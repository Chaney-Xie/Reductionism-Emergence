/*
 * These helpers are serialized into real renderer processes. Keep each
 * exported function self-contained and dependency-free.
 */

export function canonicalListItemsFromSource(value) {
  const source = typeof value === 'string' ? value : String(value ?? '');
  const items = [];
  const childCounts = new Map();
  const hierarchy = [];
  let rootCount = 0;
  let sourceOrder = 0;
  let activeQuoteDepth = null;

  const indentationColumns = (text, tabSize = 4) => {
    let columns = 0;
    for (const character of text) {
      columns = character === '\t'
        ? columns + (tabSize - (columns % tabSize))
        : columns + 1;
    }
    return columns;
  };

  const quotePrefix = (line) => {
    let cursor = 0;
    let depth = 0;
    let end = 0;
    while (cursor < line.length) {
      let marker = cursor;
      let spaces = 0;
      while (spaces < 3 && line[marker] === ' ') {
        marker += 1;
        spaces += 1;
      }
      if (line[marker] !== '>') break;
      cursor = marker + 1;
      if (line[cursor] === ' ' || line[cursor] === '\t') cursor += 1;
      depth += 1;
      end = cursor;
    }
    return { depth, end, raw: line.slice(0, end) };
  };

  const allocatePath = (parent) => {
    if (!parent) {
      const path = String(rootCount);
      rootCount += 1;
      return path;
    }
    const index = childCounts.get(parent.path) || 0;
    childCounts.set(parent.path, index + 1);
    return `${parent.path}.${index}`;
  };

  const visitLine = (text, lineIndex, start, end, ending) => {
    const quote = quotePrefix(text);
    if (quote.depth !== activeQuoteDepth) {
      hierarchy.length = 0;
      activeQuoteDepth = quote.depth;
    }

    let markerLocalStart = quote.end;
    while (text[markerLocalStart] === ' ' || text[markerLocalStart] === '\t') {
      markerLocalStart += 1;
    }
    const indentation = text.slice(quote.end, markerLocalStart);
    const remainder = text.slice(markerLocalStart);
    const orderedMatch = /^(\d+)([.)])(?=[\t ]|$)/.exec(remainder);
    const unorderedMatch = /^([-+*])(?=[\t ]|$)/.exec(remainder);
    const markerMatch = orderedMatch || unorderedMatch;
    if (!markerMatch) return;

    const kind = orderedMatch ? 'ordered' : 'unordered';
    const rawMarker = markerMatch[0];
    const markerLocalEnd = markerLocalStart + rawMarker.length;
    let contentLocalStart = markerLocalEnd;
    while (text[contentLocalStart] === ' ' || text[contentLocalStart] === '\t') {
      contentLocalStart += 1;
    }
    const columns = indentationColumns(indentation);
    while (hierarchy.length
      && hierarchy[hierarchy.length - 1].indentationColumns >= columns) {
      hierarchy.pop();
    }
    const parent = hierarchy[hierarchy.length - 1] || null;
    const path = allocatePath(parent);
    const rawOrdinal = orderedMatch ? orderedMatch[1] : null;
    const numericOrdinal = rawOrdinal == null ? null : Number(rawOrdinal);
    const item = {
      path,
      parentPath: parent?.path || null,
      sourceOrder,
      line: {
        index: lineIndex,
        start,
        end,
        endWithEnding: end + ending.length,
        ending
      },
      markerRange: {
        start: start + markerLocalStart,
        end: start + markerLocalEnd
      },
      contentRange: {
        start: start + contentLocalStart,
        end
      },
      indentation,
      indentationColumns: columns,
      quoteDepth: quote.depth,
      quotePrefix: quote.raw,
      kind,
      rawMarker,
      delimiter: orderedMatch ? orderedMatch[2] : null,
      bullet: unorderedMatch ? unorderedMatch[1] : null,
      rawOrdinal,
      ordinal: Number.isSafeInteger(numericOrdinal) ? numericOrdinal : null,
      physicalDepth: parent ? parent.physicalDepth + 1 : 1
    };
    items.push(item);
    hierarchy.push(item);
    sourceOrder += 1;
  };

  let lineStart = 0;
  let lineIndex = 0;
  const endings = /\r\n|\n|\r/g;
  let match;
  while ((match = endings.exec(source))) {
    visitLine(
      source.slice(lineStart, match.index),
      lineIndex,
      lineStart,
      match.index,
      match[0]
    );
    lineStart = match.index + match[0].length;
    lineIndex += 1;
  }
  visitLine(source.slice(lineStart), lineIndex, lineStart, source.length, '');
  return items;
}

export const CANONICAL_LIST_ITEMS_FUNCTION_SOURCE = canonicalListItemsFromSource.toString();

