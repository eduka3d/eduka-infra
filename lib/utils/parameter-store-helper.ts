/**
 * Utility module for managing Parameter Store secrets in ECS stack
 *
 * This module provides helper functions to:
 * 1. Create secrets maps from Parameter Store
 * 2. Generate IAM policies for parameter access
 * 3. Fetch parameter values during stack synthesis
 */

import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Configuration for a Parameter Store secret
 */
interface ParameterSecret {
  environmentVariable: string;
  parameterPath: string;
  type?: "String" | "SecureString";
  required?: boolean;
}

/**
 * Creates an ECS Secret from a Parameter Store parameter
 * @param construct The CDK construct
 * @param logicalId Unique logical ID for the parameter
 * @param parameterPath The path to the parameter (e.g., /eduka3d/dev/DJANGO_SECRET_KEY)
 * @returns ECS Secret
 */
export function createParameterStoreSecret(
  construct: Construct,
  logicalId: string,
  parameterPath: string
): ecs.Secret {
  const param = ssm.StringParameter.fromStringParameterAttributes(
    construct,
    logicalId,
    {
      parameterName: parameterPath,
    }
  );

  return ecs.Secret.fromSsmParameter(param);
}

/**
 * Creates a map of secrets from Parameter Store
 * @param construct The CDK construct
 * @param environment The deployment environment (dev, staging, prod)
 * @param parameters Array of parameter configurations
 * @returns Map of environment variable names to ECS Secrets
 */
export function createSecretsMap(
  construct: Construct,
  environment: string,
  parameters: ParameterSecret[]
): { [key: string]: ecs.Secret } {
  const secretsMap: { [key: string]: ecs.Secret } = {};

  for (const param of parameters) {
    const parameterPath = param.parameterPath.includes("/")
      ? param.parameterPath
      : `/eduka3d/${environment}/${param.parameterPath}`;

    try {
      secretsMap[param.environmentVariable] = createParameterStoreSecret(
        construct,
        param.environmentVariable,
        parameterPath
      );
    } catch (error) {
      if (param.required !== false) {
        console.warn(
          `Warning: Could not create secret for ${param.environmentVariable} at ${parameterPath}`
        );
      }
    }
  }

  return secretsMap;
}

/**
 * Generates an IAM policy statement for Parameter Store access
 * @param environment The deployment environment
 * @param region AWS region
 * @param accountId AWS account ID
 * @returns IAM PolicyStatement
 */
export function createParameterStorePolicy(
  environment: string,
  region: string,
  accountId: string
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    actions: [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ],
    resources: [
      `arn:aws:ssm:${region}:${accountId}:parameter/eduka3d/${environment}/*`,
    ],
    effect: iam.Effect.ALLOW,
  });
}

/**
 * Generates an IAM policy statement for KMS decryption
 * @returns IAM PolicyStatement
 */
export function createKmsDecryptPolicy(): iam.PolicyStatement {
  return new iam.PolicyStatement({
    actions: ["kms:Decrypt", "kms:DescribeKey"],
    resources: ["*"],
    effect: iam.Effect.ALLOW,
  });
}

/**
 * Default parameters based on .env.example
 */
export const DEFAULT_PARAMETERS: ParameterSecret[] = [
  // Django
  {
    environmentVariable: "DJANGO_SECRET_KEY",
    parameterPath: "DJANGO_SECRET_KEY",
    type: "SecureString",
    required: true,
  },
  {
    environmentVariable: "DJANGO_ALLOWED_HOSTS",
    parameterPath: "DJANGO_ALLOWED_HOSTS",
    type: "String",
  },
  {
    environmentVariable: "DJANGO_CSRF_TRUSTED_ORIGINS",
    parameterPath: "DJANGO_CSRF_TRUSTED_ORIGINS",
    type: "String",
  },
  {
    environmentVariable: "DATABASE_NAME",
    parameterPath: "DATABASE_NAME",
    type: "String",
    required: true,
  },
  {
    environmentVariable: "DATABASE_USER",
    parameterPath: "DATABASE_USER",
    type: "String",
    required: true,
  },
  {
    environmentVariable: "DATABASE_HOST",
    parameterPath: "DATABASE_HOST",
    type: "String",
    required: true,
  },
  {
    environmentVariable: "DATABASE_PORT",
    parameterPath: "DATABASE_PORT",
    type: "String",
    required: true,
  },

  // Email
  {
    environmentVariable: "EMAIL_HOST",
    parameterPath: "EMAIL_HOST",
    type: "String",
  },
  {
    environmentVariable: "EMAIL_PORT",
    parameterPath: "EMAIL_PORT",
    type: "String",
  },
  {
    environmentVariable: "EMAIL_HOST_USER",
    parameterPath: "EMAIL_HOST_USER",
    type: "String",
  },
  {
    environmentVariable: "EMAIL_HOST_PASSWORD",
    parameterPath: "EMAIL_HOST_PASSWORD",
    type: "SecureString",
  },
  {
    environmentVariable: "EMAIL_USE_TLS",
    parameterPath: "EMAIL_USE_TLS",
    type: "String",
  },
  {
    environmentVariable: "DEFAULT_FROM_EMAIL",
    parameterPath: "DEFAULT_FROM_EMAIL",
    type: "String",
  },

  // reCAPTCHA
  {
    environmentVariable: "RECAPTCHA_PUBLIC_KEY",
    parameterPath: "RECAPTCHA_PUBLIC_KEY",
    type: "String",
  },
  {
    environmentVariable: "RECAPTCHA_PRIVATE_KEY",
    parameterPath: "RECAPTCHA_PRIVATE_KEY",
    type: "SecureString",
  },

  //   // PayPal
  //   {
  //     environmentVariable: "PAYPAL_ENVIRONMENT",
  //     parameterPath: "PAYPAL_ENVIRONMENT",
  //     type: "String",
  //   },
  //   {
  //     environmentVariable: "PAYPAL_CLIENT_ID",
  //     parameterPath: "PAYPAL_CLIENT_ID",
  //     type: "String",
  //   },
  //   {
  //     environmentVariable: "PAYPAL_CLIENT_SECRET",
  //     parameterPath: "PAYPAL_CLIENT_SECRET",
  //     type: "SecureString",
  //   },

  // Stripe
  {
    environmentVariable: "STRIPE_PUBLISHABLE_KEY",
    parameterPath: "STRIPE_PUBLISHABLE_KEY",
    type: "String",
  },
  {
    environmentVariable: "STRIPE_SECRET_KEY",
    parameterPath: "STRIPE_SECRET_KEY",
    type: "SecureString",
  },
];
