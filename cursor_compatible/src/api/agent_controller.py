"""
Agent Controller API

FastAPI routes for agent control and management.
Provides endpoints for listing, pausing, resuming, and configuring agents.
"""

import os
import json
from typing import Dict, List, Optional, Any, Union
from fastapi import FastAPI, HTTPException, Depends, Header, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import redis.asyncio as redis
import asyncio
import uuid
import jwt
from datetime import datetime, timedelta

# Setup FastAPI app
agent_app = FastAPI(title="Agent Controller API", description="API for controlling trading agents")

# Add CORS middleware
agent_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with actual origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Redis connection
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
redis_pool = redis.ConnectionPool.from_url(REDIS_URL)

# JWT settings
JWT_SECRET = os.environ.get("JWT_SECRET", "your-secret-key")  # Change in production
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

# WebSocket connections
active_connections: Dict[str, WebSocket] = {}

# -------------------
# Pydantic Models
# -------------------

class AgentBase(BaseModel):
    """Base model for agent operations"""
    agentId: str


class AgentConfigUpdate(AgentBase):
    """Model for agent configuration updates"""
    config: Dict[str, Any]


class AgentStatus(BaseModel):
    """Model for agent status response"""
    success: bool
    message: str


class AgentPanelState(BaseModel):
    """Agent panel state model"""
    agentId: str
    name: Optional[str] = None
    status: str = Field(..., description="Agent status: running, paused, or canary")
    lastSignal: int = 0
    pnl24h: float = 0.0
    actions: List[str] = []
    tags: Optional[List[str]] = None
    lastUpdated: int = Field(default_factory=lambda: int(datetime.now().timestamp() * 1000))


class TokenResponse(BaseModel):
    """JWT token response"""
    access_token: str
    token_type: str = "bearer"


# -------------------
# Helper Functions
# -------------------

async def get_redis() -> redis.Redis:
    """Get Redis connection from pool"""
    r = redis.Redis(connection_pool=redis_pool)
    try:
        yield r
    finally:
        await r.close()


async def create_access_token(data: dict) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt


async def verify_token(authorization: str = Header(...)) -> dict:
    """Verify JWT token from header"""
    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid authentication scheme")
        
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authorization header")


async def publish_agent_event(redis_client: redis.Redis, event_type: str, agent_id: str, data: dict = None):
    """Publish agent event to Redis pubsub"""
    message = {
        "type": event_type,
        "agentId": agent_id,
        "timestamp": int(datetime.now().timestamp() * 1000)
    }
    
    if data:
        message.update(data)
    
    await redis_client.publish(
        f"agent_events",
        json.dumps(message)
    )


async def broadcast_websocket_message(message: dict):
    """Broadcast message to all connected WebSocket clients"""
    disconnected = []
    
    for client_id, websocket in active_connections.items():
        try:
            await websocket.send_json(message)
        except Exception:
            disconnected.append(client_id)
    
    # Clean up disconnected clients
    for client_id in disconnected:
        active_connections.pop(client_id, None)


# -------------------
# WebSocket Routes
# -------------------

@agent_app.websocket("/ws/agents")
async def websocket_agent_events(websocket: WebSocket):
    """WebSocket endpoint for real-time agent events"""
    await websocket.accept()
    
    # Generate a client ID for this connection
    client_id = str(uuid.uuid4())
    active_connections[client_id] = websocket
    
    # Subscribe to Redis pubsub for agent events
    redis_client = redis.Redis(connection_pool=redis_pool)
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("agent_events")
    
    try:
        # Send initial connection message
        await websocket.send_json({
            "type": "connection_established",
            "clientId": client_id
        })
        
        # Process messages in background task
        async def process_redis_messages():
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        await websocket.send_json(data)
                    except Exception as e:
                        await websocket.send_json({
                            "type": "error", 
                            "message": str(e)
                        })
        
        # Start message processing task
        task = asyncio.create_task(process_redis_messages())
        
        # Wait for websocket to disconnect
        while True:
            data = await websocket.receive_text()
            # For now, we don't process incoming messages
        
    except WebSocketDisconnect:
        active_connections.pop(client_id, None)
        await pubsub.unsubscribe("agent_events")
        await redis_client.close()
    except Exception as e:
        active_connections.pop(client_id, None)
        await pubsub.unsubscribe("agent_events")
        await redis_client.close()
        print(f"WebSocket error: {e}")


# -------------------
# Auth Routes
# -------------------

@agent_app.post("/auth/token", response_model=TokenResponse)
async def login_for_access_token(username: str = Header(...), password: str = Header(...)):
    """Generate JWT token for API access"""
    # In production, replace with actual authentication logic
    if username == "admin" and password == os.environ.get("ADMIN_PASSWORD", "admin"):
        token_data = {"sub": username, "roles": ["admin"]}
        access_token = await create_access_token(token_data)
        return {"access_token": access_token, "token_type": "bearer"}
    
    raise HTTPException(status_code=401, detail="Invalid credentials")


