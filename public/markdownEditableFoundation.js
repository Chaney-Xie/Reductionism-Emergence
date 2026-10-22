(function initMarkdownEditableFoundation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.markdownEditableFoundation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const POSITION_AFFINITIES = Object.freeze({ BEFORE: 'before', AFTER: 'after' });
  const EDITABLE_LIST_GRAMMAR = /^(\t*)(?:(\d+)\. |(-) )(.*)$/;
  let nextPhysicalLineId = 1;

  function canonicalSource(value) {
    return typeof value === 'string' ? value : String(value ?? '');
  }

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
  }

  function freezeArray(values) {
    return Object.freeze(values.map((value) => Object.freeze(value)));
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((child) => deepFreeze(child, seen));
    return Object.freeze(value);
  }

  function readOnlyMapView(map) {
    return Object.freeze({
      get size() {
        return map.size;
      },
      get(key) {
        return map.get(key);
      },
      has(key) {
        return map.has(key);
      },
      keys() {
        return map.keys();
      },
      values() {
        return map.values();
      },
      entries() {
        return map.entries();
      },
      forEach(callback, thisArg) {
        map.forEach((value, key) => callback.call(thisArg, value, key, this));
      },
      [Symbol.iterator]() {
        return map[Symbol.iterator]();
      }
    });
  }

  function lineSignature(line) {
    return `${line?.text || ''}\u0000${line?.lineEnding || ''}`;
  }

  function physicalLineRecords(source) {
    const lines = [];
    let start = 0;
    while (start < source.length) {
      let contentEnd = start;
      while (contentEnd < source.length
        && source[contentEnd] !== '\r'
        && source[contentEnd] !== '\n') contentEnd += 1;
      let sourceEnd = contentEnd;
      if (source[sourceEnd] === '\r' && source[sourceEnd + 1] === '\n') sourceEnd += 2;
      else if (source[sourceEnd] === '\r' || source[sourceEnd] === '\n') sourceEnd += 1;
      lines.push({
        index: lines.length,
        start,
        contentEnd,
        sourceEnd,
        end: contentEnd,
        nextStart: sourceEnd,
        text: source.slice(start, contentEnd),
        lineEnding: source.slice(contentEnd, sourceEnd)
      });
      start = sourceEnd;
    }
    if (!lines.length || lines.at(-1).sourceEnd === source.length && lines.at(-1).lineEnding) {
      lines.push({
        index: lines.length,
        start: source.length,
        contentEnd: source.length,
        sourceEnd: source.length,
        end: source.length,
        nextStart: source.length,
        text: '',
        lineEnding: ''
      });
    }
    return lines;
  }

  function previousLinesFrom(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.lines)) return value.lines;
    if (Array.isArray(value.physicalLines)) return value.physicalLines;
    if (Array.isArray(value.physicalLineIndex?.lines)) return value.physicalLineIndex.lines;
    return [];
  }

  function assignPhysicalLineIds(lines, previousValue) {
    const previous = previousLinesFrom(previousValue);
    if (!previous.length) {
      return lines.map((line) => ({ ...line, id: `physical-line-${nextPhysicalLineId++}` }));
    }
    const ids = new Array(lines.length);
    let prefix = 0;
    while (prefix < lines.length && prefix < previous.length
      && lineSignature(lines[prefix]) === lineSignature(previous[prefix])) {
      ids[prefix] = previous[prefix].id || previous[prefix].physicalLineId;
      prefix += 1;
    }
    let nextSuffix = lines.length - 1;
    let previousSuffix = previous.length - 1;
    while (nextSuffix >= prefix && previousSuffix >= prefix
      && lineSignature(lines[nextSuffix]) === lineSignature(previous[previousSuffix])) {
      ids[nextSuffix] = previous[previousSuffix].id || previous[previousSuffix].physicalLineId;
      nextSuffix -= 1;
      previousSuffix -= 1;
    }
    for (let index = prefix; index <= nextSuffix; index += 1) {
      const corresponding = previous[index];
      ids[index] = corresponding && index <= previousSuffix
        ? corresponding.id || corresponding.physicalLineId
        : null;
      if (!ids[index]) ids[index] = `physical-line-${nextPhysicalLineId++}`;
    }
    return lines.map((line, index) => ({ ...line, id: String(ids[index]) }));
  }

  function lineIndexAtOffset(lines, requestedOffset, affinity = POSITION_AFFINITIES.AFTER) {
    if (!lines.length) return 0;
    const sourceLength = lines.at(-1).sourceEnd;
    const offset = clamp(requestedOffset, 0, sourceLength);
    let low = 0;
    let high = lines.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (lines[middle].start <= offset) low = middle + 1;
      else high = middle - 1;
    }
    let index = clamp(high, 0, lines.length - 1);
    if (affinity === POSITION_AFFINITIES.AFTER
      && lines[index + 1]?.start === offset) index += 1;
    return index;
  }

  function createPhysicalLineIndex(value, options = {}) {
    const markdownBody = canonicalSource(value);
    const records = assignPhysicalLineIds(
      physicalLineRecords(markdownBody),
      options.previousIndex || options.previousSnapshot
    );
    const lines = freezeArray(records.map((line) => ({
      ...line,
      physicalLineId: line.id,
      length: line.text.length,
      endingLength: line.lineEnding.length,
      terminal: line.index === records.length - 1,
      blank: line.text.length === 0
    })));
    const index = {
      markdownBody,
      lines,
      physicalLines: lines,
      lineCount: lines.length,
      length: lines.length,
      at(lineNumber) {
        return lines.at(lineNumber) || null;
      },
      lineAt(lineNumber) {
        return lines[lineNumber] || null;
      },
      lineIndexAtOffset(offset, affinity) {
        return lineIndexAtOffset(lines, offset, affinity);
      },
      lineAtOffset(offset, affinity) {
        return lines[lineIndexAtOffset(lines, offset, affinity)] || null;
      },
      getLines() {
        return lines;
      },
      toArray() {
        return lines.slice();
      },
      [Symbol.iterator]() {
        return lines[Symbol.iterator]();
      }
    };
    return Object.freeze(index);
  }

  function editableIndentColumns(value) {
    let column = 0;
    for (const character of String(value || '')) {
      column = character === '\t' ? column + (4 - (column % 4)) : column + 1;
    }
    return column;
  }

  function quotePresentationPrefix(text) {
    const source = String(text || '');
    const segments = [];
    let cursor = 0;
    while (cursor < source.length) {
      const segmentStart = cursor;
      let spaces = 0;
      while (spaces < 4 && source[cursor] === ' ') {
        cursor += 1;
        spaces += 1;
      }
      if (spaces > 3 || source[cursor] !== '>') {
        cursor = segmentStart;
        break;
      }
      const markerStart = cursor;
      cursor += 1;
      if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
      segments.push(Object.freeze({
        depth: segments.length + 1,
        start: segmentStart,
        end: cursor,
        markerStart,
        markerEnd: markerStart + 1,
        raw: source.slice(segmentStart, cursor)
      }));
    }
    return Object.freeze({
      depth: segments.length,
      start: 0,
      end: cursor,
      raw: source.slice(0, cursor),
      markerOffsets: Object.freeze(segments.map((segment) => segment.markerStart)),
      segments: Object.freeze(segments)
    });
  }

  function quoteEditablePrefix(text, lineStart = 0, contentEnd = null) {
    const source = String(text || '');
    const leading = source.match(/^[ \t]*/)?.[0] || '';
    const directSegments = [];
    let cursor = leading.length;
    while (source[cursor] === '>') {
      const markerStart = cursor;
      cursor += 1;
      if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
      directSegments.push(Object.freeze({
        depth: directSegments.length + 1,
        start: markerStart,
        end: cursor,
        sourceStart: lineStart + markerStart,
        sourceEnd: lineStart + cursor,
        markerStart,
        markerEnd: markerStart + 1,
        markerSourceStart: lineStart + markerStart,
        markerSourceEnd: lineStart + markerStart + 1,
        raw: source.slice(markerStart, cursor)
      }));
    }
    const directEnd = cursor;
    const firstPadding = source.slice(cursor).match(/^[ \t]*/)?.[0] || '';
    cursor += firstPadding.length;
    const delayedSegments = [];
    while (source[cursor] === '>') {
      const markerStart = cursor;
      cursor += 1;
      if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
      const padding = source.slice(cursor).match(/^[ \t]*/)?.[0] || '';
      cursor += padding.length;
      delayedSegments.push(Object.freeze({
        depth: directSegments.length + delayedSegments.length + 1,
        start: markerStart,
        end: cursor,
        sourceStart: lineStart + markerStart,
        sourceEnd: lineStart + cursor,
        markerStart,
        markerEnd: markerStart + 1,
        markerSourceStart: lineStart + markerStart,
        markerSourceEnd: lineStart + markerStart + 1,
        raw: source.slice(markerStart, cursor)
      }));
    }
    const depth = directSegments.length;
    const prefixEnd = depth > 0 ? cursor : directEnd;
    const oneLevelUpEnd = depth > 1 ? directSegments[depth - 2].end : 0;
    const retained = oneLevelUpEnd ? source.slice(0, oneLevelUpEnd) : '';
    const oneLevelUpPrefix = retained && !/[ \t]$/.test(retained)
      ? `${retained} `
      : retained;
    const delayedMarkerOffset = directEnd + firstPadding.length;
    const delayedMarkerRun = depth > 0
      && editableIndentColumns(firstPadding) >= 4
      && source[delayedMarkerOffset] === '>'
      && /^[ \t]*$/.test(source.slice(delayedMarkerOffset + 1))
      ? Object.freeze({
        markerStart: lineStart + delayedMarkerOffset,
        markerEnd: lineStart + delayedMarkerOffset + 1,
        prefix: source.slice(0, delayedMarkerOffset)
      })
      : null;
    const trailingWhitespace = source.match(/[ \t]+$/)?.[0] || '';
    const indentationOutdentLength = trailingWhitespace
      && source.slice(0, -trailingWhitespace.length).endsWith('>')
      && editableIndentColumns(trailingWhitespace) >= 4
      ? trailingWhitespace.endsWith('\t')
        ? 1
        : Math.min(4, trailingWhitespace.match(/ +$/)?.[0].length || 0)
      : 0;
    const lineContentEnd = Number.isFinite(Number(contentEnd))
      ? Number(contentEnd)
      : lineStart + source.length;
    return Object.freeze({
      hasQuote: depth > 0,
      leading,
      leadingRange: Object.freeze({ start: lineStart, end: lineStart + leading.length }),
      depth,
      directDepth: depth,
      directEnd,
      directPrefix: source.slice(0, directEnd),
      directPrefixRange: Object.freeze({ start: lineStart, end: lineStart + directEnd }),
      directSegments: Object.freeze(directSegments),
      padding: firstPadding,
      delayedSegments: Object.freeze(delayedSegments),
      prefixStart: lineStart,
      prefixEnd: lineStart + prefixEnd,
      prefixRange: Object.freeze({ start: lineStart, end: lineStart + prefixEnd }),
      prefix: depth > 0 ? source.slice(0, prefixEnd) : '',
      contentStart: lineStart + prefixEnd,
      contentEnd: lineContentEnd,
      contentRange: Object.freeze({ start: lineStart + prefixEnd, end: lineContentEnd }),
      content: depth > 0 ? source.slice(prefixEnd) : source,
      empty: depth > 0 && source.slice(prefixEnd).trim().length === 0,
      oneLevelUpPrefix,
      delayedMarkerRun,
      indentationOutdent: indentationOutdentLength
        ? Object.freeze({
          start: lineContentEnd - indentationOutdentLength,
          end: lineContentEnd,
          replacement: '',
          kind: 'quote-indentation-outdent'
        })
        : null
    });
  }

  function createQuoteLineSeed(value, providedPhysicalLineIndex = null) {
    const markdownBody = canonicalSource(value);
    const physicalLineIndex = providedPhysicalLineIndex
      || createPhysicalLineIndex(markdownBody);
    const lines = Object.freeze(physicalLineIndex.lines.map((line) => {
      const presentationPrefix = quotePresentationPrefix(line.text);
      const command = quoteEditablePrefix(line.text, line.start, line.contentEnd);
      return Object.freeze({
        physicalLineId: String(line.id || line.physicalLineId),
        lineIndex: line.index,
        start: line.start,
        contentEnd: line.contentEnd,
        sourceEnd: line.sourceEnd,
        lineEnding: line.lineEnding,
        text: line.text,
        presentationPrefix,
        parserShadow: Object.freeze({
          depth: command.directDepth,
          prefixEnd: line.start + command.directEnd,
          prefixEndLocal: command.directEnd,
          contentStart: line.start + command.directEnd,
          content: line.text.slice(command.directEnd),
          contentNonblank: line.text.slice(command.directEnd).trim().length > 0
        }),
        command
      });
    }));
    const parserShadowInsertions = Object.freeze(lines.slice(1).flatMap((line, index) => {
      const previous = lines[index];
      const previousQuote = previous.parserShadow;
      const currentQuote = line.parserShadow;
      if (currentQuote.depth <= 0
        || previousQuote.depth <= currentQuote.depth
        || !previousQuote.contentNonblank) return [];
      return [Object.freeze({
        offset: line.start,
        value: `${line.text.slice(0, currentQuote.prefixEndLocal)}${previous.lineEnding || '\n'}`,
        previousLineIndex: previous.lineIndex,
        lineIndex: line.lineIndex
      })];
    }));
    return Object.freeze({
      markdownBody,
      lines,
      parserShadowInsertions,
      lineCount: lines.length,
      at(lineIndex) {
        return lines.at(lineIndex) || null;
      },
      lineAt(lineIndex) {
        return lines[lineIndex] || null;
      },
      lineAtOffset(offset, affinity) {
        return lines[physicalLineIndex.lineIndexAtOffset(offset, affinity)] || null;
      }
    });
  }

  function ownerIntersectsPhysicalLine(owner, line) {
    const start = Number(line.start || 0);
    const contentEnd = Number(line.contentEnd ?? line.end ?? start + String(line.text || '').length);
    const sourceEnd = Number(line.sourceEnd ?? contentEnd);
    const effectiveEnd = Math.max(contentEnd, sourceEnd, start + 1);
    return Number.isFinite(Number(owner?.start)) && Number.isFinite(Number(owner?.end))
      && Number(owner.start) < effectiveEnd && Number(owner.end) > start;
  }

  function quoteOwnershipForLine(semanticIndex, line) {
    let best = null;
    (semanticIndex?.owners || []).forEach((owner) => {
      if (!ownerIntersectsPhysicalLine(owner, line)) return;
      const pathTypes = [...(owner.ancestorTypes || []), owner.type];
      const pathOwnerIds = [...(owner.ancestorIds || []), owner.id];
      const ownerIds = pathOwnerIds.filter((_ownerId, index) => (
        pathTypes[index] === 'blockquote'
      ));
      if (!ownerIds.length || best && best.ownerIds.length >= ownerIds.length) return;
      best = { ownerIds };
    });
    if (!best) return Object.freeze({ depth: 0, ownerIds: Object.freeze([]) });
    return Object.freeze({
      depth: best.ownerIds.length,
      ownerIds: Object.freeze(best.ownerIds.map(String))
    });
  }

  function physicalLineEndingCountInRange(physicalLineIndex, requestedStart, requestedEnd) {
    const start = Math.max(0, Number(requestedStart) || 0);
    const end = Math.max(start, Number(requestedEnd) || start);
    return physicalLineIndex.lines.reduce((count, line) => (
      line.lineEnding
      && line.contentEnd >= start
      && line.sourceEnd <= end
        ? count + 1
        : count
    ), 0);
  }

  function createQuoteLineIndex(
    value,
    physicalLineIndex,
    semanticIndex,
    options = {}
  ) {
    const markdownBody = canonicalSource(value);
    const seed = options.seed || createQuoteLineSeed(markdownBody, physicalLineIndex);
    const preliminaryLines = seed.lines.map((seedLine) => {
      const ownership = quoteOwnershipForLine(semanticIndex, seedLine);
      const prefixDepth = Math.min(
        ownership.depth,
        seedLine.presentationPrefix.segments.length
      );
      const selectedSegments = seedLine.presentationPrefix.segments.slice(0, prefixDepth);
      const prefixEndLocal = selectedSegments.at(-1)?.end || 0;
      const prefixSegments = Object.freeze(selectedSegments.map((segment) => Object.freeze({
        ...segment,
        lineIndex: seedLine.lineIndex,
        physicalLineId: seedLine.physicalLineId,
        ownerId: ownership.ownerIds[segment.depth - 1] || null,
        start: seedLine.start + segment.start,
        end: seedLine.start + segment.end,
        markerStart: seedLine.start + segment.markerStart,
        markerEnd: seedLine.start + segment.markerEnd,
        localStart: segment.start,
        localEnd: segment.end,
        localMarkerStart: segment.markerStart,
        localMarkerEnd: segment.markerEnd
      })));
      const membershipKind = ownership.depth > 0
        ? prefixDepth > 0 ? 'explicit' : 'lazy'
        : seedLine.command.hasQuote || seedLine.presentationPrefix.depth > 0
          ? 'physical-only'
          : 'none';
      const reconciliationStatus = ownership.depth <= 0
        ? membershipKind === 'physical-only' ? 'physical-only' : 'none'
        : prefixDepth === 0
          ? 'lazy'
          : seedLine.presentationPrefix.depth < ownership.depth
            ? 'prefix-shallower'
            : seedLine.presentationPrefix.depth > ownership.depth
              ? 'prefix-deeper'
              : 'aligned';
      const readingContinuationPrefixPresent = ownership.depth > 0
        && seedLine.command.directDepth > 0;
      const readingContinuationPrefixEnd = readingContinuationPrefixPresent
        ? seedLine.start + seedLine.command.directEnd
        : seedLine.start;
      const readingContinuationPrefix = Object.freeze({
        present: readingContinuationPrefixPresent,
        depth: readingContinuationPrefixPresent ? seedLine.command.directDepth : 0,
        start: seedLine.start,
        end: readingContinuationPrefixEnd,
        range: Object.freeze({
          start: seedLine.start,
          end: readingContinuationPrefixEnd
        }),
        raw: readingContinuationPrefixPresent
          ? markdownBody.slice(seedLine.start, readingContinuationPrefixEnd)
          : ''
      });
      return {
        ...seedLine,
        quoted: ownership.depth > 0,
        depth: ownership.depth,
        semanticDepth: ownership.depth,
        physicalDepth: seedLine.presentationPrefix.depth,
        prefixDepth,
        explicitQuotePrefix: prefixDepth > 0,
        continuation: ownership.depth > 0
          ? prefixDepth > 0 ? 'explicit' : 'lazy'
          : 'none',
        continuationKind: ownership.depth > 0
          ? prefixDepth > 0
            ? seedLine.text.slice(prefixEndLocal).trim().length === 0
              ? 'explicit-blank'
              : 'explicit'
            : 'lazy'
          : 'none',
        membershipKind,
        reconciliationStatus,
        readingContinuationPrefix,
        ownerIds: ownership.ownerIds,
        astOwnerIds: ownership.ownerIds,
        astOwners: Object.freeze(ownership.ownerIds.map((ownerId) => (
          semanticIndex?.ownerById?.(ownerId) || null
        )).filter(Boolean)),
        prefixSegments,
        prefixStart: seedLine.start,
        prefixEnd: seedLine.start + prefixEndLocal,
        prefix: markdownBody.slice(seedLine.start, seedLine.start + prefixEndLocal),
        prefixRange: Object.freeze({
          start: seedLine.start,
          end: seedLine.start + prefixEndLocal
        }),
        explicitPrefix: Object.freeze({
          present: prefixDepth > 0,
          depth: prefixDepth,
          start: seedLine.start,
          end: seedLine.start + prefixEndLocal,
          range: Object.freeze({
            start: seedLine.start,
            end: seedLine.start + prefixEndLocal
          }),
          raw: markdownBody.slice(seedLine.start, seedLine.start + prefixEndLocal),
          segments: prefixSegments
        }),
        contentStart: seedLine.start + prefixEndLocal,
        contentRange: Object.freeze({
          start: seedLine.start + prefixEndLocal,
          end: seedLine.contentEnd
        }),
        sourceRange: Object.freeze({
          start: seedLine.start,
          contentEnd: seedLine.contentEnd,
          sourceEnd: seedLine.sourceEnd
        }),
        lineEndingRange: Object.freeze({
          start: seedLine.contentEnd,
          end: seedLine.sourceEnd,
          value: seedLine.lineEnding
        }),
        commands: seedLine.command,
        groupIds: Object.freeze([]),
        regions: Object.freeze([])
      };
    });

    const mutableRegions = [];
    const activeByTrack = new Map();
    preliminaryLines.forEach((line) => {
      if (!line.quoted) return;
      for (let depth = 1; depth <= line.semanticDepth; depth += 1) {
        const ownerId = line.ownerIds[depth - 1];
        const trackKey = JSON.stringify([depth, ownerId]);
        let region = activeByTrack.get(trackKey);
        if (!region || line.lineIndex !== region.lastLineIndex + 1) {
          region = {
            id: `quote-region:${depth}:${ownerId}:${line.lineIndex}`,
            depth,
            ownerId,
            firstLineIndex: line.lineIndex,
            lastLineIndex: line.lineIndex,
            firstPhysicalLineId: line.physicalLineId,
            lastPhysicalLineId: line.physicalLineId,
            physicalLineIds: [line.physicalLineId],
            start: line.start,
            end: line.sourceEnd,
            contentEnd: line.contentEnd,
            parentRegionId: null
          };
          mutableRegions.push(region);
          activeByTrack.set(trackKey, region);
        } else {
          region.lastLineIndex = line.lineIndex;
          region.lastPhysicalLineId = line.physicalLineId;
          region.physicalLineIds.push(line.physicalLineId);
          region.end = line.sourceEnd;
          region.contentEnd = line.contentEnd;
        }
      }
    });
    mutableRegions.forEach((region) => {
      if (region.depth <= 1) return;
      const firstLine = preliminaryLines[region.firstLineIndex];
      const parentOwnerId = firstLine?.ownerIds?.[region.depth - 2];
      const parent = mutableRegions.find((candidate) => (
        candidate.depth === region.depth - 1
        && candidate.ownerId === parentOwnerId
        && candidate.firstLineIndex <= region.firstLineIndex
        && candidate.lastLineIndex >= region.lastLineIndex
      ));
      region.parentRegionId = parent?.id || null;
    });
    const regions = Object.freeze(mutableRegions.map((region) => Object.freeze({
      ...region,
      sourceStart: region.start,
      sourceEnd: region.end,
      groupStart: region.start,
      groupEnd: region.end,
      physicalLineIds: Object.freeze([...region.physicalLineIds]),
      astOwner: semanticIndex?.ownerById?.(region.ownerId) || null,
      astNode: semanticIndex?.ownerById?.(region.ownerId)?.node || null
    })));
    const regionById = new Map(regions.map((region) => [region.id, region]));
    const lines = Object.freeze(preliminaryLines.map((line) => {
      const lineRegions = regions.filter((region) => (
        region.firstLineIndex <= line.lineIndex && region.lastLineIndex >= line.lineIndex
        && line.ownerIds[region.depth - 1] === region.ownerId
      ));
      return Object.freeze({
        ...line,
        depthBefore: preliminaryLines[line.lineIndex - 1]?.semanticDepth || 0,
        depthAfter: preliminaryLines[line.lineIndex + 1]?.semanticDepth || 0,
        groupIds: Object.freeze(lineRegions.map((region) => region.id)),
        regionIds: Object.freeze(lineRegions.map((region) => region.id)),
        startsRegionIds: Object.freeze(lineRegions.filter((region) => (
          region.firstLineIndex === line.lineIndex
        )).map((region) => region.id)),
        endsRegionIds: Object.freeze(lineRegions.filter((region) => (
          region.lastLineIndex === line.lineIndex
        )).map((region) => region.id)),
        readingBreakPolicy: line.quoted ? 'preserve-physical' : 'ordinary',
        regions: Object.freeze(lineRegions.map((region) => Object.freeze({
          id: region.id,
          depth: region.depth,
          ownerId: region.ownerId,
          firstLineIndex: region.firstLineIndex,
          lastLineIndex: region.lastLineIndex,
          firstPhysicalLineId: region.firstPhysicalLineId,
          lastPhysicalLineId: region.lastPhysicalLineId,
          physicalLineIds: region.physicalLineIds,
          start: region.start,
          end: region.end,
          parentRegionId: region.parentRegionId
        })))
      });
    }));
    const quotedLines = Object.freeze(lines.filter((line) => line.quoted));
    const explicitPrefixSegments = Object.freeze(lines.flatMap((line) => (
      line.prefixSegments
    )));
    const astQuotes = Object.freeze((semanticIndex?.ownersOfType?.('blockquote') || [])
      .map((owner) => {
        const children = owner.node?.children || [];
        const readingDepthTransition = children.some((child, index) => {
          const next = children[index + 1];
          if (!next || (child.type !== 'blockquote' && next.type !== 'blockquote')) return false;
          return physicalLineEndingCountInRange(
            physicalLineIndex,
            child.position?.end?.offset,
            next.position?.start?.offset
          ) === 1;
        });
        return Object.freeze({
          ownerId: String(owner.id),
          node: owner.node,
          start: owner.start,
          end: owner.end,
          semanticDepth: (owner.ancestorTypes || []).filter((type) => (
            type === 'blockquote'
          )).length + 1,
          regionIds: Object.freeze(regions.filter((region) => (
            region.ownerId === String(owner.id)
          )).map((region) => region.id)),
          readingDepthTransition
        });
      }));
    const astQuoteByNode = new WeakMap(astQuotes.map((entry) => [entry.node, entry]));
    const astQuoteByOwnerId = new Map(astQuotes.map((entry) => [entry.ownerId, entry]));
    const sourceVersion = Number.isInteger(Number(options.sourceVersion))
      ? Number(options.sourceVersion)
      : 0;
    const index = {
      sourceVersion,
      markdownBody,
      sourceLength: markdownBody.length,
      physicalLineIndex,
      lines,
      quoteLines: quotedLines,
      quotedLines,
      explicitPrefixSegments,
      regions,
      railIntervals: regions,
      astQuotes,
      lineCount: lines.length,
      at(lineIndex) {
        return lines.at(lineIndex) || null;
      },
      lineAt(lineIndex) {
        return lines[lineIndex] || null;
      },
      lineByPhysicalLineId(physicalLineId) {
        const requested = String(physicalLineId || '');
        return lines.find((line) => line.physicalLineId === requested) || null;
      },
      lineAtOffset(offset, affinity) {
        return lines[physicalLineIndex.lineIndexAtOffset(offset, affinity)] || null;
      },
      regionById(regionId) {
        return regionById.get(String(regionId)) || null;
      },
      regionsForLine(lineOrIndex) {
        const lineIndex = Number.isInteger(lineOrIndex)
          ? lineOrIndex
          : Number(lineOrIndex?.lineIndex ?? lineOrIndex?.index);
        return lines[lineIndex]?.regions || Object.freeze([]);
      },
      prefixSegmentsInRange(requestedStart, requestedEnd) {
        const start = Math.max(0, Number(requestedStart) || 0);
        const end = Math.min(markdownBody.length, Math.max(start, Number(requestedEnd) || start));
        return Object.freeze(explicitPrefixSegments.filter((segment) => (
          segment.markerStart >= start && segment.markerEnd <= end
        )));
      },
      astQuoteForNode(node) {
        return node && typeof node === 'object' ? astQuoteByNode.get(node) || null : null;
      },
      astQuoteForOwner(ownerId) {
        return astQuoteByOwnerId.get(String(ownerId)) || null;
      }
    };
    return Object.freeze(index);
  }

  function semanticIndexFromAst(ast, physicalLineIndex) {
    const owners = [];
    const ownersByNode = new WeakMap();
    let serial = 0;
    const visit = (node, ancestors = []) => {
      if (!node || typeof node !== 'object') return;
      const start = Number(node.position?.start?.offset);
      const end = Number(node.position?.end?.offset);
      let owner = null;
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const type = String(node.type || 'unknown');
        owner = Object.freeze({
          id: `semantic-owner-${serial++}-${type}-${start}-${Math.max(start, end)}`,
          type,
          start,
          end: Math.max(start, end),
          depth: ancestors.length,
          ancestorIds: Object.freeze(ancestors.map((ancestor) => ancestor.id)),
          ancestorTypes: Object.freeze(ancestors.map((ancestor) => ancestor.type)),
          node
        });
        owners.push(owner);
        ownersByNode.set(node, owner);
      }
      const nextAncestors = owner ? [...ancestors, owner] : ancestors;
      (node.children || []).forEach((child) => visit(child, nextAncestors));
    };
    visit(ast);
    const frozenOwners = Object.freeze(owners);
    return Object.freeze({
      owners: frozenOwners,
      ownerAtOffset(requestedOffset) {
        const offset = clamp(requestedOffset, 0, physicalLineIndex.markdownBody.length);
        return frozenOwners
          .filter((owner) => owner.start <= offset && (offset < owner.end
            || offset === physicalLineIndex.markdownBody.length && owner.end === offset))
          .sort((left, right) => right.depth - left.depth
            || (left.end - left.start) - (right.end - right.start))[0] || null;
      },
      ownersAtOffset(requestedOffset) {
        const offset = clamp(requestedOffset, 0, physicalLineIndex.markdownBody.length);
        return Object.freeze(frozenOwners
          .filter((owner) => owner.start <= offset && (offset < owner.end
            || offset === physicalLineIndex.markdownBody.length && owner.end === offset))
          .sort((left, right) => left.depth - right.depth
            || (right.end - right.start) - (left.end - left.start)));
      },
      ownerById(ownerId) {
        return frozenOwners.find((owner) => owner.id === ownerId) || null;
      },
      ownerByNode(node) {
        return node && typeof node === 'object' ? ownersByNode.get(node) || null : null;
      },
      ownersOfType(...requestedTypes) {
        const types = new Set(requestedTypes.flat().map((type) => String(type)));
        return Object.freeze(frozenOwners.filter((owner) => types.has(owner.type)));
      }
    });
  }

  function createSourceSnapshot(value, options = {}) {
    const markdownBody = canonicalSource(value?.markdownBody ?? value);
    const previousSnapshot = options.previousSnapshot || null;
    if (previousSnapshot?.markdownBody === markdownBody && options.forceVersion !== true) {
      return previousSnapshot;
    }
    const requestedVersion = Number(options.version);
    const version = Number.isInteger(requestedVersion) && requestedVersion >= 0
      ? requestedVersion
      : Math.max(1, Number(previousSnapshot?.version || 0) + 1);
    const physicalLineIndex = createPhysicalLineIndex(markdownBody, {
      previousSnapshot,
      previousIndex: previousSnapshot?.physicalLineIndex
    });
    const parseMarkdown = typeof options.parseMarkdown === 'function'
      ? options.parseMarkdown
      : typeof previousSnapshot?.parseMarkdown === 'function'
        ? previousSnapshot.parseMarkdown
        : null;
    const quoteLineSeed = createQuoteLineSeed(markdownBody, physicalLineIndex);
    const parserAst = deepFreeze(
      parseMarkdown
        ? parseMarkdown(markdownBody, physicalLineIndex, quoteLineSeed)
        : options.parserAst || null
    );
    const semanticIndex = semanticIndexFromAst(parserAst, physicalLineIndex);
    const editableListSemanticIndex = createEditableListSemanticIndex(
      markdownBody,
      physicalLineIndex,
      semanticIndex,
      { sourceVersion: version }
    );
    const quoteLineIndex = createQuoteLineIndex(
      markdownBody,
      physicalLineIndex,
      semanticIndex,
      { seed: quoteLineSeed, sourceVersion: version }
    );
    return Object.freeze({
      version,
      sourceVersion: version,
      markdownBody,
      physicalLineIndex,
      PhysicalLineIndex: physicalLineIndex,
      parserAst,
      ast: parserAst,
      semanticIndex,
      editableListSemanticIndex,
      EditableListSemanticIndex: editableListSemanticIndex,
      quoteLineIndex,
      QuoteLineIndex: quoteLineIndex,
      parseMarkdown
    });
  }

  function editablePositionForLine(snapshot, ownedLine, requestedOffset, affinity, extras = {}) {
    const offset = clamp(requestedOffset, 0, snapshot.markdownBody.length);
    const logicalColumn = clamp(offset - ownedLine.start, 0, ownedLine.text.length);
    const semanticOwner = snapshot.semanticIndex?.ownerAtOffset?.(offset) || null;
    const insideEnding = offset > ownedLine.contentEnd && offset < ownedLine.sourceEnd;
    return Object.freeze({
      sourceVersion: snapshot.version,
      offset,
      affinity,
      physicalLineId: ownedLine.id,
      physicalLineIndex: ownedLine.index,
      logicalColumn,
      semanticOwnerId: extras.semanticOwnerId ?? semanticOwner?.id ?? null,
      visibility: extras.visibility || (insideEnding ? 'structural-hidden' : 'visible'),
      interactionPolicy: extras.interactionPolicy || (insideEnding ? 'line-ending' : 'editable')
    });
  }

  function createEditablePosition(snapshot, requestedOffset, affinity = POSITION_AFFINITIES.AFTER, extras = {}) {
    if (!snapshot?.physicalLineIndex) throw new TypeError('EditablePosition requires a SourceSnapshot.');
    const normalizedAffinity = affinity === POSITION_AFFINITIES.BEFORE
      ? POSITION_AFFINITIES.BEFORE
      : POSITION_AFFINITIES.AFTER;
    const offset = clamp(requestedOffset, 0, snapshot.markdownBody.length);
    const physicalLines = snapshot.physicalLineIndex.lines || snapshot.physicalLineIndex.physicalLines || [];
    const line = typeof snapshot.physicalLineIndex.lineAtOffset === 'function'
      ? snapshot.physicalLineIndex.lineAtOffset(offset, normalizedAffinity)
      : physicalLines[lineIndexAtOffset(physicalLines, offset, normalizedAffinity)];
    const insideEnding = offset > line.contentEnd && offset < line.sourceEnd;
    const atNextRow = normalizedAffinity === POSITION_AFFINITIES.AFTER
      && physicalLines[line.index + 1]?.start === offset;
    const ownedLine = atNextRow ? physicalLines[line.index + 1] : line;
    return editablePositionForLine(snapshot, ownedLine, offset, normalizedAffinity, {
      ...extras,
      visibility: extras.visibility || (insideEnding ? 'structural-hidden' : 'visible'),
      interactionPolicy: extras.interactionPolicy || (insideEnding ? 'line-ending' : 'editable')
    });
  }

  function createEditableLinePosition(snapshot, physicalLineId, requestedColumn, extras = {}) {
    if (!snapshot?.physicalLineIndex) throw new TypeError('EditablePosition requires a SourceSnapshot.');
    const line = snapshot.physicalLineIndex.lines.find((candidate) => (
      String(candidate.id) === String(physicalLineId)
    ));
    if (!line) return null;
    const logicalColumn = clamp(requestedColumn, 0, line.text.length);
    const affinity = extras.affinity === POSITION_AFFINITIES.BEFORE
      || extras.affinity === POSITION_AFFINITIES.AFTER
      ? extras.affinity
      : logicalColumn === 0
        ? POSITION_AFFINITIES.AFTER
        : logicalColumn === line.text.length
          ? POSITION_AFFINITIES.BEFORE
          : POSITION_AFFINITIES.AFTER;
    return editablePositionForLine(
      snapshot,
      line,
      line.start + logicalColumn,
      affinity,
      extras
    );
  }

  function fencedCodeLineMask(snapshot) {
    const mask = new Set();
    let open = null;
    snapshot.physicalLineIndex.lines.forEach((line) => {
      if (!open) {
        const match = line.text.match(/^ {0,3}(`{3,}|~{3,})/);
        if (!match) return;
        open = { character: match[1][0], length: match[1].length };
        mask.add(line.index);
        return;
      }
      mask.add(line.index);
      const closing = line.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === open.character
        && closing[1].length >= open.length) open = null;
    });
    return mask;
  }

  function astListOwnerId(owner) {
    for (let index = owner?.ancestorTypes?.length - 1; index >= 0; index -= 1) {
      if (owner.ancestorTypes[index] === 'list') return owner.ancestorIds[index];
    }
    return null;
  }

  function astListItemTaskFacts(markdownBody, owner) {
    const node = owner?.node;
    if (typeof node?.checked !== 'boolean') return Object.freeze({
      task: false,
      checked: null,
      taskToken: null,
      taskTokenStart: null,
      taskTokenEnd: null,
      taskCheckStart: null,
      taskCheckEnd: null
    });
    const start = Number(owner.start);
    const end = Number(owner.end);
    const contentStarts = (node.children || [])
      .map((child) => Number(child?.position?.start?.offset))
      .filter((offset) => Number.isFinite(offset) && offset >= start);
    const contentStart = contentStarts.length ? Math.min(...contentStarts) : end;
    const prefix = markdownBody.slice(start, contentStart);
    const match = prefix.match(/\[([ xX])\](?=[ \t]*(?:\r?\n?)?$)/);
    if (!match || !Number.isFinite(match.index)) return Object.freeze({
      task: false,
      checked: null,
      taskToken: null,
      taskTokenStart: null,
      taskTokenEnd: null,
      taskCheckStart: null,
      taskCheckEnd: null
    });
    const taskTokenStart = start + match.index;
    return Object.freeze({
      task: true,
      checked: match[1].toLowerCase() === 'x',
      taskToken: markdownBody.slice(taskTokenStart, taskTokenStart + 3),
      taskTokenStart,
      taskTokenEnd: taskTokenStart + 3,
      taskCheckStart: taskTokenStart + 1,
      taskCheckEnd: taskTokenStart + 2
    });
  }

  function astListItemOwnLineIsEmpty(markdownBody, owner, physicalLineIndex) {
    const start = Number(owner?.start);
    if (!Number.isFinite(start)) return false;
    const line = physicalLineIndex.lineAtOffset(start, 'after');
    const firstLine = markdownBody.slice(start, line?.contentEnd ?? markdownBody.length);
    return /^(?:\d+[.)]|[-+*])(?:[\t ]*(?:\[[ xX]\][\t ]*)?)?$/.test(firstLine);
  }

  function createEditableListSemanticIndex(
    value,
    physicalLineIndex,
    semanticIndex,
    options = {}
  ) {
    const markdownBody = canonicalSource(value);
    const sourceVersion = Number.isInteger(Number(options.sourceVersion))
      ? Number(options.sourceVersion)
      : 0;
    const snapshotLike = { markdownBody, physicalLineIndex };
    const fencedLines = fencedCodeLineMask(snapshotLike);
    const listItemOwners = semanticIndex?.ownersOfType?.('listItem') || [];
    const listOwners = semanticIndex?.ownersOfType?.('list') || [];
    const codeOwners = semanticIndex?.ownersOfType?.('code') || [];
    const astListItemOwnerById = new Map(listItemOwners.map((owner) => [String(owner.id), owner]));
    const astListOwnerById = new Map(listOwners.map((owner) => [String(owner.id), owner]));
    const astTaskFactsByItemOwnerId = new Map(listItemOwners.map((owner) => [
      String(owner.id),
      astListItemTaskFacts(markdownBody, owner)
    ]));
    const listItemOwnersByLineIndex = new Map();
    const listItemOwnersByListOwnerId = new Map();
    listItemOwners.forEach((owner) => {
      const lineIndex = physicalLineIndex.lineIndexAtOffset(owner.start, 'after');
      if (!listItemOwnersByLineIndex.has(lineIndex)) {
        listItemOwnersByLineIndex.set(lineIndex, []);
      }
      listItemOwnersByLineIndex.get(lineIndex).push(owner);
      const listOwnerId = astListOwnerId(owner);
      if (!listItemOwnersByListOwnerId.has(listOwnerId)) {
        listItemOwnersByListOwnerId.set(listOwnerId, []);
      }
      listItemOwnersByListOwnerId.get(listOwnerId).push(owner);
    });
    const codeOwnerIdsByLineIndex = new Map();
    codeOwners.forEach((owner) => {
      const first = physicalLineIndex.lineIndexAtOffset(owner.start, 'after');
      const last = physicalLineIndex.lineIndexAtOffset(
        Math.max(owner.start, owner.end - 1),
        'before'
      );
      for (let lineIndex = first; lineIndex <= last; lineIndex += 1) {
        if (!codeOwnerIdsByLineIndex.has(lineIndex)) codeOwnerIdsByLineIndex.set(lineIndex, []);
        codeOwnerIdsByLineIndex.get(lineIndex).push(String(owner.id));
      }
    });
    const rawRows = [];
    const rawByLineIndex = new Map();
    physicalLineIndex.lines.forEach((line) => {
      if (fencedLines.has(line.index)) return;
      const match = line.text.match(EDITABLE_LIST_GRAMMAR);
      if (!match) return;
      const tabs = match[1];
      const digits = match[2] || null;
      const ordered = digits !== null;
      const markerStart = line.start + tabs.length;
      const markerEnd = markerStart + (ordered ? digits.length + 1 : 1);
      const contentStart = markerEnd + 1;
      const content = markdownBody.slice(contentStart, line.contentEnd);
      const taskMatch = ordered ? null : content.match(/^\[([ xX])\] (.*)$/);
      const task = taskMatch !== null;
      const taskToken = task ? `[${taskMatch[1]}]` : null;
      const taskTokenStart = task ? contentStart : null;
      const taskTokenEnd = task ? taskTokenStart + taskToken.length : null;
      const taskContentStart = task ? taskTokenEnd + 1 : null;
      const taskContent = task
        ? markdownBody.slice(taskContentStart, line.contentEnd)
        : null;
      const astOwner = (listItemOwnersByLineIndex.get(line.index) || []).filter((owner) => (
        owner.start <= markerStart && line.contentEnd <= owner.end
      )).sort((left, right) => (
        left.end - left.start - (right.end - right.start)
          || right.start - left.start
      ))[0] || null;
      const overlappingCodeOwnerIds = Object.freeze([
        ...(codeOwnerIdsByLineIndex.get(line.index) || [])
      ]);
      const row = {
        id: `editable-list-row:${sourceVersion}:${line.id}:${line.start}:${line.contentEnd}`,
        physicalLineId: String(line.id),
        lineId: String(line.id),
        lineIndex: line.index,
        line,
        start: line.start,
        end: line.contentEnd,
        sourceEnd: line.sourceEnd,
        tabs,
        tabDepth: tabs.length,
        depth: tabs.length + 1,
        ordered,
        unordered: !ordered,
        kind: ordered ? 'ordered' : 'unordered',
        semanticKind: task ? 'task-unordered' : ordered ? 'ordered' : 'unordered',
        number: ordered ? Number(digits) : null,
        digits,
        marker: ordered ? `${digits}.` : '-',
        markerStart,
        markerEnd,
        numberStart: ordered ? markerStart : null,
        numberEnd: ordered ? markerStart + digits.length : null,
        prefixStart: line.start,
        prefixEnd: contentStart,
        contentStart,
        contentEnd: line.contentEnd,
        content,
        task,
        isTask: task,
        checked: task ? taskMatch[1].toLowerCase() === 'x' : null,
        taskToken,
        taskTokenStart,
        taskTokenEnd,
        taskCheckStart: task ? taskTokenStart + 1 : null,
        taskCheckEnd: task ? taskTokenStart + 2 : null,
        taskPrefixStart: task ? line.start : null,
        taskPrefixEnd: task ? taskContentStart : null,
        taskContentStart,
        taskContentEnd: task ? line.contentEnd : null,
        taskContent,
        empty: (task ? taskContent : content).trim().length === 0,
        astOwnerId: astOwner ? String(astOwner.id) : null,
        astNode: astOwner?.node || null,
        astListOwnerId: astOwner ? astListOwnerId(astOwner) : null,
        overlappingCodeOwnerIds,
        parentRowId: null,
        childRowIds: [],
        ordinal: rawRows.length,
        subtreeStartOrdinal: rawRows.length,
        subtreeEndOrdinal: rawRows.length + 1,
        subtreeStart: line.start,
        subtreeEnd: line.sourceEnd,
        subtreeStartLineIndex: line.index,
        subtreeEndLineIndex: line.index + 1,
        orderedSequenceId: null,
        orderedSequencePosition: null
      };
      rawRows.push(row);
      rawByLineIndex.set(line.index, row);
    });

    const hierarchy = [];
    let previousLineIndex = -2;
    rawRows.forEach((row) => {
      if (row.lineIndex !== previousLineIndex + 1) {
        while (hierarchy.length) hierarchy.pop().subtreeEndOrdinal = row.ordinal;
      }
      while (hierarchy.length && hierarchy.at(-1).depth >= row.depth) {
        hierarchy.pop().subtreeEndOrdinal = row.ordinal;
      }
      const parent = hierarchy.at(-1) || null;
      row.parentRowId = parent?.id || null;
      if (parent) parent.childRowIds.push(row.id);
      hierarchy.push(row);
      previousLineIndex = row.lineIndex;
    });
    while (hierarchy.length) hierarchy.pop().subtreeEndOrdinal = rawRows.length;
    rawRows.forEach((row) => {
      const last = rawRows[row.subtreeEndOrdinal - 1] || row;
      row.subtreeEnd = last.sourceEnd;
      row.subtreeEndLineIndex = last.lineIndex + 1;
    });

    const mutableSequences = [];
    const activeSequences = new Map();
    const activeSequenceDepths = [];
    physicalLineIndex.lines.forEach((line) => {
      const row = rawByLineIndex.get(line.index);
      if (!row) {
        activeSequences.clear();
        activeSequenceDepths.length = 0;
        return;
      }
      while (activeSequenceDepths.length
        && activeSequenceDepths.at(-1) > row.depth) {
        activeSequences.delete(activeSequenceDepths.pop());
      }
      if (!row.ordered) {
        activeSequences.delete(row.depth);
        if (activeSequenceDepths.at(-1) === row.depth) activeSequenceDepths.pop();
        return;
      }
      let sequence = activeSequences.get(row.depth);
      if (!sequence) {
        sequence = {
          id: `editable-ordered-sequence:${sourceVersion}:${row.id}`,
          depth: row.depth,
          start: row.start,
          end: row.sourceEnd,
          startLineIndex: row.lineIndex,
          endLineIndex: row.lineIndex + 1,
          startNumber: row.number,
          rowIds: []
        };
        mutableSequences.push(sequence);
        activeSequences.set(row.depth, sequence);
        activeSequenceDepths.push(row.depth);
      }
      row.orderedSequenceId = sequence.id;
      row.orderedSequencePosition = sequence.rowIds.length;
      sequence.rowIds.push(row.id);
      sequence.end = row.sourceEnd;
      sequence.endLineIndex = row.lineIndex + 1;
    });

    // Preserve the established reconciliation policy exactly: editable
    // unordered/task rows displace an overlapping parser code candidate in
    // Source/Live, while ordered rows keep the parser candidate alongside the
    // ordered marker projection. Reading remains parser-owned in either case.
    const suppressedCodeOwnerIds = new Set(rawRows.filter((row) => !row.ordered)
      .flatMap((row) => row.overlappingCodeOwnerIds));
    const rows = Object.freeze(rawRows.map((row) => {
      const astListItemOwner = row.astOwnerId
        ? astListItemOwnerById.get(row.astOwnerId) || null
        : null;
      const astListOwner = astListItemOwner
        ? astListOwnerById.get(String(astListOwnerId(astListItemOwner))) || null
        : null;
      const astTaskFacts = astListItemOwner
        ? astTaskFactsByItemOwnerId.get(String(astListItemOwner.id)) || null
        : null;
      const astLineIndex = astListItemOwner
        ? physicalLineIndex.lineIndexAtOffset(astListItemOwner.start, 'after')
        : null;
      const rowSuppressedCodeOwnerIds = row.overlappingCodeOwnerIds.filter((ownerId) => (
        suppressedCodeOwnerIds.has(ownerId)
      ));
      const reconciliationStatus = row.overlappingCodeOwnerIds.length
        ? rowSuppressedCodeOwnerIds.length > 0
          ? row.ordered ? 'shared-code-owner-suppressed' : 'viewer-row-overrides-code'
          : 'parser-code-retained'
        : !astListItemOwner
          ? 'viewer-only'
          : astLineIndex !== row.lineIndex
            ? 'containment-only'
            : (astListOwner?.node?.ordered === true) !== row.ordered
              ? 'dialect-kind-divergence'
              : Boolean(astTaskFacts?.task) !== row.task
                ? 'dialect-task-divergence'
                : 'aligned';
      return Object.freeze({
      ...row,
      indentationRange: Object.freeze({ start: row.start, end: row.markerStart }),
      markerRange: Object.freeze({ start: row.markerStart, end: row.markerEnd }),
      prefixRange: Object.freeze({ start: row.prefixStart, end: row.prefixEnd }),
      contentRange: Object.freeze({ start: row.contentStart, end: row.contentEnd }),
      taskTokenRange: row.task
        ? Object.freeze({ start: row.taskTokenStart, end: row.taskTokenEnd })
        : null,
      taskCheckRange: row.task
        ? Object.freeze({ start: row.taskCheckStart, end: row.taskCheckEnd })
        : null,
      childRowIds: Object.freeze([...row.childRowIds]),
      reconciliation: Object.freeze({
        status: reconciliationStatus,
        astListItemOwnerId: row.astOwnerId,
        astListOwnerId: row.astListOwnerId,
        suppressedCodeOwnerIds: Object.freeze(rowSuppressedCodeOwnerIds)
      }),
      commandTargets: Object.freeze({
        indentInsertion: Object.freeze({ start: row.start, end: row.start }),
        outdentRange: row.tabDepth > 0
          ? Object.freeze({ start: row.start, end: row.start + 1 })
          : null,
        taskCheckRange: row.task
          ? Object.freeze({ start: row.taskCheckStart, end: row.taskCheckEnd })
          : null,
        emptyNestedOutdentRange: row.depth > 1
          ? Object.freeze({ start: row.start, end: row.start + 1 })
          : null,
        emptyRootExitRange: Object.freeze({ start: row.start, end: row.contentEnd }),
        continuationPrefix: row.ordered
          ? `${row.tabs}1. `
          : row.task
            ? `${row.tabs}- [ ] `
            : `${row.tabs}- `,
        subtreeRange: Object.freeze({ start: row.start, end: row.subtreeEnd }),
        orderedSequenceId: row.orderedSequenceId
      })
      });
    }));
    const byLineIndexMap = new Map(rows.map((row) => [row.lineIndex, row]));
    const byLineIdMap = new Map(rows.map((row) => [row.physicalLineId, row]));
    const byRowIdMap = new Map(rows.map((row) => [row.id, row]));

    const orderedSequences = Object.freeze(mutableSequences.map((sequence) => Object.freeze({
      ...sequence,
      rowIds: Object.freeze([...sequence.rowIds]),
      rows: Object.freeze(sequence.rowIds.map((rowId) => byRowIdMap.get(rowId)))
    })));
    const sequenceByIdMap = new Map(orderedSequences.map((sequence) => [sequence.id, sequence]));

    const astLists = Object.freeze(listOwners.map((owner) => {
      const ancestorListDepth = (owner.ancestorTypes || []).filter((type) => type === 'list').length;
      const itemOwnerIds = (listItemOwnersByListOwnerId.get(owner.id) || [])
        .map((itemOwner) => String(itemOwner.id));
      return Object.freeze({
        ownerId: String(owner.id),
        node: owner.node,
        start: owner.start,
        end: owner.end,
        ordered: owner.node?.ordered === true,
        unordered: owner.node?.ordered !== true,
        kind: owner.node?.ordered === true ? 'ordered' : 'unordered',
        startNumber: owner.node?.ordered === true
          ? Number.isFinite(Number(owner.node?.start)) ? Number(owner.node.start) : 1
          : null,
        semanticDepth: ancestorListDepth,
        itemOwnerIds: Object.freeze(itemOwnerIds)
      });
    }));
    const astListByOwnerId = new Map(astLists.map((entry) => [entry.ownerId, entry]));
    const astListByNode = new WeakMap(astLists.map((entry) => [entry.node, entry]));
    const astListItemPositionByOwnerId = new Map();
    astLists.forEach((list) => list.itemOwnerIds.forEach((ownerId, position) => {
      astListItemPositionByOwnerId.set(ownerId, position);
    }));
    const rowsByAstOwnerId = new Map();
    rows.forEach((row) => {
      if (!row.astOwnerId) return;
      if (!rowsByAstOwnerId.has(row.astOwnerId)) rowsByAstOwnerId.set(row.astOwnerId, []);
      rowsByAstOwnerId.get(row.astOwnerId).push(row);
    });
    const astListItems = Object.freeze(listItemOwners.map((owner) => {
      const listOwnerId = astListOwnerId(owner);
      const list = astListByOwnerId.get(String(listOwnerId)) || null;
      const matchedRows = rowsByAstOwnerId.get(String(owner.id)) || [];
      const taskFacts = astTaskFactsByItemOwnerId.get(String(owner.id));
      const matchedRow = matchedRows[0] || null;
      const ownerLineIndex = physicalLineIndex.lineIndexAtOffset(owner.start, 'after');
      const listPosition = astListItemPositionByOwnerId.get(String(owner.id)) ?? 0;
      return Object.freeze({
        ownerId: String(owner.id),
        node: owner.node,
        start: owner.start,
        end: owner.end,
        listOwnerId: list?.ownerId || null,
        ordered: list?.ordered === true,
        unordered: list?.unordered === true,
        kind: taskFacts.task
          ? list?.ordered ? 'task-ordered' : 'task-unordered'
          : list?.kind || 'unknown',
        semanticDepth: Number(list?.semanticDepth || 0) + 1,
        listPosition,
        readingOrdinal: list?.ordered
          ? (Number.isFinite(Number(list.startNumber))
              ? Number(list.startNumber)
              : 1) + listPosition
          : null,
        ...taskFacts,
        ownLineEmpty: astListItemOwnLineIsEmpty(markdownBody, owner, physicalLineIndex),
        editableRowId: matchedRow?.id || null,
        editableRowIds: Object.freeze(matchedRows.map((row) => row.id)),
        reconciliationStatus: !matchedRow
          ? 'parser-only'
          : ownerLineIndex !== matchedRow.lineIndex
            ? 'containment-only'
            : Boolean(list?.ordered) !== matchedRow.ordered
              ? 'dialect-kind-divergence'
              : taskFacts.task !== matchedRow.task
                ? 'dialect-task-divergence'
                : 'aligned'
      });
    }));
    const astListItemByOwnerId = new Map(astListItems.map((entry) => [entry.ownerId, entry]));
    const astListItemByNode = new WeakMap(astListItems.map((entry) => [entry.node, entry]));
    const astListItemsByStart = new Map();
    astListItems.forEach((entry) => {
      if (!astListItemsByStart.has(entry.start)) astListItemsByStart.set(entry.start, []);
      astListItemsByStart.get(entry.start).push(entry);
    });
    const frozenFencedLineIndices = Object.freeze([...fencedLines]);
    const frozenSuppressedCodeOwnerIds = Object.freeze([...suppressedCodeOwnerIds]);
    const index = {
      type: 'EditableListSemanticIndex',
      sourceVersion,
      markdownBody,
      sourceLength: markdownBody.length,
      physicalLineIndex,
      rows,
      listRows: rows,
      orderedRows: Object.freeze(rows.filter((row) => row.ordered)),
      taskRows: Object.freeze(rows.filter((row) => row.task)),
      orderedSequences,
      astLists,
      astListItems,
      fencedLineIndices: frozenFencedLineIndices,
      suppressedCodeOwnerIds: frozenSuppressedCodeOwnerIds,
      byLineIndex: readOnlyMapView(byLineIndexMap),
      byLineId: readOnlyMapView(byLineIdMap),
      byRowId: readOnlyMapView(byRowIdMap),
      rowAtLineIndex(lineIndex) {
        return byLineIndexMap.get(Number(lineIndex)) || null;
      },
      rowByPhysicalLineId(physicalLineId) {
        return byLineIdMap.get(String(physicalLineId)) || null;
      },
      rowById(rowId) {
        return byRowIdMap.get(String(rowId)) || null;
      },
      rowAtOffset(offset, affinity = POSITION_AFFINITIES.AFTER) {
        const line = physicalLineIndex.lineAtOffset(offset, affinity);
        return byLineIndexMap.get(line.index) || null;
      },
      parentOf(rowOrId) {
        const row = typeof rowOrId === 'string' ? byRowIdMap.get(rowOrId) : rowOrId;
        return row?.parentRowId ? byRowIdMap.get(row.parentRowId) || null : null;
      },
      childrenOf(rowOrId) {
        const row = typeof rowOrId === 'string' ? byRowIdMap.get(rowOrId) : rowOrId;
        return Object.freeze((row?.childRowIds || []).map((rowId) => byRowIdMap.get(rowId)));
      },
      descendantsOf(rowOrId) {
        const row = typeof rowOrId === 'string' ? byRowIdMap.get(rowOrId) : rowOrId;
        if (!row) return Object.freeze([]);
        return Object.freeze(rows.slice(row.ordinal + 1, row.subtreeEndOrdinal));
      },
      orderedSequenceById(sequenceId) {
        return sequenceByIdMap.get(String(sequenceId)) || null;
      },
      orderedSequenceForRow(rowOrId) {
        const row = typeof rowOrId === 'string' ? byRowIdMap.get(rowOrId) : rowOrId;
        return row?.orderedSequenceId
          ? sequenceByIdMap.get(row.orderedSequenceId) || null
          : null;
      },
      astListForNode(node) {
        return node && typeof node === 'object' ? astListByNode.get(node) || null : null;
      },
      astListForOwner(ownerId) {
        return astListByOwnerId.get(String(ownerId)) || null;
      },
      astListItemForNode(node) {
        return node && typeof node === 'object' ? astListItemByNode.get(node) || null : null;
      },
      astListItemForOwner(ownerId) {
        return astListItemByOwnerId.get(String(ownerId)) || null;
      },
      astListItemAtSourceStart(start) {
        return astListItemsByStart.get(Number(start))?.[0] || null;
      },
      suppressesAstOwner(ownerId) {
        return suppressedCodeOwnerIds.has(String(ownerId));
      }
    };
    return Object.freeze(index);
  }

  function normalizeEdits(edits, sourceLength) {
    const normalized = (Array.isArray(edits) ? edits : [edits])
      .filter(Boolean)
      .map((edit, order) => {
        const start = clamp(Math.min(edit.start, edit.end), 0, sourceLength);
        const end = clamp(Math.max(edit.start, edit.end), start, sourceLength);
        return Object.freeze({
          ...edit,
          start,
          end,
          replacement: canonicalSource(edit.replacement),
          order
        });
      })
      .sort((left, right) => left.start - right.start || left.end - right.end || left.order - right.order);
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index].start < normalized[index - 1].end) {
        throw new RangeError('Canonical source edits may not overlap.');
      }
    }
    return normalized;
  }

  function applySourceEdits(source, edits) {
    let next = source;
    [...edits].reverse().forEach((edit) => {
      next = `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`;
    });
    return next;
  }

  function offsetAfterEdits(requestedOffset, edits, affinity = POSITION_AFFINITIES.AFTER) {
    const offset = Number(requestedOffset) || 0;
    let delta = 0;
    for (const edit of edits) {
      if (offset < edit.start || offset === edit.start && affinity === POSITION_AFFINITIES.BEFORE) {
        break;
      }
      if (offset > edit.end || offset === edit.end && affinity === POSITION_AFFINITIES.AFTER) {
        delta += edit.replacement.length - (edit.end - edit.start);
      } else {
        return edit.start + delta
          + (affinity === POSITION_AFFINITIES.BEFORE ? 0 : edit.replacement.length);
      }
    }
    return offset + delta;
  }

  function orderedSequenceMembership(snapshot) {
    const memberships = new Map();
    snapshot.editableListSemanticIndex.orderedRows.forEach((row) => {
      const sequence = snapshot.editableListSemanticIndex
        .orderedSequenceById(row.orderedSequenceId);
      memberships.set(row.physicalLineId, Object.freeze({
        depth: row.depth,
        digits: row.digits,
        content: row.content,
        sequenceStartPhysicalLineId: sequence?.rows?.[0]?.physicalLineId
          || row.physicalLineId,
        position: row.orderedSequencePosition
      }));
    });
    return memberships;
  }

  function orderedSequenceMembershipChanged(beforeSnapshot, afterSnapshot) {
    const before = orderedSequenceMembership(beforeSnapshot);
    const after = orderedSequenceMembership(afterSnapshot);
    const lineIds = new Set([...before.keys(), ...after.keys()]);
    return [...lineIds].some((lineId) => {
      const previous = before.get(lineId);
      const next = after.get(lineId);
      return !previous || !next
        || previous.depth !== next.depth
        || previous.digits !== next.digits
        || previous.content !== next.content
        || previous.sequenceStartPhysicalLineId !== next.sequenceStartPhysicalLineId
        || previous.position !== next.position;
    });
  }

  function numericSelection(source, selection, fallback = source.length) {
    const normalizedAffinity = (...values) => {
      const explicit = values.find((value) => (
        value === POSITION_AFFINITIES.BEFORE || value === POSITION_AFFINITIES.AFTER
      ));
      return explicit || POSITION_AFFINITIES.AFTER;
    };
    const endpoint = (name, value, defaultOffset, defaultAffinity = POSITION_AFFINITIES.AFTER) => {
      const explicitPosition = selection?.[`${name}Position`];
      const position = value && typeof value === 'object'
        ? value
        : explicitPosition && typeof explicitPosition === 'object'
          ? explicitPosition
          : null;
      const requestedOffset = value && typeof value === 'object'
        ? value.offset
        : value ?? position?.offset ?? defaultOffset;
      return {
        offset: clamp(requestedOffset, 0, source.length),
        affinity: normalizedAffinity(
          value && typeof value === 'object' ? value.affinity : null,
          position?.affinity,
          selection?.[`${name}Affinity`],
          selection?.selectionAffinity?.[name],
          defaultAffinity
        )
      };
    };
    const anchor = endpoint('anchor', selection?.anchor, fallback);
    const hasExplicitFocus = selection?.focus !== undefined
      || selection?.focusPosition !== undefined
      || selection?.focusAffinity !== undefined
      || selection?.selectionAffinity?.focus !== undefined;
    const focus = endpoint(
      'focus',
      selection?.focus,
      anchor.offset,
      hasExplicitFocus ? POSITION_AFFINITIES.AFTER : anchor.affinity
    );
    return { anchor, focus };
  }

  function publicSelection(selection) {
    return Object.freeze({
      anchor: selection.anchor.offset,
      focus: selection.focus.offset,
      anchorAffinity: selection.anchor.affinity,
      focusAffinity: selection.focus.affinity
    });
  }

  function isHighSurrogate(codeUnit) {
    return Number.isInteger(codeUnit) && codeUnit >= 0xD800 && codeUnit <= 0xDBFF;
  }

  function isLowSurrogate(codeUnit) {
    return Number.isInteger(codeUnit) && codeUnit >= 0xDC00 && codeUnit <= 0xDFFF;
  }

  function visibleCodePointBoundary(source, requestedOffset, affinity) {
    const offset = clamp(requestedOffset, 0, source.length);
    if (offset <= 0 || offset >= source.length
      || !isHighSurrogate(source.charCodeAt(offset - 1))
      || !isLowSurrogate(source.charCodeAt(offset))) return offset;
    return affinity === POSITION_AFFINITIES.BEFORE ? offset - 1 : offset + 1;
  }

  function visibleEndpointAtOffset(value, endpoint) {
    const source = canonicalSource(value?.markdownBody ?? value);
    const lines = value?.physicalLineIndex?.lines || physicalLineRecords(source);
    const affinity = endpoint?.affinity === POSITION_AFFINITIES.BEFORE
      ? POSITION_AFFINITIES.BEFORE
      : POSITION_AFFINITIES.AFTER;
    const offset = visibleCodePointBoundary(source, endpoint?.offset, affinity);
    const line = typeof value?.physicalLineIndex?.lineAtOffset === 'function'
      ? value.physicalLineIndex.lineAtOffset(offset, affinity)
      : lines[lineIndexAtOffset(lines, offset, affinity)];
    const logicalColumn = clamp(offset - line.start, 0, line.text.length);
    return Object.freeze({
      offset: line.start + logicalColumn,
      affinity: logicalColumn === 0
        ? POSITION_AFFINITIES.AFTER
        : logicalColumn === line.text.length
          ? POSITION_AFFINITIES.BEFORE
          : POSITION_AFFINITIES.AFTER
    });
  }

  function normalizeVisibleSelection(value, selection = {}, fallback = null) {
    const source = canonicalSource(value?.markdownBody ?? value);
    const fallbackOffset = fallback !== null && fallback !== undefined
      && Number.isFinite(Number(fallback))
      ? Number(fallback)
      : source.length;
    const normalized = numericSelection(source, selection, fallbackOffset);
    const anchor = visibleEndpointAtOffset(value, normalized.anchor);
    const focus = visibleEndpointAtOffset(value, normalized.focus);
    return publicSelection({ anchor, focus });
  }

  function visibleSelectionAtOffsets(snapshot, selection, fallback = snapshot.markdownBody.length) {
    const numeric = normalizeVisibleSelection(snapshot, selection, fallback);
    return {
      anchor: createEditablePosition(
        snapshot,
        numeric.anchor,
        numeric.anchorAffinity
      ),
      focus: createEditablePosition(
        snapshot,
        numeric.focus,
        numeric.focusAffinity
      )
    };
  }

  function mapSelection(selection, edits) {
    return {
      anchor: {
        ...selection.anchor,
        offset: offsetAfterEdits(selection.anchor.offset, edits, selection.anchor.affinity)
      },
      focus: {
        ...selection.focus,
        offset: offsetAfterEdits(selection.focus.offset, edits, selection.focus.affinity)
      }
    };
  }

  function resolveOrderedSequences(value, options = {}) {
    const source = canonicalSource(value?.markdownBody ?? value);
    const snapshot = value?.physicalLineIndex
      ? value
      : createSourceSnapshot(source, options);
    const listIndex = snapshot.editableListSemanticIndex;
    const resetLineIndices = new Set(options.resetLineIndices || []);
    const preservedSequenceStarts = new Map(
      (options.preservedSequenceStarts || []).map((entry) => [
        String(entry.firstPhysicalLineId),
        entry
      ])
    );
    const edits = [];
    listIndex.orderedSequences.forEach((sequence) => {
      const preservedStart = preservedSequenceStarts.get(
        String(sequence.rows[0]?.physicalLineId)
      );
      let expected = preservedStart && preservedStart.depth === sequence.depth
        ? preservedStart.startNumber
        : sequence.startNumber;
      sequence.rows.forEach((row) => {
        if (resetLineIndices.has(row.lineIndex)
          && row.orderedSequencePosition === 0) expected = 1;
        if (row.number !== expected) {
          edits.push(Object.freeze({
            start: row.numberStart,
            end: row.numberEnd,
            replacement: String(expected),
            lineIndex: row.lineIndex,
            physicalLineId: row.physicalLineId,
            orderedSequenceId: sequence.id,
            orderedSequencePosition: row.orderedSequencePosition,
            kind: 'ordered-sequence-renumber'
          }));
        }
        expected += 1;
      });
    });
    const normalizedEdits = normalizeEdits(edits, source.length);
    const nextSource = applySourceEdits(source, normalizedEdits);
    return Object.freeze({
      changed: nextSource !== source,
      source: nextSource,
      markdownBody: nextSource,
      edits: Object.freeze(normalizedEdits),
      editableListSemanticIndex: listIndex
    });
  }

  function affectedLineIds(beforeSnapshot, afterSnapshot, edits) {
    const ids = new Set();
    edits.forEach((edit) => {
      const beforeStart = beforeSnapshot.physicalLineIndex.lineAtOffset(edit.start, 'after');
      const beforeEnd = beforeSnapshot.physicalLineIndex.lineAtOffset(edit.end, 'before');
      if (beforeStart) ids.add(beforeStart.id);
      if (beforeEnd) ids.add(beforeEnd.id);
      const afterLine = afterSnapshot.physicalLineIndex.lineAtOffset(
        clamp(edit.start, 0, afterSnapshot.markdownBody.length),
        'after'
      );
      if (afterLine) ids.add(afterLine.id);
    });
    return Object.freeze([...ids]);
  }

  function applyCanonicalEdit(value, selection = {}, primaryEdit = [], options = {}) {
    const source = canonicalSource(value?.markdownBody ?? value);
    const beforeSnapshot = value?.physicalLineIndex
      ? value
      : createSourceSnapshot(source, options);
    const parseMarkdown = typeof options.parseMarkdown === 'function'
      ? options.parseMarkdown
      : beforeSnapshot.parseMarkdown;
    const primaryEdits = normalizeEdits(primaryEdit, source.length);
    const beforeSelection = numericSelection(source, selection, primaryEdits[0]?.start ?? source.length);
    if (primaryEdits.length === 0
      || primaryEdits.every((edit) => edit.start === edit.end && edit.replacement === '')) {
      return Object.freeze({
        ok: true,
        changed: false,
        source,
        markdownBody: source,
        selection: publicSelection(beforeSelection),
        snapshot: beforeSnapshot,
        primaryEdits: Object.freeze([]),
        renumberEdits: Object.freeze([]),
        affectedPhysicalLineIds: Object.freeze([]),
        transaction: null
      });
    }
    const primarySource = applySourceEdits(source, primaryEdits);
    const primarySnapshot = createSourceSnapshot(primarySource, {
      previousSnapshot: beforeSnapshot,
      ...(typeof parseMarkdown === 'function'
        ? { parseMarkdown }
        : {})
    });
    const primarySelection = options.afterPrimarySelection
      ? visibleSelectionAtOffsets(
        primarySnapshot,
        options.afterPrimarySelection,
        primaryEdits.at(-1)?.start + primaryEdits.at(-1)?.replacement.length
      )
      : mapSelection(beforeSelection, primaryEdits);
    const shouldResolveOrdered = options.resolveOrderedSequences === true
      || orderedSequenceMembershipChanged(beforeSnapshot, primarySnapshot);
    const ordered = shouldResolveOrdered
      ? resolveOrderedSequences(primarySnapshot, {
        resetLineIndices: options.resetOrderedLineIndices || [],
        preservedSequenceStarts: options.preservedOrderedSequenceStarts || []
      })
      : Object.freeze({
        changed: false,
        source: primarySource,
        markdownBody: primarySource,
        edits: Object.freeze([])
      });
    const renumberEdits = ordered.edits;
    const afterSource = ordered.source;
    const afterSelectionInternal = options.afterSelection
      ? numericSelection(afterSource, options.afterSelection, afterSource.length)
      : mapSelection(primarySelection, renumberEdits);
    const afterSnapshot = createSourceSnapshot(afterSource, {
      previousSnapshot: primarySnapshot,
      version: beforeSnapshot.version + 1,
      forceVersion: true,
      ...(typeof parseMarkdown === 'function'
        ? { parseMarkdown }
        : {})
    });
    const allEdits = Object.freeze([...primaryEdits, ...renumberEdits]);
    const transaction = Object.freeze({
      transactionKind: options.transactionKind || 'canonical-edit',
      inputType: options.inputType || 'insertText',
      structural: options.structural === true,
      listTransform: options.listTransform === true,
      sourceVersionBefore: beforeSnapshot.version,
      sourceVersionAfter: afterSnapshot.version,
      beforeSource: source,
      afterSource,
      beforeSelection: publicSelection(beforeSelection),
      afterSelection: publicSelection(afterSelectionInternal),
      primaryEdits: Object.freeze(primaryEdits),
      renumberEdits: Object.freeze(renumberEdits),
      affectedPhysicalLineIds: affectedLineIds(beforeSnapshot, afterSnapshot, allEdits)
    });
    return Object.freeze({
      ok: true,
      changed: source !== afterSource,
      source: afterSource,
      markdownBody: afterSource,
      selection: transaction.afterSelection,
      snapshot: afterSnapshot,
      primaryEdits: transaction.primaryEdits,
      renumberEdits: transaction.renumberEdits,
      affectedPhysicalLineIds: transaction.affectedPhysicalLineIds,
      transaction
    });
  }

  function exactDeletionRange(source, caret, direction) {
    const insideSurrogatePair = caret > 0 && caret < source.length
      && isHighSurrogate(source.charCodeAt(caret - 1))
      && isLowSurrogate(source.charCodeAt(caret));
    if (insideSurrogatePair) return { start: caret - 1, end: caret + 1 };
    if (direction === 'forward') {
      if (caret >= source.length) return { start: caret, end: caret };
      if (source.slice(caret, caret + 2) === '\r\n') return { start: caret, end: caret + 2 };
      const first = source.charCodeAt(caret);
      const second = source.charCodeAt(caret + 1);
      if (isHighSurrogate(first) && isLowSurrogate(second)) {
        return { start: caret, end: caret + 2 };
      }
      return { start: caret, end: caret + 1 };
    }
    if (caret <= 0) return { start: caret, end: caret };
    if (source.slice(caret - 2, caret) === '\r\n') return { start: caret - 2, end: caret };
    const previous = source.charCodeAt(caret - 1);
    const preceding = source.charCodeAt(caret - 2);
    if (isHighSurrogate(preceding) && isLowSurrogate(previous)) {
      return { start: caret - 2, end: caret };
    }
    return { start: caret - 1, end: caret };
  }

  function applyExactDeletion(value, selection = {}, direction = 'backward', options = {}) {
    const source = canonicalSource(value?.markdownBody ?? value);
    const normalized = numericSelection(source, selection, 0);
    let start = Math.min(normalized.anchor.offset, normalized.focus.offset);
    let end = Math.max(normalized.anchor.offset, normalized.focus.offset);
    if (start === end) ({ start, end } = exactDeletionRange(
      source,
      normalized.focus.offset,
      direction === 'forward' ? 'forward' : 'backward'
    ));
    return applyCanonicalEdit(value, selection, { start, end, replacement: '', kind: 'exact-delete' }, {
      ...options,
      transactionKind: 'exact-deletion',
      inputType: direction === 'forward' ? 'deleteContentForward' : 'deleteContentBackward',
      resolveOrderedSequences: true
    });
  }

  function applyEditableListIndentation(value, selection = {}, direction = 'indent', options = {}) {
    const source = canonicalSource(value?.markdownBody ?? value);
    const snapshot = value?.physicalLineIndex ? value : createSourceSnapshot(source, options);
    const normalized = numericSelection(source, selection, 0);
    const line = snapshot.physicalLineIndex.lineAtOffset(
      normalized.focus.offset,
      normalized.focus.affinity
    );
    const row = snapshot.editableListSemanticIndex.byLineIndex.get(line.index);
    if (!row) return Object.freeze({
      ok: true,
      changed: false,
      source,
      markdownBody: source,
      selection: publicSelection(normalized),
      snapshot,
      primaryEdits: Object.freeze([]),
      renumberEdits: Object.freeze([]),
      affectedPhysicalLineIds: Object.freeze([]),
      transaction: null
    });
    const outdent = direction === 'outdent';
    if (outdent && row.tabDepth === 0) return Object.freeze({
      ok: true,
      changed: false,
      source,
      markdownBody: source,
      selection: publicSelection(normalized),
      snapshot,
      primaryEdits: Object.freeze([]),
      renumberEdits: Object.freeze([]),
      affectedPhysicalLineIds: Object.freeze([]),
      transaction: null
    });
    const target = outdent
      ? row.commandTargets.outdentRange
      : row.commandTargets.indentInsertion;
    const orderedSequence = row.ordered
      ? snapshot.editableListSemanticIndex.orderedSequenceForRow(row)
      : null;
    const firstSurvivingSourceRow = row.orderedSequencePosition === 0
      ? orderedSequence?.rows?.[1] || null
      : null;
    const edit = {
      start: target.start,
      end: target.end,
      replacement: outdent ? '' : '\t',
      kind: outdent ? 'list-outdent-one-tab' : 'list-indent-one-tab'
    };
    const nextLineIndex = line.index;
    return applyCanonicalEdit(snapshot, selection, edit, {
      ...options,
      transactionKind: outdent ? 'list-shift-tab' : 'list-tab',
      inputType: outdent ? 'formatOutdent' : 'formatIndent',
      structural: true,
      listTransform: true,
      resolveOrderedSequences: true,
      resetOrderedLineIndices: row.ordered && !outdent ? [nextLineIndex] : [],
      preservedOrderedSequenceStarts: firstSurvivingSourceRow
        ? [Object.freeze({
            firstPhysicalLineId: firstSurvivingSourceRow.physicalLineId,
            depth: orderedSequence.depth,
            startNumber: orderedSequence.startNumber
          })]
        : []
    });
  }

  function preferredLineEnding(snapshot, line) {
    if (line?.lineEnding) return line.lineEnding;
    const previous = snapshot.physicalLineIndex.lines
      .slice(0, line?.index ?? snapshot.physicalLineIndex.lines.length)
      .reverse()
      .find((candidate) => candidate.lineEnding);
    return previous?.lineEnding || '\n';
  }

  function editableListCaretClass(row, requestedOffset) {
    const offset = Number(requestedOffset) || 0;
    if (offset <= row.markerRange.start) return 'before-marker';
    if (offset < row.markerRange.end) return 'inside-marker';
    if (offset < row.contentRange.start) return 'marker-content-gap';
    if (offset < row.contentRange.end) return 'inside-content';
    return 'content-end';
  }

  function applyEditableNewline(value, selection = {}, options = {}) {
    const source = canonicalSource(value?.markdownBody ?? value);
    const snapshot = value?.physicalLineIndex ? value : createSourceSnapshot(source, options);
    const normalized = numericSelection(source, selection, 0);
    const start = Math.min(normalized.anchor.offset, normalized.focus.offset);
    const end = Math.max(normalized.anchor.offset, normalized.focus.offset);
    const startPosition = normalized.anchor.offset < normalized.focus.offset
      ? normalized.anchor
      : normalized.focus.offset < normalized.anchor.offset
        ? normalized.focus
        : normalized.focus;
    const line = snapshot.physicalLineIndex.lineAtOffset(start, startPosition.affinity);
    const row = snapshot.editableListSemanticIndex.byLineIndex.get(line.index);
    const lineEnding = preferredLineEnding(snapshot, line);
    const shiftKey = options.shiftKey === true || options.inputType === 'insertLineBreak';
    if (!row || shiftKey) {
      const caret = start + lineEnding.length;
      return applyCanonicalEdit(snapshot, selection, {
        start,
        end,
        replacement: lineEnding,
        kind: 'line-break'
      }, {
        ...options,
        transactionKind: 'newline',
        inputType: options.inputType || (shiftKey ? 'insertLineBreak' : 'insertParagraph'),
        afterPrimarySelection: { anchor: caret, focus: caret }
      });
    }
    const caretClass = start === end ? editableListCaretClass(row, start) : null;
    if (row.ordered && caretClass === 'before-marker') {
      const exactPrefix = source.slice(row.prefixRange.start, row.prefixRange.end);
      return applyCanonicalEdit(snapshot, selection, {
        start: row.start,
        end: row.start,
        replacement: `${exactPrefix}${lineEnding}`,
        kind: 'ordered-list-boundary-sibling'
      }, {
        ...options,
        transactionKind: 'list-enter-ordered',
        inputType: 'insertParagraph',
        structural: true,
        listTransform: true,
        resolveOrderedSequences: true,
        afterPrimarySelection: { anchor: row.contentStart, focus: row.contentStart }
      });
    }
    if (row.empty && row.depth > 1) {
      const target = row.commandTargets.emptyNestedOutdentRange;
      return applyCanonicalEdit(snapshot, selection, {
        start: target.start,
        end: target.end,
        replacement: '',
        kind: 'empty-list-one-level-up'
      }, {
        ...options,
        transactionKind: 'list-enter-empty-nested',
        inputType: 'insertParagraph',
        structural: true,
        listTransform: true,
        resolveOrderedSequences: true
      });
    }
    if (row.empty) {
      const target = row.commandTargets.emptyRootExitRange;
      return applyCanonicalEdit(snapshot, selection, {
        start: target.start,
        end: target.end,
        replacement: '',
        kind: 'empty-root-list-exit'
      }, {
        ...options,
        transactionKind: 'list-enter-empty-root',
        inputType: 'insertParagraph',
        structural: true,
        listTransform: true,
        resolveOrderedSequences: true
      });
    }
    const prefix = row.commandTargets.continuationPrefix;
    const caret = start + lineEnding.length + prefix.length;
    return applyCanonicalEdit(snapshot, selection, {
      start,
      end,
      replacement: `${lineEnding}${prefix}`,
      kind: 'list-continuation'
    }, {
      ...options,
      transactionKind: row.ordered ? 'list-enter-ordered' : 'list-enter-unordered',
      inputType: 'insertParagraph',
      structural: true,
      listTransform: true,
      resolveOrderedSequences: true,
      afterPrimarySelection: { anchor: caret, focus: caret }
    });
  }

  return Object.freeze({
    POSITION_AFFINITIES,
    createPhysicalLineIndex,
    createQuoteLineSeed,
    createQuoteLineIndex,
    createEditableListSemanticIndex,
    createSourceSnapshot,
    createEditablePosition,
    createEditableLinePosition,
    normalizeVisibleSelection,
    resolveOrderedSequences,
    applyCanonicalEdit,
    exactDeletionRange,
    applyExactDeletion,
    applyEditableListIndentation,
    applyEditableNewline,
    offsetAfterEdits
  });
}));
