# Multi-Agentic Voice AI (Nawaloka Hospital)

> **Voice-driven LangGraph multi-agent system** — LiveKit + Deepgram STT + ElevenLabs TTS sit on top of an MCP-backed agent with a 4-tier memory, CRM integration, RAG knowledge base, real-time web search, and a decision-graph guardrail with semantic CAG cache.

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![LangGraph](https://img.shields.io/badge/LangGraph-StateGraph-green.svg)](https://langchain-ai.github.io/langgraph/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-purple.svg)](https://modelcontextprotocol.io/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-teal.svg)](https://fastapi.tiangolo.com/)
[![LiveKit](https://img.shields.io/badge/LiveKit-Agents%201.5-red.svg)](https://docs.livekit.io/agents/)
[![Deepgram](https://img.shields.io/badge/Deepgram-Nova--3-black.svg)](https://deepgram.com/)
[![ElevenLabs](https://img.shields.io/badge/ElevenLabs-Turbo%20v2.5-yellow.svg)](https://elevenlabs.io/)
[![LangFuse](https://img.shields.io/badge/LangFuse-Observability-orange.svg)](https://langfuse.com/)

---

## Architecture

The system has **two entry surfaces** sharing a single multi-agent core: a text path used by the FastAPI/web UI, and a voice path used by the LiveKit worker. Both paths terminate at the same `orchestrator.achat()` so business logic, memory, and tools live in exactly one place.

```
┌──────────────── TEXT PATH (Week 13) ────────────────┐   ┌──────────── VOICE PATH (Week 14) ─────────────┐
│                                                       │   │                                                │
│   Browser  ──► FastAPI /chat  ──► decision_graph     │   │   Caller mic  ──► LiveKit Cloud (WebRTC)      │
│                                       │              │   │                        │                       │
│                                  guardrail (Llama)   │   │                  Silero VAD                    │
│                                       │              │   │                        │                       │
│                                   CAG cache (Qdrant) │   │                Deepgram STT (streaming)        │
│                                       │              │   │                        │                       │
│                                       └─► achat() ◄──┼───┼─◄ LangGraphLLMAdapter ─┘                       │
│                                                       │   │           │                                    │
└───────────────────────────────────────────────────────┘   │  ElevenLabs TTS ◄── response                  │
                            │                              │           │                                    │
                            ▼                              │  WebRTC ──► caller speaker                     │
        ┌──────────────────────────────────┐               └────────────────────────────────────────────────┘
        │   AgentOrchestrator (LangGraph)  │
        │                                  │
        │   recall ─► supervisor ─► fan-out ─► merge ─► save_memory
        │                              │
        │           ┌──────────────────┼─────────────────┐
        │           ▼                  ▼                 ▼
        │      admin_agent       clinical_agent     direct_agent
        │      (CRM via MCP)     (RAG: Qdrant KB)   (web + memory)
        └──────────────────────────────────┘
                            │
                            ▼
                  ┌──────────────────────┐
                  │   4-tier Memory       │
                  │   (ST / LT / EP / Pr) │
                  │   Supabase + pgvector │
                  └──────────────────────┘
```

**Key boundary:** `src/voice/` is a self-contained side-car. It calls `orchestrator.achat()` and nothing else; no edits to `src/api/routers/chat.py` or `src/agents/orchestrator.py`. Trade-off: voice currently bypasses the text-path's `decision_graph` (guardrail + CAG short-circuit) — that promotion is planned for Week 15.

### Voice pipeline internals

```
LiveKit Agent (livekit.agents.voice.Agent)
    │
    ├── VAD          : silero.VAD.load(activation_threshold, min_silence_duration)
    ├── STT          : deepgram.STT(model="nova-3", language="en")        ← streaming
    ├── LLM          : LangGraphLLMAdapter(orchestrator)                   ← bridge
    │                     │
    │                     └── _run() ─► orchestrator.achat(text, user_id, session_id)
    │                                       │
    │                                       └── ChatChunk(role="assistant", content=answer)
    │
    └── TTS          : elevenlabs.TTS(model="eleven_turbo_v2_5", voice_id) ← streaming
```

EOU (end-of-utterance) policy is three-layered: VAD silence → endpointing buffer → STT finalisation. All three are tunable in `config/param.yaml` under the `voice:` block.

### MCP integration layer

```
orchestrator.py (build_agent_mcp)
        │
  MCP Client Layer (langchain-mcp-adapters)
        │
   ┌────┼────────────┐
   │    │            │
nawaloka  nawaloka     postgres
 -crm     -memory       MCP
(custom)  (custom)  (off-the-shelf)
   │         │            │
CRMTool  MemoryOps    Supabase
   │         │         raw SQL
Supabase  pgvector
```

Three MCP servers, three origins (custom / custom / off-the-shelf), one agent. The LangGraph topology is unchanged — only the tool integration boundary moved to MCP.

---

## Project Structure

```
Voice AI Pipelines/
│
├── src/
│   ├── voice/                          # ← Week 14 — voice side-car
│   │   ├── __init__.py                 # Public exports
│   │   ├── config.py                   # VoiceConfig + load_voice_config + env validation
│   │   ├── stt.py                      # Deepgram STT factory (make_stt)
│   │   ├── tts.py                      # ElevenLabs / Deepgram TTS factory (make_tts)
│   │   ├── adapter.py                  # LangGraphLLMAdapter — LLM iface → orchestrator.achat()
│   │   ├── pipeline.py                 # VoiceSession + SessionManager + barge-in helpers
│   │   ├── agent.py                    # build_voice_agent() + create_and_start_agent()
│   │   └── run.py                      # Worker entrypoint: python -m voice.run
│   │
│   ├── agents/                         # LangGraph orchestration (Week 10–13)
│   │   ├── orchestrator.py             # build_agent() + build_agent_mcp() + AgentOrchestrator
│   │   ├── decision_graph.py           # Text-path: guardrail → CAG → orchestrator
│   │   ├── guardrail.py                # Llama-based safety + intent gate
│   │   ├── router.py                   # LLM intent classifier (multi-route)
│   │   ├── state.py                    # AgentState TypedDict
│   │   ├── prompts/agent_prompts.py    # All prompts (router, agents, merge)
│   │   └── tools/
│   │       ├── crm_tool.py             # Supabase CRM (patients, doctors, bookings)
│   │       ├── rag_tool.py             # Qdrant KB with CAG + CRAG
│   │       └── web_search_tool.py      # Tavily real-time search
│   │
│   ├── mcp_servers/                    # MCP server wrappers (Week 12)
│   │   ├── crm_server.py               # CRM MCP: 5 tools over CRMTool
│   │   ├── memory_server.py            # Memory MCP: 6 tools over 4-tier memory
│   │   └── mcp_config.py               # Launch config for all 3 servers
│   │
│   ├── api/                            # FastAPI async API (Week 13)
│   │   ├── main.py                     # App factory + lifespan
│   │   ├── routers/chat.py             # /chat, /chat/stream (calls decision_graph)
│   │   ├── schemas.py                  # Pydantic request/response models
│   │   └── run.py                      # Uvicorn launcher
│   │
│   ├── memory/                         # 4-tier memory system
│   │   ├── st_store.py                 # Short-term: Supabase ring buffer
│   │   ├── lt_store.py                 # Long-term: pgvector semantic facts
│   │   ├── episodic_store.py           # Episodic: full conversation snapshots
│   │   ├── procedural_store.py         # Procedural: step-by-step workflows
│   │   ├── memory_ops.py               # Distiller + Recaller (token-budgeted)
│   │   ├── schemas.py                  # ConversationTurn, MemoryFact, Episode
│   │   └── prompts.py                  # Distillation + recall prompts
│   │
│   ├── services/
│   │   ├── chat_service/               # CAG cache, CRAG pipeline, RAG chain
│   │   ├── crm_service/                # Supabase CRM queries
│   │   └── ingest_service/             # Document chunking + Qdrant indexing
│   │
│   └── infrastructure/                 # Cross-cutting concerns
│       ├── config.py                   # Environment + model + param.yaml loader
│       ├── observability.py            # LangFuse tracing + prompt management
│       ├── llm/                        # LLM + embedding factories
│       ├── db/                         # Supabase, Qdrant, SQLAlchemy clients
│       └── log.py                      # Loguru setup
│
├── notebooks/
│   ├── 01_routing_memory_and_tools.ipynb   # Week 10/12: routing, 4 memory tiers, tools
│   ├── 02_multi_agent_langgraph.ipynb      # Week 12: LangGraph + MCP graph viz
│   ├── 03_voice_pipeline_fundamentals.ipynb  # ← Week 14: STT/TTS/VAD/EOU standalone
│   └── 04_voice_agent_livekit.ipynb         # ← Week 14: voice + agent integration
│
├── docker/
│   ├── api/Dockerfile                  # FastAPI service
│   ├── web/Dockerfile                  # Next.js UI service
│   └── voice/Dockerfile                # ← Week 14: LiveKit worker (cloud-only)
│
├── scripts/
│   ├── seed_crm_unified.py             # Seed Supabase with patients, doctors, bookings
│   ├── ingest_to_qdrant.py             # Ingest hospital docs into Qdrant
│   ├── seed_procedures.py              # Seed procedural memory workflows
│   ├── rebuild_cag_cache.py            # Pre-warm the CAG FAQ cache
│   ├── test_langgraph.py               # 7-turn multi-agent conversation test
│   └── test_mcp_agent.py               # MCP-backed agent end-to-end demo
│
├── config/
│   └── param.yaml                      # Tunables — includes the voice: block
│
├── docs/
│   ├── Week 14 - Voice AI Pipelines.pdf
│   ├── Week 14 - Voice AI Slides Content.md
│   ├── Voice_AI_Pipelines_Teaching_Script.docx
│   ├── TEACHER_GUIDELINE.docx
│   ├── STUDENT_GUIDELINE.docx
│   └── Week 12 …                       # Earlier-week material kept for reference
│
├── ui/                                 # Next.js + Tailwind text chat UI
├── docker-compose.yml                  # api + web (default), voice (profile)
├── Makefile                            # demo / demo-voice / voice / voice-test …
├── pyproject.toml                      # Project name: multi-agentic-voice-ai
├── requirements.txt                    # Pinned dependencies (in sync with pyproject.toml)
├── .env                                # Secrets (not committed)
└── .env.example                        # Template — includes voice section
```

---

## Key Components

### Voice layer (Week 14)

| File | What it owns |
|------|--------------|
| `voice/config.py` | `VoiceConfig` dataclass loaded from `config/param.yaml` (`voice:` section). Validates env per-provider — only checks `ELEVEN_API_KEY` if `tts_provider=elevenlabs`, etc. |
| `voice/stt.py` | `make_stt(cfg)` → `deepgram.STT(model=cfg.stt_model, language=cfg.stt_language)` |
| `voice/tts.py` | `make_tts(cfg)` — provider dispatch. Returns `elevenlabs.TTS(...)` or `deepgram.TTS(...)` based on `cfg.tts_provider`. |
| `voice/adapter.py` | `LangGraphLLMAdapter(LLM)` and `LangGraphLLMStream`. Translates the LiveKit LLM interface into a single `orchestrator.achat()` call and emits one `ChatChunk(role="assistant", content=answer)`. Holds the in-flight task so `cancel_current()` can interrupt it on barge-in. |
| `voice/agent.py` | `build_voice_agent(...)` factory wires VAD + STT + adapter + TTS into `livekit.agents.voice.Agent(allow_interruptions=True, min_endpointing_delay=...)`. `create_and_start_agent(ctx)` is the LiveKit entrypoint that joins the room, builds the agent, starts the `AgentSession`, and says the greeting. |
| `voice/run.py` | `cli.run_app(WorkerOptions(entrypoint_fnc=...))` — what `make voice` invokes. |

The voice path is **strictly additive**. Removing `src/voice/` (and the voice deps from `requirements.txt`) leaves Week 13 fully functional.

### MCP servers

| Server | Type | Tools exposed | Wraps |
|--------|------|---------------|-------|
| `nawaloka-crm` | Custom Python | `lookup_patient`, `search_doctors`, `create_booking`, `cancel_booking`, `reschedule_booking` | `agents/tools/crm_tool.py` |
| `nawaloka-memory` | Custom Python | `recall_context`, `get_recent_turns`, `add_turn`, `search_facts`, `store_fact`, `list_facts` | `memory/memory_ops.py` + ST/LT stores |
| `postgres` | Off-the-shelf | Raw SQL access to all Supabase tables | `@modelcontextprotocol/server-postgres` |

Two entry points in `orchestrator.py`:

| Factory | CRM Source | Use case |
|---------|-----------|----------|
| `build_agent()` | Direct Python import | Standalone, no MCP dependency |
| `build_agent_mcp()` | MCP client over stdio | MCP-backed, portable tools |

Both build the same `AgentOrchestrator` with the same graph topology.

### LangGraph StateGraph

| Node | What it does | Key files |
|------|-------------|-----------|
| `recall` | Loads ST turns + LT facts into AgentState | `memory_ops.py` |
| `supervisor` | LLM classifies intent into 1–3 routes | `router.py` |
| `admin_agent` | CRM operations (via MCP or direct) | `crm_tool.py` |
| `clinical_agent` | RAG KB + patient medical history | `rag_tool.py` |
| `direct_agent` | Greetings, web search, memory recall | `web_search_tool.py` |
| `merge_responses` | Combines parallel agent outputs | `orchestrator.py` |
| `save_memory` | Stores turns + distils LT facts | `memory_ops.py` |

### Decision graph (text path only — Week 13)

```
user_message ─► guardrail ─► (block?) ─► refusal
                    │
                    ▼
                CAG cache  ─► (hit ≥0.93?) ─► cached_answer (≈ 290 ms)
                    │
                    ▼
              orchestrator.achat()  ─► AgentResponse
```

Voice currently calls `achat()` directly, skipping `guardrail` and `CAG`. That's intentional for now (kept the voice surface minimal) and slated for promotion in Week 15.

### 4-tier memory

| Tier | Storage | Purpose |
|------|---------|---------|
| **Short-Term** | Supabase (`st_turns`) | Recent conversation turns (ring buffer) |
| **Long-Term Semantic** | Supabase + pgvector | Distilled facts (medications, allergies) |
| **Episodic** | Supabase + pgvector | Full conversation snapshots with summaries |
| **Procedural** | JSON + embeddings | Step-by-step workflows (booking, triage) |

### Tools

| Tool | Backend | Capabilities |
|------|---------|-------------|
| **CRM** | Supabase (PostgreSQL) | Patient lookup, doctor search, booking CRUD |
| **RAG** | Qdrant Cloud | CAG cache (semantic dedup) + CRAG (corrective retrieval) |
| **Web Search** | Tavily API | Real-time hospital info (hours, directions) |

---

## Run the demos (Docker)

The Compose stack is profile-based:

| Command | What comes up | Containers |
|---------|---------------|------------|
| `make demo` | Default text stack | `api` + `web` |
| `make demo-voice` | Text stack + voice worker | `api` + `web` + `voice` |
| `make voice` | Voice worker only (native, foreground) | — |
| `make voice-test` | Validate voice config + env vars | — |
| `make demo-down` | Stop default stack | — |
| `make demo-voice-down` | Stop voice profile | — |
| `make demo-logs` / `make voice-logs` | Tail logs | — |

```bash
# Text-only (Week 13)
make demo
# → Web UI:  http://localhost:8080
# → API:    http://localhost:8000  (Swagger at /docs)

# Add the voice worker (Week 14, requires LiveKit Cloud + Deepgram + ElevenLabs keys)
make demo-voice
# → Connect a browser via https://agents-playground.livekit.io to your LiveKit project
```

First boot of the text stack takes ~60 s for lifespan warmup (loads the embedder + pre-seeds the CAG cache with 96 FAQ entries). Subsequent boots reuse the `hf_cache` Docker volume.

The voice worker has no exposed port — it dials outbound to `LIVEKIT_URL` and registers as a worker. Use `make voice-logs` to confirm registration.

**Try these to see each route light up (text):**

| Question | What it exercises | Latency |
|---|---|---|
| `What are the opening hours?` | CAG cache → FAQ hit | ~290 ms |
| `Do I have a booking next week?` | CRM → Supabase patient lookup | ~3–5 s |
| `How do I claim insurance?` | CAG cache → FAQ hit | ~290 ms |

`make demo` will create `.env` from the template the first time and tell you what to fill in. **Use Supabase port 6543 (transaction pooler) — port 5432 caps at 15 clients and exhausts in minutes under chat load.**

---

## Quick Start (local Python)

### 1. Environment

```bash
cp .env.example .env
# Text stack:
#   OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY,
#   QDRANT_URL, QDRANT_API_KEY, TAVILY_API_KEY,
#   LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY
#
# Voice stack adds:
#   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
#   DEEPGRAM_API_KEY, ELEVEN_API_KEY
```

### 2. Install

```bash
pip install -e .                # uses pyproject.toml
# or: pip install -r requirements.txt
```

`pyproject.toml` is the source of truth; `requirements.txt` is generated to be in lock-step. Both ship the same 60+ dependencies including the voice stack (`livekit`, `livekit-agents`, `livekit-plugins-{deepgram,elevenlabs,silero}`, `deepgram-sdk`, `elevenlabs`, `sounddevice`, `onnxruntime`, `torch`).

### 3. Seed data

```bash
cd src
python ../scripts/init_supabase.py        # Create tables
python ../scripts/seed_crm_unified.py     # Patients, doctors, bookings
python ../scripts/ingest_to_qdrant.py     # Hospital docs → Qdrant
python ../scripts/seed_procedures.py      # Procedural memory
python ../scripts/rebuild_cag_cache.py    # FAQ cache pre-warm
```

### 4. Run notebooks

```bash
jupyter notebook notebooks/
# Week 12 path:  01 → 02
# Week 14 path:  03 (standalone STT/TTS/VAD/EOU) → 04 (voice + agent integration)
```

### 5. Test MCP servers standalone

```bash
cd src && npx @modelcontextprotocol/inspector python -m mcp_servers.crm_server
cd src && npx @modelcontextprotocol/inspector python -m mcp_servers.memory_server
cd src && python ../scripts/test_mcp_agent.py
```

### 6. Run API server

```bash
python -m src.api.run
# Or: uvicorn src.api.main:app --reload --port 8000
```

### 7. Run the voice worker

```bash
make voice-test                 # validate env + print VoiceConfig
make voice                      # foreground LiveKit worker
# Then connect via https://agents-playground.livekit.io
```

---

## Voice configuration

`config/param.yaml`:

```yaml
voice:
  stt_provider: deepgram
  stt_model: nova-3
  stt_language: en
  tts_provider: elevenlabs            # or `deepgram`
  tts_model: eleven_turbo_v2_5
  tts_voice_id: l7kNoIfnJKPg7779LI2t  # Aria (ElevenLabs default)
  vad_threshold: 0.5                  # Silero — higher = stricter speech detection
  silence_threshold_ms: 500           # End-of-turn silence required
  min_endpointing_delay: 0.5          # Buffer after VAD says "silent"
  interruption_enabled: true          # Barge-in on
  sample_rate: 16000
```

**Tuning knobs and their feel:**

| Knob | Lower | Higher |
|------|-------|--------|
| `vad_threshold` | More false positives (background noise becomes "speech") | Soft speakers get cut off |
| `silence_threshold_ms` | Snappy but interrupts people who pause | Polite but feels laggy |
| `min_endpointing_delay` | Fast turn-around | Better tolerates last-syllable trail-off |

Latency budget at the defaults: ~3–5 s end-to-end (user stops talking → first audio byte). Roughly 1 s of that is EOU + STT, the rest is dominated by `orchestrator.achat()`.

---

## MCP integration details

### How MCP tools are consumed

```python
# orchestrator.py — build_agent_mcp()

from langchain_mcp_adapters.client import MultiServerMCPClient
from mcp_servers.mcp_config import build_mcp_server_config

mcp_client = MultiServerMCPClient(build_mcp_server_config())
tools = await mcp_client.get_tools()   # discovers 11 tools from 3 servers
crm_tool = _MCPCRMToolAdapter(tools)   # same dispatch() interface
```

### MCP server architecture (stdio transport)

```
Host Process (LangGraph agent)
  │
  ├── spawns subprocess ──► CRM MCP Server (crm_server.py)
  │                            │
  ├── stdin  (JSON-RPC) ───►|
  ├── stdout (JSON-RPC) ◄──|
  │                            │
  └── stderr (logs only) ◄──|
```

> **Important:** Never `print()` inside an MCP server. stdout is reserved for the JSON-RPC protocol. Use `loguru` (defaults to stderr).

---

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/chat` | Send message, get AI response (decision graph → orchestrator) |
| `POST` | `/chat/stream` | SSE stream: node-by-node state updates |
| `GET` | `/health` | Liveness check + tool availability |
| `GET` | `/graph` | LangGraph topology (Mermaid + structured nodes/edges) |
| `GET` | `/memory/{user_id}` | Inspect long-term semantic facts |
| `POST` | `/memory/clear` | Clear a session's short-term memory |

### Example

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"user_message": "Who are the cardiologists?", "user_id": "94781030736", "session_id": "demo"}'

curl -N http://localhost:8000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"user_message": "What cardiac services does the hospital offer?", "user_id": "94781030736", "session_id": "demo"}'

curl http://localhost:8000/health
curl http://localhost:8000/graph
```

The voice worker has no HTTP surface — it talks LiveKit's room protocol over WebRTC.

---

## External services

| Service | Purpose | Free tier |
|---------|---------|-----------|
| [Supabase](https://supabase.com) | PostgreSQL + pgvector (CRM + memory) | Yes |
| [Qdrant Cloud](https://qdrant.tech) | Vector DB (RAG knowledge base + CAG cache) | Yes (1 GB) |
| [OpenAI](https://openai.com) | GPT-4o-mini (routing), Gemini (synthesis), embeddings | Pay-per-use |
| [Tavily](https://tavily.com) | Real-time web search | 1 000 free searches/mo |
| [LangFuse](https://langfuse.com) | Tracing, cost tracking, prompt versioning | Free (hobby) |
| [LiveKit Cloud](https://cloud.livekit.io) | WebRTC infrastructure for voice rooms | Yes (dev tier) |
| [Deepgram](https://deepgram.com) | Streaming STT (Nova-3) | $200 credit |
| [ElevenLabs](https://elevenlabs.io) | Streaming TTS (Turbo v2.5) | 10 k chars/mo free |

---

## Course context

This codebase is the **Week 14** material for the AI Engineer Essentials bootcamp. It builds incrementally on every prior week:

| Week | Topic | Approach | What it added |
|------|-------|----------|---------------|
| 6 | Agentic design patterns | From scratch | The vocabulary |
| 7 | Memory + routing + multi-agent | From scratch | Memory, classifier router |
| 9 | LangGraph fundamentals | LangGraph | StateGraph mental model |
| 10 | Multi-agent system (rebuilt) | LangGraph | Fan-out/fan-in topology |
| 12 | MCP integration (portable tools) | LangGraph + MCP | Tool boundary moves to MCP |
| 13 | Containerised + decision graph | + Docker, FastAPI, Next.js, guardrail, CAG | Production-shaped text app |
| **14** | **Voice interface** | **+ LiveKit, Deepgram, ElevenLabs, Silero** | **STT/TTS/VAD/EOU + voice side-car** |
| 15 (planned) | Self-hosted LiveKit + voice on decision_graph | | Local LiveKit server, voice through CAG |

The Week 14 upgrade is **purely additive** — `make demo` (Week 13) still works untouched. Voice is opt-in via the `voice` Compose profile.

---

## Observability

Every `.chat()` and `.achat()` call creates a LangFuse trace with nested spans:

```
trace: agent_chat
  ├── node_recall        (ST + LT retrieval)
  ├── node_supervisor    (router LLM generation)
  ├── node_[agent]       (tool call + synthesis via MCP)
  └── node_save_memory   (ST store + LT distillation)
```

Voice calls show up identically — the trace is started inside `achat()`, so it doesn't matter whether the caller was the FastAPI route or the LiveKit adapter. Dashboard: [LangFuse Cloud](https://cloud.langfuse.com) → Traces → filter by tag `agent`.

---

## Dependency highlights

```
# Voice stack (Week 14)
livekit>=1.0.0
livekit-agents>=1.5.0
livekit-plugins-deepgram>=1.5.0
livekit-plugins-elevenlabs>=1.5.0
livekit-plugins-silero>=1.5.0
deepgram-sdk>=6.0.0
elevenlabs>=2.0.0
sounddevice>=0.5.0
onnxruntime>=1.17.0
torch>=2.0.0

# MCP (Week 12)
mcp>=1.27.0
fastmcp>=3.0.0
langchain-mcp-adapters>=0.2.2
```

`pyproject.toml` and `requirements.txt` ship in lock-step (60+ packages each). To add a dependency: edit both files in the same commit, or regenerate via `pip-compile pyproject.toml -o requirements.txt`.
