const test = require('node:test');
const assert = require('node:assert/strict');

const numbering = require('../public/hnListNumbering');

const {
  SCHEMES,
  recognizeMarker,
  nextMarker,
  defaultChildMarker
} = numbering;

test('numbering exposes exactly the five HN List schemes', () => {
  assert.deepEqual(SCHEMES, {
    DECIMAL: 'decimal',
    DOTTED_DECIMAL: 'dotted_decimal',
    UPPER_ROMAN_LEFT: 'upper_roman_left',
    LOWER_ROMAN_LEFT: 'lower_roman_left',
    LOWER_ALPHA_LEFT: 'lower_alpha_left'
  });
  assert.deepEqual(numbering.SCHEME_VALUES, Object.values(SCHEMES));
});

test('recognition requires the terminating Space and keeps it out of marker metadata', () => {
  assert.deepEqual(recognizeMarker('12. '), {
    scheme: SCHEMES.DECIMAL,
    startOrdinal: 12,
    dottedPrefix: null,
    ordinal: 12,
    path: null,
    marker: '12.'
  });
  assert.equal(recognizeMarker('12.'), null);
  assert.equal(recognizeMarker('12.  '), null);
  assert.equal(recognizeMarker('12.\t'), null);
  assert.equal(recognizeMarker(' 12. '), null);
  assert.equal(recognizeMarker('12. prose '), null);
  assert.equal(recognizeMarker('0. '), null);
  assert.equal(recognizeMarker('01. '), null);
});

test('plain decimal and dotted decimal remain distinct canonical schemes', () => {
  assert.equal(recognizeMarker('1. ').scheme, SCHEMES.DECIMAL);
  assert.deepEqual(recognizeMarker('3.7.4. '), {
    scheme: SCHEMES.DOTTED_DECIMAL,
    startOrdinal: 4,
    dottedPrefix: [3, 7],
    ordinal: 4,
    path: [3, 7, 4],
    marker: '3.7.4.'
  });
  assert.equal(recognizeMarker('1.1. ').scheme, SCHEMES.DOTTED_DECIMAL);
  assert.equal(recognizeMarker('1.0. '), null);
  assert.equal(recognizeMarker('1.01. '), null);
  assert.equal(recognizeMarker('1..1. '), null);
});

test('Roman recognition is canonical and uses a left parenthesis only', () => {
  assert.deepEqual(recognizeMarker('(IV '), {
    scheme: SCHEMES.UPPER_ROMAN_LEFT,
    startOrdinal: 4,
    dottedPrefix: null,
    ordinal: 4,
    path: null,
    marker: '(IV'
  });
  assert.equal(recognizeMarker('(iii ').scheme, SCHEMES.LOWER_ROMAN_LEFT);
  assert.equal(recognizeMarker('(IX) '), null);
  assert.equal(recognizeMarker('IX. '), null);
  assert.equal(recognizeMarker('(IIII '), null);
  assert.equal(recognizeMarker('(VX '), null);
  assert.equal(recognizeMarker('(MMMM '), null);
});

test('lower alphabetic recognition supports continuation and exact context ambiguity', () => {
  assert.equal(recognizeMarker('(a ').scheme, SCHEMES.LOWER_ALPHA_LEFT);
  assert.equal(recognizeMarker('(j ').scheme, SCHEMES.LOWER_ALPHA_LEFT);
  assert.equal(recognizeMarker('(aa ').scheme, SCHEMES.LOWER_ALPHA_LEFT);

  assert.equal(recognizeMarker('(i ').scheme, SCHEMES.LOWER_ROMAN_LEFT,
    'context-free (i defaults to lower Roman');
  assert.equal(recognizeMarker('(i ', SCHEMES.LOWER_ROMAN_LEFT).scheme,
    SCHEMES.LOWER_ROMAN_LEFT);
  assert.equal(recognizeMarker('(i ', { scheme: SCHEMES.LOWER_ALPHA_LEFT }).scheme,
    SCHEMES.LOWER_ALPHA_LEFT);
  assert.equal(recognizeMarker('(j ', { scheme: SCHEMES.LOWER_ROMAN_LEFT }).scheme,
    SCHEMES.LOWER_ALPHA_LEFT, 'an explicit valid marker can switch the scheme');
  assert.equal(recognizeMarker('(ii ', { scheme: SCHEMES.LOWER_ALPHA_LEFT }).scheme,
    SCHEMES.LOWER_ALPHA_LEFT, 'alphabetic sibling context owns an ambiguous token');
});

