const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createUndoManager } = require('../public/undoManager');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('shared Undo manager owns one context and clears redo after a branch', () => {
  const manager = createUndoManager();
  let value = 'A';
  manager.beginContext({ id: 'block-edit:page-a', type: 'block-edit', ownerId: 'page-a' });
  manager.execute({ undo: () => { value = 'A'; }, redo: () => { value = 'B'; } });
  manager.execute({ undo: () => { value = 'B'; }, redo: () => { value = 'C'; } });
  assert.equal(value, 'C');
  assert.equal(manager.undo(), true);
  assert.equal(value, 'B');
  manager.execute({ undo: () => { value = 'B'; }, redo: () => { value = 'D'; } });
  assert.equal(value, 'D');
  assert.equal(manager.canRedo(), false);
});

test('commit, cancel, and a new context make old commands unreachable', () => {
  const manager = createUndoManager();
  let value = 0;
  manager.beginContext({ id: 'one', type: 'block-edit', ownerId: 'page-a' });
  manager.execute({ undo: () => { value = 0; }, redo: () => { value = 1; } });
  manager.commitContext();
  assert.equal(manager.undo(), false);
  assert.equal(value, 1);

  manager.beginContext({ id: 'two', type: 'page-edit', ownerId: 'page-b' });
  manager.record({ undo: () => { value = 10; }, redo: () => { value = 20; } });
  manager.cancelContext();
  assert.equal(manager.redo(), false);
  assert.equal(manager.undo(), false);
});

