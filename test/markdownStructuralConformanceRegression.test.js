const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const markdown = require('../public/markdownPage');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const view = loadMarkdownPageViewInternals([
  'semanticSyntaxSegments',
  'renderSemanticBlockContents',
  'semanticSourceFromNode'
]);

const EDITOR_MODES = Object.freeze(['reading', 'live-preview', 'source']);

function astDescendants(node) {
  const result = [];
  const visit = (current, depth = 0) => {
    if (!current) return;
    result.push({ node: current, depth });
    (current.children || []).forEach((child) => visit(child, depth + 1));
  };
  visit(node);
  return result;
}

function astNodes(node, type) {
  return astDescendants(node)
    .filter((entry) => entry.node.type === type)
    .map((entry) => entry.node);
}

function elementNodes(root, predicate) {
  return descendants(root).filter((node) => node?.nodeType === 1 && predicate(node));
}

function elementsByTag(root, tagName) {
  const expected = String(tagName).toUpperCase();
  return elementNodes(root, (node) => node.tagName === expected);
}

function elementsByClass(root, className) {
  return elementNodes(root, (node) => node.classList.contains(className));
}

function directElementsByTag(root, tagName) {
  const expected = String(tagName).toUpperCase();
  return (root?.children || []).filter((node) => node.tagName === expected);
}

function renderedFixture(source, mode) {
  const rendered = renderSemanticSegments(view, source, { mode });
  const sourceFromDom = rendered.blocks
    .map((block) => view.semanticSourceFromNode(block.element))
    .join('');
  return { ...rendered, sourceFromDom };
}

function renderedDocumentRoot(rendered) {
  const root = new FakeElement({ tagName: 'main' });
  root.append(...rendered.blocks.map((block) => block.element));
  return root;
}

function assertCanonicalRoundTrip(source, rendered, label) {
  assert.equal(rendered.sourceFromDom, source, `${label}: DOM source stays canonical`);
  assert.equal(
    rendered.state.markdownSyntaxTree.position.start.offset,
    0,
    `${label}: parser input starts at canonical offset zero`
  );
  assert.equal(
    rendered.state.markdownSyntaxTree.position.end.offset,
    source.length,
    `${label}: parser input ends at the canonical source length`
  );
}

function listItemLabel(item) {
  return elementsByTag(item, 'p')[0]?.textContent || '';
}

function listItemDepths(root) {
  const result = new Map();
  const visit = (node, listDepth = 0) => {
    if (!node || node.nodeType !== 1) return;
    const nextDepth = node.tagName === 'OL' || node.tagName === 'UL'
      ? listDepth + 1
      : listDepth;
    if (node.tagName === 'LI') result.set(listItemLabel(node), listDepth);
    (node.childNodes || []).forEach((child) => visit(child, nextDepth));
  };
  visit(root);
  return result;
}

const MIXED_INDENT_ORDERED_LIST = [
  '1. Glycolysis',
  '2. Link reaction',
  '3. TCA cycle',
  '\t1. Citrate',
  '    2. Isocitrate'
].join('\n');

test('mixed TAB and four-space ordered items share one parser-owned nested list', () => {
  const source = MIXED_INDENT_ORDERED_LIST;
  const tree = markdown.parseMarkdownDocument(source);
  const topList = tree.children[0];
  const tcaItem = topList.children[2];
  const nestedList = tcaItem.children.find((node) => node.type === 'list');

  assert.equal(tree.children.length, 1);
  assert.equal(topList.type, 'list');
  assert.equal(topList.ordered, true);
  assert.equal(topList.children.length, 3);
  assert.equal(nestedList?.ordered, true);
  assert.equal(nestedList?.start, 1);
  assert.equal(nestedList?.children.length, 2);
  assert.deepEqual(
    nestedList.children.map((item) => item.children[0].children[0].value),
    ['Citrate', 'Isocitrate']
  );

  assert.deepEqual(
    nestedList.children.map((item) => [
      item.position.start.offset,
      item.position.end.offset,
      source.slice(item.position.start.offset, item.position.end.offset)
    ]),
    [
      [45, 55, '1. Citrate'],
      [60, 73, '2. Isocitrate']
    ]
  );
  assert.equal(source.charCodeAt(44), 9, 'the first nested item retains its literal TAB');
  assert.equal(source.slice(56, 60), '    ', 'the sibling retains four literal spaces');
});

