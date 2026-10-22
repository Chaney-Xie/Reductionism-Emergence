const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const stylesPath = path.resolve(__dirname, '../public/styles.css');

const legacyDeclarations = Object.freeze([
  ['flex', '0 0 auto'],
  ['color', 'var(--sidebar-control-muted)'],
  ['font-family', 'var(--font-system-family)'],
  ['font-size', 'calc(var(--font-file-size) - 2px)'],
  ['font-weight', '650'],
  ['line-height', '1'],
  ['white-space', 'nowrap'],
  ['pointer-events', 'none'],
  ['user-select', 'none']
]);

const expectedDeclarations = Object.freeze(legacyDeclarations.map(([property, value]) => {
  if (property === 'color') return [property, '#ADADAD'];
  if (property === 'font-size') {
    return [property, 'calc(var(--font-file-size) - 4px)'];
  }
  return [property, value];
}));

function extractDeclarations(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...styles.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  assert.equal(matches.length, 1, `Expected exactly one ${selector} rule.`);
  const declarations = matches[0][1]
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const declaration = /^([a-z-]+)\s*:\s*(.+)$/.exec(entry);
      assert.ok(declaration, `Could not parse ${selector} declaration: ${entry}`);
      return [declaration[1], declaration[2].trim()];
    });
  assert.equal(new Set(declarations.map(([property]) => property)).size, declarations.length,
    `${selector} must not repeat declarations.`);
  return declarations;
}

function declarationDiff(left, right) {
  const leftMap = new Map(left);
  const rightMap = new Map(right);
  return [...new Set([...leftMap.keys(), ...rightMap.keys()])].flatMap((property) => {
    const before = leftMap.get(property);
    const after = rightMap.get(property);
    return before === after ? [] : [{ property, before: before ?? null, after: after ?? null }];
  });
}

test('Page Type badge typography changes exactly color and one additional 2px step', async () => {
  const styles = await fs.readFile(stylesPath, 'utf8');
  const declarations = extractDeclarations(styles, '.nav-page-type-badge');

  assert.deepEqual(declarations, expectedDeclarations);
  assert.deepEqual(declarationDiff(legacyDeclarations, declarations), [
    {
      property: 'color',
      before: 'var(--sidebar-control-muted)',
      after: '#ADADAD'
    },
    {
      property: 'font-size',
      before: 'calc(var(--font-file-size) - 2px)',
      after: 'calc(var(--font-file-size) - 4px)'
    }
  ]);
});

test('Page filename flex, ellipsis, alignment, and row-height owners remain unchanged', async () => {
  const styles = await fs.readFile(stylesPath, 'utf8');

  const pageRow = extractDeclarations(styles, '.page-link');
  assert.deepEqual(pageRow, [
    ['display', 'flex'],
    ['align-items', 'center'],
    ['gap', '0.4rem'],
    ['width', '100%'],
    ['margin-bottom', '0'],
    ['padding', 'var(--font-file-row-padding-block) 0.7rem'],
    ['border', '0'],
    ['border-radius', '5px'],
    ['color', 'inherit'],
    ['background', 'transparent'],
    ['text-align', 'left'],
    ['cursor', 'pointer'],
    ['font-weight', '400'],
    ['line-height', 'var(--font-file-row-line-height)']
  ]);

  const label = extractDeclarations(styles, '.nav-page-label-text');
  assert.deepEqual(label, [['flex', '1 1 auto']]);

  assert.match(styles, /\.nav-page-label-text,\n\.nav-folder-label-text \{\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n\}/);
});
