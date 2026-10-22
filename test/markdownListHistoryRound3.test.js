'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const gate = require(
  './markdownConformance/scenarios/v0.3ListRandom500HistoryRegressionsRound3.json'
);
const residualGate = require(
  './markdownConformance/scenarios/v0.3ListRandom500HistoryRegressionsRound4.json'
);
const fullTraceGate = require(
  './markdownConformance/scenarios/v0.3ListRandom500HistoryRegressionsRound5.json'
);

async function markdownHistoryApi() {
  const source = await fs.readFile(
    path.join(__dirname, '..', 'public/js/markdownPageView.js'),
    'utf8'
  );
  const root = {
    addEventListener() {},
    markdownPageModel: require('../public/markdownPage')
  };
  vm.runInNewContext(source, {
    console,
    globalThis: root,
    window: root
  });
  return root.markdownPageView;
}

const historyInputTypes = Object.freeze({
  backspace: 'deleteContentBackward',
  delete: 'deleteContentForward',
  enter: 'insertParagraph',
  'shift-enter': 'insertLineBreak',
  'shift-tab': 'formatOutdent',
  tab: 'formatIndent',
  'type-text': 'insertText'
});

function plainSelection(selection) {
  return { anchor: selection.anchor, focus: selection.focus };
}

function selectionsEqual(left, right) {
  return left.anchor === right.anchor && left.focus === right.focus;
}

test('Round-3 list history gate has exactly 19 Undo and 11 Redo first targets', () => {
  assert.equal(gate.schemaVersion, 1);
  assert.equal(gate.kind, 'o1-list-history-regression-gate');
  assert.deepEqual(gate.counts, {
    cases: 30,
    undo: 19,
    redo: 11,
    intermediateSteps: 246
  });
  assert.equal(gate.cases.length, 30);
  assert.equal(new Set(gate.cases.map(({ scenarioId }) => scenarioId)).size, 30);
  assert.equal(gate.cases.filter(({ targetActionId }) => targetActionId === 'undo').length, 19);
  assert.equal(gate.cases.filter(({ targetActionId }) => targetActionId === 'redo').length, 11);
  gate.cases.forEach((scenario) => {
    assert.equal(scenario.steps.at(-1).actionIndex, scenario.targetActionIndex);
    assert.equal(scenario.steps.at(-1).action.id, scenario.targetActionId);
  });
});

test('Round-3 list history prefixes replay every exact O1 history state', async (t) => {
  const api = await markdownHistoryApi();
  let assertedHistorySteps = 0;

  for (const scenario of gate.cases) {
    await t.test(
      `${scenario.scenarioId} action ${scenario.targetActionIndex + 1} ${scenario.targetActionId}`,
      () => {
        let source = scenario.initialSource;
        let selection = plainSelection(scenario.initialSelection);
        const history = api.createMarkdownEditHistory(source);

        scenario.steps.forEach((step) => {
          const expectedSource = step.expected.source;
          const expectedSelection = plainSelection(step.expected.selection);
          const { id, historyEffect } = step.action;

          if (id === 'undo' || id === 'redo') {
            const result = api.stepMarkdownEditHistory(history, id, source);
            assert.ok(result, `${scenario.scenarioId} ${id} is available`);
            assert.equal(
              result.source,
              expectedSource,
              `${scenario.scenarioId} action ${step.actionIndex + 1} ${id} source`
            );
            assert.deepEqual(
              plainSelection(result.selection),
              expectedSelection,
              `${scenario.scenarioId} action ${step.actionIndex + 1} ${id} selection`
            );
            assertedHistorySteps += 1;
            source = result.source;
            selection = plainSelection(result.selection);
            return;
          }

          if (historyEffect === 'navigation') {
            assert.equal(
              expectedSource,
              source,
              `${scenario.scenarioId} navigation preserves source`
            );
            if (!selectionsEqual(selection, expectedSelection)) {
              api.markMarkdownEditHistorySelectionBoundary(history, expectedSelection);
            }
          } else if (expectedSource !== source) {
            assert.ok(historyInputTypes[id], `${scenario.scenarioId} maps ${id} to an input type`);
            api.recordMarkdownEditTransaction(history, {
              beforeSource: source,
              afterSource: expectedSource,
              beforeSelection: selection,
              afterSelection: expectedSelection,
              inputType: historyInputTypes[id],
              timestamp: step.actionIndex * 100
            });
          } else if (id === 'shift-tab') {
            api.recordMarkdownEditTransaction(history, {
              beforeSource: source,
              afterSource: source,
              beforeSelection: selection,
              afterSelection: expectedSelection,
              inputType: 'formatOutdent',
              timestamp: step.actionIndex * 100
            }, {
              coalesce: false,
              recordNoOp: true
            });
          }

          source = expectedSource;
          selection = expectedSelection;
          assert.equal(history.currentSource, source);
        });

        assert.equal(source, scenario.steps.at(-1).expected.source);
        assert.deepEqual(selection, scenario.steps.at(-1).expected.selection);
      }
    );
  }

  assert.ok(assertedHistorySteps >= gate.cases.length);
});

