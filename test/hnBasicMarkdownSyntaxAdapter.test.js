'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  HN_BASIC_SEMANTIC_PRESENTATION_KEYS,
  activePresentationOwnerIdsForSelection,
  buildHnBasicPresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');

function build(source, options = {}) {
  const snapshot = markdown.createSourceSnapshot(source);
  const plan = buildHnBasicPresentationPlan(snapshot, {
    model: markdown,
    hnMode: 'edit',
    ...options
  });
  return { snapshot, plan };
}

function assertExactCoverage(snapshot, plan) {
  const source = snapshot.markdownBody;
  const validation = validateEditablePresentationPlan(plan, snapshot);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(plan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join(''), source);
  plan.lines.forEach((line) => {
    assert.equal(line.leaves.map((leaf) => leaf.text).join(''), line.text);
    line.leaves.forEach((leaf) => {
      assert.equal(leaf.text, source.slice(leaf.sourceStart, leaf.sourceEnd));
    });
  });
}

function leavesIn(plan, start, end) {
  return plan.lines.flatMap((line) => line.leaves).filter((leaf) => (
    leaf.sourceStart < end && start < leaf.sourceEnd
  ));
}

function markerLeaves(plan, construct, family = construct.kind) {
  return leavesIn(plan, construct.start, construct.end).filter((leaf) => (
    (leaf.semanticRoles || []).some((role) => (
      role.family === family && role.role === 'marker'
    ))
  ));
}

test('HN basic plan is an exact-source whitelist with separate unordered and sequence rows', () => {
  const source = [
    '**bold** *italic* ~~strike~~ <u>under</u> $x+1$',
    '$$',
    'y^2',
    '$$',
    '- Parent',
    '\t- Child',
    '\t\t- Grandchild',
    '    - spaces are not Viewer Tab depth',
    '- [ ] task stays literal',
    '1. sequence item'
  ].join('\n');
  const { snapshot, plan } = build(source);

  assertExactCoverage(snapshot, plan);
  assert.equal(plan.consumer, 'hn-basic');
  assert.equal(plan.mode, 'live-preview');
  assert.deepEqual(HN_BASIC_SEMANTIC_PRESENTATION_KEYS,
    ['emphasis', 'strong', 'strikethrough']);
  assert.deepEqual({
    strong: plan.constructs.strong.length,
    emphasis: plan.constructs.emphasis.length,
    strikethrough: plan.constructs.strikethrough.length,
    underlines: plan.constructs.underlines.length,
    math: plan.constructs.math.length,
    listRows: plan.constructs.listRows.length
  }, {
    strong: 1,
    emphasis: 1,
    strikethrough: 1,
    underlines: 1,
    math: 2,
    listRows: 4
  });

  for (const key of ['strong', 'emphasis', 'strikethrough']) {
    const construct = plan.constructs[key][0];
    assert.deepEqual({
      active: construct.active,
      sourceVisible: construct.presentation.sourceVisible,
      renderedMounted: construct.presentation.renderedMounted,
      layout: construct.presentation.layout
    }, {
      active: false,
      sourceVisible: false,
      renderedMounted: false,
      layout: 'mapped-content'
    });
    assert.ok(markerLeaves(plan, construct).length >= 2);
    assert.ok(markerLeaves(plan, construct).every((leaf) => (
      leaf.visibility === 'activatable'
        && leaf.interactionPolicy === 'activate-owner'
        && leaf.semanticOwnerId === construct.ownerId
    )));
    const content = leavesIn(plan, construct.contentStart, construct.contentEnd);
    assert.ok(content.every((leaf) => leaf.visibility === 'visible'));
    assert.ok(content.some((leaf) => (leaf.semanticRoles || []).some((role) => (
      role.family === key && role.role === 'content'
    ))));
  }

  const underline = plan.constructs.underlines[0];
  assert.equal(source.slice(underline.start, underline.end), '<u>under</u>');
  assert.equal(source.slice(underline.contentStart, underline.contentEnd), 'under');
  assert.ok(markerLeaves(plan, underline, 'underline-tag').every((leaf) => (
    leaf.visibility === 'activatable'
  )));
  assert.ok(leavesIn(plan, underline.contentStart, underline.contentEnd).some((leaf) => (
    leaf.visibility === 'visible'
      && (leaf.semanticRoles || []).some((role) => (
        role.family === 'underline' && role.role === 'content'
      ))
  )));

  assert.deepEqual(plan.constructs.math.map((math) => ({
    raw: source.slice(math.start, math.end),
    content: source.slice(math.contentStart, math.contentEnd),
    display: math.display,
    sourceVisible: math.presentation.sourceVisible,
    renderedMounted: math.presentation.renderedMounted
  })), [
    { raw: '$x+1$', content: 'x+1', display: false,
      sourceVisible: false, renderedMounted: true },
    { raw: '$$\ny^2\n$$', content: 'y^2', display: true,
      sourceVisible: false, renderedMounted: true }
  ]);

  assert.deepEqual(plan.constructs.listRows.map((row) => ({
    family: row.family,
    hnSequenceList: row.hnSequenceList === true,
    marker: source.slice(row.markerStart, row.markerEnd),
    content: source.slice(row.contentStart, row.contentEnd),
    depth: row.depth,
    tabDepth: row.tabDepth,
    task: row.task,
    sourceVisible: row.presentation.sourceVisible,
    renderedMounted: row.presentation.renderedMounted
  })), [
    { family: 'unordered-list', hnSequenceList: false,
      marker: '- ', content: 'Parent', depth: 1, tabDepth: 0, task: false,
      sourceVisible: false, renderedMounted: true },
    { family: 'unordered-list', hnSequenceList: false,
      marker: '\t- ', content: 'Child', depth: 2, tabDepth: 1, task: false,
      sourceVisible: false, renderedMounted: true },
    { family: 'unordered-list', hnSequenceList: false,
      marker: '\t\t- ', content: 'Grandchild', depth: 3, tabDepth: 2, task: false,
      sourceVisible: false, renderedMounted: true },
    { family: 'hn-sequence-list', hnSequenceList: true,
      marker: '1. ', content: 'sequence item', depth: 1, tabDepth: 0, task: false,
      sourceVisible: true, renderedMounted: false }
  ]);
  assert.deepEqual(plan.controls, [], 'task-list controls are outside the HN whitelist');
});

