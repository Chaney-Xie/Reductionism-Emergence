const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pageTypesModel = require('../public/pageTypes');
const markdownPageModel = require('../public/markdownPage');

const { PAGE_TYPES } = pageTypesModel;

function emptyHnText() {
  return {
    schemaVersion: 3,
    revision: 0,
    source: '',
    anchors: {}
  };
}

test('the shared registry owns Canvas, Markdown and HN Text', () => {
  const definitions = pageTypesModel.registeredPageTypes();
  assert.deepEqual(definitions.map(({ id }) => id), [
    PAGE_TYPES.CANVAS,
    PAGE_TYPES.MARKDOWN,
    PAGE_TYPES.HN_TEXT
  ]);
  assert.equal(new Set(definitions.map(({ id }) => id)).size, definitions.length);
  assert.deepEqual(definitions.map(({ rendererId }) => rendererId), [
    'canvas',
    'markdown',
    'cne-text'
  ]);
  assert.deepEqual(definitions.map(({ navigationBadge }) => navigationBadge), [
    'CANVAS',
    'MD',
    'HN'
  ]);
  assert.equal(pageTypesModel.pageTypeNavigationBadge(PAGE_TYPES.CANVAS), 'CANVAS');
  assert.equal(pageTypesModel.pageTypeNavigationBadge(PAGE_TYPES.MARKDOWN), 'MD');
  assert.equal(pageTypesModel.pageTypeNavigationBadge(PAGE_TYPES.HN_TEXT), 'HN');
  assert.equal(pageTypesModel.pageTypeNavigationBadge('future-unregistered'), null);
  assert.deepEqual(definitions.map(({ fileImportPlacementId }) => fileImportPlacementId), [
    'canvas',
    'markdown-document',
    null
  ]);
});

test('legacy missing Page types become Canvas while explicit unknown types remain unknown', () => {
  assert.equal(pageTypesModel.normalizePageRecord({ id: 'legacy' }).type, PAGE_TYPES.CANVAS);
  assert.equal(pageTypesModel.normalizePageIndexEntry({ id: 'legacy' }).type, PAGE_TYPES.CANVAS);

  for (const explicitInvalidType of [null, 42, {}, '', '   ']) {
    const invalidPage = { id: 'invalid', type: explicitInvalidType };
    pageTypesModel.normalizePageRecord(invalidPage);
    assert.notEqual(invalidPage.type, PAGE_TYPES.CANVAS);
    const invalidIndexEntry = { id: 'invalid', type: explicitInvalidType };
    pageTypesModel.normalizePageIndexEntry(invalidIndexEntry);
    assert.equal(invalidIndexEntry.type, explicitInvalidType);
    assert.equal(pageTypesModel.pageTypeDefinition(invalidPage.type), null);
    assert.equal(pageTypesModel.validatePageRecord(invalidPage).ok, false);
    assert.equal(pageTypesModel.validateVaultDefaultPageType(explicitInvalidType).ok, false);
    assert.throws(
      () => pageTypesModel.createPageRecord({ id: 'invalid' }, explicitInvalidType),
      /Unsupported Page Type/
    );
  }

  const unknownPage = {
    id: 'future',
    type: 'future-structured-text',
    futureContent: { keep: true }
  };
  pageTypesModel.normalizePageRecord(unknownPage);
  assert.equal(unknownPage.type, 'future-structured-text');
  assert.deepEqual(unknownPage.futureContent, { keep: true });
  assert.equal(pageTypesModel.pageTypeRendererId(unknownPage.type), null);
  assert.equal(pageTypesModel.pageTypeSupports(unknownPage.type, 'canvas'), false);
});

