#!/bin/bash

# Script to populate AWS Systems Manager Parameter Store from .env files
# Usage: ./setup-parameter-store.sh dev|prod|staging [env-file-path] [profile] [region]

# Note: removed set -e to allow script to continue even if individual parameters fail

ENVIRONMENT="${1:?Error: environment required (dev|prod|staging)}"
ENV_FILE="${2:-./../ab3d/.env}"
PROFILE="${3:-eduka3d}"
REGION="${4:-eu-central-1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}📋 Parameter Store Setup for Environment: ${ENVIRONMENT}${NC}"
echo -e "${YELLOW}📁 Using env file: ${ENV_FILE}${NC}"

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ Error: .env file not found at $ENV_FILE${NC}"
    exit 1
fi

# Parameters that should be stored as SecureString (sensitive data)
SECURE_PARAMS=(
    ""
)

# Function to check if a parameter should be secure
is_secure_param() {
    local param=$1
    for secure in "${SECURE_PARAMS[@]}"; do
        if [[ "$param" == "$secure" ]]; then
            return 0
        fi
    done
    return 1
}

# Counter for created parameters
CREATED=0
UPDATED=0
FAILED=0

# Read .env file and create/update parameters
while IFS= read -r line; do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^#.*$ ]] && continue
    
    # Parse key=value pairs correctly
    key="${line%%=*}"
    value="${line#*=}"
    
    # Trim whitespace from key
    key=$(echo "$key" | xargs)
    
    # Skip if value is empty or contains placeholder text
    if [[ -z "$value" || "$value" =~ "your-" || "$value" =~ "YOUR_" || "$value" =~ "example" ]]; then
        echo -e "${YELLOW}⏭️  Skipping $key (placeholder value)${NC}"
        continue
    fi
    
    PARAM_NAME="/eduka3d/${ENVIRONMENT}/${key}"
    PARAM_TYPE="String"
    
    # Determine if this should be a SecureString
    if is_secure_param "$key"; then
        PARAM_TYPE="SecureString"
    fi
    
    echo -n "Setting $key... "
    
    # Create or update parameter
    if aws ssm put-parameter \
        --name "$PARAM_NAME" \
        --value "$value" \
        --type "$PARAM_TYPE" \
        --overwrite \
        --region "$REGION" \
        --profile "$PROFILE" > /tmp/put-parameter.log 2>&1; then
        
        echo -e "${GREEN}✓${NC}"
        ((CREATED++))
    else
        echo -e "${RED}✗${NC}"
        ((FAILED++))
    fi
done < "$ENV_FILE"

# Summary
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Successfully created/updated: $CREATED parameters${NC}"
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}✗ Failed: $FAILED parameters${NC}"
fi
echo -e "${GREEN}═══════════════════════════════════════${NC}"

# List created parameters
echo ""
echo -e "${YELLOW}📝 Created parameters in Parameter Store:${NC}"
aws ssm get-parameters-by-path \
    --path "/eduka3d/${ENVIRONMENT}" \
    --recursive \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query 'Parameters[*].[Name,Type]' \
    --output table

echo ""
echo -e "${GREEN}✓ Parameter Store setup complete!${NC}"