export function semanticListItemsFromDom(root) {
  const items = [];
  const childCounts = new Map();
  let rootCount = 0;
  let domOrder = 0;

  const tag = (element) => String(element?.tagName || '').toUpperCase();
  const children = (element) => Array.from(element?.children || []);
  const isList = (element) => tag(element) === 'OL' || tag(element) === 'UL';
  const attribute = (element, name) => {
    if (!element) return null;
    if (typeof element.getAttribute === 'function') {
      const value = element.getAttribute(name);
      return value == null ? null : String(value);
    }
    if (name.startsWith('data-') && element.dataset) {
      const property = name.slice(5).replace(/-([a-z])/g, (_match, letter) => (
        letter.toUpperCase()
      ));
      if (Object.prototype.hasOwnProperty.call(element.dataset, property)) {
        return String(element.dataset[property]);
      }
    }
    const attributes = element.attributes;
    if (attributes && Object.prototype.hasOwnProperty.call(attributes, name)) {
      return String(attributes[name]);
    }
    return null;
  };
  const integerAttribute = (element, name) => {
    const raw = attribute(element, name);
    if (raw == null || !/^[+-]?\d+$/.test(raw.trim())) return null;
    const number = Number(raw);
    return Number.isFinite(number) ? Math.trunc(number) : null;
  };
  const directListItems = (list) => children(list).filter((child) => tag(child) === 'LI');
  const collectFirstLists = (element, result) => {
    if (!element) return result;
    if (isList(element)) {
      result.push(element);
      return result;
    }
    for (const child of children(element)) collectFirstLists(child, result);
    return result;
  };
  const ownCheckbox = (item) => {
    const visit = (element) => {
      for (const child of children(element)) {
        if (isList(child) || tag(child) === 'LI') continue;
        if (tag(child) === 'INPUT'
          && String(attribute(child, 'type') || child.type || '').toLowerCase() === 'checkbox') {
          return child;
        }
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(item);
  };
  const styleValue = (style, property, cssProperty) => {
    if (!style) return null;
    const direct = style[property];
    if (direct != null && direct !== '') return String(direct);
    if (typeof style.getPropertyValue === 'function') {
      const value = style.getPropertyValue(cssProperty);
      if (value != null && value !== '') return String(value);
    }
    return null;
  };
  const nativeMarkerFacts = (item, list) => {
    const reader = typeof globalThis !== 'undefined'
      && typeof globalThis.getComputedStyle === 'function'
      ? globalThis.getComputedStyle.bind(globalThis)
      : null;
    if (!reader) return null;
    let itemStyle = null;
    let listStyle = null;
    let markerStyle = null;
    try { itemStyle = reader(item); } catch {}
    try { listStyle = reader(list); } catch {}
    try { markerStyle = reader(item, '::marker'); } catch {}
    if (!itemStyle && !listStyle && !markerStyle) return null;

    const listStyleType = styleValue(itemStyle, 'listStyleType', 'list-style-type')
      || styleValue(listStyle, 'listStyleType', 'list-style-type');
    const listStylePosition = styleValue(itemStyle, 'listStylePosition', 'list-style-position')
      || styleValue(listStyle, 'listStylePosition', 'list-style-position');
    const itemDisplay = styleValue(itemStyle, 'display', 'display');
    const itemVisibility = styleValue(itemStyle, 'visibility', 'visibility');
    const itemOpacity = styleValue(itemStyle, 'opacity', 'opacity');
    const markerDisplay = styleValue(markerStyle, 'display', 'display');
    const markerVisibility = styleValue(markerStyle, 'visibility', 'visibility');
    const markerOpacity = styleValue(markerStyle, 'opacity', 'opacity');
    const hidden = (value) => value === 'none' || value === 'hidden' || value === 'collapse';
    const transparent = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return false;
      if (normalized === 'transparent') return true;
      const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)$/);
      if (rgba && Number(rgba[1]) === 0) return true;
      return /^#[0-9a-f]{6}00$/i.test(normalized);
    };
    const meaningfulListStyle = (value) => {
      const normalized = String(value || '').trim();
      if (!normalized || normalized === 'none') return false;
      return normalized.replace(/["'\s\u200b\u200c\u200d\ufeff]/g, '') !== '';
    };
    const markerColor = styleValue(markerStyle, 'color', 'color');
    return {
      listStyleType: listStyleType || null,
      listStylePosition: listStylePosition || null,
      content: styleValue(markerStyle, 'content', 'content'),
      color: markerColor,
      fontFamily: styleValue(markerStyle, 'fontFamily', 'font-family'),
      fontSize: styleValue(markerStyle, 'fontSize', 'font-size'),
      itemDisplay,
      itemVisibility,
      itemOpacity,
      markerDisplay,
      markerVisibility,
      markerOpacity,
      rendered: !hidden(itemDisplay)
        && !hidden(itemVisibility)
        && itemOpacity !== '0'
        && meaningfulListStyle(listStyleType)
        && !hidden(markerDisplay)
        && !hidden(markerVisibility)
        && markerOpacity !== '0'
        && !transparent(markerColor)
    };
  };
  const allocatePath = (parentPath) => {
    if (parentPath == null) {
      const path = String(rootCount);
      rootCount += 1;
      return path;
    }
    const index = childCounts.get(parentPath) || 0;
    childCounts.set(parentPath, index + 1);
    return `${parentPath}.${index}`;
  };

  const visitList = (list, parentPath, listDepth) => {
    const ordered = tag(list) === 'OL';
    const startNumber = ordered ? (integerAttribute(list, 'start') ?? 1) : null;
    let nextOrdinal = startNumber;
    for (const item of directListItems(list)) {
      const explicitValue = ordered ? integerAttribute(item, 'value') : null;
      const ordinal = ordered ? (explicitValue ?? nextOrdinal) : null;
      if (ordered) nextOrdinal = ordinal + 1;
      const path = allocatePath(parentPath);
      const checkbox = ownCheckbox(item);
      items.push({
        path,
        parentPath,
        domOrder,
        sourceStart: integerAttribute(item, 'data-markdown-source-start'),
        sourceEnd: integerAttribute(item, 'data-markdown-source-end'),
        listDepth,
        ordered,
        startNumber,
        explicitValue,
        ordinal,
        checked: checkbox ? Boolean(checkbox.checked) : null,
        nativeMarker: nativeMarkerFacts(item, list)
      });
      domOrder += 1;
      const nestedLists = [];
      for (const child of children(item)) collectFirstLists(child, nestedLists);
      for (const nestedList of nestedLists) visitList(nestedList, path, listDepth + 1);
    }
  };

  const rootLists = [];
  collectFirstLists(root, rootLists);
  for (const list of rootLists) visitList(list, null, 1);
  return items;
}

export const SEMANTIC_LIST_ITEMS_FUNCTION_SOURCE = semanticListItemsFromDom.toString();

/**
 * Project the production Markdown parser tree into a source-addressed list
 * inventory. Unlike canonicalListItemsFromSource, this follows parser-owned
 * list/listItem nodes and therefore represents same-line nesting such as
 * `2. *` without guessing hierarchy from physical indentation.
 *
 * This helper is serialized into the Viewer renderer. Keep it dependency-free.
 */
export function listItemsFromMarkdownAst(tree, value) {
  const source = typeof value === 'string' ? value : String(value ?? '');
  const items = [];
  const childCounts = new Map();
  let rootCount = 0;
  let sourceOrder = 0;

  const children = (node) => Array.isArray(node?.children) ? node.children : [];
  const finiteOffset = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  };
  const startOf = (node) => finiteOffset(node?.position?.start?.offset);
  const endOf = (node) => finiteOffset(node?.position?.end?.offset);
  const allocatePath = (parent) => {
    if (!parent) {
      const path = String(rootCount);
      rootCount += 1;
      return path;
    }
    const index = childCounts.get(parent.path) || 0;
    childCounts.set(parent.path, index + 1);
    return `${parent.path}.${index}`;
  };
  const markerAt = (offset) => {
    if (offset == null || offset > source.length) return null;
    const match = /^(?:(\d+)([.)])|([-+*]))(?=[\t \r\n]|$)/.exec(source.slice(offset));
    if (!match) return null;
    const rawOrdinal = match[1] ?? null;
    const numericOrdinal = rawOrdinal == null ? null : Number(rawOrdinal);
    return {
      start: offset,
      end: offset + match[0].length,
      raw: match[0],
      kind: rawOrdinal == null ? 'unordered' : 'ordered',
      delimiter: match[2] ?? null,
      bullet: match[3] ?? null,
      rawOrdinal,
      ordinal: Number.isSafeInteger(numericOrdinal) ? numericOrdinal : null
    };
  };
  const hasOwnContent = (node) => {
    if (!node || node.type === 'list') return false;
    if (node.type === 'text') return String(node.value || '').trim().length > 0;
    const nested = children(node);
    if (nested.length) return nested.some(hasOwnContent);
    return !['break'].includes(node.type);
  };

  const visitList = (list, parent, listDepth, quoteDepth) => {
    const ordered = list?.ordered === true;
    const rawStartNumber = ordered ? Number(list?.start ?? 1) : null;
    const startNumber = ordered && Number.isFinite(rawStartNumber)
      ? Math.trunc(rawStartNumber)
      : ordered ? 1 : null;
    const listItems = children(list).filter((node) => node?.type === 'listItem');
    listItems.forEach((node, siblingIndex) => {
      const path = allocatePath(parent);
      const sourceStart = startOf(node);
      const sourceEnd = endOf(node);
      const marker = markerAt(sourceStart);
      const item = {
        path,
        parentPath: parent?.path ?? null,
        parentSourceStart: parent?.sourceStart ?? null,
        sourceOrder,
        sourceStart,
        sourceEnd,
        lineIndex: Number.isSafeInteger(Number(node?.position?.start?.line))
          ? Math.max(0, Number(node.position.start.line) - 1)
          : null,
        listDepth,
        quoteDepth,
        ordered,
        kind: ordered ? 'ordered' : 'unordered',
        startNumber,
        siblingIndex,
        ordinal: ordered ? startNumber + siblingIndex : null,
        checked: typeof node?.checked === 'boolean' ? node.checked : null,
        markerStart: marker?.start ?? null,
        markerEnd: marker?.end ?? null,
        rawMarker: marker?.raw ?? null,
        lexicalKind: marker?.kind ?? null,
        lexicalOrdinal: marker?.ordinal ?? null,
        rawOrdinal: marker?.rawOrdinal ?? null,
        delimiter: marker?.delimiter ?? null,
        bullet: marker?.bullet ?? null,
        ownContentEmpty: !children(node).some(hasOwnContent),
        directChildListCount: children(node).filter((child) => child?.type === 'list').length
      };
      items.push(item);
      sourceOrder += 1;

      const visitNested = (candidate, nestedQuoteDepth) => {
        if (!candidate) return;
        if (candidate.type === 'list') {
          visitList(candidate, item, listDepth + 1, nestedQuoteDepth);
          return;
        }
        const nextQuoteDepth = nestedQuoteDepth
          + (candidate.type === 'blockquote' ? 1 : 0);
        children(candidate).forEach((child) => visitNested(child, nextQuoteDepth));
      };
      children(node).forEach((child) => visitNested(child, quoteDepth));
    });
  };

  const visitRoot = (node, quoteDepth = 0) => {
    if (!node) return;
    if (node.type === 'list') {
      visitList(node, null, 1, quoteDepth);
      return;
    }
    const nextQuoteDepth = quoteDepth + (node.type === 'blockquote' ? 1 : 0);
    children(node).forEach((child) => visitRoot(child, nextQuoteDepth));
  };
  visitRoot(tree);
  return items;
}

