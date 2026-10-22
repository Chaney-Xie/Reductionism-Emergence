const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deleteGroup,
  childGroupIds,
  moveSelection,
  normalizeDescriptorGroups,
  remapMemberships,
  resolveDescriptorIdsForGroup,
  validateDescriptorGroups
} = require('../public/descriptorGroups');

function config() {
  return normalizeDescriptorGroups({
    version: 1,
    groups: {
      A: { id: 'A', name: 'A', parentId: null },
      B: { id: 'B', name: 'B', parentId: 'A' },
      C: { id: 'C', name: 'C', parentId: 'B' },
      Z: { id: 'Z', name: 'Z', parentId: null }
    },
    descriptorParentByEntryId: { one: 'A', two: 'B', three: 'C', loose: 'Z' }
  });
}

test('recursive descriptor group resolution includes all descendants without duplicates', () => {
  assert.deepEqual(resolveDescriptorIdsForGroup(config(), 'A'), ['one', 'three', 'two']);
  assert.deepEqual(resolveDescriptorIdsForGroup(config(), 'B'), ['three', 'two']);
  assert.deepEqual(resolveDescriptorIdsForGroup(config(), 'C'), ['three']);
  assert.deepEqual(resolveDescriptorIdsForGroup(config(), 'missing'), []);
  const vocabularyBacked = normalizeDescriptorGroups({
    groups: { A: { id: 'A', name: 'A', parentId: null } },
    descriptorParentByEntryId: { vocab_x: 'A' }
  });
  assert.deepEqual(resolveDescriptorIdsForGroup(vocabularyBacked, 'A', [
    { id: 'desc_x', vocabularyEntryId: 'vocab_x' }
  ]), ['desc_x']);
});

test('direct descriptor-group children are presented A to Z independently at every depth', () => {
  const groups = normalizeDescriptorGroups({
    groups: {
      root: { id: 'root', name: 'BioChem', parentId: null },
      metabolism: { id: 'metabolism', name: 'Metabolism', parentId: 'root' },
      anatomy: { id: 'anatomy', name: 'Anatomy', parentId: 'root' },
      zymology: { id: 'zymology', name: 'Zymology', parentId: 'metabolism' },
      energy: { id: 'energy', name: 'Energy', parentId: 'metabolism' }
    }
  });

  assert.deepEqual(childGroupIds(groups, 'root'), ['anatomy', 'metabolism']);
  assert.deepEqual(childGroupIds(groups, 'metabolism'), ['energy', 'zymology']);
});

test('normalization repairs missing parents and malformed cycles without deleting groups', () => {
  const malformed = {
    groups: {
      A: { id: 'A', name: 'A', parentId: 'B' },
      B: { id: 'B', name: 'B', parentId: 'A' },
      C: { id: 'C', name: 'C', parentId: 'missing' }
    }
  };
  assert.equal(validateDescriptorGroups(malformed).valid, false);
  const repaired = normalizeDescriptorGroups(malformed);
  assert.deepEqual(Object.keys(repaired.groups).sort(), ['A', 'B', 'C']);
  assert.equal(validateDescriptorGroups(repaired).valid, true);
  assert.equal(repaired.groups.C.parentId, null);
});

test('multi-move normalizes descendants and rejects cycles atomically', () => {
  const source = config();
  const moved = moveSelection(source, [
    { type: 'group', id: 'B' },
    { type: 'group', id: 'C' },
    { type: 'descriptor', id: 'three' }
  ], { kind: 'group', groupId: 'Z' });
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.items, [{ type: 'group', id: 'B' }]);
  assert.equal(moved.config.groups.B.parentId, 'Z');
  assert.equal(moved.config.groups.C.parentId, 'B');
  assert.equal(moved.config.descriptorParentByEntryId.three, 'C');

  const invalid = moveSelection(source, [{ type: 'group', id: 'B' }], {
    kind: 'group', groupId: 'C'
  });
  assert.equal(invalid.changed, false);
  assert.match(invalid.error, /descendant/);
  assert.deepEqual(invalid.config, source);
});

test('delete removes one hierarchy level and never deletes contained descriptors', () => {
  const nested = deleteGroup(config(), 'B').config;
  assert.equal(nested.groups.C.parentId, 'A');
  assert.equal(nested.descriptorParentByEntryId.two, 'A');
  assert.equal(nested.descriptorParentByEntryId.three, 'C');

  const top = deleteGroup(config(), 'A').config;
  assert.equal(top.groups.B.parentId, null);
  assert.equal(top.descriptorParentByEntryId.one, undefined);
  assert.equal(top.descriptorParentByEntryId.two, 'B');
});

test('dictionary remap keeps target membership and otherwise transfers source membership', () => {
  const source = config();
  const targetWins = remapMemberships(source, { one: 'loose' });
  assert.equal(targetWins.config.descriptorParentByEntryId.loose, 'Z');
  assert.equal(targetWins.config.descriptorParentByEntryId.one, undefined);

  const transfers = remapMemberships(source, { two: 'replacement' });
  assert.equal(transfers.config.descriptorParentByEntryId.replacement, 'B');
  assert.equal(transfers.config.descriptorParentByEntryId.two, undefined);
});
