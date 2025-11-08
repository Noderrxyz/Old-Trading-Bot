# Noderr Protocol Dashboard System - Complete Guide

## 🎯 Overview

The Noderr Protocol Dashboard System provides comprehensive monitoring and visualization for all aspects of the trading platform, from system health to P&L tracking, designed for different stakeholder needs.

## 📊 Dashboard Suite

### 1. **System Health Dashboard** (`noderr-system-health`)
- **Purpose**: Monitor overall system health and infrastructure
- **Key Metrics**:
  - System health score (0-100)
  - Uptime tracking
  - Error rates by module
  - Open incidents
  - CPU/Memory usage per module
- **Target Audience**: DevOps, Infrastructure team

### 2. **Strategy & AI Insights** (`noderr-strategy-ai`)
- **Purpose**: Track ML model performance and trading strategy effectiveness
- **Key Metrics**:
  - Alpha hit rate
  - Sharpe ratio
  - ML model drift scores
  - Model accuracy comparison
  - Signal quality over time
- **Target Audience**: Quant team, Data Scientists

### 3. **Execution & Order Routing** (`noderr-execution`)
- **Purpose**: Monitor order execution quality and venue performance
- **Key Metrics**:
  - Fill rates
  - Slippage (basis points)
  - Execution latency (P50, P95, P99)
  - Venue performance comparison
- **Target Audience**: Trading Operations

### 4. **Risk & Capital Allocation** (`noderr-risk`)
- **Purpose**: Real-time risk monitoring and capital efficiency
- **Key Metrics**:
  - Value at Risk (VaR)
  - Conditional VaR (CVaR)
  - Realized volatility
  - Current drawdown
  - Position limits
- **Target Audience**: Risk Management team

### 5. **Live P&L & Attribution** (`noderr-pnl`)
- **Purpose**: Track profitability and performance attribution
- **Key Metrics**:
  - 24h, 7d, 30d P&L
  - P&L by asset
  - P&L by strategy
  - Realized vs unrealized P&L
- **Target Audience**: Portfolio Managers, Stakeholders

### 6. **Backtest vs Paper vs Live** (`noderr-comparison`)
- **Purpose**: Compare performance across different execution modes
- **Key Metrics**:
  - P&L curve overlays
  - Consistency scores
  - Discrepancy tracking
  - Volume comparison
- **Target Audience**: Quant team, Risk Management

## 🚀 Quick Start

### Prerequisites
- Grafana 9.0+ installed
- Prometheus configured and collecting metrics
- API access to Noderr modules
- Node.js 16+ (for metric collection)

### Installation

1. **Start the Metrics Collector**:
```bash
cd packages/telemetry-layer
npm install
npm run start:metrics
```

2. **Deploy Dashboards to Grafana**:
```bash
# Set environment variables
export GRAFANA_URL=http://localhost:3000
export GRAFANA_API_KEY=your-api-key-here
export PROMETHEUS_URL=http://localhost:9090

# Run deployment script
./scripts/deploy-dashboards.sh
```

3. **Configure Alerts**:
```bash
# Deploy alert rules
cd packages/telemetry-layer
kubectl apply -f src/alerts/AlertConfig.yaml
```

## 📈 Metrics Collection

### Data Flow
```
Noderr Modules → MetricsCollector → Prometheus → Grafana Dashboards
                        ↓
                  MetricExporter
                        ↓
                  /metrics endpoint
```

### Key Metrics Exposed

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `noderr_execution_latency_ms` | Histogram | Order execution latency | module, venue |
| `noderr_alpha_hit_rate` | Gauge | Alpha strategy success rate | module |
| `noderr_pnl_24h` | Gauge | 24-hour P&L | mode (live/paper/backtest) |
| `noderr_drawdown_percent` | Gauge | Current portfolio drawdown | portfolio |
| `noderr_sharpe_ratio` | Gauge | Risk-adjusted returns | module, strategy |
| `noderr_ml_drift_score` | Gauge | ML model drift detection | model, timeframe |

### Custom Metric Integration

To add new metrics:

```typescript
// In your module
import { MetricExporter } from '@noderr/telemetry-layer';

// Register metric
exporter.registerMetric({
  name: 'custom_metric_name',
  type: MetricType.GAUGE,
  help: 'Description of metric',
  labelNames: ['label1', 'label2']
});

// Record values
exporter.recordMetric({
  metric: 'custom_metric_name',
  value: 123.45,
  labels: { label1: 'value1', label2: 'value2' }
});
```

## 🚨 Alert Configuration

### Alert Channels
- `#ai-alerts`: ML model drift, prediction failures
- `#infra-alerts`: System errors, latency spikes
- `#risk-alerts`: Drawdown, VaR breaches
- `#trading-alerts`: Low fill rates, high slippage
- `#quant-checks`: P&L deviations, Sharpe drops

