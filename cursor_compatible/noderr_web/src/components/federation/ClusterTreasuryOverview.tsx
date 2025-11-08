import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, Grid, Chip, LinearProgress, Tooltip, Alert, Button } from '@mui/material';
import { styled } from '@mui/material/styles';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import BalanceIcon from '@mui/icons-material/Balance';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { RedisService } from '../../services/RedisService';
import { TreasuryBalancer } from '../../services/TreasuryBalancer';

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  height: '100%',
  display: 'flex',
  flexDirection: 'column'
}));

const TreasuryCard = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'status',
})<{ status: 'surplus' | 'balanced' | 'deficit' }>(({ theme, status }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(2),
  border: `1px solid ${
    status === 'surplus' ? theme.palette.success.main :
    status === 'deficit' ? theme.palette.error.main :
    theme.palette.info.main
  }`,
  position: 'relative',
  overflow: 'hidden',
  '&::after': {
    content: '""',
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: '100%',
    background: 
      status === 'surplus' ? theme.palette.success.main :
      status === 'deficit' ? theme.palette.error.main :
      theme.palette.info.main,
    opacity: 0.1
  }
}));

const StatusChip = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'status',
})<{ status: 'surplus' | 'balanced' | 'deficit' }>(({ theme, status }) => ({
  backgroundColor: 
    status === 'surplus' ? theme.palette.success.main :
    status === 'deficit' ? theme.palette.error.main :
    theme.palette.info.main,
  color: theme.palette.getContrastText(
    status === 'surplus' ? theme.palette.success.main :
    status === 'deficit' ? theme.palette.error.main :
    theme.palette.info.main
  ),
  fontWeight: 'bold'
}));

const BalanceProgress = styled(LinearProgress, {
  shouldForwardProp: (prop) => prop !== 'status',
})<{ status: 'surplus' | 'balanced' | 'deficit' }>(({ theme, status }) => ({
  height: 8,
  borderRadius: 4,
  backgroundColor: theme.palette.grey[200],
  '& .MuiLinearProgress-bar': {
    backgroundColor: 
      status === 'surplus' ? theme.palette.success.main :
      status === 'deficit' ? theme.palette.error.main :
      theme.palette.info.main
  }
}));

interface ClusterTreasury {
  id: string;
  name: string;
  balance: number;
  previous_balance: number;
  status: 'surplus' | 'balanced' | 'deficit';
  region: string;
  imbalancePercent: number;
}

interface ClusterTreasuryOverviewProps {
  refreshInterval?: number; // in milliseconds, default 30s
  onManualRebalance?: () => void;
}

