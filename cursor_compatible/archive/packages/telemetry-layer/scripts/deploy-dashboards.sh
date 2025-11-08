#!/bin/bash

# Noderr Protocol - Dashboard Deployment Script
# Deploys dashboards to Grafana via API

set -e

# Configuration
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
GRAFANA_API_KEY="${GRAFANA_API_KEY}"
DASHBOARD_DIR="$(dirname "$0")/../src/dashboards"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed. Please install jq."
        exit 1
    fi
    
    # Check if API key is set
    if [ -z "$GRAFANA_API_KEY" ]; then
        log_error "GRAFANA_API_KEY environment variable is not set"
        log_info "Generate an API key from Grafana: Settings > API Keys"
        exit 1
    fi
    
    # Check Grafana connectivity
    if ! curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" "$GRAFANA_URL/api/health" > /dev/null; then
        log_error "Cannot connect to Grafana at $GRAFANA_URL"
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}

# Create data source if not exists
create_datasource() {
    log_info "Checking Prometheus data source..."
    
    # Check if Prometheus datasource exists
    DATASOURCE_EXISTS=$(curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
        "$GRAFANA_URL/api/datasources/name/Prometheus" | jq -r '.id')
    
    if [ "$DATASOURCE_EXISTS" != "null" ]; then
        log_info "Prometheus datasource already exists"
        return
    fi
    
    log_info "Creating Prometheus datasource..."
    
    curl -X POST \
        -H "Authorization: Bearer $GRAFANA_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
            "name": "Prometheus",
            "type": "prometheus",
            "url": "'${PROMETHEUS_URL:-http://prometheus:9090}'",
            "access": "proxy",
            "isDefault": true,
            "jsonData": {
                "httpMethod": "POST",
                "timeInterval": "5s"
            }
        }' \
        "$GRAFANA_URL/api/datasources"
    
    log_info "Prometheus datasource created"
}

# Create folders
create_folders() {
    log_info "Creating dashboard folders..."
    
    # Read folders from dashboard JSON
    FOLDERS=$(jq -r '.folders[] | @json' "$DASHBOARD_DIR/NoderrDashboards.json")
    
    while IFS= read -r folder; do
        FOLDER_DATA=$(echo "$folder" | jq -r '.')
        FOLDER_UID=$(echo "$FOLDER_DATA" | jq -r '.uid')
        FOLDER_TITLE=$(echo "$FOLDER_DATA" | jq -r '.title')
        
        # Check if folder exists
        FOLDER_EXISTS=$(curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
            "$GRAFANA_URL/api/folders/$FOLDER_UID" | jq -r '.uid')
        
        if [ "$FOLDER_EXISTS" == "$FOLDER_UID" ]; then
            log_info "Folder '$FOLDER_TITLE' already exists"
            continue
        fi
        
        # Create folder
        curl -X POST \
            -H "Authorization: Bearer $GRAFANA_API_KEY" \
            -H "Content-Type: application/json" \
            -d "{
                \"uid\": \"$FOLDER_UID\",
                \"title\": \"$FOLDER_TITLE\"
            }" \
            "$GRAFANA_URL/api/folders"
        
        log_info "Created folder: $FOLDER_TITLE"
    done <<< "$FOLDERS"
}

