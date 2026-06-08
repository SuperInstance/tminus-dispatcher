const { EventEmitter } = require('events');
const { AGENT_STATES, CUE_STATES, MSG_TYPES, HEARTBEAT_TIMEOUT_MS } = require('./constants');
const { AgentRegistry } = require('./agent-registry');
const { CueScheduler } = require('./cue-scheduler');
const { PhaseGroupManager } = require('./phase-group');
const { BeatEngine } = require('./beat-engine');
const { envelope } = require('./ws-handler');

class TminusDispatcher extends EventEmitter {
  constructor() {
    super();
    this._registry = new AgentRegistry();
    this._cues = new CueScheduler();
    this._groups = new PhaseGroupManager();
    this._beats = new BeatEngine();
    this._startedAt = null;
    this._staleCheckInterval = null;
  }

  /**
   * Start the dispatcher — fires up the beat engine and stale agent checks.
   */
  start() {
    this._startedAt = Date.now();

    // Beat tick → process cue countdowns
    this._beats.onTick((now) => {
      const readyCues = this._cues.tick(now);
      for (const cue of readyCues) {
        this._fireCue(cue);
      }
    });
    this._beats.start();

    // Stale agent cleanup every 15s
    this._staleCheckInterval = setInterval(() => {
      const staleIds = this._registry.removeStaleAgents();
      for (const id of staleIds) {
        this._groups.removeAgentFromAll(id);
        this.emit('agent_stale', id);
      }
    }, 15000);

    this.emit('started');
    return this;
  }

  /**
   * Stop the dispatcher.
   */
  stop() {
    this._beats.stop();
    if (this._staleCheckInterval) {
      clearInterval(this._staleCheckInterval);
      this._staleCheckInterval = null;
    }
    this.emit('stopped');
    return this;
  }

  /**
   * Handle a new WebSocket connection.
   * Called from the WS server on 'connection'.
   */
  onConnection(ws, connId) {
    // The connection is handed off; agent must send REGISTER to be tracked.
    ws._tminusConnId = connId;

    ws.on('message', (raw) => {
      const { handleMessage } = require('./ws-handler');
      handleMessage(this, ws, connId, raw.toString());
    });

    ws.on('close', () => {
      const agentId = this._registry.disconnect(connId);
      if (agentId) {
        this._groups.removeAgentFromAll(agentId);
        this.emit('agent_disconnected', agentId);
      }
    });

    ws.on('error', () => {
      // Connection error — close handler will catch it
    });
  }

  /**
   * Dispatch a t-minus cue. Handles the scheduling, state machine transitions,
   * and sends the CUED/PRIMED message to the target agent.
   */
  dispatchCue(spec) {
    const { sourceId, targetId, offsetBeats, phaseGroup, payload } = spec;
    const registry = this._registry;
    const target = registry.getById(targetId);
    const source = registry.getById(sourceId);

    if (!target || !source) {
      return { error: 'AGENT_NOT_FOUND' };
    }

    // Schedule the cue
    const result = this._cues.schedule({ sourceId, targetId, offsetBeats, phaseGroup, payload });

    // Add cue to target agent's active cues
    registry.addCue(targetId, result.cueId);

    // Track in phase group alignment point
    this._groups.recordCueIssued(phaseGroup);

    // Get target's socket
    const sock = registry.getSocket(targetId);

    if (result.isPreCue) {
      // Pre-cue (negative or zero offset): agent goes directly to PRIMED
      if (target.state === AGENT_STATES.LISTENING || target.state === AGENT_STATES.COMPLETE) {
        registry.setState(targetId, AGENT_STATES.PRIMED);
      }

      if (sock && sock.readyState === 1) {
        sock.send(envelope(MSG_TYPES.PRIMED, {
          cue_id: result.cueId,
          source: sourceId,
          phase_group: phaseGroup,
          pre_cued: true,
          offset_beats: offsetBeats,
          payload,
        }));
      }
    } else {
      // Standard cue: agent transitions to CUED
      if (target.state === AGENT_STATES.LISTENING || target.state === AGENT_STATES.COMPLETE) {
        registry.setState(targetId, AGENT_STATES.CUED);
      }

      if (sock && sock.readyState === 1) {
        sock.send(envelope(MSG_TYPES.CUED, {
          cue_id: result.cueId,
          source: sourceId,
          offset_beats: offsetBeats,
          delay_ms: result.delayMs,
          phase_group: phaseGroup,
          payload,
        }));
      }
    }

    this.emit('cue_dispatched', {
      cueId: result.cueId,
      sourceId,
      targetId,
      offsetBeats,
      phaseGroup,
      isPreCue: result.isPreCue,
    });

    return result;
  }

  /**
   * Internal: fire a cue whose countdown has completed.
   * Sends PRIMED to the target agent.
   */
  _fireCue(cue) {
    const registry = this._registry;
    const target = registry.getById(cue.target_id);
    if (!target) return;

    // Transition: CUED → PRIMED
    if (target.state === AGENT_STATES.CUED) {
      registry.setState(cue.target_id, AGENT_STATES.PRIMED);
    }

    const sock = registry.getSocket(cue.target_id);
    if (sock && sock.readyState === 1) {
      sock.send(envelope(MSG_TYPES.PRIMED, {
        cue_id: cue.id,
        source: cue.source_id,
        phase_group: cue.phase_group,
        pre_cued: false,
        offset_beats: 0,
        payload: cue.payload,
      }));
    }

    this.emit('cue_primed', cue.id);
  }

  /**
   * Complete all pending cues for an agent in a specific phase group.
   */
  completeAgentCues(agentId, phaseGroup) {
    const registry = this._registry;
    const agent = registry.getById(agentId);
    if (!agent) return [];

    const completed = [];
    for (const cueId of [...agent.current_cues]) {
      const cue = this._cues.getCue(cueId);
      if (cue && cue.phase_group === phaseGroup) {
        this._cues.complete(cueId);
        registry.removeCue(agentId, cueId);
        completed.push(cueId);
      }
    }
    return completed;
  }

  /**
   * Check if all agents in a phase group have completed → advance alignment point.
   */
  checkPhaseAdvance(phaseGroup) {
    return this._groups.recordCueCompleted(phaseGroup);
  }

  /** Getters for internal modules (used by WS handler) */
  getRegistry() { return this._registry; }
  getCues() { return this._cues; }
  getPhaseGroups() { return this._groups; }
  getBeats() { return this._beats; }

  /**
   * Get snapshot of dispatcher status.
   */
  getStatus() {
    const beatStats = this._beats.getStats();
    const agents = this._registry.getAll();
    const stateCount = {};
    for (const s of Object.values(AGENT_STATES)) stateCount[s] = 0;
    for (const a of agents) stateCount[a.state] = (stateCount[a.state] || 0) + 1;

    return {
      status: 'ok',
      uptime_ms: this._startedAt ? Date.now() - this._startedAt : 0,
      started_at: this._startedAt,
      beats: beatStats,
      agents: {
        total: this._registry.count(),
        by_state: stateCount,
      },
      cues: {
        total: this._cues.count(),
        active: this._cues.activeCount(),
        pending: this._cues.getActive().length,
      },
      phase_groups: this._groups.getAll().length,
    };
  }
}

module.exports = { TminusDispatcher };
