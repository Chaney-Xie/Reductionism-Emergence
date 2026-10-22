const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '..', 'public/styles.css'), 'utf8');

function ruleBody(selectorPattern) {
  const match = styles.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(match, `missing CSS rule for ${selectorPattern}`);
  return match[1];
}

test('editable H1 through H6 use the approved Viewer typography in Source and Live', () => {
  const expected = ['1.8em', '1.55em', '1.32em', '1.16em', '1.04em', '0.96em'];
  expected.forEach((fontSize, index) => {
    const depth = index + 1;
    const selector = String.raw`\.markdown-page-layer\.is-source\s+\.markdown-editable-physical-row\.is-editable-heading-depth-${depth},[\s\S]*?\.markdown-page-layer\.is-live-preview\s+\.markdown-editable-physical-row\.is-editable-heading-depth-${depth}`;
    assert.match(ruleBody(selector), new RegExp(`font-size:\\s*${fontSize.replace('.', '\\.')};`));
  });
  const headingRule = ruleBody(String.raw`\.markdown-page-layer\.is-source \.markdown-editable-physical-row\.is-editable-heading-row,[\s\S]*?\.markdown-page-layer\.is-live-preview \.markdown-editable-physical-row\.is-editable-heading-row`);
  assert.match(headingRule, /font-family:\s*var\(--font-page-title-family\);/);
  assert.match(headingRule, /font-weight:\s*700;/);
  assert.match(
    headingRule,
    /line-height:\s*var\(--markdown-page-heading-line-height\)\s*!important;/
  );
});

