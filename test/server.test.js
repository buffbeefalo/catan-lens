import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { writeFile, rm } from 'node:fs/promises';

const content = Buffer.from(Array.from({ length: 4097 }, (_, i) => i % 251));
const names = [`.range-test-${randomUUID()}.mp4`, `.range-empty-${randomUUID()}.mp4`, `.range-large-${randomUUID()}.mp4`];
const files = names.map(name => new URL(`../public/media/${name}`, import.meta.url));
let child, base;

before(async () => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  await writeFile(files[0], content, { flag: 'wx' });
  await writeFile(files[1], '', { flag: 'wx' });
  await writeFile(files[2], Buffer.alloc(2 * 1024 * 1024, 17), { flag: 'wx' });
  child = spawn(process.execPath, [new URL('../serve.js', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code]) => { throw new Error(`server exited ${code}: ${errors}`); }),
  ]);
  base = `http://127.0.0.1:${port}`;
}, { timeout: 5000 });

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
  await Promise.all(files.map(file => rm(file, { force: true })));
}, { timeout: 5000 });

const media = () => `${base}/media/${names[0]}`;
const bytes = async response => Buffer.from(await response.arrayBuffer());

test('local media GET and HEAD report the full size without sending a HEAD body', async () => {
  const full = await fetch(media());
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('content-length'), String(content.length));
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(await bytes(full), content);
  const head = await fetch(media(), { method: 'HEAD', headers: { Range: 'bytes=0-1' } });
  assert.equal(head.status, 200, 'Range applies to GET only');
  assert.equal(head.headers.get('content-length'), String(content.length));
  assert.equal((await bytes(head)).length, 0);
});

test('local media supports bounded, open-ended and suffix byte ranges', async () => {
  for (const [range, start, end] of [
    ['bytes=0-31', 0, 31], ['bytes=4090-', 4090, 4096], ['bytes=-64', 4033, 4096],
    ['bytes=4090-999999', 4090, 4096], ['bytes=-99999999999999999999999', 0, 4096],
  ]) {
    const response = await fetch(media(), { headers: { Range: range } });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${content.length}`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(await bytes(response), content.subarray(start, end + 1));
  }
});

test('unsatisfiable ranges return the file size and do not terminate the server', async () => {
  for (const range of ['bytes=4097-', 'bytes=50-20', 'bytes=-0', 'bytes=999999999999999999999999-']) {
    const response = await fetch(media(), { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), `bytes */${content.length}`);
    assert.equal((await bytes(response)).length, 0);
  }
  assert.deepEqual(await bytes(await fetch(media())), content);
});

test('unsupported range formats and conditional ranges receive the whole representation', async () => {
  for (const headers of [{ Range: 'items=0-1' }, { Range: 'bytes=0-1,8-9' }, { Range: 'bytes=0-1', 'If-Range': '"unissued-validator"' }]) {
    const response = await fetch(media(), { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await bytes(response), content);
  }
});

test('empty local files have a zero length and no satisfiable byte range', async () => {
  const url = `${base}/media/${names[1]}`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '0');
  assert.equal((await bytes(response)).length, 0);
  const range = await fetch(url, { headers: { Range: 'bytes=0-' } });
  assert.equal(range.status, 416);
  assert.equal(range.headers.get('content-range'), 'bytes */0');
});

test('streaming retains the public-file boundary and the explicit research document route', async () => {
  const escaped = await fetch(`${base}/%2e%2e%2fpackage.json`);
  assert.equal(escaped.status, 403);
  assert.equal((await fetch(`${base}/.git/config`)).status, 404);
  const research = await fetch(`${base}/docs/RESEARCH.md`);
  assert.equal(research.status, 200);
  assert.match(await research.text(), /Production first/);
});

test('cancelled video downloads leave the local server available for the next seek', async () => {
  for (let i = 0; i < 4; i++) {
    const response = await fetch(`${base}/media/${names[2]}`);
    const reader = response.body.getReader();
    assert.ok((await reader.read()).value.length > 0);
    await reader.cancel();
  }
  const response = await fetch(media(), { headers: { Range: 'bytes=1024-1055' } });
  assert.equal(response.status, 206);
  assert.deepEqual(await bytes(response), content.subarray(1024, 1056));
});
