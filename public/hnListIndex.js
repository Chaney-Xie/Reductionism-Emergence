(function exposeHnListIndex(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const api = factory(
    isCommonJs ? require('./hnListNumbering') : root?.hnListNumbering,
    isCommonJs ? require('./hnStructureIndex') : root?.hnStructureIndexModel
  );
  if (isCommonJs) module.exports = api;
  if (root) root.hnListIndexModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (
  defaultNumbering,
  defaultStructureModel
) => {
  'use strict';

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

  function sourceVersionOf(snapshot) {
    const value = Number(snapshot?.sourceVersion ?? snapshot?.version);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('HN List derivation requires a valid SourceSnapshot version.');
    }
    return value;
  }

  function sourceAndLines(snapshot) {
    const source = snapshot?.markdownBody;
    const lines = snapshot?.physicalLineIndex?.lines;
    if (typeof source !== 'string'
      || !Array.isArray(lines)
      || !snapshot?.semanticIndex
      || !Object.isFrozen(snapshot)
      || !Object.isFrozen(lines)) {
      throw new TypeError('HN List derivation requires one immutable SourceSnapshot.');
    }
    return { source, lines };
  }

  function dottedPrefixesEqual(left, right) {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function compatibleSequence(sequence, recognized, parentItemId) {
    return Boolean(sequence)
      && sequence.parentItemId === parentItemId
      && sequence.scheme === recognized.scheme
      && dottedPrefixesEqual(sequence.dottedPrefix, recognized.dottedPrefix);
  }

  function rangesIntersect(left, right) {
    return Number(left?.start) < Number(right?.end)
      && Number(right?.start) < Number(left?.end);
  }

  function rangeIntersectsAny(range, ranges) {
    return ranges.some((candidate) => rangesIntersect(range, candidate));
  }

  function markerCandidate(line, sequenceContext, reservedRanges, semanticBlockRanges, dependencies) {
    const text = String(line?.text || '');
    const tabs = text.match(/^\t*/)?.[0] || '';
    const remainder = text.slice(tabs.length);
    const separatorIndex = remainder.indexOf(' ');
    if (separatorIndex <= 0) return null;
    const markerWithSeparator = remainder.slice(0, separatorIndex + 1);
    const recognized = dependencies.numbering.recognizeMarker(
      markerWithSeparator,
      sequenceContext ? { scheme: sequenceContext.scheme } : null
    );
    if (!recognized) return null;
    const markerStart = line.start + tabs.length;
    const markerEnd = markerStart + recognized.marker.length;
    const separatorStart = markerEnd;
    const separatorEnd = separatorStart + 1;
    const prefixRange = {
      start: line.start,
      end: separatorEnd
    };
    if (rangeIntersectsAny(prefixRange, reservedRanges)
      || rangeIntersectsAny(prefixRange, semanticBlockRanges)) {
      return Object.freeze({ reserved: true, tabs, depth: tabs.length });
    }
    return {
      reserved: false,
      tabs,
      depth: tabs.length,
      recognized,
      markerStart,
      markerEnd,
      separatorStart,
      separatorEnd,
      contentStart: separatorEnd
    };
  }

  function continuationStartsReservedBlock(snapshot, line, contentStart) {
    const source = String(snapshot?.markdownBody || '');
    const owners = Array.isArray(snapshot?.semanticIndex?.owners)
      ? snapshot.semanticIndex.owners
      : [];
    const contentRange = {
      start: contentStart,
      end: Math.max(contentStart, Number(line?.contentEnd) || contentStart)
    };
    const content = source.slice(contentRange.start, contentRange.end);
    return owners.some((owner) => {
      const type = String(owner?.type || '');
      if (!['code', 'math', 'table', 'html', 'definition'].includes(type)
        || !rangesIntersect(contentRange, owner)) return false;

      // Markdown may classify sufficiently wide continuation padding as an
      // indented code block. Those spaces belong to the HN item; only an
      // explicit fenced-code opener at the text column starts a reserved
      // block here.
      if (type === 'code') return /^(?:`{3,}|~{3,})/.test(content);
      // Inline safe-HTML tags (notably the existing HN <u> whitelist) remain
      // ordinary paragraph content. A block HTML owner spans the complete
      // continuation row or crosses its physical boundary.
      if (type === 'html') {
        return Number(owner.start) <= contentStart
          && Number(owner.end) >= Number(line.contentEnd);
      }
      return true;
    });
  }

  function paragraphDescriptor(kind, line, prefixEnd) {
    const prefixStart = line.start;
    const contentStart = Math.min(line.contentEnd, Math.max(prefixStart, Number(prefixEnd)));
    return {
      kind,
      physicalLineId: String(line.id),
      lineIndex: line.index,
      tabsRange: null,
      paddingRange: null,
      prefixRange: immutableRange(prefixStart, contentStart),
      contentRange: immutableRange(contentStart, line.contentEnd),
      fullRange: immutableRange(prefixStart, line.sourceEnd)
    };
  }

  function freezeParagraph(paragraph) {
    return Object.freeze({
      ...paragraph,
      ...(paragraph.tabsRange ? { tabsRange: immutableRange(
        paragraph.tabsRange.start,
        paragraph.tabsRange.end
      ) } : {}),
      ...(paragraph.paddingRange ? { paddingRange: immutableRange(
        paragraph.paddingRange.start,
        paragraph.paddingRange.end
      ) } : {})
    });
  }

  function createHnListIndex(snapshot, options = {}) {
    const dependencies = {
      numbering: options.numbering || defaultNumbering,
      structure: options.structureModel || defaultStructureModel
    };
    if (!dependencies.numbering?.recognizeMarker
      || !dependencies.numbering?.nextMarker
      || !dependencies.numbering?.defaultChildMarker
      || !dependencies.structure?.reservedSourceRanges
      || !dependencies.structure?.createHnStructureIndex) {
      throw new TypeError('HN List derivation requires numbering and reserved-range owners.');
    }
    const { source, lines } = sourceAndLines(snapshot);
    const sourceVersion = sourceVersionOf(snapshot);
    // Validate SourceSnapshot provenance once before scanning, including the
    // empty/plain-source cases that never present a marker candidate.
    const reservedRanges = dependencies.structure.reservedSourceRanges(snapshot);
    const structureIndex = snapshot.hnStructureIndex
      || dependencies.structure.createHnStructureIndex(snapshot);
    if (!structureIndex
      || structureIndex.sourceVersion !== sourceVersion
      || structureIndex.sourceLength !== source.length
      || !Array.isArray(structureIndex.semanticBlocks)
      || !Object.isFrozen(structureIndex)) {
      throw new TypeError('HN List derivation requires the matching immutable HN structure index.');
    }
    const semanticBlockRanges = Object.freeze(structureIndex.semanticBlocks.map((block) => (
      immutableRange(block.fullRange?.start, block.fullRange?.end)
    )));
    const mutableSequences = [];
    const mutableItems = [];
    const itemByLineIndex = new Map();
    const openItems = [];
    const activeSequenceByDepth = new Map();
    let structuralRegion = 0;

    const finalizeItem = (item, boundaryOffset, boundaryLineIndex) => {
      if (!item || item.subtreeEnd !== null) return;
      item.subtreeEnd = Math.max(item.start, Number(boundaryOffset) || item.start);
      item.subtreeEndLineIndex = Math.max(
        item.firstLineIndex,
        Number(boundaryLineIndex) - 1
      );
    };

    const closeItemsAtOrDeeper = (depth, boundaryOffset, boundaryLineIndex) => {
      while (openItems.length && openItems.at(-1).depth >= depth) {
        finalizeItem(openItems.pop(), boundaryOffset, boundaryLineIndex);
      }
      [...activeSequenceByDepth.keys()].filter((value) => value > depth)
        .forEach((value) => activeSequenceByDepth.delete(value));
    };

    const closeAll = (boundaryOffset, boundaryLineIndex) => {
      while (openItems.length) finalizeItem(openItems.pop(), boundaryOffset, boundaryLineIndex);
      activeSequenceByDepth.clear();
      structuralRegion += 1;
    };

    lines.forEach((line) => {
      const text = String(line.text || '');
      const tabs = text.match(/^\t*/)?.[0] || '';
      const depth = tabs.length;
      const parentItem = depth > 0
        ? openItems.findLast?.((item) => item.depth === depth - 1)
          || [...openItems].reverse().find((item) => item.depth === depth - 1)
          || null
        : null;
      const reachableContext = activeSequenceByDepth.get(depth) || null;
      const candidate = markerCandidate(
        line,
        reachableContext,
        reservedRanges,
        semanticBlockRanges,
        dependencies
      );

      if (candidate && !candidate.reserved) {
        if (depth > 0 && !parentItem) {
          closeAll(line.start, line.index);
          return;
        }
        closeItemsAtOrDeeper(depth, line.start, line.index);
        [...activeSequenceByDepth.keys()].filter((value) => value > depth)
          .forEach((value) => activeSequenceByDepth.delete(value));
        if (parentItem) parentItem.acceptingContinuations = false;
        const parentItemId = parentItem?.id || null;
        let sequence = activeSequenceByDepth.get(depth) || null;
        if (sequence?.region !== structuralRegion
          || !compatibleSequence(sequence, candidate.recognized, parentItemId)) {
          sequence = {
            id: `hn-list-sequence:${sourceVersion}:${depth}:${candidate.markerStart}`,
            region: structuralRegion,
            depth,
            parentItemId,
            scheme: candidate.recognized.scheme,
            dottedPrefix: candidate.recognized.dottedPrefix
              ? [...candidate.recognized.dottedPrefix]
              : null,
            startOrdinal: candidate.recognized.ordinal,
            firstLineIndex: line.index,
            itemIds: [],
            items: []
          };
          mutableSequences.push(sequence);
          activeSequenceByDepth.set(depth, sequence);
          if (parentItem) parentItem.childSequenceIds.push(sequence.id);
        }

        const firstParagraph = paragraphDescriptor('first', line, candidate.contentStart);
        firstParagraph.tabsRange = immutableRange(line.start, line.start + depth);
        firstParagraph.paddingRange = immutableRange(
          candidate.markerEnd,
          candidate.separatorEnd
        );
        const item = {
          id: `hn-list-item:${sourceVersion}:${depth}:${candidate.markerStart}`,
          sequenceId: sequence.id,
          parentItemId,
          depth,
          tabs,
          scheme: candidate.recognized.scheme,
          ordinal: candidate.recognized.ordinal,
          path: candidate.recognized.path ? [...candidate.recognized.path] : null,
          dottedPrefix: candidate.recognized.dottedPrefix
            ? [...candidate.recognized.dottedPrefix]
            : null,
          marker: candidate.recognized.marker,
          markerStart: candidate.markerStart,
          markerEnd: candidate.markerEnd,
          separatorStart: candidate.separatorStart,
          separatorEnd: candidate.separatorEnd,
          contentStart: candidate.contentStart,
          start: line.start,
          ownEnd: line.sourceEnd,
          firstLineIndex: line.index,
          ownEndLineIndex: line.index,
          subtreeEnd: null,
          subtreeEndLineIndex: null,
          paragraphs: [firstParagraph],
          childSequenceIds: [],
          acceptingContinuations: true
        };
        mutableItems.push(item);
        sequence.items.push(item);
        sequence.itemIds.push(item.id);
        itemByLineIndex.set(line.index, item);
        openItems.push(item);
        return;
      }

      const continuationOwner = openItems.findLast?.((item) => item.depth === depth)
        || [...openItems].reverse().find((item) => item.depth === depth)
        || null;
      if (!candidate && continuationOwner?.acceptingContinuations) {
        const paddingWidth = continuationOwner.marker.length + 1;
        const exactPrefix = `${tabs}${' '.repeat(paddingWidth)}`;
        const contentStart = line.start + exactPrefix.length;
        if (text.startsWith(exactPrefix)
          && !continuationStartsReservedBlock(snapshot, line, contentStart)) {
          const paragraph = paragraphDescriptor('continuation', line, line.start + exactPrefix.length);
          paragraph.tabsRange = immutableRange(line.start, line.start + depth);
          paragraph.paddingRange = immutableRange(
            line.start + depth,
            line.start + exactPrefix.length
          );
          continuationOwner.paragraphs.push(paragraph);
          continuationOwner.ownEnd = line.sourceEnd;
          continuationOwner.ownEndLineIndex = line.index;
          itemByLineIndex.set(line.index, continuationOwner);
          return;
        }
      }

      closeAll(line.start, line.index);
    });
    closeAll(source.length, lines.length);

    const mutableSequenceById = new Map(mutableSequences.map((sequence) => [
      sequence.id,
      sequence
    ]));
    const childSequenceRangesFor = (item) => Object.freeze(item.childSequenceIds.map((id) => {
      const sequence = mutableSequenceById.get(id);
      const first = sequence?.items?.[0];
      const last = sequence?.items?.at(-1);
      return immutableRange(first?.start, last?.subtreeEnd);
    }));
    const itemByIdMap = new Map();
    const frozenItems = Object.freeze(mutableItems.map((item) => {
      const paragraphs = Object.freeze(item.paragraphs.map(freezeParagraph));
      const continuationParagraphs = Object.freeze(paragraphs.slice(1));
      const descriptor = Object.freeze({
        id: item.id,
        sequenceId: item.sequenceId,
        parentItemId: item.parentItemId,
        lineIndex: item.firstLineIndex,
        depth: item.depth,
        tabs: item.tabs,
        scheme: item.scheme,
        ordinal: item.ordinal,
        path: item.path ? Object.freeze([...item.path]) : null,
        dottedPrefix: item.dottedPrefix ? Object.freeze([...item.dottedPrefix]) : null,
        marker: item.marker,
        textColumnWidth: item.marker.length + 1,
        tabsRange: immutableRange(item.start, item.start + item.depth),
        markerRange: immutableRange(item.markerStart, item.markerEnd),
        separatorRange: immutableRange(item.separatorStart, item.separatorEnd),
        prefixRange: immutableRange(item.start, item.contentStart),
        firstParagraphRange: paragraphs[0].contentRange,
        continuationParagraphs,
        continuationParagraphRanges: Object.freeze(
          continuationParagraphs.map((paragraph) => paragraph.contentRange)
        ),
        paragraphRanges: Object.freeze(paragraphs.map((paragraph) => paragraph.contentRange)),
        paragraphs,
        itemRange: immutableRange(item.start, item.ownEnd),
        completeItemRange: immutableRange(item.start, item.ownEnd),
        subtreeRange: immutableRange(item.start, item.subtreeEnd),
        ownPhysicalLineExtent: immutableLineExtent(
          item.firstLineIndex,
          item.ownEndLineIndex
        ),
        physicalLineExtent: immutableLineExtent(
          item.firstLineIndex,
          item.subtreeEndLineIndex
        ),
        childSequenceIds: Object.freeze([...item.childSequenceIds]),
        childSequenceRanges: childSequenceRangesFor(item),
        empty: paragraphs.every((paragraph) => (
          source.slice(paragraph.contentRange.start, paragraph.contentRange.end).length === 0
        )) && item.childSequenceIds.length === 0
      });
      itemByIdMap.set(descriptor.id, descriptor);
      return descriptor;
    }));

    const sequenceByIdMap = new Map();
    const frozenSequences = Object.freeze(mutableSequences.map((sequence) => {
      const items = Object.freeze(sequence.itemIds.map((id) => itemByIdMap.get(id)));
      const first = items[0];
      const last = items.at(-1);
      const authoredOrdinals = Object.freeze(items.map((item) => item.ordinal));
      const sequential = authoredOrdinals.every((ordinal, index) => (
        ordinal === sequence.startOrdinal + index
      ));
      const descriptor = Object.freeze({
        id: sequence.id,
        depth: sequence.depth,
        parentItemId: sequence.parentItemId,
        scheme: sequence.scheme,
        dottedPrefix: sequence.dottedPrefix
          ? Object.freeze([...sequence.dottedPrefix])
          : null,
        startOrdinal: sequence.startOrdinal,
        authoredOrdinals,
        sequential,
        sourceRange: immutableRange(first?.subtreeRange.start, last?.subtreeRange.end),
        fullRange: immutableRange(first?.subtreeRange.start, last?.subtreeRange.end),
        physicalLineExtent: immutableLineExtent(
          first?.physicalLineExtent.startLineIndex,
          last?.physicalLineExtent.endLineIndex
        ),
        markerColumnWidth: items.reduce((width, item) => (
          Math.max(width, item.textColumnWidth)
        ), 0),
        itemIds: Object.freeze([...sequence.itemIds]),
        items
      });
      sequenceByIdMap.set(descriptor.id, descriptor);
      return descriptor;
    }));

    const frozenItemByLineIndex = new Map([...itemByLineIndex].map(([lineIndex, item]) => (
      [lineIndex, itemByIdMap.get(item.id)]
    )));
    const lineItem = (lineIndex) => frozenItemByLineIndex.get(Number(lineIndex)) || null;
    const itemAtOffset = (requestedOffset, affinity = 'after') => {
      const offset = Math.min(source.length, Math.max(0, Number(requestedOffset) || 0));
      const line = snapshot.physicalLineIndex.lineAtOffset(offset, affinity);
      return lineItem(line?.index);
    };
    const index = {
      kind: 'hn-list-index',
      sourceVersion,
      sourceLength: source.length,
      sequences: frozenSequences,
      items: frozenItems,
      itemById(id) {
        return itemByIdMap.get(String(id)) || null;
      },
      sequenceById(id) {
        return sequenceByIdMap.get(String(id)) || null;
      },
      itemAtLineIndex(lineIndex) {
        return lineItem(lineIndex);
      },
      itemAtOffset,
      itemAtPosition(position) {
        return itemAtOffset(position?.offset ?? position, position?.affinity || 'after');
      },
      sequenceAtOffset(offset, affinity = 'after') {
        const item = itemAtOffset(offset, affinity);
        return item ? sequenceByIdMap.get(item.sequenceId) || null : null;
      },
      sequenceAtPosition(position) {
        const item = itemAtOffset(position?.offset ?? position, position?.affinity || 'after');
        return item ? sequenceByIdMap.get(item.sequenceId) || null : null;
      },
      parentOf(itemOrId) {
        const item = typeof itemOrId === 'string'
          ? itemByIdMap.get(itemOrId)
          : itemOrId;
        return item?.parentItemId ? itemByIdMap.get(item.parentItemId) || null : null;
      },
      childSequencesOf(itemOrId) {
        const item = typeof itemOrId === 'string'
          ? itemByIdMap.get(itemOrId)
          : itemOrId;
        return Object.freeze((item?.childSequenceIds || []).map((id) => (
          sequenceByIdMap.get(id)
        )).filter(Boolean));
      }
    };
    return Object.freeze(index);
  }

  return Object.freeze({
    createHnListIndex
  });
}));
