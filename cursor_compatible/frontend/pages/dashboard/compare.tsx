/**
 * Agent Comparison Dashboard Page
 */

import React, { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AgentComparisonDashboard } from '../../components/dashboard/AgentComparisonDashboard';

// Import styles
import '../../styles/dashboard.css';

interface ComparePageProps {
  apiUrl?: string;
  wsUrl?: string;
}

/**
 * Compare page for agent comparison dashboard
 */
export default function ComparePage({
  apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'
}: ComparePageProps) {
  // Get router for query params
  const router = useRouter();
  const { query } = router;
  
  // Extract query params
  const agentIds = Array.isArray(query.agents)
    ? query.agents
    : query.agents
      ? [query.agents as string]
      : [];
  
  // Update URL with selected agents
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Add page view event
      const trackPageView = () => {
        try {
          // Initialize analytics if available
          if ((window as any).analytics) {
            (window as any).analytics.page('Agent Comparison Dashboard');
          }
        } catch (error) {
          console.error('Error tracking page view:', error);
        }
      };
      
      trackPageView();
    }
  }, []);
  
  return (
    <>
      <Head>
        <title>Agent Comparison Dashboard | Noderr</title>
        <meta name="description" content="Compare multiple trading agents side-by-side" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <AgentComparisonDashboard
        apiUrl={apiUrl}
        wsUrl={wsUrl}
        initialAgentIds={agentIds}
      />
    </>
  );
}

/**
 * Server-side props (optional)
 */
export async function getServerSideProps() {
  return {
    props: {
      apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
      wsUrl: process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'
    }
  };
} 