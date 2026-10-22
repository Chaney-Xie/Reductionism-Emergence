const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRelationFilterContext,
  filterRelationInstances
} = require('../public/relationFilters');

const categories = {
  groups: [
    { id: 'level', children: [
      { type: 'item', id: 'local' },
      { type: 'item', id: 'terminal' }
    ] },
    { id: 'content', children: [{ type: 'item', id: 'tool' }] }
  ]
};

const descriptorGroups = {
  version: 1,
  groups: {
    metabolism: { id: 'metabolism', name: 'Metabolism', parentId: null },
    saccharide: { id: 'saccharide', name: 'Saccharide', parentId: 'metabolism' },
    glycolysis: { id: 'glycolysis', name: 'Glycolysis', parentId: 'saccharide' },
    lipid: { id: 'lipid', name: 'Lipid', parentId: 'metabolism' },
    location: { id: 'location', name: 'Location', parentId: null },
    cytoplasm: { id: 'cytoplasm', name: 'Cytoplasm', parentId: 'location' },
    mitochondrion: { id: 'mitochondrion', name: 'Mitochondrion', parentId: 'location' }
  },
  descriptorParentByEntryId: {
    vocab_glycolysis: 'glycolysis',
    vocab_lipid: 'lipid',
    vocab_cytoplasm: 'cytoplasm',
    vocab_mitochondrion: 'mitochondrion'
  }
};

const descriptorEntries = [
  { id: 'desc_glycolysis', vocabularyEntryId: 'vocab_glycolysis' },
  { id: 'desc_lipid', vocabularyEntryId: 'vocab_lipid' },
  { id: 'desc_cytoplasm', vocabularyEntryId: 'vocab_cytoplasm' },
  { id: 'desc_mitochondrion', vocabularyEntryId: 'vocab_mitochondrion' }
];

const pageIndex = { pages: [
  { id: 'P1', categoryIds: ['local', 'tool'], descriptorIds: ['desc_glycolysis', 'desc_cytoplasm'] },
  { id: 'P2', categoryIds: ['terminal', 'tool'], descriptorIds: ['desc_lipid', 'desc_mitochondrion'] },
  { id: 'P3', categoryIds: ['local'], descriptorIds: ['desc_glycolysis'] }
] };

const instances = [
  { counterpartPageId: 'P1' },
  { counterpartPageId: 'P1' },
  { counterpartPageId: 'P2' },
  { counterpartPageId: 'P3' }
];

test('relation facet counts are recursive, distinct-page based, and stable', () => {
  const context = buildRelationFilterContext({
    relationInstances: instances,
    pageIndex,
    categoryConfig: categories,
    descriptorGroups,
    descriptorEntries
  });
  assert.equal(context.descriptorGroupCounts.get('metabolism'), 3);
  assert.equal(context.descriptorGroupCounts.get('saccharide'), 2);
  assert.equal(context.descriptorGroupCounts.get('glycolysis'), 2);
  assert.equal(context.descriptorGroupCounts.get('lipid'), 1);
  assert.equal(context.descriptorGroupCounts.get('location'), 2);
  assert.equal(context.descriptorGroupCounts.get('cytoplasm'), 1);
  assert.equal(context.descriptorGroupCounts.get('mitochondrion'), 1);

  const filtered = filterRelationInstances(instances, context, {
    descriptorGroupIds: new Set(['metabolism'])
  });
  assert.equal(filtered.length, 4);
  assert.equal(context.descriptorGroupCounts.get('location'), 2);
});

test('category OR-within/AND-across and descriptor group AND semantics compose', () => {
  const context = buildRelationFilterContext({
    relationInstances: instances,
    pageIndex,
    categoryConfig: categories,
    descriptorGroups,
    descriptorEntries
  });
  const categoryFiltered = filterRelationInstances(instances, context, {
    categoryIds: new Set(['local', 'tool'])
  });
  assert.deepEqual([...new Set(categoryFiltered.map((item) => item.counterpartPageId))], ['P1']);

  const descriptorFiltered = filterRelationInstances(instances, context, {
    descriptorGroupIds: new Set(['glycolysis', 'location'])
  });
  assert.deepEqual([...new Set(descriptorFiltered.map((item) => item.counterpartPageId))], ['P1']);
});
