#!/bin/bash
#
# Noderr Agent Restart Script
# 
# This script restarts a specific agent by sending a restart command through Redis.

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

# Get Redis URL from environment or use default
REDIS_URL=${REDIS_URL:-"localhost:6379"}
REDIS_HOST=$(echo $REDIS_URL | cut -d':' -f1)
REDIS_PORT=$(echo $REDIS_URL | cut -d':' -f2)

# Send restart command to Redis
echo -e "${GREEN}Sending restart command to agent: ${AGENT_ID}${NC}"

redis-cli -h $REDIS_HOST -p $REDIS_PORT publish "agent:${AGENT_ID}:restart" ""

echo -e "${GREEN}Restart command sent.${NC}"

# Check agent status
echo -e "${YELLOW}Checking agent status...${NC}"
sleep 2

# Get current agent state
STATE=$(redis-cli -h $REDIS_HOST -p $REDIS_PORT get "agent:${AGENT_ID}:state")

if [ -z "$STATE" ]; then
  echo -e "${RED}Error: Agent ${AGENT_ID} not found or state not available.${NC}"
  exit 1
fi

echo -e "${GREEN}Agent ${AGENT_ID} state: ${STATE}${NC}"

if [ "$STATE" = "initializing" ]; then
  echo -e "${GREEN}Agent is restarting.${NC}"
else
  echo -e "${YELLOW}Warning: Agent state is not 'initializing'. Restart might not have been successful.${NC}"
fi 