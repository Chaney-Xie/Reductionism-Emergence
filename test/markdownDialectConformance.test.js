const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const runtime = require('../public/vendor/markdownRuntime');

function descendants(node) {
  const result = [];
  const visit = (current) => {
    if (!current || typeof current !== 'object') return;
    result.push(current);
    (current.children || []).forEach(visit);
  };
  visit(node);
  return result;
}

function semanticTypeCounts(tree) {
  const counts = {};
  descendants(tree).forEach((node) => {
    if (node.type === 'root' || node.type === 'text') return;
    counts[node.type] = (counts[node.type] || 0) + 1;
  });
  return counts;
}

function assertPositionedRoundTrip(source, tree, label) {
  assert.equal(tree.position?.start?.offset, 0, `${label}: root starts at byte 0`);
  assert.equal(tree.position?.end?.offset, source.length, `${label}: root covers all source`);

  const verify = (node) => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    assert.equal(typeof start, 'number', `${label}: ${node.type} has a numeric start`);
    assert.equal(typeof end, 'number', `${label}: ${node.type} has a numeric end`);
    assert.ok(start >= 0 && start <= end && end <= source.length,
      `${label}: ${node.type} range is within canonical source`);
    assert.equal(source.slice(start, end).length, end - start,
      `${label}: ${node.type} range uses exact source offsets`);

    let cursor = start;
    let reconstructed = '';
    (node.children || []).forEach((child) => {
      const childStart = child.position?.start?.offset;
      const childEnd = child.position?.end?.offset;
      assert.ok(childStart >= cursor, `${label}: ${node.type} child ranges do not overlap`);
      assert.ok(childStart >= start && childEnd <= end,
        `${label}: ${child.type} is contained by ${node.type}`);
      reconstructed += source.slice(cursor, childStart);
      reconstructed += source.slice(childStart, childEnd);
      cursor = childEnd;
      verify(child);
    });
    reconstructed += source.slice(cursor, end);
    assert.equal(reconstructed, source.slice(start, end),
      `${label}: ${node.type} positioned children round-trip exact source`);
  };

  verify(tree);

  const topLevelCoverage = new Uint8Array(source.length);
  (tree.children || []).forEach((node) => {
    for (let offset = node.position.start.offset; offset < node.position.end.offset; offset += 1) {
      topLevelCoverage[offset] += 1;
      assert.equal(topLevelCoverage[offset], 1,
        `${label}: top-level source byte ${offset} belongs to only one semantic block`);
    }
  });
  let cursor = 0;
  let reconstructed = '';
  (tree.children || []).forEach((node) => {
    reconstructed += source.slice(cursor, node.position.start.offset);
    reconstructed += source.slice(node.position.start.offset, node.position.end.offset);
    cursor = node.position.end.offset;
  });
  reconstructed += source.slice(cursor);
  assert.equal(reconstructed, source, `${label}: top-level ranges and gaps preserve every byte`);
}

function assertPatterns(value, patterns, label) {
  (patterns || []).forEach((pattern) => {
    assert.match(value, pattern, `${label}: expected rendered semantic output ${pattern}`);
  });
}

function assertExcludedPatterns(value, patterns, label) {
  (patterns || []).forEach((pattern) => {
    assert.doesNotMatch(value, pattern, `${label}: excluded unsafe or non-semantic output ${pattern}`);
  });
}

