# TraceMind

An interactive hackathon MVP for an AI incident-investigation team. The dashboard demonstrates a production incident from evidence collection through skeptical verification instead of treating the answer as a single opaque model response.

## Run the dashboard

```bash
npm run dev
```

Open `http://localhost:4173`.

## Demo interactions

- Click an evidence chip to inspect its cited source in the evidence graph.
- Use **Replay investigation** to complete the skeptic-created verification task.
- Use **Simulate source failure** to show failure recovery without ending the investigation.

## Local CLI

```bash
npx tracemind incident simulate incident.json
npx tracemind trace INC-1042
npx tracemind test
```

The CLI uses the same deterministic demo scenario as the dashboard: a database connection-pool change in v4.8.2 is the leading hypothesis, while a nearby Redis configuration event is investigated and de-prioritized with counter-evidence.
