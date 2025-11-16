#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import dotenv from "dotenv";
import * as ec2 from "aws-cdk-lib/aws-ec2";
// import { InfraStack } from "../lib/infra-stack";
import { S3Stack } from "../lib/s3-stack";
import { VpcStack } from "../lib/vpc-stack";
import { AuroraStack } from "../lib/aurora-stack";
import { EcsStack } from "../lib/ecs-stack";

dotenv.config();

const app = new cdk.App();

const environment = process.env.ENV ?? "dev";
const env = {
  account: process.env.AWS_ACCOUNT_ID,
  region: process.env.AWS_REGION,
};

// -------------- Create stacks ------------------

// S3
const s3Stack = new S3Stack(app, "S3Stack", {
  env: env,

  environment: environment,
});

// VPC
// const vpcStack = new VpcStack(app, "VpcStack", {
//   env: env,
//   environment: environment,
// });

// Import existing VPC
const vpc = ec2.Vpc.fromLookup(s3Stack, "ExistingVPC", {
  vpcId: process.env.VPC_ID,
});

// Aurora
const auroraStack = new AuroraStack(app, "AuroraStack", {
  env: env,
  environment: environment,
  vpc: vpc,
  databaseName: process.env.DATABASE_NAME ?? "eduka3ddb",
  databaseUsername: process.env.DATABASE_USERNAME ?? "admin",
  backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS ?? "7"),
});

// ECS
const ecsStack = new EcsStack(app, "EcsStack", {
  env: env,
  environment: environment,
  vpc: vpc,
  bucketName: s3Stack.bucket.bucketName,
  cdnDomainName: s3Stack.distribution.domainName,
  ecrRepositoryName: process.env.ECR_REPOSITORY_NAME ?? "eduka3d",
  acmCertificateArn: process.env.ACM_CERTIFICATE_ARN ?? "",
  dbSecret: auroraStack.secret,
  parameterStorePath: `/eduka3d/${environment}`,
});

ecsStack.addDependency(auroraStack);
app.synth();

// new InfraStack(app, "InfraStack", {
//   /* If you don't specify 'env', this stack will be environment-agnostic.
//    * Account/Region-dependent features and context lookups will not work,
//    * but a single synthesized template can be deployed anywhere. */
//   /* Uncomment the next line to specialize this stack for the AWS Account
//    * and Region that are implied by the current CLI configuration. */
//   // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
//   /* Uncomment the next line if you know exactly what Account and Region you
//    * want to deploy the stack to. */
//   // env: { account: '123456789012', region: 'us-east-1' },
//   /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
// });
