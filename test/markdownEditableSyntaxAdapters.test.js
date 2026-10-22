'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  API_GAPS,
  INTEGRATION_REQUIREMENTS,
  SEMANTIC_PRESENTATION_KEYS,
  buildEditablePresentationPlan,
  recoverMarkdownLinkSemantics,
  validateEditablePresentationPlan,
  mathSourceRange
} = require('../public/js/markdownEditableSyntaxAdapters');

function snapshot(source) {
  return markdown.createSourceSnapshot(source);
}

function plan(source, mode = 'live-preview', options = {}) {
  const sourceSnapshot = snapshot(source);
  return {
    snapshot: sourceSnapshot,
    plan: buildEditablePresentationPlan(sourceSnapshot, {
      model: markdown,
      mode,
      ...options
    })
  };
}

function lineAt(result, index) {
  return result.lines.find((line) => line.index === index);
}

function leavesForRange(result, start, end) {
  return result.lines.flatMap((line) => line.leaves).filter((leaf) => (
    leaf.sourceStart < end && start < leaf.sourceEnd
  ));
}

function assertCanonicalLeaves(result, source) {
  const validation = validateEditablePresentationPlan(result, { markdownBody: source });
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  result.lines.forEach((line) => {
    assert.equal(
      line.leaves.map((leaf) => leaf.text).join(''),
      source.slice(line.start, line.contentEnd),
      `physical line ${line.index} must be covered by exact canonical slices`
    );
    line.leaves.forEach((leaf) => {
      assert.equal(leaf.text, source.slice(leaf.sourceStart, leaf.sourceEnd));
    });
  });
}

function parserLinkNodes(sourceSnapshot) {
  const links = [];
  const visit = (node) => {
    if (node?.type === 'link' || node?.type === 'linkReference') links.push(node);
    (node?.children || []).forEach(visit);
  };
  visit(sourceSnapshot.parserAst);
  return links;
}

test('source plan is immutable, byte-exact, CRLF/blank/terminal aware, and reports current API gaps', () => {
  const source = 'alpha\r\n\r\nomega\r\n';
  const { snapshot: sourceSnapshot, plan: result } = plan(source, 'source');

  assertCanonicalLeaves(result, source);
  assert.deepEqual(result.lines.map((line) => line.text), ['alpha', '', 'omega', '']);
  assert.deepEqual(result.lines.map((line) => line.lineEnding), ['\r\n', '\r\n', '\r\n', '']);
  assert.ok(result.lines.flatMap((line) => line.leaves)
    .every((leaf) => leaf.visibility === 'visible'));
  assert.equal(result.sourceVersion, sourceSnapshot.version);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.lines), true);
  assert.deepEqual(result.apiGaps, [], 'the editable adapter contract has no unresolved API gap');
  assert.deepEqual(result.apiGaps, API_GAPS);
  assert.deepEqual(result.integrationRequirements, INTEGRATION_REQUIREMENTS);
  assert.deepEqual(INTEGRATION_REQUIREMENTS, [
    'projected-leaf-registration',
    'position-visibility-policy',
    'ensure-position-visible-before-restoration',
    'semantic-control-pointer-bypass'
  ]);
});

test('unordered and task rows have row-local Source, inactive Live, and active Live policies', () => {
  const source = [
    '- Parent',
    '\t- **Child**',
    '- [ ] todo',
    '\t- [X] done'
  ].join('\n');
  const sourceSnapshot = snapshot(source);
  const inactive = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const rows = inactive.constructs.listRows;

  assertCanonicalLeaves(inactive, source);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => ({
    kind: row.kind,
    depth: row.depth,
    tabs: row.tabs,
    task: row.task,
    checked: row.checked,
    marker: source.slice(row.markerStart, row.markerEnd),
    content: source.slice(row.contentStart, row.contentEnd)
  })), [
    { kind: 'unordered-list-row', depth: 1, tabs: '', task: false, checked: null,
      marker: '- ', content: 'Parent' },
    { kind: 'unordered-list-row', depth: 2, tabs: '\t', task: false, checked: null,
      marker: '\t- ', content: '**Child**' },
    { kind: 'task-list-row', depth: 1, tabs: '', task: true, checked: false,
      marker: '- [ ] ', content: 'todo' },
    { kind: 'task-list-row', depth: 2, tabs: '\t', task: true, checked: true,
      marker: '\t- [X] ', content: 'done' }
  ]);
  rows.forEach((row) => {
    assert.deepEqual({ ...row.presentation }, {
      sourceVisible: false,
      renderedMounted: true,
      layout: 'rendered-prefix-source-content',
      role: row.task ? 'task-list-row' : 'unordered-list-row',
      tagName: 'span'
    });
    assert.equal(row.activationAnchor.offset, row.contentStart);
    const line = inactive.lines[row.lineIndex];
    const marker = line.leaves.find((leaf) => leaf.sourceStart === row.markerStart);
    assert.equal(marker.visibility, 'activatable');
    assert.equal(marker.interactionPolicy, 'activate-list-row');
    assert.equal(line.metadata.listRow.depth, row.depth);
    assert.equal(line.metadata.listRow.task, row.task);
  });
  assert.deepEqual(inactive.controls.map((control) => ({
    kind: control.kind,
    checked: control.checked,
    source: source.slice(control.sourceStart, control.sourceEnd)
  })), [
    { kind: 'toggle-task-list-item', checked: false, source: ' ' },
    { kind: 'toggle-task-list-item', checked: true, source: 'X' }
  ]);
  const nestedStrong = inactive.constructs.strong[0];
  assert.ok(nestedStrong, 'row-local list decoration preserves nested inline semantics');
  assert.equal(nestedStrong.contentSource, 'Child');

  const active = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [rows[1].ownerId]
  });
  assert.equal(active.constructs.listRows[0].presentation.sourceVisible, false);
  assert.equal(active.constructs.listRows[1].presentation.sourceVisible, true);
  assert.equal(active.constructs.listRows[2].presentation.sourceVisible, false);
  assert.equal(active.lines[1].leaves[0].text, '\t- ');
  assert.equal(active.lines[1].leaves[0].visibility, 'visible');
  assert.ok(active.lines[1].leaves.slice(1).some((leaf) => (
    leaf.visibility === 'activatable'
  )), 'independently inactive inline syntax keeps its own marker policy');
  assert.equal(active.lines[0].leaves[0].visibility, 'activatable');

  const sourceMode = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'source'
  });
  assert.equal(sourceMode.controls.length, 0);
  assert.ok(sourceMode.constructs.listRows.every((row) => (
    row.presentation.sourceVisible && !row.presentation.renderedMounted
  )));
  assert.ok(sourceMode.lines.flatMap((line) => line.leaves)
    .every((leaf) => leaf.visibility === 'visible'));
});

test('malformed tasks remain ordinary unordered rows and fenced markers stay ordinary code', () => {
  const source = ['- [ ]missing', '- [y] item', '```', '- [ ] fenced', '```'].join('\n');
  const result = plan(source).plan;
  assertCanonicalLeaves(result, source);
  assert.deepEqual(result.constructs.listRows.map((row) => ({
    lineIndex: row.lineIndex,
    task: row.task,
    content: row.contentSource
  })), [
    { lineIndex: 0, task: false, content: '[ ]missing' },
    { lineIndex: 1, task: false, content: '[y] item' }
  ]);
});

