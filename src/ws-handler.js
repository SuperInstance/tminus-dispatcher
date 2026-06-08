const { MSG_TYPES, AGENT_STATES, CUE_STATES, ERROR_CODES } = require('./constants');

/**
 * Build a server → client message envelope.
 */
function envelope(type, payload = {}, seq = 0) {
  return JSON.stringify({
    type,
    seq: seq + 1,
    ts: Date.now(),
    payload,
  });
}

/**
 * Handle an incoming WebSocket message.
 * @param {Object} dispatcher - The TminusDispatcher instance
 * @param {WebSocket} ws - The WebSocket connection
 * @param {string} connId - Connection identifier
 * @param {string} raw - Raw message text
 */
function handleMessage(dispatcher, ws, connId, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    sendError(ws, ERROR_CODES.INVALID_PAYLOAD, 'Invalid JSON');
    return;
  }

  const { type, payload, seq } = msg;
  if (!type) {
    sendError(ws, ERROR_CODES.INVALID_PAYLOAD, 'Missing message type');
    return;
  }

  const agent = dispatcher.getRegistry().getByConn(connId);
  const agents = dispatcher.getRegistry();

  switch (type) {
    case MSG_TYPES.REGISTER: {
      if (agent) {
        sendError(ws, ERROR_CODES.ALREADY_REGISTERED, 'Agent already registered');
        return;
      }
      const result = agents.register(ws, connId, payload || {});
      if (result.error) {
        sendError(ws, result.error, result.message);
        return;
      }
      ws.send(envelope(MSG_TYPES.REGISTERED, {
        agent_id: result.agentId,
        state: result.state,
      }, seq));
      dispatcher.emit('agent_registered', result.agentId);
      break;
    }

    case MSG_TYPES.SUBSCRIBE: {
      if (!agent) { sendError(ws, ERROR_CODES.AGENT_NOT_FOUND, 'Register first'); return; }
      const groups = payload?.phase_groups;
      if (!Array.isArray(groups) || groups.length === 0) {
        sendError(ws, ERROR_CODES.INVALID_PAYLOAD, 'phase_groups array required');
        return;
      }
      for (const g of groups) {
        agents.addPhaseGroup(agent.id, g);
        dispatcher.getPhaseGroups().addAgent(g, agent.id);
      }
      if (agent.state === AGENT_STATES.REGISTERED) {
        agents.setState(agent.id, AGENT_STATES.LISTENING);
      }
      ws.send(envelope(MSG_TYPES.REGISTERED, {
        agent_id: agent.id,
        state: agent.state,
        phase_groups: agent.phase_groups,
      }, seq));
      dispatcher.emit('agent_subscribed', { agentId: agent.id, groups });
      break;
    }

    case MSG_TYPES.CUE: {
      if (!agent) { sendError(ws, ERROR_CODES.AGENT_NOT_FOUND, 'Register first'); return; }
      const { target_id, offset_beats, phase_group, payload: cuePayload } = payload || {};
      if (!target_id || offset_beats === undefined || !phase_group) {
        sendError(ws, ERROR_CODES.INVALID_PAYLOAD, 'target_id, offset_beats, phase_group required');
        return;
      }
      const target = agents.getById(target_id);
      if (!target) {
        sendError(ws, ERROR_CODES.AGENT_NOT_FOUND, `Target ${target_id} not found`);
        return;
      }

      const result = dispatcher.dispatchCue({
        sourceId: agent.id,
        targetId: target_id,
        offsetBeats: offset_beats,
        phaseGroup: phase_group,
        payload: cuePayload,
      });

      ws.send(envelope(MSG_TYPES.REGISTERED, {
        cue_id: result.cueId,
        target_id,
        offset_beats,
        phase_group,
        pre_cued: result.isPreCue,
        delay_ms: result.delayMs,
      }, seq));
      break;
    }

    case MSG_TYPES.FIRE: {
      if (!agent) { sendError(ws, ERROR_CODES.AGENT_NOT_FOUND, 'Register first'); return; }
      if (agent.state !== AGENT_STATES.PRIMED) {
        sendError(ws, ERROR_CODES.INVALID_STATE,
          `Cannot FIRE from state ${agent.state}, expected PRIMED`);
        return;
      }
      agents.setState(agent.id, AGENT_STATES.FIRING);
      ws.send(envelope(MSG_TYPES.FIRE_ACK, {
        agent_id: agent.id,
        state: AGENT_STATES.FIRING,
      }, seq));
      dispatcher.emit('agent_firing', agent.id);
      break;
    }

    case MSG_TYPES.REPORT: {
      if (!agent) { sendError(ws, ERROR_CODES.AGENT_NOT_FOUND, 'Register first'); return; }
      const { result, duration_beats, phase_group: reportGroup } = payload || {};
      if (!reportGroup) {
        sendError(ws, ERROR_CODES.INVALID_PAYLOAD, 'phase_group is required in REPORT');
        return;
      }

      // Complete any pending cues for this agent in this phase group
      const completedInfo = dispatcher.completeAgentCues(agent.id, reportGroup);

      agents.setState(agent.id, AGENT_STATES.COMPLETE);
      ws.send(envelope(MSG_TYPES.COMPLETE_ACK, {
        agent_id: agent.id,
        state: AGENT_STATES.COMPLETE,
        cues_completed: completedInfo.length,
        result: result || 'ok',
        duration_beats: duration_beats || 0,
      }, seq));
      dispatcher.emit('agent_completed', { agentId: agent.id, group: reportGroup, result });

      // Check if alignment point can advance
      const advanced = dispatcher.checkPhaseAdvance(reportGroup);
      if (advanced) {
        // Notify all agents in group about the phase advance
        const groupAgents = agents.getByPhaseGroup(reportGroup);
        for (const ga of groupAgents) {
          const sock = agents.getSocket(ga.id);
          if (sock && sock.readyState === 1) {
            sock.send(envelope(MSG_TYPES.PHASE_ADVANCE, {
              group: reportGroup,
              point: advanced.id,
            }));
          }
        }
      }
      break;
    }

    case MSG_TYPES.PING: {
      if (agent) agents.heartbeat(agent.id);
      ws.send(envelope(MSG_TYPES.PONG, {}, seq));
      break;
    }

    case MSG_TYPES.UNSUBSCRIBE: {
      if (!agent) { sendError(ws, ERROR_CODES.AGENT_NOT_FOUND, 'Register first'); return; }
      const unsubGroups = payload?.phase_groups;
      if (!Array.isArray(unsubGroups)) {
        sendError(ws, ERROR_CODES.INVALID_PAYLOAD, 'phase_groups array required');
        return;
      }
      for (const g of unsubGroups) {
        agents.removePhaseGroup(agent.id, g);
        dispatcher.getPhaseGroups().removeAgent(g, agent.id);
      }
      if (agent.phase_groups.length === 0) {
        agents.setState(agent.id, AGENT_STATES.REGISTERED);
      }
      ws.send(envelope(MSG_TYPES.REGISTERED, {
        agent_id: agent.id,
        state: agent.state,
        phase_groups: agent.phase_groups,
      }, seq));
      break;
    }

    default:
      sendError(ws, ERROR_CODES.INVALID_PAYLOAD, `Unknown message type: ${type}`);
  }
}

function sendError(ws, code, message) {
  try {
    ws.send(envelope(MSG_TYPES.ERROR, { code, message }));
  } catch (e) {
    // Connection might be dead
  }
}

module.exports = { handleMessage, envelope };
