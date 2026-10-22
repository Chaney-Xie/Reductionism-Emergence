const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');
const markdown = require('../public/markdownPage');

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'styles.css'),
  'utf8'
);

const fixture = [
  'Escaped symbols: \\*not italic\\*,  \\# not a heading.',
  '',
  '## Quote',
  '',
  '> ATP transfers chemical energy.',
  '>',
  '>> This is a nested quotation.',
  '',
  '## Ordered list',
  '',
  '1. Glycolysis',
  '2. Link reaction',
  '3. TCA cycle',
  '\t1. Citrate',
  '\t2. Isocitrate',
  '',
  '## Unordered List',
  '',
  '- Glucose',
  '- Pyruvate',
  '\t- Lactate',
  '\t- Acetyl-CoA',
  '',
  '## Task list',
  '',
  '- [x] Glycolysis',
  '- [ ] TCA cycle'
].join('\n');

function render(source, mode = 'source') {
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents',
    'semanticSourceFromNode',
    'activeMarkdownSourceLineStarts',
    'structuralSourceMarkerIsOnActiveLine'
  ]);
  const rendered = renderSemanticSegments(view, source, { mode });
  const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
  return { view, rendered, nodes };
}

function elements(nodes, className) {
  return nodes.filter((node) => (
    node?.nodeType === 1 && node.classList.contains(className)
  ));
}

function canonicalSource(view, rendered) {
  return rendered.blocks
    .map((block) => view.semanticSourceFromNode(block.element))
    .join('');
}

test('the complete quote/list/escape fixture round-trips exactly in every mode', () => {
  for (const mode of ['reading', 'live-preview', 'source']) {
    const { view, rendered } = render(fixture, mode);
    assert.equal(canonicalSource(view, rendered), fixture, mode);
  }
});

test('quote prefixes and semantic bodies share source-neutral row ownership', () => {
  const source = '> outer\n>\n>> nested';
  const { view, rendered, nodes } = render(source);
  const quotes = elements(nodes, 'markdown-page-quote');
  assert.equal(quotes.length, 2);

  for (const quote of quotes) {
    const body = quote.children[0];
    assert.equal(body?.classList.contains('markdown-page-quote-body'), true);
    assert.equal(quote.children.length, 1);
  }

  const sourceLines = elements(nodes, 'markdown-page-quote-source-line');
  const prefixes = elements(nodes, 'markdown-page-quote-source-prefix');
  assert.deepEqual(prefixes.map((prefix) => prefix.textContent), ['> ', '>> ']);
  assert.deepEqual(prefixes.map((prefix) => [
    Number(prefix.dataset.markdownSourceStart),
    Number(prefix.dataset.markdownSourceEnd)
  ]), [[0, 2], [10, 13]]);
  prefixes.forEach((prefix) => {
    assert.equal(
      prefix.parentElement?.classList.contains('markdown-page-quote-source-line'),
      true,
      'the complete canonical prefix is owned by one physical source-line row'
    );
  });
  assert.deepEqual(
    sourceLines.filter((line) => line.dataset.markdownQuoteDepth)
      .map((line) => Number(line.dataset.markdownQuoteDepth)),
    [1, 2, 1],
    'semantic continuation rows remain nested without owning duplicate source markers'
  );

  assert.equal(elements(nodes, 'markdown-page-quote-blank-line').length, 1);
  assert.equal(elements(nodes, 'markdown-page-prefixed-block-row').length, 1);
  assert.ok(quotes[0].contains(quotes[1]), 'the nested quote remains inside its semantic owner');
  assert.equal(canonicalSource(view, rendered), source);
});

