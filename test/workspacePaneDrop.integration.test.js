const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('detached shared Page Preview resolves Tab strips before horizontal Pane edges', () => {
  const hitTest = app.slice(
    app.indexOf('function hitTestSharedPageDropTarget'),
    app.indexOf('function hitTestSidebarPageDropTarget')
  );
  assert.match(hitTest, /validSharedPreviewTabTarget/);
  assert.match(hitTest, /if \(tabTarget\) return tabTarget/);
  assert.match(hitTest, /sharedPagePreviewCanTargetPane/);
  assert.match(hitTest, /paneEdgeDropTarget/);
  assert.doesNotMatch(hitTest, /direction:\s*['"](?:top|bottom)['"]/);
});

test('Pane-edge registry follows ordered symmetric Panes and supports collapsed halves', () => {
  const regions = app.slice(
    app.indexOf('function workspacePaneDropRegions'),
    app.indexOf('function sharedPagePreviewCanTargetPane')
  );
  assert.match(regions, /workspace\.state\.panes\.map\(\(pane, index\)/);
  assert.match(regions, /pane\.mode === 'collapsed'/);
  assert.match(regions, /bounds\.left \+ bounds\.width \/ 2 \? 'left' : 'right'/);
  assert.match(regions, /direction === 'left' \? paneIndex : paneIndex \+ 1/);
  assert.doesNotMatch(regions, /workspace-pane-split|recursive/);
});

test('one Pane-edge commit route creates Sidebar Tabs or transfers existing Tab identity', () => {
  const commit = app.slice(
    app.indexOf('async function commitSharedPageToPaneEdge'),
    app.indexOf('function commitSharedPageDrag')
  );
  assert.match(commit, /state\.source\.type === 'tab'/);
  assert.match(commit, /state\.source\.type === 'sidebar-page'/);
  assert.match(commit, /destinationSession\.reset\(state\.pageId\)/);
  assert.match(commit, /sourceSession\.extractTab\(transferredTab\.id\)/);
  assert.match(commit, /destinationSession\.insertTab\(extracted\)/);
  assert.match(commit, /createAllocatedWorkspacePane\(destinationSession, target\.insertionIndex\)/);
  assert.match(commit, /historyMode: 'preserve'/);
});

test('Pane creation and spine expansion share one protected width allocator', () => {
  const model = fs.readFileSync(path.join(root, 'public', 'workspacePanes.js'), 'utf8');
  const allocation = model.slice(
    model.indexOf('function allocateProtectedExpandedPane'),
    model.indexOf('function reorderPane')
  );
  assert.match(allocation, /function expandPane[\s\S]*?allocateProtectedExpandedPane\(pane, availableWidth\)/);
  assert.match(allocation, /function addPaneAllocated[\s\S]*?allocateProtectedExpandedPane\(pane, availableWidth\)/);
});

test('Pane-edge indicators use one four-sided translucent Accent rectangle without a helper line', () => {
  assert.match(app, /workspace-pane-edge-drop-indicator/);
  const indicatorRule = styles.match(/\.workspace-pane-edge-drop-indicator \{([^}]*)\}/)?.[1] || '';
  assert.match(indicatorRule, /position: fixed/);
  assert.match(indicatorRule, /border: 1px solid color-mix\(in srgb, var\(--accent-colour\) 58%, transparent\)/);
  assert.match(indicatorRule, /background: color-mix\(in srgb, var\(--accent-colour\) 11%, transparent\)/);
  assert.match(indicatorRule, /box-shadow: inset 0 0 0 2px color-mix\(in srgb, var\(--accent-colour\) 42%, transparent\)/);
  assert.match(indicatorRule, /pointer-events: none/);
  assert.equal((indicatorRule.match(/border:/g) || []).length, 1);
  assert.doesNotMatch(indicatorRule, /var\(--border-(?:tool|canvas)\)/);
  assert.doesNotMatch(styles, /\.workspace-pane-edge-drop-indicator::(?:before|after)/);
  assert.doesNotMatch(app, /--pane-drop-boundary-x/);
  assert.doesNotMatch(styles, /workspace-pane-edge-drop-indicator\.is-(top|bottom)/);

  assert.match(styles, /\.workspace-pane \+ \.workspace-pane \{[^}]*border-left: 1px solid var\(--border-canvas\)/);
  assert.match(styles, /\.workspace-pane-root:has\(\.workspace-pane \+ \.workspace-pane\)[^}]*var\(--border-tool\)/);
});
