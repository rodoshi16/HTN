# TraceMind


TraceMind is an evidence-first AI on-call engineering team. It runs specialized workers against structured observability, deployment, code, database, and infrastructure tools; persists every result; asks a skeptic to challenge the leading explanation; and requires explicit approval for consequential operations.


<img width="1071" height="733" alt="0FED1F17-165E-4638-8ABA-E205844A8AB5_1_105_c" src="https://github.com/user-attachments/assets/b804e63e-bec7-44ec-9e1d-3298d1de2328" />


## Run locally

```bash
npm run dev
```

The server hosts the web workspace and API at `http://localhost:4173`. It creates `tracemind.db` locally on first run.

## Architecture

- **SQLite source of truth**: incidents, tasks, evidence, findings, hypotheses, messages, actions, approvals, and timeline events.
- **Concurrent agent orchestration**: metrics, logs, deployment, code, database, and infrastructure agents run concurrently. The skeptic then adds a dynamic verification task.
- **Evidence provenance**: every finding has immutable evidence IDs; the agent never presents an inference as a fact.
- **Safety boundary**: tool permissions are modeled explicitly. Rollback is created as a pending action and can only run in the simulator after approval.
- **Streaming**: the server exposes incident-scoped Server-Sent Events for agent activity, findings, and completion.
- **Six simulated environments**: connection-pool regression, Redis outage, bad application deploy, external dependency outage, resource saturation, and dual faults.

## Model providers

The product runs its deterministic, structured simulated environment with no credentials. If keys are provided, OpenAI is used for evidence-constrained incident synthesis and Gemini independently reviews the evidence without receiving the primary conclusion.

```bash
export OPENAI_API_KEY=...
export OPENAI_MODEL=gpt-5
export GEMINI_API_KEY=...
export GEMINI_MODEL=gemini-3.8-flash
npm install
npm run dev
```
The OpenAI adapter uses the Responses API with strict JSON Schema output and `store: false`. Gemini loads its current official `@google/genai` SDK only when configured; it is an optional dependency so local simulation has no installation requirement.

## API

```text
GET  /api/scenarios
POST /api/incidents                 { "scenario": "connection_pool" }
GET  /api/incidents/:id
GET  /api/incidents/:id/events      (SSE)
POST /api/incidents/:id/chat        { "message": "What changed?" }
POST /api/incidents/:id/approve     { "actionId": "act_..." }
```

## CLI and tests

```bash
./tracemind serve
./tracemind incident simulate incident.json --failure metrics-api
./tracemind trace INC-1042
npm test
```
