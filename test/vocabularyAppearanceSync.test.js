const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  CHANNEL_NAME,
  MESSAGE_TYPE,
  isAppearanceInvalidation,
  createPublisher,
  createInvalidationClient
} = require('../public/vaultAppearanceEvents');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createBroadcastChannelClass(origin = 'vault-origin') {
  const groups = new Map();
  class FakeBroadcastChannel {
    static instances = [];

    constructor(name) {
      this.name = name;
      this.origin = origin;
      this.closed = false;
      this.listeners = new Set();
      this.messages = [];
      const key = `${origin}:${name}`;
      this.group = groups.get(key) || new Set();
      groups.set(key, this.group);
      this.group.add(this);
      FakeBroadcastChannel.instances.push(this);
    }

    addEventListener(type, listener) {
      if (type === 'message') this.listeners.add(listener);
    }

    removeEventListener(type, listener) {
      if (type === 'message') this.listeners.delete(listener);
    }

    postMessage(message) {
      if (this.closed) throw new Error('BroadcastChannel is closed.');
      const copy = structuredClone(message);
      this.messages.push(copy);
      for (const peer of this.group) {
        if (peer === this || peer.closed) continue;
        for (const listener of peer.listeners) listener({ data: structuredClone(copy) });
        peer.onmessage?.({ data: structuredClone(copy) });
      }
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.group.delete(this);
    }
  }
  return FakeBroadcastChannel;
}

test('Appearance events carry invalidation metadata only', () => {
  const BroadcastChannelImpl = createBroadcastChannelClass();
  const observer = new BroadcastChannelImpl(CHANNEL_NAME);
  let received = null;
  observer.addEventListener('message', (event) => { received = event.data; });
  const publisher = createPublisher({ BroadcastChannelImpl });

  assert.equal(publisher.publish({ generation: 7, appearance: { accentColour: '#123456' } }), true);
  assert.deepEqual(received, { type: MESSAGE_TYPE, generation: 7 });
  assert.equal('appearance' in received, false);
  assert.equal(isAppearanceInvalidation(received), true);
  assert.equal(isAppearanceInvalidation({ type: 'dictionary-data-changed' }), false);

  publisher.close();
  observer.close();
});

test('Vocabulary startup and later invalidation share one authoritative refetch/apply owner', async () => {
  const BroadcastChannelImpl = createBroadcastChannelClass();
  const appearances = [
    { accentColour: '#111111' },
    { accentColour: '#222222' }
  ];
  const applied = [];
  const client = createInvalidationClient({
    BroadcastChannelImpl,
    fetchAppearance: async () => appearances.shift(),
    applyAppearance: (appearance, context) => applied.push({ appearance, context })
  });
  const publisher = createPublisher({ BroadcastChannelImpl });

  const startup = await client.refresh({ reason: 'startup' });
  assert.equal(startup.applied, true);
  assert.deepEqual(applied, [{
    appearance: { accentColour: '#111111' },
    context: { reason: 'startup', generation: 1 }
  }]);

  publisher.publish();
  await nextTurn();
  assert.deepEqual(applied.at(-1), {
    appearance: { accentColour: '#222222' },
    context: { reason: 'notification', generation: 2 }
  });

  client.close();
  publisher.close();
});

test('a slower old Appearance refetch cannot overwrite a newer notification result', async () => {
  const BroadcastChannelImpl = createBroadcastChannelClass();
  const requests = [];
  const applied = [];
  const client = createInvalidationClient({
    BroadcastChannelImpl,
    fetchAppearance: () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    applyAppearance: (appearance) => applied.push(appearance)
  });
  const publisher = createPublisher({ BroadcastChannelImpl });

  const startup = client.refresh({ reason: 'startup' });
  publisher.publish({ generation: 2 });
  assert.equal(requests.length, 2);

  requests[1].resolve({ accentColour: '#BBBBBB' });
  await nextTurn();
  requests[0].resolve({ accentColour: '#AAAAAA' });
  const oldResult = await startup;
  await nextTurn();

  assert.deepEqual(applied, [{ accentColour: '#BBBBBB' }]);
  assert.equal(oldResult.applied, false);
  assert.equal(oldResult.stale, true);

  client.close();
  publisher.close();
});

