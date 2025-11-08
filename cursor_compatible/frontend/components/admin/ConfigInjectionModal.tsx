import React, { useState, useEffect } from 'react';
import { ConfigInjectionProps } from './types';
import styles from '../../styles/admin/ConfigInjection.module.css';

export default function ConfigInjectionModal({
  agentId,
  onClose,
  onSubmit
}: ConfigInjectionProps) {
  const [configText, setConfigText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<object | null>(null);

  useEffect(() => {
    // Fetch current config when modal opens
    fetchCurrentConfig();
  }, [agentId]);

  const fetchCurrentConfig = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/agent/config?agentId=${agentId}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch current config');
      }

      const data = await response.json();
      setCurrentConfig(data.config);
      setConfigText(JSON.stringify(data.config, null, 2));
    } catch (error) {
      console.error('Error fetching config:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch current configuration');
      // Set empty default if we can't fetch current config
      setConfigText(JSON.stringify({}, null, 2));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = () => {
    try {
      // Validate JSON syntax
      const parsedConfig = JSON.parse(configText);
      
      // Call the onSubmit handler with the validated config object
      onSubmit(agentId, parsedConfig);
    } catch (err) {
      setError('Invalid JSON configuration');
    }
  };

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h2>Inject Configuration</h2>
          <button 
            className={styles.closeButton}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.agentInfo}>
            Agent ID: <strong>{agentId}</strong>
          </p>
          
          {error && (
            <div className={styles.errorMessage}>
              {error}
              <button 
                className={styles.dismissButton}
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          
          {isLoading ? (
            <div className={styles.loadingMessage}>
              Loading current configuration...
            </div>
          ) : (
            <>
              <p className={styles.configInstructions}>
                Modify the configuration below. Changes will be applied immediately.
              </p>
              
              <textarea
                className={styles.configEditor}
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                rows={20}
                spellCheck={false}
              />
            </>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button 
            className={styles.cancelButton}
            onClick={onClose}
          >
            Cancel
          </button>
          <button 
            className={styles.submitButton}
            onClick={handleSubmit}
            disabled={isLoading}
          >
            Apply Configuration
          </button>
        </div>
      </div>
    </div>
  );
} 