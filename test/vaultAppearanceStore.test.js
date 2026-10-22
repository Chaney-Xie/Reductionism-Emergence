const test = require('node:test');
const assert = require('node:assert/strict');

const appearanceSettingsModel = require('../public/appearanceSettings');
const {
  createHttpAppearancePersistence,
  createVaultAppearanceStore
} = require('../public/vaultAppearanceStore');

function clone(value) {
  return structuredClone(value);
}

function normalized(value = null) {
  return appearanceSettingsModel.normalizeAppearanceSettings(value);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createControlledPersistence(initial = normalized()) {
  let canonical = clone(initial);
  const saves = [];
  const refetches = [];
  return {
    get canonical() {
      return clone(canonical);
    },
    set canonical(value) {
      canonical = clone(value);
    },
    persist(value) {
      const gate = deferred();
      const call = { appearance: clone(value), gate };
      saves.push(call);
      return gate.promise.then((result = call.appearance) => {
        canonical = clone(result);
        return clone(result);
      });
    },
    refetch() {
      const gate = deferred();
      refetches.push(gate);
      return gate.promise;
    },
    resolveRefetch(index = refetches.length - 1, value = canonical) {
      canonical = clone(value);
      refetches[index].resolve(clone(value));
    },
    saves,
    refetches
  };
}

function createStore(persistence, options = {}) {
  return createVaultAppearanceStore({
    model: appearanceSettingsModel,
    initialAppearance: options.initialAppearance || normalized(),
    persist: persistence.persist.bind(persistence),
    refetch: persistence.refetch.bind(persistence),
    notifyCommitted: options.notifyCommitted,
    logger: options.logger
  });
}

test('store starts with one normalized immutable snapshot and subscription owner', () => {
  const persistence = createControlledPersistence();
  const store = createVaultAppearanceStore({
    model: appearanceSettingsModel,
    initialAppearance: { accentColour: '#abcdef' },
    persist: persistence.persist.bind(persistence),
    refetch: persistence.refetch.bind(persistence)
  });
  const emissions = [];
  const unsubscribe = store.subscribe((snapshot, meta) => emissions.push({ snapshot, meta }));

  assert.equal(store.snapshot().accentColour, '#ABCDEF');
  assert.equal(store.authoritativeSnapshot().accentColour, '#ABCDEF');
  assert.equal(Object.isFrozen(store.snapshot()), true);
  assert.equal(Object.isFrozen(store.snapshot().blockAppearance.monochrome.opacity), true);
  assert.equal(emissions.length, 1);
  assert.equal(emissions[0].meta.reason, 'subscribed');
  assert.equal(emissions[0].meta.authoritative, true);
  assert.equal(unsubscribe(), true);
});

test('update publishes synchronously and ordinary saves use exactly one serialized tail', async () => {
  const persistence = createControlledPersistence();
  const committed = [];
  const store = createStore(persistence, {
    notifyCommitted: (snapshot, meta) => committed.push({ snapshot, meta })
  });
  const emissions = [];
  store.subscribe((snapshot, meta) => emissions.push({ snapshot, meta }), { emitCurrent: false });

  const markdownSave = store.update((draft) => {
    draft.markdownColours.text.bold = '#112233';
  }, { label: 'markdown-bold' });
  assert.equal(store.snapshot().markdownColours.text.bold, '#112233');
  assert.equal(emissions.at(-1).meta.reason, 'optimistic');

  const blockSave = store.update((draft) => {
    draft.blockAppearance.monochrome.colour = '#445566';
  }, { label: 'block-colour' });
  assert.equal(store.snapshot().markdownColours.text.bold, '#112233');
  assert.equal(store.snapshot().blockAppearance.monochrome.colour, '#445566');

  await tick();
  assert.equal(persistence.saves.length, 1);
  assert.equal(persistence.saves[0].appearance.markdownColours.text.bold, '#112233');
  assert.equal(persistence.saves[0].appearance.blockAppearance.monochrome.colour, '#6785A3');

  persistence.saves[0].gate.resolve();
  await markdownSave;
  await tick();
  assert.equal(persistence.saves.length, 2);
  assert.equal(persistence.saves[1].appearance.markdownColours.text.bold, '#112233');
  assert.equal(persistence.saves[1].appearance.blockAppearance.monochrome.colour, '#445566');
  assert.equal(store.snapshot().blockAppearance.monochrome.colour, '#445566');
  assert.equal(committed.length, 0, 'an intermediate accepted response is not current');

  persistence.saves[1].gate.resolve();
  await blockSave;
  await store.flush();
  assert.equal(committed.length, 1);
  assert.equal(committed[0].snapshot.markdownColours.text.bold, '#112233');
  assert.equal(committed[0].snapshot.blockAppearance.monochrome.colour, '#445566');
  assert.equal(committed[0].meta.reason, 'committed');
  assert.equal(committed[0].meta.authoritative, true);
});

test('an older authoritative response is rebased beneath every newer local intent', async () => {
  const persistence = createControlledPersistence();
  const store = createStore(persistence);
  const oldSave = store.update((draft) => {
    draft.themeColour = '#010203';
  }, { label: 'old' });
  const newSave = store.update((draft) => {
    draft.fileTypography.fontSize = 19;
  }, { label: 'new' });

  await tick();
  const oldServerResponse = clone(persistence.saves[0].appearance);
  oldServerResponse.fileTypography.fontSize = 14.4;
  persistence.saves[0].gate.resolve(oldServerResponse);
  await oldSave;
  assert.equal(store.snapshot().themeColour, '#010203');
  assert.equal(store.snapshot().fileTypography.fontSize, 19);

  await tick();
  assert.equal(persistence.saves[1].appearance.themeColour, '#010203');
  assert.equal(persistence.saves[1].appearance.fileTypography.fontSize, 19);
  persistence.saves[1].gate.resolve();
  await newSave;
  assert.equal(store.authoritativeSnapshot().fileTypography.fontSize, 19);
});

test('failure of an older save refetches canonical state and preserves a newer intent', async () => {
  const initial = normalized();
  const persistence = createControlledPersistence(initial);
  const store = createStore(persistence);
  const oldSave = store.update((draft) => {
    draft.canvasSurfaceColour = '#101112';
  }, { label: 'old-fails' });
  const newSave = store.update((draft) => {
    draft.guideBorderBrightnessAdjustment = 0.22;
  }, { label: 'new-survives' });

  await tick();
  persistence.saves[0].gate.reject(new Error('old write failed'));
  await tick();
  assert.equal(persistence.refetches.length, 1);
  persistence.resolveRefetch(0, initial);
  await assert.rejects(oldSave, /old write failed/);

  assert.equal(store.snapshot().canvasSurfaceColour, initial.canvasSurfaceColour);
  assert.equal(store.snapshot().guideBorderBrightnessAdjustment, 0.22);
  await tick();
  assert.equal(persistence.saves.length, 2);
  assert.equal(persistence.saves[1].appearance.canvasSurfaceColour, initial.canvasSurfaceColour);
  assert.equal(persistence.saves[1].appearance.guideBorderBrightnessAdjustment, 0.22);
  persistence.saves[1].gate.resolve();
  await newSave;
  assert.equal(store.snapshot().guideBorderBrightnessAdjustment, 0.22);
});

test('failure of the latest save rolls back uniformly and the queue stays usable', async () => {
  const initial = normalized();
  const recovered = normalized({ accentColour: '#223344' });
  const persistence = createControlledPersistence(initial);
  const store = createStore(persistence);
  const failing = store.update((draft) => {
    draft.accentColour = '#AABBCC';
  }, { label: 'latest-fails' });

  await tick();
  persistence.saves[0].gate.reject(new Error('disk unavailable'));
  await tick();
  persistence.resolveRefetch(0, recovered);
  await assert.rejects(failing, /disk unavailable/);
  assert.equal(store.snapshot().accentColour, '#223344');
  assert.equal(store.authoritativeSnapshot().accentColour, '#223344');

  const succeeding = store.update((draft) => {
    draft.themeSoftOpacity = 0.25;
  }, { label: 'queue-reused' });
  await tick();
  assert.equal(persistence.saves[1].appearance.accentColour, '#223344');
  assert.equal(persistence.saves[1].appearance.themeSoftOpacity, 0.25);
  persistence.saves[1].gate.resolve();
  await succeeding;
  await store.flush();
  assert.equal(store.snapshot().themeSoftOpacity, 0.25);
});

test('failed canonical recovery falls back to the last accepted base without poisoning the tail', async () => {
  const persistence = createControlledPersistence();
  const store = createStore(persistence);
  const failing = store.update((draft) => {
    draft.toolBorderColour = '#010101';
  });
  await tick();
  persistence.saves[0].gate.reject(new Error('save failure'));
  await tick();
  persistence.refetches[0].reject(new Error('refetch failure'));
  await assert.rejects(failing, /save failure/);
  assert.equal(store.snapshot().toolBorderColour, normalized().toolBorderColour);

  const next = store.update((draft) => {
    draft.toolBorderColour = '#020202';
  });
  await tick();
  persistence.saves[1].gate.resolve();
  await next;
  assert.equal(store.snapshot().toolBorderColour, '#020202');
});

test('specialized transaction installs returned Appearance and rebases later ordinary intent', async () => {
  const persistence = createControlledPersistence();
  const committed = [];
  const store = createStore(persistence, {
    notifyCommitted: (snapshot) => committed.push(snapshot)
  });
  const transactionGate = deferred();
  let transactionBase;
  const transaction = store.transaction((authoritative) => {
    transactionBase = authoritative;
    return transactionGate.promise;
  }, {
    label: 'global-apply',
    selectAppearance: (result) => result.appearance
  });
  const laterSave = store.update((draft) => {
    draft.markdownColours.headingMode = 'by-level';
  }, { label: 'later-markdown' });

  assert.equal(store.snapshot().markdownColours.headingMode, 'by-level');
  await tick();
  assert.equal(persistence.saves.length, 0, 'the transaction is not an ordinary PUT');
  assert.equal(transactionBase.accentColour, normalized().accentColour);

  const transactionAppearance = normalized({
    accentColour: '#556677',
    blockAppearance: {
      colourful: true,
      colourfulBlock: { presets: [], lastUsedColour: '#123456' },
      monochrome: {
        colour: '#123456',
        opacity: { status1: 0, status2: 0.35, status3: 0.65 },
        borderWidth: 2
      }
    }
  });
  transactionGate.resolve({ appearance: transactionAppearance, pagesChanged: 3 });
  assert.equal((await transaction).pagesChanged, 3);
  assert.equal(store.snapshot().accentColour, '#556677');
  assert.equal(store.snapshot().markdownColours.headingMode, 'by-level');

  await tick();
  assert.equal(persistence.saves.length, 1);
  assert.equal(persistence.saves[0].appearance.accentColour, '#556677');
  assert.equal(persistence.saves[0].appearance.markdownColours.headingMode, 'by-level');
  assert.equal(committed.length, 0);
  persistence.saves[0].gate.resolve();
  await laterSave;
  await store.flush();
  assert.equal(committed.length, 1);
  assert.equal(committed[0].accentColour, '#556677');
});

test('transaction failure uses the same canonical recovery and does not consume later intent', async () => {
  const initial = normalized();
  const persistence = createControlledPersistence(initial);
  const store = createStore(persistence);
  const transactionGate = deferred();
  const transaction = store.transaction(() => transactionGate.promise);
  const later = store.update((draft) => {
    draft.systemTypography.fontFamilies = ['Arial', 'system-ui'];
  });

  await tick();
  transactionGate.reject(new Error('transaction conflict'));
  await tick();
  persistence.resolveRefetch(0, initial);
  await assert.rejects(transaction, /transaction conflict/);
  assert.deepEqual(store.snapshot().systemTypography.fontFamilies, ['Arial', 'system-ui']);
  await tick();
  assert.deepEqual(
    persistence.saves[0].appearance.systemTypography.fontFamilies,
    ['Arial', 'system-ui']
  );
  persistence.saves[0].gate.resolve();
  await later;
});

test('load is serialized and rebases an intent issued while canonical fetch is pending', async () => {
  const persistence = createControlledPersistence();
  const store = createStore(persistence);
  const load = store.load({ label: 'bootstrap', publish: false });
  const save = store.update((draft) => {
    draft.pageTypography.fontSize = 24;
  }, { label: 'during-load' });
  assert.equal(store.snapshot().pageTypography.fontSize, 24);

  await tick();
  const loaded = normalized({ guideSurfaceColour: '#AABBCC' });
  persistence.resolveRefetch(0, loaded);
  await load;
  assert.equal(store.snapshot().guideSurfaceColour, '#AABBCC');
  assert.equal(store.snapshot().pageTypography.fontSize, 24);

  await tick();
  assert.equal(persistence.saves[0].appearance.guideSurfaceColour, '#AABBCC');
  assert.equal(persistence.saves[0].appearance.pageTypography.fontSize, 24);
  persistence.saves[0].gate.resolve();
  await save;
});

test('replace is an optimistic whole-document intent in the same ordinary queue', async () => {
  const persistence = createControlledPersistence();
  const store = createStore(persistence);
  const replacement = normalized({
    toolSurfaceColour: '#102030',
    fileTypography: { fontFamilies: ['Arial'], fontSize: 18 }
  });
  const save = store.replace(replacement, { label: 'reset' });
  assert.equal(store.snapshot().toolSurfaceColour, '#102030');
  assert.deepEqual(store.snapshot().fileTypography, {
    fontFamilies: ['Arial'],
    fontSize: 18
  });
  await tick();
  assert.deepEqual(persistence.saves[0].appearance, replacement);
  persistence.saves[0].gate.resolve();
  await save;
});

test('invalid and asynchronous reducers cannot publish or enter persistence', () => {
  const persistence = createControlledPersistence();
  const store = createStore(persistence);
  let emissionCount = 0;
  store.subscribe(() => { emissionCount += 1; }, { emitCurrent: false });

  assert.throws(() => store.update((draft) => {
    draft.accentColour = 'red';
  }), /Colours must use six-digit HEX/);
  assert.throws(() => store.update(async (draft) => {
    draft.accentColour = '#010203';
  }), /reducers must be synchronous/);
  assert.equal(emissionCount, 0);
  assert.equal(persistence.saves.length, 0);
});

test('subscriber and committed-notification failures are isolated from state and queue', async () => {
  const persistence = createControlledPersistence();
  const logged = [];
  const store = createStore(persistence, {
    logger: { error: (...args) => logged.push(args) },
    notifyCommitted: async () => { throw new Error('notification failed'); }
  });
  store.subscribe(() => { throw new Error('subscriber failed'); });
  const observed = [];
  store.subscribe((snapshot) => observed.push(snapshot.accentColour));

  const first = store.update((draft) => {
    draft.accentColour = '#010203';
  });
  await tick();
  persistence.saves[0].gate.resolve();
  await first;
  await store.flush();
  await tick();
  assert.equal(store.snapshot().accentColour, '#010203');
  assert.equal(observed.at(-1), '#010203');
  assert.equal(logged.some((entry) => String(entry[0]).includes('subscriber')), true);
  assert.equal(logged.some((entry) => String(entry[0]).includes('notification')), true);

  const second = store.update((draft) => {
    draft.accentColour = '#040506';
  });
  await tick();
  persistence.saves[1].gate.resolve();
  await second;
  assert.equal(store.snapshot().accentColour, '#040506');
});

test('HTTP persistence helper is the single ordinary GET/PUT transport owner', async () => {
  const calls = [];
  const request = async (...args) => {
    calls.push(args);
    return { ok: true };
  };
  const persistence = createHttpAppearancePersistence(request, {
    endpoint: '/api/custom-appearance'
  });
  const value = normalized({ themeColour: '#123456' });

  await persistence.persist(value);
  await persistence.refetch();
  assert.deepEqual(calls, [
    ['/api/custom-appearance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    }],
    ['/api/custom-appearance']
  ]);
  assert.equal(Object.isFrozen(persistence), true);
});

test('UMD export exposes the same pure store authority to a browser global', () => {
  assert.equal(globalThis.vaultAppearanceStoreModel.createVaultAppearanceStore,
    createVaultAppearanceStore);
  assert.equal(globalThis.vaultAppearanceStoreModel.createHttpAppearancePersistence,
    createHttpAppearancePersistence);
});
