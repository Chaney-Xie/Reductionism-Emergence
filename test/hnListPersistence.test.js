'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const hnTextModel = require('../public/hnText');
const { planHnTextRevisionSave } = require('../server/hnTextPage');

function sourceEnvelope(revision, source) {
  return {
    schemaVersion: hnTextModel.HN_SCHEMA_VERSION,
    revision,
    source,
    anchors: {}
  };
}

test('the revision planner permits only an explicit legacy to source-envelope edit migration', () => {
  const legacy = {
    schemaVersion: 1,
    revision: 6,
    document: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { id: 'legacy-paragraph' },
        content: [{ type: 'text', text: 'Legacy' }]
      }]
    }
  };
  const candidate = sourceEnvelope(6, 'Legacy edited');
  const planned = planHnTextRevisionSave(legacy, candidate, 6);

  assert.equal(planned.ok, true);
  assert.equal(planned.previousRevision, 6);
  assert.equal(planned.revision, 7);
  assert.deepEqual(planned.value, { ...candidate, revision: 7 });
  assert.equal(legacy.schemaVersion, 1, 'planning cannot rewrite the loaded value');

  const downgrade = planHnTextRevisionSave({ ...candidate, revision: 7 }, {
    ...legacy,
    revision: 7
  }, 7);
  assert.equal(downgrade.ok, false);
  assert.equal(downgrade.status, 400);
});

test('server validation distinguishes malformed current saves from unsupported stored legacy data', () => {
  const current = sourceEnvelope(2, 'Current');
  const invalidCandidates = [
    { ...current, source: null },
    { ...current, anchors: { premature: { offset: 0 } } },
    { ...current, document: { type: 'doc', content: [] } },
    { ...current, schemaVersion: 99 }
  ];
  for (const candidate of invalidCandidates) {
    const rejected = planHnTextRevisionSave(current, candidate, 2);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.status, 400);
    assert.ok(Array.isArray(rejected.errors));
  }

  const unsupportedLegacy = {
    schemaVersion: 2,
    revision: 2,
    document: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { id: 'legacy-paragraph' },
        content: [{ type: 'text', text: 'Link', marks: [{ type: 'link' }] }]
      }]
    }
  };
  const rejectedLegacy = planHnTextRevisionSave(
    unsupportedLegacy,
    sourceEnvelope(2, 'Must not replace unsupported content'),
    2
  );
  assert.equal(rejectedLegacy.ok, false);
  assert.equal(rejectedLegacy.status, 422);
  assert.equal(rejectedLegacy.readOnly, true);
  assert.ok(Array.isArray(rejectedLegacy.errors));
  assert.deepEqual(hnTextModel.normalizeEnvelope(unsupportedLegacy), unsupportedLegacy);

  const future = { ...current, schemaVersion: 99 };
  const rejectedFuture = planHnTextRevisionSave(
    future,
    sourceEnvelope(2, 'Must not replace future content'),
    2
  );
  assert.equal(rejectedFuture.ok, false);
  assert.equal(rejectedFuture.status, 422);
  assert.deepEqual(hnTextModel.normalizeEnvelope(future), future);
});