test('mixed TAB and four-space ordered items retain the same semantic DOM depth in every mode', async (t) => {
  for (const mode of EDITOR_MODES) {
    await t.test(mode, () => {
      const rendered = renderedFixture(MIXED_INDENT_ORDERED_LIST, mode);
      assertCanonicalRoundTrip(MIXED_INDENT_ORDERED_LIST, rendered, mode);

      const root = rendered.blocks[0].element;
      const topList = directElementsByTag(root, 'ol')[0];
      const topItems = directElementsByTag(topList, 'li');
      const nestedList = elementsByTag(topItems[2], 'ol')[0];
      const nestedItems = directElementsByTag(nestedList, 'li');
      const depths = listItemDepths(root);

      assert.equal(topItems.length, 3, `${mode}: nested items are not flattened into the root`);
      assert.equal(nestedItems.length, 2, `${mode}: both mixed-indent items share one nested OL`);
      assert.deepEqual(nestedItems.map(listItemLabel), ['Citrate', 'Isocitrate']);
      assert.equal(depths.get('Glycolysis'), 1);
      assert.equal(depths.get('Link reaction'), 1);
      assert.equal(depths.get('TCA cycle'), 1);
      assert.equal(depths.get('Citrate'), 2);
      assert.equal(depths.get('Isocitrate'), 2);
    });
  }
});

test('ordered-list counters remain independent at all three AST and DOM levels', async (t) => {
  const source = [
    '1. One',
    '2. Two',
    '3. Three',
    '\t1. Nested one',
    '\t2. Nested two',
    '\t\t1. Level three',
    '\t\t2. Level three second',
    '\t3. Nested three',
    '4. Four'
  ].join('\n');
  const tree = markdown.parseMarkdownDocument(source);
  const top = tree.children[0];
  const nested = top.children[2].children.find((node) => node.type === 'list');
  const deepest = nested.children[1].children.find((node) => node.type === 'list');

  assert.deepEqual(
    [top, nested, deepest].map((list) => ({
      ordered: list.ordered,
      start: list.start,
      itemCount: list.children.length
    })),
    [
      { ordered: true, start: 1, itemCount: 4 },
      { ordered: true, start: 1, itemCount: 3 },
      { ordered: true, start: 1, itemCount: 2 }
    ]
  );

  for (const mode of EDITOR_MODES) {
    await t.test(mode, () => {
      const rendered = renderedFixture(source, mode);
      assertCanonicalRoundTrip(source, rendered, mode);
      const root = rendered.blocks[0].element;
      const topOl = directElementsByTag(root, 'ol')[0];
      const nestedOl = elementsByTag(directElementsByTag(topOl, 'li')[2], 'ol')[0];
      const deepestOl = elementsByTag(directElementsByTag(nestedOl, 'li')[1], 'ol')[0];
      assert.deepEqual(
        [topOl, nestedOl, deepestOl].map((list) => directElementsByTag(list, 'li').length),
        [4, 3, 2]
      );
    });
  }
});

const LIST_MARKER_VARIANTS = Object.freeze([
  {
    name: 'asterisk unordered marker',
    source: ['* One', '* Two', '  * Child'].join('\n'),
    ordered: false,
    tagName: 'ul',
    markers: ['*', '*', '*']
  },
  {
    name: 'plus unordered marker',
    source: ['+ One', '+ Two', '  + Child'].join('\n'),
    ordered: false,
    tagName: 'ul',
    markers: ['+', '+', '+']
  },
  {
    name: 'parenthesized ordered delimiter',
    source: ['1) One', '2) Two', '   1) Child'].join('\n'),
    ordered: true,
    tagName: 'ol',
    markers: ['1)', '2)', '1)']
  }
]);

test('all supported CommonMark list marker variants retain one AST and DOM hierarchy', async (t) => {
  for (const fixture of LIST_MARKER_VARIANTS) {
    await t.test(fixture.name, async (fixtureTest) => {
      const tree = markdown.parseMarkdownDocument(fixture.source);
      const topList = tree.children[0];
      const nestedList = topList.children[1].children.find((node) => node.type === 'list');
      const items = astNodes(tree, 'listItem');

      assert.equal(tree.children.length, 1);
      assert.equal(topList.type, 'list');
      assert.equal(topList.ordered, fixture.ordered);
      assert.equal(nestedList?.ordered, fixture.ordered);
      assert.deepEqual(
        items.map((item) => {
          const raw = fixture.source.slice(item.position.start.offset, item.position.end.offset);
          return raw.match(/^(?:\s*)(\d+[.)]|[*+-])/u)?.[1];
        }),
        fixture.markers
      );

      for (const mode of EDITOR_MODES) {
        await fixtureTest.test(mode, () => {
          const rendered = renderedFixture(fixture.source, mode);
          assertCanonicalRoundTrip(fixture.source, rendered, `${fixture.name} / ${mode}`);
          const root = renderedDocumentRoot(rendered);
          const top = directElementsByTag(rendered.blocks[0].element, fixture.tagName)[0];
          const topItems = directElementsByTag(top, 'li');
          const nested = elementsByTag(topItems[1], fixture.tagName)[0];

          assert.equal(topItems.length, 2);
          assert.equal(directElementsByTag(nested, 'li').length, 1);
          assert.equal(listItemDepths(root).get('Child'), 2);
        });
      }
    });
  }
});

