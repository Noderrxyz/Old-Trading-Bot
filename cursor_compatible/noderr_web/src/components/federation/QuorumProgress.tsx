import React, { useState } from 'react';
import { Box, LinearProgress, Typography, Tooltip, Paper } from '@mui/material';
import { styled } from '@mui/material/styles';

const ProgressContainer = styled(Box)(({ theme }) => ({
  marginBottom: theme.spacing(2),
}));

const ProgressBarWrapper = styled(Box)(({ theme }) => ({
  position: 'relative',
  height: 25,
  width: '100%',
  borderRadius: theme.shape.borderRadius,
  overflow: 'hidden',
}));

const QuorumIndicator = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'position',
})<{ position: number }>(({ theme, position }) => ({
  position: 'absolute',
  height: '100%',
  width: 3,
  backgroundColor: theme.palette.warning.dark,
  left: `${position}%`,
  top: 0,
  zIndex: 2,
  '&::after': {
    content: '""',
    position: 'absolute',
    left: -5,
    top: -5,
    width: 13,
    height: 13,
    borderRadius: '50%',
    backgroundColor: theme.palette.warning.dark,
  },
}));

const ProgressLabel = styled(Typography)(({ theme }) => ({
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.palette.getContrastText(theme.palette.primary.main),
  fontWeight: 'bold',
  zIndex: 1,
}));

const VoteBreakdown = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  marginTop: theme.spacing(1),
}));

const VoteTypeIndicator = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'color',
})<{ color: string }>(({ theme, color }) => ({
  display: 'inline-block',
  width: 12,
  height: 12,
  backgroundColor: color,
  marginRight: theme.spacing(1),
  borderRadius: theme.shape.borderRadius,
}));

interface QuorumProgressProps {
  totalClusters: number;
  votedCount: number;
  requiredPercentage: number;
  votesByType: Record<string, number>;
}

const QuorumProgress: React.FC<QuorumProgressProps> = ({
  totalClusters,
  votedCount,
  requiredPercentage,
  votesByType,
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  
  // Calculate percentages
  const votedPercentage = (votedCount / totalClusters) * 100;
  const quorumPosition = requiredPercentage * 100;
  
  // Color mapping for vote types
  const voteTypeColors = {
    approve: '#4caf50', // green
    reject: '#f44336', // red
    abstain: '#9e9e9e', // grey
  };
  
  // Helper function to calculate voting breakdown
  const calculateSegments = () => {
    const segments = [];
    let currentPosition = 0;
    
    Object.entries(votesByType).forEach(([type, count]) => {
      const percentage = (count / totalClusters) * 100;
      
      if (percentage > 0) {
        segments.push({
          type,
          position: currentPosition,
          width: percentage,
          color: voteTypeColors[type as keyof typeof voteTypeColors] || '#2196f3',
        });
        
        currentPosition += percentage;
      }
    });
    
    return segments;
  };
  
  const segments = calculateSegments();
  
  // Generate tooltip content
  const tooltipContent = (
    <Box sx={{ p: 1, maxWidth: 200 }}>
      <Typography variant="subtitle2" gutterBottom>
        Quorum Progress
      </Typography>
      <Typography variant="body2">
        {votedCount} of {totalClusters} clusters have voted ({Math.round(votedPercentage)}%)
      </Typography>
      <Typography variant="body2">
        Required: {Math.round(quorumPosition)}% for quorum
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        Click for vote breakdown
      </Typography>
    </Box>
  );
  
  return (
    <ProgressContainer>
      <Tooltip title={tooltipContent} arrow>
        <ProgressBarWrapper onClick={() => setShowBreakdown(!showBreakdown)}>
          {segments.map((segment, index) => (
            <Box
              key={index}
              sx={{
                position: 'absolute',
                left: `${segment.position}%`,
                width: `${segment.width}%`,
                height: '100%',
                backgroundColor: segment.color,
                zIndex: 0,
              }}
            />
          ))}
          
          <QuorumIndicator position={quorumPosition} />
          
          <ProgressLabel variant="body2">
            {Math.round(votedPercentage)}% of {Math.round(quorumPosition)}% needed
          </ProgressLabel>
        </ProgressBarWrapper>
      </Tooltip>
      
      {showBreakdown && (
        <VoteBreakdown elevation={1}>
          <Typography variant="subtitle2" gutterBottom>
            Vote Breakdown
          </Typography>
          
          {Object.entries(votesByType).map(([type, count]) => (
            <Box key={type} sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <VoteTypeIndicator 
                color={voteTypeColors[type as keyof typeof voteTypeColors] || '#2196f3'} 
              />
              <Typography variant="body2">
                {type}: {count} ({Math.round((count / totalClusters) * 100)}%)
              </Typography>
            </Box>
          ))}
          
          {votedCount < totalClusters && (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <VoteTypeIndicator color="#e0e0e0" />
              <Typography variant="body2">
                Not Voted: {totalClusters - votedCount} ({Math.round(((totalClusters - votedCount) / totalClusters) * 100)}%)
              </Typography>
            </Box>
          )}
        </VoteBreakdown>
      )}
    </ProgressContainer>
  );
};

export default QuorumProgress; 