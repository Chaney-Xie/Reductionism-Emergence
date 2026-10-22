(function exposeHnListCommands(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const api = factory(
    isCommonJs ? require('./hnListNumbering') : root?.hnListNumbering,
    isCommonJs ? require('./hnListIndex') : root?.hnListIndexModel
  );
  if (isCommonJs) module.exports = api;
  if (root) root.hnListCommands = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (
  defaultNumbering,
  defaultListIndexModel
) => {
  'use strict';

  const BEFORE = 'before';
  const AFTER = 'after';

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function sourceOf(snapshot) {
    if (typeof snapshot?.markdownBody !== 'string') {
      throw new TypeError('HN List commands require one source snapshot.');
    }
    return snapshot.markdownBody;
  }

  function endpoint(selection, key, affinityKey, fallback, sourceLength) {
    const candidate = selection?.[key];
    const requestedOffset = candidate && typeof candidate === 'object'
      ? candidate.offset
      : candidate;
    const requestedAffinity = candidate && typeof candidate === 'object'
      ? candidate.affinity
      : selection?.[affinityKey];
    return Object.freeze({
      offset: clamp(
        Number.isFinite(Number(requestedOffset)) ? requestedOffset : fallback,
        0,
        sourceLength
      ),
      affinity: requestedAffinity === BEFORE ? BEFORE : AFTER
    });
  }

  function normalizedSelection(selection, sourceLength) {
    const anchor = endpoint(selection, 'anchor', 'anchorAffinity', 0, sourceLength);
    const focus = endpoint(selection, 'focus', 'focusAffinity', anchor.offset, sourceLength);
    return Object.freeze({ anchor, focus });
  }

  function publicSelection(anchor, focus = anchor) {
    return Object.freeze({
      anchor: anchor.offset,
      focus: focus.offset,
      anchorAffinity: anchor.affinity === BEFORE ? BEFORE : AFTER,
      focusAffinity: focus.affinity === BEFORE ? BEFORE : AFTER
    });
  }

  function unchangedResult(source, selection) {
    return Object.freeze({
      changed: false,
      source,
      selection: publicSelection(selection.anchor, selection.focus),
      transaction: null
    });
  }

  function changedResult(
    source,
    nextSource,
    beforeSelection,
    afterSelection,
    transactionKind,
    inputType
  ) {
    const before = publicSelection(beforeSelection.anchor, beforeSelection.focus);
    const after = publicSelection(afterSelection.anchor, afterSelection.focus);
    return Object.freeze({
      changed: source !== nextSource,
      source: nextSource,
      selection: after,
      transaction: source === nextSource ? null : Object.freeze({
        transactionKind,
        inputType,
        structural: true,
        listTransform: true,
        beforeSelection: before,
        afterSelection: after
      })
    });
  }

  function dependenciesFor(snapshot, options = {}) {
    const numbering = options.numbering || defaultNumbering;
    const listIndexModel = options.listIndexModel || defaultListIndexModel;
    if (!numbering?.recognizeMarker
      || !numbering?.nextMarker
      || !numbering?.defaultChildMarker
      || !listIndexModel?.createHnListIndex) {
      throw new TypeError('HN List commands require numbering and ListIndex owners.');
    }
    const source = sourceOf(snapshot);
    const sourceVersion = Number(snapshot?.sourceVersion ?? snapshot?.version);
    const supplied = options.listIndex || snapshot?.hnListIndex || null;
    const index = supplied
      && supplied.kind === 'hn-list-index'
      && supplied.sourceVersion === sourceVersion
      && supplied.sourceLength === source.length
      ? supplied
      : listIndexModel.createHnListIndex(snapshot, options);
    return { numbering, index, source };
  }

  function sequenceContext(sequence) {
    return Object.freeze({
      scheme: sequence.scheme,
      dottedPrefix: sequence.dottedPrefix
    });
  }

  function arraysEqual(left, right) {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function preferredLineEnding(snapshot, lineIndex) {
    const lines = snapshot?.physicalLineIndex?.lines || [];
    const current = lines[Number(lineIndex)];
    if (current?.lineEnding) return current.lineEnding;
    for (let index = Number(lineIndex) - 1; index >= 0; index -= 1) {
      if (lines[index]?.lineEnding) return lines[index].lineEnding;
    }
    for (let index = Number(lineIndex) + 1; index < lines.length; index += 1) {
      if (lines[index]?.lineEnding) return lines[index].lineEnding;
    }
    return '\n';
  }

  function editKey(start, end) {
    return `${start}:${end}`;
  }

  function addEdit(edits, start, end, replacement, kind) {
    const boundedStart = Number(start);
    const boundedEnd = Number(end);
    if (!Number.isSafeInteger(boundedStart)
      || !Number.isSafeInteger(boundedEnd)
      || boundedStart < 0
      || boundedEnd < boundedStart) {
      throw new RangeError('HN List command produced an invalid source range.');
    }
    const nextReplacement = String(replacement ?? '');
    const key = editKey(boundedStart, boundedEnd);
    const existing = edits.find((edit) => edit.key === key);
    if (existing) {
      if (existing.replacement !== nextReplacement) {
        throw new TypeError('HN List command produced conflicting source edits.');
      }
      return existing;
    }
    const edit = {
      key,
      start: boundedStart,
      end: boundedEnd,
      replacement: nextReplacement,
      kind: String(kind || 'hn-list-edit'),
      order: edits.length
    };
    edits.push(edit);
    return edit;
  }

  function sortedEdits(edits) {
    const sorted = [...edits].sort((left, right) => (
      left.start - right.start
        || (left.start === left.end ? -1 : 1) - (right.start === right.end ? -1 : 1)
        || left.order - right.order
    ));
    let consumed = 0;
    sorted.forEach((edit) => {
      if (edit.start < consumed) {
        throw new TypeError('HN List command produced overlapping source edits.');
      }
      consumed = Math.max(consumed, edit.end);
    });
    return sorted;
  }

  function applyEdits(source, edits) {
    const sorted = sortedEdits(edits);
    let cursor = 0;
    let result = '';
    sorted.forEach((edit) => {
      result += source.slice(cursor, edit.start);
      result += edit.replacement;
      cursor = edit.end;
    });
    result += source.slice(cursor);
    return result;
  }

  function mappedOffset(offset, edits, affinity = AFTER) {
    const sorted = sortedEdits(edits);
    let delta = 0;
    for (const edit of sorted) {
      if (offset < edit.start || (offset === edit.start && affinity === BEFORE)) break;
      if (edit.start === edit.end) {
        delta += edit.replacement.length - (edit.end - edit.start);
        continue;
      }
      if (offset > edit.end || offset === edit.end) {
        delta += edit.replacement.length - (edit.end - edit.start);
        continue;
      }
      if (offset === edit.start) return edit.start + delta;
      return edit.start + delta + Math.min(
        offset - edit.start,
        edit.replacement.length
      );
    }
    return offset + delta;
  }

  function mappedEndpoint(endpointValue, edits) {
    return Object.freeze({
      offset: mappedOffset(endpointValue.offset, edits, endpointValue.affinity),
      affinity: endpointValue.affinity === BEFORE ? BEFORE : AFTER
    });
  }

  function finalEditStart(target, edits) {
    const sorted = sortedEdits(edits);
    let cursor = 0;
    let outputLength = 0;
    for (const edit of sorted) {
      outputLength += edit.start - cursor;
      if (edit === target) return outputLength;
      outputLength += edit.replacement.length;
      cursor = edit.end;
    }
    throw new TypeError('HN List command lost its canonical selection target.');
  }

  function paragraphForRange(item, start, end) {
    return item?.paragraphs?.find((paragraph) => (
      paragraph.contentRange.start <= start && end <= paragraph.contentRange.end
    )) || null;
  }

  function ownedNewlineContext(index, selection) {
    const start = Math.min(selection.anchor.offset, selection.focus.offset);
    const end = Math.max(selection.anchor.offset, selection.focus.offset);
    const item = index.itemAtOffset(selection.focus.offset, selection.focus.affinity)
      || index.itemAtOffset(start, AFTER);
    if (!item) return null;
    const paragraph = paragraphForRange(item, start, end);
    if (!paragraph) return null;
    return { item, paragraph, start, end };
  }

  function itemAtOwnedEndpoint(index, endpointValue) {
    const direct = index.itemAtOffset(endpointValue.offset, endpointValue.affinity);
    if (direct?.paragraphs?.some((paragraph) => (
      paragraph.prefixRange.start <= endpointValue.offset
        && endpointValue.offset <= paragraph.contentRange.end
    ))) return direct;
    return index.items.find((item) => item.paragraphs.some((paragraph) => (
      paragraph.prefixRange.start <= endpointValue.offset
        && endpointValue.offset <= paragraph.contentRange.end
    ))) || null;
  }

  function ownedIndentationContext(index, selection) {
    const anchorItem = itemAtOwnedEndpoint(index, selection.anchor);
    const focusItem = itemAtOwnedEndpoint(index, selection.focus);
    if (!anchorItem || !focusItem || anchorItem.id !== focusItem.id) return null;
    return { item: focusItem };
  }

  function markerRecognition(numbering, marker, scheme) {
    return numbering.recognizeMarker(`${marker} `, { scheme });
  }

  function addContinuationPaddingEdits(edits, item, width) {
    const padding = ' '.repeat(width);
    (item.continuationParagraphs || []).forEach((paragraph) => {
      addEdit(
        edits,
        paragraph.paddingRange.start,
        paragraph.paddingRange.end,
        padding,
        'hn-list-continuation-padding'
      );
    });
  }

  function addDependentDottedChildEdits(
    edits,
    item,
    previousParentPath,
    nextParentPath,
    dependencies
  ) {
    if (!Array.isArray(previousParentPath)
      || !Array.isArray(nextParentPath)
      || arraysEqual(previousParentPath, nextParentPath)) return;
    dependencies.index.childSequencesOf(item).forEach((sequence) => {
      if (sequence.scheme !== dependencies.numbering.SCHEMES.DOTTED_DECIMAL
        || !arraysEqual(sequence.dottedPrefix, previousParentPath)) return;
      sequence.items.forEach((child) => {
        const marker = `${[...nextParentPath, child.ordinal].join('.')}.`;
        addItemMarkerEdits(edits, child, marker, child.scheme, dependencies);
      });
    });
  }

  function addItemMarkerEdits(edits, item, marker, scheme, dependencies) {
    const nextMarker = String(marker);
    if (nextMarker !== item.marker) {
      addEdit(
        edits,
        item.markerRange.start,
        item.markerRange.end,
        nextMarker,
        'hn-list-marker'
      );
    }
    addContinuationPaddingEdits(edits, item, nextMarker.length + 1);
    const recognized = markerRecognition(dependencies.numbering, nextMarker, scheme);
    addDependentDottedChildEdits(
      edits,
      item,
      item.path,
      recognized?.path || null,
      dependencies
    );
  }

  function rewriteItemsFrom(
    edits,
    sequence,
    items,
    firstMarker,
    dependencies
  ) {
    let marker = firstMarker;
    items.forEach((item) => {
      addItemMarkerEdits(edits, item, marker, sequence.scheme, dependencies);
      marker = dependencies.numbering.nextMarker(sequenceContext(sequence), marker);
    });
  }

  function sourceSequenceAfterRemovalEdits(edits, sequence, item, dependencies) {
    const position = sequence.items.findIndex((candidate) => candidate.id === item.id);
    if (position < 0 || position >= sequence.items.length - 1) return;
    const firstMarker = position === 0
      ? item.marker
      : dependencies.numbering.nextMarker(
        sequenceContext(sequence),
        sequence.items[position - 1].marker
      );
    rewriteItemsFrom(
      edits,
      sequence,
      sequence.items.slice(position + 1),
      firstMarker,
      dependencies
    );
  }

  function destinationSequenceAfterInsertionEdits(
    edits,
    sequence,
    anchorItem,
    insertedMarker,
    dependencies
  ) {
    const position = sequence.items.findIndex((candidate) => candidate.id === anchorItem.id);
    if (position < 0 || position >= sequence.items.length - 1) return;
    const firstMarker = dependencies.numbering.nextMarker(
      sequenceContext(sequence),
      insertedMarker
    );
    rewriteItemsFrom(
      edits,
      sequence,
      sequence.items.slice(position + 1),
      firstMarker,
      dependencies
    );
  }

  function subtreeLineRecords(snapshot, item) {
    return (snapshot?.physicalLineIndex?.lines || []).filter((line) => (
      item.subtreeRange.start <= line.start && line.start < item.subtreeRange.end
    ));
  }

  function transformedSubtree(
    snapshot,
    item,
    marker,
    scheme,
    depthDelta,
    endpoints,
    dependencies
  ) {
    const source = dependencies.source;
    const absoluteEdits = [];
    addItemMarkerEdits(absoluteEdits, item, marker, scheme, dependencies);
    subtreeLineRecords(snapshot, item).forEach((line) => {
      if (depthDelta > 0) {
        addEdit(absoluteEdits, line.start, line.start, '\t', 'hn-list-indent-tab');
      } else if (depthDelta < 0) {
        if (source.slice(line.start, line.start + 1) !== '\t') {
          throw new TypeError('HN List outdent cannot remove a non-Tab depth prefix.');
        }
        addEdit(absoluteEdits, line.start, line.start + 1, '', 'hn-list-outdent-tab');
      }
    });
    const start = item.subtreeRange.start;
    const block = source.slice(start, item.subtreeRange.end);
    const localEdits = absoluteEdits.map((edit) => ({
      ...edit,
      key: editKey(edit.start - start, edit.end - start),
      start: edit.start - start,
      end: edit.end - start
    }));
    return Object.freeze({
      source: applyEdits(block, localEdits),
      endpoints: Object.freeze(endpoints.map((endpointValue) => mappedEndpoint(
        Object.freeze({
          offset: endpointValue.offset - start,
          affinity: endpointValue.affinity
        }),
        localEdits
      )))
    });
  }

  function resultForEdits(
    dependencies,
    edits,
    beforeSelection,
    afterSelection,
    transactionKind,
    inputType
  ) {
    const nextSource = applyEdits(dependencies.source, edits);
    return changedResult(
      dependencies.source,
      nextSource,
      beforeSelection,
      afterSelection,
      transactionKind,
      inputType
    );
  }

  function applyShiftEnter(snapshot, context, selection, dependencies) {
    const { item, paragraph, start, end } = context;
    const lineEnding = preferredLineEnding(snapshot, paragraph.lineIndex);
    const replacement = `${lineEnding}${item.tabs}${' '.repeat(item.textColumnWidth)}`;
    const edits = [];
    const primary = addEdit(
      edits,
      start,
      end,
      replacement,
      'hn-list-continuation-paragraph'
    );
    const caret = finalEditStart(primary, edits) + replacement.length;
    return resultForEdits(
      dependencies,
      edits,
      selection,
      Object.freeze({
        anchor: Object.freeze({ offset: caret, affinity: AFTER }),
        focus: Object.freeze({ offset: caret, affinity: AFTER })
      }),
      'hn-sequence-list-shift-enter',
      'insertLineBreak'
    );
  }

  function applyEmptyRootEnter(snapshot, context, selection, dependencies) {
    const { item, paragraph } = context;
    const edits = [];
    const replacement = item.subtreeRange.end < dependencies.source.length
      ? preferredLineEnding(snapshot, paragraph.lineIndex)
      : '';
    const primary = addEdit(
      edits,
      item.subtreeRange.start,
      item.subtreeRange.end,
      replacement,
      'hn-list-empty-root-exit'
    );
    const caret = finalEditStart(primary, edits);
    return resultForEdits(
      dependencies,
      edits,
      selection,
      Object.freeze({
        anchor: Object.freeze({ offset: caret, affinity: AFTER }),
        focus: Object.freeze({ offset: caret, affinity: AFTER })
      }),
      'hn-sequence-list-empty-root-enter',
      'insertParagraph'
    );
  }

  function applyEmptyNestedEnter(snapshot, context, selection, dependencies) {
    const { item, paragraph } = context;
    const parent = dependencies.index.parentOf(item);
    const sourceSequence = dependencies.index.sequenceById(item.sequenceId);
    const destinationSequence = parent
      ? dependencies.index.sequenceById(parent.sequenceId)
      : null;
    if (!parent || !sourceSequence || !destinationSequence) {
      return unchangedResult(dependencies.source, selection);
    }
    const marker = dependencies.numbering.nextMarker(
      sequenceContext(destinationSequence),
      parent.marker
    );
    const lineEnding = preferredLineEnding(snapshot, paragraph.lineIndex);
    const prefix = `${parent.tabs}${marker} `;
    const movesPastRemainingChildren = item.subtreeRange.end < parent.subtreeRange.end;
    const destinationAtSourceEnd = parent.subtreeRange.end === dependencies.source.length;
    const leadingLineEnding = movesPastRemainingChildren && destinationAtSourceEnd
      ? lineEnding
      : '';
    const inserted = parent.subtreeRange.end < dependencies.source.length
      ? `${prefix}${lineEnding}`
      : `${leadingLineEnding}${prefix}`;
    const edits = [];
    addEdit(
      edits,
      item.subtreeRange.start,
      item.subtreeRange.end,
      '',
      'hn-list-empty-nested-remove'
    );
    sourceSequenceAfterRemovalEdits(edits, sourceSequence, item, dependencies);
    destinationSequenceAfterInsertionEdits(
      edits,
      destinationSequence,
      parent,
      marker,
      dependencies
    );
    const insertion = addEdit(
      edits,
      parent.subtreeRange.end,
      parent.subtreeRange.end,
      inserted,
      'hn-list-empty-nested-lift'
    );
    const caret = finalEditStart(insertion, edits) + leadingLineEnding.length + prefix.length;
    return resultForEdits(
      dependencies,
      edits,
      selection,
      Object.freeze({
        anchor: Object.freeze({ offset: caret, affinity: AFTER }),
        focus: Object.freeze({ offset: caret, affinity: AFTER })
      }),
      'hn-sequence-list-empty-nested-enter',
      'insertParagraph'
    );
  }

  function applySplitEnter(snapshot, context, selection, dependencies) {
    const { item, paragraph, start, end } = context;
    const sequence = dependencies.index.sequenceById(item.sequenceId);
    if (!sequence) return unchangedResult(dependencies.source, selection);
    const marker = dependencies.numbering.nextMarker(sequenceContext(sequence), item.marker);
    const lineEnding = preferredLineEnding(snapshot, paragraph.lineIndex);
    const replacement = `${lineEnding}${item.tabs}${marker} `;
    const edits = [];
    const primary = addEdit(
      edits,
      start,
      end,
      replacement,
      'hn-list-sibling-split'
    );
    const paragraphIndex = item.paragraphs.findIndex((candidate) => (
      candidate.lineIndex === paragraph.lineIndex
    ));
    const padding = ' '.repeat(marker.length + 1);
    item.paragraphs.slice(paragraphIndex + 1).forEach((laterParagraph) => {
      addEdit(
        edits,
        laterParagraph.paddingRange.start,
        laterParagraph.paddingRange.end,
        padding,
        'hn-list-split-continuation-padding'
      );
    });
    const nextRecognition = markerRecognition(dependencies.numbering, marker, sequence.scheme);
    addDependentDottedChildEdits(
      edits,
      item,
      item.path,
      nextRecognition?.path || null,
      dependencies
    );
    const itemPosition = sequence.items.findIndex((candidate) => candidate.id === item.id);
    if (itemPosition >= 0 && itemPosition < sequence.items.length - 1) {
      const firstMarker = dependencies.numbering.nextMarker(sequenceContext(sequence), marker);
      rewriteItemsFrom(
        edits,
        sequence,
        sequence.items.slice(itemPosition + 1),
        firstMarker,
        dependencies
      );
    }
    const caret = finalEditStart(primary, edits) + replacement.length;
    return resultForEdits(
      dependencies,
      edits,
      selection,
      Object.freeze({
        anchor: Object.freeze({ offset: caret, affinity: AFTER }),
        focus: Object.freeze({ offset: caret, affinity: AFTER })
      }),
      'hn-sequence-list-enter',
      'insertParagraph'
    );
  }

  function applyHnSequenceListNewline(snapshot, selectionInput = {}, options = {}) {
    const dependencies = dependenciesFor(snapshot, options);
    const selection = normalizedSelection(selectionInput, dependencies.source.length);
    const context = ownedNewlineContext(dependencies.index, selection);
    if (!context) return null;
    try {
      if (options.shiftKey === true || options.inputType === 'insertLineBreak') {
        return applyShiftEnter(snapshot, context, selection, dependencies);
      }
      if (context.item.empty) {
        return context.item.depth === 0
          ? applyEmptyRootEnter(snapshot, context, selection, dependencies)
          : applyEmptyNestedEnter(snapshot, context, selection, dependencies);
      }
      return applySplitEnter(snapshot, context, selection, dependencies);
    } catch (error) {
      if (error instanceof RangeError) return unchangedResult(dependencies.source, selection);
      throw error;
    }
  }

  function applyIndent(snapshot, item, selection, dependencies) {
    const sequence = dependencies.index.sequenceById(item.sequenceId);
    const position = sequence?.items?.findIndex((candidate) => candidate.id === item.id) ?? -1;
    if (!sequence || position <= 0) return unchangedResult(dependencies.source, selection);
    const previous = sequence.items[position - 1];
    const childSequences = dependencies.index.childSequencesOf(previous);
    const lastChildSequence = childSequences.at(-1) || null;
    const compatibleChild = lastChildSequence
      && lastChildSequence.scheme === sequence.scheme
      && (sequence.scheme !== dependencies.numbering.SCHEMES.DOTTED_DECIMAL
        || arraysEqual(lastChildSequence.dottedPrefix, previous.path))
      ? lastChildSequence
      : null;
    const marker = compatibleChild
      ? dependencies.numbering.nextMarker(
        sequenceContext(compatibleChild),
        compatibleChild.items.at(-1).marker
      )
      : dependencies.numbering.defaultChildMarker(
        sequenceContext(sequence),
        previous.marker
      );
    const transformed = transformedSubtree(
      snapshot,
      item,
      marker,
      compatibleChild?.scheme || sequence.scheme,
      1,
      [selection.anchor, selection.focus],
      dependencies
    );
    const edits = [];
    const primary = addEdit(
      edits,
      item.subtreeRange.start,
      item.subtreeRange.end,
      transformed.source,
      'hn-list-indent-subtree'
    );
    sourceSequenceAfterRemovalEdits(edits, sequence, item, dependencies);
    const targetStart = finalEditStart(primary, edits);
    const afterSelection = Object.freeze({
      anchor: Object.freeze({
        offset: targetStart + transformed.endpoints[0].offset,
        affinity: transformed.endpoints[0].affinity
      }),
      focus: Object.freeze({
        offset: targetStart + transformed.endpoints[1].offset,
        affinity: transformed.endpoints[1].affinity
      })
    });
    return resultForEdits(
      dependencies,
      edits,
      selection,
      afterSelection,
      'hn-sequence-list-tab',
      'formatIndent'
    );
  }

  function applyOutdent(snapshot, item, selection, dependencies) {
    if (item.depth <= 0) return unchangedResult(dependencies.source, selection);
    const parent = dependencies.index.parentOf(item);
    const sourceSequence = dependencies.index.sequenceById(item.sequenceId);
    const destinationSequence = parent
      ? dependencies.index.sequenceById(parent.sequenceId)
      : null;
    if (!parent || !sourceSequence || !destinationSequence) {
      return unchangedResult(dependencies.source, selection);
    }
    const marker = dependencies.numbering.nextMarker(
      sequenceContext(destinationSequence),
      parent.marker
    );
    const transformed = transformedSubtree(
      snapshot,
      item,
      marker,
      destinationSequence.scheme,
      -1,
      [selection.anchor, selection.focus],
      dependencies
    );
    const edits = [];
    sourceSequenceAfterRemovalEdits(edits, sourceSequence, item, dependencies);
    destinationSequenceAfterInsertionEdits(
      edits,
      destinationSequence,
      parent,
      marker,
      dependencies
    );
    const movesAfterParent = item.subtreeRange.end < parent.subtreeRange.end;
    let target;
    let targetOffset = 0;
    if (movesAfterParent) {
      let insertionSource = transformed.source;
      if (parent.subtreeRange.end === dependencies.source.length) {
        const lineEnding = preferredLineEnding(
          snapshot,
          item.physicalLineExtent.endLineIndex
        );
        if (insertionSource.endsWith(lineEnding)) {
          insertionSource = insertionSource.slice(0, -lineEnding.length);
        }
        insertionSource = `${lineEnding}${insertionSource}`;
        targetOffset = lineEnding.length;
      }
      addEdit(
        edits,
        item.subtreeRange.start,
        item.subtreeRange.end,
        '',
        'hn-list-outdent-remove-subtree'
      );
      target = addEdit(
        edits,
        parent.subtreeRange.end,
        parent.subtreeRange.end,
        insertionSource,
        'hn-list-outdent-insert-subtree'
      );
    } else {
      target = addEdit(
        edits,
        item.subtreeRange.start,
        item.subtreeRange.end,
        transformed.source,
        'hn-list-outdent-subtree'
      );
    }
    const targetStart = finalEditStart(target, edits);
    const afterSelection = Object.freeze({
      anchor: Object.freeze({
        offset: targetStart + targetOffset + transformed.endpoints[0].offset,
        affinity: transformed.endpoints[0].affinity
      }),
      focus: Object.freeze({
        offset: targetStart + targetOffset + transformed.endpoints[1].offset,
        affinity: transformed.endpoints[1].affinity
      })
    });
    return resultForEdits(
      dependencies,
      edits,
      selection,
      afterSelection,
      'hn-sequence-list-shift-tab',
      'formatOutdent'
    );
  }

  function applyHnSequenceListIndentation(
    snapshot,
    selectionInput = {},
    direction = 'indent',
    options = {}
  ) {
    const dependencies = dependenciesFor(snapshot, options);
    const selection = normalizedSelection(selectionInput, dependencies.source.length);
    const context = ownedIndentationContext(dependencies.index, selection);
    if (!context) return null;
    try {
      return direction === 'outdent'
        ? applyOutdent(snapshot, context.item, selection, dependencies)
        : applyIndent(snapshot, context.item, selection, dependencies);
    } catch (error) {
      if (error instanceof RangeError) return unchangedResult(dependencies.source, selection);
      throw error;
    }
  }

  function deletionDirection(value, options = {}) {
    const requested = String(value || options.inputType || '').toLowerCase();
    if (requested === 'backward'
      || requested === 'backspace'
      || requested === 'deletecontentbackward') return 'backward';
    if (requested === 'forward'
      || requested === 'delete'
      || requested === 'deletecontentforward') return 'forward';
    return null;
  }

  function listJoinContext(index, selection, direction) {
    if (selection.anchor.offset !== selection.focus.offset) return null;
    const offset = selection.focus.offset;
    let sequence = null;
    let previous = null;
    let current = null;
    if (direction === 'backward') {
      current = index.items.find((item) => item.firstParagraphRange.start === offset) || null;
      sequence = current ? index.sequenceById(current.sequenceId) : null;
      const position = sequence?.items?.findIndex((item) => item.id === current?.id) ?? -1;
      previous = position > 0 ? sequence.items[position - 1] : null;
    } else {
      previous = index.items.find((item) => (
        item.paragraphs.at(-1)?.contentRange.end === offset
          && item.childSequenceIds.length === 0
      )) || null;
      sequence = previous ? index.sequenceById(previous.sequenceId) : null;
      const position = sequence?.items?.findIndex((item) => item.id === previous?.id) ?? -1;
      current = position >= 0 && position < sequence.items.length - 1
        ? sequence.items[position + 1]
        : null;
    }
    if (!sequence || !previous || !current
      || previous.childSequenceIds.length > 0
      || previous.subtreeRange.end !== current.subtreeRange.start
      || previous.sequenceId !== current.sequenceId) return null;
    return Object.freeze({ sequence, previous, current });
  }

  function applyHnSequenceListDeletion(
    snapshot,
    selectionInput = {},
    directionInput = 'backward',
    options = {}
  ) {
    const dependencies = dependenciesFor(snapshot, options);
    const selection = normalizedSelection(selectionInput, dependencies.source.length);
    const direction = deletionDirection(directionInput, options);
    if (!direction) return null;
    const context = listJoinContext(dependencies.index, selection, direction);
    if (!context) return null;
    const { sequence, previous, current } = context;
    const previousParagraph = previous.paragraphs.at(-1);
    const edits = [];
    const primary = addEdit(
      edits,
      previousParagraph.contentRange.end,
      current.firstParagraphRange.start,
      '',
      'hn-list-item-boundary-join'
    );
    addContinuationPaddingEdits(edits, current, previous.textColumnWidth);
    addDependentDottedChildEdits(
      edits,
      current,
      current.path,
      previous.path,
      dependencies
    );
    sourceSequenceAfterRemovalEdits(edits, sequence, current, dependencies);
    const caret = finalEditStart(primary, edits);
    return resultForEdits(
      dependencies,
      edits,
      selection,
      Object.freeze({
        anchor: Object.freeze({ offset: caret, affinity: AFTER }),
        focus: Object.freeze({ offset: caret, affinity: AFTER })
      }),
      direction === 'backward'
        ? 'hn-sequence-list-backspace-join'
        : 'hn-sequence-list-delete-join',
      direction === 'backward' ? 'deleteContentBackward' : 'deleteContentForward'
    );
  }

  return Object.freeze({
    applyHnSequenceListNewline,
    applyHnSequenceListIndentation,
    applyHnSequenceListDeletion
  });
}));
