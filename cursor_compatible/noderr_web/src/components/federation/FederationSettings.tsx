import React from 'react';
import {
  Paper,
  Typography,
  Box,
  Grid,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
  Card,
  CardContent,
  IconButton,
  Chip,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  FormHelperText,
  Alert
} from '@mui/material';
import { styled } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';

interface Cluster {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  trustScore: number;
  isActive: boolean;
  lastSync: string;
}

interface FederationSettingsProps {
  userCluster: {
    id: string;
    name: string;
    endpoint: string;
    region: string;
    trustScore: number;
  };
  connectedClusters: Cluster[];
  onSaveClusterSettings: (settings: FederationSettings) => void;
  onAddCluster: (cluster: Omit<Cluster, 'id' | 'trustScore' | 'lastSync'>) => void;
  onUpdateCluster: (clusterId: string, updates: Partial<Cluster>) => void;
  onRemoveCluster: (clusterId: string) => void;
}

interface FederationSettings {
  autoSync: boolean;
  syncInterval: number;
  minTrustThreshold: number;
  voteWeighting: 'equal' | 'trust-weighted';
  quorumPercentage: number;
  proposalAutoClose: boolean;
  proposalLifetime: number;
  allowMetaAgentVeto: boolean;
}

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  height: '100%',
  overflow: 'auto'
}));

const SectionHeading = styled(Typography)(({ theme }) => ({
  marginBottom: theme.spacing(2),
  marginTop: theme.spacing(3),
  fontWeight: 500
}));

const ClusterCard = styled(Card)(({ theme }) => ({
  marginBottom: theme.spacing(2),
  position: 'relative'
}));

const ClusterActions = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(1),
  right: theme.spacing(1),
  display: 'flex',
  gap: theme.spacing(1)
}));

const RegionChip = styled(Chip)(({ theme }) => ({
  marginRight: theme.spacing(1)
}));

