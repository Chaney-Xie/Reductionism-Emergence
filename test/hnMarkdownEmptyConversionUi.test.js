const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

async function read(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('empty Markdown/HN menu eligibility remains registry-driven', async () => {
  const app = await read('public/app.js');
  const updater = sliceBetween(
    app,
    'function updatePanePageTypeMenu',
    'function updatePaneToolbarPresentation'
  );
  assert.match(app, /pageTypesModel\.pageTypesForMenu\(\)/);
  assert.match(updater, /pageTypesModel\.conversionEligibility\(page, targetType\)/);
  assert.doesNotMatch(updater, /markdownBody\s*===|cneText\.document|innerText/);
});

test('HN conversion locks and flushes the Page session before the authoritative request', async () => {
  const app = await read('public/app.js');
  const workflow = sliceBetween(app, 'async function convertCurrentPageType', 'async function createNewPage');
  const lockIndex = workflow.indexOf('lockAndFlushHnPageDocumentSessionForConversion(pageId, runtime)');
  const recheckIndex = workflow.indexOf(
    'pageTypesModel.conversionEligibility(latestPage, normalizedTarget)',
    lockIndex
  );
  const requestIndex = workflow.indexOf('request(`${pageApiUrl(pageId)}/type`', recheckIndex);
  const discardIndex = workflow.indexOf('discardHnPageDocumentSessionAfterConversion(pageId)', requestIndex);
  const commitIndex = workflow.indexOf('commitCanonicalPage(savedPage, {', discardIndex);
  const indexRefreshIndex = workflow.indexOf("request('/api/page-index')", commitIndex);
  assert.ok(lockIndex >= 0);
  assert.ok(recheckIndex > lockIndex);
  assert.ok(requestIndex > recheckIndex);
  assert.ok(discardIndex > requestIndex);
  assert.ok(commitIndex > discardIndex);
  assert.ok(indexRefreshIndex > commitIndex);
  assert.match(workflow,
    /try \{[^]*?discardHnPageDocumentSessionAfterConversion\(pageId\);[^]*?\} catch \(error\) \{[^]*?handleHnSessionError\(error, runtime\);[^]*?\}[^]*?commitCanonicalPage\(savedPage, \{[^]*?originRuntime: ownerCurrent \? runtime : null[^]*?\}\)/);
  assert.match(workflow, /unlockHnPageDocumentSessionAfterFailedConversion\(lockedHnSession\)/);
  assert.match(workflow, /markdownBodySaveStates\.delete\(pageId\)/);
  assert.match(workflow, /setMarkdownPageConversionReadOnly\(pageId, true\)/);
  assert.match(workflow, /setMarkdownPageConversionReadOnly\(pageId, false\)/);
  assert.match(workflow, /scheduleHnSessionReferenceReconcile\(\)/);
  assert.equal(
    (workflow.match(/request\(`\$\{pageApiUrl\(pageId\)\}\/type`/g) || []).length,
    1,
    'Every registered conversion uses one direct authoritative request.'
  );
  assert.doesNotMatch(workflow, /type:\s*['"]markdown['"][^]*?type:\s*normalizedTarget/);
});

test('direct Canvas/HN edges reuse the existing menu, HN session, and Pane convergence owners', async () => {
  const [app, markdown] = await Promise.all([
    read('public/app.js'),
    read('public/markdownPage.js')
  ]);
  assert.match(markdown,
    /registerPageTypeConversion\(PAGE_TYPES\.CANVAS, PAGE_TYPES\.HN_TEXT/);
  assert.match(markdown,
    /registerPageTypeConversion\(PAGE_TYPES\.HN_TEXT, PAGE_TYPES\.CANVAS/);
  assert.match(markdown,
    /source === PAGE_TYPES\.CANVAS && target === PAGE_TYPES\.HN_TEXT[^]*?allowed: true/);
  assert.match(markdown,
    /source === PAGE_TYPES\.HN_TEXT && target === PAGE_TYPES\.CANVAS[^]*?emptyHnConversionEligibility\(page\)/);
  assert.match(markdown,
    /function emptyHnConversionEligibility\(page\)[^]*?hnTextPlaceholderIsEmpty\(page\?\.cneText\)/);

  const workflow = sliceBetween(
    app,
    'async function convertCurrentPageType',
    'async function createNewPage'
  );
  assert.match(workflow,
    /currentType === pageTypesModel\.PAGE_TYPES\.HN_TEXT[^]*?lockAndFlushHnPageDocumentSessionForConversion/);
  assert.match(workflow,
    /request\(`\$\{pageApiUrl\(pageId\)\}\/type`[^]*?discardHnPageDocumentSessionAfterConversion/);
  assert.doesNotMatch(
    workflow.slice(0, workflow.indexOf('const savedPage = await request')),
    /acquire.*Hn|renderHnTextPage|createHnPageDocumentSession/i
  );

  const commit = sliceBetween(app, 'function commitCanonicalPage', 'function highlightBlockIds');
  assert.match(commit, /const enteringHnText/);
  assert.match(commit, /for \(const runtime of livingPaneRuntimes\(\)\)/);
  assert.match(commit, /renderPageContent\(runtime, page, \{ fit: false \}\)/);
});

test('Markdown conversion read-only state is applied to every Pane copy through the existing view API', async () => {
  const app = await read('public/app.js');
  const readOnly = sliceBetween(
    app,
    'function setMarkdownPageConversionReadOnly',
    'function applyVaultMarkdownPreferences'
  );
  assert.match(readOnly, /for \(const pane of workspace\.state\.panes\)/);
  assert.match(readOnly, /page\?\.id !== pageId/);
  assert.match(readOnly, /updateMarkdownPageLayer\?\.\(stage, \{[^]*?bodyReadOnly: Boolean\(readOnly\)/);
  assert.doesNotMatch(readOnly, /contentEditable|innerHTML|markdownBody\s*=/);
});

test('type transitions converge inactive and newly active Panes without stale HN authority', async () => {
  const app = await read('public/app.js');
  const commit = sliceBetween(app, 'function commitCanonicalPage', 'function highlightBlockIds');
  const conversion = sliceBetween(app, 'async function convertCurrentPageType', 'async function createNewPage');
  const discard = sliceBetween(
    app,
    'async function discardHnPageDocumentSessionAfterConversion',
    'function showRuntimeStatus'
  );
  assert.match(commit, /enteringHnText/);
  assert.match(commit, /for \(const runtime of livingPaneRuntimes\(\)\)/);
  assert.match(commit, /runtime\.session\.activeTab\(\)\?\.currentPageId !== page\.id\) continue/);
  assert.match(commit, /if \(runtime === originRuntime\) continue/);
  assert.match(
    commit,
    /const structuredTextUpdate = !enteringHnText && \([^]*?pageIsHnText\(page\)[^]*?updateStructuredTextPageLayerForRuntime\(runtime, page\)[^]*?if \(updated\) \{[^]*?continue;/
  );
  assert.match(discard, /retainedHnSessionReferences\.delete\(pageId\)/);
  assert.match(discard, /registry\.discard\(pageId, \{ flush: false \}\)/);
  assert.match(conversion, /const operation = captureRuntimeOperation\(runtime, \{[^]*?scope: 'page-type-conversion'[^]*?pageId/);
  assert.match(conversion,
    /const ownerCurrent = runtimeOperationIsCurrent\(operation\);[^]*?originRuntime: ownerCurrent \? runtime : null/);
  assert.match(conversion,
    /if \(runtimeOperationIsCurrent\(operation\)\) \{[^]*?runtime\.currentPage = canonical;[^]*?renderPage\(runtime, canonical, \{ installCanonical: false \}\)/);
});

test('HN Page session conversion lock is presentation-visible and rejects document writes', async () => {
  const session = await read('public/js/hnPageDocumentSession.js');
  assert.match(session, /conversionLocked: this\.conversionLocked/);
  assert.match(session, /readOnly: Boolean\(this\.conflict\) \|\| this\.conversionLocked/);
  assert.match(session, /setConversionLocked\(locked\)[^]*?this\.publish\('conversion-lock'/);
  assert.match(session,
    /assertMutable\(\)[^]*?this\.conversionLocked[^]*?HN_SESSION_CONVERSION_LOCKED/);
  assert.match(session,
    /applySourceTransaction\(viewId, transactionValue, options = \{\}\)[^]*?this\.assertMutable\(\)/);
});
