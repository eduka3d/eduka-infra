#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import dotenv from "dotenv";
// import { InfraStack } from "../lib/infra-stack";
import { S3Stack } from "../lib/s3-stack";
import { VpcStack } from "../lib/vpc-stack";
import { EscStack } from "../lib/esc-stack";

dotenv.config();

const app = new cdk.App();

const environment = process.env.ENV ?? "dev";
const env = {
  account: process.env.AWS_ACCOUNT_ID,
  region: process.env.AWS_REGION,
};
// console.log(`env: ${JSON.stringify(env)}`);
// console.log(`environment: ${environment}`);

// define the stack
const s3Stack = new S3Stack(app, "S3Stack", {
  env: env,
  environment: environment,
});

const vpcStack = new VpcStack(app, "VpcStack", {
  env: env,
  environment: environment,
});

// const escStack = new EscStack(app, "EscStack", {
//   env: env,
//   environment: environment,
//   vpcId: vpcStack.vpc.vpcId,
//   ecrRepositoryName: process.env.ECR_REPOSITORY_NAME ?? "",
//   // acmCertificateArn: process.env.ACM_CERTIFICATE_ARN ?? "",
//   // secretArn: process.env.SECRET_ARN ?? "",
// });

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
