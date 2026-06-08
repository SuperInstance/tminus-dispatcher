const { AGENT_STATES, CONTEXT_DEPTH_FACTOR, NORMALIZED_BEAT_MS, HEARTBEAT_TIMEOUT_MS } = require('./constants');

class AgentRegistry {
  constructor() {
    this._agents = new Map();   // agent_id → agent record
    this._conns = new Map();    // ws_connection_id → agent_id
    this._socks = new Map();    // agent_id → WebSocket
  }

  register(ws, connId, payload) {
    const { name, timbre, frequency, latency_ms, context_depth } = payload;

    if (!name) {
      return { error: 'INVALID_PAYLOAD', message: 'name is required' };
    }

    const agentId = `${name.toLowerCase().replace(/\s+/g, '-')}_${Date.now().toString(36)}`;
    const depthFactor = CONTEXT_DEPTH_FACTOR[context_depth] || 2;
    const normalizedBeats = ((latency_ms || NORMALIZED_BEAT_MS) * depthFactor) / NORMALIZED_BEAT_MS;

    const agent = {
      id: agentId,
      name,
      timbre: timbre || 'neutral',
      frequency: typeof frequency === 'number' ? Math.max(0, Math.min(1, frequency)) : 1.0,
      state: AGENT_STATES.REGISTERED,
      phase_groups: [],
      latency_ms: latency_ms || NORMALIZED_BEAT_MS,
      context_depth: context_depth || 'medium',
      normalized_beats: Math.max(1, normalizedBeats),
      conn_id: connId,
      registered_at: Date.now(),
      last_heartbeat: Date.now(),
      current_cues: [],      // cue IDs this agent is involved in
      completed_cues: 0,
    };

    this._agents.set(agentId, agent);
    this._conns.set(connId, agentId);
    this._socks.set(agentId, ws);

    return { agentId, state: agent.state };
  }

  getById(agentId) {
    return this._agents.get(agentId) || null;
  }

  getByConn(connId) {
    const agentId = this._conns.get(connId);
    return agentId ? this._agents.get(agentId) : null;
  }

  getSocket(agentId) {
    return this._socks.get(agentId) || null;
  }

  setState(agentId, newState) {
    const agent = this._agents.get(agentId);
    if (!agent) return false;
    agent.state = newState;
    return true;
  }

  transitionTo(agentId, newState) {
    const agent = this._agents.get(agentId);
    if (!agent) return false;
    agent.state = newState;
    return true;
  }

  addCue(agentId, cueId) {
    const agent = this._agents.get(agentId);
    if (!agent) return;
    if (!agent.current_cues.includes(cueId)) {
      agent.current_cues.push(cueId);
    }
  }

  removeCue(agentId, cueId) {
    const agent = this._agents.get(agentId);
    if (!agent) return;
    agent.current_cues = agent.current_cues.filter(c => c !== cueId);
  }

  addPhaseGroup(agentId, groupName) {
    const agent = this._agents.get(agentId);
    if (!agent) return false;
    if (!agent.phase_groups.includes(groupName)) {
      agent.phase_groups.push(groupName);
    }
    return true;
  }

  removePhaseGroup(agentId, groupName) {
    const agent = this._agents.get(agentId);
    if (!agent) return false;
    agent.phase_groups = agent.phase_groups.filter(g => g !== groupName);
    return true;
  }

  heartbeat(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return false;
    agent.last_heartbeat = Date.now();
    return true;
  }

  disconnect(connId) {
    const agentId = this._conns.get(connId);
    if (!agentId) return null;

    const agent = this._agents.get(agentId);
    if (agent) {
      agent.state = AGENT_STATES.OFFLINE;
      agent.conn_id = null;
    }

    this._conns.delete(connId);
    this._socks.delete(agentId);
    return agentId;
  }

  getAll() {
    return Array.from(this._agents.values());
  }

  getByState(state) {
    return this.getAll().filter(a => a.state === state);
  }

  getByPhaseGroup(groupName) {
    return this.getAll().filter(a => a.phase_groups.includes(groupName));
  }

  getListeningInGroup(groupName) {
    return this.getAll().filter(a =>
      a.phase_groups.includes(groupName) &&
      (a.state === AGENT_STATES.LISTENING || a.state === AGENT_STATES.COMPLETE)
    );
  }

  removeStaleAgents() {
    const now = Date.now();
    const stale = [];
    for (const [id, agent] of this._agents) {
      if (now - agent.last_heartbeat > HEARTBEAT_TIMEOUT_MS &&
          agent.state !== AGENT_STATES.OFFLINE) {
        agent.state = AGENT_STATES.OFFLINE;
        stale.push(id);
      }
    }
    return stale;
  }

  count() {
    return this._agents.size;
  }
}

module.exports = { AgentRegistry };
