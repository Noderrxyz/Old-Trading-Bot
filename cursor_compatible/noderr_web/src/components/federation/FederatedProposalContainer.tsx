import React, { useState, useEffect } from 'react';
import { Box, Paper, Grid, Typography, CircularProgress } from '@mui/material';
import FederatedProposalList, { FederatedProposal } from './FederatedProposalList';
import FederatedProposalDetail from './FederatedProposalDetail';

// Extended interface for detailed proposal data
interface ProposalDetailData extends FederatedProposal {
  votes: Array<{
    id: string;
    voterId: string;
    voterName: string;
    clusterName: string;
    vote: 'approve' | 'reject';
    reason: string;
    timestamp: string;
  }>;
  comments: Array<{
    id: string;
    authorId: string;
    authorName: string;
    clusterName: string;
    content: string;
    timestamp: string;
  }>;
  events: Array<{
    id: string;
    type: 'created' | 'vote' | 'comment' | 'status_change';
    description: string;
    actorName?: string;
    clusterName?: string;
    timestamp: string;
  }>;
  fullDetails: string;
}

interface FederatedProposalContainerProps {
  federationId: string;
}

const FederatedProposalContainer: React.FC<FederatedProposalContainerProps> = ({ federationId }) => {
  const [proposals, setProposals] = useState<FederatedProposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ProposalDetailData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch list of proposals
  useEffect(() => {
    const fetchProposals = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // This would be a real API call in production
        // const response = await fetch(`/api/federations/${federationId}/proposals`);
        // const data = await response.json();
        
        // For demo, using mock data
        setTimeout(() => {
          setProposals(getMockProposals());
          setLoading(false);
        }, 800);
      } catch (err) {
        setError('Failed to load proposals. Please try again.');
        setLoading(false);
        console.error('Error fetching proposals:', err);
      }
    };

    fetchProposals();
  }, [federationId]);

  // Fetch detailed proposal data when a proposal is selected
  useEffect(() => {
    if (!selectedProposalId) {
      setSelectedProposal(null);
      return;
    }

    const fetchProposalDetail = async () => {
      setDetailLoading(true);
      
      try {
        // This would be a real API call in production
        // const response = await fetch(`/api/federations/${federationId}/proposals/${selectedProposalId}`);
        // const data = await response.json();
        
        // For demo, using mock data with a delay to simulate loading
        setTimeout(() => {
          const proposal = proposals.find(p => p.id === selectedProposalId);
          if (proposal) {
            setSelectedProposal(getMockProposalDetail(proposal));
          }
          setDetailLoading(false);
        }, 500);
      } catch (err) {
        setError('Failed to load proposal details. Please try again.');
        setDetailLoading(false);
        console.error('Error fetching proposal details:', err);
      }
    };

    fetchProposalDetail();
  }, [selectedProposalId, proposals, federationId]);

  const handleSelectProposal = (proposalId: string) => {
    setSelectedProposalId(proposalId);
  };

  const handleCloseDetail = () => {
    setSelectedProposalId(null);
  };

  const handleVote = async (proposalId: string, vote: 'approve' | 'reject', reason: string) => {
    // This would be a real API call in production
    // await fetch(`/api/federations/${federationId}/proposals/${proposalId}/vote`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({ vote, reason }),
    // });
    
    // For demo, just update the local state
    console.log(`Vote submitted: ${vote} on proposal ${proposalId} with reason: ${reason}`);
    
    // Simulate an API call delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Add the vote to the selected proposal
    if (selectedProposal) {
      const newVote = {
        id: `vote-${Date.now()}`,
        voterId: 'current_user_id', // This would come from auth context
        voterName: 'Current User',
        clusterName: 'Your Cluster',
        vote,
        reason,
        timestamp: new Date().toISOString()
      };
      
      // Update the selected proposal
      setSelectedProposal({
        ...selectedProposal,
        votes: [...selectedProposal.votes, newVote],
        votesReceived: selectedProposal.votesReceived + 1,
        events: [
          ...selectedProposal.events,
          {
            id: `event-${Date.now()}`,
            type: 'vote',
            description: `Vote ${vote}d by Current User`,
            actorName: 'Current User',
            clusterName: 'Your Cluster',
            timestamp: new Date().toISOString()
          }
        ]
      });
      
      // Also update the list of proposals
      setProposals(proposals.map(p => 
        p.id === proposalId 
          ? { ...p, votesReceived: p.votesReceived + 1 } 
          : p
      ));
    }
  };

  const handleComment = async (proposalId: string, content: string) => {
    // This would be a real API call in production
    // await fetch(`/api/federations/${federationId}/proposals/${proposalId}/comments`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({ content }),
    // });
    
    // For demo, just update the local state
    console.log(`Comment submitted on proposal ${proposalId}: ${content}`);
    
    // Simulate an API call delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Add the comment to the selected proposal
    if (selectedProposal) {
      const newComment = {
        id: `comment-${Date.now()}`,
        authorId: 'current_user_id', // This would come from auth context
        authorName: 'Current User',
        clusterName: 'Your Cluster',
        content,
        timestamp: new Date().toISOString()
      };
      
      setSelectedProposal({
        ...selectedProposal,
        comments: [...selectedProposal.comments, newComment],
        events: [
          ...selectedProposal.events,
          {
            id: `event-${Date.now()}`,
            type: 'comment',
            description: 'New comment added',
            actorName: 'Current User',
            clusterName: 'Your Cluster',
            timestamp: new Date().toISOString()
          }
        ]
      });
    }
  };

  // Render the container with either the list or the detail view
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {error && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.light', color: 'error.contrastText' }}>
          <Typography>{error}</Typography>
        </Paper>
      )}
      
      <Grid container spacing={2} sx={{ flexGrow: 1 }}>
        {selectedProposalId ? (
          // Detail view
          <Grid item xs={12}>
            {detailLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
                <CircularProgress />
              </Box>
            ) : (
              <FederatedProposalDetail
                proposalId={selectedProposalId}
                proposal={selectedProposal}
                onVote={handleVote}
                onComment={handleComment}
                onClose={handleCloseDetail}
              />
            )}
          </Grid>
        ) : (
          // List view
          <Grid item xs={12}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
                <CircularProgress />
              </Box>
            ) : (
              <FederatedProposalList 
                proposals={proposals} 
                onSelectProposal={handleSelectProposal} 
              />
            )}
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