test('empty unordered and task rows anchor to the declared terminal position', () => {
  ['- ', '- [ ] ', '- [x] ', '- [X] '].forEach((source) => {
    const result = plan(source).plan;
    const row = result.constructs.listRows[0];
    assert.ok(row);
    assert.equal(row.contentStart, source.length);
    assert.equal(row.activationAnchor.offset, source.length);
    assert.equal(row.activationAnchor.affinity, 'before');
    assert.equal(
      row.activationAnchor.physicalLineId,
      result.lines[0].physicalLineId
    );
    assertCanonicalLeaves(result, source);
  });
});

test('strict Tab-depth list rows suppress an overlapping parser indented-code presentation', () => {
  [
    { source: '\t- A', kind: 'unordered-list-row', controls: 0 },
    { source: '\t- [ ] task', kind: 'task-list-row', controls: 1 },
    { source: '\t- [ ] ', kind: 'task-list-row', controls: 1 }
  ].forEach(({ source, kind, controls }) => {
    const result = plan(source).plan;
    assert.equal(result.constructs.listRows.length, 1);
    assert.equal(result.constructs.listRows[0].kind, kind);
    assert.equal(result.constructs.codeBlocks.length, 0);
    assert.equal(result.controls.length, controls);
    assertCanonicalLeaves(result, source);
  });
});

test('quote plan uses parser ancestry for depth, exact physical prefixes, lazy rows, and fence exclusion', () => {
  const source = [
    '> > Alpha',
    'continued',
    '',
    '```',
    '> not quote',
    '```',
    '',
    '> Beta'
  ].join('\n');
  const { snapshot: sourceSnapshot, plan: inactive } = plan(source);
  const quotes = inactive.constructs.quotes;

  assertCanonicalLeaves(inactive, source);
  assert.deepEqual(quotes.map((quote) => quote.lineIndex), [0, 1, 7]);
  assert.deepEqual(quotes.map((quote) => quote.depth), [2, 2, 1]);
  assert.deepEqual(quotes.map((quote) => quote.prefix), ['> > ', '', '> ']);
  assert.deepEqual(quotes.map((quote) => quote.prefixDepth), [2, 0, 1]);
  const prefixProbe = snapshot('   > >  value').quoteLineIndex.lines[0].presentationPrefix;
  assert.deepEqual({
    depth: prefixProbe.depth,
    start: prefixProbe.start,
    end: prefixProbe.end,
    raw: prefixProbe.raw,
    markerOffsets: [...prefixProbe.markerOffsets]
  }, {
    depth: 2,
    start: 0,
    end: 7,
    raw: '   > > ',
    markerOffsets: [3, 5]
  });

  const firstLine = lineAt(inactive, 0);
  assert.deepEqual(firstLine.leaves.map((leaf) => [
    leaf.kind,
    leaf.text,
    leaf.visibility,
    leaf.interactionPolicy
  ]), [
    ['quote-prefix', '> > ', 'activatable', 'activate-quote-line'],
    ['quote-content', 'Alpha', 'visible', 'editable-text']
  ]);
  const [inactiveMarker, inactiveContent] = firstLine.leaves;
  const inactiveMarkerRole = inactiveMarker.semanticRoles.find((role) => role.family === 'quote');
  const inactiveContentRole = inactiveContent.semanticRoles.find((role) => role.family === 'quote');
  assert.deepEqual({
    markerRole: inactiveMarkerRole.role,
    markerDepth: inactiveMarkerRole.depth,
    markerSourceVisible: inactiveMarkerRole.sourceVisible,
    contentRole: inactiveContentRole.role,
    contentDepth: inactiveContentRole.depth,
    contentSourceVisible: inactiveContentRole.sourceVisible
  }, {
    markerRole: 'marker',
    markerDepth: 2,
    markerSourceVisible: false,
    contentRole: 'content',
    contentDepth: 2,
    contentSourceVisible: true
  });
  assert.equal(
    inactiveContent.semanticOwnerId,
    sourceSnapshot.semanticIndex.ownerAtOffset(inactiveContent.sourceStart)?.id || null,
    'quote content decoration must not replace the canonical text owner'
  );
  assert.equal(lineAt(inactive, 4).metadata.quote, undefined,
    'a greater-than sign inside fenced code does not invent a quote rail');

  const active = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview',
    activePhysicalLineIds: [firstLine.physicalLineId]
  });
  assert.equal(active.constructs.quotes[0].active, true);
  assert.equal(active.constructs.quotes[1].active, false,
    'activation reveals only the selected physical quote row');
  assert.ok(lineAt(active, 0).leaves.every((leaf) => leaf.visibility === 'visible'));
  assert.equal(lineAt(active, 0).leaves.map((leaf) => leaf.text).join(''), '> > Alpha');
  const activeMarkerRole = lineAt(active, 0).leaves[0].semanticRoles
    .find((role) => role.family === 'quote' && role.role === 'marker');
  assert.equal(activeMarkerRole.depth, 2);
  assert.equal(activeMarkerRole.active, true);
  assert.equal(activeMarkerRole.sourceVisible, true);

  const sourceMode = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'source'
  });
  const sourceContent = lineAt(sourceMode, 0).leaves
    .find((leaf) => leaf.kind === 'quote-content');
  assert.equal(
    sourceContent.semanticOwnerId,
    sourceSnapshot.semanticIndex.ownerAtOffset(sourceContent.sourceStart)?.id || null
  );
});

test('link plan exposes exact labels, activatable raw syntax, safe destinations, and reference definitions', () => {
  const source = [
    '[Safe](https://example.com) [Unsafe](javascript:alert(1))',
    '',
    '[Ref][id]',
    '',
    '[id]: https://example.org "Reference"'
  ].join('\n');
  const inactive = plan(source).plan;
  const links = inactive.constructs.links;

  assertCanonicalLeaves(inactive, source);
  assert.equal(links.length, 3);
  links.forEach((link) => {
    assert.equal(link.raw, source.slice(link.start, link.end));
    assert.equal(link.labelSource, source.slice(link.labelStart, link.labelEnd));
    assert.equal(link.destinationSource, source.slice(
      link.destinationStart,
      link.destinationEnd
    ));
    assert.ok(link.logicalLinkId);
    assert.ok(link.parserNode);
    assert.equal(Object.hasOwn(link, 'control'), false);
  });
  assert.deepEqual(links.map((link) => link.labelSource), ['Safe', 'Unsafe', 'Ref']);
  assert.deepEqual(links.map((link) => link.safeHref), [
    'https://example.com',
    '',
    'https://example.org'
  ]);
  assert.equal(inactive.controls.some((control) => control.kind === 'open-link'), false);

  const safe = links[0];
  const safeLeaves = leavesForRange(inactive, safe.start, safe.end);
  assert.deepEqual(safeLeaves.map((leaf) => [leaf.kind, leaf.text, leaf.visibility]), [
    ['link-hidden-source', '[', 'activatable'],
    ['link-label', 'Safe', 'visible'],
    ['link-hidden-source', '](https://example.com)', 'activatable']
  ]);
  assert.ok(safeLeaves.filter((leaf) => leaf.kind === 'link-hidden-source')
    .every((leaf) => leaf.interactionPolicy === 'activate-link-source'));

  const active = plan(source, 'live-preview', {
    activeOwnerIds: [safe.ownerId]
  }).plan;
  const activeSafe = active.constructs.links[0];
  assert.equal(activeSafe.active, true);
  assert.ok(leavesForRange(active, safe.start, safe.end)
    .every((leaf) => leaf.visibility === 'visible'));
  assert.equal(
    leavesForRange(active, safe.start, safe.end).map((leaf) => leaf.text).join(''),
    safe.raw
  );

  const sourceMode = plan(source, 'source').plan;
  assert.equal(sourceMode.mode, 'source');
  assert.equal(sourceMode.controls.length, 0);
  assert.ok(sourceMode.constructs.links.every((link) => !Object.hasOwn(link, 'control')));
});

