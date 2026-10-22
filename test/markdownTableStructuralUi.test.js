const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const markdown = require('../public/markdownPage');
const {
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const fixture = [
  'Before exact.',
  '',
  '| Molecule | Role        | Compartment |',
  '| :------- | :---------: | ----------: |',
  '| ATP      | Energy      | Cytosol     |',
  '| DNA      | Information | Nucleus     |',
  '',
  'After exact.'
].join('\n');

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'styles.css'),
  'utf8'
);

const runtimeSource = () => fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
  'utf8'
);

const APPEND_CONTROL_CLASSES = [
  'markdown-table-add-column',
  'markdown-table-add-row'
];

function viewWithInternals(names = [], environment = {}) {
  return loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents',
    ...names
  ], environment);
}

function render(mode) {
  const view = viewWithInternals();
  const sourceSnapshot = markdown.createSourceSnapshot(fixture);
  const rendered = renderSemanticSegments(view, fixture, {
    mode,
    sourceSnapshot,
    sourceVersion: sourceSnapshot.version
  });
  const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
  return { view, rendered, nodes, sourceSnapshot };
}

function elements(nodes, className) {
  return nodes.filter((node) => (
    node?.nodeType === 1 && node.classList.contains(className)
  ));
}

function appendControls(nodes) {
  return APPEND_CONTROL_CLASSES.flatMap((className) => elements(nodes, className));
}

function tablePlan(sourceSnapshot, mode = 'live-preview') {
  const plan = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode
  });
  const validation = validateEditablePresentationPlan(plan, sourceSnapshot);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  return plan;
}

function styleRule(selector) {
  const marker = `${selector} {`;
  const start = styles.indexOf(marker);
  assert.notEqual(start, -1, `missing CSS rule for ${selector}`);
  const bodyStart = start + marker.length;
  const end = styles.indexOf('}', bodyStart);
  assert.notEqual(end, -1, `unterminated CSS rule for ${selector}`);
  return styles.slice(bodyStart, end);
}

function mountedLive(view, stateOverrides = {}) {
  const sourceSnapshot = markdown.createSourceSnapshot(fixture);
  const rendered = renderSemanticSegments(view, fixture, {
    mode: 'live-preview',
    sourceSnapshot,
    sourceVersion: sourceSnapshot.version,
    ...stateOverrides
  });
  const bodyRoot = new FakeElement();
  bodyRoot.append(...rendered.blocks.map((block) => block.element));
  rendered.state.bodyRoot = bodyRoot;
  const nodes = descendants(bodyRoot);
  const table = elements(nodes, 'markdown-page-table')[0];
  table.isConnected = true;
  return { rendered, bodyRoot, nodes, table };
}

function tableCell(nodes, rowIndex, columnIndex, { header = false } = {}) {
  return nodes.find((node) => node?.tagName === (header ? 'TH' : 'TD')
    && node.dataset.markdownTableRowIndex === String(header ? -1 : rowIndex)
    && node.dataset.markdownTableColumnIndex === String(columnIndex));
}