# Deploy dashboards
deploy_dashboards() {
    log_info "Deploying dashboards..."
    
    # Read dashboards from JSON
    DASHBOARDS=$(jq -r '.dashboards[] | @json' "$DASHBOARD_DIR/NoderrDashboards.json")
    
    # Get folder mappings
    declare -A FOLDER_MAP
    while IFS= read -r folder; do
        FOLDER_DATA=$(echo "$folder" | jq -r '.')
        FOLDER_UID=$(echo "$FOLDER_DATA" | jq -r '.uid')
        DASHBOARD_IDS=$(echo "$FOLDER_DATA" | jq -r '.dashboards[]')
        
        while IFS= read -r dashboard_id; do
            FOLDER_MAP["$dashboard_id"]="$FOLDER_UID"
        done <<< "$DASHBOARD_IDS"
    done <<< "$(jq -r '.folders[] | @json' "$DASHBOARD_DIR/NoderrDashboards.json")"
    
    # Deploy each dashboard
    while IFS= read -r dashboard; do
        DASHBOARD_DATA=$(echo "$dashboard" | jq -r '.')
        DASHBOARD_UID=$(echo "$DASHBOARD_DATA" | jq -r '.uid')
        DASHBOARD_TITLE=$(echo "$DASHBOARD_DATA" | jq -r '.title')
        
        log_info "Deploying dashboard: $DASHBOARD_TITLE"
        
        # Get folder UID for this dashboard
        FOLDER_UID="${FOLDER_MAP[$DASHBOARD_UID]:-}"
        
        # Build dashboard payload
        PAYLOAD=$(jq -n \
            --argjson dashboard "$DASHBOARD_DATA" \
            --arg folderUid "$FOLDER_UID" \
            '{
                dashboard: $dashboard,
                folderUid: $folderUid,
                overwrite: true
            }')
        
        # Deploy dashboard
        RESPONSE=$(curl -s -X POST \
            -H "Authorization: Bearer $GRAFANA_API_KEY" \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD" \
            "$GRAFANA_URL/api/dashboards/db")
        
        if echo "$RESPONSE" | jq -e '.status == "success"' > /dev/null; then
            log_info "Successfully deployed: $DASHBOARD_TITLE"
        else
            log_error "Failed to deploy: $DASHBOARD_TITLE"
            echo "$RESPONSE" | jq '.'
        fi
    done <<< "$DASHBOARDS"
}

# Deploy alert rules
deploy_alerts() {
    log_info "Deploying alert rules..."
    
    # Convert YAML to JSON and deploy
    if command -v yq &> /dev/null; then
        ALERT_CONFIG=$(yq eval -o=json "$DASHBOARD_DIR/../alerts/AlertConfig.yaml")
        
        # Deploy each alert group
        echo "$ALERT_CONFIG" | jq -r '.groups[] | @json' | while IFS= read -r group; do
            GROUP_DATA=$(echo "$group" | jq -r '.')
            GROUP_NAME=$(echo "$GROUP_DATA" | jq -r '.name')
            
            log_info "Deploying alert group: $GROUP_NAME"
            
            # Create alert rule
            curl -X POST \
                -H "Authorization: Bearer $GRAFANA_API_KEY" \
                -H "Content-Type: application/json" \
                -d "$GROUP_DATA" \
                "$GRAFANA_URL/api/v1/provisioning/alert-rules"
        done
    else
        log_warn "yq not installed, skipping alert deployment. Install yq to deploy alerts."
    fi
}

# Create API endpoint for stakeholder metrics
create_stakeholder_api() {
    log_info "Setting up stakeholder API endpoint..."
    
    # This would typically be handled by your backend API
    # Here we create a simple proxy configuration
    
    cat > /tmp/stakeholder-api.json <<EOF
{
    "name": "stakeholder-metrics",
    "type": "json",
    "url": "$GRAFANA_URL/api/datasources/proxy/1/api/v1/query",
    "access": "proxy",
    "jsonData": {
        "httpMethod": "GET",
        "queryParams": {
            "query": "noderr_pnl_24h{mode=\"live\"}"
        }
    }
}
EOF
    
    log_info "Stakeholder API configuration created"
}

# Main execution
main() {
    log_info "Starting Noderr Protocol dashboard deployment..."
    
    check_prerequisites
    create_datasource
    create_folders
    deploy_dashboards
    deploy_alerts
    create_stakeholder_api
    
    log_info "Dashboard deployment completed!"
    log_info "Access your dashboards at: $GRAFANA_URL"
    log_info ""
    log_info "Dashboard URLs:"
    log_info "- System Health: $GRAFANA_URL/d/noderr-system-health"
    log_info "- Strategy & AI: $GRAFANA_URL/d/noderr-strategy-ai"
    log_info "- Execution: $GRAFANA_URL/d/noderr-execution"
    log_info "- Risk: $GRAFANA_URL/d/noderr-risk"
    log_info "- P&L: $GRAFANA_URL/d/noderr-pnl"
    log_info "- Comparison: $GRAFANA_URL/d/noderr-comparison"
    log_info ""
    log_info "Stakeholder view: $GRAFANA_URL/public/stakeholder-view.html"
}

# Run main function
main "$@" 