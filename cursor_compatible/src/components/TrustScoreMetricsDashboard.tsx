import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, Typography, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Box, CircularProgress, Chip, Button, Divider, Tabs, Tab, Alert, Tooltip } from '@mui/material';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip as ChartTooltip, Legend } from 'chart.js';
import axios from 'axios';

// Register ChartJS components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend);

interface TrustHistoryEntry {
  timestamp: number;
  score: number;
}

interface ViolationReport {
  agentId: string;
  violations: number;
  firstViolation: number;
  lastViolation: number;
  nextResetTime: number;
}

interface EnforcementEvent {
  type: string;
  action: string;
  agentId: string;
  score: number;
  timestamp: number;
  reason?: string;
  [key: string]: any;
}

interface AgentTrustData {
  agentId: string;
  name: string;
  trustScore: number;
  healthMode: string;
  history: TrustHistoryEntry[];
  violations: ViolationReport | null;
  lastEnforcement: EnforcementEvent | null;
}

const TrustScoreMetricsDashboard: React.FC = () => {
  const [agentData, setAgentData] = useState<AgentTrustData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState<number>(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<string>('1d');

  useEffect(() => {
    fetchAgentTrustData();
    
    // Set up polling for real-time updates
    const interval = setInterval(() => {
      fetchAgentTrustData();
    }, 30000); // Poll every 30 seconds
    
    return () => clearInterval(interval);
  }, [timeRange]);

  const fetchAgentTrustData = async () => {
    try {
      setLoading(true);
      // Replace with your actual API endpoint
      const response = await axios.get(`/api/agents/trust?timeRange=${timeRange}`);
      setAgentData(response.data.agents);
      setError(null);
    } catch (err) {
      setError('Failed to load trust data. Please try again later.');
      console.error('Error fetching trust data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeTab = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleAgentSelect = (agentId: string) => {
    setSelectedAgentId(agentId === selectedAgentId ? null : agentId);
  };

  const handleChangeTimeRange = (range: string) => {
    setTimeRange(range);
  };

  const getHealthModeColor = (mode: string): string => {
    switch (mode.toLowerCase()) {
      case 'normal':
        return '#4caf50'; // Green
      case 'self_healing':
        return '#ff9800'; // Orange
      case 'critical':
        return '#f44336'; // Red
      case 'quarantined':
        return '#9c27b0'; // Purple
      default:
        return '#9e9e9e'; // Gray
    }
  };

  const getTrustScoreColor = (score: number): string => {
    if (score >= 0.7) return '#4caf50'; // Green
    if (score >= 0.35) return '#ff9800'; // Orange
    return '#f44336'; // Red
  };

  const formatDateTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    let interval = Math.floor(seconds / 31536000);
    if (interval > 1) return `${interval} years ago`;
    
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return `${interval} months ago`;
    
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return `${interval} days ago`;
    
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return `${interval} hours ago`;
    
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return `${interval} minutes ago`;
    
    return `${Math.floor(seconds)} seconds ago`;
  };

  const renderTrustScoreOverview = () => {
    if (loading) return <CircularProgress />;
    if (error) return <Alert severity="error">{error}</Alert>;
    
    return (
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Agent</TableCell>
              <TableCell>Trust Score</TableCell>
              <TableCell>Health Mode</TableCell>
              <TableCell>Violations</TableCell>
              <TableCell>Last Update</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {agentData.map((agent) => (
              <TableRow 
                key={agent.agentId}
                onClick={() => handleAgentSelect(agent.agentId)}
                sx={{ 
                  cursor: 'pointer',
                  backgroundColor: selectedAgentId === agent.agentId ? 'rgba(0, 0, 0, 0.04)' : 'inherit'
                }}
              >
                <TableCell>{agent.name}</TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center">
                    <Box
                      width={60}
                      height={60}
                      position="relative"
                      display="inline-flex"
                      mr={2}
                    >
                      <CircularProgress
                        variant="determinate"
                        value={agent.trustScore * 100}
                        size={60}
                        thickness={5}
                        sx={{ color: getTrustScoreColor(agent.trustScore) }}
                      />
                      <Box
                        top={0}
                        left={0}
                        bottom={0}
                        right={0}
                        position="absolute"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                      >
                        <Typography variant="caption" fontWeight="bold">
                          {Math.round(agent.trustScore * 100)}%
                        </Typography>
                      </Box>
                    </Box>
                    <Typography>{(agent.trustScore * 100).toFixed(1)}%</Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip 
                    label={agent.healthMode}
                    sx={{ 
                      backgroundColor: getHealthModeColor(agent.healthMode),
                      color: 'white'
                    }}
                  />
                </TableCell>
                <TableCell>
                  {agent.violations ? (
                    <Tooltip title={`First violation: ${formatDateTime(agent.violations.firstViolation)}`}>
                      <Chip 
                        label={`${agent.violations.violations} violation(s)`}
                        color="error"
                      />
                    </Tooltip>
                  ) : (
                    <Chip label="None" color="success" />
                  )}
                </TableCell>
                <TableCell>
                  {agent.history.length > 0 
                    ? formatTimeAgo(agent.history[agent.history.length - 1].timestamp)
                    : 'No data'}
                </TableCell>
                <TableCell>
                  <Button 
                    size="small" 
                    variant="outlined"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.location.href = `/agents/${agent.agentId}/trust`;
                    }}
                  >
                    Details
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  const renderSelectedAgentDetails = () => {
    if (!selectedAgentId) return null;
    
    const agent = agentData.find(a => a.agentId === selectedAgentId);
    if (!agent) return null;

    // Prepare chart data
    const chartData = {
      labels: agent.history.map(h => new Date(h.timestamp).toLocaleTimeString()),
      datasets: [
        {
          label: 'Trust Score',
          data: agent.history.map(h => h.score),
          borderColor: 'rgba(75, 192, 192, 1)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          tension: 0.1
        }
      ]
    };

    const chartOptions = {
      responsive: true,
      scales: {
        y: {
          min: 0,
          max: 1,
          ticks: {
            callback: (value: number) => `${(value * 100).toFixed(0)}%`
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context: any) => `Trust: ${(context.raw * 100).toFixed(1)}%`
          }
        }
      }
    };

    return (
      <Card sx={{ mt: 3 }}>
        <CardHeader 
          title={`${agent.name} Trust Details`} 
          subheader={`Agent ID: ${agent.agentId}`}
          action={
            <Button 
              variant="outlined" 
              size="small"
              onClick={() => setSelectedAgentId(null)}
            >
              Close
            </Button>
          }
        />
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} md={8}>
              <Typography variant="h6" gutterBottom>Trust Score History</Typography>
              <Box sx={{ height: 300 }}>
                <Line data={chartData} options={chartOptions} />
              </Box>
              <Box sx={{ mt: 2 }}>
                <Button 
                  variant={timeRange === '1h' ? 'contained' : 'outlined'} 
                  size="small" 
                  onClick={() => handleChangeTimeRange('1h')}
                  sx={{ mr: 1 }}
                >
                  1H
                </Button>
                <Button 
                  variant={timeRange === '1d' ? 'contained' : 'outlined'} 
                  size="small" 
                  onClick={() => handleChangeTimeRange('1d')}
                  sx={{ mr: 1 }}
                >
                  1D
                </Button>
                <Button 
                  variant={timeRange === '7d' ? 'contained' : 'outlined'} 
                  size="small" 
                  onClick={() => handleChangeTimeRange('7d')}
                  sx={{ mr: 1 }}
                >
                  7D
                </Button>
                <Button 
                  variant={timeRange === '30d' ? 'contained' : 'outlined'} 
                  size="small" 
                  onClick={() => handleChangeTimeRange('30d')}
                >
                  30D
                </Button>
              </Box>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom>Violation Report</Typography>
              {agent.violations ? (
                <Box>
                  <Typography variant="body2">
                    <strong>Violations:</strong> {agent.violations.violations}
                  </Typography>
                  <Typography variant="body2">
                    <strong>First Violation:</strong> {formatDateTime(agent.violations.firstViolation)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Last Violation:</strong> {formatDateTime(agent.violations.lastViolation)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Reset Time:</strong> {formatDateTime(agent.violations.nextResetTime)}
                  </Typography>
                </Box>
              ) : (
                <Alert severity="success">No violations reported</Alert>
              )}

              <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>Last Enforcement</Typography>
                {agent.lastEnforcement ? (
                  <Box>
                    <Typography variant="body2">
                      <strong>Action:</strong> {agent.lastEnforcement.action}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Time:</strong> {formatDateTime(agent.lastEnforcement.timestamp)}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Score:</strong> {(agent.lastEnforcement.score * 100).toFixed(1)}%
                    </Typography>
                    {agent.lastEnforcement.reason && (
                      <Typography variant="body2">
                        <strong>Reason:</strong> {agent.lastEnforcement.reason}
                      </Typography>
                    )}
                  </Box>
                ) : (
                  <Alert severity="info">No enforcement actions recorded</Alert>
                )}
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  };

  const renderEnforcementHistory = () => {
    // This would display a table of all enforcement actions across agents
    // Simplified for this example
    return (
      <Alert severity="info">
        Enforcement history view would display a historical record of all trust score enforcement actions
        across the system, including quarantines, slashes, and manual interventions.
      </Alert>
    );
  };

  const renderSystemOverview = () => {
    if (loading) return <CircularProgress />;
    if (error) return <Alert severity="error">{error}</Alert>;
    
    // Calculate metrics
    const totalAgents = agentData.length;
    const healthyAgents = agentData.filter(a => a.healthMode === 'normal').length;
    const quarantinedAgents = agentData.filter(a => a.healthMode === 'quarantined').length;
    const avgTrustScore = agentData.reduce((sum, agent) => sum + agent.trustScore, 0) / totalAgents;
    
    return (
      <Grid container spacing={3}>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Total Agents</Typography>
              <Typography variant="h4">{totalAgents}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Healthy Agents</Typography>
              <Typography variant="h4">
                {healthyAgents} ({((healthyAgents / totalAgents) * 100).toFixed(0)}%)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Quarantined Agents</Typography>
              <Typography variant="h4">
                {quarantinedAgents} ({((quarantinedAgents / totalAgents) * 100).toFixed(0)}%)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>Average Trust Score</Typography>
              <Typography variant="h4">{(avgTrustScore * 100).toFixed(1)}%</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    );
  };

  return (
    <div>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>Trust Score Metrics Dashboard</Typography>
        <Typography color="textSecondary">
          Monitor agent trust scores, violations, and enforcement actions across the system
        </Typography>
      </Box>
      
      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={handleChangeTab} variant="fullWidth">
          <Tab label="Trust Overview" />
          <Tab label="System Metrics" />
          <Tab label="Enforcement History" />
        </Tabs>
      </Paper>
      
      {tabValue === 0 && (
        <>
          {renderTrustScoreOverview()}
          {renderSelectedAgentDetails()}
        </>
      )}
      
      {tabValue === 1 && renderSystemOverview()}
      
      {tabValue === 2 && renderEnforcementHistory()}
    </div>
  );
};

export default TrustScoreMetricsDashboard; 