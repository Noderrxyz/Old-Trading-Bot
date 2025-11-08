use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::commands::federation::{NormalizationMethod, TrustNormalization};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustDistribution {
    pub mean: f64,
    pub std_dev: f64,
    pub min: f64,
    pub max: f64,
    pub percentiles: HashMap<String, f64>, // Key is percentile as string (e.g., "90")
}

pub struct TrustNormalizer {
    normalizations: Arc<Mutex<HashMap<String, TrustNormalization>>>,
    distributions: Arc<Mutex<HashMap<String, TrustDistribution>>>,
}

impl TrustNormalizer {
    pub fn new() -> Self {
        Self {
            normalizations: Arc::new(Mutex::new(HashMap::new())),
            distributions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    
    pub fn add_normalization(&self, normalization: TrustNormalization) -> Result<()> {
        let key = format!("{}:{}", normalization.local_cluster_id, normalization.remote_cluster_id);
        let mut normalizations = self.normalizations.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        normalizations.insert(key, normalization);
        Ok(())
    }
    
    pub fn get_normalization(&self, local_cluster_id: &str, remote_cluster_id: &str) -> Result<Option<TrustNormalization>> {
        let key = format!("{}:{}", local_cluster_id, remote_cluster_id);
        let normalizations = self.normalizations.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        Ok(normalizations.get(&key).cloned())
    }
    
    pub fn set_distribution(&self, cluster_id: &str, distribution: TrustDistribution) -> Result<()> {
        let mut distributions = self.distributions.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        distributions.insert(cluster_id.to_string(), distribution);
        Ok(())
    }
    
    pub fn get_distribution(&self, cluster_id: &str) -> Result<Option<TrustDistribution>> {
        let distributions = self.distributions.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        Ok(distributions.get(cluster_id).cloned())
    }
    
    /// Normalize trust score from remote cluster to local cluster scale
    pub fn normalize_trust(&self, 
                          remote_cluster_id: &str, 
                          local_cluster_id: &str, 
                          remote_trust: f64) -> Result<f64> {
        // Get the normalization configuration
        let norm_key = format!("{}:{}", local_cluster_id, remote_cluster_id);
        let remote_key = remote_cluster_id.to_string();
        let local_key = local_cluster_id.to_string();
        
        let normalizations = self.normalizations.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        let normalization = normalizations.get(&norm_key)
            .ok_or_else(|| anyhow::anyhow!("No normalization found for {}:{}", local_cluster_id, remote_cluster_id))?;
        
        let distributions = self.distributions.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        
        match normalization.method {
            NormalizationMethod::Percentile => {
                // For percentile normalization, we need distributions for both clusters
                let remote_dist = distributions.get(&remote_key)
                    .ok_or_else(|| anyhow::anyhow!("No distribution found for {}", remote_cluster_id))?;
                let local_dist = distributions.get(&local_key)
                    .ok_or_else(|| anyhow::anyhow!("No distribution found for {}", local_cluster_id))?;
                
                // Find which percentile the remote trust score corresponds to
                let remote_percentile = find_percentile(remote_trust, remote_dist)?;
                
                // Map that percentile to the equivalent score in local distribution
                interpolate_from_percentile(remote_percentile, local_dist)
            },
            
            NormalizationMethod::ZScore => {
                // For Z-score normalization, standardize using remote distribution then scale to local
                let remote_dist = distributions.get(&remote_key)
                    .ok_or_else(|| anyhow::anyhow!("No distribution found for {}", remote_cluster_id))?;
                let local_dist = distributions.get(&local_key)
                    .ok_or_else(|| anyhow::anyhow!("No distribution found for {}", local_cluster_id))?;
                
                // Calculate z-score in remote distribution
                let z_score = (remote_trust - remote_dist.mean) / remote_dist.std_dev;
                
                // Apply z-score in local distribution
                let local_trust = local_dist.mean + (z_score * local_dist.std_dev);
                
                // Clamp to local min/max
                Ok(local_trust.max(local_dist.min).min(local_dist.max))
            },
            
            NormalizationMethod::LinearMapping => {
                // For linear mapping, use the parameters from the normalization config
                let slope = normalization.mapping_parameters.get("slope")
                    .ok_or_else(|| anyhow::anyhow!("Missing slope parameter for linear mapping"))?;
                let intercept = normalization.mapping_parameters.get("intercept")
                    .ok_or_else(|| anyhow::anyhow!("Missing intercept parameter for linear mapping"))?;
                
                let local_trust = (remote_trust * slope) + intercept;
                
                // Get local distribution to clamp if available
                if let Some(local_dist) = distributions.get(&local_key) {
                    Ok(local_trust.max(local_dist.min).min(local_dist.max))
                } else {
                    // If no distribution, just clamp to 0-1 range
                    Ok(local_trust.max(0.0).min(1.0))
                }
            },
            
            NormalizationMethod::Custom => {
                // For custom normalization, execute the custom function defined in parameters
                // This is a simple example - in a real implementation, this might use more complex logic
                // or even reference custom code registered with the normalizer
                
                let a = normalization.mapping_parameters.get("a")
                    .ok_or_else(|| anyhow::anyhow!("Missing parameter 'a' for custom mapping"))?;
                let b = normalization.mapping_parameters.get("b")
                    .ok_or_else(|| anyhow::anyhow!("Missing parameter 'b' for custom mapping"))?;
                let c = normalization.mapping_parameters.get("c")
                    .ok_or_else(|| anyhow::anyhow!("Missing parameter 'c' for custom mapping"))?;
                
                // Example of a custom formula: a * (remote_trust)^2 + b * remote_trust + c
                let local_trust = a * remote_trust.powi(2) + b * remote_trust + c;
                
                // Get local distribution to clamp if available
                if let Some(local_dist) = distributions.get(&local_key) {
                    Ok(local_trust.max(local_dist.min).min(local_dist.max))
                } else {
                    // If no distribution, just clamp to 0-1 range
                    Ok(local_trust.max(0.0).min(1.0))
                }
            },
        }
    }
    
    /// Create a new normalization configuration by analyzing trust distributions
    pub fn create_normalization(&self, 
                               local_cluster_id: &str, 
                               remote_cluster_id: &str, 
                               method: NormalizationMethod) -> Result<TrustNormalization> {
        let distributions = self.distributions.lock().map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        
        let remote_dist = distributions.get(remote_cluster_id)
            .ok_or_else(|| anyhow::anyhow!("No distribution found for {}", remote_cluster_id))?;
        let local_dist = distributions.get(local_cluster_id)
            .ok_or_else(|| anyhow::anyhow!("No distribution found for {}", local_cluster_id))?;
        
        let mut normalization = TrustNormalization {
            local_cluster_id: local_cluster_id.to_string(),
            remote_cluster_id: remote_cluster_id.to_string(),
            method,
            mapping_parameters: HashMap::new(),
            last_updated: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or(std::time::Duration::from_secs(0))
                .as_secs(),
        };
        
        match method {
            NormalizationMethod::Percentile => {
                // For percentile normalization, we don't need any additional parameters
                // The normalization function will use the distributions directly
            },
            
            NormalizationMethod::ZScore => {
                // For Z-score normalization, store mean and std_dev for both distributions
                normalization.mapping_parameters.insert("local_mean".to_string(), local_dist.mean);
                normalization.mapping_parameters.insert("local_std_dev".to_string(), local_dist.std_dev);
                normalization.mapping_parameters.insert("remote_mean".to_string(), remote_dist.mean);
                normalization.mapping_parameters.insert("remote_std_dev".to_string(), remote_dist.std_dev);
            },
            
            NormalizationMethod::LinearMapping => {
                // For linear mapping, calculate slope and intercept based on min/max of both distributions
                
                // Simple approach: map the min and max points
                // slope = (local_max - local_min) / (remote_max - remote_min)
                // intercept = local_min - slope * remote_min
                
                let slope = (local_dist.max - local_dist.min) / (remote_dist.max - remote_dist.min);
                let intercept = local_dist.min - (slope * remote_dist.min);
                
                normalization.mapping_parameters.insert("slope".to_string(), slope);
                normalization.mapping_parameters.insert("intercept".to_string(), intercept);
            },
            
            NormalizationMethod::Custom => {
                // For custom normalization, we'd need a specific algorithm
                // This is just a placeholder example using a quadratic function
                // In a real system, this might involve machine learning or complex curve fitting
                
                // Example quadratic mapping: a*x^2 + b*x + c where x is remote_trust
                // This simplistic approach just ensures the endpoints match
                
                let a = 0.0; // No quadratic component for simplicity
                let b = (local_dist.max - local_dist.min) / (remote_dist.max - remote_dist.min);
                let c = local_dist.min - (b * remote_dist.min);
                
                normalization.mapping_parameters.insert("a".to_string(), a);
                normalization.mapping_parameters.insert("b".to_string(), b);
                normalization.mapping_parameters.insert("c".to_string(), c);
            },
        }
        
        // Add the normalization to our store
        self.add_normalization(normalization.clone())?;
        
        Ok(normalization)
    }
}

// Helper functions

fn find_percentile(trust: f64, distribution: &TrustDistribution) -> Result<f64> {
    // Simple implementation - in a real system you'd have more complete percentile data
    // or use statistical functions to calculate it
    
    // If the trust is at or below min, it's at the 0th percentile
    if trust <= distribution.min {
        return Ok(0.0);
    }
    
    // If the trust is at or above max, it's at the 100th percentile
    if trust >= distribution.max {
        return Ok(100.0);
    }
    
    // Create a sorted list of percentiles
    let mut percentiles: Vec<(f64, f64)> = distribution.percentiles.iter()
        .map(|(k, v)| (k.parse::<f64>().unwrap_or(0.0), *v))
        .collect();
    percentiles.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    
    // Add min and max as 0th and 100th percentiles
    percentiles.insert(0, (0.0, distribution.min));
    percentiles.push((100.0, distribution.max));
    
    // Find the two percentiles that bracket our trust value
    for i in 0..percentiles.len() - 1 {
        let (p1, v1) = percentiles[i];
        let (p2, v2) = percentiles[i + 1];
        
        if trust >= v1 && trust <= v2 {
            // Linear interpolation to find the exact percentile
            return Ok(p1 + ((trust - v1) / (v2 - v1)) * (p2 - p1));
        }
    }
    
    // If we get here, something went wrong
    Err(anyhow::anyhow!("Could not find percentile for trust value {}", trust))
}

fn interpolate_from_percentile(percentile: f64, distribution: &TrustDistribution) -> Result<f64> {
    // If the percentile is 0 or less, return min
    if percentile <= 0.0 {
        return Ok(distribution.min);
    }
    
    // If the percentile is 100 or greater, return max
    if percentile >= 100.0 {
        return Ok(distribution.max);
    }
    
    // Create a sorted list of percentiles
    let mut percentiles: Vec<(f64, f64)> = distribution.percentiles.iter()
        .map(|(k, v)| (k.parse::<f64>().unwrap_or(0.0), *v))
        .collect();
    percentiles.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    
    // Add min and max as 0th and 100th percentiles
    percentiles.insert(0, (0.0, distribution.min));
    percentiles.push((100.0, distribution.max));
    
    // Find the two percentiles that bracket our target percentile
    for i in 0..percentiles.len() - 1 {
        let (p1, v1) = percentiles[i];
        let (p2, v2) = percentiles[i + 1];
        
        if percentile >= p1 && percentile <= p2 {
            // Linear interpolation to find the exact trust value
            return Ok(v1 + ((percentile - p1) / (p2 - p1)) * (v2 - v1));
        }
    }
    
    // If we get here, something went wrong
    Err(anyhow::anyhow!("Could not interpolate trust value for percentile {}", percentile))
} 