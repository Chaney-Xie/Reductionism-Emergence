const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = require('../public/markdownPage');
const { createTabSession, defaultViewState } = require('../public/sessionTabs');

function loadMarkdownPageViewModel() {
  const frameSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'structuredTextFrame.js'),
    'utf8'
  );
  const shellSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'structuredTextPageShell.js'),
    'utf8'
  );
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
    'utf8'
  );
  const context = { globalThis: { markdownPageModel: markdown } };
  vm.runInNewContext(frameSource, context);
  vm.runInNewContext(shellSource, context);
  vm.runInNewContext(source, context);
  return context.globalThis.markdownPageView;
}

function emptyPage(type = 'canvas') {
  return {
    id: 'page_markdown_test',
    type,
    title: 'Bound title is not body content',
    objects: [],
    blocks: [],
    highlightGroups: [],
    maintenanceResources: [],
    externalLinks: []
  };
}

test('Markdown preference normalization defaults Preserve Single Line Breaks off and validates Booleans only', () => {
  assert.deepEqual(markdown.DEFAULT_SETTINGS, {
    lastMarkdownMode: markdown.MARKDOWN_MODES.LIVE_PREVIEW,
    preserveSingleLineBreaks: false
  });
  assert.equal(markdown.normalizeSettings(null).preserveSingleLineBreaks, false);
  assert.equal(markdown.normalizeSettings({ preserveSingleLineBreaks: true })
    .preserveSingleLineBreaks, true);
  assert.equal(markdown.normalizeSettings({ preserveSingleLineBreaks: 'true' })
    .preserveSingleLineBreaks, false);
  assert.equal(markdown.validateSettings({
    defaultPageType: 'canvas',
    lastMarkdownMode: 'reading',
    preserveSingleLineBreaks: true
  }).ok, true);
  assert.equal(markdown.validateSettings({
    defaultPageType: 'canvas',
    preserveSingleLineBreaks: 1
  }).ok, false);
});