test('Round-4 residual list history gate covers exactly two Undo and one Redo divergence', () => {
  assert.equal(residualGate.schemaVersion, 1);
  assert.equal(residualGate.kind, 'o1-list-history-residual-regression-gate');
  assert.deepEqual(residualGate.counts, {
    cases: 3,
    undoDivergences: 2,
    redoDivergences: 1,
    exactHistorySteps: 5,
    intermediateSteps: 11
  });
  assert.equal(residualGate.cases.length, 3);
  assert.equal(new Set(residualGate.cases.map(({ scenarioId }) => scenarioId)).size, 3);
  assert.equal(
    residualGate.cases.filter(({ divergenceActionId }) => divergenceActionId === 'undo').length,
    2
  );
  assert.equal(
    residualGate.cases.filter(({ divergenceActionId }) => divergenceActionId === 'redo').length,
    1
  );
  residualGate.cases.forEach((scenario) => {
    assert.equal(
      scenario.steps[scenario.divergenceActionIndex].action.id,
      scenario.divergenceActionId
    );
  });
});

test('Round-4 residual list history prefixes replay every exact O1 state', async (t) => {
  const api = await markdownHistoryApi();
  let assertedHistorySteps = 0;

  for (const scenario of residualGate.cases) {
    await t.test(
      `${scenario.scenarioId} ${scenario.divergenceActionId}`,
      () => {
        let source = scenario.initialSource;
        let selection = plainSelection(scenario.initialSelection);
        const history = api.createMarkdownEditHistory(source);

        scenario.steps.forEach((step) => {
          const expectedSource = step.expected.source;
          const expectedSelection = plainSelection(step.expected.selection);
          const { id, historyEffect } = step.action;

          if (id === 'undo' || id === 'redo') {
            const result = api.stepMarkdownEditHistory(history, id, source);
            assert.ok(result, `${scenario.scenarioId} ${id} is available`);
            assert.equal(
              result.source,
              expectedSource,
              `${scenario.scenarioId} action ${step.actionIndex + 1} ${id} source`
            );
            assert.deepEqual(
              plainSelection(result.selection),
              expectedSelection,
              `${scenario.scenarioId} action ${step.actionIndex + 1} ${id} selection`
            );
            assertedHistorySteps += 1;
            source = result.source;
            selection = plainSelection(result.selection);
            return;
          }

          if (historyEffect === 'navigation') {
            assert.equal(
              expectedSource,
              source,
              `${scenario.scenarioId} navigation preserves source`
            );
            if (!selectionsEqual(selection, expectedSelection)) {
              api.markMarkdownEditHistorySelectionBoundary(history, expectedSelection);
            }
          } else if (expectedSource !== source) {
            assert.ok(historyInputTypes[id], `${scenario.scenarioId} maps ${id} to an input type`);
            api.recordMarkdownEditTransaction(history, {
              beforeSource: source,
              afterSource: expectedSource,
              beforeSelection: selection,
              afterSelection: expectedSelection,
              inputType: historyInputTypes[id],
              timestamp: step.actionIndex * 100
            });
          }

          source = expectedSource;
          selection = expectedSelection;
          assert.equal(history.currentSource, source);
        });

        assert.equal(source, scenario.steps.at(-1).expected.source);
        assert.deepEqual(selection, scenario.steps.at(-1).expected.selection);
      }
    );
  }

  assert.equal(assertedHistorySteps, residualGate.counts.exactHistorySteps);
});

