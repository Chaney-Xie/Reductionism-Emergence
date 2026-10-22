const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('Pane Highlight menu owns multi-group view state and Pane-scoped actions', async () => {
  const [app, bootstrap, tabs, css] = await Promise.all([
    read('public/app.js'),
    read('public/js/appBootstrap.js'),
    read('public/sessionTabs.js'),
    read('public/styles.css')
  ]);
  assert.match(tabs, /checkedHighlightGroupIds: \[\]/);
  assert.match(app, /highlightMenuElement\.dataset\.paneRole = 'highlight-menu'/);
  assert.match(app, /function renderHighlightMenu\(runtime\)[^]*?const pane = getWorkspacePane\(runtime\.paneId\)/);
  assert.match(app, /checkbox\.addEventListener\('change'[^]*?toggleHighlightGroupForCurrentTab\(runtime,/);
  assert.match(app, /\['rename', 'Rename'\][^]*?\['adjust', 'Adjust'\][^]*?\['edit-info', 'Edit Info'\][^]*?\['delete', 'Delete'\]/);
  assert.match(app, /function prepareActiveTabHighlightState\(runtime\)[^]*?for \(const groupId of checkedGroupIds\)[^]*?runtime\.activeHighlightBlockIds\.add/);
  assert.match(bootstrap, /setHighlightMenuOpen\(runtime, runtime\.dom\.highlightMenu\?\.hidden\)/);
  assert.match(css, /\.highlight-menu \{[^]*?position: fixed/);
});

test('Highlight Group rename input keeps its full grid width and visible text paint', async () => {
  const [app, css] = await Promise.all([
    read('public/app.js'),
    read('public/styles.css')
  ]);
  assert.match(css, /\.highlight-group-toggle input\[type="checkbox"\] \{[^}]*width: 14px/);
  assert.doesNotMatch(css, /\.highlight-group-toggle input \{/);
  assert.match(css, /\.highlight-group-rename-input \{[^}]*min-width: 0;[^}]*width: 100%;[^}]*max-width: 100%;/);
  assert.match(css, /\.highlight-group-rename-input \{[^}]*color: var\(--system-text-level-1\);[^}]*opacity: 1;[^}]*caret-color: currentColor;[^}]*-webkit-text-fill-color: currentColor;[^}]*font: inherit;/);
  assert.match(css, /\.highlight-group-rename-input \{[^}]*padding: 0;[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/);
  assert.match(css, /\.highlight-group-rename-input:focus \{[^}]*outline: 0;[^}]*box-shadow: none;/);
  assert.match(app, /action === 'rename'[^]*?actions\.hidden = true;\s*more\.setAttribute\('aria-expanded', 'false'\);\s*beginHighlightGroupRename\(runtime, group, name\)/);
  assert.match(app, /nameElement\.replaceWith\(input\);\s*input\.focus\(\);\s*input\.select\(\);/);
  assert.match(app, /event\.key === 'Enter'[^]*?event\.preventDefault\(\);\s*event\.stopPropagation\(\);[^]*?finish\(true\)/);
  assert.match(app, /event\.key === 'Escape'[^]*?event\.preventDefault\(\);\s*event\.stopPropagation\(\);[^]*?finish\(false\)/);
  assert.match(app, /checkbox\.addEventListener\('change', \(\) => \{[^}]*?toggleHighlightGroupForCurrentTab\(runtime, group\.id, checkbox\.checked\);\s*\}\);/);
  assert.doesNotMatch(app, /checkbox\.addEventListener\('change'[^]*?toggleHighlightGroupForCurrentTab\(runtime, group\.id, checkbox\.checked\);\s*renderHighlightMenu\(runtime\)/);
});

test('Highlight view and edit use the required 1\/0 and 3\/2 Block states', async () => {
  const [app, canvas, bootstrap] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/js/appBootstrap.js')
  ]);
  assert.match(canvas, /case BLOCK_MODE\.HIGHLIGHT_VIEW:[^]*?activeHighlightMember[^]*?BLOCK_STATE\.DEFAULT[^]*?BLOCK_STATE\.HIDDEN/);
  assert.match(canvas, /case BLOCK_MODE\.HIGHLIGHT_EDIT:[^]*?semanticSelectedHighlightBlockIds\?\.has\?\.\(block\.id\)[^]*?BLOCK_STATE\.ACTIVE[^]*?BLOCK_STATE\.HIGHLIGHTED/);
  assert.match(canvas, /BLOCK_INTERACTION_KIND\.EDIT_HIGHLIGHT_MEMBERSHIP[^]*?toggleHighlightEditBlock\(runtime, target\.block\.id\)/);
  assert.match(app, /function beginNewHighlightGroup\(runtime\)[^]*?runtime\.currentPage[^]*?nextHighlightGroupName/);
  assert.match(app, /function beginAdjustHighlightGroup\(runtime, groupId\)[^]*?runtime\.currentPage[^]*?selectedBlockIds: highlightBlockIds\(group\)/);
  assert.match(app, /function finishHighlightEdit[^]*?draft\.preEditCheckedGroupIds\.filter\(\(groupId\) => groupId !== uncheckedGroupId\)/);
  assert.match(bootstrap, /runtime\.highlightEditDraft[^]*?saveHighlightEdits\(runtime\)[^]*?cancelHighlightEdits\(runtime\)/);
});

