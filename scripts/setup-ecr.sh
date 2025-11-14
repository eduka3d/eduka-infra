#!/bin/bash

# Setup ECR repository with best practices
# Usage: ./setup-ecr.sh [REPO_NAME] [PROFILE] [REGION]
# Examples:
#   ./setup-ecr.sh                             # Default: eduka3d, eduka3d, eu-central-1
#   ./setup-ecr.sh myapp                       # Custom repo name
#   ./setup-ecr.sh myapp myprofile eu-west-1  # All custom

set -e

# Configuration
REPO_NAME=${1:-"eduka3d"}
PROFILE=${2:-"eduka3d"}
REGION=${3:-"eu-central-1"}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Helper functions
log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

log_step() {
  echo -e "\n${YELLOW}📋 $1${NC}"
}

# Header
echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  🏗️  Setting up ECR Repository        ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
echo ""
log_info "Configuration:"
echo "  Repository: $REPO_NAME"
echo "  Profile:    $PROFILE"
echo "  Region:     $REGION"
echo ""

# Step 1: Check prerequisites
log_step "Step 1: Checking prerequisites..."
if ! command -v aws &> /dev/null; then
  log_error "AWS CLI is not installed"
  exit 1
fi
log_success "AWS CLI found"

# Verify credentials
if ! aws sts get-caller-identity --profile $PROFILE > /dev/null 2>&1; then
  log_error "Cannot access AWS with profile: $PROFILE"
  log_error "Try: aws configure --profile $PROFILE"
  exit 1
fi
log_success "AWS credentials valid"

# Step 2: Get Account ID
log_step "Step 2: Getting AWS Account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile $PROFILE)
log_success "Account ID: $ACCOUNT_ID"

# Step 3: Check/Create repository
log_step "Step 3: Checking/Creating ECR repository..."
if aws ecr describe-repositories \
    --repository-names $REPO_NAME \
    --region $REGION \
    --profile $PROFILE &>/dev/null; then
  log_success "Repository already exists: $REPO_NAME"
else
  log_warning "Repository doesn't exist. Creating..."
  if aws ecr create-repository \
      --repository-name $REPO_NAME \
      --region $REGION \
      --profile $PROFILE > /dev/null; then
    log_success "Repository created successfully"
  else
    log_error "Failed to create repository"
    exit 1
  fi
fi

# Step 4: Enable image scanning
log_step "Step 4: Configuring image scanning..."
if aws ecr put-image-scanning-configuration \
    --repository-name $REPO_NAME \
    --image-scanning-configuration scanOnPush=true \
    --region $REGION \
    --profile $PROFILE > /dev/null 2>&1; then
  log_success "Image scanning enabled"
else
  log_warning "Could not enable image scanning (may already be configured)"
fi

# Step 5: Set lifecycle policy
log_step "Step 5: Setting lifecycle policy..."

# Create temporary lifecycle policy file
LIFECYCLE_POLICY=$(cat <<'EOF'
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images after 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 2,
      "description": "Keep only last 20 tagged images (any tag)",
      "selection": {
        "tagStatus": "tagged",
        "tagPatternList": ["*"],      
        "countType": "imageCountMoreThan",
        "countNumber": 20
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 3,
      "description": "Delete images with dev prefix older than 3 days",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["dev"],
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 3
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
EOF
)

# Write to temporary file and apply
TEMP_FILE=$(mktemp)
echo "$LIFECYCLE_POLICY" > $TEMP_FILE

if aws ecr put-lifecycle-policy \
    --repository-name $REPO_NAME \
    --lifecycle-policy-text file://$TEMP_FILE \
    --region $REGION \
    --profile $PROFILE > /tmp/apply-lifecycle-policy.log 2>&1; then
  log_success "Lifecycle policy applied"
  log_info "Policy details:"
  echo "  • Untagged: expire after 7 days"
  echo "  • Tagged: keep last 20 images"
  echo "  • Dev tags: expire after 3 days"
else
  # print the error
  cat $TEMP_FILE

  log_warning "Could not apply lifecycle policy"
fi

rm -f $TEMP_FILE

# Step 6: Enable repository encryption (optional)
log_step "Step 6: Checking encryption..."
log_info "Repository uses default AES256 encryption"
log_info "For KMS encryption, update repository settings in AWS Console"

# Step 7: Get repository details
log_step "Step 7: Getting repository details..."
REPO_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"
log_success "Repository URI: $REPO_URI"

# Get repository details
REPO_ARN=$(aws ecr describe-repositories \
  --repository-names $REPO_NAME \
  --region $REGION \
  --profile $PROFILE \
  --query 'repositories[0].repositoryArn' \
  --output text)

log_info "Repository ARN: $REPO_ARN"

# Step 8: Create setup output file
log_step "Step 8: Saving configuration..."
OUTPUT_FILE="ecr-${REPO_NAME}-config.txt"

cat > $OUTPUT_FILE << EOF
ECR Repository Configuration
============================
Generated: $(date)
Repository Name: $REPO_NAME
Account ID: $ACCOUNT_ID
Region: $REGION
Repository URI: $REPO_URI
Repository ARN: $REPO_ARN

Quick Commands
==============

# Authenticate Docker
aws ecr get-login-password --region $REGION --profile $PROFILE | docker login --username AWS --password-stdin $REPO_URI

# Build image
docker build -t $REPO_NAME:latest -f ab3d/Dockerfile ./ab3d

# Tag image
docker tag $REPO_NAME:latest $REPO_URI:latest

# Push image
docker push $REPO_URI:latest

# List images
aws ecr describe-images --repository-name $REPO_NAME --region $REGION --profile $PROFILE

# View image details
aws ecr describe-images --repository-name $REPO_NAME --region $REGION --profile $PROFILE --query 'imageDetails[*].[imageTags,imageSizeInBytes,imagePushedAt]'

# Get scan results
aws ecr describe-image-scan-findings --repository-name $REPO_NAME --image-id imageTag=latest --region $REGION --profile $PROFILE

IAM Policy Required
===================
Add these permissions to your IAM user/role to use this repository:

{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "$REPO_ARN"
    }
  ]
}

ECS Task Definition Reference
============================
Use this image URI in your ECS task definition:
$REPO_URI:latest

Example in CDK:
const image = ecs.ContainerImage.fromEcrRepository(
  ecr.Repository.fromRepositoryName(this, 'EdukaRepository', '$REPO_NAME'),
  'latest'
);

Example in JSON:
{
  "image": "$REPO_URI:latest"
}
EOF

log_success "Configuration saved to: $OUTPUT_FILE"

# Summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Repository Setup Complete!        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
log_info "Repository is ready for use!"
echo ""
echo "Key Information:"
echo "  Repository URI: $REPO_URI"
echo "  Account ID:     $ACCOUNT_ID"
echo "  Region:         $REGION"
echo ""
echo "Next Steps:"
echo "  1. Build image:    docker build -t $REPO_NAME:latest -f ab3d/Dockerfile ./ab3d"
echo "  2. Authenticate:   aws ecr get-login-password ... | docker login ..."
echo "  3. Tag image:      docker tag $REPO_NAME:latest $REPO_URI:latest"
echo "  4. Push image:     docker push $REPO_URI:latest"
echo "  5. Or use script:  ./infra/scripts/build-and-push.sh"
echo ""
echo "Reference: Configuration saved to $OUTPUT_FILE"
echo ""
