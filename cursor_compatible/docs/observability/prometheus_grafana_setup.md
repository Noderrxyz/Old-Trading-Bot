# Prometheus and Grafana Setup Guide

This guide provides detailed instructions for setting up and configuring Prometheus and Grafana for the Noderr trading protocol.

## Architecture Overview

The metrics infrastructure consists of the following components:

1. **Prometheus** - Time-series database for metrics storage and querying
2. **Grafana** - Visualization and dashboarding platform
3. **Alertmanager** - Handles alerts from Prometheus
4. **Node Exporter** (optional) - Collects system-level metrics
5. **Metric Exporters** - Embedded in Noderr services to expose metrics

![Metrics Architecture](../../assets/metrics-architecture.png)

## Prerequisites

- Docker and Docker Compose installed
- Basic familiarity with YAML configuration
- Network access to all Noderr services
- A host with at least 4GB RAM and 2 CPU cores

## Quick Start

The simplest way to set up the metrics stack is using our provided Docker Compose file:

```bash
# Start the metrics stack
npm run metrics:start

# Stop the metrics stack
npm run metrics:stop

# View logs
npm run metrics:logs
```

This will start Prometheus, Grafana, and Alertmanager with pre-configured settings.

## Manual Configuration

If you need more control or want to deploy the components separately, follow these steps:

### 1. Prometheus Configuration

Create a configuration file for Prometheus:

```yaml
# config/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: 'noderr-monitor'

# Alertmanager configuration
alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - 'alertmanager:9093'

# Load rules from file
rule_files:
  - 'alerts.yml'

# Scrape configurations
scrape_configs:
  # Scrape Prometheus itself
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  # Scrape Noderr trading service
  - job_name: 'noderr-trading'
    metrics_path: '/metrics'
    scrape_interval: 5s
    static_configs:
      - targets: ['noderr:3000']
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        regex: '(.*):.*'
        replacement: '$1'

  # Scrape Node Exporter (system metrics)
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
```

Create an alerts configuration file:

```yaml
# config/prometheus/alerts.yml
groups:
  - name: noderr_alerts
    rules:
      # Alert for service down
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.instance }} down"
          description: "{{ $labels.instance }} of job {{ $labels.job }} has been down for more than 1 minute."

      # Alert for high error rate
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High error rate on {{ $labels.instance }}"
          description: "Error rate is above 5% (current value: {{ $value | humanizePercentage }})"

      # Alert for data staleness
      - alert: MarketDataStale
        expr: (time() - market_data_last_update_timestamp_seconds) > 60
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Market data is stale for {{ $labels.symbol }}"
          description: "Last market data update was {{ $value | humanizeDuration }} ago"
```

### 2. Alertmanager Configuration

Create a configuration file for Alertmanager:

```yaml
# config/alertmanager/alertmanager.yml
global:
  resolve_timeout: 5m
  # Slack configuration
  slack_api_url: 'https://hooks.slack.com/services/YOUR_WORKSPACE_ID/YOUR_CHANNEL_ID/YOUR_WEBHOOK_TOKEN'

# The route block defines the default receiver and grouping rules
route:
  group_by: ['alertname', 'job']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'slack-notifications'
  
  # Routing based on alert severity
  routes:
  - match:
      severity: critical
    receiver: 'slack-critical'
    continue: true
  - match:
      severity: warning
    receiver: 'slack-warnings'

# Receiver definitions
receivers:
- name: 'slack-notifications'
  slack_configs:
  - channel: '#alerts'
    send_resolved: true
    title: '{{ .GroupLabels.alertname }}'
    text: >
      {{ range .Alerts }}
        *Alert:* {{ .Annotations.summary }}
        *Description:* {{ .Annotations.description }}
        *Severity:* {{ .Labels.severity }}
        *Time:* {{ .StartsAt.Format "2006-01-02 15:04:05" }}
      {{ end }}

- name: 'slack-critical'
  slack_configs:
  - channel: '#critical-alerts'
    send_resolved: true
    title: '[CRITICAL] {{ .GroupLabels.alertname }}'
    text: >
      {{ range .Alerts }}
        *Alert:* {{ .Annotations.summary }}
        *Description:* {{ .Annotations.description }}
        *Time:* {{ .StartsAt.Format "2006-01-02 15:04:05" }}
      {{ end }}

- name: 'slack-warnings'
  slack_configs:
  - channel: '#warnings'
    send_resolved: true
    title: '[WARNING] {{ .GroupLabels.alertname }}'
    text: >
      {{ range .Alerts }}
        *Alert:* {{ .Annotations.summary }}
        *Description:* {{ .Annotations.description }}
        *Time:* {{ .StartsAt.Format "2006-01-02 15:04:05" }}
      {{ end }}

# Inhibition rules prevent notifications for alert B if alert A is firing
inhibit_rules:
  # Don't send warning alerts if the same service has a critical alert
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'instance']
```

