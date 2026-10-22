(function universalMarkdownEditableProjection(root, factory) {
  const defaultFoundation = root?.markdownEditableFoundation
    || (typeof module === 'object' && module.exports
      ? require('../markdownEditableFoundation')
      : null);
  const api = factory(defaultFoundation);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.markdownEditableProjection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildMarkdownEditableProjection(
  defaultFoundation
) {
  'use strict';

  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;
  const VALID_MODES = new Set(['source', 'live-preview']);
  const EMPTY_ARRAY = Object.freeze([]);

  function clamp(value, lower, upper) {
    return Math.min(upper, Math.max(lower, Number.isFinite(value) ? value : lower));
  }

  function normalizeSnapshot(snapshot) {
    const physicalLineIndex = snapshot?.physicalLineIndex;
    const rawLines = physicalLineIndex?.lines;
    if (!snapshot || typeof snapshot.markdownBody !== 'string'
      || !physicalLineIndex || !Array.isArray(rawLines)) {
      throw new TypeError(
        'Editable projection requires a SourceSnapshot with one PhysicalLineIndex; it does not scan source.'
      );
    }

    const markdownBody = snapshot.markdownBody;
    const version = snapshot.version;
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new TypeError('Editable projection requires the canonical SourceSnapshot version.');
    }
    const lines = rawLines.map((rawLine, index) => {
      const raw = rawLine || null;
      if (!raw || String(raw.id || '') === ''
        || raw.index !== index
        || !Number.isSafeInteger(raw.start)
        || !Number.isSafeInteger(raw.contentEnd)
        || !Number.isSafeInteger(raw.sourceEnd)
        || typeof raw.text !== 'string'
        || typeof raw.lineEnding !== 'string'
        || raw.contentEnd !== raw.start + raw.text.length
        || raw.sourceEnd !== raw.contentEnd + raw.lineEnding.length
        || markdownBody.slice(raw.start, raw.contentEnd) !== raw.text
        || markdownBody.slice(raw.contentEnd, raw.sourceEnd) !== raw.lineEnding) {
        throw new TypeError(`PhysicalLineIndex line ${index} is not one exact canonical row.`);
      }
      return Object.freeze({
        id: String(raw.id),
        index,
        start: raw.start,
        contentEnd: raw.contentEnd,
        sourceEnd: raw.sourceEnd,
        text: raw.text,
        lineEnding: raw.lineEnding,
        semanticOwnerId: raw.semanticOwnerId
          ?? snapshot.semanticIndex?.ownerAtOffset?.(raw.start)?.id
          ?? null,
        raw
      });
    });

    return Object.freeze({ snapshot, physicalLineIndex, markdownBody, version, lines });
  }

  function normalizePresentationPlan(plan, normalized, mode) {
    if (plan == null) {
      throw new TypeError('Editable projection requires one immutable presentationPlan.');
    }
    if (!plan || typeof plan !== 'object' || !Object.isFrozen(plan)) {
      throw new TypeError('Editable projection presentationPlan must be immutable.');
    }
    if (plan.sourceVersion !== undefined && plan.sourceVersion !== normalized.version) {
      throw new TypeError('Editable projection presentationPlan sourceVersion does not match SourceSnapshot.');
    }
    if (plan.markdownBody !== undefined && plan.markdownBody !== normalized.markdownBody) {
      throw new TypeError('Editable projection presentationPlan does not own the canonical markdownBody.');
    }
    if (plan.mode !== undefined && plan.mode !== mode) {
      throw new TypeError('Editable projection presentationPlan mode does not match render mode.');
    }
    if (!Array.isArray(plan.lines) || !Object.isFrozen(plan.lines)) {
      throw new TypeError('Editable projection presentationPlan.lines must be an immutable array.');
    }

    const source = normalized.markdownBody;
    const sourceLinesById = new Map(normalized.lines.map((line) => [line.id, line]));
    const linesById = new Map();
    const leafIds = new Set();
    plan.lines.forEach((planLine, planIndex) => {
      if (!planLine || typeof planLine !== 'object' || !Object.isFrozen(planLine)) {
        throw new TypeError(`Editable projection presentationPlan line ${planIndex} must be immutable.`);
      }
      const lineId = String(planLine.physicalLineId ?? planLine.lineId ?? '');
      const line = sourceLinesById.get(lineId);
      if (!line || linesById.has(lineId)) {
        throw new TypeError(`Editable projection presentationPlan has an unknown or duplicate row ${lineId}.`);
      }
      if (Number(planLine.index) !== line.index
        || Number(planLine.start) !== line.start
        || Number(planLine.contentEnd) !== line.contentEnd
        || Number(planLine.sourceEnd) !== line.sourceEnd
        || String(planLine.lineEnding || '') !== line.lineEnding
        || String(planLine.text || '') !== line.text) {
        throw new TypeError(`Editable projection presentationPlan row ${lineId} is not the exact physical row.`);
      }
      if (!Array.isArray(planLine.leaves) || !Object.isFrozen(planLine.leaves)
        || planLine.leaves.length === 0) {
        throw new TypeError(`Editable projection presentationPlan row ${lineId} needs immutable leaves.`);
      }
      const anchors = planLine.anchors ?? EMPTY_ARRAY;
      if (!Array.isArray(anchors) || !Object.isFrozen(anchors)) {
        throw new TypeError(`Editable projection presentationPlan row ${lineId} anchors must be immutable.`);
      }

      let cursor = line.start;
      planLine.leaves.forEach((leaf, leafIndex) => {
        if (!leaf || typeof leaf !== 'object' || !Object.isFrozen(leaf)) {
          throw new TypeError(
            `Editable projection presentationPlan leaf ${lineId}:${leafIndex} must be immutable.`
          );
        }
        const leafId = String(leaf.leafId || '');
        const start = Number(leaf.sourceStart);
        const end = Number(leaf.sourceEnd);
        if (!leafId || leafIds.has(leafId)) {
          throw new TypeError(`Editable projection presentationPlan has a missing or duplicate leafId ${leafId}.`);
        }
        if (String(leaf.physicalLineId ?? lineId) !== lineId
          || !Number.isInteger(start) || !Number.isInteger(end)
          || start !== cursor || end < start || end > line.contentEnd
          || (line.start !== line.contentEnd && end === start)
          || String(leaf.text ?? '') !== source.slice(start, end)) {
          throw new TypeError(`Editable projection presentationPlan leaf ${leafId} is not an exact canonical slice.`);
        }
        leafIds.add(leafId);
        cursor = end;
      });
      if (cursor !== line.contentEnd
        || (line.start === line.contentEnd && planLine.leaves.length !== 1)) {
        throw new TypeError(`Editable projection presentationPlan leaves do not exactly cover row ${lineId}.`);
      }
      anchors.forEach((anchor, anchorIndex) => {
        if (!anchor || typeof anchor !== 'object' || !Object.isFrozen(anchor)
          || !anchor.position || !Object.isFrozen(anchor.position)) {
          throw new TypeError(
            `Editable projection presentationPlan anchor ${lineId}:${anchorIndex} must own an immutable position.`
          );
        }
      });
      linesById.set(lineId, Object.freeze({ line, planLine, leaves: planLine.leaves, anchors }));
    });
    if (linesById.size !== normalized.lines.length) {
      throw new TypeError('Editable projection presentationPlan must cover every physical row exactly once.');
    }
    return Object.freeze({ plan, linesById });
  }

  function positionKey(position) {
    if (!position) return '';
    return [
      String(position.sourceVersion ?? ''),
      String(position.physicalLineId ?? ''),
      String(position.offset ?? ''),
      String(position.affinity ?? '')
    ].join('|');
  }

  function samePosition(left, right) {
    return Boolean(left && right)
      && left.sourceVersion === right.sourceVersion
      && left.offset === right.offset
      && left.affinity === right.affinity
      && String(left.physicalLineId) === String(right.physicalLineId);
  }

  function contains(root, node) {
    if (!root || !node) return false;
    if (root === node) return true;
    if (typeof root.contains === 'function') return root.contains(node);
    let current = node;
    while (current) {
      if (current === root) return true;
      current = current.parentNode || current.parentElement || null;
    }
    return false;
  }

  function childArray(node) {
    return Array.from(node?.childNodes || []);
  }

  function setData(element, name, value) {
    if (element?.dataset) element.dataset[name] = String(value);
    else element?.setAttribute?.(
      `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      String(value)
    );
  }

  function deleteData(element, name) {
    if (element?.dataset) delete element.dataset[name];
    element?.removeAttribute?.(
      `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
    );
  }

  function addClass(element, ...names) {
    if (element?.classList?.add) element.classList.add(...names);
    else if (element) element.className = names.join(' ');
  }

  function normalizeExactRevisionEdits(edits, sourceLength) {
    if (!Array.isArray(edits) || edits.length === 0) return null;
    const normalized = [];
    for (const edit of edits) {
      if (!edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end)
        || edit.start < 0 || edit.end < edit.start || edit.end > sourceLength
        || typeof edit.replacement !== 'string') return null;
      normalized.push(Object.freeze({
        start: edit.start,
        end: edit.end,
        replacement: edit.replacement
      }));
    }
    normalized.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < normalized.length; index += 1) {
      const previous = normalized[index - 1];
      const current = normalized[index];
      if (current.start < previous.end
        || current.start === previous.start
        || current.start === previous.end && previous.start === previous.end) return null;
    }
    return Object.freeze(normalized);
  }

  function sourceAfterExactEdits(source, edits) {
    let next = source;
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      const edit = edits[index];
      next = `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`;
    }
    return next;
  }

  function offsetAfterExactEdits(requestedOffset, edits, affinity = 'after') {
    const offset = Number(requestedOffset);
    if (!Number.isInteger(offset)) return null;
    let delta = 0;
    for (const edit of edits) {
      if (offset < edit.start || offset === edit.start && affinity === 'before') break;
      if (offset > edit.end || offset === edit.end && affinity === 'after') {
        delta += edit.replacement.length - (edit.end - edit.start);
      } else {
        return edit.start + delta + (affinity === 'before' ? 0 : edit.replacement.length);
      }
    }
    return offset + delta;
  }

  function sameSemanticRoleShape(leftRoles, rightRoles) {
    const left = Array.isArray(leftRoles) ? leftRoles : EMPTY_ARRAY;
    const right = Array.isArray(rightRoles) ? rightRoles : EMPTY_ARRAY;
    if (left.length !== right.length) return false;
    return left.every((role, index) => {
      const candidate = right[index];
      return Boolean(role && candidate)
        && String(role.family ?? '') === String(candidate.family ?? '')
        && String(role.role ?? '') === String(candidate.role ?? '')
        && String(role.tagName ?? '') === String(candidate.tagName ?? '')
        && String(role.depth ?? '') === String(candidate.depth ?? '')
        && Boolean(role.active) === Boolean(candidate.active)
        && Boolean(role.sourceVisible) === Boolean(candidate.sourceVisible)
        && Boolean(role.renderedMounted) === Boolean(candidate.renderedMounted);
    });
  }

  function sameLeafTopology(left, right) {
    return Boolean(left && right)
      && String(left.kind || 'source') === String(right.kind || 'source')
      && String(left.visibility || 'visible') === String(right.visibility || 'visible')
      && String(left.interactionPolicy || 'editable-text')
        === String(right.interactionPolicy || 'editable-text')
      && sameSemanticRoleShape(left.semanticRoles, right.semanticRoles);
  }

  function canonicalPositionFromIndexes(
    position,
    normalized,
    linesById,
    positionsByLine,
    positions
  ) {
    if (!position || !normalized) return null;
    const version = position.sourceVersion ?? normalized.version;
    if (version !== normalized.version) return null;
    if (position.physicalLineId !== undefined && position.physicalLineId !== null) {
      const line = linesById.get(String(position.physicalLineId));
      if (!line) return null;
      const column = Number.isInteger(position.logicalColumn)
        ? position.logicalColumn
        : Number.isInteger(position.offset)
          ? position.offset - line.start
          : null;
      if (!Number.isInteger(column) || column < 0 || column > line.text.length) return null;
      const candidate = positionsByLine.get(line.id)?.[column] || null;
      if (!candidate) return null;
      if (Number.isInteger(position.offset) && position.offset !== candidate.offset) return null;
      if (position.affinity && position.affinity !== candidate.affinity) return null;
      return candidate;
    }
    if (!Number.isInteger(position.offset)) return null;
    const candidates = positions.filter((candidate) => candidate.offset === position.offset);
    return (position.affinity
      ? candidates.find((candidate) => candidate.affinity === position.affinity)
      : candidates[0]) || null;
  }

  function positiveRect(rect) {
    return Boolean(rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) && rect.height > 0);
  }

  function normalizedRect(rect, x = rect?.left) {
    if (!rect) return null;
    const left = Number.isFinite(x) ? x : rect.left;
    return Object.freeze({
      left,
      right: left,
      top: rect.top,
      bottom: rect.bottom,
      width: 0,
      height: rect.height,
      x: left,
      y: rect.top
    });
  }

  class EditableProjection {
    constructor(options = {}) {
      if (!options.root) throw new TypeError('Editable projection requires a root element.');
      this.root = options.root;
      this.document = options.document
        || this.root.ownerDocument
        || (typeof document !== 'undefined' ? document : null);
      this.foundation = options.foundation || defaultFoundation || null;
      if (!this.foundation?.createEditableLinePosition) {
        throw new TypeError('Editable projection requires the canonical Markdown editable foundation.');
      }
      this.mode = VALID_MODES.has(options.mode) ? options.mode : 'source';
      this._normalized = null;
      this._presentationPlan = null;
      this._planLinesById = new Map();
      this._rows = [];
      this._rowsById = new Map();
      this._linesById = new Map();
      this._textRecords = new WeakMap();
      this._rowRecords = new WeakMap();
      this._leafElementRecords = new WeakMap();
      this._leafRecordsByLine = new Map();
      this._projectedLeaves = [];
      this._positionLeafByKey = new Map();
      this._activationAnchors = new WeakMap();
      this._activationAnchorRecords = new Map();
      this._restorationAnchorsByPositionKey = new Map();
      this._planActivationAnchors = [];
      this._planActivationAnchorsById = new Map();
      this._planActivationAnchorsBySource = new WeakMap();
      this._positions = [];
      this._positionsByLine = new Map();
      this._positionByKey = new Map();
      this._positionOrder = new Map();
    }

    render(snapshotInput, options = {}) {
      const mode = options.mode || this.mode;
      if (!VALID_MODES.has(mode)) {
        throw new TypeError(`Editable projection cannot render non-editable mode: ${String(mode)}`);
      }
      const normalized = normalizeSnapshot(snapshotInput);
      const normalizedPlan = normalizePresentationPlan(options.presentationPlan, normalized, mode);
      const previousRows = this._rowsById;
      const nextRowsById = new Map();
      const nextRows = [];

      this.mode = mode;
      this._normalized = normalized;
      this._presentationPlan = normalizedPlan.plan;
      this._planLinesById = normalizedPlan.linesById;
      this._rows = [];
      this._rowsById = nextRowsById;
      this._linesById = new Map(normalized.lines.map((line) => [line.id, line]));
      this._textRecords = new WeakMap();
      this._rowRecords = new WeakMap();
      this._leafElementRecords = new WeakMap();
      this._leafRecordsByLine = new Map();
      this._projectedLeaves = [];
      this._positionLeafByKey = new Map();
      this._activationAnchors = new WeakMap();
      this._activationAnchorRecords = new Map();
      this._restorationAnchorsByPositionKey = new Map();
      this._planActivationAnchors = [];
      this._planActivationAnchorsById = new Map();
      this._planActivationAnchorsBySource = new WeakMap();
      this._positions = [];
      this._positionsByLine = new Map();
      this._positionByKey = new Map();
      this._positionOrder = new Map();

      normalized.lines.forEach((line) => {
        const row = previousRows.get(line.id) || this.document.createElement('div');
        row.replaceChildren?.();
        addClass(row, 'markdown-editable-physical-row');
        setData(row, 'markdownEditableRow', 'true');
        setData(row, 'physicalLineId', line.id);
        setData(row, 'physicalLineIndex', line.index);
        setData(row, 'sourceStart', line.start);
        setData(row, 'sourceContentEnd', line.contentEnd);
        setData(row, 'sourceEnd', line.sourceEnd);
        setData(row, 'lineEnding', line.lineEnding === '\r\n' ? 'crlf' : line.lineEnding === '\n' ? 'lf' : 'none');
        setData(row, 'editableMode', mode);
        row.setAttribute?.('role', 'presentation');
        row.style.display = 'block';
        row.style.position = 'relative';
        row.style.minHeight = '1em';
        row.style.lineHeight = 'inherit';
        row.style.whiteSpace = 'pre-wrap';
        row.style.overflowWrap = 'anywhere';
        row.style.tabSize = '4';

        const planLine = this._planLinesById.get(line.id);
        const leafRecords = [];
        if (line.text.length > 0) {
          planLine.leaves.forEach((leaf) => {
            const leafElement = this.document.createElement('span');
            addClass(leafElement, 'markdown-editable-projected-leaf');
            setData(leafElement, 'markdownProjectedLeaf', 'true');
            setData(leafElement, 'leafId', leaf.leafId);
            setData(leafElement, 'physicalLineId', line.id);
            setData(leafElement, 'sourceStart', leaf.sourceStart);
            setData(leafElement, 'sourceEnd', leaf.sourceEnd);
            setData(leafElement, 'presentationRole', leaf.kind || 'source');
            setData(leafElement, 'visibility', leaf.visibility || 'visible');
            setData(
              leafElement,
              'interactionPolicy',
              leaf.interactionPolicy || 'editable-text'
            );
            if (leaf.semanticOwnerId != null) {
              setData(leafElement, 'semanticOwnerId', leaf.semanticOwnerId);
            }
            const textNode = this.document.createTextNode(leaf.text);
            leafElement.append(textNode);
            row.append(leafElement);
            const record = Object.freeze({
              line,
              planLine: planLine.planLine,
              leaf,
              leafId: leaf.leafId,
              sourceStart: leaf.sourceStart,
              sourceEnd: leaf.sourceEnd,
              textNode,
              element: leafElement,
              emptyCaretHost: false
            });
            this._textRecords.set(textNode, record);
            this._leafElementRecords.set(leafElement, record);
            leafRecords.push(record);
            this._projectedLeaves.push(record);
          });
        } else {
          const host = this.document.createElement('span');
          addClass(host, 'markdown-editable-empty-caret-host');
          setData(host, 'markdownEmptyCaretHost', 'true');
          host.setAttribute?.('aria-hidden', 'true');
          host.style.display = 'inline-block';
          host.style.minWidth = '1px';
          host.style.height = '1em';
          host.style.lineHeight = 'inherit';
          host.style.verticalAlign = 'text-bottom';
          const caretText = this.document.createTextNode('\u200b');
          host.append(caretText);
          row.append(host);
          const emptyLeaf = planLine.leaves[0];
          addClass(host, 'markdown-editable-projected-leaf');
          setData(host, 'markdownProjectedLeaf', 'true');
          setData(host, 'leafId', emptyLeaf.leafId);
          setData(host, 'physicalLineId', line.id);
          setData(host, 'sourceStart', emptyLeaf.sourceStart);
          setData(host, 'sourceEnd', emptyLeaf.sourceEnd);
          setData(host, 'presentationRole', emptyLeaf.kind || 'empty-row');
          setData(host, 'visibility', emptyLeaf.visibility || 'visible');
          setData(host, 'interactionPolicy', emptyLeaf.interactionPolicy || 'editable-empty-row');
          if (emptyLeaf.semanticOwnerId != null) {
            setData(host, 'semanticOwnerId', emptyLeaf.semanticOwnerId);
          }
          const record = {
            line,
            textNode: caretText,
            sourceStart: line.start,
            sourceEnd: line.contentEnd,
            emptyCaretHost: true
          };
          Object.assign(record, {
            planLine: planLine.planLine,
            leaf: emptyLeaf,
            leafId: emptyLeaf.leafId,
            element: host
          });
          Object.freeze(record);
          this._textRecords.set(caretText, record);
          this._rowRecords.set(host, { line, row });
          this._leafElementRecords.set(host, record);
          leafRecords.push(record);
          this._projectedLeaves.push(record);
        }
        this._leafRecordsByLine.set(line.id, leafRecords);

        const linePositions = Array.from(
          { length: line.text.length + 1 },
          (_unused, logicalColumn) => {
            const position = this.foundation?.createEditableLinePosition?.(
              normalized.snapshot,
              line.id,
              logicalColumn
            );
            if (!position) {
              throw new TypeError(
                'Editable projection requires the canonical createEditableLinePosition API.'
              );
            }
            const leafRecord = this._leafRecordAtPosition(line, position, leafRecords);
            if (!leafRecord) {
              throw new TypeError(`Editable projection cannot assign row position to a plan leaf: ${line.id}.`);
            }
            return Object.freeze({
              ...position,
              semanticOwnerId: leafRecord.leaf.semanticOwnerId ?? position.semanticOwnerId,
              leafId: leafRecord.leafId,
              visibility: leafRecord.leaf.visibility || position.visibility,
              interactionPolicy: leafRecord.leaf.interactionPolicy || position.interactionPolicy
            });
          }
        );
        this._positionsByLine.set(line.id, linePositions);
        linePositions.forEach((position) => {
          const leafRecord = this._leafRecordAtPosition(line, position, leafRecords);
          this._positionLeafByKey.set(positionKey(position), leafRecord);
          this._positionOrder.set(positionKey(position), this._positions.length);
          this._positionByKey.set(positionKey(position), position);
          this._positions.push(position);
        });
        this._rowRecords.set(row, { line, row });
        nextRowsById.set(line.id, row);
        nextRows.push(row);
      });

      this._indexPlanActivationAnchors();

      this.root.replaceChildren(...nextRows);
      this._rows = nextRows;
      setData(this.root, 'markdownEditableProjection', 'true');
      setData(this.root, 'editableMode', mode);
      setData(this.root, 'sourceVersion', normalized.version);
      setData(this.root, 'presentationPlan', 'true');
      return this.snapshot();
    }

    reconcileExactSourceRevision(snapshotInput, options = {}) {
      if (!this._normalized || !this._presentationPlan) return false;
      const mode = options.mode || this.mode;
      if (!VALID_MODES.has(mode) || mode !== this.mode) return false;

      let normalized;
      let normalizedPlan;
      try {
        normalized = normalizeSnapshot(snapshotInput);
        normalizedPlan = normalizePresentationPlan(options.presentationPlan, normalized, mode);
      } catch (_error) {
        return false;
      }

      const previousNormalized = this._normalized;
      if (normalized.version !== previousNormalized.version + 1) return false;
      const edits = normalizeExactRevisionEdits(
        options.edits,
        previousNormalized.markdownBody.length
      );
      if (!edits
        || sourceAfterExactEdits(previousNormalized.markdownBody, edits)
          !== normalized.markdownBody
        || previousNormalized.markdownBody === normalized.markdownBody) return false;

      const affectedPhysicalLineIds = new Set(
        options.affectedPhysicalLineIds instanceof Set
          ? options.affectedPhysicalLineIds
          : Array.isArray(options.affectedPhysicalLineIds)
            ? options.affectedPhysicalLineIds
            : EMPTY_ARRAY
      );
      if (affectedPhysicalLineIds.size === 0) return false;
      if (previousNormalized.lines.length !== normalized.lines.length) return false;

      const previousLinesById = new Map(
        previousNormalized.lines.map((line) => [line.id, line])
      );
      for (const lineIdInput of affectedPhysicalLineIds) {
        if (!previousLinesById.has(String(lineIdInput))) return false;
      }
      const affectedIds = new Set(
        Array.from(affectedPhysicalLineIds, (lineId) => String(lineId))
      );
      for (const edit of edits) {
        if (/\r|\n/.test(edit.replacement)) return false;
        const line = previousNormalized.lines.find((candidate) => (
          candidate.start <= edit.start
            && edit.start <= candidate.contentEnd
            && candidate.start <= edit.end
            && edit.end <= candidate.contentEnd
        ));
        if (!line || !affectedIds.has(line.id)) return false;
      }

      const nextRows = [];
      const nextRowsById = new Map();
      const nextLinesById = new Map();
      const nextTextRecords = new WeakMap();
      const nextRowRecords = new WeakMap();
      const nextLeafElementRecords = new WeakMap();
      const nextLeafRecordsByLine = new Map();
      const nextProjectedLeaves = [];
      const leafCommits = [];
      const rowCommits = [];
      const topologyRemovals = new Set();
      const topologyPlacements = [];
      const discardedActivationAnchorElements = new Set();
      const createdLeafElements = new Set();
      let topologyReconciledPhysicalLineId = null;
      let reusedLeafCount = 0;
      let createdLeafCount = 0;
      let removedLeafCount = 0;

      for (let index = 0; index < normalized.lines.length; index += 1) {
        const previousLine = previousNormalized.lines[index];
        const line = normalized.lines[index];
        if (line.id !== previousLine.id
          || line.index !== previousLine.index
          || line.lineEnding !== previousLine.lineEnding) return false;
        if (line.text !== previousLine.text && !affectedIds.has(line.id)) return false;

        const row = this._rowsById.get(line.id) || null;
        if (!row || this._rows[index] !== row || !contains(this.root, row)) return false;
        const previousPlanLine = this._planLinesById.get(line.id);
        const nextPlanLine = normalizedPlan.linesById.get(line.id);
        const previousLeafRecords = this._leafRecordsByLine.get(line.id) || EMPTY_ARRAY;
        if (!previousPlanLine || !nextPlanLine
          || (previousLine.text.length === 0) !== (line.text.length === 0)) return false;

        const topologyMatches = previousLeafRecords.length === nextPlanLine.leaves.length
          && nextPlanLine.leaves.every((leaf, leafIndex) => (
            sameLeafTopology(previousLeafRecords[leafIndex]?.leaf, leaf)
          ));
        let topologyTransition = null;
        let planAnchorDelta = null;
        if (!topologyMatches) {
          if (topologyReconciledPhysicalLineId != null
            || !affectedIds.has(line.id)
            || previousLine.text.length === 0
            || line.text.length === 0
            || typeof options.leafTopologyReconciler !== 'function') return false;
          const allowedKinds = new Set(['table-cell', 'table-structural-source']);
          if (previousLeafRecords.some((record) => !allowedKinds.has(record.leaf.kind))
            || nextPlanLine.leaves.some((leaf) => !allowedKinds.has(leaf.kind))) return false;
          const previousCellCount = previousLeafRecords.filter((record) => (
            record.leaf.kind === 'table-cell'
          )).length;
          const nextCellCount = nextPlanLine.leaves.filter((leaf) => leaf.kind === 'table-cell').length;
          if (Math.abs(nextCellCount - previousCellCount) !== 1) return false;
          topologyTransition = nextCellCount > previousCellCount
            ? 'empty-to-nonempty'
            : 'nonempty-to-empty';
        }

        if (topologyMatches) {
          if (previousPlanLine.anchors.length !== nextPlanLine.anchors.length) return false;
          for (let anchorIndex = 0; anchorIndex < previousPlanLine.anchors.length; anchorIndex += 1) {
            const previousAnchor = previousPlanLine.anchors[anchorIndex];
            const nextAnchor = nextPlanLine.anchors[anchorIndex];
            const previousAnchorId = String(
              previousAnchor.anchorId
              ?? previousAnchor.id
              ?? `${line.id}:activation-anchor:${anchorIndex}:${previousAnchor.kind || 'semantic'}`
            );
            const nextAnchorId = String(
              nextAnchor.anchorId
              ?? nextAnchor.id
              ?? `${line.id}:activation-anchor:${anchorIndex}:${nextAnchor.kind || 'semantic'}`
            );
            if (previousAnchorId !== nextAnchorId
              || String(previousAnchor.kind || '') !== String(nextAnchor.kind || '')) return false;
          }
        } else {
          const previousAnchors = previousPlanLine.anchors;
          const nextAnchors = nextPlanLine.anchors;
          if (previousAnchors.some((anchor) => anchor.kind !== 'table-empty-cell')
            || nextAnchors.some((anchor) => anchor.kind !== 'table-empty-cell')) return false;
          const anchorKey = (anchor) => (
            Number.isInteger(anchor?.rowIndex) && Number.isInteger(anchor?.columnIndex)
              ? `${anchor.rowIndex}:${anchor.columnIndex}`
              : ''
          );
          const previousByKey = new Map(previousAnchors.map((anchor, anchorIndex) => (
            [anchorKey(anchor), { anchor, anchorIndex }]
          )));
          const nextByKey = new Map(nextAnchors.map((anchor, anchorIndex) => (
            [anchorKey(anchor), { anchor, anchorIndex }]
          )));
          if (previousByKey.has('') || nextByKey.has('')
            || previousByKey.size !== previousAnchors.length
            || nextByKey.size !== nextAnchors.length) return false;
          const removed = [...previousByKey.entries()].filter(([key]) => !nextByKey.has(key));
          const inserted = [...nextByKey.entries()].filter(([key]) => !previousByKey.has(key));
          const retainedKeysMatch = [...previousByKey.entries()].every(([key, previous]) => {
            const next = nextByKey.get(key);
            if (!next) return true;
            const mappedOffset = offsetAfterExactEdits(
              previous.anchor.position?.offset,
              edits,
              previous.anchor.position?.affinity
            );
            return Number.isInteger(mappedOffset)
              && String(previous.anchor.position?.physicalLineId || '') === line.id
              && String(next.anchor.position?.physicalLineId || '') === line.id
              && next.anchor.position?.offset === mappedOffset
              && next.anchor.position?.affinity === previous.anchor.position?.affinity;
          });
          if (!retainedKeysMatch
            || (topologyTransition === 'empty-to-nonempty'
              && (removed.length !== 1 || inserted.length !== 0))
            || (topologyTransition === 'nonempty-to-empty'
              && (inserted.length !== 1 || removed.length !== 0))) return false;
          const [changeKind, entry] = removed.length
            ? ['removed', removed[0][1]]
            : ['inserted', inserted[0][1]];
          planAnchorDelta = Object.freeze({
            changeKind,
            anchor: entry.anchor,
            previousIndex: changeKind === 'removed' ? entry.anchorIndex : null,
            nextIndex: changeKind === 'inserted' ? entry.anchorIndex : null
          });
        }

        const nextLeafRecords = [];
        let topologyBindings = null;
        if (!topologyMatches) {
          let response;
          try {
            response = options.leafTopologyReconciler(Object.freeze({
              transition: topologyTransition,
              physicalLineId: line.id,
              previousLine,
              nextLine: line,
              previousLeafRecords: Object.freeze(previousLeafRecords.slice()),
              nextLeaves: nextPlanLine.leaves,
              previousAnchors: previousPlanLine.anchors,
              nextAnchors: nextPlanLine.anchors,
              planAnchorDelta
            }));
          } catch (_error) {
            return false;
          }
          if (!response || response.transition !== topologyTransition
            || !Array.isArray(response.bindings)
            || response.bindings.length !== nextPlanLine.leaves.length) return false;

          const nextIndices = new Set();
          const previousIndices = new Set();
          topologyBindings = new Array(nextPlanLine.leaves.length);
          for (const binding of response.bindings) {
            const nextLeafIndex = binding?.nextLeafIndex;
            if (!Number.isInteger(nextLeafIndex)
              || nextLeafIndex < 0 || nextLeafIndex >= nextPlanLine.leaves.length
              || nextIndices.has(nextLeafIndex)) return false;
            nextIndices.add(nextLeafIndex);
            const nextLeaf = nextPlanLine.leaves[nextLeafIndex];
            if (Number.isInteger(binding.previousLeafIndex)) {
              const previousLeafIndex = binding.previousLeafIndex;
              const previousRecord = previousLeafRecords[previousLeafIndex];
              if (!previousRecord || previousIndices.has(previousLeafIndex)
                || binding.element != null || binding.textNode != null
                || !sameLeafTopology(previousRecord.leaf, nextLeaf)
                || !previousRecord.element || !previousRecord.textNode
                || !contains(this.root, previousRecord.element)
                || !contains(previousRecord.element, previousRecord.textNode)) return false;
              previousIndices.add(previousLeafIndex);
              topologyBindings[nextLeafIndex] = {
                element: previousRecord.element,
                textNode: previousRecord.textNode,
                emptyCaretHost: false,
                reused: true
              };
              reusedLeafCount += 1;
            } else {
              const element = binding?.element;
              const textNode = binding?.textNode;
              if (!element || element.nodeType !== ELEMENT_NODE
                || !textNode || textNode.nodeType !== TEXT_NODE
                || element.parentNode || element.parentElement
                || !contains(element, textNode)
                || createdLeafElements.has(element)) return false;
              createdLeafElements.add(element);
              topologyBindings[nextLeafIndex] = {
                element,
                textNode,
                emptyCaretHost: false,
                reused: false
              };
              createdLeafCount += 1;
            }
          }

          const removePreviousLeafIndices = Array.isArray(response.removePreviousLeafIndices)
            ? response.removePreviousLeafIndices
            : EMPTY_ARRAY;
          const removalIndices = new Set();
          for (const previousLeafIndex of removePreviousLeafIndices) {
            const previousRecord = previousLeafRecords[previousLeafIndex];
            if (!Number.isInteger(previousLeafIndex) || !previousRecord
              || previousIndices.has(previousLeafIndex)
              || removalIndices.has(previousLeafIndex)
              || !previousRecord.element
              || !contains(this.root, previousRecord.element)) return false;
            removalIndices.add(previousLeafIndex);
            topologyRemovals.add(previousRecord.element);
            removedLeafCount += 1;
          }
          if (previousIndices.size + removalIndices.size !== previousLeafRecords.length) return false;

          const extraRemovals = Array.isArray(response.removeElements)
            ? response.removeElements
            : EMPTY_ARRAY;
          for (const element of extraRemovals) {
            if (!element || element === this.root || this._rows.includes(element)
              || !contains(this.root, element)) return false;
            topologyRemovals.add(element);
          }
          const discarded = Array.isArray(response.discardedActivationAnchorElements)
            ? response.discardedActivationAnchorElements
            : EMPTY_ARRAY;
          for (const element of discarded) {
            if (!this._activationAnchorRecords.has(element)
              || !topologyRemovals.has(element)) return false;
            discardedActivationAnchorElements.add(element);
          }
          for (const element of topologyRemovals) {
            if (this._activationAnchorRecords.has(element)
              && !discardedActivationAnchorElements.has(element)) return false;
          }

          const placements = Array.isArray(response.placements) ? response.placements : EMPTY_ARRAY;
          const placedElements = new Set();
          for (const placement of placements) {
            if (placement?.nextLeafIndex !== undefined
              && (!Number.isInteger(placement.nextLeafIndex)
                || placement.nextLeafIndex < 0
                || placement.nextLeafIndex >= topologyBindings.length)) return false;
            const binding = Number.isInteger(placement?.nextLeafIndex)
              ? topologyBindings[placement.nextLeafIndex]
              : null;
            const element = binding?.element || placement?.element || null;
            const parent = placement?.parent || null;
            const before = placement?.before || null;
            if (!element || !parent || parent.nodeType !== ELEMENT_NODE
              || !contains(this.root, parent)
              || topologyRemovals.has(parent)
              || topologyRemovals.has(element)
              || placedElements.has(element)
              || before && (before.parentNode !== parent || topologyRemovals.has(before))) return false;
            const knownLeaf = topologyBindings.some((candidate) => candidate?.element === element);
            if (!knownLeaf && (element.parentNode || element.parentElement)) return false;
            placedElements.add(element);
            topologyPlacements.push({ element, parent, before });
          }
          if ([...createdLeafElements].some((element) => !placedElements.has(element))) return false;
          topologyReconciledPhysicalLineId = line.id;
        }

        for (let leafIndex = 0; leafIndex < nextPlanLine.leaves.length; leafIndex += 1) {
          const leaf = nextPlanLine.leaves[leafIndex];
          const previousRecord = previousLeafRecords[leafIndex];
          const binding = topologyBindings?.[leafIndex] || (topologyMatches ? {
            element: previousRecord?.element,
            textNode: previousRecord?.textNode,
            emptyCaretHost: previousRecord?.emptyCaretHost,
            reused: true
          } : null);
          if (!binding || !binding.element || !binding.textNode
            || binding.reused && (!contains(this.root, binding.element)
              || !contains(binding.element, binding.textNode))
            || binding.emptyCaretHost !== (line.text.length === 0)) return false;
          if (topologyMatches) reusedLeafCount += 1;
          const record = Object.freeze({
            line,
            planLine: nextPlanLine.planLine,
            leaf,
            leafId: leaf.leafId,
            sourceStart: leaf.sourceStart,
            sourceEnd: leaf.sourceEnd,
            textNode: binding.textNode,
            element: binding.element,
            emptyCaretHost: binding.emptyCaretHost
          });
          nextTextRecords.set(record.textNode, record);
          nextLeafElementRecords.set(record.element, record);
          if (record.emptyCaretHost) nextRowRecords.set(record.element, { line, row });
          nextLeafRecords.push(record);
          nextProjectedLeaves.push(record);
          leafCommits.push(record);
        }
        nextLeafRecordsByLine.set(line.id, nextLeafRecords);
        nextRowRecords.set(row, { line, row });
        nextRows.push(row);
        nextRowsById.set(line.id, row);
        nextLinesById.set(line.id, line);
        rowCommits.push({ line, row });
      }

      const nextPositions = [];
      const nextPositionsByLine = new Map();
      const nextPositionByKey = new Map();
      const nextPositionOrder = new Map();
      const nextPositionLeafByKey = new Map();
      for (const line of normalized.lines) {
        const leafRecords = nextLeafRecordsByLine.get(line.id);
        const linePositions = [];
        for (let logicalColumn = 0; logicalColumn <= line.text.length; logicalColumn += 1) {
          const position = this.foundation?.createEditableLinePosition?.(
            normalized.snapshot,
            line.id,
            logicalColumn
          );
          if (!position) return false;
          const leafRecord = this._leafRecordAtPosition(line, position, leafRecords);
          if (!leafRecord) return false;
          const declared = Object.freeze({
            ...position,
            semanticOwnerId: leafRecord.leaf.semanticOwnerId ?? position.semanticOwnerId,
            leafId: leafRecord.leafId,
            visibility: leafRecord.leaf.visibility || position.visibility,
            interactionPolicy: leafRecord.leaf.interactionPolicy || position.interactionPolicy
          });
          const key = positionKey(declared);
          linePositions.push(declared);
          nextPositionLeafByKey.set(key, leafRecord);
          nextPositionOrder.set(key, nextPositions.length);
          nextPositionByKey.set(key, declared);
          nextPositions.push(declared);
        }
        nextPositionsByLine.set(line.id, linePositions);
      }

      const nextPlanActivationAnchors = [];
      const nextPlanActivationAnchorsById = new Map();
      const nextPlanActivationAnchorsBySource = new WeakMap();
      for (const [lineId, planLine] of normalizedPlan.linesById) {
        for (let anchorIndex = 0; anchorIndex < planLine.anchors.length; anchorIndex += 1) {
          const sourceAnchor = planLine.anchors[anchorIndex];
          const canonical = canonicalPositionFromIndexes(
            sourceAnchor.position,
            normalized,
            nextLinesById,
            nextPositionsByLine,
            nextPositions
          );
          if (!canonical || String(canonical.physicalLineId) !== lineId) return false;
          const anchorId = String(
            sourceAnchor.anchorId
            ?? sourceAnchor.id
            ?? `${lineId}:activation-anchor:${anchorIndex}:${sourceAnchor.kind || 'semantic'}`
          );
          if (nextPlanActivationAnchorsById.has(anchorId)) return false;
          const position = Object.freeze({
            ...canonical,
            semanticOwnerId: sourceAnchor.ownerId
              ?? sourceAnchor.semanticOwnerId
              ?? sourceAnchor.position.semanticOwnerId
              ?? canonical.semanticOwnerId,
            visibility: sourceAnchor.position.visibility || 'activatable',
            interactionPolicy: sourceAnchor.position.interactionPolicy || 'activate-owner'
          });
          const descriptor = Object.freeze({
            ...sourceAnchor,
            anchorId,
            physicalLineId: lineId,
            semanticOnly: true,
            contentEditable: false,
            position,
            sourceAnchor
          });
          nextPlanActivationAnchors.push(descriptor);
          nextPlanActivationAnchorsById.set(anchorId, descriptor);
          nextPlanActivationAnchorsBySource.set(sourceAnchor, descriptor);
        }
      }
      Object.freeze(nextPlanActivationAnchors);

      const nextActivationAnchors = new WeakMap();
      const nextActivationAnchorRecords = new Map();
      const nextRestorationAnchorsByPositionKey = new Map();
      for (const [element, record] of this._activationAnchorRecords) {
        if (discardedActivationAnchorElements.has(element)) continue;
        if (!element || !record?.position || !contains(this.root, element)) return false;
        const mappedOffset = offsetAfterExactEdits(
          record.position.offset,
          edits,
          record.position.affinity
        );
        if (!Number.isInteger(mappedOffset)) return false;
        const lineId = String(record.position.physicalLineId || '');
        const line = nextLinesById.get(lineId);
        let target = null;
        if (record.planAnchorId != null) {
          target = nextPlanActivationAnchorsById.get(String(record.planAnchorId))?.position || null;
          if (!target || target.offset !== mappedOffset || target.physicalLineId !== lineId) return false;
        } else {
          const logicalColumn = line ? mappedOffset - line.start : -1;
          target = Number.isInteger(logicalColumn) && logicalColumn >= 0
            ? nextPositionsByLine.get(lineId)?.[logicalColumn] || null
            : null;
          if (!target || target.offset !== mappedOffset) return false;
        }
        const anchor = Object.freeze({
          ...target,
          semanticOwnerId: target.semanticOwnerId ?? record.semanticOwnerId ?? null,
          visibility: record.position.visibility || target.visibility || 'activatable',
          interactionPolicy: record.position.interactionPolicy
            || target.interactionPolicy
            || 'activation-anchor'
        });
        const nextRecord = Object.freeze({
          ...record,
          semanticOwnerId: anchor.semanticOwnerId,
          position: anchor
        });
        nextActivationAnchors.set(element, anchor);
        nextActivationAnchorRecords.set(element, nextRecord);
        if (record.metadata?.restoreTarget === true) {
          nextRestorationAnchorsByPositionKey.set(positionKey(anchor), Object.freeze({
            element,
            domOffset: Number.isInteger(record.metadata.domOffset) ? record.metadata.domOffset : 0,
            record: nextRecord
          }));
        }
      }

      let textMutations = 0;
      for (const { line, row } of rowCommits) {
        setData(row, 'physicalLineId', line.id);
        setData(row, 'physicalLineIndex', line.index);
        setData(row, 'sourceStart', line.start);
        setData(row, 'sourceContentEnd', line.contentEnd);
        setData(row, 'sourceEnd', line.sourceEnd);
        setData(row, 'lineEnding', line.lineEnding === '\r\n' ? 'crlf' : line.lineEnding === '\n' ? 'lf' : 'none');
        setData(row, 'editableMode', mode);
      }
      for (const record of leafCommits) {
        const { element, leaf, line, textNode } = record;
        addClass(element, 'markdown-editable-projected-leaf');
        setData(element, 'markdownProjectedLeaf', 'true');
        setData(element, 'leafId', leaf.leafId);
        setData(element, 'physicalLineId', line.id);
        setData(element, 'sourceStart', leaf.sourceStart);
        setData(element, 'sourceEnd', leaf.sourceEnd);
        setData(element, 'presentationRole', leaf.kind || 'source');
        setData(element, 'visibility', leaf.visibility || 'visible');
        setData(element, 'interactionPolicy', leaf.interactionPolicy || 'editable-text');
        if (leaf.semanticOwnerId != null) setData(element, 'semanticOwnerId', leaf.semanticOwnerId);
        else deleteData(element, 'semanticOwnerId');
        const expectedText = record.emptyCaretHost ? '\u200b' : leaf.text;
        if (textNode.nodeValue !== expectedText) {
          textNode.nodeValue = expectedText;
          textMutations += 1;
        }
      }
      for (const element of discardedActivationAnchorElements) {
        deleteData(element, 'markdownActivationAnchor');
        deleteData(element, 'markdownSemanticOnly');
        deleteData(element, 'activationAnchorId');
      }
      for (const element of topologyRemovals) {
        if (typeof element.remove === 'function') element.remove();
        else if (typeof element.parentNode?.removeChild === 'function') {
          element.parentNode.removeChild(element);
        } else {
          const parent = element.parentNode;
          const index = parent?.childNodes ? Array.from(parent.childNodes).indexOf(element) : -1;
          if (index >= 0 && Array.isArray(parent.childNodes)) parent.childNodes.splice(index, 1);
          element.parentNode = null;
          element.parentElement = null;
        }
      }
      for (const { element, parent, before } of topologyPlacements) {
        if (before && typeof parent.insertBefore === 'function') parent.insertBefore(element, before);
        else if (before && typeof before.before === 'function') before.before(element);
        else parent.append(element);
      }

      this.mode = mode;
      this._normalized = normalized;
      this._presentationPlan = normalizedPlan.plan;
      this._planLinesById = normalizedPlan.linesById;
      this._rows = nextRows;
      this._rowsById = nextRowsById;
      this._linesById = nextLinesById;
      this._textRecords = nextTextRecords;
      this._rowRecords = nextRowRecords;
      this._leafElementRecords = nextLeafElementRecords;
      this._leafRecordsByLine = nextLeafRecordsByLine;
      this._projectedLeaves = nextProjectedLeaves;
      this._positionLeafByKey = nextPositionLeafByKey;
      this._activationAnchors = nextActivationAnchors;
      this._activationAnchorRecords = nextActivationAnchorRecords;
      this._restorationAnchorsByPositionKey = nextRestorationAnchorsByPositionKey;
      this._planActivationAnchors = nextPlanActivationAnchors;
      this._planActivationAnchorsById = nextPlanActivationAnchorsById;
      this._planActivationAnchorsBySource = nextPlanActivationAnchorsBySource;
      this._positions = nextPositions;
      this._positionsByLine = nextPositionsByLine;
      this._positionByKey = nextPositionByKey;
      this._positionOrder = nextPositionOrder;
      setData(this.root, 'editableMode', mode);
      setData(this.root, 'sourceVersion', normalized.version);
      setData(this.root, 'presentationPlan', 'true');

      return Object.freeze({
        reconciled: true,
        sourceVersion: normalized.version,
        rowsReused: nextRows.length,
        leavesReused: reusedLeafCount,
        leavesCreated: createdLeafCount,
        leavesRemoved: removedLeafCount,
        activationAnchorsDiscarded: discardedActivationAnchorElements.size,
        topologyReconciledPhysicalLineId,
        textMutations,
        affectedPhysicalLineIds: Object.freeze(Array.from(affectedIds))
      });
    }

    snapshot() {
      if (!this._normalized) return null;
      return Object.freeze({
        sourceVersion: this._normalized.version,
        markdownBody: this._normalized.markdownBody,
        physicalLineIndex: this._normalized.physicalLineIndex,
        lineCount: this._normalized.lines.length,
        mode: this.mode
      });
    }

    _leafRecordAtPosition(line, position, records = this._leafRecordsByLine.get(line?.id) || []) {
      if (!line || !position || !records.length) return null;
      if (line.start === line.contentEnd) return records[0] || null;
      const offset = position.offset;
      if (position.affinity === 'before') {
        return records.find((record) => (
          record.sourceStart < offset && offset <= record.sourceEnd
        )) || records.find((record) => record.sourceStart === offset) || records.at(-1) || null;
      }
      return records.find((record) => (
        record.sourceStart <= offset && offset < record.sourceEnd
      )) || records.find((record) => record.sourceEnd === offset) || records[0] || null;
    }

    _indexPlanActivationAnchors() {
      this._planLinesById.forEach((planLine, lineId) => {
        planLine.anchors.forEach((sourceAnchor, anchorIndex) => {
          const canonical = this._canonicalPosition(sourceAnchor.position);
          if (!canonical || String(canonical.physicalLineId) !== lineId) {
            throw new TypeError(
              `Editable projection presentationPlan anchor ${lineId}:${anchorIndex} is not a declared exact position.`
            );
          }
          const anchorId = String(
            sourceAnchor.anchorId
            ?? sourceAnchor.id
            ?? `${lineId}:activation-anchor:${anchorIndex}:${sourceAnchor.kind || 'semantic'}`
          );
          if (this._planActivationAnchorsById.has(anchorId)) {
            throw new TypeError(`Editable projection presentationPlan has duplicate anchorId ${anchorId}.`);
          }
          const position = Object.freeze({
            ...canonical,
            semanticOwnerId: sourceAnchor.ownerId
              ?? sourceAnchor.semanticOwnerId
              ?? sourceAnchor.position.semanticOwnerId
              ?? canonical.semanticOwnerId,
            visibility: sourceAnchor.position.visibility || 'activatable',
            interactionPolicy: sourceAnchor.position.interactionPolicy || 'activate-owner'
          });
          const descriptor = Object.freeze({
            ...sourceAnchor,
            anchorId,
            physicalLineId: lineId,
            semanticOnly: true,
            contentEditable: false,
            position,
            sourceAnchor
          });
          this._planActivationAnchors.push(descriptor);
          this._planActivationAnchorsById.set(anchorId, descriptor);
          this._planActivationAnchorsBySource.set(sourceAnchor, descriptor);
        });
      });
      Object.freeze(this._planActivationAnchors);
    }

    enumerateDeclaredPositions() {
      return Object.freeze(this._positions.slice());
    }

    enumerateProjectedLeaves() {
      return Object.freeze(this._projectedLeaves.map((record) => Object.freeze({
        leafId: record.leafId,
        physicalLineId: record.line.id,
        lineIndex: record.line.index,
        sourceStart: record.sourceStart,
        sourceEnd: record.sourceEnd,
        text: this._normalized.markdownBody.slice(record.sourceStart, record.sourceEnd),
        domText: record.textNode?.nodeValue ?? record.textNode?.textContent ?? '',
        emptyCaretHost: record.emptyCaretHost,
        semanticOwnerId: record.leaf.semanticOwnerId ?? null,
        kind: record.leaf.kind || 'source',
        visibility: record.leaf.visibility || 'visible',
        interactionPolicy: record.leaf.interactionPolicy || 'editable-text',
        element: record.element,
        textNode: record.textNode,
        planLeaf: record.leaf
      })));
    }

    enumeratePlanActivationAnchors() {
      return Object.freeze(this._planActivationAnchors.slice());
    }

    enumerateRegisteredActivationAnchors() {
      return Object.freeze(Array.from(this._activationAnchorRecords.values()));
    }

    enumeratePhysicalRows() {
      return Object.freeze(this._normalized?.lines.map((line) => Object.freeze({
        physicalLineId: line.id,
        index: line.index,
        start: line.start,
        contentEnd: line.contentEnd,
        sourceEnd: line.sourceEnd,
        text: line.text,
        lineEnding: line.lineEnding,
        element: this._rowsById.get(line.id) || null
      })) || []);
    }

    _canonicalPosition(position) {
      if (!position || !this._normalized) return null;
      const version = position.sourceVersion ?? this._normalized.version;
      if (version !== this._normalized.version) return null;
      if (position.physicalLineId !== undefined && position.physicalLineId !== null) {
        const line = this._linesById.get(String(position.physicalLineId));
        if (!line) return null;
        const column = Number.isInteger(position.logicalColumn)
          ? position.logicalColumn
          : Number.isInteger(position.offset)
            ? position.offset - line.start
            : null;
        if (!Number.isInteger(column) || column < 0 || column > line.text.length) return null;
        const candidate = this._positionsByLine.get(line.id)?.[column] || null;
        if (!candidate) return null;
        if (Number.isInteger(position.offset) && position.offset !== candidate.offset) return null;
        if (position.affinity && position.affinity !== candidate.affinity) return null;
        return candidate;
      }
      if (!Number.isInteger(position.offset)) return null;
      const candidates = this._positions.filter((candidate) => candidate.offset === position.offset);
      const match = position.affinity
        ? candidates.find((candidate) => candidate.affinity === position.affinity)
        : candidates[0];
      return match || null;
    }

    sourceToDom(position) {
      const canonical = this._canonicalPosition(position);
      if (!canonical) return null;
      const row = this._rowsById.get(canonical.physicalLineId);
      const line = this._linesById.get(canonical.physicalLineId);
      if (!row || !line) return null;
      const restorationAnchor = this._restorationAnchorsByPositionKey.get(
        positionKey(canonical)
      );
      if (restorationAnchor?.element && contains(this.root, restorationAnchor.element)) {
        const node = restorationAnchor.element.firstChild || restorationAnchor.element;
        return Object.freeze({
          node,
          offset: node.nodeType === TEXT_NODE
            ? clamp(restorationAnchor.domOffset, 0, String(node.nodeValue || '').length)
            : clamp(restorationAnchor.domOffset, 0, childArray(node).length),
          position: canonical,
          activationAnchor: restorationAnchor
        });
      }
      const leafRecord = this._positionLeafByKey.get(positionKey(canonical))
        || this._leafRecordAtPosition(line, canonical);
      if (!leafRecord) return null;
      if (leafRecord.emptyCaretHost) {
        const host = leafRecord.element || row.firstChild || childArray(row)[0] || row;
        return Object.freeze({
          node: leafRecord.textNode || host.firstChild || host,
          offset: 0,
          position: canonical,
          leafId: leafRecord.leafId
        });
      }
      return Object.freeze({
        node: leafRecord.textNode,
        offset: clamp(
          canonical.offset - leafRecord.sourceStart,
          0,
          leafRecord.sourceEnd - leafRecord.sourceStart
        ),
        position: canonical,
        leafId: leafRecord.leafId
      });
    }

    _linePosition(line, logicalColumn) {
      const positions = this._positionsByLine.get(line?.id);
      if (!positions) return null;
      return positions[clamp(logicalColumn, 0, positions.length - 1)] || null;
    }

    _activationRecord(node) {
      let current = node?.nodeType === TEXT_NODE ? node.parentNode : node;
      while (current && contains(this.root, current)) {
        const record = this._activationAnchorRecords.get(current);
        if (record) return Object.freeze({ element: current, record });
        current = current.parentNode || current.parentElement || null;
      }
      return null;
    }

    _activationPosition(node) {
      return this._activationRecord(node)?.record?.position || null;
    }

    _domTextOffsetWithin(root, node, offset) {
      if (!root || !node || !contains(root, node)) return null;
      const visit = (current) => {
        if (current === node) {
          if (current.nodeType === TEXT_NODE) {
            return clamp(offset, 0, String(current.nodeValue || '').length);
          }
          const children = childArray(current);
          const boundary = clamp(offset, 0, children.length);
          return children.slice(0, boundary).reduce((total, child) => (
            total + String(child?.textContent || '').length
          ), 0);
        }
        if (current?.nodeType === TEXT_NODE) return null;
        let preceding = 0;
        for (const child of childArray(current)) {
          if (child === node || contains(child, node)) {
            const nested = visit(child);
            return Number.isInteger(nested) ? preceding + nested : null;
          }
          preceding += String(child?.textContent || '').length;
        }
        return null;
      };
      return visit(root);
    }

    _exactMappedActivationPosition(node, offset) {
      const activation = this._activationRecord(node);
      if (!activation || !this._normalized) return null;
      const source = this._normalized.markdownBody;
      let current = node?.nodeType === TEXT_NODE ? node.parentNode : node;
      while (current && contains(activation.element, current)) {
        const start = Number(current.dataset?.markdownSourceStart);
        const end = Number(current.dataset?.markdownSourceEnd);
        if (Number.isSafeInteger(start) && Number.isSafeInteger(end)
          && 0 <= start && start <= end && end <= source.length
          && String(current.textContent || '') === source.slice(start, end)) {
          const textOffset = this._domTextOffsetWithin(current, node, offset);
          if (Number.isInteger(textOffset) && 0 <= textOffset && textOffset <= end - start) {
            const canonical = this._canonicalPosition({
              sourceVersion: activation.record.position.sourceVersion,
              physicalLineId: activation.record.position.physicalLineId,
              offset: start + textOffset
            });
            if (canonical) return canonical;
          }
        }
        if (current === activation.element) break;
        current = current.parentNode || current.parentElement || null;
      }
      return null;
    }

    _firstSourcePosition(node) {
      if (!node) return null;
      const textRecord = this._textRecords.get(node);
      if (textRecord) {
        return this._linePosition(
          textRecord.line,
          textRecord.sourceStart - textRecord.line.start
        );
      }
      const rowRecord = this._rowRecords.get(node);
      if (rowRecord) return this._linePosition(rowRecord.line, 0);
      for (const child of childArray(node)) {
        const result = this._firstSourcePosition(child);
        if (result) return result;
      }
      return null;
    }

    _lastSourcePosition(node) {
      if (!node) return null;
      const textRecord = this._textRecords.get(node);
      if (textRecord) {
        return this._linePosition(
          textRecord.line,
          textRecord.sourceEnd - textRecord.line.start
        );
      }
      const rowRecord = this._rowRecords.get(node);
      if (rowRecord) return this._linePosition(rowRecord.line, rowRecord.line.text.length);
      const children = childArray(node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const result = this._lastSourcePosition(children[index]);
        if (result) return result;
      }
      return null;
    }

    _domBoundaryPosition(node, offset) {
      const rowRecord = this._rowRecords.get(node);
      const children = childArray(node);
      if (!children.length) {
        if (!rowRecord) return null;
        return offset <= 0
          ? this._linePosition(rowRecord.line, 0)
          : this._linePosition(rowRecord.line, rowRecord.line.text.length);
      }
      const boundary = clamp(offset, 0, children.length);
      if (boundary > 0) {
        const previous = this._lastSourcePosition(children[boundary - 1]);
        if (previous) return previous;
      }
      if (boundary < children.length) {
        const next = this._firstSourcePosition(children[boundary]);
        if (next) return next;
      }
      return null;
    }

    domToSource(node, offset) {
      if (!node || !contains(this.root, node)) return null;
      const textRecord = this._textRecords.get(node);
      if (textRecord) {
        if (textRecord.emptyCaretHost) return this._linePosition(textRecord.line, 0);
        const sourceOffset = textRecord.sourceStart + clamp(
          offset,
          0,
          textRecord.sourceEnd - textRecord.sourceStart
        );
        const logicalColumn = sourceOffset - textRecord.line.start;
        return this._linePosition(textRecord.line, logicalColumn);
      }
      const activation = this._activationPosition(node);
      if (activation) return activation;
      if (node.nodeType === ELEMENT_NODE || childArray(node).length) {
        const boundary = this._domBoundaryPosition(node, offset);
        if (boundary) return boundary;
      }
      return null;
    }

    registerActivationAnchor(element, position, metadata = {}) {
      if (!element || !contains(this.root, element)) return null;
      const canonical = this._canonicalPosition(position);
      if (!canonical) return null;
      const anchor = Object.freeze({
        ...canonical,
        semanticOwnerId: metadata.semanticOwnerId ?? canonical.semanticOwnerId,
        visibility: metadata.visibility || 'activatable',
        interactionPolicy: metadata.interactionPolicy || 'activation-anchor'
      });
      this._activationAnchors.set(element, anchor);
      const record = Object.freeze({
        anchorId: metadata.anchorId ?? null,
        planAnchorId: metadata.planAnchorId ?? null,
        kind: metadata.kind || 'semantic-activation',
        semanticOnly: metadata.semanticOnly !== false,
        contentEditable: metadata.contentEditable === true,
        semanticOwnerId: anchor.semanticOwnerId,
        element,
        position: anchor,
        metadata: Object.freeze({ ...metadata })
      });
      this._activationAnchorRecords.set(element, record);
      if (metadata.restoreTarget === true) {
        this._restorationAnchorsByPositionKey.set(positionKey(anchor), Object.freeze({
          element,
          domOffset: Number.isInteger(metadata.domOffset) ? metadata.domOffset : 0,
          record
        }));
      }
      setData(element, 'markdownActivationAnchor', 'true');
      setData(element, 'markdownSemanticOnly', record.semanticOnly);
      if (record.anchorId != null) setData(element, 'activationAnchorId', record.anchorId);
      if (!record.contentEditable) element.setAttribute?.('contenteditable', 'false');
      return anchor;
    }

    registerPlanActivationAnchor(element, anchorReference, metadata = {}) {
      let descriptor = null;
      if (typeof anchorReference === 'string') {
        descriptor = this._planActivationAnchorsById.get(anchorReference) || null;
      } else if (anchorReference && typeof anchorReference === 'object') {
        descriptor = this._planActivationAnchorsBySource.get(anchorReference)
          || this._planActivationAnchorsById.get(String(
            anchorReference.anchorId ?? anchorReference.id ?? ''
          ))
          || (this._planActivationAnchors.includes(anchorReference) ? anchorReference : null);
      }
      if (!descriptor) return null;
      return this.registerActivationAnchor(element, descriptor.position, {
        ...metadata,
        anchorId: descriptor.anchorId,
        planAnchorId: descriptor.anchorId,
        kind: descriptor.kind || metadata.kind,
        semanticOwnerId: descriptor.position.semanticOwnerId,
        semanticOnly: true,
        contentEditable: false,
        visibility: descriptor.position.visibility,
        interactionPolicy: descriptor.position.interactionPolicy
      });
    }

    unregisterActivationAnchor(element) {
      const record = this._activationAnchorRecords.get(element) || null;
      this._activationAnchorRecords.delete(element);
      if (record) {
        const key = positionKey(record.position);
        if (this._restorationAnchorsByPositionKey.get(key)?.element === element) {
          this._restorationAnchorsByPositionKey.delete(key);
        }
      }
      deleteData(element, 'markdownActivationAnchor');
      deleteData(element, 'markdownSemanticOnly');
      deleteData(element, 'activationAnchorId');
      return this._activationAnchors.delete(element);
    }

    _rowFromNode(node) {
      let current = node?.nodeType === TEXT_NODE ? node.parentNode : node;
      while (current && contains(this.root, current)) {
        if (this._rowRecords.has(current)) return current;
        current = current.parentNode || current.parentElement || null;
      }
      return null;
    }

    _nativeCaretAtPoint(clientX, clientY) {
      if (!this.document || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      if (typeof this.document.caretPositionFromPoint === 'function') {
        const caret = this.document.caretPositionFromPoint(clientX, clientY);
        if (caret?.offsetNode) return { node: caret.offsetNode, offset: caret.offset };
      }
      if (typeof this.document.caretRangeFromPoint === 'function') {
        const range = this.document.caretRangeFromPoint(clientX, clientY);
        if (range?.startContainer) return { node: range.startContainer, offset: range.startOffset };
      }
      return null;
    }

    pointerToPosition(eventOrPoint) {
      const clientX = eventOrPoint?.clientX;
      const clientY = eventOrPoint?.clientY;
      const nativeCaret = this._nativeCaretAtPoint(clientX, clientY);
      if (nativeCaret && contains(this.root, nativeCaret.node)) {
        const mappedPresentation = this._exactMappedActivationPosition(
          nativeCaret.node,
          nativeCaret.offset
        );
        if (mappedPresentation) return mappedPresentation;
      }
      const targetActivation = this._activationPosition(eventOrPoint?.target);
      if (targetActivation) return targetActivation;
      if (nativeCaret && contains(this.root, nativeCaret.node)) {
        const exact = this.domToSource(nativeCaret.node, nativeCaret.offset);
        if (exact) return exact;
      }
      const activation = this._activationPosition(nativeCaret?.node);
      if (activation) return activation;
      return null;
    }

    claimPointer(event, options = {}) {
      const position = this.pointerToPosition(event);
      if (!position) return null;
      // This ordering is intentional: Chromium must not schedule a second native placement.
      event?.preventDefault?.();
      if (options.stopPropagation) event?.stopPropagation?.();
      if (options.place !== false) {
        let selection = { anchor: position, focus: position };
        if (event?.shiftKey) {
          const current = this.getSelection();
          if (current?.anchor) selection = { anchor: current.anchor, focus: position };
        }
        this.restoreSelection(selection, options.selection);
      }
      return position;
    }

    _createRange() {
      return this.document?.createRange?.() || null;
    }

    _collapsedRect(domPoint) {
      const range = this._createRange();
      if (!range || !domPoint) return null;
      try {
        range.setStart(domPoint.node, domPoint.offset);
        range.collapse(true);
        const rects = Array.from(range.getClientRects?.() || []);
        return rects.find(positiveRect) || (positiveRect(range.getBoundingClientRect?.())
          ? range.getBoundingClientRect()
          : null);
      } catch (_error) {
        return null;
      }
    }

    collapsedPositionRect(position) {
      const canonical = this._canonicalPosition(position);
      const domPoint = this.sourceToDom(canonical);
      if (!canonical || !domPoint) return null;
      const collapsed = this._collapsedRect(domPoint);
      return positiveRect(collapsed) ? normalizedRect(collapsed) : null;
    }

    positionRect(position) {
      const canonical = this._canonicalPosition(position);
      const domPoint = this.sourceToDom(canonical);
      if (!canonical || !domPoint) return null;
      const collapsed = this.collapsedPositionRect(canonical);
      if (positiveRect(collapsed)) return collapsed;

      const line = this._linesById.get(canonical.physicalLineId);
      const row = this._rowsById.get(canonical.physicalLineId);
      if (!line || !row) return null;
      if (line.text.length === 0) {
        const leafRecord = this._positionLeafByKey.get(positionKey(canonical));
        const hostRect = (leafRecord?.element || row.firstChild)?.getBoundingClientRect?.();
        if (positiveRect(hostRect)) return normalizedRect(hostRect, hostRect.left);
        const rowRect = row.getBoundingClientRect?.();
        return positiveRect(rowRect) ? normalizedRect(rowRect, rowRect.left) : null;
      }

      const textNode = domPoint.node;
      const textRecord = this._textRecords.get(textNode);
      if (!textRecord || textRecord.emptyCaretHost) return null;
      const textLength = textRecord.sourceEnd - textRecord.sourceStart;
      const characterIndex = domPoint.offset < textLength
        ? domPoint.offset
        : domPoint.offset - 1;
      const range = this._createRange();
      if (!range || characterIndex < 0) return null;
      try {
        range.setStart(textNode, characterIndex);
        range.setEnd(textNode, characterIndex + 1);
        const rects = Array.from(range.getClientRects?.() || []);
        const characterRect = rects.find(positiveRect) || range.getBoundingClientRect?.();
        if (!positiveRect(characterRect)) return null;
        const x = domPoint.offset < textLength
          ? characterRect.left
          : characterRect.right;
        return normalizedRect(characterRect, x);
      } catch (_error) {
        return null;
      }
    }

    _nearestPositionInRow(row, clientX) {
      const record = this._rowRecords.get(row);
      const positions = this._positionsByLine.get(record?.line?.id) || [];
      if (!positions.length) return null;
      if (!Number.isFinite(clientX)) return null;
      let best = null;
      let bestDistance = Infinity;
      for (const position of positions) {
        const rect = this.positionRect(position);
        if (!positiveRect(rect)) continue;
        const distance = Math.abs(clientX - rect.left);
        if (distance < bestDistance) {
          best = position;
          bestDistance = distance;
        }
      }
      return best;
    }

    _nativeSelection(selection) {
      if (selection) return selection;
      if (typeof this.document?.getSelection === 'function') return this.document.getSelection();
      return this.document?.defaultView?.getSelection?.()
        || (typeof window !== 'undefined' ? window.getSelection?.() : null);
    }

    getSelection(selectionInput) {
      const selection = this._nativeSelection(selectionInput);
      if (!selection?.anchorNode || !selection?.focusNode) return null;
      const anchor = this.domToSource(selection.anchorNode, selection.anchorOffset);
      const focus = this.domToSource(selection.focusNode, selection.focusOffset);
      if (!anchor || !focus) return null;
      return Object.freeze({
        sourceVersion: this._normalized?.version,
        anchor,
        focus,
        collapsed: samePosition(anchor, focus)
      });
    }

    _visibleExactTextDomPoint(position) {
      if (!position || position.sourceVersion !== this._normalized?.version) return null;
      const canonical = this._canonicalPosition(position);
      const domPoint = this.sourceToDom(canonical);
      if (!canonical || !domPoint || domPoint.activationAnchor
        || !contains(this.root, domPoint.node)
        || domPoint.node.isConnected === false) return null;

      const record = this._textRecords.get(domPoint.node);
      if (!record || record.emptyCaretHost || record.leaf?.visibility !== 'visible'
        || !record.element || !contains(this.root, record.element)
        || record.element.isConnected === false) return null;

      let current = record.element;
      while (current && contains(this.root, current)) {
        const style = current.style || null;
        if (style?.display === 'none' || style?.visibility === 'hidden'
          || style?.contentVisibility === 'hidden') return null;
        const computed = this.document?.defaultView?.getComputedStyle?.(current);
        if (computed?.display === 'none' || computed?.visibility === 'hidden'
          || computed?.contentVisibility === 'hidden') return null;
        if (current === this.root) break;
        current = current.parentNode || current.parentElement || null;
      }

      const rect = record.element.getBoundingClientRect?.();
      if (rect && !positiveRect(rect)) return null;
      const roundTrip = this.domToSource(domPoint.node, domPoint.offset);
      return samePosition(canonical, roundTrip)
        ? Object.freeze({ canonical, domPoint })
        : null;
    }

    _exactSourcePositionForDomPoint(node, offset) {
      if (!node || !contains(this.root, node) || node.isConnected === false) return null;
      if (this._textRecords.has(node)) return this.domToSource(node, offset);
      if (node.nodeType === ELEMENT_NODE || childArray(node).length) {
        return this._domBoundaryPosition(node, offset);
      }
      return null;
    }

    _nativeSelectionSnapshot(selection) {
      if (!selection) return null;
      if (!selection.anchorNode || !selection.focusNode) {
        return Object.freeze({ empty: true });
      }
      return Object.freeze({
        empty: false,
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset
      });
    }

    _restoreNativeSelectionSnapshot(selection, snapshot) {
      if (!selection || !snapshot) return false;
      try {
        if (snapshot.empty) {
          if (typeof selection.removeAllRanges !== 'function') return false;
          selection.removeAllRanges();
          return true;
        }
        if (typeof selection.setBaseAndExtent === 'function') {
          selection.setBaseAndExtent(
            snapshot.anchorNode,
            snapshot.anchorOffset,
            snapshot.focusNode,
            snapshot.focusOffset
          );
          return true;
        }
        const range = this._createRange();
        if (!range || typeof selection.removeAllRanges !== 'function'
          || typeof selection.addRange !== 'function') return false;
        range.setStart(snapshot.anchorNode, snapshot.anchorOffset);
        range.setEnd(snapshot.focusNode, snapshot.focusOffset);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      } catch (_error) {
        return false;
      }
    }

    selectTextGranularity(position, granularity, options = {}) {
      if (granularity !== 'word' && granularity !== 'block') return null;
      const exact = this._visibleExactTextDomPoint(position);
      const range = this._createRange();
      if (!exact || !range || typeof range.expand !== 'function') return null;

      let anchor;
      let focus;
      try {
        range.setStart(exact.domPoint.node, exact.domPoint.offset);
        range.collapse(true);
        range.expand(granularity);
        if (!contains(this.root, range.startContainer)
          || !contains(this.root, range.endContainer)
          || range.startContainer?.isConnected === false
          || range.endContainer?.isConnected === false) return null;
        anchor = this._exactSourcePositionForDomPoint(
          range.startContainer,
          range.startOffset
        );
        focus = this._exactSourcePositionForDomPoint(
          range.endContainer,
          range.endOffset
        );
      } catch (_error) {
        return null;
      }

      if (!anchor || !focus
        || anchor.sourceVersion !== this._normalized?.version
        || focus.sourceVersion !== this._normalized?.version) return null;
      const anchorOrder = this._positionOrder.get(positionKey(anchor));
      const focusOrder = this._positionOrder.get(positionKey(focus));
      const positionOrder = this._positionOrder.get(positionKey(exact.canonical));
      if (!Number.isInteger(anchorOrder) || !Number.isInteger(focusOrder)
        || !Number.isInteger(positionOrder)
        || anchorOrder > focusOrder
        || positionOrder < anchorOrder
        || positionOrder > focusOrder) return null;

      const canonicalSelection = Object.freeze({
        sourceVersion: this._normalized.version,
        anchor,
        focus,
        collapsed: samePosition(anchor, focus),
        granularity
      });
      if (options.apply === false) return canonicalSelection;

      const selection = this._nativeSelection(options.selection);
      const previous = this._nativeSelectionSnapshot(selection);
      if (!selection || !previous) return null;
      try {
        if (typeof selection.setBaseAndExtent === 'function') {
          selection.setBaseAndExtent(
            range.startContainer,
            range.startOffset,
            range.endContainer,
            range.endOffset
          );
        } else if (typeof selection.removeAllRanges === 'function'
          && typeof selection.addRange === 'function') {
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          return null;
        }
        const applied = this.getSelection(selection);
        if (applied && samePosition(applied.anchor, anchor)
          && samePosition(applied.focus, focus)) return canonicalSelection;
      } catch (_error) {
        // Fall through to exact native-selection restoration below.
      }
      this._restoreNativeSelectionSnapshot(selection, previous);
      return null;
    }

    restoreSelection(canonicalSelection, selectionInput) {
      const anchorInput = canonicalSelection?.anchor
        || canonicalSelection?.start
        || canonicalSelection;
      const focusInput = canonicalSelection?.focus
        || canonicalSelection?.end
        || canonicalSelection;
      const anchor = this._canonicalPosition(anchorInput);
      const focus = this._canonicalPosition(focusInput);
      const anchorDom = this.sourceToDom(anchor);
      const focusDom = this.sourceToDom(focus);
      const selection = this._nativeSelection(selectionInput);
      if (!anchor || !focus || !anchorDom || !focusDom || !selection) return false;

      if (typeof selection.setBaseAndExtent === 'function') {
        selection.setBaseAndExtent(
          anchorDom.node,
          anchorDom.offset,
          focusDom.node,
          focusDom.offset
        );
        return true;
      }

      const range = this._createRange();
      if (!range || typeof selection.removeAllRanges !== 'function' || typeof selection.addRange !== 'function') {
        return false;
      }
      const anchorOrder = this._positionOrder.get(positionKey(anchor));
      const focusOrder = this._positionOrder.get(positionKey(focus));
      const startDom = anchorOrder <= focusOrder ? anchorDom : focusDom;
      const endDom = anchorOrder <= focusOrder ? focusDom : anchorDom;
      try {
        range.setStart(startDom.node, startDom.offset);
        range.setEnd(endDom.node, endDom.offset);
        selection.removeAllRanges();
        selection.addRange(range);
        if (anchorOrder > focusOrder && typeof selection.extend === 'function') {
          selection.collapse(anchorDom.node, anchorDom.offset);
          selection.extend(focusDom.node, focusDom.offset);
        }
        return true;
      } catch (_error) {
        return false;
      }
    }

    moveHorizontal(position, direction) {
      const canonical = this._canonicalPosition(position);
      if (!canonical) return null;
      const currentIndex = this._positionOrder.get(positionKey(canonical));
      const delta = direction === 'left' || direction === -1 ? -1 : 1;
      return this._positions[currentIndex + delta] || canonical;
    }

    preferredXFor(position) {
      return this.positionRect(position)?.left ?? null;
    }

    moveVertical(position, direction, preferredX) {
      const canonical = this._canonicalPosition(position);
      if (!canonical) return null;
      const line = this._linesById.get(canonical.physicalLineId);
      const delta = direction === 'up' || direction === -1 ? -1 : 1;
      const targetLine = this._normalized?.lines[line.index + delta];
      if (!targetLine) return canonical;
      const targetPositions = this._positionsByLine.get(targetLine.id) || [];
      const desiredX = Number.isFinite(preferredX) ? preferredX : this.preferredXFor(canonical);
      if (!Number.isFinite(desiredX)) return null;
      const targetRow = this._rowsById.get(targetLine.id);
      return this._nearestPositionInRow(targetRow, desiredX);
    }

    diagnosticSnapshot() {
      return Object.freeze({
        ...this.snapshot(),
        presentationPlan: this._presentationPlan,
        projectedLeaves: this.enumerateProjectedLeaves(),
        planActivationAnchors: this.enumeratePlanActivationAnchors(),
        registeredActivationAnchors: this.enumerateRegisteredActivationAnchors(),
        rows: this.enumeratePhysicalRows(),
        positions: Object.freeze(this._positions.map((position) => {
          const dom = this.sourceToDom(position);
          const roundTrip = dom ? this.domToSource(dom.node, dom.offset) : null;
          const rect = this.positionRect(position);
          const collapsedRect = this.collapsedPositionRect(position);
          const row = this._rowsById.get(position.physicalLineId) || null;
          const pointerRoundTrip = positiveRect(rect)
            ? this.pointerToPosition({
              clientX: rect.left,
              clientY: rect.top + (rect.height / 2),
              target: row
            })
            : null;
          const leafRecord = this._positionLeafByKey.get(positionKey(position)) || null;
          return Object.freeze({
            key: positionKey(position),
            position,
            leafId: leafRecord?.leafId ?? position.leafId ?? null,
            leaf: leafRecord?.leaf || null,
            visibility: position.visibility,
            interactionPolicy: position.interactionPolicy,
            domNodeType: dom?.node?.nodeType ?? null,
            domOffset: dom?.offset ?? null,
            roundTrip,
            roundTripExact: samePosition(position, roundTrip),
            pointerRoundTrip,
            pointerRoundTripExact: samePosition(position, pointerRoundTrip),
            rect,
            positiveCaretRect: positiveRect(rect),
            collapsedRect,
            positiveCollapsedCaretRect: positiveRect(collapsedRect)
          });
        }))
      });
    }

    certifyPositions() {
      const diagnostics = this.diagnosticSnapshot().positions;
      const keyboard = this._positions.map(positionKey);
      const pointer = diagnostics
        .filter((entry) => (
          entry.positiveCollapsedCaretRect && entry.roundTripExact && entry.pointerRoundTripExact
        ))
        .map((entry) => entry.key);
      const visible = diagnostics
        .filter((entry) => entry.positiveCollapsedCaretRect && entry.roundTripExact)
        .map((entry) => entry.key);
      const pointerSet = new Set(pointer);
      const keyboardSet = new Set(keyboard);
      const visibleSet = new Set(visible);
      const equal = keyboard.length === pointer.length
        && keyboard.length === visible.length
        && keyboard.every((key) => pointerSet.has(key) && visibleSet.has(key))
        && pointer.every((key) => keyboardSet.has(key))
        && visible.every((key) => keyboardSet.has(key));
      return Object.freeze({
        P: Object.freeze(pointer),
        K: Object.freeze(keyboard),
        V: Object.freeze(visible),
        equal,
        failures: Object.freeze(diagnostics.filter(
          (entry) => !entry.positiveCollapsedCaretRect || !entry.roundTripExact
            || !entry.pointerRoundTripExact
        ))
      });
    }
  }

  function createEditableProjection(options) {
    return new EditableProjection(options);
  }

  return Object.freeze({
    EditableProjection,
    createEditableProjection,
    normalizeSnapshot,
    positionKey,
    samePosition
  });
});