# -------------------
# Agent API Routes
# -------------------

@agent_app.get("/api/agent/list", response_model=List[AgentPanelState])
async def list_agents(r: redis.Redis = Depends(get_redis)):
    """Get list of all agents with their current state"""
    # Get all agent registrations from Redis
    registrations = await r.keys("agent:*:registration")
    agents = []
    
    for reg_key in registrations:
        try:
            agent_data = await r.get(reg_key)
            if agent_data:
                agent_json = json.loads(agent_data)
                agent_id = agent_json.get("agentId", "unknown")
                
                # Get agent state
                state_key = f"agent:{agent_id}:state"
                state_data = await r.get(state_key)
                state = state_data.decode("utf-8") if state_data else "unknown"
                
                # Map state to status
                status = "running"
                if state == "paused":
                    status = "paused"
                elif state == "disabled":
                    status = "paused"
                
                # Check if agent is in canary mode
                is_canary = False
                if "config" in agent_json and "executionConfig" in agent_json["config"]:
                    exec_config = agent_json["config"]["executionConfig"]
                    if (exec_config.get("mode") == "canary" or 
                        exec_config.get("canaryMode", False)):
                        is_canary = True
                        status = "canary"
                
                # Get metrics
                metrics_key = f"agent:{agent_id}:metrics"
                metrics_data = await r.get(metrics_key)
                metrics = json.loads(metrics_data) if metrics_data else {}
                
                # Available actions based on status
                actions = []
                if status == "running":
                    actions = ["pause", "restart"]
                elif status == "paused":
                    actions = ["resume", "restart"]
                elif status == "canary":
                    actions = ["promote", "pause", "restart"]
                
                # Last signal time
                last_signal_key = f"agent:{agent_id}:last_signal"
                last_signal = await r.get(last_signal_key)
                last_signal_time = int(last_signal) if last_signal else 0
                
                # Get 24h PnL
                pnl_24h = metrics.get("pnl", 0.0)
                if "custom" in metrics and "pnl_24h" in metrics["custom"]:
                    pnl_24h = metrics["custom"]["pnl_24h"]
                
                # Tags from state and config
                tags = []
                if is_canary:
                    tags.append("canary")
                if status == "paused":
                    tags.append("paused")
                
                if "tradingPairs" in agent_json:
                    for pair in agent_json["tradingPairs"][:2]:  # Limit to 2 pairs for UI
                        tags.append(pair)
                
                if "agentType" in agent_json:
                    tags.append(agent_json["agentType"])
                
                # Create agent panel state
                agent_panel = AgentPanelState(
                    agentId=agent_id,
                    name=agent_json.get("name", None),
                    status=status,
                    lastSignal=last_signal_time,
                    pnl24h=pnl_24h,
                    actions=actions,
                    tags=tags,
                    lastUpdated=int(datetime.now().timestamp() * 1000)
                )
                
                agents.append(agent_panel)
                
        except Exception as e:
            print(f"Error processing agent registration: {e}")
    
    return agents


@agent_app.get("/api/agent/config", response_model=Dict[str, Any])
async def get_agent_config(agentId: str, r: redis.Redis = Depends(get_redis)):
    """Get configuration for a specific agent"""
    reg_key = f"agent:{agentId}:registration"
    agent_data = await r.get(reg_key)
    
    if not agent_data:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    agent_json = json.loads(agent_data)
    config = agent_json.get("config", {})
    
    return {"agentId": agentId, "config": config}


@agent_app.post("/api/agent/pause", response_model=AgentStatus)
async def pause_agent(agent: AgentBase, r: redis.Redis = Depends(get_redis)):
    """Pause a running agent"""
    # Check if agent exists
    reg_key = f"agent:{agent.agentId}:registration"
    exists = await r.exists(reg_key)
    
    if not exists:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Publish pause command to Redis
    await publish_agent_event(r, "pause_requested", agent.agentId)
    
    # Send pause command directly to agent through Redis
    pause_command = f"agent:{agent.agentId}:pause"
    await r.publish(pause_command, "")
    
    # Update agent state in Redis
    state_key = f"agent:{agent.agentId}:state"
    await r.set(state_key, "paused")
    
    # Broadcast state change to WebSocket clients
    await broadcast_websocket_message({
        "type": "agent_status_changed",
        "agentId": agent.agentId,
        "status": "paused",
        "timestamp": int(datetime.now().timestamp() * 1000)
    })
    
    return {"success": True, "message": f"Agent {agent.agentId} paused"}


