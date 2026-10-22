#!/usr/bin/env node

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { ViewerV1Adapter } from './viewerV1.mjs';

const require = createRequire(import.meta.url);
const markdown = require('../../../../public/markdownPage');
const outputPath = path.resolve(
  process.argv[2] || '/private/tmp/viewer-table-live-preview-certification.json'
);
const source = [
  '| Name | Score |',
  '| --- | ---: |',
  '| A | 5 |',
  '| B | 8 |'
].join('\n');

const inspectExpression = `(() => {
  const body = document.querySelector('.workspace-pane.is-workspace-pane-active .markdown-page-body')
    || document.querySelector('.markdown-page-body');
  const layer = body?.closest('.markdown-page-layer');
  const diagnostic = body ? globalThis.markdownPageView?.editableProjectionSnapshot?.(body) : null;
  const plan = diagnostic?.presentationPlan || null;
  const tablePlan = plan?.constructs?.tables?.[0] || null;
  const selection = body ? globalThis.markdownPageView?.editableSelection?.(body) : null;
  const nativeSelection = getSelection();
  const nativeNode = nativeSelection?.focusNode || null;
  const nativeElement = nativeNode?.nodeType === Node.ELEMENT_NODE
    ? nativeNode : nativeNode?.parentElement;
  const nativeCell = nativeElement?.closest?.('th,td') || null;
  const canonical = canonicalPages.get(globalThis.__cneConformancePageId)?.markdownBody
    ?? currentPage?.markdownBody
    ?? '';
  return {
    preferenceMode: markdownPageModel.normalizeMarkdownMode(vaultPreferences.lastMarkdownMode),
    layerMode: layer?.classList.contains('is-live-preview') ? 'live-preview'
      : layer?.classList.contains('is-source') ? 'source'
        : layer?.classList.contains('is-reading') ? 'reading' : null,
    planMode: plan?.mode || null,
    activeOwnerIds: plan?.activeOwnerIds || [],
    tableActiveRaw: tablePlan?.activeRaw ?? null,
    plannedCellCount: tablePlan?.cells?.filter((cell) => cell.canonical).length || 0,
    renderedInteractiveTableCount: body?.querySelectorAll(
      '.markdown-editable-table-presentation .markdown-page-table'
    ).length || 0,
    editableCellCount: body?.querySelectorAll(
      '[data-markdown-editable-table-cell="true"]'
    ).length || 0,
    activeCellCount: body?.querySelectorAll(
      '[data-markdown-editable-table-cell-active="true"]'
    ).length || 0,
    activeProjectedCellCount: body?.querySelectorAll(
      '[data-markdown-editable-table-cell-active="true"] [data-markdown-projected-leaf="true"]'
    ).length || 0,
    semanticTableCount: body?.querySelectorAll('.markdown-page-table').length || 0,
    rawTableLeafCount: body?.querySelectorAll('.is-table-raw-source').length || 0,
    contextAnchorCount: body?.querySelectorAll('.is-table-context-anchor').length || 0,
    selection: selection ? {
      anchor: selection.anchor.offset,
      focus: selection.focus.offset,
      anchorVisibility: selection.anchor.visibility,
      focusVisibility: selection.focus.visibility,
      anchorPolicy: selection.anchor.interactionPolicy,
      focusPolicy: selection.focus.interactionPolicy
    } : null,
    nativeCell: nativeCell ? {
      tagName: nativeCell.tagName,
      rowIndex: nativeCell.dataset.markdownTableRowIndex,
      columnIndex: nativeCell.dataset.markdownTableColumnIndex,
      collapsed: nativeSelection?.isCollapsed === true
    } : null,
    canonicalSource: canonical,
    tableText: [...(body?.querySelectorAll(
      '.markdown-editable-table-presentation [data-markdown-editable-table-cell="true"]'
    ) || [])].map((cell) => String(cell.textContent || '').replaceAll('\u200b', '')),
    contextRequest: globalThis.__cneTableContextRequest || null,
    userAgent: navigator.userAgent
  };
})()`;