test('reference images retain source-only literal presentation in every mode', async (t) => {
  const source = [
    '![Diagram][asset]',
    '',
    '[asset]: assets/images/example.png "Example title"'
  ].join('\n');
  const tree = markdown.parseMarkdownDocument(source);
  const imageReference = astNodes(tree, 'imageReference')[0];
  const definition = astNodes(tree, 'definition')[0];

  assert.ok(imageReference);
  assert.equal(imageReference.identifier, 'asset');
  assert.ok(definition);
  assert.equal(definition.identifier, 'asset');
  assert.equal(definition.url, 'assets/images/example.png');
  assert.equal(definition.title, 'Example title');

  for (const mode of EDITOR_MODES) {
    await t.test(mode, () => {
      const rendered = renderedFixture(source, mode);
      assertCanonicalRoundTrip(source, rendered, `reference image / ${mode}`);
      const root = renderedDocumentRoot(rendered);
      const sourceOnly = elementsByClass(root, 'markdown-page-image-source-only');

      assert.equal(elementsByTag(root, 'img').length, 0);
      assert.equal(sourceOnly.length, 1);
      assert.equal(sourceOnly[0].textContent, '![Diagram][asset]');
      assert.equal(sourceOnly[0].dataset.markdownImagePresentation, 'source-only');
      assert.equal(
        elementsByClass(sourceOnly[0], 'markdown-page-image-source-alt')[0]?.textContent,
        'Diagram'
      );
    });
  }
});