test('Markdown parser renders the v1 block and inline formats from one safe source', () => {
  const source = [
    '# Body heading',
    '',
    'Paragraph with *emphasis*, **strong text**, [a link](https://example.test), `inline code`, and $x+y$.',
    '',
    '- alpha',
    '- beta',
    '',
    '1. first',
    '2. second',
    '',
    '> quoted line',
    '',
    '---',
    '',
    '```js',
    'const less = 1 < 2;',
    '```',
    '',
    '$$',
    'E = mc^2',
    '$$'
  ].join('\n');

  assert.deepEqual(
    markdown.sourceBlocks(source).map((block) => block.type),
    [
      'heading', 'paragraph', 'unordered-list', 'ordered-list',
      'quote', 'rule', 'code', 'math'
    ]
  );

  const html = markdown.renderMarkdown(source);
  assert.match(html, /<h1>Body heading<\/h1>/);
  assert.match(html, /<em>emphasis<\/em>/);
  assert.match(html, /<strong>strong text<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.test" rel="noreferrer">a link<\/a>/);
  assert.match(html, /<code class="markdown-page-inline-code">inline code<\/code>/);
  assert.match(html, /<span class="markdown-math-inline" data-math-source="x\+y">/);
  assert.match(html, /<annotation encoding="application\/x-tex">x\+y<\/annotation>/);
  assert.match(html, /<ul><li><p>alpha<\/p><\/li><li><p>beta<\/p><\/li><\/ul>/);
  assert.match(html, /<ol><li><p>first<\/p><\/li><li><p>second<\/p><\/li><\/ol>/);
  assert.match(html, /<blockquote><p>quoted line<\/p><\/blockquote>/);
  assert.doesNotMatch(html, /<hr\b/i);
  assert.match(html, /markdown-page-code-shell is-fenced/);
  assert.match(html, /markdown-code-language-control is-display-only/);
  assert.match(html, /<code class="hljs language-javascript">/);
  assert.match(html, /<span class="hljs-keyword">const<\/span> less =/);
  assert.match(html, /<div class="markdown-math-display" data-math-source="E = mc\^2">/);
  assert.match(html, /<annotation encoding="application\/x-tex">E = mc\^2<\/annotation>/);
  assert.doesNotMatch(html, /katex-error/);
});

test('semantic rendering keeps nested inline styles, tables, breaks, and code boundaries', () => {
  const source = [
    '***both*** and ~~removed~~',
    'soft line',
    'hard line  ',
    'after hard break',
    '',
    '| A | B |',
    '| :- | -: |',
    '| 1 | 2 |',
    '',
    '```javascript',
    'const formula = "$x^2$";',
    '```'
  ].join('\n');
  const html = markdown.renderMarkdown(source);

  assert.match(html, /(?:<em><strong>both<\/strong><\/em>|<strong><em>both<\/em><\/strong>)/);
  assert.match(html, /<del>removed<\/del>/);
  assert.match(html, /soft line\n/);
  assert.match(html, /hard line<br>after hard break/);
  assert.match(html, /<table><thead><tr><th style="text-align:left">A<\/th><th style="text-align:right">B<\/th>/);
  assert.match(html, /markdown-page-code-shell is-fenced/);
  assert.match(html, /<code class="hljs language-javascript">/);
  assert.match(html, /<span class="hljs-keyword">const<\/span> formula = <span class="hljs-string">&quot;\$x\^2\$&quot;<\/span>;/);
  assert.doesNotMatch(html, /language-javascript[^]*markdown-math/);
  assert.equal(markdown.readableText(source).includes('***'), false);
  assert.equal(markdown.readableText(source).includes('~~'), false);
});

test('Markdown rendering escapes raw HTML and refuses executable link protocols', () => {
  const source = [
    '<script>globalThis.compromised = true</script>',
    '<img src=x onerror="globalThis.compromised = true">',
    '',
    '[safe](https://example.test/path)',
    '[relative](./local-page)',
    '[unsafe](javascript:alert(1))',
    '[also unsafe](data:text/html,boom)'
  ].join('\n');
  const html = markdown.renderMarkdown(source);

  assert.doesNotMatch(html, /<script(?:\s|>)/i);
  assert.doesNotMatch(html, /<img(?:\s|>)/i);
  assert.doesNotMatch(html, /href="(?:javascript|data):/i);
  assert.match(html, /&lt;script&gt;globalThis\.compromised = true&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;globalThis\.compromised = true&quot;&gt;/);
  assert.match(html, /href="https:\/\/example\.test\/path"/);
  assert.match(html, /href="\.\/local-page"/);
  assert.match(html, /(?:^|\n)unsafe(?:\n|$)/);
  assert.match(html, /(?:^|\n)also unsafe(?:<\/p>|\n|$)/);
  assert.equal(markdown.safeLinkHref('mailto:reader@example.test'), 'mailto:reader@example.test');
  assert.equal(markdown.safeLinkHref('./local-page'), './local-page');
  assert.equal(markdown.safeLinkHref('javascript:alert(1)'), '');
  assert.equal(markdown.safeLinkHref('data:text/html,boom'), '');
});

test('Markdown statistics count rendered English and Han units while excluding syntax and whitespace', () => {
  const source = [
    '**Hello** world, \u4f60\u597d\uff01',
    '',
    '`const x` + $\u03b1+\u03b2$.',
    '',
    '---'
  ].join('\n');

  assert.equal(markdown.readableText(source), 'Hello world, \u4f60\u597d\uff01\nconst x + \u03b1+\u03b2.');
  assert.deepEqual(markdown.statistics(source), {
    words: 8,
    paragraphs: 2,
    characters: 25
  });
  assert.deepEqual(markdown.statistics('   \n\t\n'), {
    words: 0,
    paragraphs: 0,
    characters: 0
  });
  assert.deepEqual(markdown.statistics('$\\alpha$'), {
    words: 1,
    paragraphs: 1,
    characters: 1
  });
  assert.deepEqual(markdown.statistics('$$\n\\frac{a}{b}\n$$'), {
    words: 2,
    paragraphs: 1,
    characters: 2
  });
});

test('conversion eligibility is conservative about meaningful Markdown and visual dependencies', () => {
  const harmlessMarkdown = {
    ...emptyPage('markdown'),
    markdownBody: '  \n\n\t',
    textFrame: { preferredWidth: 760 },
    maintenanceResources: [{
      id: 'resource_psd', filename: 'source.psd', mimeType: 'image/vnd.adobe.photoshop'
    }],
    externalLinks: [{ id: 'page_link', href: 'https://example.test' }]
  };
  assert.deepEqual(markdown.conversionEligibility(harmlessMarkdown, 'canvas'), {
    allowed: true,
    reasons: []
  });

  const horizontalRule = { ...harmlessMarkdown, markdownBody: '---' };
  const horizontalRuleResult = markdown.conversionEligibility(horizontalRule, 'canvas');
  assert.equal(horizontalRuleResult.allowed, false);
  assert.match(horizontalRuleResult.reasons.join(' '), /Markdown body/);

  const hiddenImageObject = {
    ...emptyPage('canvas'),
    objects: [{ id: 'image_hidden', type: 'image', hidden: true, src: 'images/hidden.png' }]
  };
  const hiddenObjectResult = markdown.conversionEligibility(hiddenImageObject, 'markdown');
  assert.equal(hiddenObjectResult.allowed, false);
  assert.match(hiddenObjectResult.reasons.join(' '), /Canvas Objects/);

  const hiddenImageResource = {
    ...emptyPage('canvas'),
    maintenanceResources: [{
      id: 'resource_png', filename: 'hidden.png', hidden: true, displayable: false
    }]
  };
  const hiddenResourceResult = markdown.conversionEligibility(hiddenImageResource, 'markdown');
  assert.equal(hiddenResourceResult.allowed, false);
  assert.match(hiddenResourceResult.reasons.join(' '), /display-capable resource/);

  const blockOwnedExternalLink = {
    ...emptyPage('canvas'),
    externalLinks: [{ id: 'block_link', sourceBlockId: 'block_a', href: 'https://example.test' }]
  };
  const externalLinkResult = markdown.conversionEligibility(blockOwnedExternalLink, 'markdown');
  assert.equal(externalLinkResult.allowed, false);
  assert.match(externalLinkResult.reasons.join(' '), /Block-owned External Link/);

  const blockAndHighlight = {
    ...emptyPage('canvas'),
    blocks: [{ id: 'block_a' }],
    highlightGroups: [{ id: 'group_a', blockIds: ['block_a'] }]
  };
  const dependentResult = markdown.conversionEligibility(blockAndHighlight, 'markdown');
  assert.equal(dependentResult.allowed, false);
  assert.match(dependentResult.reasons.join(' '), /Blocks/);
  assert.match(dependentResult.reasons.join(' '), /Highlight Groups/);
});

test('Live Preview source segmentation preserves exact editable source ranges', () => {
  const view = loadMarkdownPageViewModel();
  const source = [
    '# Heading',
    '',
    'paragraph line one',
    'paragraph line two',
    '',
    '- list one',
    '- list two',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '$$',
    'x + y',
    '$$',
    '',
    '> quote one',
    '> quote two',
    '',
    '---'
  ].join('\n');
  const segments = Array.from(view.sourceSegments(source), (segment) => ({
    start: segment.start,
    end: segment.end,
    raw: segment.raw
  }));

  assert.deepEqual(segments.map((segment) => segment.raw), [
    '# Heading',
    'paragraph line one\nparagraph line two',
    '- list one\n- list two',
    '```js\nconst x = 1;\n```',
    '$$\nx + y\n$$',
    '> quote one\n> quote two',
    '---'
  ]);
  for (const segment of segments) {
    assert.equal(source.slice(segment.start, segment.end), segment.raw);
  }
});

test('editable inter-block gaps subtract only the structural newline from visual spacing', () => {
  const view = loadMarkdownPageViewModel();
  const cases = [
    ['\n', 0, ''],
    ['\n\n', 1, '\n'],
    ['\n\n\n', 2, '\n\n']
  ];

  cases.forEach(([source, expectedBlankLines, expectedVisibleSource]) => {
    const layout = view.editableSourceGapLayout(source, { betweenBlocks: true });
    assert.equal(layout.source, source);
    assert.equal(layout.structuralLength, 1);
    assert.equal(layout.visibleSource, expectedVisibleSource);
    assert.equal(layout.visibleBlankLines, expectedBlankLines);
    assert.deepEqual(Array.from(layout.visibleLineOffsets), Array.from(
      { length: expectedBlankLines },
      (_, index) => index + 1
    ));
  });

  const leading = view.editableSourceGapLayout('\n\n', { betweenBlocks: false });
  assert.equal(leading.source, '\n\n');
  assert.equal(leading.structuralLength, 0);
  assert.equal(leading.visibleSource, '\n\n');
  assert.equal(leading.visibleBlankLines, 2);
  assert.deepEqual(Array.from(leading.visibleLineOffsets), [0, 1]);

  const trailing = view.editableSourceGapLayout('\n\n', {
    hasPrecedingContent: true,
    hasFollowingContent: false
  });
  assert.equal(trailing.structuralLength, 1);
  assert.equal(trailing.visibleSource, '\n');
  assert.equal(trailing.visibleBlankLines, 2);
  assert.deepEqual(Array.from(trailing.visibleLineOffsets), [1, 2]);

  const windowsLineEnding = view.editableSourceGapLayout('\r\n\r\n', {
    betweenBlocks: true
  });
  assert.equal(windowsLineEnding.source, '\r\n\r\n');
  assert.equal(windowsLineEnding.structuralLength, 2);
  assert.equal(windowsLineEnding.visibleSource, '\r\n');
  assert.equal(windowsLineEnding.visibleBlankLines, 1);
  assert.deepEqual(Array.from(windowsLineEnding.visibleLineOffsets), [2]);
});

test('semantic table editing preserves outer whitespace and exact pipes', () => {
  const view = loadMarkdownPageViewModel();
  const row = '  | A | B |  ';
  const slices = Array.from(view.tableRowSlices(row));
  assert.equal(
    slices.map((slice) => `${slice.prefix}${slice.content}${slice.suffix}`).join(''),
    row
  );
});

test('Markdown document extent follows text and Object geometry and can shrink again', () => {
  const view = loadMarkdownPageViewModel();
  const calculateExtent = view.calculateMarkdownDocumentExtent;
  assert.equal(typeof calculateExtent, 'function');

  const shortDocument = calculateExtent({
    documentTop: 0,
    contentBottom: 240,
    objects: [],
    bottomPadding: 80,
    minimumHeight: 520
  });
  assert.equal(shortDocument.top, 0);
  assert.equal(shortDocument.bottom, 600);
  assert.equal(shortDocument.height, 600);

  const extendedByText = calculateExtent({
    documentTop: 0,
    contentBottom: 760,
    objects: [],
    bottomPadding: 80,
    minimumHeight: 520
  });
  assert.equal(extendedByText.bottom, 840);

  const extendedByObject = calculateExtent({
    documentTop: 0,
    contentBottom: 400,
    objects: [
      { id: 'higher', y: 180, height: 100 },
      { id: 'lowest', y: 720, height: 140 }
    ],
    bottomPadding: 80,
    minimumHeight: 520
  });
  assert.equal(extendedByObject.bottom, 940);

  const movedUp = calculateExtent({
    documentTop: 0,
    contentBottom: 400,
    objects: [{ id: 'lowest', y: 500, height: 90 }],
    bottomPadding: 80,
    minimumHeight: 520
  });
  assert.equal(movedUp.bottom, 670);

  const deleted = calculateExtent({
    documentTop: 0,
    contentBottom: 400,
    objects: [],
    bottomPadding: 80,
    minimumHeight: 520
  });
  assert.equal(deleted.bottom, 600);

  const provisionalFloor = calculateExtent({
    documentTop: 0,
    contentBottom: 400,
    objects: [],
    bottomPadding: 80,
    minimumHeight: 520,
    provisionalBottom: 940
  });
  assert.equal(provisionalFloor.bottom, 940);
  assert.ok(deleted.bottom < movedUp.bottom);
  assert.ok(movedUp.bottom < extendedByObject.bottom);
});

test('Markdown visual frame covers its owning Pane without changing semantic document extent', () => {
  const view = loadMarkdownPageViewModel();
  const calculateVisualExtent = view.calculateMarkdownVisualFrameExtent;
  assert.equal(typeof calculateVisualExtent, 'function');

  const semanticDocumentBottom = 608;
  const atOneHundredPercent = calculateVisualExtent({
    documentTop: 0,
    documentBottom: semanticDocumentBottom,
    viewportHeight: 800,
    scale: 1,
    cameraOffsetY: 0
  });
  assert.equal(atOneHundredPercent.documentBottom, semanticDocumentBottom);
  assert.equal(atOneHundredPercent.viewportWorldBottom, 800);
  assert.equal(atOneHundredPercent.bottom, 800);
  assert.equal(atOneHundredPercent.height, 800);

  const atFiftyPercent = calculateVisualExtent({
    documentTop: 0,
    documentBottom: semanticDocumentBottom,
    viewportHeight: 800,
    scale: 0.5,
    cameraOffsetY: 0
  });
  assert.equal(atFiftyPercent.documentBottom, semanticDocumentBottom);
  assert.equal(atFiftyPercent.viewportWorldBottom, 1600);
  assert.equal(atFiftyPercent.bottom, 1600);

  const atTwoHundredPercent = calculateVisualExtent({
    documentTop: 0,
    documentBottom: semanticDocumentBottom,
    viewportHeight: 800,
    scale: 2,
    cameraOffsetY: 0
  });
  assert.equal(atTwoHundredPercent.documentBottom, semanticDocumentBottom);
  assert.equal(atTwoHundredPercent.viewportWorldBottom, 400);
  assert.equal(atTwoHundredPercent.bottom, semanticDocumentBottom);

  const panned = calculateVisualExtent({
    documentTop: 0,
    documentBottom: 1200,
    viewportHeight: 800,
    scale: 1,
    cameraOffsetY: -300
  });
  assert.equal(panned.viewportWorldBottom, 1100);
  assert.equal(panned.bottom, 1200, 'long semantic content continues to own the lower extent');

  const shortPanned = calculateVisualExtent({
    documentTop: 0,
    documentBottom: semanticDocumentBottom,
    viewportHeight: 800,
    scale: 1,
    cameraOffsetY: -200
  });
  assert.equal(shortPanned.bottom, 1000, 'camera translation is converted back into world units');
  assert.equal(shortPanned.documentBottom, semanticDocumentBottom);
});

test('Markdown vertical camera clamp is top aligned and zoom aware', () => {
  const view = loadMarkdownPageViewModel();
  const clampOffset = view.clampMarkdownVerticalOffset;
  assert.equal(typeof clampOffset, 'function');
  const options = {
    scale: 1,
    viewportHeight: 600,
    documentTop: 0,
    documentBottom: 1000,
    topInset: 0
  };

  assert.equal(clampOffset({ ...options, offsetY: 250 }), 0);
  assert.equal(clampOffset({ ...options, offsetY: -900 }), -400);
  assert.equal(clampOffset({ ...options, offsetY: -180 }), -180);

  assert.equal(clampOffset({
    ...options,
    offsetY: -900,
    scale: 0.5
  }), 0, 'a short zoomed-out document stays aligned to its top');
  assert.equal(clampOffset({
    ...options,
    offsetY: -3000,
    scale: 2
  }), -1400, 'the bottom clamp uses scaled document geometry');
});

test('Markdown Arrow navigation is owned by the canonical editable projection', () => {
  const view = loadMarkdownPageViewModel();
  const viewSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
    'utf8'
  );

  assert.equal(view.moveMarkdownSelectionByArrow, undefined,
    'the removed flat-source navigator cannot bypass the editable projection');
  assert.match(viewSource, /function applySemanticArrowNavigation\(state, event\)[^]*?projection\?\.getSelection\(\)/);
  assert.match(viewSource, /projection\.moveVertical\([^]*?projection\.moveHorizontal\(/);
  assert.match(viewSource, /ensureEditableSelectionVisible\(state, next, \{ direction: key \}\)[^]*?restoreSelection\(visible\)/);
});

test('Markdown view has no responsive frame-compression or Pane-resize owner', () => {
  const view = loadMarkdownPageViewModel();
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
    'utf8'
  );

  assert.equal(view.constrainMarkdownFrameToViewport, undefined);
  assert.equal(view.beginMarkdownPaneResize, undefined);
  assert.equal(view.endMarkdownPaneResize, undefined);
  assert.doesNotMatch(source, /renderedWidth|frameOffsetX|frameConstraintSide|VIEWPORT_FRAME_INSET/);
  assert.doesNotMatch(source, /ResizeObserver\(\(\) => resizeState/);
});

test('the same Markdown Page keeps independent camera state in each Tab view', () => {
  let nextId = 0;
  const session = createTabSession({ createId: () => `markdown_tab_${++nextId}` });
  const first = session.createTab('markdown_page');
  session.saveViewState(first.id, {
    panX: -120,
    panY: -480,
    zoom: 1.6,
    viewportInitialized: true
  });
  const second = session.createTab('markdown_page');
  session.saveViewState(second.id, {
    panX: 95,
    panY: -70,
    zoom: 0.85,
    viewportInitialized: true
  });

  assert.deepEqual(
    [session.tabById(first.id).viewState.panY, session.tabById(first.id).viewState.zoom],
    [-480, 1.6]
  );
  assert.deepEqual(
    [session.tabById(second.id).viewState.panY, session.tabById(second.id).viewState.zoom],
    [-70, 0.85]
  );

  session.closeTab(first.id);
  assert.equal(session.tabById(first.id), null);
  assert.deepEqual(
    [session.tabById(second.id).viewState.panY, session.tabById(second.id).viewState.zoom],
    [-70, 0.85]
  );

  const reopened = session.createTab('markdown_page');
  assert.deepEqual(
    [reopened.viewState.panX, reopened.viewState.panY, reopened.viewState.zoom],
    [0, 0, 1]
  );
  assert.equal(Object.hasOwn(defaultViewState(), 'lastMarkdownMode'), false);
  assert.equal(Object.hasOwn(defaultViewState(), 'markdownBody'), false);
});
