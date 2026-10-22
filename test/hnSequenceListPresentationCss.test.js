'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf8');

function ruleFor(selector) {
  const start = styles.indexOf(selector);
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`);
  const open = styles.indexOf('{', start);
  const close = styles.indexOf('}', open);
  assert.ok(open > start && close > open, `incomplete CSS rule: ${selector}`);
  return styles.slice(start, close + 1);
}

test('HN sequence rows own a scoped shared marker/text grid without changing Markdown lists', () => {
  const selector = [
    '.hn-source-editor',
    '  .markdown-editable-physical-row.has-editable-list-row-presentation.is-hn-sequence-list-row:not(.is-editable-task-list-row) {'
  ].join('\n');
  const rule = ruleFor(selector);

  assert.match(rule, /--hn-sequence-list-marker-width:\s*3em/);
  assert.match(rule,
    /--hn-sequence-list-leading-width:\s*var\(--hn-sequence-list-marker-width\)/);
  assert.match(rule, /grid-template-columns:\s*var\(--hn-sequence-list-leading-width\)/);
  assert.doesNotMatch(rule, /--hn-sequence-list-marker-columns[^;]*\*/,
    'the HN track must not rely on unsupported typed CSS multiplication');
  assert.match(rule, /minmax\(0, 1fr\)/);
  assert.doesNotMatch(rule, /position\s*:\s*(?:absolute|fixed)/);
  assert.doesNotMatch(rule, /text-overflow|overflow\s*:\s*hidden/);

  const sharedRule = ruleFor(
    '.markdown-page-layer.is-live-preview\n'
      + '  .markdown-editable-physical-row.has-editable-list-row-presentation:not(.is-editable-task-list-row),'
  );
  assert.match(sharedRule, /--markdown-editable-list-marker-width:\s*1\.25em/,
    'the existing Markdown/unordered grid remains independently owned');
});

test('HN marker source uses tabular digits only inside the sequence marker cell', () => {
  const selector = [
    '.hn-source-editor',
    '  .markdown-editable-physical-row.is-hn-sequence-list-row',
    '  .markdown-editable-list-marker-slot {'
  ].join('\n');
  const rule = ruleFor(selector);

  assert.match(rule, /font-variant-numeric:\s*tabular-nums/);
  assert.equal(rule.includes('.markdown-page-layer'), false);
});
