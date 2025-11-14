#!/bin/bash

# Script to validate Parameter Store setup and ECS configuration
# Usage: ./validate-parameter-store.sh dev|prod|staging [profile] [region]

# set -e

ENVIRONMENT="${1:?Error: environment required (dev|prod|staging)}"
PROFILE="${2:-eduka3d}"
REGION="${3:-eu-central-1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}Parameter Store Validation${NC}"
echo -e "${BLUE}Environment: $ENVIRONMENT${NC}"
echo -e "${BLUE}Region: $REGION${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

CHECKS_PASSED=0
CHECKS_FAILED=0

# Function to check a parameter exists
check_parameter() {
    local param_name=$1
    local param_path="/eduka3d/${ENVIRONMENT}/${param_name}"
    
    if aws ssm get-parameter \
        --name "$param_path" \
        --region "$REGION" \
        --profile "$PROFILE" \
        --query 'Parameter.Name' \
        --output text &>/dev/null; then
        echo -e "${GREEN}✓${NC} $param_name"
        ((CHECKS_PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} $param_name (NOT FOUND)"
        ((CHECKS_FAILED++))
        return 1
    fi
}

# Function to check parameter type
check_parameter_type() {
    local param_name=$1
    local expected_type=$2
    local param_path="/eduka3d/${ENVIRONMENT}/${param_name}"
    
    local param_type=$(aws ssm get-parameter \
        --name "$param_path" \
        --region "$REGION" \
        --profile "$PROFILE" \
        --query 'Parameter.Type' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$param_type" = "$expected_type" ]; then
        echo -e "${GREEN}✓${NC} $param_name ($param_type)"
        ((CHECKS_PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} $param_name (Expected: $expected_type, Got: $param_type)"
        ((CHECKS_FAILED++))
        return 1
    fi
}

# Check basic parameters
echo -e "${YELLOW}Checking required parameters:${NC}"
check_parameter "DJANGO_SECRET_KEY"
check_parameter "DATABASE_ENGINE"
check_parameter "DATABASE_NAME"
check_parameter "DATABASE_USER"
check_parameter "DATABASE_PASSWORD"
check_parameter "DATABASE_HOST"
check_parameter "DATABASE_PORT"

echo ""
echo -e "${YELLOW}Checking AWS/S3 parameters:${NC}"
check_parameter "AWS_STORAGE_BUCKET_NAME"
check_parameter "AWS_S3_REGION_NAME"

echo ""
echo -e "${YELLOW}Checking Email parameters:${NC}"
check_parameter "EMAIL_HOST"
check_parameter "EMAIL_PORT"
check_parameter "EMAIL_HOST_USER"

echo ""
echo -e "${YELLOW}Checking Payment parameters:${NC}"
# check_parameter "PAYPAL_ENVIRONMENT" || true
check_parameter "STRIPE_PUBLISHABLE_KEY" || true

echo ""
echo -e "${YELLOW}Checking parameter types (secure vs standard):${NC}"
check_parameter_type "DJANGO_SECRET_KEY" "SecureString"
check_parameter_type "DATABASE_PASSWORD" "SecureString"
check_parameter_type "DJANGO_ALLOWED_HOSTS" "String"

# Check IAM role permissions
echo ""
echo -e "${YELLOW}Checking IAM role permissions:${NC}"

# List available IAM roles
EXEC_ROLES=$(aws iam list-roles \
    --query "Roles[?contains(AssumeRolePolicyDocument, 'ecs-tasks')].RoleName" \
    --output text)

if [ -z "$EXEC_ROLES" ]; then
    echo -e "${YELLOW}⚠${NC}  No ECS task execution roles found (might not be deployed yet)"
else
    for role in $EXEC_ROLES; do
        echo -e "${BLUE}Checking role: $role${NC}"
        
        # Check for SSM permissions
        if aws iam get-role-policy "$role" --policy-name "*ssm*" &>/dev/null; then
            echo -e "${GREEN}✓${NC} Has SSM parameter access"
            ((CHECKS_PASSED++))
        else
            echo -e "${YELLOW}⚠${NC}  SSM policy not found (role might be newly created)"
        fi
    done
fi

# List all parameters for this environment
echo ""
echo -e "${YELLOW}All parameters for $ENVIRONMENT:${NC}"
PARAM_COUNT=$(aws ssm get-parameters-by-path \
    --path "/eduka3d/${ENVIRONMENT}" \
    --recursive \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query 'Parameters | length(@)' \
    --output text)

echo -e "${GREEN}Total parameters: $PARAM_COUNT${NC}"

# Show parameter details
aws ssm get-parameters-by-path \
    --path "/eduka3d/${ENVIRONMENT}" \
    --recursive \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query 'Parameters[*].[Name,Type,Value]' \
    --output table | head -20

# Check if parameter values are still placeholders
echo ""
echo -e "${YELLOW}Checking for placeholder values:${NC}"
PLACEHOLDER_COUNT=$(aws ssm get-parameters-by-path \
    --path "/eduka3d/${ENVIRONMENT}" \
    --recursive \
    --region "$REGION" \
    --profile "$PROFILE" \
    --with-decryption \
    --query "Parameters[?contains(Value, 'your-') || contains(Value, 'YOUR_') || contains(Value, 'example')].Name" \
    --output text | wc -w)

if [ "$PLACEHOLDER_COUNT" -gt 0 ]; then
    echo -e "${RED}⚠${NC}  Found $PLACEHOLDER_COUNT parameters with placeholder values"
    echo -e "${RED}   Please update these with real values${NC}"
    ((CHECKS_FAILED++))
else
    echo -e "${GREEN}✓${NC} No placeholder values found"
    ((CHECKS_PASSED++))
fi

# Check KMS access
echo ""
echo -e "${YELLOW}Checking KMS encryption:${NC}"
SECURE_PARAMS=$(aws ssm get-parameters-by-path \
    --path "/eduka3d/${ENVIRONMENT}" \
    --recursive \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query "Parameters[?Type=='SecureString'].Name" \
    --output text | wc -w)

echo -e "${GREEN}✓${NC} Found $SECURE_PARAMS SecureString parameters (encrypted)"
((CHECKS_PASSED++))

# Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}Validation Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${GREEN}Checks passed: $CHECKS_PASSED${NC}"
if [ $CHECKS_FAILED -gt 0 ]; then
    echo -e "${RED}Checks failed: $CHECKS_FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}All checks passed!${NC}"
fi

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Deploy the CDK stack: cdk deploy --context environment=$ENVIRONMENT"
echo "2. Verify ECS task has access to parameters"
echo "3. Monitor CloudWatch logs for any errors"