test('Edit activation reveals exact markers while Browser ignores every requested active owner', () => {
  const source = '**bold** *italic* ~~strike~~ <u>under</u> $x$\n- Item';
  const inactive = build(source).plan;
  const allConstructs = [
    ...inactive.constructs.strong,
    ...inactive.constructs.emphasis,
    ...inactive.constructs.strikethrough,
    ...inactive.constructs.underlines,
    ...inactive.constructs.math,
    ...inactive.constructs.listRows
  ];
  const requestedOwners = allConstructs.map((construct) => (
    construct.activationOwnerId || construct.ownerId
  ));
  const active = build(source, { activeOwnerIds: requestedOwners }).plan;

  for (const key of ['strong', 'emphasis', 'strikethrough']) {
    const construct = active.constructs[key][0];
    assert.equal(construct.active, true);
    assert.equal(construct.presentation.sourceVisible, true);
    assert.ok(markerLeaves(active, construct).every((leaf) => leaf.visibility === 'visible'));
  }
  const underline = active.constructs.underlines[0];
  assert.equal(underline.active, true);
  assert.ok(markerLeaves(active, underline, 'underline-tag')
    .every((leaf) => leaf.visibility === 'visible'));
  assert.equal(active.constructs.math[0].active, true);
  assert.equal(active.constructs.math[0].presentation.sourceVisible, true);
  assert.equal(active.constructs.listRows[0].active, true);
  assert.equal(active.constructs.listRows[0].presentation.sourceVisible, true);

  allConstructs.forEach((construct) => {
    const selection = {
      anchor: construct.start,
      focus: Math.max(construct.start, construct.end - 1)
    };
    const selected = activePresentationOwnerIdsForSelection(inactive, selection);
    assert.ok(selected.includes(String(construct.activationOwnerId || construct.ownerId)),
      `${construct.kind} uses its existing exact source range for activation`);
  });

  const browser = build(source, {
    hnMode: 'browser',
    activeOwnerIds: requestedOwners
  }).plan;
  assert.deepEqual(browser.activeOwnerIds, []);
  for (const key of ['strong', 'emphasis', 'strikethrough']) {
    const construct = browser.constructs[key][0];
    assert.equal(construct.active, false);
    assert.ok(markerLeaves(browser, construct)
      .every((leaf) => leaf.visibility === 'activatable'));
  }
  assert.equal(browser.constructs.underlines[0].active, false);
  assert.equal(browser.constructs.math[0].active, false);
  assert.equal(browser.constructs.listRows[0].active, false);
});

