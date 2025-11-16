// Aurora Serverless MySQL Database Cluster
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as logs from "aws-cdk-lib/aws-logs";

interface AuroraStackProps extends cdk.StackProps {
  environment: string;
  vpc: ec2.IVpc;
  databaseName?: string;
  databaseUsername?: string;
  backupRetentionDays?: number;
}

export class AuroraStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: AuroraStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const databaseName = props.databaseName || "eduka3ddb";
    const databaseUsername = props.databaseUsername || "admin";
    const backupRetention =
      props.backupRetentionDays ?? (env === "prod" ? 30 : 7);

    // Security Group for Aurora Serverless
    const auroraSecurityGroup = new ec2.SecurityGroup(
      this,
      "AuroraSecurityGroup",
      {
        vpc: props.vpc,
        description: `Security group for Aurora Serverless cluster in ${env}`,
        securityGroupName: `eduka3d-${env}-aurora-sg`,
        allowAllOutbound: true,
      }
    );

    // Allow connections from within the VPC on port 3306 (MySQL)
    auroraSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(3306),
      "Allow MySQL connections from VPC"
    );

    // Optional: Allow connections from specific security groups (e.g., ECS tasks)
    // This can be added later if needed

    // Create Aurora Serverless Cluster
    this.cluster = new rds.DatabaseCluster(this, "AuroraV2Cluster", {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_0,
      }),
      writer: rds.ClusterInstance.serverlessV2("writer", {
        enablePerformanceInsights: env === "prod" ? true : false,
      }),
      // readers: [rds.ClusterInstance.serverlessV2("reader")],
      vpc: props.vpc,
      vpcSubnets: {
        // public subnet is preferred for cost savings. as it doesn't require NAT gateway.
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroups: [auroraSecurityGroup],
      storageEncrypted: env === "prod" ? true : false,
      defaultDatabaseName: databaseName,
      credentials: rds.Credentials.fromUsername(databaseUsername, {
        excludeCharacters: '"@/\\',
      }),
      clusterIdentifier: `eduka3d-${env}-aurora-cluster`,
      backup: {
        retention: cdk.Duration.days(backupRetention),
        preferredWindow: "02:00-03:00",
      },
      removalPolicy:
        env === "prod" ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
      deletionProtection: env === "prod" ? true : false,
    });

    // Store the database secret
    const dbSecret = this.cluster.secret as secretsmanager.ISecret;
    this.secret = dbSecret as any;

    // Export database endpoint to Parameter Store
    new ssm.StringParameter(this, "DatabaseEndpointParameter", {
      parameterName: `/eduka3d/${env}/DATABASE_HOST`,
      stringValue: this.cluster.clusterEndpoint.hostname,
      description: "Aurora Serverless cluster endpoint",
    });

    // Export database port to Parameter Store
    new ssm.StringParameter(this, "DatabasePortParameter", {
      parameterName: `/eduka3d/${env}/DATABASE_PORT`,
      stringValue: "3306",
      description: "Aurora Serverless MySQL port",
    });

    // Export database name to Parameter Store
    new ssm.StringParameter(this, "DatabaseNameParameter", {
      parameterName: `/eduka3d/${env}/DATABASE_NAME`,
      stringValue: databaseName,
      description: "Aurora Serverless database name",
    });

    // Export database username to Parameter Store
    new ssm.StringParameter(this, "DatabaseUserParameter", {
      parameterName: `/eduka3d/${env}/DATABASE_USER`,
      stringValue: databaseUsername,
      description: "Aurora Serverless database username",
    });

    // Exports for CloudFormation
    new cdk.CfnOutput(this, "ClusterEndpoint", {
      value: this.cluster.clusterEndpoint.hostname,
      description: "Aurora Serverless cluster endpoint",
      exportName: `eduka3d-${env}-aurora-endpoint`,
    });

    new cdk.CfnOutput(this, "ClusterPort", {
      value: "3306",
      description: "Aurora Serverless MySQL port",
      exportName: `eduka3d-${env}-aurora-port`,
    });

    new cdk.CfnOutput(this, "DatabaseName", {
      value: databaseName,
      description: "Database name",
      exportName: `eduka3d-${env}-db-name`,
    });

    new cdk.CfnOutput(this, "DatabaseUser", {
      value: databaseUsername,
      description: "Database username",
      exportName: `eduka3d-${env}-db-user`,
    });

    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: this.secret.secretArn,
      description: "Database secret ARN",
      exportName: `eduka3d-${env}-db-secret-arn`,
    });

    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: auroraSecurityGroup.securityGroupId,
      description: "Aurora Serverless security group ID",
      exportName: `eduka3d-${env}-aurora-sg`,
    });
  }
}
