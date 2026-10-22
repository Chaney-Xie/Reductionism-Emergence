const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');

const {
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const view = loadMarkdownPageViewInternals([
  'semanticSyntaxSegments',
  'renderSemanticBlockContents',
  'mathPresentationFor'
]);

const fixture = [
  'Inline formula: $x^2 + y^2 = z^2$.',
  '',
  'Chemical formula: $\\mathrm{C_6H_{12}O_6}$.',
  '',
  '$$',
  '\\Delta G = \\Delta H - T\\Delta S',
  '$$'
].join('\n');

function renderedReadingFixture(source = fixture) {
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const result = renderSemanticSegments(view, source, {
    mode: 'reading',
    sourceSnapshot,
    sourceVersion: sourceSnapshot.version
  });
  const elements = result.blocks.flatMap((block) => descendants(block.element));
  const constructs = elements.filter((element) => (
    element.classList?.contains('is-math')
    || element.classList?.contains('is-math-display')
  ));
  return {
    ...result,
    constructs,
    sourceSnapshot
  };
}

function editablePlan(source = fixture, mode = 'live-preview', options = {}) {
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const plan = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode,
    ...options
  });
  const validation = validateEditablePresentationPlan(plan, sourceSnapshot);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  return { sourceSnapshot, plan };
}

function plannedSource({ sourceSnapshot, plan }) {
  return plan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join('').slice(0, sourceSnapshot.markdownBody.length);
}

function childWithClass(element, className) {
  return descendants(element).find((child) => child.classList?.contains(className)) || null;
}

function mountedCount(element, className) {
  return descendants(element).filter((child) => child.classList?.contains(className)).length;
}

test('LaTeX presentation policy distinguishes Source, inactive Live, active inline, and active display', () => {
  assert.deepEqual(
    { ...view.mathPresentationFor('reading', false, false) },
    { sourceVisible: false, renderedMounted: true, layout: 'rendered-only' }
  );
  const source = editablePlan(fixture, 'source').plan;
  const inactive = editablePlan(fixture).plan;
  const [inline, chemical, display] = inactive.constructs.math;
  const activeInline = editablePlan(fixture, 'live-preview', {
    activeOwnerIds: [inline.ownerId]
  }).plan;
  const activeDisplay = editablePlan(fixture, 'live-preview', {
    activeOwnerIds: [display.ownerId]
  }).plan;

  assert.ok(source.constructs.math.every((math) => (
    math.presentation.sourceVisible
      && !math.presentation.renderedMounted
      && math.presentation.layout === 'source-only'
  )));
  assert.deepEqual(
    inactive.constructs.math.map((math) => ({ ...math.presentation })),
    [inline, chemical, display].map(() => ({
      sourceVisible: false,
      renderedMounted: true,
      layout: 'rendered-only'
    }))
  );
  assert.deepEqual({ ...activeInline.constructs.math[0].presentation }, {
    sourceVisible: true,
    renderedMounted: false,
    layout: 'source-only'
  });
  assert.deepEqual({ ...activeDisplay.constructs.math[2].presentation }, {
    sourceVisible: true,
    renderedMounted: true,
    layout: 'source-above-rendered'
  });
});

test('Reading AST source annotations isolate math delimiters and underline tag symbols', () => {
  const mathSource = ['$x$', '', '$$', 'y', '$$'].join('\n');
  const math = renderedReadingFixture(mathSource);
  const mathDelimiters = math.blocks.flatMap((block) => descendants(block.element))
    .filter((element) => element.classList?.contains('markdown-math-delimiter-marker'));
  assert.deepEqual(mathDelimiters.map((element) => ({
    text: element.textContent,
    start: Number(element.dataset.markdownSourceStart),
    end: Number(element.dataset.markdownSourceEnd),
    group1: element.classList.contains('is-symbol-group-1')
  })), [
    { text: '$', start: 0, end: 1, group1: true },
    { text: '$', start: 2, end: 3, group1: true },
    { text: '$$', start: 5, end: 7, group1: true },
    { text: '$$', start: 10, end: 12, group1: true }
  ]);

  const underlineSource = '<u>under</u>';
  const underline = renderedReadingFixture(underlineSource);
  const underlineElements = underline.blocks.flatMap((block) => descendants(block.element));
  const wrapper = underlineElements.find((element) => (
    element.classList?.contains('markdown-page-inline-underline')
  ));
  const underlineSymbols = underlineElements.filter((element) => (
    element.classList?.contains('markdown-underline-symbol-marker')
  ));
  const punctuation = underlineElements.filter((element) => (
    element.classList?.contains('is-symbol-group-2')
  ));
  assert.ok(wrapper);
  assert.deepEqual(underlineSymbols.map((element) => [
    element.textContent,
    Number(element.dataset.markdownSourceStart),
    Number(element.dataset.markdownSourceEnd),
    element.classList.contains('is-symbol-group-1')
  ]), [
    ['u', 1, 2, true],
    ['u', 10, 11, true]
  ]);
  assert.deepEqual(punctuation.map((element) => element.textContent), ['<', '>', '</', '>']);
});