### 3. Grafana Configuration

Create a datasource configuration file:

```yaml
# config/grafana/provisioning/datasources/default.yml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    version: 1
    editable: false
```

### 4. Docker Compose File

Use a Docker Compose file to start all components:

```yaml
# docker-compose.metrics.yml
version: '3.8'

services:
  # Prometheus for metrics collection
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./config/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./config/prometheus/alerts.yml:/etc/prometheus/alerts.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
      - '--web.enable-lifecycle'
    networks:
      - metrics-network

  # Grafana for metrics visualization
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    volumes:
      - ./config/grafana/provisioning:/etc/grafana/provisioning
      - ./src/telemetry/dashboards:/var/lib/grafana/dashboards
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=noderr123
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_INSTALL_PLUGINS=grafana-piechart-panel
    networks:
      - metrics-network
    depends_on:
      - prometheus

  # Alertmanager for alert management
  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./config/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
    networks:
      - metrics-network
    depends_on:
      - prometheus

  # Node Exporter for system metrics (optional)
  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--path.rootfs=/rootfs'
      - '--collector.filesystem.ignored-mount-points=^/(sys|proc|dev|host|etc)($$|/)'
    networks:
      - metrics-network

volumes:
  prometheus_data:
  grafana_data:

networks:
  metrics-network:
    driver: bridge
```

## Exposing Metrics from Noderr Services

Each Noderr service should expose a `/metrics` endpoint that Prometheus can scrape:

```typescript
// src/api/routes/metrics.ts
import express from 'express';
import { register } from '../../telemetry/metrics';

const router = express.Router();

router.get('/', async (req, res) => {
  res.set('Content-Type', register.contentType);
  const metrics = await register.metrics();
  res.end(metrics);
});

export default router;

// Add the route to your Express application
// src/api/index.ts
import express from 'express';
import metricsRouter from './routes/metrics';

const app = express();
// ...other middleware and routes
app.use('/metrics', metricsRouter);
```

## Creating Dashboards

### 1. System Overview Dashboard

Create a dashboard for system-level metrics:

