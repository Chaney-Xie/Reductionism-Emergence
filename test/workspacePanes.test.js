const test = require('node:test');
const assert = require('node:assert/strict');
const sessionTabs = require('../public/sessionTabs');
const workspacePanes = require('../public/workspacePanes');

test('workspace owns ordered symmetric Panes and one active Pane identity', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    createViewContext: (paneId) => ({ paneId })
  });
  const first = workspace.reset({ id: 'pane-a' });
  const second = workspace.addPane({ id: 'pane-b' });

  assert.deepEqual(workspace.state.panes.map((pane) => pane.id), ['pane-a', 'pane-b']);
  assert.equal(workspace.activePane(), first);
  assert.notEqual(first.session, second.session);
  assert.equal(workspace.activatePane('pane-b'), second);
  assert.equal(workspace.state.activePaneId, 'pane-b');
});

test('removing a Pane prefers its immediate right neighbour, then its left neighbour', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession()
  });
  workspace.reset({ id: 'left' });
  workspace.addPane({ id: 'middle' });
  workspace.addPane({ id: 'right' });

  workspace.activatePane('middle');
  const middleRemoval = workspace.removePane('middle');
  assert.equal(middleRemoval.pane.id, 'middle');
  assert.equal(middleRemoval.activePane.id, 'right');
  assert.deepEqual(workspace.state.panes.map((pane) => pane.id), ['left', 'right']);

  const rightRemoval = workspace.removePane('right');
  assert.equal(rightRemoval.activePane.id, 'left');
  assert.equal(workspace.removePane('left'), null);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.id), ['left']);
});

test('removing the last sibling restores the sole surviving Pane to expanded width', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 500,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  const survivor = workspace.reset({ id: 'survivor', width: 500 });
  workspace.addPane({ id: 'closing', width: 500 });
  workspace.collapsePane(survivor);

  workspace.removePane('closing');
  workspace.fitToWidth(1000);

  assert.equal(workspace.state.panes.length, 1);
  assert.equal(survivor.mode, 'expanded');
  assert.equal(survivor.width, 1000);
});

test('Pane sessions keep independent active Tabs, histories, and view state', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession()
  });
  const left = workspace.reset({ id: 'left' });
  const right = workspace.addPane({ id: 'right' });
  left.session.reset('page-a');
  right.session.reset('page-a');
  left.session.navigateActive('page-b', { mode: 'push' });
  left.session.saveViewState(left.session.activeTab().id, { panX: 10, zoom: 2 });
  right.session.saveViewState(right.session.activeTab().id, { panX: 90, zoom: 0.5 });

  assert.deepEqual(left.session.activeTab().history, ['page-a', 'page-b']);
  assert.deepEqual(right.session.activeTab().history, ['page-a']);
  assert.equal(left.session.activeTab().viewState.panX, 10);
  assert.equal(right.session.activeTab().viewState.panX, 90);
});

test('workspace width fitting shrinks proportionally, clamps, and collapses from the right', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 500,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  workspace.reset({ id: 'a' });
  workspace.addPane({ id: 'b' });
  workspace.addPane({ id: 'c' });

  workspace.fitToWidth(1000);
  assert.deepEqual(
    workspace.state.panes.map((pane) => Math.round(pane.width)),
    [333, 333, 333]
  );

  workspace.fitToWidth(800);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), [
    'expanded', 'expanded', 'collapsed'
  ]);
  assert.deepEqual(
    workspace.state.panes.map((pane) => Math.round(pane.width)),
    [380, 380, 40]
  );

  workspace.fitToWidth(1000);
  assert.deepEqual(
    workspace.state.panes.map((pane) => Math.round(pane.width)),
    [480, 480, 40]
  );
});