test('recognition results and their dotted paths are immutable values', () => {
  const result = recognizeMarker('3.7.4. ');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.path), true);
  assert.equal(Object.isFrozen(result.dottedPrefix), true);
  assert.throws(() => result.path.push(5), TypeError);
});

test('nextMarker advances only the current sibling sequence', () => {
  assert.equal(nextMarker(SCHEMES.DECIMAL, 1), '2.');
  assert.equal(nextMarker(SCHEMES.DECIMAL, '12.'), '13.');
  assert.equal(nextMarker(SCHEMES.DOTTED_DECIMAL, [1, 1]), '1.2.');
  assert.equal(nextMarker(SCHEMES.DOTTED_DECIMAL, [3, 7, 4]), '3.7.5.');
  assert.equal(nextMarker(SCHEMES.DOTTED_DECIMAL, recognizeMarker('3.7.4. ')), '3.7.5.');
  assert.equal(nextMarker({ scheme: SCHEMES.DOTTED_DECIMAL, dottedPrefix: [3, 7] }, 4),
    '3.7.5.');
  assert.equal(nextMarker(SCHEMES.UPPER_ROMAN_LEFT, 3), '(IV');
  assert.equal(nextMarker(SCHEMES.LOWER_ROMAN_LEFT, '(iii'), '(iv');
  assert.equal(nextMarker(SCHEMES.LOWER_ALPHA_LEFT, 8), '(i');
  assert.equal(nextMarker(SCHEMES.LOWER_ALPHA_LEFT, 26), '(aa');
});

test('defaultChildMarker restarts every scheme except recursive dotted decimal', () => {
  assert.equal(defaultChildMarker(SCHEMES.DECIMAL, '12.'), '1.');
  assert.equal(defaultChildMarker(SCHEMES.UPPER_ROMAN_LEFT, '(XII'), '(I');
  assert.equal(defaultChildMarker(SCHEMES.LOWER_ROMAN_LEFT, '(xii'), '(i');
  assert.equal(defaultChildMarker(SCHEMES.LOWER_ALPHA_LEFT, '(z'), '(a');
  assert.equal(defaultChildMarker(SCHEMES.DOTTED_DECIMAL, '1.'), '1.1.');
  assert.equal(defaultChildMarker(SCHEMES.DOTTED_DECIMAL, '1.2.'), '1.2.1.');
  assert.equal(defaultChildMarker(SCHEMES.DOTTED_DECIMAL, [3, 7, 4]), '3.7.4.1.');
  assert.equal(defaultChildMarker(SCHEMES.DOTTED_DECIMAL, recognizeMarker('3.7.4. ')),
    '3.7.4.1.');
});

test('unsupported schemes and invalid current values fail without guessing', () => {
  assert.throws(() => nextMarker('markdown-ordered', 1), TypeError);
  assert.throws(() => nextMarker(SCHEMES.DECIMAL, 0), RangeError);
  assert.throws(() => nextMarker(SCHEMES.DOTTED_DECIMAL, [1]), RangeError);
  assert.throws(() => nextMarker(SCHEMES.DOTTED_DECIMAL, '1.'), RangeError);
  assert.throws(() => defaultChildMarker(SCHEMES.DOTTED_DECIMAL, '(I'), TypeError);
  assert.throws(() => nextMarker(SCHEMES.UPPER_ROMAN_LEFT, 3999), RangeError);
});
