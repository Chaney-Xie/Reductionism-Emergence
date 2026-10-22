const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const acorn = require('acorn');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');

const downstreamPreviewHashes = Object.freeze({
  animateSharedPagePreviewReturn: 'e87e910a6a955e203ea77f1a122abc41289e56ca7167bc08d8354758648706a8',
  beginActiveTabReturnReconnect: '026e1ae2f094fb2eda2e502092188c848101b9d825b0272840115ae70c9a8f23',
  pagePreviewTabDropTarget: '7cf7c4ded5711ac362c8cb5ea9538e0edfc8860837ab38f2c441599238801258',
  hitTestSharedPageDropTarget: 'e5ef84228163d45a997b5ddbb2b818b16faedf7a1758eb3948a7cf0e8b966fd7',
  handoffSidebarPageDragToTabReorder: '2d8f453dbb4386c0611ee6fd2dc5d254a8963521e760be02ad3062250c5487c1',
  beginSidebarTabStripEntry: '77a58a42823772fa84e6b0c5aab1d3cd3a94ab4a8c3961d163340288479805d1',
  commitSidebarPageDrop: 'ba4aaa1f3d71c016ca65073dcfc879ba1e8890d83923e0cb73d4d97d1d36847a',
  // W-RENAME042 changed only the private Page Type enum spelling CNE_TEXT -> HN_TEXT.
  commitSharedPageToPaneEdge: '17ca735d24c41a2c842a18a7af615e2c40e7960a8c7404b8b350bc5f2d0672b1',
  detachTabReorder: '9e0c49eb309a7c25a1d73cecfc8ec120f16fbd12a974fd14b983e01003f56f4b',
  enterTabStripFromPreview: '209ee23f4c5cf722f71d5fe73146c3961c8f6d2eb602cebb359e259134a524f0',
  applySharedTabSortingVisuals: '0717d07a17b93ccf75bacbeb380b169ccfb1bc469fab76ab5ec4ff41f19718ca',
  beginTabReorderReturn: 'dfea3bbf18b8c79ea790a60d70695c05879ddc33d6f4eb058c470b120db37df3',
  workspacePaneDropRegions: 'd9c4950a22b9587c4b54f4314637912b7f67b5ecbf64a3ec8998b9616a7a5770',
  paneEdgeDropTarget: 'a8e20d80b436ac1aaaab8d2190f1201086a0de064a2f7fa8c0b720ab2e1b02c8',
  sharedPagePreviewCanTargetPane: '3cc8285726809a866d05712412ca344ee411016d06b27ba4b9cafb62aaab01f1'
});

test('the audit-frozen Pane hit-test, Page Preview, and Tab functions remain byte-exact', async () => {
  const source = await read('public/app.js');
  const program = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const declarations = new Map(program.body
    .filter((node) => node.type === 'FunctionDeclaration' && node.id?.name)
    .map((node) => [node.id.name, node]));

  for (const [name, expectedHash] of Object.entries(downstreamPreviewHashes)) {
    const node = declarations.get(name);
    assert.ok(node, `${name} must remain a top-level FunctionDeclaration`);
    const actualHash = crypto.createHash('sha256')
      .update(source.slice(node.start, node.end), 'utf8')
      .digest('hex');
    assert.equal(actualHash, expectedHash, `${name} changed below the approved boundary`);
  }
});

test('active Left Sidebar sources contain no retired sibling-reorder presentation or state', async () => {
  const [app, navigation, styles] = await Promise.all([
    read('public/app.js'),
    read('public/js/navigation.js'),
    read('public/styles.css')
  ]);
  const activeSidebarSources = `${app}\n${navigation}\n${styles}`;
  const retiredTokens = [
    'navInsertTarget',
    'nav-insert-indicator',
    '--nav-insert-depth',
    'navigationDisplaySortActive',
    'canInsertNavigationPayload',
    'sameInsertTarget',
    'setNavigationInsertTarget',
    'insertNavigationItem',
    'clearNavigationInsertTarget',
    'renderNavigationInsertIndicator',
    "area: 'pages'",
    "area: 'folders'"
  ];

  for (const token of retiredTokens) {
    assert.equal(activeSidebarSources.includes(token), false, `retired token remains active: ${token}`);
  }
  assert.doesNotMatch(navigation, /rect\.height \* 0\.28|afterCurrent|nextIndex = rootPages\.length/);
  assert.match(styles, /\.nav-folder\.is-drop-target > \.nav-folder-button/);
  assert.doesNotMatch(styles, /\.nav-folder\.is-invalid-drop-target > \.nav-folder-button/);
  assert.doesNotMatch(styles, /\.left-sidebar-scroll-region\.is-navigation-root-(?:drop-target|invalid-drop-target)/);
  assert.match(styles, /\.viewer-tab-strip\.is-page-preview-tab-drop-target::before/);
});
