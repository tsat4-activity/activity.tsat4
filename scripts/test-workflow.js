import assert from 'node:assert/strict';
import { calcReduction } from '../server/modules/act/workflow.js';
import { createApp } from '../server/app.js';

console.log('Testing Work Flow Automation module...');

// 1. calcReduction unit tests
assert.equal(calcReduction(100, 20), 80, '100 to 20 should be 80% reduction');
assert.equal(calcReduction(50, 50), 0, '50 to 50 should be 0% reduction');
assert.equal(calcReduction(0, 10), null, 'Before 0 should be null (N/A)');
assert.equal(calcReduction(null, 10), null, 'Before null should be null (N/A)');
assert.equal(calcReduction(60, 45), 25, '60 to 45 should be 25% reduction');
console.log('ok   calcReduction formula and zero-division protection');

// 2. HTTP endpoints smoke test
const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  // Stats endpoint rejects without auth
  const resNoAuth = await fetch(`${base}/api/workflow/stats`);
  assert.ok([401, 503].includes(resNoAuth.status), 'Should refuse without session');
  console.log('ok   API guards require session');
} finally {
  server.close();
}

console.log('All workflow tests passed!');