const ClusterTreasuryOverview: React.FC<ClusterTreasuryOverviewProps> = ({ 
  refreshInterval = 30000,
  onManualRebalance 
}) => {
  const [treasuries, setTreasuries] = useState<ClusterTreasury[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [medianBalance, setMedianBalance] = useState<number>(0);
  const [rebalanceAvailable, setRebalanceAvailable] = useState<boolean>(false);
  const [autoRebalancing, setAutoRebalancing] = useState<boolean>(false);
  
  // Fetch treasury data
  const fetchTreasuryData = async () => {
    try {
      setLoading(true);
      const redisService = RedisService.getInstance();
      const balances = await redisService.getAllTreasuryBalances();
      
      // Mock data for demonstration (in production, this would come from the API)
      const mockTreasuries: ClusterTreasury[] = [
        { 
          id: 'cluster-1', 
          name: 'North America Cluster', 
          balance: balances['north-america'] || 250000, 
          previous_balance: 220000,
          status: 'surplus',
          region: 'NA',
          imbalancePercent: 0
        },
        { 
          id: 'cluster-2', 
          name: 'Europe Cluster', 
          balance: balances['europe'] || 150000, 
          previous_balance: 170000,
          status: 'deficit',
          region: 'EU',
          imbalancePercent: 0
        },
        { 
          id: 'cluster-3', 
          name: 'Asia Pacific Cluster', 
          balance: balances['asia-pacific'] || 200000, 
          previous_balance: 200000,
          status: 'balanced',
          region: 'APAC',
          imbalancePercent: 0
        },
        { 
          id: 'cluster-4', 
          name: 'Africa Cluster', 
          balance: balances['africa'] || 130000, 
          previous_balance: 120000,
          status: 'deficit',
          region: 'AFR',
          imbalancePercent: 0
        },
        { 
          id: 'cluster-5', 
          name: 'South America Cluster', 
          balance: balances['south-america'] || 180000, 
          previous_balance: 160000,
          status: 'surplus',
          region: 'SA',
          imbalancePercent: 0
        }
      ];
      
      // Calculate median balance
      const values = mockTreasuries.map(t => t.balance);
      const median = getMedian(values);
      setMedianBalance(median);
      
      // Calculate surplus/deficit based on median
      const processedTreasuries = mockTreasuries.map(treasury => {
        const imbalance = treasury.balance - median;
        const imbalancePercent = Math.abs((imbalance / median) * 100);
        
        let status: 'surplus' | 'balanced' | 'deficit';
        if (imbalancePercent < 10) {
          status = 'balanced';
        } else {
          status = imbalance > 0 ? 'surplus' : 'deficit';
        }
        
        return {
          ...treasury,
          status,
          imbalancePercent
        };
      });
      
      setTreasuries(processedTreasuries);
      
      // Determine if rebalance is needed
      const needsRebalance = processedTreasuries.some(t => t.imbalancePercent > 15);
      setRebalanceAvailable(needsRebalance);
      
      setLoading(false);
    } catch (err) {
      setError('Failed to load treasury data');
      setLoading(false);
      console.error('Error fetching treasury data:', err);
    }
  };
  
  // Handle manual rebalance
  const handleRebalance = () => {
    try {
      const treasuryBalancer = TreasuryBalancer.getInstance();
      treasuryBalancer.checkAndBalanceTreasuries();
      
      if (onManualRebalance) {
        onManualRebalance();
      }
      
      // Optimistically update UI
      setRebalanceAvailable(false);
    } catch (error) {
      console.error('Error triggering rebalance:', error);
      setError('Failed to trigger rebalance');
    }
  };
  
  // Toggle auto-rebalancing
  const toggleAutoRebalance = () => {
    try {
      const treasuryBalancer = TreasuryBalancer.getInstance();
      
      if (autoRebalancing) {
        treasuryBalancer.stop();
      } else {
        treasuryBalancer.start();
      }
      
      setAutoRebalancing(!autoRebalancing);
    } catch (error) {
      console.error('Error toggling auto-rebalance:', error);
      setError('Failed to toggle auto-rebalance');
    }
  };
  
  // Calculate median
  const getMedian = (values: number[]): number => {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };
  
  // Format currency
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };
  
  // Calculate progress bar value (0-100)
  const getProgressValue = (treasury: ClusterTreasury): number => {
    // Cap at 100% for display purposes
    return Math.min(100, treasury.imbalancePercent);
  };
  
  // Initial load and refresh interval
  useEffect(() => {
    fetchTreasuryData();
    
    const interval = setInterval(() => {
      fetchTreasuryData();
    }, refreshInterval);
    
    return () => clearInterval(interval);
  }, [refreshInterval]);
  
  return (
    <StyledPaper elevation={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" component="h2">
          Federation Treasury Status
        </Typography>
        
        <Box>
          <Button
            variant={autoRebalancing ? "contained" : "outlined"}
            color={autoRebalancing ? "success" : "primary"}
            onClick={toggleAutoRebalance}
            sx={{ mr: 1 }}
          >
            {autoRebalancing ? "Auto-Rebalance ON" : "Auto-Rebalance OFF"}
          </Button>
          
          <Button
            variant="contained"
            color="primary"
            onClick={handleRebalance}
            disabled={!rebalanceAvailable || autoRebalancing}
            startIcon={<BalanceIcon />}
          >
            Rebalance Now
          </Button>
        </Box>
      </Box>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" color="text.secondary">
          Median Balance: {formatCurrency(medianBalance)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Clusters with &gt;15% imbalance are candidates for rebalancing
        </Typography>
      </Box>
      
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <LinearProgress sx={{ width: '100%' }} />
        </Box>
      ) : (
        <Grid container spacing={2}>
          {treasuries.map((treasury) => (
            <Grid item xs={12} sm={6} md={4} key={treasury.id}>
              <TreasuryCard status={treasury.status}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Typography variant="h6" component="h3">
                    {treasury.name}
                  </Typography>
                  <StatusChip 
                    size="small"
                    status={treasury.status}
                    label={treasury.status.toUpperCase()}
                    icon={
                      treasury.status === 'surplus' ? <TrendingUpIcon /> :
                      treasury.status === 'deficit' ? <TrendingDownIcon /> :
                      <BalanceIcon />
                    }
                  />
                </Box>
                
                <Typography variant="h5" component="div" sx={{ mb: 1, fontWeight: 'bold' }}>
                  {formatCurrency(treasury.balance)}
                </Typography>
                
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  {treasury.balance > treasury.previous_balance ? (
                    <ArrowUpwardIcon color="success" fontSize="small" />
                  ) : treasury.balance < treasury.previous_balance ? (
                    <ArrowDownwardIcon color="error" fontSize="small" />
                  ) : (
                    <span>→</span>
                  )}
                  <Typography variant="body2" sx={{ ml: 0.5 }}>
                    {formatCurrency(treasury.previous_balance)} (previous)
                  </Typography>
                </Box>
                
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Region: {treasury.region}
                </Typography>
                
                <Box sx={{ mt: 2 }}>
                  <Tooltip 
                    title={
                      treasury.status === 'balanced' ? 
                        "Within acceptable range" : 
                        `${Math.round(treasury.imbalancePercent)}% ${treasury.status === 'surplus' ? 'above' : 'below'} median`
                    }
                    arrow
                  >
                    <Box sx={{ width: '100%' }}>
                      <Typography variant="caption" display="block" gutterBottom>
                        Imbalance: {Math.round(treasury.imbalancePercent)}%
                      </Typography>
                      <BalanceProgress 
                        variant="determinate" 
                        value={getProgressValue(treasury)} 
                        status={treasury.status}
                      />
                    </Box>
                  </Tooltip>
                </Box>
              </TreasuryCard>
            </Grid>
          ))}
        </Grid>
      )}
    </StyledPaper>
  );
};

export default ClusterTreasuryOverview; 