@agent_app.post("/api/agent/resume", response_model=AgentStatus)
async def resume_agent(agent: AgentBase, r: redis.Redis = Depends(get_redis)):
    """Resume a paused agent"""
    # Check if agent exists
    reg_key = f"agent:{agent.agentId}:registration"
    exists = await r.exists(reg_key)
    
    if not exists:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Publish resume command to Redis
    await publish_agent_event(r, "resume_requested", agent.agentId)
    
    # Send resume command directly to agent through Redis
    resume_command = f"agent:{agent.agentId}:resume"
    await r.publish(resume_command, "")
    
    # Update agent state in Redis
    state_key = f"agent:{agent.agentId}:state"
    await r.set(state_key, "running")
    
    # Broadcast state change to WebSocket clients
    await broadcast_websocket_message({
        "type": "agent_status_changed",
        "agentId": agent.agentId,
        "status": "running",
        "timestamp": int(datetime.now().timestamp() * 1000)
    })
    
    return {"success": True, "message": f"Agent {agent.agentId} resumed"}


@agent_app.post("/api/agent/inject-config", response_model=AgentStatus)
async def inject_config(update: AgentConfigUpdate, r: redis.Redis = Depends(get_redis)):
    """Inject new configuration into a running agent"""
    # Check if agent exists
    reg_key = f"agent:{update.agentId}:registration"
    agent_data = await r.get(reg_key)
    
    if not agent_data:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Publish config update event
    await publish_agent_event(r, "config_update_requested", update.agentId, {"config": update.config})
    
    # Send config directly to agent through Redis
    config_command = f"agent:{update.agentId}:inject_config"
    await r.publish(config_command, json.dumps(update.config))
    
    # Update agent registration with new config
    agent_json = json.loads(agent_data)
    if "config" not in agent_json:
        agent_json["config"] = {}
    
    # Deep merge config (simple implementation)
    def deep_update(d, u):
        for k, v in u.items():
            if isinstance(v, dict) and k in d and isinstance(d[k], dict):
                deep_update(d[k], v)
            else:
                d[k] = v
    
    deep_update(agent_json["config"], update.config)
    await r.set(reg_key, json.dumps(agent_json))
    
    # Broadcast config change to WebSocket clients
    await broadcast_websocket_message({
        "type": "agent_config_updated",
        "agentId": update.agentId,
        "timestamp": int(datetime.now().timestamp() * 1000)
    })
    
    return {"success": True, "message": f"Configuration injected into agent {update.agentId}"}


@agent_app.post("/api/agent/promote-canary", response_model=AgentStatus)
async def promote_canary(agent: AgentBase, r: redis.Redis = Depends(get_redis)):
    """Promote a canary agent to live status"""
    # Check if agent exists
    reg_key = f"agent:{agent.agentId}:registration"
    agent_data = await r.get(reg_key)
    
    if not agent_data:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Check if agent is in canary mode
    agent_json = json.loads(agent_data)
    if "config" not in agent_json or "executionConfig" not in agent_json["config"]:
        raise HTTPException(status_code=400, detail="Agent does not have execution configuration")
    
    exec_config = agent_json["config"]["executionConfig"]
    if not (exec_config.get("mode") == "canary" or exec_config.get("canaryMode", False)):
        raise HTTPException(status_code=400, detail="Agent is not in canary mode")
    
    # Update execution config to live mode
    exec_config["mode"] = "live"
    exec_config["canaryMode"] = False
    
    # Save updated config
    await r.set(reg_key, json.dumps(agent_json))
    
    # Publish config update event to Redis
    await publish_agent_event(r, "canary_promoted", agent.agentId, {"newMode": "live"})
    
    # Send config update command to agent
    config_command = f"agent:{agent.agentId}:inject_config"
    await r.publish(config_command, json.dumps({"executionConfig": exec_config}))
    
    # Broadcast promotion to WebSocket clients
    await broadcast_websocket_message({
        "type": "agent_status_changed",
        "agentId": agent.agentId,
        "status": "running",  # Now it's a live running agent
        "timestamp": int(datetime.now().timestamp() * 1000)
    })
    
    return {"success": True, "message": f"Agent {agent.agentId} promoted from canary to live"}


@agent_app.post("/api/agent/restart", response_model=AgentStatus)
async def restart_agent(agent: AgentBase, r: redis.Redis = Depends(get_redis)):
    """Restart an agent"""
    # Check if agent exists
    reg_key = f"agent:{agent.agentId}:registration"
    exists = await r.exists(reg_key)
    
    if not exists:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Publish restart command to Redis
    await publish_agent_event(r, "restart_requested", agent.agentId)
    
    # Send restart command directly to agent through Redis
    restart_command = f"agent:{agent.agentId}:restart"
    await r.publish(restart_command, "")
    
    # Update agent state in Redis
    state_key = f"agent:{agent.agentId}:state"
    await r.set(state_key, "initializing")
    
    # Broadcast state change to WebSocket clients
    await broadcast_websocket_message({
        "type": "agent_status_changed",
        "agentId": agent.agentId,
        "status": "initializing",
        "timestamp": int(datetime.now().timestamp() * 1000)
    })
    
    return {"success": True, "message": f"Agent {agent.agentId} restarting"} 