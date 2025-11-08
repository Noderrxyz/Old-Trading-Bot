# Noderr Protocol Trading Bot - Disaster Recovery Drill Playbook

## Overview

This document provides a structured approach to disaster recovery drills for the Noderr Protocol Trading Bot. Regular drills ensure the team is prepared to respond effectively to various failure scenarios, minimizing downtime and potential financial losses.

## Recovery Objectives

| Metric | Target |
|--------|--------|
| Recovery Time Objective (RTO) | < 2 hours for critical functions |
| Recovery Point Objective (RPO) | < 5 minutes of data loss |
| Reliability Target | 99.99% uptime |
| Recovery Success Rate | 100% of drills successful |

## Team Roles & Responsibilities

### Incident Commander

- Coordinates the recovery effort
- Makes critical decisions
- Communicates with stakeholders
- Declares incident start/end

### Technical Lead

- Executes recovery procedures
- Performs technical validation
- Coordinates with infrastructure providers
- Updates incident commander on progress

### Communications Coordinator

- Notifies affected stakeholders
- Provides regular status updates
- Documents the incident timeline
- Prepares post-incident report

### Security Officer

- Ensures security controls during recovery
- Validates that no security compromises occur
- Verifies identity of team members during sensitive operations
- Manages access controls during recovery

## Drill Frequency & Schedule

| Scenario | Frequency | Last Performed | Next Scheduled |
|----------|-----------|----------------|----------------|
| Node Failure | Monthly | YYYY-MM-DD | YYYY-MM-DD |
| Database Corruption | Quarterly | YYYY-MM-DD | YYYY-MM-DD |
| Network Partition | Bi-monthly | YYYY-MM-DD | YYYY-MM-DD |
| Chain Adapter Outage | Monthly | YYYY-MM-DD | YYYY-MM-DD |
| Complete System Restore | Quarterly | YYYY-MM-DD | YYYY-MM-DD |
| Cross-chain Recovery | Quarterly | YYYY-MM-DD | YYYY-MM-DD |
| Key Compromise | Bi-annually | YYYY-MM-DD | YYYY-MM-DD |

## Recovery Scenarios

### Scenario 1: Primary Node Failure

#### Scenario Description
The primary application node becomes unresponsive or crashes, requiring failover to a secondary node.

#### Prerequisites
- Access to cloud provider console
- Admin credentials for the system
- Current infrastructure diagram

#### Recovery Steps

1. **Detect Failure**
   ```bash
   # Verify node is down
   ping primary-node.noderr.com
   ssh admin@primary-node.noderr.com
   ```

2. **Activate Standby Node**
   ```bash
   # Update DNS to point to standby node
   ./scripts/failover.sh primary-to-standby
   
   # Verify the standby node is operational
   curl -X GET https://api.noderr.com/health
   ```

3. **Validate Database State**
   ```bash
   # Connect to database and verify integrity
   psql -h db.noderr.com -U admin -c "SELECT pg_is_in_recovery();"
   psql -h db.noderr.com -U admin -c "SELECT count(*) FROM strategies;"
   ```

4. **Resume Operations**
   ```bash
   # Enable trading on new primary
   curl -X POST https://api.noderr.com/admin/enable-trading \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json"
   ```

5. **Repair Original Node**
   ```bash
   # Investigate cause and repair
   ./scripts/node-repair.sh primary-node
   ```

#### Success Criteria
- Trading bot functionality restored within 15 minutes
- No transaction data lost
- All pending trades properly executed
- System telemetry normal

#### Rollback Plan
If standby node activation fails:
```bash
# Restore from latest snapshot
./scripts/restore-from-snapshot.sh latest
```

### Scenario 2: Database Corruption

#### Scenario Description
The primary database experiences corruption requiring restoration from backup.

#### Prerequisites
- Database admin credentials
- Access to backup storage
- Database restoration documentation

#### Recovery Steps

1. **Confirm Corruption**
   ```bash
   # Run database integrity check
   psql -h db.noderr.com -U admin -c "SELECT count(*) FROM pg_catalog.pg_tables;"
   psql -h db.noderr.com -U admin -c "ANALYZE VERBOSE;"
   ```

2. **Stop Trading Operations**
   ```bash
   # Pause all trading activity
   curl -X POST https://api.noderr.com/admin/disable-trading \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json"
   ```

3. **Identify Last Valid Backup**
   ```bash
   # List available backups
   aws s3 ls s3://noderr-backups/database/ --recursive | sort -r
   ```

4. **Restore Database**
   ```bash
   # Restore from last valid backup
   ./scripts/db-restore.sh s3://noderr-backups/database/noderr_db_YYYYMMDD_HHMMSS.sql.gz
   ```

5. **Validate Restoration**
   ```bash
   # Verify database integrity and data
   psql -h db.noderr.com -U admin -c "SELECT count(*) FROM strategies;"
   psql -h db.noderr.com -U admin -c "SELECT count(*) FROM execution_history WHERE timestamp > (NOW() - INTERVAL '24 HOURS');"
   ```