test('nested-link-looking shells recover one outer logical link by source identity', () => {
  const source = '[[OpenAI](https://openai.com/)](https://openai.com)';
  const sourceSnapshot = snapshot(source);
  const originalAst = sourceSnapshot.parserAst;
  const rawLinks = parserLinkNodes(sourceSnapshot);
  assert.deepEqual(rawLinks.map((node) => [
    node.position.start.offset,
    node.position.end.offset,
    node.url
  ]), [
    [1, 30, 'https://openai.com/'],
    [32, 50, 'https://openai.com']
  ]);

  const recoveries = recoverMarkdownLinkSemantics(sourceSnapshot);
  assert.equal(recoveries.length, 1);
  const [recovery] = recoveries;
  assert.deepEqual({
    kind: recovery.kind,
    complete: [recovery.start, recovery.end],
    label: [recovery.labelStart, recovery.labelEnd],
    destination: [recovery.destinationStart, recovery.destinationEnd],
    href: recovery.href,
    parserLinks: recovery.rawParserLinkNodes.length
  }, {
    kind: 'obsidian-nested-link-shell',
    complete: [0, 51],
    label: [1, 30],
    destination: [32, 50],
    href: 'https://openai.com',
    parserLinks: 2
  });
  assert.equal(sourceSnapshot.parserAst, originalAst);
  assert.equal(sourceSnapshot.markdownBody, source);

  const sourcePlan = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'source'
  });
  const livePlan = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  [sourcePlan, livePlan].forEach((result) => {
    assertCanonicalLeaves(result, source);
    assert.equal(result.constructs.links.length, 1);
    const [link] = result.constructs.links;
    assert.deepEqual({
      complete: [link.start, link.end],
      label: [link.labelStart, link.labelEnd, link.labelSource],
      destination: [link.destinationStart, link.destinationEnd, link.destinationSource],
      href: link.safeHref,
      parserNode: link.parserNode,
      recovery: link.semanticRecovery.kind
    }, {
      complete: [0, 51],
      label: [1, 30, '[OpenAI](https://openai.com/)'],
      destination: [32, 50, 'https://openai.com'],
      href: 'https://openai.com',
      parserNode: null,
      recovery: 'obsidian-nested-link-shell'
    });
  });
  assert.deepEqual(leavesForRange(livePlan, 0, source.length)
    .map((leaf) => [leaf.kind, leaf.text, leaf.visibility]), [
    ['link-hidden-source', '[', 'activatable'],
    ['link-label', '[OpenAI](https://openai.com/)', 'visible'],
    ['link-hidden-source', '](https://openai.com)', 'activatable']
  ]);
  const syntheticOwner = livePlan.constructs.links[0].ownerId;
  const active = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [syntheticOwner]
  });
  assert.equal(active.constructs.links[0].active, true);
  assert.ok(leavesForRange(active, 0, source.length)
    .every((leaf) => leaf.visibility === 'visible'));

  const authenticLink = sourcePlan.constructs.links[0];
  const forgedHref = 'https://evil.example';
  const forgedRecovery = {
    ...authenticLink.semanticRecovery,
    href: forgedHref,
    presentationNode: {
      ...authenticLink.semanticRecovery.presentationNode,
      url: forgedHref
    }
  };
  const forgedPlan = {
    ...sourcePlan,
    constructs: {
      ...sourcePlan.constructs,
      links: [{
        ...authenticLink,
        safeHref: forgedHref,
        semanticRecovery: forgedRecovery
      }]
    }
  };
  const forgedValidation = validateEditablePresentationPlan(forgedPlan, sourceSnapshot);
  assert.equal(forgedValidation.ok, false);
  assert.match(forgedValidation.errors.join('\n'), /not one exact recovered outer-link shell/);

  const different = '[[OpenAI](https://inner.example/)](https://outer.example)';
  const prose = `Before ${different} after.`;
  const repeated = `${different} ${different}`;
  assert.deepEqual(plan(different, 'source').plan.constructs.links.map((link) => ({
    range: [link.start, link.end],
    href: link.safeHref
  })), [{ range: [0, 57], href: 'https://outer.example' }]);
  assert.deepEqual(plan(prose, 'source').plan.constructs.links.map((link) => [
    link.start,
    link.end
  ]), [[7, 64]]);
  const repeatedLinks = plan(repeated, 'source').plan.constructs.links;
  assert.deepEqual(repeatedLinks.map((link) => [link.start, link.end]), [
    [0, 57],
    [58, 115]
  ]);
  assert.equal(new Set(repeatedLinks.map((link) => link.logicalLinkId)).size, 2);
  assert.equal(new Set(repeatedLinks.map((link) => link.safeHref)).size, 1);

  const validEscaped = String.raw`[\[OpenAI\](https://openai.com/)](https://openai.com/)`;
  const escapedOpening = String.raw`\[[OpenAI](https://inner.example/)](https://outer.example)`;
  assert.equal(recoverMarkdownLinkSemantics(snapshot(validEscaped)).length, 0);
  assert.equal(plan(validEscaped, 'source').plan.constructs.links.length, 1);
  assert.equal(recoverMarkdownLinkSemantics(snapshot(escapedOpening)).length, 0);
  assert.equal(plan(escapedOpening, 'source').plan.constructs.links.length, 2);
  assert.equal(plan('Visit https://openai.com today.', 'source').plan.constructs.links.length, 1);
  assert.equal(plan('[One](https://same.com/)\nhttps://same.com/', 'source')
    .plan.constructs.links.length, 2);
});

test('math plan preserves Source/Live policies and gives KaTeX one exact non-proportional anchor', () => {
  const source = 'Inline $x^2$.\r\n\r\n$$\r\nalpha\r\n$$';
  const sourceSnapshot = snapshot(source);
  const inactive = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const [inline, display] = inactive.constructs.math;

  assertCanonicalLeaves(inactive, source);
  assert.equal(inactive.constructs.math.length, 2);
  assert.deepEqual({ ...mathSourceRange(
    sourceSnapshot.semanticIndex.ownersOfType('inlineMath')[0].node,
    source
  ) }, {
    start: inline.start,
    end: inline.end,
    contentStart: inline.contentStart,
    contentEnd: inline.contentEnd,
    display: false,
    raw: '$x^2$'
  });
  assert.equal(inline.source, 'x^2');
  assert.equal(display.source, 'alpha');
  assert.deepEqual({ ...inline.presentation }, {
    sourceVisible: false,
    renderedMounted: true,
    layout: 'rendered-only'
  });
  assert.deepEqual({ ...display.presentation }, {
    sourceVisible: false,
    renderedMounted: true,
    layout: 'rendered-only'
  });
  [inline, display].forEach((math) => {
    assert.equal(math.raw, source.slice(math.start, math.end));
    assert.equal(math.source, source.slice(math.contentStart, math.contentEnd));
    assert.equal(math.activationAnchor.offset, math.contentStart);
    assert.equal(math.activationAnchor.semanticOwnerId, math.ownerId);
    assert.equal(math.activationAnchor.interactionPolicy, 'activate-owner');
    assert.ok(leavesForRange(inactive, math.start, math.end)
      .every((leaf) => leaf.visibility === 'activatable'));
  });

  const activeInline = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [inline.ownerId]
  });
  assert.deepEqual({ ...activeInline.constructs.math[0].presentation }, {
    sourceVisible: true,
    renderedMounted: false,
    layout: 'source-only'
  });
  assert.ok(leavesForRange(activeInline, inline.start, inline.end)
    .every((leaf) => leaf.visibility === 'visible'));

  const activeDisplay = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [display.ownerId]
  });
  assert.deepEqual({ ...activeDisplay.constructs.math[1].presentation }, {
    sourceVisible: true,
    renderedMounted: true,
    layout: 'source-above-rendered'
  });

  const sourceMode = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'source'
  });
  assert.ok(sourceMode.constructs.math.every((math) => (
    math.presentation.layout === 'source-only'
      && math.presentation.renderedMounted === false
      && math.activationAnchor === null
  )));
});

