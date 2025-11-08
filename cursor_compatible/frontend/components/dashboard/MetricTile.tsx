/**
 * Metric Tile Component
 * 
 * Display a metric with optional trend indicator
 */

import React from 'react';

interface MetricTileProps {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  inverseTrend?: boolean;
  highlight?: boolean;
  subtext?: string;
}

export function MetricTile({
  label,
  value,
  trend,
  inverseTrend = false,
  highlight = false,
  subtext
}: MetricTileProps) {
  // Determine CSS classes based on props
  const trendClass = trend ? `trend-${trend}` : '';
  const highlightClass = highlight ? 'highlight' : '';
  
  // If inverseTrend is true, swap the styling logic
  // 'up' trends would be bad (red) and 'down' trends would be good (green)
  let finalTrendClass = trendClass;
  if (inverseTrend && trend) {
    finalTrendClass = trend === 'up' ? 'trend-down' : 'trend-up';
  }
  
  return (
    <div className={`metric-tile ${finalTrendClass} ${highlightClass}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {subtext && (
        <div className="metric-subtext">{subtext}</div>
      )}
      {trend && (
        <div className="trend-indicator">
          {trend === 'up' && '↑'}
          {trend === 'down' && '↓'}
          {trend === 'neutral' && '→'}
        </div>
      )}
    </div>
  );
} 