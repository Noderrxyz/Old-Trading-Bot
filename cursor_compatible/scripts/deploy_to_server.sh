#!/bin/bash

# Configuration
SERVER_HOST=${SERVER_HOST:-"localhost"}
SERVER_USER=${SERVER_USER:-"deploy"}
DEPLOY_DIR=${DEPLOY_DIR:-"/opt/bot"}
ENV_FILE=${ENV_FILE:-".env.prod"}

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Function to print status messages
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required files exist
if [ ! -f "dist/bot-runtime.bundle.js" ]; then
    print_error "Bot runtime bundle not found. Please build the project first."
    exit 1
fi

if [ ! -f "dist/dashboard.bundle.js" ]; then
    print_error "Dashboard bundle not found. Please build the project first."
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    print_error "Environment file $ENV_FILE not found."
    exit 1
fi

# Create deployment package
print_status "Creating deployment package..."
DEPLOY_PACKAGE="deploy-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$DEPLOY_PACKAGE" \
    dist/bot-runtime.bundle.js \
    dist/dashboard.bundle.js \
    config/ \
    "$ENV_FILE"

# Deploy to server
print_status "Deploying to $SERVER_HOST..."
scp "$DEPLOY_PACKAGE" "$SERVER_USER@$SERVER_HOST:$DEPLOY_DIR/"

# Execute deployment commands on server
ssh "$SERVER_USER@$SERVER_HOST" << EOF
    cd $DEPLOY_DIR
    
    # Stop existing services
    print_status "Stopping existing services..."
    docker-compose down || true
    
    # Extract new deployment
    print_status "Extracting deployment package..."
    tar -xzf "$DEPLOY_PACKAGE"
    
    # Update environment file
    print_status "Updating environment configuration..."
    cp "$ENV_FILE" .env
    
    # Start services
    print_status "Starting services..."
    docker-compose up -d
    
    # Clean up
    print_status "Cleaning up..."
    rm "$DEPLOY_PACKAGE"
EOF

# Clean up local deployment package
rm "$DEPLOY_PACKAGE"

print_status "Deployment completed successfully!" 