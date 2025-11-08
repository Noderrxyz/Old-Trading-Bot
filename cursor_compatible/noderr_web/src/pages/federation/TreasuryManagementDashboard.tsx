import React, { useEffect } from 'react';
import { Container, Grid, Typography, Paper, Box, Divider } from '@mui/material';
import { styled } from '@mui/material/styles';
import ClusterTreasuryOverview from '../../components/federation/ClusterTreasuryOverview';
import SlashingEventFeed from '../../components/federation/SlashingEventFeed';
import { TreasuryBalancer } from '../../services/TreasuryBalancer';
import { SlashingEngine } from '../../services/SlashingEngine';
import { WebSocketService } from '../../services/WebSocketService';

const HeaderPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  marginBottom: theme.spacing(3),
  background: `linear-gradient(120deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
  color: theme.palette.primary.contrastText,
}));

const SectionHeader = styled(Typography)(({ theme }) => ({
  marginBottom: theme.spacing(2),
  fontWeight: 500,
}));

const TreasuryManagementDashboard: React.FC = () => {
  // Initialize services on component mount
  useEffect(() => {
    // Connect WebSocket service
    const wsService = WebSocketService.getInstance();
    wsService.connect();
    
    // In a real app, we might initialize the services based on user settings
    // For now, we'll just initialize them but not start the automated functions
    
    // Initialize TreasuryBalancer
    const treasuryBalancer = TreasuryBalancer.getInstance();
    
    // Initialize SlashingEngine
    const slashingEngine = SlashingEngine.getInstance();
    
    // Cleanup on unmount
    return () => {
      wsService.disconnect();
    };
  }, []);
  
  const handleManualRebalance = () => {
    // This could show a confirmation dialog or track the rebalance operation
    console.log('Manual treasury rebalance initiated');
  };
  
  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <HeaderPaper>
        <Typography variant="h4">Federation Treasury Management</Typography>
        <Typography variant="subtitle1">
          Monitor treasury balances, automate rebalancing, and track slashing events
        </Typography>
      </HeaderPaper>
      
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <ClusterTreasuryOverview onManualRebalance={handleManualRebalance} />
        </Grid>
        
        <Grid item xs={12}>
          <Box p={2} pt={3}>
            <SectionHeader variant="h5">Treasury Activity</SectionHeader>
            <Divider sx={{ mb: 3 }} />
          </Box>
        </Grid>
        
        <Grid item xs={12} md={7}>
          <SlashingEventFeed maxEvents={10} />
        </Grid>
        
        <Grid item xs={12} md={5}>
          <Paper elevation={3} sx={{ p: 2, height: '100%' }}>
            <Typography variant="h5" component="h2" gutterBottom>
              Treasury Statistics
            </Typography>
            
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                This panel will display treasury statistics, including:
              </Typography>
              <ul style={{ textAlign: 'left' }}>
                <li>Total federation treasury balance</li>
                <li>Historical balance trends</li>
                <li>Rebalance history</li>
                <li>Slashing activity statistics</li>
                <li>Trust-weighted treasury allocation</li>
              </ul>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Statistics module will be implemented in the next phase.
              </Typography>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default TreasuryManagementDashboard; 