const blockCases = [
  {
    name: 'ATX and Setext headings',
    source: [
      '# H1', '## H2', '### H3', '#### H4', '##### H5', '###### H6', '',
      'Setext One', '==========', '', 'Setext Two', '----------'
    ].join('\n'),
    blockTypes: Array(8).fill('heading'),
    counts: { heading: 8 },
    inspect(tree) {
      assert.deepEqual(
        tree.children.map((node) => node.depth),
        [1, 2, 3, 4, 5, 6, 1, 2]
      );
    },
    rendered: [/<h1>H1<\/h1>/, /<h6>H6<\/h6>/, /<h1>Setext One<\/h1>/,
      /<h2>Setext Two<\/h2>/]
  },
  {
    name: 'soft breaks, hard breaks, HTML break, and genuine blank lines',
    source: [
      'soft', 'line', 'two-space hard  ', 'after two-space', 'slash hard\\',
      'after slash', 'html<br>after html', '', '', 'next paragraph'
    ].join('\n'),
    blockTypes: ['paragraph', 'paragraph'],
    counts: { paragraph: 2, break: 2, html: 1 },
    rendered: [/soft\nline/, /two-space hard<br>after two-space/,
      /slash hard<br>after slash/, /html<br>after html/, /<p>next paragraph<\/p>/]
  },
  {
    name: 'nested block quotes including an empty quoted line',
    source: ['> outer', '>', '> > nested', '> >', '> > deeper continuation'].join('\n'),
    blockTypes: ['quote'],
    counts: { blockquote: 2, paragraph: 3 },
    rendered: [/<blockquote><p>outer<\/p><blockquote><p>nested<\/p><p>deeper continuation<\/p>/]
  },
  {
    name: 'nested ordered and unordered lists, continuation paragraph, and tasks',
    source: [
      '1. parent', '   - child', '     continuation', '',
      '   continued paragraph', '2. next', '', '- [ ] todo', '- [x] done'
    ].join('\n'),
    blockTypes: ['ordered-list', 'unordered-list'],
    counts: { list: 3, listItem: 5, paragraph: 6 },
    inspect(tree) {
      const items = descendants(tree).filter((node) => node.type === 'listItem');
      assert.deepEqual(items.filter((node) => typeof node.checked === 'boolean')
        .map((node) => node.checked), [false, true]);
      assert.equal(tree.children[0].ordered, true);
      assert.equal(tree.children[0].children[0].children[1].ordered, false);
    },
    rendered: [/<ol>/, /<ul>/, /continued paragraph/, /type="checkbox" disabled/,
      /type="checkbox" disabled checked/]
  },
  {
    name: 'all CommonMark thematic-break marker forms',
    source: ['---', '', '***', '', '___'].join('\n'),
    blockTypes: ['rule', 'rule', 'rule'],
    counts: { thematicBreak: 3 },
    rendered: [/^$/]
  },
  {
    name: 'indented code plus backtick and tilde fenced code',
    source: [
      '    const indented = 1;', '',
      '```javascript title="demo"', 'const tick = `x`;', '```', '',
      '~~~python', 'print(1)', '~~~'
    ].join('\n'),
    blockTypes: ['code', 'code', 'code'],
    counts: { code: 3 },
    inspect(tree) {
      assert.deepEqual(tree.children.map((node) => ({
        lang: node.lang ?? null,
        meta: node.meta ?? null,
        value: node.value
      })), [
        { lang: null, meta: null, value: 'const indented = 1;' },
        { lang: 'javascript', meta: 'title="demo"', value: 'const tick = `x`;' },
        { lang: 'python', meta: null, value: 'print(1)' }
      ]);
    },
    rendered: [/is-indented/, /is-fenced/, /JavaScript/, /Python/,
      /hljs-keyword[^>]*>const/, /hljs-built_in[^>]*>print/]
  }
];

test('CommonMark and GFM block corpus has stable positioned structure and semantics', async (t) => {
  for (const fixture of blockCases) {
    await t.test(fixture.name, () => {
      const tree = runtime.parseMarkdown(fixture.source);
      assertPositionedRoundTrip(fixture.source, tree, fixture.name);
      assert.deepEqual(markdown.sourceBlocks(fixture.source).map((block) => block.type),
        fixture.blockTypes);
      const counts = semanticTypeCounts(tree);
      Object.entries(fixture.counts).forEach(([type, count]) => {
        assert.equal(counts[type], count, `${fixture.name}: ${type} count`);
      });
      fixture.inspect?.(tree);
      const html = markdown.renderMarkdown(fixture.source);
      assertPatterns(html, fixture.rendered, fixture.name);
      assertExcludedPatterns(html, fixture.excluded, fixture.name);
    });
  }
});

