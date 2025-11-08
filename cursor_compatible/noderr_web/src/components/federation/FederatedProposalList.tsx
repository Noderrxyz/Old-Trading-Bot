import React, { useState } from 'react';
import {
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Box,
  TextField,
  InputAdornment,
  IconButton,
  TablePagination,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TableSortLabel,
  LinearProgress
} from '@mui/material';
import { styled } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import VisibilityIcon from '@mui/icons-material/Visibility';

// Define interfaces for our federation components
export interface FederatedVote {
  clusterId: string;
  cluster: string;
  trustScore: number;
  position: 'approve' | 'reject' | 'abstain';
  timestamp: string;
  reason: string;
  region: string;
}

export interface MetaAgentReview {
  recommendation: 'approve' | 'reject' | 'more_info';
  confidence: number;
  reasoning: string;
  veto: boolean;
}

export interface ProposalOutcome {
  result: 'approved' | 'rejected';
  implementationDate: string | null;
  voteSummary: {
    approve: number;
    reject: number;
    abstain: number;
    weightedScore: number;
  }
}

export interface FederatedProposal {
  id: string;
  title: string;
  description: string;
  proposer: {
    id: string;
    name: string;
    clusterId: string;
    clusterName: string;
  };
  status: 'open' | 'approved' | 'rejected' | 'expired';
  category: 'parameter' | 'governance' | 'network' | 'agent' | 'resource';
  createdAt: string;
  votesRequired: number;
  votesReceived: number;
  expiresAt: string;
}

interface FederatedProposalListProps {
  proposals: FederatedProposal[];
  onSelectProposal: (proposalId: string) => void;
}

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  height: '100%',
  display: 'flex',
  flexDirection: 'column'
}));

const StatusChip = styled(Chip)(({ theme, color }) => ({
  fontWeight: 500,
  borderRadius: '4px',
  minWidth: '80px',
  color: theme.palette.getContrastText(
    color === 'success' ? theme.palette.success.main : 
    color === 'error' ? theme.palette.error.main :
    color === 'warning' ? theme.palette.warning.main :
    theme.palette.info.main
  ),
}));

const CategoryChip = styled(Chip)(({ theme }) => ({
  fontWeight: 400,
  fontSize: '0.75rem',
  height: '22px',
  borderRadius: '4px',
}));

const SearchBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  marginBottom: theme.spacing(2),
  gap: theme.spacing(2)
}));

type Order = 'asc' | 'desc';
type OrderBy = 'title' | 'status' | 'category' | 'createdAt' | 'expiresAt' | 'votesReceived';

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function calculateTimeRemaining(expiryDate: string) {
  const now = new Date();
  const expiry = new Date(expiryDate);
  const diffTime = expiry.getTime() - now.getTime();
  
  if (diffTime <= 0) {
    return 'Expired';
  }
  
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (diffDays > 0) {
    return `${diffDays}d ${diffHours}h`;
  } else {
    return `${diffHours}h`;
  }
}