test('table plan maps only canonical cell ranges and leaves pipes, padding, and delimiter explicit', () => {
  const source = [
    '| A | B |',
    '| :-- | --: |',
    '| x\\|y | `p\\|q` |',
    '| |   |'
  ].join('\r\n');
  const sourceSnapshot = snapshot(source);
  const inactive = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const table = inactive.constructs.tables[0];

  assertCanonicalLeaves(inactive, source);
  assert.ok(table);
  assert.equal(table.raw, source);
  assert.equal(table.columnCount, 2);
  assert.deepEqual(table.alignments, ['left', 'right']);
  assert.equal(table.activeRaw, false);
  assert.equal(table.cells.length, 6);
  assert.ok(table.cells.every((cell) => cell.canonical));
  table.cells.forEach((cell) => {
    assert.equal(cell.source, source.slice(cell.start, cell.end));
    assert.ok(cell.outerStart <= cell.start);
    assert.ok(cell.end <= cell.outerEnd);
  });
  assert.equal(table.delimiterRange.start, source.indexOf('| :--'));
  assert.equal(
    source.slice(table.delimiterRange.start, table.delimiterRange.end),
    '| :-- | --: |'
  );
  assert.deepEqual(table.controls.map((control) => control.kind), [
    'append-column',
    'append-row'
  ]);
  assert.ok(table.controls.every((control) => control.semanticOnly
    && control.contentEditable === false));

  const tableLeaves = leavesForRange(inactive, table.start, table.end);
  const cellLeaves = tableLeaves.filter((leaf) => leaf.kind === 'table-cell');
  const structuralLeaves = tableLeaves.filter((leaf) => leaf.kind === 'table-structural-source');
  assert.deepEqual(cellLeaves.map((leaf) => leaf.text), ['A', 'B', 'x\\|y', '`p\\|q`']);
  assert.ok(cellLeaves.every((leaf) => leaf.visibility === 'visible'
    && leaf.interactionPolicy === 'editable-table-cell'));
  assert.ok(structuralLeaves.every((leaf) => leaf.visibility === 'source-only'
    && leaf.interactionPolicy === 'activate-table-source'));
  const delimiterLine = inactive.lines.find((line) => (
    line.physicalLineId === table.delimiterRange.physicalLineId
  ));
  assert.ok(delimiterLine.leaves.every((leaf) => leaf.kind === 'table-structural-source'));
  assert.equal(delimiterLine.leaves.map((leaf) => leaf.text).join(''), '| :-- | --: |');
  assert.deepEqual(
    inactive.lines.flatMap((line) => line.anchors)
      .filter((anchor) => anchor.kind === 'table-empty-cell')
      .map((anchor) => [anchor.rowIndex, anchor.columnIndex, anchor.position.offset]),
    [[1, 0, table.rows[1][0].start], [1, 1, table.rows[1][1].start]],
    'empty cells have exact canonical anchors and no synthetic rows/cells'
  );

  const activeLive = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [table.ownerId]
  });
  const forcedLive = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview',
    forcedRawOwnerIds: [table.ownerId]
  });
  [activeLive, forcedLive].forEach((liveTablePlan) => {
    assert.equal(liveTablePlan.constructs.tables[0].activeRaw, false,
      'Live tables remain semantic for active and forced owner requests');
    assert.deepEqual(
      liveTablePlan.constructs.tables[0].controls.map((control) => control.kind),
      ['append-column', 'append-row']
    );
    const liveLeaves = leavesForRange(liveTablePlan, table.start, table.end);
    assert.ok(liveLeaves.some((leaf) => leaf.kind === 'table-cell'
      && leaf.visibility === 'visible'
      && leaf.interactionPolicy === 'editable-table-cell'));
    assert.ok(liveLeaves.filter((leaf) => leaf.kind === 'table-structural-source')
      .every((leaf) => leaf.visibility === 'source-only'
        && leaf.interactionPolicy === 'activate-table-source'));
    assertCanonicalLeaves(liveTablePlan, source);
  });

  const sourceMode = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'source'
  });
  assert.equal(sourceMode.constructs.tables[0].activeRaw, true);
  assert.ok(leavesForRange(sourceMode, table.start, table.end)
    .every((leaf) => leaf.visibility === 'visible'));
});

test('ragged table padding is presentation metadata, not a fake canonical caret anchor', () => {
  const source = ['| A | B |', '| - | - |', '| one |'].join('\n');
  const result = plan(source).plan;
  const table = result.constructs.tables[0];
  const synthetic = table.cells.filter((cell) => !cell.canonical);
  const anchors = result.lines.flatMap((line) => line.anchors)
    .filter((anchor) => anchor.kind === 'table-empty-cell');

  assert.equal(synthetic.length, 1);
  assert.equal(synthetic[0].rowIndex, 0);
  assert.equal(synthetic[0].columnIndex, 1);
  assert.equal(anchors.some((anchor) => anchor.position.offset === 0), false,
    'a parser-padded missing cell must not claim document offset zero');
  assertCanonicalLeaves(result, source);
});

test('heading, inline formatting, escape, and inline-code plans use one exact immutable contract', () => {
  const source = [
    '# Heading',
    '',
    '*em* **strong** ~~gone~~ \\*literal\\* and ``a ` b``'
  ].join('\r\n');
  const sourceSnapshot = snapshot(source);
  const inactive = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const expectedCounts = {
    headings: 1,
    emphasis: 1,
    strong: 1,
    strikethrough: 1,
    escapes: 2,
    inlineCode: 1,
    codeBlocks: 0,
    thematicBreaks: 0
  };

  assert.deepEqual(SEMANTIC_PRESENTATION_KEYS, Object.keys(expectedCounts));
  assertCanonicalLeaves(inactive, source);
  SEMANTIC_PRESENTATION_KEYS.forEach((key) => {
    assert.equal(inactive.constructs[key].length, expectedCounts[key], key);
  });
  const presentations = SEMANTIC_PRESENTATION_KEYS
    .flatMap((key) => inactive.constructs[key]);
  presentations.forEach((construct) => {
    assert.equal(construct.raw, source.slice(construct.start, construct.end));
    assert.equal(construct.contentSource,
      source.slice(construct.contentStart, construct.contentEnd));
    assert.equal(
      sourceSnapshot.semanticIndex.ownerByNode(construct.node).id,
      construct.ownerId,
      'metadata resolves through SourceSnapshot.semanticIndex.ownerByNode'
    );
    assert.equal(construct.presentationOwned, true);
    assert.deepEqual({
      sourceVisible: construct.presentation.sourceVisible,
      renderedMounted: construct.presentation.renderedMounted,
      layout: construct.presentation.layout
    }, {
      sourceVisible: false,
      renderedMounted: true,
      layout: 'rendered-only'
    });
    assert.equal(construct.activationAnchor.offset, construct.anchorOffset);
    assert.equal(construct.activationAnchor.semanticOwnerId, construct.ownerId);
    assert.equal(construct.activationAnchor.interactionPolicy, 'activate-owner');
    assert.ok(leavesForRange(inactive, construct.start, construct.end)
      .every((leaf) => leaf.visibility === 'activatable'
        && leaf.interactionPolicy === 'activate-owner'));
  });
  assert.deepEqual({
    delimiter: inactive.constructs.inlineCode[0].delimiter,
    delimiterLength: inactive.constructs.inlineCode[0].delimiterLength,
    contentSource: inactive.constructs.inlineCode[0].contentSource,
    value: inactive.constructs.inlineCode[0].value
  }, {
    delimiter: '``',
    delimiterLength: 2,
    contentSource: 'a ` b',
    value: 'a ` b'
  });
  assert.equal(Object.isFrozen(inactive.constructs.headings[0]), true);
  assert.equal(Object.isFrozen(inactive.constructs.inlineCode[0].presentation), true);
  assert.equal(Object.isFrozen(inactive.constructs.escapes), true);

  presentations.forEach((construct) => {
    const active = buildEditablePresentationPlan(sourceSnapshot, {
      model: markdown,
      mode: 'live-preview',
      activeOwnerIds: [construct.ownerId]
    });
    const activeConstruct = active.constructs[
      SEMANTIC_PRESENTATION_KEYS.find((key) => (
        active.constructs[key].some((candidate) => candidate.presentationId === construct.presentationId)
      ))
    ].find((candidate) => candidate.presentationId === construct.presentationId);
    assert.equal(activeConstruct.presentation.layout, 'source-only');
    assert.equal(activeConstruct.activationAnchor, null);
    assert.ok(leavesForRange(active, activeConstruct.start, activeConstruct.end)
      .every((leaf) => leaf.visibility === 'visible'));
  });

  const sourceMode = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'source'
  });
  assertCanonicalLeaves(sourceMode, source);
  SEMANTIC_PRESENTATION_KEYS.flatMap((key) => sourceMode.constructs[key])
    .forEach((construct) => {
      assert.equal(construct.presentation.layout, 'source-only');
      assert.equal(construct.activationAnchor, null);
      assert.ok(leavesForRange(sourceMode, construct.start, construct.end)
        .every((leaf) => leaf.visibility === 'visible'));
    });
});

