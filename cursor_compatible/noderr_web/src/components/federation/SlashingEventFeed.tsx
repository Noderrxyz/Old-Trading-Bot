import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, List, ListItem, ListItemText, ListItemIcon, Chip, Divider, Badge, Alert, Menu, MenuItem, IconButton, Tooltip } from '@mui/material';
import { styled } from '@mui/material/styles';
import GavelIcon from '@mui/icons-material/Gavel';
import WarningIcon from '@mui/icons-material/Warning';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { WebSocketService, FederatedEvent } from '../../services/WebSocketService';

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  height: '100%',
  display: 'flex',
  flexDirection: 'column'
}));

const EventItem = styled(ListItem, {
  shouldForwardProp: (prop) => prop !== 'severity',
})<{ severity: 'high' | 'medium' | 'low' }>(({ theme, severity }) => ({
  borderLeft: `4px solid ${
    severity === 'high' ? theme.palette.error.main :
    severity === 'medium' ? theme.palette.warning.main :
    theme.palette.info.main
  }`,
  marginBottom: theme.spacing(1),
  backgroundColor: 
    severity === 'high' ? theme.palette.error.light + '20' :
    severity === 'medium' ? theme.palette.warning.light + '20' :
    theme.palette.info.light + '20',
  '&:hover': {
    backgroundColor: 
      severity === 'high' ? theme.palette.error.light + '40' :
      severity === 'medium' ? theme.palette.warning.light + '40' :
      theme.palette.info.light + '40',
  }
}));

const ViolationChip = styled(Chip)(({ theme }) => ({
  margin: theme.spacing(0.5),
  fontSize: '0.75rem',
  height: 24
}));

const SeverityBadge = styled(Badge, {
  shouldForwardProp: (prop) => prop !== 'severity',
})<{ severity: 'high' | 'medium' | 'low' }>(({ theme, severity }) => ({
  '& .MuiBadge-badge': {
    backgroundColor: 
      severity === 'high' ? theme.palette.error.main :
      severity === 'medium' ? theme.palette.warning.main :
      theme.palette.info.main,
    color: 
      severity === 'high' ? theme.palette.error.contrastText :
      severity === 'medium' ? theme.palette.warning.contrastText :
      theme.palette.info.contrastText,
  }
}));

const CenteredAlert = styled(Alert)(({ theme }) => ({
  width: '100%',
  justifyContent: 'center',
  marginBottom: theme.spacing(2)
}));

interface SlashEvent {
  id: string;
  cluster: string;
  amount: number;
  reason: string;
  confidence: number;
  timestamp: string;
  severity: 'high' | 'medium' | 'low';
  violations: string[];
  resolved: boolean;
}

interface SlashingEventFeedProps {
  maxEvents?: number;
}