test('divider drag compresses the opposite side and collapses from its outer edge', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 400,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  workspace.reset({ id: 'a' });
  workspace.addPane({ id: 'b' });
  workspace.addPane({ id: 'c' });

  workspace.resizeAtDivider(0, 150);
  assert.deepEqual(
    workspace.state.panes.map((pane) => Math.round(pane.width)),
    [550, 300, 350]
  );

  const original = workspace.captureLayout();
  workspace.resizeAtDivider(0, 250);
  assert.equal(workspace.state.panes[2].mode, 'collapsed');
  assert.equal(Math.round(workspace.state.panes[2].width), 40);
  assert.equal(workspace.state.panes.reduce((sum, pane) => sum + pane.width, 0), 1200);
  workspace.restoreLayout(original);
  assert.deepEqual(workspace.captureLayout(), original);
});

test('divider overdrag holds Panes at minimum width until the outer collapse travel is crossed', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 400,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  workspace.reset({ id: 'a' });
  workspace.addPane({ id: 'b' });
  workspace.addPane({ id: 'c' });
  const overdragState = {
    compressSide: null,
    collapseOverdrag: 0,
    candidatePaneId: null,
    triggerDistance: 0
  };

  workspace.resizeAtDivider(0, 200, { overdragState });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.width), [600, 300, 300]);
  assert.equal(overdragState.collapseOverdrag, 0);

  workspace.resizeAtDivider(0, 259, { overdragState });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), [
    'expanded', 'expanded', 'expanded'
  ]);
  assert.equal(overdragState.candidatePaneId, 'c');
  assert.equal(overdragState.triggerDistance, 260);

  workspace.resizeAtDivider(0, -100, { overdragState });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.width), [600, 300, 300]);
  assert.equal(overdragState.collapseOverdrag, 159);
  workspace.resizeAtDivider(0, 100, { overdragState });
  assert.equal(overdragState.collapseOverdrag, 259);

  workspace.resizeAtDivider(0, 1, { overdragState });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), [
    'expanded', 'expanded', 'collapsed'
  ]);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.width), [860, 300, 40]);

  workspace.resizeAtDivider(0, -20, { overdragState });
  assert.equal(workspace.state.panes[2].mode, 'collapsed');
  assert.deepEqual(workspace.state.panes.map((pane) => pane.width), [840, 320, 40]);
});

test('leftward divider compression crosses the real threshold and collapses Panes left to right', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 400,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  workspace.reset({ id: 'a' });
  workspace.addPane({ id: 'b' });
  workspace.addPane({ id: 'c' });
  workspace.addPane({ id: 'd' });
  const overdragState = {
    compressSide: null,
    collapseOverdrag: 0,
    candidatePaneId: null,
    triggerDistance: 0
  };

  workspace.resizeAtDivider(2, -300, { overdragState });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.width), [300, 300, 300, 700]);

  workspace.resizeAtDivider(2, -259.99975, { overdragState });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), [
    'expanded', 'expanded', 'expanded', 'expanded'
  ]);
  assert.equal(overdragState.candidatePaneId, 'a');

  workspace.resizeAtDivider(2, -0.0005, { overdragState });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), [
    'collapsed', 'expanded', 'expanded', 'expanded'
  ]);
  assert.equal(overdragState.candidatePaneId, 'b');

  workspace.resizeAtDivider(2, -259.99975, { overdragState });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), [
    'collapsed', 'collapsed', 'expanded', 'expanded'
  ]);
  assert.equal(overdragState.candidatePaneId, 'c');

  const bulk = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 400,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  bulk.reset({ id: 'a' });
  bulk.addPane({ id: 'b' });
  bulk.addPane({ id: 'c' });
  bulk.addPane({ id: 'd' });
  const bulkOverdragState = {
    compressSide: null,
    collapseOverdrag: 0,
    candidatePaneId: null,
    triggerDistance: 0
  };
  bulk.resizeAtDivider(2, -820, { overdragState: bulkOverdragState });
  assert.deepEqual(bulk.captureLayout(), workspace.captureLayout());
});

