# Noderr Trading Bot Enhanced - Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Configuration](#configuration)
4. [Deployment Options](#deployment-options)
5. [Monitoring Setup](#monitoring-setup)
6. [Performance Tuning](#performance-tuning)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements
- **CPU**: 8+ cores (16+ recommended for production)
- **RAM**: 32GB minimum (64GB recommended)
- **Storage**: 500GB SSD (NVMe preferred)
- **GPU**: NVIDIA GPU with 8GB+ VRAM (for ML Enhanced)
- **Network**: 1Gbps+ connection
- **OS**: Ubuntu 20.04+ or Windows Server 2019+

### Software Requirements
- Docker 20.10+
- Kubernetes 1.24+ (for production)
- Node.js 20+
- Rust 1.70+
- CUDA 11.8+ (for GPU support)

## Environment Setup

### 1. Clone Repository
```bash
git clone https://github.com/noderr/trading-bot.git
cd trading-bot
```

### 2. Install Dependencies
```bash
# Install Node.js dependencies
npm install

# Build all packages
node build-all.js

# Verify installation
node verify-enhancements.js
```

### 3. Environment Variables
Create `.env` file:
```env
# Network Configuration
NETWORK_INTERFACE=eth0
TCP_BUFFER_SIZE=8388608
UDP_BUFFER_SIZE=8388608

# Telemetry Configuration
PROMETHEUS_ENABLED=true
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
GRAFANA_PASSWORD=secure_password

# ML Configuration
CUDA_VISIBLE_DEVICES=0
TF_FORCE_GPU_ALLOW_GROWTH=true
MODEL_CHECKPOINT_DIR=/data/models

# Execution Configuration
ENABLE_SMART_ROUTING=true
ENABLE_ORDER_SLICING=true
MAX_ORDER_SIZE=10000

# P2P Configuration
P2P_ENABLED=true
NODE_ID=node-1
BOOTSTRAP_PEERS=/ip4/1.2.3.4/tcp/4001/p2p/QmPeerId

# Security
JWT_SECRET=your_jwt_secret
API_KEY=your_api_key
```

## Configuration

### 1. CPU Affinity Configuration
Edit `/etc/systemd/system/noderr-trading.service`:
```ini
[Service]
CPUAffinity=0-7
Nice=-20
IOSchedulingClass=realtime
IOSchedulingPriority=0
```

### 2. Kernel Optimization
Add to `/etc/sysctl.conf`:
```bash
# Network optimizations
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_congestion_control = bbr

# Memory optimizations
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
```

### 3. NUMA Configuration
```bash
# Check NUMA topology
numactl --hardware

# Run with NUMA binding
numactl --cpunodebind=0 --membind=0 npm start
```

## Deployment Options

### Option 1: Docker Compose (Development/Staging)
```bash
# Build images
docker-compose -f docker/docker-compose.enhanced.yml build

# Start services
docker-compose -f docker/docker-compose.enhanced.yml up -d

# Check status
docker-compose -f docker/docker-compose.enhanced.yml ps

# View logs
docker-compose -f docker/docker-compose.enhanced.yml logs -f
```

### Option 2: Kubernetes (Production)
```bash
# Create namespace
kubectl create namespace noderr-trading

# Apply configurations
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/deployments/

# Check status
kubectl get pods -n noderr-trading
kubectl get services -n noderr-trading

# Scale deployment
kubectl scale deployment network-optimizer --replicas=3 -n noderr-trading
```

### Option 3: Bare Metal (Maximum Performance)
```bash
# Install systemd services
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload

# Start services
sudo systemctl start noderr-network-optimizer
sudo systemctl start noderr-telemetry
sudo systemctl start noderr-ml-enhanced
sudo systemctl start noderr-execution
sudo systemctl start noderr-p2p

# Enable auto-start
sudo systemctl enable noderr-*.service
```

## Monitoring Setup

### 1. Prometheus Configuration
```bash
# Start Prometheus
docker run -d \
  -p 9090:9090 \
  -v $(pwd)/docker/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

# Verify metrics
curl http://localhost:9090/metrics
```

### 2. Grafana Setup
```bash
# Start Grafana
docker run -d \
  -p 3000:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=admin \
  grafana/grafana

# Import dashboards
1. Login to http://localhost:3000 (admin/admin)
2. Add Prometheus data source
3. Import dashboard from docker/grafana/dashboards/
```

### 3. Alert Configuration
Configure alerts in `docker/prometheus/alerts.yml`:
```yaml
groups:
  - name: latency
    rules:
      - alert: HighP99Latency
        expr: histogram_quantile(0.99, rate(trading_latency_microseconds_bucket[5m])) > 1000
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "High P99 latency detected"
          description: "P99 latency is {{ $value }}μs"
```

## Performance Tuning

### 1. CPU Optimization
```bash
# Disable CPU frequency scaling
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# Disable hyperthreading for critical cores
echo 0 | sudo tee /sys/devices/system/cpu/cpu8/online
echo 0 | sudo tee /sys/devices/system/cpu/cpu9/online
```

### 2. Memory Optimization
```bash
# Enable huge pages
echo 1024 | sudo tee /proc/sys/vm/nr_hugepages

# Lock memory
ulimit -l unlimited
```

### 3. Network Optimization
```bash
# Enable receive packet steering
echo 32768 | sudo tee /proc/sys/net/core/rps_sock_flow_entries
echo f | sudo tee /sys/class/net/eth0/queues/rx-0/rps_cpus

# Set interrupt affinity
sudo ./scripts/set_irq_affinity.sh eth0
```

## Troubleshooting

### Common Issues

#### 1. High Latency
- Check CPU affinity: `taskset -cp $(pgrep node)`
- Verify network settings: `ss -i`
- Monitor context switches: `vmstat 1`

#### 2. Memory Issues
- Check memory usage: `free -h`
- Monitor page faults: `sar -B 1`
- Verify huge pages: `cat /proc/meminfo | grep Huge`

#### 3. P2P Connection Issues
- Check peer connections: `curl http://localhost:4003/api/peers`
- Verify firewall rules: `sudo iptables -L`
- Test connectivity: `nc -zv peer-address 4001`

### Debug Commands
```bash
# Performance profiling
perf record -g npm start
perf report

# Network debugging
tcpdump -i eth0 -w capture.pcap
wireshark capture.pcap

# System tracing
strace -c -p $(pgrep node)

# Latency analysis
bpftrace -e 'tracepoint:syscalls:sys_enter_* { @start[tid] = nsecs; }'
```

### Health Checks
```bash
# Check all services
curl http://localhost:8080/health  # Network Optimizer
curl http://localhost:9090/metrics  # Telemetry
curl http://localhost:8081/health  # Execution Engine
curl http://localhost:4003/health  # P2P Node

# Run integration tests
cd packages/integration-tests
npm run test:e2e
```

## Production Checklist

- [ ] CPU affinity configured
- [ ] Kernel parameters optimized
- [ ] Huge pages enabled
- [ ] Network interrupts optimized
- [ ] Monitoring dashboards configured
- [ ] Alerts configured
- [ ] Backup strategy implemented
- [ ] Security hardening completed
- [ ] Load testing performed
- [ ] Chaos testing executed
- [ ] Documentation updated
- [ ] Runbooks created

## Support

For issues or questions:
1. Check logs: `journalctl -u noderr-* -f`
2. Review metrics in Grafana
3. Consult troubleshooting guide
4. Contact support team 