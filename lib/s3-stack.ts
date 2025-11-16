// S3 and CloudFront stack
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfront_origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";

interface S3StackProps extends cdk.StackProps {
  environment: string;
}

export class S3Stack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: S3StackProps) {
    super(scope, id, props);

    const env = props.environment;

    var bucketName = `eduka3d-${env}-bucket`;

    this.bucket = new s3.Bucket(this, "eduka3d-bucket", {
      bucketName: bucketName,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          exposedHeaders: ["Access-Control-Allow-Origin"],
        },
      ],

      removalPolicy:
        env === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: env === "prod" ? false : true,
    });

    // Create CloudFront distribution
    this.distribution = new cloudfront.Distribution(
      this,
      `eduka3d-${env}-distribution`,
      {
        defaultBehavior: {
          origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
            this.bucket
          ),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        defaultRootObject: "index.html",
      }
    );

    // create iam policy for bucket
    // const bucketPolicy = new iam.Policy(this, "BucketPolicy", {
    //   policyName: `eduka3d-${env}-bucket-policy`,
    //   statements: [
    //     new iam.PolicyStatement({
    //       actions: ["s3:GetObject"],
    //       resources: [this.bucket.arnForObjects("*")],
    //       principals: [new iam.AnyPrincipal()],
    //     }),
    //   ],
    // });

    // Output
    new cdk.CfnOutput(this, "BucketName", {
      value: this.bucket.bucketName,
      exportName: `${env}-BucketName`,
    });

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: this.distribution.domainName,
      exportName: `${env}-DistributionDomainName`,
    });

    // new cdk.CfnOutput(this, "PolicyName", {
    //   value: bucketPolicy.policyName,
    //   exportName: `${env}-BucketPolicy`,
    // });
  }
}
