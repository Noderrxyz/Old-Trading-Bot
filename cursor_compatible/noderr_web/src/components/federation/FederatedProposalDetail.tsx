import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Box,
  Grid,
  Chip,
  Button,
  Divider,
  TextField,
  IconButton,
  Avatar,
  Card,
  CardContent,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  LinearProgress,
  Tooltip,
  Stack,
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineOppositeContent
} from '@mui/material';
import { styled } from '@mui/material/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HistoryIcon from '@mui/icons-material/History';
import CommentIcon from '@mui/icons-material/Comment';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import { FederatedProposal } from './FederatedProposalList';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PendingIcon from '@mui/icons-material/Pending';
import EventIcon from '@mui/icons-material/Event';
import PersonIcon from '@mui/icons-material/Person';
import EditIcon from '@mui/icons-material/Edit';
import SendIcon from '@mui/icons-material/Send';

interface FederatedVote {
  id: string;
  voterId: string;
  voterName: string;
  clusterName: string;
  vote: 'approve' | 'reject';
  reason: string;
  timestamp: string;
}

interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  clusterName: string;
  content: string;
  timestamp: string;
}

interface ProposalEvent {
  id: string;
  type: 'created' | 'modified' | 'vote_submitted' | 'comment_added' | 'status_changed';
  timestamp: string;
  actorId: string;
  actorName: string;
  details: string;
}

interface ResolutionOption {
  id: string;
  description: string;
  impact: string;
  votes: number;
}

interface ProposalConflict {
  id: string;
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  affectedClusters: string[];
  resolutionOptions: ResolutionOption[];
  status: 'identified' | 'in_review' | 'resolved';
}

interface ProposalDetailData extends FederatedProposal {
  id: string;
  title: string;
  description: string;
  category: 'parameter' | 'governance' | 'resource' | 'security';
  status: 'draft' | 'active' | 'passed' | 'rejected' | 'expired';
  proposedBy: string;
  proposedAt: string;
  deadline: string;
  fullDetails: string;
  requiredMajority: number;
  votes: FederatedVote[];
  comments: Comment[];
  events: ProposalEvent[];
  conflicts?: ProposalConflict[];
}

interface FederatedProposalDetailProps {
  proposalId: string | null;
  proposal: ProposalDetailData | null;
  onVote: (proposalId: string, vote: 'approve' | 'reject', reason: string) => Promise<void>;
  onComment: (proposalId: string, comment: string) => Promise<void>;
  onClose: () => void;
}

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
}));

const HeaderBox = styled(Box)(({ theme }) => ({
  marginBottom: theme.spacing(3),
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center'
}));

const StatusChip = styled(Chip)<{ status: string }>(({ theme, status }) => {
  let color;
  switch (status) {
    case 'approved':
      color = theme.palette.success.main;
      break;
    case 'rejected':
      color = theme.palette.error.main;
      break;
    case 'expired':
      color = theme.palette.text.disabled;
      break;
    default:
      color = theme.palette.primary.main;
  }
  
  return {
    backgroundColor: color,
    color: theme.palette.getContrastText(color),
    fontWeight: 500,
    textTransform: 'capitalize'
  };
});

const CategoryChip = styled(Chip)<{ category: string }>(({ theme, category }) => {
  let color;
  switch (category) {
    case 'parameter':
      color = theme.palette.info.light;
      break;
    case 'governance':
      color = theme.palette.warning.light;
      break;
    case 'network':
      color = theme.palette.success.light;
      break;
    case 'agent':
      color = theme.palette.secondary.light;
      break;
    case 'resource':
      color = theme.palette.error.light;
      break;
    default:
      color = theme.palette.grey[500];
  }
  
  return {
    backgroundColor: color,
    color: theme.palette.getContrastText(color),
    textTransform: 'capitalize'
  };
});

const ScrollableBox = styled(Box)(({ theme }) => ({
  overflowY: 'auto',
  flexGrow: 1,
  padding: theme.spacing(1)
}));

const CommentBox = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(2),
  display: 'flex',
  gap: theme.spacing(1)
}));

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getProgressColor(percent: number): string {
  if (percent < 33) return '#f44336'; // red
  if (percent < 66) return '#ff9800'; // orange
  return '#4caf50'; // green
}

