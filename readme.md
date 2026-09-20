# TraceMind


TraceMind is an evidence-first AI on-call engineering team. It runs specialized workers against structured observability, deployment, code, database, and infrastructure tools; persists every result; asks a skeptic to challenge the leading explanation; and requires explicit approval for consequential operations.


<img width="1071" height="733" alt="0FED1F17-165E-4638-8ABA-E205844A8AB5_1_105_c" src="https://github.com/user-attachments/assets/b804e63e-bec7-44ec-9e1d-3298d1de2328" />

## Huawei openJiuwen Multi-Agent Challenge alignment

> **Track path:** customized multi-agent application for a real-world engineering workflow.

TraceMind is built for the core challenge question: **when a high-stakes incident is ambiguous, how can a team of agents get to a safe, evidence-backed result faster than one assistant can?** It is not a chain of differently named prompts. An Incident Agent coordinates independent specialists, preserves their messages and evidence in a shared state model, and changes the investigation when the team discovers uncertainty.

| Challenge capability | How TraceMind demonstrates it |
| --- | --- |
| **Task decomposition** | The Incident Agent converts an incident into metrics, logs, deployment, code, database, and infrastructure investigation tasks. |
| **Role specialization** | Each specialist owns a distinct evidence source and returns typed findings; the Skeptic Agent has the deliberately different job of trying to falsify the leading hypothesis. |
| **Agent communication** | Structured messages include sender, recipient, type, body, timestamps, and evidence IDs. The Swarm Radio exposes this collaboration in the product. |
| **Tools and Skills** | Agents use permissioned tools for metrics, logs, deployment history, Git diffs, database health, infrastructure events, repository context, and structured external ingestion. |
| **Parallel execution** | Independent evidence agents run concurrently through the orchestration engine before synthesis. |
| **Dynamic coordination** | The Skeptic Agent creates a new Verification Agent task when a plausible competing cause—such as a Redis change—needs to be resolved. |
| **Result verification** | An independent Gemini review can cross-check OpenAI synthesis; the Verification Agent tests the competing explanation against primary evidence. |
| **Safety and recovery** | Consequential operations are modeled as persisted actions that require human approval. The system never silently rolls back a service or creates an external ticket. |
| **Reusable collaboration pattern** | The agent registry, evidence schema, scenario library, tool-permission policy, and evaluation suite make the investigation workflow reusable across incident classes. |


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

