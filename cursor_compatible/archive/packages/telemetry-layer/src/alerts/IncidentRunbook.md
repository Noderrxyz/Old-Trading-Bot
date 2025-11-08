# Noderr Protocol - Incident Response Runbook

## Critical Alerts Response Guide

### 🚨 High Drawdown Alert

**Trigger**: `noderr_drawdown_percent > 15%`

**Immediate Actions**:
1. **Verify Alert**: Check Grafana dashboard `noderr-risk` for current drawdown
2. **Pause Trading**: Execute emergency stop if drawdown > 20%
   ```bash
   curl -X POST http://noderr-api:3000/api/trading/emergency-stop
   ```
3. **Check Positions**: Review all open positions
   ```bash
   curl http://noderr-api:3000/api/positions/summary
   ```

**Investigation**:
- Check for abnormal market conditions
- Review recent trades for errors
- Verify risk limits are being enforced
- Check for model drift or prediction failures

**Recovery**:
1. Close or reduce high-risk positions
2. Adjust position sizing parameters
3. Review and update risk limits
4. Resume trading with reduced exposure

---

### 🚨 Model Drift Critical

**Trigger**: `noderr_ml_drift_score > 30%`

**Immediate Actions**:
1. **Switch to Fallback Model**:
   ```bash
   curl -X POST http://noderr-api:3000/api/models/fallback -d '{"model": "ensemble"}'
   ```
2. **Reduce Model Confidence**:
   ```bash
   curl -X POST http://noderr-api:3000/api/models/confidence -d '{"factor": 0.5}'
   ```

**Investigation**:
- Check model performance metrics
- Review recent prediction accuracy
- Analyze feature distributions
- Check for data quality issues

**Recovery**:
1. Retrain model with recent data
2. Run backtests on new model
3. Gradually increase confidence
4. Monitor drift closely for 24h

---

### 🚨 Module Down

**Trigger**: `up{job="noderr"} == 0`

**Immediate Actions**:
1. **Check Module Status**:
   ```bash
   kubectl get pods -n noderr | grep <module>
   ```
2. **View Logs**:
   ```bash
   kubectl logs -n noderr <module-pod> --tail=100
   ```
3. **Restart if Necessary**:
   ```bash
   kubectl rollout restart deployment/<module> -n noderr
   ```

**Investigation**:
- Check for OOM kills
- Review error logs
- Check dependencies (Redis, DB)
- Verify configuration

**Recovery**:
1. Fix root cause
2. Restart module
3. Verify health checks pass
4. Monitor for stability

---

### 🚨 High Error Rate

**Trigger**: `noderr_error_rate_percent > 5%`

**Immediate Actions**:
1. **Identify Error Sources**:
   ```bash
   curl http://noderr-api:3000/api/errors/summary?timeframe=5m
   ```
2. **Check Dependencies**:
   - Redis connectivity
   - Database status
   - External API availability

**Investigation**:
- Group errors by type
- Check for patterns
- Review recent deployments
- Check system resources

**Recovery**:
1. Fix identified issues
2. Clear error queues if needed
3. Implement retry logic
4. Add error handling

---

### 🚨 Execution Latency Spike

**Trigger**: `P99 execution_latency_ms > 2ms`

**Immediate Actions**:
1. **Check Venue Status**:
   ```bash
   curl http://noderr-api:3000/api/venues/health
   ```
2. **Review Order Queue**:
   ```bash
   curl http://noderr-api:3000/api/orders/queue/stats
   ```

**Investigation**:
- Check network latency
- Review order routing logic
- Check venue API limits
- Monitor concurrent connections

**Recovery**:
1. Switch to backup venues
2. Reduce order frequency
3. Optimize routing logic
4. Scale execution pods

---

## Escalation Matrix

| Alert Type | L1 Response Time | L2 Escalation | L3 Escalation |
|------------|------------------|---------------|---------------|
| Module Down | 5 min | 15 min | 30 min |
| High Drawdown | Immediate | 10 min | 20 min |
| Model Drift Critical | 10 min | 30 min | 1 hour |
| High Error Rate | 15 min | 30 min | 1 hour |
| Execution Latency | 30 min | 1 hour | 2 hours |

## Communication Templates

### Incident Start
```
🚨 INCIDENT: [Alert Name]
Severity: [Critical/Warning]
Time: [UTC Timestamp]
Impact: [Business Impact]
Status: Investigating
Lead: @[username]
```

### Status Update
```
📊 UPDATE: [Alert Name]
Time: [UTC Timestamp]
Status: [Investigating/Mitigating/Resolved]
Actions Taken: [List]
Next Steps: [List]
ETA: [Time estimate]
```

### Incident Resolution
```
✅ RESOLVED: [Alert Name]
Duration: [Total time]
Root Cause: [Brief description]
Fix Applied: [What was done]
Follow-up: [Link to postmortem]
```

## Post-Incident Checklist

- [ ] Document timeline in incident log
- [ ] Update runbook with learnings
- [ ] Create JIRA tickets for improvements
- [ ] Schedule postmortem (if severity > warning)
- [ ] Update monitoring thresholds if needed
- [ ] Test fixes in staging environment
- [ ] Communicate resolution to stakeholders

## Emergency Contacts

- **On-Call Engineer**: Check PagerDuty
- **Team Lead**: @teamlead (Slack)
- **Infrastructure**: @infra-team (Slack)
- **Risk Team**: @risk-team (Slack)
- **Escalation**: +1-XXX-XXX-XXXX

---

*Last Updated: [Date]*
*Version: 1.0* 