const mockConflicts: ProposalConflict[] = [
  {
    id: "conflict-1",
    type: "governance",
    description: "This proposal conflicts with the existing governance structure in clusters Alpha and Beta. The parameter changes would create inconsistent validation rules.",
    severity: "high",
    affectedClusters: ["Alpha Cluster", "Beta Cluster"],
    resolutionOptions: [
      {
        id: "option-1",
        description: "Modify proposal to align with existing governance structure",
        impact: "Minimal disruption but reduces proposal effectiveness by 15%",
        votes: 7
      },
      {
        id: "option-2",
        description: "Update governance structure in affected clusters",
        impact: "Requires consensus from 75% of cluster nodes",
        votes: 12
      },
      {
        id: "option-3",
        description: "Create exception handler for affected clusters",
        impact: "Increases system complexity but preserves autonomy",
        votes: 5
      }
    ],
    status: "in_review"
  },
  {
    id: "conflict-2",
    type: "resource",
    description: "Resource allocation conflicts detected with Gamma Cluster's current processing capacity.",
    severity: "medium",
    affectedClusters: ["Gamma Cluster"],
    resolutionOptions: [
      {
        id: "option-4",
        description: "Scale Gamma Cluster resources by 25%",
        impact: "Requires additional computing resources",
        votes: 9
      },
      {
        id: "option-5",
        description: "Implement progressive resource allocation",
        impact: "Extends implementation timeline by 2 weeks",
        votes: 14
      }
    ],
    status: "identified"
  }
];

