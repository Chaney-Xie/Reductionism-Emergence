const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Vault Appearance exposes every Markdown colour role through the shared picker', async () => {
  const [html, controller] = await Promise.all([
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8')
  ]);
  const rolePaths = [
    'markdownColours.headings.unified',
    ...[1, 2, 3, 4, 5, 6].map((level) => `markdownColours.headings.h${level}`),
    'markdownColours.text.bold',
    'markdownColours.text.italic',
    'markdownColours.text.boldItalic',
    'markdownColours.text.strikethroughText',
    'markdownColours.text.strikethroughLine',
    'markdownColours.text.underlineText',
    'markdownColours.text.underlineLine',
    'markdownColours.text.hyperlink',
    'markdownColours.code.background',
    'markdownColours.code.border',
    'markdownColours.symbols.group1',
    'markdownColours.symbols.group2'
  ];
  assert.match(html, />Markdown Colour</);
  assert.match(html, /id="markdown-heading-colour-mode"/);
  assert.match(html, /<option value="unified">Unified<\/option>/);
  assert.match(html, /<option value="by-level">By level<\/option>/);
  rolePaths.forEach((rolePath) => {
    assert.match(html, new RegExp(`data-colour-select="${rolePath.replaceAll('.', '\\.')}"`));
    assert.match(html, new RegExp(`data-colour-swatch="${rolePath.replaceAll('.', '\\.')}"`));
    assert.match(controller, new RegExp(`'${rolePath.replaceAll('.', '\\.')}':`));
  });
  assert.equal((html.match(/data-colour-select="markdownColours\./g) || []).length, rolePaths.length);
  assert.match(controller, /useDefault\.textContent = 'Use Default'/);
  assert.match(controller, /setAppearanceColourValue\(next, state\.colourKey, null\)/);
  assert.match(controller, /vaultAppearanceStore\.update/);
  assert.doesNotMatch(controller, /appearanceMarkdownSaveQueue|queueMarkdownAppearanceSave/);
  assert.match(controller, /applyAppearanceSettings\(document\.documentElement/);
  assert.match(controller, /markdownHeadingUnifiedRows\.style\.display = mode === 'unified' \? '' : 'none'/);
  assert.match(controller, /markdownHeadingLevelRows\.style\.display = mode === 'by-level' \? '' : 'none'/);
  assert.doesNotMatch(controller, /renderMarkdownPage|refreshEditableProjection|markdownBody\s*=/);
});

test('Markdown semantic roles bind only colour properties to Vault CSS variables', async () => {
  const css = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8');
  for (const variable of [
    '--md-heading-color',
    '--md-heading-h1-color',
    '--md-heading-h6-color',
    '--md-bold-color',
    '--md-italic-color',
    '--md-bold-italic-color',
    '--md-strike-text-color',
    '--md-strike-line-color',
    '--md-underline-text-color',
    '--md-underline-line-color',
    '--md-link-color',
    '--md-code-background',
    '--md-code-border',
    '--md-symbol-group-1',
    '--md-symbol-group-2'
  ]) assert.match(css, new RegExp(variable));

  assert.match(css, /\.markdown-editable-projected-leaf\.is-strong-content\s*\{[^}]*color:\s*var\(--md-bold-color, inherit\)/s);
  assert.match(css, /\.is-strong-content\.is-emphasis-content\s*\{[^}]*--md-bold-italic-color/s);
  assert.match(css, /\.is-strikethrough-content\s*\{[^}]*--md-strike-text-color[^}]*text-decoration-color:\s*var\(--md-strike-line-color/s);
  assert.match(css, /\.is-underline-content\s*\{[^}]*--md-underline-text-color[^}]*text-decoration-color:\s*var\(--md-underline-line-color/s);
  assert.match(css, /\.markdown-page-link\s*\{[^}]*color:\s*var\(--md-link-color, inherit\)/s);
  assert.match(css, /\.markdown-page-code-block\s*\{[^}]*border:\s*1px solid var\(--md-code-border, var\(--border-guide\)\)[^}]*background:\s*var\(--md-code-background, var\(--surface-guide\)\)/s);
  assert.match(css, /\.is-math-delimiter-marker,[\s\S]*\.is-underline-symbol-marker\s*\{[^}]*--md-symbol-group-1/s);
  assert.match(css, /\.is-heading-marker,[\s\S]*\.is-table-symbol-marker,[\s\S]*\.is-thematic-break-marker\s*\{[^}]*--md-symbol-group-2/s);
  assert.match(css, /\.markdown-source-marker\.is-symbol-group-1\s*\{[^}]*--md-symbol-group-1/s);
});

test('Markdown colour presentation annotations preserve source-ranged role ownership', async () => {
  const [adapters, view] = await Promise.all([
    fs.readFile(path.join(root, 'public/js/markdownEditableSyntaxAdapters.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/markdownPageView.js'), 'utf8')
  ]);
  assert.match(adapters, /'math-delimiter',[\s\S]*'marker'/);
  assert.match(adapters, /'underline-symbol',[\s\S]*'marker'/);
  assert.match(adapters, /function orderedListMarkerMetadata/);
  assert.match(adapters, /'ordered-list',[\s\S]*'marker'/);
  assert.match(adapters, /'table-symbol',[\s\S]*'marker'/);
  assert.match(view, /markdown-math-delimiter-marker/);
  assert.match(view, /markdown-underline-symbol-marker/);
});
