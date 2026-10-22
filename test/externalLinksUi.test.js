const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('Block Others and Resources External Links reuse the shared editor without Link Type semantics', async () => {
  const [html, app, ui, server] = await Promise.all([
    read('public/index.html'), read('public/app.js'), read('public/js/externalLinks.js'),
    read('server/appServer.js')
  ]);
  assert.match(html, /<span id="add-link-type-na"[^>]*hidden>Not applicable<\/span>/);
  assert.match(html, /id="add-link-others-button"[^>]*>Add<\/button>/);
  assert.match(html, /External Links[\s\S]*?id="external-links-add-button"[\s\S]*?>Add<\/button>/);
  assert.match(ui, /function createExternalLinkEditor\(/);
  assert.match(ui, /sourceBlockId: runtime\.addLinkTarget\?\.blockId \|\| null/);
  assert.match(ui, /sourceBlockId: context\.sourceBlockId/);
  assert.match(ui, /urlInput\.addEventListener\('focus',[\s\S]*?expandUrlEditor/);
  assert.match(ui, /urlInput\.addEventListener\('blur', collapseUrlEditor\)/);
  assert.match(ui, /position = 'fixed'|style\.position = 'fixed'/);
  assert.match(ui, /displayInput\.setAttribute\('aria-describedby', displayError\.id\)/);
  assert.match(ui, /urlInput\.setAttribute\('aria-describedby', targetError\.id\)/);
  assert.match(ui, /errors\.displayName/);
  assert.match(ui, /errors\.url/);
  assert.match(app, /clickableBlockTargets\(runtime, block\)/);
  assert.match(app, /addLinkTypeLabel\.removeAttribute\('for'\)/);
  assert.match(server, /page\.externalLinks = normalizeExternalLinks/);
  assert.doesNotMatch(server, /blocks\[\]\.links/);
});

test('External Link rows are sorted, open immediately, use Group 2.1 hover, and native context actions', async () => {
  const [ui, css, menu, preload] = await Promise.all([
    read('public/js/externalLinks.js'), read('public/styles.css'),
    read('desktop/nativeContextMenu.js'), read('desktop/preload.js')
  ]);
  assert.match(ui, /sort\(\(left, right\) =>[\s\S]*?compareVisibleNames/);
  assert.match(ui, /button\.addEventListener\('click', \(\) => openExternalLinkTarget\(runtime, link\)\)/);
  assert.match(css, /\.external-link-row:hover,[\s\S]*?background: var\(--surface-guide-section\)/);
  assert.match(menu, /case 'external-link':[\s\S]*?'Open'[\s\S]*?'Edit'[\s\S]*?'Delete'/);
  assert.match(preload, /openExternalLinkTarget:[\s\S]*?cne-desktop:open-external-link-target/);
});

test('anchored External Link row hover contributes transient Block state and clears at every replacement boundary', async () => {
  const [app, ui, sidebar, canvas] = await Promise.all([
    read('public/app.js'), read('public/js/externalLinks.js'),
    read('public/js/rightSidebar.js'), read('public/js/canvasBlocks.js')
  ]);
  assert.doesNotMatch(app, /let externalLinkHoveredBlockId = null/);
  assert.match(canvas, /function deriveBlockPresentationInteraction\([^]*?const requestedPresentationState = Math\.max\(/);
  assert.match(canvas, /function blockPresentationRequestKey\(runtime, block\)[^]*?runtime\.currentPage\?\.id[^]*?block\.id/);
  assert.match(canvas, /function setBlockState\(runtime, overlay, source, state\)[^]*?blockPresentationRequests\(runtime, overlay, block\)/);
  assert.match(ui, /function setExternalLinkBlockHover\(runtime, link, active\)[\s\S]*?runtime\.currentPage\?\.blocks[\s\S]*?block\.id === sourceBlockId[\s\S]*?setBlockState\(runtime, overlay, 'external-link-hover', BLOCK_STATE\.ACTIVE\)/);
  assert.match(ui, /function clearExternalLinkBlockHover\(runtime\)[\s\S]*?setBlockState\(runtime, overlay, 'external-link-hover', null\)/);
  assert.match(ui, /button\.addEventListener\('mouseenter', \(\) => setExternalLinkBlockHover\(runtime, link, true\)\)/);
  assert.match(ui, /button\.addEventListener\('mouseleave', \(\) => setExternalLinkBlockHover\(runtime, link, false\)\)/);
  assert.match(ui, /function renderExternalLinks\(runtime, page\) \{[\s\S]*?clearExternalLinkBlockHover\(runtime\);[\s\S]*?externalLinksList\.replaceChildren\(\)/);
  assert.match(ui, /function openSidebarExternalLinkEditor\(runtime, link = null\) \{[\s\S]*?clearExternalLinkBlockHover\(runtime\)/);
  assert.match(sidebar, /function setRightSidebarView[\s\S]*?clearExternalLinkBlockHover\(runtime\)/);
  assert.match(sidebar, /sectionId === 'external-links'[\s\S]*?clearExternalLinkBlockHover\(runtime\)/);
  assert.doesNotMatch(ui, /page\.blocks.*=.*external-link-hover|request\([\s\S]*?external-link-hover/);
});

test('External Link drop targets reuse the shared editor and narrow desktop file bridge', async () => {
  const [ui, css, preload, main, actions] = await Promise.all([
    read('public/js/externalLinks.js'), read('public/styles.css'), read('desktop/preload.js'),
    read('desktop/main.js'), read('desktop/externalLinkActions.js')
  ]);
  assert.match(ui, /function bindExternalLinkDropTarget\(element, contextKind\)/);
  assert.match(ui, /bindExternalLinkDropTarget\(externalLinksSectionBody, 'sidebar'\)/);
  assert.match(ui, /bindExternalLinkDropTarget\(externalLinkSidebarPopover, 'sidebar'\)/);
  assert.match(ui, /bindExternalLinkDropTarget\(addLinkPopover, 'block'\)/);
  assert.match(ui, /if \(runtime\.addLinkSelection !== 'external'\) activateBlockExternalLinkEditor\(runtime\)/);
  assert.match(ui, /runtime\.externalLinkEditorController\?\.applyDroppedTarget\(target\)/);
  assert.match(ui, /sourceBlockId = contextKind === 'block' \? runtime\.addLinkTarget\?\.blockId : null/);
  assert.match(ui, /if \(!state\.displayName\.trim\(\) && target\.displayName\)/);
  assert.match(ui, /displayNameAfterFileSelection\([\s\S]*?state\.fileName/);
  assert.doesNotMatch(ui, /document\.addEventListener\(['"](?:dragenter|dragover|dragleave|drop)['"]/);
  assert.match(css, /\.right-section-body\.is-external-link-drop-target,[\s\S]*?background: var\(--surface-guide-section\)/);
  assert.match(preload, /function registerDroppedExternalLinkFile\(files\)[\s\S]*?webUtils\.getPathForFile/);
  assert.match(preload, /cne-desktop:register-dropped-external-link-file/);
  assert.match(main, /REGISTER_DROPPED_EXTERNAL_LINK_FILE:[\s\S]*?register-dropped-external-link-file/);
  assert.match(actions, /async function registerDroppedExternalFile\(selectedPaths\)/);
  assert.match(actions, /stat\.isDirectory\(\)[\s\S]*?\.app/);
});