const cellPointExpression = (rowIndex, columnIndex, edge = 'start') => `(() => {
  const body = document.querySelector('.workspace-pane.is-workspace-pane-active .markdown-page-body')
    || document.querySelector('.markdown-page-body');
  const cell = body?.querySelector(
    '[data-markdown-editable-table-cell="true"]'
      + '[data-markdown-table-row-index="${rowIndex}"]'
      + '[data-markdown-table-column-index="${columnIndex}"]'
  );
  if (!cell) return null;
  const visibleTextNodes = [];
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const excluded = parent?.closest(
      '.markdown-editable-table-canonical-depot, .markdown-source-marker, '
        + '[aria-hidden="true"], button, [data-markdown-semantic-control="true"]'
    );
    if (!excluded && node.nodeValue && node.nodeValue !== '\u200b') {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) visibleTextNodes.push({ node, rect });
    }
    node = walker.nextNode();
  }
  const target = ${JSON.stringify(edge)} === 'end'
    ? visibleTextNodes.at(-1)
    : visibleTextNodes[0];
  if (!target) {
    const rect = cell.getBoundingClientRect();
    return {
      x: ${JSON.stringify(edge)} === 'end' ? rect.right - 2 : rect.left + 2,
      y: rect.top + (rect.height / 2),
      text: '',
      cellStart: Number(cell.dataset.markdownSourceStart),
      cellEnd: Number(cell.dataset.markdownSourceEnd)
    };
  }
  const { node: text, rect } = target;
  return {
    x: ${JSON.stringify(edge)} === 'end' ? rect.right - 0.25 : rect.left + 0.25,
    y: rect.top + (rect.height / 2),
    text: text.nodeValue,
    cellStart: Number(cell.dataset.markdownSourceStart),
    cellEnd: Number(cell.dataset.markdownSourceEnd)
  };
})()`;

const modeButtonPointExpression = `(() => {
  const button = document.querySelector('#markdown-mode-button');
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
})()`;

function assertLiveInteractive(checkpoint, expectedSource) {
  assert.equal(checkpoint.preferenceMode, 'live-preview');
  assert.equal(checkpoint.layerMode, 'live-preview');
  assert.equal(checkpoint.planMode, 'live-preview');
  assert.equal(checkpoint.tableActiveRaw, false);
  assert.equal(checkpoint.renderedInteractiveTableCount, 1);
  assert.equal(checkpoint.editableCellCount, checkpoint.plannedCellCount);
  assert.ok(checkpoint.editableCellCount > 0);
  assert.ok(checkpoint.activeCellCount === 0 || checkpoint.activeCellCount === 1);
  assert.equal(checkpoint.rawTableLeafCount, 0);
  assert.equal(checkpoint.canonicalSource, expectedSource);
}

async function inspect(adapter, name, expectedSource = null) {
  const value = await adapter.client.evaluate(inspectExpression, { timeoutMs: 25_000 });
  if (expectedSource != null) assert.equal(value.canonicalSource, expectedSource, name);
  return { name, ...value };
}

async function trustedCellClick(adapter, rowIndex, columnIndex, edge, button = 'left') {
  const point = await adapter.client.evaluate(
    cellPointExpression(rowIndex, columnIndex, edge),
    { timeoutMs: 25_000 }
  );
  assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y));
  await adapter.client.click({ x: point.x, y: point.y, button });
  await delay(180);
  return point;
}

async function trustedModeClick(adapter) {
  const point = await adapter.client.evaluate(modeButtonPointExpression, { timeoutMs: 25_000 });
  assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y));
  await adapter.client.click(point);
  await delay(240);
}