test('Canvas and Markdown normalization retain their existing contracts', () => {
  const envelope = { id: 'created', title: 'Created', objects: [], blocks: [] };
  const createdCanvas = pageTypesModel.createPageRecord(envelope, PAGE_TYPES.CANVAS);
  assert.equal(createdCanvas.type, PAGE_TYPES.CANVAS);
  assert.equal(Object.hasOwn(createdCanvas, 'navigationBadge'), false);
  assert.deepEqual(createdCanvas.objects, []);
  assert.equal(Object.hasOwn(createdCanvas, 'markdownBody'), false);

  const createdMarkdown = pageTypesModel.createPageRecord(envelope, PAGE_TYPES.MARKDOWN);
  assert.equal(createdMarkdown.type, PAGE_TYPES.MARKDOWN);
  assert.equal(Object.hasOwn(createdMarkdown, 'navigationBadge'), false);
  assert.equal(createdMarkdown.markdownBody, '');
  assert.deepEqual(createdMarkdown.textFrame, { centerWorldX: 0, preferredWidth: 760 });

  const canvas = pageTypesModel.normalizePageRecord({
    type: PAGE_TYPES.CANVAS,
    markdownBody: 'remove',
    textFrame: { preferredWidth: 900 },
    objects: [{ id: 'object_1' }]
  });
  assert.equal(canvas.type, PAGE_TYPES.CANVAS);
  assert.equal(Object.hasOwn(canvas, 'markdownBody'), false);
  assert.equal(Object.hasOwn(canvas, 'textFrame'), false);
  assert.deepEqual(canvas.objects, [{ id: 'object_1' }]);

  const markdown = pageTypesModel.normalizePageRecord({ type: PAGE_TYPES.MARKDOWN });
  assert.equal(markdown.markdownBody, '');
  assert.deepEqual(markdown.textFrame, { centerWorldX: 0, preferredWidth: 760 });
});

test('HN Text is creatable, schema-bounded and excluded from Page-index content', () => {
  const page = pageTypesModel.createPageRecord({ id: 'page_cne', title: 'HN' }, PAGE_TYPES.HN_TEXT);
  assert.equal(page.type, PAGE_TYPES.HN_TEXT);
  assert.equal(Object.hasOwn(page, 'navigationBadge'), false);
  assert.deepEqual(page.cneText, emptyHnText());
  assert.deepEqual(page.textFrame, { centerWorldX: 0, preferredWidth: 760 });
  assert.equal(pageTypesModel.pageTypeSupports(PAGE_TYPES.HN_TEXT, 'page-edit'), true);
  assert.equal(pageTypesModel.pageTypeSupports(PAGE_TYPES.HN_TEXT, 'structured-text'), true);

  const indexEntry = pageTypesModel.normalizePageIndexEntry({
    id: page.id,
    type: page.type,
    title: page.title,
    cneText: emptyHnText(),
    markdownBody: '# Must not enter the Page index',
    textFrame: { preferredWidth: 900 }
  });
  assert.equal(indexEntry.type, PAGE_TYPES.HN_TEXT);
  assert.equal(Object.hasOwn(indexEntry, 'cneText'), false);
  assert.equal(Object.hasOwn(indexEntry, 'markdownBody'), false);
  assert.equal(Object.hasOwn(indexEntry, 'textFrame'), false);

  assert.deepEqual(
    pageTypesModel.validatePageTypePartialSave(page, 'cneText', emptyHnText()),
    { ok: true, value: emptyHnText() }
  );
  page.textFrame = { centerWorldX: 275, preferredWidth: 900 };
  assert.deepEqual(
    pageTypesModel.validatePageTypePartialSave(page, 'textFrame', { preferredWidth: 1100 }).value,
    { centerWorldX: 275, preferredWidth: 1100 }
  );
  assert.equal(pageTypesModel.validatePageTypePartialSave(page, 'markdownBody', '').ok, false);
  assert.equal(pageTypesModel.validatePageTypePartialSave(page, 'cneText', {
    ...emptyHnText(),
    document: { type: 'doc', content: [{ type: 'paragraph' }] }
  }).ok, false);
  assert.equal(pageTypesModel.validatePageTypePartialSave(page, 'cneText', {
    ...emptyHnText(),
    revision: 1
  }).ok, true);
  const legacyV2 = {
    schemaVersion: 2,
    revision: 12,
    document: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'cne-paragraph-001' },
          content: [{
            type: 'text',
            text: 'Strong emphasis',
            marks: [{ type: 'strong' }, { type: 'emphasis' }]
          }]
        },
        {
          type: 'heading',
          attrs: { id: 'cne-heading-001', level: 3 },
          content: [{
            type: 'text',
            text: 'Struck heading',
            marks: [{ type: 'strikethrough' }]
          }]
        }
      ]
    }
  };
  assert.equal(pageTypesModel.validatePageTypePartialSave(page, 'cneText', legacyV2).ok, false);
  assert.equal(pageTypesModel.validatePageRecord({
    ...page,
    cneText: legacyV2
  }).ok, true);
  assert.equal(pageTypesModel.validatePageTypePartialSave(page, 'cneText', {
    ...emptyHnText(),
    history: { undo: [] }
  }).ok, false);

  const futureDocument = {
    schemaVersion: 1,
    revision: 0,
    document: { type: 'future-doc', content: [{ type: 'keep' }] }
  };
  const explicitFuturePage = { type: PAGE_TYPES.HN_TEXT, cneText: futureDocument };
  pageTypesModel.normalizePageRecord(explicitFuturePage);
  assert.deepEqual(explicitFuturePage.cneText, futureDocument);
  assert.equal(pageTypesModel.validatePageRecord(explicitFuturePage).ok, false);

  const explicitInvalidPage = { type: PAGE_TYPES.HN_TEXT, cneText: null };
  pageTypesModel.normalizePageRecord(explicitInvalidPage);
  assert.equal(explicitInvalidPage.cneText, null);
  assert.equal(pageTypesModel.validatePageRecord(explicitInvalidPage).ok, false);

  const missingContentPage = { type: PAGE_TYPES.HN_TEXT };
  pageTypesModel.normalizePageRecord(missingContentPage);
  assert.deepEqual(missingContentPage.cneText, emptyHnText());
});