test('multiline paragraph metadata spans physical rows without taking over row geometry', () => {
  const source = ['first line', 'second line', '', '---'].join('\n');
  const { snapshot: sourceSnapshot, plan: result } = plan(source, 'source');
  const paragraph = result.constructs.paragraphs[0];

  assertCanonicalLeaves(result, source);
  assert.equal(result.constructs.paragraphs.length, 1);
  assert.equal(paragraph.raw, 'first line\nsecond line');
  assert.deepEqual(paragraph.lineIds, result.lines.slice(0, 2)
    .map((line) => line.physicalLineId));
  assert.equal(paragraph.presentation.layout, 'physical-rows');
  assert.equal(result.lines[0].physicalLineId === result.lines[1].physicalLineId, false);
  result.lines.slice(0, 2).forEach((line) => {
    assert.equal(line.leaves.map((leaf) => leaf.text).join(''), line.text);
    assert.ok(line.leaves.every((leaf) => leaf.kind === 'source'));
    line.leaves.forEach((leaf) => {
      assert.equal(
        leaf.semanticOwnerId,
        sourceSnapshot.semanticIndex.ownerAtOffset(leaf.sourceStart)?.id || null,
        'paragraph annotation must not replace the foundation-resolved semantic owner'
      );
    });
    assert.ok(line.leaves.flatMap((leaf) => leaf.semanticRoles).some((role) => (
      role.family === 'paragraph'
        && role.role === 'content'
        && role.presentationId === paragraph.presentationId
    )));
    assert.equal(line.metadata.paragraphs[0].presentationId, paragraph.presentationId);
  });
  const paragraphRole = result.lines[0].leaves[0].semanticRoles
    .find((role) => role.family === 'paragraph');
  assert.equal(Object.isFrozen(result.lines[0].leaves[0].semanticRoles), true);
  assert.equal(Object.isFrozen(paragraphRole), true);
});

test('H1 through H6 preserve exact Source marker/content roles and depth metadata', () => {
  const source = Array.from({ length: 6 }, (_unused, index) => (
    `${'#'.repeat(index + 1)} H${index + 1}`
  )).join('\n\n');
  const result = plan(source, 'source').plan;

  assertCanonicalLeaves(result, source);
  assert.deepEqual(result.constructs.headings.map((heading) => heading.depth), [1, 2, 3, 4, 5, 6]);
  result.constructs.headings.forEach((heading) => {
    const leaves = leavesForRange(result, heading.start, heading.end);
    assert.deepEqual(leaves.map((leaf) => leaf.kind), ['heading-marker', 'heading-content']);
    assert.equal(leaves[0].text, `${'#'.repeat(heading.depth)} `);
    const contentRole = leaves[1].semanticRoles.find((role) => (
      role.family === 'heading' && role.role === 'content'
    ));
    assert.equal(contentRole.depth, heading.depth);
    assert.equal(contentRole.tagName, `h${heading.depth}`);
  });
});

test('appearance roles annotate math delimiters and safe underline source without changing bytes', () => {
  const inlineMathSource = '$x^2$';
  const inlineMath = plan(inlineMathSource, 'source').plan;
  assertCanonicalLeaves(inlineMath, inlineMathSource);
  const inlineDelimiterLeaves = inlineMath.lines.flatMap((line) => line.leaves)
    .filter((leaf) => leaf.semanticRoles.some((role) => (
      role.family === 'math-delimiter' && role.role === 'marker'
    )));
  assert.deepEqual(inlineDelimiterLeaves.map((leaf) => ({
    source: leaf.text,
    start: leaf.sourceStart,
    end: leaf.sourceEnd
  })), [
    { source: '$', start: 0, end: 1 },
    { source: '$', start: 4, end: 5 }
  ]);
  assert.equal(inlineMath.lines[0].leaves.find((leaf) => leaf.text === 'x^2')
    .semanticRoles.some((role) => role.family === 'math-delimiter'), false);

  const displayMathSource = '$$\ny\n$$';
  const displayMath = plan(displayMathSource, 'source').plan;
  assertCanonicalLeaves(displayMath, displayMathSource);
  assert.deepEqual(displayMath.lines.flatMap((line) => line.leaves)
    .filter((leaf) => leaf.semanticRoles.some((role) => role.family === 'math-delimiter'))
    .map((leaf) => [leaf.sourceStart, leaf.sourceEnd, leaf.text]), [
      [0, 2, '$$'],
      [5, 7, '$$']
    ]);

  const underlineSource = '<u>under</u>';
  const underline = plan(underlineSource, 'source').plan;
  assertCanonicalLeaves(underline, underlineSource);
  assert.deepEqual(underline.lines[0].leaves.map((leaf) => ({
    text: leaf.text,
    roles: leaf.semanticRoles
      .filter((role) => ['underline', 'underline-symbol', 'source-symbol'].includes(role.family))
      .map((role) => `${role.family}:${role.role}`)
  })), [
    { text: '<', roles: ['source-symbol:marker'] },
    { text: 'u', roles: ['underline-symbol:marker'] },
    { text: '>', roles: ['source-symbol:marker'] },
    { text: 'under', roles: ['underline:content'] },
    { text: '</', roles: ['source-symbol:marker'] },
    { text: 'u', roles: ['underline-symbol:marker'] },
    { text: '>', roles: ['source-symbol:marker'] }
  ]);

  const inactiveResult = plan(underlineSource, 'live-preview');
  const inactiveLive = inactiveResult.plan;
  assertCanonicalLeaves(inactiveLive, underlineSource);
  const descriptor = inactiveLive.constructs.underlines[0];
  assert.ok(descriptor.activationOwnerId);
  assert.notEqual(descriptor.activationOwnerId, descriptor.ownerId,
    'underline editing activation is pair-local, while semantic ownership stays canonical');
  const inactiveMarkers = inactiveLive.lines[0].leaves.filter((leaf) => (
    leaf.semanticRoles.some((role) => (
      ['underline-symbol', 'source-symbol'].includes(role.family)
        && role.role === 'marker'
    ))
  ));
  assert.deepEqual(inactiveMarkers.map((leaf) => leaf.text), ['<', 'u', '>', '</', 'u', '>']);
  assert.ok(inactiveMarkers.every((leaf) => leaf.visibility === 'activatable'));
  assert.ok(inactiveMarkers.every((leaf) => leaf.interactionPolicy === 'activate-owner'));
  assert.ok(inactiveMarkers.every((leaf) => (
    leaf.semanticOwnerId === inactiveResult.snapshot.semanticIndex.ownerAtOffset(
      leaf.sourceStart
    )?.id
  )));
  assert.ok(inactiveMarkers.every((leaf) => leaf.semanticRoles.every((role) => (
    role.role !== 'marker' || role.sourceVisible === false
  ))));
  const inactiveContent = inactiveLive.lines[0].leaves.find((leaf) => (
    leaf.semanticRoles.some((role) => role.family === 'underline' && role.role === 'content')
  ));
  assert.equal(inactiveContent.text, 'under');
  assert.equal(inactiveContent.visibility, 'visible');

  const activeLive = plan(underlineSource, 'live-preview', {
    activeOwnerIds: [descriptor.activationOwnerId]
  }).plan;
  assertCanonicalLeaves(activeLive, underlineSource);
  const activeMarkers = activeLive.lines[0].leaves.filter((leaf) => (
    leaf.semanticRoles.some((role) => (
      ['underline-symbol', 'source-symbol'].includes(role.family)
        && role.role === 'marker'
    ))
  ));
  assert.ok(activeMarkers.every((leaf) => leaf.visibility === 'visible'));
  assert.ok(activeMarkers.every((leaf) => leaf.interactionPolicy === 'editable-text'));
  assert.ok(activeMarkers.every((leaf) => leaf.semanticRoles.every((role) => (
    role.role !== 'marker' || role.sourceVisible === true
  ))));
});

