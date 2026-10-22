'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { boundedInteger, digest, stableStringify } = require('./utils');

async function ddmin(items, reproduces, options = {}) {
  if (!Array.isArray(items)) throw new TypeError('ddmin items must be an array.');
  if (typeof reproduces !== 'function') throw new TypeError('ddmin reproduces must be a function.');
  const maximumEvaluations = boundedInteger(
    options.maximumEvaluations,
    1000,
    1,
    100000,
    'maximumEvaluations'
  );
  let evaluations = 0;
  async function check(candidate) {
    if (evaluations >= maximumEvaluations) return false;
    evaluations += 1;
    return Boolean(await reproduces(candidate));
  }

  let current = [...items];
  if (!(await check(current))) {
    throw new Error('The original sequence does not reproduce the mismatch.');
  }
  let granularity = 2;
  while (current.length >= 2 && evaluations < maximumEvaluations) {
    const chunkSize = Math.ceil(current.length / granularity);
    let reduced = false;
    for (let start = 0; start < current.length; start += chunkSize) {
      const candidate = current.slice(0, start).concat(current.slice(start + chunkSize));
      if (candidate.length === current.length) continue;
      if (await check(candidate)) {
        current = candidate;
        granularity = Math.max(2, granularity - 1);
        reduced = true;
        break;
      }
    }
    if (reduced) continue;
    if (granularity >= current.length) break;
    granularity = Math.min(current.length, granularity * 2);
  }
  return {
    minimized: current,
    originalLength: items.length,
    minimizedLength: current.length,
    evaluations,
    bounded: evaluations <= maximumEvaluations,
    oneMinimal: evaluations < maximumEvaluations
  };
}

async function minimizeFailure(sequence, reproduces, options = {}) {
  if (!sequence || !Array.isArray(sequence.actions)) {
    throw new TypeError('A sequence with an actions array is required.');
  }
  const result = await ddmin(sequence.actions, async (actions) => reproduces({
    ...sequence,
    actions
  }), options);
  const minimizedSequence = {
    ...sequence,
    id: `regression.${digest({
      fixtureId: sequence.fixtureId,
      mode: sequence.mode ?? null,
      state: sequence.state ?? null,
      initialSource: sequence.initialSource,
      initialSelection: sequence.initialSelection ?? null,
      actions: result.minimized
    }).slice(0, 20)}`,
    randomOriginId: sequence.id,
    actions: result.minimized
  };
  return {...result, minimizedSequence};
}

function writeMinimizedRegression(directory, minimizedResult, metadata = {}, options = {}) {
  const sequence = minimizedResult?.minimizedSequence;
  if (!sequence?.id || !Array.isArray(sequence.actions)) {
    throw new TypeError('A minimizeFailure result with minimizedSequence is required.');
  }
  const safeId = String(sequence.id).replace(/[^a-z0-9._-]+/gi, '-');
  const destination = path.join(path.resolve(directory), `${safeId}.json`);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  const document = {
    schemaVersion: 1,
    kind: 'minimized-o1-v1-regression',
    metadata,
    originalLength: minimizedResult.originalLength,
    minimizedLength: minimizedResult.minimizedLength,
    evaluations: minimizedResult.evaluations,
    sequence
  };
  try {
    fs.writeFileSync(destination, `${stableStringify(document)}\n`, {
      flag: options.overwrite === true ? 'w' : 'wx'
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Regression already exists and was not overwritten: ${destination}`);
    }
    throw error;
  }
  return destination;
}

module.exports = Object.freeze({ddmin, minimizeFailure, writeMinimizedRegression});
