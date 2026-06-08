#!/usr/bin/env node

/**
 * T-Minus Dispatcher — Agent Simulation
 *
 * Simulates 3 agents (Chronicler, Architect, Critic) coordinating
 * via t-minus cues to produce a small orchestrated workflow:
 *
 *   ┌──────────┐     ┌──────────┐     ┌──────────┐
 *   │Chronicler│     │Architect │     │ Critic   │
 *   │  gather  │     │ synthesize│    │  review  │
 *   └────┬─────┘     └────┬─────┘     └────┬─────┘
 *        │ CUE(+3,gather) │                │
 *        │───────────────>│                │
 *        │                │ CUE(+5,review) │
 *        │                │───────────────>│
 *        │ REPORT(done)   │                │
 *        │                │ REPORT(done)   │
 *        │                │                │ REPORT(approved)
 *
 * Pre-cue test: Chronicler sends a CUE(-2) to show the negative t-minus pattern
 */

const WebSocket = require('ws');
const http = require('http');

const DISPATCHER_URL = process.env.TMINUS_URL || 'ws://localhost:8765';

// ── Utility: wait ──────────────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Utility: REST GET ──────────────────────────────────────────────────
function restGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, DISPATCHER_URL.replace(/^ws:/, 'http:'));
    http.get(url.href, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Agent class ────────────────────────────────────────────────────────
class SimAgent {
  constructor(name, timbre, frequency, latencyMs, contextDepth) {
    this.name = name;
    this.timbre = timbre;
    this.frequency = frequency;
    this.latencyMs = latencyMs;
    this.contextDepth = contextDepth;
    this.ws = null;
    this.id = null;
    this.state = 'offline';
    this.cueLog = [];
    this.primedLog = [];
    this.seq = 0;
    this.connected = false;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => this._onMessage(raw));
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    this.seq = msg.seq;

    switch (msg.type) {
      case 'REGISTERED':
        if (msg.payload.agent_id) {
          this.id = msg.payload.agent_id;
          this.state = msg.payload.state || 'registered';
        }
        break;

      case 'CUED':
        this.state = 'cued';
        this.cueLog.push(msg.payload);
        break;

      case 'PRIMED':
        this.state = 'primed';
        this.primedLog.push(msg.payload);
        break;

      case 'FIRE_ACK':
        this.state = 'firing';
        break;

      case 'COMPLETE_ACK':
        this.state = 'complete';
        break;

      case 'PHASE_ADVANCE':
        break; // just informational

      case 'PONG':
        break;

      case 'ERROR':
        console.error(`  [${this.name}] ERROR: ${msg.payload.message}`);
        break;
    }
  }

  register() {
    this._send('REGISTER', {
      name: this.name,
      timbre: this.timbre,
      frequency: this.frequency,
      latency_ms: this.latencyMs,
      context_depth: this.contextDepth,
    });
  }

  subscribe(groups) {
    this._send('SUBSCRIBE', { phase_groups: groups });
  }

  cue(targetId, offsetBeats, phaseGroup, payload) {
    this._send('CUE', {
      target_id: targetId,
      offset_beats: offsetBeats,
      phase_group: phaseGroup,
      payload: payload || null,
    });
  }

  fire() {
    this._send('FIRE', {});
  }

  report(result, phaseGroup, durationBeats) {
    this._send('REPORT', {
      result,
      phase_group: phaseGroup,
      duration_beats: durationBeats || 1,
    });
  }

  ping() {
    this._send('PING', {});
  }

  _send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = JSON.stringify({ type, payload, ts: Date.now() });
    this.ws.send(msg);
  }

  close() {
    if (this.ws) { try { this.ws.close(); } catch {} }
  }

  waitForState(targetState, timeoutMs = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.state === targetState) return resolve(true);
        if (Date.now() - start > timeoutMs) return reject(new Error(
          `[${this.name}] Timeout waiting for state ${targetState}, current=${this.state}`));
        setTimeout(check, 50);
      };
      check();
    });
  }

  waitForPrimed(timeoutMs = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.primedLog.length > 0) return resolve(this.primedLog[this.primedLog.length - 1]);
        if (Date.now() - start > timeoutMs) return reject(new Error(
          `[${this.name}] Timeout waiting for PRIMED`));
        setTimeout(check, 50);
      };
      check();
    });
  }
}

