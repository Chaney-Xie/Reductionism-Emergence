const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const categoryBatch = require('../public/categoryBatch');

test('batch Category instructions cycle neutral, add, remove, neutral', () => {
  assert.equal(categoryBatch.nextInstructionState('neutral'), 'add');
  assert.equal(categoryBatch.nextInstructionState('add'), 'remove');
  assert.equal(categoryBatch.nextInstructionState('remove'), 'neutral');
  assert.deepEqual(categoryBatch.instructionPayload(new Map([
    ['foundation', 'add'],
    ['tool', 'remove'],
    ['neutral', 'neutral']
  ])), {
    addCategoryIds: ['foundation'],
    removeCategoryIds: ['tool']
  });
});

test('batch Category application preserves neutral values and never duplicates additions', () => {
  assert.deepEqual(categoryBatch.applyCategoryInstructions(
    ['tool', 'neutral', 'foundation', 'foundation'],
    ['foundation', 'new'],
    ['tool']
  ), ['neutral', 'foundation', 'new']);
});

test('batch mode reuses the existing Category modal and keeps single-Page checkbox rendering', async () => {
  const root = path.join(__dirname, '..');
  const [app, modal, css] = await Promise.all([
    fs.readFile(path.join(root, 'public/app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/descriptorModal.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/styles.css'), 'utf8')
  ]);

  assert.match(modal, /title: options\.batch \? 'Batch Edit Category' : 'Page Category'/);
  assert.match(modal, /function openPageMetaModal\(runtime, type, options = \{\}\)/);
  assert.match(modal, /mode: batch \? 'batch' : 'single'/);
  assert.match(app, /options\.batch\s*\? new Set\(\)\s*:\s*new Set\(Array\.isArray\(runtime\?\.currentPage\?\.categories\)/);
  assert.match(app, /checkbox\.type = 'checkbox';[\s\S]*checkbox\.checked = selectedIds\.has\(node\.id\)/);
  assert.match(css, /data-category-instruction='add'[\s\S]*background: var\(--surface-tool\);[\s\S]*color: var\(--theme-colour\)/);
  assert.match(css, /data-category-instruction='remove'[\s\S]*background: var\(--surface-tool\);[\s\S]*color: var\(--accent-colour\)/);
});
