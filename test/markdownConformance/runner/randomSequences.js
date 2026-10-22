'use strict';

const { boundedInteger, digest } = require('./utils');
const { resolveTarget } = require('../scenarios/generator');
const CERTIFICATION_PROFILE = require('../scenarios/certificationRandomProfile.json');

function seedWords(seed) {
  const text = String(seed ?? 'markdown-conformance-v0.3');
  let state = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    state = Math.imul(state ^ text.charCodeAt(index), 3432918353);
    state = state << 13 | state >>> 19;
  }
  return () => {
    state = Math.imul(state ^ state >>> 16, 2246822507);
    state = Math.imul(state ^ state >>> 13, 3266489909);
    state ^= state >>> 16;
    return state >>> 0;
  };
}

function seededRandom(seed) {
  const nextSeed = seedWords(seed);
  let state = nextSeed();
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

const GENERAL_ACTIONS = Object.freeze([
  {type: 'input', command: 'insertText', text: 'x'},
  {type: 'input', command: 'insertText', text: ' '},
  {type: 'keyboard', key: 'Enter'},
  {type: 'keyboard', key: 'Enter', shiftKey: true},
  {type: 'keyboard', key: 'Backspace'},
  {type: 'keyboard', key: 'Delete'},
  {type: 'keyboard', key: 'ArrowLeft'},
  {type: 'keyboard', key: 'ArrowRight'},
  {type: 'keyboard', key: 'ArrowUp'},
  {type: 'keyboard', key: 'ArrowDown'},
  {type: 'keyboard', key: 'Tab'},
  {type: 'keyboard', key: 'Tab', shiftKey: true},
  {type: 'keyboard', key: 'z', modifiers: ['platform-primary']},
  {type: 'keyboard', key: 'z', modifiers: ['platform-primary', 'shift']}
]);

const STRUCTURAL_ACTIONS = Object.freeze([
  {type: 'keyboard', key: 'Tab'},
  {type: 'keyboard', key: 'Tab', shiftKey: true}
]);

const STRUCTURAL_FAMILIES = new Set([
  'ordered-lists',
  'unordered-lists',
  'mixed-lists',
  'task-lists',
  'quotes',
  'fenced-code'
]);

function randomizedAction(random, fixture) {
  const pool = STRUCTURAL_FAMILIES.has(fixture.syntaxFamily)
    ? [...GENERAL_ACTIONS, ...STRUCTURAL_ACTIONS]
    : GENERAL_ACTIONS;
  const action = {...pick(random, pool)};
  if (action.command === 'insertText' && action.text === 'x') {
    action.text = pick(random, ['x', 'A', '1', '*', '>', '$', '`']);
  }
  return action;
}

function generateRandomSequences(fixturesDocument, options = {}) {
  const fixtures = (fixturesDocument?.fixtures || []).filter((fixture) => fixture.random !== false);
  if (!fixtures.length) throw new Error('At least one random-sequence fixture is required.');
  const seed = String(options.seed ?? 'markdown-conformance-v0.3');
  const count = boundedInteger(options.count, 100, 1, 10000, 'count');
  const minimumActions = boundedInteger(options.minimumActions, 3, 1, 100, 'minimumActions');
  const maximumActions = boundedInteger(options.maximumActions, 20, minimumActions, 100, 'maximumActions');
  const random = seededRandom(seed);
  const sequences = [];
  for (let index = 0; index < count; index += 1) {
    const fixture = pick(random, fixtures);
    const target = resolveTarget(fixture);
    const actionCount = minimumActions
      + Math.floor(random() * (maximumActions - minimumActions + 1));
    const actions = Array.from({length: actionCount}, () => randomizedAction(random, fixture));
    const payload = {
      seed,
      index,
      fixtureId: fixture.id,
      syntaxFamily: fixture.syntaxFamily,
      initialSource: fixture.source,
      mode: pick(random, ['source', 'live-preview']),
      initialSelection: {anchor: target.start, focus: target.start},
      actions,
      requiredObservations: ['source', 'selection', 'physical', 'semantic']
    };
    sequences.push({
      id: `random.${digest(payload).slice(0, 20)}`,
      schemaVersion: 1,
      ...payload
    });
  }
  return {
    schemaVersion: 1,
    deterministic: true,
    bounded: true,
    seed,
    count,
    minimumActions,
    maximumActions,
    corpusSha256: digest(sequences),
    sequences
  };
}

const CERTIFICATION_GUARANTEED_EDITS = Object.freeze([
  {type: 'input', command: 'insertText', text: 'x', certificationEffect: 'guaranteed-edit'},
  {type: 'input', command: 'insertText', text: ' ', certificationEffect: 'guaranteed-edit'},
  {type: 'keyboard', key: 'Enter', certificationEffect: 'guaranteed-edit'},
  {type: 'keyboard', key: 'Enter', shiftKey: true, certificationEffect: 'guaranteed-edit'}
]);

const CERTIFICATION_AMBIGUOUS_EDITS = Object.freeze([
  {type: 'keyboard', key: 'Backspace', certificationEffect: 'possible-edit'},
  {type: 'keyboard', key: 'Delete', certificationEffect: 'possible-edit'},
  {type: 'keyboard', key: 'Tab', certificationEffect: 'possible-edit'},
  {type: 'keyboard', key: 'Tab', shiftKey: true, certificationEffect: 'possible-edit'}
]);

const CERTIFICATION_HORIZONTAL_NAVIGATION = Object.freeze([
  {type: 'keyboard', key: 'ArrowLeft', certificationEffect: 'navigation'},
  {type: 'keyboard', key: 'ArrowRight', certificationEffect: 'navigation'}
]);

const CERTIFICATION_UNDO = Object.freeze({
  type: 'keyboard',
  key: 'z',
  modifiers: ['platform-primary'],
  certificationEffect: 'undo'
});

const CERTIFICATION_REDO = Object.freeze({
  type: 'keyboard',
  key: 'z',
  modifiers: ['platform-primary', 'shift'],
  certificationEffect: 'redo'
});

function certificationInsertAction(random) {
  const action = {...pick(random, CERTIFICATION_GUARANTEED_EDITS)};
  if (action.command === 'insertText' && action.text === 'x') {
    action.text = pick(random, ['x', 'A', '1', '*', '>', '$', '`']);
  }
  return action;
}

function applyCertificationHistory(state, action) {
  switch (action.certificationEffect) {
    case 'guaranteed-edit':
      state.guaranteedUndoDepth += 1;
      state.redoArmed = false;
      break;
    case 'possible-edit':
      // It may mutate in one editor and no-op in another, so it cannot prove a
      // future Undo is available and it always invalidates comparable Redo.
      state.redoArmed = false;
      break;
    case 'undo':
      if (state.guaranteedUndoDepth <= 0) {
        throw new Error('Certification grammar attempted Undo without a guaranteed edit.');
      }
      state.guaranteedUndoDepth -= 1;
      state.redoArmed = true;
      break;
    case 'redo':
      if (!state.redoArmed) {
        throw new Error('Certification grammar attempted Redo without an immediately preceding Undo.');
      }
      state.guaranteedUndoDepth += 1;
      state.redoArmed = false;
      break;
    default:
      // Even non-mutating cursor movement is deliberately not placed between
      // Undo and Redo; different history implementations can record selection.
      state.redoArmed = false;
  }
}

function nextCertificationAction(random, state) {
  const choices = [
    ...CERTIFICATION_GUARANTEED_EDITS,
    ...CERTIFICATION_AMBIGUOUS_EDITS,
    ...CERTIFICATION_HORIZONTAL_NAVIGATION
  ];
  if (state.guaranteedUndoDepth > 0) choices.push(CERTIFICATION_UNDO);
  if (state.redoArmed) {
    // Redo is intentionally forced immediately; no navigation or possible edit
    // can make its validity editor-dependent.
    return {...CERTIFICATION_REDO};
  }
  const selected = pick(random, choices);
  return selected.certificationEffect === 'guaranteed-edit'
    ? certificationInsertAction(random)
    : {...selected};
}

function validateCertificationHistory(actions) {
  const errors = [];
  const state = {guaranteedUndoDepth: 0, redoArmed: false};
  actions.forEach((action, index) => {
    if (['ArrowUp', 'ArrowDown'].includes(action.key)
      && action.comparison !== 'non-comparable') {
      errors.push(`action ${index}: vertical navigation is not marked non-comparable`);
    }
    try {
      applyCertificationHistory(state, action);
    } catch (error) {
      errors.push(`action ${index}: ${error.message}`);
      state.redoArmed = false;
    }
  });
  return {valid: errors.length === 0, errors};
}

function generateCertificationRandomSequences(fixturesDocument, options = {}) {
  const fixtures = (fixturesDocument?.fixtures || []).filter((fixture) => fixture.random !== false);
  if (!fixtures.length) throw new Error('At least one certification fixture is required.');
  const seed = String(options.seed ?? CERTIFICATION_PROFILE.seed);
  const count = boundedInteger(
    options.count,
    CERTIFICATION_PROFILE.count,
    1,
    CERTIFICATION_PROFILE.bounds.maximumSequences,
    'count'
  );
  const minimumActions = boundedInteger(
    options.minimumActions,
    CERTIFICATION_PROFILE.minimumActions,
    3,
    CERTIFICATION_PROFILE.bounds.maximumActionsPerSequence,
    'minimumActions'
  );
  const maximumActions = boundedInteger(
    options.maximumActions,
    CERTIFICATION_PROFILE.maximumActions,
    minimumActions,
    CERTIFICATION_PROFILE.bounds.maximumActionsPerSequence,
    'maximumActions'
  );
  const includeVertical = options.includeNonComparableVerticalNavigation === true;
  const random = seededRandom(seed);
  const sequences = [];
  for (let index = 0; index < count; index += 1) {
    const fixture = pick(random, fixtures);
    const target = resolveTarget(fixture);
    const actionCount = minimumActions
      + Math.floor(random() * (maximumActions - minimumActions + 1));
    const comparableActionCount = actionCount - (includeVertical ? 1 : 0);
    const state = {guaranteedUndoDepth: 0, redoArmed: false};
    const actions = [];

    // Every trace begins with a guaranteed transaction. A quarter also starts
    // with a guaranteed Undo→Redo control, so both history paths are present in
    // every deterministic 100-sequence corpus without relying on chance.
    const first = certificationInsertAction(random);
    actions.push(first);
    applyCertificationHistory(state, first);
    if (index % 4 === 0 && actions.length + 2 <= comparableActionCount) {
      actions.push({...CERTIFICATION_UNDO});
      applyCertificationHistory(state, CERTIFICATION_UNDO);
      actions.push({...CERTIFICATION_REDO});
      applyCertificationHistory(state, CERTIFICATION_REDO);
    }
    while (actions.length < comparableActionCount) {
      const action = nextCertificationAction(random, state);
      actions.push(action);
      applyCertificationHistory(state, action);
    }

    if (includeVertical) {
      actions.push({
        type: 'keyboard',
        key: pick(random, ['ArrowUp', 'ArrowDown']),
        certificationEffect: 'navigation',
        comparison: 'non-comparable',
        nonComparableDimensions: ['selection'],
        reason: 'Vertical caret geometry is editor-specific; this terminal action cannot affect later source edits.'
      });
    }
    const validation = validateCertificationHistory(actions);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    const payload = {
      profile: CERTIFICATION_PROFILE.id,
      seed,
      index,
      fixtureId: fixture.id,
      syntaxFamily: fixture.syntaxFamily,
      initialSource: fixture.source,
      mode: pick(random, ['source', 'live-preview']),
      state: {active: true},
      initialSelection: {anchor: target.start, focus: target.start},
      actions,
      comparisonPolicy: includeVertical
        ? {kind: 'source-comparable', nonComparableDimensions: ['selection']}
        : {kind: 'fully-comparable', nonComparableDimensions: []},
      requiredObservations: includeVertical
        ? ['source', 'physical', 'semantic']
        : ['source', 'selection', 'physical', 'semantic']
    };
    sequences.push({
      id: `certification-random.${digest(payload).slice(0, 20)}`,
      schemaVersion: 1,
      ...payload
    });
  }
  return {
    schemaVersion: 1,
    profile: CERTIFICATION_PROFILE.id,
    diagnostic: false,
    deterministic: true,
    bounded: true,
    seed,
    count,
    minimumActions,
    maximumActions,
    verticalNavigation: includeVertical ? 'terminal-non-comparable' : 'excluded',
    corpusSha256: digest(sequences),
    sequences
  };
}

module.exports = Object.freeze({
  CERTIFICATION_PROFILE,
  GENERAL_ACTIONS,
  STRUCTURAL_ACTIONS,
  generateCertificationRandomSequences,
  generateRandomSequences,
  seededRandom,
  validateCertificationHistory
});