test('normalization dispatches only to the selected registered Page Type', () => {
  const hnPage = {
    type: PAGE_TYPES.HN_TEXT,
    cneText: emptyHnText(),
    markdownBody: 'must not select the Markdown normalizer',
    textFrame: { preferredWidth: 999 }
  };
  pageTypesModel.normalizePageRecord(hnPage);
  assert.equal(hnPage.type, PAGE_TYPES.HN_TEXT);
  assert.equal(hnPage.markdownBody, 'must not select the Markdown normalizer');
  assert.deepEqual(hnPage.textFrame, { centerWorldX: 0, preferredWidth: 999 });
  assert.deepEqual(hnPage.cneText, emptyHnText());
});

test('Vault defaults and conversion edges derive from registered descriptors', () => {
  assert.equal(pageTypesModel.normalizeSettings(null).defaultPageType, PAGE_TYPES.CANVAS);
  assert.equal(pageTypesModel.normalizeSettings({ defaultPageType: null }).defaultPageType, null);
  assert.deepEqual(pageTypesModel.vaultDefaultPageTypes().map(({ id }) => id), [
    PAGE_TYPES.CANVAS,
    PAGE_TYPES.MARKDOWN,
    PAGE_TYPES.HN_TEXT
  ]);
  assert.equal(pageTypesModel.validateVaultDefaultPageType(PAGE_TYPES.HN_TEXT).ok, true);
  assert.equal(pageTypesModel.validateVaultDefaultPageType('future-type').ok, false);

  const canvas = { type: PAGE_TYPES.CANVAS, objects: [], blocks: [], highlightGroups: [] };
  assert.equal(pageTypesModel.conversionEligibility(canvas, PAGE_TYPES.MARKDOWN).allowed, true);
  assert.equal(pageTypesModel.conversionEligibility(canvas, PAGE_TYPES.HN_TEXT).allowed, true);
  assert.equal(pageTypesModel.conversionEligibility(
    { type: PAGE_TYPES.HN_TEXT, cneText: emptyHnText() },
    PAGE_TYPES.CANVAS
  ).allowed, true);
  assert.equal(pageTypesModel.conversionEligibility(
    { type: PAGE_TYPES.MARKDOWN, markdownBody: '', textFrame: { preferredWidth: 760 } },
    PAGE_TYPES.HN_TEXT
  ).allowed, true);
  assert.equal(pageTypesModel.conversionEligibility(
    { type: PAGE_TYPES.HN_TEXT, cneText: emptyHnText() },
    PAGE_TYPES.MARKDOWN
  ).allowed, true);
});

