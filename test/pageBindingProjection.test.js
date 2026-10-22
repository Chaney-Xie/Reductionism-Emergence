const test = require('node:test');
const assert = require('node:assert/strict');
const navigationSort = require('../public/navigationSort');
const pageBindingProjection = require('../public/pageBindingProjection');

const pages = [
  {
    id: 'page_a', title: 'Alpha',
    createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z'
  },
  {
    id: 'page_b', title: 'Beta',
    createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z'
  },
  {
    id: 'page_c', title: 'Charlie',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-03T00:00:00.000Z'
  }
];
const bindings = [{
  id: 'binding_1', leaderPageId: 'page_a', followerPageIds: ['page_c', 'page_b']
}];

function project(visiblePageIds, options = {}) {
  return pageBindingProjection.projectContainer({
    pageIds: pages.map((page) => page.id),
    pages,
    visiblePageIds,
    bindings,
    comparePages: navigationSort.comparePages,
    sortMode: options.sortMode || 'name_asc',
    synthetic: options.synthetic === true
  });
}

test('visible Leader projects real follower Pages sorted by every existing comparator', () => {
  for (const mode of navigationSort.SORT_OPTIONS.map((option) => option.value)) {
    const [unit] = project(new Set(pages.map((page) => page.id)), { sortMode: mode });
    assert.equal(unit.page.id, 'page_a');
    assert.equal(unit.visualRole, 'leader');
    assert.deepEqual(
      unit.followerPages.map((page) => page.id),
      navigationSort.sortPages(pages.slice(1), mode).map((page) => page.id)
    );
    assert.equal(unit.followerPages[0], pages.find((page) => page.id === unit.followerPages[0].id));
  }
});

test('filtering is independent and a hidden Leader flattens only visible Followers', () => {
  let units = project(new Set(['page_b', 'page_c']));
  assert.deepEqual(units.map((unit) => [unit.page.id, unit.visualRole]), [
    ['page_b', 'ordinary'], ['page_c', 'ordinary']
  ]);

  units = project(new Set(['page_a', 'page_c']));
  assert.deepEqual(units.map((unit) => unit.page.id), ['page_a']);
  assert.deepEqual(units[0].followerPages.map((page) => page.id), ['page_c']);

  units = project(new Set(['page_c']));
  assert.deepEqual(units.map((unit) => [unit.page.id, unit.visualRole]), [
    ['page_c', 'ordinary']
  ]);
  assert.deepEqual(project(new Set()), []);
});

test('dynamic/system containers ignore Binding projection and retain ordinary real occurrences', () => {
  const units = project(new Set(pages.map((page) => page.id)), { synthetic: true });
  assert.deepEqual(units.map((unit) => ({
    id: unit.page.id,
    visualRole: unit.visualRole,
    followerCount: unit.followerPages.length
  })), [
    { id: 'page_a', visualRole: 'ordinary', followerCount: 0 },
    { id: 'page_b', visualRole: 'ordinary', followerCount: 0 },
    { id: 'page_c', visualRole: 'ordinary', followerCount: 0 }
  ]);
});

test('role facts expose one stable real-Page membership identity', () => {
  assert.equal(pageBindingProjection.bindingFact(bindings, 'page_a').role, 'leader');
  assert.equal(pageBindingProjection.bindingFact(bindings, 'page_b').role, 'follower');
  assert.equal(pageBindingProjection.bindingFact(bindings, 'page_missing').role, 'unbound');
});
