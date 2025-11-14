#!/bin/bash

# Build and push Docker image to ECR
# Usage: ./build-and-push.sh [TAG] [PROFILE] [REGION]
# Examples:
#   ./build-and-push.sh                           # Default: latest, eduka3d, eu-central-1
#   ./build-and-push.sh v1.0.0                    # Custom tag
#   ./build-and-push.sh v1.0.0 eduka3d eu-west-1 # All custom

set -e

# Configuration
TAG=${1:-"latest"}
PROFILE=${2:-"eduka3d"}
REGION=${3:-"eu-central-1"}
REPO_NAME="eduka3d"
APP_DIR="ab3d"
DOCKERFILE="${APP_DIR}/Dockerfile"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Check prerequisites
check_prerequisites() {
  log_step "Checking prerequisites..."
  
  # Check Docker
  if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed"
    exit 1
  fi
  log_success "Docker is installed"
  
  # Check AWS CLI
  if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is not installed"
    exit 1
  fi
  log_success "AWS CLI is installed"
  
  # Check Dockerfile exists
  if [ ! -f "$DOCKERFILE" ]; then
    log_error "Dockerfile not found at: $DOCKERFILE"
    exit 1
  fi
  log_success "Dockerfile found at: $DOCKERFILE"
}

# Header
echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  🐳 Docker Build & Push to ECR         ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
echo ""
log_info "Configuration:"
echo "  Tag:     $TAG"
echo "  Profile: $PROFILE"
echo "  Region:  $REGION"
echo "  Repo:    $REPO_NAME"
echo ""

# Check prerequisites
check_prerequisites

# Step 1: Get AWS Account ID
log_step "Step 1: Getting AWS Account ID..."
if ! ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile $PROFILE 2>&1); then
  log_error "Failed to get AWS Account ID. Check your AWS credentials."
  log_error "Try: aws configure --profile $PROFILE"
  exit 1
fi
log_success "Account ID: $ACCOUNT_ID"

# Step 2: Construct ECR URI
log_step "Step 2: Constructing ECR Registry URI..."
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
REPO_URI="${REGISTRY}/${REPO_NAME}"
IMAGE_URI="${REPO_URI}:${TAG}"

log_success "Registry: $REGISTRY"
log_success "Repository: $REPO_NAME"
log_success "Image URI: $IMAGE_URI"

# Step 3: Check if repository exists, create if not
log_step "Step 3: Checking ECR repository..."
if aws ecr describe-repositories \
    --repository-names $REPO_NAME \
    --region $REGION \
    --profile $PROFILE &>/dev/null; then
  log_success "Repository exists"
else
  log_warning "Repository doesn't exist. Creating..."
  if aws ecr create-repository \
      --repository-name $REPO_NAME \
      --region $REGION \
      --profile $PROFILE > /dev/null; then
    log_success "Repository created"
  else
    log_error "Failed to create repository"
    exit 1
  fi
fi

# Step 4: Authenticate Docker with ECR
log_step "Step 4: Authenticating Docker with ECR..."
if aws ecr get-login-password \
    --region $REGION \
    --profile $PROFILE 2>/dev/null | docker login \
    --username AWS \
    --password-stdin $REGISTRY > /dev/null 2>&1; then
  log_success "Docker authenticated successfully"
else
  log_error "Docker authentication failed. Check your credentials."
  exit 1
fi

# Step 5: Build Docker image
log_step "Step 5: Building Docker image..."
log_info "Building from: $DOCKERFILE"
if docker build \
    -t eduka3d:local \
    -f $DOCKERFILE \
    ./${APP_DIR} > /tmp/docker-build.log 2>&1; then
  log_success "Image built successfully"
else
  log_error "Docker build failed. See details below:"
  tail -20 /tmp/docker-build.log
  exit 1
fi

# Get image size
IMAGE_SIZE=$(docker inspect eduka3d:local --format='{{.Size}}' | numfmt --to=iec 2>/dev/null || echo "")
if [ -n "$IMAGE_SIZE" ]; then
  log_info "Image size: $IMAGE_SIZE"
fi

# Step 6: Tag image
log_step "Step 6: Tagging image..."
docker tag eduka3d:local $IMAGE_URI
log_success "Tagged as: $IMAGE_URI"

# Also tag as latest if not already
if [ "$TAG" != "latest" ]; then
  docker tag eduka3d:local ${REPO_URI}:latest
  log_success "Also tagged as: ${REPO_URI}:latest"
fi

# Step 7: Push to ECR
log_step "Step 7: Pushing image to ECR..."
if docker push $IMAGE_URI > /tmp/docker-push.log 2>&1 && \
   [ "$TAG" != "latest" ] && docker push ${REPO_URI}:latest >> /tmp/docker-push.log 2>&1; then
  log_success "Image pushed successfully"
else
  log_error "Push failed. See details below:"
  tail -20 /tmp/docker-push.log
  exit 1
fi

# Step 8: Verify
log_step "Step 8: Verifying image in ECR..."
IMAGES=$(aws ecr describe-images \
    --repository-name $REPO_NAME \
    --region $REGION \
    --profile $PROFILE \
    --query "imageDetails[*].imageTags[]" \
    --output text 2>/dev/null)

if [ -n "$IMAGES" ]; then
  log_success "Images in repository:"
  echo "$IMAGES" | tr ' ' '\n' | sed 's/^/    /'
else
  log_warning "No images found in repository"
fi

# Cleanup
log_step "Cleanup: Removing local image..."
docker rmi eduka3d:local > /dev/null 2>&1
log_success "Cleanup complete"

# Summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Workflow Complete!                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
log_info "Image details:"
echo "  URI:    $IMAGE_URI"
echo "  Tag:    $TAG"
echo "  Repo:   $REPO_URI"
echo ""
log_info "Next steps:"
echo "  1. Use this URI in your ECS task definition:"
echo "     $IMAGE_URI"
echo "  2. Deploy with: cdk deploy --context environment=dev"
echo "  3. Verify in ECS console"
echo ""