test('Markdown and HN Text convert only across canonical empty document states', () => {
  for (const markdownBody of [' ', '\n', '\t', '#', '<!-- authored -->']) {
    assert.equal(pageTypesModel.conversionEligibility({
      type: PAGE_TYPES.MARKDOWN,
      markdownBody,
      textFrame: { preferredWidth: 760 }
    }, PAGE_TYPES.HN_TEXT).allowed, false, JSON.stringify(markdownBody));
  }

  for (const source of [' ', '**x**']) {
    const hnPage = {
      type: PAGE_TYPES.HN_TEXT,
      cneText: { ...emptyHnText(), source },
      textFrame: { preferredWidth: 760 }
    };
    assert.equal(
      pageTypesModel.conversionEligibility(hnPage, PAGE_TYPES.CANVAS).allowed,
      false,
      JSON.stringify(source)
    );
    assert.equal(
      pageTypesModel.conversionEligibility(hnPage, PAGE_TYPES.MARKDOWN).allowed,
      false,
      JSON.stringify(source)
    );
  }

  const anchoredEmptySource = {
    type: PAGE_TYPES.HN_TEXT,
    cneText: {
      ...emptyHnText(),
      anchors: {
        retained_anchor: { start: 0, end: 0 }
      }
    },
    textFrame: { preferredWidth: 760 }
  };
  assert.equal(
    pageTypesModel.conversionEligibility(anchoredEmptySource, PAGE_TYPES.CANVAS).allowed,
    false
  );
  assert.equal(
    pageTypesModel.conversionEligibility(anchoredEmptySource, PAGE_TYPES.MARKDOWN).allowed,
    false
  );

  const emptyParagraph = {
    type: 'paragraph',
    attrs: { id: 'cne_empty_paragraph' }
  };
  for (const document of [
    { type: 'doc', content: [] },
    { type: 'doc', content: [emptyParagraph] },
    { type: 'doc', content: [{ ...emptyParagraph, content: [] }] }
  ]) {
    assert.equal(pageTypesModel.hnTextPlaceholderIsEmpty({
      schemaVersion: 2,
      revision: 7,
      document
    }), true);
  }

  for (const document of [
    { type: 'doc', content: [emptyParagraph, {
      type: 'paragraph', attrs: { id: 'cne_second_empty_paragraph' }
    }] },
    { type: 'doc', content: [{
      type: 'heading', attrs: { id: 'cne_empty_heading', level: 1 }
    }] },
    { type: 'doc', content: [{
      ...emptyParagraph,
      content: [{ type: 'text', text: ' ' }]
    }] },
    { type: 'doc', content: [{
      ...emptyParagraph,
      content: [{ type: 'inline-atom' }]
    }] }
  ]) {
    assert.equal(pageTypesModel.hnTextPlaceholderIsEmpty({
      schemaVersion: 2,
      revision: 7,
      document
    }), false);
  }
});

test('all direct empty-body conversions preserve the Page envelope exactly', () => {
  const envelope = {
    id: 'page_empty_conversion',
    title: 'Title is not document content',
    code: 'PAGE-CODE',
    categories: ['category-a'],
    descriptors: ['descriptor-a'],
    ignoredDescriptorIds: ['descriptor-ignored'],
    objects: [{ id: 'object-a', x: 12, y: 34 }],
    maintenanceResources: [{ id: 'resource-a', originalName: 'resource.pdf' }],
    externalLinks: [{ id: 'link-a', url: 'https://example.com/' }],
    blocks: [{ id: 'block-a' }],
    highlightGroups: [{ id: 'highlight-a', blockIds: ['block-a'] }],
    backlinks: [{ pageId: 'page-source' }],
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T01:00:00.000Z'
  };
  const markdown = {
    ...structuredClone(envelope),
    type: PAGE_TYPES.MARKDOWN,
    markdownBody: '',
    textFrame: { preferredWidth: 1337 }
  };

  const canvas = {
    ...structuredClone(envelope),
    type: PAGE_TYPES.CANVAS
  };
  const canvasToHn = pageTypesModel.convertPage(canvas, PAGE_TYPES.HN_TEXT);
  assert.equal(canvasToHn.ok, true);
  assert.equal(canvasToHn.page.type, PAGE_TYPES.HN_TEXT);
  assert.deepEqual(canvasToHn.page.cneText, emptyHnText());
  assert.deepEqual(canvasToHn.page.textFrame, {
    centerWorldX: 0,
    preferredWidth: 760
  });
  assert.equal(Object.hasOwn(canvasToHn.page, 'markdownBody'), false);
  for (const [field, value] of Object.entries(envelope)) {
    assert.deepEqual(canvasToHn.page[field], value, field);
  }
  assert.deepEqual(canvas, {
    ...envelope,
    type: PAGE_TYPES.CANVAS
  });

  const hnToCanvas = pageTypesModel.convertPage(canvasToHn.page, PAGE_TYPES.CANVAS);
  assert.equal(hnToCanvas.ok, true);
  assert.equal(hnToCanvas.page.type, PAGE_TYPES.CANVAS);
  assert.equal(Object.hasOwn(hnToCanvas.page, 'cneText'), false);
  assert.equal(Object.hasOwn(hnToCanvas.page, 'markdownBody'), false);
  assert.equal(Object.hasOwn(hnToCanvas.page, 'textFrame'), false);
  for (const [field, value] of Object.entries(envelope)) {
    assert.deepEqual(hnToCanvas.page[field], value, field);
  }

  const toHn = pageTypesModel.convertPage(markdown, PAGE_TYPES.HN_TEXT);
  assert.equal(toHn.ok, true);
  assert.equal(toHn.page.type, PAGE_TYPES.HN_TEXT);
  assert.deepEqual(toHn.page.cneText, emptyHnText());
  assert.equal(Object.hasOwn(toHn.page, 'markdownBody'), false);
  assert.deepEqual(toHn.page.textFrame, { centerWorldX: 0, preferredWidth: 1337 });
  for (const [field, value] of Object.entries(envelope)) {
    assert.deepEqual(toHn.page[field], value, field);
  }
  assert.equal(markdown.type, PAGE_TYPES.MARKDOWN);
  assert.equal(markdown.markdownBody, '');
  assert.deepEqual(markdown.textFrame, { preferredWidth: 1337 });

  toHn.page.cneText = {
    schemaVersion: 2,
    revision: 9,
    document: {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'runtime_empty_paragraph' } }]
    }
  };
  const toMarkdown = pageTypesModel.convertPage(toHn.page, PAGE_TYPES.MARKDOWN);
  assert.equal(toMarkdown.ok, true);
  assert.equal(toMarkdown.page.type, PAGE_TYPES.MARKDOWN);
  assert.equal(toMarkdown.page.markdownBody, '');
  assert.deepEqual(toMarkdown.page.textFrame, { centerWorldX: 0, preferredWidth: 1337 });
  assert.equal(Object.hasOwn(toMarkdown.page, 'cneText'), false);
  for (const [field, value] of Object.entries(envelope)) {
    assert.deepEqual(toMarkdown.page[field], value, field);
  }
});

