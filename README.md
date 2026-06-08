# T-Minus Cue Dispatcher

> The temporal heartbeat of the Symphony of Shells.

A lightweight HTTP/WebSocket timing service for distributed cognitive agent orchestration. Instead of "do A then B then C", agents receive **t-minus cues** at temporal offsets so they can prepare context, resonate in parallel, and fire at the right moment.

## How It Works

```
t-minus(shell_id, n_beats, phase_group)
```

- **Positive n**: Countdown cue — agent acts `n` beats from now
- **Zero n**: Immediate cue — agent acts NOW (skips countdown)
- **Negative n**: Pre-cue — agent is told it started `n` beats ago (instant PRIMED)

1 **cognitive beat** = 500ms by default (configurable).

## Quick Start

```bash
# Install
cd tminus-dispatcher && npm install

# Start the dispatcher
npm start

# In another terminal, run the simulation
node tests/simulate.js
```

## Architecture

```
┌────────────────────────────────────────────────┐
│            T-Minus Dispatcher                  │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │  Agent   │  │   Cue    │  │  Phase Group  │ │
│  │ Registry │  │Scheduler │  │   Manager    │ │
│  └──────────┘  └──────────┘  └──────────────┘ │
│  ┌──────────┐  ┌──────────┐                   │
│  │  Beat    │  │    WS    │                   │
│  │  Engine  │  │  Handler │                   │
│  └──────────┘  └──────────┘                   │
└────────────────────────────────────────────────┘
```

## Agent State Machine

```
OFFLINE → REGISTERED → LISTENING → CUED → PRIMED → FIRING → COMPLETE
                 ↕          ↑         ↕        ↕        ↑
             (reconnect)   └─────────┴────┴────┘
                           (return to listening after complete,
                            or from cued/primed on next cue in group)
```

## API

### WebSocket (ws://host:8765)

Messages are JSON with this envelope:

```json
{ "type": "REGISTER", "seq": 1, "ts": 1710000000000, "payload": { ... } }
```

| Client → Server | Payload |
|-----------------|---------|
| `REGISTER` | `{name, timbre?, frequency?, latency_ms?, context_depth?}` |
| `SUBSCRIBE` | `{phase_groups: ["gather"]}` |
| `CUE` | `{target_id, offset_beats, phase_group, payload?}` |
| `FIRE` | `{}` |
| `REPORT` | `{result, duration_beats, phase_group}` |
| `PING` | `{}` |
| `UNSUBSCRIBE` | `{phase_groups: ["review"]}` |

| Server → Client | Payload |
|-----------------|---------|
| `REGISTERED` | `{agent_id, state, phase_groups?}` |
| `CUED` | `{cue_id, source, offset_beats, delay_ms, phase_group, payload?}` |
| `PRIMED` | `{cue_id, source, phase_group, pre_cued, offset_beats, payload?}` |
| `FIRE_ACK` | `{agent_id, state}` |
| `COMPLETE_ACK` | `{agent_id, state, cues_completed, result}` |
| `PHASE_ADVANCE` | `{group, point}` |
| `ERROR` | `{code, message}` |
| `PONG` | `{}` |

### REST (http://host:8765)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check with stats |
| `GET` | `/agents` | List all agents |
| `GET` | `/agents/:id` | Agent detail |
| `DELETE` | `/agents/:id` | Force-deregister |
| `GET` | `/phase-groups` | List phase groups |
| `GET` | `/cues` | Active/pending cues |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TMINUS_PORT` | `8765` | Server port |
| `TMINUS_HOST` | `0.0.0.0` | Bind address |

## Pre-Cueing Pattern

The **negative t-minus** pattern enables long-running agents that start early:

```
critic CUE(chronicler, -5, deliver)
```

→ Chronicler immediately transitions to PRIMED
→ "You should already be delivering — you started 5 beats ago"

This is how the Chronicle pattern works: chroniclers begin narrating before the main composition is complete, so they're ready to deliver when the waveform aligns.

## Development

```bash
# Run in background
TMINUS_PORT=8765 npm start &

# Run tests
node tests/simulate.js

# Custom port
TMINUS_PORT=9999 npm start
```
