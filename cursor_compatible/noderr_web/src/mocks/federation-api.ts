import { rest } from 'msw';
import { FederatedProposal } from '../components/federation/FederatedProposalList';

// Sample cluster data
const clusters = [
  { id: 'cluster-1', name: 'Alpha Cluster', trustScore: 0.92, region: 'US-West' },
  { id: 'cluster-2', name: 'Beta Cluster', trustScore: 0.85, region: 'EU-Central' },
  { id: 'cluster-3', name: 'Gamma Cluster', trustScore: 0.78, region: 'APAC-East' },
  { id: 'cluster-4', name: 'Delta Cluster', trustScore: 0.89, region: 'US-East' },
  { id: 'cluster-5', name: 'Epsilon Cluster', trustScore: 0.73, region: 'EU-North' }
];

// Generate mock vote data
const generateVotes = (proposalId: string, voteCount: number) => {
  const votes = [];
  const positions = ['approve', 'reject', 'abstain'];
  
  for (let i = 0; i < voteCount; i++) {
    const cluster = clusters[i % clusters.length];
    votes.push({
      clusterId: cluster.id,
      cluster: cluster.name,
      trustScore: cluster.trustScore,
      position: positions[Math.floor(Math.random() * 2)], // Mostly approve or reject
      timestamp: new Date(Date.now() - Math.floor(Math.random() * 86400000)).toISOString(),
      reason: `Vote from ${cluster.name} based on regional policy evaluation.`,
      region: cluster.region
    });
  }
  
  return votes;
};

// Create mock proposal data
const mockProposals: FederatedProposal[] = [
  {
    id: 'proposal-001',
    title: 'Standardize Cross-Cluster Authentication Protocol',
    description: 'Implement OAuth 2.0 with JWT as the standard authentication protocol across all federated clusters to enhance security and interoperability.',
    proposer: 'Alpha Cluster',
    createdAt: new Date(Date.now() - 864000000).toISOString(), // 10 days ago
    status: 'active',
    category: 'security',
    deadline: new Date(Date.now() + 432000000).toISOString(), // 5 days from now
    votes: generateVotes('proposal-001', 4),
    metaAgentReview: {
      recommendation: 'approve',
      confidence: 0.89,
      reasoning: 'The proposed authentication protocol aligns with industry best practices and addresses critical security vulnerabilities identified in our last audit.',
      veto: false
    }
  },
  {
    id: 'proposal-002',
    title: 'Resource Allocation Framework Update',
    description: 'Update the resource allocation framework to prioritize critical applications during peak load periods while ensuring fair distribution across all clusters.',
    proposer: 'Beta Cluster',
    createdAt: new Date(Date.now() - 432000000).toISOString(), // 5 days ago
    status: 'active',
    category: 'operations',
    deadline: new Date(Date.now() + 864000000).toISOString(), // 10 days from now
    votes: generateVotes('proposal-002', 3),
    metaAgentReview: {
      recommendation: 'more_info',
      confidence: 0.65,
      reasoning: 'While the proposal addresses important resource management issues, it lacks specific metrics for determining criticality of applications. More details needed on the scoring system.',
      veto: false
    }
  },
  {
    id: 'proposal-003',
    title: 'Data Compliance Policy for EU Regions',
    description: 'Implement additional data protection measures for clusters operating in EU regions to ensure compliance with GDPR and upcoming EU AI regulations.',
    proposer: 'Epsilon Cluster',
    createdAt: new Date(Date.now() - 345600000).toISOString(), // 4 days ago
    status: 'active',
    category: 'compliance',
    deadline: new Date(Date.now() + 604800000).toISOString(), // 7 days from now
    votes: generateVotes('proposal-003', 5),
    metaAgentReview: {
      recommendation: 'approve',
      confidence: 0.93,
      reasoning: 'Proposal provides comprehensive compliance measures that meet or exceed all current EU regulations, with sufficient flexibility for forthcoming regulatory changes.',
      veto: false
    }
  },
  {
    id: 'proposal-004',
    title: 'Implement Federation-wide Anomaly Detection System',
    description: 'Deploy an advanced anomaly detection system that correlates data across all federated clusters to identify potential security threats and operational issues.',
    proposer: 'Gamma Cluster',
    createdAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
    status: 'active',
    category: 'security',
    deadline: new Date(Date.now() + 1209600000).toISOString(), // 14 days from now
    votes: generateVotes('proposal-004', 2),
    metaAgentReview: null // No meta-agent review yet
  },
  {
    id: 'proposal-005',
    title: 'Trust Score Algorithm Enhancement',
    description: 'Enhance the trust score calculation algorithm to include more fine-grained behavioral analysis and historical compliance factors.',
    proposer: 'Delta Cluster',
    createdAt: new Date(Date.now() - 518400000).toISOString(), // 6 days ago
    status: 'completed',
    category: 'governance',
    deadline: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    votes: generateVotes('proposal-005', 5),
    metaAgentReview: {
      recommendation: 'approve',
      confidence: 0.91,
      reasoning: 'The algorithm enhancements are mathematically sound and provide a more accurate representation of trust relationships within the federation.',
      veto: false
    },
    outcome: {
      result: 'approved',
      implementationDate: new Date(Date.now() + 259200000).toISOString(), // 3 days from now
      voteSummary: {
        approve: 4,
        reject: 1,
        abstain: 0,
        weightedScore: 0.83
      }
    }
  },
  {
    id: 'proposal-006',
    title: 'Emergency Protocol Override Mechanism',
    description: 'Establish a secure mechanism for emergency protocol overrides when critical systems are compromised or during disaster recovery scenarios.',
    proposer: 'Alpha Cluster',
    createdAt: new Date(Date.now() - 691200000).toISOString(), // 8 days ago
    status: 'rejected',
    category: 'security',
    deadline: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
    votes: generateVotes('proposal-006', 5),
    metaAgentReview: {
      recommendation: 'reject',
      confidence: 0.87,
      reasoning: 'The proposed override mechanism creates significant security vulnerabilities that outweigh the potential benefits during emergency scenarios.',
      veto: true
    },
    outcome: {
      result: 'rejected',
      implementationDate: null,
      voteSummary: {
        approve: 2,
        reject: 3,
        abstain: 0,
        weightedScore: 0.42
      }
    }
  }
];