function makeContextTarget(cell) {
  const closest = cell.closest.bind(cell);
  cell.closest = (selector) => (
    selector.includes('th[data-markdown-table-column-index]') ? cell : closest(selector)
  );
  return cell;
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

test('Markdown table structural UI exists only in Live Preview and has no row/column handles', () => {
  const source = render('source');
  assert.equal(elements(source.nodes, 'markdown-page-table-source').length, 1);
  assert.equal(elements(source.nodes, 'markdown-page-table').length, 0);
  assert.equal(elements(source.nodes, 'markdown-page-table-shell').length, 0);
  assert.equal(appendControls(source.nodes).length, 0);

  const reading = render('reading');
  assert.equal(elements(reading.nodes, 'markdown-page-table-source').length, 0);
  assert.equal(elements(reading.nodes, 'markdown-page-table').length, 1);
  assert.equal(elements(reading.nodes, 'markdown-page-table-shell').length, 0);
  assert.equal(appendControls(reading.nodes).length, 0);

  const live = render('live-preview');
  const shell = elements(live.nodes, 'markdown-page-table-shell')[0];
  const table = elements(live.nodes, 'markdown-page-table')[0];
  assert.ok(shell);
  assert.ok(table);
  assert.equal(shell.contains(table), true);
  assert.equal(elements(live.nodes, 'markdown-table-column-selector').length, 0);
  assert.equal(elements(live.nodes, 'markdown-table-row-selector').length, 0);
  assert.notEqual(table.contentEditable, 'false', 'Live cells inherit body editing');
  const addColumn = elements(live.nodes, 'markdown-table-add-column')[0];
  const addRow = elements(live.nodes, 'markdown-table-add-row')[0];
  assert.equal(addColumn.parentElement, shell);
  assert.equal(addRow.parentElement, shell);
  assert.equal(addColumn.attributes['aria-label'], 'Append table column');
  assert.equal(addRow.attributes['aria-label'], 'Append table row');
  assert.equal(addColumn.listeners.get('click')?.length, 1);
  assert.equal(addRow.listeners.get('click')?.length, 1);
});

test('Table append controls remain external hit zones revealed only by themselves', () => {
  const shellRule = styleRule('.markdown-page-table-shell');
  assert.match(shellRule, /--markdown-table-append-zone-size:\s*\d+(?:\.\d+)?px/);
  assert.match(shellRule, /position:\s*relative/);
  assert.match(shellRule, /overflow:\s*visible/);

  const baseRule = styleRule('.markdown-table-add-control');
  assert.match(baseRule, /position:\s*absolute/);
  assert.match(baseRule, /opacity:\s*0/);
  assert.match(baseRule, /pointer-events:\s*auto/);
  assert.match(baseRule, /background:\s*transparent/);
  assert.match(baseRule, /box-shadow:\s*none/);

  const columnRule = styleRule('.markdown-table-add-column');
  assert.match(columnRule, /right:\s*calc\(-1\s*\*\s*var\(--markdown-table-append-zone-size\)\)/);
  assert.match(columnRule, /width:\s*var\(--markdown-table-append-zone-size\)/);
  assert.match(columnRule, /height:\s*auto/);

  const rowRule = styleRule('.markdown-table-add-row');
  assert.match(rowRule, /top:\s*100%/);
  assert.match(rowRule, /right:\s*0/);
  assert.match(rowRule, /left:\s*0/);
  assert.match(rowRule, /height:\s*var\(--markdown-table-append-zone-size\)/);

  const hoverRule = styleRule('.markdown-table-add-control:is(:hover, :focus-visible)');
  assert.match(hoverRule, /opacity:\s*1/);
  assert.match(hoverRule, /color:\s*var\(--accent-colour\)/);
  assert.doesNotMatch(
    styles,
    /\.markdown-page-table-shell:hover\s*>\s*\.markdown-table-add-control/
  );
});

test('Live Preview append controls are presentation-only and preserve canonical source', () => {
  for (const mode of ['source', 'live-preview', 'reading']) {
    const { rendered, nodes, sourceSnapshot } = render(mode);
    assert.equal(rendered.state.body, fixture, `${mode} canonical state stays byte-exact`);
    assert.equal(sourceSnapshot.markdownBody, fixture, `${mode} SourceSnapshot stays byte-exact`);
    if (mode !== 'reading') {
      const plan = tablePlan(sourceSnapshot, mode);
      assert.equal(
        plan.lines.map((line) => (
          line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
        )).join('').slice(0, fixture.length),
        fixture,
        `${mode} plan owns every canonical byte exactly once`
      );
      assert.deepEqual(
        plan.constructs.tables[0].controls.map((control) => control.kind),
        mode === 'live-preview' ? ['append-column', 'append-row'] : []
      );
    }
    if (mode !== 'live-preview') continue;
    const controls = appendControls(nodes);
    assert.equal(controls.length, 2);
    controls.forEach((control) => {
      assert.equal(control.dataset.markdownSemanticOnly, 'true');
      assert.equal(control.contentEditable, 'false');
    });
  }
});

test('Clicking either append zone commits one canonical transaction without selection state', () => {
  const cases = [
    ['markdown-table-add-column', 'append-column'],
    ['markdown-table-add-row', 'append-row']
  ];

  cases.forEach(([controlClass, operation]) => {
    const view = viewWithInternals();
    const commits = [];
    const inputs = [];
    const editHistory = view.createMarkdownEditHistory(fixture);
    const mounted = mountedLive(view, {
      page: { id: `append-${operation}` },
      editHistory,
      onBodyInput(payload) { inputs.push(payload); },
      onBodyCommit(payload) { commits.push(payload); }
    });
    const control = elements(mounted.nodes, controlClass)[0];
    let prevented = 0;
    let stopped = 0;
    control.listeners.get('click')[0]({
      preventDefault() { prevented += 1; },
      stopPropagation() { stopped += 1; }
    });

    const expected = markdown.applyMarkdownTableOperation(
      fixture,
      fixture.indexOf('| Molecule'),
      { type: operation }
    );
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    assert.equal(mounted.rendered.state.body, expected.source);
    assert.equal(Object.hasOwn(mounted.rendered.state, 'tableSelection'), false);
    assert.equal(inputs.length, 1);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].reason, 'table-structure');
    assert.equal(editHistory.undoStack.length, 1);
    assert.equal(editHistory.undoStack[0].inputType, 'formatTableStructure');
    assert.equal(editHistory.undoStack[0].beforeSource, fixture);
    assert.equal(editHistory.undoStack[0].afterSource, expected.source);
    assert.equal(mounted.rendered.state.sourceSnapshot.markdownBody, expected.source);
    const currentPlan = tablePlan(mounted.rendered.state.sourceSnapshot);
    assert.equal(currentPlan.sourceVersion, mounted.rendered.state.sourceVersion);
    assert.deepEqual(
      currentPlan.constructs.tables[0].controls.map((control) => control.kind),
      ['append-column', 'append-row'],
      'the canonical transaction regenerates the exact current table controls'
    );
  });
});