const inlineCases = [
  {
    name: 'asterisk and underscore emphasis variants plus nesting',
    source: '*a* _b_ **c** __d__ ***e*** **outer *inner* outer**',
    counts: { emphasis: 4, strong: 4 },
    rendered: [/<em>a<\/em>/, /<em>b<\/em>/, /<strong>c<\/strong>/,
      /<strong>d<\/strong>/, /(?:<em><strong>e<\/strong><\/em>|<strong><em>e<\/em><\/strong>)/,
      /<strong>outer <em>inner<\/em> outer<\/strong>/]
  },
  {
    name: 'intraword underscores, escapes, strike, and punctuation adjacency',
    source: 'foo_bar_baz \\*literal\\* (~~strike~~), **bold**!',
    counts: { delete: 1, strong: 1 },
    inspect(tree) {
      assert.equal(descendants(tree).some((node) => node.type === 'emphasis'), false);
      assert.ok(descendants(tree).some((node) => node.type === 'text'
        && node.value.includes('foo_bar_baz *literal*')));
    },
    rendered: [/foo_bar_baz \*literal\*/, /\(<del>strike<\/del>\),/,
      /<strong>bold<\/strong>!/]
  },
  {
    name: 'code span containing a backtick',
    source: 'Before ``code ` tick`` after',
    counts: { inlineCode: 1 },
    inspect(tree) {
      assert.equal(descendants(tree).find((node) => node.type === 'inlineCode').value,
        'code ` tick');
    },
    rendered: [/<code class="markdown-page-inline-code">code ` tick<\/code>/]
  },
  {
    name: 'inline link with title',
    source: '[label](https://example.test/path "Title")',
    counts: { link: 1 },
    inspect(tree) {
      const link = descendants(tree).find((node) => node.type === 'link');
      assert.equal(link.url, 'https://example.test/path');
      assert.equal(link.title, 'Title');
    },
    rendered: [/<a href="https:\/\/example\.test\/path" title="Title" rel="noreferrer">label<\/a>/]
  },
  {
    name: 'full and collapsed reference links preserve their definitions',
    source: ['[full][target] and [target][] and [target]', '',
      '[target]: https://example.test/reference "Reference title"'].join('\n'),
    blockTypes: ['paragraph', 'definition'],
    counts: { linkReference: 3, definition: 1 },
    rendered: [
      /<a href="https:\/\/example\.test\/reference" title="Reference title" rel="noreferrer">full<\/a>/,
      /<a href="https:\/\/example\.test\/reference" title="Reference title" rel="noreferrer">target<\/a>/
    ]
  },
  {
    name: 'angle and GFM literal autolinks',
    source: '<https://example.test> https://example.org test@example.com',
    counts: { link: 3 },
    inspect(tree) {
      assert.deepEqual(descendants(tree).filter((node) => node.type === 'link')
        .map((node) => node.url), [
        'https://example.test', 'https://example.org', 'mailto:test@example.com'
      ]);
    },
    rendered: [/href="https:\/\/example\.test"/, /href="https:\/\/example\.org"/,
      /href="mailto:test@example\.com"/]
  },
  {
    name: 'image, entities, numeric entities, and escaped punctuation',
    source: '![alt](https://example.test/image.png "Image title") &amp; &copy; &#35; \\[literal\\]',
    counts: { image: 1 },
    inspect(tree) {
      const image = descendants(tree).find((node) => node.type === 'image');
      assert.deepEqual({ url: image.url, title: image.title, alt: image.alt }, {
        url: 'https://example.test/image.png', title: 'Image title', alt: 'alt'
      });
      assert.ok(descendants(tree).some((node) => node.type === 'text'
        && node.value.includes('& © # [literal]')));
    },
    rendered: [
      /data-markdown-image-presentation="source-only"/,
      /markdown-page-image-source-marker is-symbol-group-2">!\[<\/span>/,
      /markdown-page-image-source-alt">alt<\/span>/,
      /markdown-page-image-source-destination is-symbol-group-2">\]\(https:\/\/example\.test\/image\.png &quot;Image title&quot;\)<\/span>/,
      /&amp; © # \[literal\]/
    ],
    excluded: [/<img(?:\s|>)/i]
  }
];

test('CommonMark and GFM inline corpus has stable positioned tokens and semantics', async (t) => {
  for (const fixture of inlineCases) {
    await t.test(fixture.name, () => {
      const tree = runtime.parseMarkdown(fixture.source);
      assertPositionedRoundTrip(fixture.source, tree, fixture.name);
      assert.deepEqual(markdown.sourceBlocks(fixture.source).map((block) => block.type),
        fixture.blockTypes || ['paragraph']);
      const counts = semanticTypeCounts(tree);
      Object.entries(fixture.counts).forEach(([type, count]) => {
        assert.equal(counts[type], count, `${fixture.name}: ${type} count`);
      });
      fixture.inspect?.(tree);
      const html = markdown.renderMarkdown(fixture.source);
      assertPatterns(html, fixture.rendered, fixture.name);
      assertExcludedPatterns(html, fixture.excluded, fixture.name);
    });
  }
});

const tableCases = [
  {
    name: 'aligned table',
    source: ['| Left | Centre | Right |', '| :--- | :---: | ---: |', '| A | B | C |'].join('\n'),
    align: ['left', 'center', 'right'],
    values: [['Left', 'Centre', 'Right'], ['A', 'B', 'C']]
  },
  {
    name: 'empty cells remain semantic cells',
    source: ['| A |  | C |', '| --- | --- | --- |', '|  | B |  |'].join('\n'),
    align: [null, null, null],
    values: [['A', '', 'C'], ['', 'B', '']]
  }
];

test('GFM table corpus preserves alignment, empty cells, pipes, and exact ranges', async (t) => {
  for (const fixture of tableCases) {
    await t.test(fixture.name, () => {
      const tree = runtime.parseMarkdown(fixture.source);
      assertPositionedRoundTrip(fixture.source, tree, fixture.name);
      assert.equal(tree.children.length, 1);
      const table = tree.children[0];
      assert.equal(table.type, 'table');
      assert.deepEqual(Array.from(table.align), fixture.align);
      assert.deepEqual(table.children.map((row) => row.children.map((cell) => (
        (cell.children || []).map((node) => node.value || '').join('')
      ))), fixture.values);
      assert.equal(fixture.source.slice(table.position.start.offset, table.position.end.offset),
        fixture.source);
      const html = markdown.renderMarkdown(fixture.source);
      assert.match(html, /<table><thead>/);
      assert.match(html, /<tbody>/);
      if (fixture.name === 'aligned table') {
        assert.match(html, /<th style="text-align:left">Left<\/th>/);
        assert.match(html, /<th style="text-align:center">Centre<\/th>/);
        assert.match(html, /<th style="text-align:right">Right<\/th>/);
      } else {
        assert.match(html, /<th><\/th>/);
        assert.match(html, /<td><\/td>/);
      }
    });
  }
});

test('approved inline HTML is retained while arbitrary raw HTML stays escaped and inert', () => {
  const safeSource = '<u>under <sub>nested</sub></u> <sub>sub</sub> <sup>sup</sup> line<br>next';
  const safeTree = runtime.parseMarkdown(safeSource);
  assertPositionedRoundTrip(safeSource, safeTree, 'approved inline HTML');
  assert.equal(semanticTypeCounts(safeTree).html, 9);
  assert.equal(
    markdown.renderMarkdown(safeSource),
    '<p><u>under <sub>nested</sub></u> <sub>sub</sub> <sup>sup</sup> line<br>next</p>'
  );

  const unsafeSource = [
    '<script>alert(1)</script>', '',
    'Safe [link](https://example.test) <iframe src="x" onload="alert(1)"></iframe>'
  ].join('\n');
  const unsafeTree = runtime.parseMarkdown(unsafeSource);
  assertPositionedRoundTrip(unsafeSource, unsafeTree, 'sanitized raw HTML');
  const html = markdown.renderMarkdown(unsafeSource);
  assertPatterns(html, [
    /&lt;script&gt;alert\(1\)&lt;\/script&gt;/,
    /<a href="https:\/\/example\.test" rel="noreferrer">link<\/a>/,
    /&lt;iframe src=&quot;x&quot; onload=&quot;alert\(1\)&quot;&gt;&lt;\/iframe&gt;/
  ], 'sanitized raw HTML');
  assertExcludedPatterns(html, [/<script(?:\s|>)/i, /<iframe(?:\s|>)/i],
    'sanitized raw HTML');
});