1. Navigate to Grafana (http://localhost:3001)
2. Log in with the default credentials (admin/noderr123)
3. Click "Create" > "Dashboard" > "Add new panel"
4. Create panels for:
   - CPU usage
   - Memory usage
   - Disk I/O
   - Network traffic
   - Node.js memory heap
   - Event loop lag

Example PromQL queries:

```
# CPU Usage
100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Memory Usage
node_memory_MemTotal_bytes - node_memory_MemFree_bytes - node_memory_Buffers_bytes - node_memory_Cached_bytes

# Disk I/O
rate(node_disk_io_time_seconds_total[5m])

# Network Traffic
rate(node_network_receive_bytes_total[5m])
rate(node_network_transmit_bytes_total[5m])
```

### 2. Trading Dashboard

Create a dashboard for trading-specific metrics:

1. Create a new dashboard
2. Add panels for:
   - Order volume
   - Order success/failure rate
   - Order execution latency
   - P&L
   - Active positions
   - Exchange connectivity status

Example PromQL queries:

```
# Order Volume
sum(increase(trading_orders_placed_total[24h])) by (exchange)

# Order Success Rate
sum(increase(trading_orders_filled_total[1h])) / sum(increase(trading_orders_placed_total[1h]))

# Order Latency (95th percentile)
histogram_quantile(0.95, sum(rate(trading_order_latency_milliseconds_bucket[5m])) by (le, exchange))

# Exchange Connectivity
blockchain_connection_status
```

### 3. Market Data Dashboard

Create a dashboard for market data metrics:

1. Create a new dashboard
2. Add panels for:
   - Market data freshness
   - Market data processing rate
   - Orderbook depth
   - Price volatility
   - Data provider latency

Example PromQL queries:

```
# Market Data Freshness
time() - market_data_last_update_timestamp_seconds

# Market Data Processing Rate
rate(market_data_updates_processed_total[5m])

# Orderbook Depth
market_data_orderbook_depth{symbol="BTC-USDT"}
```

## Alert Configuration

### Critical Alerts

Configure critical alerts that require immediate action:

1. Service availability issues
2. Order execution failures above threshold
3. Market data staleness
4. Error rates above threshold

### Warning Alerts

Configure warning alerts for potential issues:

1. Increased latency
2. Memory usage above threshold
3. Unusual trading patterns
4. Database connection pool saturation

## Performance Considerations

1. **Retention Period**
   - Default Prometheus retention is 15 days
   - Adjust with `--storage.tsdb.retention.time` flag
   - Consider federation for long-term storage

2. **Scrape Intervals**
   - Use shorter intervals (5-15s) for critical metrics
   - Use longer intervals (30s-1m) for slower-changing metrics
   - Balance between data granularity and storage/performance

3. **Resource Requirements**
   - Monitor Prometheus memory usage (rule of thumb: 1-2GB RAM per million active series)
   - Scale vertically if needed
   - Consider using VictoriaMetrics for larger scale

## Security Considerations

1. **Network Security**
   - Restrict access to Prometheus and Grafana
   - Use reverse proxy with TLS for public access
   - Consider network isolation for metrics infrastructure

2. **Authentication**
   - Change default Grafana admin password
   - Set up proper user management in Grafana
   - Use OAuth or LDAP integration for enterprise environments

3. **Sensitive Data**
   - Avoid exposing sensitive data in metrics
   - Use appropriate label cardinality
   - Sanitize alert messages for sensitive information

## Troubleshooting

### Common Issues

1. **Prometheus not scraping targets**
   - Check the Targets page in Prometheus UI
   - Verify network connectivity
   - Check for misconfigured scrape_configs

2. **Missing metrics**
   - Verify metrics are being exported correctly
   - Check metric naming and conventions
   - Look for errors in Prometheus logs

3. **Grafana not showing data**
   - Verify Prometheus data source is configured correctly
   - Check PromQL queries for syntax errors
   - Ensure time range is appropriate

4. **High cardinality problems**
   - Look for metrics with too many label combinations
   - Check for metrics with unique IDs as labels
   - Monitor Prometheus memory usage

## Advanced Topics

### Federation

For large-scale deployments, consider setting up Prometheus federation:

```yaml
scrape_configs:
  - job_name: 'federate'
    scrape_interval: 15s
    honor_labels: true
    metrics_path: '/federate'
    params:
      'match[]':
        - '{job="noderr-trading"}'
        - '{__name__=~"job:.*"}'
    static_configs:
      - targets:
        - 'prometheus-us-east:9090'
        - 'prometheus-us-west:9090'
        - 'prometheus-eu:9090'
```

### Recording Rules

Use recording rules to pre-calculate expensive queries:

```yaml
# config/prometheus/recording_rules.yml
groups:
  - name: recording_rules
    interval: 5s
    rules:
      - record: job:request_latency_seconds:mean5m
        expr: sum(rate(request_latency_seconds_sum[5m])) by (job) / sum(rate(request_latency_seconds_count[5m])) by (job)
      
      - record: job:request_errors:ratio5m
        expr: sum(rate(request_errors_total[5m])) by (job) / sum(rate(requests_total[5m])) by (job)
```

### Grafana Alerts

Configure Grafana alerts for specific dashboard panels:

1. Edit a panel
2. Go to the "Alert" tab
3. Click "Create Alert"
4. Configure conditions, evaluation frequency, and notifications
5. Save the alert

## Maintenance Procedures

### Backing Up Prometheus Data

```bash
# Stop Prometheus
docker-compose -f docker-compose.metrics.yml stop prometheus

# Backup Prometheus data
tar -cvzf prometheus_data_backup.tar.gz /path/to/prometheus_data

# Restart Prometheus
docker-compose -f docker-compose.metrics.yml start prometheus
```

### Upgrading Components

```bash
# Pull latest images
docker-compose -f docker-compose.metrics.yml pull

# Restart with new images
docker-compose -f docker-compose.metrics.yml up -d
```

### Scaling Prometheus

For larger deployments:

1. Use Thanos or Cortex for horizontal scaling
2. Implement sharding by metrics or instance
3. Consider using remote storage for long-term retention

## Additional Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [Alertmanager Documentation](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [PromQL Cheat Sheet](https://promlabs.com/promql-cheat-sheet/)
- [Grafana Dashboard Examples](https://grafana.com/grafana/dashboards/) 