test('Live Preview table cells expose stable coordinates without selector controls', () => {
  const { nodes } = render('live-preview');
  const headers = nodes.filter((node) => node?.tagName === 'TH');
  const bodyCells = nodes.filter((node) => node?.tagName === 'TD'
    && node.classList.contains('markdown-source-construct'));
  assert.deepEqual(
    headers.map((cell) => [
      cell.dataset.markdownTableRowIndex,
      cell.dataset.markdownTableColumnIndex
    ]),
    [['-1', '0'], ['-1', '1'], ['-1', '2']]
  );
  assert.deepEqual(
    bodyCells.map((cell) => [
      cell.dataset.markdownTableRowIndex,
      cell.dataset.markdownTableColumnIndex
    ]),
    [
      ['0', '0'], ['0', '1'], ['0', '2'],
      ['1', '0'], ['1', '1'], ['1', '2']
    ]
  );
  assert.equal(elements(nodes, 'markdown-table-column-selector').length, 0);
  assert.equal(elements(nodes, 'markdown-table-row-selector').length, 0);
});

test('Ordinary left click stays on the normal editing path with no cell highlight', () => {
  const view = viewWithInternals(['handleMarkdownTablePointerDown']);
  const mounted = mountedLive(view);
  const cell = makeContextTarget(tableCell(mounted.nodes, 0, 1));
  let prevented = false;
  let stopped = false;
  assert.equal(view.handleMarkdownTablePointerDown(mounted.rendered.state, {
    target: cell,
    button: 0,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
  }), false);
  assert.equal(prevented, false);
  assert.equal(stopped, false);
  assert.equal(cell.classList.contains('is-table-context-anchor'), false);
  assert.equal(Object.hasOwn(mounted.rendered.state, 'tableSelection'), false);
  assert.match(
    runtimeSource(),
    /if \(handleMarkdownTablePointerDown\(state, event\)\) return;[\s\S]*?beginMarkdownSelectionGesture\(state, 'body', bodyRoot, event\)/,
    'an unclaimed cell pointerdown continues into ordinary caret/selection ownership'
  );
});

