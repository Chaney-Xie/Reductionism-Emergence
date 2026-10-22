const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('HN Text loads its source-canonical editor without a second body runtime or IPC', async () => {
  const [index, packageJson, forge, preload, main] = await Promise.all([
    read('public/index.html'),
    read('package.json'),
    read('forge.config.js'),
    read('desktop/preload.js'),
    read('desktop/main.js')
  ]);
  const scripts = [...index.matchAll(/<script\s+src="([^"]+)"/g)]
    .map((match) => match[1].split('?')[0]);
  const expectedOrder = [
    'hnListNumbering.js',
    'structuredTextCount.js',
    'hnText.js',
    'pageTypes.js',
    'markdownPage.js',
    'hnStructureIndex.js',
    'hnListIndex.js',
    'hnListCommands.js',
    'js/hnPageDocumentSession.js',
    'js/structuredTextPageShell.js',
    'app.js',
    'js/canvasBlocks.js',
    'js/sourceCanonicalEditor.js',
    'js/hnTextPageView.js',
    'js/appBootstrap.js'
  ];
  let previous = -1;
  for (const source of expectedOrder) {
    const position = scripts.indexOf(source);
    assert.ok(position > previous, `${source} must load after its HN dependencies`);
    previous = position;
  }
  for (const source of scripts) {
    assert.doesNotMatch(source, /^(?:https?:)?\/\//i, `renderer script must be local: ${source}`);
  }
  assert.equal(scripts.includes('vendor/hnTextRuntime.js'), false);

  const manifest = JSON.parse(packageJson);
  for (const dependency of [
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-view',
    'prosemirror-history',
    'prosemirror-commands',
    'prosemirror-keymap'
  ]) {
    assert.equal(Object.hasOwn(manifest.dependencies, dependency), false);
  }
  assert.equal(Object.hasOwn(manifest.scripts, 'build:cne-text-runtime'), false);
  assert.equal(manifest.scripts['build:runtimes'], 'npm run build:markdown-runtime');
  assert.doesNotMatch(forge, /hnTextRuntime|buildHnTextRuntime|generateAssets/);
  for (const retiredPath of [
    'scripts/buildHnTextRuntime.cjs',
    'build/hnTextRuntime.entry.mjs',
    'public/vendor/hnTextRuntime.js'
  ]) {
    await assert.rejects(
      fs.access(path.join(projectRoot, retiredPath)),
      (error) => error?.code === 'ENOENT',
      `${retiredPath} must stay retired`
    );
  }
  assert.doesNotMatch(preload, /prosemirror|cneText|cne-text/i);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
});

test('HN has an explicit editor renderer while Canvas and Markdown adapters remain distinct', async () => {
  const [app, canvas] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js')
  ]);
  const registry = sliceBetween(
    app,
    'const pageRendererAdapters = new Map',
    'function pageRendererAdapter'
  );
  const entries = Object.fromEntries([...registry.matchAll(
    /\[\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\]/g
  )].map((match) => [match[1], match[2]]));
  assert.deepEqual(entries, {
    canvas: 'renderCanvasPageContent',
    markdown: 'renderMarkdownPageContent',
    'cne-text': 'renderHnTextPageContent'
  });
  assert.notEqual(entries['cne-text'], entries.canvas);
  assert.notEqual(entries['cne-text'], entries.markdown);
  assert.doesNotMatch(registry, /cne-placeholder|unsupported/);

  const hnRenderer = sliceBetween(
    app,
    'function renderHnTextPageContent',
    'const pageRendererAdapters'
  );
  assert.match(hnRenderer, /resetPageTypePlaceholderSurface\(runtime\)/);
  assert.match(hnRenderer, /renderCanvas\(runtime, page\.objects \|\| \[\], page\.blocks \|\| \[\], \{ fit \}\)/);
  assert.doesNotMatch(hnRenderer, /renderPageTypePlaceholder/);

  assert.match(canvas, /const rendersHnText =[^]*?pageIsHnText\(runtime\.currentPage\)/);
  assert.match(canvas, /const rendersStructuredText = rendersMarkdown \|\| rendersHnText/);
  assert.match(canvas, /getHnPageDocumentSession\(runtime\.currentPage, runtime, ownerTab\)/);
  assert.match(canvas, /const page = runtime\.pageEditMode && runtime\.draftPageTextFrame[^]*?renderHnTextPageLayer\(\{[^]*?page,[^]*?session,/);
});

test('supported legacy CNE migration immediately replaces the runtime Page projection only', async () => {
  const app = await read('public/app.js');
  const acquisition = sliceBetween(
    app,
    'function getHnPageDocumentSession(page, runtime, tab)',
    'function desiredHnSessionReferences()'
  );
  assert.match(acquisition, /const sessionEnvelope = session\.currentEnvelope\?\.\(\)/);
  assert.match(acquisition, /!hnTextModel\.validateCurrentEnvelope\(page\.cneText\)\.ok/);
  assert.match(acquisition, /hnTextModel\.validateCurrentEnvelope\(sessionEnvelope\)\.ok/);
  assert.match(acquisition, /updateCanonicalHnTextEnvelope\(page\.id, sessionEnvelope\)/);
  assert.doesNotMatch(acquisition, /request\(|saveHnTextRevision|flush\(/,
    'in-memory migration projection must not eagerly persist the legacy Page');
});

test('HN exposes Edit and Browser with the shared Count presentation and Page zoom', async () => {
  const [index, app, canvas, pageView, styles, bootstrap] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/hnTextPageView.js'),
    read('public/styles.css'),
    read('public/js/appBootstrap.js')
  ]);
  const strip = index.match(
    /<div\s+id="hn-text-control-strip"[\s\S]*?<\/div>/
  )?.[0] || '';
  assert.doesNotMatch(strip, /cne-text-strip-label|cne-text-statistics|cne-text-character-count/);
  assert.doesNotMatch(strip, />HN Text<|>HN<|>字</);
  assert.match(strip, /aria-label="Page status and zoom controls"/);
  assert.match(strip, /id="hn-text-mode-button"/);
  assert.match(strip, /aria-label="Change HN Text mode"/);
  assert.match(strip, /id="hn-text-mode-value">Edit<\/span>/);
  for (const control of ['zoom-out', 'zoom-value', 'zoom-in']) {
    assert.match(strip, new RegExp(`id="hn-text-${control}"`));
  }
  assert.doesNotMatch(strip, /source|live preview|reading/i);
  assert.equal((index.match(/id="markdown-statistics"/g) || []).length, 1,
    'one physical Count presentation is shared between Page Types');
  assert.match(index, /id="markdown-statistics"[^>]*data-structured-text-count/);
  assert.match(index, /data-count-field="words"[^]*?data-count-field="characters"[^]*?data-count-field="paragraphs"/);
  assert.match(index, /structuredTextCount\.js\?v=shared-count-status-v01/);

  assert.match(app, /createCountPresentation\?\.\(markdownStatistics\)/);
  const renderer = sliceBetween(
    app,
    'function renderSharedCountPresentation',
    'function refreshMarkdownControlStrip'
  );
  assert.match(renderer, /querySelector\('\.markdown-zoom-controls'\)/);
  assert.match(renderer, /sharedCountPresentation\.mount\(controlStrip, zoomControls\)/);
  assert.match(renderer, /sharedCountPresentation\.update\(statistics\)/);

  const refresh = sliceBetween(
    app,
    'function refreshHnTextControlStrip',
    'function refreshAllMarkdownPaneViews'
  );
  assert.match(refresh, /pageIsHnText\(runtime\.currentPage\)/);
  assert.match(refresh, /snapshot\?\.pageId === runtime\.currentPage\.id && typeof snapshot\.source === 'string'/);
  assert.match(refresh, /hnTextModeValue\.textContent = hnTextModeLabel\(vaultPreferences\.cneTextMode\)/);
  assert.match(refresh, /globalThis\.hnTextModel\?\.statistics\?\.\(presentationSource\)/);
  assert.match(refresh, /renderSharedCountPresentation\(\s*hnTextControlStrip,/);
  assert.match(refresh, /hnTextZoomValueButton\.textContent = `\$\{Math\.round\(runtime\.canvasView\.scale \* 100\)\}%`/);
  assert.match(app, /function hnTextModeLabel[^]*?HN_TEXT_MODES\.BROWSER[^]*?'Browser' : 'Edit'/);
  assert.match(app, /function cycleVaultHnTextMode[^]*?HN_TEXT_MODES\.EDIT[^]*?HN_TEXT_MODES\.BROWSER/);
  assert.match(canvas, /onDocumentState: \(snapshot\) => \{[^]*?runtime === activePaneRuntime\(\)[^]*?refreshHnTextControlStrip\(runtime, snapshot\)/);
  assert.match(canvas, /mode: hnTextModel\.normalizeHnTextMode\(vaultPreferences\.cneTextMode\)/);
  assert.doesNotMatch(`${app}\n${canvas}\n${pageView}`,
    /onCharacterCountChange|characterCountForPage|hnTextCharacterCount/);
  assert.doesNotMatch(styles, /\.cne-text-statistics|\.cne-text-strip-label/);
  assert.match(bootstrap, /hnTextModeButton\?\.addEventListener\('click', cycleVaultHnTextMode\)/);
  assert.match(bootstrap, /hnTextZoomOutButton\?\.addEventListener\('click', \(\) => \{[^]*?const runtime = activePaneRuntime\(\);[^]*?zoomActiveHnTextBy\(runtime, 0\.9\)/);
  assert.match(bootstrap, /hnTextZoomValueButton\?\.addEventListener\('click', \(\) => \{[^]*?const runtime = activePaneRuntime\(\);[^]*?resetActiveHnTextZoom\(runtime\)/);
  assert.match(bootstrap, /hnTextZoomInButton\?\.addEventListener\('click', \(\) => \{[^]*?const runtime = activePaneRuntime\(\);[^]*?zoomActiveHnTextBy\(runtime, 1\.1\)/);

  const hnTextModel = require('../public/hnText');
  const document = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      attrs: { id: 'ui-count-block' },
      content: [{ type: 'text', text: '你 A e\u0301 👨‍👩‍👧‍👦\n\t' }]
    }]
  };
  assert.deepEqual(hnTextModel.statistics(document), {
    words: 3,
    paragraphs: 1,
    characters: 11
  });
});

test('one Page-scoped session is retained by Tabs, reconciled on close, and flushed with workspace state', async () => {
  const [app, workspaceState, sessionSource] = await Promise.all([
    read('public/app.js'),
    read('public/js/workspaceState.js'),
    read('public/js/hnPageDocumentSession.js')
  ]);
  assert.match(app, /let hnPageDocumentSessionRegistry = null/);
  const registryFactory = sliceBetween(app, 'function hnSessionRegistry', 'function hnTabReferenceId');
  assert.match(registryFactory, /if \(!hnPageDocumentSessionRegistry\)/);
  assert.match(registryFactory, /createHnPageDocumentSessionRegistry\(\{/);
  const acquisition = sliceBetween(
    app,
    'function getHnPageDocumentSession',
    'function desiredHnSessionReferences'
  );
  assert.match(acquisition, /hnSessionRegistry\(\)\.acquire\(page\.id, page\.cneText, \{ referenceId \}\)/);
  const reconciliation = sliceBetween(
    app,
    'function desiredHnSessionReferences',
    'function showRuntimeStatus'
  );
  assert.match(reconciliation, /for \(const pane of workspace\.state\.panes\)/);
  assert.match(reconciliation, /for \(const tab of pane\.session\.tabs\(\)\)/);
  assert.match(reconciliation, /hnPageDocumentSessionRegistry\.release\(pageId, referenceId\)/);
  assert.match(reconciliation, /flushAll\?\.\(\)/);
  assert.match(workspaceState, /flushHnPageDocumentSessionsNow[^]*?'HN Text'/);
  assert.match(app, /function closeTab[^]*?scheduleHnSessionReferenceReconcile\(\)/);

  assert.match(sessionSource, /this\.source = migration\.ok \? migratedEnvelope\.source : null/);
  assert.match(sessionSource, /this\.subscribers = new Map\(\)/);
  assert.match(sessionSource, /applySourceTransaction\(viewId, transactionValue, options = \{\}\)/);
  assert.match(sessionSource, /record\.updateState\(snapshot, metadata\)/);
  assert.match(sessionSource, /this\.undoStack = \[\]/);
  assert.match(sessionSource, /class HnPageDocumentSessionRegistry[^]*?this\.sessions = new Map\(\)/);

  const hnTextModel = require('../public/hnText');
  const { createHnPageDocumentSessionRegistry } = require('../public/js/hnPageDocumentSession');
  let revision = 0;
  const saves = [];
  const sessionRegistry = createHnPageDocumentSessionRegistry({
    saveDelayMs: 60_000,
    save: async (payload) => {
      saves.push(structuredClone(payload));
      revision += 1;
      return { revision };
    }
  });
  const envelope = hnTextModel.createEmptyEnvelope();
  const first = sessionRegistry.acquire('ui-page', envelope, { referenceId: 'pane-a:tab-a' });
  const same = sessionRegistry.acquire('ui-page', envelope, { referenceId: 'pane-b:tab-b' });
  assert.equal(same, first);
  const updates = [[], []];
  first.subscribe('pane-a', { updateState: (snapshot) => updates[0].push(snapshot) });
  first.subscribe('pane-b', { updateState: (snapshot) => updates[1].push(snapshot) });
  first.setFocusedView('pane-a');
  first.applySourceTransaction('pane-a', { from: 0, to: 0, insert: 'shared' }, {
    sourceVersion: 0
  });
  assert.equal(updates[0].at(-1).source, 'shared');
  assert.equal(updates[1].at(-1).source, 'shared');
  assert.deepEqual(first.historyDepth, { undo: 1, redo: 0 });
  assert.equal(await sessionRegistry.release('ui-page', 'pane-a:tab-a'), false);
  assert.equal(await sessionRegistry.release('ui-page', 'pane-b:tab-b'), true);
  assert.equal(first.disposed, true);
  assert.equal(saves.length, 1);
  const fresh = sessionRegistry.acquire('ui-page', {
    ...saves[0].cneText,
    revision: 1
  }, { referenceId: 'pane-a:tab-c' });
  assert.notEqual(fresh, first);
  assert.deepEqual(fresh.historyDepth, { undo: 0, redo: 0 });
  await sessionRegistry.release('ui-page', 'pane-a:tab-c');
});

test('HN source reconciliation updates stable source controllers without canonical Page rerenders', async () => {
  const [app, canvas, view] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/hnTextPageView.js')
  ]);
  const documentChange = sliceBetween(
    app,
    'function handleHnSessionDocumentChange',
    'function handleHnSessionPersisted'
  );
  assert.match(documentChange, /updateCanonicalHnTextEnvelope\(pageId, cneText\)/);
  assert.doesNotMatch(documentChange, /commitCanonicalPage|renderCanvas|renderPageIntoInactivePane/);

  const canonicalCommit = sliceBetween(app, 'function commitCanonicalPage', 'function highlightBlockIds');
  assert.match(canonicalCommit,
    /const structuredTextUpdate = !enteringHnText[^]*?pageIsHnText\(page\)[^]*?updateStructuredTextPageLayerForRuntime\(runtime, page\)[^]*?continue;/);
  const renderer = sliceBetween(view, 'function renderHnTextPageLayer', 'function resolve');
  assert.match(renderer, /let state = stageStates\.get\(options\.stage\)/);
  assert.match(renderer, /if \(state\) \{[^]*?return state\.layer/);
  assert.match(renderer, /state\.controller = sourceEditor\.createSourceCanonicalEditor\(/);
  assert.match(renderer, /state\.controller\.refresh\(\)/);
  assert.doesNotMatch(view, /createEditorView|updateState\(nextState\)/);
  assert.match(view, /dataset\.hnMountId = mountId/);
  assert.match(canvas, /if \(!rendersHnText && typeof destroyHnTextPageLayer === 'function'\)/);
});

test('HN empty-source conversion stays registry-owned and does not reuse Markdown editor architecture', async () => {
  const [view, session, shell, pageTypesSource, markdownSource] = await Promise.all([
    read('public/js/hnTextPageView.js'),
    read('public/js/hnPageDocumentSession.js'),
    read('public/js/structuredTextPageShell.js'),
    read('public/pageTypes.js'),
    read('public/markdownPage.js')
  ]);
  const hnImplementation = `${view}\n${session}\n${shell}`;
  assert.doesNotMatch(
    hnImplementation,
    /markdownPageView|markdownEditable|markdown-source|MARKDOWN_MODES|Live Preview|Reading Mode|Source Mode/
  );
  assert.match(view, /sourceEditor\.createSourceCanonicalEditor\(/);
  assert.match(session, /applySourceTransaction\(viewId, transactionValue, options = \{\}\)/);
  assert.doesNotMatch(hnImplementation, /hnTextRuntime|createEditorView|EditorState|nodeViews/);
  assert.match(shell, /root\.structuredTextPageShell = Object\.freeze/);
  assert.doesNotMatch(view, /createLiveEditor|renderMarkdown/);

  assert.match(markdownSource,
    /registerPageTypeConversion\(PAGE_TYPES\.MARKDOWN, PAGE_TYPES\.HN_TEXT/);
  assert.match(markdownSource,
    /registerPageTypeConversion\(PAGE_TYPES\.HN_TEXT, PAGE_TYPES\.MARKDOWN/);
  assert.match(markdownSource,
    /registerPageTypeConversion\(PAGE_TYPES\.CANVAS, PAGE_TYPES\.HN_TEXT/);
  assert.match(markdownSource,
    /registerPageTypeConversion\(PAGE_TYPES\.HN_TEXT, PAGE_TYPES\.CANVAS/);
  assert.match(pageTypesSource, /hnTextPlaceholderIsEmpty/);

  const pageTypesModel = require('../public/pageTypes');
  require('../public/markdownPage');
  const { PAGE_TYPES } = pageTypesModel;
  const hnPage = {
    id: 'cne-no-conversion',
    type: PAGE_TYPES.HN_TEXT,
    cneText: pageTypesModel.createHnTextPlaceholder()
  };
  assert.equal(pageTypesModel.conversionEligibility(hnPage, PAGE_TYPES.CANVAS).allowed, true);
  assert.equal(pageTypesModel.conversionEligibility(hnPage, PAGE_TYPES.MARKDOWN).allowed, true);
  assert.deepEqual(
    pageTypesModel.conversionTargetPageTypes(hnPage).map(({ id }) => id),
    [PAGE_TYPES.CANVAS, PAGE_TYPES.MARKDOWN, PAGE_TYPES.HN_TEXT]
  );
  assert.equal(pageTypesModel.conversionEligibility(
    { type: PAGE_TYPES.CANVAS, objects: [], blocks: [] },
    PAGE_TYPES.HN_TEXT
  ).allowed, true);
  assert.equal(pageTypesModel.conversionEligibility(
    { type: PAGE_TYPES.MARKDOWN, markdownBody: '', textFrame: { preferredWidth: 760 } },
    PAGE_TYPES.HN_TEXT
  ).allowed, true);
  assert.equal(pageTypesModel.conversionEligibility(
    { type: PAGE_TYPES.MARKDOWN, markdownBody: ' ', textFrame: { preferredWidth: 760 } },
    PAGE_TYPES.HN_TEXT
  ).allowed, false);
  const nonemptyHnPage = {
    ...hnPage,
    cneText: {
      ...hnPage.cneText,
      source: 'content'
    }
  };
  assert.equal(
    pageTypesModel.conversionEligibility(nonemptyHnPage, PAGE_TYPES.MARKDOWN).allowed,
    false
  );
  assert.equal(
    pageTypesModel.conversionEligibility(nonemptyHnPage, PAGE_TYPES.CANVAS).allowed,
    false
  );
});
