import React from 'react';
import { Box, Typography, Paper, Switch, FormControlLabel, useTheme } from '@mui/material';
import { styled } from '@mui/material/styles';
import { 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  ResponsiveContainer,
  Tooltip,
  Legend
} from 'recharts';
import type { FederatedProposal, FederatedVote } from './FederatedProposalList';

const GraphContainer = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(2),
}));

const SwitchContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: theme.spacing(1),
}));

const NoDataMessage = styled(Typography)(({ theme }) => ({
  padding: theme.spacing(4),
  textAlign: 'center',
  color: theme.palette.text.secondary,
}));

interface TrustWeightGraphProps {
  proposal: FederatedProposal | null;
}

const TrustWeightGraph: React.FC<TrustWeightGraphProps> = ({ proposal }) => {
  const theme = useTheme();
  const [showWeighted, setShowWeighted] = React.useState(true);
  
  if (!proposal || proposal.votes.length === 0) {
    return (
      <GraphContainer>
        <Typography variant="h6" gutterBottom>
          Trust Weight Analysis
        </Typography>
        <NoDataMessage>
          No vote data available to display
        </NoDataMessage>
      </GraphContainer>
    );
  }
  
  // Prepare data for the radar chart
  const prepareChartData = () => {
    // Group votes by type and calculate totals
    const votesByCluster = proposal.votes.reduce((acc, vote) => {
      const key = vote.cluster;
      
      if (!acc[key]) {
        acc[key] = {
          cluster: vote.cluster,
          rawImpact: 0,
          weightedImpact: 0,
          vote: vote.vote,
          trust: vote.trust,
        };
      }
      
      // For raw impact, each vote contributes 1
      acc[key].rawImpact = 1;
      
      // For weighted impact, scale by trust score (0-100)
      acc[key].weightedImpact = vote.trust / 100;
      
      return acc;
    }, {} as Record<string, any>);
    
    return Object.values(votesByCluster);
  };
  
  const chartData = prepareChartData();
  
  // Custom tooltip for the radar chart
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <Box 
          sx={{ 
            bgcolor: 'background.paper',
            p: 1.5,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            boxShadow: 1
          }}
        >
          <Typography variant="subtitle2">{data.cluster}</Typography>
          <Typography variant="body2">
            Vote: <strong>{data.vote}</strong>
          </Typography>
          <Typography variant="body2">
            Trust Score: <strong>{data.trust}</strong>
          </Typography>
          <Typography variant="body2">
            {showWeighted ? 'Weighted Impact' : 'Raw Impact'}: <strong>
              {showWeighted 
                ? `${(data.weightedImpact * 100).toFixed(0)}%` 
                : data.rawImpact}
            </strong>
          </Typography>
        </Box>
      );
    }
    return null;
  };
  
  // Calculate if there's a meta-agent veto
  const hasMetaAgentVeto = proposal.votes.some(
    vote => vote.cluster.includes('meta-agent') && vote.vote.toLowerCase() === 'reject'
  );
  
  return (
    <GraphContainer>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">
          Trust Weight Analysis
        </Typography>
        
        <SwitchContainer>
          <FormControlLabel
            control={
              <Switch
                checked={showWeighted}
                onChange={() => setShowWeighted(!showWeighted)}
                color="primary"
              />
            }
            label="Show Trust-Weighted Impact"
          />
        </SwitchContainer>
      </Box>
      
      {hasMetaAgentVeto && (
        <Box 
          sx={{ 
            p: 1, 
            mb: 2, 
            bgcolor: theme.palette.error.light,
            color: theme.palette.error.contrastText,
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Typography variant="subtitle2">
            ⚠️ Meta-Agent Veto Active
          </Typography>
        </Box>
      )}
      
      <Box sx={{ height: 350, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart outerRadius="80%" data={chartData}>
            <PolarGrid />
            <PolarAngleAxis 
              dataKey="cluster" 
              tick={{ fill: theme.palette.text.primary, fontSize: 12 }}
            />
            <PolarRadiusAxis 
              angle={30} 
              domain={[0, showWeighted ? 1 : 1]}
              tickFormatter={(value) => showWeighted ? `${(value * 100)}%` : value.toString()}
            />
            <Radar
              name={showWeighted ? "Trust-Weighted Impact" : "Raw Vote Impact"}
              dataKey={showWeighted ? "weightedImpact" : "rawImpact"}
              stroke={theme.palette.primary.main}
              fill={theme.palette.primary.main}
              fillOpacity={0.6}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </RadarChart>
        </ResponsiveContainer>
      </Box>
      
      <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
        {showWeighted 
          ? "This chart shows each cluster's vote impact weighted by its trust score." 
          : "This chart shows each cluster's vote with equal weight (unweighted)."}
      </Typography>
    </GraphContainer>
  );
};

export default TrustWeightGraph; 