#!/bin/bash
#
# Noderr Trading Platform Deployment Script
# 
# This script handles the deployment of the Noderr trading platform.
# It clones the repository, installs dependencies, configures environment,
# and starts the services using PM2.

set -e  # Exit on error

# Configuration
REPO_URL="https://github.com/noderr/trading-platform.git"
DEPLOY_DIR="/opt/noderr"
BRANCH="main"
ENV_FILE=".env"
LOG_FILE="deploy.log"

# Colors for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Log function
log() {
  echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a $LOG_FILE
}

error() {
  echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a $LOG_FILE
  exit 1
}

warn() {
  echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a $LOG_FILE
}

# Check required tools
check_dependencies() {
  log "Checking dependencies..."
  
  for cmd in git node npm redis-cli; do
    if ! command -v $cmd &> /dev/null; then
      error "$cmd is required but not installed."
    fi
  done
  
  # Check Node.js version
  NODE_VERSION=$(node -v | cut -d 'v' -f 2)
  NODE_MAJOR=$(echo $NODE_VERSION | cut -d '.' -f 1)
  
  if [ "$NODE_MAJOR" -lt "16" ]; then
    error "Node.js version 16+ is required, but found v$NODE_VERSION"
  fi
  
  log "All dependencies satisfied."
}

# Clone or update repository
setup_repository() {
  log "Setting up repository..."
  
  if [ -d "$DEPLOY_DIR" ]; then
    log "Repository directory exists, updating..."
    cd $DEPLOY_DIR
    git fetch origin
    git reset --hard origin/$BRANCH
    git clean -fd
  else
    log "Cloning repository..."
    git clone -b $BRANCH $REPO_URL $DEPLOY_DIR
    cd $DEPLOY_DIR
  fi
  
  log "Repository setup complete."
}

# Install dependencies
install_dependencies() {
  log "Installing dependencies..."
  
  cd $DEPLOY_DIR
  npm ci
  
  # Install frontend dependencies
  cd $DEPLOY_DIR/frontend
  npm ci
  
  log "Dependencies installed."
}

# Setup environment
setup_environment() {
  log "Setting up environment..."
  
  cd $DEPLOY_DIR
  
  # Check if .env file exists in the current directory
  if [ -f "./$ENV_FILE" ]; then
    log "Using existing $ENV_FILE file."
  else
    # Check if .env.example exists
    if [ -f "./.env.example" ]; then
      log "Creating $ENV_FILE from .env.example..."
      cp ./.env.example ./$ENV_FILE
      warn "Please edit $ENV_FILE with your production values."
    else
      error "No .env or .env.example file found."
    fi
  fi
  
  log "Environment setup complete."
}

# Build project
build_project() {
  log "Building project..."
  
  cd $DEPLOY_DIR
  npm run build
  
  cd $DEPLOY_DIR/frontend
  npm run build
  
  log "Build completed."
}

# Setup PM2
setup_pm2() {
  log "Setting up PM2..."
  
  cd $DEPLOY_DIR
  
  # Check if PM2 is installed
  if ! command -v pm2 &> /dev/null; then
    log "Installing PM2 globally..."
    npm install -g pm2
  fi
  
  # Check if PM2 configuration exists
  if [ -f "./pm2.config.js" ]; then
    log "Using existing PM2 configuration."
  else
    log "Creating PM2 configuration..."
    cat > pm2.config.js <<EOL
module.exports = {
  apps: [
    {
      name: 'noderr-api',
      script: 'dist/api/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'noderr-frontend',
      script: 'npm',
      args: 'start',
      cwd: './frontend',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'noderr-agent-engine',
      script: 'dist/agents/index.js',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
EOL
  fi
  
  log "PM2 setup complete."
}

# Start services
start_services() {
  log "Starting services..."
  
  cd $DEPLOY_DIR
  pm2 start pm2.config.js
  
  # Save PM2 configuration to enable startup on boot
  pm2 save
  
  log "Services started."
}

# Main function
main() {
  echo -e "${GREEN}=== Noderr Trading Platform Deployment ===${NC}"
  echo -e "${GREEN}Starting deployment at $(date)${NC}"
  
  mkdir -p $(dirname $LOG_FILE)
  
  check_dependencies
  setup_repository
  install_dependencies
  setup_environment
  build_project
  setup_pm2
  start_services
  
  log "Deployment completed successfully."
  echo -e "${GREEN}=== Deployment completed at $(date) ===${NC}"
}

# Run main function
main 