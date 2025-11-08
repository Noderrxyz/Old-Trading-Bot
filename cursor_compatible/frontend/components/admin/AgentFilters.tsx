import React from 'react';
import { AgentFiltersProps } from './types';
import styles from '../../styles/admin/AgentFilters.module.css';

export default function AgentFilters({
  currentFilter,
  onFilterChange
}: AgentFiltersProps) {
  const filters = [
    { id: 'all', label: 'All Agents' },
    { id: 'live', label: 'Live Agents' },
    { id: 'canary', label: 'Canary Agents' },
    { id: 'paused', label: 'Paused Agents' }
  ];
  
  return (
    <div className={styles.container}>
      <div className={styles.filtersGroup}>
        {filters.map(filter => (
          <button
            key={filter.id}
            className={`${styles.filterButton} ${currentFilter === filter.id ? styles.active : ''}`}
            onClick={() => onFilterChange(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
} 