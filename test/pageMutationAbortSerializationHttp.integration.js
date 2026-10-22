const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('client abort never releases an active mutation and queued aborts are skipped', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-abort-serialization-'));
  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const postTitle = (pageId, title, signal) => fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
    signal
  });

  const created = await fetch(`${origin}/api/pages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(created.status, 201);
  const pageId = (await created.json()).page.id;
  const pagePath = path.join(vaultRoot, 'pages', `${pageId}.json`);

  const originalWriteFile = fs.writeFile;
  let armedDelay = null;
  let queuedMutationStarted = false;
  fs.writeFile = async (filePath, contents, ...args) => {
    const text = typeof contents === 'string' ? contents : contents.toString('utf8');
    if (path.resolve(filePath) === pagePath && text.includes('"title": "Queued Must Not Run"')) {
      queuedMutationStarted = true;
    }
    if (armedDelay && path.resolve(filePath) === pagePath
      && text.includes(`"title": "${armedDelay.title}"`)) {
      const current = armedDelay;
      armedDelay = null;
      current.entered.resolve();
      await current.release.promise;
    }
    return originalWriteFile.call(fs, filePath, contents, ...args);
  };
  t.after(() => { fs.writeFile = originalWriteFile; });

  function armDelay(title) {
    const gate = { title, entered: deferred(), release: deferred() };
    armedDelay = gate;
    return gate;
  }

  const abandonedGate = armDelay('Abandoned Rename');
  const abandonedController = new AbortController();
  const abandonedRequest = postTitle(pageId, 'Abandoned Rename', abandonedController.signal)
    .catch((error) => error);
  await abandonedGate.entered.promise;
  abandonedController.abort();
  await abandonedRequest;

  let winningSettled = false;
  const winningRequest = postTitle(pageId, 'Winning Rename')
    .then((response) => {
      winningSettled = true;
      return response;
    });
  try {
    await delay(40);
    assert.equal(winningSettled, false, 'later mutation must wait for the abandoned active handler');
  } finally {
    abandonedGate.release.resolve();
  }
  assert.equal((await winningRequest).status, 200);
  assert.equal(JSON.parse(await fs.readFile(pagePath, 'utf8')).title, 'Winning Rename');

  const blockingGate = armDelay('Blocking Rename');
  const blockingRequest = postTitle(pageId, 'Blocking Rename');
  await blockingGate.entered.promise;

  const queuedBody = JSON.stringify({ title: 'Queued Must Not Run' });
  const queuedAborted = deferred();
  const queuedRequest = http.request(`${origin}/api/pages/${pageId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(queuedBody)
    }
  });
  queuedRequest.on('error', () => queuedAborted.resolve());
  queuedRequest.on('close', () => queuedAborted.resolve());
  queuedRequest.end(queuedBody);
  await delay(30);
  queuedRequest.destroy();
  await queuedAborted.promise;

  let finalSettled = false;
  const finalRequest = postTitle(pageId, 'Final Rename').then((response) => {
    finalSettled = true;
    return response;
  });
  try {
    await delay(40);
    assert.equal(finalSettled, false, 'later work must remain queued behind the active handler');
  } finally {
    blockingGate.release.resolve();
  }
  assert.equal((await blockingRequest).status, 200);
  assert.equal((await finalRequest).status, 200, 'aborted queued request must not deadlock the queue');
  assert.equal(queuedMutationStarted, false, 'aborted queued mutation must never enter its handler');
  assert.equal(JSON.parse(await fs.readFile(pagePath, 'utf8')).title, 'Final Rename');
});