test('nested approved formatting composes roles while shared reserved math/link ownership stays exact', () => {
  const source = [
    '***combined***',
    '**bold with *italic* inside**',
    '**$x$**',
    '[**literal link formatting**](https://example.com)',
    '**bold** beside $y$'
  ].join('\n');
  const { snapshot, plan } = build(source);
  assertExactCoverage(snapshot, plan);

  const visibleCombined = leavesIn(plan, source.indexOf('combined'),
    source.indexOf('combined') + 'combined'.length);
  assert.ok(visibleCombined.some((leaf) => {
    const roles = new Set((leaf.semanticRoles || []).map((role) => (
      `${role.family}:${role.role}`
    )));
    return roles.has('strong:content') && roles.has('emphasis:content');
  }), 'combined syntax decorates one canonical content leaf with both roles');

  const italicStart = source.indexOf('*italic*');
  const nestedItalic = leavesIn(plan, italicStart, italicStart + '*italic*'.length);
  assert.ok(nestedItalic.filter((leaf) => leaf.text === '*')
    .every((leaf) => leaf.visibility === 'activatable'));
  assert.ok(nestedItalic.some((leaf) => leaf.text === 'italic'
    && leaf.semanticRoles.some((role) => role.family === 'strong' && role.role === 'content')
    && leaf.semanticRoles.some((role) => role.family === 'emphasis' && role.role === 'content')));

  for (const literal of ['**$x$**', '[**literal link formatting**](https://example.com)']) {
    const start = source.indexOf(literal);
    const rangeLeaves = leavesIn(plan, start, start + literal.length);
    const formattingLeaves = rangeLeaves.filter((leaf) => (
      (leaf.semanticRoles || []).some((role) => (
        ['strong', 'emphasis', 'strikethrough'].includes(role.family)
      ))
    ));
    assert.deepEqual(formattingLeaves, [],
      `${literal} preserves the established reserved-owner overlap policy`);
  }

  const adjacentBoldStart = source.lastIndexOf('**bold**');
  assert.ok(leavesIn(plan, adjacentBoldStart, adjacentBoldStart + '**bold**'.length)
    .some((leaf) => leaf.visibility === 'activatable'),
  'formatting adjacent to math remains an independent approved construct');
});

test('HN structure headings and sequence rows coexist with unsupported exact-source Markdown', () => {
  const source = [
    '# Heading',
    '',
    '> Quote',
    '',
    '1. sequence',
    '',
    '- [x] task',
    '',
    '[link](https://example.com)',
    '[$x$](https://example.com/math)',
    '[<u>under</u>](https://example.com/underline)',
    '',
    '![image](asset.png)',
    '',
    '`inline code`',
    '',
    '```md',
    '**not formatting inside code**',
    '```',
    '',
    '| A | B |',
    '| --- | --- |',
    '| C | D |',
    '',
    '---',
    '',
    '<u class="unsafe">not approved</u>',
    '',
    '<u>unpaired'
  ].join('\n');
  const { snapshot, plan } = build(source);

  assertExactCoverage(snapshot, plan);
  assert.deepEqual(plan.constructs.headings, []);
  assert.deepEqual(plan.constructs.quotes, []);
  assert.deepEqual(plan.constructs.quoteRegions, []);
  assert.deepEqual(plan.constructs.orderedListMarkers, []);
  assert.deepEqual(plan.constructs.listRows.map((row) => ({
    family: row.family,
    hnSequenceList: row.hnSequenceList,
    markerSource: row.markerSource,
    contentSource: row.contentSource,
    sourceVisible: row.presentation.sourceVisible,
    renderedMounted: row.presentation.renderedMounted
  })), [{
    family: 'hn-sequence-list',
    hnSequenceList: true,
    markerSource: '1. ',
    contentSource: 'sequence',
    sourceVisible: true,
    renderedMounted: false
  }]);
  assert.deepEqual(plan.constructs.links, []);
  assert.deepEqual(plan.constructs.images, []);
  assert.deepEqual(plan.constructs.inlineCode, []);
  assert.deepEqual(plan.constructs.codeBlocks, []);
  assert.deepEqual(plan.constructs.tables, []);
  assert.deepEqual(plan.constructs.thematicBreaks, []);
  assert.deepEqual(plan.constructs.math, [],
    'approved math is not promoted from an unsupported link owner');
  assert.deepEqual(plan.constructs.underlines, []);
  assert.deepEqual(plan.constructs.strong, [],
    'parser-owned code ranges cannot leak inline formatting into HN presentation');
  const sequenceRow = plan.constructs.listRows[0];
  const sequenceLeaves = leavesIn(plan, sequenceRow.start, sequenceRow.end);
  assert.ok(sequenceLeaves.every((leaf) => (
    leaf.visibility === 'visible'
      && (leaf.semanticRoles || []).length === 1
      && leaf.semanticRoles[0].family === 'hn-sequence-list'
  )), 'the complete sequence prefix and content remain canonical visible leaves');
  assert.ok(plan.lines.flatMap((line) => line.leaves).filter((leaf) => (
    leaf.sourceEnd <= sequenceRow.start || sequenceRow.end <= leaf.sourceStart
  )).every((leaf) => (
    leaf.visibility === 'visible'
      && (leaf.interactionPolicy === 'editable-text'
        || leaf.interactionPolicy === 'editable-empty-row')
      && (leaf.semanticRoles || []).length === 0
  )));
});