// Mock data generation functions
function getMockProposals(): FederatedProposal[] {
  const statuses = ['open', 'approved', 'rejected', 'expired'];
  const categories = ['governance', 'parameter', 'network', 'agent', 'resource'];
  
  return Array.from({ length: 15 }, (_, i) => {
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - Math.floor(Math.random() * 30));
    
    const expiresAt = new Date(createdAt);
    expiresAt.setDate(expiresAt.getDate() + 14); // 14 days voting period
    
    const votesRequired = 10 + Math.floor(Math.random() * 10);
    const votesReceived = Math.floor(Math.random() * votesRequired);
    
    return {
      id: `proposal-${i + 1}`,
      title: `Proposal ${i + 1}: ${getProposalTitle(category)}`,
      description: `This is a ${category} proposal that aims to ${getProposalDescription(category)}`,
      status,
      category,
      proposer: {
        id: `cluster-${Math.floor(Math.random() * 5) + 1}`,
        name: `Cluster ${String.fromCharCode(65 + Math.floor(Math.random() * 5))}`,
        clusterName: `Region-${Math.floor(Math.random() * 3) + 1}`
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      votesRequired,
      votesReceived
    };
  });
}

function getProposalTitle(category: string): string {
  switch (category) {
    case 'governance':
      return ['Update voting threshold parameters', 'Add new oversight role', 'Modify federation charter'][Math.floor(Math.random() * 3)];
    case 'parameter':
      return ['Adjust trust score calculation weights', 'Modify consensus timeout values', 'Update resource allocation limits'][Math.floor(Math.random() * 3)];
    case 'network':
      return ['Add new node verification protocol', 'Update peer discovery mechanism', 'Implement enhanced routing algorithm'][Math.floor(Math.random() * 3)];
    case 'agent':
      return ['Deploy specialized data processing agents', 'Update agent credentialing requirements', 'Modify agent coordination protocols'][Math.floor(Math.random() * 3)];
    case 'resource':
      return ['Allocate additional computing resources', 'Update storage distribution policy', 'Modify bandwidth allocation strategy'][Math.floor(Math.random() * 3)];
    default:
      return 'Generic proposal title';
  }
}

function getProposalDescription(category: string): string {
  switch (category) {
    case 'governance':
      return 'improve the decision-making process within the federation by updating key governance parameters.';
    case 'parameter':
      return 'optimize system performance by fine-tuning critical operational parameters.';
    case 'network':
      return 'enhance network resilience and communication efficiency between federation members.';
    case 'agent':
      return 'improve agent capabilities and coordination mechanisms across the federation.';
    case 'resource':
      return 'optimize resource allocation and utilization across federation members.';
    default:
      return 'address various operational concerns within the federation.';
  }
}