test('Live underline activation is pair-specific and unsafe or unpaired HTML remains literal', () => {
  const source = '<u>first</u> and <u>second</u>';
  const inactive = plan(source, 'live-preview').plan;
  assertCanonicalLeaves(inactive, source);
  assert.equal(inactive.constructs.underlines.length, 2);
  const [first, second] = inactive.constructs.underlines;
  assert.equal(first.ownerId, second.ownerId);
  assert.notEqual(first.activationOwnerId, second.activationOwnerId);

  const active = plan(source, 'live-preview', {
    activeOwnerIds: [first.activationOwnerId]
  }).plan;
  assertCanonicalLeaves(active, source);
  assert.deepEqual(active.constructs.underlines.map((underline) => underline.active), [true, false]);
  const markerVisibility = active.constructs.underlines.map((underline) => (
    underline.markerRanges.flatMap((range) => leavesForRange(active, range.start, range.end))
      .filter((leaf) => leaf.semanticRoles.some((role) => role.role === 'marker'))
      .map((leaf) => leaf.visibility)
  ));
  assert.ok(markerVisibility[0].every((visibility) => visibility === 'visible'));
  assert.ok(markerVisibility[1].every((visibility) => visibility === 'activatable'));

  const linkedSource = '[<u>under</u>](https://example.test)';
  const linked = plan(linkedSource, 'live-preview').plan;
  assertCanonicalLeaves(linked, linkedSource);
  const linkedUnderline = linked.constructs.underlines[0];
  const linkedMarkers = linked.lines.flatMap((line) => line.leaves).filter((leaf) => (
    linkedUnderline.markerRanges.some((range) => (
      range.start <= leaf.sourceStart && leaf.sourceEnd <= range.end
    ))
  ));
  assert.deepEqual(linkedMarkers.map((leaf) => leaf.text), ['<', 'u', '>', '</', 'u', '>']);
  assert.ok(linkedMarkers.every((leaf) => leaf.visibility === 'visible'));
  assert.ok(linkedMarkers.every((leaf) => leaf.kind === 'link-label'));
  assert.ok(linkedMarkers.every((leaf) => leaf.semanticRoles.some((role) => (
    role.family === 'link' && role.role === 'content'
  ))));
  assert.ok(linkedMarkers.every((leaf) => leaf.semanticRoles.some((role) => (
    role.family === 'underline-tag' && role.role === 'marker' && !role.sourceVisible
  ))), 'role-local hiding composes without replacing the outer link owner');

  for (const literal of ['<u>unpaired', '<u class="x">unsafe</u>', '<u>outer <u>inner</u></u>']) {
    const result = plan(literal, 'live-preview').plan;
    assertCanonicalLeaves(result, literal);
    if (literal.startsWith('<u>outer')) {
      assert.equal(result.constructs.underlines.length, 2,
        'the existing AST-owned depth-aware pairing supports nested safe tags');
    } else {
      assert.equal(result.constructs.underlines.length, 0);
      assert.ok(result.lines.flatMap((line) => line.leaves)
        .every((leaf) => leaf.visibility === 'visible'));
    }
  }
});

test('ordered-list and Source-table symbols receive presentation-only marker roles', () => {
  const orderedSource = '1. one\n2. two';
  const ordered = plan(orderedSource, 'live-preview').plan;
  assertCanonicalLeaves(ordered, orderedSource);
  assert.equal(ordered.constructs.listRows.length, 0,
    'presentation-only ordered marker roles do not enter the unordered-list controller');
  assert.deepEqual(ordered.constructs.orderedListMarkers.map((row) => ({
    kind: row.kind,
    marker: orderedSource.slice(row.start, row.end)
  })), [
    { kind: 'ordered-list-marker', marker: '1. ' },
    { kind: 'ordered-list-marker', marker: '2. ' }
  ]);
  assert.deepEqual(ordered.lines.flatMap((line) => line.leaves)
    .filter((leaf) => leaf.semanticRoles.some((role) => (
      role.family === 'ordered-list' && role.role === 'marker'
    )))
    .map((leaf) => leaf.text), ['1. ', '2. ']);

  const tableSource = '| A | B |\n|:---|---:|\n| 1 | 2 |';
  const table = plan(tableSource, 'source').plan;
  assertCanonicalLeaves(table, tableSource);
  const tableLeaves = table.lines.flatMap((line) => line.leaves);
  const symbolLeaves = tableLeaves.filter((leaf) => leaf.semanticRoles.some((role) => (
    role.family === 'table-symbol' && role.role === 'marker'
  )));
  assert.deepEqual(symbolLeaves.map((leaf) => leaf.text), [
    '| ', ' | ', ' |', '|:---|---:|', '| ', ' | ', ' |'
  ]);
  assert.deepEqual(tableLeaves.filter((leaf) => ['A', 'B', '1', '2'].includes(leaf.text))
    .map((leaf) => [leaf.text, leaf.semanticRoles.some((role) => (
      role.family === 'table-symbol'
    ))]), [
      ['A', false], ['B', false], ['1', false], ['2', false]
    ]);
});

