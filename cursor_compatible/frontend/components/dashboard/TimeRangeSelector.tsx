/**
 * Time Range Selector Component
 * 
 * Selector for choosing the time range for data display
 */

import React from 'react';

interface TimeRangeOption {
  value: string;
  label: string;
}

interface TimeRangeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options: TimeRangeOption[];
}

export function TimeRangeSelector({
  value,
  onChange,
  options
}: TimeRangeSelectorProps) {
  return (
    <div className="time-range-selector">
      <div className="range-options">
        {options.map(option => (
          <button
            key={option.value}
            className={`range-option ${value === option.value ? 'active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
} 