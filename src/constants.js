// T-Minus Dispatcher — Constants and State Definitions

// Agent Lifecycle States
const AGENT_STATES = Object.freeze({
  OFFLINE:    'offline',      // Not connected
  REGISTERED: 'registered',   // WS connected, metadata stored
  LISTENING:  'listening',    // Subscribed to ≥1 phase group
  CUED:       'cued',         // Has received a t-minus cue, waiting for countdown
  PRIMED:     'primed',       // T-minus offset reached zero, ready to fire
  FIRING:     'firing',       // Agent is executing its action
  COMPLETE:   'complete',     // Result reported, ready for next cue
});

const VALID_TRANSITIONS = Object.freeze({
  [AGENT_STATES.OFFLINE]:    [AGENT_STATES.REGISTERED],
  [AGENT_STATES.REGISTERED]: [AGENT_STATES.LISTENING, AGENT_STATES.OFFLINE],
  [AGENT_STATES.LISTENING]:  [AGENT_STATES.CUED, AGENT_STATES.PRIMED, AGENT_STATES.OFFLINE],
  [AGENT_STATES.CUED]:       [AGENT_STATES.PRIMED, AGENT_STATES.LISTENING, AGENT_STATES.OFFLINE],
  [AGENT_STATES.PRIMED]:     [AGENT_STATES.FIRING, AGENT_STATES.LISTENING, AGENT_STATES.OFFLINE],
  [AGENT_STATES.FIRING]:     [AGENT_STATES.COMPLETE, AGENT_STATES.LISTENING, AGENT_STATES.OFFLINE],
  [AGENT_STATES.COMPLETE]:   [AGENT_STATES.LISTENING, AGENT_STATES.OFFLINE],
});

// Cue States
const CUE_STATES = Object.freeze({
  SCHEDULED:  'scheduled',
  DELIVERED:  'delivered',
  COMPLETED:  'completed',
  CANCELLED:  'cancelled',
});

// Message Types
const MSG_TYPES = Object.freeze({
  // Client → Server
  REGISTER:     'REGISTER',
  SUBSCRIBE:    'SUBSCRIBE',
  CUE:          'CUE',
  FIRE:         'FIRE',
  REPORT:       'REPORT',
  PING:         'PING',
  UNSUBSCRIBE:  'UNSUBSCRIBE',
  // Server → Client
  REGISTERED:       'REGISTERED',
  CUED:             'CUED',
  PRIMED:           'PRIMED',
  FIRE_ACK:         'FIRE_ACK',
  COMPLETE_ACK:     'COMPLETE_ACK',
  PHASE_ADVANCE:    'PHASE_ADVANCE',
  ERROR:            'ERROR',
  PONG:             'PONG',
});

// Timing defaults
const TICK_MS = 500;           // 1 cognitive beat = 500ms by default
const HEARTBEAT_TIMEOUT_MS = 30000;  // 30s without PING → offline
const NORMALIZED_BEAT_MS = 500;
const CONTEXT_DEPTH_FACTOR = Object.freeze({
  shallow: 1,
  medium: 2,
  deep: 4,
});

// Error codes
const ERROR_CODES = Object.freeze({
  AGENT_NOT_FOUND:    'AGENT_NOT_FOUND',
  AGENT_OFFLINE:      'AGENT_OFFLINE',
  INVALID_STATE:      'INVALID_STATE',
  UNKNOWN_CUE:        'UNKNOWN_CUE',
  GROUP_NOT_FOUND:    'GROUP_NOT_FOUND',
  ALREADY_REGISTERED: 'ALREADY_REGISTERED',
  INVALID_PAYLOAD:    'INVALID_PAYLOAD',
});

// REST paths
const REST_PATHS = Object.freeze({
  HEALTH:       '/health',
  AGENTS:       '/agents',
  AGENT_DETAIL: '/agents/:id',
  PHASE_GROUPS: '/phase-groups',
  GROUP_DETAIL: '/phase-groups/:name',
  CUES:         '/cues',
});

module.exports = {
  AGENT_STATES,
  VALID_TRANSITIONS,
  CUE_STATES,
  MSG_TYPES,
  TICK_MS,
  HEARTBEAT_TIMEOUT_MS,
  NORMALIZED_BEAT_MS,
  CONTEXT_DEPTH_FACTOR,
  ERROR_CODES,
  REST_PATHS,
};
