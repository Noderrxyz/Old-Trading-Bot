/**
 * Swarm Evolution Visualizer
 * 
 * React component to visualize agent lineage and evolution.
 * Uses a graph-based visualization for evolutionary trees.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AgentLineageGraph, AgentLineage } from '../../types/agent.types';
import * as d3 from 'd3';

/**
 * Properties for the SwarmEvolutionVisualizer component
 */
interface SwarmEvolutionVisualizerProps {
  /** Lineage graph data to visualize */
  data: AgentLineageGraph;
  
  /** Width of the visualization */
  width?: number;
  
  /** Height of the visualization */
  height?: number;
  
  /** Whether to enable zooming and panning */
  enableZoom?: boolean;
  
  /** Optional callback when a node is clicked */
  onNodeClick?: (agentId: string) => void;
  
  /** Optional callback when an edge is clicked */
  onEdgeClick?: (sourceId: string, targetId: string) => void;
}

/**
 * Node data with position for visualization
 */
interface NodeData extends AgentLineage {
  x?: number;
  y?: number;
  radius?: number;
  color?: string;
}

/**
 * Edge data with position for visualization
 */
interface EdgeData {
  source: string | NodeData;
  target: string | NodeData;
  mutationType: string;
  color?: string;
}

/**
 * Visualizes agent evolution and lineage as an interactive graph
 */
const SwarmEvolutionVisualizer: React.FC<SwarmEvolutionVisualizerProps> = ({
  data,
  width = 800,
  height = 600,
  enableZoom = true,
  onNodeClick,
  onEdgeClick
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  
  // Convert data to D3 compatible format
  const nodes: NodeData[] = data.nodes.map(node => ({
    ...node,
    radius: 10,
    color: getNodeColor(node)
  }));
  
  const edges: EdgeData[] = data.edges.map(edge => ({
    ...edge,
    color: getEdgeColor(edge.mutationType)
  }));
  
  // Function to determine node color based on properties
  function getNodeColor(node: AgentLineage): string {
    // Color by generation or cluster
    const generationColors = [
      '#4285F4', // Blue
      '#34A853', // Green
      '#FBBC05', // Yellow
      '#EA4335', // Red
      '#8F00FF', // Purple
      '#FF6D01', // Orange
      '#00C9A7', // Teal
    ];
    
    return generationColors[node.generation % generationColors.length];
  }
  
  // Function to determine edge color based on mutation type
  function getEdgeColor(mutationType: string): string {
    const mutationColors: Record<string, string> = {
      'performance_optimization': '#34A853', // Green
      'market_specialization': '#4285F4', // Blue
      'risk_adjustment': '#FBBC05', // Yellow
      'underperformance_remediation': '#EA4335', // Red
      'cluster_divergence': '#8F00FF', // Purple
      'hybrid_formation': '#FF6D01', // Orange
    };
    
    return mutationColors[mutationType] || '#CCCCCC'; // Gray default
  }
  
  // Generate the visualization using D3
  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;
    
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    
    // Create a container for the graph
    const container = svg.append('g');
    
    // Set up zoom behavior
    if (enableZoom) {
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          container.attr('transform', event.transform);
        });
      
      svg.call(zoom);
    }
    
    // Create a force simulation for positioning nodes
    const simulation = d3.forceSimulation<NodeData>(nodes)
      .force('link', d3.forceLink<NodeData, EdgeData>(edges)
        .id(d => d.agentId)
        .distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(20));
    
    // Draw the edges
    const edgeElements = container.append('g')
      .selectAll('line')
      .data(edges)
      .enter()
      .append('line')
      .attr('stroke', d => d.color || '#CCCCCC')
      .attr('stroke-width', 2)
      .on('click', (event, d) => {
        if (onEdgeClick && typeof d.source !== 'string' && typeof d.target !== 'string') {
          onEdgeClick(d.source.agentId, d.target.agentId);
        }
      });
    
    // Draw the nodes
    const nodeElements = container.append('g')
      .selectAll('circle')
      .data(nodes)
      .enter()
      .append('circle')
      .attr('r', d => d.radius || 10)
      .attr('fill', d => d.color || '#4285F4')
      .on('click', (event, d) => {
        setHighlightedNode(d.agentId);
        if (onNodeClick) {
          onNodeClick(d.agentId);
        }
      })
      .call(d3.drag<SVGCircleElement, NodeData>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );
    
    // Add labels to nodes
    const textElements = container.append('g')
      .selectAll('text')
      .data(nodes)
      .enter()
      .append('text')
      .text(d => d.agentId.substring(0, 8))
      .attr('font-size', 10)
      .attr('dx', 15)
      .attr('dy', 4)
      .attr('pointer-events', 'none');
    
    // Add tooltips
    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'tooltip')
      .style('position', 'absolute')
      .style('background', 'white')
      .style('border', '1px solid #ddd')
      .style('border-radius', '4px')
      .style('padding', '10px')
      .style('pointer-events', 'none')
      .style('opacity', 0);
    
    nodeElements
      .on('mouseover', (event, d) => {
        tooltip
          .style('opacity', 1)
          .html(`
            <div>
              <strong>Agent:</strong> ${d.agentId}<br/>
              <strong>Generation:</strong> ${d.generation}<br/>
              <strong>Cluster:</strong> ${d.clusterId}<br/>
              <strong>Mutation:</strong> ${d.mutationReason}<br/>
              <strong>Created:</strong> ${new Date(d.createdAt).toLocaleString()}<br/>
            </div>
          `);
      })
      .on('mousemove', (event) => {
        tooltip
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY + 10) + 'px');
      })
      .on('mouseout', () => {
        tooltip.style('opacity', 0);
      });
    
    // Update positions during simulation
    simulation.on('tick', () => {
      edgeElements
        .attr('x1', d => (d.source as NodeData).x || 0)
        .attr('y1', d => (d.source as NodeData).y || 0)
        .attr('x2', d => (d.target as NodeData).x || 0)
        .attr('y2', d => (d.target as NodeData).y || 0);
      
      nodeElements
        .attr('cx', d => d.x || 0)
        .attr('cy', d => d.y || 0);
      
      textElements
        .attr('x', d => d.x || 0)
        .attr('y', d => d.y || 0);
    });
    
    // Clean up on unmount
    return () => {
      simulation.stop();
      d3.select('body').selectAll('.tooltip').remove();
    };
  }, [data, width, height, enableZoom, onNodeClick, onEdgeClick, highlightedNode]);
  
  return (
    <div className="swarm-evolution-visualizer">
      <svg ref={svgRef} width={width} height={height} />
    </div>
  );
};

export default SwarmEvolutionVisualizer; 