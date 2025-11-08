import React from 'react';
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  Grid,
  Chip,
  Tooltip,
  Card,
  CardContent,
} from '@mui/material';
import {
  CheckCircleOutline,
  CancelOutlined,
  AccessTimeOutlined,
} from '@mui/icons-material';
import { ClusterConsensusState } from '@/types/governance/cluster.types';
import { ClusterProposalSummary } from '@/types/governance/proposal.types';

interface QuorumTrackerProps {
  proposals: ClusterProposalSummary[];
  consensusState: ClusterConsensusState;
  quorumThreshold: number;
}

export const QuorumTracker: React.FC<QuorumTrackerProps> = ({
  proposals,
  consensusState,
  quorumThreshold,
}) => {
  if (!proposals || proposals.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          No active proposals
        </Typography>
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {proposals.map((proposal) => {
        // Calculate vote stats
        const totalVotes = proposal.votes.length;
        const yesVotes = proposal.votes.filter(v => v.vote === 'yes').length;
        const noVotes = proposal.votes.filter(v => v.vote === 'no').length;
        const abstainVotes = proposal.votes.filter(v => v.vote === 'abstain').length;
        
        // Calculate weighted votes if vote weights are available
        const totalWeight = proposal.votes.reduce((sum, vote) => sum + (vote.weight || 1), 0);
        const yesWeight = proposal.votes
          .filter(v => v.vote === 'yes')
          .reduce((sum, vote) => sum + (vote.weight || 1), 0);
        
        // Calculate percentages
        const yesPercentage = totalWeight > 0 ? (yesWeight / totalWeight) * 100 : 0;
        const quorumReached = consensusState.quorumStatus[proposal.id] || false;
        
        // Time remaining calculation
        const now = Date.now();
        const endTime = proposal.createdAt + (proposal.votingPeriod || 48 * 60 * 60 * 1000); // Default 48h
        const timeRemaining = endTime - now;
        const hoursRemaining = Math.max(0, Math.floor(timeRemaining / (1000 * 60 * 60)));
        const minutesRemaining = Math.max(0, Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)));
        
        return (
          <Grid item xs={12} key={proposal.id}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold" noWrap sx={{ maxWidth: '60%' }}>
                    {proposal.title}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {quorumReached ? (
                      <Chip 
                        icon={<CheckCircleOutline />} 
                        label="Quorum Reached" 
                        color="success" 
                        size="small"
                      />
                    ) : (
                      <Chip 
                        icon={<AccessTimeOutlined />} 
                        label="Quorum Pending" 
                        color="warning" 
                        size="small"
                      />
                    )}
                    <Tooltip title={`${hoursRemaining}h ${minutesRemaining}m remaining`}>
                      <Chip 
                        icon={<AccessTimeOutlined />}
                        label={`${hoursRemaining}h remaining`}
                        variant="outlined"
                        size="small"
                      />
                    </Tooltip>
                  </Box>
                </Box>
                
                <Box sx={{ mb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2">Quorum Progress</Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {yesPercentage.toFixed(1)}% / {quorumThreshold}% required
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min(100, (yesPercentage / quorumThreshold) * 100)}
                    color={quorumReached ? "success" : "primary"}
                    sx={{ height: 10, borderRadius: 5 }}
                  />
                </Box>
                
                <Grid container spacing={1} sx={{ mt: 1 }}>
                  <Grid item xs={4}>
                    <Tooltip title="Yes Votes">
                      <Paper 
                        sx={{ 
                          p: 1, 
                          bgcolor: 'success.light', 
                          color: 'success.contrastText',
                          textAlign: 'center'
                        }}
                      >
                        <Typography variant="body2">Yes: {yesVotes}</Typography>
                      </Paper>
                    </Tooltip>
                  </Grid>
                  <Grid item xs={4}>
                    <Tooltip title="No Votes">
                      <Paper 
                        sx={{ 
                          p: 1, 
                          bgcolor: 'error.light', 
                          color: 'error.contrastText',
                          textAlign: 'center'
                        }}
                      >
                        <Typography variant="body2">No: {noVotes}</Typography>
                      </Paper>
                    </Tooltip>
                  </Grid>
                  <Grid item xs={4}>
                    <Tooltip title="Abstain Votes">
                      <Paper 
                        sx={{ 
                          p: 1, 
                          bgcolor: 'grey.300', 
                          textAlign: 'center'
                        }}
                      >
                        <Typography variant="body2">Abstain: {abstainVotes}</Typography>
                      </Paper>
                    </Tooltip>
                  </Grid>
                </Grid>
                
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    {totalVotes} votes cast
                    {proposal.totalEligibleVoters && (
                      ` (${((totalVotes / proposal.totalEligibleVoters) * 100).toFixed(1)}% participation)`
                    )}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
};

export default QuorumTracker; 