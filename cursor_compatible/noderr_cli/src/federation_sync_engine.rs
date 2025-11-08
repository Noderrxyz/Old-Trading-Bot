use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;
use tokio::time::interval;

use crate::commands::federation::{FederationDataType, FederationLinkPacket, FederationLink};

const MAX_CACHE_SIZE: usize = 1000;
const DEFAULT_SYNC_INTERVAL: u64 = 300; // 5 minutes

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedTrustMetric {
    pub agent_id: String,
    pub cluster_id: String,
    pub trust_score: f64,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedModelUpdate {
    pub strategy_hash: String,
    pub from_cluster: String,
    pub version: String,
    pub patch: serde_json::Value,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedAlert {
    pub alert_id: String,
    pub from_cluster: String,
    pub severity: String,
    pub message: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub enum FederationEvent {
    TrustUpdate(FederatedTrustMetric),
    ModelUpdate(FederatedModelUpdate),
    Alert(FederatedAlert),
    VoteUpdate(String), // Proposal ID
    LinkEstablished(String), // Cluster ID
    LinkBroken(String), // Cluster ID
}

pub struct FederationSyncEngine {
    links: Arc<Mutex<HashMap<String, FederationLink>>>,
    trust_cache: Arc<Mutex<HashMap<String, FederatedTrustMetric>>>,
    model_cache: Arc<Mutex<HashMap<String, FederatedModelUpdate>>>,
    alert_cache: Arc<Mutex<Vec<FederatedAlert>>>,
    event_sender: broadcast::Sender<FederationEvent>,
    running: Arc<Mutex<bool>>,
    sync_interval: u64,
}

impl FederationSyncEngine {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        
        Self {
            links: Arc::new(Mutex::new(HashMap::new())),
            trust_cache: Arc::new(Mutex::new(HashMap::new())),
            model_cache: Arc::new(Mutex::new(HashMap::new())),
            alert_cache: Arc::new(Mutex::new(Vec::new())),
            event_sender: tx,
            running: Arc::new(Mutex::new(false)),
            sync_interval: DEFAULT_SYNC_INTERVAL,
        }
    }
    
    pub fn subscribe(&self) -> broadcast::Receiver<FederationEvent> {
        self.event_sender.subscribe()
    }
    
    pub fn add_link(&self, link: FederationLink) -> Result<()> {
        let mut links = self.links.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        links.insert(link.cluster_id.clone(), link);
        Ok(())
    }
    
    pub fn remove_link(&self, cluster_id: &str) -> Result<bool> {
        let mut links = self.links.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        Ok(links.remove(cluster_id).is_some())
    }
    
    pub fn get_links(&self) -> Result<Vec<FederationLink>> {
        let links = self.links.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        Ok(links.values().cloned().collect())
    }
    
    pub fn get_link(&self, cluster_id: &str) -> Result<Option<FederationLink>> {
        let links = self.links.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        Ok(links.get(cluster_id).cloned())
    }
    
    pub fn process_packet(&self, packet: &FederationLinkPacket, public_key: &str) -> Result<bool> {
        // Verify the packet signature
        if !packet.verify(public_key)? {
            return Ok(false);
        }
        
        // Process based on payload type
        match packet.payload_type {
            FederationDataType::Trust => self.process_trust_packet(packet),
            FederationDataType::ModelSync => self.process_model_packet(packet),
            FederationDataType::Alert => self.process_alert_packet(packet),
            FederationDataType::Vote => self.process_vote_packet(packet),
            FederationDataType::All => Err(anyhow::anyhow!("Invalid payload type 'All' for specific packet")),
        }
    }
    
    fn process_trust_packet(&self, packet: &FederationLinkPacket) -> Result<bool> {
        let trust_metric: FederatedTrustMetric = serde_json::from_value(packet.payload.clone())?;
        
        // Update trust cache
        let mut trust_cache = self.trust_cache.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        let cache_key = format!("{}:{}", trust_metric.cluster_id, trust_metric.agent_id);
        trust_cache.insert(cache_key, trust_metric.clone());
        
        // Trim cache if needed
        if trust_cache.len() > MAX_CACHE_SIZE {
            // Simple strategy: remove oldest entries
            let mut entries: Vec<_> = trust_cache.iter().collect();
            entries.sort_by_key(|(_, v)| v.timestamp);
            
            while trust_cache.len() > MAX_CACHE_SIZE / 2 {
                if let Some((k, _)) = entries.first() {
                    trust_cache.remove(*k);
                    entries.remove(0);
                } else {
                    break;
                }
            }
        }
        
        // Broadcast event
        let _ = self.event_sender.send(FederationEvent::TrustUpdate(trust_metric));
        
        Ok(true)
    }
    
    fn process_model_packet(&self, packet: &FederationLinkPacket) -> Result<bool> {
        let model_update: FederatedModelUpdate = serde_json::from_value(packet.payload.clone())?;
        
        // Update model cache
        let mut model_cache = self.model_cache.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        let cache_key = format!("{}:{}", model_update.from_cluster, model_update.strategy_hash);
        model_cache.insert(cache_key, model_update.clone());
        
        // Trim cache if needed
        if model_cache.len() > MAX_CACHE_SIZE {
            // Simple strategy: remove oldest entries
            let mut entries: Vec<_> = model_cache.iter().collect();
            entries.sort_by_key(|(_, v)| v.timestamp);
            
            while model_cache.len() > MAX_CACHE_SIZE / 2 {
                if let Some((k, _)) = entries.first() {
                    model_cache.remove(*k);
                    entries.remove(0);
                } else {
                    break;
                }
            }
        }
        
        // Broadcast event
        let _ = self.event_sender.send(FederationEvent::ModelUpdate(model_update));
        
        Ok(true)
    }
    
    fn process_alert_packet(&self, packet: &FederationLinkPacket) -> Result<bool> {
        let alert: FederatedAlert = serde_json::from_value(packet.payload.clone())?;
        
        // Update alert cache
        let mut alert_cache = self.alert_cache.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        alert_cache.push(alert.clone());
        
        // Trim cache if needed
        if alert_cache.len() > MAX_CACHE_SIZE {
            // Sort by timestamp (newest first)
            alert_cache.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
            // Keep only most recent
            alert_cache.truncate(MAX_CACHE_SIZE / 2);
        }
        
        // Broadcast event
        let _ = self.event_sender.send(FederationEvent::Alert(alert));
        
        Ok(true)
    }
    
    fn process_vote_packet(&self, packet: &FederationLinkPacket) -> Result<bool> {
        // For vote packets, we'll just forward them to the governance system
        // We don't need to cache them here as that's handled by the governance module
        
        // Extract proposal ID from payload
        let proposal_id = packet.payload.get("proposal_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Invalid vote packet: missing proposal_id"))?;
        
        // Broadcast event
        let _ = self.event_sender.send(FederationEvent::VoteUpdate(proposal_id.to_string()));
        
        Ok(true)
    }
    
    pub async fn start_sync_loop(&self) -> Result<()> {
        {
            let mut running = self.running.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
            if *running {
                return Err(anyhow::anyhow!("Sync engine already running"));
            }
            *running = true;
        }
        
        let running = self.running.clone();
        let links = self.links.clone();
        let event_sender = self.event_sender.clone();
        let sync_interval = self.sync_interval;
        
        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(sync_interval));
            
            loop {
                interval.tick().await;
                
                {
                    let is_running = running.lock().unwrap();
                    if !*is_running {
                        break;
                    }
                }
                
                // Perform synchronization with all linked clusters
                let link_clones = {
                    let links_guard = links.lock().unwrap();
                    links_guard.values().cloned().collect::<Vec<_>>()
                };
                
                for link in link_clones {
                    if !link.authorized {
                        continue;
                    }
                    
                    // In a real implementation, this would:
                    // 1. Connect to the remote cluster
                    // 2. Pull updates since last sync
                    // 3. Process and validate received packets
                    // 4. Update the last_sync timestamp
                    
                    // For now, we'll just simulate successful sync
                    let mut links_guard = links.lock().unwrap();
                    if let Some(existing_link) = links_guard.get_mut(&link.cluster_id) {
                        existing_link.last_sync = Some(
                            SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or(Duration::from_secs(0))
                                .as_secs()
                        );
                    }
                }
            }
        });
        
        Ok(())
    }
    
    pub fn stop_sync_loop(&self) -> Result<()> {
        let mut running = self.running.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        *running = false;
        Ok(())
    }
    
    pub fn set_sync_interval(&mut self, interval_seconds: u64) {
        self.sync_interval = interval_seconds;
    }
    
    pub fn get_trust_metric(&self, cluster_id: &str, agent_id: &str) -> Result<Option<FederatedTrustMetric>> {
        let trust_cache = self.trust_cache.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        let cache_key = format!("{}:{}", cluster_id, agent_id);
        Ok(trust_cache.get(&cache_key).cloned())
    }
    
    pub fn get_model_update(&self, cluster_id: &str, strategy_hash: &str) -> Result<Option<FederatedModelUpdate>> {
        let model_cache = self.model_cache.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        let cache_key = format!("{}:{}", cluster_id, strategy_hash);
        Ok(model_cache.get(&cache_key).cloned())
    }
    
    pub fn get_recent_alerts(&self, limit: usize) -> Result<Vec<FederatedAlert>> {
        let alert_cache = self.alert_cache.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        let mut alerts = alert_cache.clone();
        alerts.sort_by(|a, b| b.timestamp.cmp(&a.timestamp)); // newest first
        Ok(alerts.into_iter().take(limit).collect())
    }
} 