const STRUCTURAL_FIXTURES = Object.freeze([
  {
    name: 'escaped punctuation stays in one ordinary paragraph',
    source: 'Escaped symbols: \\*not italic\\*,  \\# not a heading.',
    inspectAst(tree) {
      assert.deepEqual(tree.children.map((node) => node.type), ['paragraph']);
      assert.equal(astNodes(tree, 'heading').length, 0);
      assert.equal(astNodes(tree, 'emphasis').length, 0);
      assert.equal(astNodes(tree, 'text')[0].value,
        'Escaped symbols: *not italic*,  # not a heading.');
    },
    inspectDom(root) {
      assert.equal(elementsByTag(root, 'p').length, 1);
      assert.equal(elementsByTag(root, 'em').length, 0);
      assert.equal(elementsByTag(root, 'h1').length, 0);
    }
  },
  {
    name: 'ATX headings keep six independent semantic levels',
    source: ['# H1', '## H2', '### H3', '#### H4', '##### H5', '###### H6'].join('\n\n'),
    inspectAst(tree) {
      assert.deepEqual(tree.children.map((node) => node.depth), [1, 2, 3, 4, 5, 6]);
    },
    inspectDom(root) {
      assert.deepEqual(
        elementNodes(root, (node) => /^H[1-6]$/.test(node.tagName))
          .map((node) => node.tagName),
        ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']
      );
    }
  },
  {
    name: 'mixed ordered and unordered lists retain AST ownership',
    source: [
      '1. Ordered parent',
      '\t- unordered child one',
      '\t- unordered child two',
      '2. Ordered peer',
      '',
      '- Unordered parent',
      '\t1. ordered child one',
      '\t2. ordered child two',
      '- Unordered peer'
    ].join('\n'),
    inspectAst(tree) {
      assert.equal(tree.children.length, 2);
      assert.equal(tree.children[0].ordered, true);
      assert.equal(tree.children[0].children[0].children[1].ordered, false);
      assert.equal(tree.children[1].ordered, false);
      assert.equal(tree.children[1].children[0].children[1].ordered, true);
    },
    inspectDom(root) {
      assert.equal(elementsByTag(root, 'ol').length, 2);
      assert.equal(elementsByTag(root, 'ul').length, 2);
      const depths = listItemDepths(root);
      assert.equal(depths.get('unordered child one'), 2);
      assert.equal(depths.get('unordered child two'), 2);
      assert.equal(depths.get('ordered child one'), 2);
      assert.equal(depths.get('ordered child two'), 2);
    }
  },
  {
    name: 'three quote levels remain nested semantic ancestors',
    source: ['> Level one', '>', '>> Level two', '>>', '>>> Level three'].join('\n'),
    inspectAst(tree) {
      const quotes = astNodes(tree, 'blockquote');
      assert.equal(quotes.length, 3);
      assert.ok(quotes[0].children.includes(quotes[1]));
      assert.ok(quotes[1].children.includes(quotes[2]));
    },
    inspectDom(root) {
      const quotes = elementsByTag(root, 'blockquote');
      assert.equal(quotes.length, 3);
      assert.equal(quotes[0].contains(quotes[1]), true);
      assert.equal(quotes[1].contains(quotes[2]), true);
    }
  },
  {
    name: 'fenced code owns its complete source without Markdown or math children',
    source: ['```javascript', 'const formula = "$x^2$";', '```'].join('\n'),
    inspectAst(tree) {
      const code = astNodes(tree, 'code');
      assert.equal(code.length, 1);
      assert.equal(code[0].lang, 'javascript');
      assert.equal(code[0].value, 'const formula = "$x^2$";');
      assert.equal(astNodes(code[0], 'inlineMath').length, 0);
      assert.equal(astNodes(code[0], 'math').length, 0);
    },
    inspectDom(root) {
      assert.equal(elementsByClass(root, 'markdown-page-code-shell').length, 1);
      assert.equal(elementsByTag(root, 'pre').length, 1);
    }
  },
  {
    name: 'GFM table retains rows, cells, alignment, and mode-specific hierarchy',
    source: [
      '| Left | Centre | Right |',
      '|:---|:---:|---:|',
      '| A | B | C |'
    ].join('\n'),
    inspectAst(tree) {
      const table = astNodes(tree, 'table')[0];
      assert.ok(table);
      assert.deepEqual(Array.from(table.align), ['left', 'center', 'right']);
      assert.equal(table.children.length, 2);
      assert.deepEqual(table.children.map((row) => row.children.length), [3, 3]);
    },
    inspectDom(root, mode) {
      if (mode === 'source') {
        assert.equal(elementsByClass(root, 'markdown-page-table-source').length, 1);
        assert.equal(elementsByTag(root, 'table').length, 0);
      } else {
        assert.equal(elementsByTag(root, 'table').length, 1);
        assert.equal(elementsByTag(root, 'th').length, 3);
        assert.equal(elementsByTag(root, 'td').length >= 3, true);
      }
    }
  },
  {
    name: 'thematic breaks remain source-owned but have no semantic HR element',
    source: ['---', '', '***', '', '___'].join('\n'),
    inspectAst(tree) {
      assert.equal(astNodes(tree, 'thematicBreak').length, 3);
    },
    inspectDom(root) {
      assert.equal(elementsByClass(root, 'markdown-page-rule-source').length, 3);
      assert.equal(elementsByTag(root, 'hr').length, 0);
    }
  }
]);

test('supported structural corpus keeps parser hierarchy, semantic DOM, and canonical bytes', async (t) => {
  for (const fixture of STRUCTURAL_FIXTURES) {
    await t.test(fixture.name, async (fixtureTest) => {
      const tree = markdown.parseMarkdownDocument(fixture.source);
      assert.equal(tree.position.start.offset, 0);
      assert.equal(tree.position.end.offset, fixture.source.length);
      fixture.inspectAst(tree);

      for (const mode of EDITOR_MODES) {
        await fixtureTest.test(mode, () => {
          const rendered = renderedFixture(fixture.source, mode);
          assertCanonicalRoundTrip(fixture.source, rendered, `${fixture.name} / ${mode}`);
          fixture.inspectDom(renderedDocumentRoot(rendered), mode);
        });
      }
    });
  }
});

test('complete Markdown conformance fixture round-trips through every semantic mode', async (t) => {
  const source = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'markdown-conformance.md'),
    'utf8'
  );
  const tree = markdown.parseMarkdownDocument(source);

  assert.equal(tree.position.start.offset, 0);
  assert.equal(tree.position.end.offset, source.length);

  for (const mode of EDITOR_MODES) {
    await t.test(mode, () => {
      const rendered = renderedFixture(source, mode);
      assertCanonicalRoundTrip(source, rendered, `complete fixture / ${mode}`);
    });
  }
});