const FederatedProposalDetail: React.FC<FederatedProposalDetailProps> = ({
  proposalId,
  proposal,
  onVote,
  onComment,
  onClose
}) => {
  const [tabValue, setTabValue] = useState(0);
  const [voteReason, setVoteReason] = useState('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voteType, setVoteType] = React.useState<'approve' | 'reject' | null>(null);
  const [selectedResolutionOption, setSelectedResolutionOption] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentProposal, setCurrentProposal] = useState<ProposalDetailData | null>(null);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleVote = async (vote: 'approve' | 'reject') => {
    if (!currentProposal) return;
    
    setIsSubmitting(true);
    try {
      await onVote(currentProposal.id, vote, voteReason);
      setVoteReason('');
      setVoteType(null);
    } catch (error) {
      console.error('Failed to submit vote:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!currentProposal || !comment.trim()) return;
    
    setIsSubmitting(true);
    try {
      await onComment(currentProposal.id, comment);
      setComment('');
    } catch (error) {
      console.error('Failed to submit comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolutionVote = (conflictId: string, optionId: string) => {
    setSelectedResolutionOption(optionId);
    // Mock implementation - in real app would call API to record vote
    console.log(`Voted for resolution option ${optionId} for conflict ${conflictId}`);
  };

  const renderConflictResolutionTab = () => {
    if (!currentProposal?.conflicts || currentProposal.conflicts.length === 0) {
      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="subtitle1">No conflicts detected for this proposal.</Typography>
        </Box>
      );
    }

    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>Detected Conflicts</Typography>
        <Typography variant="body2" paragraph>
          The following conflicts have been identified for this proposal. Review and vote on resolution options.
        </Typography>

        {currentProposal.conflicts.map((conflict) => (
          <Paper key={conflict.id} sx={{ mb: 3, p: 2, border: `1px solid ${
            conflict.severity === 'high' ? '#f44336' : 
            conflict.severity === 'medium' ? '#ff9800' : '#4caf50'
          }` }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                {conflict.type.charAt(0).toUpperCase() + conflict.type.slice(1)} Conflict
              </Typography>
              <Typography variant="body2" paragraph>{conflict.description}</Typography>
              
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Chip 
                  label={`Severity: ${conflict.severity.toUpperCase()}`} 
                  color={
                    conflict.severity === 'high' ? 'error' : 
                    conflict.severity === 'medium' ? 'warning' : 'success'
                  }
                  size="small"
                  sx={{ mr: 1 }}
                />
                <Chip 
                  label={`Status: ${conflict.status.replace('_', ' ').toUpperCase()}`}
                  color={
                    conflict.status === 'resolved' ? 'success' : 
                    conflict.status === 'in_review' ? 'info' : 'default'
                  }
                  size="small"
                />
              </Box>
              
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Affected Clusters:</strong> {conflict.affectedClusters.join(', ')}
              </Typography>
            </Box>

            <Typography variant="subtitle2">Resolution Options:</Typography>
            <List>
              {conflict.resolutionOptions.map((option) => (
                <ListItem key={option.id} alignItems="flex-start" divider>
                  <ListItemText
                    primary={option.description}
                    secondary={
                      <>
                        <Typography component="span" variant="body2" color="text.primary">
                          Impact: 
                        </Typography>
                        {` ${option.impact}`}
                      </>
                    }
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Chip 
                      label={`${option.votes} votes`} 
                      size="small" 
                      sx={{ mr: 1 }}
                    />
                    <Button 
                      variant="outlined" 
                      size="small"
                      onClick={() => handleResolutionVote(conflict.id, option.id)}
                    >
                      Vote
                    </Button>
                  </Box>
                </ListItem>
              ))}
            </List>
          </Paper>
        ))}
      </Box>
    );
  };

  useEffect(() => {
    // Simulate API call to fetch proposal details
    if (proposalId && !proposal) {
      setTimeout(() => {
        if (proposalId === 'demo') {
          // Load demo data with conflicts
          setCurrentProposal({
            id: 'FP-2023-42',
            title: 'Unified Parameter Distribution Protocol',
            description: 'A protocol to standardize parameter sharing across federated clusters with conflict resolution mechanisms.',
            category: 'parameter',
            status: 'active',
            proposedBy: 'Cluster Beta-7',
            proposedAt: '2023-09-15T14:30:00Z',
            createdAt: '2023-09-15T14:30:00Z',
            expiresAt: '2023-09-30T23:59:59Z',
            deadline: '2023-09-30T23:59:59Z',
            fullDetails: 'This proposal aims to establish a standardized protocol for parameter sharing across all federated clusters...',
            requiredMajority: 65,
            votesRequired: 10,
            votesReceived: 6,
            proposer: {
              id: 'cluster-beta-7',
              name: 'Beta-7',
              clusterName: 'Beta Cluster'
            },
            votes: [
              { 
                id: 'v1', 
                voterId: 'cluster-alpha-1',
                voterName: 'Alpha-1',
                clusterName: 'Alpha Cluster',
                vote: 'approve', 
                reason: 'Aligns with our parameter optimization goals',
                timestamp: '2023-09-16T09:15:32Z'
              },
              { 
                id: 'v2', 
                voterId: 'cluster-beta-3',
                voterName: 'Beta-3',
                clusterName: 'Beta Cluster',
                vote: 'approve', 
                reason: 'Protocol meets our security requirements',
                timestamp: '2023-09-16T10:22:45Z'
              },
              { 
                id: 'v3', 
                voterId: 'cluster-gamma-2',
                voterName: 'Gamma-2',
                clusterName: 'Gamma Cluster',
                vote: 'reject', 
                reason: 'Concerns about implementation overhead',
                timestamp: '2023-09-17T14:05:12Z'
              }
            ],
            comments: [
              { 
                id: 'c1', 
                authorId: 'cluster-beta-3',
                authorName: 'Beta-3',
                clusterName: 'Beta Cluster',
                content: 'We support this proposal but suggest considering asynchronous parameter exchange for low-bandwidth clusters.', 
                timestamp: '2023-09-16T11:00:15Z'
              },
              { 
                id: 'c2', 
                authorId: 'cluster-gamma-2',
                authorName: 'Gamma-2',
                clusterName: 'Gamma Cluster', 
                content: 'This protocol may introduce unnecessary overhead for smaller clusters. We recommend a tiered approach.', 
                timestamp: '2023-09-17T14:10:33Z'
              }
            ],
            events: [
              { 
                id: 'e1', 
                type: 'created', 
                timestamp: '2023-09-15T14:30:00Z', 
                actorId: 'cluster-beta-7',
                actorName: 'Beta-7',
                details: 'Proposal created by Cluster Beta-7' 
              },
              { 
                id: 'e2', 
                type: 'modified', 
                timestamp: '2023-09-16T08:15:42Z', 
                actorId: 'cluster-beta-7',
                actorName: 'Beta-7',
                details: 'Security section updated with additional encryption requirements' 
              },
              { 
                id: 'e3', 
                type: 'status_changed', 
                timestamp: '2023-09-18T10:00:00Z', 
                actorId: 'system',
                actorName: 'System',
                details: 'Voting threshold of 50% reached' 
              }
            ],
            conflicts: mockConflicts
          });
        } else {
          // For other proposals, just use the provided proposal data
          // This would normally fetch the proposal from an API
          setCurrentProposal(proposal);
        }
        setLoading(false);
      }, 1000);
    } else {
      // If proposal is provided directly, use it
      setCurrentProposal(proposal);
      setLoading(false);
    }
  }, [proposalId, proposal]);

  if (!currentProposal) {
    return (
      <StyledPaper elevation={3}>
        <Typography variant="h6" align="center" sx={{ py: 4 }}>
          Select a proposal to view details
        </Typography>
      </StyledPaper>
    );
  }

  const votePercent = (currentProposal.votesReceived / currentProposal.votesRequired) * 100;
  const approveVotes = currentProposal.votes.filter(v => v.vote === 'approve').length;
  const rejectVotes = currentProposal.votes.filter(v => v.vote === 'reject').length;
  const hasVoted = currentProposal.votes.some(v => v.voterId === 'current_user_id'); // Replace with actual user ID

  const approvalPercentage = () => {
    const approvalVotes = currentProposal.votes.filter(v => v.vote === 'approve').length;
    return currentProposal.votes.length > 0 
      ? Math.round((approvalVotes / currentProposal.votes.length) * 100) 
      : 0;
  };

  const getStatusColor = (status: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
    switch (status) {
      case 'open':
        return 'primary';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      case 'expired':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <PendingIcon />;
      case 'approved':
        return <CheckCircleIcon />;
      case 'rejected':
        return <CancelIcon />;
      case 'expired':
        return <EventIcon />;
      default:
        return <PendingIcon />;
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'created':
        return <PersonIcon />;
      case 'modified':
        return <EditIcon />;
      case 'vote_submitted':
        return <ThumbUpIcon />;
      case 'comment_added':
        return <CommentIcon />;
      case 'status_changed':
        return <EventIcon />;
      default:
        return <EventIcon />;
    }
  };

  return (
    <StyledPaper elevation={3}>
      <HeaderBox>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton onClick={onClose} sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Typography variant="h5" component="h1">
              {currentProposal.title}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <StatusChip 
                label={currentProposal.status} 
                status={currentProposal.status}
                icon={getStatusIcon(currentProposal.status)}
                size="small"
              />
              <CategoryChip 
                label={currentProposal.category} 
                category={currentProposal.category}
                size="small" 
              />
              <Typography variant="body2" color="text.secondary">
                {formatDateTime(currentProposal.createdAt)}
              </Typography>
            </Box>
          </Box>
        </Box>
      </HeaderBox>

      <Divider />

      <Box sx={{ mt: 2, display: 'flex' }}>
        <Tabs value={tabValue} onChange={handleTabChange} sx={{ borderBottom: 1, borderColor: 'divider', width: '100%' }}>
          <Tab label="Details" />
          <Tab label="Votes" />
          <Tab label="Comments" />
          <Tab label="Timeline" />
          <Tab label="Conflicts" />
        </Tabs>
      </Box>

      <ScrollableBox>
        {tabValue === 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              Proposed by: <strong>{currentProposal.proposer.name}</strong> ({currentProposal.proposer.clusterName})
            </Typography>
            
            <Card variant="outlined" sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Description
                </Typography>
                <Typography paragraph>
                  {currentProposal.description}
                </Typography>
                
                <Typography variant="h6" gutterBottom>
                  Full Details
                </Typography>
                <Typography sx={{ whiteSpace: 'pre-line' }}>
                  {currentProposal.fullDetails}
                </Typography>
              </CardContent>
            </Card>

            <Card variant="outlined" sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Voting Status
                </Typography>
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">
                      Votes received: {currentProposal.votesReceived} / {currentProposal.votesRequired}
                    </Typography>
                    <Typography variant="body2">
                      {Math.min(Math.round(votePercent), 100)}%
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min(votePercent, 100)} 
                    sx={{ 
                      height: 10, 
                      borderRadius: 5,
                      bgcolor: 'grey.300',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: getProgressColor(votePercent)
                      }
                    }} 
                  />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Box>
                    <Typography variant="body2" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <ThumbUpIcon fontSize="small" />
                      Approve: {approveVotes}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="body2" color="error.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <ThumbDownIcon fontSize="small" />
                      Reject: {rejectVotes}
                    </Typography>
                  </Box>
                </Box>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Current approval: {approvalPercentage()}% (Required: {currentProposal.requiredMajority}%)
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Expires: {formatDateTime(currentProposal.expiresAt)}
                </Typography>
              </CardContent>
            </Card>

            {currentProposal.status === 'open' && !hasVoted && (
              <Card variant="outlined" sx={{ mt: 2 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Cast Your Vote
                  </Typography>
                  <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                    <Button
                      variant={voteType === 'approve' ? 'contained' : 'outlined'}
                      color="success"
                      startIcon={<ThumbUpIcon />}
                      onClick={() => setVoteType('approve')}
                      disabled={isSubmitting}
                    >
                      Approve
                    </Button>
                    <Button
                      variant={voteType === 'reject' ? 'contained' : 'outlined'}
                      color="error"
                      startIcon={<ThumbDownIcon />}
                      onClick={() => setVoteType('reject')}
                      disabled={isSubmitting}
                    >
                      Reject
                    </Button>
                  </Stack>
                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    placeholder="Provide a reason for your vote..."
                    value={voteReason}
                    onChange={(e) => setVoteReason(e.target.value)}
                    sx={{ mb: 2 }}
                    disabled={!voteType || isSubmitting}
                  />
                  <Button 
                    variant="contained" 
                    endIcon={<SendIcon />}
                    disabled={!voteType || !voteReason.trim() || isSubmitting}
                    onClick={() => handleVote(voteType as 'approve' | 'reject')}
                  >
                    Submit Vote
                  </Button>
                </CardContent>
              </Card>
            )}
          </Box>
        )}

        {tabValue === 1 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Votes ({currentProposal.votes.length})
            </Typography>
            <List>
              {currentProposal.votes.map((vote) => (
                <ListItem key={vote.id} sx={{ bgcolor: 'background.paper', mb: 1, borderRadius: 1 }}>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: vote.vote === 'approve' ? 'success.main' : 'error.main' }}>
                      {vote.vote === 'approve' ? <ThumbUpIcon /> : <ThumbDownIcon />}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body1">
                          {vote.voterName}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          ({vote.clusterName})
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          • {formatDateTime(vote.timestamp)}
                        </Typography>
                      </Box>
                    }
                    secondary={vote.reason}
                  />
                </ListItem>
              ))}
              {currentProposal.votes.length === 0 && (
                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                  No votes cast yet
                </Typography>
              )}
            </List>
          </Box>
        )}

        {tabValue === 2 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Comments ({currentProposal.comments.length})
            </Typography>
            
            <Box sx={{ mb: 3 }}>
              <TextField
                fullWidth
                multiline
                rows={3}
                placeholder="Add your comment..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                sx={{ mb: 1 }}
                disabled={isSubmitting}
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  endIcon={<SendIcon />}
                  onClick={handleSubmitComment}
                  disabled={!comment.trim() || isSubmitting}
                >
                  Post Comment
                </Button>
              </Box>
            </Box>
            
            <List>
              {currentProposal.comments.map((comment) => (
                <ListItem key={comment.id} sx={{ bgcolor: 'background.paper', mb: 1, borderRadius: 1 }}>
                  <ListItemAvatar>
                    <Avatar>{comment.authorName.charAt(0).toUpperCase()}</Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body1">
                          {comment.authorName}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          ({comment.clusterName})
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          • {formatDateTime(comment.timestamp)}
                        </Typography>
                      </Box>
                    }
                    secondary={comment.content}
                  />
                </ListItem>
              ))}
              {currentProposal.comments.length === 0 && (
                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                  No comments yet
                </Typography>
              )}
            </List>
          </Box>
        )}

        {tabValue === 3 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Activity Timeline
            </Typography>
            <Timeline position="right">
              {currentProposal.events.map((event) => (
                <TimelineItem key={event.id}>
                  <TimelineOppositeContent color="text.secondary" sx={{ flex: 0.2 }}>
                    <Typography variant="caption">
                      {formatDateTime(event.timestamp)}
                    </Typography>
                  </TimelineOppositeContent>
                  <TimelineSeparator>
                    <TimelineDot color={
                      event.type === 'status_changed' ? 
                        'secondary' : 
                        event.type === 'vote_submitted' ? 
                          'success' : 
                          'primary'
                    }>
                      {getEventIcon(event.type)}
                    </TimelineDot>
                    <TimelineConnector />
                  </TimelineSeparator>
                  <TimelineContent sx={{ py: '12px', px: 2 }}>
                    <Typography variant="body2">
                      {event.details}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      by {event.actorName}
                    </Typography>
                  </TimelineContent>
                </TimelineItem>
              ))}
              {currentProposal.events.length === 0 && (
                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                  No activity recorded
                </Typography>
              )}
            </Timeline>
          </Box>
        )}

        {tabValue === 4 && renderConflictResolutionTab()}
      </ScrollableBox>
    </StyledPaper>
  );
};

export default FederatedProposalDetail; 