test('editable rows inherit Page typography and semantic roles split content from markers', () => {
  const body = ruleBody(String.raw`\.markdown-page-body\[data-markdown-editable-projection="true"\]`);
  assert.match(body, /font-family:\s*inherit;/);
  assert.match(body, /font-size:\s*inherit;/);

  const row = ruleBody(String.raw`\.markdown-editable-physical-row`);
  assert.doesNotMatch(row, /font-family:|font-size:|system-ui/);
  const leaf = ruleBody(String.raw`\.markdown-editable-projected-leaf`);
  assert.doesNotMatch(leaf, /font(?:-family|-size)?:|line-height:/);

  assert.match(ruleBody(String.raw`\.markdown-editable-projected-leaf\.is-strong-content`), /font-weight:\s*700;/);
  assert.match(ruleBody(String.raw`\.markdown-editable-projected-leaf\.is-emphasis-content`), /font-style:\s*italic;/);
  assert.match(ruleBody(String.raw`\.markdown-editable-projected-leaf\.is-strikethrough-content`), /text-decoration:\s*line-through;/);
  assert.match(
    ruleBody(String.raw`\.markdown-editable-projected-leaf\.is-heading-marker,[\s\S]*?\.markdown-editable-projected-leaf\.is-thematic-break-marker`),
    /color:\s*var\(--md-symbol-group-2, var\(--sidebar-control-muted\)\);/
  );
  assert.match(
    styles,
    /\.is-emphasis-marker,[\s\S]*?\.is-inline-code-marker[\s\S]*?:not\(\.is-markdown-semantic-active\)\s*\{\s*display:\s*none;/
  );
});

test('quote rails, code, math, and collapsed physical rows use presentation-only styling', () => {
  const documentRule = ruleBody(String.raw`\.markdown-page-document`);
  assert.match(documentRule, /--markdown-quote-rail-color:\s*var\(--border-canvas\);/);
  assert.match(documentRule, /--markdown-quote-rail-width:\s*3px;/);
  assert.match(documentRule, /--markdown-quote-rail-content-gap:\s*1rem;/);
  assert.match(documentRule,
    /--markdown-quote-rail-step:\s*calc\([\s\S]*?--markdown-quote-rail-width[\s\S]*?--markdown-quote-rail-content-gap/);
  const quote = ruleBody(String.raw`\.markdown-page-layer\.is-source \.markdown-editable-physical-row\.is-editable-quote-row,[\s\S]*?\.markdown-page-layer\.is-live-preview \.markdown-editable-physical-row\.is-editable-quote-row`);
  assert.match(quote, /--markdown-editable-quote-rail-depth/);
  assert.match(quote, /--markdown-quote-rail-step/);
  assert.doesNotMatch(styles, /\.is-editable-quote-row::before/,
    'physical editable rows cannot paint independent quote rails');
  assert.doesNotMatch(styles, /repeating-linear-gradient\([^)]*quote/,
    'quote rails cannot be repeated row-local paint');
  const quoteLayer = ruleBody(String.raw`\.markdown-editable-quote-rail-layer`);
  assert.match(quoteLayer, /position:\s*absolute;/);
  assert.match(quoteLayer, /inset:\s*0;/);
  assert.match(quoteLayer, /overflow:\s*visible;/);
  assert.match(quoteLayer, /pointer-events:\s*none;/);
  assert.match(quoteLayer, /user-select:\s*none;/);
  const quoteRail = ruleBody(String.raw`\.markdown-editable-quote-rail`);
  assert.match(quoteRail, /position:\s*absolute;/);
  assert.match(quoteRail, /width:\s*var\(--markdown-quote-rail-width\);/);
  assert.match(quoteRail, /height:\s*var\(--markdown-editable-quote-rail-height\);/);
  assert.match(quoteRail, /background:\s*var\(--markdown-quote-rail-color\);/);
  assert.match(quoteRail, /pointer-events:\s*none;/);
  assert.doesNotMatch(quoteRail, /border-radius/,
    'continuous rails have no physical-row cap treatment');
  const readingQuote = ruleBody(String.raw`\.markdown-page-quote`);
  assert.match(readingQuote,
    /padding:\s*0\.15rem 0 0\.15rem var\(--markdown-quote-rail-content-gap\);/);
  assert.match(readingQuote,
    /border-left:\s*var\(--markdown-quote-rail-width\) solid var\(--markdown-quote-rail-color\);/);

  const collapsed = ruleBody(String.raw`\.markdown-editable-physical-row\.is-editable-presentation-collapsed`);
  assert.match(collapsed, /height:\s*0\s*!important;/);
  assert.match(collapsed, /min-height:\s*0\s*!important;/);
  assert.match(collapsed, /line-height:\s*0\s*!important;/);
  assert.match(collapsed, /padding:\s*0\s*!important;/);

  const codeShell = ruleBody(String.raw`\.markdown-editable-code-block-presentation`);
  assert.match(codeShell, /background:\s*transparent;/);
  assert.match(codeShell, /font:\s*inherit;/);
  assert.match(styles, /\.markdown-page-code-block\s*\{[\s\S]*?padding:\s*0\.85rem 1rem;/);
  const codeRow = ruleBody(String.raw`\.markdown-page-layer\.is-source \.markdown-editable-physical-row\.is-editable-code-row,[\s\S]*?\.markdown-page-layer\.is-live-preview \.markdown-editable-physical-row\.is-editable-code-row`);
  assert.match(
    codeRow,
    /line-height:\s*var\(--markdown-page-code-line-height\)\s*!important;/
  );

  const displayMath = ruleBody(String.raw`\.markdown-editable-math-presentation\.is-display`);
  assert.match(displayMath, /display:\s*flex;/);
  assert.match(displayMath, /padding:\s*0\.5rem 1rem;/);
  assert.match(
    styles,
    /\.markdown-page-math-display \.markdown-math-row,\s*\.markdown-editable-math-presentation\.is-display \.markdown-math-row\s*\{\s*font-size:\s*1\.08em;/s
  );
});

test('the CSS migration does not introduce native editable list markers', () => {
  const editableSection = styles.slice(
    styles.indexOf('/* Editable-layer v0.3'),
    styles.indexOf('.markdown-page-body > :first-child')
  );
  assert.doesNotMatch(editableSection, /list-style-(?:type|position):\s*(?!none)/);
  assert.doesNotMatch(editableSection, /counter-(?:increment|reset)/);
});

test('inactive Live syntax hiding stays primary-visibility based, not symbol-family based', () => {
  assert.match(styles,
    /\.markdown-page-layer\.is-live-preview[\s\S]*?\[data-visibility="activatable"\][\s\S]*?display:\s*none;/);
  assert.doesNotMatch(styles,
    /is-live-preview[^{}]*\.is-source-symbol-marker[^{}]*\{[^}]*display:\s*none;/s,
    'shared source symbols cannot be globally hidden to repair underline tags');
  assert.match(styles,
    /is-live-preview[\s\S]*?\.is-underline-tag-marker-source-hidden\s*\{\s*display:\s*none;/,
    'nested underline tags use one pair-specific non-owning presentation role');
});