test('Source and active Live plans keep segmented, composable semantic roles', () => {
  const source = [
    '# Heading',
    '',
    '***both***',
    '',
    '> quote',
    '',
    '`code` [label](https://example.com)',
    '',
    '```text',
    'body',
    '```'
  ].join('\n');
  const sourcePlan = plan(source, 'source').plan;
  const heading = sourcePlan.constructs.headings[0];
  const headingLeaves = leavesForRange(sourcePlan, heading.start, heading.end);

  assertCanonicalLeaves(sourcePlan, source);
  assert.deepEqual(headingLeaves.map((leaf) => [leaf.kind, leaf.text]), [
    ['heading-marker', '# '],
    ['heading-content', 'Heading']
  ]);
  const headingContentRole = headingLeaves[1].semanticRoles.find((role) => (
    role.family === 'heading' && role.role === 'content'
  ));
  assert.equal(headingContentRole.depth, 1);
  assert.equal(headingContentRole.tagName, 'h1');

  const bothLeaf = sourcePlan.lines.flatMap((line) => line.leaves)
    .find((leaf) => leaf.text === 'both');
  assert.ok(bothLeaf);
  assert.deepEqual(new Set(bothLeaf.semanticRoles
    .filter((role) => role.role === 'content')
    .map((role) => role.family)), new Set(['emphasis', 'strong', 'paragraph']));

  const quoteLine = sourcePlan.lines.find((line) => line.text === '> quote');
  assert.deepEqual(quoteLine.leaves.map((leaf) => [leaf.kind, leaf.text]), [
    ['quote-marker', '> '],
    ['quote-content', 'quote']
  ]);

  const link = sourcePlan.constructs.links[0];
  assert.deepEqual(leavesForRange(sourcePlan, link.start, link.end)
    .map((leaf) => [leaf.kind, leaf.text]), [
      ['link-marker', '['],
      ['link-content', 'label'],
      ['link-marker', '](https://example.com)']
    ]);

  const code = sourcePlan.constructs.codeBlocks[0];
  assert.deepEqual(new Set(leavesForRange(sourcePlan, code.start, code.end)
    .map((leaf) => leaf.kind)), new Set([
      'code-block-marker',
      'code-block-info',
      'code-block-content'
    ]));

  const activeHeadingPlan = plan(source, 'live-preview', {
    activeOwnerIds: [heading.ownerId]
  }).plan;
  assert.deepEqual(leavesForRange(activeHeadingPlan, heading.start, heading.end)
    .map((leaf) => [leaf.kind, leaf.text]), headingLeaves
    .map((leaf) => [leaf.kind, leaf.text]));
  assert.ok(leavesForRange(activeHeadingPlan, heading.start, heading.end)
    .flatMap((leaf) => leaf.semanticRoles)
    .filter((role) => role.family === 'heading')
    .every((role) => role.active));
});

test('ATX and Setext headings preserve exact CRLF markers and own nested formatting once', () => {
  const source = '# Head **bold** ###\r\n\r\nSet *title*\r\n---\r\n';
  const inactive = plan(source).plan;
  const [atx, setext] = inactive.constructs.headings;
  const [nestedEmphasis] = inactive.constructs.emphasis;
  const [nestedStrong] = inactive.constructs.strong;

  assertCanonicalLeaves(inactive, source);
  assert.deepEqual({
    style: atx.style,
    depth: atx.depth,
    raw: atx.raw,
    contentSource: atx.contentSource,
    opening: atx.openingMarkerRange.source,
    closing: atx.closingMarkerRange.source
  }, {
    style: 'atx',
    depth: 1,
    raw: '# Head **bold** ###',
    contentSource: 'Head **bold**',
    opening: '#',
    closing: '###'
  });
  assert.deepEqual({
    style: setext.style,
    depth: setext.depth,
    raw: setext.raw,
    contentSource: setext.contentSource,
    underline: setext.underlineRange.source,
    underlineLine: setext.underlineRange.physicalLineId
  }, {
    style: 'setext',
    depth: 2,
    raw: 'Set *title*\r\n---',
    contentSource: 'Set *title*',
    underline: '---',
    underlineLine: setext.lineIds[1]
  });
  assert.equal(atx.activationAnchor.offset, source.indexOf('Head'));
  assert.equal(setext.activationAnchor.offset, source.indexOf('Set'));
  [nestedEmphasis, nestedStrong].forEach((nested) => {
    assert.equal(nested.presentationOwned, false);
    assert.equal(nested.suppressionReason, 'nested-presentation-owner');
    assert.ok([atx.ownerId, setext.ownerId].includes(nested.suppressedByOwnerId));
    assert.equal(nested.activationAnchor, null);
  });
  const owned = SEMANTIC_PRESENTATION_KEYS.flatMap((key) => inactive.constructs[key])
    .filter((construct) => construct.presentationOwned);
  assert.deepEqual(owned.map((construct) => construct.kind), ['heading', 'heading']);
  assert.equal(inactive.lines.flatMap((line) => line.anchors)
    .filter((anchor) => anchor.kind === 'heading-rendered-activation').length, 2);
});

test('nested inline presentations choose top-level owners and preserve reserved link/math behavior', () => {
  const source = '*before [x](https://x.test) after* and **outer *inner* end** $m$';
  const inactive = plan(source).plan;
  const reservedOuter = inactive.constructs.emphasis[0];
  const outerStrong = inactive.constructs.strong[0];
  const nestedEmphasis = inactive.constructs.emphasis[1];
  const link = inactive.constructs.links[0];

  assertCanonicalLeaves(inactive, source);
  assert.equal(reservedOuter.presentationOwned, false);
  assert.equal(reservedOuter.suppressedByOwnerId, link.ownerId);
  assert.equal(reservedOuter.suppressionReason, 'reserved-syntax-range');
  assert.equal(reservedOuter.activationAnchor, null);
  assert.equal(outerStrong.presentationOwned, true);
  assert.equal(nestedEmphasis.presentationOwned, false);
  assert.equal(nestedEmphasis.suppressedByOwnerId, outerStrong.ownerId);
  assert.equal(nestedEmphasis.suppressionReason, 'nested-presentation-owner');
  assert.deepEqual(leavesForRange(inactive, link.start, link.end)
    .map((leaf) => [leaf.kind, leaf.text, leaf.visibility]), [
      ['link-hidden-source', '[', 'activatable'],
      ['link-label', 'x', 'visible'],
      ['link-hidden-source', '](https://x.test)', 'activatable']
    ], 'the established link projection wins its complete reserved range');
  assert.equal(inactive.constructs.math[0].activationAnchor.offset,
    inactive.constructs.math[0].contentStart);
  const owned = SEMANTIC_PRESENTATION_KEYS.flatMap((key) => inactive.constructs[key])
    .filter((construct) => construct.presentationOwned)
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < owned.length; index += 1) {
    assert.ok(owned[index - 1].end <= owned[index].start,
      'owned presentation ranges never overlap');
  }
});

