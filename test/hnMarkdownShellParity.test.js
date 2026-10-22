'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('HN and Markdown consume one structured-text frame, title, boundary, and extent contract', async () => {
  const [index, frameModel, shell, cne, markdown] = await Promise.all([
    read('public/index.html'),
    read('public/structuredTextFrame.js'),
    read('public/js/structuredTextPageShell.js'),
    read('public/js/hnTextPageView.js'),
    read('public/js/markdownPageView.js')
  ]);

  const frameModelScript = index.indexOf('structuredTextFrame.js');
  const shellScript = index.indexOf('js/structuredTextPageShell.js');
  const hnScript = index.indexOf('js/hnTextPageView.js');
  const markdownScript = index.indexOf('js/markdownPageView.js');
  assert.ok(frameModelScript >= 0 && frameModelScript < shellScript
    && shellScript < hnScript && shellScript < markdownScript,
    'the shared owner loads before either text-engine adapter');

  assert.match(frameModel, /const DEFAULT_TEXT_FRAME = Object\.freeze\(\{[^]*?centerWorldX: 0,[^]*?preferredWidth: 760/);
  assert.match(frameModel, /function edgesForFrame\(value\)/);
  assert.match(frameModel, /function beginBoundaryDrag\(value, side\)/);
  assert.match(frameModel, /function updateBoundaryDrag\(session, targetWorldX\)/);
  assert.match(shell, /const frameModel = root\.structuredTextFrameModel;/);
  assert.doesNotMatch(shell, /VIEWPORT_INSET|constrainFrameToViewport|renderedWidth|frameConstraintSide/);
  assert.match(shell, /function calculateVisualFrameExtent\(options = \{\}\)/);
  assert.match(shell, /function createBoundTitle\(options = \{\}\)/);
  assert.match(shell, /function createFrameBoundary\(options = \{\}\)/);
  assert.match(shell, /function beginFrameBoundaryDrag\(editor, side, event, handle\)/);

  assert.match(cne, /shell\.mount\(\{[^]*?textFrame: options\.page\.textFrame,[^]*?pageEditMode: Boolean\(options\.pageEditMode\)[^]*?onTextFrameInput:[^]*?onTextFrameCommit:[^]*?boundTitle: \{/);
  assert.match(cne, /layer\.className = 'hn-text-page-layer structured-text-page-body'/);
  assert.match(cne, /shellState\.surface\.replaceChildren\(shellState\.title, layer\)/);
  assert.match(cne, /titleElement: shellState\.title/);

  assert.doesNotMatch(markdown, /constrainMarkdownFrameToViewport|frameOffsetX|renderedWidth|frameConstraintSide|beginMarkdownPaneResize|endMarkdownPaneResize/);
  assert.match(markdown, /function calculateMarkdownVisualFrameExtent\(options = \{\}\)[^]*?structuredTextShell\.calculateVisualFrameExtent/);
  assert.match(markdown, /function createTitle\(state\)[^]*?structuredTextShell\.createBoundTitle/);
  assert.match(markdown, /function createFrameBoundary\(state\)[^]*?structuredTextShell\.createFrameBoundary/);
  assert.match(markdown, /frameEditor: \{[^]*?getFrame: \(\) => state\.textFrame[^]*?onInput:[^]*?onCommit:/);
  assert.match(markdown, /markdown-page-layer structured-text-page-frame/);
  assert.match(markdown, /markdown-page-document structured-text-page-surface/);
  assert.match(markdown, /markdown-page-body structured-text-page-body/);
});

test('Markdown and HN share one dynamic Page Edit Save fence and shell settlement owner', async () => {
  const [shell, canvas, cne, markdown] = await Promise.all([
    read('public/js/structuredTextPageShell.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/hnTextPageView.js'),
    read('public/js/markdownPageView.js')
  ]);

  assert.match(shell,
    /function settleActiveBoundaryDragForSave\(target\)[^]*?settlement: 'page-edit-save'/);
  assert.match(shell,
    /handle\.removeEventListener\?\.\('pointermove'[^]*?handle\.removeEventListener\?\.\('lostpointercapture'[^]*?handle\.releasePointerCapture/);
  assert.match(shell,
    /enabled: \(\) => state\.pageEditMode && \([^]*?state\.frameBoundaryInteractionEnabled/);
  assert.match(markdown,
    /enabled: \(\) => state\.pageEditMode && \([^]*?state\.frameBoundaryInteractionEnabled/);
  assert.match(cne,
    /pageEditMode: Boolean\(options\.pageEditMode\),[^]*?frameBoundaryInteractionEnabled: options\.frameBoundaryInteractionEnabled/);
  assert.match(canvas,
    /const frameBoundaryInteractionEnabled = \(\) => \([^]*?runtimeOperationIsCurrent\(renderOperation\)[^]*?!runtime\.pageEditSaveInProgress/);
  assert.equal(
    (canvas.match(/frameBoundaryInteractionEnabled,/g) || []).length,
    2,
    'both structured renderers receive the same dynamic interaction predicate'
  );
  assert.match(canvas,
    /runtime\.pageEditSaveInProgress = true;[^]*?settleStructuredTextFrameForPageEditSave\(runtime, pageId\);[^]*?const textFrameToSave = runtime\.draftPageTextFrame/);
  assert.match(canvas,
    /settlesPendingSave = detail\?\.settlement === 'page-edit-save'/);
});

test('shared CSS gives empty HN the exact Markdown title/body start and side-only frame chrome', async () => {
  const styles = await read('public/styles.css');
  const surface = styles.match(/\.structured-text-page-surface\s*\{[^}]*\}/)?.[0] || '';
  const title = styles.slice(
    styles.indexOf('.structured-text-bound-title,'),
    styles.indexOf('}', styles.indexOf('.structured-text-bound-title,')) + 1
  );
  const boundary = styles.slice(
    styles.indexOf('.structured-text-page-boundary,'),
    styles.indexOf('}', styles.indexOf('.structured-text-page-boundary,')) + 1
  );
  const body = styles.match(/\.structured-text-page-body\s*\{[^}]*\}/)?.[0] || '';
  const editorHost = styles.match(
    /\.hn-text-editor-host,\s*\.hn-source-editor\s*\{[^}]*\}/
  )?.[0] || '';

  assert.match(surface, /min-height: 10rem;/);
  assert.match(surface, /padding: 2\.75rem var\(--markdown-text-frame-padding-inline\) 8rem;/);
  assert.doesNotMatch(surface, /clamp\(|vw/);
  assert.match(title, /margin: 0 0 1\.75rem;/);
  assert.match(title, /font-family: var\(--font-page-title-family\);/);
  assert.match(title, /font-size: clamp\(1\.9rem, calc\(var\(--font-page-body-size\) \* 2\.15\), 2\.75rem\);/);
  assert.match(title, /font-weight: 650;/);
  assert.match(title, /line-height: 1\.15;/);
  assert.match(body, /min-height: 7rem;/);
  assert.match(editorHost, /min-height: 7rem;/);
  assert.doesNotMatch(editorHost, /20rem/);
  assert.match(boundary, /height: 100%;/);
  assert.match(boundary, /border-right: 1px solid var\(--border-canvas\);/);
  assert.match(boundary, /border-left: 1px solid var\(--border-canvas\);/);
  assert.doesNotMatch(boundary, /border-(?:top|bottom):/);
  assert.match(boundary, /pointer-events: none;/);
  assert.doesNotMatch(styles, /\.cne-text-format-toolbar\s*\{/,
    'the temporary generic rich-text toolbar cannot displace the default body start');
});

test('the shared title is canonical Page.title while HN keeps source/session ownership', async () => {
  const [app, cne, sourceEditor, pageTypes] = await Promise.all([
    read('public/app.js'),
    read('public/js/hnTextPageView.js'),
    read('public/js/sourceCanonicalEditor.js'),
    read('public/pageTypes.js')
  ]);

  assert.match(app, /function applySavedPageTitle\(savedPage, \{ originRuntime = null \} = \{\}\)[^]*?structuredTextPageShell\?\.updateBoundTitles/);
  assert.match(app, /function commitFocusedPageTitleEditor\(\)[^]*?\.structured-text-bound-title\[contenteditable\]/);
  assert.match(app, /function beginNewPageTitleEditor\(runtime, page\)[^]*?PAGE_TYPES\.MARKDOWN[^]*?PAGE_TYPES\.HN_TEXT[^]*?focusBoundTitleForStage/);
  assert.match(cne, /return root\.sourceCanonicalEditor \|\| null/);
  assert.match(cne, /const presentationStrategy = sourceEditor\.createHnBasicPresentationStrategy\(\)/);
  assert.match(cne, /sourceEditor\.createSourceCanonicalEditor\(\{/);
  assert.match(cne, /presentationStrategy,/);
  assert.match(sourceEditor, /this\.session\.subscribe\(this\.viewId, subscriber\)/);
  assert.match(sourceEditor, /createIdentitySourceSnapshot\(source/);
  assert.match(sourceEditor, /this\.presentationStrategy\.createSourceSnapshot\(source/);
  assert.match(sourceEditor, /this\.presentationStrategy\.createPresentationPlan\(this\.sourceSnapshot/);
  assert.match(sourceEditor, /mode: this\.presentationStrategy\.projectionMode/);
  assert.match(sourceEditor, /this\.projection\.render\(this\.sourceSnapshot/);
  assert.match(cne, /shell\.updateBoundTitle\?\.\(state\.titleElement/);
  assert.doesNotMatch(cne, /ProseMirror|hnTextRuntime|createEditorView|EditorState|nodeViews/);
  assert.doesNotMatch(sourceEditor, /parseMarkdown|markdownRuntime|applyCanonicalEdit/);
  assert.doesNotMatch(cne, /cneText\.(?:document|documentState)[^\n]*title|title[^\n]*cneText\.(?:document|documentState)/);

  const hnRegistration = pageTypes.slice(
    pageTypes.indexOf('id: PAGE_TYPES.HN_TEXT'),
    pageTypes.indexOf('return Object.freeze', pageTypes.indexOf('id: PAGE_TYPES.HN_TEXT'))
  );
  assert.match(hnRegistration, /capabilities: \['page-edit', 'preview', 'structured-text'\]/);
  assert.match(cne, /const locked = sessionReadOnly\(state\.session, snapshot\)/);
  assert.match(cne, /state\.controller\?\.capabilities\?\.\(\)/);
  assert.match(cne, /shell\.setPageEditMode\?\.\(state\.stage, state\.pageEditMode\)/);
});

test('HN pointer and Object extent ownership remain scoped to the shared frame', async () => {
  const [shell, cne, canvas, pageTypes, markdown] = await Promise.all([
    read('public/js/structuredTextPageShell.js'),
    read('public/js/hnTextPageView.js'),
    read('public/js/canvasBlocks.js'),
    read('public/pageTypes.js'),
    read('public/markdownPage.js')
  ]);

  assert.match(shell, /function ownsPointer\(target\)[^]*?target\.closest\('\.structured-text-page-frame'\)/);
  assert.match(cne, /function hnTextPageOwnsPointer\(target\)[^]*?target\.closest\?\.\('\.hn-text-page-layer'\)[^]*?shell\.ownsPointer\(target\)/);
  assert.match(canvas, /if \(rendersHnText[^]*?const ownerStage = canvasStage;[^]*?stage: ownerStage[^]*?onDocumentExtentChange: \(\) => \{[^]*?refreshPaneStructuredTextWorldBounds\(runtime, ownerStage\)[^]*?const hnBounds = getHnTextDocumentBounds\(ownerStage\)[^]*?Math\.min\(runtime\.canvasBounds\.minX, hnBounds\.left\)[^]*?Math\.max\(runtime\.canvasBounds\.maxY, hnBounds\.bottom\)/);
  assert.match(cne, /function applySessionReadOnly\(state,[^]*?state\.controller\?\.setPageEditMode\?\.\(state\.pageEditMode\)[^]*?state\.layer\.dataset\.hnCanEdit/);
  assert.match(shell, /const bottom = Math\.max\([^]*?contentBottom,[^]*?objects\?\.maxY[^]*?\+ DOCUMENT_BOTTOM_PADDING/);
  assert.match(shell, /state\.boundary\.style\.height = `\$\{visual\.height\}px`/);
  assert.match(shell, /state\.extent\.style\.height = `\$\{next\.height\}px`[^]*?state\.frame\.style\.minHeight = `\$\{visual\.height\}px`/);

  const hnRegistration = pageTypes.slice(
    pageTypes.indexOf('id: PAGE_TYPES.HN_TEXT'),
    pageTypes.indexOf('return Object.freeze', pageTypes.indexOf('id: PAGE_TYPES.HN_TEXT'))
  );
  assert.doesNotMatch(hnRegistration, /capabilities:\s*\[[^\]]*'canvas'/);
  assert.match(markdown, /capabilities:\s*\[[^\]]*'canvas'/);
  assert.match(canvas, /function pageTypeOwnsCanvasObjectEdits\(runtime, page = runtime\.currentPage\)[^]*?pageTypeSupports\?\.\(page\?\.type, 'canvas'\)/);
  assert.match(canvas, /if \(runtime\.pageEditMode && pageTypeOwnsCanvasObjectEdits\(runtime\)\) \{[^]*?appendPageEditHandles\(layer\)/);
  assert.match(canvas, /function handlePageObjectPointerDown\(runtime, event\)[^]*?!pageTypeOwnsCanvasObjectEdits\(runtime\)/);
  assert.match(canvas, /function handlePageObjectContextMenu\(runtime, event\)[^]*?!pageTypeOwnsCanvasObjectEdits\(runtime\)/);
  assert.match(canvas, /runtime\.selectedPageObjectId = pageTypeOwnsCanvasObjectEdits\(runtime\)[^]*?\? selectObjectId[^]*?: null/);
});
