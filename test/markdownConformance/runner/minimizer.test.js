'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { minimizeFailure, writeMinimizedRegression } = require('./minimizer');

const baseSequence = Object.freeze({
  id: 'random.same-source-and-actions',
  fixtureId: 'same-fixture',
  initialSource: '1. A',
  initialSelection: Object.freeze({ anchor: 4, focus: 4 }),
  state: Object.freeze({ active: true }),
  actions: Object.freeze([
    Object.freeze({ id: 'enter', key: 'Enter', type: 'keyboard' })
  ])
});

async function minimize(sequence) {
  return minimizeFailure(sequence, async (candidate) => candidate.actions.length === 1);
}

test('minimized regression filenames distinguish Source and Live Preview identity', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-minimizer-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const source = await minimize({ ...baseSequence, mode: 'source' });
  const livePreview = await minimize({ ...baseSequence, mode: 'live-preview' });
  assert.notEqual(source.minimizedSequence.id, livePreview.minimizedSequence.id);

  const sourcePath = writeMinimizedRegression(directory, source);
  const livePreviewPath = writeMinimizedRegression(directory, livePreview);
  assert.notEqual(path.basename(sourcePath), path.basename(livePreviewPath));
  assert.deepEqual(
    fs.readdirSync(directory).sort(),
    [path.basename(sourcePath), path.basename(livePreviewPath)].sort()
  );
});

test('minimized regression identity includes state and initial selection', async () => {
  const baseline = await minimize({ ...baseSequence, mode: 'source' });
  const inactive = await minimize({
    ...baseSequence,
    mode: 'source',
    state: { active: false }
  });
  const differentSelection = await minimize({
    ...baseSequence,
    mode: 'source',
    initialSelection: { anchor: 3, focus: 3 }
  });

  assert.notEqual(baseline.minimizedSequence.id, inactive.minimizedSequence.id);
  assert.notEqual(baseline.minimizedSequence.id, differentSelection.minimizedSequence.id);
});
