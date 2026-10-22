const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function declarations(css, selector) {
  return flatRules(css)
    .filter((rule) => rule.selector.split(',').some((part) => part.trim() === selector))
    .map((rule) => rule.body)
    .join('\n');
}

function flatRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2]
  }));
}

test('Markdown body, heading, and fenced code consume mode-neutral line-height variables', async () => {
  const css = await read('public/styles.css');
  const layer = declarations(css, '.markdown-page-layer');
  const heading = declarations(css, '.markdown-page-heading');
  const code = declarations(css, '.markdown-page-code-block');

  assert.match(layer, /--markdown-page-body-line-height:\s*1\.62;/);
  assert.match(layer, /--markdown-page-heading-line-height:\s*1\.23;/);
  assert.match(layer, /--markdown-page-code-line-height:\s*1\.5;/);
  assert.match(layer, /font-family:\s*var\(--font-page-family\);/);
  assert.match(layer, /font-size:\s*var\(--font-page-body-size\);/);
  assert.match(layer, /line-height:\s*var\(--markdown-page-body-line-height\);/);
  assert.match(heading, /font-family:\s*var\(--font-page-title-family\);/);
  assert.match(heading, /line-height:\s*var\(--markdown-page-heading-line-height\);/);
  assert.match(code, /font-family:\s*ui-monospace/);
  assert.match(code, /line-height:\s*var\(--markdown-page-code-line-height\);/);

  const physicalRow = declarations(css, '.markdown-editable-physical-row');
  assert.match(physicalRow, /line-height:\s*var\(--markdown-page-body-line-height\);/);
  assert.doesNotMatch(physicalRow, /font-family:|font-size:/);
});

test('Reading markers inherit semantics while editable projected leaves own Source/Live typography', async () => {
  const css = await read('public/styles.css');
  const marker = declarations(css, '.markdown-source-marker');

  assert.match(marker, /font-family:\s*inherit;/);
  assert.match(marker, /line-height:\s*inherit;/);
  assert.doesNotMatch(marker, /font-size:/);

  assert.doesNotMatch(
    css,
    /\.markdown-page-layer\.is-(?:source|live-preview)[^{]*\.markdown-source-marker/
  );
  const projectedLeaf = declarations(css, '.markdown-editable-projected-leaf');
  const physicalRow = declarations(css, '.markdown-editable-physical-row');
  assert.match(projectedLeaf, /white-space:\s*pre-wrap;/);
  assert.doesNotMatch(projectedLeaf, /font(?:-family|-size)?:|line-height:/);
  assert.match(physicalRow, /line-height:\s*var\(--markdown-page-body-line-height\);/);
});

test('mode presentation rules do not override paragraph, heading, or code line-box typography', async () => {
  const css = await read('public/styles.css');
  const relevantModeRules = flatRules(css).filter(({ selector }) => (
    /\.markdown-page-layer\.(?:is-reading|is-live-preview|is-source)/.test(selector)
      || /\.markdown-page-layer:is\(\.is-live-preview, \.is-source\)/.test(selector)
  ) && /\.markdown-page-(?:paragraph|heading|code-block)/.test(selector));

  assert.ok(relevantModeRules.length > 0, 'expected mode-specific presentation rules');
  relevantModeRules.forEach(({ selector, body }) => {
    assert.doesNotMatch(
      body,
      /(?:^|;)\s*(?:font-family|font-size|line-height)\s*:/,
      `${selector} must inherit the shared construct typography`
    );
  });

  // Block margins are a separate semantic-spacing concern and intentionally
  // are not required to match by this line-box typography contract.
  assert.ok(
    relevantModeRules.some(({ body }) => /margin(?:-block|-bottom)?\s*:/.test(body)),
    'the contract must tolerate independent mode-specific block spacing'
  );
});