test('the four pre-existing conversion edges retain their exact target-body contracts', () => {
  const canvas = {
    id: 'existing_edge_canvas',
    type: PAGE_TYPES.CANVAS,
    title: 'Existing edge',
    objects: [],
    blocks: [],
    highlightGroups: [],
    maintenanceResources: [],
    externalLinks: []
  };
  const canvasToMarkdown = pageTypesModel.convertPage(canvas, PAGE_TYPES.MARKDOWN);
  assert.equal(canvasToMarkdown.ok, true);
  assert.deepEqual(canvasToMarkdown.page, {
    ...canvas,
    type: PAGE_TYPES.MARKDOWN,
    markdownBody: '',
    textFrame: { centerWorldX: 0, preferredWidth: 760 }
  });

  const markdownToCanvas = pageTypesModel.convertPage(
    canvasToMarkdown.page,
    PAGE_TYPES.CANVAS
  );
  assert.equal(markdownToCanvas.ok, true);
  assert.deepEqual(markdownToCanvas.page, canvas);

  const markdownWithFrame = {
    ...canvasToMarkdown.page,
    textFrame: { centerWorldX: 125, preferredWidth: 940 }
  };
  const markdownToHn = pageTypesModel.convertPage(
    markdownWithFrame,
    PAGE_TYPES.HN_TEXT
  );
  assert.equal(markdownToHn.ok, true);
  assert.deepEqual(markdownToHn.page, {
    ...canvas,
    type: PAGE_TYPES.HN_TEXT,
    cneText: emptyHnText(),
    textFrame: { centerWorldX: 125, preferredWidth: 940 }
  });

  const hnToMarkdown = pageTypesModel.convertPage(
    markdownToHn.page,
    PAGE_TYPES.MARKDOWN
  );
  assert.equal(hnToMarkdown.ok, true);
  assert.deepEqual(hnToMarkdown.page, markdownWithFrame);
});

test('browser and Node consumers register the same Page Type IDs', () => {
  const context = vm.createContext({ console });
  const publicRoot = path.join(__dirname, '..', 'public');
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'hnListNumbering.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'structuredTextCount.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'hnText.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'structuredTextFrame.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'pageTypes.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'markdownPage.js'), 'utf8'), context);
  const browserIds = vm.runInContext(
    'pageTypesModel.registeredPageTypes().map((definition) => definition.id)',
    context
  );
  assert.deepEqual([...browserIds], pageTypesModel.registeredPageTypes().map(({ id }) => id));
  assert.equal(markdownPageModel.PAGE_TYPES, pageTypesModel.PAGE_TYPES);
});

