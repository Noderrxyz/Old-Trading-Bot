/// A simple in-memory implementation for testing
#[derive(Default)]
pub struct MockViolationLogger {
    /// In-memory violations storage
    violations: Arc<RwLock<Vec<LoggedViolation>>>,
}

impl MockViolationLogger {
    /// Create a new mock violation logger
    pub fn new() -> Self {
        Self {
            violations: Arc::new(RwLock::new(Vec::new())),
        }
    }
    
    /// Get all logged violations
    pub fn get_violations(&self) -> Vec<LoggedViolation> {
        let violations = self.violations.read().unwrap();
        violations.clone()
    }
    
    /// Clear all logged violations
    pub fn clear(&self) {
        let mut violations = self.violations.write().unwrap();
        violations.clear();
    }
}

#[async_trait]
impl ViolationLogger for MockViolationLogger {
    async fn log_violation(
        &self,
        agent_id: &str,
        action_type: &GovernanceActionType,
        violation: &RuleViolation
    ) -> Result<LoggedViolation, ViolationLogError> {
        let logged = LoggedViolation {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            action_type: action_type.clone(),
            reason: violation.reason.clone(),
            severity: violation.severity,
            rule_code: violation.rule_code.clone(),
            timestamp: Utc::now(),
        };
        
        {
            let mut violations = self.violations.write().unwrap();
            violations.push(logged.clone());
        }
        
        Ok(logged)
    }
    
    async fn get_violations_for_agent(
        &self,
        agent_id: &str
    ) -> Result<Vec<LoggedViolation>, ViolationLogError> {
        let violations = self.violations.read().unwrap();
        let filtered = violations.iter()
            .filter(|v| v.agent_id == agent_id)
            .cloned()
            .collect();
        
        Ok(filtered)
    }
    
    async fn get_recent_violations(
        &self,
        _limit: usize
    ) -> Result<Vec<LoggedViolation>, ViolationLogError> {
        let violations = self.violations.read().unwrap();
        Ok(violations.clone())
    }
} 