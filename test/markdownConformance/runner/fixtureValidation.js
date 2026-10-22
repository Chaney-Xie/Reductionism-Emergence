'use strict';

const { physicalLines, semanticObservationFromViewer } = require('./observations');
const { resolveTarget } = require('../scenarios/generator');

function validateSemanticAssertions(fixture, semantic) {
  const errors = [];
  const assertions = fixture.semanticAssertions || {};
  const types = semantic.nodes.map((node) => node.type);
  (assertions.containsTypes || []).forEach((type) => {
    if (!types.includes(type)) errors.push(`missing semantic type ${type}`);
  });
  (assertions.excludesTypes || []).forEach((type) => {
    if (types.includes(type)) errors.push(`unexpected semantic type ${type}`);
  });
  if (assertions.rootTypes && JSON.stringify(assertions.rootTypes) !== JSON.stringify(semantic.rootTypes)) {
    errors.push(`root types ${JSON.stringify(semantic.rootTypes)} != ${JSON.stringify(assertions.rootTypes)}`);
  }
  if (assertions.headingDepths) {
    const depths = semantic.nodes.filter((node) => node.type === 'heading').map((node) => node.depth);
    if (JSON.stringify(depths) !== JSON.stringify(assertions.headingDepths)) {
      errors.push(`heading depths ${JSON.stringify(depths)} != ${JSON.stringify(assertions.headingDepths)}`);
    }
  }
  if (assertions.quoteDepth != null && semantic.maximumQuoteDepth !== assertions.quoteDepth) {
    errors.push(`quote depth ${semantic.maximumQuoteDepth} != ${assertions.quoteDepth}`);
  }
  return errors;
}

function validateFixtures(fixturesDocument, inventoryDocument, options = {}) {
  const inventory = new Set((inventoryDocument?.syntax || []).map((entry) => entry.id));
  const errors = [];
  const ids = new Set();
  const fixtureResults = [];
  for (const fixture of fixturesDocument?.fixtures || []) {
    const fixtureErrors = [];
    if (!fixture.id) fixtureErrors.push('missing id');
    if (ids.has(fixture.id)) fixtureErrors.push('duplicate id');
    ids.add(fixture.id);
    if (!inventory.has(fixture.syntaxFamily)) fixtureErrors.push(`unknown syntax family ${fixture.syntaxFamily}`);
    try {
      resolveTarget(fixture);
    } catch (error) {
      fixtureErrors.push(error.message);
    }
    const lineCount = physicalLines(fixture.source).length;
    if (fixture.expectedPhysicalLineCount != null && lineCount !== fixture.expectedPhysicalLineCount) {
      fixtureErrors.push(`physical line count ${lineCount} != ${fixture.expectedPhysicalLineCount}`);
    }
    if (options.semantic !== false) {
      try {
        fixtureErrors.push(...validateSemanticAssertions(
          fixture,
          semanticObservationFromViewer(fixture.source)
        ));
      } catch (error) {
        fixtureErrors.push(`Viewer parser failed: ${error.message}`);
      }
    }
    fixtureResults.push({id: fixture.id, valid: fixtureErrors.length === 0, errors: fixtureErrors});
    fixtureErrors.forEach((error) => errors.push(`${fixture.id}: ${error}`));
  }
  return {valid: errors.length === 0, errors, fixtures: fixtureResults};
}

module.exports = Object.freeze({validateFixtures, validateSemanticAssertions});
