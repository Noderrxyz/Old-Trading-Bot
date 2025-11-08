import React from 'react';
import { Chip } from '@mui/material';
import {
  AccountBalanceOutlined,
  StorageOutlined,
  GavelOutlined,
  TrendingUpOutlined,
} from '@mui/icons-material';

interface ClusterScopeTagProps {
  scope: 'treasury' | 'infra' | 'legal' | 'growth' | string;
  size?: 'small' | 'medium';
}

export const ClusterScopeTag: React.FC<ClusterScopeTagProps> = ({ 
  scope,
  size = 'small'
}) => {
  // Define scope configurations
  const scopeConfig: Record<string, {
    icon: React.ReactNode;
    label: string;
    color: 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error' | 'default';
  }> = {
    treasury: {
      icon: <AccountBalanceOutlined />,
      label: 'Treasury',
      color: 'primary'
    },
    infra: {
      icon: <StorageOutlined />,
      label: 'Infrastructure',
      color: 'info'
    },
    legal: {
      icon: <GavelOutlined />,
      label: 'Legal',
      color: 'warning'
    },
    growth: {
      icon: <TrendingUpOutlined />,
      label: 'Growth',
      color: 'success'
    }
  };

  // Get configuration or use default
  const config = scopeConfig[scope] || {
    icon: <StorageOutlined />,
    label: scope.charAt(0).toUpperCase() + scope.slice(1),
    color: 'default'
  };

  return (
    <Chip
      icon={config.icon}
      label={config.label}
      color={config.color}
      size={size}
      variant="outlined"
    />
  );
};

export default ClusterScopeTag; 