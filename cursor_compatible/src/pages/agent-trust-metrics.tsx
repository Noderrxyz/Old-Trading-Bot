import React from 'react';
import { Container, Typography, Paper, Box } from '@mui/material';
import TrustScoreMetricsDashboard from '../components/TrustScoreMetricsDashboard';
import Head from 'next/head';

/**
 * Agent Trust Metrics Page
 * 
 * Displays a dashboard of trust metrics and analytics for all agents
 * in the system, allowing operators to monitor trust scores and violations.
 */
const AgentTrustMetricsPage: React.FC = () => {
  return (
    <>
      <Head>
        <title>Agent Trust Metrics | Noderr</title>
        <meta name="description" content="Monitor agent trust scores and violations across the Noderr system" />
      </Head>
      
      <Container maxWidth="xl">
        <Box sx={{ py: 3 }}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h4" gutterBottom>Agent Trust Metrics</Typography>
            <Typography variant="subtitle1" color="textSecondary">
              Monitor agent reputation, trust scores, violations, and enforcement actions
            </Typography>
          </Paper>
          
          <TrustScoreMetricsDashboard />
        </Box>
      </Container>
    </>
  );
};

export default AgentTrustMetricsPage; 