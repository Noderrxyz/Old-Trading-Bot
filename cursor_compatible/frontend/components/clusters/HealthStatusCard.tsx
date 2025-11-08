import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  CircularProgress,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  CheckCircleOutlined,
  WarningAmberOutlined,
  ErrorOutlined,
  ShowChartOutlined,
  PeopleOutlined,
  ScheduleOutlined,
} from '@mui/icons-material';
import { ClusterHealthMetrics, ClusterAnomaly } from '@/types/governance/health.types';

interface HealthStatusCardProps {
  healthMetrics: ClusterHealthMetrics | null;
  anomalies: ClusterAnomaly[];
}

export const HealthStatusCard: React.FC<HealthStatusCardProps> = ({
  healthMetrics,
  anomalies,
}) => {
  if (!healthMetrics) {
    return (
      <Card>
        <CardHeader title="Cluster Health" />
        <CardContent sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 3 }}>
          <CircularProgress />
        </CardContent>
      </Card>
    );
  }

  // Helper function to determine health status icon
  const getHealthIcon = (score: number) => {
    if (score >= 80) return <CheckCircleOutlined color="success" />;
    if (score >= 50) return <WarningAmberOutlined color="warning" />;
    return <ErrorOutlined color="error" />;
  };

  // Helper function to determine health status text
  const getHealthText = (score: number) => {
    if (score >= 80) return "Healthy";
    if (score >= 50) return "Warning";
    return "Critical";
  };

  // Helper function to determine health status color
  const getHealthColor = (score: number) => {
    if (score >= 80) return "success.main";
    if (score >= 50) return "warning.main";
    return "error.main";
  };

  // Get the top 3 anomalies that aren't resolved
  const topAnomalies = anomalies
    .filter(a => !a.resolved)
    .sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })
    .slice(0, 3);

  return (
    <Card>
      <CardHeader 
        title="Cluster Health" 
        action={
          <Chip 
            label={getHealthText(healthMetrics.healthScore)}
            color={healthMetrics.healthScore >= 80 ? "success" : 
                  healthMetrics.healthScore >= 50 ? "warning" : "error"}
            icon={getHealthIcon(healthMetrics.healthScore)}
            sx={{ fontWeight: 'bold' }}
          />
        }
      />
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress 
              variant="determinate" 
              value={healthMetrics.healthScore} 
              size={100}
              thickness={5}
              sx={{ color: getHealthColor(healthMetrics.healthScore) }}
            />
            <Box
              sx={{
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                position: 'absolute',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography
                variant="h5"
                component="div"
                color="text.secondary"
                fontWeight="bold"
              >
                {Math.round(healthMetrics.healthScore)}%
              </Typography>
            </Box>
          </Box>
        </Box>

        <List dense disablePadding>
          <ListItem>
            <ListItemIcon>
              <ShowChartOutlined color="primary" />
            </ListItemIcon>
            <ListItemText 
              primary="Participation"
              secondary={`${healthMetrics.averageParticipation.toFixed(1)}%`}
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <CheckCircleOutlined color="primary" />
            </ListItemIcon>
            <ListItemText 
              primary="Quorum Success"
              secondary={`${healthMetrics.quorumSuccessRate.toFixed(1)}%`}
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <PeopleOutlined color="primary" />
            </ListItemIcon>
            <ListItemText 
              primary="Agent Health"
              secondary={`${Object.values(healthMetrics.agentMetrics).reduce(
                (sum, agent) => sum + agent.healthScore, 0) / 
                Object.values(healthMetrics.agentMetrics).length
              }%`}
            />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <ScheduleOutlined color="primary" />
            </ListItemIcon>
            <ListItemText 
              primary="Resolution Time"
              secondary={`${Math.round(healthMetrics.averageTimeToResolution / (1000 * 60 * 60))} hours`}
            />
          </ListItem>
        </List>

        {topAnomalies.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" color="error" gutterBottom>
              Detected Issues
            </Typography>
            <List dense disablePadding>
              {topAnomalies.map((anomaly) => (
                <ListItem key={anomaly.id}>
                  <ListItemIcon>
                    {anomaly.severity === 'high' ? 
                      <ErrorOutlined color="error" /> : 
                      <WarningAmberOutlined color="warning" />
                    }
                  </ListItemIcon>
                  <ListItemText 
                    primary={anomaly.type.replace(/_/g, ' ')}
                    primaryTypographyProps={{
                      variant: 'body2',
                      style: { 
                        textTransform: 'capitalize',
                        fontWeight: anomaly.severity === 'high' ? 'bold' : 'normal'
                      }
                    }}
                    secondary={`${anomaly.severity} severity`}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default HealthStatusCard; 