function getMockProposalDetail(proposal: FederatedProposal): ProposalDetailData {
  // Generate random number of votes
  const voteCount = Math.min(proposal.votesReceived, 8);
  const votes = Array.from({ length: voteCount }, (_, i) => {
    const voteType = Math.random() > 0.3 ? 'approve' : 'reject';
    const timestamp = new Date(proposal.createdAt);
    timestamp.setHours(timestamp.getHours() + Math.floor(Math.random() * 24 * 7)); // Within a week
    
    return {
      id: `vote-${i}`,
      voterId: `voter-${i}`,
      voterName: `Voter ${String.fromCharCode(65 + i)}`,
      clusterName: `Cluster ${Math.floor(Math.random() * 5) + 1}`,
      vote: voteType,
      reason: voteType === 'approve' 
        ? ['I believe this will improve our operations.', 'This aligns with our strategic goals.', 'The benefits outweigh the costs.'][Math.floor(Math.random() * 3)]
        : ['This introduces unnecessary complexity.', 'The timing is not right for this change.', 'We need more information before proceeding.'][Math.floor(Math.random() * 3)],
      timestamp: timestamp.toISOString()
    };
  });

  // Generate random comments
  const commentCount = Math.floor(Math.random() * 5);
  const comments = Array.from({ length: commentCount }, (_, i) => {
    const timestamp = new Date(proposal.createdAt);
    timestamp.setHours(timestamp.getHours() + Math.floor(Math.random() * 24 * 10)); // Within 10 days
    
    return {
      id: `comment-${i}`,
      authorId: `author-${i}`,
      authorName: `Commenter ${String.fromCharCode(65 + i)}`,
      clusterName: `Cluster ${Math.floor(Math.random() * 5) + 1}`,
      content: [
        'I have some concerns about the implementation timeline.',
        'Have we considered the impact on existing operations?',
        'This looks promising, but we should monitor closely.',
        'I would recommend additional testing before full deployment.',
        'How does this align with our long-term strategy?'
      ][Math.floor(Math.random() * 5)],
      timestamp: timestamp.toISOString()
    };
  });

  // Generate history events
  const events = [
    {
      id: 'event-creation',
      type: 'created' as const,
      description: 'Proposal created',
      actorName: proposal.proposer.name,
      clusterName: proposal.proposer.clusterName,
      timestamp: proposal.createdAt
    }
  ];

  // Add vote events
  votes.forEach((vote, index) => {
    events.push({
      id: `event-vote-${index}`,
      type: 'vote' as const,
      description: `Vote ${vote.vote}d`,
      actorName: vote.voterName,
      clusterName: vote.clusterName,
      timestamp: vote.timestamp
    });
  });

  // Add comment events
  comments.forEach((comment, index) => {
    events.push({
      id: `event-comment-${index}`,
      type: 'comment' as const,
      description: 'Comment added',
      actorName: comment.authorName,
      clusterName: comment.clusterName,
      timestamp: comment.timestamp
    });
  });

  // Add status change event if not open
  if (proposal.status !== 'open') {
    const statusChangeDate = new Date(proposal.expiresAt);
    statusChangeDate.setDate(statusChangeDate.getDate() - Math.floor(Math.random() * 5)); // Random day before expiry
    
    events.push({
      id: 'event-status-change',
      type: 'status_change' as const,
      description: `Proposal ${proposal.status}`,
      timestamp: statusChangeDate.toISOString()
    });
  }

  // Sort events by timestamp
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Generate mock full details
  const fullDetails = `
{
  "id": "${proposal.id}",
  "title": "${proposal.title}",
  "type": "${proposal.category}",
  "status": "${proposal.status}",
  "created_at": "${proposal.createdAt}",
  "expires_at": "${proposal.expiresAt}",
  "proposer": {
    "id": "${proposal.proposer.id}",
    "name": "${proposal.proposer.name}",
    "cluster": "${proposal.proposer.clusterName}"
  },
  "parameters": {
    ${getMockParametersForCategory(proposal.category)}
  },
  "implementation": {
    "estimated_time": "${Math.floor(Math.random() * 14) + 7} days",
    "required_resources": "medium",
    "impact_level": "${['low', 'medium', 'high'][Math.floor(Math.random() * 3)]}"
  },
  "requirements": [
    "Federation member consensus",
    "Technical implementation team availability",
    "System update window"
  ]
}`.trim();

  return {
    ...proposal,
    votes,
    comments,
    events,
    fullDetails
  };
}

function getMockParametersForCategory(category: string): string {
  switch (category) {
    case 'governance':
      return `
    "voting_threshold": ${60 + Math.floor(Math.random() * 20)},
    "veto_power": ${Math.random() > 0.5 ? "true" : "false"},
    "decision_time_limit": "${Math.floor(Math.random() * 7) + 7} days"`;
    
    case 'parameter':
      return `
    "trust_weight": ${(Math.random() * 0.5 + 0.3).toFixed(2)},
    "performance_weight": ${(Math.random() * 0.3 + 0.2).toFixed(2)},
    "reliability_weight": ${(Math.random() * 0.3 + 0.2).toFixed(2)}`;
    
    case 'network':
      return `
    "connection_timeout": ${Math.floor(Math.random() * 30) + 30},
    "packet_size": ${Math.floor(Math.random() * 1000) + 1000},
    "retry_attempts": ${Math.floor(Math.random() * 5) + 3}`;
    
    case 'agent':
      return `
    "verification_level": "${['basic', 'enhanced', 'strict'][Math.floor(Math.random() * 3)]}",
    "autonomy_level": ${Math.floor(Math.random() * 5) + 1},
    "oversight_frequency": "${['hourly', 'daily', 'weekly'][Math.floor(Math.random() * 3)]}"`;
    
    case 'resource':
      return `
    "cpu_allocation": ${Math.floor(Math.random() * 20) + 10} + "%",
    "memory_allocation": "${Math.floor(Math.random() * 16) + 8}GB",
    "storage_quota": "${Math.floor(Math.random() * 500) + 100}GB"`;
    
    default:
      return `
    "generic_parameter_1": "${Math.random().toFixed(2)}",
    "generic_parameter_2": "${Math.floor(Math.random() * 100)}"`;
  }
}

export default FederatedProposalContainer; 