test('Reading mounts one renderer while canonical raw owners remain non-visible', () => {
  const rendered = renderedReadingFixture();
  assert.equal(rendered.constructs.length, 3);
  assert.equal(rendered.state.body, fixture);
  assert.equal(rendered.sourceSnapshot.markdownBody, fixture);
  rendered.constructs.forEach((construct) => {
    assert.equal(mountedCount(construct, 'markdown-math-rendered'), 1);
    const source = childWithClass(construct, 'markdown-math-source-representation');
    assert.ok(source);
    assert.equal(source.classList.contains('is-visible'), false);
    assert.equal(construct.dataset.markdownMathPresentation, 'rendered-only');
  });
});

test('Source mounts exact canonical raw LaTeX and no rendered formula representation', () => {
  const rendered = editablePlan(fixture, 'source');
  assert.equal(plannedSource(rendered), fixture);
  assert.equal(rendered.plan.constructs.math.length, 3);
  assert.deepEqual(
    rendered.plan.constructs.math.map((construct) => construct.raw),
    [
      '$x^2 + y^2 = z^2$',
      '$\\mathrm{C_6H_{12}O_6}$',
      '$$\n\\Delta G = \\Delta H - T\\Delta S\n$$'
    ]
  );
  rendered.plan.constructs.math.forEach((construct) => {
    assert.equal(construct.raw, fixture.slice(construct.start, construct.end));
    assert.equal(construct.presentation.renderedMounted, false);
    assert.equal(construct.presentation.sourceVisible, true);
    assert.equal(construct.presentation.layout, 'source-only');
    assert.equal(construct.activationAnchor, null);
  });
  assert.ok(rendered.plan.lines.flatMap((line) => line.leaves)
    .every((leaf) => leaf.visibility === 'visible'));
});

test('active Live inline replaces rendered math while active display orders source before preview', () => {
  const inactive = editablePlan().plan;
  const inlineOwner = inactive.constructs.math[0];
  const displayOwner = inactive.constructs.math[2];
  const inline = editablePlan(fixture, 'live-preview', {
    activeOwnerIds: [inlineOwner.ownerId]
  });
  const display = editablePlan(fixture, 'live-preview', {
    activeOwnerIds: [displayOwner.ownerId]
  });

  assert.deepEqual({ ...inline.plan.constructs.math[0].presentation }, {
    sourceVisible: true,
    renderedMounted: false,
    layout: 'source-only'
  });
  assert.equal(inline.plan.constructs.math[0].raw, '$x^2 + y^2 = z^2$');
  assert.ok(inline.plan.lines.flatMap((line) => line.leaves)
    .filter((leaf) => leaf.semanticOwnerId === inlineOwner.ownerId)
    .every((leaf) => leaf.visibility === 'visible'));

  assert.deepEqual({ ...display.plan.constructs.math[2].presentation }, {
    sourceVisible: true,
    renderedMounted: true,
    layout: 'source-above-rendered'
  });
  assert.equal(
    display.plan.constructs.math[2].raw,
    '$$\n\\Delta G = \\Delta H - T\\Delta S\n$$'
  );
  assert.equal(plannedSource(inline), fixture);
  assert.equal(plannedSource(display), fixture);
});

test('invalid LaTeX remains byte-exact raw source without a Source-mode renderer', () => {
  const invalid = '$$\n\\notARealCommand{\n$$';
  const result = editablePlan(invalid, 'source');
  const construct = result.plan.constructs.math[0];
  assert.ok(construct);
  assert.equal(construct.raw, invalid);
  assert.equal(construct.presentation.renderedMounted, false);
  assert.equal(construct.presentation.layout, 'source-only');
  assert.equal(plannedSource(result), invalid);
  assert.equal(result.sourceSnapshot.markdownBody, invalid);
});
