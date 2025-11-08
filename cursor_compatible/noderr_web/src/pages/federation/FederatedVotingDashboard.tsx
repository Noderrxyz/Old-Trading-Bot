import React, { useEffect, useState } from 'react';
import { Box, Grid, Typography, Container, Paper, Divider, CircularProgress, Alert } from '@mui/material';
import { styled } from '@mui/material/styles';
import FederatedProposalList from '../../components/federation/FederatedProposalList';
import FederatedProposalDetail from '../../components/federation/FederatedProposalDetail';
import TrustWeightGraph from '../../components/federation/TrustWeightGraph';
import type { FederatedProposal } from '../../components/federation/FederatedProposalList';

const DashboardContainer = styled(Container)(({ theme }) => ({
  padding: theme.spacing(3),
  marginTop: theme.spacing(2),
  marginBottom: theme.spacing(4),
}));

const HeaderPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  marginBottom: theme.spacing(3),
  background: `linear-gradient(120deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
  color: theme.palette.primary.contrastText,
}));

const LoadingContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: theme.spacing(6),
  width: '100%',
}));

const FederatedVotingDashboard: React.FC = () => {
  const [proposals, setProposals] = useState<FederatedProposal[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<FederatedProposal | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnection, setWsConnection] = useState<WebSocket | null>(null);

  // Fetch initial proposals
  useEffect(() => {
    const fetchProposals = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/federation/proposals');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch proposals: ${response.statusText}`);
        }
        
        const data = await response.json();
        setProposals(data.proposals);
        
        // Set the first proposal as selected if any exist
        if (data.proposals.length > 0) {
          setSelectedProposal(data.proposals[0]);
        }
      } catch (err) {
        console.error('Error fetching federation proposals:', err);
        setError(err instanceof Error ? err.message : 'Failed to load federation proposals');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProposals();
  }, []);
  
  // Setup WebSocket connection for real-time updates
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/api/federation/updates`);
    
    ws.onopen = () => {
      console.log('Federation WebSocket connection established');
      setWsConnection(ws);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'VOTE_UPDATE') {
          // Update the proposals with new vote data
          setProposals(prevProposals => {
            const updatedProposals = [...prevProposals];
            const proposalIndex = updatedProposals.findIndex(p => p.id === data.payload.proposalId);
            
            if (proposalIndex !== -1) {
              // Update vote or add new vote
              const voteIndex = updatedProposals[proposalIndex].votes.findIndex(
                v => v.cluster === data.payload.vote.cluster
              );
              
              if (voteIndex !== -1) {
                updatedProposals[proposalIndex].votes[voteIndex] = data.payload.vote;
              } else {
                updatedProposals[proposalIndex].votes.push(data.payload.vote);
              }
              
              // Update status if provided
              if (data.payload.newStatus) {
                updatedProposals[proposalIndex].status = data.payload.newStatus;
              }
              
              // If this is the selected proposal, update it as well
              if (selectedProposal && selectedProposal.id === data.payload.proposalId) {
                setSelectedProposal(updatedProposals[proposalIndex]);
              }
            }
            
            return updatedProposals;
          });
        } else if (data.type === 'NEW_PROPOSAL') {
          // Add new proposal to the list
          setProposals(prevProposals => [data.payload.proposal, ...prevProposals]);
        } else if (data.type === 'PROPOSAL_STATUS_CHANGE') {
          // Update proposal status
          setProposals(prevProposals => {
            return prevProposals.map(p => 
              p.id === data.payload.proposalId 
                ? { ...p, status: data.payload.newStatus } 
                : p
            );
          });
          
          // Update selected proposal if needed
          if (selectedProposal && selectedProposal.id === data.payload.proposalId) {
            setSelectedProposal(prev => prev ? { ...prev, status: data.payload.newStatus } : null);
          }
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
      }
    };
    
    ws.onerror = (error) => {
      console.error('Federation WebSocket error:', error);
      setError('WebSocket connection error. Real-time updates may not work.');
    };
    
    ws.onclose = () => {
      console.log('Federation WebSocket connection closed');
      setWsConnection(null);
    };
    
    // Cleanup on unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [selectedProposal]);
  
  const handleProposalSelect = (proposal: FederatedProposal) => {
    setSelectedProposal(proposal);
  };
  
  if (loading) {
    return (
      <DashboardContainer>
        <HeaderPaper>
          <Typography variant="h4">Federated Voting Dashboard</Typography>
          <Typography variant="subtitle1">
            Monitor and manage cross-cluster governance proposals
          </Typography>
        </HeaderPaper>
        
        <LoadingContainer>
          <CircularProgress size={60} />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Loading Federation Data...
          </Typography>
        </LoadingContainer>
      </DashboardContainer>
    );
  }

  return (
    <DashboardContainer>
      <HeaderPaper>
        <Typography variant="h4">Federated Voting Dashboard</Typography>
        <Typography variant="subtitle1">
          Monitor and manage cross-cluster governance proposals
        </Typography>
        
        {wsConnection ? (
          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center' }}>
            <Box 
              sx={{ 
                width: 10, 
                height: 10, 
                borderRadius: '50%', 
                bgcolor: 'success.main', 
                mr: 1 
              }} 
            />
            <Typography variant="body2">Real-time updates active</Typography>
          </Box>
        ) : (
          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center' }}>
            <Box 
              sx={{ 
                width: 10, 
                height: 10, 
                borderRadius: '50%', 
                bgcolor: 'error.main', 
                mr: 1 
              }} 
            />
            <Typography variant="body2">Real-time updates unavailable</Typography>
          </Box>
        )}
      </HeaderPaper>
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      
      <Grid container spacing={3}>
        <Grid item xs={12} md={5} lg={4}>
          <FederatedProposalList 
            proposals={proposals} 
            onSelectProposal={handleProposalSelect}
            selectedProposalId={selectedProposal?.id}
          />
        </Grid>
        
        <Grid item xs={12} md={7} lg={8}>
          {selectedProposal ? (
            <>
              <FederatedProposalDetail proposal={selectedProposal} />
              <Divider sx={{ my: 2 }} />
              <TrustWeightGraph proposal={selectedProposal} />
            </>
          ) : (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h6" color="text.secondary" sx={{ my: 2 }}>
                Select a proposal to view details
              </Typography>
            </Paper>
          )}
        </Grid>
      </Grid>
    </DashboardContainer>
  );
};

export default FederatedVotingDashboard; 