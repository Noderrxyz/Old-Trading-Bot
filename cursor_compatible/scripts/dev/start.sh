#!/bin/bash
#
# Noderr Development Environment Startup Script
# 
# This script starts all necessary services for local development.

set -e  # Exit on error

# Colors for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT=$(pwd)
ENV_FILE=".env"

# Log functions
log() {
  echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"
}

info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
  exit 1
}

# Check if we're in the project root
check_project_root() {
  if [ ! -f "package.json" ]; then
    error "Please run this script from the project root directory."
  fi
}

# Setup environment
setup_environment() {
  log "Setting up environment..."
  
  # Check if .env file exists
  if [ -f "$ENV_FILE" ]; then
    info "Using existing $ENV_FILE file."
  else
    # Check if .env.example exists
    if [ -f ".env.example" ]; then
      info "Creating $ENV_FILE from .env.example..."
      cp .env.example $ENV_FILE
      warn "Please update $ENV_FILE with your local configuration."
    else
      error "No .env or .env.example file found."
    fi
  fi
  
  # Load environment variables
  export $(grep -v '^#' $ENV_FILE | xargs)
  
  log "Environment setup complete."
}

# Check if Redis is running
check_redis() {
  log "Checking Redis service..."
  
  # Get Redis host and port from environment
  REDIS_URL=${REDIS_URL:-"localhost:6379"}
  REDIS_HOST=$(echo $REDIS_URL | cut -d':' -f1)
  REDIS_PORT=$(echo $REDIS_URL | cut -d':' -f2)
  
  # Check if Redis is running
  if ! redis-cli -h $REDIS_HOST -p $REDIS_PORT ping > /dev/null 2>&1; then
    warn "Redis is not running at $REDIS_HOST:$REDIS_PORT."
    
    # Try to start Redis if it's installed
    if command -v redis-server &> /dev/null; then
      info "Starting Redis server..."
      redis-server --daemonize yes
    else
      error "Redis is not running and could not be started. Please start Redis manually."
    fi
  fi
  
  # Verify Redis is now running
  if redis-cli -h $REDIS_HOST -p $REDIS_PORT ping > /dev/null 2>&1; then
    info "Redis is running at $REDIS_HOST:$REDIS_PORT."
  else
    error "Redis is not running. Please start Redis manually."
  fi
}

# Build and watch the project
start_development_server() {
  log "Starting development servers..."
  
  # Create a logs directory if it doesn't exist
  mkdir -p logs
  
  # Start API server
  info "Starting API server..."
  npm run dev:api > logs/api.log 2>&1 &
  API_PID=$!
  
  # Start agent engine
  info "Starting agent engine..."
  npm run dev:agents > logs/agents.log 2>&1 &
  AGENTS_PID=$!
  
  # Start frontend server
  info "Starting frontend server..."
  cd frontend
  npm run dev > ../logs/frontend.log 2>&1 &
  FRONTEND_PID=$!
  cd ..
  
  log "All services started successfully."
  info "API server running with PID: $API_PID"
  info "Agent engine running with PID: $AGENTS_PID"
  info "Frontend server running with PID: $FRONTEND_PID"
  info "Log files are available in the logs directory."
  
  # Save PIDs for cleanup
  echo "$API_PID $AGENTS_PID $FRONTEND_PID" > .dev_pids
  
  # Display endpoints
  API_PORT=${API_PORT:-3001}
  FRONTEND_PORT=${FRONTEND_PORT:-3000}
  
  echo
  echo -e "${GREEN}Services are now running:${NC}"
  echo -e "- Frontend: ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
  echo -e "- API: ${BLUE}http://localhost:$API_PORT${NC}"
  echo -e "- Admin Dashboard: ${BLUE}http://localhost:$FRONTEND_PORT/admin/agents${NC}"
  echo
  echo -e "Press Ctrl+C to stop all services."
  
  # Setup trap to cleanup on exit
  trap cleanup INT TERM
  
  # Wait for user to press Ctrl+C
  wait
}

# Cleanup function
cleanup() {
  log "Stopping development services..."
  
  if [ -f ".dev_pids" ]; then
    while read -r pid; do
      if ps -p $pid > /dev/null; then
        info "Stopping process with PID: $pid"
        kill $pid
      fi
    done < .dev_pids
    rm .dev_pids
  fi
  
  log "All services stopped."
  exit 0
}

# Main function
main() {
  echo -e "${GREEN}=== Noderr Development Environment ===${NC}"
  
  check_project_root
  setup_environment
  check_redis
  start_development_server
}

# Run main function
main 