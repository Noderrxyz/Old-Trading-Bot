/**
 * Governance API Routes
 * 
 * Exposes endpoints for managing agent governance roles.
 */

import express from 'express';
import { createMockRedisClient } from '../../common/redis.js';
import { GovernanceService } from '../../agents/governance/service.js';
import { GovernanceRole } from '../../agents/governance/models.js';

// Create router
const router = express.Router();
const redis = createMockRedisClient();
const governanceService = new GovernanceService(redis);

/**
 * GET /governance/roles
 * 
 * Get all role assignments
 */
router.get('/roles', async (req, res) => {
  try {
    const roleMap = await governanceService.getAllRoleAssignments();
    
    // Convert Map to object for JSON response
    const result: Record<string, string[]> = {};
    for (const [role, agents] of roleMap.entries()) {
      result[role] = agents;
    }
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to get role assignments: ${error.message}`
    });
  }
});

/**
 * GET /governance/roles/:role
 * 
 * Get agents with a specific role
 */
router.get('/roles/:role', async (req, res) => {
  try {
    const { role } = req.params;
    
    // Validate role
    const validRoles = Object.values(GovernanceRole);
    if (!validRoles.includes(role as GovernanceRole)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role: ${role}. Valid roles: ${validRoles.join(', ')}`
      });
    }
    
    const agents = await governanceService.getAgentsWithRole(role);
    
    res.json({
      success: true,
      data: {
        role,
        agents,
        count: agents.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to get agents for role: ${error.message}`
    });
  }
});

/**
 * GET /governance/agents/:agentId/role
 * 
 * Get the role of a specific agent
 */
router.get('/agents/:agentId/role', async (req, res) => {
  try {
    const { agentId } = req.params;
    const role = await governanceService.getAgentRole(agentId);
    
    if (!role) {
      return res.status(404).json({
        success: false,
        error: `Agent ${agentId} doesn't have a role assigned`
      });
    }
    
    res.json({
      success: true,
      data: {
        agentId,
        role
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to get agent role: ${error.message}`
    });
  }
});

/**
 * GET /governance/agents/:agentId/history
 * 
 * Get role assignment history for an agent
 */
router.get('/agents/:agentId/history', async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    
    const history = await governanceService.getRoleHistory(agentId, limit);
    
    res.json({
      success: true,
      data: {
        agentId,
        history
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to get role history: ${error.message}`
    });
  }
});

/**
 * POST /governance/agents/:agentId/role
 * 
 * Assign a role to an agent
 */
router.post('/agents/:agentId/role', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { role, reason } = req.body;
    
    if (!role) {
      return res.status(400).json({
        success: false,
        error: 'Role is required'
      });
    }
    
    // Validate role
    const validRoles = Object.values(GovernanceRole);
    if (!validRoles.includes(role as GovernanceRole)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role: ${role}. Valid roles: ${validRoles.join(', ')}`
      });
    }
    
    const currentRole = await governanceService.getAgentRole(agentId);
    await governanceService.assignRole(agentId, role, reason || 'API assignment', 'api');
    
    res.json({
      success: true,
      data: {
        agentId,
        previousRole: currentRole,
        newRole: role
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to assign role: ${error.message}`
    });
  }
});

/**
 * DELETE /governance/agents/:agentId/role
 * 
 * Remove a role from an agent
 */
router.delete('/agents/:agentId/role', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { reason } = req.body;
    
    const currentRole = await governanceService.getAgentRole(agentId);
    
    if (!currentRole) {
      return res.status(404).json({
        success: false,
        error: `Agent ${agentId} doesn't have a role assigned`
      });
    }
    
    await governanceService.removeRole(agentId, reason || 'API removal');
    
    res.json({
      success: true,
      data: {
        agentId,
        removedRole: currentRole
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to remove role: ${error.message}`
    });
  }
});

export default router; 