

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

### Why this is a strong openJiuwen / WorkSwarm fit

The challenge encourages **leader-driven decomposition, specialized teammates, tool invocation, dynamic collaboration, and reusable Swarm workflows**—the exact collaboration pattern TraceMind implements for on-call engineering. TraceMind uses the challenge’s valid **customized application** path: its orchestration is deliberately portable and maps directly to a WorkSwarm Leader (Incident Agent), teammates (specialist agents), Skills/tools (evidence adapters), and a reusable incident-investigation workflow. This lets a team run the product today while keeping the collaboration contract ready for WorkSwarm deployment.

### Judge checklist: what to watch in the demo

1. Start the **connection-pool regression** scenario and watch six specialist agents fan out in parallel.
2. Follow their structured evidence into the Evidence Ledger—not a model’s unsupported prose.
3. Watch the Skeptic Agent challenge the obvious explanation with the competing Redis change.
4. See the Incident Agent dynamically dispatch Verification, rule Redis out with evidence, and request—not perform—a rollback.
5. Approve the action, verify recovery, then export the postmortem or prepare an approval-gated GitHub follow-up Issue.

## Run locally