export const AST_LIST_ITEMS_FUNCTION_SOURCE = listItemsFromMarkdownAst.toString();

/**
 * Capture V1-only semantic list ownership and geometry. This intentionally is
 * separate from semanticListItemsFromDom so enriching lifecycle diagnostics
 * cannot alter O1's established normalized comparison contract.
 */
export function listLifecycleDomInventory(root) {
  const items = [];
  const lists = [];
  const childCounts = new Map();
  let rootCount = 0;
  let domOrder = 0;
  let listOrder = 0;

  const tag = (element) => String(element?.tagName || '').toUpperCase();
  const children = (element) => Array.from(element?.children || []);
  const isList = (element) => tag(element) === 'OL' || tag(element) === 'UL';
  const attribute = (element, name) => {
    if (!element) return null;
    if (typeof element.getAttribute === 'function') {
      const value = element.getAttribute(name);
      return value == null ? null : String(value);
    }
    return null;
  };
  const integerAttribute = (element, name) => {
    const raw = attribute(element, name);
    if (raw == null || !/^[+-]?\d+$/.test(raw.trim())) return null;
    const number = Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  };
  const rectangle = (element) => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    let value;
    try { value = element.getBoundingClientRect(); } catch { return null; }
    const number = (candidate) => {
      const parsed = Number(candidate);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const left = number(value?.left ?? value?.x);
    const top = number(value?.top ?? value?.y);
    const width = number(value?.width);
    const height = number(value?.height);
    const right = number(value?.right) ?? (left != null && width != null ? left + width : null);
    const bottom = number(value?.bottom) ?? (top != null && height != null ? top + height : null);
    if ([left, top, right, bottom, width, height].some((entry) => entry == null)) return null;
    return { x: left, y: top, left, top, right, bottom, width, height };
  };
  const reader = typeof globalThis !== 'undefined'
    && typeof globalThis.getComputedStyle === 'function'
    ? globalThis.getComputedStyle.bind(globalThis)
    : null;
  const styleValue = (style, property, cssProperty) => {
    if (!style) return null;
    const direct = style[property];
    if (direct != null && direct !== '') return String(direct);
    if (typeof style.getPropertyValue === 'function') {
      const value = style.getPropertyValue(cssProperty);
      if (value != null && value !== '') return String(value);
    }
    return null;
  };
  const hiddenStyle = (value) => value === 'none' || value === 'hidden' || value === 'collapse';
  const transparent = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'transparent') return true;
    const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)$/);
    return Boolean(rgba && Number(rgba[1]) === 0) || /^#[0-9a-f]{6}00$/i.test(normalized);
  };
  const visible = (element) => {
    const box = rectangle(element);
    if (!box || box.width <= 0 || box.height <= 0) return false;
    if (!reader) return true;
    let style = null;
    try { style = reader(element); } catch {}
    return !hiddenStyle(styleValue(style, 'display', 'display'))
      && !hiddenStyle(styleValue(style, 'visibility', 'visibility'))
      && styleValue(style, 'opacity', 'opacity') !== '0';
  };
  const nativeMarkerFacts = (item, list) => {
    if (!reader) return null;
    let itemStyle = null;
    let listStyle = null;
    let markerStyle = null;
    try { itemStyle = reader(item); } catch {}
    try { listStyle = reader(list); } catch {}
    try { markerStyle = reader(item, '::marker'); } catch {}
    const listStyleType = styleValue(itemStyle, 'listStyleType', 'list-style-type')
      || styleValue(listStyle, 'listStyleType', 'list-style-type');
    const markerColor = styleValue(markerStyle, 'color', 'color');
    const meaningful = String(listStyleType || '').trim();
    return {
      listStyleType: listStyleType || null,
      content: styleValue(markerStyle, 'content', 'content'),
      color: markerColor,
      rendered: visible(item)
        && styleValue(itemStyle, 'display', 'display') === 'list-item'
        && Boolean(meaningful && meaningful !== 'none'
          && meaningful.replace(/["'\s\u200b\u200c\u200d\ufeff]/g, ''))
        && !hiddenStyle(styleValue(markerStyle, 'display', 'display'))
        && !hiddenStyle(styleValue(markerStyle, 'visibility', 'visibility'))
        && styleValue(markerStyle, 'opacity', 'opacity') !== '0'
        && !transparent(markerColor)
    };
  };
  const directListItems = (list) => children(list).filter((child) => tag(child) === 'LI');
  const collectFirstLists = (element, result) => {
    if (!element) return result;
    if (isList(element)) {
      result.push(element);
      return result;
    }
    children(element).forEach((child) => collectFirstLists(child, result));
    return result;
  };
  const ownCheckbox = (item) => {
    const visit = (element) => {
      for (const child of children(element)) {
        if (isList(child) || tag(child) === 'LI') continue;
        if (tag(child) === 'INPUT'
          && String(attribute(child, 'type') || child.type || '').toLowerCase() === 'checkbox') {
          return child;
        }
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(item);
  };
  const hasClass = (element, className) => Boolean(element?.classList?.contains?.(className));
  const ignoredOwnContent = (element) => (
    isList(element)
    || tag(element) === 'INPUT'
    || hasClass(element, 'markdown-page-list-prefix')
    || hasClass(element, 'markdown-source-marker')
    || hasClass(element, 'markdown-source-indentation')
    || hasClass(element, 'markdown-source-line-break')
    || hasClass(element, 'markdown-source-block-gap')
  );
  const ownContentText = (item) => {
    const visit = (element) => {
      if (!element || ignoredOwnContent(element)) return '';
      const childNodes = Array.from(element?.childNodes || []);
      if (childNodes.length) {
        return childNodes.map((node) => {
          if (node?.nodeType === 3) return String(node.nodeValue || '');
          return visit(node);
        }).join('');
      }
      const elementChildren = children(element);
      if (elementChildren.length) return elementChildren.map(visit).join('');
      return String(element?.innerText ?? element?.textContent ?? '');
    };
    return children(item).map(visit).join('')
      .replace(/[\s\u200b\u200c\u200d\ufeff]+/g, '');
  };
  const allocatePath = (parentPath) => {
    if (parentPath == null) {
      const path = String(rootCount);
      rootCount += 1;
      return path;
    }
    const index = childCounts.get(parentPath) || 0;
    childCounts.set(parentPath, index + 1);
    return `${parentPath}.${index}`;
  };

  const visitList = (list, parentItem, listDepth) => {
    const parentPath = parentItem?.path ?? null;
    const parentSourceStart = parentItem?.sourceStart ?? null;
    const ordered = tag(list) === 'OL';
    const startNumber = ordered ? (integerAttribute(list, 'start') ?? 1) : null;
    const directItems = directListItems(list);
    const listPath = `list-${listOrder}`;
    lists.push({
      listPath,
      domOrder: listOrder,
      parentPath,
      parentSourceStart,
      sourceStart: integerAttribute(list, 'data-markdown-source-start'),
      sourceEnd: integerAttribute(list, 'data-markdown-source-end'),
      listDepth,
      ordered,
      directItemCount: directItems.length,
      rect: rectangle(list)
    });
    listOrder += 1;
    let nextOrdinal = startNumber;
    for (let siblingIndex = 0; siblingIndex < directItems.length; siblingIndex += 1) {
      const item = directItems[siblingIndex];
      const explicitValue = ordered ? integerAttribute(item, 'value') : null;
      const ordinal = ordered ? (explicitValue ?? nextOrdinal) : null;
      if (ordered) nextOrdinal = ordinal + 1;
      const path = allocatePath(parentPath);
      const sourceStart = integerAttribute(item, 'data-markdown-source-start');
      const checkbox = ownCheckbox(item);
      const entry = {
        path,
        parentPath,
        parentSourceStart,
        listPath,
        domOrder,
        siblingIndex,
        siblingCount: directItems.length,
        sourceStart,
        sourceEnd: integerAttribute(item, 'data-markdown-source-end'),
        listDepth,
        ordered,
        startNumber,
        explicitValue,
        ordinal,
        checked: checkbox ? Boolean(checkbox.checked) : null,
        ownContentEmpty: ownContentText(item).length === 0,
        rect: rectangle(item),
        nativeMarker: nativeMarkerFacts(item, list),
        taskMarker: checkbox ? {
          visible: visible(checkbox),
          rect: rectangle(checkbox)
        } : null
      };
      items.push(entry);
      domOrder += 1;
      const nestedLists = [];
      children(item).forEach((child) => collectFirstLists(child, nestedLists));
      nestedLists.forEach((nestedList) => visitList(nestedList, entry, listDepth + 1));
    }
  };

  const rootLists = [];
  collectFirstLists(root, rootLists);
  rootLists.forEach((list) => visitList(list, null, 1));
  return { lists, items };
}

export const LIST_LIFECYCLE_DOM_FUNCTION_SOURCE = listLifecycleDomInventory.toString();

/**
 * Evaluate V1's internal parser-AST -> semantic-LI -> effective-marker
 * lifecycle. Absolute pixels remain diagnostic; failures are based on source
 * ownership and sibling-local row-band collisions.
 */
export function evaluateListLifecycleIntegrity(input = {}) {
  const astItems = Array.isArray(input.astItems) ? input.astItems : [];
  const sourceItems = Array.isArray(input.sourceItems) ? input.sourceItems : [];
  const semanticItems = Array.isArray(input.semanticItems) ? input.semanticItems : [];
  const markers = Array.isArray(input.markers) ? input.markers : [];
  const astAvailable = input.astAvailable !== false;
  const epsilon = Number.isFinite(Number(input.geometryEpsilon))
    ? Math.max(0, Number(input.geometryEpsilon))
    : 0.5;
  const violations = [];
  const finiteStart = (value) => value != null && Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;
  const normalizedParent = (value) => finiteStart(value);
  const addViolation = (code, details = {}) => {
    violations.push({ code, ...details });
  };
  const groupedByStart = (entries, field) => {
    const grouped = new Map();
    entries.forEach((entry) => {
      const start = finiteStart(entry?.[field]);
      if (start == null) return;
      const values = grouped.get(start) || [];
      values.push(entry);
      grouped.set(start, values);
    });
    return grouped;
  };
  const astByStart = groupedByStart(astItems, 'sourceStart');
  const semanticByStart = groupedByStart(semanticItems, 'sourceStart');
  const astMarkerStarts = new Set(astItems
    .map((item) => finiteStart(item?.markerStart ?? item?.sourceStart))
    .filter((start) => start != null));
  const sourceMarkerStart = (item) => finiteStart(
    item?.markerStart ?? item?.markerRange?.start
  );
  const sourceOnlyItems = sourceItems.filter((item) => {
    const markerStart = sourceMarkerStart(item);
    return markerStart != null && !astMarkerStarts.has(markerStart);
  });

  if (!astAvailable) addViolation('parser-ast-unavailable');
  if (astItems.length !== semanticItems.length) {
    addViolation('ast-semantic-count-mismatch', {
      astItemCount: astItems.length,
      semanticItemCount: semanticItems.length
    });
  }
  for (const [sourceStart, entries] of astByStart) {
    if (entries.length > 1) {
      addViolation('duplicate-ast-source-owner', { sourceStart, count: entries.length });
    }
  }
  astItems.forEach((astItem) => {
    const sourceStart = finiteStart(astItem?.sourceStart);
    const matches = sourceStart == null ? [] : (semanticByStart.get(sourceStart) || []);
    if (matches.length === 0) {
      addViolation('missing-semantic-list-item', { sourceStart });
      return;
    }
    if (matches.length > 1) {
      addViolation('duplicate-semantic-list-item', { sourceStart, count: matches.length });
      return;
    }
    const semanticItem = matches[0];
    const astParent = normalizedParent(astItem?.parentSourceStart);
    const semanticParent = normalizedParent(semanticItem?.parentSourceStart);
    if (astParent !== semanticParent) {
      addViolation('semantic-parent-owner-mismatch', {
        sourceStart,
        expectedParentSourceStart: astParent,
        actualParentSourceStart: semanticParent
      });
    }
    if (Boolean(astItem?.ordered) !== Boolean(semanticItem?.ordered)) {
      addViolation('semantic-list-kind-mismatch', {
        sourceStart,
        expectedOrdered: Boolean(astItem?.ordered),
        actualOrdered: Boolean(semanticItem?.ordered)
      });
    }
    if (Number(astItem?.listDepth) !== Number(semanticItem?.listDepth)) {
      addViolation('semantic-list-depth-mismatch', {
        sourceStart,
        expectedListDepth: Number(astItem?.listDepth) || 0,
        actualListDepth: Number(semanticItem?.listDepth) || 0
      });
    }
  });
  semanticItems.forEach((semanticItem) => {
    const sourceStart = finiteStart(semanticItem?.sourceStart);
    if (sourceStart == null || !astByStart.has(sourceStart)) {
      addViolation('orphan-semantic-list-item', { sourceStart });
    }
  });

  const effectiveMarkers = markers.filter((marker) => marker?.effective === true);
  const presentationOnlyMarkers = markers.filter((marker) => marker?.presentationOnly === true);
  const visiblePresentationOnlyMarkers = presentationOnlyMarkers.filter((marker) => (
    marker?.presentationEffective === true
  ));
  const markersByAstStart = new Map();
  effectiveMarkers.forEach((marker) => {
    const astSourceStart = finiteStart(marker?.astSourceStart);
    const ownerSourceStart = finiteStart(marker?.ownerSourceStart);
    if (astSourceStart == null || !astByStart.has(astSourceStart)) {
      addViolation('orphan-effective-list-marker', {
        markerId: marker?.markerId ?? null,
        astSourceStart,
        ownerSourceStart
      });
      return;
    }
    if (ownerSourceStart !== astSourceStart) {
      addViolation('effective-marker-owner-mismatch', {
        markerId: marker?.markerId ?? null,
        astSourceStart,
        ownerSourceStart
      });
    }
    const owned = markersByAstStart.get(astSourceStart) || [];
    owned.push(marker);
    markersByAstStart.set(astSourceStart, owned);
  });
  astItems.forEach((astItem) => {
    const sourceStart = finiteStart(astItem?.sourceStart);
    const owned = sourceStart == null ? [] : (markersByAstStart.get(sourceStart) || []);
    if (owned.length === 0) {
      addViolation('missing-effective-list-marker', { sourceStart });
    } else if (owned.length > 1) {
      addViolation('duplicate-effective-list-marker', {
        sourceStart,
        markerIds: owned.map((marker) => marker?.markerId ?? null)
      });
    }
  });

  const presentationBySourceStart = groupedByStart(
    presentationOnlyMarkers,
    'presentationSourceStart'
  );
  const sourceOnlyStarts = new Set(sourceOnlyItems
    .map(sourceMarkerStart)
    .filter((start) => start != null));
  sourceOnlyItems.forEach((sourceItem) => {
    const presentationSourceStart = sourceMarkerStart(sourceItem);
    const owned = presentationSourceStart == null
      ? []
      : (presentationBySourceStart.get(presentationSourceStart) || []);
    // Regex-only source tokens are diagnostic candidates, not mandatory
    // presentation. The renderer may intentionally leave an indented lexical
    // token unrecognized (for example `1.A\n    1. B`). Once a decorated
    // marker candidate exists, however, it must be uniquely source-owned.
    if (owned.length > 1) {
      addViolation('duplicate-presentation-only-list-marker', {
        presentationSourceStart,
        presentationItemPath: sourceItem?.path ?? null,
        markerIds: owned.map((marker) => marker?.markerId ?? null)
      });
    }
  });
  presentationOnlyMarkers.forEach((marker) => {
    const presentationSourceStart = finiteStart(marker?.presentationSourceStart);
    if (presentationSourceStart == null || !sourceOnlyStarts.has(presentationSourceStart)) {
      addViolation('orphan-presentation-only-list-marker', {
        markerId: marker?.markerId ?? null,
        presentationSourceStart
      });
      return;
    }
    const sourceMatches = sourceOnlyItems.filter((sourceItem) => (
      sourceMarkerStart(sourceItem) === presentationSourceStart
    ));
    const sourceItem = sourceMatches.length === 1 ? sourceMatches[0] : null;
    const expectedTokenEnd = finiteStart(
      sourceItem?.markerEnd ?? sourceItem?.markerRange?.end
    );
    const tokenEnd = finiteStart(marker?.tokenEnd);
    const expectedPath = sourceItem?.path ?? null;
    const candidatePath = marker?.presentationItemPath ?? null;
    const expectedMarker = sourceItem?.rawMarker ?? null;
    const candidateMarker = marker?.displayedMarker ?? null;
    if (!sourceItem
      || tokenEnd !== expectedTokenEnd
      || (candidatePath != null && candidatePath !== expectedPath)
      || (candidateMarker != null && expectedMarker != null
        && candidateMarker !== expectedMarker)) {
      addViolation('presentation-only-marker-source-token-mismatch', {
        markerId: marker?.markerId ?? null,
        presentationSourceStart,
        expectedTokenEnd,
        tokenEnd,
        expectedPath,
        candidatePath
      });
    }
    const containmentEnd = tokenEnd ?? presentationSourceStart;
    const semanticContainers = astItems.filter((item) => {
      const start = finiteStart(item?.sourceStart);
      const end = finiteStart(item?.sourceEnd);
      return start != null && end != null
        && start <= presentationSourceStart && end >= containmentEnd;
    }).sort((left, right) => (
      (Number(right?.listDepth) || 0) - (Number(left?.listDepth) || 0)
      || (finiteStart(right?.sourceStart) || 0) - (finiteStart(left?.sourceStart) || 0)
    ));
    const expectedOwnerSourceStart = finiteStart(semanticContainers[0]?.sourceStart);
    const ownerSourceStart = finiteStart(marker?.ownerSourceStart);
    if (ownerSourceStart !== expectedOwnerSourceStart) {
      addViolation('presentation-only-marker-owner-mismatch', {
        markerId: marker?.markerId ?? null,
        presentationSourceStart,
        expectedOwnerSourceStart,
        ownerSourceStart
      });
    }
  });

  const validRect = (rect) => rect
    && [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height]
      .every((value) => Number.isFinite(Number(value)));
  const positiveHeightRect = (rect) => validRect(rect)
    && Number(rect.height) > 0
    && Number(rect.bottom) - Number(rect.top) > 0;
  semanticItems.forEach((item) => {
    const sourceStart = finiteStart(item?.sourceStart);
    if (!validRect(item?.rect)) {
      addViolation('semantic-list-item-geometry-missing', { sourceStart });
    } else if (!positiveHeightRect(item.rect)) {
      addViolation('semantic-list-item-geometry-nonpositive-height', {
        sourceStart,
        top: Number(item.rect.top),
        bottom: Number(item.rect.bottom),
        height: Number(item.rect.height)
      });
    }
  });
  effectiveMarkers.forEach((marker) => {
    if (!validRect(marker?.rect)) {
      addViolation('effective-marker-geometry-missing', {
        markerId: marker?.markerId ?? null,
        astSourceStart: finiteStart(marker?.astSourceStart)
      });
    }
  });
  visiblePresentationOnlyMarkers.forEach((marker) => {
    if (!validRect(marker?.rect)) {
      addViolation('presentation-only-marker-geometry-missing', {
        markerId: marker?.markerId ?? null,
        presentationSourceStart: finiteStart(marker?.presentationSourceStart)
      });
    }
  });
  // List rows may be horizontally disjoint because indentation, marker
  // placement, or wrapper geometry changes their x bands. Sibling ownership
  // makes vertical overlap alone the relevant signal for a collapsed row.
  const rowBandsCollide = (left, right) => (
    Math.min(Number(left.bottom), Number(right.bottom))
      - Math.max(Number(left.top), Number(right.top)) > epsilon
  );
  const siblingKey = (entry, astSourceStart = null) => {
    const astItem = astSourceStart == null
      ? null
      : (astByStart.get(astSourceStart) || [])[0];
    const parent = normalizedParent(astItem?.parentSourceStart ?? entry?.parentSourceStart);
    const depth = Number(astItem?.listDepth ?? entry?.listDepth) || 0;
    return `${parent == null ? 'root' : parent}:${depth}`;
  };
  const collisionGroups = (records, recordIdentity, astSourceFor, groupKeyFor = null) => {
    const eligible = records.filter((record) => validRect(record?.rect));
    const parent = eligible.map((_entry, index) => index);
    const find = (index) => {
      let cursor = index;
      while (parent[cursor] !== cursor) {
        parent[cursor] = parent[parent[cursor]];
        cursor = parent[cursor];
      }
      return cursor;
    };
    const union = (left, right) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
    };
    for (let left = 0; left < eligible.length; left += 1) {
      for (let right = left + 1; right < eligible.length; right += 1) {
        const leftStart = astSourceFor(eligible[left]);
        const rightStart = astSourceFor(eligible[right]);
        const leftGroup = groupKeyFor
          ? groupKeyFor(eligible[left])
          : siblingKey(eligible[left], leftStart);
        const rightGroup = groupKeyFor
          ? groupKeyFor(eligible[right])
          : siblingKey(eligible[right], rightStart);
        if (leftGroup !== rightGroup) {
          continue;
        }
        if (rowBandsCollide(eligible[left].rect, eligible[right].rect)) union(left, right);
      }
    }
    const groups = new Map();
    eligible.forEach((record, index) => {
      const root = find(index);
      const group = groups.get(root) || [];
      group.push(recordIdentity(record));
      groups.set(root, group);
    });
    return [...groups.values()].filter((group) => group.length > 1);
  };
  const itemCollisionGroups = collisionGroups(
    semanticItems,
    (item) => ({
      sourceStart: finiteStart(item?.sourceStart),
      parentSourceStart: normalizedParent(item?.parentSourceStart),
      listDepth: Number(item?.listDepth) || 0
    }),
    (item) => finiteStart(item?.sourceStart)
  );
  const markerCollisionGroups = collisionGroups(
    effectiveMarkers,
    (marker) => ({
      markerId: marker?.markerId ?? null,
      astSourceStart: finiteStart(marker?.astSourceStart),
      ownerSourceStart: finiteStart(marker?.ownerSourceStart)
    }),
    (marker) => finiteStart(marker?.astSourceStart)
  );
  const presentationMarkerCollisionGroups = collisionGroups(
    visiblePresentationOnlyMarkers,
    (marker) => ({
      markerId: marker?.markerId ?? null,
      presentationSourceStart: finiteStart(marker?.presentationSourceStart),
      ownerSourceStart: finiteStart(marker?.ownerSourceStart)
    }),
    () => null,
    (marker) => `${marker?.presentationParentPath ?? 'root'}:${
      Number(marker?.presentationListDepth) || 0
    }`
  );
  if (itemCollisionGroups.length) {
    addViolation('semantic-list-item-geometry-collision', { groups: itemCollisionGroups });
  }
  if (markerCollisionGroups.length) {
    addViolation('effective-marker-geometry-collision', { groups: markerCollisionGroups });
  }
  if (presentationMarkerCollisionGroups.length) {
    addViolation('presentation-only-marker-geometry-collision', {
      groups: presentationMarkerCollisionGroups
    });
  }

  return {
    valid: violations.length === 0,
    counts: {
      astItems: astItems.length,
      semanticItems: semanticItems.length,
      effectiveMarkers: effectiveMarkers.length,
      presentationOnlySourceItems: sourceOnlyItems.length,
      presentationOnlyMarkers: presentationOnlyMarkers.length,
      visiblePresentationOnlyMarkers: visiblePresentationOnlyMarkers.length
    },
    ownership: astItems.map((astItem) => {
      const sourceStart = finiteStart(astItem?.sourceStart);
      return {
        sourceStart,
        parentSourceStart: normalizedParent(astItem?.parentSourceStart),
        semanticMatches: sourceStart == null ? 0 : (semanticByStart.get(sourceStart) || []).length,
        effectiveMarkerMatches: sourceStart == null
          ? 0
          : (markersByAstStart.get(sourceStart) || []).length
      };
    }),
    presentationOwnership: sourceOnlyItems.map((sourceItem) => {
      const presentationSourceStart = sourceMarkerStart(sourceItem);
      const owned = presentationSourceStart == null
        ? []
        : (presentationBySourceStart.get(presentationSourceStart) || []);
      return {
        presentationSourceStart,
        presentationItemPath: sourceItem?.path ?? null,
        presentationParentPath: sourceItem?.parentPath ?? null,
        markerMatches: owned.length,
        visibleMarkerMatches: owned.filter((marker) => (
          marker?.presentationEffective === true
        )).length
      };
    }),
    geometry: {
      itemRows: semanticItems.map((item) => ({
        sourceStart: finiteStart(item?.sourceStart),
        parentSourceStart: normalizedParent(item?.parentSourceStart),
        listDepth: Number(item?.listDepth) || 0,
        rect: positiveHeightRect(item?.rect) ? item.rect : null
      })),
      markerRows: effectiveMarkers.map((marker) => ({
        markerId: marker?.markerId ?? null,
        astSourceStart: finiteStart(marker?.astSourceStart),
        ownerSourceStart: finiteStart(marker?.ownerSourceStart),
        kind: marker?.kind ?? null,
        rect: validRect(marker?.rect) ? marker.rect : null
      })),
      presentationMarkerRows: visiblePresentationOnlyMarkers.map((marker) => ({
        markerId: marker?.markerId ?? null,
        presentationSourceStart: finiteStart(marker?.presentationSourceStart),
        presentationItemPath: marker?.presentationItemPath ?? null,
        presentationParentPath: marker?.presentationParentPath ?? null,
        ownerSourceStart: finiteStart(marker?.ownerSourceStart),
        rect: validRect(marker?.rect) ? marker.rect : null
      })),
      itemCollisionGroups,
      markerCollisionGroups,
      presentationMarkerCollisionGroups
    },
    violations
  };
}

export const LIST_LIFECYCLE_INTEGRITY_FUNCTION_SOURCE = evaluateListLifecycleIntegrity.toString();
