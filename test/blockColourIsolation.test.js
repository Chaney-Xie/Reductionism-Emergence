const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function styles() {
  return fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8');
}

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('normal Block states use dedicated canvas colours rather than application Accent', async () => {
  const css = await styles();
  const defaultState = rule(css, '.canvas-block-overlay[data-state="1"]');
  const highlightedState = rule(css, '.canvas-block-overlay[data-state="2"]');
  const activeState = rule(css, '.canvas-block-overlay[data-state="3"]');

  assert.match(defaultState, /background: transparent/);
  assert.match(highlightedState, /var\(--block-highlighted-background\)/);
  assert.match(highlightedState, /var\(--block-highlighted-border\)/);
  assert.match(activeState, /var\(--block-active-background\)/);
  assert.match(activeState, /var\(--block-active-border\)/);
  assert.doesNotMatch(`${defaultState}\n${highlightedState}\n${activeState}`, /var\(--accent-/);
});

test('Block edit mode uses Accent only for visible overlay background and edit foreground', async () => {
  const css = await styles();
  const editCanvas = rule(css, '.canvas-area.block-edit-mode');
  const editLabel = css.match(/\.canvas-area\.block-edit-mode::after,\s*\.canvas-area\.highlight-edit-mode::after\s*\{[^}]*\}/)?.[0] || '';
  const editHighlighted = css.match(/\.canvas-area\.block-edit-mode \.canvas-block-overlay\[data-state="2"\],[\s\S]*?\.canvas-area\.block-edit-mode \.canvas-block-overlay\[data-state="3"\]\s*\{[^}]*\}/)?.[0] || '';

  assert.match(editCanvas, /box-shadow: none/);
  assert.match(editLabel, /color: var\(--accent-colour\)/);
  assert.match(editLabel, /background: var\(--accent-soft\)/);
  assert.match(editHighlighted, /background: var\(--accent-soft\)/);
  assert.doesNotMatch(editHighlighted, /border(?:-color)?:\s*var\(--accent-/);
});

test('generic selected and active UI selectors do not target canvas Blocks', async () => {
  const css = await styles();
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim());
  const genericStateSelectors = selectors.filter((selector) => (
    /(?:^|[\s,.])(?:selected|active|is-selected)(?:$|[\s,.:#\[])/.test(selector)
    || /\[aria-selected=(?:"true"|'true'|true)\]/.test(selector)
  ));

  assert.ok(genericStateSelectors.length > 0);
  assert.equal(genericStateSelectors.some((selector) => /canvas-block-overlay/.test(selector)), false);
});
