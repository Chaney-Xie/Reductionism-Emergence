const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalRemoval,
  canExplicitlyExclude,
  restoreSource
} = require('../public/descriptorMutation');
const { createDescriptorModel } = require('../server/descriptorModel');

test('normal descriptor removal ignores only states with automatic support', () => {
  assert.deepEqual(normalRemoval([{ source: 'manual' }]), {
    manual: true,
    auto: false,
    createIgnored: false,
    rememberManual: false
  });
  assert.deepEqual(normalRemoval([{ source: 'auto' }]), {
    manual: false,
    auto: true,
    createIgnored: true,
    rememberManual: false
  });
  assert.deepEqual(normalRemoval([{ source: 'manual' }, { source: 'auto' }]), {
    manual: true,
    auto: true,
    createIgnored: true,
    rememberManual: true
  });
});

test('explicit class exclusion is offered only for manual-only descriptors', () => {
  assert.equal(canExplicitlyExclude([{ source: 'manual' }]), true);
  assert.equal(canExplicitlyExclude([{ source: 'auto' }]), false);
  assert.equal(canExplicitlyExclude([{ source: 'manual' }, { source: 'auto' }]), false);
});

test('restore provenance chooses manual only when required', () => {
  assert.equal(restoreSource({ ignoredManual: true, hasAutoSupport: true }), 'manual');
  assert.equal(restoreSource({ ignoredManual: false, hasAutoSupport: true }), 'auto');
  assert.equal(restoreSource({ ignoredManual: false, hasAutoSupport: false }), 'manual');
});

test('ignored manual provenance stays a normalized subset and supports remap/delete', () => {
  const samples = {
    'descriptors.json': {
      classes: ['class_1', 'class_2'].map((id) => ({ id, label: id })),
      groups: [],
      entries: []
    }
  };
  const model = createDescriptorModel(samples);
  const ignored = {
    class_1: [
      { entryId: 'A', restoreManual: true },
      { entryId: 'B' }
    ],
    class_2: []
  };
  const provenance = model.normalizeIgnoredManualEntryIds(
    { class_1: ['B', 'missing'], class_2: ['A'] },
    ignored
  );
  assert.deepEqual(provenance, { class_1: ['B', 'A'], class_2: [] });

  assert.equal(model.remapDescriptorIdsInGroups(provenance, new Map([['A', 'C']])), true);
  assert.deepEqual(provenance.class_1, ['B', 'C']);
  assert.equal(model.removeDescriptorIdsFromPageDescriptors(provenance, new Set(['B'])), true);
  assert.deepEqual(provenance.class_1, ['C']);
});

test('draft descriptor definitions keep their stable ids when materialized', () => {
  const samples = {
    'descriptors.json': {
      classes: [{ id: 'class_1', label: 'Class 1' }],
      groups: [],
      entries: []
    }
  };
  const model = createDescriptorModel(samples);
  const descriptorLibrary = structuredClone(samples['descriptors.json']);
  const vocabularyLibrary = { version: 1, entries: [] };
  const draft = {
    class_1: [{
      entryId: 'desc_draft_stable',
      vocabularyEntryId: 'vocab_draft_stable',
      display: 'A',
      source: 'manual'
    }]
  };

  assert.equal(model.materializeDescriptorDraftDefinitions(
    draft,
    descriptorLibrary,
    vocabularyLibrary,
    '2026-07-15T00:00:00.000Z'
  ), true);
  assert.equal(descriptorLibrary.entries[0].id, 'desc_draft_stable');
  assert.equal(vocabularyLibrary.entries[0].id, 'vocab_draft_stable');
  assert.equal(model.materializeDescriptorDraftDefinitions(
    draft,
    descriptorLibrary,
    vocabularyLibrary,
    '2026-07-15T00:00:00.000Z'
  ), false);
});