### Critical Alerts

1. **High Drawdown**: >15% triggers immediate notification
2. **Model Drift**: >30% switches to fallback model
3. **System Down**: Any module offline >1 minute
4. **P&L Deviation**: >10% difference from backtest

### Alert Response

Follow the incident runbook at `src/alerts/IncidentRunbook.md` for:
- Immediate actions
- Investigation steps
- Recovery procedures
- Escalation matrix

## 👥 Role-Based Access

### Folder Structure
```
Grafana/
├── Admin/          # Full system visibility
├── Quant/          # Strategy and AI focus
├── Operations/     # Execution and system health
└── Stakeholder/    # P&L and high-level metrics
```

### Access Control
Configure in Grafana:
1. Settings → Teams → Create teams per role
2. Assign users to appropriate teams
3. Set folder permissions per team
4. Use dashboard variables for filtering

## 🎨 Stakeholder View

### Executive Dashboard
A simplified HTML dashboard for C-level executives:
- Real-time P&L tracking
- Key performance indicators
- Portfolio composition
- No technical complexity

Access at: `http://your-domain/stakeholder-view.html`

### Features
- Auto-refresh every 5 seconds
- Mobile responsive design
- Dark theme for easy viewing
- Embedded Grafana charts

## 🔧 Customization

### Adding New Panels

1. Edit `NoderrDashboards.json`
2. Add panel configuration:
```json
{
  "id": "unique-panel-id",
  "title": "Panel Title",
  "type": "graph|stat|table|heatmap",
  "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
  "targets": [{
    "expr": "your_prometheus_query",
    "refId": "A"
  }]
}
```

3. Redeploy dashboards

### Modifying Queries

Common query patterns:

```promql
# Rate of change
rate(metric_name[5m])

# Percentiles
histogram_quantile(0.99, sum(rate(metric_bucket[5m])) by (le))

# Aggregations
sum(metric_name) by (label)

# Time comparisons
metric_name - metric_name offset 1d
```

## 📊 Performance Optimization

### Dashboard Best Practices
1. Use appropriate refresh intervals (5s for critical, 30s for others)
2. Limit time ranges for heavy queries
3. Use recording rules for complex calculations
4. Enable query caching in Grafana

### Prometheus Optimization
```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

# Recording rules for expensive queries
groups:
  - name: noderr_aggregations
    interval: 30s
    rules:
      - record: noderr:pnl_total
        expr: sum(noderr_pnl_24h)
```

## 🐛 Troubleshooting

### Common Issues

1. **No Data in Dashboards**
   - Check Prometheus targets: `http://prometheus:9090/targets`
   - Verify metrics endpoint: `curl http://module:port/metrics`
   - Check time range selection

2. **Slow Dashboard Loading**
   - Reduce panel count per dashboard
   - Use recording rules for complex queries
   - Check Prometheus resource usage

3. **Alert Not Firing**
   - Verify alert expression in Prometheus
   - Check alertmanager configuration
   - Review inhibition rules

### Debug Commands

```bash
# Check metric availability
curl -s http://localhost:9090/api/v1/label/__name__/values | jq . | grep noderr

# Test specific query
curl -g 'http://localhost:9090/api/v1/query?query=noderr_pnl_24h'

# View active alerts
curl http://localhost:9093/api/v1/alerts
```

## 📚 Advanced Topics

### Multi-Environment Setup
```bash
# Development
GRAFANA_URL=http://dev-grafana:3000 ./deploy-dashboards.sh

# Production
GRAFANA_URL=http://prod-grafana:3000 ./deploy-dashboards.sh
```

### Backup & Restore
```bash
# Backup dashboards
curl -H "Authorization: Bearer $API_KEY" \
  http://grafana:3000/api/dashboards/db/noderr-pnl > backup.json

# Restore
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d @backup.json \
  http://grafana:3000/api/dashboards/db
```

### Integration with CI/CD
```yaml
# .github/workflows/dashboard-deploy.yml
- name: Deploy Dashboards
  run: |
    ./scripts/deploy-dashboards.sh
  env:
    GRAFANA_API_KEY: ${{ secrets.GRAFANA_API_KEY }}
```

## 🤝 Contributing

To contribute new dashboards or improvements:

1. Fork the repository
2. Create feature branch
3. Update `NoderrDashboards.json`
4. Test locally with Grafana
5. Submit pull request

## 📞 Support

- **Documentation**: This guide
- **Slack Channel**: #noderr-dashboards
- **Issue Tracker**: GitHub Issues
- **Emergency**: See incident runbook

---

**Dashboard System Version**: 2.0.0  
**Last Updated**: [Current Date]  
**Maintained By**: Noderr Platform Team 