6. **Resume Operations**
   ```bash
   # Re-enable trading
   curl -X POST https://api.noderr.com/admin/enable-trading \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json"
   ```

#### Success Criteria
- Database restored with minimal data loss
- System can read/write to database normally
- Strategy data integrity verified
- Trading operations resumed successfully

#### Rollback Plan
If restoration fails:
```bash
# Switch to standby database
./scripts/failover.sh primary-db-to-standby
```

### Scenario 3: Chain Adapter Outage

#### Scenario Description
One or more blockchain adapters fail to connect to RPC endpoints, requiring fallback to alternative endpoints or chains.

#### Prerequisites
- Administrator access to chain adapter configuration
- List of alternative RPC endpoints
- Chain adapter monitoring tools

#### Recovery Steps

1. **Identify Failed Adapter**
   ```bash
   # Check adapter health status
   curl -X GET https://api.noderr.com/admin/chain-health \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

2. **Isolate Affected Strategies**
   ```bash
   # List strategies using the affected chain
   curl -X GET https://api.noderr.com/admin/strategies?chain=ethereum \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   
   # Pause affected strategies
   curl -X POST https://api.noderr.com/admin/strategies/pause \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"chain": "ethereum"}'
   ```

3. **Switch RPC Endpoints**
   ```bash
   # Update RPC endpoints configuration
   curl -X POST https://api.noderr.com/admin/chain-config/update \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "chain": "ethereum",
       "rpcUrls": ["https://eth-backup1.noderr.com", "https://ethereum.publicnode.com"]
     }'
   ```

4. **Verify Adapter Recovery**
   ```bash
   # Check new endpoints are working
   curl -X GET https://api.noderr.com/admin/chain-health \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

5. **Resume Strategy Execution**
   ```bash
   # Resume paused strategies
   curl -X POST https://api.noderr.com/admin/strategies/resume \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"chain": "ethereum"}'
   ```

#### Success Criteria
- Chain adapter reconnected within 5 minutes
- No funds locked in pending transactions
- All strategies resumed normal operation
- No duplicate transactions created

#### Rollback Plan
If alternative endpoints also fail:
```bash
# Enable cross-chain routing for affected strategies
curl -X POST https://api.noderr.com/admin/enable-cross-chain-fallback \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"sourceChain": "ethereum", "targetChain": "polygon"}'
```

### Scenario 4: Complete System Restore

#### Scenario Description
Catastrophic failure requiring complete system restoration from backups to new infrastructure.

#### Prerequisites
- Infrastructure as Code templates
- Database backups
- Configuration backups
- Access to cloud provider console
- API key backup

#### Recovery Steps

1. **Provision Infrastructure**
   ```bash
   # Deploy infrastructure using IaC
   terraform init
   terraform apply -var-file=prod.tfvars
   ```

2. **Restore Databases**
   ```bash
   # Restore primary database
   ./scripts/db-restore.sh s3://noderr-backups/database/noderr_db_latest.sql.gz
   
   # Verify database restoration
   psql -h new-db.noderr.com -U admin -c "SELECT count(*) FROM strategies;"
   ```

3. **Deploy Application**
   ```bash
   # Deploy application containers
   docker-compose -f docker-compose.prod.yml up -d
   
   # Verify application health
   curl -X GET https://new-api.noderr.com/health
   ```

4. **Restore Configuration**
   ```bash
   # Apply saved configurations
   ./scripts/config-restore.sh s3://noderr-backups/configs/latest/
   
   # Validate configuration
   curl -X GET https://new-api.noderr.com/admin/config/validate \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

5. **Restore Keys (Secure Procedure)**
   ```bash
   # This would be a manual process with appropriate security controls
   ./scripts/secure-key-restore.sh --hsm
   ```

6. **Update DNS**
   ```bash
   # Update DNS to point to new infrastructure
   ./scripts/update-dns.sh prod new-infrastructure
   ```

7. **Validate System**
   ```bash
   # Run system validation suite
   ./scripts/system-validation.sh --comprehensive
   ```

#### Success Criteria
- Complete system restored within RTO (2 hours)
- Data loss within RPO (5 minutes)
- All integrations functional
- Security controls verified
- Trading operations successfully resumed

#### Rollback Plan
None - this is the recovery of last resort.

### Scenario 5: Network Partition

#### Scenario Description
Network partition between system components requiring isolation detection and service restoration.

#### Prerequisites
- Network monitoring tools
- Distributed system architecture documentation
- Access to infrastructure management console

#### Recovery Steps

1. **Detect Partition**
   ```bash
   # Run network partition detection
   ./scripts/network-diagnostics.sh --detect-partitions
   ```

2. **Isolate Affected Components**
   ```bash
   # Identify affected components
   curl -X GET https://api.noderr.com/admin/system-topology \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   
   # Disable affected routes
   ./scripts/network-fence.sh --isolate partition-group-a
   ```

3. **Establish Alternative Communication**
   ```bash
   # Activate backup communication channels
   ./scripts/enable-backup-channels.sh
   ```

4. **Reconcile State**
   ```bash
   # Once partition resolves, reconcile state
   ./scripts/state-reconciliation.sh
   ```

5. **Resume Normal Operations**
   ```bash
   # Re-enable normal communication paths
   ./scripts/network-fence.sh --restore
   ```

#### Success Criteria
- Partition detected within 5 minutes
- No duplicate transactions or inconsistent state
- System gracefully handles split-brain scenario
- Operations resume automatically after partition resolves

### Scenario 6: Cross-chain Recovery

#### Scenario Description
Cross-chain transaction failure requiring recovery of locked funds or completion of interrupted operations.

#### Prerequisites
- Cross-chain transaction monitoring tools
- Access to both source and destination chains
- Recovery transaction templates

#### Recovery Steps

1. **Identify Failed Transactions**
   ```bash
   # List pending cross-chain transactions
   curl -X GET https://api.noderr.com/admin/cross-chain/pending \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