let adapter;
const checkpoints = [];
try {
  adapter = await ViewerV1Adapter.launch({
    sourceRoot: process.cwd(),
    label: 'table-live-preview-certification',
    keepArtifacts: false,
    settleMs: 180
  });
  await adapter.setup({
    id: 'table-live-preview-certification',
    initialSource: source,
    mode: 'live-preview',
    state: { active: false },
    initialSelection: { anchor: 0, focus: 0 }
  });

  const initial = await inspect(adapter, 'initial', source);
  assertLiveInteractive(initial, source);
  assert.equal(initial.activeCellCount, 0);
  checkpoints.push(initial);

  await trustedCellClick(adapter, 0, 0, 'start');
  const clickedA = await inspect(adapter, 'clicked-a', source);
  assertLiveInteractive(clickedA, source);
  assert.equal(clickedA.selection?.anchor, source.indexOf('| A |') + 2);
  assert.equal(clickedA.selection?.anchorPolicy, 'editable-table-cell');
  assert.equal(clickedA.contextAnchorCount, 0);
  assert.equal(clickedA.activeCellCount, 1);
  assert.ok(clickedA.activeProjectedCellCount > 0);
  checkpoints.push(clickedA);

  await adapter.client.typeText('X');
  await delay(220);
  const sourceAfterFirstEdit = source.replace('| A |', '| XA |');
  const editedA = await inspect(adapter, 'edited-a', sourceAfterFirstEdit);
  assertLiveInteractive(editedA, sourceAfterFirstEdit);
  assert.equal(editedA.selection?.anchorPolicy, 'editable-table-cell');
  assert.equal(editedA.activeCellCount, 1);
  checkpoints.push(editedA);

  await trustedCellClick(adapter, 1, 1, 'end');
  const clickedEight = await inspect(adapter, 'clicked-eight-end', sourceAfterFirstEdit);
  assertLiveInteractive(clickedEight, sourceAfterFirstEdit);
  assert.equal(clickedEight.selection?.anchorPolicy, 'editable-table-cell');
  assert.equal(clickedEight.nativeCell?.rowIndex, '1');
  assert.equal(clickedEight.nativeCell?.columnIndex, '1');
  assert.equal(clickedEight.activeCellCount, 1);
  checkpoints.push(clickedEight);

  await adapter.client.typeText('Y');
  await delay(220);
  const sourceAfterSecondEdit = sourceAfterFirstEdit.replace('| B | 8 |', '| B | 8Y |');
  const editedEight = await inspect(adapter, 'edited-eight', sourceAfterSecondEdit);
  assertLiveInteractive(editedEight, sourceAfterSecondEdit);
  checkpoints.push(editedEight);

  await adapter.dispatch({ type: 'undo' });
  const undoneEdit = await inspect(adapter, 'undo-cell-edit', sourceAfterFirstEdit);
  assertLiveInteractive(undoneEdit, sourceAfterFirstEdit);
  checkpoints.push(undoneEdit);

  await adapter.dispatch({ type: 'redo' });
  const redoneEdit = await inspect(adapter, 'redo-cell-edit', sourceAfterSecondEdit);
  assertLiveInteractive(redoneEdit, sourceAfterSecondEdit);
  checkpoints.push(redoneEdit);

  await trustedCellClick(adapter, 1, 1, 'end');
  await adapter.client.dispatchKey('Delete');
  await delay(180);
  const protectedForwardBoundary = await inspect(
    adapter,
    'protected-forward-cell-boundary',
    sourceAfterSecondEdit
  );
  assertLiveInteractive(protectedForwardBoundary, sourceAfterSecondEdit);
  checkpoints.push(protectedForwardBoundary);

  await adapter.client.dispatchKey('Backspace');
  await delay(220);
  const boundaryBackspace = await inspect(
    adapter,
    'boundary-backspace',
    sourceAfterFirstEdit
  );
  assertLiveInteractive(boundaryBackspace, sourceAfterFirstEdit);
  assert.equal(boundaryBackspace.activeCellCount, 1);
  checkpoints.push(boundaryBackspace);

  await adapter.dispatch({ type: 'undo' });
  const undoneBackspace = await inspect(
    adapter,
    'undo-boundary-backspace',
    sourceAfterSecondEdit
  );
  assertLiveInteractive(undoneBackspace, sourceAfterSecondEdit);
  checkpoints.push(undoneBackspace);

  await trustedCellClick(adapter, 0, 0, 'start');
  await adapter.client.dispatchKey('Backspace');
  await delay(180);
  const protectedBackwardBoundary = await inspect(
    adapter,
    'protected-backward-cell-boundary',
    sourceAfterSecondEdit
  );
  assertLiveInteractive(protectedBackwardBoundary, sourceAfterSecondEdit);
  checkpoints.push(protectedBackwardBoundary);

  await adapter.client.dispatchKey('Delete');
  await delay(220);
  const sourceAfterBoundaryDelete = sourceAfterSecondEdit.replace('| XA |', '| A |');
  const boundaryDelete = await inspect(
    adapter,
    'boundary-delete',
    sourceAfterBoundaryDelete
  );
  assertLiveInteractive(boundaryDelete, sourceAfterBoundaryDelete);
  assert.equal(boundaryDelete.activeCellCount, 1);
  checkpoints.push(boundaryDelete);

  await adapter.dispatch({ type: 'undo' });
  const undoneDelete = await inspect(
    adapter,
    'undo-boundary-delete',
    sourceAfterSecondEdit
  );
  assertLiveInteractive(undoneDelete, sourceAfterSecondEdit);
  checkpoints.push(undoneDelete);

  await trustedCellClick(adapter, 1, 1, 'start');
  const movedBeforeContext = await inspect(
    adapter,
    'second-cell-before-context',
    sourceAfterSecondEdit
  );
  assertLiveInteractive(movedBeforeContext, sourceAfterSecondEdit);
  assert.equal(movedBeforeContext.activeCellCount, 1);
  checkpoints.push(movedBeforeContext);

  await adapter.client.evaluate(`(() => {
    const original = globalThis.nativeContextMenu;
    globalThis.__cneOriginalNativeContextMenu = original;
    globalThis.__cneTableContextRequest = null;
    let resolveMenu;
    const pending = new Promise((resolve) => { resolveMenu = resolve; });
    globalThis.__cneResolveTableContextMenu = (command) => {
      resolveMenu(command);
      setTimeout(() => { globalThis.nativeContextMenu = original; }, 0);
    };
    globalThis.nativeContextMenu = {
      available: () => true,
      open: (_event, request) => {
        globalThis.__cneTableContextRequest = request;
        return pending;
      }
    };
    return true;
  })()`);
  await trustedCellClick(adapter, 0, 0, 'end', 'right');
  const pendingMenu = await inspect(adapter, 'right-click-menu-pending', sourceAfterSecondEdit);
  assertLiveInteractive(pendingMenu, sourceAfterSecondEdit);
  assert.equal(pendingMenu.contextAnchorCount, 1);
  assert.equal(pendingMenu.contextRequest?.type, 'markdown-table-cell');
  assert.equal(pendingMenu.contextRequest?.isHeader, false);
  assert.equal(pendingMenu.activeCellCount, 1,
    'right click keeps the existing edit cell and uses only a temporary context anchor');
  checkpoints.push(pendingMenu);

  const structural = markdown.applyMarkdownTableOperation(sourceAfterSecondEdit, 0, {
    type: 'insert-row',
    index: 1
  });
  assert.equal(structural.ok, true);
  assert.equal(structural.changed, true);
  await adapter.client.evaluate(
    `globalThis.__cneResolveTableContextMenu('insert-table-row-below')`
  );
  await delay(300);
  const structured = await inspect(adapter, 'context-command', structural.source);
  assertLiveInteractive(structured, structural.source);
  assert.equal(structured.contextAnchorCount, 0);
  assert.equal(structured.activeCellCount, 0);
  checkpoints.push(structured);

  await trustedModeClick(adapter);
  const sourceMode = await inspect(adapter, 'explicit-source', structural.source);
  assert.equal(sourceMode.preferenceMode, 'source');
  assert.equal(sourceMode.layerMode, 'source');
  assert.equal(sourceMode.planMode, 'source');
  assert.equal(sourceMode.tableActiveRaw, true);
  assert.equal(sourceMode.renderedInteractiveTableCount, 0);
  assert.ok(sourceMode.rawTableLeafCount > 0);
  checkpoints.push(sourceMode);

  await trustedModeClick(adapter);
  const readingMode = await inspect(adapter, 'explicit-reading', structural.source);
  assert.equal(readingMode.preferenceMode, 'reading');
  assert.equal(readingMode.layerMode, 'reading');
  assert.equal(readingMode.planMode, null);
  assert.equal(readingMode.renderedInteractiveTableCount, 0);
  assert.equal(readingMode.semanticTableCount, 1);
  assert.equal(readingMode.editableCellCount, 0);
  checkpoints.push(readingMode);

  await trustedModeClick(adapter);
  const returnedLive = await inspect(adapter, 'explicit-live-return', structural.source);
  assertLiveInteractive(returnedLive, structural.source);
  assert.equal(returnedLive.activeCellCount, 1,
    'returning to Live restores the canonical Source caret into one active semantic cell');
  checkpoints.push(returnedLive);

  const evidence = {
    ok: true,
    fixture: source,
    expected: {
      sourceAfterFirstEdit,
      sourceAfterSecondEdit,
      sourceAfterStructure: structural.source
    },
    packageFreshness: adapter.packageMetadata,
    checkpoints
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outputPath,
    checkpointCount: checkpoints.length,
    asarSha256: adapter.packageMetadata?.asarSha256 || null,
    freshnessCount: adapter.packageMetadata?.checked?.length || 0,
    userAgent: checkpoints[0]?.userAgent || null
  }, null, 2)}\n`);
} finally {
  await adapter?.close();
}
