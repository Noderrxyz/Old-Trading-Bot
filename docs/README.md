# Noderr Active Trading System Documentation

Welcome to the comprehensive documentation for the Noderr Active Trading (AT) System - a next-generation, ML-powered algorithmic trading platform built to institutional standards.

## Documentation Structure

### 📊 Analysis & Strategy

- [ML/AI Optimization Analysis](./analysis/ML_AI_OPTIMIZATION_ANALYSIS.md) - Comprehensive evaluation of ML/AI optimization proposals
- [System Architecture Findings](./analysis/SYSTEM_ARCHITECTURE_FINDINGS.md) - Detailed findings from repository analysis
- [Optimization Priorities Matrix](./analysis/OPTIMIZATION_PRIORITIES_MATRIX.txt) - Comparison of competing roadmaps

## Architecture

- [System Architecture](../cursor_compatible/packages/SYSTEM_ARCHITECTURE.md) - Overall system architecture
- [Floor Engine Architecture](../cursor_compatible/packages/FLOOR_ENGINE_ARCHITECTURE.md) - Floor engine design

## Maintenance

- [Cleanup Plan](./CLEANUP_PLAN.md) - Repository cleanup and organization plan

### 📐 Architecture Documentation

- [System Architecture Overview](./architecture/system-overview.md)
- [Data Infrastructure](./architecture/data-infrastructure.md)
- [ML/AI Architecture](./architecture/ml-ai-architecture.md)
- [Microservices Design](./architecture/microservices.md)
- [Security Architecture](./architecture/security.md)
- [Architectural Decision Records (ADRs)](./architecture/adrs/)

### 📚 API Documentation

- [ML Prediction Service API](./api/ml-prediction-service.md)
- [Feature Store API](./api/feature-store.md)
- [Model Registry API](./api/model-registry.md)
- [Data Ingestion API](./api/data-ingestion.md)
- [gRPC Service Definitions](./api/grpc/)

### 🔧 Operational Runbooks

- [Deployment Runbook](./runbooks/deployment.md)
- [Model Deployment Runbook](./runbooks/model-deployment.md)
- [Incident Response](./runbooks/incident-response.md)
- [Troubleshooting Guide](./runbooks/troubleshooting.md)
- [Monitoring & Alerting](./runbooks/monitoring.md)

### 🚀 Getting Started

- [Development Environment Setup](./getting-started/dev-setup.md)
- [Quick Start Guide](./getting-started/quickstart.md)
- [Contributing Guidelines](./getting-started/contributing.md)

## Archive

Historical documentation and reports are archived in:
- `../archive/old_audits_2024/` - Previous audit reports
- `../archive/old_reports_2024/` - Outdated phase reports
- `../packages/floor-engine/archive/` - Weekly development reports

---

## Building Documentation

This documentation is built using [MkDocs](https://www.mkdocs.org/) with the Material theme.

```bash
# Serve documentation locally with live reload
pnpm run docs:dev

# Build static documentation
pnpm run docs:build

# Deploy to GitHub Pages
pnpm run docs:deploy
```

## Contributing to Documentation

Documentation is code. All documentation changes should:

1. Follow the same review process as code changes
2. Be written in clear, concise Markdown
3. Include diagrams where appropriate (use Mermaid or D2)
4. Be tested locally before submitting
5. Follow the documentation style guide

---

**Last Updated**: November 10, 2025  
**Maintained by**: Noderr Engineering Team
