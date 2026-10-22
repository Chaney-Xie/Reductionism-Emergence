(function exposeHnListNumbering(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.hnListNumbering = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SCHEMES = Object.freeze({
    DECIMAL: 'decimal',
    DOTTED_DECIMAL: 'dotted_decimal',
    UPPER_ROMAN_LEFT: 'upper_roman_left',
    LOWER_ROMAN_LEFT: 'lower_roman_left',
    LOWER_ALPHA_LEFT: 'lower_alpha_left'
  });
  const SCHEME_VALUES = Object.freeze(Object.values(SCHEMES));
  const SCHEME_SET = new Set(SCHEME_VALUES);
  const ROMAN_DIGITS = Object.freeze([
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ]);

  function schemeOf(value) {
    const scheme = typeof value === 'string' ? value : value?.scheme;
    return SCHEME_SET.has(scheme) ? scheme : null;
  }

  function requireScheme(value) {
    const scheme = schemeOf(value);
    if (!scheme) throw new TypeError(`Unsupported HN List numbering scheme: ${String(value?.scheme ?? value)}.`);
    return scheme;
  }

  function requireOrdinal(value, label = 'ordinal') {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`HN List ${label} must be a positive safe integer.`);
    }
    return value;
  }

  function parseDecimalToken(token) {
    if (!/^[1-9]\d*$/.test(token)) return null;
    const ordinal = Number(token);
    return Number.isSafeInteger(ordinal) ? ordinal : null;
  }

  function parseDottedMarker(marker) {
    if (typeof marker !== 'string' || !/^[1-9]\d*(?:\.[1-9]\d*)+\.$/.test(marker)) return null;
    const path = marker.slice(0, -1).split('.').map(Number);
    return path.every(Number.isSafeInteger) ? path : null;
  }

  function parseMarkerPath(marker) {
    if (typeof marker !== 'string' || !/^[1-9]\d*(?:\.[1-9]\d*)*\.$/.test(marker)) return null;
    const path = marker.slice(0, -1).split('.').map(Number);
    return path.every(Number.isSafeInteger) ? path : null;
  }

  function ordinalToRoman(value, lowerCase = false) {
    let remaining = requireOrdinal(value, 'Roman ordinal');
    if (remaining > 3999) {
      throw new RangeError('HN List Roman ordinals must be between 1 and 3999.');
    }
    let result = '';
    ROMAN_DIGITS.forEach(([ordinal, digit]) => {
      while (remaining >= ordinal) {
        result += digit;
        remaining -= ordinal;
      }
    });
    return lowerCase ? result.toLowerCase() : result;
  }

  function romanToOrdinal(token) {
    if (typeof token !== 'string' || !/^[IVXLCDM]+$/.test(token)) return null;
    let offset = 0;
    let ordinal = 0;
    while (offset < token.length) {
      const match = ROMAN_DIGITS.find(([, digit]) => token.startsWith(digit, offset));
      if (!match) return null;
      ordinal += match[0];
      offset += match[1].length;
    }
    if (ordinal < 1 || ordinal > 3999) return null;
    return ordinalToRoman(ordinal) === token ? ordinal : null;
  }

  function ordinalToAlpha(value) {
    let remaining = requireOrdinal(value, 'alphabetic ordinal');
    let result = '';
    while (remaining > 0) {
      remaining -= 1;
      result = String.fromCharCode(97 + (remaining % 26)) + result;
      remaining = Math.floor(remaining / 26);
    }
    return result;
  }

  function alphaToOrdinal(token) {
    if (typeof token !== 'string' || !/^[a-z]+$/.test(token)) return null;
    let ordinal = 0;
    for (const character of token) {
      ordinal = (ordinal * 26) + character.charCodeAt(0) - 96;
      if (!Number.isSafeInteger(ordinal)) return null;
    }
    return ordinal;
  }

  function recognition(scheme, ordinal, marker, path = null) {
    const canonicalPath = path ? Object.freeze([...path]) : null;
    const dottedPrefix = canonicalPath ? Object.freeze(canonicalPath.slice(0, -1)) : null;
    return Object.freeze({
      scheme,
      startOrdinal: ordinal,
      dottedPrefix,
      ordinal,
      path: canonicalPath,
      marker
    });
  }

  /**
   * Recognize one complete marker commit. The final ASCII Space is part of the
   * input gesture, but is deliberately absent from the returned marker.
   */
  function recognizeMarker(input, sequenceContext = null) {
    if (typeof input !== 'string' || !input.endsWith(' ') || input.endsWith('  ')) return null;
    const marker = input.slice(0, -1);
    if (!marker || /\s/.test(marker)) return null;

    const dottedPath = parseDottedMarker(marker);
    if (dottedPath) {
      return recognition(
        SCHEMES.DOTTED_DECIMAL,
        dottedPath.at(-1),
        marker,
        dottedPath
      );
    }

    const decimalMatch = /^([1-9]\d*)\.$/.exec(marker);
    if (decimalMatch) {
      const ordinal = parseDecimalToken(decimalMatch[1]);
      return ordinal === null ? null : recognition(SCHEMES.DECIMAL, ordinal, marker);
    }

    const upperRomanMatch = /^\(([IVXLCDM]+)$/.exec(marker);
    if (upperRomanMatch) {
      const ordinal = romanToOrdinal(upperRomanMatch[1]);
      return ordinal === null ? null : recognition(SCHEMES.UPPER_ROMAN_LEFT, ordinal, marker);
    }

    const lowerMatch = /^\(([a-z]+)$/.exec(marker);
    if (!lowerMatch) return null;
    const token = lowerMatch[1];
    const contextScheme = schemeOf(sequenceContext);
    const romanOrdinal = romanToOrdinal(token.toUpperCase());

    // A canonical lower-Roman token remains alphabetic only when its current
    // sibling sequence is explicitly alphabetic. In particular, context-free
    // `(i ` starts lower Roman as required by the product contract.
    if (romanOrdinal !== null && contextScheme !== SCHEMES.LOWER_ALPHA_LEFT) {
      return recognition(SCHEMES.LOWER_ROMAN_LEFT, romanOrdinal, marker);
    }

    const alphaOrdinal = alphaToOrdinal(token);
    return alphaOrdinal === null
      ? null
      : recognition(SCHEMES.LOWER_ALPHA_LEFT, alphaOrdinal, marker);
  }

  function ordinalFromCurrent(scheme, current) {
    if (Number.isSafeInteger(current)) return requireOrdinal(current);
    if (current && typeof current === 'object') {
      if (Number.isSafeInteger(current.ordinal)) return requireOrdinal(current.ordinal);
      if (Number.isSafeInteger(current.startOrdinal)) return requireOrdinal(current.startOrdinal);
    }
    if (typeof current === 'string') {
      const recognized = recognizeMarker(`${current} `, { scheme });
      if (recognized?.scheme === scheme) return recognized.ordinal;
    }
    throw new TypeError(`Current ${scheme} marker must provide a valid ordinal.`);
  }

  function dottedPathFromCurrent(sequenceScheme, current) {
    if (Array.isArray(current)) {
      if (current.length < 2) throw new RangeError('Dotted-decimal paths require at least two ordinals.');
      return current.map((ordinal) => requireOrdinal(ordinal, 'path ordinal'));
    }
    if (typeof current === 'string') {
      const path = parseMarkerPath(current);
      if (path) return path;
    }
    if (current && typeof current === 'object') {
      if (Array.isArray(current.path)) return dottedPathFromCurrent(sequenceScheme, current.path);
      if (Array.isArray(current.dottedPrefix)
        && Number.isSafeInteger(current.ordinal ?? current.startOrdinal)) {
        return dottedPathFromCurrent(sequenceScheme, [
          ...current.dottedPrefix,
          current.ordinal ?? current.startOrdinal
        ]);
      }
    }
    if (sequenceScheme && typeof sequenceScheme === 'object'
      && Array.isArray(sequenceScheme.dottedPrefix)
      && Number.isSafeInteger(current)) {
      return dottedPathFromCurrent(sequenceScheme, [...sequenceScheme.dottedPrefix, current]);
    }
    throw new TypeError('Current dotted-decimal marker must provide its complete path.');
  }

  function formatMarker(scheme, ordinalOrPath) {
    if (scheme === SCHEMES.DECIMAL) return `${requireOrdinal(ordinalOrPath)}.`;
    if (scheme === SCHEMES.DOTTED_DECIMAL) {
      return `${dottedPathFromCurrent(scheme, ordinalOrPath).join('.')}.`;
    }
    if (scheme === SCHEMES.UPPER_ROMAN_LEFT) return `(${ordinalToRoman(ordinalOrPath)}`;
    if (scheme === SCHEMES.LOWER_ROMAN_LEFT) return `(${ordinalToRoman(ordinalOrPath, true)}`;
    return `(${ordinalToAlpha(ordinalOrPath)}`;
  }

  function nextMarker(sequenceScheme, currentOrdinalOrPath) {
    const scheme = requireScheme(sequenceScheme);
    if (scheme === SCHEMES.DOTTED_DECIMAL) {
      const path = dottedPathFromCurrent(sequenceScheme, currentOrdinalOrPath);
      const nextPath = [...path];
      nextPath[nextPath.length - 1] = requireOrdinal(nextPath.at(-1)) + 1;
      requireOrdinal(nextPath.at(-1));
      return formatMarker(scheme, nextPath);
    }
    const ordinal = ordinalFromCurrent(scheme, currentOrdinalOrPath);
    return formatMarker(scheme, requireOrdinal(ordinal + 1));
  }

  function defaultChildMarker(sequenceScheme, currentMarker) {
    const scheme = requireScheme(sequenceScheme);
    if (scheme === SCHEMES.DOTTED_DECIMAL) {
      const path = dottedPathFromCurrent(sequenceScheme, currentMarker);
      return formatMarker(scheme, [...path, 1]);
    }
    return formatMarker(scheme, 1);
  }

  return Object.freeze({
    SCHEMES,
    SCHEME_VALUES,
    recognizeMarker,
    nextMarker,
    defaultChildMarker
  });
}));
