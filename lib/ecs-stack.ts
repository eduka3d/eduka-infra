// ECS cluster stack
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import {
  createSecretsMap,
  createParameterStorePolicy,
  createKmsDecryptPolicy,
  DEFAULT_PARAMETERS,
} from "./utils/parameter-store-helper";

interface EcsFargateStackProps extends cdk.StackProps {
  environment: string; // dev, staging, prod
  vpc: ec2.IVpc;
  bucketName: string; // S3 bucket name
  cdnDomainName: string; // CloudFront distribution domain name
  ecrRepositoryName: string; // ECR repository name
  acmCertificateArn: string; // ACM certificate ARN for HTTPS
  dbSecret: secretsmanager.ISecret;
  parameterStorePath?: string; // Path in Parameter Store for environment variables (default: /eduka3d/{environment}/)
}

export class EcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsFargateStackProps) {
    super(scope, id, props);

    const env = props.environment;

    // Reference the existing ECR repository
    const ecrRepo = ecr.Repository.fromRepositoryName(
      this,
      "ExistingEcrRepository",
      props.ecrRepositoryName
    );

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "EcsCluster", {
      clusterName: `eduka3d-${env}-fargate-cluster`,
      vpc: props.vpc,
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "FargateTaskDef",
      {
        memoryLimitMiB: 512,
        cpu: 256,
      }
    );

    // Grant execution role permissions for Parameter Store
    taskDefinition.executionRole?.addToPrincipalPolicy(
      createParameterStorePolicy(env, this.region, this.account)
    );

    // Grant execution role permissions for KMS decryption
    taskDefinition.executionRole?.addToPrincipalPolicy(
      createKmsDecryptPolicy()
    );

    // Grant task role permissions for s3 access
    taskDefinition.taskRole?.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject",
        ],
        resources: [
          `arn:aws:s3:::${props.bucketName}`,
          `arn:aws:s3:::${props.bucketName}/*`,
        ],
      })
    );

    // Create secrets map from Parameter Store using the helper
    const secretsMap = createSecretsMap(this, env, DEFAULT_PARAMETERS);
    secretsMap["DATABASE_PASSWORD"] = ecs.Secret.fromSecretsManager(
      props.dbSecret,
      "password"
    );

    // Add a container to the task definition
    const container = taskDefinition.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "latest"),
      logging: ecs.LogDriver.awsLogs({ streamPrefix: "eduka3d" }),
      environment: {
        DEBUG: env === "prod" ? "False" : "True",
        // DJANGO_SITE_ID: "1",
        DJANGO_USE_S3: "True",

        // Database
        DATABASE_ENGINE: "django.db.backends.mysql",

        // S3
        AWS_STORAGE_BUCKET_NAME: props.bucketName,
        AWS_S3_REGION_NAME: this.region,
        AWS_S3_CUSTOM_DOMAIN: props.cdnDomainName,
      },
      secrets: secretsMap,
    });

    container.addPortMappings({
      containerPort: 8000,
      hostPort: 8000,
      protocol: ecs.Protocol.TCP,
    });

    // ACM Certificate for HTTPS
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "AcmCertificate",
      props.acmCertificateArn
    );

    // Application Load Balanced Fargate Service
    const fargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "FargateService",
        {
          cluster,
          taskDefinition: taskDefinition,
          desiredCount: 1,
          enableExecuteCommand: true,
          certificate,
          publicLoadBalancer: true,
          loadBalancerName: `eduka3d-${env}-alb`,
          sslPolicy: elbv2.SslPolicy.RECOMMENDED,
          redirectHTTP: true,
          protocol: elbv2.ApplicationProtocol.HTTPS,
          serviceName: `eduka3d-${env}-fargate-service`,

          // Health check settings
          minHealthyPercent: 50, // Allow rolling updates: only 50% must be healthy
          maxHealthyPercent: 200, // Allow 200% during updates for smooth transitions

          // public subnet is preferred for cost savings. as it doesn't require NAT gateway.
          taskSubnets: {
            subnetType: ec2.SubnetType.PUBLIC,
          },
          assignPublicIp: true,
        }
      );

    // Configure health check on target group
    fargateService.targetGroup.configureHealthCheck({
      path: "/health",
      port: "8000",
      protocol: elbv2.Protocol.HTTP,
      interval: cdk.Duration.seconds(60), // Check every 60 seconds (more relaxed)
      timeout: cdk.Duration.seconds(10),
      healthyThresholdCount: 3, // Require 3 successful checks
      unhealthyThresholdCount: 5, // Allow 5 failures before marking unhealthy
    });

    // Set health check grace period for ECS tasks to initialize (60 seconds)
    fargateService.service.node.tryRemoveChild("ServiceTaskCountTarget");
    const serviceCfn = fargateService.service.node
      .defaultChild as ecs.CfnService;
    serviceCfn.healthCheckGracePeriodSeconds = 60;

    // Add deregistration delay for graceful shutdown
    fargateService.targetGroup.setAttribute(
      "deregistration_delay.timeout_seconds",
      "30"
    );

    // Add startup grace period (stickiness_lb_cookie duration) for app initialization
    fargateService.targetGroup.setAttribute(
      "stickiness.lb_cookie.duration_seconds",
      "86400"
    );

    // Configure autoscaling
    const scaling = fargateService.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 3,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
    });

    scaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: 80,
    });

    // Outputs
    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
      description: "ECS Cluster Name",
    });

    new cdk.CfnOutput(this, "ServiceName", {
      value: fargateService.service.serviceName,
      description: "ECS Service Name",
    });
  }
}
