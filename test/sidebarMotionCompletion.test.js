const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'public', 'js', 'navigation.js'), 'utf8');

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test('navigation mutation wiring delegates to the shared Sidebar motion coordinator', () => {
  const wiring = sliceBetween(
    navigation,
    'function captureSidebarNavigationMutation',
    'async function performNavigationBatchMove'
  );

  assert.match(wiring, /sidebarMembershipMoveAnimator\?\.captureMutation\(options\)/);
  assert.match(wiring, /sidebarMembershipMoveAnimator\.playMutation\([\s\S]*?renderPageList\(\{ sidebarMotionRender: true \}\)/);
  assert.match(wiring, /if \(!session\)[\s\S]*?renderPageList\(\{ sidebarMotionRender: true \}\)/);
  assert.doesNotMatch(wiring, /createCoordinator|request\(|navigation\s*=/);
});

test('successful New Page and New Folder creation enter at the canonical rendered position', () => {
  const createPage = sliceBetween(app, 'async function createNewPage', 'async function createNewFolder');
  const createFolder = sliceBetween(app, 'async function createNewFolder', 'async function confirmAddLinkNewPage');

  for (const [workflow, kind] of [[createPage, 'page'], [createFolder, 'folder']]) {
    const requestIndex = workflow.indexOf('const created = await request');
    const stateIndex = workflow.indexOf('navigation = created.navigation');
    const captureIndex = workflow.indexOf('captureSidebarNavigationMutation');
    const playIndex = workflow.indexOf('await playSidebarNavigationMutation');
    assert.ok(requestIndex >= 0 && requestIndex < stateIndex);
    assert.ok(stateIndex < captureIndex && captureIndex < playIndex);
    assert.match(workflow, new RegExp(`enteringItems: \\[\\{ type: '${kind}', id: created\\.${kind}\\.id \\}\\]`));
    assert.doesNotMatch(workflow, /\n\s*renderPageList\(\);/);
  }

  assert.ok(createPage.indexOf('await playSidebarNavigationMutation')
    < createPage.indexOf('beginNewPageTitleEditor(runtime, created.page)'));
  assert.ok(createFolder.indexOf('await playSidebarNavigationMutation')
    < createFolder.indexOf('startFolderRename(created.folder'));
});

test('successful Page and Folder deletion capture visible exits before canonical rerender', () => {
  const deletePage = sliceBetween(app, 'async function deleteContextPage', 'async function deleteContextFolder');
  const deleteFolder = sliceBetween(app, 'async function deleteContextFolder', 'async function deleteContextRelation');

  const pageDeleteRequest = deletePage.lastIndexOf("method: 'DELETE'");
  const pageCapture = deletePage.indexOf('captureSidebarNavigationMutation');
  const pagePlay = deletePage.indexOf('await playSidebarNavigationMutation');
  assert.ok(pageDeleteRequest >= 0 && pageDeleteRequest < pageCapture && pageCapture < pagePlay);
  assert.match(deletePage, /targetPageIds\.map\(\(id\) => \(\{ type: 'page', id \}\)\)/);
  assert.match(deletePage, /foldersToDelete\.map\(\(folder\) => \(\{ type: 'folder', id: folder\.id \}\)\)/);
  assert.doesNotMatch(deletePage, /\n\s*renderPageList\(\);/);

  const folderDeleteRequest = deleteFolder.indexOf('const deletedFolder = await request');
  const folderCapture = deleteFolder.indexOf('captureSidebarNavigationMutation');
  const folderPlay = deleteFolder.indexOf('await playSidebarNavigationMutation');
  assert.ok(folderDeleteRequest >= 0 && folderDeleteRequest < folderCapture && folderCapture < folderPlay);
  assert.match(deleteFolder, /\{ type: 'folder', id: folder\.id \}/);
  assert.match(deleteFolder, /decision\.deletePages[\s\S]*?pageIds\.map\(\(id\) => \(\{ type: 'page', id \}\)\)/);
  assert.doesNotMatch(deleteFolder, /\n\s*renderPageList\(\);/);
});

test('create/delete motion wiring does not replace navigation selection ownership', () => {
  assert.doesNotMatch(
    navigation,
    /navigationExplicitSelectionActive|setNavigationExplicitSelectionActive/
  );
  assert.match(navigation, /const enteringExplicitSelection = modifierSelection\s*&& !navigationExplicitSelectionMode/);
  assert.match(navigation, /if \(enteringExplicitSelection\)[\s\S]*?navigationExplicitSelectionMode = true/);
  assert.match(navigation, /'active', !navigationExplicitSelectionMode/);
});