const FederationSettings: React.FC<FederationSettingsProps> = ({
  userCluster,
  connectedClusters,
  onSaveClusterSettings,
  onAddCluster,
  onUpdateCluster,
  onRemoveCluster
}) => {
  const [settings, setSettings] = React.useState<FederationSettings>({
    autoSync: true,
    syncInterval: 60,
    minTrustThreshold: 70,
    voteWeighting: 'trust-weighted',
    quorumPercentage: 67,
    proposalAutoClose: true,
    proposalLifetime: 7,
    allowMetaAgentVeto: true
  });

  const [newCluster, setNewCluster] = React.useState({
    name: '',
    endpoint: '',
    region: '',
    isActive: true
  });

  const [editingClusterId, setEditingClusterId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<Partial<Cluster>>({});
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [formErrors, setFormErrors] = React.useState<{[key: string]: string}>({});

  const handleSettingChange = (setting: keyof FederationSettings, value: any) => {
    setSettings({
      ...settings,
      [setting]: value
    });
  };

  const handleNewClusterChange = (field: keyof typeof newCluster, value: any) => {
    setNewCluster({
      ...newCluster,
      [field]: value
    });
  };

  const handleEditFormChange = (field: keyof Cluster, value: any) => {
    setEditForm({
      ...editForm,
      [field]: value
    });
  };

  const validateClusterForm = (cluster: typeof newCluster) => {
    const errors: {[key: string]: string} = {};
    
    if (!cluster.name.trim()) {
      errors.name = 'Name is required';
    }
    
    if (!cluster.endpoint.trim()) {
      errors.endpoint = 'Endpoint URL is required';
    } else if (!/^https?:\/\/.+/.test(cluster.endpoint)) {
      errors.endpoint = 'Endpoint must be a valid URL starting with http:// or https://';
    }
    
    if (!cluster.region.trim()) {
      errors.region = 'Region is required';
    }
    
    return errors;
  };

  const handleSaveSettings = () => {
    onSaveClusterSettings(settings);
  };

  const handleAddNewCluster = () => {
    const validationErrors = validateClusterForm(newCluster);
    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors);
      return;
    }
    
    onAddCluster(newCluster);
    setNewCluster({
      name: '',
      endpoint: '',
      region: '',
      isActive: true
    });
    setShowAddForm(false);
    setFormErrors({});
  };

  const startEditingCluster = (cluster: Cluster) => {
    setEditingClusterId(cluster.id);
    setEditForm({
      name: cluster.name,
      endpoint: cluster.endpoint,
      region: cluster.region,
      isActive: cluster.isActive
    });
  };

  const handleSaveEdit = () => {
    if (editingClusterId) {
      const validationErrors = validateClusterForm(editForm as typeof newCluster);
      if (Object.keys(validationErrors).length > 0) {
        setFormErrors(validationErrors);
        return;
      }
      
      onUpdateCluster(editingClusterId, editForm);
      setEditingClusterId(null);
      setEditForm({});
      setFormErrors({});
    }
  };

  const handleCancelEdit = () => {
    setEditingClusterId(null);
    setEditForm({});
    setFormErrors({});
  };

  const handleRemoveCluster = (clusterId: string) => {
    onRemoveCluster(clusterId);
  };

  const formatTimestamp = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <StyledPaper elevation={3}>
      <Typography variant="h5" component="h1" gutterBottom>
        Federation Settings
      </Typography>
      
      <Alert severity="info" sx={{ mb: 3 }}>
        Configure how your cluster interacts with other clusters in the federation.
        Changes to these settings will affect how proposals are processed and votes are counted.
      </Alert>
      
      <SectionHeading variant="h6">Your Cluster Details</SectionHeading>
      <Card variant="outlined" sx={{ mb: 4 }}>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="textSecondary">Name</Typography>
              <Typography variant="body1">{userCluster.name}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="textSecondary">ID</Typography>
              <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>{userCluster.id}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="textSecondary">Region</Typography>
              <Typography variant="body1">{userCluster.region}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="textSecondary">Trust Score</Typography>
              <Typography variant="body1">{userCluster.trustScore.toFixed(2)}</Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="textSecondary">API Endpoint</Typography>
              <Typography variant="body1" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {userCluster.endpoint}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
      
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Federation Configuration</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.autoSync}
                    onChange={(e) => handleSettingChange('autoSync', e.target.checked)}
                    color="primary"
                  />
                }
                label="Enable Auto-Synchronization"
              />
              
              <Box sx={{ mt: 2 }}>
                <Typography id="sync-interval-slider" gutterBottom>
                  Sync Interval (minutes)
                </Typography>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs>
                    <Slider
                      value={settings.syncInterval}
                      onChange={(e, newValue) => handleSettingChange('syncInterval', newValue)}
                      aria-labelledby="sync-interval-slider"
                      disabled={!settings.autoSync}
                      min={5}
                      max={240}
                      valueLabelDisplay="auto"
                    />
                  </Grid>
                  <Grid item>
                    <TextField
                      value={settings.syncInterval}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if (!isNaN(value) && value >= 5 && value <= 240) {
                          handleSettingChange('syncInterval', value);
                        }
                      }}
                      disabled={!settings.autoSync}
                      InputProps={{ inputProps: { min: 5, max: 240 } }}
                      type="number"
                      size="small"
                      sx={{ width: 80 }}
                    />
                  </Grid>
                </Grid>
              </Box>
              
              <Box sx={{ mt: 3 }}>
                <Typography id="trust-threshold-slider" gutterBottom>
                  Minimum Trust Threshold (%)
                </Typography>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs>
                    <Slider
                      value={settings.minTrustThreshold}
                      onChange={(e, newValue) => handleSettingChange('minTrustThreshold', newValue)}
                      aria-labelledby="trust-threshold-slider"
                      min={0}
                      max={100}
                      valueLabelDisplay="auto"
                    />
                  </Grid>
                  <Grid item>
                    <TextField
                      value={settings.minTrustThreshold}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if (!isNaN(value) && value >= 0 && value <= 100) {
                          handleSettingChange('minTrustThreshold', value);
                        }
                      }}
                      InputProps={{ inputProps: { min: 0, max: 100 } }}
                      type="number"
                      size="small"
                      sx={{ width: 80 }}
                    />
                  </Grid>
                </Grid>
                <FormHelperText>
                  Clusters with trust scores below this threshold will not be able to participate in voting
                </FormHelperText>
              </Box>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControl fullWidth sx={{ mb: 3 }}>
                <InputLabel id="vote-weighting-label">Vote Weighting Method</InputLabel>
                <Select
                  labelId="vote-weighting-label"
                  value={settings.voteWeighting}
                  label="Vote Weighting Method"
                  onChange={(e) => handleSettingChange('voteWeighting', e.target.value)}
                >
                  <MenuItem value="equal">Equal Weight (One Cluster, One Vote)</MenuItem>
                  <MenuItem value="trust-weighted">Trust-Weighted (Proportional to Trust Score)</MenuItem>
                </Select>
                <FormHelperText>
                  Determines how votes are counted toward proposal outcomes
                </FormHelperText>
              </FormControl>
              
              <Box sx={{ mb: 3 }}>
                <Typography id="quorum-slider" gutterBottom>
                  Quorum Requirement (%)
                </Typography>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs>
                    <Slider
                      value={settings.quorumPercentage}
                      onChange={(e, newValue) => handleSettingChange('quorumPercentage', newValue)}
                      aria-labelledby="quorum-slider"
                      min={50}
                      max={100}
                      step={1}
                      marks={[
                        { value: 50, label: '50%' },
                        { value: 67, label: '67%' },
                        { value: 75, label: '75%' },
                        { value: 100, label: '100%' }
                      ]}
                      valueLabelDisplay="auto"
                    />
                  </Grid>
                  <Grid item>
                    <TextField
                      value={settings.quorumPercentage}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if (!isNaN(value) && value >= 50 && value <= 100) {
                          handleSettingChange('quorumPercentage', value);
                        }
                      }}
                      InputProps={{ inputProps: { min: 50, max: 100 } }}
                      type="number"
                      size="small"
                      sx={{ width: 80 }}
                    />
                  </Grid>
                </Grid>
                <FormHelperText>
                  The percentage of clusters that must vote for a proposal to be considered valid
                </FormHelperText>
              </Box>
              
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.proposalAutoClose}
                    onChange={(e) => handleSettingChange('proposalAutoClose', e.target.checked)}
                    color="primary"
                  />
                }
                label="Automatically Close Expired Proposals"
              />
              
              <Box sx={{ mt: 2, mb: 2 }}>
                <Typography id="proposal-lifetime-slider" gutterBottom>
                  Default Proposal Lifetime (days)
                </Typography>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs>
                    <Slider
                      value={settings.proposalLifetime}
                      onChange={(e, newValue) => handleSettingChange('proposalLifetime', newValue)}
                      aria-labelledby="proposal-lifetime-slider"
                      min={1}
                      max={30}
                      valueLabelDisplay="auto"
                    />
                  </Grid>
                  <Grid item>
                    <TextField
                      value={settings.proposalLifetime}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if (!isNaN(value) && value >= 1 && value <= 30) {
                          handleSettingChange('proposalLifetime', value);
                        }
                      }}
                      InputProps={{ inputProps: { min: 1, max: 30 } }}
                      type="number"
                      size="small"
                      sx={{ width: 80 }}
                    />
                  </Grid>
                </Grid>
              </Box>
              
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.allowMetaAgentVeto}
                    onChange={(e) => handleSettingChange('allowMetaAgentVeto', e.target.checked)}
                    color="primary"
                  />
                }
                label="Allow Meta-Agent Veto Power"
              />
              <FormHelperText sx={{ mt: 0 }}>
                Enables meta-agents to veto proposals that violate safety or ethical guidelines
              </FormHelperText>
            </Grid>
            
            <Grid item xs={12}>
              <Box display="flex" justifyContent="flex-end" sx={{ mt: 2 }}>
                <Button 
                  variant="contained" 
                  color="primary"
                  startIcon={<SaveIcon />}
                  onClick={handleSaveSettings}
                >
                  Save Settings
                </Button>
              </Box>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>
      
      <Divider sx={{ my: 3 }} />
      
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <SectionHeading variant="h6">Connected Clusters ({connectedClusters.length})</SectionHeading>
        <Button 
          variant="outlined" 
          startIcon={<AddIcon />}
          onClick={() => setShowAddForm(true)}
          disabled={showAddForm}
        >
          Add Cluster
        </Button>
      </Box>
      
      {showAddForm && (
        <Card variant="outlined" sx={{ mb: 3, p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Add New Cluster</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Cluster Name"
                value={newCluster.name}
                onChange={(e) => handleNewClusterChange('name', e.target.value)}
                fullWidth
                error={!!formErrors.name}
                helperText={formErrors.name}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Region"
                value={newCluster.region}
                onChange={(e) => handleNewClusterChange('region', e.target.value)}
                fullWidth
                error={!!formErrors.region}
                helperText={formErrors.region}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="API Endpoint"
                value={newCluster.endpoint}
                onChange={(e) => handleNewClusterChange('endpoint', e.target.value)}
                fullWidth
                placeholder="https://api.cluster-name.example.com"
                error={!!formErrors.endpoint}
                helperText={formErrors.endpoint}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={newCluster.isActive}
                    onChange={(e) => handleNewClusterChange('isActive', e.target.checked)}
                    color="primary"
                  />
                }
                label="Active"
              />
            </Grid>
            <Grid item xs={12}>
              <Box display="flex" justifyContent="flex-end" gap={1}>
                <Button 
                  variant="outlined" 
                  onClick={() => {
                    setShowAddForm(false);
                    setFormErrors({});
                  }}
                  startIcon={<CancelIcon />}
                >
                  Cancel
                </Button>
                <Button 
                  variant="contained" 
                  color="primary"
                  onClick={handleAddNewCluster}
                  startIcon={<SaveIcon />}
                >
                  Add Cluster
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Card>
      )}
      
      {connectedClusters.length === 0 ? (
        <Typography variant="body2" color="textSecondary" sx={{ my: 2 }}>
          No clusters connected yet. Add a cluster to start collaborating.
        </Typography>
      ) : (
        connectedClusters.map((cluster) => (
          <ClusterCard key={cluster.id} variant="outlined">
            <CardContent>
              {editingClusterId === cluster.id ? (
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Cluster Name"
                      value={editForm.name || ''}
                      onChange={(e) => handleEditFormChange('name', e.target.value)}
                      fullWidth
                      error={!!formErrors.name}
                      helperText={formErrors.name}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Region"
                      value={editForm.region || ''}
                      onChange={(e) => handleEditFormChange('region', e.target.value)}
                      fullWidth
                      error={!!formErrors.region}
                      helperText={formErrors.region}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="API Endpoint"
                      value={editForm.endpoint || ''}
                      onChange={(e) => handleEditFormChange('endpoint', e.target.value)}
                      fullWidth
                      error={!!formErrors.endpoint}
                      helperText={formErrors.endpoint}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={editForm.isActive || false}
                          onChange={(e) => handleEditFormChange('isActive', e.target.checked)}
                          color="primary"
                        />
                      }
                      label="Active"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Box display="flex" justifyContent="flex-end" gap={1}>
                      <Button 
                        variant="outlined" 
                        onClick={handleCancelEdit}
                        startIcon={<CancelIcon />}
                      >
                        Cancel
                      </Button>
                      <Button 
                        variant="contained" 
                        color="primary"
                        onClick={handleSaveEdit}
                        startIcon={<SaveIcon />}
                      >
                        Save Changes
                      </Button>
                    </Box>
                  </Grid>
                </Grid>
              ) : (
                <>
                  <ClusterActions>
                    <IconButton 
                      size="small" 
                      onClick={() => startEditingCluster(cluster)}
                      color="primary"
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton 
                      size="small" 
                      onClick={() => handleRemoveCluster(cluster.id)}
                      color="error"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </ClusterActions>
                  
                  <Typography variant="h6" gutterBottom>
                    {cluster.name}
                    {!cluster.isActive && (
                      <Chip 
                        label="Inactive" 
                        size="small" 
                        color="default"
                        sx={{ ml: 1, backgroundColor: 'text.disabled', color: 'white' }}
                      />
                    )}
                  </Typography>
                  
                  <Box sx={{ mb: 1 }}>
                    <RegionChip 
                      label={cluster.region}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    <Chip 
                      label={`Trust: ${cluster.trustScore.toFixed(2)}`}
                      size="small"
                      color={cluster.trustScore >= settings.minTrustThreshold ? "success" : "default"}
                    />
                  </Box>
                  
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" display="block" color="textSecondary">
                        Cluster ID
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {cluster.id}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" display="block" color="textSecondary">
                        Last Synchronized
                      </Typography>
                      <Typography variant="body2">
                        {formatTimestamp(cluster.lastSync)}
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" display="block" color="textSecondary">
                        API Endpoint
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {cluster.endpoint}
                      </Typography>
                    </Grid>
                  </Grid>
                </>
              )}
            </CardContent>
          </ClusterCard>
        ))
      )}
    </StyledPaper>
  );
};

export default FederationSettings; 