const SlashingEventFeed: React.FC<SlashingEventFeedProps> = ({ maxEvents = 10 }) => {
  const [events, setEvents] = useState<SlashEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<SlashEvent[]>([]);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<{
    element: HTMLElement | null;
    eventId: string | null;
  }>({ element: null, eventId: null });
  
  // Connect to WebSocket and listen for slash events
  useEffect(() => {
    const wsService = WebSocketService.getInstance();
    
    // Setup event listener for slash events
    const handleSlashEvent = (event: FederatedEvent) => {
      if (event.type === 'SLASH_ENFORCED') {
        // Create a new slash event object
        const severity = getSeverityFromReason(event.reason);
        const violations = getViolationsFromReason(event.reason);
        
        const newEvent: SlashEvent = {
          id: `slash-${Date.now()}`,
          cluster: event.cluster,
          amount: event.amount,
          reason: event.reason,
          confidence: event.confidence,
          timestamp: new Date().toISOString(),
          severity,
          violations,
          resolved: false
        };
        
        // Add new event to the list
        setEvents(prev => [newEvent, ...prev].slice(0, maxEvents));
      }
    };
    
    // Connect to WebSocket
    try {
      wsService.connect();
      wsService.addEventListener('SLASH_ENFORCED', handleSlashEvent);
      setConnected(wsService.isConnected());
      
      // Simulate some initial slash events for demonstration
      simulateInitialEvents();
    } catch (err) {
      console.error('Error connecting to WebSocket:', err);
      setError('Failed to connect to event feed. Slash events may not be displayed in real-time.');
      
      // Still simulate some events for demonstration
      simulateInitialEvents();
    }
    
    // Cleanup
    return () => {
      wsService.removeEventListener('SLASH_ENFORCED', handleSlashEvent);
    };
  }, [maxEvents]);
  
  // Update filtered events when events or filters change
  useEffect(() => {
    if (activeFilters.length === 0) {
      setFilteredEvents(events);
    } else {
      setFilteredEvents(events.filter(event => 
        event.violations.some(violation => activeFilters.includes(violation))
      ));
    }
  }, [events, activeFilters]);
  
  // Get severity level from reason string
  const getSeverityFromReason = (reason: string): 'high' | 'medium' | 'low' => {
    const reasonLower = reason.toLowerCase();
    
    if (reasonLower.includes('malicious') || reasonLower.includes('override')) {
      return 'high';
    } else if (reasonLower.includes('consensus') || reasonLower.includes('manipulation')) {
      return 'medium';
    }
    
    return 'low';
  };
  
  // Extract violation types from reason string
  const getViolationsFromReason = (reason: string): string[] => {
    const violations: string[] = [];
    
    if (reason.includes('Governance Abstention')) {
      violations.push('governance_abstention');
    }
    if (reason.includes('Malicious Override')) {
      violations.push('malicious_override');
    }
    if (reason.includes('Consensus Violation')) {
      violations.push('consensus_violation');
    }
    if (reason.includes('Resource Misuse')) {
      violations.push('resource_misuse');
    }
    if (reason.includes('Parameter Manipulation')) {
      violations.push('parameter_manipulation');
    }
    if (reason.includes('Trust Decay')) {
      violations.push('trust_decay');
    }
    
    // If we couldn't identify specific violations, add a generic one
    if (violations.length === 0) {
      violations.push('other');
    }
    
    return violations;
  };
  
  // Format currency
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };
  
  // Format date
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };
  
  // Format violation type for display
  const formatViolation = (violation: string): string => {
    return violation
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };
  
  // Get all possible violation types
  const getAllViolationTypes = (): string[] => {
    const allViolations = new Set<string>();
    
    events.forEach(event => {
      event.violations.forEach(violation => {
        allViolations.add(violation);
      });
    });
    
    return Array.from(allViolations);
  };
  
  // Handle filter menu open
  const handleFilterMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  
  // Handle filter menu close
  const handleFilterMenuClose = () => {
    setAnchorEl(null);
  };
  
  // Toggle a filter
  const toggleFilter = (filter: string) => {
    setActiveFilters(prev => {
      if (prev.includes(filter)) {
        return prev.filter(f => f !== filter);
      } else {
        return [...prev, filter];
      }
    });
  };
  
  // Handle action menu open
  const handleActionMenuOpen = (event: React.MouseEvent<HTMLElement>, eventId: string) => {
    event.stopPropagation();
    setActionMenuAnchor({
      element: event.currentTarget,
      eventId
    });
  };
  
  // Handle action menu close
  const handleActionMenuClose = () => {
    setActionMenuAnchor({
      element: null,
      eventId: null
    });
  };
  
  // Mark event as resolved
  const markAsResolved = (eventId: string) => {
    setEvents(prev => 
      prev.map(event => 
        event.id === eventId ? { ...event, resolved: true } : event
      )
    );
    handleActionMenuClose();
  };
  
  // Simulate initial events for demonstration
  const simulateInitialEvents = () => {
    const mockEvents: SlashEvent[] = [
      {
        id: 'slash-1',
        cluster: 'europe',
        amount: 42000,
        reason: '2x Governance Abstention + 1x Malicious Override',
        confidence: 0.91,
        timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        severity: 'high',
        violations: ['governance_abstention', 'malicious_override'],
        resolved: false
      },
      {
        id: 'slash-2',
        cluster: 'asia-pacific',
        amount: 15000,
        reason: '3x Resource Misuse',
        confidence: 0.83,
        timestamp: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
        severity: 'medium',
        violations: ['resource_misuse'],
        resolved: true
      },
      {
        id: 'slash-3',
        cluster: 'africa',
        amount: 8500,
        reason: '2x Trust Decay',
        confidence: 0.72,
        timestamp: new Date(Date.now() - 10800000).toISOString(), // 3 hours ago
        severity: 'low',
        violations: ['trust_decay'],
        resolved: false
      }
    ];
    
    setEvents(mockEvents);
  };
  
  return (
    <StyledPaper elevation={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" component="h2">
          Slashing Event Feed
        </Typography>
        
        <Box>
          <Tooltip title="Filter by violation type">
            <IconButton onClick={handleFilterMenuOpen}>
              <Badge 
                color="primary" 
                badgeContent={activeFilters.length > 0 ? activeFilters.length : 0}
                invisible={activeFilters.length === 0}
              >
                <FilterAltIcon />
              </Badge>
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleFilterMenuClose}
      >
        {getAllViolationTypes().map((violation) => (
          <MenuItem 
            key={violation}
            onClick={() => toggleFilter(violation)}
            selected={activeFilters.includes(violation)}
          >
            {formatViolation(violation)}
          </MenuItem>
        ))}
        {getAllViolationTypes().length > 0 && (
          <Divider />
        )}
        <MenuItem onClick={() => setActiveFilters([])}>
          Clear Filters
        </MenuItem>
      </Menu>
      
      <Menu
        anchorEl={actionMenuAnchor.element}
        open={Boolean(actionMenuAnchor.element)}
        onClose={handleActionMenuClose}
      >
        <MenuItem onClick={() => actionMenuAnchor.eventId && markAsResolved(actionMenuAnchor.eventId)}>
          Mark as Resolved
        </MenuItem>
        <MenuItem onClick={handleActionMenuClose}>
          View Details
        </MenuItem>
      </Menu>
      
      {!connected && !error && (
        <CenteredAlert severity="warning">
          Not connected to live feed. Showing historical events only.
        </CenteredAlert>
      )}
      
      {error && (
        <CenteredAlert severity="error">
          {error}
        </CenteredAlert>
      )}
      
      {activeFilters.length > 0 && (
        <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" sx={{ mr: 1, my: 0.5 }}>
            Active Filters:
          </Typography>
          {activeFilters.map(filter => (
            <Chip
              key={filter}
              label={formatViolation(filter)}
              size="small"
              onDelete={() => toggleFilter(filter)}
              sx={{ m: 0.5 }}
            />
          ))}
        </Box>
      )}
      
      {filteredEvents.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
          <Typography variant="body1" color="text.secondary">
            No slashing events to display
          </Typography>
        </Box>
      ) : (
        <List sx={{ flexGrow: 1, overflow: 'auto' }}>
          {filteredEvents.map((event) => (
            <EventItem key={event.id} severity={event.severity} alignItems="flex-start" divider>
              <ListItemIcon>
                <SeverityBadge 
                  badgeContent={event.violations.length} 
                  severity={event.severity}
                >
                  <GavelIcon color={
                    event.severity === 'high' ? 'error' :
                    event.severity === 'medium' ? 'warning' :
                    'info'
                  } />
                </SeverityBadge>
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="subtitle1">
                      {event.cluster} Cluster
                      {event.resolved && (
                        <Chip 
                          label="Resolved" 
                          size="small" 
                          color="success" 
                          sx={{ ml: 1 }}
                        />
                      )}
                    </Typography>
                    <IconButton 
                      edge="end" 
                      aria-label="actions"
                      size="small"
                      onClick={(e) => handleActionMenuOpen(e, event.id)}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Box>
                }
                secondary={
                  <>
                    <Typography variant="body2" component="span" color="text.primary">
                      Slashed {formatCurrency(event.amount)}
                    </Typography>
                    <Typography variant="body2" component="div">
                      {event.reason}
                    </Typography>
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
                        Confidence: {(event.confidence * 100).toFixed(1)}% • {formatDate(event.timestamp)}
                      </Typography>
                      <Box>
                        {event.violations.map(violation => (
                          <ViolationChip
                            key={violation}
                            label={formatViolation(violation)}
                            size="small"
                            onClick={() => toggleFilter(violation)}
                          />
                        ))}
                      </Box>
                    </Box>
                  </>
                }
              />
            </EventItem>
          ))}
        </List>
      )}
    </StyledPaper>
  );
};

export default SlashingEventFeed; 