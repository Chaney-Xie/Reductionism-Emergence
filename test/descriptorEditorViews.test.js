const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function source(name) {
  return fs.readFile(path.join(__dirname, '..', name), 'utf8');
}

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('Active descriptor view keeps one heading and three class fields without repeated labels', async () => {
  const ui = await source('public/js/descriptorModal.js');
  assert.match(ui, /descriptorEditorMode === 'ignored'[\s\S]*?'Ignored descriptors'[\s\S]*?: 'This page descriptors'/);
  assert.doesNotMatch(ui, /Active descriptors/);
  assert.match(ui, /for \(const descriptorClass of descriptorClasses\(\)\)[\s\S]*renderDescriptorClassEditor\(descriptorClass\)/);
  assert.match(ui, /function renderDescriptorClassEditor\(descriptorClass\)[\s\S]*section\.append\(heading, field, helper\)/);
});

test('Ignored descriptor view mirrors class fields and only replaces remove with restore', async () => {
  const [ui, css] = await Promise.all([
    source('public/js/descriptorModal.js'),
    source('public/styles.css')
  ]);
  assert.match(ui, /function renderIgnoredDescriptorClassEditor\(descriptorClass\)[\s\S]*descriptor-token-field descriptor-ignored-token-field[\s\S]*section\.append\(heading, field\)/);
  assert.match(ui, /for \(const descriptorClass of descriptorClasses\(\)\)[\s\S]*renderIgnoredDescriptorClassEditor\(descriptorClass\)/);
  assert.doesNotMatch(ui, /if \(!refs\.length\) continue/);
  assert.match(ui, /restoreButton\.textContent = '\+'/);
  assert.match(ui, /chip\.classList\.toggle\('auto', !ignoredDescriptorHadManualState/);
  assert.match(rule(css, '.descriptor-chip'), /background: var\(--accent-soft\)/);
  assert.match(rule(css, '.descriptor-chip.auto'), /background: var\(--theme-soft\)/);
  assert.equal(rule(css, '.descriptor-chip.ignored'), '');
  assert.doesNotMatch(ui, /Descriptors blocked from automatic addition|No ignored descriptors/);
  assert.doesNotMatch(css, /descriptor-ignored-helper|descriptor-ignored-empty/);
});

test('footer toggle switches only between Ignored and Active', async () => {
  const ui = await source('public/js/descriptorModal.js');
  assert.match(ui, /button\.textContent = ignoredMode \? 'Active' : 'Ignored'/);
  assert.match(ui, /ignoredButton\.textContent = 'Ignored'/);
  assert.match(ui, /descriptorEditorMode = descriptorEditorMode === 'ignored' \? 'active' : 'ignored'/);
  assert.doesNotMatch(ui, /`Ignored \(\$\{ignoredCount\}\)`/);
});
