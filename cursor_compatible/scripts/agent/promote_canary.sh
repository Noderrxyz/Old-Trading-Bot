#!/bin/bash
#
# Noderr Canary Agent Promotion Script
# 
# This script promotes a canary agent to live status by calling the API.

set -e  # Exit on error

# Colors for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Check if agent ID is provided
if [ $# -lt 1 ]; then
  echo -e "${RED}Error: Agent ID is required${NC}"
  echo -e "Usage: $0 <agent_id>"
  exit 1
fi

AGENT_ID=$1

# Load environment from .env if it exists
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

# API URL
API_URL=${API_URL:-"http://localhost:3001"}

# Get authentication token
get_auth_token() {
  # Check if admin credentials are provided
  ADMIN_USER=${ADMIN_USER:-"admin"}
  ADMIN_PASSWORD=${ADMIN_PASSWORD:-"admin"}

  # Get token from API
  echo -e "${YELLOW}Authenticating with API...${NC}"
  TOKEN_RESPONSE=$(curl -s -X POST \
    -H "Username: $ADMIN_USER" \
    -H "Password: $ADMIN_PASSWORD" \
    "${API_URL}/auth/token")
  
  # Extract token from response
  ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
  
  if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}Error: Failed to authenticate. Check credentials.${NC}"
    exit 1
  fi
  
  echo $ACCESS_TOKEN
}

# Main function
main() {
  # Get auth token
  TOKEN=$(get_auth_token)
  
  # Call API to promote canary agent
  echo -e "${GREEN}Promoting canary agent ${AGENT_ID} to live status...${NC}"
  
  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"agentId\":\"$AGENT_ID\"}" \
    "${API_URL}/api/agent/promote-canary")
  
  # Check response
  SUCCESS=$(echo $RESPONSE | grep -o '"success":\s*true' || echo "")
  MESSAGE=$(echo $RESPONSE | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
  
  if [ -n "$SUCCESS" ]; then
    echo -e "${GREEN}Success: ${MESSAGE}${NC}"
  else
    ERROR=$(echo $RESPONSE | grep -o '"detail":"[^"]*"' | cut -d'"' -f4)
    if [ -z "$ERROR" ]; then
      ERROR=$(echo $RESPONSE | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
    fi
    if [ -z "$ERROR" ]; then
      ERROR="Unknown error"
    fi
    echo -e "${RED}Error: ${ERROR}${NC}"
    exit 1
  fi
  
  # Wait for a moment
  sleep 2
  
  # Verify agent status
  echo -e "${YELLOW}Verifying agent status...${NC}"
  
  STATUS_RESPONSE=$(curl -s \
    -H "Authorization: Bearer $TOKEN" \
    "${API_URL}/api/agent/list")
  
  # Extract status for our agent
  AGENT_STATUS=$(echo $STATUS_RESPONSE | grep -o "{[^}]*\"agentId\":\"$AGENT_ID\"[^}]*}" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  
  if [ "$AGENT_STATUS" = "running" ]; then
    echo -e "${GREEN}Agent ${AGENT_ID} is now running in live mode.${NC}"
  else
    echo -e "${YELLOW}Warning: Agent status is '$AGENT_STATUS', expected 'running'.${NC}"
    echo -e "${YELLOW}The promotion might have been partially successful. Please check the agent in the control panel.${NC}"
  fi
}

# Run main function
main 