test('Reading and inactive Live Preview preserve quoted soft physical rows only', () => {
  const fixtures = [
    { source: '> A\n> B', quoteCount: 1, transitionCount: 0 },
    { source: '>> A\n>> B', quoteCount: 2, transitionCount: 0 },
    { source: '>> A\n> B\nC', quoteCount: 2, transitionCount: 1 }
  ];

  for (const mode of ['reading', 'live-preview']) {
    fixtures.forEach(({ source, quoteCount, transitionCount }) => {
      const { view, rendered, nodes } = render(source, mode);
      const quotes = elements(nodes, 'markdown-page-quote');
      const softBreaks = elements(nodes, 'markdown-source-line-break');
      assert.equal(quotes.length, quoteCount, `${mode}: ${JSON.stringify(source)}`);
      assert.equal(
        softBreaks.every((lineBreak) => quotes[0].contains(lineBreak)),
        true,
        `${mode}: every soft physical break remains quote-scoped`
      );
      assert.equal(
        elements(nodes, 'markdown-page-quote-transition').length,
        transitionCount,
        `${mode}: quote-depth transition remains an explicit layout owner`
      );
      assert.equal(canonicalSource(view, rendered), source, `${mode}: source round-trip`);
    });
  }

  const ordinary = render('A\nB', 'reading');
  const ordinaryBreaks = elements(ordinary.nodes, 'markdown-source-line-break');
  assert.equal(ordinaryBreaks.length, 1);
  assert.equal(elements(ordinary.nodes, 'markdown-page-quote').length, 0);
  assert.equal(canonicalSource(ordinary.view, ordinary.rendered), 'A\nB');

  const quotedBlank = render('> A\n>\n> B', 'reading');
  const blankRows = elements(quotedBlank.nodes, 'markdown-page-quote-blank-line');
  assert.equal(blankRows.length, 1);
  assert.equal(blankRows[0].classList.contains('is-interstitial'), true);
  assert.equal(canonicalSource(quotedBlank.view, quotedBlank.rendered), '> A\n>\n> B');

  assert.match(
    styles,
    /\.markdown-source-line-break\s*\{[^}]*white-space:\s*normal;/,
    'strict-line-breaks-off Reading collapses ordinary paragraph soft newlines'
  );
  assert.match(
    styles,
    /\.markdown-page-layer\.is-reading\s+\.markdown-page-quote \.markdown-source-line-break\s*\{[^}]*white-space:\s*pre;/,
    'Reading preserves soft physical rows specifically inside quotes'
  );
  assert.match(
    styles,
    /\.markdown-page-layer\.is-reading[\s\S]*?\.markdown-page-quote \.markdown-page-paragraph,[\s\S]*?\.markdown-page-layer\.is-reading[\s\S]*?\.markdown-page-quote \.markdown-page-quote\s*\{[^}]*margin-block:\s*0;/,
    'quoted paragraphs and depth transitions do not insert extra reading rows'
  );
  assert.match(
    styles,
    /\.markdown-page-layer:is\(\.is-reading, \.is-live-preview\) \.markdown-page-quote\s*\{[^}]*padding-block:\s*0;/,
    'inactive quote rails align to their physical source rows'
  );
  assert.match(
    styles,
    /\.markdown-page-layer\.is-reading[\s\S]*?\.markdown-page-quote-blank-line\.is-interstitial\s*\{[^}]*display:\s*block;/,
    'an explicit quoted blank source row remains visible after reading margins are removed'
  );
});

test('Reading quote rows preserve the exact O1 text at blank and depth transitions', () => {
  const capturedCases = [
    {
      scenarioId: 'quotes.quote-blank-line.reading.inactive.text-middle.inspect',
      source: '> A\n>\n> B',
      expectedVisibleText: 'A\n\nB',
      beforeRepairVisibleText: 'A\n\n\n\n\nB',
      quoteCount: 1,
      paragraphTags: ['P', 'P'],
      blankLineCount: 1
    },
    {
      scenarioId: 'quotes.quote-transition.reading.inactive.text-middle.inspect',
      source: '>> A\n> B\nC',
      expectedVisibleText: 'A\nB\nC',
      beforeRepairVisibleText: 'A\n\nB\nC',
      quoteCount: 2,
      paragraphTags: ['DIV', 'DIV'],
      blankLineCount: 0
    }
  ];

  capturedCases.forEach((captured) => {
    const { view, rendered, nodes } = render(captured.source, 'reading');
    const paragraphs = elements(nodes, 'markdown-page-paragraph');
    assert.deepEqual(
      paragraphs.map((paragraph) => paragraph.tagName),
      captured.paragraphTags,
      `${captured.scenarioId}: paragraph separators must follow the captured O1 row boundary`
    );
    assert.equal(elements(nodes, 'markdown-page-quote').length, captured.quoteCount);
    assert.equal(
      elements(nodes, 'markdown-page-quote-blank-line').length,
      captured.blankLineCount
    );
    assert.equal(canonicalSource(view, rendered), captured.source);
    assert.notEqual(captured.expectedVisibleText, captured.beforeRepairVisibleText);
  });

  assert.match(
    styles,
    /\.markdown-page-layer\.is-reading\s+\.markdown-page-quote-blank-line\s*>\s*br\s*\{[^}]*display:\s*none;/,
    'Reading hides only the blank-row caret placeholder; the block owner keeps the O1 blank row'
  );
});

test('a trailing marker-only quote keeps a source-backed physical row after rerender', () => {
  const source = '>> Quote\n>> ';
  for (const mode of ['source', 'live-preview']) {
    const { view, rendered, nodes } = render(source, mode);
    const blankLines = elements(nodes, 'markdown-page-quote-blank-line');
    assert.equal(blankLines.length, 1, mode);
    assert.equal(blankLines[0].dataset.markdownSourceStart, '9');
    assert.equal(blankLines[0].dataset.markdownSourceEnd, '12');
    assert.equal(blankLines[0].firstChild.textContent, '>> ');
    assert.equal(
      blankLines[0].childNodes.at(-1).tagName,
      'BR',
      'an unmapped browser caret placeholder must keep the empty row addressable'
    );
    assert.equal(canonicalSource(view, rendered), source, mode);
  }

  assert.match(
    styles,
    /\.markdown-page-layer\.is-live-preview \.markdown-page-quote-blank-line \{[^}]*display: block;/,
    'Live Preview keeps the physical row even while its source marker is inactive'
  );
});

