import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Tab,
  Tabs,
  Typography,
  Paper,
  Grid,
  Chip,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Divider,
  CircularProgress,
  LinearProgress,
  Card,
  CardContent,
  CardHeader,
} from '@mui/material';
import {
  PersonOutline,
  CheckCircleOutline,
  CancelOutlined,
  WarningAmberOutlined,
  AssignmentOutlined,
  GroupOutlined,
  DashboardOutlined,
  HistoryOutlined,
  TrendingUpOutlined,
} from '@mui/icons-material';
import { useRouter } from 'next/router';
import { GovernanceCluster, AgentRef, ClusterConsensusState } from '@/types/governance/cluster.types';
import { ClusterAnomaly, ClusterHealthMetrics } from '@/types/governance/health.types';
import { ClusterProposalSummary } from '@/types/governance/proposal.types';
import { VoteGraph } from './VoteGraph';
import { ProposalList } from './ProposalList';
import { AgentList } from './AgentList';
import { QuorumTracker } from './QuorumTracker';
import { HealthStatusCard } from './HealthStatusCard';
import { ClusterScopeTag } from './ClusterScopeTag';

interface ClusterControlPanelProps {
  clusterId: string;
}

const ClusterControlPanel: React.FC<ClusterControlPanelProps> = ({ clusterId }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [cluster, setCluster] = useState<GovernanceCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<ClusterProposalSummary[]>([]);
  const [consensusState, setConsensusState] = useState<ClusterConsensusState | null>(null);
  const [healthMetrics, setHealthMetrics] = useState<ClusterHealthMetrics | null>(null);
  const [anomalies, setAnomalies] = useState<ClusterAnomaly[]>([]);
  const router = useRouter();

  useEffect(() => {
    const fetchClusterData = async () => {
      setLoading(true);
      try {
        // Fetch cluster details
        const clusterResponse = await fetch(`/api/governance/clusters/${clusterId}`);
        const clusterData = await clusterResponse.json();
        setCluster(clusterData);

        // Fetch cluster proposals
        const proposalsResponse = await fetch(`/api/governance/clusters/${clusterId}/proposals`);
        const proposalsData = await proposalsResponse.json();
        setProposals(proposalsData);

        // Fetch consensus state
        const consensusResponse = await fetch(`/api/governance/clusters/${clusterId}/consensus`);
        const consensusData = await consensusResponse.json();
        setConsensusState(consensusData);

        // Fetch health metrics
        const healthResponse = await fetch(`/api/governance/clusters/${clusterId}/health`);
        const healthData = await healthResponse.json();
        setHealthMetrics(healthData);

        // Fetch anomalies
        const anomaliesResponse = await fetch(`/api/governance/clusters/${clusterId}/anomalies`);
        const anomaliesData = await anomaliesResponse.json();
        setAnomalies(anomaliesData);
      } catch (error) {
        console.error('Error fetching cluster data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (clusterId) {
      fetchClusterData();
    }
  }, [clusterId]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const renderTabContent = () => {
    if (loading || !cluster) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      );
    }

    switch (activeTab) {
      case 0: // Overview
        return renderOverview();
      case 1: // Proposals
        return (
          <ProposalList 
            proposals={proposals} 
            clusterId={clusterId} 
            consensusState={consensusState}
          />
        );
      case 2: // Members
        return (
          <AgentList 
            agents={cluster.agents} 
            clusterId={clusterId}
            healthMetrics={healthMetrics}
          />
        );
      case 3: // Votes
        return (
          <Box sx={{ mt: 2 }}>
            <VoteGraph 
              proposals={proposals} 
              agents={cluster.agents}
              clusterId={clusterId}
            />
          </Box>
        );
      case 4: // Health
        return renderHealthTab();
      default:
        return null;
    }
  };

  const renderOverview = () => {
    if (!cluster || !consensusState) return null;

    return (
      <Box sx={{ mt: 2 }}>
        <Grid container spacing={3}>
          {/* Cluster Info Card */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardHeader 
                title="Cluster Information"
                subheader={`Created ${new Date(cluster.genesisAt).toLocaleDateString()}`}
              />
              <CardContent>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>ID:</strong> {cluster.id}
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>Scope:</strong> <ClusterScopeTag scope={cluster.scope} />
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>Decision Protocol:</strong> {cluster.decisionProtocol}
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>Quorum Threshold:</strong> {cluster.quorumThreshold}%
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>Active Agents:</strong> {cluster.agents.filter(a => a.status === 'active').length}
                </Typography>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <strong>Active Proposals:</strong> {consensusState.activeProposals}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Health Status Card */}
          <Grid item xs={12} md={6}>
            <HealthStatusCard healthMetrics={healthMetrics} anomalies={anomalies} />
          </Grid>

          {/* Quorum Tracker */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Live Quorum Tracker</Typography>
              {proposals.length > 0 ? (
                <QuorumTracker 
                  proposals={proposals.filter(p => p.status === 'active')} 
                  consensusState={consensusState}
                  quorumThreshold={cluster.quorumThreshold}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No active proposals to track
                </Typography>
              )}
            </Paper>
          </Grid>

          {/* Quick Links */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Quick Actions</Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button 
                  variant="outlined" 
                  startIcon={<AssignmentOutlined />}
                  onClick={() => router.push(`/governance/clusters/${clusterId}/proposals/new`)}
                >
                  Create Proposal
                </Button>
                <Button 
                  variant="outlined" 
                  startIcon={<GroupOutlined />}
                  onClick={() => router.push(`/governance/clusters/${clusterId}/agents/invite`)}
                >
                  Invite Agent
                </Button>
                <Button 
                  variant="outlined" 
                  startIcon={<DashboardOutlined />}
                  onClick={() => router.push(`/governance/clusters/${clusterId}/settings`)}
                >
                  Cluster Settings
                </Button>
                <Button 
                  variant="outlined" 
                  startIcon={<HistoryOutlined />}
                  onClick={() => router.push(`/governance/clusters/${clusterId}/history`)}
                >
                  View History
                </Button>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Box>
    );
  };

  const renderHealthTab = () => {
    if (!healthMetrics) return null;

    return (
      <Box sx={{ mt: 2 }}>
        <Grid container spacing={3}>
          {/* Health Metrics */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardHeader title="Cluster Health Metrics" />
              <CardContent>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Overall Health Score
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                    <Box sx={{ width: '100%', mr: 1 }}>
                      <LinearProgress 
                        variant="determinate" 
                        value={healthMetrics.healthScore} 
                        color={healthMetrics.healthScore > 75 ? 'success' : 
                               healthMetrics.healthScore > 50 ? 'warning' : 'error'}
                        sx={{ height: 10, borderRadius: 5 }}
                      />
                    </Box>
                    <Box sx={{ minWidth: 35 }}>
                      <Typography variant="body2" color="text.secondary">
                        {Math.round(healthMetrics.healthScore)}%
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                <Typography variant="body2" sx={{ mt: 2 }}>
                  <strong>Average Participation:</strong> {healthMetrics.averageParticipation.toFixed(1)}%
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>Quorum Success Rate:</strong> {healthMetrics.quorumSuccessRate.toFixed(1)}%
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>Avg. Time to Resolution:</strong> {Math.round(healthMetrics.averageTimeToResolution / (1000 * 60 * 60))} hours
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>Total Proposals:</strong> {healthMetrics.proposalCount}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>Active Proposals:</strong> {healthMetrics.activeProposals}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>Completed Proposals:</strong> {healthMetrics.completedProposals}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>Failed Proposals:</strong> {healthMetrics.failedProposals}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Anomalies */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardHeader 
                title="Detected Anomalies" 
                subheader={`${anomalies.filter(a => !a.resolved).length} active issues`}
              />
              <CardContent>
                {anomalies.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No anomalies detected
                  </Typography>
                ) : (
                  <List>
                    {anomalies.slice(0, 5).map((anomaly) => (
                      <ListItem 
                        key={anomaly.id}
                        secondaryAction={
                          anomaly.resolved ? (
                            <Chip 
                              label="Resolved" 
                              color="success" 
                              size="small" 
                            />
                          ) : (
                            <Chip 
                              label={anomaly.severity} 
                              color={
                                anomaly.severity === 'high' ? 'error' : 
                                anomaly.severity === 'medium' ? 'warning' : 'info'
                              }
                              size="small"
                            />
                          )
                        }
                      >
                        <ListItemAvatar>
                          <Avatar sx={{ bgcolor: 
                            anomaly.severity === 'high' ? 'error.main' : 
                            anomaly.severity === 'medium' ? 'warning.main' : 'info.main' 
                          }}>
                            <WarningAmberOutlined />
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={anomaly.type.replace(/_/g, ' ')}
                          secondary={`Detected ${new Date(anomaly.timestamp).toLocaleDateString()}`}
                        />
                      </ListItem>
                    ))}
                    {anomalies.length > 5 && (
                      <Button 
                        fullWidth 
                        sx={{ mt: 1 }}
                        onClick={() => router.push(`/governance/clusters/${clusterId}/anomalies`)}
                      >
                        View all {anomalies.length} anomalies
                      </Button>
                    )}
                  </List>
                )}
              </CardContent>
            </Card>
          </Grid>
          
          {/* Agent Performance */}
          <Grid item xs={12}>
            <Card>
              <CardHeader title="Agent Performance" />
              <CardContent>
                <Grid container spacing={2}>
                  {Object.entries(healthMetrics.agentMetrics)
                    .sort((a, b) => b[1].healthScore - a[1].healthScore)
                    .slice(0, 5)
                    .map(([agentDid, metrics]) => (
                      <Grid item xs={12} sm={6} md={4} key={agentDid}>
                        <Paper sx={{ p: 2 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                            <Avatar sx={{ mr: 1 }}>
                              <PersonOutline />
                            </Avatar>
                            <Typography variant="subtitle1" noWrap>
                              {agentDid.substring(0, 8)}...{agentDid.substring(agentDid.length - 4)}
                            </Typography>
                          </Box>
                          <Divider sx={{ my: 1 }} />
                          <Typography variant="body2">
                            Health Score: {metrics.healthScore.toFixed(1)}%
                          </Typography>
                          <Typography variant="body2">
                            Participation: {metrics.participationRate.toFixed(1)}%
                          </Typography>
                          <Typography variant="body2">
                            Consensus Alignment: {metrics.consensusAlignment.toFixed(1)}%
                          </Typography>
                          <Typography variant="body2">
                            Votes Cast: {metrics.voteCount}
                          </Typography>
                        </Paper>
                      </Grid>
                    ))}
                </Grid>
                <Button 
                  fullWidth 
                  sx={{ mt: 2 }}
                  onClick={() => setActiveTab(2)} // Go to Members tab
                >
                  View All Agent Metrics
                </Button>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    );
  };

  if (loading && !cluster) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            {cluster?.name}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ClusterScopeTag scope={cluster?.scope || 'infra'} />
            <Chip 
              label={`${cluster?.agents.length || 0} members`} 
              icon={<PersonOutline />} 
              variant="outlined" 
              size="small"
            />
            <Chip 
              label={consensusState?.activeProposals || 0} 
              icon={<AssignmentOutlined />} 
              variant="outlined" 
              size="small"
            />
            <Chip 
              label={`${healthMetrics?.healthScore.toFixed(0) || '?'}% health`}
              icon={<TrendingUpOutlined />}
              variant="outlined"
              size="small"
              color={
                (healthMetrics?.healthScore || 0) > 75 ? 'success' : 
                (healthMetrics?.healthScore || 0) > 50 ? 'warning' : 'error'
              }
            />
          </Box>
        </Box>
        <Button 
          variant="contained" 
          color="primary"
          onClick={() => router.push(`/governance/clusters/${clusterId}/proposals/new`)}
        >
          New Proposal
        </Button>
      </Box>

      <Paper sx={{ width: '100%', mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="fullWidth"
        >
          <Tab label="Overview" />
          <Tab label="Proposals" />
          <Tab label="Members" />
          <Tab label="Vote Graph" />
          <Tab label="Health" />
        </Tabs>
        <Box sx={{ p: 3 }}>
          {renderTabContent()}
        </Box>
      </Paper>
    </Container>
  );
};

export default ClusterControlPanel; 