test('failed refresh preserves the currently applied CSS state and later refresh remains usable', async () => {
  const errors = [];
  const applied = [];
  const responses = [
    Promise.resolve({ themeColour: '#111111' }),
    Promise.reject(new Error('temporary read failure')),
    Promise.resolve({ themeColour: '#333333' })
  ];
  const client = createInvalidationClient({
    BroadcastChannelImpl: null,
    fetchAppearance: () => responses.shift(),
    applyAppearance: (appearance) => applied.push(appearance),
    onError: (error, context) => errors.push({ error, context })
  });

  await client.refresh({ reason: 'startup' });
  const failed = await client.refresh({ reason: 'notification' });
  assert.equal(failed.applied, false);
  assert.deepEqual(applied, [{ themeColour: '#111111' }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].context.phase, 'fetch');

  await client.refresh({ reason: 'notification' });
  assert.deepEqual(applied, [
    { themeColour: '#111111' },
    { themeColour: '#333333' }
  ]);
  client.close();
});

test('closing the child channel invalidates in-flight work and ignores later events', async () => {
  const BroadcastChannelImpl = createBroadcastChannelClass();
  const pending = deferred();
  const applied = [];
  let fetchCount = 0;
  const client = createInvalidationClient({
    BroadcastChannelImpl,
    fetchAppearance: () => {
      fetchCount += 1;
      return pending.promise;
    },
    applyAppearance: (appearance) => applied.push(appearance)
  });
  const publisher = createPublisher({ BroadcastChannelImpl });

  const refresh = client.refresh();
  client.close();
  pending.resolve({ accentColour: '#123456' });
  assert.equal((await refresh).stale, true);
  publisher.publish();
  await nextTurn();
  assert.equal(fetchCount, 1);
  assert.deepEqual(applied, []);

  publisher.close();
});

test('BroadcastChannel delivery remains scoped to the child window origin', async () => {
  const VaultAChannel = createBroadcastChannelClass('vault-a-origin');
  const VaultBChannel = createBroadcastChannelClass('vault-b-origin');
  let fetchCount = 0;
  const client = createInvalidationClient({
    BroadcastChannelImpl: VaultAChannel,
    fetchAppearance: async () => {
      fetchCount += 1;
      return {};
    },
    applyAppearance: () => {}
  });
  const otherVaultPublisher = createPublisher({ BroadcastChannelImpl: VaultBChannel });

  otherVaultPublisher.publish();
  await nextTurn();
  assert.equal(fetchCount, 0);

  const sameVaultPublisher = createPublisher({ BroadcastChannelImpl: VaultAChannel });
  sameVaultPublisher.publish();
  await nextTurn();
  assert.equal(fetchCount, 1);

  client.close();
  sameVaultPublisher.close();
  otherVaultPublisher.close();
});

test('Vocabulary loads the sync owner before runtime and uses it for startup, events, and pagehide', async () => {
  const root = path.join(__dirname, '..');
  const [html, source, eventsSource] = await Promise.all([
    fs.readFile(path.join(root, 'public/vocabulary.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/vocabulary.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/vaultAppearanceEvents.js'), 'utf8')
  ]);

  assert.ok(html.indexOf('appearanceSettings.js') < html.indexOf('vaultAppearanceEvents.js'));
  assert.ok(html.indexOf('vaultAppearanceEvents.js') < html.indexOf('vocabulary.js'));
  assert.match(source, /vaultAppearanceEventsModel\.createInvalidationClient\(\{/);
  assert.match(source, /fetchAppearance: \(\) => request\('\/api\/appearance'\)/);
  assert.match(source, /applyAppearanceSettings\?\.\([\s\S]*?document\.documentElement,[\s\S]*?appearance/);
  assert.match(source, /appearanceInvalidationClient\.refresh\(\{ reason: 'startup' \}\)/);
  assert.match(source, /window\.addEventListener\('pagehide', \(\) => appearanceInvalidationClient\.close\(\)\)/);
  assert.equal((source.match(/request\('\/api\/appearance'/g) || []).length, 1);
  assert.match(eventsSource, /const CHANNEL_NAME = 'cogneuro-vault-appearance'/);
  assert.doesNotMatch(eventsSource, /ipcRenderer|electron|window\.opener|localStorage/);
});
