import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../backend/server.js';

test('demo endpoints and 5–10 minute validation', async () => {
 const server = createServer().listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 const base = 'http://127.0.0.1:' + server.address().port;
 try {
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.liveIntegration, false);
  const list = await (await fetch(base + '/api/tonies')).json();
  assert.equal(list.tonies.length, 3);
  const request = minutes => fetch(base + '/api/story', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idea:'friendly dragon',minutes})});
  assert.equal((await request(4)).status,400);
  assert.equal((await request(11)).status,400);
  assert.equal((await request(5)).status,200);
  assert.equal((await request(10)).status,200);
  assert.equal((await fetch(base + '/api/upload',{method:'POST'})).status,501);
 } finally { await new Promise(resolve => server.close(resolve)); }
});
