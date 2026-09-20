import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';

process.env.TRACEMIND_NO_LISTEN = '1';
process.env.TRACEMIND_DB = '/private/tmp/tracemind-orchestration.test.db';
const { createIncident, hydrateIncident, approve, scenarios, toolPermissions } = await import('../server.js');

test('agent workflow persists evidence, skeptic task, and approval boundary', async () => {
  const incidentId = await createIncident({ scenario: 'connection_pool', title: 'Checkout is broken' });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const state = hydrateIncident(incidentId);
  assert.equal(state.incident.status, 'awaiting_approval');
  assert.ok(state.evidence.length >= 8, 'specialists should persist evidence');
  assert.ok(state.tasks.some(t => t.agent === 'skeptic_agent'));
  assert.ok(state.tasks.some(t => t.agent === 'verification_agent' && t.status === 'completed'));
  const action = state.actions.find(a => a.status === 'pending_approval');
  assert.equal(action.kind, 'rollback_deployment');
  await approve(incidentId, action.id);
  assert.equal(hydrateIncident(incidentId).incident.status, 'mitigated');
});

test('scenario library and permission boundary remain explicit', () => {
  assert.equal(Object.keys(scenarios).length, 6);
  assert.equal(toolPermissions.query_metrics, 'read');
  assert.equal(toolPermissions.rollback_deployment, 'write');
});

test.after(async () => {
  await Promise.all(['', '-shm', '-wal'].map(suffix => rm(`/private/tmp/tracemind-orchestration.test.db${suffix}`, { force: true })));
});
