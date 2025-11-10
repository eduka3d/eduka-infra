// ECS cluster stack
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

interface EcsFargateStackProps extends cdk.StackProps {
  environment: string;
  vpcId: string; // VPC Id
  ecrRepositoryName: string; // ECR repository name
  acmCertificateArn?: string; // ACM certificate ARN for HTTPS
  secretArn?: string; // Secret ARN for Fargate Service
}

export class EscStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsFargateStackProps) {
    super(scope, id, props);

    const env = props.environment;

    // Lookup existing VPC using VPC ID from props
    const vpc = ec2.Vpc.fromLookup(this, "EcsVpc", {
      vpcId: props.vpcId,
    });

    // Reference the existing ECR repository
    const ecrRepo = ecr.Repository.fromRepositoryName(
      this,
      "ExistingEcrRepository",
      props.ecrRepositoryName
    );

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "EcsCluster", {
      clusterName: `eduka3d-${env}-fargate-cluster`,
      vpc,
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

    // Reference the secret from AWS Secrets Manager
    // const taskSecret = secretsmanager.Secret.fromSecretCompleteArn(
    //   this,
    //   "FargateTaskSecret",
    //   props.secretArn
    // );

    // Add a container to the task definition
    const container = taskDefinition.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "latest"),
      logging: ecs.LogDriver.awsLogs({ streamPrefix: "ecs-app" }),
      environment: {
        DEBUG: env === "prod" ? "False" : "True",
      },
      //   secrets: {
      //     SECRET_KEY: ecs.Secret.fromSecretsManager(taskSecret, "SECRET_KEY"), // Referencing secret for SECRET_KEY
      //   },
    });

    container.addPortMappings({
      containerPort: 5000, // Container runs on port 5000
    });

    // ACM Certificate for HTTPS
    // const certificate = acm.Certificate.fromCertificateArn(
    //   this,
    //   "AcmCertificate",
    //   props.acmCertificateArn
    // );

    // Application Load Balanced Fargate Service
    const fargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "FargateService",
        {
          cluster,
          taskDefinition,
          enableExecuteCommand: true, // Enable execute command
          //   certificate,
          publicLoadBalancer: true,
          loadBalancerName: `eduka3d-${env}-alb`,
          sslPolicy: elbv2.SslPolicy.RECOMMENDED,
          serviceName: `eduka3d-${env}-fargate-service`,
          redirectHTTP: true,
          protocol: elbv2.ApplicationProtocol.HTTPS, // Default HTTPS
        }
      );

    // Adjust target group port to match the container port
    fargateService.targetGroup.configureHealthCheck({
      path: "/",
      port: "5000", // Health check targets container port 5000
    });

    // Autoscaling
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