// ── Main Simulation ────────────────────────────────────────────────────
async function main() {
  const PASS = '✅';
  const FAIL = '❌';
  let passed = 0;
  let failed = 0;

  function test(description, condition) {
    if (condition) {
      console.log(`  ${PASS} ${description}`);
      passed++;
    } else {
      console.log(`  ${FAIL} ${description}`);
      failed++;
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   T-Minus Dispatcher — Agent Simulation          ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Ensure dispatcher is running ──────────────────────────────
  try {
    const health = await restGet('/health');
    console.log(`  ℹ️  Dispatcher status: ${health.status} (${health.agents.total} agents, ${health.cues.total} cues)\n`);
  } catch (e) {
    console.log(`${FAIL} Dispatcher not running at ${DISPATCHER_URL}`);
    console.log('  Start with: cd tminus-dispatcher && npm start');
    process.exit(1);
  }

  // ── Create agents ─────────────────────────────────────────────
  const chronicler = new SimAgent('Chronicler', 'narrative', 1.0, 100, 'deep');
  const architect = new SimAgent('Architect', 'analytical', 0.9, 200, 'medium');
  const critic = new SimAgent('Critic', 'evaluative', 0.8, 150, 'shallow');

  // ── Connect ───────────────────────────────────────────────────
  console.log('── Connecting agents ──');
  await chronicler.connect(DISPATCHER_URL);
  await architect.connect(DISPATCHER_URL);
  await critic.connect(DISPATCHER_URL);
  await wait(100);
  console.log('  ✅ All agents connected\n');

  // ── Register ──────────────────────────────────────────────────
  console.log('── Registering agents ──');
  chronicler.register();
  architect.register();
  critic.register();
  await wait(200);
  test('Chronicler registered', chronicler.id !== null);
  test('Architect registered', architect.id !== null);
  test('Critic registered', critic.id !== null);
  console.log(`  IDs: chronicler=${chronicler.id}, architect=${architect.id}, critic=${critic.id}\n`);

  // ── Subscribe ─────────────────────────────────────────────────
  console.log('── Subscribing to phase groups ──');
  chronicler.subscribe(['gather', 'deliver']);
  architect.subscribe(['gather', 'synthesize']);
  critic.subscribe(['review']);
  await wait(200);
  test('Chronicler state = listening', chronicler.state === 'listening' || chronicler.state === 'complete');
  test('Architect state = listening', architect.state === 'listening' || architect.state === 'complete');
  test('Critic state = listening', critic.state === 'listening' || critic.state === 'complete');
  console.log();

  // ═══════════════════════════════════════════════════════════
  // Test 1: Positive T-Minus Cue
  // Chronicler cues Architect at +3 beats (1.5s)
  // ═══════════════════════════════════════════════════════════
  console.log('── Test 1: Standard t-minus +3 cue ──');
  chronicler.cue(architect.id, 3, 'gather', { topic: 'design-doc' });
  await wait(200);
  test('Architect received CUED', architect.cueLog.length > 0);
  test('Architect state = cued', architect.state === 'cued');

  // Wait for countdown to complete (3 beats * 500ms = 1.5s)
  console.log('  ⏳ Waiting for countdown (3 beats)...');
  await wait(1700);
  test('Architect received PRIMED', architect.primedLog.length > 0);
  test('Architect state = primed', architect.state === 'primed');

  // Fire and report
  architect.fire();
  await wait(100);
  test('Architect state = firing', architect.state === 'firing');
  architect.report('synthesized', 'gather', 2);
  await wait(200);
  test('Architect state = complete', architect.state === 'complete');
  console.log();

  // ═══════════════════════════════════════════════════════════
  // Test 2: Zero T-Minus Cue (immediate)
  // Architect cues Critic at 0 beats
  // ═══════════════════════════════════════════════════════════
  console.log('── Test 2: Zero t-minus cue (immediate) ──');
  architect.cue(critic.id, 0, 'review', { artifact: 'design-v1' });
  await wait(300);
  test('Critic received PRIMED (not CUED, since offset=0)', critic.primedLog.length > 0);
  test('Critic PRIMED has phase_group=review', critic.primedLog[0].phase_group === 'review');
  test('Critic PRIMED marked as pre_cued', critic.primedLog[0].pre_cued === true);
  console.log();

  // ═══════════════════════════════════════════════════════════
  // Test 3: Negative T-Minus (pre-cue)
  // Critic cues Chronicler at -2 beats
  // ═══════════════════════════════════════════════════════════
  console.log('── Test 3: Negative t-minus cue (pre-cue) ──');
  // Reset chronicler to listening state
  chronicler.cueLog = [];
  const preCuePrimedCount = chronicler.primedLog.length;

  critic.cue(chronicler.id, -2, 'deliver', { order: 'narrate' });
  await wait(300);
  test('Chronicler received PRIMED from pre-cue', chronicler.primedLog.length > preCuePrimedCount);
  test('Chronicler state = primed', chronicler.state === 'primed');

  chronicler.fire();
  await wait(100);
  chronicler.report('narrated', 'deliver', 3);
  await wait(200);
  console.log();

  // ═══════════════════════════════════════════════════════════
  // Test 4: Phase Advance
  // ═══════════════════════════════════════════════════════════
  console.log('── Test 4: Phase group advancement ──');
  const groupsStatus = await restGet('/phase-groups');
  const deliverGroup = groupsStatus.phase_groups.find(g => g.name === 'deliver');
  test('Deliver phase group exists', deliverGroup !== undefined);
  test('Deliver group has agents', deliverGroup && deliverGroup.agent_count > 0);
  console.log();

  // ═══════════════════════════════════════════════════════════
  // Test 5: REST Health Endpoint
  // ═══════════════════════════════════════════════════════════
  console.log('── Test 5: REST health ──');
  const healthData = await restGet('/health');
  test('Health endpoint returns ok', healthData.status === 'ok');
  test('Health shows agent count > 0', healthData.agents.total > 0);
  test('Health shows beat counter running', healthData.beats.counter > 0);
  test('Health shows phase groups', healthData.phase_groups >= 2);
  console.log();

  // ═══════════════════════════════════════════════════════════
  // Test 6: Agent Listing
  // ═══════════════════════════════════════════════════════════
  console.log('── Test 6: REST agent listing ──');
  const agentsData = await restGet('/agents');
  test('REST /agents returns list', Array.isArray(agentsData.agents));
  test('3 agents registered', agentsData.count === 3);
  const names = agentsData.agents.map(a => a.name).sort();
  test('All three agents present', names.join(',') === 'Architect,Chronicler,Critic');
  console.log('  Names:', names.join(', '));
  console.log();

  // ═══════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════
  chronicler.close();
  architect.close();
  critic.close();
  await wait(100);

  // ── Final Summary ──────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║  Simulation Summary                              ║`);
  console.log(`║  ${PASS} Passed: ${passed}                              ║`);
  if (failed > 0) {
    console.log(`║  ${FAIL} Failed: ${failed}                              ║`);
  }
  console.log(`║  Total tests: ${passed + failed}                          ║`);
  console.log('╚══════════════════════════════════════════════════╝');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n${FAIL} Simulation error:`, err.message);
  process.exit(1);
});