test('Round-5 full-trace history gate covers four origins and seven divergent actions', () => {
  assert.equal(fullTraceGate.schemaVersion, 1);
  assert.equal(fullTraceGate.kind, 'o1-list-history-full-trace-regression-gate');
  assert.deepEqual(fullTraceGate.counts, {
    origins: 4,
    divergentActions: 7,
    exactHistorySteps: 10,
    navigationSteps: 10,
    editSteps: 21,
    intermediateSteps: 41
  });
  assert.equal(fullTraceGate.cases.length, 4);
  assert.equal(new Set(fullTraceGate.cases.map(({ scenarioId }) => scenarioId)).size, 4);
  assert.deepEqual(
    fullTraceGate.cases.flatMap((scenario) => scenario.divergentActionNumbers.map(
      (actionNumber) => `${scenario.scenarioId}:${actionNumber}:${scenario.steps[actionNumber - 1].action.id}`
    )),
    [
      'list-random-500.002.ab87e9a2e3876e26:7:undo',
      'list-random-500.090.db357197c37d622e:6:undo',
      'list-random-500.118.a9ac910c37812c16:8:undo',
      'list-random-500.264.ac52270c30fa0c8d:9:redo',
      'list-random-500.264.ac52270c30fa0c8d:10:delete',
      'list-random-500.264.ac52270c30fa0c8d:11:type-text',
      'list-random-500.264.ac52270c30fa0c8d:12:arrowleft'
    ]
  );
});

test('Round-5 full list prefixes replay every exact O1 state through downstream actions', async (t) => {
  const api = await markdownHistoryApi();
  let assertedHistorySteps = 0;

  for (const scenario of fullTraceGate.cases) {
    await t.test(scenario.scenarioId, () => {
      let source = scenario.initialSource;
      let selection = plainSelection(scenario.initialSelection);
      const history = api.createMarkdownEditHistory(source);

      scenario.steps.forEach((step) => {
        const expectedSource = step.expected.source;
        const expectedSelection = plainSelection(step.expected.selection);
        const { id, historyEffect } = step.action;

        if (id === 'undo' || id === 'redo') {
          const result = api.stepMarkdownEditHistory(history, id, source);
          assert.ok(result, `${scenario.scenarioId} ${id} is available`);
          assert.equal(
            result.source,
            expectedSource,
            `${scenario.scenarioId} action ${step.actionIndex + 1} ${id} source`
          );
          assert.deepEqual(
            plainSelection(result.selection),
            expectedSelection,
            `${scenario.scenarioId} action ${step.actionIndex + 1} ${id} selection`
          );
          assertedHistorySteps += 1;
          source = result.source;
          selection = plainSelection(result.selection);
          return;
        }

        if (historyEffect === 'navigation') {
          assert.equal(
            expectedSource,
            source,
            `${scenario.scenarioId} navigation preserves source`
          );
          if (!selectionsEqual(selection, expectedSelection)) {
            api.markMarkdownEditHistorySelectionBoundary(history, expectedSelection);
          }
        } else if (expectedSource !== source) {
          assert.ok(historyInputTypes[id], `${scenario.scenarioId} maps ${id} to an input type`);
          api.recordMarkdownEditTransaction(history, {
            beforeSource: source,
            afterSource: expectedSource,
            beforeSelection: selection,
            afterSelection: expectedSelection,
            inputType: historyInputTypes[id],
            timestamp: step.actionIndex * 100
          });
        } else if (id === 'shift-tab') {
          api.recordMarkdownEditTransaction(history, {
            beforeSource: source,
            afterSource: source,
            beforeSelection: selection,
            afterSelection: expectedSelection,
            inputType: 'formatOutdent',
            timestamp: step.actionIndex * 100
          }, {
            coalesce: false,
            recordNoOp: true
          });
        }

        source = expectedSource;
        selection = expectedSelection;
        assert.equal(history.currentSource, source);
      });

      assert.equal(source, scenario.steps.at(-1).expected.source);
      assert.deepEqual(selection, scenario.steps.at(-1).expected.selection);
    });
  }

  assert.equal(assertedHistorySteps, fullTraceGate.counts.exactHistorySteps);
});