test('nested list indentation remains canonical without becoming its own layout row', () => {
  const source = [
    '1. parent',
    '\t1. first',
    '\t2. second',
    '',
    '- parent',
    '\t- child',
    '\t- [ ] task',
    '\t- \\*literal\\*'
  ].join('\n');
  const { view, rendered, nodes } = render(source);
  const items = elements(nodes, 'markdown-page-list-item');
  assert.equal(items.length, 7);

  items.forEach((item) => {
    const direct = item.children;
    const prefix = direct.find((child) => child.classList.contains('markdown-page-list-prefix'));
    const body = direct.find((child) => child.classList.contains('markdown-page-list-item-body'));
    assert.ok(prefix, 'every item keeps one stable prefix column');
    assert.ok(body, 'every item keeps one stable body column');
  });

  const indentationOwners = elements(nodes, 'markdown-source-indentation');
  assert.ok(indentationOwners.length >= 5);
  assert.equal(canonicalSource(view, rendered), source);
});

test('Enter preserves the complete nested quote prefix', () => {
  for (const [source, replacement] of [
    ['> outer', '\n> '],
    ['>> nested', '\n>> '],
    ['> > nested', '\n> > ']
  ]) {
    const result = markdown.applyMarkdownNewline(source, {
      anchor: source.length,
      focus: source.length
    });
    assert.equal(result.replacement, replacement);
  }
});

test('active nested quotes reveal only structural markers from the current source line', () => {
  const source = '> outer\n>\n>> nested';
  const { view, nodes } = render(source, 'live-preview');
  const prefixes = elements(nodes, 'markdown-page-quote-source-prefix');
  const firstPrefix = prefixes.find((marker) => marker.textContent === '> ');
  const nestedPrefix = prefixes.find((marker) => marker.textContent === '>> ');
  const caret = source.indexOf('nested') + 2;
  const activeLines = view.activeMarkdownSourceLineStarts(source, {
    anchor: caret,
    focus: caret
  });

  assert.equal(view.structuralSourceMarkerIsOnActiveLine(
    firstPrefix, source, activeLines
  ), false, 'the outer quote marker belongs to an earlier line');
  assert.equal(view.structuralSourceMarkerIsOnActiveLine(
    nestedPrefix, source, activeLines
  ), true, 'the complete coherent nested quote prefix is on the active line');
  assert.equal(
    elements(nodes, 'markdown-page-quote-source-nested')
      .some((quote) => quote.children.some((child) => (
        child.classList.contains('markdown-source-marker')
      ))),
    false,
    'nested semantic wrappers do not independently paint canonical quote markers'
  );
});

test('editable quote/list rows are mode-scoped without flattening Reading layout', () => {
  assert.match(
    styles,
    /\.markdown-page-layer\.is-source \.markdown-page-quote-source-line,[\s\S]*?\.markdown-page-layer\.is-live-preview[\s\S]*?\.markdown-page-quote-source-line:has\([\s\S]*?> \.markdown-page-quote-source-prefix\.is-visible[\s\S]*?\) \{[\s\S]*?position:\s*relative;[\s\S]*?display:\s*block;/
  );
  assert.match(
    styles,
    /\.markdown-page-layer\.is-source[\s\S]*?\.markdown-page-quote-source-line > \.markdown-page-quote-source-prefix,[\s\S]*?\.markdown-page-layer\.is-live-preview[\s\S]*?> \.markdown-page-quote-source-prefix\.is-visible \{[\s\S]*?position:\s*absolute;[\s\S]*?left:\s*-0\.75rem;/
  );
  assert.match(
    styles,
    /\.markdown-page-layer\.is-source[\s\S]*?\.markdown-page-quote-source-line \.markdown-page-quote-source-nested,[\s\S]*?\.markdown-page-layer\.is-live-preview[\s\S]*?\.markdown-page-quote-source-nested \{[\s\S]*?border-left-color:\s*transparent;/
  );
  assert.match(
    styles,
    /\.markdown-page-list-prefix\s*\{[^}]*display:\s*none;/
  );
  assert.match(
    styles,
    /\.markdown-source-indentation\s*\{[^}]*position:\s*absolute;[^}]*width:\s*0;[^}]*height:\s*0;/
  );
  assert.doesNotMatch(
    styles,
    /\.markdown-page-layer:is\(\.is-source, \.is-live-preview\)[^{]*\.markdown-page-quote[^{]*\{[^}]*display:\s*grid;/,
    'source markers must not become a second quote indentation column'
  );
  assert.doesNotMatch(
    styles,
    /\.markdown-page-quote\s*>\s*\.markdown-source-marker/,
    'canonical quote markers belong to coherent source-line rows, not semantic wrappers'
  );
});
