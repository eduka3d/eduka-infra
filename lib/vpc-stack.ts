// VPC stack
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";

interface VpcStackProps extends cdk.StackProps {
  environment: string;
}

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    const env = props.environment;

    // VPC Flow Logs
    const vpcFlowLogs = new logs.LogGroup(this, "VpcFlowLogs", {
      logGroupName: `/eduka3d/${env}/flowlogs/`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a VPC
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 3, // Maximum number of availability zones
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      natGateways: 1, // Number of NAT Gateways
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "PublicSubnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "PrivateSubnet",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        // {
        //   cidrMask: 24,
        //   name: 'IsolatedSubnet',
        //   subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        // },
      ],
      flowLogs: {
        cloudwatch: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(vpcFlowLogs),
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });

    // Add tags to the VPC
    cdk.Tags.of(this.vpc).add("Name", `eduka3d-${env}-vpc`);
    cdk.Tags.of(this.vpc).add("Environment", env);
    cdk.Tags.of(this.vpc).add("Project", "eduka3d");

    // Add tags to subnets
    this.vpc.publicSubnets.forEach((subnet, index) => {
      cdk.Tags.of(subnet).add("Name", `Public-Subnet-${index + 1}`);
      cdk.Tags.of(subnet).add("Environment", env);
      cdk.Tags.of(subnet).add("Project", "eduka3d");
    });

    this.vpc.privateSubnets.forEach((subnet, index) => {
      cdk.Tags.of(subnet).add("Name", `Private-Subnet-${index + 1}`);
      cdk.Tags.of(subnet).add("Environment", env);
      cdk.Tags.of(subnet).add("Project", "eduka3d");
    });

    // output the VPC ID
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
    });
  }
}
