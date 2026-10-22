(function universalMarkdownEditableSyntaxAdapters(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const api = factory(
    root?.markdownPageModel || null,
    isCommonJs ? require('../hnListIndex') : root?.hnListIndexModel
  );
  if (isCommonJs) module.exports = api;
  else root.markdownEditableSyntaxAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildSyntaxAdapterApi(
  defaultModel,
  defaultHnListIndexModel
) {
  'use strict';

  const EDITABLE_MODES = new Set(['source', 'live-preview']);
  const API_GAPS = Object.freeze([]);
  const SEMANTIC_PRESENTATION_KEYS = Object.freeze([
    'headings',
    'emphasis',
    'strong',
    'strikethrough',
    'escapes',
    'inlineCode',
    'codeBlocks',
    'thematicBreaks'
  ]);
  const HN_BASIC_SEMANTIC_PRESENTATION_KEYS = Object.freeze([
    'emphasis',
    'strong',
    'strikethrough'
  ]);
  const INTEGRATION_REQUIREMENTS = Object.freeze([
    'projected-leaf-registration',
    'position-visibility-policy',
    'ensure-position-visible-before-restoration',
    'semantic-control-pointer-bypass'
  ]);

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((child) => deepFreeze(child, seen));
    return Object.freeze(value);
  }

  function canonicalSource(snapshot) {
    return typeof snapshot?.markdownBody === 'string'
      ? snapshot.markdownBody
      : String(snapshot?.markdownBody || '');
  }

  function physicalLines(snapshot) {
    const index = snapshot?.physicalLineIndex || snapshot?.PhysicalLineIndex;
    const lines = index?.lines || index?.physicalLines;
    if (!Array.isArray(lines)) {
      throw new TypeError('Markdown syntax adapters require SourceSnapshot.PhysicalLineIndex.');
    }
    return lines;
  }

  function nodeStart(node, fallback = 0) {
    const value = Number(node?.position?.start?.offset);
    return Number.isFinite(value) ? value : fallback;
  }

  function nodeEnd(node, fallback = nodeStart(node, 0)) {
    const value = Number(node?.position?.end?.offset);
    return Number.isFinite(value) ? Math.max(fallback, value) : fallback;
  }

  function ownerIdFallback(node) {
    const start = nodeStart(node, 0);
    return `${String(node?.type || 'unknown')}:${start}:${nodeEnd(node, start)}`;
  }

  function semanticOwnerMaps(snapshot) {
    const owners = Array.isArray(snapshot?.semanticIndex?.owners)
      ? snapshot.semanticIndex.owners
      : [];
    const byNode = new Map();
    const byId = new Map();
    owners.forEach((owner) => {
      if (owner?.node) byNode.set(owner.node, owner);
      if (owner?.id != null) byId.set(String(owner.id), owner);
    });
    return { owners, byNode, byId };
  }

  function collectAstEntries(snapshot) {
    const ast = snapshot?.parserAst || snapshot?.ast;
    const ownerMaps = semanticOwnerMaps(snapshot);
    const entries = [];
    const visit = (node, ancestors = []) => {
      if (!node || typeof node !== 'object') return;
      const start = nodeStart(node, NaN);
      const end = nodeEnd(node, start);
      const owner = snapshot.semanticIndex?.ownerByNode?.(node)
        || ownerMaps.byNode.get(node)
        || null;
      const ancestorTypes = Array.isArray(owner?.ancestorTypes)
        ? [...owner.ancestorTypes]
        : ancestors.map((ancestor) => String(ancestor.type || 'unknown'));
      const ancestorOwnerIds = Array.isArray(owner?.ancestorIds)
        ? [...owner.ancestorIds].map(String)
        : ancestors.map((ancestor) => String(
          ownerMaps.byNode.get(ancestor)?.id || ownerIdFallback(ancestor)
        ));
      const entry = {
        type: String(node.type || 'unknown'),
        start,
        end,
        ownerId: String(owner?.id || ownerIdFallback(node)),
        node,
        ancestors,
        ancestorTypes,
        ancestorOwnerIds
      };
      entries.push(entry);
      (node.children || []).forEach((child) => visit(child, [...ancestors, node]));
    };
    visit(ast);
    return { entries, ownerMaps };
  }

  function definitionMap(entries) {
    const definitions = new Map();
    entries.filter((entry) => entry.type === 'definition').forEach((entry) => {
      const identifier = String(entry.node?.identifier || entry.node?.label || '').toLowerCase();
      if (identifier) definitions.set(identifier, entry.node);
    });
    return definitions;
  }

  function ownerAtOffset(snapshot, requestedOffset) {
    const source = canonicalSource(snapshot);
    const offset = clamp(requestedOffset, 0, source.length);
    return snapshot?.semanticIndex?.ownerAtOffset?.(offset) || null;
  }

  function lineForOffset(snapshot, requestedOffset, affinity = 'after') {
    const lines = physicalLines(snapshot);
    const index = snapshot?.physicalLineIndex || snapshot?.PhysicalLineIndex;
    if (typeof index?.lineAtOffset === 'function') {
      return index.lineAtOffset(requestedOffset, affinity) || lines[0] || null;
    }
    const offset = clamp(requestedOffset, 0, canonicalSource(snapshot).length);
    let result = lines[0] || null;
    lines.forEach((line) => {
      if (line.start <= offset) result = line;
    });
    return result;
  }

  function positionDescriptor(
    snapshot,
    requestedOffset,
    semanticOwnerId,
    model = defaultModel,
    requestedAffinity = 'after'
  ) {
    const affinity = requestedAffinity === 'before' ? 'before' : 'after';
    if (typeof model?.createEditablePosition === 'function') {
      return model.createEditablePosition(snapshot, requestedOffset, affinity, {
        semanticOwnerId,
        visibility: 'activatable',
        interactionPolicy: 'activate-owner'
      });
    }
    const source = canonicalSource(snapshot);
    const offset = clamp(requestedOffset, 0, source.length);
    const line = lineForOffset(snapshot, offset, affinity);
    return Object.freeze({
      sourceVersion: snapshot?.version ?? snapshot?.sourceVersion ?? 0,
      offset,
      affinity,
      physicalLineId: String(line?.id || line?.physicalLineId || ''),
      logicalColumn: clamp(offset - Number(line?.start || 0), 0, String(line?.text || '').length),
      semanticOwnerId: semanticOwnerId || ownerAtOffset(snapshot, offset)?.id || null,
      visibility: 'activatable',
      interactionPolicy: 'activate-owner'
    });
  }

  function normalizedIdSet(value) {
    return new Set(Array.from(value || [], (entry) => String(entry)));
  }

  function entryIntersectsLine(entry, line) {
    const lineStart = Number(line.start || 0);
    const contentEnd = Number(line.contentEnd ?? line.end ?? lineStart + String(line.text || '').length);
    const sourceEnd = Number(line.sourceEnd ?? contentEnd);
    const effectiveEnd = Math.max(contentEnd, sourceEnd, lineStart + 1);
    return Number.isFinite(entry.start) && Number.isFinite(entry.end)
      && entry.start < effectiveEnd && entry.end > lineStart;
  }

  function rangesOverlap(left, right) {
    return Number(left?.start) < Number(right?.end)
      && Number(right?.start) < Number(left?.end);
  }

  function rangeContains(outer, inner) {
    return Number(outer?.start) <= Number(inner?.start)
      && Number(inner?.end) <= Number(outer?.end);
  }

  function childContentRange(entry) {
    const children = (entry?.node?.children || []).filter((child) => (
      Number.isFinite(Number(child?.position?.start?.offset))
        && Number.isFinite(Number(child?.position?.end?.offset))
    ));
    if (!children.length) return { start: entry.start, end: entry.end };
    return {
      start: Math.min(...children.map((child) => nodeStart(child, entry.start))),
      end: Math.max(...children.map((child) => nodeEnd(child, nodeStart(child, entry.start))))
    };
  }

  function lineIdsForRange(snapshot, range) {
    return physicalLines(snapshot).filter((line) => entryIntersectsLine(range, line))
      .map((line) => String(line.id || line.physicalLineId));
  }

  function presentationPolicy(mode, active, presentationOwned) {
    const sourceVisible = mode === 'source' || active || !presentationOwned;
    const renderedMounted = mode === 'live-preview' && presentationOwned && !active;
    return Object.freeze({
      sourceVisible,
      renderedMounted,
      layout: renderedMounted ? 'rendered-only' : 'source-only'
    });
  }

  function thematicBreakPresentationPolicy(mode, active, presentationOwned) {
    const sourceVisible = mode === 'source' || active || !presentationOwned;
    return Object.freeze({
      sourceVisible,
      renderedMounted: false,
      layout: sourceVisible ? 'source-only' : 'hidden'
    });
  }

  function commonmarkEscapable(character) {
    const code = String(character || '').codePointAt(0);
    return Number.isFinite(code) && (code >= 0x21 && code <= 0x2f
      || code >= 0x3a && code <= 0x40
      || code >= 0x5b && code <= 0x60
      || code >= 0x7b && code <= 0x7e);
  }

  function quoteMetadata(snapshot, activeOwnerIds, activeLineIds) {
    const source = canonicalSource(snapshot);
    const quoteLineIndex = snapshot?.quoteLineIndex || snapshot?.QuoteLineIndex;
    if (!quoteLineIndex || !Array.isArray(quoteLineIndex.quotedLines)) {
      throw new TypeError('Markdown syntax adapters require SourceSnapshot.QuoteLineIndex.');
    }
    return quoteLineIndex.quotedLines.map((line) => {
      const lineId = String(line.physicalLineId);
      const active = activeLineIds.has(lineId)
        || line.ownerIds.some((ownerId) => activeOwnerIds.has(ownerId));
      return {
        presentationId: `quote:${lineId}:${Number(line.start)}:${Number(line.contentEnd)}`,
        family: 'quote',
        kind: 'quote',
        physicalLineId: lineId,
        lineIndex: Number(line.lineIndex),
        depth: line.semanticDepth,
        semanticDepth: line.semanticDepth,
        physicalDepth: line.physicalDepth,
        ownerIds: line.ownerIds,
        prefixStart: line.prefixStart,
        prefixEnd: line.prefixEnd,
        prefix: source.slice(line.prefixStart, line.prefixEnd),
        contentStart: line.contentStart,
        contentEnd: line.contentEnd,
        prefixDepth: line.prefixDepth,
        continuation: line.continuation,
        regionIds: line.regionIds,
        regions: line.regions,
        active
      };
    });
  }

  function linkLabelRange(entry, source) {
    const children = entry.node?.children || [];
    if (children.length) {
      const start = Math.min(...children.map((child) => nodeStart(child, entry.start + 1)));
      const end = Math.max(...children.map((child) => nodeEnd(child, start)));
      return { start, end };
    }
    const raw = source.slice(entry.start, entry.end);
    const closing = raw.indexOf(']');
    const start = Math.min(entry.end, entry.start + (raw.startsWith('[') ? 1 : 0));
    return { start, end: closing >= 0 ? entry.start + closing : start };
  }

  function sourceIndexIsEscaped(source, index) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
      slashCount += 1;
    }
    return slashCount % 2 === 1;
  }

  function linkDestinationRange(entry, source, label) {
    const canonical = String(source || '');
    const constructEnd = Math.min(canonical.length, Math.max(entry.start, entry.end));
    if (entry.type === 'linkReference') {
      const opening = canonical.indexOf('[', label.end);
      if (opening >= label.end && opening < constructEnd) {
        for (let cursor = opening + 1; cursor < constructEnd; cursor += 1) {
          if (canonical[cursor] === ']' && !sourceIndexIsEscaped(canonical, cursor)) {
            return { start: opening + 1, end: cursor };
          }
        }
      }
      return { start: label.start, end: label.end };
    }

    const opening = canonical.indexOf('(', label.end);
    if (opening < label.end || opening >= constructEnd) {
      return { start: label.end, end: label.end };
    }
    let cursor = opening + 1;
    while (cursor < constructEnd && /[\t\n\r ]/.test(canonical[cursor])) cursor += 1;
    if (canonical[cursor] === '<') {
      const start = cursor + 1;
      cursor = start;
      while (cursor < constructEnd) {
        if (canonical[cursor] === '>' && !sourceIndexIsEscaped(canonical, cursor)) break;
        cursor += 1;
      }
      return { start, end: Math.min(cursor, constructEnd) };
    }

    const start = cursor;
    let nestedParentheses = 0;
    while (cursor < constructEnd) {
      const character = canonical[cursor];
      if (sourceIndexIsEscaped(canonical, cursor)) {
        cursor += 1;
        continue;
      }
      if (character === '(') nestedParentheses += 1;
      else if (character === ')') {
        if (nestedParentheses === 0) break;
        nestedParentheses -= 1;
      } else if (nestedParentheses === 0 && /[\t\n\r ]/.test(character)) break;
      cursor += 1;
    }
    return { start, end: cursor };
  }

  const RECOVERED_NESTED_LINK_KIND = 'obsidian-nested-link-shell';

  function literalAutolinkEntry(entry, source) {
    if (entry?.type !== 'link') return false;
    const children = entry.node?.children || [];
    if (children.length !== 1 || children[0]?.type !== 'text') return false;
    const childStart = nodeStart(children[0], NaN);
    const childEnd = nodeEnd(children[0], childStart);
    const raw = source.slice(entry.start, entry.end);
    return entry.start === childStart
      && entry.end === childEnd
      && raw.length > 0
      && String(children[0]?.value || '') === raw;
  }

  function recoveredLinkPresentationNode(source, recovery) {
    const label = Object.freeze({
      type: 'text',
      value: source.slice(recovery.labelStart, recovery.labelEnd),
      position: Object.freeze({
        start: Object.freeze({ offset: recovery.labelStart }),
        end: Object.freeze({ offset: recovery.labelEnd })
      })
    });
    return Object.freeze({
      type: 'link',
      url: recovery.href,
      title: recovery.title || null,
      children: Object.freeze([label]),
      position: Object.freeze({
        start: Object.freeze({ offset: recovery.start }),
        end: Object.freeze({ offset: recovery.end })
      }),
      data: Object.freeze({ markdownSemanticRecoveryKind: RECOVERED_NESTED_LINK_KIND })
    });
  }

  function recoverMarkdownLinkSemantics(snapshot, entriesInput = null) {
    const source = canonicalSource(snapshot);
    const ast = snapshot?.parserAst || snapshot?.ast;
    if (!ast) return Object.freeze([]);
    const entries = Array.isArray(entriesInput)
      ? entriesInput
      : collectAstEntries(snapshot).entries;
    const entryByNode = new Map(entries.map((entry) => [entry.node, entry]));
    const recoveries = [];
    const claimedParserNodes = new WeakSet();

    const visit = (parent) => {
      const children = Array.isArray(parent?.children) ? parent.children : [];
      for (let index = 0; index <= children.length - 5; index += 1) {
        const sourceSiblingNodes = children.slice(index, index + 5);
        const [openingText, explicitNode, bridgeText, literalNode, closingText] = sourceSiblingNodes;
        const explicitEntry = entryByNode.get(explicitNode);
        const literalEntry = entryByNode.get(literalNode);
        if (openingText?.type !== 'text'
          || explicitEntry?.type !== 'link'
          || bridgeText?.type !== 'text'
          || closingText?.type !== 'text'
          || !literalAutolinkEntry(literalEntry, source)
          || claimedParserNodes.has(explicitNode)
          || claimedParserNodes.has(literalNode)) continue;

        const explicitStart = explicitEntry.start;
        const explicitEnd = explicitEntry.end;
        const destinationStart = literalEntry.start;
        const destinationEnd = literalEntry.end;
        const start = explicitStart - 1;
        const end = destinationEnd + 1;
        const openingTextStart = nodeStart(openingText, NaN);
        const openingTextEnd = nodeEnd(openingText, openingTextStart);
        const bridgeStart = nodeStart(bridgeText, NaN);
        const bridgeEnd = nodeEnd(bridgeText, bridgeStart);
        const closingTextStart = nodeStart(closingText, NaN);
        const closingTextEnd = nodeEnd(closingText, closingTextStart);
        const explicitRaw = source.slice(explicitStart, explicitEnd);
        const contiguous = Number.isFinite(start)
          && openingTextStart <= start
          && openingTextEnd === explicitStart
          && bridgeStart === explicitEnd
          && bridgeEnd === destinationStart
          && closingTextStart === destinationEnd
          && end <= closingTextEnd;
        const exactShell = contiguous
          && source[start] === '['
          && !sourceIndexIsEscaped(source, start)
          && explicitRaw.startsWith('[')
          && explicitRaw.endsWith(')')
          && source.slice(explicitEnd, destinationStart) === ']('
          && !sourceIndexIsEscaped(source, explicitEnd)
          && !sourceIndexIsEscaped(source, explicitEnd + 1)
          && source[destinationEnd] === ')'
          && !sourceIndexIsEscaped(source, destinationEnd);
        if (!exactShell) continue;

        const parentEntry = entryByNode.get(parent);
        const sourceOwnerIds = Object.freeze([
          String(explicitEntry.ownerId),
          String(literalEntry.ownerId)
        ]);
        const ownerId = [
          'semantic-recovered-link',
          String(parentEntry?.ownerId || ownerIdFallback(parent)),
          start,
          end
        ].join(':');
        const base = {
          kind: RECOVERED_NESTED_LINK_KIND,
          parentNode: parent,
          firstChildIndex: index,
          lastChildIndex: index + 4,
          sourceSiblingNodes: Object.freeze(sourceSiblingNodes),
          rawParserLinkNodes: Object.freeze([explicitNode, literalNode]),
          sourceOwnerIds,
          ownerId,
          start,
          end,
          labelStart: explicitStart,
          labelEnd: explicitEnd,
          destinationStart,
          destinationEnd,
          href: typeof literalNode?.url === 'string' ? literalNode.url : '',
          title: literalNode?.title || ''
        };
        const recovery = Object.freeze({
          ...base,
          presentationNode: recoveredLinkPresentationNode(source, base)
        });
        recoveries.push(recovery);
        claimedParserNodes.add(explicitNode);
        claimedParserNodes.add(literalNode);
      }
      children.forEach(visit);
    };
    visit(ast);
    return Object.freeze(recoveries.sort((left, right) => (
      left.start - right.start || left.end - right.end
    )));
  }

  function linkMetadata(
    snapshot,
    entries,
    activeOwnerIds,
    model = defaultModel,
    semanticRecoveries = recoverMarkdownLinkSemantics(snapshot, entries)
  ) {
    const source = canonicalSource(snapshot);
    const definitions = definitionMap(entries);
    const suppressedParserNodes = new WeakSet(semanticRecoveries.flatMap((recovery) => (
      recovery.rawParserLinkNodes
    )));
    const parserBacked = entries.filter((entry) => (
      entry.type === 'link' || entry.type === 'linkReference'
    ))
      .filter((entry) => !suppressedParserNodes.has(entry.node))
      .map((entry) => {
        const definition = entry.type === 'linkReference'
          ? definitions.get(String(entry.node?.identifier || '').toLowerCase()) || null
          : entry.node;
        const href = typeof definition?.url === 'string' ? definition.url : '';
        const safeHref = typeof model?.safeLinkHref === 'function'
          ? model.safeLinkHref(href)
          : href;
        const label = linkLabelRange(entry, source);
        const destination = linkDestinationRange(entry, source, label);
        const active = activeOwnerIds.has(entry.ownerId);
        const logicalLinkId = `logical-link:${entry.ownerId}:${entry.start}:${entry.end}`;
        return {
          presentationId: `link:${entry.ownerId}:${entry.start}:${entry.end}`,
          logicalLinkId,
          family: 'link',
          kind: 'link',
          parserNode: entry.node,
          parserNodeType: entry.type,
          ownerId: entry.ownerId,
          start: entry.start,
          end: entry.end,
          raw: source.slice(entry.start, entry.end),
          labelStart: label.start,
          labelEnd: label.end,
          destinationStart: destination.start,
          destinationEnd: destination.end,
          destinationSource: source.slice(destination.start, destination.end),
          contentStart: label.start,
          contentEnd: label.end,
          labelSource: source.slice(label.start, label.end),
          tagName: 'a',
          lineIds: lineIdsForRange(snapshot, entry),
          safeHref,
          title: definition?.title || '',
          active
        };
      });
    const recovered = semanticRecoveries.map((recovery) => {
      const href = recovery.href;
      const safeHref = typeof model?.safeLinkHref === 'function'
        ? model.safeLinkHref(href)
        : href;
      const active = activeOwnerIds.has(recovery.ownerId)
        || recovery.sourceOwnerIds.some((ownerId) => activeOwnerIds.has(ownerId));
      const logicalLinkId = [
        'logical-link',
        recovery.ownerId,
        recovery.start,
        recovery.end
      ].join(':');
      return {
        presentationId: `link:${recovery.ownerId}:${recovery.start}:${recovery.end}`,
        logicalLinkId,
        family: 'link',
        kind: 'link',
        parserNode: null,
        parserNodeType: RECOVERED_NESTED_LINK_KIND,
        semanticRecovery: recovery,
        ownerId: recovery.ownerId,
        start: recovery.start,
        end: recovery.end,
        raw: source.slice(recovery.start, recovery.end),
        labelStart: recovery.labelStart,
        labelEnd: recovery.labelEnd,
        destinationStart: recovery.destinationStart,
        destinationEnd: recovery.destinationEnd,
        destinationSource: source.slice(recovery.destinationStart, recovery.destinationEnd),
        contentStart: recovery.labelStart,
        contentEnd: recovery.labelEnd,
        labelSource: source.slice(recovery.labelStart, recovery.labelEnd),
        tagName: 'a',
        lineIds: lineIdsForRange(snapshot, recovery),
        safeHref,
        title: recovery.title,
        active
      };
    });
    return [...parserBacked, ...recovered].sort((left, right) => (
      left.start - right.start || left.end - right.end
    ));
  }

  function imageSourceMetadata(snapshot, entries, activeOwnerIds, model = defaultModel) {
    const source = canonicalSource(snapshot);
    const imageEntries = entries.filter((entry) => (
      entry.type === 'image' || entry.type === 'imageReference'
    ));
    if (imageEntries.length && typeof model?.imageSourceRanges !== 'function') {
      throw new TypeError('Markdown image presentation requires model.imageSourceRanges().');
    }
    return imageEntries.map((entry) => {
      const ranges = model.imageSourceRanges(source, entry.node);
      return {
        presentationId: `image-source:${entry.ownerId}:${entry.start}:${entry.end}`,
        family: 'image-source',
        kind: 'image-source',
        ownerId: entry.ownerId,
        start: entry.start,
        end: entry.end,
        raw: source.slice(entry.start, entry.end),
        markerStart: ranges.markerStart,
        markerEnd: ranges.markerEnd,
        altStart: ranges.altStart,
        altEnd: ranges.altEnd,
        destinationStart: ranges.destinationStart,
        destinationEnd: ranges.destinationEnd,
        lineIds: lineIdsForRange(snapshot, entry),
        active: activeOwnerIds.has(entry.ownerId),
        presentation: {
          sourceVisible: true,
          renderedMounted: false,
          layout: 'source-only'
        }
      };
    });
  }

  function mathSourceRange(node, source) {
    const start = nodeStart(node, 0);
    const end = nodeEnd(node, start);
    const raw = String(source || '').slice(start, end);
    const display = node?.type === 'math';
    if (!display) {
      const opening = raw.match(/^\$+/)?.[0] || '$';
      const closing = raw.match(/\$+$/)?.[0] || opening;
      const contentStart = Math.min(end, start + opening.length);
      const contentEnd = Math.max(contentStart, end - closing.length);
      return Object.freeze({ start, end, contentStart, contentEnd, display, raw });
    }
    const first = raw.indexOf('$$');
    const last = raw.lastIndexOf('$$');
    const openingIndex = first >= 0 ? first : 0;
    let contentStart = start + openingIndex + 2;
    const openingBreak = raw.slice(openingIndex + 2).match(/^(?:\r\n|\n|\r)/)?.[0] || '';
    contentStart = Math.min(end, contentStart + openingBreak.length);
    let contentEnd = last > openingIndex ? start + last : end;
    const closingBreak = String(source || '').slice(contentStart, contentEnd)
      .match(/(?:\r\n|\n|\r)$/)?.[0] || '';
    contentEnd = Math.max(contentStart, contentEnd - closingBreak.length);
    return Object.freeze({ start, end, contentStart, contentEnd, display, raw });
  }

  function mathPresentationPolicy(mode, display, active) {
    const sourceVisible = mode === 'source' || mode === 'live-preview' && active;
    const renderedMounted = mode === 'live-preview' && (!active || display);
    return Object.freeze({
      sourceVisible,
      renderedMounted,
      layout: sourceVisible && renderedMounted && display
        ? 'source-above-rendered'
        : sourceVisible
          ? 'source-only'
          : 'rendered-only'
    });
  }

  function mathMetadata(snapshot, entries, activeOwnerIds, mode, model = defaultModel) {
    const source = canonicalSource(snapshot);
    return entries.filter((entry) => entry.type === 'inlineMath' || entry.type === 'math')
      .map((entry) => {
        const range = mathSourceRange(entry.node, source);
        const openingSource = range.display ? '$$' : range.raw.match(/^\$+/)?.[0] || '$';
        const closingSource = range.display ? '$$' : range.raw.match(/\$+$/)?.[0] || openingSource;
        const openingIndex = range.raw.indexOf(openingSource);
        const closingIndex = range.raw.lastIndexOf(closingSource);
        const active = activeOwnerIds.has(entry.ownerId);
        const policy = mathPresentationPolicy(mode, range.display, active);
        return {
          kind: 'math',
          ownerId: entry.ownerId,
          start: range.start,
          end: range.end,
          contentStart: range.contentStart,
          contentEnd: range.contentEnd,
          source: source.slice(range.contentStart, range.contentEnd),
          raw: range.raw,
          display: range.display,
          delimiterRanges: [
            openingIndex >= 0 ? {
              start: range.start + openingIndex,
              end: range.start + openingIndex + openingSource.length
            } : null,
            closingIndex >= 0 && closingIndex !== openingIndex ? {
              start: range.start + closingIndex,
              end: range.start + closingIndex + closingSource.length
            } : null
          ].filter(Boolean),
          active,
          presentation: policy,
          activationAnchor: mode === 'live-preview' && !active
            ? positionDescriptor(snapshot, range.contentStart, entry.ownerId, model)
            : null
        };
      });
  }

  function approvedUnderlineTag(node) {
    if (node?.type !== 'html') return null;
    const match = String(node.value || '').match(/^(\s*<\s*\/?\s*)(u)(\s*>\s*)$/i);
    if (!match) return null;
    const nameOffset = match[1].length;
    return {
      closing: /<\s*\//.test(match[1]),
      nameOffset,
      nameLength: match[2].length
    };
  }

  function underlineMetadata(snapshot, entries, activeOwnerIds) {
    const source = canonicalSource(snapshot);
    const entryByNode = new Map(entries.map((entry) => [entry.node, entry]));
    const underlines = [];
    const visit = (node) => {
      const children = Array.isArray(node?.children) ? node.children : [];
      children.forEach((child, index) => {
        const opening = approvedUnderlineTag(child);
        if (!opening || opening.closing) return;
        let depth = 1;
        let closingIndex = -1;
        for (let cursor = index + 1; cursor < children.length; cursor += 1) {
          const candidate = approvedUnderlineTag(children[cursor]);
          if (!candidate) continue;
          depth += candidate.closing ? -1 : 1;
          if (depth === 0) {
            closingIndex = cursor;
            break;
          }
        }
        if (closingIndex < 0) return;
        const openingEntry = entryByNode.get(child);
        const closingNode = children[closingIndex];
        const closingEntry = entryByNode.get(closingNode);
        if (!openingEntry || !closingEntry) return;
        const start = openingEntry.start;
        const end = closingEntry.end;
        const openingNameStart = start + opening.nameOffset;
        const closing = approvedUnderlineTag(closingNode);
        const closingNameStart = closingEntry.start + closing.nameOffset;
        const ownerId = String(openingEntry.ancestorOwnerIds.at(-1) || openingEntry.ownerId);
        const activationOwnerId = String(openingEntry.ownerId);
        underlines.push({
          presentationId: `underline:${start}:${end}`,
          family: 'underline',
          kind: 'underline',
          ownerId,
          activationOwnerId,
          start,
          end,
          raw: source.slice(start, end),
          contentStart: openingEntry.end,
          contentEnd: closingEntry.start,
          active: activeOwnerIds.has(activationOwnerId),
          markerRanges: [
            { family: 'source-symbol', start, end: openingNameStart },
            { family: 'underline-symbol', start: openingNameStart,
              end: openingNameStart + opening.nameLength },
            { family: 'source-symbol', start: openingNameStart + opening.nameLength,
              end: openingEntry.end },
            { family: 'source-symbol', start: closingEntry.start, end: closingNameStart },
            { family: 'underline-symbol', start: closingNameStart,
              end: closingNameStart + closing.nameLength },
            { family: 'source-symbol', start: closingNameStart + closing.nameLength,
              end: closingEntry.end }
          ].filter((range) => range.end > range.start)
        });
      });
      children.forEach(visit);
    };
    visit(snapshot.parserAst || snapshot.ast);
    return underlines;
  }

  function headingCandidate(snapshot, entry) {
    const source = canonicalSource(snapshot);
    const raw = source.slice(entry.start, entry.end);
    const children = childContentRange(entry);
    const atx = raw.match(/^( {0,3})(#{1,6})(?:([ \t]+)|(?=$))/);
    const lines = physicalLines(snapshot).filter((line) => entryIntersectsLine(entry, line));
    let style = 'setext';
    let contentStart = children.start;
    let contentEnd = children.end;
    let openingMarkerRange = null;
    let closingMarkerRange = null;
    let underlineRange = null;
    if (atx) {
      style = 'atx';
      const markerStart = entry.start + atx[1].length;
      const markerEnd = markerStart + atx[2].length;
      openingMarkerRange = {
        start: markerStart,
        end: markerEnd,
        source: source.slice(markerStart, markerEnd)
      };
      if (!(entry.node?.children || []).length) {
        contentStart = entry.start + atx[0].length;
        contentEnd = contentStart;
      }
      const closingSuffix = source.slice(contentEnd, entry.end);
      const closing = closingSuffix.match(/[ \t]+(#+)[ \t]*$/);
      if (closing) {
        const markerOffset = closing.index + closing[0].indexOf(closing[1]);
        closingMarkerRange = {
          start: contentEnd + markerOffset,
          end: contentEnd + markerOffset + closing[1].length,
          source: closing[1]
        };
      }
    } else {
      const underlineLine = [...lines].reverse().find((line) => (
        /^ {0,3}(?:=+|-+)[ \t]*$/.test(String(line.text || ''))
      ));
      if (underlineLine) {
        const marker = String(underlineLine.text || '').match(/(?:=+|-+)/)?.[0] || '';
        const markerColumn = String(underlineLine.text || '').indexOf(marker);
        underlineRange = {
          start: Number(underlineLine.start) + Math.max(0, markerColumn),
          end: Number(underlineLine.start) + Math.max(0, markerColumn) + marker.length,
          source: marker,
          physicalLineId: String(underlineLine.id || underlineLine.physicalLineId)
        };
      }
    }
    return {
      presentationId: `heading:${entry.ownerId}:${entry.start}:${entry.end}`,
      family: 'heading',
      kind: 'heading',
      astType: entry.type,
      ownerId: entry.ownerId,
      start: entry.start,
      end: entry.end,
      raw,
      contentStart,
      contentEnd,
      contentSource: source.slice(contentStart, contentEnd),
      node: entry.node,
      depth: Number(entry.node?.depth || 1),
      tagName: `h${Number(entry.node?.depth || 1)}`,
      style,
      openingMarkerRange,
      closingMarkerRange,
      underlineRange,
      lineIds: lineIdsForRange(snapshot, entry),
      anchorOffset: contentStart,
      priority: 26
    };
  }

  function inlineFormattingCandidate(snapshot, entry, family, tagName) {
    const source = canonicalSource(snapshot);
    const content = childContentRange(entry);
    return {
      presentationId: `${family}:${entry.ownerId}:${entry.start}:${entry.end}`,
      family,
      kind: family,
      astType: entry.type,
      ownerId: entry.ownerId,
      start: entry.start,
      end: entry.end,
      raw: source.slice(entry.start, entry.end),
      contentStart: content.start,
      contentEnd: content.end,
      contentSource: source.slice(content.start, content.end),
      node: entry.node,
      tagName,
      lineIds: lineIdsForRange(snapshot, entry),
      anchorOffset: content.start,
      priority: 25
    };
  }

  function inlineCodeCandidate(snapshot, entry) {
    const source = canonicalSource(snapshot);
    const raw = source.slice(entry.start, entry.end);
    const opening = raw.match(/^`+/)?.[0] || '';
    const closing = raw.match(/`+$/)?.[0] || '';
    const delimiterLength = opening && closing && opening.length === closing.length
      ? opening.length
      : Math.min(opening.length, closing.length);
    const contentStart = Math.min(entry.end, entry.start + delimiterLength);
    const contentEnd = Math.max(contentStart, entry.end - delimiterLength);
    return {
      presentationId: `inline-code:${entry.ownerId}:${entry.start}:${entry.end}`,
      family: 'inline-code',
      kind: 'inline-code',
      astType: entry.type,
      ownerId: entry.ownerId,
      start: entry.start,
      end: entry.end,
      raw,
      contentStart,
      contentEnd,
      contentSource: source.slice(contentStart, contentEnd),
      value: String(entry.node?.value || ''),
      node: entry.node,
      tagName: 'code',
      delimiter: opening.slice(0, delimiterLength),
      delimiterLength,
      openingRange: {
        start: entry.start,
        end: contentStart,
        source: source.slice(entry.start, contentStart)
      },
      closingRange: {
        start: contentEnd,
        end: entry.end,
        source: source.slice(contentEnd, entry.end)
      },
      lineIds: lineIdsForRange(snapshot, entry),
      anchorOffset: contentStart,
      priority: 27
    };
  }

  function codeCandidate(snapshot, entry, model = defaultModel) {
    if (typeof model?.codeFenceRanges !== 'function') {
      throw new TypeError('Markdown code presentation requires model.codeFenceRanges.');
    }
    const source = canonicalSource(snapshot);
    const range = model.codeFenceRanges(source, entry.node);
    const start = Number.isFinite(Number(range?.start)) ? Number(range.start) : entry.start;
    const end = Number.isFinite(Number(range?.end)) ? Number(range.end) : entry.end;
    const bodyStart = clamp(range?.bodyStart, start, end);
    const bodyEnd = clamp(range?.bodyEnd, bodyStart, end);
    const infoStart = clamp(range?.infoStart, start, end);
    const infoEnd = clamp(range?.infoEnd, infoStart, end);
    const fenced = Boolean(range?.fenced);
    const firstLine = lineForOffset(snapshot, start, 'after');
    const indentedPrefix = fenced
      ? ''
      : source.slice(start, Math.min(end, Number(firstLine?.contentEnd ?? end)))
        .match(/^(?: {4}|\t)/)?.[0] || '';
    const anchorOffset = fenced ? bodyStart : Math.min(end, start + indentedPrefix.length);
    const closingStart = clamp(range?.closingStart ?? end, bodyStart, end);
    const lineIds = lineIdsForRange(snapshot, { start, end });
    return {
      presentationId: `code-block:${entry.ownerId}:${start}:${end}`,
      family: 'code-block',
      kind: 'code-block',
      astType: entry.type,
      ownerId: entry.ownerId,
      start,
      end,
      raw: source.slice(start, end),
      contentStart: bodyStart,
      contentEnd: bodyEnd,
      contentSource: source.slice(bodyStart, bodyEnd),
      value: String(entry.node?.value || ''),
      node: entry.node,
      fenced,
      language: String(entry.node?.lang || ''),
      meta: String(entry.node?.meta || ''),
      marker: String(range?.marker || ''),
      markerLength: Number(range?.markerLength || 0),
      fenceStart: fenced ? clamp(range?.fenceStart, start, end) : null,
      fenceEnd: fenced ? clamp(range?.fenceEnd, start, end) : null,
      infoStart,
      infoEnd,
      infoSource: source.slice(infoStart, infoEnd),
      bodyStart,
      bodyEnd,
      bodySource: source.slice(bodyStart, bodyEnd),
      closingStart,
      closed: fenced && closingStart < end,
      openingRange: fenced ? {
        start,
        end: bodyStart,
        source: source.slice(start, bodyStart)
      } : null,
      closingRange: fenced ? {
        start: closingStart,
        end,
        source: source.slice(closingStart, end)
      } : null,
      lineIds,
      openingPhysicalLineId: lineIds[0] || null,
      closingPhysicalLineId: fenced && closingStart < end
        ? String(lineForOffset(snapshot, closingStart, 'after')?.id || '') || null
        : null,
      anchorOffset,
      activationStrategy: 'non-proportional-exact-anchor',
      priority: 55
    };
  }

  function escapeCandidates(snapshot, entries) {
    const source = canonicalSource(snapshot);
    const results = [];
    entries.filter((entry) => entry.type === 'text').forEach((entry) => {
      for (let offset = entry.start; offset + 1 < entry.end; offset += 1) {
        if (source[offset] !== '\\' || !commonmarkEscapable(source[offset + 1])) continue;
        results.push({
          presentationId: `escape:${entry.ownerId}:${offset}:${offset + 2}`,
          family: 'escape',
          kind: 'escape',
          astType: entry.type,
          ownerId: entry.ownerId,
          start: offset,
          end: offset + 2,
          raw: source.slice(offset, offset + 2),
          contentStart: offset + 1,
          contentEnd: offset + 2,
          contentSource: source[offset + 1],
          value: source[offset + 1],
          node: entry.node,
          tagName: 'span',
          lineIds: lineIdsForRange(snapshot, { start: offset, end: offset + 2 }),
          anchorOffset: offset + 1,
          priority: 24
        });
        offset += 1;
      }
    });
    return results;
  }

  function thematicBreakCandidate(snapshot, entry) {
    const source = canonicalSource(snapshot);
    return {
      presentationId: `thematic-break:${entry.ownerId}:${entry.start}:${entry.end}`,
      family: 'thematic-break',
      kind: 'thematic-break',
      astType: entry.type,
      ownerId: entry.ownerId,
      start: entry.start,
      end: entry.end,
      raw: source.slice(entry.start, entry.end),
      contentStart: entry.end,
      contentEnd: entry.end,
      contentSource: '',
      node: entry.node,
      tagName: null,
      markerRange: {
        start: entry.start,
        end: entry.end,
        source: source.slice(entry.start, entry.end)
      },
      lineIds: lineIdsForRange(snapshot, entry),
      anchorOffset: entry.start,
      priority: 58
    };
  }

  function paragraphMetadata(snapshot, entries, mode) {
    const source = canonicalSource(snapshot);
    return entries.filter((entry) => entry.type === 'paragraph').map((entry) => ({
      presentationId: `paragraph:${entry.ownerId}:${entry.start}:${entry.end}`,
      family: 'paragraph',
      kind: 'paragraph',
      astType: entry.type,
      ownerId: entry.ownerId,
      start: entry.start,
      end: entry.end,
      raw: source.slice(entry.start, entry.end),
      node: entry.node,
      tagName: 'p',
      lineIds: lineIdsForRange(snapshot, entry),
      presentation: {
        sourceVisible: true,
        renderedMounted: false,
        layout: 'physical-rows',
        role: 'paragraph',
        tagName: 'p',
        mode
      }
    }));
  }

  function editableListRowMetadata(
    snapshot,
    entries,
    activeOwnerIds,
    activeLineIds,
    mode,
    model = defaultModel,
    rowPredicate = (row) => row.unordered
  ) {
    const listIndex = snapshot?.editableListSemanticIndex;
    if (!listIndex) return [];
    const source = canonicalSource(snapshot);
    return listIndex.rows.filter(rowPredicate).map((row) => {
      const lineId = String(row.physicalLineId || row.lineId);
      const ownerId = String(row.astOwnerId || `editable-list-row:${lineId}`);
      const task = row.task === true;
      const renderedContentStart = task
        ? Number(row.taskContentStart)
        : Number(row.contentStart);
      const contentStart = Number.isFinite(renderedContentStart)
        ? renderedContentStart
        : Number(row.contentStart);
      const active = activeOwnerIds.has(ownerId) || activeLineIds.has(lineId);
      const sourceVisible = mode === 'source' || active;
      const renderedMounted = mode === 'live-preview' && !active;
      const presentationId = `${task ? 'task-list-row' : 'unordered-list-row'}:${lineId}:${row.start}:${row.end}`;
      return {
        presentationId,
        family: task ? 'task-list' : 'unordered-list',
        kind: task ? 'task-list-row' : 'unordered-list-row',
        ownerId,
        node: row.astNode || null,
        editableListRowId: row.id,
        reconciliation: row.reconciliation,
        start: Number(row.start),
        end: Number(row.end),
        raw: source.slice(Number(row.start), Number(row.end)),
        markerStart: Number(row.prefixStart),
        markerEnd: contentStart,
        markerSource: source.slice(Number(row.prefixStart), contentStart),
        contentStart,
        contentEnd: Number(row.contentEnd),
        contentSource: source.slice(contentStart, Number(row.contentEnd)),
        physicalLineId: lineId,
        lineIds: [lineId],
        lineIndex: Number(row.lineIndex),
        tabs: String(row.tabs || ''),
        tabDepth: Number(row.tabDepth || 0),
        depth: Number(row.depth || 1),
        task,
        checked: task ? Boolean(row.checked) : null,
        taskToken: task ? String(row.taskToken || '') : null,
        taskTokenStart: task ? Number(row.taskTokenStart) : null,
        taskTokenEnd: task ? Number(row.taskTokenEnd) : null,
        taskCheckStart: task ? Number(row.taskCheckStart) : null,
        taskCheckEnd: task ? Number(row.taskCheckEnd) : null,
        empty: Boolean(row.empty),
        active,
        presentation: {
          sourceVisible,
          renderedMounted,
          layout: renderedMounted ? 'rendered-prefix-source-content' : 'source-only',
          role: task ? 'task-list-row' : 'unordered-list-row',
          tagName: 'span'
        },
        activationAnchor: renderedMounted
          ? positionDescriptor(
            snapshot,
            contentStart,
            ownerId,
            model,
            contentStart === Number(row.contentEnd) ? 'before' : 'after'
          )
          : null,
        control: task && renderedMounted ? {
          kind: 'toggle-task-list-item',
          ownerId,
          presentationId,
          semanticOnly: true,
          contentEditable: false,
          checked: Boolean(row.checked),
          sourceStart: Number(row.taskCheckStart),
          sourceEnd: Number(row.taskCheckEnd)
        } : null
      };
    });
  }

  function hnSequenceListRowMetadata(snapshot, activeOwnerIds = new Set()) {
    const listIndex = snapshot?.hnListIndex
      || defaultHnListIndexModel?.createHnListIndex?.(snapshot)
      || null;
    if (!listIndex) return [];
    const source = canonicalSource(snapshot);
    return listIndex.sequences.flatMap((sequence) => sequence.items.flatMap((item) => (
      item.paragraphs.map((paragraph, paragraphIndex) => {
        const continuation = paragraph.kind === 'continuation';
        const lineId = String(paragraph.physicalLineId);
        const markerStart = Number(paragraph.prefixRange.start);
        const markerEnd = Number(paragraph.contentRange.start);
        const contentStart = markerEnd;
        const contentEnd = Number(paragraph.contentRange.end);
        const ownerId = String(item.id);
        const active = activeOwnerIds.has(ownerId);
        return {
          presentationId: `hn-sequence-list-row:${lineId}:${markerStart}:${contentEnd}`,
          family: 'hn-sequence-list',
          kind: continuation
            ? 'hn-sequence-list-continuation'
            : 'hn-sequence-list-item',
          ownerId,
          node: null,
          editableListRowId: null,
          reconciliation: Object.freeze({ status: 'hn-source-derived' }),
          hnSequenceList: true,
          hnSequenceId: String(sequence.id),
          hnItemId: String(item.id),
          continuation,
          paragraphIndex,
          markerColumnWidth: Number(sequence.markerColumnWidth),
          start: Number(paragraph.fullRange.start),
          end: contentEnd,
          raw: source.slice(Number(paragraph.fullRange.start), contentEnd),
          markerStart,
          markerEnd,
          markerSource: source.slice(markerStart, markerEnd),
          contentStart,
          contentEnd,
          contentSource: source.slice(contentStart, contentEnd),
          physicalLineId: lineId,
          lineIds: [lineId],
          lineIndex: Number(paragraph.lineIndex),
          tabs: item.tabs,
          tabDepth: Number(item.depth),
          depth: Number(item.depth) + 1,
          task: false,
          checked: null,
          empty: contentStart === contentEnd,
          active,
          presentation: {
            sourceVisible: true,
            renderedMounted: false,
            layout: 'source-two-column',
            role: continuation
              ? 'hn-sequence-list-continuation'
              : 'hn-sequence-list-item',
            tagName: 'span'
          },
          activationAnchor: null,
          control: null
        };
      })
    )));
  }

  function orderedListMarkerMetadata(snapshot, entries, model = defaultModel) {
    const listIndex = snapshot?.editableListSemanticIndex;
    if (!listIndex) return [];
    const source = canonicalSource(snapshot);
    return listIndex.rows.filter((row) => row.ordered).map((row) => {
      const lineId = String(row.physicalLineId || row.lineId);
      const start = Number(row.prefixStart);
      const end = Number(row.contentStart);
      return {
        presentationId: `ordered-list-marker:${lineId}:${start}:${end}`,
        family: 'ordered-list',
        kind: 'ordered-list-marker',
        ownerId: String(row.astOwnerId || `ordered-list-marker:${lineId}`),
        editableListRowId: row.id,
        reconciliation: row.reconciliation,
        physicalLineId: lineId,
        start,
        end,
        raw: source.slice(start, end)
      };
    });
  }

  function semanticPresentationCandidates(
    snapshot,
    entries,
    model = defaultModel,
    requestedKeys = SEMANTIC_PRESENTATION_KEYS
  ) {
    const keys = new Set(requestedKeys);
    const candidates = Object.fromEntries(
      SEMANTIC_PRESENTATION_KEYS.map((key) => [key, []])
    );
    if (keys.has('headings')) {
      candidates.headings = entries.filter((entry) => entry.type === 'heading')
        .map((entry) => headingCandidate(snapshot, entry));
    }
    if (keys.has('emphasis')) {
      candidates.emphasis = entries.filter((entry) => entry.type === 'emphasis')
        .map((entry) => inlineFormattingCandidate(snapshot, entry, 'emphasis', 'em'));
    }
    if (keys.has('strong')) {
      candidates.strong = entries.filter((entry) => entry.type === 'strong')
        .map((entry) => inlineFormattingCandidate(snapshot, entry, 'strong', 'strong'));
    }
    if (keys.has('strikethrough')) {
      candidates.strikethrough = entries.filter((entry) => entry.type === 'delete')
        .map((entry) => inlineFormattingCandidate(snapshot, entry, 'strikethrough', 'del'));
    }
    if (keys.has('escapes')) candidates.escapes = escapeCandidates(snapshot, entries);
    if (keys.has('inlineCode')) {
      candidates.inlineCode = entries.filter((entry) => entry.type === 'inlineCode')
        .map((entry) => inlineCodeCandidate(snapshot, entry));
    }
    if (keys.has('codeBlocks')) {
      candidates.codeBlocks = entries.filter((entry) => entry.type === 'code')
        .map((entry) => codeCandidate(snapshot, entry, model));
    }
    if (keys.has('thematicBreaks')) {
      candidates.thematicBreaks = entries.filter((entry) => entry.type === 'thematicBreak')
        .map((entry) => thematicBreakCandidate(snapshot, entry));
    }
    return candidates;
  }

  function presentationOwnership(
    candidates,
    entries,
    reservedTypes = ['link', 'linkReference', 'inlineMath', 'math', 'table']
  ) {
    const all = Object.values(candidates).flat();
    const reservedTypeSet = new Set(reservedTypes);
    const reserved = entries.filter((entry) => reservedTypeSet.has(entry.type));
    const conflicts = new Map();
    all.forEach((candidate) => {
      const reservedOwner = reserved
        .filter((entry) => rangesOverlap(candidate, entry))
        .sort((left, right) => left.start - right.start || right.end - left.end)[0] || null;
      if (reservedOwner) conflicts.set(candidate.presentationId, {
        ownerId: reservedOwner.ownerId,
        kind: reservedOwner.type,
        reason: 'reserved-syntax-range'
      });
    });
    const selected = [];
    all.filter((candidate) => !conflicts.has(candidate.presentationId))
      .sort((left, right) => left.start - right.start
        || right.end - left.end
        || right.priority - left.priority
        || left.presentationId.localeCompare(right.presentationId))
      .forEach((candidate) => {
        const prior = selected.find((owner) => rangesOverlap(owner, candidate));
        if (prior) {
          conflicts.set(candidate.presentationId, {
            ownerId: prior.ownerId,
            kind: prior.kind,
            reason: rangeContains(prior, candidate)
              ? 'nested-presentation-owner'
              : 'deterministic-overlap-priority'
          });
          return;
        }
        selected.push(candidate);
      });
    return { selected, conflicts };
  }

  function activeWithinCandidate(snapshot, candidate, activeOwnerIds) {
    if (activeOwnerIds.has(candidate.ownerId)) return true;
    for (const ownerId of activeOwnerIds) {
      const owner = snapshot?.semanticIndex?.ownerById?.(ownerId);
      if (owner && rangeContains(candidate, owner)) return true;
    }
    return false;
  }

  function semanticPresentationMetadata(
    snapshot,
    entries,
    activeOwnerIds,
    mode,
    model = defaultModel,
    options = {}
  ) {
    const unfilteredCandidates = semanticPresentationCandidates(
      snapshot,
      entries,
      model,
      options.requestedKeys || SEMANTIC_PRESENTATION_KEYS
    );
    const candidates = typeof options.candidateFilter === 'function'
      ? Object.fromEntries(Object.entries(unfilteredCandidates).map(([key, values]) => [
        key,
        values.filter((candidate) => options.candidateFilter(candidate, key))
      ]))
      : unfilteredCandidates;
    const ownership = presentationOwnership(
      candidates,
      entries,
      options.reservedTypes
    );
    const selectedIds = new Set(ownership.selected.map((candidate) => candidate.presentationId));
    const result = {};
    Object.entries(candidates).forEach(([key, familyCandidates]) => {
      result[key] = familyCandidates.map((candidate) => {
        const presentationOwned = selectedIds.has(candidate.presentationId);
        const active = activeWithinCandidate(snapshot, candidate, activeOwnerIds);
        const presentation = candidate.kind === 'thematic-break'
          ? thematicBreakPresentationPolicy(mode, active, presentationOwned)
          : presentationPolicy(mode, active, presentationOwned);
        const conflict = ownership.conflicts.get(candidate.presentationId) || null;
        return {
          ...candidate,
          presentationOwned,
          suppressedByOwnerId: conflict?.ownerId || null,
          suppressedByKind: conflict?.kind || null,
          suppressionReason: conflict?.reason || null,
          active,
          presentation: {
            ...presentation,
            role: candidate.family,
            tagName: candidate.tagName || null
          },
          activationAnchor: presentation.renderedMounted
            ? positionDescriptor(snapshot, candidate.anchorOffset, candidate.ownerId, model)
            : null
        };
      });
    });
    return result;
  }

  function clonedCell(cell, rowIndex, columnIndex, header) {
    const start = Number(cell?.start);
    const end = Number(cell?.end);
    const outerStart = Number(cell?.outerStart);
    const outerEnd = Number(cell?.outerEnd);
    return {
      rowIndex,
      columnIndex,
      header,
      start,
      end,
      outerStart,
      outerEnd,
      source: String(cell?.source || ''),
      sortText: String(cell?.sortText || ''),
      canonical: Number.isFinite(start) && Number.isFinite(end)
        && Number.isFinite(outerStart) && Number.isFinite(outerEnd)
        && outerEnd > outerStart
    };
  }

  function tableMetadata(snapshot, entries, activeOwnerIds, forcedRawOwnerIds, mode, model) {
    const source = canonicalSource(snapshot);
    if (typeof model?.parseMarkdownTableStructure !== 'function') return [];
    const lines = physicalLines(snapshot);
    return entries.filter((entry) => entry.type === 'table').map((entry) => {
      const structure = model.parseMarkdownTableStructure(source, entry.start);
      if (!structure) {
        return {
          kind: 'table',
          ownerId: entry.ownerId,
          start: entry.start,
          end: entry.end,
          invalid: true,
          raw: source.slice(entry.start, entry.end),
          activeRaw: true,
          cells: [],
          lineIds: []
        };
      }
      // Live Preview tables are edited through their canonical cell adapter.
      // Unlike other active syntax, neither an active owner nor a visibility
      // request may replace the semantic table with whole-table raw source.
      const activeRaw = mode === 'source';
      const tableLines = lines.filter((line) => {
        const contentEnd = Number(line.contentEnd ?? line.end ?? line.start);
        return Number(line.start) < structure.end && contentEnd >= structure.start;
      });
      const header = structure.header.map((cell, columnIndex) => (
        clonedCell(cell, -1, columnIndex, true)
      ));
      const rows = structure.rows.map((row, rowIndex) => row.map((cell, columnIndex) => (
        clonedCell(cell, rowIndex, columnIndex, false)
      )));
      const cells = [...header, ...rows.flat()];
      const delimiterLine = tableLines[1] || null;
      return {
        kind: 'table',
        ownerId: entry.ownerId,
        start: structure.start,
        end: structure.end,
        raw: structure.raw,
        lineEnding: structure.lineEnding,
        continuationPrefix: structure.continuationPrefix,
        columnCount: structure.columnCount,
        alignments: [...structure.alignments],
        activeRaw,
        lineIds: tableLines.map((line) => String(line.id || line.physicalLineId)),
        delimiterRange: delimiterLine ? {
          start: Number(delimiterLine.start),
          end: Number(delimiterLine.contentEnd ?? delimiterLine.end),
          physicalLineId: String(delimiterLine.id || delimiterLine.physicalLineId)
        } : null,
        header,
        rows,
        cells,
        controls: mode === 'live-preview' && !activeRaw ? [
          { kind: 'append-column', semanticOnly: true, contentEditable: false },
          { kind: 'append-row', semanticOnly: true, contentEditable: false }
        ] : []
      };
    });
  }

  function clippedRange(range, line) {
    const lineStart = Number(line.start);
    const lineEnd = Number(line.contentEnd ?? line.end ?? lineStart + String(line.text || '').length);
    const start = clamp(range.start, lineStart, lineEnd);
    const end = clamp(range.end, start, lineEnd);
    return end > start ? { start, end } : null;
  }

  function addOverride(overridesByLineId, lines, range, metadata) {
    if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.end <= range.start) {
      return;
    }
    lines.forEach((line) => {
      const clipped = clippedRange(range, line);
      if (!clipped) return;
      const id = String(line.id || line.physicalLineId);
      if (!overridesByLineId.has(id)) overridesByLineId.set(id, []);
      overridesByLineId.get(id).push({ ...metadata, ...clipped });
    });
  }

  function overridesForSpan(overrides, start, end) {
    return [...overrides]
      .filter((override) => override.start <= start && end <= override.end)
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
  }

  function semanticRolesForOverrides(overrides) {
    const roles = [];
    const keys = new Set();
    overrides.forEach((override) => {
      (override.semanticRoles || []).forEach((role) => {
        const key = [
          role.family,
          role.role,
          role.ownerId,
          role.presentationId,
          role.sourceStart,
          role.sourceEnd
        ].join(':');
        if (keys.has(key)) return;
        keys.add(key);
        roles.push({ ...role });
      });
    });
    return roles;
  }

  function leafFor(snapshot, line, start, end, metadata = {}) {
    const source = canonicalSource(snapshot);
    const lineId = String(line.id || line.physicalLineId);
    const owner = metadata.semanticOwnerId
      ? { id: metadata.semanticOwnerId }
      : ownerAtOffset(snapshot, start);
    return {
      leafId: `${lineId}:${start}:${end}:${metadata.kind || 'source'}`,
      physicalLineId: lineId,
      lineIndex: Number(line.index),
      sourceStart: start,
      sourceEnd: end,
      text: source.slice(start, end),
      semanticOwnerId: owner?.id || null,
      kind: metadata.kind || 'source',
      visibility: metadata.visibility || 'visible',
      interactionPolicy: metadata.interactionPolicy || 'editable-text',
      semanticRoles: Array.isArray(metadata.semanticRoles)
        ? metadata.semanticRoles.map((role) => ({ ...role }))
        : []
    };
  }

  function createLinePlans(snapshot, overridesByLineId, anchorsByLineId, lineMetadata) {
    return physicalLines(snapshot).map((line) => {
      const lineId = String(line.id || line.physicalLineId);
      const start = Number(line.start);
      const end = Number(line.contentEnd ?? line.end ?? start + String(line.text || '').length);
      const overrides = overridesByLineId.get(lineId) || [];
      const leaves = [];
      if (start === end) {
        leaves.push(leafFor(snapshot, line, start, end, {
          kind: 'empty-row',
          visibility: 'visible',
          interactionPolicy: 'editable-empty-row'
        }));
      } else {
        const boundaries = [...new Set([
          start,
          end,
          ...overrides.flatMap((override) => [override.start, override.end])
        ])].filter((offset) => start <= offset && offset <= end).sort((a, b) => a - b);
        for (let index = 0; index < boundaries.length - 1; index += 1) {
          const spanStart = boundaries[index];
          const spanEnd = boundaries[index + 1];
          const matchingOverrides = overridesForSpan(overrides, spanStart, spanEnd);
          const primary = matchingOverrides.find((override) => !override.decorationOnly) || null;
          leaves.push(leafFor(snapshot, line, spanStart, spanEnd, {
            ...(primary || {}),
            semanticRoles: semanticRolesForOverrides(matchingOverrides)
          }));
        }
      }
      return {
        physicalLineId: lineId,
        index: Number(line.index),
        start,
        contentEnd: end,
        sourceEnd: Number(line.sourceEnd ?? end),
        lineEnding: String(line.lineEnding || ''),
        text: canonicalSource(snapshot).slice(start, end),
        leaves,
        anchors: anchorsByLineId.get(lineId) || [],
        metadata: lineMetadata.get(lineId) || {}
      };
    });
  }

  function addEmptyCellAnchors(snapshot, tables, anchorsByLineId, model) {
    tables.forEach((table) => {
      if (table.activeRaw) return;
      table.cells.filter((cell) => cell.canonical && cell.start === cell.end).forEach((cell) => {
        const position = positionDescriptor(snapshot, cell.start, table.ownerId, model);
        const lineId = String(position.physicalLineId);
        if (!anchorsByLineId.has(lineId)) anchorsByLineId.set(lineId, []);
        anchorsByLineId.get(lineId).push({
          kind: 'table-empty-cell',
          ownerId: table.ownerId,
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          position
        });
      });
    });
  }

  function semanticRoleDescriptor(construct, role, range) {
    return {
      family: construct.family || construct.kind,
      role,
      ownerId: construct.ownerId || null,
      presentationId: construct.presentationId || null,
      tagName: construct.tagName || construct.presentation?.tagName || null,
      depth: Number.isFinite(Number(construct.depth)) ? Number(construct.depth) : null,
      active: Boolean(construct.active),
      sourceVisible: construct.presentation?.sourceVisible !== false,
      renderedMounted: Boolean(construct.presentation?.renderedMounted),
      sourceStart: Number(range.start),
      sourceEnd: Number(range.end)
    };
  }

  function simpleConstructSegments(construct) {
    const segments = [];
    const append = (role, start, end) => {
      if (!Number.isFinite(Number(start)) || !Number.isFinite(Number(end)) || end <= start) return;
      segments.push({ role, start: Number(start), end: Number(end) });
    };
    if (construct.kind === 'thematic-break') {
      append('marker', construct.start, construct.end);
      return segments;
    }
    if (construct.kind === 'code-block') {
      if (!construct.fenced) {
        append('content', construct.start, construct.end);
        return segments;
      }
      append('marker', construct.start, construct.infoStart);
      append('info', construct.infoStart, construct.bodyStart);
      append('content', construct.bodyStart, construct.bodyEnd);
      append('marker', construct.closingStart, construct.end);
      return segments;
    }
    append('marker', construct.start, construct.contentStart);
    append('content', construct.contentStart, construct.contentEnd);
    append('marker', construct.contentEnd, construct.end);
    return segments;
  }

  function addSimpleConstructSegments(
    snapshot,
    lines,
    construct,
    overridesByLineId,
    options = {}
  ) {
    const sourceVisible = construct.presentation?.sourceVisible !== false;
    const semanticDepth = Number(
      snapshot.semanticIndex?.ownerById?.(construct.ownerId)?.depth || 0
    );
    simpleConstructSegments(construct).forEach((segment) => {
      const baseRole = semanticRoleDescriptor(construct, segment.role, segment);
      const role = typeof options.rolePolicy === 'function'
        ? { ...baseRole, ...options.rolePolicy(segment, baseRole) }
        : baseRole;
      const decorationOnly = options.decorationOnly === true || !sourceVisible;
      addOverride(overridesByLineId, lines, segment, {
        priority: Number(construct.priority || 0)
          + semanticDepth / 100
          + (segment.role === 'marker' ? 0.002 : 0.001),
        ...(decorationOnly ? { decorationOnly: true } : {
          kind: `${construct.kind}-${segment.role}`,
          visibility: 'visible',
          interactionPolicy: 'editable-text',
          semanticOwnerId: construct.ownerId
        }),
        semanticRoles: [role]
      });
    });
  }

  function addParagraphOverrides(
    paragraphs,
    lines,
    overridesByLineId,
    lineMetadata
  ) {
    paragraphs.forEach((paragraph) => {
      const role = semanticRoleDescriptor(paragraph, 'content', paragraph);
      addOverride(overridesByLineId, lines, paragraph, {
        priority: 1,
        decorationOnly: true,
        semanticRoles: [role]
      });
      paragraph.lineIds.forEach((lineId) => {
        const existing = lineMetadata.get(lineId) || {};
        const annotations = Array.isArray(existing.paragraphs) ? existing.paragraphs : [];
        lineMetadata.set(lineId, {
          ...existing,
          paragraphs: [...annotations, {
            presentationId: paragraph.presentationId,
            ownerId: paragraph.ownerId,
            start: paragraph.start,
            end: paragraph.end
          }]
        });
      });
    });
  }

  function addSemanticPresentationOverrides(
    snapshot,
    semanticPresentations,
    overridesByLineId,
    anchorsByLineId,
    lineMetadata,
    reservedLinks = [],
    mode = 'source'
  ) {
    const lines = physicalLines(snapshot);
    Object.values(semanticPresentations).flat().forEach((construct) => {
      const sourceVisible = construct.presentation.sourceVisible;
      if (!construct.presentationOwned) {
        if (construct.suppressionReason === 'nested-presentation-owner') {
          addSimpleConstructSegments(snapshot, lines, construct, overridesByLineId, {
            decorationOnly: true
          });
        } else if (construct.suppressionReason === 'reserved-syntax-range'
          && (construct.suppressedByKind === 'link'
            || construct.suppressedByKind === 'linkReference')) {
          const containingLink = reservedLinks.find((link) => (
            String(link.ownerId) === String(construct.suppressedByOwnerId)
          ));
          if (containingLink) {
            const rawVisible = mode === 'source' || construct.active || containingLink.active;
            addSimpleConstructSegments(snapshot, lines, construct, overridesByLineId, {
              decorationOnly: true,
              rolePolicy: (segment) => ({
                active: Boolean(construct.active || containingLink.active),
                sourceVisible: segment.role === 'content' || rawVisible,
                renderedMounted: mode === 'live-preview'
                  && !rawVisible
                  && segment.role === 'content'
              })
            });
          }
        }
        return;
      }
      if (!sourceVisible) {
        addOverride(overridesByLineId, lines, construct, {
          priority: construct.priority,
          kind: `${construct.kind}-hidden-source`,
          visibility: 'activatable',
          interactionPolicy: 'activate-owner',
          semanticOwnerId: construct.ownerId
        });
      }
      addSimpleConstructSegments(snapshot, lines, construct, overridesByLineId, {
        decorationOnly: !sourceVisible
      });
      if (construct.activationAnchor) {
        const lineId = String(construct.activationAnchor.physicalLineId);
        if (!anchorsByLineId.has(lineId)) anchorsByLineId.set(lineId, []);
        anchorsByLineId.get(lineId).push({
          kind: `${construct.kind}-rendered-activation`,
          ownerId: construct.ownerId,
          presentationId: construct.presentationId,
          activationStrategy: construct.activationStrategy || 'non-proportional-exact-anchor',
          position: construct.activationAnchor
        });
      }
      construct.lineIds.forEach((lineId) => {
        const existing = lineMetadata.get(lineId) || {};
        const presentations = Array.isArray(existing.semanticPresentations)
          ? existing.semanticPresentations
          : [];
        lineMetadata.set(lineId, {
          ...existing,
          semanticPresentations: [...presentations, {
            presentationId: construct.presentationId,
            kind: construct.kind,
            ownerId: construct.ownerId,
            active: construct.active,
            sourceVisible,
            renderedMounted: construct.presentation.renderedMounted
          }],
          ...(construct.kind === 'code-block' ? {
            codeOwnerId: construct.ownerId,
            codeFenced: construct.fenced,
            codeActiveRaw: sourceVisible
          } : {})
        });
      });
    });
  }

  function addMappedSemanticPresentationOverrides(
    snapshot,
    semanticPresentations,
    overridesByLineId,
    lineMetadata
  ) {
    const lines = physicalLines(snapshot);
    Object.values(semanticPresentations).flat().forEach((construct) => {
      if (!construct.presentationOwned
        && construct.suppressionReason !== 'nested-presentation-owner') return;
      const semanticDepth = Number(
        snapshot.semanticIndex?.ownerById?.(construct.ownerId)?.depth || 0
      );
      simpleConstructSegments(construct).forEach((segment) => {
        const marker = segment.role === 'marker';
        const sourceVisible = !marker || construct.active;
        const role = {
          ...semanticRoleDescriptor(construct, segment.role, segment),
          sourceVisible,
          renderedMounted: false
        };
        addOverride(overridesByLineId, lines, segment, {
          priority: Number(construct.priority || 0)
            + semanticDepth / 100
            + (marker ? 0.002 : 0.001),
          ...(marker ? {
            kind: sourceVisible
              ? `${construct.kind}-marker`
              : `${construct.kind}-hidden-source`,
            visibility: sourceVisible ? 'visible' : 'activatable',
            interactionPolicy: sourceVisible ? 'editable-text' : 'activate-owner',
            semanticOwnerId: construct.ownerId
          } : { decorationOnly: true }),
          semanticRoles: [role]
        });
      });
      construct.lineIds.forEach((lineId) => {
        const existing = lineMetadata.get(lineId) || {};
        const presentations = Array.isArray(existing.semanticPresentations)
          ? existing.semanticPresentations
          : [];
        lineMetadata.set(lineId, {
          ...existing,
          semanticPresentations: [...presentations, {
            presentationId: construct.presentationId,
            kind: construct.kind,
            ownerId: construct.ownerId,
            active: construct.active,
            sourceVisible: construct.active,
            renderedMounted: false,
            layout: construct.active ? 'source-only' : 'mapped-content'
          }]
        });
      });
    });
  }

  function presentationAnnotationRole(family, role, construct, range, sourceVisible = true) {
    return {
      family,
      role,
      ownerId: construct.ownerId || null,
      presentationId: construct.presentationId || null,
      tagName: null,
      depth: null,
      active: Boolean(construct.active),
      sourceVisible,
      renderedMounted: false,
      sourceStart: Number(range.start),
      sourceEnd: Number(range.end)
    };
  }

  function tableSymbolRanges(snapshot, table) {
    const tableLineIds = new Set((table.lineIds || []).map(String));
    const ranges = [];
    physicalLines(snapshot).filter((line) => (
      tableLineIds.has(String(line.id || line.physicalLineId))
    )).forEach((line) => {
      const start = Number(line.start);
      const end = Number(line.contentEnd ?? line.end ?? start);
      if (!(end > start)) return;
      const contentRanges = (table.cells || []).map((cell) => ({
        start: Math.max(start, Number(cell.start)),
        end: Math.min(end, Number(cell.end))
      })).filter((range) => range.end > range.start)
        .sort((left, right) => left.start - right.start || left.end - right.end);
      let cursor = start;
      contentRanges.forEach((content) => {
        if (content.start > cursor) ranges.push({ start: cursor, end: content.start });
        cursor = Math.max(cursor, content.end);
      });
      if (cursor < end) ranges.push({ start: cursor, end });
    });
    return ranges;
  }

  function buildOverrides(snapshot, mode, constructs, model, options = {}) {
    const lines = physicalLines(snapshot);
    const overridesByLineId = new Map();
    const anchorsByLineId = new Map();
    const lineMetadata = new Map();

    addParagraphOverrides(
      constructs.paragraphs,
      lines,
      overridesByLineId,
      lineMetadata
    );

    const semanticPresentations = Object.fromEntries(
      SEMANTIC_PRESENTATION_KEYS.map((key) => [key, constructs[key]])
    );
    if (options.mappedSimplePresentation === true) {
      addMappedSemanticPresentationOverrides(
        snapshot,
        semanticPresentations,
        overridesByLineId,
        lineMetadata
      );
    } else {
      addSemanticPresentationOverrides(
        snapshot,
        semanticPresentations,
        overridesByLineId,
        anchorsByLineId,
        lineMetadata,
        constructs.links,
        mode
      );
    }

    constructs.underlines.forEach((underline) => {
      const markerSourceVisible = mode === 'source' || underline.active;
      const contentRange = {
        start: underline.contentStart,
        end: underline.contentEnd
      };
      addOverride(overridesByLineId, lines, contentRange, {
        priority: 18,
        decorationOnly: true,
        semanticRoles: [presentationAnnotationRole(
          'underline',
          'content',
          underline,
          contentRange
        )]
      });
      underline.markerRanges.forEach((range) => {
        addOverride(overridesByLineId, lines, range, {
          priority: 18.01,
          kind: markerSourceVisible ? `${range.family}-marker` : 'underline-hidden-source',
          visibility: markerSourceVisible ? 'visible' : 'activatable',
          interactionPolicy: markerSourceVisible ? 'editable-text' : 'activate-owner',
          semanticRoles: [
            presentationAnnotationRole(
              range.family,
              'marker',
              underline,
              range,
              markerSourceVisible
            ),
            // Outer presentation owners (notably links and Live tables) keep
            // their primary mapping/event policy. This pair-specific role lets
            // CSS hide only underline tag bytes without hiding shared symbols.
            presentationAnnotationRole(
              'underline-tag',
              'marker',
              underline,
              range,
              markerSourceVisible
            )
          ]
        });
      });
    });

    constructs.orderedListMarkers.forEach((marker) => {
      addOverride(overridesByLineId, lines, marker, {
        priority: 22.01,
        decorationOnly: true,
        semanticRoles: [presentationAnnotationRole(
          'ordered-list',
          'marker',
          marker,
          marker
        )]
      });
    });

    constructs.listRows.forEach((listRow) => {
      const sourceVisible = listRow.presentation.sourceVisible;
      const role = (family, semanticRole, range, renderedMounted = false) => ({
        family,
        role: semanticRole,
        ownerId: listRow.ownerId,
        presentationId: listRow.presentationId,
        tagName: 'span',
        depth: listRow.depth,
        active: listRow.active,
        sourceVisible: semanticRole === 'marker' ? sourceVisible : true,
        renderedMounted,
        sourceStart: range.start,
        sourceEnd: range.end
      });
      const markerRange = { start: listRow.markerStart, end: listRow.markerEnd };
      const markerRoles = [role(listRow.family, 'marker', markerRange, !sourceVisible)];
      if (listRow.task) {
        markerRoles.push(role('unordered-list', 'marker', markerRange, !sourceVisible));
      }
      addOverride(overridesByLineId, lines, markerRange, {
        priority: 23,
        kind: sourceVisible ? `${listRow.kind}-marker` : `${listRow.kind}-hidden-source`,
        visibility: sourceVisible ? 'visible' : 'activatable',
        interactionPolicy: sourceVisible ? 'editable-text' : 'activate-list-row',
        semanticOwnerId: listRow.ownerId,
        semanticRoles: markerRoles
      });
      const contentRange = { start: listRow.contentStart, end: listRow.contentEnd };
      if (contentRange.end > contentRange.start) {
        const contentRoles = [role(listRow.family, 'content', contentRange, !sourceVisible)];
        if (listRow.task) {
          contentRoles.push(role('unordered-list', 'content', contentRange, !sourceVisible));
        }
        addOverride(overridesByLineId, lines, contentRange, {
          priority: 22,
          kind: `${listRow.kind}-content`,
          visibility: 'visible',
          interactionPolicy: 'editable-text',
          semanticOwnerId: listRow.ownerId,
          semanticRoles: contentRoles
        });
      }
      if (listRow.activationAnchor) {
        if (!anchorsByLineId.has(listRow.physicalLineId)) {
          anchorsByLineId.set(listRow.physicalLineId, []);
        }
        anchorsByLineId.get(listRow.physicalLineId).push({
          kind: `${listRow.kind}-rendered-activation`,
          ownerId: listRow.ownerId,
          presentationId: listRow.presentationId,
          position: listRow.activationAnchor
        });
      }
      lineMetadata.set(listRow.physicalLineId, {
        ...(lineMetadata.get(listRow.physicalLineId) || {}),
        listRow: {
          presentationId: listRow.presentationId,
          ownerId: listRow.ownerId,
          kind: listRow.kind,
          task: listRow.task,
          checked: listRow.checked,
          depth: listRow.depth,
          tabDepth: listRow.tabDepth,
          active: listRow.active,
          sourceVisible,
          renderedMounted: listRow.presentation.renderedMounted
        }
      });
    });

    constructs.quotes.forEach((quote) => {
      const ownerId = quote.ownerIds.at(-1) || null;
      const markerVisible = mode === 'source' || quote.active;
      const descriptor = (role, range, sourceVisible) => ({
        family: 'quote',
        role,
        ownerId,
        presentationId: quote.presentationId,
        tagName: 'blockquote',
        depth: quote.depth,
        active: quote.active,
        sourceVisible,
        renderedMounted: true,
        sourceStart: range.start,
        sourceEnd: range.end
      });
      lineMetadata.set(quote.physicalLineId, {
        ...(lineMetadata.get(quote.physicalLineId) || {}),
        quote
      });
      const markerRange = { start: quote.prefixStart, end: quote.prefixEnd };
      if (quote.prefixEnd > quote.prefixStart) {
        addOverride(overridesByLineId, lines, markerRange, {
          priority: 20,
          kind: markerVisible ? 'quote-marker' : 'quote-prefix',
          visibility: markerVisible ? 'visible' : 'activatable',
          interactionPolicy: markerVisible ? 'editable-text' : 'activate-quote-line',
          semanticOwnerId: ownerId,
          semanticRoles: [descriptor('marker', markerRange, markerVisible)]
        });
      }
      const contentRange = { start: quote.contentStart, end: quote.contentEnd };
      addOverride(overridesByLineId, lines, contentRange, {
        priority: 19,
        kind: 'quote-content',
        visibility: 'visible',
        interactionPolicy: 'editable-text',
        semanticRoles: [descriptor('content', contentRange, true)]
      });
    });

    constructs.images.forEach((image) => {
      const segments = [
        {
          family: 'image-source',
          role: 'marker',
          start: image.markerStart,
          end: image.markerEnd,
          symbol: true
        },
        {
          family: 'image-source',
          role: 'content',
          start: image.altStart,
          end: image.altEnd,
          symbol: false
        },
        {
          family: 'image-source',
          role: 'destination',
          start: image.destinationStart,
          end: image.destinationEnd,
          symbol: true
        }
      ].filter((segment) => segment.end > segment.start);
      segments.forEach((segment) => {
        const range = { start: segment.start, end: segment.end };
        const roles = [presentationAnnotationRole(
          segment.family,
          segment.role,
          image,
          range
        )];
        if (segment.symbol) {
          roles.push(presentationAnnotationRole(
            'source-symbol',
            'marker',
            image,
            range
          ));
        }
        addOverride(overridesByLineId, lines, range, {
          priority: 36,
          decorationOnly: true,
          semanticRoles: roles
        });
      });
    });

    constructs.links.forEach((link) => {
      const descriptor = (role, range, sourceVisible, renderedMounted) => ({
        family: 'link',
        role,
        ownerId: link.ownerId,
        presentationId: link.presentationId,
        tagName: 'a',
        depth: null,
        active: link.active,
        sourceVisible,
        renderedMounted,
        sourceStart: range.start,
        sourceEnd: range.end
      });
      const segments = [
        { role: 'marker', start: link.start, end: link.labelStart },
        { role: 'content', start: link.labelStart, end: link.labelEnd },
        { role: 'marker', start: link.labelEnd, end: link.end }
      ].filter((segment) => segment.end > segment.start);
      if (mode !== 'live-preview' || link.active) {
        segments.forEach((segment) => {
          addOverride(overridesByLineId, lines, segment, {
            priority: 35 + (segment.role === 'marker' ? 0.002 : 0.001),
            kind: `link-${segment.role}`,
            visibility: 'visible',
            interactionPolicy: 'editable-text',
            semanticOwnerId: link.ownerId,
            semanticRoles: [descriptor(segment.role, segment, true, false)]
          });
        });
        return;
      }
      addOverride(overridesByLineId, lines, link, {
        priority: 30,
        kind: 'link-hidden-source',
        visibility: 'activatable',
        interactionPolicy: 'activate-link-source',
        semanticOwnerId: link.ownerId
      });
      segments.forEach((segment) => {
        addOverride(overridesByLineId, lines, segment, {
          priority: 30.5,
          decorationOnly: true,
          semanticRoles: [descriptor(
            segment.role,
            segment,
            segment.role === 'content',
            segment.role === 'content'
          )]
        });
      });
      addOverride(overridesByLineId, lines, {
        start: link.labelStart,
        end: link.labelEnd
      }, {
        priority: 31,
        kind: 'link-label',
        visibility: 'visible',
        interactionPolicy: 'editable-text',
        semanticOwnerId: link.ownerId,
        semanticRoles: [descriptor('content', {
          start: link.labelStart,
          end: link.labelEnd
        }, true, true)]
      });
      if (link.labelStart === link.labelEnd) {
        const position = positionDescriptor(snapshot, link.labelStart, link.ownerId, model);
        const lineId = String(position.physicalLineId);
        if (!anchorsByLineId.has(lineId)) anchorsByLineId.set(lineId, []);
        anchorsByLineId.get(lineId).push({ kind: 'empty-link-label', ownerId: link.ownerId, position });
      }
    });

    constructs.math.forEach((math) => {
      const sourceVisible = math.presentation.sourceVisible;
      addOverride(overridesByLineId, lines, math, {
        priority: sourceVisible ? 45 : 40,
        kind: sourceVisible ? 'math-source' : 'math-hidden-source',
        visibility: sourceVisible ? 'visible' : 'activatable',
        interactionPolicy: sourceVisible ? 'editable-text' : 'activate-math-source',
        semanticOwnerId: math.ownerId
      });
      math.delimiterRanges.forEach((range) => {
        addOverride(overridesByLineId, lines, range, {
          priority: 45.01,
          decorationOnly: true,
          semanticRoles: [presentationAnnotationRole(
            'math-delimiter',
            'marker',
            math,
            range,
            sourceVisible
          )]
        });
      });
      if (math.activationAnchor) {
        const lineId = String(math.activationAnchor.physicalLineId);
        if (!anchorsByLineId.has(lineId)) anchorsByLineId.set(lineId, []);
        anchorsByLineId.get(lineId).push({
          kind: 'math-rendered-activation',
          ownerId: math.ownerId,
          position: math.activationAnchor
        });
      }
    });

    constructs.tables.forEach((table) => {
      addOverride(overridesByLineId, lines, table, {
        priority: table.activeRaw ? 70 : 60,
        kind: table.activeRaw ? 'table-raw-source' : 'table-structural-source',
        visibility: table.activeRaw ? 'visible' : 'source-only',
        interactionPolicy: table.activeRaw ? 'editable-text' : 'activate-table-source',
        semanticOwnerId: table.ownerId
      });
      tableSymbolRanges(snapshot, table).forEach((range) => {
        addOverride(overridesByLineId, lines, range, {
          priority: table.activeRaw ? 70.01 : 60.01,
          decorationOnly: true,
          semanticRoles: [presentationAnnotationRole(
            'table-symbol',
            'marker',
            table,
            range,
            table.activeRaw
          )]
        });
      });
      if (!table.activeRaw) {
        table.cells.filter((cell) => cell.canonical).forEach((cell) => {
          addOverride(overridesByLineId, lines, cell, {
            priority: 65,
            kind: 'table-cell',
            visibility: 'visible',
            interactionPolicy: 'editable-table-cell',
            semanticOwnerId: table.ownerId
          });
        });
      }
      table.lineIds.forEach((lineId) => {
        lineMetadata.set(lineId, {
          ...(lineMetadata.get(lineId) || {}),
          tableOwnerId: table.ownerId,
          tableActiveRaw: table.activeRaw
        });
      });
    });
    addEmptyCellAnchors(snapshot, constructs.tables, anchorsByLineId, model);
    return { overridesByLineId, anchorsByLineId, lineMetadata };
  }

  function recoveredLinkDescriptorIsExact(link, source) {
    const recovery = link?.semanticRecovery;
    if (!recovery || recovery.kind !== RECOVERED_NESTED_LINK_KIND
      || link.parserNode !== null
      || link.parserNodeType !== RECOVERED_NESTED_LINK_KIND
      || link.ownerId !== recovery.ownerId) return false;
    const siblings = recovery.sourceSiblingNodes || [];
    const parserLinks = recovery.rawParserLinkNodes || [];
    const parentChildren = recovery.parentNode?.children || [];
    const first = Number(recovery.firstChildIndex);
    if (siblings.length !== 5 || parserLinks.length !== 2
      || !Number.isInteger(first)
      || recovery.lastChildIndex !== first + 4
      || siblings.some((node, index) => parentChildren[first + index] !== node)
      || parserLinks[0] !== siblings[1]
      || parserLinks[1] !== siblings[3]) return false;
    const explicitStart = nodeStart(parserLinks[0], NaN);
    const explicitEnd = nodeEnd(parserLinks[0], explicitStart);
    const literalStart = nodeStart(parserLinks[1], NaN);
    const literalEnd = nodeEnd(parserLinks[1], literalStart);
    const literalEntry = {
      type: parserLinks[1]?.type,
      node: parserLinks[1],
      start: literalStart,
      end: literalEnd
    };
    const parserHref = typeof parserLinks[1]?.url === 'string'
      ? parserLinks[1].url
      : '';
    const parserTitle = parserLinks[1]?.title || '';
    const presentation = recovery.presentationNode;
    const presentationLabel = presentation?.children?.[0];
    return siblings[0]?.type === 'text'
      && parserLinks[0]?.type === 'link'
      && siblings[2]?.type === 'text'
      && siblings[4]?.type === 'text'
      && literalAutolinkEntry(literalEntry, source)
      && link.start === explicitStart - 1
      && link.end === literalEnd + 1
      && link.labelStart === explicitStart
      && link.labelEnd === explicitEnd
      && link.destinationStart === literalStart
      && link.destinationEnd === literalEnd
      && recovery.start === link.start
      && recovery.end === link.end
      && recovery.labelStart === link.labelStart
      && recovery.labelEnd === link.labelEnd
      && recovery.destinationStart === link.destinationStart
      && recovery.destinationEnd === link.destinationEnd
      && source[link.start] === '['
      && !sourceIndexIsEscaped(source, link.start)
      && source.slice(explicitEnd, literalStart) === ']('
      && source[literalEnd] === ')'
      && !sourceIndexIsEscaped(source, literalEnd)
      && recovery.href === parserHref
      && recovery.title === parserTitle
      && link.title === parserTitle
      && link.labelSource === source.slice(link.labelStart, link.labelEnd)
      && presentation?.url === parserHref
      && (presentation?.title || '') === parserTitle
      && presentation?.position?.start?.offset === link.start
      && presentation?.position?.end?.offset === link.end
      && presentation?.children?.length === 1
      && presentationLabel?.type === 'text'
      && presentationLabel?.value === link.labelSource
      && presentationLabel?.position?.start?.offset === link.labelStart
      && presentationLabel?.position?.end?.offset === link.labelEnd;
  }

  function validateEditablePresentationPlan(plan, snapshotInput = null) {
    const source = canonicalSource(snapshotInput || plan);
    const errors = [];
    (plan?.lines || []).forEach((line) => {
      const leaves = line.leaves || [];
      if (!leaves.length) {
        errors.push(`line ${line.index} has no projected leaf`);
        return;
      }
      if (line.start === line.contentEnd) {
        if (leaves.length !== 1 || leaves[0].sourceStart !== line.start
          || leaves[0].sourceEnd !== line.contentEnd) {
          errors.push(`empty line ${line.index} has an invalid caret leaf`);
        }
      } else {
        let cursor = line.start;
        leaves.forEach((leaf) => {
          if (leaf.sourceStart !== cursor) {
            errors.push(`line ${line.index} has a gap or overlap at ${cursor}`);
          }
          if (leaf.sourceEnd <= leaf.sourceStart) {
            errors.push(`line ${line.index} has a non-positive source leaf`);
          }
          if (leaf.text !== source.slice(leaf.sourceStart, leaf.sourceEnd)) {
            errors.push(`leaf ${leaf.leafId} is not the exact canonical slice`);
          }
          cursor = leaf.sourceEnd;
        });
        if (cursor !== line.contentEnd) {
          errors.push(`line ${line.index} coverage ends at ${cursor}, expected ${line.contentEnd}`);
        }
      }
    });
    const links = plan?.constructs?.links || [];
    const recoveredParserNodes = new WeakSet();
    links.forEach((link) => {
      (link.semanticRecovery?.rawParserLinkNodes || []).forEach((node) => {
        if (node && typeof node === 'object') recoveredParserNodes.add(node);
      });
    });
    const logicalLinkIds = new Set();
    links.forEach((link) => {
      if (!link.logicalLinkId || logicalLinkIds.has(link.logicalLinkId)) {
        errors.push(`${link.presentationId} does not have one unique logical-link identity`);
      }
      logicalLinkIds.add(link.logicalLinkId);
      const recovered = link.semanticRecovery?.kind === RECOVERED_NESTED_LINK_KIND;
      if (recovered && !recoveredLinkDescriptorIsExact(link, source)) {
        errors.push(`${link.presentationId} is not one exact recovered outer-link shell`);
      } else if (!recovered
        && (!link.parserNode || !['link', 'linkReference'].includes(link.parserNodeType))) {
        errors.push(`${link.presentationId} is not backed by one parser link node`);
      } else if (!recovered && recoveredParserNodes.has(link.parserNode)) {
        errors.push(`${link.presentationId} republishes a parser link claimed by semantic recovery`);
      }
      if (link.raw !== source.slice(link.start, link.end)) {
        errors.push(`${link.presentationId} does not own one exact complete construct range`);
      }
      for (const [name, start, end] of [
        ['label', link.labelStart, link.labelEnd],
        ['destination', link.destinationStart, link.destinationEnd]
      ]) {
        if (!Number.isFinite(start) || !Number.isFinite(end)
          || start < link.start || end < start || end > link.end) {
          errors.push(`${link.presentationId} has an invalid ${name} range`);
        }
      }
      if (link.destinationSource !== source.slice(link.destinationStart, link.destinationEnd)) {
        errors.push(`${link.presentationId} has a non-canonical destination range`);
      }
      if (link.labelSource !== source.slice(link.labelStart, link.labelEnd)) {
        errors.push(`${link.presentationId} has a non-canonical label range`);
      }
      if (Object.hasOwn(link, 'control')) {
        errors.push(`${link.presentationId} republishes a second navigation-control descriptor`);
      }
    });
    if ((plan?.controls || []).some((control) => control.kind === 'open-link')) {
      errors.push('logical links are republished through the independent controls collection');
    }
    (plan?.constructs?.images || []).forEach((image) => {
      if (image.raw !== source.slice(image.start, image.end)) {
        errors.push(`${image.presentationId} is not the exact canonical image source`);
      }
      const ranges = [
        [image.markerStart, image.markerEnd],
        [image.altStart, image.altEnd],
        [image.destinationStart, image.destinationEnd]
      ];
      if (ranges[0][0] !== image.start
        || ranges[0][1] !== ranges[1][0]
        || ranges[1][1] !== ranges[2][0]
        || ranges[2][1] !== image.end) {
        errors.push(`${image.presentationId} does not cover one continuous image source range`);
      }
      if (!image.presentation?.sourceVisible
        || image.presentation?.renderedMounted
        || image.presentation?.layout !== 'source-only') {
        errors.push(`${image.presentationId} is not source-only presentation`);
      }
    });
    (plan?.constructs?.listRows || []).forEach((listRow) => {
      if (listRow.raw !== source.slice(listRow.start, listRow.end)) {
        errors.push(`${listRow.presentationId} is not the exact canonical physical row`);
      }
      if (listRow.markerSource !== source.slice(listRow.markerStart, listRow.markerEnd)) {
        errors.push(`${listRow.presentationId} has a non-canonical list prefix`);
      }
      if (listRow.contentSource !== source.slice(listRow.contentStart, listRow.contentEnd)) {
        errors.push(`${listRow.presentationId} has a non-canonical list content range`);
      }
      if (listRow.presentation?.renderedMounted !== Boolean(listRow.activationAnchor)) {
        errors.push(`${listRow.presentationId} has an inconsistent activation anchor policy`);
      }
      if (listRow.task && (
        listRow.taskCheckEnd !== listRow.taskCheckStart + 1
          || !/^[ xX]$/.test(source.slice(listRow.taskCheckStart, listRow.taskCheckEnd))
      )) errors.push(`${listRow.presentationId} has an invalid canonical task-state range`);
    });
    const ownedPresentations = SEMANTIC_PRESENTATION_KEYS
      .flatMap((key) => plan?.constructs?.[key] || [])
      .filter((construct) => construct.presentationOwned)
      .sort((left, right) => left.start - right.start || right.end - left.end);
    ownedPresentations.forEach((construct, index) => {
      if (construct.raw !== source.slice(construct.start, construct.end)) {
        errors.push(`${construct.presentationId} is not the exact canonical construct range`);
      }
      if (index > 0 && rangesOverlap(ownedPresentations[index - 1], construct)) {
        errors.push(`${construct.presentationId} overlaps another presentation owner`);
      }
      const anchor = construct.activationAnchor;
      if (construct.presentation?.renderedMounted && !anchor) {
        errors.push(`${construct.presentationId} has rendered presentation without an exact anchor`);
      }
      if (!construct.presentation?.renderedMounted && anchor) {
        errors.push(`${construct.presentationId} retains an anchor without rendered presentation`);
      }
      if (anchor && (anchor.offset < construct.start || anchor.offset > construct.end
        || anchor.semanticOwnerId !== construct.ownerId)) {
        errors.push(`${construct.presentationId} has an invalid exact activation anchor`);
      }
    });
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
  }

  function presentationSelectionOffsets(selection = {}) {
    const offset = (value) => Number(value && typeof value === 'object' ? value.offset : value);
    const anchor = offset(selection.anchor ?? selection.anchorPosition ?? 0);
    const focus = offset(selection.focus ?? selection.focusPosition ?? anchor);
    return {
      anchor: Number.isFinite(anchor) ? anchor : 0,
      focus: Number.isFinite(focus) ? focus : (Number.isFinite(anchor) ? anchor : 0)
    };
  }

  function activePresentationOwnerIdsForSelection(plan, selection = {}) {
    const { anchor, focus } = presentationSelectionOffsets(selection);
    const selectionStart = Math.min(anchor, focus);
    const selectionEnd = Math.max(anchor, focus);
    const intersects = (construct) => selectionStart === selectionEnd
      ? Number(construct.start) <= selectionStart && selectionStart <= Number(construct.end)
      : Number(construct.start) < selectionEnd && Number(construct.end) > selectionStart;
    const constructs = plan?.constructs || {};
    const candidates = [
      ...SEMANTIC_PRESENTATION_KEYS.flatMap((key) => constructs[key] || []),
      ...(constructs.listRows || []),
      ...(constructs.underlines || []),
      ...(constructs.links || []),
      ...(constructs.math || [])
    ];
    return Object.freeze([...new Set(candidates.filter(intersects).map((construct) => (
      String(construct.activationOwnerId || construct.ownerId)
    )))].filter(Boolean));
  }

  function finalizeEditablePresentationPlan(
    snapshot,
    mode,
    constructs,
    options = {}
  ) {
    const overrides = buildOverrides(
      snapshot,
      mode,
      constructs,
      options.model || defaultModel,
      options.overrideOptions
    );
    const lines = createLinePlans(
      snapshot,
      overrides.overridesByLineId,
      overrides.anchorsByLineId,
      overrides.lineMetadata
    );
    const controls = [
      ...constructs.listRows.map((listRow) => listRow.control).filter(Boolean),
      ...constructs.tables.flatMap((table) => table.controls.map((control) => ({
        ...control,
        ownerId: table.ownerId,
        tableStart: table.start
      })))
    ];
    const plan = {
      sourceVersion: snapshot.version ?? snapshot.sourceVersion ?? 0,
      markdownBody: canonicalSource(snapshot),
      mode,
      activeOwnerIds: [...(options.activeOwnerIds || [])],
      activePhysicalLineIds: [...(options.activeLineIds || [])],
      forcedRawOwnerIds: [...(options.forcedRawOwnerIds || [])],
      lines,
      constructs,
      controls,
      apiGaps: API_GAPS,
      integrationRequirements: INTEGRATION_REQUIREMENTS,
      ...(options.consumer ? { consumer: options.consumer } : {})
    };
    const validation = validateEditablePresentationPlan(plan, snapshot);
    if (!validation.ok) {
      throw new Error(`Invalid editable presentation plan: ${validation.errors.join('; ')}`);
    }
    return deepFreeze(plan);
  }

  function buildHnBasicPresentationPlan(snapshot, options = {}) {
    if (!snapshot || !snapshot.parserAst || !snapshot.semanticIndex) {
      throw new TypeError('HN syntax presentation requires a parsed immutable SourceSnapshot.');
    }
    const model = options.model || defaultModel;
    const hnMode = options.hnMode === 'browser' ? 'browser' : 'edit';
    const mode = 'live-preview';
    const activeOwnerIds = hnMode === 'edit'
      ? normalizedIdSet(options.activeOwnerIds)
      : new Set();
    const activeLineIds = new Set();
    const { entries } = collectAstEntries(snapshot);
    const unsupportedLinkEntries = entries.filter((entry) => (
      entry.type === 'link' || entry.type === 'linkReference'
    ));
    const outsideUnsupportedLink = (construct) => !unsupportedLinkEntries.some((entry) => (
      rangeContains(entry, construct)
    ));
    const source = canonicalSource(snapshot);
    const hnInlineCandidate = (candidate) => {
      const opening = source.slice(candidate.start, candidate.contentStart);
      const closing = source.slice(candidate.contentEnd, candidate.end);
      if (candidate.family === 'emphasis') return opening === '*' && closing === '*';
      if (candidate.family === 'strong') return opening === '**' && closing === '**';
      if (candidate.family === 'strikethrough') return opening === '~~' && closing === '~~';
      return false;
    };
    const semanticPresentations = semanticPresentationMetadata(
      snapshot,
      entries,
      activeOwnerIds,
      mode,
      model,
      {
        requestedKeys: HN_BASIC_SEMANTIC_PRESENTATION_KEYS,
        candidateFilter: hnInlineCandidate
      }
    );
    HN_BASIC_SEMANTIC_PRESENTATION_KEYS.forEach((key) => {
      semanticPresentations[key] = semanticPresentations[key].map((construct) => ({
        ...construct,
        presentation: {
          ...construct.presentation,
          sourceVisible: construct.active,
          renderedMounted: false,
          layout: construct.active ? 'source-only' : 'mapped-content'
        },
        activationAnchor: null
      }));
    });
    const listRows = [
      ...editableListRowMetadata(
      snapshot,
      entries,
      activeOwnerIds,
      activeLineIds,
      mode,
      model,
      (row) => row.unordered && !row.task
      ),
      ...hnSequenceListRowMetadata(snapshot, activeOwnerIds)
    ].sort((left, right) => left.start - right.start || left.end - right.end);
    const constructs = {
      paragraphs: [],
      ...semanticPresentations,
      listRows,
      orderedListMarkers: [],
      quotes: [],
      quoteRegions: [],
      images: [],
      links: [],
      math: mathMetadata(snapshot, entries, activeOwnerIds, mode, model)
        .filter(outsideUnsupportedLink),
      underlines: underlineMetadata(snapshot, entries, activeOwnerIds)
        .filter(outsideUnsupportedLink),
      tables: []
    };
    return finalizeEditablePresentationPlan(snapshot, mode, constructs, {
      model,
      activeOwnerIds,
      activeLineIds,
      forcedRawOwnerIds: [],
      consumer: 'hn-basic',
      overrideOptions: { mappedSimplePresentation: true }
    });
  }

  function buildEditablePresentationPlan(snapshot, options = {}) {
    if (!snapshot || !snapshot.parserAst || !snapshot.semanticIndex) {
      throw new TypeError('Markdown syntax adapters require a parsed immutable SourceSnapshot.');
    }
    const mode = options.mode || 'source';
    if (!EDITABLE_MODES.has(mode)) {
      throw new TypeError(`Syntax adapter plan cannot own non-editable mode: ${String(mode)}`);
    }
    const model = options.model || defaultModel;
    const activeOwnerIds = normalizedIdSet(options.activeOwnerIds);
    const activeLineIds = normalizedIdSet(options.activePhysicalLineIds || options.activeLineIds);
    const forcedRawOwnerIds = normalizedIdSet(options.forcedRawOwnerIds);
    const { entries } = collectAstEntries(snapshot);
    const linkSemanticRecoveries = recoverMarkdownLinkSemantics(snapshot, entries);
    const listRows = editableListRowMetadata(
      snapshot,
      entries,
      activeOwnerIds,
      activeLineIds,
      mode,
      model
    );
    const semanticPresentations = semanticPresentationMetadata(
      snapshot,
      entries,
      activeOwnerIds,
      mode,
      model
    );
    semanticPresentations.codeBlocks = (semanticPresentations.codeBlocks || []).filter((codeBlock) => (
      !snapshot.editableListSemanticIndex?.suppressesAstOwner?.(codeBlock.ownerId)
    ));
    const constructs = {
      paragraphs: paragraphMetadata(snapshot, entries, mode),
      ...semanticPresentations,
      listRows,
      orderedListMarkers: orderedListMarkerMetadata(snapshot, entries, model),
      quotes: quoteMetadata(snapshot, activeOwnerIds, activeLineIds),
      quoteRegions: snapshot.quoteLineIndex.regions,
      images: imageSourceMetadata(snapshot, entries, activeOwnerIds, model),
      links: linkMetadata(
        snapshot,
        entries,
        activeOwnerIds,
        model,
        linkSemanticRecoveries
      ),
      math: mathMetadata(snapshot, entries, activeOwnerIds, mode, model),
      underlines: underlineMetadata(snapshot, entries, activeOwnerIds),
      tables: tableMetadata(
        snapshot,
        entries,
        activeOwnerIds,
        forcedRawOwnerIds,
        mode,
        model
      )
    };
    return finalizeEditablePresentationPlan(snapshot, mode, constructs, {
      model,
      activeOwnerIds,
      activeLineIds,
      forcedRawOwnerIds
    });
  }

  return Object.freeze({
    API_GAPS,
    SEMANTIC_PRESENTATION_KEYS,
    HN_BASIC_SEMANTIC_PRESENTATION_KEYS,
    INTEGRATION_REQUIREMENTS,
    RECOVERED_NESTED_LINK_KIND,
    buildEditablePresentationPlan,
    buildHnBasicPresentationPlan,
    activePresentationOwnerIdsForSelection,
    recoverMarkdownLinkSemantics,
    validateEditablePresentationPlan,
    mathSourceRange
  });
});
