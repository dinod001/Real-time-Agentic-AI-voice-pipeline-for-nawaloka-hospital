# FastAPI API Plan for Multi-Agent System

## Goal
Wrap the existing `AgentOrchestrator` with a FastAPI HTTP API so students can interact with the Nawaloka Health Assistant via REST endpoints (and optionally via a simple UI later).

---

## Architecture

```
Client (Postman / curl / frontend)
    │
    ▼
FastAPI (src/api/main.py)
    │
    ├── POST /chat          → agent.chat()
    ├── GET  /health        → liveness check
    ├── GET  /graph         → graph visualization (Mermaid)
    ├── GET  /memory/{user} → inspect stored facts
    └── POST /memory/clear  → clear session memory
    │
    ▼
AgentOrchestrator (existing — zero changes)
```

**Key principle:** The API is a thin wrapper. We do NOT modify any existing code (orchestrator, router, tools, memory). We only add new files.

---

## New Files (4 files)

### 1. `src/api/__init__.py`
Empty init.

### 2. `src/api/main.py`
FastAPI app with:
- **Lifespan handler** — calls `build_agent()` once at startup, stores on `app.state`
- **CORS middleware** — allow all origins (teaching project)
- **5 endpoints** (see below)

### 3. `src/api/schemas.py`
Pydantic request/response models:
- `ChatRequest(user_message, user_id, session_id)`
- `ChatResponse(answer, route, routes, action, tool_output, memory_context, latency_ms)`
- `HealthResponse(status, tools_enabled)`
- `MemoryResponse(user_id, facts)`
- `GraphResponse(mermaid_text, nodes, edges)`

### 4. `src/api/run.py`
Uvicorn runner script: `uvicorn api.main:app --reload --port 8000`

---

## Endpoints

### `POST /chat`
The core endpoint — mirrors `agent.chat()`.

```
Request:  { "user_message": "...", "user_id": "...", "session_id": "..." }
Response: { "answer": "...", "route": "...", "routes": [...], "action": "...",
            "tool_output": "...", "memory_context": "...", "latency_ms": 123 }
```

- Calls `app.state.agent.chat()`
- Returns all `AgentResponse` fields as JSON
- Error handling: 500 with detail message if agent fails

### `GET /health`
Liveness + readiness check.

```
Response: { "status": "ok", "tools": {"crm": true, "rag": true, "web": true} }
```

- Checks if agent is initialized
- Reports which tools are enabled

### `GET /graph`
Returns the LangGraph topology for visualization.

```
Response: { "mermaid": "graph TD; ...", "nodes": [...], "edges": [...] }
```

- Calls `agent.graph.get_graph().draw_mermaid()`
- Also returns structured nodes/edges list

### `GET /memory/{user_id}`
Inspect a user's stored long-term facts.

```
Response: { "user_id": "...", "facts": [{"text": "...", "tags": [...], "score": 0.5}, ...] }
```

- Queries `LongTermMemoryStore` directly via the agent's `lt_store`
- Teaching value: students see what the memory system stored

### `POST /memory/clear`
Clear a user's session memory (for demos/testing).

```
Request:  { "user_id": "...", "session_id": "..." }
Response: { "cleared": true }
```

- Deletes ST turns for the session
- Does NOT delete LT facts (those persist across sessions)

---

## Dependencies to Add

```
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
```

Added to `requirements.txt`.

---

## What We DON'T Change

- `orchestrator.py` — zero changes
- `router.py` — zero changes
- `agent_prompts.py` — zero changes
- `state.py` — zero changes
- Memory stores, tools, services — zero changes
- Notebooks — zero changes

The API is purely additive.

---

## File Structure After

```
src/
├── api/                    ← NEW
│   ├── __init__.py
│   ├── main.py             ← FastAPI app + endpoints
│   ├── schemas.py           ← Pydantic models
│   └── run.py               ← uvicorn launcher
├── agents/                  (unchanged)
├── memory/                  (unchanged)
├── services/                (unchanged)
└── infrastructure/          (unchanged)
```

---

## Teaching Value

This gives students:
1. **REST API pattern** — wrapping an AI system for production deployment
2. **Pydantic validation** — request/response schemas
3. **Lifespan management** — expensive init once, reuse across requests
4. **Observability** — every `/chat` call still creates a LangFuse trace
5. **Memory inspection** — `/memory/{user}` endpoint shows the memory system in action
6. **Graph introspection** — `/graph` endpoint returns the Mermaid diagram
