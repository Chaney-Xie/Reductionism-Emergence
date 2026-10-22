'use strict';

const crypto = require('node:crypto');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function stableStringify(value, spacing = 2) {
  return JSON.stringify(canonicalize(value), null, spacing);
}

function digest(value) {
  const input = typeof value === 'string' ? value : stableStringify(value, 0);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function getPath(value, path) {
  if (!path) return value;
  return String(path).split('.').reduce((cursor, segment) => (
    cursor == null ? undefined : cursor[segment]
  ), value);
}

function hasPath(value, path) {
  if (!path) return true;
  let cursor = value;
  for (const segment of String(path).split('.')) {
    if (cursor == null || !Object.prototype.hasOwnProperty.call(Object(cursor), segment)) {
      return false;
    }
    cursor = cursor[segment];
  }
  return true;
}

function deepEqual(left, right) {
  return stableStringify(left, 0) === stableStringify(right, 0);
}

function pathMatches(pattern, path) {
  const patternParts = String(pattern).split('.');
  const pathParts = String(path).split('.');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part === '*' || part === pathParts[index]);
}

function matchesWhen(when, context) {
  if (!when) return true;
  return Object.entries(when).every(([key, expected]) => {
    const actual = getPath(context, key);
    return Array.isArray(expected) ? expected.includes(actual) : deepEqual(actual, expected);
  });
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return number;
}

module.exports = Object.freeze({
  boundedInteger,
  canonicalize,
  deepEqual,
  digest,
  getPath,
  hasPath,
  isPlainObject,
  matchesWhen,
  pathMatches,
  stableStringify
});
