(function initMarkdownPageModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.markdownPageModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const pageTypesModel = (() => {
    if (typeof globalThis !== 'undefined' && globalThis.pageTypesModel) {
      return globalThis.pageTypesModel;
    }
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // eslint-disable-next-line global-require
      return require('./pageTypes');
    }
    throw new Error('The shared Page Type model is unavailable.');
  })();
  const structuredTextCountModel = (() => {
    if (typeof globalThis !== 'undefined' && globalThis.structuredTextCountModel) {
      return globalThis.structuredTextCountModel;
    }
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // eslint-disable-next-line global-require
      return require('./structuredTextCount');
    }
    throw new Error('The shared structured-text Count model is unavailable.');
  })();
  const structuredTextFrameModel = (() => {
    if (typeof globalThis !== 'undefined' && globalThis.structuredTextFrameModel) {
      return globalThis.structuredTextFrameModel;
    }
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // eslint-disable-next-line global-require
      return require('./structuredTextFrame');
    }
    throw new Error('The shared structured-text frame model is unavailable.');
  })();
  const { PAGE_TYPES } = pageTypesModel;
  const MARKDOWN_MODES = Object.freeze({
    LIVE_PREVIEW: 'live-preview',
    SOURCE: 'source',
    READING: 'reading'
  });
  const {
    DEFAULT_TEXT_FRAME,
    normalizeTextFrame,
    validateTextFrame,
    validateTextFramePartial
  } = structuredTextFrameModel;
  const DEFAULT_SETTINGS = Object.freeze({
    lastMarkdownMode: MARKDOWN_MODES.LIVE_PREVIEW,
    preserveSingleLineBreaks: false
  });

  const normalizePageType = pageTypesModel.normalizePageType;

  function normalizeMarkdownMode(value) {
    return Object.values(MARKDOWN_MODES).includes(value)
      ? value
      : MARKDOWN_MODES.LIVE_PREVIEW;
  }

  function validateMarkdownMode(value) {
    return Object.values(MARKDOWN_MODES).includes(value)
      ? { ok: true, mode: value }
      : { ok: false, error: 'Unknown Markdown mode.' };
  }

  function normalizePreserveSingleLineBreaks(value) {
    return value === true;
  }

  function validatePreserveSingleLineBreaks(value) {
    return typeof value === 'boolean'
      ? { ok: true, preserveSingleLineBreaks: value }
      : { ok: false, error: 'Preserve Single Line Breaks must be a Boolean.' };
  }

  function normalizeSettings(value) {
    return {
      ...pageTypesModel.normalizeSettings(value),
      lastMarkdownMode: normalizeMarkdownMode(value?.lastMarkdownMode),
      preserveSingleLineBreaks: normalizePreserveSingleLineBreaks(
        value?.preserveSingleLineBreaks
      )
    };
  }

  function validateSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Markdown settings must be an object.' };
    }
    if (Object.hasOwn(value, 'defaultPageType')) {
      const pageTypeValidation = pageTypesModel.validateVaultDefaultPageType(
        value.defaultPageType
      );
      if (!pageTypeValidation.ok) return pageTypeValidation;
    }
    if (Object.hasOwn(value, 'lastMarkdownMode')) {
      const markdownModeValidation = validateMarkdownMode(value.lastMarkdownMode);
      if (!markdownModeValidation.ok) return markdownModeValidation;
    }
    if (Object.hasOwn(value, 'preserveSingleLineBreaks')) {
      const lineBreakValidation = validatePreserveSingleLineBreaks(
        value.preserveSingleLineBreaks
      );
      if (!lineBreakValidation.ok) return lineBreakValidation;
    }
    return { ok: true, settings: normalizeSettings(value) };
  }

  function normalizeMarkdownPageRecord(page) {
    page.markdownBody = typeof page.markdownBody === 'string' ? page.markdownBody : '';
    page.textFrame = normalizeTextFrame(page.textFrame);
    return page;
  }

  function normalizePage(page) {
    return pageTypesModel.normalizePageRecord(page);
  }

  pageTypesModel.registerPageType({
    id: PAGE_TYPES.MARKDOWN,
    label: 'Markdown',
    navigationBadge: 'MD',
    order: 20,
    rendererId: 'markdown',
    fileImportPlacementId: 'markdown-document',
    capabilities: ['canvas', 'page-edit', 'file-import', 'preview', 'structured-text'],
    vaultDefaultEligible: true,
    createContent: () => ({
      markdownBody: '',
      textFrame: normalizeTextFrame(null)
    }),
    normalizePage: normalizeMarkdownPageRecord,
    validatePage: (page) => {
      if (typeof page?.markdownBody !== 'string') {
        return { ok: false, error: 'Markdown body must be a string.' };
      }
      return validateTextFrame(page.textFrame);
    },
    partialSaveFields: {
      markdownBody: (value) => (typeof value === 'string'
        ? { ok: true, value }
        : { ok: false, error: 'Markdown body must be a string.' }),
      textFrame: (value, page) => validateTextFramePartial(value, page?.textFrame)
    }
  }, { replace: true });

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  let resolvedMarkdownRuntime = null;
  let resolvedMarkdownEditableFoundation = null;

  function markdownEditableFoundation() {
    if (resolvedMarkdownEditableFoundation) return resolvedMarkdownEditableFoundation;
    if (typeof globalThis !== 'undefined' && globalThis.markdownEditableFoundation) {
      resolvedMarkdownEditableFoundation = globalThis.markdownEditableFoundation;
      return resolvedMarkdownEditableFoundation;
    }
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // eslint-disable-next-line global-require
      resolvedMarkdownEditableFoundation = require('./markdownEditableFoundation');
      return resolvedMarkdownEditableFoundation;
    }
    throw new Error('The Markdown editable foundation is unavailable.');
  }

  function markdownRuntime() {
    if (resolvedMarkdownRuntime) return resolvedMarkdownRuntime;
    if (typeof globalThis !== 'undefined' && globalThis.markdownRuntime) {
      resolvedMarkdownRuntime = globalThis.markdownRuntime;
      return resolvedMarkdownRuntime;
    }
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // The browser receives this same runtime as a local UMD asset before this
      // file. Node tests/server consumers resolve the identical bundle here.
      // eslint-disable-next-line global-require
      resolvedMarkdownRuntime = require('./vendor/markdownRuntime');
      return resolvedMarkdownRuntime;
    }
    throw new Error('The locally bundled Markdown runtime is unavailable.');
  }

  function markdownQuoteBoundaryParseShadow(
    source,
    providedPhysicalLineIndex = null,
    providedQuoteLineSeed = null
  ) {
    const canonical = String(source || '');
    const physicalLineIndex = providedPhysicalLineIndex
      || markdownEditableFoundation().createPhysicalLineIndex(canonical);
    const quoteLineSeed = providedQuoteLineSeed
      || markdownEditableFoundation().createQuoteLineSeed(canonical, physicalLineIndex);
    const boundaries = quoteLineSeed.parserShadowInsertions;
    if (!boundaries.length) return { source: canonical, insertions: [] };
    const insertions = [];
    let cursor = 0;
    let shadow = '';
    boundaries.forEach((boundary) => {
      shadow += canonical.slice(cursor, boundary.offset);
      const shadowStart = shadow.length;
      shadow += boundary.value;
      insertions.push({
        offset: boundary.offset,
        shadowStart,
        shadowEnd: shadow.length,
        length: boundary.value.length
      });
      cursor = boundary.offset;
    });
    shadow += canonical.slice(cursor);
    return { source: shadow, insertions };
  }

  function markdownCanonicalOffsetFromParseShadow(offset, insertions) {
    const requested = Math.max(0, Number(offset) || 0);
    let insertedLength = 0;
    for (const insertion of insertions) {
      if (requested < insertion.shadowStart) break;
      if (requested <= insertion.shadowEnd) return insertion.offset;
      insertedLength += insertion.length;
    }
    return Math.max(0, requested - insertedLength);
  }

  function markdownSourcePointAtOffset(source, offset, providedPhysicalLineIndex = null) {
    const canonical = String(source || '');
    const bounded = Math.max(0, Math.min(canonical.length, Number(offset) || 0));
    const physicalLineIndex = providedPhysicalLineIndex
      || markdownEditableFoundation().createPhysicalLineIndex(canonical);
    const line = physicalLineIndex.lineAtOffset(bounded, 'after');
    return { line: line.index + 1, column: bounded - line.start + 1, offset: bounded };
  }

  function restoreMarkdownParseShadowPositions(
    tree,
    canonical,
    insertions,
    physicalLineIndex
  ) {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.position?.start && node.position?.end) {
        const start = markdownCanonicalOffsetFromParseShadow(
          node.position.start.offset,
          insertions
        );
        const end = markdownCanonicalOffsetFromParseShadow(
          node.position.end.offset,
          insertions
        );
        node.position.start = markdownSourcePointAtOffset(canonical, start, physicalLineIndex);
        node.position.end = markdownSourcePointAtOffset(canonical, end, physicalLineIndex);
      }
      (node.children || []).forEach(visit);
    };
    visit(tree);
    return tree;
  }

  function parseMarkdownDocument(source, options = {}) {
    const canonical = String(source ?? '');
    const physicalLineIndex = options?.lines
      ? options
      : options?.physicalLineIndex
        || markdownEditableFoundation().createPhysicalLineIndex(canonical);
    const quoteLineSeed = options?.quoteLineSeed
      || markdownEditableFoundation().createQuoteLineSeed(canonical, physicalLineIndex);
    const shadow = markdownQuoteBoundaryParseShadow(
      canonical,
      physicalLineIndex,
      quoteLineSeed
    );
    const tree = markdownRuntime().parseMarkdown(shadow.source);
    return shadow.insertions.length
      ? restoreMarkdownParseShadowPositions(
        tree,
        canonical,
        shadow.insertions,
        physicalLineIndex
      )
      : tree;
  }

  function safeLinkHref(value) {
    const href = String(value || '').trim();
    if (!href) return '';
    if (/^(?:#|\.{0,2}\/)/.test(href) || !/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    try {
      const parsed = new URL(href);
      return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? href : '';
    } catch {
      return '';
    }
  }

  function nodeStart(node, fallback = 0) {
    const value = Number(node?.position?.start?.offset);
    return Number.isFinite(value) ? value : fallback;
  }

  function nodeEnd(node, fallback = 0) {
    const value = Number(node?.position?.end?.offset);
    return Number.isFinite(value) ? value : fallback;
  }

  function sourceCharacterIsEscaped(source, index) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
      slashCount += 1;
    }
    return slashCount % 2 === 1;
  }

  function imageSourceRanges(source, node) {
    const canonical = String(source || '');
    const start = nodeStart(node, 0);
    const end = nodeEnd(node, start);
    const raw = canonical.slice(start, end);
    let nestedLabelDepth = 0;
    let labelEndIndex = -1;
    if (raw.startsWith('![')) {
      for (let index = 2; index < raw.length; index += 1) {
        if (sourceCharacterIsEscaped(raw, index)) continue;
        if (raw[index] === '[') nestedLabelDepth += 1;
        else if (raw[index] === ']') {
          if (nestedLabelDepth === 0) {
            labelEndIndex = index;
            break;
          }
          nestedLabelDepth -= 1;
        }
      }
    }
    const recognized = labelEndIndex >= 2;
    const altStart = recognized ? start + 2 : start;
    const altEnd = recognized ? start + labelEndIndex : start;
    return Object.freeze({
      recognized,
      start,
      end,
      raw,
      markerStart: start,
      markerEnd: altStart,
      altStart,
      altEnd,
      destinationStart: altEnd,
      destinationEnd: end
    });
  }

  function childContentRange(node) {
    const positioned = (node?.children || []).filter((child) => child?.position);
    if (!positioned.length) return { start: nodeStart(node), end: nodeEnd(node) };
    return {
      start: nodeStart(positioned[0], nodeStart(node)),
      end: nodeEnd(positioned[positioned.length - 1], nodeEnd(node))
    };
  }

  function codeFenceRanges(source, node) {
    const canonical = String(source || '');
    const start = nodeStart(node);
    const end = nodeEnd(node, start);
    const raw = canonical.slice(start, end);
    const firstLineBreak = raw.search(/\r?\n/);
    const openingLine = raw.slice(0, firstLineBreak < 0 ? raw.length : firstLineBreak);
    const opening = openingLine.match(/^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/);
    if (!opening) {
      return {
        fenced: false,
        start,
        end,
        bodyStart: start,
        bodyEnd: end,
        infoStart: start,
        infoEnd: start,
        marker: '',
        markerLength: 0
      };
    }
    const marker = opening[2][0];
    const markerLength = opening[2].length;
    const fenceStart = start + opening[1].length;
    const fenceEnd = fenceStart + markerLength;
    const suffixStart = fenceEnd;
    const suffix = opening[3] || '';
    const leading = suffix.match(/^[ \t]*/)?.[0].length || 0;
    const trailing = suffix.match(/[ \t]*$/)?.[0].length || 0;
    const infoStart = suffixStart + leading;
    const infoEnd = Math.max(infoStart, suffixStart + suffix.length - trailing);
    const openingBreakLength = firstLineBreak < 0
      ? 0
      : raw[firstLineBreak] === '\r' && raw[firstLineBreak + 1] === '\n' ? 2 : 1;
    const bodyStart = firstLineBreak < 0
      ? end
      : start + firstLineBreak + openingBreakLength;
    const lines = [...raw.matchAll(/(?:^|\r?\n)( {0,3})(`{3,}|~{3,})[ \t]*(?=\r?$)/gm)];
    const closing = firstLineBreak < 0
      ? null
      : [...lines].reverse().find((match) => (
        match[2][0] === marker
        && match[2].length >= markerLength
        && (match.index || 0) > firstLineBreak
      ));
    const closingStart = closing
      ? start + (closing.index || 0)
        + (raw[closing.index] === '\r' && raw[closing.index + 1] === '\n'
          ? 2
          : raw[closing.index] === '\n' ? 1 : 0)
      : end;
    return {
      fenced: true,
      start,
      end,
      fenceStart,
      fenceEnd,
      infoStart,
      infoEnd,
      bodyStart,
      bodyEnd: closingStart,
      closingStart,
      marker,
      markerLength
    };
  }

  function compatibilityBlock(source, node, editableListSemanticIndex = null) {
    const canonical = String(source || '');
    const start = nodeStart(node);
    const end = nodeEnd(node, start);
    const raw = canonical.slice(start, end);
    const content = childContentRange(node);
    const common = {
      node,
      start,
      end,
      raw,
      contentStart: content.start,
      contentEnd: content.end,
      source: canonical.slice(content.start, content.end)
    };
    if (node.type === 'heading') return { ...common, type: 'heading', level: node.depth };
    if (node.type === 'blockquote') return { ...common, type: 'quote', source: raw };
    if (node.type === 'thematicBreak') return { ...common, type: 'rule', source: '' };
    if (node.type === 'code') {
      const fence = codeFenceRanges(canonical, node);
      return {
        ...common,
        ...fence,
        type: 'code',
        language: node.lang || '',
        meta: node.meta || '',
        source: String(node.value || '')
      };
    }
    if (node.type === 'math') {
      const firstDelimiter = raw.indexOf('$$');
      const lastDelimiter = raw.lastIndexOf('$$');
      const valueStart = firstDelimiter < 0
        ? start
        : start + firstDelimiter + 2 + (/^\r?\n/.test(raw.slice(firstDelimiter + 2))
          ? raw.slice(firstDelimiter + 2).match(/^\r?\n/)[0].length : 0);
      const valueEnd = lastDelimiter > firstDelimiter
        ? start + lastDelimiter - (/\r?\n$/.test(raw.slice(0, lastDelimiter))
          ? raw.slice(0, lastDelimiter).match(/\r?\n$/)[0].length : 0)
        : end;
      return {
        ...common,
        type: 'math',
        source: String(node.value || ''),
        contentStart: valueStart,
        contentEnd: Math.max(valueStart, valueEnd)
      };
    }
    if (node.type === 'list') {
      const indexedList = editableListSemanticIndex?.astListForNode?.(node) || null;
      if (!indexedList) throw new Error('EditableListSemanticIndex missing parser list owner');
      const ordered = indexedList.ordered;
      return {
        ...common,
        type: ordered ? 'ordered-list' : 'unordered-list',
        orderedStart: indexedList.startNumber,
        items: (node.children || []).map((item) => readableNodeText(item)).filter(Boolean)
      };
    }
    if (node.type === 'table') {
      const rows = node.children || [];
      return {
        ...common,
        type: 'table',
        alignments: node.align || [],
        header: (rows[0]?.children || []).map((cell) => readableNodeText(cell)),
        rows: rows.slice(1).map((row) => (
          (row.children || []).map((cell) => readableNodeText(cell))
        ))
      };
    }
    return { ...common, type: node.type === 'paragraph' ? 'paragraph' : node.type };
  }

  function sourceBlocks(source) {
    const canonical = String(source || '');
    const snapshot = createMarkdownSourceSnapshot(canonical);
    const tree = snapshot.parserAst;
    return (tree.children || []).map((node) => compatibilityBlock(
      canonical,
      node,
      snapshot.editableListSemanticIndex
    ));
  }

  function definitionMap(tree) {
    const definitions = new Map();
    (tree.children || []).forEach((node) => {
      if (node.type !== 'definition') return;
      definitions.set(String(node.identifier || '').toLowerCase(), node);
    });
    return definitions;
  }

  const SAFE_INLINE_HTML = Object.freeze({
    u: 'u', sub: 'sub', sup: 'sup'
  });

  function normalizedHtmlTag(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^<\s*(\/?)\s*(u|sub|sup)\s*>$/i);
    if (!match) return null;
    return { closing: Boolean(match[1]), name: match[2].toLowerCase() };
  }

  function renderInlineNodes(nodes, context) {
    const list = Array.isArray(nodes) ? nodes : [];
    let html = '';
    for (let index = 0; index < list.length; index += 1) {
      const node = list[index];
      if (node.type === 'html') {
        if (/^<br\s*\/?>$/i.test(String(node.value || '').trim())) {
          html += '<br>';
          continue;
        }
        const tag = normalizedHtmlTag(node.value);
        if (tag && !tag.closing) {
          let depth = 1;
          let closeIndex = -1;
          for (let cursor = index + 1; cursor < list.length; cursor += 1) {
            const candidate = list[cursor].type === 'html'
              ? normalizedHtmlTag(list[cursor].value)
              : null;
            if (!candidate || candidate.name !== tag.name) continue;
            depth += candidate.closing ? -1 : 1;
            if (depth === 0) {
              closeIndex = cursor;
              break;
            }
          }
          if (closeIndex >= 0) {
            html += `<${SAFE_INLINE_HTML[tag.name]}>${renderInlineNodes(
              list.slice(index + 1, closeIndex), context
            )}</${SAFE_INLINE_HTML[tag.name]}>`;
            index = closeIndex;
            continue;
          }
        }
        html += escapeHtml(node.value);
        continue;
      }
      html += renderNode(node, context);
    }
    return html;
  }

  function renderCodeNode(node, context) {
    const raw = context.source.slice(nodeStart(node), nodeEnd(node));
    const fenced = /^(?: {0,3})(?:`{3,}|~{3,})/.test(raw);
    const highlighted = markdownRuntime().highlightCode(node.value || '', node.lang || '');
    const languageClass = highlighted.language
      ? ` language-${escapeHtml(highlighted.language)}`
      : '';
    const codeIcon = '<svg class="markdown-interaction-icon markdown-code-language-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m5.5 3.75-3.75 4.25 3.75 4.25M10.5 3.75 14.25 8l-3.75 4.25M9.25 2.5l-2.5 11"></path></svg>';
    const label = fenced
      ? `<span class="markdown-code-language-control is-display-only" data-markdown-semantic-only="true">${codeIcon}<span class="markdown-code-language-name">${escapeHtml(highlighted.displayName)}</span></span>`
      : '';
    return `<div class="markdown-page-code-shell${fenced ? ' is-fenced' : ' is-indented'}">${label}<pre class="markdown-page-code-block"><code class="hljs${languageClass}">${highlighted.html}</code></pre></div>`;
  }

  function renderImageSourceOnly(node, context) {
    const ranges = imageSourceRanges(context.source, node);
    const source = context.source;
    const segment = (className, start, end) => end > start
      ? `<span class="${className}">${escapeHtml(source.slice(start, end))}</span>`
      : '';
    return [
      '<span class="markdown-page-image-source-only" data-markdown-image-presentation="source-only">',
      segment(
        'markdown-source-marker markdown-page-image-source-marker is-symbol-group-2',
        ranges.markerStart,
        ranges.markerEnd
      ),
      segment('markdown-page-image-source-alt', ranges.altStart, ranges.altEnd),
      segment(
        'markdown-source-marker markdown-page-image-source-destination is-symbol-group-2',
        ranges.destinationStart,
        ranges.destinationEnd
      ),
      '</span>'
    ].join('');
  }

  function renderNode(node, context) {
    if (!node || typeof node !== 'object') return '';
    const children = () => renderInlineNodes(node.children || [], context);
    if (node.type === 'text') return escapeHtml(node.value);
    if (node.type === 'paragraph') return `<p>${children()}</p>`;
    if (node.type === 'heading') return `<h${node.depth}>${children()}</h${node.depth}>`;
    if (node.type === 'emphasis') return `<em>${children()}</em>`;
    if (node.type === 'strong') return `<strong>${children()}</strong>`;
    if (node.type === 'delete') return `<del>${children()}</del>`;
    if (node.type === 'inlineCode') {
      return `<code class="markdown-page-inline-code">${escapeHtml(node.value)}</code>`;
    }
    if (node.type === 'inlineMath') {
      return `<span class="markdown-math-inline" data-math-source="${escapeHtml(node.value)}">${markdownRuntime().renderLatex(node.value, { displayMode: false })}</span>`;
    }
    if (node.type === 'math') {
      return `<div class="markdown-math-display" data-math-source="${escapeHtml(node.value)}">${markdownRuntime().renderLatex(node.value, { displayMode: true })}</div>`;
    }
    if (node.type === 'break') return '<br>';
    if (node.type === 'blockquote') {
      return `<blockquote>${(node.children || []).map((child) => renderNode(child, context)).join('')}</blockquote>`;
    }
    if (node.type === 'thematicBreak') return '';
    if (node.type === 'list') {
      const indexedList = context.editableListSemanticIndex?.astListForNode?.(node) || null;
      if (!indexedList) throw new Error('EditableListSemanticIndex missing parser list owner');
      const ordered = indexedList.ordered;
      const startNumber = indexedList.startNumber;
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && Number(startNumber) !== 1 ? ` start="${Number(startNumber)}"` : '';
      return `<${tag}${start}>${(node.children || []).map((child) => renderNode(child, context)).join('')}</${tag}>`;
    }
    if (node.type === 'listItem') {
      const indexedItem = context.editableListSemanticIndex?.astListItemForNode?.(node) || null;
      if (!indexedItem) throw new Error('EditableListSemanticIndex missing parser list-item owner');
      const task = indexedItem.task;
      const checked = indexedItem.checked;
      const checkbox = task
        ? `<label class="filter-checkbox" data-markdown-semantic-only="true"><input type="checkbox" disabled${checked ? ' checked' : ''} aria-label="${checked ? 'Completed task' : 'Incomplete task'}"><span class="filter-checkbox-box" aria-hidden="true"></span></label>`
        : '';
      const className = task ? ' class="task-list-item"' : '';
      return `<li${className}>${checkbox}${(node.children || []).map((child) => renderNode(child, context)).join('')}</li>`;
    }
    if (node.type === 'link' || node.type === 'linkReference') {
      const definition = node.type === 'linkReference'
        ? context.definitions.get(String(node.identifier || '').toLowerCase())
        : node;
      const href = safeLinkHref(definition?.url);
      const content = children();
      if (!href) return content;
      const title = definition?.title ? ` title="${escapeHtml(definition.title)}"` : '';
      return `<a href="${escapeHtml(href)}"${title} rel="noreferrer">${content}</a>`;
    }
    if (node.type === 'image' || node.type === 'imageReference') {
      return renderImageSourceOnly(node, context);
    }
    if (node.type === 'table') {
      const rows = node.children || [];
      const renderRow = (row, header = false) => `<tr>${(row.children || []).map((cell, index) => {
        const tag = header ? 'th' : 'td';
        const alignment = node.align?.[index] ? ` style="text-align:${node.align[index]}"` : '';
        return `<${tag}${alignment}>${renderInlineNodes(cell.children || [], context)}</${tag}>`;
      }).join('')}</tr>`;
      const head = rows.length ? `<thead>${renderRow(rows[0], true)}</thead>` : '';
      const body = `<tbody>${rows.slice(1).map((row) => renderRow(row)).join('')}</tbody>`;
      return `<table>${head}${body}</table>`;
    }
    if (node.type === 'code') return renderCodeNode(node, context);
    if (node.type === 'definition') return '';
    if (node.type === 'html') return escapeHtml(node.value);
    if (node.children) return renderInlineNodes(node.children, context);
    const start = nodeStart(node);
    const end = nodeEnd(node, start);
    return escapeHtml(context.source.slice(start, end));
  }

  function renderMarkdown(source) {
    const canonical = String(source || '');
    const snapshot = createMarkdownSourceSnapshot(canonical);
    const tree = snapshot.parserAst;
    const context = {
      source: canonical,
      definitions: definitionMap(tree),
      editableListSemanticIndex: snapshot.editableListSemanticIndex
    };
    return (tree.children || []).map((node) => renderNode(node, context)).join('');
  }

  function inlineMarkup(source) {
    const canonical = String(source || '');
    const snapshot = createMarkdownSourceSnapshot(canonical);
    const tree = snapshot.parserAst;
    const context = {
      source: canonical,
      definitions: definitionMap(tree),
      editableListSemanticIndex: snapshot.editableListSemanticIndex
    };
    const paragraph = (tree.children || []).find((node) => node.type === 'paragraph');
    return paragraph ? renderInlineNodes(paragraph.children || [], context) : renderMarkdown(canonical);
  }

  function nextInlineConstruct(source, fromIndex = 0) {
    const canonical = String(source || '');
    const underlineIndex = canonical.indexOf('<u>', Math.max(0, fromIndex));
    if (underlineIndex >= 0) {
      const close = canonical.indexOf('</u>', underlineIndex + 3);
      if (close >= underlineIndex + 3) {
        return {
          kind: 'underline', index: underlineIndex, end: close + 4,
          open: '<u>', close: '</u>',
          content: canonical.slice(underlineIndex + 3, close),
          contentStart: underlineIndex + 3
        };
      }
    }
    const tree = parseMarkdownDocument(canonical);
    const kinds = {
      inlineCode: 'code', inlineMath: 'math', link: 'link', linkReference: 'link',
      strong: 'strong', emphasis: 'emphasis', delete: 'strike'
    };
    const candidates = [];
    const visit = (node) => {
      const kind = kinds[node?.type];
      const start = nodeStart(node, -1);
      const end = nodeEnd(node, -1);
      if (kind && start >= fromIndex && end > start) candidates.push({ node, kind, start, end });
      (node?.children || []).forEach(visit);
    };
    visit(tree);
    candidates.sort((left, right) => left.start - right.start || right.end - left.end);
    const match = candidates[0];
    if (!match) return null;
    const content = childContentRange(match.node);
    const contentStart = match.node.type === 'inlineCode' || match.node.type === 'inlineMath'
      ? match.start + canonical.slice(match.start, match.end).match(/^[`$]+/)?.[0].length
      : content.start;
    const contentEnd = match.node.type === 'inlineCode' || match.node.type === 'inlineMath'
      ? match.end - canonical.slice(match.start, match.end).match(/[`$]+$/)?.[0].length
      : content.end;
    return {
      kind: match.kind,
      index: match.start,
      end: match.end,
      open: canonical.slice(match.start, contentStart),
      close: canonical.slice(contentEnd, match.end),
      content: canonical.slice(contentStart, contentEnd),
      contentStart,
      ...(match.node.url ? { href: match.node.url } : {})
    };
  }

  function splitTableRow(source) {
    const line = String(source || '');
    const cells = [];
    let current = '';
    let escaped = false;
    let codeFence = '';
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (escaped) {
        current += character;
        escaped = false;
        continue;
      }
      if (character === '\\') {
        current += character;
        escaped = true;
        continue;
      }
      if (character === '`') {
        const run = line.slice(index).match(/^`+/)?.[0] || '`';
        if (!codeFence) codeFence = run;
        else if (run === codeFence) codeFence = '';
        current += run;
        index += run.length - 1;
        continue;
      }
      if (character === '|' && !codeFence) {
        cells.push(current);
        current = '';
      } else current += character;
    }
    cells.push(current);
    if (/^\s*$/.test(cells[0] || '') && line.trimStart().startsWith('|')) cells.shift();
    if (/^\s*$/.test(cells.at(-1) || '') && line.trimEnd().endsWith('|')) cells.pop();
    return cells.map((cell) => cell.trim());
  }

  function normalizedTableAlignment(value) {
    if (value === 'centre') return 'center';
    return ['left', 'center', 'right'].includes(value) ? value : null;
  }

  function markdownTableNodes(tree) {
    const tables = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'table') tables.push(node);
      (node.children || []).forEach(visit);
    };
    visit(tree);
    return tables;
  }

  function markdownTableNodeAt(source, requestedStart) {
    const tables = markdownTableNodes(parseMarkdownDocument(source));
    if (!tables.length) return null;
    const offset = Number(requestedStart);
    if (!Number.isFinite(offset)) return tables[0];
    const exact = tables.find((table) => nodeStart(table, -1) === offset);
    if (exact) return exact;
    const containing = tables.filter((table) => (
      nodeStart(table, -1) <= offset && offset < nodeEnd(table, -1)
    )).sort((left, right) => (
      (nodeEnd(left) - nodeStart(left)) - (nodeEnd(right) - nodeStart(right))
    ));
    if (containing.length) return containing[0];
    return tables.length === 1 ? tables[0] : null;
  }

  function tableContinuationPrefix(source, tableNode) {
    const canonical = String(source || '');
    const physicalLineIndex = markdownEditableFoundation().createPhysicalLineIndex(canonical);
    const rows = tableNode?.children || [];
    const headerEnd = nodeEnd(rows[0], nodeStart(tableNode));
    const headerLine = physicalLineIndex.lineAtOffset(
      Math.max(nodeStart(tableNode), headerEnd - 1),
      'before'
    );
    const separatorPhysicalLine = physicalLineIndex.lines[headerLine.index + 1] || headerLine;
    const separatorLine = canonical.slice(
      separatorPhysicalLine.start,
      separatorPhysicalLine.contentEnd
    );
    const separatorPrefix = separatorLine.match(
      /^(.*?)(?=\|?[ \t]*:?-+:?[ \t]*(?:\||$))/
    )?.[1];
    if (typeof separatorPrefix === 'string') return separatorPrefix;
    const firstBodyRow = rows[1];
    if (!firstBodyRow) return '';
    const bodyStart = nodeStart(firstBodyRow);
    const bodyLine = physicalLineIndex.lineAtOffset(bodyStart, 'after');
    return canonical.slice(bodyLine.start, bodyStart);
  }

  function tableCellContent(source, cellNode) {
    const canonical = String(source || '');
    const outerStart = nodeStart(cellNode);
    const outerEnd = nodeEnd(cellNode, outerStart);
    const positioned = (cellNode?.children || []).filter((child) => child?.position);
    let start;
    let end;
    if (positioned.length) {
      start = nodeStart(positioned[0], outerStart);
      end = nodeEnd(positioned[positioned.length - 1], start);
    } else {
      start = outerStart;
      end = outerEnd;
      if (canonical[start] === '|') start += 1;
      if (end > start && canonical[end - 1] === '|') end -= 1;
      while (start < end && /[ \t]/.test(canonical[start])) start += 1;
      while (end > start && /[ \t]/.test(canonical[end - 1])) end -= 1;
    }
    const cellSource = canonical.slice(start, end);
    const readable = normalizedMarkdownTableSortText(readableNodeText(cellNode));
    return Object.freeze({
      source: cellSource,
      sortText: readable || normalizedMarkdownTableSortText(cellSource),
      start,
      end,
      outerStart,
      outerEnd
    });
  }

  function emptyMarkdownTableCell() {
    return Object.freeze({
      source: '',
      sortText: '',
      start: null,
      end: null,
      outerStart: null,
      outerEnd: null
    });
  }

  function paddedMarkdownTableCells(cells, columnCount) {
    const padded = [...cells];
    while (padded.length < columnCount) padded.push(emptyMarkdownTableCell());
    return Object.freeze(padded);
  }

  function parseMarkdownTableStructure(markdownBody, tableStart = null) {
    const canonical = String(markdownBody || '');
    const tableNode = markdownTableNodeAt(canonical, tableStart);
    if (!tableNode) return null;
    const start = nodeStart(tableNode);
    const end = nodeEnd(tableNode, start);
    const astRows = tableNode.children || [];
    const rawHeader = (astRows[0]?.children || []).map((cell) => (
      tableCellContent(canonical, cell)
    ));
    const rawRows = astRows.slice(1).map((row) => (
      (row.children || []).map((cell) => tableCellContent(canonical, cell))
    ));
    const rawAlignments = Array.from(tableNode.align || [], normalizedTableAlignment);
    const columnCount = Math.max(
      1,
      rawHeader.length,
      rawAlignments.length,
      ...rawRows.map((row) => row.length)
    );
    const header = paddedMarkdownTableCells(rawHeader, columnCount);
    const rows = Object.freeze(rawRows.map((row) => (
      paddedMarkdownTableCells(row, columnCount)
    )));
    const alignments = Object.freeze(Array.from(
      { length: columnCount },
      (_unused, index) => normalizedTableAlignment(rawAlignments[index])
    ));
    const raw = canonical.slice(start, end);
    const lineEnding = raw.match(/\r\n|\n|\r/)?.[0] || '\n';
    return Object.freeze({
      type: 'markdown-table',
      start,
      end,
      sourceRange: Object.freeze({ start, end }),
      raw,
      lineEnding,
      continuationPrefix: tableContinuationPrefix(canonical, tableNode),
      columnCount,
      header,
      alignments,
      rows
    });
  }

  function markdownTableCellSource(cell) {
    if (typeof cell === 'string') return cell;
    return typeof cell?.source === 'string' ? cell.source : '';
  }

  function markdownTableAlignmentMarker(alignment) {
    if (normalizedTableAlignment(alignment) === 'left') return ':---';
    if (normalizedTableAlignment(alignment) === 'center') return ':---:';
    if (normalizedTableAlignment(alignment) === 'right') return '---:';
    return '---';
  }

  function serializeMarkdownTableStructure(table) {
    if (!table || typeof table !== 'object') return '';
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const header = Array.isArray(table.header) ? table.header : [];
    const alignments = Array.isArray(table.alignments) ? table.alignments : [];
    const columnCount = Math.max(
      1,
      Number.isInteger(table.columnCount) ? table.columnCount : 0,
      header.length,
      alignments.length,
      ...rows.map((row) => Array.isArray(row) ? row.length : 0)
    );
    const rowSource = (cells) => {
      const values = Array.from({ length: columnCount }, (_unused, index) => (
        markdownTableCellSource(cells?.[index])
      ));
      return `| ${values.join(' | ')} |`;
    };
    const lines = [
      rowSource(header),
      rowSource(Array.from({ length: columnCount }, (_unused, index) => (
        markdownTableAlignmentMarker(alignments[index])
      ))),
      ...rows.map((row) => rowSource(row))
    ];
    const lineEnding = ['\r\n', '\n', '\r'].includes(table.lineEnding)
      ? table.lineEnding
      : '\n';
    const continuationPrefix = typeof table.continuationPrefix === 'string'
      ? table.continuationPrefix
      : '';
    return lines.map((line, index) => (
      index === 0 ? line : `${continuationPrefix}${line}`
    )).join(lineEnding);
  }

  function clonedMarkdownTableCell(cell) {
    return { ...cell, source: markdownTableCellSource(cell) };
  }

  function mutableMarkdownTableStructure(table) {
    return {
      ...table,
      header: table.header.map(clonedMarkdownTableCell),
      alignments: [...table.alignments],
      rows: table.rows.map((row) => row.map(clonedMarkdownTableCell))
    };
  }

  function boundedInteger(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || maximum < minimum
      || number < minimum || number > maximum) return null;
    return number;
  }

  const markdownTableAlphabeticalCollator = new Intl.Collator('en-US', {
    usage: 'sort',
    sensitivity: 'base',
    numeric: false,
    ignorePunctuation: false
  });

  function normalizedMarkdownTableSortText(value) {
    return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  }

  function markdownTableCellSortText(cell) {
    if (typeof cell?.sortText === 'string') {
      return normalizedMarkdownTableSortText(cell.sortText);
    }
    return normalizedMarkdownTableSortText(markdownTableCellSource(cell));
  }

  function markdownTableNumericSortValue(text) {
    const normalized = normalizedMarkdownTableSortText(text);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
      return null;
    }
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function sortedMarkdownTableEntries(entries, operation) {
    const sort = operation?.sort;
    const direction = operation?.direction;
    if (!['alphabetical', 'numeric'].includes(sort)
      || !['asc', 'desc'].includes(direction)) return null;
    const directionFactor = direction === 'desc' ? -1 : 1;
    return entries.map((entry, originalIndex) => {
      const text = markdownTableCellSortText(entry.cell);
      return {
        ...entry,
        originalIndex,
        text,
        numericValue: sort === 'numeric' ? markdownTableNumericSortValue(text) : null
      };
    }).sort((left, right) => {
      if (sort === 'alphabetical') {
        const leftEmpty = left.text.length === 0;
        const rightEmpty = right.text.length === 0;
        if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
        if (!leftEmpty) {
          const compared = markdownTableAlphabeticalCollator.compare(left.text, right.text);
          if (compared) return compared * directionFactor;
        }
        return left.originalIndex - right.originalIndex;
      }
      const leftRank = left.numericValue !== null ? 0 : left.text ? 1 : 2;
      const rightRank = right.numericValue !== null ? 0 : right.text ? 1 : 2;
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (leftRank === 0 && left.numericValue !== right.numericValue) {
        return (left.numericValue < right.numericValue ? -1 : 1) * directionFactor;
      }
      return left.originalIndex - right.originalIndex;
    });
  }

  function markdownTableOrderChanged(sorted, originalIndexes) {
    return sorted.some((entry, index) => entry.index !== originalIndexes[index]);
  }

  function applyMarkdownTableColumnOrder(table, columnOrder) {
    table.header = columnOrder.map((index) => table.header[index]);
    table.alignments = columnOrder.map((index) => table.alignments[index]);
    table.rows = table.rows.map((row) => columnOrder.map((index) => row[index]));
  }

  function applyMarkdownTableStructureOperation(table, operation = {}) {
    const next = mutableMarkdownTableStructure(table);
    const type = String(operation?.type || '');
    let changed = false;
    if (type === 'append-row' || type === 'insert-row') {
      const index = type === 'append-row'
        ? next.rows.length
        : boundedInteger(operation.index, 0, next.rows.length);
      if (index === null) return { ok: false, changed: false, table };
      next.rows.splice(index, 0, Array.from(
        { length: next.columnCount },
        () => ({ ...emptyMarkdownTableCell() })
      ));
      changed = true;
    } else if (type === 'move-row') {
      const fromIndex = boundedInteger(operation.fromIndex, 0, next.rows.length - 1);
      const toIndex = boundedInteger(operation.toIndex, 0, next.rows.length - 1);
      if (fromIndex === null || toIndex === null) {
        return { ok: false, changed: false, table };
      }
      if (fromIndex !== toIndex) {
        const [row] = next.rows.splice(fromIndex, 1);
        next.rows.splice(toIndex, 0, row);
        changed = true;
      }
    } else if (type === 'append-column' || type === 'insert-column') {
      const index = type === 'append-column'
        ? next.columnCount
        : boundedInteger(operation.index, 0, next.columnCount);
      if (index === null) return { ok: false, changed: false, table };
      next.header.splice(index, 0, { ...emptyMarkdownTableCell() });
      next.alignments.splice(index, 0, null);
      next.rows.forEach((row) => row.splice(index, 0, { ...emptyMarkdownTableCell() }));
      next.columnCount += 1;
      changed = true;
    } else if (type === 'move-column') {
      const fromIndex = boundedInteger(operation.fromIndex, 0, next.columnCount - 1);
      const toIndex = boundedInteger(operation.toIndex, 0, next.columnCount - 1);
      if (fromIndex === null || toIndex === null) {
        return { ok: false, changed: false, table };
      }
      if (fromIndex !== toIndex) {
        const [header] = next.header.splice(fromIndex, 1);
        next.header.splice(toIndex, 0, header);
        const [alignment] = next.alignments.splice(fromIndex, 1);
        next.alignments.splice(toIndex, 0, alignment);
        next.rows.forEach((row) => {
          const [cell] = row.splice(fromIndex, 1);
          row.splice(toIndex, 0, cell);
        });
        changed = true;
      }
    } else if (type === 'set-alignment') {
      const columnIndex = boundedInteger(operation.columnIndex, 0, next.columnCount - 1);
      const requestedAlignment = operation.alignment;
      if (columnIndex === null || (requestedAlignment !== null
        && !['left', 'center', 'centre', 'right'].includes(requestedAlignment))) {
        return { ok: false, changed: false, table };
      }
      const alignment = normalizedTableAlignment(requestedAlignment);
      if (next.alignments[columnIndex] !== alignment) {
        next.alignments[columnIndex] = alignment;
        changed = true;
      }
    } else if (type === 'sort-rows') {
      const columnIndex = boundedInteger(operation.columnIndex, 0, next.columnCount - 1);
      if (columnIndex === null) return { ok: false, changed: false, table };
      const entries = next.rows.map((row, index) => ({ index, row, cell: row[columnIndex] }));
      const sorted = sortedMarkdownTableEntries(entries, operation);
      if (!sorted) return { ok: false, changed: false, table };
      const originalIndexes = entries.map((entry) => entry.index);
      changed = markdownTableOrderChanged(sorted, originalIndexes);
      if (changed) next.rows = sorted.map((entry) => entry.row);
    } else if (type === 'sort-columns') {
      const rowIndex = boundedInteger(operation.rowIndex, -1, next.rows.length - 1);
      if (rowIndex === null) return { ok: false, changed: false, table };
      const anchor = rowIndex === -1 ? next.header : next.rows[rowIndex];
      const entries = Array.from(
        { length: Math.max(0, next.columnCount - 1) },
        (_unused, index) => ({ index: index + 1, cell: anchor[index + 1] })
      );
      const sorted = sortedMarkdownTableEntries(entries, operation);
      if (!sorted) return { ok: false, changed: false, table };
      const originalIndexes = entries.map((entry) => entry.index);
      changed = markdownTableOrderChanged(sorted, originalIndexes);
      if (changed) applyMarkdownTableColumnOrder(next, [
        0,
        ...sorted.map((entry) => entry.index)
      ]);
    } else {
      return { ok: false, changed: false, table };
    }
    return { ok: true, changed, table: next };
  }

  function applyMarkdownTableOperation(markdownBody, tableStart, operation) {
    const canonical = String(markdownBody || '');
    const table = parseMarkdownTableStructure(canonical, tableStart);
    if (!table) {
      return Object.freeze({
        ok: false,
        changed: false,
        source: canonical,
        markdownBody: canonical,
        replacement: '',
        start: null,
        end: null,
        nextEnd: null,
        table: null
      });
    }
    const result = applyMarkdownTableStructureOperation(table, operation);
    if (!result.ok || !result.changed) {
      return Object.freeze({
        ok: result.ok,
        changed: false,
        source: canonical,
        markdownBody: canonical,
        replacement: table.raw,
        start: table.start,
        end: table.end,
        nextEnd: table.end,
        table
      });
    }
    const replacement = serializeMarkdownTableStructure(result.table);
    const source = `${canonical.slice(0, table.start)}${replacement}${canonical.slice(table.end)}`;
    const nextTable = parseMarkdownTableStructure(source, table.start);
    return Object.freeze({
      ok: true,
      changed: source !== canonical,
      source,
      markdownBody: source,
      replacement,
      start: table.start,
      end: table.end,
      nextEnd: nextTable?.end ?? table.start + replacement.length,
      table: nextTable
    });
  }


  const LATEX_READABLE_COMMANDS = Object.freeze({
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
    tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
    Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ',
    Omega: 'Ω', infty: '∞', partial: '∂', nabla: '∇', pm: '±', times: '×',
    div: '÷', cdot: '⋅', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠',
    neq: '≠', approx: '≈', equiv: '≡', to: '→', rightarrow: '→',
    leftarrow: '←', leftrightarrow: '↔', sum: '∑', prod: '∏', int: '∫'
  });

  function latexReadableText(source) {
    let text = String(source || '');
    // Resolve the common argument-bearing constructs from the inside out so
    // statistics reflect their visible operands rather than TeX commands.
    for (let pass = 0; pass < 6; pass += 1) {
      const next = text
        .replace(/\\(?:d?frac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1 $2')
        .replace(/\\sqrt(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, '√$1')
        .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1');
      if (next === text) break;
      text = next;
    }
    text = text.replace(/\\([A-Za-z]+)\b/g, (_match, command) => (
      Object.hasOwn(LATEX_READABLE_COMMANDS, command)
        ? LATEX_READABLE_COMMANDS[command]
        : ' '
    ));
    return text
      .replace(/\\(?:left|right)\s*/g, '')
      .replace(/\\[,;:!]/g, ' ')
      .replace(/[{}]/g, '')
      .replace(/[_^]/g, ' ')
      .replace(/\\/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function readableNodeText(node) {
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      return String(node.value || '');
    }
    if (node.type === 'inlineMath' || node.type === 'math') {
      return latexReadableText(node.value);
    }
    if (node.type === 'image' || node.type === 'imageReference') return String(node.alt || '');
    if (node.type === 'break') return '\n';
    if (node.type === 'thematicBreak' || node.type === 'definition') return '';
    if (node.type === 'html') {
      return /^<br\s*\/?>$/i.test(String(node.value || '').trim()) ? '\n' : '';
    }
    if (node.type === 'table') {
      return (node.children || []).map((row) => (
        (row.children || []).map((cell) => readableNodeText(cell)).join(' ')
      )).join('\n');
    }
    const separator = ['root', 'blockquote', 'list', 'listItem'].includes(node.type)
      ? '\n'
      : '';
    return (node.children || []).map((child) => readableNodeText(child)).join(separator);
  }

  function readableBlockText(block) {
    if (!block?.node) return '';
    return readableNodeText(block.node).trim();
  }

  function readableInlineText(source) {
    const tree = parseMarkdownDocument(String(source || ''));
    return readableNodeText(tree).trim();
  }

  function readableText(source) {
    const tree = parseMarkdownDocument(String(source || ''));
    return (tree.children || []).map((node) => readableNodeText(node).trim())
      .filter(Boolean).join('\n');
  }

  function statistics(source) {
    const blocks = sourceBlocks(source);
    const visibleBlocks = blocks.map(readableBlockText).filter(Boolean);
    return structuredTextCountModel.statisticsFromTextBlocks(visibleBlocks);
  }

  function markdownBodyHasMeaning(source) {
    const body = String(source || '');
    const blocks = sourceBlocks(body);
    if (blocks.some((block) => block.type === 'rule')) return true;
    if (blocks.some((block) => readableBlockText(block))) return true;
    const tree = parseMarkdownDocument(body);
    const stack = [...(tree.children || [])];
    while (stack.length) {
      const node = stack.pop();
      if (node?.type === 'image' || node?.type === 'imageReference') return true;
      stack.push(...(node?.children || []));
    }
    return false;
  }

  const DISPLAYABLE_IMAGE_MIMES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'image/bmp', 'image/tiff', 'image/avif', 'image/heic', 'image/heif'
  ]);

  function resourceMayDisplay(resource) {
    if (!resource || typeof resource !== 'object') return false;
    if (resource.displayable === true) return true;
    const mime = String(resource.mimeType || resource.type || '').toLowerCase();
    if (DISPLAYABLE_IMAGE_MIMES.has(mime)) return true;
    const filename = String(resource.originalName || resource.filename
      || resource.name || resource.src || resource.location?.relativePath || '').toLowerCase();
    return /\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic)$/i.test(filename);
  }

  function canvasMarkdownConversionEligibility(page, targetType) {
    const target = normalizePageType(targetType);
    const source = normalizePageType(page?.type);
    const supportedPair = (source === PAGE_TYPES.CANVAS && target === PAGE_TYPES.MARKDOWN)
      || (source === PAGE_TYPES.MARKDOWN && target === PAGE_TYPES.CANVAS);
    if (!supportedPair) {
      return { allowed: false, reasons: [`Conversion from ${source} to ${target} is not supported.`] };
    }
    const reasons = [];
    if (source === PAGE_TYPES.MARKDOWN && markdownBodyHasMeaning(page?.markdownBody)) {
      reasons.push('Markdown body contains meaningful content.');
    }
    if (Array.isArray(page?.objects) && page.objects.length) {
      reasons.push('Canvas Objects require visual placement.');
    }
    if (Array.isArray(page?.blocks) && page.blocks.length) {
      reasons.push('Blocks require Canvas geometry.');
    }
    if (Array.isArray(page?.highlightGroups) && page.highlightGroups.length) {
      reasons.push('Highlight Groups depend on Blocks.');
    }
    if ((page?.externalLinks || []).some((link) => typeof link?.sourceBlockId === 'string'
      && link.sourceBlockId)) {
      reasons.push('A Block-owned External Link requires its Block.');
    }
    if ((page?.maintenanceResources || []).some(resourceMayDisplay)) {
      reasons.push('A display-capable resource requires visual placement.');
    }
    return { allowed: reasons.length === 0, reasons };
  }

  function convertCanvasMarkdownPage(page, targetType) {
    const target = normalizePageType(targetType);
    const eligibility = canvasMarkdownConversionEligibility(page, target);
    if (!eligibility.allowed) return { ok: false, ...eligibility };
    const converted = { ...page, type: target };
    if (target === PAGE_TYPES.MARKDOWN) {
      converted.markdownBody = '';
      converted.textFrame = normalizeTextFrame(null);
    } else {
      delete converted.markdownBody;
      delete converted.textFrame;
    }
    return { ok: true, allowed: true, reasons: [], page: converted };
  }

  function markdownHnConversionEligibility(page, targetType) {
    const target = normalizePageType(targetType);
    const source = normalizePageType(page?.type);
    const supportedPair = (source === PAGE_TYPES.MARKDOWN && target === PAGE_TYPES.HN_TEXT)
      || (source === PAGE_TYPES.HN_TEXT && target === PAGE_TYPES.MARKDOWN);
    if (!supportedPair) {
      return { allowed: false, reasons: [`Conversion from ${source} to ${target} is not supported.`] };
    }
    if (source === PAGE_TYPES.MARKDOWN) {
      const empty = typeof page?.markdownBody === 'string' && page.markdownBody === '';
      return empty
        ? { allowed: true, reasons: [] }
        : { allowed: false, reasons: ['Markdown body must be exactly empty.'] };
    }
    return emptyHnConversionEligibility(page);
  }

  function emptyHnConversionEligibility(page) {
    return pageTypesModel.hnTextPlaceholderIsEmpty(page?.cneText)
      ? { allowed: true, reasons: [] }
      : { allowed: false, reasons: ['HN Text document must be empty.'] };
  }

  function convertEmptyMarkdownHnPage(page, targetType) {
    const target = normalizePageType(targetType);
    const eligibility = markdownHnConversionEligibility(page, target);
    if (!eligibility.allowed) return { ok: false, ...eligibility };
    const converted = { ...page, type: target };
    if (target === PAGE_TYPES.HN_TEXT) {
      delete converted.markdownBody;
      converted.textFrame = normalizeTextFrame(page?.textFrame);
      converted.cneText = pageTypesModel.createHnTextPlaceholder();
    } else {
      delete converted.cneText;
      converted.markdownBody = '';
      converted.textFrame = normalizeTextFrame(page?.textFrame);
    }
    return { ok: true, allowed: true, reasons: [], page: converted };
  }

  function canvasHnConversionEligibility(page, targetType) {
    const target = normalizePageType(targetType);
    const source = normalizePageType(page?.type);
    if (source === PAGE_TYPES.CANVAS && target === PAGE_TYPES.HN_TEXT) {
      return { allowed: true, reasons: [] };
    }
    if (source === PAGE_TYPES.HN_TEXT && target === PAGE_TYPES.CANVAS) {
      return emptyHnConversionEligibility(page);
    }
    return { allowed: false, reasons: [`Conversion from ${source} to ${target} is not supported.`] };
  }

  function convertDirectCanvasHnPage(page, targetType) {
    const target = normalizePageType(targetType);
    const eligibility = canvasHnConversionEligibility(page, target);
    if (!eligibility.allowed) return { ok: false, ...eligibility };
    const converted = { ...page, type: target };
    if (target === PAGE_TYPES.HN_TEXT) {
      delete converted.markdownBody;
      converted.cneText = pageTypesModel.createHnTextPlaceholder();
      converted.textFrame = normalizeTextFrame(null);
    } else {
      delete converted.markdownBody;
      delete converted.cneText;
      delete converted.textFrame;
    }
    return { ok: true, allowed: true, reasons: [], page: converted };
  }

  pageTypesModel.registerPageTypeConversion(PAGE_TYPES.CANVAS, PAGE_TYPES.MARKDOWN, {
    eligibility: canvasMarkdownConversionEligibility,
    convert: convertCanvasMarkdownPage
  });
  pageTypesModel.registerPageTypeConversion(PAGE_TYPES.MARKDOWN, PAGE_TYPES.CANVAS, {
    eligibility: canvasMarkdownConversionEligibility,
    convert: convertCanvasMarkdownPage
  });
  pageTypesModel.registerPageTypeConversion(PAGE_TYPES.MARKDOWN, PAGE_TYPES.HN_TEXT, {
    eligibility: markdownHnConversionEligibility,
    convert: convertEmptyMarkdownHnPage
  });
  pageTypesModel.registerPageTypeConversion(PAGE_TYPES.HN_TEXT, PAGE_TYPES.MARKDOWN, {
    eligibility: markdownHnConversionEligibility,
    convert: convertEmptyMarkdownHnPage
  });
  pageTypesModel.registerPageTypeConversion(PAGE_TYPES.CANVAS, PAGE_TYPES.HN_TEXT, {
    eligibility: canvasHnConversionEligibility,
    convert: convertDirectCanvasHnPage
  });
  pageTypesModel.registerPageTypeConversion(PAGE_TYPES.HN_TEXT, PAGE_TYPES.CANVAS, {
    eligibility: canvasHnConversionEligibility,
    convert: convertDirectCanvasHnPage
  });

  function conversionEligibility(page, targetType) {
    return pageTypesModel.conversionEligibility(page, targetType);
  }

  function convertPage(page, targetType) {
    return pageTypesModel.convertPage(page, targetType);
  }

  // -----------------------------------------------------------------------
  // Markdown editable-layer v0.3 public boundary
  // -----------------------------------------------------------------------

  function createMarkdownSourceSnapshot(markdownBody, options = {}) {
    return markdownEditableFoundation().createSourceSnapshot(markdownBody, {
      ...options,
      parseMarkdown: options.parseMarkdown || ((source, physicalLineIndex, quoteLineSeed) => (
        parseMarkdownDocument(source, { physicalLineIndex, quoteLineSeed })
      ))
    });
  }

  function editableLayerResult(result, metadata = {}) {
    if (!result) return result;
    const resultSelection = metadata.selection || result.selection;
    const selection = resultSelection
      ? Object.freeze(editableSelectionOffsets(
        result.source ?? result.markdownBody ?? '',
        resultSelection
      ))
      : null;
    return Object.freeze({
      ...result,
      ...metadata,
      selection,
      selectionAffinity: Object.freeze({
        anchor: selection?.anchorAffinity || 'after',
        focus: selection?.focusAffinity || 'after'
      })
    });
  }

  function editableSelectionOffsets(source, selection = {}) {
    const canonical = String(source || '');
    const normalizedAffinity = (...values) => {
      const explicit = values.find((value) => value === 'before' || value === 'after');
      return explicit || 'after';
    };
    const endpoint = (name, value, fallbackOffset, fallbackAffinity = 'after') => {
      const explicitPosition = selection?.[`${name}Position`];
      const position = value && typeof value === 'object'
        ? value
        : explicitPosition && typeof explicitPosition === 'object'
          ? explicitPosition
          : null;
      const requestedOffset = value && typeof value === 'object'
        ? value.offset
        : value ?? position?.offset ?? fallbackOffset;
      return Object.freeze({
        offset: Math.max(
          0,
          Math.min(canonical.length, Number(requestedOffset) || 0)
        ),
        affinity: normalizedAffinity(
          value && typeof value === 'object' ? value.affinity : null,
          position?.affinity,
          selection?.[`${name}Affinity`],
          selection?.selectionAffinity?.[name],
          fallbackAffinity
        )
      });
    };
    const anchorPosition = endpoint('anchor', selection.anchor, canonical.length);
    const hasExplicitFocus = selection?.focus !== undefined
      || selection?.focusPosition !== undefined
      || selection?.focusAffinity !== undefined
      || selection?.selectionAffinity?.focus !== undefined;
    const focusPosition = endpoint(
      'focus',
      selection.focus,
      anchorPosition.offset,
      hasExplicitFocus ? 'after' : anchorPosition.affinity
    );
    return {
      anchor: anchorPosition.offset,
      focus: focusPosition.offset,
      anchorAffinity: anchorPosition.affinity,
      focusAffinity: focusPosition.affinity
    };
  }

  function editableIndentColumns(value) {
    let column = 0;
    for (const character of String(value || '')) {
      column = character === '\t' ? column + (4 - (column % 4)) : column + 1;
    }
    return column;
  }

  function editableListRowAtSelection(snapshot, selection) {
    const offsets = editableSelectionOffsets(snapshot.markdownBody, selection);
    const line = snapshot.physicalLineIndex.lineAtOffset(
      offsets.focus,
      offsets.focusAffinity
    );
    return snapshot.editableListSemanticIndex.byLineIndex.get(line.index)
      || null;
  }

  function ordinaryEditableIndentation(markdownBody, selection = {}, direction = 'indent') {
    const canonical = String(markdownBody || '');
    const snapshot = createMarkdownSourceSnapshot(canonical);
    const offsets = editableSelectionOffsets(canonical, selection);
    const selectionStart = Math.min(offsets.anchor, offsets.focus);
    const selectionEnd = Math.max(offsets.anchor, offsets.focus);
    const startAffinity = offsets.anchor < offsets.focus
      ? offsets.anchorAffinity
      : offsets.focus < offsets.anchor
        ? offsets.focusAffinity
        : offsets.focusAffinity;
    const endAffinity = offsets.anchor > offsets.focus
      ? offsets.anchorAffinity
      : offsets.focus > offsets.anchor
        ? offsets.focusAffinity
        : offsets.focusAffinity;
    const firstLine = snapshot.physicalLineIndex.lineIndexAtOffset(selectionStart, startAffinity);
    const lastLine = snapshot.physicalLineIndex.lineIndexAtOffset(
      selectionStart === selectionEnd ? selectionEnd : Math.max(selectionStart, selectionEnd - 1),
      selectionStart === selectionEnd ? endAffinity : 'before'
    );
    const edits = [];
    const selectedLineIndices = [];
    for (let index = firstLine; index <= lastLine; index += 1) {
      const line = snapshot.physicalLineIndex.lines[index];
      const quote = snapshot.quoteLineIndex.lines[index].command;
      selectedLineIndices.push(index);
      if (direction === 'outdent' && quote.depth > 0
        && editableIndentColumns(quote.leading) > 3) {
        edits.push({
          start: line.start,
          end: line.start + quote.leading.length,
          replacement: '',
          kind: 'quote-leading-alignment',
          lineIndex: index
        });
        continue;
      }
      const editStart = quote.depth > 0 ? line.start + quote.directEnd : line.start;
      const editableTail = canonical.slice(editStart, line.contentEnd);
      if (direction !== 'outdent') {
        const indentationUnit = editableTail.startsWith('\t') ? '\t' : '    ';
        edits.push({
          start: editStart,
          end: editStart,
          replacement: indentationUnit,
          kind: 'ordinary-indent',
          lineIndex: index
        });
        continue;
      }
      const removalLength = editableTail.startsWith('\t')
        ? 1
        : Math.min(4, editableTail.match(/^ +/)?.[0].length || 0);
      if (removalLength) {
        edits.push({
          start: editStart,
          end: editStart + removalLength,
          replacement: '',
          kind: 'ordinary-outdent',
          lineIndex: index
        });
      }
    }
    const result = markdownEditableFoundation().applyCanonicalEdit(
      snapshot,
      offsets,
      edits,
      {
        transactionKind: direction === 'outdent' ? 'ordinary-shift-tab' : 'ordinary-tab',
        inputType: direction === 'outdent' ? 'formatOutdent' : 'formatIndent'
      }
    );
    return editableLayerResult(result, {
      direction,
      editKind: selectionStart === selectionEnd && selectedLineIndices.length === 1
        && !edits.some((edit) => edit.kind === 'quote-leading-alignment')
        ? 'plain-caret'
        : 'lines',
      selectedLineIndices: Object.freeze(selectedLineIndices),
      affectedLineIndices: Object.freeze(edits.map((edit) => edit.lineIndex))
    });
  }

  function applyEditableLayerIndentation(markdownBody, selection = {}, direction = 'indent') {
    const canonical = String(markdownBody || '');
    const snapshot = createMarkdownSourceSnapshot(canonical);
    const row = editableListRowAtSelection(snapshot, selection);
    if (row) {
      return editableLayerResult(markdownEditableFoundation().applyEditableListIndentation(
        snapshot,
        editableSelectionOffsets(canonical, selection),
        direction
      ));
    }
    const offsets = editableSelectionOffsets(canonical, selection);
    return ordinaryEditableIndentation(canonical, offsets, direction);
  }

  function repeatedDelayedQuoteMarkerExit(snapshot, line, selectionOffset) {
    if (!line || selectionOffset !== line.contentEnd) return null;
    const delayedMarker = (candidate) => snapshot.quoteLineIndex
      .lines[candidate.index]?.command?.delayedMarkerRun || null;
    const current = delayedMarker(line);
    if (!current) return null;
    const markers = [current];
    for (let index = line.index - 1; index >= 0; index -= 1) {
      const marker = delayedMarker(snapshot.physicalLineIndex.lines[index]);
      if (!marker || marker.prefix !== current.prefix) break;
      markers.unshift(marker);
    }
    if (markers.length < 2) return null;
    return markers.map((marker) => ({
      start: marker.markerStart,
      end: marker.markerStart + 1,
      replacement: '',
      kind: 'quote-marker-run-exit'
    }));
  }

  function genericEditableNewline(snapshot, selection, options = {}) {
    const canonical = snapshot.markdownBody;
    const offsets = editableSelectionOffsets(canonical, selection);
    const start = Math.min(offsets.anchor, offsets.focus);
    const end = Math.max(offsets.anchor, offsets.focus);
    const startAffinity = offsets.anchor < offsets.focus
      ? offsets.anchorAffinity
      : offsets.focus < offsets.anchor
        ? offsets.focusAffinity
        : offsets.focusAffinity;
    const line = snapshot.physicalLineIndex.lineAtOffset(start, startAffinity);
    const lineEnding = line.lineEnding
      || [...snapshot.physicalLineIndex.lines]
        .slice(0, line.index)
        .reverse()
        .find((candidate) => candidate.lineEnding)?.lineEnding
      || '\n';
    const quoteFacts = snapshot.quoteLineIndex.lines[line.index].command;
    const quote = quoteFacts.hasQuote ? quoteFacts : null;
    const shiftLineBreak = options.inputType === 'insertLineBreak' || options.shiftKey === true;
    if (quote) {
      const repeatedExit = !shiftLineBreak && start === end
        ? repeatedDelayedQuoteMarkerExit(snapshot, line, start)
        : null;
      if (repeatedExit) {
        const result = markdownEditableFoundation().applyCanonicalEdit(snapshot, offsets, repeatedExit, {
          transactionKind: 'quote-marker-run-exit',
          inputType: 'insertParagraph'
        });
        return editableLayerResult(result, { editKind: 'quote-marker-run-exit' });
      }
      const indentationOutdent = !shiftLineBreak && quote.empty && start === end
        ? quote.indentationOutdent
        : null;
      if (indentationOutdent) {
        const result = markdownEditableFoundation().applyCanonicalEdit(
          snapshot,
          offsets,
          indentationOutdent,
          { transactionKind: 'quote-indentation-outdent', inputType: 'insertParagraph' }
        );
        return editableLayerResult(result, {
          editKind: 'quote-indentation-outdent',
          replacement: ''
        });
      }
      if (quote.empty && !shiftLineBreak) {
        const replacement = quote.depth === 1
          ? lineEnding
          : quote.oneLevelUpPrefix;
        const result = markdownEditableFoundation().applyCanonicalEdit(snapshot, offsets, {
          start: line.start,
          end: line.contentEnd,
          replacement,
          kind: 'quote-outdent-one-level'
        }, {
          transactionKind: 'quote-outdent',
          inputType: 'insertParagraph'
        });
        return editableLayerResult(result, {
          editKind: 'quote-outdent',
          replacement
        });
      }
      const continuation = quote.prefix;
      const editKind = 'quote-continuation';
      const replacement = `${lineEnding}${continuation}`;
      const caret = start + replacement.length;
      const result = markdownEditableFoundation().applyCanonicalEdit(snapshot, offsets, {
        start,
        end,
        replacement,
        kind: editKind
      }, {
        transactionKind: editKind,
        inputType: options.inputType || 'insertParagraph',
        afterPrimarySelection: { anchor: caret, focus: caret }
      });
      return editableLayerResult(result, { editKind, replacement });
    }
    const indentation = line.text.match(/^[ \t]*/)?.[0] || '';
    const collapsed = start === end;
    const indentationEnd = line.start + indentation.length;
    const fenced = new Set(snapshot.editableListSemanticIndex.fencedLineIndices || []);
    const codeOwner = snapshot.semanticIndex?.ownersOfType?.('code')?.some((owner) => (
      owner.start <= line.contentEnd && owner.end >= line.start
    ));
    const codeKind = fenced.has(line.index)
      ? 'fenced-code-continuation'
      : codeOwner ? 'indented-code-continuation' : null;
    if (collapsed && line.text.trim().length === 0 && indentation) {
      const removalLength = indentation.endsWith('\t')
        ? 1
        : Math.min(4, indentation.match(/ +$/)?.[0].length || 0);
      const edit = {
        start: line.contentEnd - removalLength,
        end: line.contentEnd,
        replacement: '',
        kind: 'indentation-outdent'
      };
      const result = markdownEditableFoundation().applyCanonicalEdit(snapshot, offsets, edit, {
        transactionKind: 'indentation-outdent',
        inputType: options.inputType || 'insertParagraph'
      });
      return editableLayerResult(result, {
        editKind: 'indentation-outdent',
        replacement: ''
      });
    }
    if (collapsed && line.text.length > 0 && start === line.start) {
      const afterPrimarySelection = {
        anchor: line.start + lineEnding.length + indentation.length,
        focus: line.start + lineEnding.length + indentation.length
      };
      const result = markdownEditableFoundation().applyCanonicalEdit(snapshot, offsets, {
        start: line.start,
        end: line.start,
        replacement: lineEnding,
        kind: 'physical-line-start'
      }, {
        transactionKind: 'newline',
        inputType: options.inputType || 'insertParagraph',
        afterPrimarySelection
      });
      return editableLayerResult(result, {
        editKind: codeKind || 'physical-line-start',
        replacement: lineEnding
      });
    }
    if (collapsed && start > line.start && start < indentationEnd) {
      const afterPrimarySelection = {
        anchor: line.start + lineEnding.length + indentation.length,
        focus: line.start + lineEnding.length + indentation.length
      };
      const result = markdownEditableFoundation().applyCanonicalEdit(snapshot, offsets, {
        start: line.start,
        end: line.start,
        replacement: lineEnding,
        kind: 'indentation-boundary'
      }, {
        transactionKind: 'newline',
        inputType: options.inputType || 'insertParagraph',
        afterPrimarySelection
      });
      return editableLayerResult(result, {
        editKind: codeKind || 'indentation-boundary',
        replacement: lineEnding
      });
    }
    const rightWhitespace = start === end
      ? canonical.slice(start, line.contentEnd).match(/^[ \t]+(?=\S)/)?.[0] || ''
      : '';
    const replacement = `${lineEnding}${indentation}`;
    const editKind = codeKind || (shiftLineBreak
      ? (indentation ? 'indented-line-break' : 'line-break')
      : 'paragraph');
    const result = markdownEditableFoundation().applyCanonicalEdit(snapshot, offsets, {
      start,
      end: end + rightWhitespace.length,
      replacement,
      kind: editKind
    }, {
      transactionKind: 'newline',
      inputType: options.inputType || 'insertParagraph',
      afterPrimarySelection: {
        anchor: start + replacement.length,
        focus: start + replacement.length
      }
    });
    return editableLayerResult(result, { editKind, replacement });
  }

  function applyEditableLayerNewline(markdownBody, selection = {}, options = {}) {
    const canonical = String(markdownBody || '');
    const snapshot = createMarkdownSourceSnapshot(canonical);
    const offsets = editableSelectionOffsets(canonical, selection);
    const startAffinity = offsets.anchor < offsets.focus
      ? offsets.anchorAffinity
      : offsets.focus < offsets.anchor
        ? offsets.focusAffinity
        : offsets.focusAffinity;
    const line = snapshot.physicalLineIndex.lineAtOffset(
      Math.min(offsets.anchor, offsets.focus),
      startAffinity
    );
    const row = snapshot.editableListSemanticIndex.byLineIndex.get(line.index);
    if (row) {
      return editableLayerResult(markdownEditableFoundation().applyEditableNewline(
        snapshot,
        offsets,
        options
      ));
    }
    return genericEditableNewline(snapshot, offsets, options);
  }

  function applyEditableLayerDeletion(markdownBody, selection = {}, direction = 'backward') {
    const canonical = String(markdownBody || '');
    const snapshot = createMarkdownSourceSnapshot(canonical);
    return editableLayerResult(markdownEditableFoundation().applyExactDeletion(
      snapshot,
      editableSelectionOffsets(canonical, selection),
      direction
    ));
  }

  return Object.freeze({
    PAGE_TYPES,
    MARKDOWN_MODES,
    DEFAULT_TEXT_FRAME,
    DEFAULT_SETTINGS,
    normalizePageType,
    normalizeMarkdownMode,
    validateMarkdownMode,
    normalizePreserveSingleLineBreaks,
    validatePreserveSingleLineBreaks,
    normalizeSettings,
    validateSettings,
    normalizeTextFrame,
    validateTextFrame,
    validateTextFramePartial,
    edgesForFrame: structuredTextFrameModel.edgesForFrame,
    frameFromEdges: structuredTextFrameModel.frameFromEdges,
    resizeBoundary: structuredTextFrameModel.resizeBoundary,
    beginBoundaryDrag: structuredTextFrameModel.beginBoundaryDrag,
    updateBoundaryDrag: structuredTextFrameModel.updateBoundaryDrag,
    projectFrame: structuredTextFrameModel.projectFrame,
    resolveViewportResize: structuredTextFrameModel.resolveViewportResize,
    normalizePage,
    escapeHtml,
    safeLinkHref,
    imageSourceRanges,
    parseMarkdownDocument,
    createSourceSnapshot: createMarkdownSourceSnapshot,
    createPhysicalLineIndex: (...args) => markdownEditableFoundation().createPhysicalLineIndex(...args),
    createEditablePosition: (...args) => markdownEditableFoundation().createEditablePosition(...args),
    createEditableLinePosition: (...args) => markdownEditableFoundation().createEditableLinePosition(...args),
    resolveOrderedSequences: (...args) => markdownEditableFoundation().resolveOrderedSequences(...args),
    applyCanonicalEdit: (...args) => markdownEditableFoundation().applyCanonicalEdit(...args),
    applyExactDeletion: (...args) => markdownEditableFoundation().applyExactDeletion(...args),
    applyEditableListIndentation: (...args) => markdownEditableFoundation().applyEditableListIndentation(...args),
    applyEditableNewline: (...args) => markdownEditableFoundation().applyEditableNewline(...args),
    offsetAfterEdits: (...args) => markdownEditableFoundation().offsetAfterEdits(...args),
    codeFenceRanges,
    nextInlineConstruct,
    splitTableRow,
    parseMarkdownTableStructure,
    serializeMarkdownTableStructure,
    applyMarkdownTableOperation,
    applyMarkdownNewline: applyEditableLayerNewline,
    applyMarkdownIndentation: applyEditableLayerIndentation,
    applyMarkdownDeletion: applyEditableLayerDeletion,
    inlineMarkup,
    sourceBlocks,
    renderMarkdown,
    latexReadableText,
    readableText,
    statistics,
    markdownBodyHasMeaning,
    resourceMayDisplay,
    conversionEligibility,
    convertPage
  });
}));