const FederatedProposalList: React.FC<FederatedProposalListProps> = ({ proposals, onSelectProposal }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [order, setOrder] = useState<Order>('desc');
  const [orderBy, setOrderBy] = useState<OrderBy>('createdAt');

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRequestSort = (property: OrderBy) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const filteredProposals = proposals.filter(proposal => {
    const matchesSearch = proposal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          proposal.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          proposal.proposer.name.toLowerCase().includes(searchTerm.toLowerCase());
                          
    const matchesStatus = statusFilter === 'all' || proposal.status === statusFilter;
    const matchesCategory = categoryFilter === 'all' || proposal.category === categoryFilter;
    
    return matchesSearch && matchesStatus && matchesCategory;
  });

  const sortedProposals = [...filteredProposals].sort((a, b) => {
    let comparison = 0;
    
    switch (orderBy) {
      case 'title':
        comparison = a.title.localeCompare(b.title);
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
      case 'category':
        comparison = a.category.localeCompare(b.category);
        break;
      case 'createdAt':
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case 'expiresAt':
        comparison = new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
        break;
      case 'votesReceived':
        const aPercent = (a.votesReceived / a.votesRequired) * 100;
        const bPercent = (b.votesReceived / b.votesRequired) * 100;
        comparison = aPercent - bPercent;
        break;
      default:
        comparison = 0;
    }
    
    return order === 'asc' ? comparison : -comparison;
  });

  const paginatedProposals = sortedProposals.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  // Function to get chip color based on status
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

  // Function to get category display name
  const getCategoryDisplay = (category: string): string => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  // Calculate days left for open proposals
  const getDaysLeft = (expiresAt: string): number => {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  return (
    <StyledPaper elevation={3}>
      <Typography variant="h5" component="h1" gutterBottom>
        Federation Proposals
      </Typography>
      
      <SearchBox>
        <TextField
          placeholder="Search proposals"
          variant="outlined"
          size="small"
          fullWidth
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
        
        <FormControl variant="outlined" size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="status-filter-label">Status</InputLabel>
          <Select
            labelId="status-filter-label"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            label="Status"
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="approved">Approved</MenuItem>
            <MenuItem value="rejected">Rejected</MenuItem>
            <MenuItem value="expired">Expired</MenuItem>
          </Select>
        </FormControl>
        
        <FormControl variant="outlined" size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="category-filter-label">Category</InputLabel>
          <Select
            labelId="category-filter-label"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            label="Category"
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="parameter">Parameter</MenuItem>
            <MenuItem value="governance">Governance</MenuItem>
            <MenuItem value="network">Network</MenuItem>
            <MenuItem value="agent">Agent</MenuItem>
            <MenuItem value="resource">Resource</MenuItem>
          </Select>
        </FormControl>
        
        <Tooltip title="Filter">
          <IconButton>
            <FilterListIcon />
          </IconButton>
        </Tooltip>
      </SearchBox>
      
      <TableContainer sx={{ flexGrow: 1 }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'title'}
                  direction={orderBy === 'title' ? order : 'asc'}
                  onClick={() => handleRequestSort('title')}
                >
                  Title
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'status'}
                  direction={orderBy === 'status' ? order : 'asc'}
                  onClick={() => handleRequestSort('status')}
                >
                  Status
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'category'}
                  direction={orderBy === 'category' ? order : 'asc'}
                  onClick={() => handleRequestSort('category')}
                >
                  Category
                </TableSortLabel>
              </TableCell>
              <TableCell>Proposer</TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'createdAt'}
                  direction={orderBy === 'createdAt' ? order : 'asc'}
                  onClick={() => handleRequestSort('createdAt')}
                >
                  Created
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'votesReceived'}
                  direction={orderBy === 'votesReceived' ? order : 'asc'}
                  onClick={() => handleRequestSort('votesReceived')}
                >
                  Votes
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={orderBy === 'expiresAt'}
                  direction={orderBy === 'expiresAt' ? order : 'asc'}
                  onClick={() => handleRequestSort('expiresAt')}
                >
                  Time Remaining
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedProposals.length > 0 ? (
              paginatedProposals.map((proposal) => (
                <TableRow 
                  key={proposal.id}
                  hover
                  onClick={() => onSelectProposal(proposal.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {proposal.title}
                    </Typography>
                    <Typography variant="caption" color="textSecondary" noWrap>
                      {proposal.description.length > 60 
                        ? `${proposal.description.substring(0, 60)}...` 
                        : proposal.description}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip label={proposal.status.toUpperCase()} color={getStatusColor(proposal.status)} size="small" />
                  </TableCell>
                  <TableCell>
                    <CategoryChip label={getCategoryDisplay(proposal.category)} size="small" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {proposal.proposer.name}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      {proposal.proposer.clusterName}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {formatDate(proposal.createdAt)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Box sx={{ width: '100%', mr: 1 }}>
                        <Typography variant="body2">
                          {proposal.votesReceived}/{proposal.votesRequired}
                        </Typography>
                        <Box
                          sx={{
                            width: '100%',
                            backgroundColor: 'rgba(0, 0, 0, 0.1)',
                            borderRadius: 1,
                            height: 4
                          }}
                        >
                          <Box
                            sx={{
                              width: `${Math.min(100, (proposal.votesReceived / proposal.votesRequired) * 100)}%`,
                              backgroundColor: 'primary.main',
                              borderRadius: 1,
                              height: 4
                            }}
                          />
                        </Box>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    {proposal.status === 'open' ? (
                      <Typography variant="body2">
                        {getDaysLeft(proposal.expiresAt)} days left
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="textSecondary">
                        {proposal.status === 'expired' ? 'Expired' : 'Closed'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="View Details">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProposal(proposal.id);
                        }}
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography variant="body1" sx={{ py: 3 }}>
                    No proposals match the current filters
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      
      <TablePagination
        rowsPerPageOptions={[5, 10, 25]}
        component="div"
        count={filteredProposals.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </StyledPaper>
  );
};

export default FederatedProposalList; 