test('state-0 Blocks are excluded from hit testing and guarded at action entry points', async () => {
  const [app, canvas, pageObjects, externalLinks, css] = await Promise.all([
    read('public/app.js'),
    read('public/js/canvasBlocks.js'),
    read('public/pageObjects.js'),
    read('public/js/externalLinks.js'),
    read('public/styles.css')
  ]);
  assert.match(canvas, /function blockIsInteractive\(runtime, block\) \{\s*return currentBlockPresentationInteraction\(runtime, block\)\.interactive;/);
  assert.doesNotMatch(canvas, /function blockEffectiveState\(/);
  assert.match(canvas, /resolveOrdinaryBlockTarget\([^]*?\(object, localPoint\) => canvasObjectOpaqueAt\(runtime, object, localPoint\),\s*\(block\) => blockIsInteractive\(runtime, block\)\s*\)/);
  assert.match(canvas, /const disabled = ownedBlock \? !state\.interactive : hidden;\s*overlay\.disabled = disabled;\s*overlay\.tabIndex = disabled \? -1 : 0;/);
  assert.match(pageObjects, /function findBlockAtPoint\(object, blocks, point, acceptsBlock = \(\) => true\)/);
  assert.match(app, /function handleBlockClick\(runtime, event, block\) \{\s*if \(!runtimeIsLive\(runtime\) \|\| !blockIsInteractive\(runtime, block\)/);
  assert.match(app, /const block = runtime\.currentPage\?\.blocks\?\.find[^]*?if \(!block \|\| !blockIsInteractive\(runtime, block\)\) return;/);
  assert.match(externalLinks, /function openBlockLinkChoice\(runtime, block, anchor\) \{\s*closeBlockLinkChoicePopover\(\);\s*if \(runtime !== activePaneRuntime\(\) \|\| !blockIsInteractive\(runtime, block\)\) return;/);
  assert.match(css, /\.canvas-block-overlay\[data-state="0"\] \{[^}]*pointer-events: none;/);
  assert.match(canvas, /case BLOCK_MODE\.HIGHLIGHT_EDIT:[^]*?BLOCK_STATE\.ACTIVE[^]*?BLOCK_STATE\.HIGHLIGHTED/);
});

test('Highlight nonmembership clamps presentation requests without owning interaction', async () => {
  const canvas = await read('public/js/canvasBlocks.js');
  const start = canvas.indexOf('function deriveBlockPresentationInteraction(');
  const end = canvas.indexOf('\nfunction currentBlockPresentationInteraction(', start);
  assert.ok(start >= 0 && end > start);
  const boundary = canvas.slice(start, end);
  assert.match(boundary, /const requestedPresentationState = Math\.max\(/);
  assert.match(boundary, /mode === BLOCK_MODE\.HIGHLIGHT_VIEW[^]*?!activeHighlightMember[^]*?BLOCK_STATE\.HIDDEN/);
  assert.match(boundary, /interactive = activeHighlightMember;/);
  assert.doesNotMatch(boundary, /dataset|querySelector|classList|getComputedStyle|mask|opacity|pointer/i);
});

test('Highlight view renders one world-coordinate Group-3 mask with rotated union holes', async () => {
  const [canvas, css] = await Promise.all([
    read('public/js/canvasBlocks.js'),
    read('public/styles.css')
  ]);
  assert.match(canvas, /function highlightMaskableVisualRegions\(runtime, objects = runtime\.canvasObjects\)[^]*?object\.type === 'image'/);
  assert.match(canvas, /function highlightMaskExclusionRegions\([^]*?runtime\.activeHighlightBlockIds[^]*?pageObjectsModel\.rotatedRectPolygon\(block\)/);
  assert.match(canvas, /function renderHighlightMask\(runtime, blocks = runtime\.currentPage\?\.blocks \|\| \[\]\)[^]*?runtime\.blockVisualMode !== BLOCK_MODE\.HIGHLIGHT_VIEW[^]*?createElementNS\(namespace, 'mask'\)/);
  assert.match(canvas, /for \(const region of maskableRegions\)[^]*?createElementNS\(namespace, 'rect'\)[^]*?fill', 'white'/);
  assert.match(canvas, /for \(const region of exclusionRegions\)[^]*?createElementNS\(namespace, 'polygon'\)[^]*?fill', 'black'/);
  assert.match(canvas, /canvasStage\.append\(svg\);\s*canvasStage\.classList\.add\('has-highlight-mask'\)/);
  assert.match(canvas, /renderHighlightMask\(runtime, blocks\);/);
  assert.match(css, /--highlight-mask-opacity: 0\.68;/);
  assert.match(css, /\.canvas-highlight-mask \{[^}]*z-index: 2;[^}]*opacity: var\(--highlight-mask-opacity\);[^}]*pointer-events: none;/);
  assert.match(css, /\.canvas-highlight-mask-fill \{\s*fill: var\(--surface-canvas\);/);
  assert.match(css, /\.canvas-stage\.has-highlight-mask \.canvas-block-overlay \{\s*z-index: 3;/);
});

test('Edit Highlight reuses Block Edit confirm and mode badge UI without inline toolbar text', async () => {
  const [app, css] = await Promise.all([
    read('public/app.js'),
    read('public/styles.css')
  ]);
  assert.match(app, /highlightButton\.classList\.toggle\('edit-block-button', highlightEditing\)/);
  assert.match(app, /highlightButton\.classList\.toggle\('is-active', highlighted \|\| highlightEditing\)/);
  assert.doesNotMatch(app, /highlight-mode-label|highlightModeLabel/);
  assert.match(css, /\.canvas-area\.block-edit-mode::after,\s*\.canvas-area\.highlight-edit-mode::after\s*\{/);
  assert.match(css, /\.canvas-area\.block-edit-mode::after\s*\{\s*content: "Block edit mode";/);
  assert.match(css, /\.canvas-area\.highlight-edit-mode::after\s*\{\s*content: "Edit Highlight mode";/);
  assert.doesNotMatch(css, /\.highlight-mode-label/);
});

test('empty Highlight drafts are discarded and empty adjusted groups are deleted everywhere', async () => {
  const [app, server] = await Promise.all([
    read('public/app.js'),
    read('server/appServer.js')
  ]);
  assert.match(app, /draft\.isNew && validSelectedBlockIds\.length === 0[^]*?finishHighlightEdit\(draft\)/);
  assert.match(app, /removesExistingGroup[^]*?groups\.filter\(\(group\) => group\.id !== draft\.groupId\)/);
  assert.match(app, /removesExistingGroup\) clearHighlightGroupFromOpenTabViews\(draft\.pageId, draft\.id\)/);
  assert.match(server, /if \(blockIds\.length\) \{[^]*?validated\.push\(\{[^]*?id: group\.id,[^]*?name,[^]*?blockIds,[^]*?info:/);
});

test('saving a surviving adjusted Highlight preserves its Pane-local checked state', async () => {
  const app = await read('public/app.js');
  assert.match(
    app,
    /finishHighlightEdit\(draft, \{\s*uncheckedGroupId: removesExistingGroup \? draft\.id : null\s*\}\)/
  );
  assert.doesNotMatch(
    app,
    /finishHighlightEdit\(draft, \{ uncheckedGroupId: draft\.id \}\)/
  );
});

test('Highlight definitions persist canonically while checked IDs stay Tab-local', async () => {
  const [app, server] = await Promise.all([
    read('public/app.js'),
    read('server/appServer.js')
  ]);
  assert.match(app, /body: JSON\.stringify\(\{[^]*?highlightGroups:/);
  assert.match(app, /commitCanonicalPage\(savedPage, \{\s*originRuntime: ownerCurrent \? runtime : null\s*\}\)/);
  assert.match(app, /function clearHighlightGroupFromOpenTabViews[^]*?pane\.session\.tabs\(\)/);
  assert.match(server, /function validatedHighlightGroups\(groups, blocks = \[\], existingGroups = \[\]\)/);
  assert.match(server, /savesHighlightGroups = Object\.hasOwn\(req\.body, 'highlightGroups'\)/);
  assert.match(server, /else if \(savesBlocks\)[^]*?validatedHighlightGroups\(page\.highlightGroups, page\.blocks\)/);
});
