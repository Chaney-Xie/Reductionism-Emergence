const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('Page Type controls derive options and conversion items from the shared registry', async () => {
  const [index, app, settings] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('public/js/vaultSettings.js')
  ]);

  assert.ok(index.indexOf('pageTypes.js') < index.indexOf('markdownPage.js'));
  const select = index.match(
    /<select\b[^>]*\bid="vault-default-page-type"[^>]*>[\s\S]*?<\/select>/
  )?.[0] || '';
  assert.match(select, /vault-default-page-type/);
  assert.doesNotMatch(select, /<option\b/);
  assert.match(settings, /pageTypesModel\.vaultDefaultPageTypes\(\)/);

  const toolbarFactory = app.slice(
    app.indexOf('function createPaneToolbarRegion'),
    app.indexOf('function ensurePaneToolbarRegion')
  );
  assert.match(toolbarFactory, /pageTypesModel\.pageTypesForMenu\(\)/);
  assert.match(toolbarFactory, /item\.dataset\.pageType = id/);
  assert.doesNotMatch(toolbarFactory, /\[['"]page-type-canvas|\[['"]page-type-markdown/);

  const menuUpdater = app.slice(
    app.indexOf('function updatePanePageTypeMenu'),
    app.indexOf('function updatePaneToolbarPresentation')
  );
  assert.match(menuUpdater, /pageTypeMenuItems/);
  assert.match(menuUpdater, /pageTypesModel\.conversionEligibility\(page, targetType\)/);
  assert.doesNotMatch(menuUpdater, /pageTypeCanvasMenuItem|pageTypeMarkdownMenuItem/);
});

test('left-navigation Page Type badges derive from the registry and invalidate on default change', async () => {
  const [pageTypes, markdown, navigation, app, styles] = await Promise.all([
    read('public/pageTypes.js'),
    read('public/markdownPage.js'),
    read('public/js/navigation.js'),
    read('public/app.js'),
    read('public/styles.css')
  ]);

  assert.match(pageTypes, /navigationBadge: 'CANVAS'/);
  assert.match(markdown, /navigationBadge: 'MD'/);
  assert.match(pageTypes, /navigationBadge: 'HN'/);
  assert.match(pageTypes, /function pageTypeNavigationBadge\(value\)/);

  const badgePolicy = navigation.slice(
    navigation.indexOf('function navigationPageTypeBadge'),
    navigation.indexOf('function createPageListButton')
  );
  assert.match(badgePolicy, /Object\.hasOwn\(page, 'type'\)/);
  assert.match(badgePolicy, /pageTypesModel\.LEGACY_DEFAULT_PAGE_TYPE/);
  assert.match(badgePolicy, /pageTypesModel\.normalizeVaultDefaultPageType/);
  assert.match(badgePolicy, /pageTypesModel\.pageTypeNavigationBadge\(pageType\)/);
  assert.match(badgePolicy, /function syncNavigationPageTypeBadge\(row, page\)/);
  assert.match(badgePolicy, /badge\.className = 'nav-page-type-badge system-typography'/);
  assert.match(badgePolicy, /if \(!existing\) row\.append\(badge\)/);
  assert.doesNotMatch(badgePolicy, /CANVAS|\bMD\b|\bCNE\b/);

  const rowFactory = navigation.slice(
    navigation.indexOf('function createPageListButton'),
    navigation.indexOf('function renderFolderLabel')
  );
  assert.match(rowFactory, /nav-page-status-indicator[^]*?nav-page-label-text[^]*?syncNavigationPageTypeBadge\(button, page\)/);
  assert.doesNotMatch(rowFactory, /badge\.addEventListener/);

  const preferenceApply = app.slice(
    app.indexOf('function applyVaultMarkdownPreferences'),
    app.indexOf('function queueVaultMarkdownPreferenceIntent')
  );
  assert.match(preferenceApply, /previousDefaultPageType/);
  assert.match(preferenceApply, /defaultPageType !== previousDefaultPageType/);
  assert.match(preferenceApply, /renderPageList\(\{ force: true \}\)/);

  const badgeStyles = styles.match(/\.nav-page-type-badge \{[^}]*\}/)?.[0] || '';
  assert.match(badgeStyles, /flex: 0 0 auto/);
  assert.match(badgeStyles, /font-family: var\(--font-system-family\)/);
  assert.match(badgeStyles, /font-size: calc\(var\(--font-file-size\) - 4px\)/);
  assert.match(badgeStyles, /font-weight: 650/);
  assert.match(badgeStyles, /color: #ADADAD/);
  assert.match(badgeStyles, /white-space: nowrap/);
  assert.match(badgeStyles, /pointer-events: none/);
  assert.doesNotMatch(badgeStyles, /background|border|border-radius/);
});

test('HN has an explicit non-Canvas surface and unknown Pages have no fallback renderer', async () => {
  const [app, canvasBlocks] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js')
  ]);
  const rendererRegistry = app.slice(
    app.indexOf('const pageRendererAdapters'),
    app.indexOf('function pageRendererAdapter')
  );
  for (const rendererId of ['canvas', 'markdown', 'cne-text']) {
    assert.match(rendererRegistry, new RegExp(`['"]${rendererId}['"]`));
  }
  assert.doesNotMatch(rendererRegistry, /['"]unsupported['"]/);
  const rendererSelector = app.slice(
    app.indexOf('function pageRendererAdapter'),
    app.indexOf('function renderPageContent')
  );
  assert.match(rendererSelector, /pageTypesModel\.pageTypeRendererId\(page\?\.type\)/);
  assert.match(rendererSelector, /throw new Error\(`Unsupported Page Type/);
  assert.doesNotMatch(rendererSelector, /pageRendererAdapters\.get\(['"]canvas['"]\)/);

  const hnRenderer = app.slice(
    app.indexOf('function renderHnTextPageContent'),
    app.indexOf('const pageRendererAdapters')
  );
  assert.match(hnRenderer, /resetPageTypePlaceholderSurface\(runtime\)/);
  assert.match(hnRenderer, /renderCanvas\(runtime, page\.objects \|\| \[\], page\.blocks \|\| \[\], \{ fit \}\)/);
  assert.doesNotMatch(hnRenderer, /renderPageTypePlaceholder|Editing is not implemented yet/);

  const previewRegistry = app.slice(
    app.indexOf('const tabPagePreviewRenderers'),
    app.indexOf('function tabPagePreviewRenderer')
  );
  for (const rendererId of ['canvas', 'markdown', 'cne-text']) {
    assert.match(previewRegistry, new RegExp(`['"]${rendererId}['"]`));
  }
  assert.doesNotMatch(previewRegistry, /['"]unsupported['"]/);
  assert.doesNotMatch(previewRegistry, /image-canvas/);

  for (const [start, end, capability] of [
    ['function updateEditAvailability', 'function syncMarkdownDraftToOtherPanes', 'canvas'],
    ['function updatePaneToolbarPresentation', 'function renderPaneToolbarCollection', 'page-edit'],
    ['async function addFilesToCurrentPage', 'function droppedFiles', 'file-import'],
    ['function bindImportDropTarget', 'async function toggleResourceVisibility', 'file-import']
  ]) {
    const implementation = app.slice(app.indexOf(start), app.indexOf(end));
    assert.match(implementation, new RegExp(`pageTypesModel\\.pageTypeSupports[\\s\\S]*?['"]${capability}['"]`));
  }

  const pageEditAvailability = app.match(
    /const pageEditType =[^]*?visibleObjectCount < 2/g
  ) || [];
  assert.equal(pageEditAvailability.length, 2);
  for (const guard of pageEditAvailability) {
    assert.match(guard, /pageEditType === pageTypesModel\.PAGE_TYPES\.CANVAS/);
    assert.match(guard, /pageEditType === pageTypesModel\.PAGE_TYPES\.MARKDOWN/);
    assert.match(guard, /!hasPageEditImplementation/);
  }
  assert.doesNotMatch(
    app,
    /pageTypesModel\.normalizePageType\([^)]*?type\)\s*!==\s*pageTypesModel\.PAGE_TYPES\.MARKDOWN/
  );
  assert.match(
    canvasBlocks,
    /const editsCanvasObjects = pageTypesModel\.normalizePageType\(runtime\.currentPage\?\.type\)[^]*?PAGE_TYPES\.CANVAS/
  );
  assert.match(
    canvasBlocks,
    /const editsStructuredTextFrame = \(typeof pageIsMarkdown[^]*?typeof pageIsHnText/
  );
  assert.match(canvasBlocks, /!editsStructuredTextFrame && !editsCanvasObjects/);
  assert.match(canvasBlocks, /editsCanvasObjects && visualObjects\.length < 2/);
});