test('type adapters cannot replace the generic envelope or registered identity', () => {
  const context = vm.createContext({ console });
  const publicRoot = path.join(__dirname, '..', 'public');
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'hnListNumbering.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'structuredTextCount.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'hnText.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'structuredTextFrame.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'pageTypes.js'), 'utf8'), context);
  const created = JSON.parse(vm.runInContext(`
    pageTypesModel.registerPageType({
      id: 'factory-audit',
      createContent: () => ({ id: 'factory-owned', title: 'Factory', type: 'canvas', payload: true }),
      normalizePage: (page) => page,
      validatePage: () => ({ ok: true })
    });
    JSON.stringify(pageTypesModel.createPageRecord(
      { id: 'envelope-owned', title: 'Envelope' },
      'factory-audit'
    ));
  `, context));
  assert.equal(created.id, 'envelope-owned');
  assert.equal(created.title, 'Envelope');
  assert.equal(created.type, 'factory-audit');
  assert.equal(created.payload, true);

  const mutationAttempt = JSON.parse(vm.runInContext(`
    pageTypesModel.registerPageType({
      id: 'normalizer-audit',
      normalizePage: (page) => { page.type = 'canvas'; return page; }
    });
    const page = { type: 'normalizer-audit', payload: { keep: true } };
    let error = null;
    try { pageTypesModel.normalizePageRecord(page); } catch (caught) { error = caught.message; }
    JSON.stringify({ error, page });
  `, context));
  assert.match(mutationAttempt.error, /cannot change Page type identity/);
  assert.equal(mutationAttempt.page.type, 'normalizer-audit');
  assert.deepEqual(mutationAttempt.page.payload, { keep: true });

  const replacementAttempt = vm.runInContext(`
    pageTypesModel.registerPageType({
      id: 'replacement-audit',
      normalizePage: () => ({ type: 'replacement-audit' })
    });
    try {
      pageTypesModel.normalizePageRecord({ type: 'replacement-audit' });
      'no error';
    } catch (error) {
      error.message;
    }
  `, context);
  assert.match(replacementAttempt, /must update the supplied record in place/);
});

test('future Page Types may declare navigation metadata without changing Sidebar authority', () => {
  const context = vm.createContext({ console });
  const publicRoot = path.join(__dirname, '..', 'public');
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'hnListNumbering.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'structuredTextCount.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'hnText.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'structuredTextFrame.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'pageTypes.js'), 'utf8'), context);
  const result = JSON.parse(vm.runInContext(`
    const definition = pageTypesModel.registerPageType({
      id: 'future-text',
      navigationBadge: 'TXT'
    });
    JSON.stringify({
      definitionBadge: definition.navigationBadge,
      resolvedBadge: pageTypesModel.pageTypeNavigationBadge('future-text'),
      missingBadge: pageTypesModel.pageTypeNavigationBadge('future-missing')
    });
  `, context));
  assert.deepEqual(result, {
    definitionBadge: 'TXT',
    resolvedBadge: 'TXT',
    missingBadge: null
  });
});

test('HN source editing has no bundled secondary document runtime', () => {
  const packageJson = require('../package.json');
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const packageName of [
    'prosemirror-commands',
    'prosemirror-history',
    'prosemirror-keymap',
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-view'
  ]) {
    assert.equal(Object.hasOwn(dependencies, packageName), false);
  }
  assert.equal(Object.keys(dependencies).some((name) => name.startsWith('@tiptap/')), false);
  assert.equal(Object.keys(dependencies).some((name) => name.startsWith('lexical')), false);

  const index = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
  const hnPageView = fs.readFileSync(
    path.join(__dirname, '..', 'public/js/hnTextPageView.js'),
    'utf8'
  );
  assert.doesNotMatch(index, /vendor\/hnTextRuntime\.js/);
  assert.match(index, /js\/sourceCanonicalEditor\.js/);
  assert.match(hnPageView, /sourceCanonicalEditor/);
  assert.doesNotMatch(hnPageView, /hnTextRuntime|createEditorView|EditorState|nodeViews/);
});