export const federationHandlers = [
  // Get all proposals
  rest.get('/api/federation/proposals', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        proposals: mockProposals,
        totalCount: mockProposals.length
      })
    );
  }),
  
  // Get single proposal by ID
  rest.get('/api/federation/proposals/:id', (req, res, ctx) => {
    const { id } = req.params;
    const proposal = mockProposals.find(p => p.id === id);
    
    if (!proposal) {
      return res(
        ctx.status(404),
        ctx.json({ error: 'Proposal not found' })
      );
    }
    
    return res(
      ctx.status(200),
      ctx.json({ proposal })
    );
  }),
  
  // Get federation clusters
  rest.get('/api/federation/clusters', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({ clusters })
    );
  }),
  
  // Cast a vote (mock endpoint)
  rest.post('/api/federation/proposals/:id/vote', async (req, res, ctx) => {
    const { id } = req.params;
    const proposalIndex = mockProposals.findIndex(p => p.id === id);
    
    if (proposalIndex === -1) {
      return res(
        ctx.status(404),
        ctx.json({ error: 'Proposal not found' })
      );
    }
    
    // In a real implementation, we would validate the vote and update the database
    return res(
      ctx.status(200),
      ctx.json({ 
        success: true,
        message: 'Vote recorded successfully'
      })
    );
  })
];

// Helper function to initialize mock WebSocket
export const initMockWebSocket = () => {
  // This would normally be implemented in your mock service worker setup
  // For now, this is just a placeholder
  console.log('Mock WebSocket initialized for federation updates');
}; 