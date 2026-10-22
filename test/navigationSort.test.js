const test = require('node:test');
const assert = require('node:assert/strict');
const navigationSort = require('../public/navigationSort');

const labels = [
  'File name (A to Z)',
  'File name (Z to A)',
  'Modified time (new to old)',
  'Modified time (old to new)',
  'Created time (new to old)',
  'Created time (old to new)'
];

function ids(items) {
  return items.map((item) => item.id);
}

test('navigation sort exposes the six grouped options in the accepted order', () => {
  assert.deepEqual(navigationSort.SORT_OPTIONS.map((option) => option.label), labels);
  assert.deepEqual(navigationSort.SORT_OPTIONS.map((option) => option.group), [
    'name', 'name', 'modified', 'modified', 'created', 'created'
  ]);
  assert.equal(navigationSort.normalizeSortMode(undefined), 'name_asc');
  assert.equal(navigationSort.normalizeSortMode('not-a-mode'), 'name_asc');
});

test('name sorting is natural, case-insensitive, deterministic, and keeps fixed folders in place', () => {
  const pages = [
    { id: 'page_10', title: 'Page 10' },
    { id: 'page_2', title: 'page 2' },
    { id: 'page_b', title: 'Alpha' },
    { id: 'page_a', title: 'alpha' },
    { id: 'page_cn', title: '中文 3' }
  ];
  assert.deepEqual(ids(navigationSort.sortPages(pages, 'name_asc')), [
    'page_a', 'page_b', 'page_2', 'page_10', 'page_cn'
  ]);
  assert.deepEqual(ids(navigationSort.sortPages(pages, 'name_desc')), [
    'page_cn', 'page_10', 'page_2', 'page_a', 'page_b'
  ]);

  const folders = [
    { id: 'folder_system', label: 'Uncategorised', type: 'system', pinned: true },
    { id: 'folder_10', label: 'Folder 10', type: 'manual' },
    { id: 'folder_2', label: 'folder 2', type: 'manual' },
    { id: 'folder_a', label: 'Same', type: 'manual' },
    { id: 'folder_b', label: 'same', type: 'manual' }
  ];
  assert.deepEqual(ids(navigationSort.sortFolders(folders, 'name_asc')), [
    'folder_system', 'folder_2', 'folder_10', 'folder_a', 'folder_b'
  ]);
  assert.deepEqual(ids(navigationSort.sortFolders(folders, 'name_desc')), [
    'folder_system', 'folder_a', 'folder_b', 'folder_10', 'folder_2'
  ]);
  assert.deepEqual(ids(folders), [
    'folder_system', 'folder_10', 'folder_2', 'folder_a', 'folder_b'
  ]);
});

test('dynamic folders keep Uncategory first and preserve configured Category order in every mode', () => {
  const folders = [
    {
      id: 'folder_class_3', label: 'Class 3', type: 'system',
      source: { kind: 'categoryAny' }, projectedPageIds: []
    },
    { id: 'folder_manual', label: 'Manual', type: 'manual', source: { kind: 'manual' } },
    {
      id: 'folder_uncategorised', label: 'Uncategorised', type: 'system',
      source: { kind: 'missingCategories' }, projectedPageIds: []
    },
    {
      id: 'folder_class_1', label: 'Class 1', type: 'system',
      source: { kind: 'categoryAny' }, projectedPageIds: []
    },
    {
      id: 'folder_class_2', label: 'Class 2', type: 'system',
      source: { kind: 'categoryAny' }, projectedPageIds: []
    }
  ];
  for (const mode of ['name_asc', 'name_desc', 'modified_desc']) {
    assert.deepEqual(ids(navigationSort.sortFolders(folders, mode)), [
      'folder_uncategorised', 'folder_class_3', 'folder_class_1', 'folder_class_2', 'folder_manual'
    ]);
  }
});

test('page time modes use canonical timestamps, keep missing values last, and resolve ties by name and ID', () => {
  const pages = [
    {
      id: 'page_beta', title: 'Beta',
      createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z'
    },
    {
      id: 'page_alpha_b', title: 'Alpha',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z'
    },
    {
      id: 'page_alpha_a', title: 'alpha',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z'
    },
    { id: 'page_missing_b', title: 'Missing 10' },
    { id: 'page_missing_a', title: 'Missing 2', createdAt: 'invalid', updatedAt: null }
  ];
  assert.deepEqual(ids(navigationSort.sortPages(pages, 'modified_desc')), [
    'page_beta', 'page_alpha_a', 'page_alpha_b', 'page_missing_a', 'page_missing_b'
  ]);
  assert.deepEqual(ids(navigationSort.sortPages(pages, 'modified_asc')), [
    'page_alpha_a', 'page_alpha_b', 'page_beta', 'page_missing_a', 'page_missing_b'
  ]);
  assert.deepEqual(ids(navigationSort.sortPages(pages, 'created_desc')), [
    'page_beta', 'page_alpha_a', 'page_alpha_b', 'page_missing_a', 'page_missing_b'
  ]);
  assert.deepEqual(ids(navigationSort.sortPages(pages, 'created_asc')), [
    'page_alpha_a', 'page_alpha_b', 'page_beta', 'page_missing_a', 'page_missing_b'
  ]);

  const folders = [
    { id: 'folder_b', label: 'Zulu', type: 'manual' },
    { id: 'folder_a', label: 'Alpha', type: 'manual' }
  ];
  assert.deepEqual(ids(navigationSort.sortFolders(folders, 'modified_desc')), [
    'folder_a', 'folder_b'
  ]);
  assert.deepEqual(ids(navigationSort.sortFolders(folders, 'created_asc')), [
    'folder_a', 'folder_b'
  ]);
});

test('display sorting does not mutate page objects or persisted sibling arrays', () => {
  const pages = [
    { id: 'page_b', title: 'B', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'page_a', title: 'A', updatedAt: '2026-02-01T00:00:00.000Z' }
  ];
  const before = JSON.stringify(pages);
  const sorted = navigationSort.sortPages(pages, 'modified_desc');
  assert.deepEqual(ids(sorted), ['page_a', 'page_b']);
  assert.equal(JSON.stringify(pages), before);
  assert.notEqual(sorted, pages);
});
