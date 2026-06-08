#!/usr/bin/env node

/**
 * T-Minus Cue Dispatcher Server
 *
 * A lightweight HTTP/WS service for distributed cognitive agent orchestration.
 * Agents register, send t-minus cues, and coordinate via cognitive beats.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const { TminusDispatcher } = require('./dispatcher');
const { REST_PATHS, AGENT_STATES, CUE_STATES } = require('./constants');

const PORT = parseInt(process.env.TMINUS_PORT || '8765', 10);
const HOST = process.env.TMINUS_HOST || '0.0.0.0';

// ── Create the dispatcher ──────────────────────────────────────────────
const dispatcher = new TminusDispatcher();

// ── Create HTTP server (serves REST + WS upgrade) ──────────────────────
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    handleRestRequest(req, res, path);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
  }
});

// ── REST request handler ───────────────────────────────────────────────
function handleRestRequest(req, res, path) {
  const registry = dispatcher.getRegistry();
  const cueSched = dispatcher.getCues();
  const groupMgr = dispatcher.getPhaseGroups();

  // GET /health
  if (path === REST_PATHS.HEALTH && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(dispatcher.getStatus()));
    return;
  }

  // GET /agents
  if (path === REST_PATHS.AGENTS && req.method === 'GET') {
    const agents = registry.getAll().map(a => ({
      id: a.id,
      name: a.name,
      timbre: a.timbre,
      frequency: a.frequency,
      state: a.state,
      phase_groups: a.phase_groups,
      latency_ms: a.latency_ms,
      context_depth: a.context_depth,
      connected: a.conn_id !== null,
      last_heartbeat: a.last_heartbeat,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents, count: agents.length }));
    return;
  }

  // DELETE /agents/:id
  const agentDetailMatch = path.match(/^\/agents\/(.+)$/);
  if (agentDetailMatch && req.method === 'DELETE') {
    const agentId = decodeURIComponent(agentDetailMatch[1]);
    const agent = registry.getById(agentId);
    if (!agent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` }));
      return;
    }
    // Disconnect
    if (agent.conn_id) {
      const sock = registry.getSocket(agentId);
      if (sock) sock.close();
      registry.disconnect(agent.conn_id);
    }
    groupMgr.removeAgentFromAll(agentId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, agent_id: agentId }));
    return;
  }

  // GET /agents/:id
  if (agentDetailMatch && req.method === 'GET') {
    const agentId = decodeURIComponent(agentDetailMatch[1]);
    const agent = registry.getById(agentId);
    if (!agent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agent));
    return;
  }

  // GET /phase-groups
  if (path === REST_PATHS.PHASE_GROUPS && req.method === 'GET') {
    const groups = groupMgr.getAll().map(g => ({
      name: g.name,
      agent_count: g.agents.length,
      sequence: g.sequence,
      state: g.state,
      last_alignment: g.last_alignment,
      agents: g.agents,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ phase_groups: groups, count: groups.length }));
    return;
  }

  // GET /cues
  if (path === REST_PATHS.CUES && req.method === 'GET') {
    const active = cueSched.getActive();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cues: active, count: active.length }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'NOT_FOUND', message: `Path ${path} not found` }));
}

// ── WebSocket Server ───────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const connId = `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  dispatcher.onConnection(ws, connId);
});

// ── Start ──────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║     T-Minus Cue Dispatcher — v1.0.0              ║`);
  console.log(`║     ${new Date().toISOString()}                   ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  WS/REST : ws://${HOST}:${PORT}              ║`);
  console.log(`║  REST    : http://${HOST}:${PORT}/health     ║`);
  console.log(`║  Beat    : 1 tick = 500ms                        ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);

  dispatcher.start();
});

// ── Graceful shutdown ─────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n⏹  Shutting down...');
  dispatcher.stop();
  wss.close(() => {
    server.close(() => {
      console.log('⏹  Dispatcher stopped.');
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  dispatcher.stop();
  wss.close(() => {
    server.close(() => process.exit(0));
  });
});