test('divider overdrag expands only the adjacent collapsed Pane after substantial travel', () => {
  const makeOverdragState = () => ({
    compressSide: null,
    collapseOverdrag: 0,
    candidatePaneId: null,
    triggerDistance: 0,
    expansionPaneId: null,
    expansionDirection: 0,
    expansionOverdrag: 0,
    expansionTriggerDistance: 0,
    protectedExpandedPaneIds: []
  });
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 560,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  workspace.reset({ id: 'b', mode: 'collapsed' });
  workspace.addPane({ id: 'c', width: 560 });
  const rightward = makeOverdragState();

  workspace.resizeAtDivider(0, 259, { overdragState: rightward });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), ['collapsed', 'expanded']);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.width), [40, 560]);
  assert.equal(rightward.expansionPaneId, 'b');
  assert.equal(rightward.expansionTriggerDistance, 260);

  workspace.resizeAtDivider(0, -100, { overdragState: rightward });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.width), [40, 560]);
  assert.equal(rightward.expansionOverdrag, 159);
  workspace.resizeAtDivider(0, 101, { overdragState: rightward });
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), ['expanded', 'expanded']);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.width), [300, 300]);

  workspace.resizeAtDivider(0, -300, { overdragState: rightward });
  assert.equal(workspace.state.panes[0].mode, 'expanded');

  const mirrored = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 560,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  mirrored.reset({ id: 'a', width: 560 });
  mirrored.addPane({ id: 'b', mode: 'collapsed' });
  const leftward = makeOverdragState();
  mirrored.resizeAtDivider(0, -259, { overdragState: leftward });
  assert.deepEqual(mirrored.state.panes.map((pane) => pane.mode), ['expanded', 'collapsed']);
  mirrored.resizeAtDivider(0, -1, { overdragState: leftward });
  assert.deepEqual(mirrored.state.panes.map((pane) => pane.mode), ['expanded', 'expanded']);
  assert.deepEqual(mirrored.state.panes.map((pane) => pane.width), [300, 300]);
});

test('expanding a spine protects it while reclaiming width and Pane reorder preserves identity', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 300,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  const a = workspace.reset({ id: 'a' });
  const b = workspace.addPane({ id: 'b' });
  const c = workspace.addPane({ id: 'c' });
  b.session.reset('page-b');
  workspace.collapsePane(b);

  assert.equal(workspace.expandPane('b', 640), true);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), [
    'expanded', 'expanded', 'collapsed'
  ]);
  assert.equal(workspace.state.panes[1], b);
  assert.equal(b.session.activeTab().currentPageId, 'page-b');

  assert.equal(workspace.reorderPane('b', 0), true);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.id), ['b', 'a', 'c']);
  assert.equal(workspace.state.panes[0], b);
  assert.equal(workspace.state.panes[1], a);
  assert.equal(workspace.state.panes[2], c);
});

test('allocated Pane creation starts at minWidth and protects the new Pane from collapse', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 400,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 40
  });
  workspace.reset({ id: 'a' });
  workspace.addPane({ id: 'b' });

  const created = workspace.addPaneAllocated({ id: 'new', insertionIndex: 1 }, 700);
  assert.equal(created.mode, 'expanded');
  assert.equal(created.width, created.minWidth);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.id), ['a', 'new', 'b']);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.mode), [
    'expanded', 'expanded', 'collapsed'
  ]);
  assert.equal(Math.round(workspace.state.panes.reduce((sum, pane) => sum + pane.width, 0)), 700);
});

test('failed allocated Pane creation restores the previous Pane layout exactly', () => {
  const workspace = workspacePanes.createWorkspace({
    createSession: () => sessionTabs.createTabSession(),
    defaultWidth: 300,
    defaultMinWidth: 300,
    defaultCollapsedWidth: 100
  });
  workspace.reset({ id: 'a' });
  const before = workspace.captureLayout();
  const activeBefore = workspace.state.activePaneId;

  assert.equal(workspace.addPaneAllocated({ id: 'new' }, 350), null);
  assert.deepEqual(workspace.captureLayout(), before);
  assert.equal(workspace.state.activePaneId, activeBefore);
  assert.deepEqual(workspace.state.panes.map((pane) => pane.id), ['a']);
});