test('Live table caret affordances are box-neutral across active state', () => {
  const endCaretRule = styleRule('.markdown-editable-table-cell-end-caret');
  assert.match(endCaretRule, /display:\s*inline\s*;/);
  assert.doesNotMatch(
    endCaretRule,
    /inline-block|(?:^|;)\s*width\s*:|overflow\s*:|color\s*:\s*transparent/
  );

  const emptyCaretRule = styleRule('.markdown-editable-table-empty-cell');
  assert.match(emptyCaretRule, /color:\s*inherit\s*;/,
    'an empty cell keeps a visible native caret while its zero-width host stays glyph-free');

  const emptyCellStrut = styleRule(
    '.markdown-editable-table-presentation\n  [data-markdown-editable-table-cell-empty="true"]::before'
  );
  assert.match(emptyCellStrut, /content:\s*["']\\200b["']\s*;/i);

  const activeCellRule = styleRule(
    '.markdown-editable-table-presentation\n  [data-markdown-editable-table-cell-active="true"]'
  );
  assert.match(activeCellRule, /outline:\s*none\s*;/,
    'ordinary left-click editing exposes only the native caret, not a UA focus ring');
  assert.match(activeCellRule, /word-break:\s*break-word\s*;/,
    'active editable cells retain the inactive auto-table intrinsic width policy');

  const contextAnchorRule = styleRule('.is-table-context-anchor');
  assert.match(contextAnchorRule, /box-shadow:\s*inset/,
    'right-click structural feedback remains paint-only');
  assert.doesNotMatch(contextAnchorRule, /(?:^|;)\s*(?:padding|border|margin|width|height)\s*:/);
});

test('Reading and Source mode right click is unhandled and never creates an anchor', async () => {
  let nativeOpenCount = 0;
  const view = viewWithInternals(['openMarkdownTableContextMenu'], {
    globalThis: {
      nativeContextMenu: {
        available: () => true,
        open() {
          nativeOpenCount += 1;
          return Promise.resolve(null);
        }
      }
    }
  });
  for (const mode of ['reading', 'source']) {
    const cell = new FakeElement({ tagName: 'td' });
    let prevented = false;
    let stopped = false;
    const state = { mode, bodyReadOnly: false, pageEditMode: false };
    assert.equal(await view.openMarkdownTableContextMenu(state, {
      target: cell,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; }
    }), false);
    assert.equal(prevented, false, `${mode} preserves the non-structural context path`);
    assert.equal(stopped, false, `${mode} preserves event propagation`);
    assert.equal(cell.classList.contains('is-table-context-anchor'), false);
    assert.equal(state.tableContextMenuToken, undefined);
  }
  assert.equal(nativeOpenCount, 0);
});

test('Standalone Live Preview preserves the browser context menu when native menus are unavailable', async () => {
  const view = viewWithInternals(['openMarkdownTableContextMenu'], {
    globalThis: {
      nativeContextMenu: { available: () => false }
    }
  });
  const mounted = mountedLive(view);
  const cell = makeContextTarget(tableCell(mounted.nodes, 0, 1));
  let prevented = 0;
  let stopped = 0;
  assert.equal(await view.openMarkdownTableContextMenu(mounted.rendered.state, {
    target: cell,
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  }), false);
  assert.equal(prevented, 0);
  assert.equal(stopped, 0);
  assert.equal(cell.classList.contains('is-table-context-anchor'), false);
});

test('Every table menu ID maps directly to one cell-relative model command', () => {
  const view = viewWithInternals(['markdownTableCommandFromMenu']);
  const bodyCell = new FakeElement({
    tagName: 'td',
    dataset: { markdownTableRowIndex: '2', markdownTableColumnIndex: '1' }
  });
  const headerCell = new FakeElement({
    tagName: 'th',
    dataset: { markdownTableRowIndex: '-1', markdownTableColumnIndex: '0' }
  });
  const cases = [
    ['align-table-column-left', bodyCell, { type: 'set-alignment', columnIndex: 1, alignment: 'left' }],
    ['align-table-column-centre', bodyCell, { type: 'set-alignment', columnIndex: 1, alignment: 'center' }],
    ['align-table-column-right', bodyCell, { type: 'set-alignment', columnIndex: 1, alignment: 'right' }],
    ['insert-table-row-above', bodyCell, { type: 'insert-row', index: 2 }],
    ['insert-table-row-below', bodyCell, { type: 'insert-row', index: 3 }],
    ['insert-table-row-below', headerCell, { type: 'insert-row', index: 0 }],
    ['insert-table-column-left', bodyCell, { type: 'insert-column', index: 1 }],
    ['insert-table-column-right', bodyCell, { type: 'insert-column', index: 2 }],
    ['move-table-row-up', bodyCell, { type: 'move-row', fromIndex: 2, toIndex: 1 }],
    ['move-table-row-down', bodyCell, { type: 'move-row', fromIndex: 2, toIndex: 3 }],
    ['move-table-column-left', bodyCell, { type: 'move-column', fromIndex: 1, toIndex: 0 }],
    ['move-table-column-right', bodyCell, { type: 'move-column', fromIndex: 1, toIndex: 2 }],
    ['sort-table-rows-alpha-asc', bodyCell, {
      type: 'sort-rows', columnIndex: 1, sort: 'alphabetical', direction: 'asc'
    }],
    ['sort-table-rows-alpha-desc', bodyCell, {
      type: 'sort-rows', columnIndex: 1, sort: 'alphabetical', direction: 'desc'
    }],
    ['sort-table-rows-numeric-asc', bodyCell, {
      type: 'sort-rows', columnIndex: 1, sort: 'numeric', direction: 'asc'
    }],
    ['sort-table-rows-numeric-desc', bodyCell, {
      type: 'sort-rows', columnIndex: 1, sort: 'numeric', direction: 'desc'
    }],
    ['sort-table-columns-alpha-asc', headerCell, {
      type: 'sort-columns', rowIndex: -1, sort: 'alphabetical', direction: 'asc'
    }],
    ['sort-table-columns-alpha-desc', headerCell, {
      type: 'sort-columns', rowIndex: -1, sort: 'alphabetical', direction: 'desc'
    }],
    ['sort-table-columns-numeric-asc', bodyCell, {
      type: 'sort-columns', rowIndex: 2, sort: 'numeric', direction: 'asc'
    }],
    ['sort-table-columns-numeric-desc', bodyCell, {
      type: 'sort-columns', rowIndex: 2, sort: 'numeric', direction: 'desc'
    }]
  ];
  cases.forEach(([commandId, cell, expected]) => {
    assert.deepEqual({ ...view.markdownTableCommandFromMenu(commandId, cell) }, expected, commandId);
  });
  assert.equal(view.markdownTableCommandFromMenu('unknown-table-command', bodyCell), null);
});

test('Right click highlights only its cell while the native menu is pending and sends context', async () => {
  const menu = deferred();
  let request = null;
  const view = viewWithInternals(['openMarkdownTableContextMenu'], {
    globalThis: {
      nativeContextMenu: {
        available: () => true,
        open(_event, context) {
          request = context;
          return menu.promise;
        }
      }
    }
  });
  const mounted = mountedLive(view, { page: { id: 'cell-anchor' } });
  const cell = makeContextTarget(tableCell(mounted.nodes, 1, 0));
  let prevented = 0;
  let stopped = 0;
  const pending = view.openMarkdownTableContextMenu(mounted.rendered.state, {
    target: cell,
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  });

  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(cell.classList.contains('is-table-context-anchor'), true);
  assert.equal(
    mounted.nodes.filter((node) => node?.classList?.contains('is-table-context-anchor')).length,
    1
  );
  assert.deepEqual({ ...request }, {
    type: 'markdown-table-cell',
    targetId: `cell-anchor:${fixture.indexOf('| Molecule')}:1:0`,
    isHeader: false,
    isFirstColumn: true,
    isTopLeft: false,
    canMoveRowUp: true,
    canMoveRowDown: false,
    canMoveColumnLeft: false,
    canMoveColumnRight: true
  });

  menu.resolve(null);
  assert.equal(await pending, true);
  assert.equal(cell.classList.contains('is-table-context-anchor'), false);
  assert.equal(mounted.rendered.state.tableContextMenuToken, null);
  assert.equal(Object.hasOwn(mounted.rendered.state, 'tableSelection'), false);
});

test('A rejected native menu promise still clears its temporary cell anchor', async () => {
  const view = viewWithInternals(['openMarkdownTableContextMenu'], {
    globalThis: {
      nativeContextMenu: {
        available: () => true,
        open: () => Promise.reject(new Error('menu failed'))
      }
    }
  });
  const mounted = mountedLive(view);
  const cell = makeContextTarget(tableCell(mounted.nodes, 0, 2));
  const pending = view.openMarkdownTableContextMenu(mounted.rendered.state, {
    target: cell, preventDefault() {}, stopPropagation() {}
  });
  assert.equal(cell.classList.contains('is-table-context-anchor'), true);
  await assert.rejects(pending, /menu failed/);
  assert.equal(cell.classList.contains('is-table-context-anchor'), false);
  assert.equal(mounted.rendered.state.tableContextMenuToken, null);
});

test('Top-left Header context is explicit and retains the Header row coordinate', async () => {
  let request = null;
  const view = viewWithInternals(['openMarkdownTableContextMenu'], {
    globalThis: {
      nativeContextMenu: {
        available: () => true,
        open(_event, context) {
          request = context;
          return Promise.resolve(null);
        }
      }
    }
  });
  const mounted = mountedLive(view, { page: { id: 'top-left' } });
  const cell = makeContextTarget(tableCell(mounted.nodes, -1, 0, { header: true }));
  await view.openMarkdownTableContextMenu(mounted.rendered.state, {
    target: cell,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(request.isHeader, true);
  assert.equal(request.isFirstColumn, true);
  assert.equal(request.isTopLeft, true);
  assert.match(request.targetId, /:-1:0$/);
  assert.equal(cell.classList.contains('is-table-context-anchor'), false);
});

test('Ragged body columns use the canonical maximum column boundary', async () => {
  const requests = [];
  const view = viewWithInternals(['openMarkdownTableContextMenu'], {
    globalThis: {
      nativeContextMenu: {
        available: () => true,
        open(_event, context) {
          requests.push(context);
          return Promise.resolve(null);
        }
      }
    }
  });
  const source = [
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 | 3 | 4 |'
  ].join('\n');
  const rendered = renderSemanticSegments(view, source, { mode: 'live-preview' });
  const bodyRoot = new FakeElement();
  bodyRoot.append(...rendered.blocks.map((block) => block.element));
  rendered.state.bodyRoot = bodyRoot;
  const nodes = descendants(bodyRoot);
  const table = elements(nodes, 'markdown-page-table')[0];
  table.isConnected = true;

  for (const columnIndex of [2, 3]) {
    const cell = makeContextTarget(tableCell(nodes, 0, columnIndex));
    await view.openMarkdownTableContextMenu(rendered.state, {
      target: cell, preventDefault() {}, stopPropagation() {}
    });
  }
  assert.equal(requests.length, 2);
  assert.equal(requests[0].canMoveColumnRight, true);
  assert.equal(requests[1].canMoveColumnRight, false);
});

test('Superseded and cancelled menu promises cannot clear or execute a newer anchor', async () => {
  const menus = [deferred(), deferred()];
  let openIndex = 0;
  const view = viewWithInternals([
    'openMarkdownTableContextMenu',
    'cancelMarkdownTableInteractionState'
  ], {
    globalThis: {
      nativeContextMenu: {
        available: () => true,
        open() {
          return menus[openIndex++].promise;
        }
      }
    }
  });
  const commits = [];
  const mounted = mountedLive(view, {
    editHistory: view.createMarkdownEditHistory(fixture),
    onBodyCommit(payload) { commits.push(payload); }
  });
  const first = makeContextTarget(tableCell(mounted.nodes, 0, 1));
  const second = makeContextTarget(tableCell(mounted.nodes, 1, 2));
  const firstPending = view.openMarkdownTableContextMenu(mounted.rendered.state, {
    target: first, preventDefault() {}, stopPropagation() {}
  });
  const secondPending = view.openMarkdownTableContextMenu(mounted.rendered.state, {
    target: second, preventDefault() {}, stopPropagation() {}
  });
  assert.equal(first.classList.contains('is-table-context-anchor'), false);
  assert.equal(second.classList.contains('is-table-context-anchor'), true);

  menus[0].resolve('move-table-column-right');
  await firstPending;
  assert.equal(second.classList.contains('is-table-context-anchor'), true);
  assert.equal(mounted.rendered.state.body, fixture, 'stale menu cannot mutate source');
  assert.equal(commits.length, 0);

  assert.equal(view.cancelMarkdownTableInteractionState(mounted.rendered.state), true);
  assert.equal(second.classList.contains('is-table-context-anchor'), false);
  menus[1].resolve('move-table-column-left');
  await secondPending;
  assert.equal(mounted.rendered.state.body, fixture, 'cancelled menu cannot mutate source');
  assert.equal(commits.length, 0);
  assert.equal(view.cancelMarkdownTableInteractionState(mounted.rendered.state), false);
});

test('A context command clears its anchor and records exactly one canonical Undo transaction', async () => {
  const menu = deferred();
  const view = viewWithInternals(['openMarkdownTableContextMenu'], {
    globalThis: {
      nativeContextMenu: {
        available: () => true,
        open: () => menu.promise
      }
    }
  });
  const commits = [];
  const editHistory = view.createMarkdownEditHistory(fixture);
  const mounted = mountedLive(view, {
    page: { id: 'one-command' },
    editHistory,
    onBodyCommit(payload) { commits.push(payload); }
  });
  const cell = makeContextTarget(tableCell(mounted.nodes, 0, 1));
  const expected = markdown.applyMarkdownTableOperation(
    fixture,
    fixture.indexOf('| Molecule'),
    { type: 'move-column', fromIndex: 1, toIndex: 2 }
  );
  const pending = view.openMarkdownTableContextMenu(mounted.rendered.state, {
    target: cell, preventDefault() {}, stopPropagation() {}
  });
  assert.equal(cell.classList.contains('is-table-context-anchor'), true);
  menu.resolve('move-table-column-right');
  await pending;

  assert.equal(cell.classList.contains('is-table-context-anchor'), false);
  assert.equal(mounted.rendered.state.body, expected.source);
  assert.equal(commits.length, 1);
  assert.equal(editHistory.undoStack.length, 1);
  assert.equal(editHistory.undoStack[0].beforeSource, fixture);
  assert.equal(editHistory.undoStack[0].afterSource, expected.source);
  assert.equal(view.stepMarkdownEditHistory(editHistory, 'undo', expected.source).source, fixture);
  assert.equal(view.stepMarkdownEditHistory(editHistory, 'redo', fixture).source, expected.source);
  assert.equal(Object.hasOwn(mounted.rendered.state, 'tableSelection'), false);
});

test('Each sort menu command is one input, commit, history event, and exact Undo/Redo', async () => {
  const sortable = [
    '| Axis | C | A | B |',
    '| :--- | :--: | ---: | --- |',
    '| X | 7 | 2 | 5 |',
    '| Y | 2 | 5 | 7 |',
    '| Z | 5 | 7 | 2 |'
  ].join('\n');
  const cases = [
    ['sort-table-rows-alpha-asc', { type: 'sort-rows', columnIndex: 1, sort: 'alphabetical', direction: 'asc' }, true],
    ['sort-table-rows-alpha-desc', { type: 'sort-rows', columnIndex: 1, sort: 'alphabetical', direction: 'desc' }, true],
    ['sort-table-rows-numeric-asc', { type: 'sort-rows', columnIndex: 1, sort: 'numeric', direction: 'asc' }, true],
    ['sort-table-rows-numeric-desc', { type: 'sort-rows', columnIndex: 1, sort: 'numeric', direction: 'desc' }, true],
    ['sort-table-columns-alpha-asc', { type: 'sort-columns', rowIndex: 0, sort: 'alphabetical', direction: 'asc' }, false],
    ['sort-table-columns-alpha-desc', { type: 'sort-columns', rowIndex: 0, sort: 'alphabetical', direction: 'desc' }, false],
    ['sort-table-columns-numeric-asc', { type: 'sort-columns', rowIndex: 0, sort: 'numeric', direction: 'asc' }, false],
    ['sort-table-columns-numeric-desc', { type: 'sort-columns', rowIndex: 0, sort: 'numeric', direction: 'desc' }, false]
  ];

  for (const [commandId, operation, rowSort] of cases) {
    const inputs = [];
    const commits = [];
    const view = viewWithInternals(['openMarkdownTableContextMenu'], {
      globalThis: {
        nativeContextMenu: {
          available: () => true,
          open: () => Promise.resolve(commandId)
        }
      }
    });
    const editHistory = view.createMarkdownEditHistory(sortable);
    const rendered = renderSemanticSegments(view, sortable, {
      mode: 'live-preview',
      page: { id: commandId },
      editHistory,
      onBodyInput(payload) { inputs.push(payload); },
      onBodyCommit(payload) { commits.push(payload); }
    });
    const bodyRoot = new FakeElement();
    bodyRoot.append(...rendered.blocks.map((block) => block.element));
    rendered.state.bodyRoot = bodyRoot;
    const nodes = descendants(bodyRoot);
    const table = elements(nodes, 'markdown-page-table')[0];
    table.isConnected = true;
    const cell = makeContextTarget(rowSort
      ? tableCell(nodes, -1, 1, { header: true })
      : tableCell(nodes, 0, 0));
    const expected = markdown.applyMarkdownTableOperation(sortable, 0, operation);
    assert.equal(expected.changed, true, `${commandId} fixture must exercise a real reorder`);

    await view.openMarkdownTableContextMenu(rendered.state, {
      target: cell, preventDefault() {}, stopPropagation() {}
    });
    assert.equal(rendered.state.body, expected.source, commandId);
    assert.equal(cell.classList.contains('is-table-context-anchor'), false, commandId);
    assert.equal(inputs.length, 1, `${commandId}: one canonical body input`);
    assert.equal(commits.length, 1, `${commandId}: one persistence commit`);
    assert.equal(editHistory.undoStack.length, 1, `${commandId}: one Undo event`);
    assert.equal(editHistory.undoStack[0].inputType, 'formatTableStructure');
    assert.equal(view.stepMarkdownEditHistory(editHistory, 'undo', expected.source).source, sortable);
    assert.equal(view.stepMarkdownEditHistory(editHistory, 'redo', sortable).source, expected.source);
  }
});

test('Escape and every lifecycle exit route through the same temporary-anchor cleanup', () => {
  const source = runtimeSource();
  assert.match(
    source,
    /event\.key === 'Escape' && state\.tableContextMenuToken[\s\S]*?clearMarkdownTableContextAnchor\(state\)/
  );
  assert.match(source, /function renderState\(state\) \{\s*clearMarkdownTableContextAnchor\(state\)/);
  assert.match(
    source,
    /function destroyMarkdownPageLayer\(target\)[\s\S]*?clearMarkdownTableContextAnchor\(state\)/
  );
  assert.ok(
    (source.match(/clearMarkdownTableContextAnchor\(state\)/g) || []).length >= 8,
    'mode, page, read-only, render, Escape, cancel, and destroy all clear the anchor'
  );
});

test('obsolete row/column selection and Table drag implementation is absent', () => {
  const source = runtimeSource();
  [
    'createMarkdownTableSelector',
    'setMarkdownTableSelection',
    'clearMarkdownTableSelection',
    'applyMarkdownTableSelectionVisuals',
    'setMarkdownTableHoveredColumn',
    'tableDocumentPointerDown',
    'markdown-table-column-selector',
    'markdown-table-row-selector',
    'is-table-row-selected',
    'is-table-column-selected',
    'is-table-selection-first',
    'is-table-selection-last',
    'MARKDOWN_TABLE_DRAG_DISTANCE',
    'tableDrag',
    'markdown-table-drag-ghost',
    'markdown-table-insertion-indicator',
    'is-table-cell-selected'
  ].forEach((obsolete) => {
    assert.equal(source.includes(obsolete), false, `${obsolete} is absent from runtime`);
    assert.equal(styles.includes(obsolete), false, `${obsolete} is absent from styles`);
  });
  const sourceSnapshot = markdown.createSourceSnapshot(fixture);
  const table = tablePlan(sourceSnapshot).constructs.tables[0];
  assert.equal(Object.hasOwn(table, 'selection'), false,
    'the current table plan has no row/column selection state');
  assert.equal(Object.hasOwn(table, 'drag'), false,
    'the current table plan has no drag state');
  assert.deepEqual(table.controls.map((control) => control.kind), [
    'append-column',
    'append-row'
  ], 'the plan exposes only the approved structural controls');
  assert.match(styles, /\.is-table-context-anchor\s*\{/);
});