test('reserved link ownership keeps nested formatting and escape roles non-owning and composable', () => {
  const source = '*before [**bold** and \\*](https://x.test) after*';
  const sourceResult = plan(source, 'source').plan;
  const link = sourceResult.constructs.links[0];
  const reserved = [
    ...sourceResult.constructs.emphasis,
    ...sourceResult.constructs.strong,
    ...sourceResult.constructs.escapes
  ];

  assertCanonicalLeaves(sourceResult, source);
  assert.ok(reserved.length >= 3);
  reserved.forEach((construct) => {
    assert.equal(construct.presentationOwned, false);
    assert.equal(construct.suppressionReason, 'reserved-syntax-range');
    assert.ok(['link', 'linkReference'].includes(construct.suppressedByKind));
    assert.equal(construct.suppressedByOwnerId, link.ownerId);
    assert.equal(construct.activationAnchor, null);
  });
  const sourceRoles = sourceResult.lines.flatMap((line) => line.leaves)
    .flatMap((leaf) => leaf.semanticRoles);
  for (const family of ['emphasis', 'strong', 'escape']) {
    assert.ok(sourceRoles.some((role) => role.family === family && role.role === 'marker'));
    assert.ok(sourceRoles.some((role) => role.family === family && role.role === 'content'));
  }
  leavesForRange(sourceResult, link.start, link.end).forEach((leaf) => {
    assert.equal(leaf.semanticOwnerId, link.ownerId,
      'semantic decorations must not replace established link source ownership');
  });

  const inactive = plan(source, 'live-preview').plan;
  const inactiveLink = inactive.constructs.links[0];
  const inactiveLeaves = leavesForRange(inactive, inactiveLink.start, inactiveLink.end);
  const inactiveRoles = inactive.lines.flatMap((line) => line.leaves)
    .flatMap((leaf) => leaf.semanticRoles);
  assert.ok(inactiveLeaves.filter((leaf) => leaf.kind === 'link-label')
    .every((leaf) => leaf.visibility === 'visible'));
  assert.ok(inactiveRoles.filter((role) => role.role === 'marker'
    && ['link', 'emphasis', 'strong', 'escape'].includes(role.family))
    .every((role) => role.sourceVisible === false));
  assert.ok(inactiveRoles.filter((role) => role.role === 'content'
    && ['link', 'emphasis', 'strong', 'escape'].includes(role.family))
    .every((role) => role.sourceVisible === true));

  const active = plan(source, 'live-preview', {
    activeOwnerIds: [inactiveLink.ownerId]
  }).plan;
  const activeRoles = active.lines.flatMap((line) => line.leaves)
    .flatMap((leaf) => leaf.semanticRoles)
    .filter((role) => ['link', 'emphasis', 'strong', 'escape'].includes(role.family));
  assert.ok(activeRoles.filter((role) => role.role === 'marker')
    .every((role) => role.sourceVisible === true));
  assert.ok(leavesForRange(active, inactiveLink.start, inactiveLink.end)
    .every((leaf) => leaf.semanticOwnerId === inactiveLink.ownerId));
});

test('escape adapter recognizes exact CommonMark punctuation without entering code and defers to links', () => {
  const slash = '\\';
  const source = `plain ${slash}* ${slash}${slash}* [${slash}*](x) \`${slash}*\``;
  const sourceSnapshot = snapshot(source);
  const inactive = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const escapes = inactive.constructs.escapes;

  assertCanonicalLeaves(inactive, source);
  assert.deepEqual(escapes.map((escape) => escape.raw), [`${slash}*`, `${slash}${slash}`, `${slash}*`]);
  assert.deepEqual(escapes.map((escape) => escape.value), ['*', slash, '*']);
  assert.deepEqual(escapes.map((escape) => escape.presentationOwned), [true, true, false]);
  assert.equal(escapes[2].suppressedByOwnerId, inactive.constructs.links[0].ownerId);
  assert.equal(escapes[2].suppressionReason, 'reserved-syntax-range');
  assert.equal(inactive.constructs.inlineCode.length, 1);
  assert.equal(inactive.constructs.inlineCode[0].contentSource, `${slash}*`);
  assert.equal(escapes.some((escape) => (
    inactive.constructs.inlineCode[0].start <= escape.start
      && escape.end <= inactive.constructs.inlineCode[0].end
  )), false, 'backslashes inside inline code are code bytes, not escape presentations');
});

test('fenced and indented code keep exact CRLF ranges and expose one non-proportional anchor each', () => {
  const source = [
    '```javascript meta words',
    'const x = `a`;',
    '```',
    '',
    '    first',
    '    second',
    ''
  ].join('\r\n');
  const sourceSnapshot = snapshot(source);
  const inactive = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview'
  });
  const [fenced, indented] = inactive.constructs.codeBlocks;

  assertCanonicalLeaves(inactive, source);
  assert.equal(inactive.constructs.inlineCode.length, 0,
    'backticks inside a fenced code body do not become inline-code owners');
  assert.deepEqual({
    fenced: fenced.fenced,
    raw: fenced.raw,
    language: fenced.language,
    meta: fenced.meta,
    marker: fenced.marker,
    markerLength: fenced.markerLength,
    infoSource: fenced.infoSource,
    bodySource: fenced.bodySource,
    closingSource: fenced.closingRange.source,
    closed: fenced.closed,
    activationStrategy: fenced.activationStrategy
  }, {
    fenced: true,
    raw: '```javascript meta words\r\nconst x = `a`;\r\n```',
    language: 'javascript',
    meta: 'meta words',
    marker: '`',
    markerLength: 3,
    infoSource: 'javascript meta words',
    bodySource: 'const x = `a`;\r\n',
    closingSource: '```',
    closed: true,
    activationStrategy: 'non-proportional-exact-anchor'
  });
  assert.equal(fenced.activationAnchor.offset, fenced.bodyStart);
  assert.equal(fenced.openingPhysicalLineId, fenced.lineIds[0]);
  assert.equal(fenced.closingPhysicalLineId, fenced.lineIds.at(-1));
  assert.deepEqual({
    fenced: indented.fenced,
    raw: indented.raw,
    value: indented.value,
    activationOffset: indented.activationAnchor.offset,
    activationStrategy: indented.activationStrategy
  }, {
    fenced: false,
    raw: '    first\r\n    second',
    value: 'first\r\nsecond',
    activationOffset: indented.start + 4,
    activationStrategy: 'non-proportional-exact-anchor'
  });
  [fenced, indented].forEach((code) => {
    const anchors = inactive.lines.flatMap((line) => line.anchors).filter((anchor) => (
      anchor.kind === 'code-block-rendered-activation' && anchor.ownerId === code.ownerId
    ));
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].position.offset, code.activationAnchor.offset);
    assert.equal(anchors[0].activationStrategy, 'non-proportional-exact-anchor');
    assert.equal(sourceSnapshot.semanticIndex.ownerByNode(code.node).id, code.ownerId);
    assert.ok(code.lineIds.every((lineId) => inactive.lines.find((line) => (
      line.physicalLineId === lineId
    )).metadata.codeOwnerId === code.ownerId));
  });

  const active = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [fenced.ownerId]
  });
  assert.equal(active.constructs.codeBlocks[0].presentation.layout, 'source-only');
  assert.equal(active.constructs.codeBlocks[0].activationAnchor, null);
  assert.ok(leavesForRange(active, fenced.start, fenced.end)
    .every((leaf) => leaf.visibility === 'visible'));
  assert.equal(active.constructs.codeBlocks[1].presentation.layout, 'rendered-only');
});

test('unclosed fenced code retains its complete canonical tail and a single exact body anchor', () => {
  const source = '~~~js\r\nunclosed\r\n';
  const inactive = plan(source).plan;
  const code = inactive.constructs.codeBlocks[0];

  assertCanonicalLeaves(inactive, source);
  assert.equal(code.fenced, true);
  assert.equal(code.closed, false);
  assert.equal(code.start, 0);
  assert.equal(code.end, source.length);
  assert.equal(code.raw, source);
  assert.equal(code.bodySource, 'unclosed\r\n');
  assert.equal(code.closingStart, source.length);
  assert.deepEqual(code.closingRange, {
    start: source.length,
    end: source.length,
    source: ''
  });
  assert.equal(code.activationAnchor.offset, source.indexOf('unclosed'));
  assert.equal(inactive.lines.flatMap((line) => line.anchors)
    .filter((anchor) => anchor.ownerId === code.ownerId).length, 1);
});
