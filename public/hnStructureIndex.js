(function exposeHnStructureIndex(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.hnStructureIndexModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const CONCEPT_KINDS = Object.freeze({
    PRIMARY: 'concept-primary',
    QUESTION: 'concept-question'
  });
  const SEMANTIC_KINDS = Object.freeze({
    REFORMULATION: 'reformulation',
    EXAMPLE: 'example',
    DESCRIPTION: 'description'
  });
  const HEADING_LEVEL_BY_MARKER = Object.freeze({
    '#': 1,
    '-##': 2,
    '?##': 2,
    '-###': 3,
    '?###': 3
  });

  // These owners already reserve their exact source ranges in the shared
  // SourceSnapshot. HN structure recognition consumes those ranges instead
  // of independently reparsing their contents.
  const MASKED_OWNER_TYPES = Object.freeze([
    'inlineMath',
    'math',
    'inlineCode',
    'code',
    'link',
    'linkReference',
    'image',
    'imageReference',
    'table',
    'html',
    'definition'
  ]);
  const MASKED_OWNER_TYPE_SET = new Set(MASKED_OWNER_TYPES);

  function immutableRange(start, end) {
    const boundedStart = Math.max(0, Number(start) || 0);
    const boundedEnd = Math.max(boundedStart, Number(end) || boundedStart);
    return Object.freeze({ start: boundedStart, end: boundedEnd });
  }

  function immutableLineExtent(startLineIndex, endLineIndex) {
    const start = Math.max(0, Number(startLineIndex) || 0);
    const end = Math.max(start, Number(endLineIndex) || start);
    return Object.freeze({
      startLineIndex: start,
      endLineIndex: end,
      lineCount: end - start + 1
    });
  }

  function snapshotSourceVersion(snapshot) {
    const version = Number(snapshot?.sourceVersion ?? snapshot?.version);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new TypeError('HN structure recognition requires a valid SourceSnapshot version.');
    }
    return version;
  }

  function sourceLines(snapshot) {
    const lines = snapshot?.physicalLineIndex?.lines;
    if (typeof snapshot?.markdownBody !== 'string'
      || !Array.isArray(lines)
      || !snapshot?.parserAst
      || !Array.isArray(snapshot?.semanticIndex?.owners)
      || !Object.isFrozen(snapshot)
      || !Object.isFrozen(lines)
      || !Object.isFrozen(snapshot.parserAst)
      || !Object.isFrozen(snapshot.semanticIndex)) {
      throw new TypeError('HN structure recognition requires one immutable SourceSnapshot.');
    }
    return lines;
  }

  function reservedSourceRanges(snapshot) {
    sourceLines(snapshot);
    const owners = Array.isArray(snapshot?.semanticIndex?.owners)
      ? snapshot.semanticIndex.owners
      : [];
    return Object.freeze(owners.filter((owner) => (
      MASKED_OWNER_TYPE_SET.has(String(owner?.type || ''))
        && Number.isFinite(Number(owner?.start))
        && Number.isFinite(Number(owner?.end))
        && Number(owner.end) > Number(owner.start)
    )).map((owner) => immutableRange(owner.start, owner.end)));
  }

  function sourceRangeIntersectsReserved(snapshot, requestedRange) {
    const range = immutableRange(requestedRange?.start, requestedRange?.end);
    return reservedSourceRanges(snapshot).some((reserved) => (
      range.start < reserved.end && reserved.start < range.end
    ));
  }

  function lineIntersectsRange(line, range) {
    const start = Number(line?.start) || 0;
    const contentEnd = Number(line?.contentEnd ?? start);
    return start < range.end && range.start < contentEnd;
  }

  function lineIsMasked(line, maskedRanges) {
    return maskedRanges.some((range) => lineIntersectsRange(line, range));
  }

  function headingForLine(line, maskedRanges) {
    if (!line) return null;
    const match = String(line.text || '').match(/^(#|-##|\?##|-###|\?###) (.+)$/);
    if (!match || match[2].trim().length === 0) return null;
    const marker = match[1];
    const headingLevel = HEADING_LEVEL_BY_MARKER[marker];
    if (!headingLevel) return null;
    const structuralPrefixRange = immutableRange(
      line.start,
      line.start + marker.length + 1
    );
    if (maskedRanges.some((range) => (
      structuralPrefixRange.start < range.end && range.start < structuralPrefixRange.end
    ))) return null;
    return Object.freeze({
      headingLevel,
      conceptKind: headingLevel === 2
        ? marker === '-##' ? CONCEPT_KINDS.PRIMARY : CONCEPT_KINDS.QUESTION
        : null,
      markerRange: immutableRange(line.start, line.start + marker.length),
      titleRange: immutableRange(line.start + marker.length + 1, line.contentEnd)
    });
  }

  function conceptHeaderForHeading(heading) {
    if (!heading || heading.headingLevel !== 2) return null;
    return Object.freeze({
      kind: heading.conceptKind,
      markerRange: heading.markerRange,
      titleRange: heading.titleRange
    });
  }

  function semanticMarkerForLine(line, maskedRanges) {
    if (!line || lineIsMasked(line, maskedRanges)) return null;
    if (line.text === '>>') {
      return Object.freeze({
        kind: SEMANTIC_KINDS.EXAMPLE,
        opener: '>>',
        closer: '>>'
      });
    }
    if (line.text === '>') {
      return Object.freeze({
        kind: SEMANTIC_KINDS.REFORMULATION,
        opener: '>',
        closer: '>'
      });
    }
    if (line.text === '?{') {
      return Object.freeze({
        kind: SEMANTIC_KINDS.DESCRIPTION,
        opener: '?{',
        closer: '/}'
      });
    }
    return null;
  }

  function endLineForRange(lines, start, end) {
    if (end <= start) return lines.find((line) => line.start === start) || lines[0] || null;
    return [...lines].reverse().find((line) => (
      line.start < end && line.sourceEnd <= end
    ))
      || lines[0]
      || null;
  }

  function semanticBlocksForConcept({
    sourceVersion,
    conceptId,
    lines,
    firstBodyLineIndex,
    endLineIndex,
    maskedRanges
  }) {
    const blocks = [];
    let lineIndex = firstBodyLineIndex;
    while (lineIndex < endLineIndex) {
      const openingLine = lines[lineIndex];
      const marker = semanticMarkerForLine(openingLine, maskedRanges);
      if (!marker) {
        lineIndex += 1;
        continue;
      }

      let closingLineIndex = -1;
      for (let candidateIndex = lineIndex + 1;
        candidateIndex < endLineIndex;
        candidateIndex += 1) {
        const candidate = lines[candidateIndex];
        if (!lineIsMasked(candidate, maskedRanges) && candidate.text === marker.closer) {
          closingLineIndex = candidateIndex;
          break;
        }
      }

      // Fail-safe policy: an unmatched opener is literal source. Continue the
      // scan after that one line so it cannot swallow later valid structures.
      if (closingLineIndex < 0) {
        lineIndex += 1;
        continue;
      }

      const closingLine = lines[closingLineIndex];
      const id = `hn-semantic:${sourceVersion}:${marker.kind}:${openingLine.start}`;
      blocks.push(Object.freeze({
        id,
        kind: marker.kind,
        parentConceptId: conceptId,
        openingMarkerRange: immutableRange(openingLine.start, openingLine.contentEnd),
        bodyRange: immutableRange(openingLine.sourceEnd, closingLine.start),
        closingMarkerRange: immutableRange(closingLine.start, closingLine.contentEnd),
        fullRange: immutableRange(openingLine.start, closingLine.sourceEnd),
        physicalLineExtent: immutableLineExtent(lineIndex, closingLineIndex)
      }));
      // Semantic blocks are deliberately non-recursive in this foundation.
      // Every marker inside a matched block belongs to its literal body.
      lineIndex = closingLineIndex + 1;
    }
    return Object.freeze(blocks);
  }

  function rangeContainsOffset(range, offset, sourceLength) {
    return range.start <= offset && (offset < range.end
      || offset === sourceLength && range.end === sourceLength);
  }

  function createHnStructureIndex(snapshot) {
    const lines = sourceLines(snapshot);
    const source = snapshot.markdownBody;
    const sourceVersion = snapshotSourceVersion(snapshot);
    const maskedRanges = reservedSourceRanges(snapshot);
    const headingEntries = lines.flatMap((line) => {
      const heading = headingForLine(line, maskedRanges);
      return heading ? [Object.freeze({ line, heading })] : [];
    });
    const headings = Object.freeze(headingEntries.map(({ line, heading }) => Object.freeze({
      id: `hn-heading:${sourceVersion}:${heading.headingLevel}:${line.start}`,
      headingLevel: heading.headingLevel,
      headerRange: immutableRange(line.start, line.contentEnd),
      markerRange: heading.markerRange,
      titleRange: heading.titleRange,
      physicalLineExtent: immutableLineExtent(line.index, line.index)
    })));
    const headers = headingEntries.flatMap(({ line, heading }) => {
      const header = conceptHeaderForHeading(heading);
      return header ? [Object.freeze({ line, header })] : [];
    });

    const concepts = Object.freeze(headers.map((entry, index) => {
      const { line, header } = entry;
      const nextHeaderLine = headers[index + 1]?.line || null;
      const fullEnd = nextHeaderLine ? nextHeaderLine.start : source.length;
      const endLine = nextHeaderLine
        ? endLineForRange(lines, line.start, fullEnd) || line
        : lines.at(-1) || line;
      const id = `hn-concept:${sourceVersion}:${header.kind}:${line.start}`;
      const semanticBlocks = semanticBlocksForConcept({
        sourceVersion,
        conceptId: id,
        lines,
        firstBodyLineIndex: line.index + 1,
        endLineIndex: nextHeaderLine ? nextHeaderLine.index : lines.length,
        maskedRanges
      });
      return Object.freeze({
        id,
        kind: header.kind,
        headerRange: immutableRange(line.start, line.contentEnd),
        markerRange: header.markerRange,
        titleRange: header.titleRange,
        contentRange: immutableRange(line.sourceEnd, fullEnd),
        fullRange: immutableRange(line.start, fullEnd),
        physicalLineExtent: immutableLineExtent(line.index, endLine.index),
        semanticBlocks
      });
    }));
    const semanticBlocks = Object.freeze(concepts.flatMap((concept) => concept.semanticBlocks));

    const index = {
      kind: 'hn-structure-index',
      sourceVersion,
      sourceLength: source.length,
      headings,
      concepts,
      semanticBlocks,
      conceptById(id) {
        return concepts.find((concept) => concept.id === String(id)) || null;
      },
      semanticBlockById(id) {
        return semanticBlocks.find((block) => block.id === String(id)) || null;
      },
      conceptAtOffset(requestedOffset) {
        const offset = Math.min(source.length, Math.max(0, Number(requestedOffset) || 0));
        return concepts.find((concept) => (
          rangeContainsOffset(concept.fullRange, offset, source.length)
        )) || null;
      },
      semanticBlockAtOffset(requestedOffset) {
        const offset = Math.min(source.length, Math.max(0, Number(requestedOffset) || 0));
        return semanticBlocks.find((block) => (
          rangeContainsOffset(block.fullRange, offset, source.length)
        )) || null;
      }
    };
    Object.values(index).filter((value) => typeof value === 'function').forEach(Object.freeze);
    return Object.freeze(index);
  }

  return Object.freeze({
    CONCEPT_KINDS,
    SEMANTIC_KINDS,
    MASKED_OWNER_TYPES,
    reservedSourceRanges,
    sourceRangeIntersectsReserved,
    createHnStructureIndex
  });
}));
