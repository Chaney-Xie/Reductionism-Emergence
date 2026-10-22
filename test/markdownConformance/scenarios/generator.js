'use strict';

const { digest } = require('../runner/utils');
const { physicalLines } = require('../runner/observations');

const EDITABLE_MODES = new Set(['source', 'live-preview']);

function nthIndexOf(source, needle, occurrence = 0) {
  if (needle === '') return 0;
  let from = 0;
  let found = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    found = source.indexOf(needle, from);
    if (found < 0) return -1;
    from = found + Math.max(needle.length, 1);
  }
  return found;
}

function resolveTarget(fixture) {
  const source = String(fixture.source ?? '');
  if (Number.isFinite(fixture.target?.offset)) {
    const offset = Math.max(0, Math.min(source.length, Number(fixture.target.offset)));
    return { start: offset, end: offset };
  }
  const needle = String(fixture.target?.needle ?? '');
  const startIndex = nthIndexOf(source, needle, Number(fixture.target?.occurrence) || 0);
  if (startIndex < 0) throw new Error(`Fixture ${fixture.id} target needle was not found: ${needle}`);
  const offsetWithinNeedle = Number(fixture.target?.offsetWithinNeedle) || 0;
  const start = Math.max(startIndex, Math.min(startIndex + needle.length, startIndex + offsetWithinNeedle));
  return { start, end: startIndex + needle.length };
}

function nearestOpening(source, targetStart, marker) {
  if (!marker) return null;
  const index = source.lastIndexOf(marker, targetStart);
  return index < 0 ? null : { start: index, end: index + marker.length };
}

function nearestClosing(source, targetEnd, marker) {
  if (!marker) return null;
  const index = source.indexOf(marker, targetEnd);
  return index < 0 ? null : { start: index, end: index + marker.length };
}

function boundaryPositions(fixture) {
  const source = String(fixture.source ?? '');
  const target = resolveTarget(fixture);
  const opening = nearestOpening(source, target.start, fixture.markers?.opening);
  const closing = nearestClosing(source, target.end, fixture.markers?.closing);
  const lines = physicalLines(source);
  const targetLine = lines.find((line) => target.start >= line.start && (
    target.start <= line.end || target.start < line.endWithEnding || line.terminal
  ))
    || lines[lines.length - 1];
  const nextLine = lines[targetLine.index + 1];
  const firstBlank = lines.find((line) => line.blank && !line.terminal);
  const terminal = lines[lines.length - 1];
  const candidates = [
    {name: 'document-start', offset: 0},
    opening && {name: 'after-opening-marker', offset: opening.end},
    {name: 'text-start', offset: target.start},
    {name: 'text-middle', offset: Math.floor((target.start + target.end) / 2)},
    {name: 'text-end', offset: target.end},
    closing && {name: 'before-closing-marker', offset: closing.start},
    {name: 'physical-line-end', offset: targetLine.end},
    nextLine && {name: 'next-physical-line-start', offset: nextLine.start},
    firstBlank && {name: 'blank-line', offset: firstBlank.start},
    {name: 'terminal-line', offset: terminal.start},
    {name: 'document-end', offset: source.length}
  ].filter(Boolean);
  const seen = new Set();
  return candidates.filter((boundary) => {
    const key = `${boundary.name}:${boundary.offset}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function actionIsMeaningful(action, fixture, mode, boundary) {
  const editable = EDITABLE_MODES.has(mode);
  if (action.editable && !editable) return false;
  if (mode === 'reading' && !['inspect', 'click', 'switch-mode', 'reopen-note'].includes(action.id)) {
    return false;
  }
  if (Array.isArray(action.families) && !action.families.includes(fixture.syntaxFamily)) return false;
  if (action.requiresMultipleLines && physicalLines(fixture.source).length < 2) return false;
  if (['backspace', 'arrow-left'].includes(action.id) && boundary.offset === 0) return false;
  if (['delete', 'arrow-right'].includes(action.id) && boundary.offset === fixture.source.length) return false;
  if (action.id === 'select-target' && boundary.name !== 'text-start') return false;
  if (['switch-mode', 'reopen-note'].includes(action.id) && boundary.name !== 'text-middle') return false;
  if (action.id === 'click' && !['text-start', 'text-middle', 'blank-line', 'terminal-line'].includes(boundary.name)) return false;
  if (action.id === 'inspect' && boundary.name !== 'text-middle') return false;
  return true;
}

function scenarioModes(fixture) {
  const requested = fixture.modes || ['source', 'live-preview', 'reading'];
  const modes = [];
  for (const mode of requested) {
    if (mode === 'live-preview') {
      modes.push({mode, active: false}, {mode, active: true});
    } else {
      modes.push({mode, active: mode === 'source'});
    }
  }
  return modes;
}

function scenarioId(parts) {
  const readable = parts.join('.').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
  return readable.length <= 180 ? readable : `${readable.slice(0, 160)}.${digest(readable).slice(0, 12)}`;
}

function makeInitialSelection(fixture, boundary, action) {
  if (action.id === 'select-target') {
    const target = resolveTarget(fixture);
    return {anchor: target.start, focus: target.end};
  }
  return {anchor: boundary.offset, focus: boundary.offset};
}

function generateScenarios(fixturesDocument, actionDocument, options = {}) {
  const fixtures = [...(fixturesDocument?.fixtures || [])].sort((a, b) => a.id.localeCompare(b.id));
  const actions = [...(actionDocument?.actions || [])].sort((a, b) => a.id.localeCompare(b.id));
  const familyFilter = options.families ? new Set(options.families) : null;
  const scenarios = [];
  fixtures.forEach((fixture) => {
    if (familyFilter && !familyFilter.has(fixture.syntaxFamily)) return;
    boundaryPositions(fixture).forEach((boundary) => {
      scenarioModes(fixture).forEach(({mode, active}) => {
        actions.forEach((action) => {
          if (!actionIsMeaningful(action, fixture, mode, boundary)) return;
          if (mode === 'live-preview' && !active && action.editable && action.id !== 'click') return;
          const id = scenarioId([
            fixture.syntaxFamily,
            fixture.id,
            mode,
            active ? 'active' : 'inactive',
            boundary.name,
            action.id
          ]);
          scenarios.push({
            id,
            schemaVersion: 1,
            fixtureId: fixture.id,
            syntaxFamily: fixture.syntaxFamily,
            initialSource: fixture.source,
            mode,
            state: {active, ...(fixture.metadata || {})},
            initialSelection: makeInitialSelection(fixture, boundary, action),
            boundary,
            action: {...action},
            requiredObservations: action.id === 'inspect'
              ? ['source', 'physical', 'semantic', 'presentation']
              : ['source', 'selection', 'physical', 'semantic'],
            tags: [...(fixture.tags || [])]
          });
        });
      });
    });
  });
  scenarios.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt || null,
    deterministic: true,
    fixtureCount: fixtures.length,
    scenarioCount: scenarios.length,
    corpusSha256: digest(scenarios),
    scenarios
  };
}

module.exports = Object.freeze({
  actionIsMeaningful,
  boundaryPositions,
  generateScenarios,
  nthIndexOf,
  resolveTarget,
  scenarioModes
});