test('the HN inline whitelist admits only the declared marker spellings', () => {
  const source = [
    '*asterisk italic*',
    '**asterisk bold**',
    '***asterisk combined***',
    '_underscore italic_',
    '__underscore bold__',
    '___underscore combined___'
  ].join('\n');
  const { snapshot, plan } = build(source);

  assertExactCoverage(snapshot, plan);
  assert.deepEqual(plan.constructs.emphasis.map((construct) => construct.raw), [
    '*asterisk italic*',
    '***asterisk combined***'
  ]);
  assert.deepEqual(plan.constructs.strong.map((construct) => construct.raw), [
    '**asterisk bold**',
    '**asterisk combined**'
  ]);
  for (const literal of [
    '_underscore italic_',
    '__underscore bold__',
    '___underscore combined___'
  ]) {
    const start = source.indexOf(literal);
    assert.ok(leavesIn(plan, start, start + literal.length).every((leaf) => (
      leaf.visibility === 'visible'
        && (leaf.semanticRoles || []).every((role) => (
          !['emphasis', 'strong'].includes(role.family)
        ))
    )), `${literal} remains literal HN source`);
  }
});

test('HN pins sibling lists, malformed math, and knowledge-shaped tokens to the explicit boundary', () => {
  const source = [
    '- First',
    '- Second',
    '\t- Child',
    'Unclosed $math',
    '[concept]',
    '<connection>',
    '?{future}',
    '// future'
  ].join('\n');
  const { snapshot, plan } = build(source);

  assertExactCoverage(snapshot, plan);
  assert.deepEqual(plan.constructs.listRows.map((row) => ({
    content: row.contentSource,
    tabDepth: row.tabDepth
  })), [
    { content: 'First', tabDepth: 0 },
    { content: 'Second', tabDepth: 0 },
    { content: 'Child', tabDepth: 1 }
  ]);
  assert.deepEqual(plan.constructs.math, [], 'unclosed math has no HN presentation owner');
  assert.deepEqual(plan.constructs.links, []);
  for (const literal of ['Unclosed $math', '[concept]', '<connection>', '?{future}', '// future']) {
    const start = source.indexOf(literal);
    assert.ok(leavesIn(plan, start, start + literal.length).every((leaf) => (
      leaf.visibility === 'visible' && (leaf.semanticRoles || []).length === 0
    )), `${literal} remains literal source`);
  }
});

test('HN presentation consumes parser/list descriptors and never rescans quote or list source', () => {
  const source = '> Quote syntax\n- List syntax';
  const canonical = markdown.createSourceSnapshot(source);
  const descriptorOnly = Object.create(canonical);
  Object.defineProperties(descriptorOnly, {
    quoteLineIndex: {
      get() {
        throw new Error('HN must not consume quote metadata');
      }
    },
    QuoteLineIndex: {
      get() {
        throw new Error('HN must not consume quote metadata');
      }
    },
    editableListSemanticIndex: {
      value: Object.freeze({ rows: Object.freeze([]) })
    },
    hnListIndex: {
      value: Object.freeze({ sequences: Object.freeze([]) })
    }
  });

  const plan = buildHnBasicPresentationPlan(descriptorOnly, {
    model: markdown,
    hnMode: 'edit'
  });
  assertExactCoverage(descriptorOnly, plan);
  assert.deepEqual(plan.constructs.quotes, []);
  assert.deepEqual(plan.constructs.quoteRegions, []);
  assert.deepEqual(plan.constructs.listRows, [],
    'raw list-looking bytes cannot create a HN list when both descriptor owners are empty');
  assert.ok(plan.lines.flatMap((line) => line.leaves)
    .every((leaf) => leaf.visibility === 'visible'));
});
