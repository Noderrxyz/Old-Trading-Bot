#!/bin/bash
#
# Noderr Protocol - Production Deployment Script
# 
# Usage: ./deploy.sh [environment] [version] [strategy]
# Example: ./deploy.sh production v1.0.0 blue-green

set -euo pipefail

# Configuration
ENVIRONMENT=${1:-production}
VERSION=${2:-$(git describe --tags --always)}
STRATEGY=${3:-rolling}
REGISTRY=${DOCKER_REGISTRY:-""}
NAMESPACE=${KUBERNETES_NAMESPACE:-noderr}

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validate prerequisites
validate_prerequisites() {
    log_info "Validating prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    # Check kubectl for Kubernetes deployment
    if [[ "$DEPLOYMENT_TARGET" == "kubernetes" ]] && ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi
    
    # Check environment
    if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
        log_error "Invalid environment: $ENVIRONMENT"
        exit 1
    fi
    
    # Check deployment strategy
    if [[ ! "$STRATEGY" =~ ^(rolling|blue-green|canary)$ ]]; then
        log_error "Invalid strategy: $STRATEGY"
        exit 1
    fi
    
    log_info "Prerequisites validated"
}

# Build Docker images
build_images() {
    log_info "Building Docker images for version $VERSION..."
    
    local modules=(
        "risk-engine"
        "market-intelligence"
        "execution-optimizer"
        "ai-core"
        "system-vanguard"
        "quant-research"
        "telemetry-layer"
        "integration-layer"
        "alpha-exploitation"
    )
    
    for module in "${modules[@]}"; do
        log_info "Building $module..."
        
        docker build \
            -t "noderr-$module:$VERSION" \
            -t "noderr-$module:latest" \
            --build-arg MODULE="$module" \
            -f packages/deployment/docker/Dockerfile.module \
            ../..
        
        if [[ -n "$REGISTRY" ]]; then
            docker tag "noderr-$module:$VERSION" "$REGISTRY/noderr-$module:$VERSION"
            docker tag "noderr-$module:latest" "$REGISTRY/noderr-$module:latest"
        fi
    done
    
    log_info "All images built successfully"
}

# Push images to registry
push_images() {
    if [[ -z "$REGISTRY" ]]; then
        log_warn "No registry configured, skipping push"
        return
    fi
    
    log_info "Pushing images to registry $REGISTRY..."
    
    local modules=(
        "risk-engine"
        "market-intelligence"
        "execution-optimizer"
        "ai-core"
        "system-vanguard"
        "quant-research"
        "telemetry-layer"
        "integration-layer"
        "alpha-exploitation"
    )
    
    for module in "${modules[@]}"; do
        log_info "Pushing $module..."
        docker push "$REGISTRY/noderr-$module:$VERSION"
        docker push "$REGISTRY/noderr-$module:latest"
    done
    
    log_info "All images pushed successfully"
}

# Deploy with Docker Compose
deploy_docker_compose() {
    log_info "Deploying with Docker Compose..."
    
    cd packages/deployment/docker
    
    # Export environment variables
    export VERSION
    export ENVIRONMENT
    
    # Deploy based on strategy
    case "$STRATEGY" in
        "rolling")
            docker-compose up -d --no-deps --build
            ;;
        "blue-green")
            # Deploy to blue environment
            docker-compose -f docker-compose.yaml -f docker-compose.blue.yaml up -d
            
            # Wait for health checks
            sleep 30
            
            # Switch traffic
            docker-compose -f docker-compose.yaml -f docker-compose.green.yaml up -d
            
            # Remove blue environment
            docker-compose -f docker-compose.yaml -f docker-compose.blue.yaml down
            ;;
        "canary")
            # Deploy canary version
            docker-compose -f docker-compose.yaml -f docker-compose.canary.yaml up -d
            ;;
    esac
    
    cd -
}

# Deploy to Kubernetes
deploy_kubernetes() {
    log_info "Deploying to Kubernetes namespace $NAMESPACE..."
    
    # Create namespace if not exists
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    
    # Apply configurations
    kubectl apply -f packages/deployment/kubernetes/configmap.yaml -n "$NAMESPACE"
    kubectl apply -f packages/deployment/kubernetes/secrets.yaml -n "$NAMESPACE"
    
    # Deploy based on strategy
    case "$STRATEGY" in
        "rolling")
            kubectl apply -f packages/deployment/kubernetes/deployment.yaml -n "$NAMESPACE"
            ;;
        "blue-green")
            # Deploy to green environment
            kubectl apply -f packages/deployment/kubernetes/deployment-green.yaml -n "$NAMESPACE"
            
            # Wait for rollout
            kubectl rollout status deployment -n "$NAMESPACE"
            
            # Switch service selector
            kubectl patch service noderr-service -n "$NAMESPACE" -p '{"spec":{"selector":{"version":"green"}}}'
            
            # Delete blue deployment
            kubectl delete -f packages/deployment/kubernetes/deployment-blue.yaml -n "$NAMESPACE"
            ;;
        "canary")
            # Deploy canary version
            kubectl apply -f packages/deployment/kubernetes/deployment-canary.yaml -n "$NAMESPACE"
            ;;
    esac
    
    # Apply services and ingress
    kubectl apply -f packages/deployment/kubernetes/services.yaml -n "$NAMESPACE"
    kubectl apply -f packages/deployment/kubernetes/ingress.yaml -n "$NAMESPACE"
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."
    
    local modules=(
        "risk-engine"
        "market-intelligence"
        "execution-optimizer"
        "ai-core"
        "system-vanguard"
        "quant-research"
        "telemetry-layer"
        "integration-layer"
        "alpha-exploitation"
    )
    
    local all_healthy=true
    
    for module in "${modules[@]}"; do
        if curl -sf "http://localhost:3000/health/$module" > /dev/null; then
            log_info "$module is healthy"
        else
            log_error "$module health check failed"
            all_healthy=false
        fi
    done
    
    if [[ "$all_healthy" == "false" ]]; then
        log_error "Some modules are unhealthy"
        return 1
    fi
    
    log_info "All modules are healthy"
}

# Run smoke tests
run_smoke_tests() {
    log_info "Running smoke tests..."
    
    # Run basic API tests
    npm run test:smoke -- --environment="$ENVIRONMENT"
}

# Main deployment flow
main() {
    log_info "Starting Noderr Protocol deployment"
    log_info "Environment: $ENVIRONMENT"
    log_info "Version: $VERSION"
    log_info "Strategy: $STRATEGY"
    
    # Validate prerequisites
    validate_prerequisites
    
    # Build images
    build_images
    
    # Push images if registry configured
    push_images
    
    # Deploy based on target
    if [[ "${DEPLOYMENT_TARGET:-docker}" == "kubernetes" ]]; then
        deploy_kubernetes
    else
        deploy_docker_compose
    fi
    
    # Wait for services to start
    log_info "Waiting for services to start..."
    sleep 30
    
    # Run health checks
    if run_health_checks; then
        log_info "Deployment successful!"
        
        # Run smoke tests
        run_smoke_tests
    else
        log_error "Deployment failed health checks"
        exit 1
    fi
    
    log_info "Deployment completed successfully"
}

# Run main function
main "$@" 