2. **Verify Source Chain Status**
   ```bash
   # Check if funds left the source chain
   ./scripts/verify-transaction.sh --chain ethereum --tx 0xabcdef1234567890
   ```

3. **Check Destination Chain Status**
   ```bash
   # Verify if transaction was received on destination
   ./scripts/verify-transaction.sh --chain cosmos --tx IBC78ABCDEF1234567890
   ```

4. **Execute Recovery Transaction**
   ```bash
   # For stuck IBC/XCM transfers
   ./scripts/cross-chain-recovery.sh \
     --source-chain ethereum \
     --dest-chain cosmos \
     --tx 0xabcdef1234567890 \
     --action complete
   ```

5. **Verify Recovery**
   ```bash
   # Confirm funds are recovered
   ./scripts/verify-balance.sh --address cosmos1abcdef1234567890
   ```

#### Success Criteria
- Cross-chain transaction properly recovered
- No funds permanently locked
- Transaction eventually completes or safely reverts
- System records recovery action for audit

## Drill Report Template

```
# DISASTER RECOVERY DRILL REPORT

## Drill Information
- Date: YYYY-MM-DD
- Scenario: [Scenario Name]
- Participants: [Names and Roles]
- Start Time: HH:MM
- End Time: HH:MM
- Total Duration: XX minutes

## Objectives
- [List specific objectives for this drill]

## Summary
[Brief description of the drill execution and outcome]

## Metrics
- Recovery Time: XX minutes
- Data Loss: XX minutes of data
- Success Criteria Met: YES/NO

## Issues Encountered
1. [Issue description]
   - Impact: [Impact description]
   - Resolution: [How it was resolved]

2. [Issue description]
   - Impact: [Impact description]
   - Resolution: [How it was resolved]

## Improvement Opportunities
1. [Improvement description]
   - Priority: HIGH/MEDIUM/LOW
   - Assigned To: [Name]
   - Target Date: YYYY-MM-DD

2. [Improvement description]
   - Priority: HIGH/MEDIUM/LOW
   - Assigned To: [Name]
   - Target Date: YYYY-MM-DD

## Action Items
1. [Action item description]
   - Assigned To: [Name]
   - Due Date: YYYY-MM-DD

2. [Action item description]
   - Assigned To: [Name]
   - Due Date: YYYY-MM-DD

## Sign-off
- Drill Coordinator: [Name, Signature]
- Technical Lead: [Name, Signature]
- Security Officer: [Name, Signature]
```

## Communication During Recovery

### Communication Channels

1. **Primary**: Encrypted team messaging platform
2. **Secondary**: Conference bridge line 
3. **Tertiary**: SMS/Signal message group
4. **Out-of-band**: Designated personal phone numbers

### Status Update Template

```
RECOVERY STATUS UPDATE #[X]
Time: YYYY-MM-DD HH:MM
Incident: [Brief description]
Current Status: [Summary of current situation]
Actions Completed:
- [Action 1]
- [Action 2]
Actions In Progress:
- [Action 3] - ETA HH:MM
- [Action 4] - ETA HH:MM
Blockers:
- [Blocker 1]
Next Update: HH:MM
Contact: [Name] at [Contact Method]
```

## Post-Recovery Analysis

After each successful recovery (drill or real incident):

1. Conduct a blameless post-mortem
2. Document lessons learned
3. Update recovery procedures based on findings
4. Implement preventative measures
5. Schedule follow-up drill to verify improvements

## Appendix: Drill Preparation Checklist

- [ ] Notify all participants 48 hours in advance
- [ ] Ensure backup systems are fully operational before drill
- [ ] Verify monitoring systems are properly configured to observe drill
- [ ] Prepare rollback plans for each step
- [ ] Secure senior management approval for drills affecting production systems
- [ ] Prepare customer communications if public-facing services will be affected
- [ ] Set up a dedicated communication channel for the drill team
- [ ] Verify all participants have necessary access credentials
- [ ] Review previous drill reports for unresolved issues
- [ ] Prepare success criteria measurement tools 