test('Canvas edit gestures record completed snapshots and never pointermove entries', async () => {
  const [canvas, bootstrap, app] = await Promise.all([
    read('public/js/canvasBlocks.js'),
    read('public/js/appBootstrap.js'),
    read('public/app.js')
  ]);
  assert.match(canvas, /beforeBlocks: cloneBlocks\(runtime\.draftBlocks\)/);
  assert.match(canvas, /function finishBlockTransform\(runtime,[\s\S]*?recordDraftBlockChange\(runtime,/);
  assert.doesNotMatch(canvas.match(/function updateBlockTransform[\s\S]*?function finishBlockTransform/)?.[0] || '', /undoManager\.record/);
  assert.match(canvas, /beforeSnapshot: clonePageEditSnapshot\(runtime\)/);
  assert.match(canvas, /function finishPageObjectDrag\(runtime,[\s\S]*?recordPageEditChange\(runtime,/);
  assert.match(bootstrap, /finishBlockTransform\(runtime, event, false\)/);
  assert.match(bootstrap, /finishPageObjectDrag\(runtime, event, false\)/);
  assert.match(app, /deleteDraftBlock[\s\S]*?recordDraftBlockChange\(/);
});

test('editing lifecycles begin empty contexts and clear them only on save or cancel', async () => {
  const [canvas, descriptor] = await Promise.all([
    read('public/js/canvasBlocks.js'), read('public/js/descriptorModal.js')
  ]);
  for (const type of ['block-edit', 'page-edit']) {
    assert.match(canvas, new RegExp(`beginCanvasUndoContext\\(runtime, '${type}'\\)`));
  }
  assert.match(canvas, /function beginCanvasUndoContext\(runtime, type\)[\s\S]*?undoManager\.beginContext\(/);
  assert.match(canvas, /function saveBlockEdits\(runtime\)[\s\S]*?clearCanvasUndoContext\(runtime, \{ commit: true \}\)/);
  assert.match(canvas, /function cancelBlockEdits\(runtime\)[\s\S]*?clearCanvasUndoContext\(runtime\)/);
  assert.match(canvas, /function savePageEdits\(runtime\)[\s\S]*?clearCanvasUndoContext\(runtime, \{ commit: true \}\)/);
  assert.match(canvas, /function cancelPageEdits\(runtime\)[\s\S]*?clearCanvasUndoContext\(runtime\)/);
  assert.match(descriptor, /type: 'descriptor-edit'/);
  assert.match(descriptor, /if \(saved\) undoManager\.commitContext\(\)/);
  assert.match(descriptor, /undoManager\.cancelContext\(\)/);
});

test('Descriptor structural changes stay in the draft and persist only from Save', async () => {
  const descriptor = await read('public/js/descriptorModal.js');
  assert.match(descriptor, /performDescriptorGroupMove[\s\S]*?descriptorGroupsConfig = result\.config[\s\S]*?recordDescriptorChange\(before\)/);
  assert.match(descriptor, /commitDescriptorGroupRename[\s\S]*?recordDescriptorChange\(rename\.beforeSnapshot\)/);
  assert.match(descriptor, /deleteSelectedDescriptorGroup[\s\S]*?recordDescriptorChange\(before\)/);
  const descriptorSave = descriptor.match(
    /async function savePageMetaModal\(\)[\s\S]*?if \(modalOwner\.type !== 'category'\)/
  )?.[0] || '';
  assert.equal((descriptorSave.match(/request\(pageApiUrl\(pageId\)/g) || []).length, 1);
  assert.match(descriptorSave, /descriptorGroupsChanged \? \{ descriptorGroups: descriptorGroupsConfig \}/);
  assert.doesNotMatch(descriptorSave, /\/api\/(?:descriptor-groups|descriptors|vocabulary|page-index)/);
});

test('Undo keyboard routing preserves native editors and handles application contexts first', async () => {
  const [app, bootstrap, textEditing] = await Promise.all([
    read('public/app.js'), read('public/js/appBootstrap.js'), read('public/textEditing.js')
  ]);
  assert.match(app, /function applicationUndoShortcut[\s\S]*?key === 'z'[\s\S]*?key === 'y'/);
  assert.match(app, /isTextEditingElement\(event\.target\)[\s\S]*?undoManager\.undo\(\)[\s\S]*?undoManager\.redo\(\)/);
  assert.match(bootstrap, /shouldPreserveNativeEditing[\s\S]*?handleApplicationUndoRedo\(event\)[\s\S]*?if \(pageMetaModal\) return/);
  assert.match(textEditing, /'y'/);
});

test('committed Page title changes are one partial-write Undo and Redo transaction', async () => {
  const app = await read('public/app.js');
  assert.match(app, /function performPageTitleSave[\s\S]*?body: JSON\.stringify\(\{ title: uniqueTitle \}\)/);
  assert.match(app, /function applySavedPageTitle[\s\S]*?\.\.\.savedPage,[\s\S]*?\.\.\.latest,[\s\S]*?title: savedPage\.title/);
  assert.match(app, /function recordCommittedPageTitleChange[\s\S]*?type: 'page-title'[\s\S]*?undo: \(\) => runCommittedPageTitleHistoryMutation[\s\S]*?title: before[\s\S]*?redo: \(\) => runCommittedPageTitleHistoryMutation[\s\S]*?title: after/);
  assert.match(app, /async function saveMarkdownDocumentTitle[\s\S]*?await persistPageTitle[\s\S]*?recordCommittedPageTitleChange/);
  assert.match(app, /async function saveTitle\(runtime\)[\s\S]*?await persistPageTitle[\s\S]*?recordCommittedPageTitleChange/);
});

test('one title flush drains Canvas and Markdown saves and reports failures', async () => {
  const app = await read('public/app.js');
  assert.match(app, /const pageTitleSaveQueues = new Map\(\)/);
  assert.match(app, /const pendingPageTitleSaves = new Map\(\)/);
  assert.match(app, /function commitFocusedPageTitleEditor[\s\S]*?structuredTitle\.blur\(\)[\s\S]*?pageTitle\.blur\(\)/);
  assert.match(app, /async function flushPageTitleSavesNow[\s\S]*?commitFocusedPageTitleEditor\(\)[\s\S]*?Promise\.allSettled[\s\S]*?queuePageTitleSave\(intent\)[\s\S]*?ok: false/);
  assert.match(app, /globalThis\.flushPageTitleSavesNow = flushPageTitleSavesNow/);
  assert.match(app, /globalThis\.flushMarkdownTitleSavesNow = flushPageTitleSavesNow/);
});

test('Markdown preference flush reports a rejected persistence queue', async () => {
  const app = await read('public/app.js');
  assert.match(app, /let pendingMarkdownPreferenceSave = null/);
  assert.match(app, /function queueVaultMarkdownPreferenceIntent[\s\S]*?intent\.changes[\s\S]*?pendingMarkdownPreferenceSave === intent/);
  assert.match(app, /globalThis\.flushMarkdownPreferenceSavesNow = async \(\) => \{[\s\S]*?await markdownPreferenceSaveQueue[\s\S]*?queueVaultMarkdownPreferenceIntent\(intent\)[\s\S]*?ok: true[\s\S]*?ok: false/);
  assert.doesNotMatch(app, /flushMarkdownPreferenceSavesNow = \(\) => markdownPreferenceSaveQueue\.catch\(\(\) => \{\}\)/);
});

test('successful Page deletion discards every retryable Page save intent', async () => {
  const app = await read('public/app.js');
  assert.match(app, /function discardPagePersistenceState[\s\S]*?markdownBodySaveStates\.delete\(pageId\)[\s\S]*?clearPageTitleSaveState\(pageId\)[\s\S]*?discardInfoPanelSavesForPage[\s\S]*?canonicalPages\.delete\(pageId\)/);
  assert.match(app, /function applyDescriptorMetadataChangeSet[\s\S]*?for \(const deletedPageId of cumulativeDeletedPageIds\)[\s\S]*?discardPagePersistenceState\(deletedPageId\)/);
  assert.match(app, /async function deleteContextPage[\s\S]*?for \(const pageId of targetPageIds\)[\s\S]*?method: 'DELETE'/);
  assert.match(app, /async function deleteContextFolder[\s\S]*?for \(const pageId of pageIds\)[\s\S]*?method: 'DELETE'/);
  assert.doesNotMatch(app, /discardPagePersistenceState\(deleted\.deletedPageId \|\| pageId\)/);
});

test('Page Edit image import is one staged command with stable returned Object ids', async () => {
  const [app, desktop, server] = await Promise.all([
    read('public/app.js'), read('desktop/main.js'), read('server/appServer.js')
  ]);
  assert.match(app, /stageOnly: importIntoPageEdit/);
  assert.match(app, /const beforeSnapshot = clonePageEditSnapshot\(runtime\)[\s\S]*?for \(const object of importedObjects\)[\s\S]*?recordPageEditChange\(runtime,/);
  assert.match(desktop, /requestAddFileMutation\(runtime, pageId, files, placementCenter, stageOnly\)/);
  assert.match(server, /const stageOnly = req\.body\.stageOnly === true[\s\S]*?if \(!stageOnly\)[\s\S]*?await writeJson\(filePath, page\)/);
  assert.match(server, /function validatedObjectLayout[\s\S]*?allowSetChanges[\s\S]*?normalizeResourceLocation\(edit\)[\s\S]*?return validated/);
});
