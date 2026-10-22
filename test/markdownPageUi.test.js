const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const pageObjectsModel = require('../public/pageObjects');
const { createPaneRuntimeHarness } = require('./helpers/paneRuntimeHarness');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('Markdown Page renderer is Pane-scoped and participates in the shared Canvas world', async () => {
  const [app, canvas, view, shell, styles, index] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/markdownPageView.js'),
    read('public/js/structuredTextPageShell.js'),
    read('public/styles.css'),
    read('public/index.html')
  ]);

  assert.match(index, /markdownPage\.js[^]*?app\.js[^]*?canvasBlocks\.js[^]*?markdownPageView\.js[^]*?appBootstrap\.js/);
  assert.match(canvas, /const rendersMarkdown =[^]*?pageIsMarkdown\(runtime\.currentPage\)/);
  assert.match(canvas, /const rendersStructuredText = rendersMarkdown \|\| rendersHnText/);
  assert.match(canvas, /canvasStage\.hidden = runtime\.canvasObjects\.length === 0/);
  assert.match(canvas, /emptyCanvas\.hidden = runtime\.canvasObjects\.length > 0 \|\| rendersStructuredText/);
  assert.match(canvas, /renderMarkdownPageLayer\(\{[^]*?page,[^]*?stage: canvasStage,[^]*?area: canvasArea,[^]*?paneId: runtime\.paneId,[^]*?mode: vaultPreferences\.lastMarkdownMode/);
  assert.match(canvas, /const markdownBounds = getMarkdownDocumentBounds\(canvasStage\)[^]*?Math\.min\(runtime\.canvasBounds\.minX, markdownBounds\.left\)[^]*?Math\.max\(runtime\.canvasBounds\.maxY, markdownBounds\.bottom\)/);
  assert.match(canvas, /if \(fit && rendersStructuredText\) \{\s*fitStructuredTextCameraToFrame\(runtime\.currentPage\.textFrame, canvasArea, runtime\.canvasView\);\s*applyCanvasTransform\(runtime\);/);
  assert.match(canvas, /function pageWorldIsRenderable\(runtime\)[^]*?runtime\.canvasObjects\.length > 0[^]*?pageIsMarkdown\(runtime\.currentPage\)[^]*?pageIsHnText\(runtime\.currentPage\)/);
  assert.match(canvas, /const mostlyVertical = \(markdownTarget \|\| hnTextTarget\)[^]*?runtime\.canvasView\.offsetX -= \(mostlyVertical \? 0 : event\.deltaX\)[^]*?runtime\.canvasView\.offsetY -= event\.deltaY/);

  assert.doesNotMatch(view, /constrainMarkdownFrameToViewport|renderedWidth|frameOffsetX|frameConstraintSide/);
  assert.doesNotMatch(shell, /constrainFrameToViewport|renderedWidth|frameConstraintSide|VIEWPORT_INSET/);
  assert.match(view, /function createTitle\(state\)[^]*?state\.page\?\.title[^]*?data-markdown-role|function createTitle\(state\)[^]*?dataset\.markdownRole = 'title'/);
  assert.match(view, /function createFrameBoundary\(state\)[^]*?structuredTextShell\.createFrameBoundary/);
  assert.match(shell, /function createFrameBoundary\(options = \{\}\)[^]*?\['left', 'right'\]/);
  assert.match(view, /markdown-page-document-extent/);
  assert.match(shell, /function beginFrameBoundaryDrag\(editor, side, event, handle\)[^]*?frameModel\.beginBoundaryDrag[^]*?frameModel\.updateBoundaryDrag/);
  assert.match(view, /state\.layer\.append\(documentSurface\);\s*state\.layer\.append\(createFrameBoundary\(state\)\)/);
  assert.match(view, /frameEditor: \{[^]*?getFrame: \(\) => state\.textFrame[^]*?getZoom: \(\) => state\.zoom[^]*?onInput:[^]*?onCommit:/);
  assert.match(view, /function renderSemanticDocumentBlocks\(state, bodyRoot\)[^]*?renderSemanticBlockContents\(state, blockState\)/);
  assert.match(view, /function renderSemanticBlockContents\(state, blockState\)[^]*?appendAstNode\([^]*?node,[^]*?source,[^]*?state,[^]*?state\.markdownSyntaxContext/);
  assert.match(view, /function updateLiveMarkerVisibility\(state\)[^]*?editableActiveStateForSelection[^]*?installEditableActiveState[^]*?refreshEditableProjection/);
  assert.match(view, /function updateSemanticEditorMode\(state\)[^]*?state\.bodyRoot\.contentEditable = editable \? 'true' : 'false'/);
  assert.match(view, /function appendAstMath\(parent, node, source, display, state = null\)[^]*?appendSemanticMath\(/);
  assert.match(view, /node\.type === 'break'[^]*?markdown-hard-break-marker[^]*?markdownSourceBreak = 'true'/);
  assert.doesNotMatch(view, /createSourceEditor|createLiveEditor|markdown-page-source-editor|markdown-page-live-editor/);
  assert.match(view, /function createMarkdownPresentationHost\(stage, area\)[^]*?cameraLayer\.append\(worldLayer\);[^]*?area\.append\(cameraLayer\)/);
  assert.match(view, /state\.worldLayer\.append\(extentElement, layer\)/);
  assert.match(styles, /\.markdown-page-camera-layer \{[^}]*position: absolute;[^}]*z-index: 5;[^}]*transform-origin: 0 0;[^}]*pointer-events: none/);
  assert.match(styles, /\.markdown-page-world-layer \{[^}]*position: absolute;[^}]*zoom: 1;[^}]*pointer-events: none/);
  const markdownLayerRule = styles.match(/\.markdown-page-layer\s*\{[^}]*\}/)?.[0] || '';
  assert.match(markdownLayerRule, /position: absolute;[^]*top: 0;/);
  assert.doesNotMatch(markdownLayerRule, /transform:/);
  assert.match(styles, /--markdown-text-frame-padding-inline: 2\.5rem/);
  assert.match(styles, /\.markdown-page-layer::before \{[^}]*inset: 0;[^}]*background: var\(--surface-canvas\);[^}]*pointer-events: none/);
  assert.match(styles, /\.markdown-page-document \{[^}]*width: 100%;[^}]*padding: 2\.75rem var\(--markdown-text-frame-padding-inline\) 8rem;[^}]*background: transparent/);
  const extentRule = styles.match(/\.markdown-page-document-extent\s*\{[^}]*\}/)?.[0] || '';
  assert.match(extentRule, /border: 0/);
  assert.doesNotMatch(extentRule, /border-(?:top|bottom):/);
  assert.match(extentRule, /pointer-events: none/);
  assert.doesNotMatch(extentRule, /border-(?:right|left):/);
  assert.match(styles, /\.markdown-page-frame-boundary \{[^}]*height: 100%;[^}]*border-right: 1px solid var\(--border-canvas\);[^}]*border-left: 1px solid var\(--border-canvas\);[^}]*pointer-events: none/);
  assert.doesNotMatch(
    styles.match(/\.markdown-page-frame-boundary\s*\{[^}]*\}/)?.[0] || '',
    /border-(?:top|bottom):/
  );
  assert.match(view, /function calculateMarkdownVisualFrameExtent\(options = \{\}\)[^]*?structuredTextShell\.calculateVisualFrameExtent/);
  assert.match(shell, /function calculateVisualFrameExtent\(options = \{\}\)[^]*?\(viewportHeight - cameraOffsetY\) \/ scale[^]*?Math\.max\(documentBottom, viewportWorldBottom\)/);
  assert.match(view, /function updateMarkdownVisualFrameExtent\(state,[^]*?state\.frameBoundary\.style\.height = `\$\{visual\.height\}px`/);
  assert.match(view, /function applyMarkdownPresentationGeometry\(state\)[^]*?updateMarkdownVisualFrameExtent\(state\)/);
  assert.match(view, /function createFrameBoundary\(state\)[^]*?state\.frameBoundary = boundary/);
  assert.match(view, /function updateDocumentExtent\(state,[^]*?state\.layer\.style\.height = `\$\{next\.height\}px`/);
  assert.match(view, /function updateDocumentExtent\(state,[^]*?updateMarkdownVisualFrameExtent\(state, next\)/);
  assert.match(styles, /\.markdown-page-frame-handle \{[^}]*pointer-events: none/);
  assert.match(styles, /\.markdown-page-layer\.is-page-edit-mode \.markdown-page-frame-handle \{[^}]*pointer-events: auto/);
  assert.match(styles, /\.markdown-page-layer \{[^}]*font-family: var\(--font-page-family\)/);
  assert.match(styles, /\.markdown-page-layer\.is-live-preview\s+\.markdown-editable-projected-leaf\[data-visibility="activatable"\],[^]*?\[data-visibility="source-only"\] \{\s*display: none;/);
  assert.match(styles, /\.markdown-page-inline-code \{[^}]*font-family: var\(--font-page-family\)/);
  assert.match(styles, /\.markdown-page-code-block \{[^}]*font-family: ui-monospace/);

  assert.match(app, /function syncMarkdownDraftToOtherPanes\(pageId, ownerRuntime\)[^]*?for \(const runtime of livingPaneRuntimes\(\)\)[^]*?updateStructuredTextPageLayerForRuntime\(runtime, page\)[^]*?renderPageContent\(runtime, page, \{ fit: false \}\)/);
  assert.match(app, /function updateMarkdownBodyFromView\(runtime,[^]*?canonicalPages\.set\(pageId, next\)[^]*?syncMarkdownDraftToOtherPanes\(pageId, runtime\)/);
});

test('Markdown modes share one semantic document and vary only marker visibility and editability', async () => {
  const [view, styles] = await Promise.all([
    read('public/js/markdownPageView.js'),
    read('public/styles.css')
  ]);

  assert.match(view, /function appendSourceMarker\([^]*?markdown-source-marker[^]*?markdownMarkerFor/);
  assert.match(view, /node\.type === 'emphasis' \|\| node\.type === 'strong' \|\| node\.type === 'delete'[^]*?node\.type === 'emphasis' \? 'em'[^]*?'strong'[^]*?'del'/);
  assert.match(view, /node\.type === 'heading'[^]*?createElement\(`h\$\{clamp\(node\.depth \|\| 1, 1, 6\)\}`[^]*?appendAstChildren\(heading, node/);
  assert.match(view, /function appendAstChildren\([^]*?approvedInlineHtmlTag\(child\)[^]*?appendAstChildren\(wrapper, \{[^]*?children: children\.slice\(index \+ 1, closingIndex\)/);
  assert.match(view, /function renderState\(state\)[^]*?renderSemanticDocument\(state, bodyRoot\)/);
  assert.match(view, /function renderSemanticDocument\(state, bodyRoot\)[^]*?renderSemanticDocumentBlocks\(state, bodyRoot\)/);
  assert.match(view, /function syncSemanticDocumentInput\(state, event = \{\}[^]*?Editable DOM is a projection, never a text authority[^]*?renderEditableDocumentBlocks[^]*?refreshEditableProjection/);
  assert.match(view, /function replaceSemanticSourceRange\([^]*?installSourceSnapshot[^]*?refreshEditableProjection[^]*?notifySemanticBodyInput/);
  assert.match(view, /bodyRoot\.addEventListener\('compositionstart'[^]*?bodyRoot\.addEventListener\('compositionend'/);
  assert.doesNotMatch(view, /function syncSemanticBlockInput/);
  assert.match(view, /if \(mode !== state\.mode\) \{[^]*?if \(state\.semanticDirty\) \{[^]*?commitBody\(state, 'mode-change'\);[^]*?semanticFocusHistorySnapshot[^]*?requiresModeUpdate = true;/);
  assert.match(view, /if \(requiresRender\) \{\s*renderState\(state\);\s*if \(modeSelection && semanticModeEditable\(state\)\) \{[^]*?restoreSemanticSelection\(state\.bodyRoot, modeSelection\)[^]*?updateLiveMarkerVisibility\(state\)/);
  assert.match(view, /function updateLiveMarkerVisibility\(state\)[^]*?active\.ownerIds[^]*?active\.lineIds[^]*?refreshEditableProjection/);
  assert.doesNotMatch(view, /createSourceEditor|createLiveEditor|<textarea|markdown-page-source-editor|markdown-page-live-editor/);

  assert.match(styles, /\.markdown-source-marker \{[^}]*display: none;[^}]*font-family: inherit;/);
  assert.match(styles, /\.markdown-page-layer\.is-live-preview[^]*?\.markdown-editable-projected-leaf:is\([^]*?\.is-emphasis-marker,[^]*?\.is-strong-marker,[^]*?\):not\(\.is-markdown-semantic-active\) \{\s*display: none;/);
  assert.match(styles, /\.markdown-page-layer \{[^}]*font-family: var\(--font-page-family\)/);
  assert.match(styles, /\.markdown-page-inline-code \{[^}]*font-family: var\(--font-page-family\)/);
  assert.match(styles, /\.markdown-page-code-block \{[^}]*font-family: ui-monospace/);
});

test('editable Markdown spacing is physical-row owned without Reading margins', async () => {
  const [view, styles] = await Promise.all([
    read('public/js/markdownPageView.js'),
    read('public/styles.css')
  ]);

  assert.match(view, /function editableSourceGapLayout\(value, \{[^]*?hasPrecedingContent = betweenBlocks,[^]*?hasFollowingContent = true[^]*?visibleBlankLines/);
  assert.match(view, /function createSourceBlockGap\(value, start, end, options = \{\}\)[^]*?markdown-source-structural-break/);
  assert.match(view, /hasFollowingBlock: index < segments\.length - 1/);
  assert.match(view, /hasPrecedingContent: true,[^]*?hasFollowingContent: blockState\.hasFollowingBlock/);
  assert.match(styles, /\.markdown-editable-physical-row \{[^}]*display: block;[^}]*min-height: 1lh;[^}]*margin: 0;[^}]*padding: 0;[^}]*line-height: var\(--markdown-page-body-line-height\);[^}]*white-space: pre-wrap;/);
  assert.match(styles, /\.markdown-page-layer\.is-live-preview\s+\.markdown-editable-projected-leaf\[data-visibility="activatable"\],[^]*?\[data-visibility="source-only"\] \{\s*display: none;/);
  assert.match(styles, /\.markdown-source-gap-character,[^]*?\.markdown-source-structural-break \{[^}]*position: absolute;[^}]*width: 0;[^}]*height: 0;[^}]*font-size: 0;[^}]*line-height: 0;/);
  assert.match(styles, /\.markdown-source-gap-line \{[^}]*height: auto;[^}]*min-height: 0;[^}]*margin: 0;[^}]*padding: 0;[^}]*line-height: inherit;/);
  assert.match(styles, /\.markdown-editable-physical-row\.is-editable-presentation-collapsed \{[^}]*height: 0 !important;[^}]*margin: 0 !important;[^}]*line-height: 0 !important;/);
  assert.match(styles, /\.markdown-page-paragraph,[^]*?\.markdown-page-live-block \{\s*margin: 0 0 1rem;/);
});

test('Markdown vertical bounds own wheel, zoom, and restored camera clamping', async () => {
  const [app, canvas, view] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/markdownPageView.js')
  ]);

  assert.match(view, /function calculateMarkdownDocumentExtent\(/);
  assert.match(view, /function clampMarkdownVerticalOffset\(/);
  assert.match(canvas, /function applyCanvasTransform\(runtime\)[^]*?clampMarkdownVerticalOffsetForCanvas\(runtime\);[^]*?writeCanvasTransform\(runtime\);/);
  assert.match(canvas, /function writeCanvasTransform\(runtime\) \{\s*writeCanvasTransformFor\([^]*?runtime\.dom\.canvasStage,[^]*?runtime\.dom\.canvasArea,[^]*?runtime\.canvasView/);
  assert.match(canvas, /function writeCanvasTransformFor\([^]*?stage\.style\.transform[^]*?updateMarkdownPageLayer\(stage, \{[^]*?zoom: view\.scale,[^]*?cameraOffsetX: view\.offsetX,[^]*?cameraOffsetY: view\.offsetY/);
  assert.match(canvas, /function handleCanvasWheel\(runtime, event\)[^]*?applyCanvasTransform\(runtime\)/);
  assert.match(canvas, /function zoomAtPoint\(runtime,[^]*?applyCanvasTransform\(runtime\)/);
  assert.match(app, /function restoreActiveTabViewState\(runtime\)[^]*?applyCanvasTransform\(runtime\)/);
  assert.match(canvas, /if \(fit && rendersStructuredText\) \{\s*fitStructuredTextCameraToFrame\(runtime\.currentPage\.textFrame, canvasArea, runtime\.canvasView\);\s*applyCanvasTransform\(runtime\);/);
});

test('Markdown Page file drops use the Pane-level Canvas importer at the pointer world position', async () => {
  const [app, bootstrap] = await Promise.all([
    read('public/app.js'),
    read('public/js/appBootstrap.js')
  ]);

  assert.match(bootstrap, /bindImportDropTarget\(resolveRuntime, area, 'canvas'\)/);
  assert.match(app, /async function addFilesToCurrentPage\(runtime, droppedFiles = null, dropPoint = null\)/);
  assert.match(app, /const hasDropPoint = isDrop[^]*?Number\.isFinite\(dropPoint\?\.clientX\)[^]*?Number\.isFinite\(dropPoint\?\.clientY\)/);
  assert.match(app, /const placementCenter = screenToWorld\(runtime,[^]*?hasDropPoint \? dropPoint\.clientX[^]*?hasDropPoint \? dropPoint\.clientY/);
  assert.match(app, /if \(documentBounds && !hasDropPoint\)/);
  assert.match(app, /const capturePageDrop = importTarget === 'canvas'[^]*?addEventListener\('drop'[^]*?const runtime = resolveRuntime\(\)[^]*?event\.preventDefault\(\);[^]*?event\.stopPropagation\(\);[^]*?addFilesToCurrentPage\(runtime, files, \{\s*clientX: event\.clientX,\s*clientY: event\.clientY/);
  assert.match(app, /renderPage\(runtime, runtime\.currentPage, \{\s*resetCanvas: isDrop \? false : !entersPageEdit,\s*installCanonical: false\s*\}\)/);
});

test('new structured-text Pages focus and select the shared bound title instead of the Pane title', async () => {
  const [app, view, shell] = await Promise.all([
    read('public/app.js'),
    read('public/js/markdownPageView.js'),
    read('public/js/structuredTextPageShell.js')
  ]);

  assert.match(view, /function focusMarkdownDocumentTitle\(target, \{ selectAll = false \} = \{\}\)[^]*?\[data-markdown-role="title"\][^]*?structuredTextShell\?\.focusBoundTitle/);
  assert.match(shell, /function selectBoundTitleContents\(title\)[^]*?range\.selectNodeContents\(title\)[^]*?selection\.addRange\(range\)/);
  assert.match(shell, /if \(event\.key === 'Enter'\) \{\s*event\.preventDefault\(\);\s*title\.blur\(\)/);
  assert.match(app, /function beginNewPageTitleEditor\(runtime, page\)[^]*?PAGE_TYPES\.MARKDOWN[^]*?PAGE_TYPES\.HN_TEXT[^]*?closeTitleEditor\(runtime\)[^]*?focusBoundTitleForStage\?\.\([^]*?runtime\.dom\.canvasStage,[^]*?selectAll: true/);
  assert.match(app, /async function createNewPage[^]*?const opened = await completePageOpen\(runtime, created\.pageEntry, created\.page, \{ historyMode \}\);[^]*?if \(!opened \|\| !createOwnerIsCurrent\(\)[^]*?\) return;[^]*?runtime === activePaneRuntime\(\)[^]*?beginNewPageTitleEditor\(runtime, created\.page\)/);
  assert.match(app, /async function confirmAddLinkNewPage[^]*?const navigated = await navigateCurrentTabToPage\(runtime, created\.page\.id, \{[^]*?resolvedPageEntry: created\.pageEntry,[^]*?resolvedPage: created\.page[^]*?\}\);[^]*?if \(!navigated\) return;[^]*?runtime !== activePaneRuntime\(\)[^]*?return;\s*beginNewPageTitleEditor\(runtime, created\.page\)/);
});

test('Markdown title and body selection gestures retain ownership beyond the text frame', async () => {
  const [app, canvas, view, styles] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/markdownPageView.js'),
    read('public/styles.css')
  ]);

  assert.match(view, /let activeMarkdownSelectionGesture = null/);
  assert.match(view, /function beginMarkdownSelectionGesture\(state, editorType, editor, event, options = \{\}\)[^]*?paneId: state\.paneId[^]*?tabId: state\.tabId[^]*?pageId:/);
  assert.match(view, /gesture\.onPointerMove = \(moveEvent\) => \{[^]*?moveEvent\.preventDefault\(\);[^]*?extendMarkdownSelectionGesture/);
  assert.doesNotMatch(view, /gesture\.onPointerMove = \(moveEvent\) => \{[^]*?pointerIsOutsideSelectionRegion[^]*?return;/);
  assert.match(view, /function pointerIsOutsideSelectionRegion\(gesture,[^]*?gesture\?\.state\?\.area\?\.getBoundingClientRect/);
  assert.match(view, /gesture\.onPointerUp = \(upEvent\) => finishMarkdownSelectionGesture/);
  assert.match(view, /gesture\.onPointerCancel = \(cancelEvent\)[^]*?cancelled: true/);
  assert.match(view, /gesture\.onWindowBlur = \(\) => clearMarkdownSelectionGesture/);
  assert.match(view, /bodyRoot\.addEventListener\('pointerdown'[^]*?beginMarkdownSelectionGesture\(state, 'body', bodyRoot, event\)[^]*?true\);/);
  assert.match(view, /function createTitle\(state\)[^]*?onPointerDown:[^]*?beginMarkdownSelectionGesture\(state, 'title', title, event\)/);
  assert.match(view, /function editablePointerPosition\(state, event\)[^]*?editableTableCellPointerPosition[^]*?editableProjection\?\.pointerToPosition[^]*?projectionPositionAtOffset/);
  assert.match(view, /Keep ownership through the synthetic click dispatched after pointerup/);
  assert.match(canvas, /function markdownOwnsPointerEvent\(runtime, event\)[^]*?markdownSelectionGestureOwnsPointer\(event\)[^]*?return true/);
  assert.match(styles, /\.markdown-page-document \{[^}]*user-select: text;/);
  assert.match(styles, /\.markdown-page-layer\.is-markdown-selection-gesture-active,[^]*?\.is-markdown-selection-owner \{\s*user-select: text;/);
  assert.match(view, /let activeMarkdownClipboardSelection = null/);
  assert.match(view, /function setMarkdownClipboardSelection\(state, selection = \{\}\)[^]*?paneId: state\.paneId[^]*?tabId: state\.tabId[^]*?pageId: statePageId\(state\)/);
  assert.match(view, /document\.addEventListener\('copy'[^]*?handleMarkdownClipboardEvent\(event, 'copy'\)/);
  assert.match(view, /document\.addEventListener\('cut'[^]*?handleMarkdownClipboardEvent\(event, 'cut'\)/);
  assert.match(view, /event\.clipboardData\.setData\('text\/plain', source\)/);
  assert.match(view, /canonicalMarkdownSelectionText\(state\.body, selection\)/);
  assert.match(view, /replaceSemanticSourceRange\(state, range\.start, range\.end, '', \{[^]*?inputType: 'deleteByCut'/);
  assert.match(view, /selection\.kind === 'whole-body'[^]*?start: 0, end: length/);
  assert.match(view, /function editableTableCellPointerPosition\([^]*?state\.editableProjection\.domToSource\(point\.node, point\.offset\)[^]*?editableTableCellEffectiveRange\(state, table, cellPlan\)[^]*?activeRange\.start[^]*?activeRange\.end/);
  assert.match(view, /function textPointAtOffset\([^]*?node\.parentElement\?\.closest\?\.\('\[data-markdown-semantic-only="true"\]'\)[^]*?if \(!semanticOnly\) textNodes\.push\(node\)/);
  assert.match(view, /unboundedFocusedSelection[^]*?containsNode\?\.\(focusedBody, true\)[^]*?kind: 'whole-body'/);
  assert.match(view, /document\.addEventListener\('focusin'[^]*?selection\.kind !== 'whole-body'[^]*?clearMarkdownClipboardSelection/);
  assert.match(view, /if \(state\.tabId && activeTab\?\.id !== state\.tabId\) return false/);
  assert.match(view, /if \(statePageId\(state\) && activeTab\?\.currentPageId !== statePageId\(state\)\) return false/);
  assert.match(view, /if \(!event\.clipboardData\?\.setData\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(view, /let pendingMarkdownClipboardWrite = null/);
  assert.match(view, /pendingWrite\.fulfilled = true[^]*?event\.stopImmediatePropagation\(\)/);
  assert.match(view, /\{ allowAsyncFallback: false \}[^]*?if \(!copied\) return true;[^]*?replaceSemanticSourceRange/);
  assert.match(view, /typeof text !== 'string' \|\| text\.length === 0/);
  assert.match(app, /async function loadPage[^]*?clearMarkdownClipboardSelection\?\.\(\{ clearBrowserSelection: true \}\)/);
  assert.match(app, /function commitPageHistoryOpen\(runtime,[^]*?historyMode === 'replace'[^]*?forgetMarkdownEditHistory\?\.\(runtime\.session\.activeTab\(\)\)/);
  assert.match(app, /function disposeWorkspacePaneView[^]*?querySelectorAll\?\.\('\.markdown-page-layer'\)[^]*?destroyMarkdownPageLayer/);
  assert.match(app, /const wasActive = closing\.id === activeTab\(runtime\)\?\.id[^]*?if \(wasActive\)[^]*?clearMarkdownClipboardSelection/);
  assert.match(styles, /\.markdown-page-layer\.is-reading \.markdown-page-body \{\s*user-select: text;/);
  assert.match(view, /function browserSelectionInsideMarkdownBody\(state\)[^]*?selection\.isCollapsed[^]*?anchor === body && focus === body/);
  assert.match(view, /function browserSelectionOutsideMarkdownBody\(state\)[^]*?!browserSelectionInsideMarkdownBody\(state\)/);
  assert.match(view, /operation === 'copy' && !logicalWholeBody[^]*?browserSelectionInsideMarkdownBody\(commandState\)\) return false/);
  assert.match(view, /const fallbackState = focusedState \? null : activeMarkdownPageState\(\);\s*if \(!focusedState && fallbackState\s*&& browserSelectionOutsideMarkdownBody\(fallbackState\)\) return false/);
  assert.match(view, /function markdownContextMenuPointer\(event\)[^]*?event\.button === 2[^]*?event\.ctrlKey[^]*?markdownRunsOnMacOS/);
  assert.match(view, /document\.addEventListener\('pointerdown'[^]*?if \(markdownContextMenuPointer\(event\)\) return;/);
  assert.match(view, /semanticModeEditable\(state\) && state\.editableProjection[^]*?!markdownContextMenuPointer\(event\)/);
  assert.match(view, /state\.mode === 'reading' && !state\.pageEditMode[^]*?!markdownContextMenuPointer\(event\)/);
  assert.match(view, /function textContextMenuCapabilities\(target\)[^]*?editableTableCellEditContext\(state, selection\)[^]*?canonicalMutationBlocked[^]*?canCut: editable && selected && !canonicalMutationBlocked[^]*?canCopy: selected[^]*?canPaste: editable && !canonicalMutationBlocked/);
});

test('editable Markdown owns canonical Arrow navigation and mode-stable document extent', async () => {
  const view = await read('public/js/markdownPageView.js');

  assert.match(view, /function applySemanticArrowNavigation\([^]*?ArrowLeft[^]*?ArrowRight[^]*?ArrowUp[^]*?ArrowDown/);
  assert.match(view, /function applySemanticArrowNavigation\([^]*?editableProjection\.getSelection|function applySemanticArrowNavigation\([^]*?projection\?\.getSelection[^]*?projection\.moveVertical[^]*?projection\.moveHorizontal[^]*?restoreSelection/);
  assert.match(view, /bodyRoot\.addEventListener\('keydown'[^]*?applySemanticArrowNavigation\(state, event\)/);
  assert.match(view, /modeExtentFloor: null/);
  assert.match(view, /mode !== state\.mode[^]*?state\.modeExtentFloor = Math\.max\([^]*?state\.documentExtent\?\.modeContentBottom/);
  assert.match(view, /provisionalBottom: Math\.max\([^]*?state\.modeExtentFloor/);
});

test('the fixed Markdown control strip follows the active Pane Page and Vault mode', async () => {
  const [index, styles, app, bootstrap] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css'),
    read('public/app.js'),
    read('public/js/appBootstrap.js')
  ]);

  assert.match(index, /id="markdown-control-strip"[^]*?id="markdown-mode-button"[^]*?id="markdown-mode-value"[^]*?id="markdown-statistics"[^]*?Count:[^]*?id="markdown-word-count"[^]*?markdown-statistic-separator[^]*?id="markdown-character-count"[^]*?markdown-statistic-separator[^]*?id="markdown-paragraph-count"[^]*?markdown-zoom-controls[^]*?id="markdown-zoom-out"[^]*?id="markdown-zoom-value"[^]*?id="markdown-zoom-in"/);
  assert.doesNotMatch(index, /id="markdown-statistic-button"/);
  assert.match(styles, /\.markdown-control-strip \{[^}]*position: fixed;[^}]*right: 0;[^}]*bottom: 0;[^}]*width: max-content;[^}]*border-top: 1px solid var\(--border-canvas\);[^}]*border-left: 1px solid var\(--border-canvas\);[^}]*border-radius: 6px 0 0;[^}]*font-size: var\(--font-file-size\)/);
  assert.doesNotMatch(styles, /\.markdown-control-strip \{[^}]*left: 50%/);
  assert.match(styles, /\.markdown-control-strip \{[^}]*z-index: 48;/);
  assert.match(app, /function refreshMarkdownControlStrip\(runtime\)[^]*?markdownPageModel\.normalizePageType\(runtime\.currentPage\.type\)[^]*?markdownControlStrip\.hidden = !markdownActive/);
  assert.match(app, /markdownPageModel\.statistics\(runtime\.currentPage\.markdownBody \|\| ''\)/);
  assert.match(app, /markdownModeValue\.textContent = markdownModeLabel\(mode\)/);
  assert.match(index, /structuredTextCount\.js\?v=shared-count-status-v01/);
  assert.match(app, /createCountPresentation\?\.\(markdownStatistics\)/);
  assert.match(app, /function renderSharedCountPresentation\(controlStrip, statistics\)[^]*?sharedCountPresentation\.mount\(controlStrip, zoomControls\)[^]*?sharedCountPresentation\.update\(statistics\)/);
  assert.match(app, /renderSharedCountPresentation\(markdownControlStrip, stats\)/);
  assert.match(app, /markdownZoomValueButton\.textContent = `\$\{Math\.round\(runtime\.canvasView\.scale \* 100\)\}%`/);
  assert.match(app, /function setActiveWorkspacePane[^]*?const targetRuntime = runtimeForPane\(target\)[^]*?workspace\.activatePane\(target\.id\)[^]*?refreshActivePaneWindowChrome\(targetRuntime\)/);
  assert.match(app, /function refreshActivePaneWindowChrome\(runtime\)[^]*?refreshMarkdownControlStrip\(runtime\)/);
  assert.match(app, /function setVaultMarkdownMode[^]*?queueVaultMarkdownPreferenceSave\(\{ lastMarkdownMode: normalizedMode \}\)/);
  assert.match(app, /const version = \+\+markdownModePreferenceVersion[^]*?version !== markdownModePreferenceVersion/);
  assert.match(app, /function queueVaultMarkdownPreferenceIntent[^]*?request\('\/api\/vault-preferences'[^]*?method: 'PATCH'[^]*?function queueVaultMarkdownPreferenceSave/);
  assert.match(bootstrap, /markdownModeButton\?\.addEventListener\('click', cycleVaultMarkdownMode\)/);
  assert.doesNotMatch(app, /function cycleMarkdownStatistic|markdownStatisticKind/);
  assert.doesNotMatch(bootstrap, /markdownStatisticButton|cycleMarkdownStatistic/);
  assert.match(bootstrap, /markdownZoomOutButton\?\.addEventListener[^]*?markdownZoomInButton\?\.addEventListener/);
});

test('Page Type UI and Vault Default Page Type use canonical eligibility and settings routes', async () => {
  const [index, app, settings, server] = await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('public/js/vaultSettings.js'),
    read('server/appServer.js')
  ]);

  const defaultPageTypeSelect = index.match(
    /<select\b[^>]*\bid="vault-default-page-type"[^>]*>[\s\S]*?<\/select>/
  )?.[0] || '';
  assert.match(defaultPageTypeSelect, /id="vault-default-page-type"/);
  assert.doesNotMatch(defaultPageTypeSelect, /<option\b/);

  const preferenceRenderer = settings.slice(
    settings.indexOf('function renderVaultPageTypePreference'),
    settings.indexOf('async function saveVaultPageTypePreference')
  );
  assert.match(preferenceRenderer, /pageTypesModel\.vaultDefaultPageTypes\(\)/);
  assert.match(preferenceRenderer, /createElement\(['"]option['"]\)/);
  assert.match(preferenceRenderer, /\.value\s*=\s*(?:[A-Za-z_$][\w$]*\.)?id/);
  assert.match(preferenceRenderer, /\.textContent\s*=\s*(?:[A-Za-z_$][\w$]*\.)?label/);
  assert.match(settings, /function saveVaultPageTypePreference\(\)[^]*?defaultPageType: vaultDefaultPageType\.value[^]*?queueVaultMarkdownPreferenceSave\(\{[^]*?defaultPageType: next\.defaultPageType/);

  const toolbarFactory = app.slice(
    app.indexOf('function createPaneToolbarRegion'),
    app.indexOf('function ensurePaneToolbarRegion')
  );
  assert.match(toolbarFactory, /pageTypeTrigger\.textContent\s*=\s*['"]Page Type…['"]/);
  assert.match(toolbarFactory, /pageTypesModel\.pageTypesForMenu\(\)/);
  assert.match(toolbarFactory, /dataset\.pageType\s*=\s*(?:[A-Za-z_$][\w$]*\.)?id/);
  assert.match(toolbarFactory, /\.textContent\s*=\s*(?:[A-Za-z_$][\w$]*\.)?label/);
  assert.match(toolbarFactory, /setAttribute\(['"]role['"],\s*['"]menuitemradio['"]\)/);
  assert.doesNotMatch(toolbarFactory, /page-type-canvas[^\n]*Canvas|page-type-markdown[^\n]*Markdown/);

  const menuUpdater = app.slice(
    app.indexOf('function updatePanePageTypeMenu'),
    app.indexOf('function updatePaneToolbarPresentation')
  );
  assert.match(menuUpdater, /pageTypeMenuItems/);
  assert.doesNotMatch(menuUpdater, /pageTypeCanvasMenuItem|pageTypeMarkdownMenuItem/);
  assert.match(menuUpdater, /pageTypesModel\.conversionEligibility\(page,\s*targetType\)/);
  assert.match(menuUpdater, /item\.disabled\s*=\s*!selected\s*&&\s*!eligibility\.allowed/);

  const conversionHandler = app.slice(
    app.indexOf('async function convertCurrentPageType'),
    app.indexOf('async function createNewPage')
  );
  assert.match(conversionHandler, /pageTypesModel\.conversionEligibility\(runtime\.currentPage,\s*normalizedTarget\)/);
  assert.match(conversionHandler, /\/type`/);

  assert.match(server, /app\.(?:put|patch)\('\/api\/vault-preferences', saveVaultPreferencesRequest\)/);
  assert.match(server, /const \{ defaultPageType \} = await readVaultPreferences\(\);\s*const page = newEmptyPageRecord\(pageId, title, now, defaultPageType\)/);
  assert.match(server, /app\.get\('\/api\/pages\/:pageId\/type-eligibility'/);
  assert.match(server, /app\.post\('\/api\/pages\/:pageId\/type'/);
});

test('Page Type renderers expose HN explicitly and reject unknown Pages without Canvas fallback', async () => {
  const app = await read('public/app.js');
  const rendererRegistryMatch = app.match(
    /const\s+(page[A-Za-z_$][\w$]*(?:Renderers|Adapters))\s*=\s*new Map\(\[([\s\S]*?)\]\);/
  );
  assert.ok(rendererRegistryMatch, 'Page renderer adapter registry is required');
  const rendererRegistryName = rendererRegistryMatch[1];
  const rendererRegistryStart = rendererRegistryMatch.index;
  const rendererRegistryEnd = rendererRegistryStart + rendererRegistryMatch[0].length;
  const rendererIdLookup = app.indexOf(
    'pageTypesModel.pageTypeRendererId(page?.type)',
    rendererRegistryEnd
  );
  const rendererSelectorStart = app.lastIndexOf('function ', rendererIdLookup);
  const contentDispatcherStart = app.indexOf('function renderPageContent');
  assert.notEqual(rendererIdLookup, -1, 'Page renderer selection must use the registry renderer id');
  assert.notEqual(rendererSelectorStart, -1, 'Page renderer selector is required');
  assert.notEqual(contentDispatcherStart, -1, 'Page content dispatcher is required');

  const rendererRegistry = rendererRegistryMatch[0];
  for (const rendererId of ['canvas', 'markdown', 'cne-text']) {
    assert.match(rendererRegistry, new RegExp(`['"]${rendererId}['"]`));
  }
  assert.doesNotMatch(rendererRegistry, /['"]unsupported['"]/);
  const rendererEntries = Object.fromEntries([...rendererRegistry.matchAll(
    /\[\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\]/g
  )].map((match) => [match[1], match[2]]));
  assert.notEqual(rendererEntries['cne-text'], rendererEntries.canvas);

  const rendererSelector = app.slice(rendererSelectorStart, contentDispatcherStart);
  assert.match(rendererSelector, /pageTypesModel\.pageTypeRendererId\(page\?\.type\)/);
  assert.match(rendererSelector, /throw new Error\(`Unsupported Page Type/);
  assert.doesNotMatch(rendererSelector, new RegExp(
    `${rendererRegistryName}\\.get\\(['"]canvas['"]\\)`
  ));

  const activeRenderer = app.slice(
    app.indexOf('function renderPage(runtime, page'),
    app.indexOf('function setEditMenuOpen')
  );
  assert.match(activeRenderer, /renderPageContent\(runtime, page/);
  assert.doesNotMatch(activeRenderer, /renderCanvas\(runtime, page\.objects/);

  const inactiveRenderer = app.slice(
    app.indexOf('function renderPageIntoInactivePane'),
    app.indexOf('function createAllocatedWorkspacePane')
  );
  assert.match(inactiveRenderer, /renderPageContent\(runtime, page/);
  assert.doesNotMatch(inactiveRenderer, /renderCanvas\(runtime, page\.objects/);

  const toolbarPresentation = app.slice(
    app.indexOf('function updatePaneToolbarPresentation'),
    app.indexOf('function renderPaneToolbarCollection')
  );
  assert.match(toolbarPresentation, /(?:pageTypesModel\.pageTypeSupports|pageSupportsCapability)\([\s\S]*?['"]page-edit['"]\)/);
  assert.match(toolbarPresentation, /(?:pageTypesModel\.pageTypeSupports|pageSupportsCapability)\([\s\S]*?['"]canvas['"]\)/);

  const editAvailability = app.slice(
    app.indexOf('function updateEditAvailability'),
    app.indexOf('function syncMarkdownDraftToOtherPanes')
  );
  assert.match(editAvailability, /(?:pageTypesModel\.pageTypeSupports|pageSupportsCapability)\([\s\S]*?['"]page-edit['"]\)/);
  assert.match(editAvailability, /(?:pageTypesModel\.pageTypeSupports|pageSupportsCapability)\([\s\S]*?['"]canvas['"]\)/);

  assert.match(app, /function pageSupportsFileImport\(page\)[\s\S]*?(?:pageTypesModel\.pageTypeSupports|pageSupportsCapability)\([\s\S]*?['"]file-import['"]\)/);

  const addFiles = app.slice(
    app.indexOf('async function addFilesToCurrentPage'),
    app.indexOf('function droppedFiles')
  );
  assert.match(addFiles, /(?:pageSupportsFileImport\(currentPage\)|(?:pageTypesModel\.pageTypeSupports|pageSupportsCapability)\([\s\S]*?['"]file-import['"]\))/);

  const dropBinding = app.slice(
    app.indexOf('function bindImportDropTarget'),
    app.indexOf('async function toggleResourceVisibility')
  );
  assert.match(dropBinding, /(?:pageSupportsFileImport\(currentPage\)|(?:pageTypesModel\.pageTypeSupports|pageSupportsCapability)\([\s\S]*?['"]file-import['"]\))/);
});

test('structured Page Edit sends one canonical Page frame through the shared boundary lifecycle', async () => {
  const [canvas, view, shell, sessionTabs] = await Promise.all([
    read('public/js/canvasBlocks.js'),
    read('public/js/markdownPageView.js'),
    read('public/js/structuredTextPageShell.js'),
    read('public/sessionTabs.js')
  ]);

  assert.match(canvas, /onTextFrameInput:\s*\(frame, detail\)/);
  assert.match(canvas, /onTextFrameCommit:\s*\(frame, detail\)/);
  assert.match(view, /onInput: \(nextFrame, detail\) => invoke\(state\.onTextFrameInput, nextFrame/);
  assert.match(view, /onCommit: \(nextFrame, detail\) => invoke\(state\.onTextFrameCommit, nextFrame/);
  assert.match(shell, /editor\.setFrame\?\.\(\{ \.\.\.active\.startFrame \}, detail\);[^]*?editor\.onInput\?\.\(\{ \.\.\.active\.startFrame \}, detail\)/);
  assert.match(shell, /frameModel\.updateBoundaryDrag\(active\.dragSession, targetWorldX\)/);
  assert.doesNotMatch(view, /temporaryCenterOffsetX|draftPreferredWidth|frameOffsetX|renderedWidth|frameConstraintSide/);
  assert.doesNotMatch(sessionTabs, /markdownFrameOffsetX|markdownFrameWidth|markdownFramePreferredWidth|markdownFrameConstraintSide/);
});

test('structured-text views never resize Page geometry from viewport observations', async () => {
  const [frameModel, view, shell] = await Promise.all([
    read('public/structuredTextFrame.js'),
    read('public/js/markdownPageView.js'),
    read('public/js/structuredTextPageShell.js')
  ]);

  assert.match(frameModel, /function resolveViewportResize\(options = \{\}\)/);
  assert.doesNotMatch(view, /constrainMarkdownFrameToViewport|beginMarkdownPaneResize|endMarkdownPaneResize|onFrameGeometryChange/);
  assert.doesNotMatch(view, /new ResizeObserver\([^]*?state\.area/);
  assert.match(shell, /state\.resizeObserver\.observe\(state\.surface\);/);
  assert.doesNotMatch(shell, /state\.resizeObserver\.observe\(state\.area\)|VIEWPORT_INSET|DOCUMENT_BOUNDARY_GUTTER/);
  assert.doesNotMatch(view, /DOCUMENT_BOUNDARY_GUTTER|frameOffsetX|renderedWidth|frameConstraintSide/);
});

test('Page Edit locks the currently selected Markdown mode instead of forcing Reading rendering', async () => {
  const [canvas, view, styles] = await Promise.all([
    read('public/js/canvasBlocks.js'),
    read('public/js/markdownPageView.js'),
    read('public/styles.css')
  ]);

  assert.match(view, /function semanticModeEditable\(state\) \{\s*return state\.mode !== 'reading' && !state\.pageEditMode && !state\.bodyReadOnly;/);
  assert.match(view, /function renderState\(state\)[^]*?renderSemanticDocument\(state, bodyRoot\)/);
  assert.match(view, /function updateSemanticEditorMode\(state\)[^]*?state\.bodyRoot\.contentEditable = editable \? 'true' : 'false'[^]*?state\.bodyRoot\.tabIndex = 0[^]*?aria-readonly/);
  assert.match(view, /function renderSemanticDocumentBlocks\(state, bodyRoot\)[^]*?semanticSyntaxSegments\(state\)[^]*?node: segment\.node[^]*?renderSemanticBlockContents\(state, blockState\)/);
  assert.doesNotMatch(view, /createSourceEditor|createLiveEditor|textarea\.readOnly/);
  assert.match(view, /const documentSurface = createElement\(\s*'article',\s*'markdown-page-document structured-text-page-surface'\s*\);[^]*?state\.documentSurface = documentSurface;[^]*?if \(state\.pageEditMode\) documentSurface\.inert = true;/);
  assert.match(view, /const geometry = textFrameEdges\(state\.textFrame\);[^]*?state\.layer\.style\.left = `\$\{geometry\.leftWorld\}px`/);
  assert.match(styles, /\.markdown-page-layer\.is-page-edit-mode \{[^}]*z-index: 8;[^}]*pointer-events: none;/);
  assert.match(styles, /\.markdown-page-layer\.is-page-edit-mode \.markdown-page-document \{[^}]*z-index: 1;[^}]*user-select: none;[^}]*pointer-events: none;/);
  assert.match(styles, /\.markdown-page-layer\.is-page-edit-mode::before \{\s*background: color-mix\(in srgb, var\(--surface-canvas\) 72%, transparent\);/);
  assert.match(styles, /\.markdown-page-layer\.is-page-edit-mode \.markdown-page-document \* \{[^}]*pointer-events: none;/);
  assert.match(styles, /\.canvas-area\.page-edit-mode \.canvas-object-layer \{[^}]*z-index: 6;[^}]*isolation: isolate;[^}]*pointer-events: auto;/);
  assert.match(styles, /\.canvas-area\.page-edit-mode \.canvas-object-layer\.is-selected \{\s*z-index: 7;/);
  assert.match(styles, /\.markdown-page-layer\.is-page-edit-mode \.markdown-page-frame-boundary \{\s*z-index: 8;/);
  assert.match(canvas, /if \(runtime\.pageEditMode && target\?\.closest\?\.\('\.markdown-page-layer\.is-page-edit-mode'\)\) \{[^]*?return Boolean\(target\.closest\('\.markdown-page-frame-handle'\)\);/);
  assert.doesNotMatch(view, /if \(state\.pageEditMode \|\| state\.bodyReadOnly \|\| state\.mode === 'reading'\)/);
});

test('Markdown Page Edit interleaves locked text, Objects, controls, and frame handles', async () => {
  const styles = await read('public/styles.css');
  const declarations = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `Missing CSS rule for ${selector}`);
    return match[1];
  };
  const zIndex = (selector) => {
    const value = declarations(selector).match(/z-index:\s*(-?\d+);/)?.[1];
    assert.notEqual(value, undefined, `Missing numeric z-index for ${selector}`);
    return Number(value);
  };

  assert.equal(zIndex('.markdown-page-camera-layer'), 5);
  assert.ok(
    zIndex('.canvas-area.page-edit-mode .canvas-object-layer')
      < zIndex('.canvas-area.page-edit-mode .canvas-object-layer.is-selected')
  );
  assert.ok(
    zIndex('.markdown-page-layer.is-page-edit-mode .markdown-page-document')
      < zIndex('.markdown-page-layer.is-page-edit-mode .markdown-page-frame-boundary')
  );
  assert.match(declarations('.markdown-page-camera-layer'), /pointer-events:\s*none;/);
  assert.match(declarations('.markdown-page-layer.is-page-edit-mode'), /z-index:\s*8;/);
  assert.doesNotMatch(declarations('.markdown-page-layer.is-page-edit-mode'), /transform:/);
  assert.match(declarations('.markdown-page-layer.is-page-edit-mode'), /pointer-events:\s*none;/);
  assert.match(
    declarations('.markdown-page-layer.is-page-edit-mode .markdown-page-document'),
    /pointer-events:\s*none;/
  );
  assert.match(
    declarations('.markdown-page-layer.is-page-edit-mode .markdown-page-document *'),
    /pointer-events:\s*none;/
  );
  assert.match(
    declarations('.canvas-area.page-edit-mode .canvas-object-layer'),
    /isolation:\s*isolate;[^]*pointer-events:\s*auto;/
  );
  assert.match(declarations('.markdown-page-frame-boundary'), /pointer-events:\s*none;/);
  assert.match(declarations('.markdown-page-frame-handle'), /width:\s*12px;[^]*pointer-events:\s*none;/);
  assert.match(
    declarations('.markdown-page-layer.is-page-edit-mode .markdown-page-frame-handle'),
    /pointer-events:\s*auto;/
  );
  assert.ok(
    styles.indexOf('.canvas-area.page-edit-mode .canvas-object-layer {')
      > styles.indexOf('.canvas-stage.has-highlight-mask .canvas-object-layer {')
  );
});

test('locked Markdown passes fresh Page Edit pointer input through to covered Objects', async () => {
  const object = {
    id: 'object_layer_test',
    type: 'image',
    src: 'assets/images/layer-test.png',
    displayable: true,
    visible: true,
    x: 100,
    y: 100,
    width: 300,
    height: 200
  };
  let capturedPointerId = null;
  const page = {
    id: 'page_markdown_layer_test',
    type: 'canvas',
    objects: [{ ...object }],
    blocks: [],
    highlightGroups: []
  };
  const harness = await createPaneRuntimeHarness({
    leftPage: page,
    globals: {
      markdownPageOwnsPointer: (target) => target?.kind === 'markdown'
    }
  });
  const runtime = harness.left.runtime;
  runtime.pageEditMode = true;
  runtime.draftPageObjects = [{ ...object }];
  runtime.draftPageBlocks = [];
  runtime.canvasObjects = [{ ...object }];
  runtime.canvasView = { scale: 2, offsetX: 80, offsetY: -30 };
  runtime.dom.canvasArea._rect = {
    x: 40, y: 25, left: 40, top: 25,
    width: 800, height: 600, right: 840, bottom: 625
  };
  const capturePointer = runtime.dom.canvasArea.setPointerCapture.bind(runtime.dom.canvasArea);
  runtime.dom.canvasArea.setPointerCapture = (pointerId) => {
    capturedPointerId = pointerId;
    capturePointer(pointerId);
  };
  const { api } = await harness.loadLeaf('canvasBlocks.js', [
    'markdownOwnsPointerEvent',
    'handlePageObjectPointerDown',
    'handlePageObjectPointerMove'
  ]);
  const lockedTextTarget = {
    kind: 'markdown',
    closest(selector) {
      if (selector === '.markdown-page-layer.is-page-edit-mode') return this;
      return null;
    }
  };
  const canvasTarget = { closest: () => null };
  let prevented = false;
  api.handlePageObjectPointerDown(runtime, {
    target: canvasTarget,
    button: 0,
    pointerId: 17,
    clientX: 420,
    clientY: 255,
    preventDefault: () => { prevented = true; }
  });

  assert.equal(api.markdownOwnsPointerEvent(runtime, { target: lockedTextTarget }), false);
  assert.equal(api.markdownOwnsPointerEvent(runtime, { target: canvasTarget }), false);
  assert.equal(runtime.selectedPageObjectId, object.id);
  assert.equal(runtime.pageObjectDrag?.objectId, object.id);
  assert.equal(capturedPointerId, 17);
  assert.equal(prevented, true);

  api.handlePageObjectPointerMove(runtime, {
    pointerId: 17,
    clientX: 470,
    clientY: 285,
    preventDefault() {}
  });
  assert.deepEqual(
    { x: runtime.draftPageObjects[0].x, y: runtime.draftPageObjects[0].y,
      width: runtime.draftPageObjects[0].width, height: runtime.draftPageObjects[0].height },
    { x: 125, y: 115, width: 300, height: 200 }
  );
  assert.deepEqual(runtime.canvasView, { scale: 2, offsetX: 80, offsetY: -30 });

  runtime.pageObjectDrag = null;
  const objectLayerTarget = { dataset: { objectId: object.id } };
  const resizeHandleTarget = {
    dataset: { resizeHandle: 'se' },
    closest(selector) {
      if (selector === '.markdown-page-layer.is-page-edit-mode') return lockedTextTarget;
      if (selector === '.canvas-object-resize-handle') return this;
      if (selector === '.canvas-object-layer') return objectLayerTarget;
      return null;
    }
  };
  api.handlePageObjectPointerDown(runtime, {
    target: resizeHandleTarget,
    button: 0,
    pointerId: 18,
    clientX: 970,
    clientY: 625,
    preventDefault() {}
  });
  assert.equal(runtime.pageObjectDrag?.handle, 'se');
  api.handlePageObjectPointerMove(runtime, {
    pointerId: 18,
    clientX: 1090,
    clientY: 705,
    preventDefault() {}
  });
  assert.deepEqual(
    { width: runtime.draftPageObjects[0].width, height: runtime.draftPageObjects[0].height },
    { width: 360, height: 240 }
  );

  runtime.pageObjectDrag = null;
  runtime.selectedPageObjectId = null;
  const frameHandleTarget = {
    closest(selector) {
      if (selector === '.markdown-page-layer.is-page-edit-mode'
        || selector === '.markdown-page-frame-handle') return this;
      return null;
    }
  };
  api.handlePageObjectPointerDown(runtime, {
    target: frameHandleTarget,
    button: 0,
    pointerId: 19,
    clientX: 150,
    clientY: 130,
    preventDefault() {}
  });
  assert.equal(api.markdownOwnsPointerEvent(runtime, { target: frameHandleTarget }), true);
  assert.equal(runtime.pageObjectDrag, null);

  runtime.pageEditMode = false;
  assert.equal(api.markdownOwnsPointerEvent(runtime, { target: lockedTextTarget }), true);
  api.handlePageObjectPointerDown(runtime, {
    target: lockedTextTarget,
    button: 0,
    pointerId: 20,
    clientX: 150,
    clientY: 130,
    preventDefault() {}
  });
  assert.equal(runtime.pageObjectDrag, null);
  clearTimeout(runtime.canvasImageResolutionTimer);
});

test('pending Markdown content is drained on shutdown and survives concurrent partial Page saves', async () => {
  const [app, workspaceState, server, canvas] = await Promise.all([
    read('public/app.js'),
    read('public/js/workspaceState.js'),
    read('server/appServer.js'),
    read('public/js/canvasBlocks.js')
  ]);

  assert.match(app, /async function flushMarkdownBodySavesNow\(\)[^]*?state\.inFlight[^]*?persistMarkdownBody\(pageId\)/);
  assert.match(app, /globalThis\.flushMarkdownBodySavesNow = flushMarkdownBodySavesNow/);
  assert.match(workspaceState, /async function flushWorkspaceStateNow\(\)[^]*?await globalThis\.flushMarkdownBodySavesNow\(\)/);
  assert.match(app, /function commitCanonicalPage\(page, options = \{\}\)[^]*?markdownSaveState[^]*?page = \{ \.\.\.page, markdownBody: previous\.markdownBody \|\| '' \}/);
  assert.match(app, /async function flushMarkdownBodyPageNow\(pageId\)[^]*?for \(let pass = 0; pass < 3; pass \+= 1\)[^]*?state\.inFlight[^]*?persistMarkdownBody\(pageId\)/);
  assert.match(app, /const pageTitleSaveQueues = new Map\(\)[^]*?function queuePageTitleSave[^]*?pageTitleSaveQueues\.set[^]*?async function saveMarkdownDocumentTitle[^]*?await persistPageTitle/);
  assert.doesNotMatch(app, /!nextTitle \|\| !page \|\| titleSaveInProgress/);
  assert.match(workspaceState, /await globalThis\.flushMarkdownTitleSavesNow\(\)/);
  assert.match(app, /function persistMarkdownBody\(pageId\)[^]*?const canonical = latest[^]*?markdownBody: latestBody === body[^]*?canonicalPages\.set\(pageId, canonical\)[^]*?for \(const runtime of livingPaneRuntimes\(\)\)[^]*?runtime\.currentPage = canonical/);
  assert.match(app, /async function convertCurrentPageType[^]*?markdownPageMutationLocks\.add\(pageId\)[^]*?flushMarkdownBodyPageNow\(pageId\)[^]*?\/type`[^]*?markdownPageMutationLocks\.delete\(pageId\)/);
  assert.match(canvas, /bodyReadOnly: markdownPageMutationLocks\.has\(page\.id\)/);
  assert.match(server, /let pageMutationQueue = Promise\.resolve\(\)[^]*?function serializePageMutation\(req, res, next\)[^]*?pageMutationQueue = current/);
  assert.match(server, /let started = false[^]*?const cancelBeforeStart = \(\) => \{[^]*?if \(!started\) finish\(\)[^]*?req\.once\('aborted', cancelBeforeStart\)[^]*?previous\.catch[^]*?complete \|\| req\.aborted \|\| res\.destroyed \|\| res\.writableEnded/);
  assert.match(server, /const finishFromResponse = \(\) => \{[^]*?!req\[SERIALIZED_MUTATION_OWNS_COMPLETION\][^]*?res\.end = function serializedMutationEnd[^]*?started && !req\[SERIALIZED_MUTATION_OWNS_COMPLETION\][^]*?function transactionalJsonRoute[^]*?finally \{[^]*?req\[SERIALIZED_MUTATION_COMPLETE\]\?\.\(\)/);
  assert.match(server, /function requestNeedsPageSerialization\(req\)[^]*?PAGE_MUTATION_METHODS[^]*?req\.method !== 'GET'[^]*?\/api\\\/pages/);
  assert.match(server, /app\.use\('\/api', serializePageMutation\)/);
});
