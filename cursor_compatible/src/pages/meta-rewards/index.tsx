import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Box,
  Heading,
  Text,
  Flex,
  Spinner,
  Card,
  CardBody,
  CardHeader,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Select,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Grid,
  GridItem,
  SimpleGrid,
  useColorModeValue,
  Button,
} from '@chakra-ui/react';
import { 
  ForceGraph2D, 
  // @ts-ignore
} from 'react-force-graph';
import MainLayout from '../../components/layout/MainLayout';

// Types
interface ReinforcementGraphData {
  nodes: {
    id: string;
    trust: number;
    reinforcementScore: number;
    clusterIds: string[];
  }[];
  edges: {
    source: string;
    target: string;
    strength: number;
    contextType: string;
    timestamp: number;
  }[];
  clusters: {
    id: string;
    members: string[];
    averageAgreement: number;
    density: number;
    dominantContexts: string[];
  }[];
}

interface RewardEvent {
  id: string;
  rewardVectorId: string;
  sourceAgentId: string;
  targetAgentId: string;
  timestamp: number;
  value: number;
  isVerified: boolean;
}

interface AgentInfluence {
  agentId: string;
  baseScore: number;
  boostMultiplier: number;
  effectiveInfluence: number;
  lastCalculated: number;
}

// Main Page Component
const MetaRewardsDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [graphData, setGraphData] = useState<ReinforcementGraphData | null>(null);
  const [recentRewards, setRecentRewards] = useState<RewardEvent[]>([]);
  const [topAgents, setTopAgents] = useState<{id: string, score: number}[]>([]);
  const [influenceData, setInfluenceData] = useState<AgentInfluence[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  
  const cardBg = useColorModeValue('white', 'gray.700');
  const borderColor = useColorModeValue('gray.200', 'gray.600');
  
  // Initialize force graph ref
  const graphRef = React.useRef();
  
  useEffect(() => {
    // Fetch dashboard data
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch reinforcement graph
        const graphResponse = await axios.get('/api/meta-rewards/graph');
        setGraphData(graphResponse.data);
        
        // Fetch recent reward events
        const rewardsResponse = await axios.get('/api/meta-rewards/recent');
        setRecentRewards(rewardsResponse.data);
        
        // Fetch top agents by influence
        const influenceResponse = await axios.get('/api/meta-rewards/influence');
        
        // Sort agents by effective influence
        const sortedAgents = influenceResponse.data
          .sort((a: AgentInfluence, b: AgentInfluence) => 
            b.effectiveInfluence - a.effectiveInfluence);
        
        setInfluenceData(sortedAgents);
        
        // Top 10 agents
        setTopAgents(sortedAgents.slice(0, 10).map((a: AgentInfluence) => ({
          id: a.agentId,
          score: a.effectiveInfluence
        })));
      } catch (error) {
        console.error('Error fetching dashboard data', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
    
    // Refresh data periodically
    const intervalId = setInterval(fetchData, 5 * 60 * 1000); // every 5 minutes
    
    return () => clearInterval(intervalId);
  }, []);
  
  // Prepare the graph data for force graph
  const prepareGraphData = () => {
    if (!graphData) return { nodes: [], links: [] };
    
    // Map nodes with additional visual properties
    const nodes = graphData.nodes.map(node => {
      // Calculate node radius based on trust and reinforcement
      const radius = 5 + (node.trust / 20) + (node.reinforcementScore / 5);
      
      // Determine color based on cluster membership
      let color = '#999999'; // Default gray
      
      if (selectedCluster && node.clusterIds.includes(selectedCluster)) {
        color = '#4299E1'; // Blue for selected cluster
      } else if (node.clusterIds.length > 0) {
        // Generate predictable color based on first cluster ID
        const clusterId = parseInt(node.clusterIds[0].replace('cluster-', ''));
        const hue = (clusterId * 137) % 360; // Golden ratio approach for distinct colors
        color = `hsl(${hue}, 70%, 60%)`;
      }
      
      return {
        ...node,
        radius,
        color
      };
    });
    
    // Map edges to links
    const links = graphData.edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      value: edge.strength,
      color: `rgba(150, 150, 150, ${edge.strength * 0.7})`,
      width: 1 + edge.strength * 3
    }));
    
    return { nodes, links };
  };
  
  // Find cluster info by ID
  const getClusterInfo = (clusterId: string) => {
    if (!graphData) return null;
    return graphData.clusters.find(c => c.id === clusterId);
  };
  
  // Format timestamp to readable date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };
  
  // Render loading spinner
  if (loading) {
    return (
      <MainLayout>
        <Flex justify="center" align="center" height="80vh">
          <Spinner size="xl" />
        </Flex>
      </MainLayout>
    );
  }
  
  return (
    <MainLayout>
      <Box p={4}>
        <Heading as="h1" size="xl" mb={6}>
          Meta-Rewards & Agent Reinforcement Dashboard
        </Heading>
        
        <Tabs variant="enclosed" colorScheme="blue" mb={6}>
          <TabList>
            <Tab>Overview</Tab>
            <Tab>Reinforcement Graph</Tab>
            <Tab>Agent Clusters</Tab>
            <Tab>Recent Activities</Tab>
          </TabList>
          
          <TabPanels>
            {/* Overview Panel */}
            <TabPanel>
              <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4} mb={8}>
                <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                  <CardBody>
                    <Stat>
                      <StatLabel>Total Agents</StatLabel>
                      <StatNumber>{graphData?.nodes.length || 0}</StatNumber>
                      <StatHelpText>In reinforcement network</StatHelpText>
                    </Stat>
                  </CardBody>
                </Card>
                
                <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                  <CardBody>
                    <Stat>
                      <StatLabel>Active Clusters</StatLabel>
                      <StatNumber>{graphData?.clusters.length || 0}</StatNumber>
                      <StatHelpText>Cooperative agent groups</StatHelpText>
                    </Stat>
                  </CardBody>
                </Card>
                
                <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                  <CardBody>
                    <Stat>
                      <StatLabel>Reinforcement Links</StatLabel>
                      <StatNumber>{graphData?.edges.length || 0}</StatNumber>
                      <StatHelpText>Trust relationships</StatHelpText>
                    </Stat>
                  </CardBody>
                </Card>
                
                <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                  <CardBody>
                    <Stat>
                      <StatLabel>Recent Rewards</StatLabel>
                      <StatNumber>{recentRewards.length}</StatNumber>
                      <StatHelpText>In the last 24 hours</StatHelpText>
                    </Stat>
                  </CardBody>
                </Card>
              </SimpleGrid>
              
              <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={6}>
                {/* Top Influential Agents */}
                <GridItem>
                  <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                    <CardHeader>
                      <Heading size="md">Top Influential Agents</Heading>
                    </CardHeader>
                    <CardBody>
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>Agent ID</Th>
                            <Th isNumeric>Influence Score</Th>
                            <Th>Boost</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {topAgents.map((agent) => (
                            <Tr key={agent.id}>
                              <Td>{agent.id}</Td>
                              <Td isNumeric>{agent.score.toFixed(3)}</Td>
                              <Td>
                                {influenceData.find(a => a.agentId === agent.id)?.boostMultiplier > 1 && (
                                  <Badge colorScheme="green">Active</Badge>
                                )}
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </CardBody>
                  </Card>
                </GridItem>
                
                {/* Recent Reward Events */}
                <GridItem>
                  <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                    <CardHeader>
                      <Heading size="md">Recent Reward Events</Heading>
                    </CardHeader>
                    <CardBody>
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>Type</Th>
                            <Th>Recipient</Th>
                            <Th isNumeric>Value</Th>
                            <Th>Status</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {recentRewards.slice(0, 5).map((reward) => (
                            <Tr key={reward.id}>
                              <Td>{reward.rewardVectorId}</Td>
                              <Td>{reward.targetAgentId}</Td>
                              <Td isNumeric>{reward.value.toFixed(1)}</Td>
                              <Td>
                                {reward.isVerified ? (
                                  <Badge colorScheme="green">Verified</Badge>
                                ) : (
                                  <Badge colorScheme="orange">Pending</Badge>
                                )}
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </CardBody>
                  </Card>
                </GridItem>
              </Grid>
            </TabPanel>
            
            {/* Reinforcement Graph Panel */}
            <TabPanel>
              <Card bg={cardBg} borderWidth="1px" borderColor={borderColor} mb={4}>
                <CardHeader>
                  <Heading size="md">Agent Reinforcement Network</Heading>
                </CardHeader>
                <CardBody>
                  <Flex direction="column">
                    <Box mb={4}>
                      <Select 
                        placeholder="Filter by cluster" 
                        value={selectedCluster || ""} 
                        onChange={(e) => setSelectedCluster(e.target.value || null)}
                        mb={2}
                      >
                        <option value="">All clusters</option>
                        {graphData?.clusters.map(cluster => (
                          <option key={cluster.id} value={cluster.id}>
                            {cluster.id} ({cluster.members.length} agents)
                          </option>
                        ))}
                      </Select>
                      
                      <Text fontSize="sm" color="gray.500">
                        Hover over nodes to see agent details. Click and drag to reposition.
                      </Text>
                    </Box>
                    
                    <Box height="600px" border="1px solid" borderColor={borderColor} borderRadius="md">
                      {graphData && (
                        <ForceGraph2D
                          ref={graphRef}
                          graphData={prepareGraphData()}
                          nodeLabel={(node: any) => `Agent: ${node.id}\nTrust: ${node.trust.toFixed(1)}\nReinforcement: ${node.reinforcementScore.toFixed(1)}`}
                          linkLabel={(link: any) => `Strength: ${link.value.toFixed(2)}`}
                          nodeRelSize={6}
                          nodeVal={(node: any) => node.radius}
                          nodeColor={(node: any) => node.color}
                          linkWidth={(link: any) => link.width}
                          linkColor={(link: any) => link.color}
                          cooldownTicks={100}
                          onEngineStop={() => console.log('Graph layout stabilized')}
                        />
                      )}
                    </Box>
                  </Flex>
                </CardBody>
              </Card>
              
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                  <CardHeader>
                    <Heading size="sm">Node Color Legend</Heading>
                  </CardHeader>
                  <CardBody>
                    <Flex direction="column" gap={2}>
                      <Flex align="center">
                        <Box width="16px" height="16px" borderRadius="full" bg="#999999" mr={2} />
                        <Text fontSize="sm">No cluster</Text>
                      </Flex>
                      <Flex align="center">
                        <Box width="16px" height="16px" borderRadius="full" bg="#4299E1" mr={2} />
                        <Text fontSize="sm">Selected cluster</Text>
                      </Flex>
                      <Flex align="center">
                        <Box width="16px" height="16px" borderRadius="full" bg="green.400" mr={2} />
                        <Text fontSize="sm">High trust agents</Text>
                      </Flex>
                    </Flex>
                  </CardBody>
                </Card>
                
                <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                  <CardHeader>
                    <Heading size="sm">Node Size</Heading>
                  </CardHeader>
                  <CardBody>
                    <Text fontSize="sm">
                      Node size is based on a combination of agent trust score and total reinforcement received from other agents.
                    </Text>
                    <Flex mt={2} align="center">
                      <Box width="8px" height="8px" borderRadius="full" bg="gray.400" mr={2} />
                      <Text fontSize="sm">Small: Low trust and reinforcement</Text>
                    </Flex>
                    <Flex align="center">
                      <Box width="16px" height="16px" borderRadius="full" bg="gray.400" mr={2} />
                      <Text fontSize="sm">Medium: Average trust</Text>
                    </Flex>
                    <Flex align="center">
                      <Box width="24px" height="24px" borderRadius="full" bg="gray.400" mr={2} />
                      <Text fontSize="sm">Large: High trust and reinforcement</Text>
                    </Flex>
                  </CardBody>
                </Card>
                
                <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                  <CardHeader>
                    <Heading size="sm">Edge Thickness</Heading>
                  </CardHeader>
                  <CardBody>
                    <Text fontSize="sm">
                      Edge thickness represents the strength of reinforcement between two agents.
                      Thicker edges indicate stronger cooperation and mutual reinforcement.
                    </Text>
                  </CardBody>
                </Card>
              </SimpleGrid>
            </TabPanel>
            
            {/* Agent Clusters Panel */}
            <TabPanel>
              <Grid templateColumns={{ base: '1fr', lg: '1fr 2fr' }} gap={6}>
                <GridItem>
                  <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                    <CardHeader>
                      <Heading size="md">Agent Clusters</Heading>
                    </CardHeader>
                    <CardBody>
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>ID</Th>
                            <Th isNumeric>Size</Th>
                            <Th isNumeric>Density</Th>
                            <Th>Actions</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {graphData?.clusters.map(cluster => (
                            <Tr 
                              key={cluster.id} 
                              bg={selectedCluster === cluster.id ? 'blue.50' : undefined}
                              _dark={{
                                bg: selectedCluster === cluster.id ? 'blue.900' : undefined
                              }}
                            >
                              <Td>{cluster.id}</Td>
                              <Td isNumeric>{cluster.members.length}</Td>
                              <Td isNumeric>{(cluster.density * 100).toFixed(1)}%</Td>
                              <Td>
                                <Button 
                                  size="xs" 
                                  colorScheme={selectedCluster === cluster.id ? 'blue' : 'gray'}
                                  onClick={() => setSelectedCluster(
                                    selectedCluster === cluster.id ? null : cluster.id
                                  )}
                                >
                                  {selectedCluster === cluster.id ? 'Deselect' : 'View'}
                                </Button>
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </CardBody>
                  </Card>
                </GridItem>
                
                <GridItem>
                  {selectedCluster ? (
                    <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                      <CardHeader>
                        <Heading size="md">Cluster {selectedCluster}</Heading>
                      </CardHeader>
                      <CardBody>
                        {(() => {
                          const cluster = getClusterInfo(selectedCluster);
                          if (!cluster) return <Text>Cluster not found</Text>;
                          
                          return (
                            <Box>
                              <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={4}>
                                <Stat>
                                  <StatLabel>Member Count</StatLabel>
                                  <StatNumber>{cluster.members.length}</StatNumber>
                                </Stat>
                                <Stat>
                                  <StatLabel>Avg Agreement</StatLabel>
                                  <StatNumber>{(cluster.averageAgreement * 100).toFixed(1)}%</StatNumber>
                                </Stat>
                                <Stat>
                                  <StatLabel>Cluster Density</StatLabel>
                                  <StatNumber>{(cluster.density * 100).toFixed(1)}%</StatNumber>
                                </Stat>
                              </SimpleGrid>
                              
                              <Box mb={4}>
                                <Heading size="sm" mb={2}>Dominant Contexts</Heading>
                                <Flex gap={2}>
                                  {cluster.dominantContexts.map(context => (
                                    <Badge key={context} colorScheme="blue" p={1}>
                                      {context}
                                    </Badge>
                                  ))}
                                </Flex>
                              </Box>
                              
                              <Heading size="sm" mb={2}>Cluster Members</Heading>
                              <Box maxH="300px" overflowY="auto">
                                <Table variant="simple" size="sm">
                                  <Thead>
                                    <Tr>
                                      <Th>Agent ID</Th>
                                      <Th isNumeric>Trust</Th>
                                      <Th isNumeric>Reinforcement</Th>
                                    </Tr>
                                  </Thead>
                                  <Tbody>
                                    {cluster.members.map(memberId => {
                                      const node = graphData?.nodes.find(n => n.id === memberId);
                                      return (
                                        <Tr key={memberId}>
                                          <Td>{memberId}</Td>
                                          <Td isNumeric>{node?.trust.toFixed(1) || 'N/A'}</Td>
                                          <Td isNumeric>{node?.reinforcementScore.toFixed(1) || 'N/A'}</Td>
                                        </Tr>
                                      );
                                    })}
                                  </Tbody>
                                </Table>
                              </Box>
                            </Box>
                          );
                        })()}
                      </CardBody>
                    </Card>
                  ) : (
                    <Flex 
                      justify="center" 
                      align="center" 
                      height="100%" 
                      bg={cardBg} 
                      borderWidth="1px" 
                      borderColor={borderColor}
                      borderRadius="md"
                      p={8}
                    >
                      <Text color="gray.500">Select a cluster to view details</Text>
                    </Flex>
                  )}
                </GridItem>
              </Grid>
            </TabPanel>
            
            {/* Recent Activities Panel */}
            <TabPanel>
              <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                <CardHeader>
                  <Heading size="md">Recent Reward Activities</Heading>
                </CardHeader>
                <CardBody>
                  <Table variant="simple">
                    <Thead>
                      <Tr>
                        <Th>Timestamp</Th>
                        <Th>Reward Type</Th>
                        <Th>Source</Th>
                        <Th>Recipient</Th>
                        <Th isNumeric>Value</Th>
                        <Th>Status</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {recentRewards.map(reward => (
                        <Tr key={reward.id}>
                          <Td>{formatDate(reward.timestamp)}</Td>
                          <Td>{reward.rewardVectorId}</Td>
                          <Td>{reward.sourceAgentId}</Td>
                          <Td>{reward.targetAgentId}</Td>
                          <Td isNumeric>{reward.value.toFixed(1)}</Td>
                          <Td>
                            {reward.isVerified ? (
                              <Badge colorScheme="green">Verified</Badge>
                            ) : (
                              <Badge colorScheme="orange">Pending</Badge>
                            )}
                          </Td>
                        </Tr>
                      ))}
                      {recentRewards.length === 0 && (
                        <Tr>
                          <Td colSpan={6} textAlign="center" py={4}>
                            No recent reward activities found.
                          </Td>
                        </Tr>
                      )}
                    </Tbody>
                  </Table>
                </CardBody>
              </Card>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </MainLayout>
  );
};

export default MetaRewardsDashboard; 