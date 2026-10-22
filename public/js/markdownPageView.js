(function initMarkdownPageView(root) {
  'use strict';

  const model = root.markdownPageModel;
  const markdownRuntime = root.markdownRuntime;
  const editableFoundation = root.markdownEditableFoundation || model;
  const editableSyntaxAdapters = root.markdownEditableSyntaxAdapters;
  const editableProjectionRuntime = root.markdownEditableProjection;
  const structuredTextShell = root.structuredTextPageShell;
  const structuredTextFrameModel = root.structuredTextFrameModel;
  const layerStates = new WeakMap();
  const stageStates = new WeakMap();
  const editableProjectionRoots = new WeakMap();
  const editableStateRoots = new WeakMap();
  const liveStates = new Set();
  const markdownEditHistories = new WeakMap();
  let activeMarkdownSelectionGesture = null;
  let markdownSelectionGestureCleanupTimer = 0;
  let activeMarkdownClipboardSelection = null;
  let pendingMarkdownClipboardWrite = null;
  let markdownClipboardListenersInstalled = false;
  let markdownStructuralGeometryObserver = null;
  let markdownStructuralGeometryFrame = 0;
  let markdownStructuralFontGeometryInstalled = false;
  let activeCodeLanguageMenu = null;
  const DOCUMENT_TOP = 0;
  const DOCUMENT_BOTTOM_PADDING = 128;
  const MIN_DOCUMENT_HEIGHT = 480;
  const MARKDOWN_HISTORY_LIMIT = 200;
  const MARKDOWN_HISTORY_COALESCE_MS = 500;
  const UNORDERED_MARKER_PRESENTATIONS = Object.freeze([
    Object.freeze({ glyph: '\u2022', listStyleType: 'disc' }),
    Object.freeze({ glyph: '\u25e6', listStyleType: 'circle' }),
    Object.freeze({ glyph: '\u25aa', listStyleType: 'square' })
  ]);

  function pageIsMarkdown(page) {
    return Boolean(page && model
      && model.normalizePageType(page.type) === model.PAGE_TYPES.MARKDOWN);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function unorderedMarkerForDepth(depth) {
    const normalizedDepth = Math.max(0, Math.trunc(finiteNumber(depth, 0)));
    return UNORDERED_MARKER_PRESENTATIONS[
      Math.min(normalizedDepth, UNORDERED_MARKER_PRESENTATIONS.length - 1)
    ];
  }

  function calculateMarkdownDocumentExtent(options = {}) {
    const top = finiteNumber(options.documentTop, DOCUMENT_TOP);
    const contentBottom = Math.max(top, finiteNumber(options.contentBottom, top));
    const objectBottomFromObjects = Array.isArray(options.objects)
      ? options.objects.reduce((lowest, object) => Math.max(
        lowest,
        finiteNumber(object?.y, top) + Math.max(0, finiteNumber(object?.height, 0))
      ), top)
      : top;
    const objectBottom = Math.max(
      top,
      objectBottomFromObjects,
      finiteNumber(options.objectBottom, top)
    );
    const bottomPadding = Math.max(
      0,
      finiteNumber(options.bottomPadding, DOCUMENT_BOTTOM_PADDING)
    );
    const minimumHeight = Math.max(1, finiteNumber(options.minimumHeight, MIN_DOCUMENT_HEIGHT));
    const provisionalBottom = finiteNumber(options.provisionalBottom, top);
    const naturalBottom = Math.max(top + minimumHeight, contentBottom, objectBottom)
      + bottomPadding;
    const bottom = Math.max(naturalBottom, provisionalBottom);
    return {
      top,
      bottom,
      height: Math.max(1, bottom - top),
      contentBottom,
      objectBottom,
      bottomPadding,
      minimumHeight
    };
  }

  function calculateMarkdownVisualFrameExtent(options = {}) {
    return structuredTextShell.calculateVisualFrameExtent(options);
  }

  function clampMarkdownVerticalOffset(options = {}) {
    const scale = Math.max(0.05, finiteNumber(options.scale, 1));
    const viewportHeight = Math.max(0, finiteNumber(options.viewportHeight, 0));
    const documentTop = finiteNumber(options.documentTop, DOCUMENT_TOP);
    const documentBottom = Math.max(
      documentTop,
      finiteNumber(options.documentBottom, documentTop)
    );
    const topInset = Math.max(0, finiteNumber(options.topInset, 0));
    const bottomInset = Math.max(0, finiteNumber(options.bottomInset, 0));
    const topAlignedOffset = topInset - (documentTop * scale);
    const bottomAlignedOffset = viewportHeight - bottomInset - (documentBottom * scale);
    const usableHeight = Math.max(0, viewportHeight - topInset - bottomInset);
    if ((documentBottom - documentTop) * scale <= usableHeight) return topAlignedOffset;
    return clamp(
      finiteNumber(options.offsetY, topAlignedOffset),
      bottomAlignedOffset,
      topAlignedOffset
    );
  }

  function normalizedMode(value) {
    return model?.normalizeMarkdownMode
      ? model.normalizeMarkdownMode(value)
      : (value === 'source' || value === 'reading' ? value : 'live-preview');
  }

  function normalizeMarkdownStructuralFoldDescriptors(value) {
    const source = Array.isArray(value)
      ? value
      : Array.isArray(value?.folds)
        ? value.folds
        : [];
    const descriptors = [];
    const seen = new Set();
    for (const entry of source) {
      const kind = entry?.kind === 'heading' || entry?.kind === 'list'
        ? entry.kind
        : null;
      const physicalLineId = typeof entry?.physicalLineId === 'string'
        && entry.physicalLineId
        ? entry.physicalLineId
        : null;
      const lineIndex = Number.isInteger(entry?.lineIndex) && entry.lineIndex >= 0
        ? entry.lineIndex
        : null;
      const depth = Number.isInteger(entry?.depth) && entry.depth > 0
        ? entry.depth
        : 1;
      if (!kind || (physicalLineId === null && lineIndex === null)) continue;
      const identity = physicalLineId
        ? `${kind}:id:${physicalLineId}`
        : `${kind}:line:${lineIndex}:${depth}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      descriptors.push({ kind, physicalLineId, lineIndex, depth });
      if (descriptors.length >= 2000) break;
    }
    return descriptors;
  }

  function markdownStructuralDocumentLineCount(snapshot) {
    const lines = snapshot?.physicalLineIndex?.lines || [];
    const terminal = lines.at(-1);
    return terminal
      && terminal.start === snapshot.markdownBody.length
      && terminal.sourceEnd === terminal.start
      && terminal.text === ''
      ? Math.max(0, lines.length - 1)
      : lines.length;
  }

  function markdownHeadingFoldOwners(snapshot) {
    const lines = snapshot?.physicalLineIndex?.lines || [];
    const documentLineCount = markdownStructuralDocumentLineCount(snapshot);
    const headings = (snapshot?.semanticIndex?.ownersOfType?.('heading') || [])
      .map((entry) => {
        const start = Number(entry.start);
        const end = Math.max(start, Number(entry.end));
        const lineIndex = snapshot.physicalLineIndex.lineIndexAtOffset(start, 'after');
        const endLineIndex = snapshot.physicalLineIndex.lineIndexAtOffset(
          Math.max(start, end - 1),
          'before'
        );
        const line = lines[lineIndex];
        if (!line || lineIndex >= documentLineCount) return null;
        const depth = clamp(Number(entry.node?.depth || 1), 1, 6);
        const childStart = Number(entry.node?.children?.[0]?.position?.start?.offset);
        return {
          kind: 'heading',
          key: `heading:${line.id}`,
          physicalLineId: String(line.id),
          lineIndex,
          endLineIndex,
          depth,
          ownerStart: start,
          ownerEnd: end,
          safeOffset: Number.isFinite(childStart) ? childStart : start
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.lineIndex - right.lineIndex
        || left.ownerStart - right.ownerStart);
    return headings.map((heading, index) => {
      const boundary = headings.slice(index + 1).find((candidate) => (
        candidate.depth <= heading.depth
      ));
      const hiddenStartLineIndex = heading.endLineIndex + 1;
      const semanticHiddenEndLineIndex = boundary?.lineIndex ?? documentLineCount;
      const foldable = hiddenStartLineIndex < semanticHiddenEndLineIndex;
      // A synthetic EOF row does not make an otherwise empty heading
      // foldable, but it is part of the presentation hidden to document end
      // once at least one real descendant row exists.
      const hiddenEndLineIndex = boundary
        ? boundary.lineIndex
        : foldable ? lines.length : semanticHiddenEndLineIndex;
      return {
        ...heading,
        hiddenStartLineIndex,
        hiddenEndLineIndex,
        hiddenStartOffset: lines[hiddenStartLineIndex]?.start ?? snapshot.markdownBody.length,
        hiddenEndOffset: lines[hiddenEndLineIndex]?.start ?? snapshot.markdownBody.length,
        foldable
      };
    });
  }

  function markdownListFoldOwners(snapshot) {
    const listIndex = snapshot?.editableListSemanticIndex;
    if (!listIndex) return [];
    const lines = snapshot.physicalLineIndex.lines;
    const documentLineCount = markdownStructuralDocumentLineCount(snapshot);
    return listIndex.rows.map((row) => {
      const semanticHiddenEndLineIndex = row.subtreeEndLineIndex;
      const hiddenStartLineIndex = row.lineIndex + 1;
      const foldable = hiddenStartLineIndex < semanticHiddenEndLineIndex;
      const hiddenEndLineIndex = foldable
        && semanticHiddenEndLineIndex === documentLineCount
        ? lines.length
        : semanticHiddenEndLineIndex;
      return {
        kind: 'list',
        key: `list:${row.physicalLineId}`,
        physicalLineId: String(row.physicalLineId),
        lineIndex: row.lineIndex,
        endLineIndex: row.lineIndex,
        depth: row.depth,
        listKind: row.task ? 'task' : row.kind,
        task: row.task === true,
        ownerStart: row.start,
        ownerEnd: row.end,
        editableListRowId: row.id,
        astOwnerId: row.astOwnerId,
        markerStart: row.markerStart,
        markerEnd: row.markerEnd,
        safeOffset: row.task && Number.isFinite(row.taskContentStart)
          ? row.taskContentStart
          : row.contentStart,
        hiddenStartLineIndex,
        hiddenEndLineIndex,
        hiddenStartOffset: lines[hiddenStartLineIndex]?.start ?? snapshot.markdownBody.length,
        hiddenEndOffset: lines[hiddenEndLineIndex]?.start ?? snapshot.markdownBody.length,
        foldable
      };
    });
  }

  function buildMarkdownStructuralFoldIndex(snapshot) {
    const owners = [
      ...markdownHeadingFoldOwners(snapshot),
      ...markdownListFoldOwners(snapshot)
    ].sort((left, right) => left.lineIndex - right.lineIndex
      || (left.kind === 'heading' ? -1 : 1));
    return {
      sourceVersion: snapshot?.version ?? null,
      owners,
      foldableOwners: owners.filter((owner) => owner.foldable),
      byKey: new Map(owners.map((owner) => [owner.key, owner])),
      byPhysicalIdentity: new Map(owners.map((owner) => (
        [`${owner.kind}:${owner.physicalLineId}`, owner]
      )))
    };
  }

  function deriveMarkdownStructuralFoldVisibility(index, collapsedKeys) {
    const collapsed = index.foldableOwners.filter((owner) => collapsedKeys?.has(owner.key));
    const hiddenLineIndices = new Set();
    const hiddenByLineIndex = new Map();
    collapsed.forEach((owner) => {
      for (let lineIndex = owner.hiddenStartLineIndex;
        lineIndex < owner.hiddenEndLineIndex;
        lineIndex += 1) {
        hiddenLineIndices.add(lineIndex);
        if (!hiddenByLineIndex.has(lineIndex)) hiddenByLineIndex.set(lineIndex, []);
        hiddenByLineIndex.get(lineIndex).push(owner);
      }
    });
    hiddenByLineIndex.forEach((owners) => owners.sort((left, right) => (
      left.hiddenStartLineIndex - right.hiddenStartLineIndex
        || right.hiddenEndLineIndex - left.hiddenEndLineIndex
    )));
    return { collapsed, hiddenLineIndices, hiddenByLineIndex };
  }

  function textFrameForPage(page) {
    const owner = structuredTextFrameModel?.normalizeTextFrame
      ? structuredTextFrameModel : model;
    if (typeof owner?.normalizeTextFrame !== 'function') {
      throw new Error('The structured text frame model is unavailable.');
    }
    return owner.normalizeTextFrame(page?.textFrame);
  }

  function textFrameEdges(frame) {
    if (typeof structuredTextFrameModel?.edgesForFrame === 'function') {
      return structuredTextFrameModel.edgesForFrame(frame);
    }
    if (typeof structuredTextShell?.edgesForTextFrame === 'function') {
      return structuredTextShell.edgesForTextFrame(frame);
    }
    throw new Error('Structured text frame edge projection is unavailable.');
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function createMarkdownPresentationHost(stage, area) {
    if (!(stage instanceof Element) || !(area instanceof Element)) return null;
    const cameraLayer = createElement('div', 'markdown-page-camera-layer');
    const worldLayer = createElement('div', 'markdown-page-world-layer');
    cameraLayer.append(worldLayer);
    area.append(cameraLayer);
    return { cameraLayer, worldLayer };
  }

  function applyMarkdownPresentationGeometry(state) {
    if (!state?.cameraLayer || !state?.worldLayer) return false;
    const zoom = Math.max(0.05, finiteNumber(state.zoom, 1));
    const cameraOffsetX = finiteNumber(state.cameraOffsetX, 0);
    const cameraOffsetY = finiteNumber(state.cameraOffsetY, 0);
    state.cameraLayer.style.transform = `translate3d(${cameraOffsetX}px, ${cameraOffsetY}px, 0)`;
    state.worldLayer.style.zoom = String(zoom);
    state.cameraLayer.dataset.offsetX = String(cameraOffsetX);
    state.cameraLayer.dataset.offsetY = String(cameraOffsetY);
    state.worldLayer.dataset.zoom = String(zoom);
    updateMarkdownVisualFrameExtent(state);
    scheduleMarkdownStructuralFoldGeometryRefresh();
    return true;
  }

  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

  function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS(SVG_NAMESPACE, tagName);
    Object.entries(attributes).forEach(([name, value]) => {
      element.setAttribute(name, String(value));
    });
    return element;
  }

  function createMarkdownInteractionIcon(kind, className = '') {
    const icon = createSvgElement('svg', {
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false'
    });
    icon.classList.add('markdown-interaction-icon');
    if (className) icon.classList.add(className);
    if (kind === 'open-link') {
      icon.append(
        createSvgElement('path', {
          d: 'M8.75 3.25h4v4M12.75 3.25 7.25 8.75M11.75 8.25v3A1.5 1.5 0 0 1 10.25 12.75h-6A1.5 1.5 0 0 1 2.75 11.25v-6a1.5 1.5 0 0 1 1.5-1.5h3'
        })
      );
    } else if (kind === 'plus') {
      icon.append(createSvgElement('path', { d: 'M8 3v10M3 8h10' }));
    } else if (kind === 'code') {
      icon.append(createSvgElement('path', {
        d: 'm5.5 3.75-3.75 4.25 3.75 4.25M10.5 3.75 14.25 8l-3.75 4.25M9.25 2.5l-2.5 11'
      }));
    }
    return icon;
  }

  function appendText(parent, value) {
    if (value) parent.append(document.createTextNode(value));
  }

  function markSourceRange(element, start, end) {
    if (!element || !Number.isFinite(start) || !Number.isFinite(end)) return element;
    element.dataset.markdownSourceStart = String(Math.max(0, start));
    element.dataset.markdownSourceEnd = String(Math.max(start, end));
    return element;
  }

  function appendMappedText(parent, value, sourceStart) {
    const text = String(value || '');
    if (!text) return;
    const span = markSourceRange(
      createElement('span', 'markdown-source-mapped-text', text),
      sourceStart,
      sourceStart + text.length
    );
    parent.append(span);
  }

  function appendAstMappedText(parent, value, sourceStart) {
    const text = String(value || '');
    let cursor = 0;
    const lineBreakPattern = /\r\n|\n/g;
    let match = lineBreakPattern.exec(text);
    while (match) {
      appendMappedText(parent, text.slice(cursor, match.index), sourceStart + cursor);
      const lineBreakStart = sourceStart + match.index;
      const lineBreak = markSourceRange(
        createElement('span', 'markdown-source-line-break', match[0]),
        lineBreakStart,
        lineBreakStart + match[0].length
      );
      lineBreak.dataset.markdownSourceBreak = 'true';
      parent.append(lineBreak);
      cursor = match.index + match[0].length;
      match = lineBreakPattern.exec(text);
    }
    appendMappedText(parent, text.slice(cursor), sourceStart + cursor);
  }

  function sourceConstructId(kind, start, end) {
    return `${kind}:${Math.max(0, start)}:${Math.max(start, end)}`;
  }

  function markSourceConstruct(element, kind, start, end) {
    if (!element) return element;
    element.classList.add('markdown-source-construct', `is-${kind}`);
    markSourceRange(element, Math.max(0, start), Math.max(start, end));
    element.dataset.markdownConstructId = sourceConstructId(kind, start, end);
    element.dataset.markdownConstructStart = String(Math.max(0, start));
    element.dataset.markdownConstructEnd = String(Math.max(start, end));
    return element;
  }

  function appendSourceMarker(parent, value, sourceStart, constructId) {
    const text = String(value || '');
    if (!text) return null;
    const marker = markSourceRange(
      createElement('span', 'markdown-source-marker', text),
      sourceStart,
      sourceStart + text.length
    );
    marker.dataset.markdownMarkerFor = constructId;
    marker.setAttribute('aria-hidden', 'true');
    parent.append(marker);
    return marker;
  }

  const CODE_LANGUAGE_ALIASES = Object.freeze({
    js: 'javascript',
    javascript: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    typescript: 'typescript',
    tsx: 'typescript',
    json: 'json',
    jsonc: 'json',
    py: 'python',
    python: 'python',
    css: 'css',
    scss: 'css',
    less: 'css',
    html: 'markup',
    htm: 'markup',
    xml: 'markup',
    svg: 'markup',
    md: 'markup',
    markdown: 'markup',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    shell: 'shell',
    sql: 'sql',
    c: 'c-like',
    h: 'c-like',
    cc: 'c-like',
    cpp: 'c-like',
    'c++': 'c-like',
    hpp: 'c-like',
    java: 'c-like',
    kotlin: 'c-like',
    kt: 'c-like',
    cs: 'c-like',
    csharp: 'c-like',
    go: 'c-like',
    rust: 'c-like',
    rs: 'c-like',
    rb: 'ruby',
    ruby: 'ruby',
    php: 'php'
  });

  const CODE_KEYWORDS = Object.freeze({
    javascript: new Set([
      'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
      'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
      'for', 'from', 'function', 'get', 'if', 'import', 'in', 'instanceof', 'let',
      'new', 'of', 'return', 'set', 'static', 'super', 'switch', 'throw', 'try',
      'typeof', 'var', 'void', 'while', 'with', 'yield'
    ]),
    typescript: new Set([
      'abstract', 'any', 'as', 'asserts', 'async', 'await', 'boolean', 'break',
      'case', 'catch', 'class', 'const', 'constructor', 'continue', 'declare',
      'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally',
      'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in',
      'infer', 'instanceof', 'interface', 'is', 'keyof', 'let', 'module',
      'namespace', 'never', 'new', 'number', 'object', 'of', 'private', 'protected',
      'public', 'readonly', 'return', 'satisfies', 'set', 'static', 'string', 'super',
      'switch', 'symbol', 'this', 'throw', 'try', 'type', 'typeof', 'undefined',
      'unknown', 'var', 'void', 'while', 'with', 'yield'
    ]),
    python: new Set([
      'and', 'as', 'assert', 'async', 'await', 'break', 'case', 'class', 'continue',
      'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
      'if', 'import', 'in', 'is', 'lambda', 'match', 'nonlocal', 'not', 'or',
      'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
    ]),
    css: new Set([
      'and', 'important', 'not', 'only', 'or', 'screen', 'supports'
    ]),
    shell: new Set([
      'case', 'do', 'done', 'elif', 'else', 'esac', 'export', 'fi', 'for',
      'function', 'if', 'in', 'local', 'readonly', 'select', 'then', 'time',
      'until', 'while'
    ]),
    sql: new Set([
      'add', 'all', 'alter', 'and', 'as', 'asc', 'begin', 'between', 'by', 'case',
      'check', 'column', 'commit', 'constraint', 'create', 'cross', 'database',
      'default', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'exists',
      'foreign', 'from', 'full', 'group', 'having', 'in', 'index', 'inner',
      'insert', 'into', 'is', 'join', 'key', 'left', 'like', 'limit', 'not',
      'null', 'on', 'or', 'order', 'outer', 'primary', 'references', 'right',
      'rollback', 'select', 'set', 'table', 'then', 'union', 'unique', 'update',
      'values', 'view', 'when', 'where', 'with'
    ]),
    'c-like': new Set([
      'abstract', 'alignas', 'auto', 'bool', 'break', 'byte', 'case', 'catch',
      'char', 'class', 'const', 'constexpr', 'continue', 'default', 'delete', 'do',
      'double', 'else', 'enum', 'extends', 'extern', 'final', 'finally', 'float',
      'for', 'friend', 'func', 'go', 'goto', 'if', 'implements', 'import', 'inline',
      'int', 'interface', 'internal', 'long', 'module', 'namespace', 'new',
      'operator', 'override', 'package', 'private', 'protected', 'public', 'return',
      'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template',
      'this', 'throw', 'trait', 'try', 'type', 'typedef', 'typename', 'union',
      'unsafe', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'where', 'while'
    ]),
    ruby: new Set([
      'alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined', 'do',
      'else', 'elsif', 'end', 'ensure', 'false', 'for', 'if', 'in', 'module',
      'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry', 'return', 'self',
      'super', 'then', 'true', 'undef', 'unless', 'until', 'when', 'while', 'yield'
    ]),
    php: new Set([
      'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch',
      'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo',
      'else', 'elseif', 'empty', 'endfor', 'endforeach', 'endif', 'endswitch',
      'endwhile', 'extends', 'final', 'finally', 'for', 'foreach', 'function',
      'global', 'if', 'implements', 'include', 'include_once', 'instanceof',
      'interface', 'namespace', 'new', 'or', 'private', 'protected', 'public',
      'require', 'require_once', 'return', 'static', 'switch', 'throw', 'trait',
      'try', 'use', 'var', 'while', 'xor', 'yield'
    ])
  });

  const CODE_LITERALS = new Set([
    'false', 'inf', 'infinity', 'nan', 'nil', 'none', 'null', 'true', 'undefined'
  ]);

  function normalizedCodeLanguage(value) {
    return CODE_LANGUAGE_ALIASES[String(value || '').trim().toLowerCase()] || '';
  }

  function codeProfile(language) {
    if (!language) return null;
    if (language === 'markup') return { markup: true };
    if (language === 'python' || language === 'shell' || language === 'ruby') {
      return { lineComments: ['#'], blockComments: [], strings: ['"', "'"], language };
    }
    if (language === 'sql') {
      return { lineComments: ['--'], blockComments: [['/*', '*/']], strings: ['"', "'", '`'], language };
    }
    if (language === 'css') {
      return { lineComments: [], blockComments: [['/*', '*/']], strings: ['"', "'"], language };
    }
    if (language === 'json') {
      return { lineComments: [], blockComments: [], strings: ['"'], language };
    }
    return {
      lineComments: ['//'],
      blockComments: [['/*', '*/']],
      strings: language === 'javascript' || language === 'typescript'
        ? ['"', "'", '`']
        : ['"', "'"],
      language
    };
  }

  function pushCodeToken(tokens, type, value) {
    if (!value) return;
    const previous = tokens[tokens.length - 1];
    if (previous && previous.type === type) previous.value += value;
    else tokens.push({ type, value });
  }

  function readQuotedCode(source, start, quote) {
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += Math.min(2, source.length - index);
      } else if (source[index] === quote) {
        index += 1;
        break;
      } else {
        index += 1;
      }
    }
    return index;
  }

  function tokenizeMarkupCode(source) {
    const tokens = [];
    const text = String(source || '');
    let cursor = 0;
    while (cursor < text.length) {
      if (text.startsWith('<!--', cursor)) {
        const end = text.indexOf('-->', cursor + 4);
        const next = end < 0 ? text.length : end + 3;
        pushCodeToken(tokens, 'comment', text.slice(cursor, next));
        cursor = next;
        continue;
      }
      if (text[cursor] !== '<') {
        const next = text.indexOf('<', cursor);
        pushCodeToken(tokens, 'plain', text.slice(cursor, next < 0 ? text.length : next));
        cursor = next < 0 ? text.length : next;
        continue;
      }
      const close = text.indexOf('>', cursor + 1);
      if (close < 0) {
        pushCodeToken(tokens, 'plain', text.slice(cursor));
        break;
      }
      const tagSource = text.slice(cursor, close + 1);
      const tagMatch = tagSource.match(/^(<\/?\s*)([A-Za-z][\w:.-]*)/);
      if (!tagMatch) {
        pushCodeToken(tokens, 'plain', tagSource);
        cursor = close + 1;
        continue;
      }
      pushCodeToken(tokens, 'punctuation', tagMatch[1]);
      pushCodeToken(tokens, 'tag', tagMatch[2]);
      let tagCursor = tagMatch[0].length;
      while (tagCursor < tagSource.length) {
        const rest = tagSource.slice(tagCursor);
        const whitespace = rest.match(/^\s+/);
        if (whitespace) {
          pushCodeToken(tokens, 'plain', whitespace[0]);
          tagCursor += whitespace[0].length;
          continue;
        }
        const quoted = rest.match(/^(["'])(?:\\.|(?!\1)[\s\S])*?\1/);
        if (quoted) {
          pushCodeToken(tokens, 'string', quoted[0]);
          tagCursor += quoted[0].length;
          continue;
        }
        const attribute = rest.match(/^[A-Za-z_:][\w:.-]*/);
        if (attribute) {
          pushCodeToken(tokens, 'attribute', attribute[0]);
          tagCursor += attribute[0].length;
          continue;
        }
        const operator = rest.match(/^(?:=|\/?>)/);
        if (operator) {
          pushCodeToken(tokens, operator[0].includes('>') ? 'punctuation' : 'operator', operator[0]);
          tagCursor += operator[0].length;
          continue;
        }
        pushCodeToken(tokens, 'plain', rest[0]);
        tagCursor += 1;
      }
      cursor = close + 1;
    }
    return tokens;
  }

  function tokenizeCode(source, declaredLanguage) {
    const text = String(source || '');
    const language = normalizedCodeLanguage(declaredLanguage);
    const profile = codeProfile(language);
    if (!profile) return text ? [{ type: 'plain', value: text }] : [];
    if (profile.markup) return tokenizeMarkupCode(text);
    const tokens = [];
    const keywords = CODE_KEYWORDS[profile.language] || new Set();
    let cursor = 0;
    while (cursor < text.length) {
      const lineComment = profile.lineComments.find((marker) => text.startsWith(marker, cursor));
      if (lineComment) {
        const newline = text.indexOf('\n', cursor + lineComment.length);
        const next = newline < 0 ? text.length : newline;
        pushCodeToken(tokens, 'comment', text.slice(cursor, next));
        cursor = next;
        continue;
      }
      const blockComment = profile.blockComments.find(([start]) => text.startsWith(start, cursor));
      if (blockComment) {
        const end = text.indexOf(blockComment[1], cursor + blockComment[0].length);
        const next = end < 0 ? text.length : end + blockComment[1].length;
        pushCodeToken(tokens, 'comment', text.slice(cursor, next));
        cursor = next;
        continue;
      }
      const character = text[cursor];
      if (profile.strings.includes(character)) {
        const next = readQuotedCode(text, cursor, character);
        pushCodeToken(tokens, 'string', text.slice(cursor, next));
        cursor = next;
        continue;
      }
      const number = text.slice(cursor).match(/^(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
      if (number) {
        pushCodeToken(tokens, 'number', number[0]);
        cursor += number[0].length;
        continue;
      }
      const identifier = text.slice(cursor).match(/^[A-Za-z_$][\w$-]*/);
      if (identifier) {
        const value = identifier[0];
        const lowered = value.toLowerCase();
        const following = text.slice(cursor + value.length);
        const type = keywords.has(profile.language === 'sql' ? lowered : value)
          ? 'keyword'
          : CODE_LITERALS.has(lowered)
            ? 'literal'
            : /^\s*\(/.test(following)
              ? 'function'
              : /^\s*:/.test(following)
                ? 'property'
                : 'plain';
        pushCodeToken(tokens, type, value);
        cursor += value.length;
        continue;
      }
      const operator = text.slice(cursor).match(/^(?:===?|!==?|=>|\+\+|--|&&|\|\||\?\?|\?\.|\*\*|<<|>>>?|[-+*/%&|^~<>?:]=?)/);
      if (operator) {
        pushCodeToken(tokens, 'operator', operator[0]);
        cursor += operator[0].length;
        continue;
      }
      if (/[[\]{}();,.]/.test(character)) pushCodeToken(tokens, 'punctuation', character);
      else pushCodeToken(tokens, 'plain', character);
      cursor += 1;
    }
    return tokens;
  }

  function appendHighlightedCode(parent, source, declaredLanguage) {
    tokenizeCode(source, declaredLanguage).forEach((token) => {
      if (token.type === 'plain') appendText(parent, token.value);
      else parent.append(createElement('span', `markdown-code-token is-${token.type}`, token.value));
    });
  }

  const LATEX_SYMBOLS = Object.freeze({
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ',
    varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
    iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
    omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'ϕ', chi: 'χ',
    psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ',
    Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
    Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', infty: '∞', partial: '∂',
    nabla: '∇', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ',
    aleph: 'ℵ', forall: '∀', exists: '∃', emptyset: '∅',
    angle: '∠', degree: '°'
  });

  const LATEX_OPERATORS = Object.freeze({
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅',
    ast: '∗', star: '⋆', circ: '∘', bullet: '∙', cap: '∩',
    cup: '∪', setminus: '∖', wedge: '∧', vee: '∨', oplus: '⊕',
    otimes: '⊗', le: '≤', leq: '≤', ge: '≥', geq: '≥',
    ne: '≠', neq: '≠', approx: '≈', equiv: '≡', propto: '∝',
    sim: '∼', simeq: '≃', cong: '≅', in: '∈', notin: '∉',
    ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃',
    supseteq: '⊇', perp: '⊥', parallel: '∥', to: '→',
    rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
    sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬',
    iiint: '∭', oint: '∮', lim: 'lim', min: 'min', max: 'max', log: 'log',
    ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot',
    sec: 'sec', csc: 'csc', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
    det: 'det', gcd: 'gcd'
  });

  const LATEX_DELIMITERS = Object.freeze({
    lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', vert: '|', Vert: '‖',
    '{': '{', '}': '}'
  });

  function mathNode(type, properties = {}) {
    return { type, ...properties };
  }

  function parseLatex(source) {
    const input = String(source || '');
    let cursor = 0;
    let invalid = false;

    function rangeMathNode(node, start, end = cursor) {
      if (!node) return node;
      node.sourceStart = Math.max(0, finiteNumber(start, 0));
      node.sourceEnd = Math.max(node.sourceStart, finiteNumber(end, node.sourceStart));
      return node;
    }

    function parseCommand() {
      const start = cursor;
      cursor += 1;
      const word = input.slice(cursor).match(/^[A-Za-z]+/);
      if (word) {
        cursor += word[0].length;
        return { name: word[0], raw: input.slice(start, cursor), start, end: cursor };
      }
      if (cursor < input.length) cursor += 1;
      return {
        name: input.slice(start + 1, cursor),
        raw: input.slice(start, cursor),
        start,
        end: cursor
      };
    }

    function skipSpaces() {
      while (/\s/.test(input[cursor] || '')) cursor += 1;
    }

    function parseRequiredArgument() {
      skipSpaces();
      if (input[cursor] === '{') {
        cursor += 1;
        const value = parseRow('}');
        if (input[cursor] === '}') cursor += 1;
        else invalid = true;
        return value;
      }
      if (cursor >= input.length) return null;
      return parseAtom();
    }

    function parseOptionalArgument() {
      skipSpaces();
      if (input[cursor] !== '[') return null;
      cursor += 1;
      const children = [];
      while (cursor < input.length && input[cursor] !== ']') children.push(parseAtom());
      if (input[cursor] === ']') cursor += 1;
      else invalid = true;
      return rangeMathNode(mathNode('row', { children }), children[0]?.sourceStart ?? cursor, cursor);
    }

    function literalCommand(command) {
      return rangeMathNode(mathNode('text', { value: command.raw }), command.start, command.end);
    }

    function parseCommandNode() {
      const start = cursor;
      const command = parseCommand();
      if (command.name === 'frac' || command.name === 'dfrac' || command.name === 'tfrac') {
        const numerator = parseRequiredArgument();
        const denominator = parseRequiredArgument();
        if (!numerator || !denominator) {
          invalid = true;
          return literalCommand(command);
        }
        return rangeMathNode(mathNode('fraction', { numerator, denominator }), start, cursor);
      }
      if (command.name === 'sqrt') {
        const index = parseOptionalArgument();
        const radicand = parseRequiredArgument();
        if (!radicand) {
          invalid = true;
          return literalCommand(command);
        }
        return rangeMathNode(mathNode('root', { index, radicand }), start, cursor);
      }
      if (command.name === 'text' || command.name === 'mathrm' || command.name === 'operatorname') {
        const value = parseRequiredArgument();
        if (!value) return literalCommand(command);
        return rangeMathNode(mathNode('upright', { body: value }), start, cursor);
      }
      if (command.name === 'mathbf' || command.name === 'boldsymbol') {
        const value = parseRequiredArgument();
        return value
          ? rangeMathNode(mathNode('bold', { body: value }), start, cursor)
          : literalCommand(command);
      }
      if (command.name === 'mathit') {
        const value = parseRequiredArgument();
        return value
          ? rangeMathNode(mathNode('italic', { body: value }), start, cursor)
          : literalCommand(command);
      }
      if (['hat', 'widehat', 'bar', 'overline', 'vec', 'tilde', 'dot', 'ddot', 'underline'].includes(command.name)) {
        const body = parseRequiredArgument();
        return body
          ? rangeMathNode(mathNode('accent', { accent: command.name, body }), start, cursor)
          : literalCommand(command);
      }
      if (command.name === 'left' || command.name === 'right') {
        skipSpaces();
        if (cursor >= input.length) return literalCommand(command);
        let value;
        if (input[cursor] === '\\') {
          const delimiter = parseCommand();
          value = LATEX_DELIMITERS[delimiter.name] || LATEX_DELIMITERS[delimiter.raw] || delimiter.raw;
        } else {
          value = input[cursor];
          cursor += 1;
        }
        return rangeMathNode(mathNode('delimiter', { value }), start, cursor);
      }
      if (Object.hasOwn(LATEX_SYMBOLS, command.name)) {
        return rangeMathNode(mathNode('identifier', { value: LATEX_SYMBOLS[command.name] }), start, cursor);
      }
      if (Object.hasOwn(LATEX_OPERATORS, command.name)) {
        const value = LATEX_OPERATORS[command.name];
        const named = /^[A-Za-z]+$/.test(value);
        return rangeMathNode(mathNode(named ? 'function' : 'operator', { value }), start, cursor);
      }
      if (command.name === ',' || command.name === ':' || command.name === ';'
        || command.name === 'quad' || command.name === 'qquad' || command.name === '!') {
        const widths = { ',': 'thin', ':': 'medium', ';': 'thick', quad: 'quad', qquad: 'qquad', '!': 'negative' };
        return rangeMathNode(mathNode('space', { width: widths[command.name] }), start, cursor);
      }
      const escaped = { '%': '%', '#': '#', '$': '$', '&': '&', '_': '_', '{': '{', '}': '}', '\\': '\\' };
      if (Object.hasOwn(escaped, command.name)) {
        return rangeMathNode(mathNode('text', { value: escaped[command.name] }), start, cursor);
      }
      return literalCommand(command);
    }

    function parseAtom() {
      const start = cursor;
      if (cursor >= input.length) return rangeMathNode(mathNode('text', { value: '' }), start, cursor);
      const character = input[cursor];
      if (character === '\\') return parseCommandNode();
      if (character === '{') {
        cursor += 1;
        const group = parseRow('}');
        if (input[cursor] === '}') cursor += 1;
        else invalid = true;
        return rangeMathNode(mathNode('group', { body: group }), start, cursor);
      }
      if (/\s/.test(character)) {
        while (/\s/.test(input[cursor] || '')) cursor += 1;
        return rangeMathNode(mathNode('space', { width: 'normal' }), start, cursor);
      }
      const number = input.slice(cursor).match(/^\d+(?:[.,]\d+)?/);
      if (number) {
        cursor += number[0].length;
        return rangeMathNode(mathNode('number', { value: number[0] }), start, cursor);
      }
      const letters = input.slice(cursor).match(/^[A-Za-z]+/);
      if (letters) {
        cursor += letters[0].length;
        return rangeMathNode(mathNode('identifier', { value: letters[0] }), start, cursor);
      }
      cursor += 1;
      if (/[-+=<>|]/.test(character)) {
        return rangeMathNode(mathNode('operator', { value: character }), start, cursor);
      }
      if (/[()[\]]/.test(character)) {
        return rangeMathNode(mathNode('delimiter', { value: character }), start, cursor);
      }
      return rangeMathNode(mathNode('text', { value: character }), start, cursor);
    }

    function parseScriptArgument() {
      skipSpaces();
      return cursor < input.length ? parseRequiredArgument() : null;
    }

    function parseRow(stopCharacter) {
      const start = cursor;
      const children = [];
      while (cursor < input.length && input[cursor] !== stopCharacter) {
        if ((input[cursor] === '^' || input[cursor] === '_') && children.length) {
          const kind = input[cursor] === '^' ? 'superscript' : 'subscript';
          const scriptMarkerStart = cursor;
          cursor += 1;
          const script = parseScriptArgument();
          if (!script) {
            children.push(rangeMathNode(
              mathNode('text', { value: kind === 'superscript' ? '^' : '_' }),
              scriptMarkerStart,
              cursor
            ));
            continue;
          }
          const previous = children.pop();
          const scripts = previous.type === 'scripts'
            ? previous
            : rangeMathNode(
                mathNode('scripts', { base: previous, superscript: null, subscript: null }),
                previous.sourceStart,
                previous.sourceEnd
              );
          scripts[kind] = script;
          scripts.sourceStart = Math.min(scripts.sourceStart, scriptMarkerStart);
          scripts.sourceEnd = Math.max(scripts.sourceEnd, script.sourceEnd ?? cursor);
          children.push(scripts);
          continue;
        }
        children.push(parseAtom());
      }
      return rangeMathNode(mathNode('row', { children }), start, cursor);
    }

    try {
      const parsed = parseRow(null);
      return invalid
        ? rangeMathNode(mathNode('text', { value: input, invalid: true }), 0, input.length)
        : parsed;
    } catch (_error) {
      return rangeMathNode(mathNode('text', { value: input, invalid: true }), 0, input.length);
    }
  }

  const MATH_ACCENTS = Object.freeze({
    hat: '^', widehat: '^', bar: '¯', overline: '¯', vec: '→',
    tilde: '~', dot: '˙', ddot: '¨', underline: '_'
  });

  function appendMathNode(parent, node, sourceOffset = 0) {
    if (!node) return;
    const mapped = (element) => markSourceRange(
      element,
      sourceOffset + finiteNumber(node.sourceStart, 0),
      sourceOffset + finiteNumber(node.sourceEnd, node.sourceStart)
    );
    if (node.type === 'row') {
      const row = mapped(createElement('span', 'markdown-math-row'));
      (node.children || []).forEach((child) => appendMathNode(row, child, sourceOffset));
      parent.append(row);
      return;
    }
    if (node.type === 'fraction') {
      const fraction = mapped(createElement('span', 'markdown-math-fraction'));
      const numerator = createElement('span', 'markdown-math-numerator');
      const denominator = createElement('span', 'markdown-math-denominator');
      appendMathNode(numerator, node.numerator, sourceOffset);
      appendMathNode(denominator, node.denominator, sourceOffset);
      fraction.append(numerator, denominator);
      parent.append(fraction);
      return;
    }
    if (node.type === 'root') {
      const rootElement = mapped(createElement('span', 'markdown-math-root'));
      if (node.index) {
        const index = createElement('span', 'markdown-math-root-index');
        appendMathNode(index, node.index, sourceOffset);
        rootElement.append(index);
      }
      rootElement.append(markSourceRange(
        createElement('span', 'markdown-math-root-sign', '√'),
        sourceOffset + finiteNumber(node.sourceStart, 0),
        sourceOffset + Math.min(
          finiteNumber(node.sourceEnd, node.sourceStart),
          finiteNumber(node.sourceStart, 0) + 5
        )
      ));
      const radicand = createElement('span', 'markdown-math-radicand');
      appendMathNode(radicand, node.radicand, sourceOffset);
      rootElement.append(radicand);
      parent.append(rootElement);
      return;
    }
    if (node.type === 'scripts') {
      const scripts = mapped(createElement('span', 'markdown-math-scripts'));
      const base = createElement('span', 'markdown-math-script-base');
      appendMathNode(base, node.base, sourceOffset);
      const stack = createElement('span', 'markdown-math-script-stack');
      const superscript = createElement('sup', 'markdown-math-superscript');
      const subscript = createElement('sub', 'markdown-math-subscript');
      if (node.superscript) appendMathNode(superscript, node.superscript, sourceOffset);
      if (node.subscript) appendMathNode(subscript, node.subscript, sourceOffset);
      stack.append(superscript, subscript);
      scripts.append(base, stack);
      parent.append(scripts);
      return;
    }
    if (node.type === 'accent') {
      const accented = mapped(createElement('span', `markdown-math-accent is-${node.accent}`));
      const glyph = markSourceRange(
        createElement('span', 'markdown-math-accent-glyph', MATH_ACCENTS[node.accent] || ''),
        sourceOffset + finiteNumber(node.sourceStart, 0),
        sourceOffset + Math.min(
          finiteNumber(node.sourceEnd, node.sourceStart),
          finiteNumber(node.sourceStart, 0) + String(node.accent || '').length + 1
        )
      );
      const body = createElement('span', 'markdown-math-accent-body');
      appendMathNode(body, node.body, sourceOffset);
      accented.append(glyph, body);
      parent.append(accented);
      return;
    }
    if (node.type === 'group' || node.type === 'upright' || node.type === 'bold' || node.type === 'italic') {
      const container = mapped(createElement('span', `markdown-math-${node.type}`));
      appendMathNode(container, node.body, sourceOffset);
      parent.append(container);
      return;
    }
    const value = node.value || '';
    const type = node.type === 'identifier'
      ? 'identifier'
      : node.type === 'operator'
        ? 'operator'
        : node.type === 'delimiter'
          ? 'delimiter'
          : node.type === 'function'
            ? 'function'
            : node.type === 'number'
              ? 'number'
              : node.type === 'space'
                ? `space is-${node.width || 'normal'}`
                : 'text';
    parent.append(mapped(createElement('span', `markdown-math-${type}`, value)));
  }

  function appendRenderedMath(parent, source, display = false, sourceOffset = 0) {
    parent.dataset.mathSource = String(source || '');
    parent.setAttribute('role', 'math');
    parent.setAttribute('aria-label', String(source || ''));
    parent.classList.toggle('is-display', display);
    try {
      if (!markdownRuntime?.renderLatex) throw new Error('KaTeX runtime is unavailable.');
      parent.innerHTML = markdownRuntime.renderLatex(source, { displayMode: display });
      parent.classList.toggle('is-invalid', Boolean(parent.querySelector('.katex-error')));
    } catch (_error) {
      parent.classList.add('is-invalid');
      appendText(parent, String(source || ''));
    }
  }

  function appendSemanticMath(parent, source, display, sourceOffset) {
    const rendered = markSourceRange(createElement(
      'span',
      display ? 'markdown-page-math-display-content markdown-math-rendered' : 'markdown-math-rendered'
    ), sourceOffset, sourceOffset + String(source || '').length);
    rendered.dataset.markdownSemanticOnly = 'true';
    rendered.contentEditable = 'false';
    appendRenderedMath(rendered, source, display, sourceOffset);
    parent.append(rendered);
    return rendered;
  }

  function mathPresentationFor(mode, display, active = false) {
    const normalized = normalizedMode(mode);
    const sourceVisible = normalized === 'source'
      || (normalized === 'live-preview' && active);
    const renderedMounted = normalized === 'reading'
      || (normalized === 'live-preview' && (!active || display));
    return {
      sourceVisible,
      renderedMounted,
      layout: sourceVisible && renderedMounted && display
        ? 'source-above-rendered'
        : sourceVisible
          ? 'source-only'
          : 'rendered-only'
    };
  }

  function detachMathPresentationNode(node) {
    const parent = node?.parentNode || node?.parentElement;
    if (!node || !parent) return;
    if (typeof node.remove === 'function') {
      node.remove();
      return;
    }
    parent.replaceChildren?.(
      ...Array.from(parent.childNodes || []).filter((child) => child !== node)
    );
  }

  function modeForMathConstruct(construct) {
    const layer = construct?.closest?.('.markdown-page-layer');
    if (layer?.classList?.contains('is-source')) return 'source';
    if (layer?.classList?.contains('is-reading')) return 'reading';
    if (layer?.classList?.contains('is-live-preview')) return 'live-preview';
    return construct?.markdownMathMode || 'live-preview';
  }

  function syncMathPresentation(construct, mode = null) {
    if (!construct) return null;
    const sourceRepresentation = construct.markdownMathSourceRepresentation;
    const rendered = construct.markdownMathRendered;
    if (!sourceRepresentation || !rendered) return null;
    const resolvedMode = mode || modeForMathConstruct(construct);
    construct.markdownMathMode = resolvedMode;
    const display = construct.classList.contains('is-math-display');
    const active = construct.classList.contains('is-source-active');
    const presentation = mathPresentationFor(resolvedMode, display, active);
    sourceRepresentation.classList.toggle('is-visible', presentation.sourceVisible);
    sourceRepresentation.setAttribute('aria-hidden', String(!presentation.sourceVisible));
    construct.dataset.markdownMathPresentation = presentation.layout;
    if (presentation.renderedMounted) {
      if (rendered.parentElement !== construct) construct.append(rendered);
    } else {
      detachMathPresentationNode(rendered);
    }
    return presentation;
  }

  function tablePipeIndexes(source) {
    const line = String(source || '');
    const indexes = [];
    let inCode = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      let slashCount = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
        slashCount += 1;
      }
      const escaped = slashCount % 2 === 1;
      if (character === '`' && !escaped) inCode = !inCode;
      if (character === '|' && !escaped && !inCode) indexes.push(index);
    }
    return indexes;
  }

  function tableRowSlices(source) {
    const line = String(source || '');
    const pipes = tablePipeIndexes(line);
    const startsWithPipe = pipes[0] === line.search(/\S/);
    const endsWithPipe = pipes.at(-1) === line.trimEnd().length - 1;
    const outerLeading = startsWithPipe ? line.slice(0, pipes[0]) : '';
    const outerTrailing = endsWithPipe ? line.slice(pipes.at(-1) + 1) : '';
    const boundaries = [startsWithPipe ? pipes[0] + 1 : 0];
    for (const pipe of pipes) {
      if (startsWithPipe && pipe === pipes[0]) continue;
      boundaries.push(pipe + 1);
    }
    if (!endsWithPipe) boundaries.push(line.length + 1);
    const slices = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const rawStart = boundaries[index];
      const nextBoundary = boundaries[index + 1];
      const rawEnd = nextBoundary - 1;
      const raw = line.slice(rawStart, rawEnd);
      const leading = raw.match(/^\s*/)?.[0] || '';
      // Keep each canonical whitespace byte owned by exactly one range. For a
      // whitespace-only cell, matching both ends against the complete raw
      // value makes `leading` and `trailing` overlap, so Source-mode DOM
      // serialization duplicates the cell whitespace.
      const trailing = raw.slice(leading.length).match(/\s*$/)?.[0] || '';
      const contentStart = rawStart + leading.length;
      const contentEnd = Math.max(contentStart, rawEnd - trailing.length);
      const firstPipedCell = index === 0 && startsWithPipe;
      const finalCell = index === boundaries.length - 2;
      const prefixStart = firstPipedCell ? 0 : rawStart;
      const prefix = `${firstPipedCell ? `${outerLeading}|` : ''}${leading}`;
      const separator = rawEnd < line.length && line[rawEnd] === '|' ? '|' : '';
      slices.push({
        prefix,
        prefixStart,
        content: line.slice(contentStart, contentEnd),
        contentStart,
        suffix: `${trailing}${separator}${finalCell && endsWithPipe ? outerTrailing : ''}`,
        suffixStart: contentEnd
      });
    }
    return slices;
  }

  function blocksForSource(source) {
    return model?.sourceBlocks ? model.sourceBlocks(source) : [];
  }

  function syntaxNodeStart(node, fallback = 0) {
    return finiteNumber(node?.position?.start?.offset, fallback);
  }

  function syntaxNodeEnd(node, fallback = 0) {
    return finiteNumber(node?.position?.end?.offset, fallback);
  }

  function indexedMarkdownTaskItem(sourceOrSnapshot, itemNodeOrDescriptor) {
    const snapshot = sourceOrSnapshot?.editableListSemanticIndex
      ? sourceOrSnapshot
      : model?.createSourceSnapshot?.(String(sourceOrSnapshot || ''));
    const listIndex = snapshot?.editableListSemanticIndex;
    if (!listIndex) return { snapshot, item: null };
    const direct = itemNodeOrDescriptor?.ownerId
      ? listIndex.astListItemForOwner(itemNodeOrDescriptor.ownerId)
      : listIndex.astListItemForNode(itemNodeOrDescriptor);
    const itemStart = Number(itemNodeOrDescriptor?.start
      ?? itemNodeOrDescriptor?.position?.start?.offset);
    const item = direct || (Number.isFinite(itemStart)
      ? listIndex.astListItemAtSourceStart(itemStart)
      : null);
    return { snapshot, item };
  }

  function toggleMarkdownTaskItemSource(sourceOrSnapshot, itemNodeOrDescriptor) {
    const { snapshot, item } = indexedMarkdownTaskItem(sourceOrSnapshot, itemNodeOrDescriptor);
    const canonical = String(snapshot?.markdownBody || '');
    if (!item?.task || !Number.isFinite(item.taskCheckStart)
      || !Number.isFinite(item.taskCheckEnd)) return null;
    const markerStart = item.taskCheckStart;
    const markerEnd = item.taskCheckEnd;
    const checked = item.checked !== true;
    const replacement = checked ? 'x' : ' ';
    return {
      source: `${canonical.slice(0, markerStart)}${replacement}${canonical.slice(markerEnd)}`,
      markerStart,
      markerEnd,
      checked
    };
  }

  function createMarkdownTaskCheckbox(state, itemNode) {
    const createSharedCheckbox = root.filterCheckboxControl?.create;
    if (typeof createSharedCheckbox !== 'function') return null;
    const indexed = indexedMarkdownTaskItem(state.sourceSnapshot, itemNode).item;
    if (!indexed?.task) return null;
    const itemStart = indexed.start;
    const initiallyChecked = Boolean(indexed.checked);
    const renderedSourceVersion = state.sourceVersion;
    const currentTaskItem = () => {
      if (state.sourceVersion !== renderedSourceVersion || itemStart < 0) return null;
      return state.sourceSnapshot?.editableListSemanticIndex
        ?.astListItemAtSourceStart?.(itemStart) || null;
    };
    const control = createSharedCheckbox({
      document,
      checked: initiallyChecked,
      ariaLabel: initiallyChecked ? 'Mark task as incomplete' : 'Mark task as complete',
      onChange: (event) => {
        event.stopPropagation();
        const liveItem = currentTaskItem();
        const result = toggleMarkdownTaskItemSource(state.sourceSnapshot, liveItem);
        if (!result) {
          event.currentTarget.checked = Boolean(liveItem?.checked ?? initiallyChecked);
          if (state.sourceVersion !== renderedSourceVersion) {
            renderSemanticDocumentBlocks(state, state.bodyRoot);
          }
          return;
        }
        const beforeSelection = captureSemanticSelection(state.bodyRoot);
        replaceSemanticSourceRange(
          state,
          result.markerStart,
          result.markerEnd,
          result.source.slice(result.markerStart, result.markerEnd),
          {
            beforeSelection,
            afterSelection: beforeSelection,
            inputType: 'formatTaskList',
            restoreSelection: false
          }
        );
        commitBody(state, 'task-list-toggle');
      }
    });
    control.element.dataset.markdownSemanticOnly = 'true';
    control.element.contentEditable = 'false';
    return control.element;
  }

  function parseMarkdownSyntax(source) {
    if (model?.parseMarkdownDocument) return model.parseMarkdownDocument(String(source || ''));
    if (markdownRuntime?.parseMarkdown) return markdownRuntime.parseMarkdown(String(source || ''));
    return { type: 'root', children: [], position: { start: { offset: 0 }, end: { offset: 0 } } };
  }

  function markdownDefinitionMap(tree) {
    const definitions = new Map();
    (tree?.children || []).forEach((node) => {
      if (node.type === 'definition') {
        definitions.set(String(node.identifier || '').toLowerCase(), node);
      }
    });
    return definitions;
  }

  function markdownAstRenderContext(state, tree) {
    const source = String(state?.body || '');
    const snapshot = state?.sourceSnapshot?.parserAst === tree
      && state.sourceSnapshot?.markdownBody === source
      ? state.sourceSnapshot
      : { markdownBody: source, parserAst: tree, ast: tree };
    const recoveries = editableSyntaxAdapters?.recoverMarkdownLinkSemantics
      ? editableSyntaxAdapters.recoverMarkdownLinkSemantics(snapshot)
      : [];
    const recoveriesByParent = new WeakMap();
    const suppressedParserLinkNodes = new WeakSet();
    recoveries.forEach((recovery) => {
      if (!recoveriesByParent.has(recovery.parentNode)) {
        recoveriesByParent.set(recovery.parentNode, new Map());
      }
      recoveriesByParent.get(recovery.parentNode).set(
        recovery.firstChildIndex,
        recovery
      );
      recovery.rawParserLinkNodes.forEach((node) => suppressedParserLinkNodes.add(node));
    });
    return {
      definitions: markdownDefinitionMap(tree),
      quoteLineIndex: state?.sourceSnapshot?.quoteLineIndex || null,
      editableListSemanticIndex: state?.sourceSnapshot?.editableListSemanticIndex || null,
      linkSemanticRecoveries: recoveries,
      linkSemanticRecoveriesByParent: recoveriesByParent,
      suppressedParserLinkNodes
    };
  }

  function appendSyntaxMarker(parent, source, start, end, constructId, className = '') {
    if (end <= start) return null;
    const value = String(source || '').slice(start, end);
    if (/^\r?\n[\t ]*$/.test(value)) {
      const indentation = createHiddenSourceValue(
        value,
        start,
        'markdown-source-indentation'
      );
      indentation.dataset.markdownMarkerFor = constructId;
      parent.append(indentation);
      return indentation;
    }
    const marker = appendSourceMarker(
      parent,
      value,
      start,
      constructId
    );
    if (marker && className) marker.classList.add(className);
    return marker;
  }

  function appendGroupedSourceMarker(
    parent,
    source,
    start,
    end,
    constructId,
    groupClass,
    roleClass = ''
  ) {
    if (end <= start) return null;
    const marker = appendSourceMarker(
      parent,
      String(source || '').slice(start, end),
      start,
      constructId
    );
    if (groupClass) marker?.classList.add(groupClass);
    if (roleClass) marker?.classList.add(roleClass);
    return marker;
  }

  function appendUnderlineTagSourceMarkers(parent, source, start, end, constructId) {
    const raw = String(source || '').slice(start, end);
    const match = raw.match(/^(\s*<\s*\/?\s*)(u)(\s*>\s*)$/i);
    if (!match) {
      return appendGroupedSourceMarker(
        parent,
        source,
        start,
        end,
        constructId,
        'is-symbol-group-2'
      );
    }
    const nameStart = start + match[1].length;
    appendGroupedSourceMarker(
      parent,
      source,
      start,
      nameStart,
      constructId,
      'is-symbol-group-2'
    );
    appendGroupedSourceMarker(
      parent,
      source,
      nameStart,
      nameStart + match[2].length,
      constructId,
      'is-symbol-group-1',
      'markdown-underline-symbol-marker'
    );
    return appendGroupedSourceMarker(
      parent,
      source,
      nameStart + match[2].length,
      end,
      constructId,
      'is-symbol-group-2'
    );
  }

  function appendAstImageSourceOnly(parent, node, source) {
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    const ranges = model?.imageSourceRanges?.(source, node);
    if (!ranges) {
      appendMappedText(parent, String(source || '').slice(start, end), start);
      return null;
    }
    const construct = markSourceConstruct(
      createElement('span', 'markdown-page-image-source-only'),
      'image-source',
      start,
      end
    );
    construct.dataset.markdownImagePresentation = 'source-only';
    const marker = appendGroupedSourceMarker(
      construct,
      source,
      ranges.markerStart,
      ranges.markerEnd,
      construct.dataset.markdownConstructId,
      'is-symbol-group-2',
      'markdown-page-image-source-marker'
    );
    if (marker) marker.dataset.markdownImageSourceRole = 'marker';
    if (ranges.altEnd > ranges.altStart) {
      const alt = markSourceRange(
        createElement(
          'span',
          'markdown-page-image-source-alt',
          String(source || '').slice(ranges.altStart, ranges.altEnd)
        ),
        ranges.altStart,
        ranges.altEnd
      );
      alt.dataset.markdownImageSourceRole = 'content';
      construct.append(alt);
    }
    const destination = appendGroupedSourceMarker(
      construct,
      source,
      ranges.destinationStart,
      ranges.destinationEnd,
      construct.dataset.markdownConstructId,
      'is-symbol-group-2',
      'markdown-page-image-source-destination'
    );
    if (destination) destination.dataset.markdownImageSourceRole = 'destination';
    parent.append(construct);
    return construct;
  }

  function createHiddenSourceValue(value, start, className = '') {
    const sourceValue = String(value || '');
    const element = markSourceRange(
      createElement(
        'span',
        `markdown-source-gap-character${className ? ` ${className}` : ''}`,
        sourceValue
      ),
      start,
      start + sourceValue.length
    );
    element.dataset.markdownSourceValue = sourceValue;
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  function commonMarkEscapedPunctuation(rawSource, decodedValue) {
    const raw = String(rawSource || '');
    let decoded = '';
    let hasEscape = false;
    for (let index = 0; index < raw.length; index += 1) {
      const character = raw[index];
      const next = raw[index + 1];
      const code = next?.charCodeAt?.(0);
      const escapable = Number.isFinite(code) && (
        (code >= 33 && code <= 47)
        || (code >= 58 && code <= 64)
        || (code >= 91 && code <= 96)
        || (code >= 123 && code <= 126)
      );
      if (character === '\\' && escapable) {
        decoded += next;
        index += 1;
        hasEscape = true;
      } else {
        decoded += character;
      }
    }
    return hasEscape && decoded === String(decodedValue || '');
  }

  function quoteContinuationSourceParts(
    rawSource,
    decodedValue,
    sourceStart,
    quoteLineIndex
  ) {
    const raw = String(rawSource || '');
    const decoded = String(decodedValue || '');
    const absoluteStart = Number(sourceStart);
    const absoluteEnd = absoluteStart + raw.length;
    if (!quoteLineIndex || !Number.isFinite(absoluteStart)) return null;
    const parts = [];
    let absoluteCursor = absoluteStart;
    let decodedFromRaw = '';
    let hasQuotePrefix = false;
    while (absoluteCursor < absoluteEnd) {
      const line = quoteLineIndex.lineAtOffset(absoluteCursor, 'after');
      if (!line) return null;
      const readingPrefix = line.readingContinuationPrefix;
      if (absoluteCursor === line.start && absoluteCursor > absoluteStart
        && readingPrefix?.present && readingPrefix.end <= absoluteEnd) {
        const prefix = raw.slice(
          readingPrefix.start - absoluteStart,
          readingPrefix.end - absoluteStart
        );
        parts.push({
          type: 'quote-prefix',
          value: prefix,
          start: readingPrefix.start - absoluteStart,
          lineIndex: line.lineIndex,
          quoteDepth: readingPrefix.depth
        });
        hasQuotePrefix = true;
        absoluteCursor = readingPrefix.end;
      }
      const contentEnd = Math.min(line.contentEnd, absoluteEnd);
      if (contentEnd > absoluteCursor) {
        const content = raw.slice(
          absoluteCursor - absoluteStart,
          contentEnd - absoluteStart
        );
        parts.push({
          type: 'content',
          value: content,
          start: absoluteCursor - absoluteStart
        });
        decodedFromRaw += content;
        absoluteCursor = contentEnd;
      }
      if (absoluteCursor >= absoluteEnd) break;
      if (absoluteCursor !== line.contentEnd
        || !['\n', '\r\n'].includes(line.lineEnding)
        || line.sourceEnd > absoluteEnd) return null;
      parts.push({
        type: 'line-break',
        value: line.lineEnding,
        start: line.contentEnd - absoluteStart
      });
      decodedFromRaw += '\n';
      absoluteCursor = line.sourceEnd;
    }
    return hasQuotePrefix && decodedFromRaw === decoded ? parts : null;
  }

  function appendQuoteContinuationSource(
    parent,
    rawSource,
    decodedValue,
    sourceStart,
    quoteLineIndex
  ) {
    const parts = quoteContinuationSourceParts(
      rawSource,
      decodedValue,
      sourceStart,
      quoteLineIndex
    );
    if (!parts) return false;
    const ownerId = parent.dataset?.markdownConstructId
      || sourceConstructId('quote-line', sourceStart, sourceStart + String(rawSource || '').length);
    let currentLine = null;
    parts.forEach((part) => {
      const start = sourceStart + part.start;
      if (part.type === 'content') {
        appendMappedText(currentLine || parent, part.value, start);
        if (currentLine) {
          currentLine.dataset.markdownSourceEnd = String(start + part.value.length);
        }
        return;
      }
      if (part.type === 'line-break') {
        const lineBreak = markSourceRange(
          createElement('span', 'markdown-source-line-break', part.value),
          start,
          start + part.value.length
        );
        lineBreak.dataset.markdownSourceBreak = 'true';
        parent.append(lineBreak);
        currentLine = null;
        return;
      }
      const line = markSourceRange(
        createElement(
          'span',
          'markdown-page-quote-source-line is-inline-quote-source-line'
        ),
        start,
        start + part.value.length
      );
      const quoteDepth = Math.max(1, Number(part.quoteDepth) || 1);
      line.dataset.markdownQuoteDepth = String(quoteDepth);
      line.style.setProperty('--markdown-quote-source-depth', String(quoteDepth));
      const marker = appendSourceMarker(line, part.value, start, ownerId);
      marker?.classList.add('markdown-page-quote-source-prefix');
      parent.append(line);
      currentLine = line;
    });
    return true;
  }

  function appendPhysicalPlainSource(parent, rawSource, decodedValue, sourceStart) {
    const raw = String(rawSource || '');
    const decoded = String(decodedValue || '');
    if (!/(?:\r\n|\n)[\t ]+/.test(raw)) return false;
    const normalized = raw
      .replace(/\r\n/g, '\n')
      .replace(/\n[\t ]+/g, '\n');
    if (normalized !== decoded) return false;
    const physicalSource = markSourceRange(
      createElement('span', 'markdown-physical-source-lines'),
      sourceStart,
      sourceStart + raw.length
    );
    let cursor = 0;
    let lineIndex = 0;
    const appendLine = (value, localStart) => {
      const indentation = lineIndex > 0 ? value.match(/^[\t ]+/)?.[0] || '' : '';
      if (indentation) {
        physicalSource.append(markSourceRange(
          createElement('span', 'markdown-physical-line-indentation', indentation),
          sourceStart + localStart,
          sourceStart + localStart + indentation.length
        ));
      }
      appendMappedText(
        physicalSource,
        value.slice(indentation.length),
        sourceStart + localStart + indentation.length
      );
      lineIndex += 1;
    };
    const lineBreakPattern = /\r\n|\n/g;
    let match = lineBreakPattern.exec(raw);
    while (match) {
      appendLine(raw.slice(cursor, match.index), cursor);
      const lineBreakStart = sourceStart + match.index;
      const lineBreak = markSourceRange(
        createElement('span', 'markdown-source-line-break', match[0]),
        lineBreakStart,
        lineBreakStart + match[0].length
      );
      lineBreak.dataset.markdownSourceBreak = 'true';
      physicalSource.append(lineBreak);
      cursor = match.index + match[0].length;
      match = lineBreakPattern.exec(raw);
    }
    appendLine(raw.slice(cursor), cursor);
    parent.append(physicalSource);
    return true;
  }

  function appendEscapedSyntaxText(parent, rawSource, sourceStart, constructId) {
    const raw = String(rawSource || '');
    let runStart = 0;
    for (let index = 0; index < raw.length; index += 1) {
      const next = raw[index + 1];
      const code = next?.charCodeAt?.(0);
      const escapable = Number.isFinite(code) && (
        (code >= 33 && code <= 47)
        || (code >= 58 && code <= 64)
        || (code >= 91 && code <= 96)
        || (code >= 123 && code <= 126)
      );
      if (raw[index] !== '\\' || !escapable) continue;
      appendAstMappedText(parent, raw.slice(runStart, index), sourceStart + runStart);
      const marker = appendSourceMarker(parent, '\\', sourceStart + index, constructId);
      marker?.classList.add('markdown-escape-marker');
      appendMappedText(parent, next, sourceStart + index + 1);
      index += 1;
      runStart = index + 1;
    }
    appendAstMappedText(parent, raw.slice(runStart), sourceStart + runStart);
  }

  function appendDecodedSyntaxText(parent, node, source, context = null) {
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    const raw = String(source || '').slice(start, end);
    const value = String(node?.value || '');
    if (raw === value) {
      appendAstMappedText(parent, value, start);
      return;
    }
    if (commonMarkEscapedPunctuation(raw, value)) {
      appendEscapedSyntaxText(
        parent,
        raw,
        start,
        parent.dataset?.markdownConstructId || sourceConstructId('text', start, end)
      );
      return;
    }
    if (appendQuoteContinuationSource(
      parent,
      raw,
      value,
      start,
      context?.quoteLineIndex
    )) return;
    if (parent.dataset?.markdownPlainPhysicalLines === 'true'
      && appendPhysicalPlainSource(parent, raw, value, start)) return;
    const construct = markSourceConstruct(
      createElement('span', 'markdown-decoded-source-construct'),
      'decoded-source',
      start,
      end
    );
    appendSyntaxMarker(
      construct,
      source,
      start,
      end,
      construct.dataset.markdownConstructId
    );
    const rendered = markSourceRange(
      createElement('span', 'markdown-decoded-rendered', value),
      start,
      end
    );
    rendered.dataset.markdownSemanticOnly = 'true';
    rendered.contentEditable = 'false';
    construct.append(rendered);
    parent.append(construct);
  }

  function appendDecodedBoundaryTextSlice(
    parent,
    node,
    source,
    sliceStart,
    sliceEnd,
    context = null
  ) {
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    if (sliceEnd <= sliceStart) return;
    const leadingShellCharacters = sliceStart - start;
    const trailingShellCharacters = end - sliceEnd;
    if (![0, 1].includes(leadingShellCharacters)
      || ![0, 1].includes(trailingShellCharacters)) {
      throw new TypeError('Recovered link boundary text must trim at most one shell character.');
    }
    const decoded = String(node?.value || '');
    const decodedEnd = decoded.length - trailingShellCharacters;
    appendDecodedSyntaxText(parent, {
      type: 'text',
      value: decoded.slice(leadingShellCharacters, decodedEnd),
      position: {
        start: { offset: sliceStart },
        end: { offset: sliceEnd }
      }
    }, source, context);
  }

  function approvedInlineHtmlTag(node) {
    if (node?.type !== 'html') return null;
    const match = String(node.value || '').trim().match(/^<\s*(\/?)\s*(u|sub|sup)\s*>$/i);
    if (!match) return null;
    return { closing: Boolean(match[1]), name: match[2].toLowerCase() };
  }

  function appendRecoveredAstLink(parent, recovery, source, state) {
    const start = Number(recovery.start);
    const end = Number(recovery.end);
    const href = model?.safeLinkHref ? model.safeLinkHref(recovery.href) : recovery.href;
    const link = markSourceConstruct(
      createElement('span', 'markdown-page-link'),
      'link',
      start,
      end
    );
    link.dataset.markdownLinkSemanticRecovery = String(recovery.kind || '');
    link.classList.toggle('is-valid', Boolean(href));
    if (recovery.title) link.title = recovery.title;
    appendSyntaxMarker(
      link,
      source,
      start,
      recovery.labelStart,
      link.dataset.markdownConstructId
    );
    appendAstMappedText(
      link,
      String(source || '').slice(recovery.labelStart, recovery.labelEnd),
      recovery.labelStart
    );
    appendSyntaxMarker(
      link,
      source,
      recovery.labelEnd,
      end,
      link.dataset.markdownConstructId
    );
    link.addEventListener('click', (event) => {
      if (state?.mode !== 'reading' || !href) return;
      event.preventDefault();
      event.stopPropagation();
      invoke(state?.onLinkActivate, {
        href,
        paneId: state?.paneId || null,
        pageId: state?.page?.id || state?.page?.pageId || null,
        event
      });
    });
    parent.append(link);
    const arrowDescriptor = state?.linkArrowDescriptorAtRange?.(start, end);
    if (state?.mode === 'live-preview' && arrowDescriptor && !arrowDescriptor.active) {
      state?.linkArrowAnchorSink?.({
        ...linkArrowIdentity(arrowDescriptor),
        rightEdgeAnchor: link
      });
    }
    return link;
  }

  function appendAstChildren(parent, node, source, state, context, options = {}) {
    const children = node?.children || [];
    const ownerId = options.constructId || parent.dataset?.markdownConstructId
      || sourceConstructId(node?.type || 'construct', syntaxNodeStart(node), syntaxNodeEnd(node));
    let cursor = syntaxNodeStart(node);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const firstRecovery = context?.linkSemanticRecoveriesByParent
        ?.get(node)?.get(index) || null;
      if (firstRecovery) {
        const firstChildStart = syntaxNodeStart(child, cursor);
        appendSyntaxMarker(parent, source, cursor, firstChildStart, ownerId);
        appendDecodedBoundaryTextSlice(
          parent,
          child,
          source,
          firstChildStart,
          firstRecovery.start,
          context
        );
        let recovery = firstRecovery;
        while (recovery) {
          appendRecoveredAstLink(parent, recovery, source, state);
          const lastChild = children[recovery.lastChildIndex];
          const lastChildEnd = syntaxNodeEnd(lastChild, recovery.end);
          const nextRecovery = context.linkSemanticRecoveriesByParent
            .get(node)?.get(recovery.lastChildIndex) || null;
          if (nextRecovery && nextRecovery !== recovery) {
            appendDecodedBoundaryTextSlice(
              parent,
              lastChild,
              source,
              recovery.end,
              nextRecovery.start,
              context
            );
            recovery = nextRecovery;
            continue;
          }
          appendDecodedBoundaryTextSlice(
            parent,
            lastChild,
            source,
            recovery.end,
            lastChildEnd,
            context
          );
          cursor = lastChildEnd;
          index = recovery.lastChildIndex;
          recovery = null;
        }
        continue;
      }
      const childStart = syntaxNodeStart(child, cursor);
      appendSyntaxMarker(parent, source, cursor, childStart, ownerId);
      const htmlTag = approvedInlineHtmlTag(child);
      if (htmlTag && !htmlTag.closing) {
        let depth = 1;
        let closingIndex = -1;
        for (let candidateIndex = index + 1; candidateIndex < children.length; candidateIndex += 1) {
          const candidate = approvedInlineHtmlTag(children[candidateIndex]);
          if (!candidate || candidate.name !== htmlTag.name) continue;
          depth += candidate.closing ? -1 : 1;
          if (depth === 0) {
            closingIndex = candidateIndex;
            break;
          }
        }
        if (closingIndex >= 0) {
          const closing = children[closingIndex];
          const wrapperStart = childStart;
          const wrapperEnd = syntaxNodeEnd(closing, wrapperStart);
          const wrapper = markSourceConstruct(
            createElement(
              htmlTag.name,
              `markdown-page-inline-${htmlTag.name}${htmlTag.name === 'u'
                ? ' markdown-page-inline-underline'
                : ''}`
            ),
            htmlTag.name === 'u' ? 'underline' : htmlTag.name,
            wrapperStart,
            wrapperEnd
          );
          if (htmlTag.name === 'u') {
            appendUnderlineTagSourceMarkers(
              wrapper,
              source,
              childStart,
              syntaxNodeEnd(child, childStart),
              wrapper.dataset.markdownConstructId
            );
          } else {
            appendSyntaxMarker(
              wrapper,
              source,
              childStart,
              syntaxNodeEnd(child, childStart),
              wrapper.dataset.markdownConstructId
            );
          }
          const innerStart = syntaxNodeEnd(child, childStart);
          const innerEnd = syntaxNodeStart(closing, innerStart);
          appendAstChildren(wrapper, {
            children: children.slice(index + 1, closingIndex),
            position: {
              start: { offset: innerStart },
              end: { offset: innerEnd }
            }
          }, source, state, context, {
            constructId: wrapper.dataset.markdownConstructId
          });
          if (htmlTag.name === 'u') {
            appendUnderlineTagSourceMarkers(
              wrapper,
              source,
              syntaxNodeStart(closing, innerEnd),
              wrapperEnd,
              wrapper.dataset.markdownConstructId
            );
          } else {
            appendSyntaxMarker(
              wrapper,
              source,
              syntaxNodeStart(closing, innerEnd),
              wrapperEnd,
              wrapper.dataset.markdownConstructId
            );
          }
          parent.append(wrapper);
          cursor = wrapperEnd;
          index = closingIndex;
          continue;
        }
      }
      appendAstNode(parent, child, source, state, context);
      cursor = syntaxNodeEnd(child, childStart);
    }
    appendSyntaxMarker(parent, source, cursor, syntaxNodeEnd(node, cursor), ownerId);
  }

  function appendAstLink(parent, node, source, state, context) {
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    if (context?.suppressedParserLinkNodes?.has(node)) {
      appendAstMappedText(parent, String(source || '').slice(start, end), start);
      return;
    }
    const definition = node.type === 'linkReference'
      ? context.definitions.get(String(node.identifier || '').toLowerCase())
      : node;
    const href = model?.safeLinkHref ? model.safeLinkHref(definition?.url) : '';
    const link = markSourceConstruct(
      createElement('span', 'markdown-page-link'),
      'link',
      start,
      end
    );
    link.classList.toggle('is-valid', Boolean(href));
    if (definition?.title) link.title = definition.title;
    appendAstChildren(link, node, source, state, context, {
      constructId: link.dataset.markdownConstructId
    });
    link.addEventListener('click', (event) => {
      if (state?.mode !== 'reading' || !href) return;
      event.preventDefault();
      event.stopPropagation();
      invoke(state?.onLinkActivate, {
        href,
        paneId: state?.paneId || null,
        pageId: state?.page?.id || state?.page?.pageId || null,
        event
      });
    });
    parent.append(link);
    const arrowDescriptor = state?.linkArrowDescriptorAtRange?.(start, end);
    if (state?.mode === 'live-preview' && arrowDescriptor && !arrowDescriptor.active) {
      state?.linkArrowAnchorSink?.({
        ...linkArrowIdentity(arrowDescriptor),
        rightEdgeAnchor: link
      });
    }
  }

  function appendAstInlineCode(parent, node, source) {
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    const raw = String(source || '').slice(start, end);
    const opening = raw.match(/^`+/)?.[0] || '`';
    const closing = raw.match(/`+$/)?.[0] || opening;
    const innerStart = start + opening.length;
    const innerEnd = Math.max(innerStart, end - closing.length);
    const construct = markSourceConstruct(
      createElement('code', 'markdown-page-inline-code'),
      'code',
      start,
      end
    );
    appendSyntaxMarker(
      construct,
      source,
      start,
      innerStart,
      construct.dataset.markdownConstructId
    );
    const canonicalContent = appendSyntaxMarker(
      construct,
      source,
      innerStart,
      innerEnd,
      construct.dataset.markdownConstructId,
      'markdown-inline-code-source-content'
    );
    canonicalContent?.classList.add('markdown-inline-code-source-content');
    const rendered = markSourceRange(
      createElement('span', 'markdown-inline-code-rendered', node.value || ''),
      innerStart,
      innerEnd
    );
    rendered.dataset.markdownSemanticOnly = 'true';
    rendered.contentEditable = 'false';
    construct.append(rendered);
    appendSyntaxMarker(
      construct,
      source,
      innerEnd,
      end,
      construct.dataset.markdownConstructId
    );
    parent.append(construct);
  }

  function appendAstMath(parent, node, source, display, state = null) {
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    const raw = String(source || '').slice(start, end);
    let contentStart;
    let contentEnd;
    if (display) {
      const first = raw.indexOf('$$');
      const last = raw.lastIndexOf('$$');
      contentStart = start + Math.max(0, first) + 2;
      const openingBreak = raw.slice(Math.max(0, first) + 2).match(/^\r?\n/)?.[0] || '';
      contentStart += openingBreak.length;
      contentEnd = last > first ? start + last : end;
      const closingBreak = String(source || '').slice(contentStart, contentEnd).match(/\r?\n$/)?.[0] || '';
      contentEnd -= closingBreak.length;
    } else {
      const opening = raw.match(/^\$+/)?.[0] || '$';
      const closing = raw.match(/\$+$/)?.[0] || opening;
      contentStart = start + opening.length;
      contentEnd = Math.max(contentStart, end - closing.length);
    }
    const construct = markSourceConstruct(
      createElement(display ? 'div' : 'span', display
        ? 'markdown-page-math-display'
        : 'markdown-page-math-inline-construct'),
      display ? 'math-display' : 'math',
      start,
      end
    );
    const sourceRepresentation = createElement(
      display ? 'div' : 'span',
      `markdown-math-source-representation ${display ? 'is-display' : 'is-inline'}`
    );
    const openingSource = display ? '$$' : raw.match(/^\$+/)?.[0] || '$';
    const closingSource = display ? '$$' : raw.match(/\$+$/)?.[0] || openingSource;
    const openingStart = start + Math.max(0, raw.indexOf(openingSource));
    const openingEnd = Math.min(end, openingStart + openingSource.length);
    const closingIndex = raw.lastIndexOf(closingSource);
    const closingStart = closingIndex >= 0 ? start + closingIndex : end;
    const closingEnd = Math.min(end, closingStart + closingSource.length);
    appendGroupedSourceMarker(
      sourceRepresentation,
      source,
      start,
      openingStart,
      construct.dataset.markdownConstructId,
      'is-symbol-group-2'
    );
    appendGroupedSourceMarker(
      sourceRepresentation,
      source,
      openingStart,
      openingEnd,
      construct.dataset.markdownConstructId,
      'is-symbol-group-1',
      'markdown-math-delimiter-marker'
    );
    appendGroupedSourceMarker(
      sourceRepresentation,
      source,
      openingEnd,
      contentStart,
      construct.dataset.markdownConstructId,
      'is-symbol-group-2'
    );
    const sourceText = markSourceRange(
      createElement(
        'span',
        'markdown-math-source-text',
        String(source || '').slice(contentStart, contentEnd)
      ),
      contentStart,
      contentEnd
    );
    sourceRepresentation.append(sourceText);
    appendGroupedSourceMarker(
      sourceRepresentation,
      source,
      contentEnd,
      closingStart,
      construct.dataset.markdownConstructId,
      'is-symbol-group-2'
    );
    appendGroupedSourceMarker(
      sourceRepresentation,
      source,
      closingStart,
      closingEnd,
      construct.dataset.markdownConstructId,
      'is-symbol-group-1',
      'markdown-math-delimiter-marker'
    );
    appendGroupedSourceMarker(
      sourceRepresentation,
      source,
      closingEnd,
      end,
      construct.dataset.markdownConstructId,
      'is-symbol-group-2'
    );
    construct.append(sourceRepresentation);
    const rendered = appendSemanticMath(
      construct,
      String(source || '').slice(contentStart, contentEnd),
      display,
      contentStart
    );
    construct.markdownMathSourceRepresentation = sourceRepresentation;
    construct.markdownMathSourceText = sourceText;
    construct.markdownMathRendered = rendered;
    syncMathPresentation(construct, state?.mode || 'live-preview');
    parent.append(construct);
  }

  function closeCodeLanguageMenu() {
    const active = activeCodeLanguageMenu;
    if (!active) return;
    activeCodeLanguageMenu = null;
    document.removeEventListener('pointerdown', active.onDocumentPointerDown, true);
    document.removeEventListener('keydown', active.onDocumentKeyDown, true);
    active.element.remove();
    active.button?.setAttribute('aria-expanded', 'false');
  }

  function shiftedSelectionAfterReplacement(selection, start, end, replacementLength) {
    const delta = replacementLength - (end - start);
    const shift = (offset) => {
      if (offset <= start) return offset;
      if (offset >= end) return offset + delta;
      return start + replacementLength;
    };
    return { anchor: shift(selection.anchor), focus: shift(selection.focus) };
  }

  function openCodeLanguageMenu(button, state, fence) {
    closeCodeLanguageMenu();
    if (!semanticModeEditable(state) || !markdownRuntime?.languageMetadata?.length) return;
    const selection = markdownSelectionForState(state, fence.infoEnd);
    const menu = createElement('div', 'markdown-code-language-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Code language');
    menu.dataset.markdownSemanticOnly = 'true';
    menu.contentEditable = 'false';
    markdownRuntime.languageMetadata.forEach((language) => {
      const item = createElement('button', 'markdown-code-language-menu-item', language.label);
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      const current = markdownRuntime.resolveCodeLanguage(fence.declaredLanguage || '').id;
      item.setAttribute('aria-checked', String(current === language.id));
      item.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const replacement = language.id === 'plaintext' ? '' : language.id;
        const afterSelection = shiftedSelectionAfterReplacement(
          selection,
          fence.infoStart,
          fence.infoEnd,
          replacement.length
        );
        closeCodeLanguageMenu();
        replaceSemanticSourceRange(
          state,
          fence.infoStart,
          fence.infoEnd,
          replacement,
          {
            beforeSelection: selection,
            afterSelection,
            inputType: 'formatCodeLanguage'
          }
        );
      });
      menu.append(item);
    });
    document.body.append(menu);
    const rect = button.closest?.('.markdown-code-language-control')?.getBoundingClientRect()
      || button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    menu.style.left = `${clamp(rect.right - menuRect.width, 8, window.innerWidth - menuRect.width - 8)}px`;
    menu.style.top = `${clamp(rect.bottom + 4, 8, window.innerHeight - menuRect.height - 8)}px`;
    const onDocumentPointerDown = (event) => {
      if (!menu.contains(event.target) && !button.contains(event.target)) closeCodeLanguageMenu();
    };
    const onDocumentKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeCodeLanguageMenu();
      button.focus({ preventScroll: true });
    };
    activeCodeLanguageMenu = {
      element: menu,
      button,
      onDocumentPointerDown,
      onDocumentKeyDown
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  }

  function canonicalCodeBodyText(source, fence = {}) {
    const canonical = typeof source === 'string' ? source : String(source || '');
    const start = clamp(finiteNumber(fence.bodyStart, 0), 0, canonical.length);
    let end = clamp(finiteNumber(fence.bodyEnd, start), start, canonical.length);
    let hasClosingFence = false;
    if (fence.fenced && (fence.marker === '`' || fence.marker === '~')) {
      const constructEnd = clamp(finiteNumber(fence.end, end), end, canonical.length);
      const markerLength = Math.max(3, finiteNumber(fence.markerLength, 3));
      const escapedMarker = fence.marker;
      const closingPattern = new RegExp(
        `(?:^|\\r?\\n)( {0,3})(${escapedMarker}{${markerLength},})[ \\t]*(?=\\r?$)`,
        'gm'
      );
      const bodyAndClosing = canonical.slice(start, constructEnd);
      const closingMatches = [...bodyAndClosing.matchAll(closingPattern)];
      const closing = closingMatches.at(-1);
      if (closing) {
        const lineBreakLength = closing[0].startsWith('\r\n')
          ? 2
          : closing[0].startsWith('\n') ? 1 : 0;
        end = Math.min(end, start + (closing.index || 0) + lineBreakLength);
        hasClosingFence = true;
      }
    }
    if (hasClosingFence && end > start) {
      if (canonical.slice(end - 2, end) === '\r\n') end -= 2;
      else if (canonical[end - 1] === '\n' || canonical[end - 1] === '\r') end -= 1;
    }
    return canonical.slice(start, end);
  }

  function liveCodeFenceRange(fence, codeElement) {
    const bodyStart = finiteNumber(codeElement?.dataset?.markdownSourceStart, fence.bodyStart);
    const bodyEnd = finiteNumber(codeElement?.dataset?.markdownSourceEnd, fence.bodyEnd);
    const delta = bodyStart - finiteNumber(fence.bodyStart, bodyStart);
    const shifted = { ...fence, bodyStart, bodyEnd };
    [
      'start',
      'end',
      'fenceStart',
      'fenceEnd',
      'infoStart',
      'infoEnd',
      'closingStart'
    ].forEach((key) => {
      if (Number.isFinite(Number(fence[key]))) shifted[key] = Number(fence[key]) + delta;
    });
    const construct = codeElement?.closest?.('.markdown-page-code-shell');
    shifted.start = finiteNumber(construct?.dataset?.markdownSourceStart, shifted.start);
    shifted.end = finiteNumber(construct?.dataset?.markdownSourceEnd, shifted.end);
    return shifted;
  }

  function createCodeLanguageControl(state, fence, highlighted, codeElement) {
    const control = createElement('span', 'markdown-code-language-control');
    control.contentEditable = 'false';
    control.dataset.markdownSemanticOnly = 'true';
    control.setAttribute('role', 'group');
    control.setAttribute('aria-label', 'Code block actions');
    const selector = createElement('button', 'markdown-code-language-selector');
    selector.type = 'button';
    selector.contentEditable = 'false';
    selector.setAttribute('aria-label', 'Change code language');
    selector.setAttribute('aria-haspopup', 'menu');
    selector.setAttribute('aria-expanded', 'false');
    const icon = createMarkdownInteractionIcon('code', 'markdown-code-language-icon');
    selector.append(icon);
    const copy = createElement(
      'button',
      'markdown-code-language-copy markdown-code-language-name',
      highlighted.displayName
    );
    copy.type = 'button';
    copy.contentEditable = 'false';
    copy.setAttribute('aria-label', `Copy ${highlighted.displayName} code body`);
    if (!semanticModeEditable(state)) {
      selector.classList.add('is-display-only');
      selector.setAttribute('aria-disabled', 'true');
      selector.tabIndex = -1;
    }
    [selector, copy].forEach((button) => button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    }));
    selector.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCodeLanguageMenu(selector, state, liveCodeFenceRange(fence, codeElement));
    });
    copy.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      writeCanonicalCodeBodyClipboard(
        state,
        canonicalCodeBodyText(state.body, liveCodeFenceRange(fence, codeElement))
      );
    });
    control.append(selector, copy);
    return control;
  }

  function appendAstCode(parent, node, source, state) {
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    const fence = model?.codeFenceRanges
      ? model.codeFenceRanges(source, node)
      : { fenced: false, start, end, bodyStart: start, bodyEnd: end, infoStart: start, infoEnd: start };
    fence.declaredLanguage = node.lang || '';
    const codeSource = fence.fenced
      ? String(source || '').slice(fence.bodyStart, fence.bodyEnd)
      : String(source || '').slice(start, end);
    const highlighted = markdownRuntime?.highlightCode
      ? markdownRuntime.highlightCode(codeSource, node.lang || '')
      : { html: '', language: '', displayName: node.lang || 'Plain Text' };
    const shell = markSourceConstruct(
      createElement('div', `markdown-page-code-shell ${fence.fenced ? 'is-fenced' : 'is-indented'}`),
      'code-block',
      start,
      end
    );
    const pre = createElement('pre', 'markdown-page-code-block');
    if (fence.fenced) {
      appendSyntaxMarker(
        pre,
        source,
        start,
        fence.bodyStart,
        shell.dataset.markdownConstructId
      );
    }
    const code = markSourceRange(
      createElement('code', `hljs${highlighted.language ? ` language-${highlighted.language}` : ''}`),
      fence.bodyStart,
      fence.bodyEnd
    );
    code.spellcheck = false;
    code.dataset.language = node.lang || '';
    if (highlighted.html) code.innerHTML = highlighted.html;
    else if (codeSource) appendText(code, codeSource);
    else code.append(createElement('br'));
    pre.append(code);
    if (fence.fenced) {
      appendSyntaxMarker(
        pre,
        source,
        fence.bodyEnd,
        end,
        shell.dataset.markdownConstructId
      );
    }
    if (fence.fenced) {
      shell.append(createCodeLanguageControl(state, fence, highlighted, code));
    }
    shell.append(pre);
    parent.append(shell);
  }

  function markdownTableInteractionEnabled(state) {
    return Boolean(state?.mode === 'live-preview' && semanticModeEditable(state));
  }

  function markMarkdownTableControl(element) {
    if (!element) return element;
    element.dataset.markdownSemanticOnly = 'true';
    element.contentEditable = 'false';
    element.setAttribute('draggable', 'false');
    return element;
  }

  function renderedTableStart(table) {
    return finiteNumber(table?.dataset?.markdownSourceStart, NaN);
  }

  function markdownTableColumnCount(table) {
    return [...(table?.querySelectorAll?.('[data-markdown-table-column-index]') || [])]
      .reduce((count, cell) => Math.max(
        count,
        finiteNumber(cell.dataset.markdownTableColumnIndex, -1) + 1
      ), 0);
  }

  function markdownTableBodyRows(table) {
    return [...(table?.querySelectorAll?.('tr') || [])].filter((row) => (
      Object.hasOwn(row.dataset || {}, 'markdownTableRowIndex')
    ));
  }

  function clearMarkdownTableContextAnchor(state, token = null) {
    if (!state) return false;
    const activeToken = state.tableContextMenuToken;
    if (!activeToken || (token && activeToken !== token)) return false;
    activeToken.cell?.classList?.remove('is-table-context-anchor');
    state.tableContextMenuToken = null;
    return true;
  }

  function beginMarkdownTableContextAnchor(state, cell) {
    if (!state || !cell) return null;
    clearMarkdownTableContextAnchor(state);
    const token = { cell };
    cell.classList.add('is-table-context-anchor');
    state.tableContextMenuToken = token;
    return token;
  }

  function markdownTableCellLocation(cell) {
    if (!cell) return null;
    const isHeader = cell.tagName === 'TH';
    return {
      isHeader,
      rowIndex: isHeader ? -1 : finiteNumber(cell.dataset.markdownTableRowIndex, -1),
      columnIndex: finiteNumber(cell.dataset.markdownTableColumnIndex, -1)
    };
  }

  function commitMarkdownTableOperation(state, table, command) {
    if (!markdownTableInteractionEnabled(state) || !table?.isConnected
      || typeof model?.applyMarkdownTableOperation !== 'function') return false;
    const tableStart = renderedTableStart(table);
    if (!Number.isFinite(tableStart)) return false;
    const result = model.applyMarkdownTableOperation(state.body, tableStart, command);
    if (!result?.ok || !result.changed || typeof result.replacement !== 'string') return false;
    state.editableActiveTableCell = null;
    replaceSemanticSourceRange(state, result.start, result.end, result.replacement, {
      beforeSelection: { anchor: result.start, focus: result.start },
      afterSelection: { anchor: result.start, focus: result.start },
      inputType: 'formatTableStructure',
      restoreSelection: false
    });
    commitBody(state, 'table-structure');
    state.semanticFocusOriginalBody = state.body;
    state.semanticFocusHistorySnapshot = snapshotMarkdownEditHistory(state.editHistory);
    return true;
  }

  function markdownTableCommandFromMenu(commandId, cell) {
    const rowIndex = finiteNumber(cell?.dataset?.markdownTableRowIndex, -1);
    const columnIndex = finiteNumber(cell?.dataset?.markdownTableColumnIndex, -1);
    switch (commandId) {
      case 'align-table-column-left':
        return { type: 'set-alignment', columnIndex, alignment: 'left' };
      case 'align-table-column-centre':
        return { type: 'set-alignment', columnIndex, alignment: 'center' };
      case 'align-table-column-right':
        return { type: 'set-alignment', columnIndex, alignment: 'right' };
      case 'insert-table-row-above':
        return { type: 'insert-row', index: rowIndex };
      case 'insert-table-row-below':
        return { type: 'insert-row', index: rowIndex + 1 };
      case 'insert-table-column-left':
        return { type: 'insert-column', index: columnIndex };
      case 'insert-table-column-right':
        return { type: 'insert-column', index: columnIndex + 1 };
      case 'move-table-row-up':
        return { type: 'move-row', fromIndex: rowIndex, toIndex: rowIndex - 1 };
      case 'move-table-row-down':
        return { type: 'move-row', fromIndex: rowIndex, toIndex: rowIndex + 1 };
      case 'move-table-column-left':
        return { type: 'move-column', fromIndex: columnIndex, toIndex: columnIndex - 1 };
      case 'move-table-column-right':
        return { type: 'move-column', fromIndex: columnIndex, toIndex: columnIndex + 1 };
      case 'sort-table-rows-alpha-asc':
        return { type: 'sort-rows', columnIndex, sort: 'alphabetical', direction: 'asc' };
      case 'sort-table-rows-alpha-desc':
        return { type: 'sort-rows', columnIndex, sort: 'alphabetical', direction: 'desc' };
      case 'sort-table-rows-numeric-asc':
        return { type: 'sort-rows', columnIndex, sort: 'numeric', direction: 'asc' };
      case 'sort-table-rows-numeric-desc':
        return { type: 'sort-rows', columnIndex, sort: 'numeric', direction: 'desc' };
      case 'sort-table-columns-alpha-asc':
        return { type: 'sort-columns', rowIndex, sort: 'alphabetical', direction: 'asc' };
      case 'sort-table-columns-alpha-desc':
        return { type: 'sort-columns', rowIndex, sort: 'alphabetical', direction: 'desc' };
      case 'sort-table-columns-numeric-asc':
        return { type: 'sort-columns', rowIndex, sort: 'numeric', direction: 'asc' };
      case 'sort-table-columns-numeric-desc':
        return { type: 'sort-columns', rowIndex, sort: 'numeric', direction: 'desc' };
      default:
        return null;
    }
  }

  async function openMarkdownTableContextMenu(state, event) {
    if (!markdownTableInteractionEnabled(state)) return false;
    const cell = event.target?.closest?.(
      '.markdown-page-table th[data-markdown-table-column-index], '
      + '.markdown-page-table td[data-markdown-table-column-index]'
    );
    const table = cell?.closest?.('.markdown-page-table');
    if (!cell || !table || !state.bodyRoot?.contains(table)) return false;
    if (!root.nativeContextMenu?.available?.()) {
      clearMarkdownTableContextAnchor(state);
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const location = markdownTableCellLocation(cell);
    const rowCount = markdownTableBodyRows(table).length;
    const columnCount = markdownTableColumnCount(table);
    const isHeader = cell.tagName === 'TH';
    const token = beginMarkdownTableContextAnchor(state, cell);
    try {
      const commandId = await root.nativeContextMenu.open(event, {
        type: 'markdown-table-cell',
        targetId: `${statePageId(state) || 'page'}:${renderedTableStart(table)}:${location.rowIndex}:${location.columnIndex}`,
        isHeader,
        isFirstColumn: location.columnIndex === 0,
        isTopLeft: isHeader && location.columnIndex === 0,
        canMoveRowUp: !isHeader && location.rowIndex > 0,
        canMoveRowDown: !isHeader && location.rowIndex >= 0 && location.rowIndex < rowCount - 1,
        canMoveColumnLeft: location.columnIndex > 0,
        canMoveColumnRight: location.columnIndex >= 0 && location.columnIndex < columnCount - 1
      });
      if (state.tableContextMenuToken !== token) return true;
      if (!commandId || !markdownTableInteractionEnabled(state) || !table.isConnected) return true;
      const command = markdownTableCommandFromMenu(commandId, cell);
      if (command) commitMarkdownTableOperation(state, table, command);
      return true;
    } finally {
      clearMarkdownTableContextAnchor(state, token);
    }
  }

  function handleMarkdownTablePointerDown(state, event) {
    if (!markdownTableInteractionEnabled(state)) return false;
    const tableTarget = event.target?.closest?.(
      '.markdown-page-table-shell, .markdown-page-table'
    );
    if (!tableTarget || !state.bodyRoot?.contains(tableTarget)) return false;
    if (event.button !== 0) return false;
    const addControl = event.target.closest?.(
      '.markdown-table-add-column, .markdown-table-add-row'
    );
    if (addControl) {
      // The control's own target-phase listener stops the pointerdown before
      // it reaches Canvas/Page pan ownership. Do not stop it during capture:
      // Chromium must deliver pointerdown to the button to synthesize click.
      return true;
    }
    const cell = event.target.closest?.(
      '.markdown-page-table th[data-markdown-table-column-index], '
      + '.markdown-page-table td[data-markdown-table-column-index]'
    );
    const table = cell?.closest?.('.markdown-page-table');
    if (!cell || !table) return false;
    clearMarkdownTableContextAnchor(state);
    return false;
  }

  function handleMarkdownTableClick(state, event) {
    if (!markdownTableInteractionEnabled(state)) return false;
    const control = event.target?.closest?.(
      '.markdown-table-add-column, .markdown-table-add-row'
    );
    if (!control || !state.bodyRoot?.contains(control)) return false;
    event.preventDefault();
    event.stopPropagation();
    const table = control.closest('.markdown-page-table-shell')?.querySelector?.(
      '.markdown-page-table'
    ) || control.closest('.markdown-page-table');
    if (!table) return true;
    if (control.classList.contains('markdown-table-add-column')) {
      commitMarkdownTableOperation(state, table, { type: 'append-column' });
    } else {
      commitMarkdownTableOperation(state, table, { type: 'append-row' });
    }
    return true;
  }

  function appendMarkdownTableSourceLine(parent, line, lineStart, constructId, delimiter) {
    const sourceLine = markSourceRange(
      createElement('span', 'markdown-page-table-source-line'),
      lineStart,
      lineStart + line.length
    );
    if (delimiter) {
      appendSourceMarker(sourceLine, line, lineStart, constructId);
    } else {
      tableRowSlices(line).forEach((slice) => {
        appendSourceMarker(
          sourceLine,
          slice.prefix,
          lineStart + slice.prefixStart,
          constructId
        );
        appendMappedText(
          sourceLine,
          slice.content,
          lineStart + slice.contentStart
        );
        appendSourceMarker(
          sourceLine,
          slice.suffix,
          lineStart + slice.suffixStart,
          constructId
        );
      });
    }
    parent.append(sourceLine);
  }

  function appendMarkdownTableSource(parent, rawSource, sourceStart, constructId) {
    const raw = String(rawSource || '');
    let cursor = 0;
    let lineIndex = 0;
    for (const match of raw.matchAll(/\r\n|\n/g)) {
      const line = raw.slice(cursor, match.index);
      appendMarkdownTableSourceLine(
        parent,
        line,
        sourceStart + cursor,
        constructId,
        lineIndex === 1
      );
      appendAstMappedText(parent, match[0], sourceStart + match.index);
      cursor = match.index + match[0].length;
      lineIndex += 1;
    }
    appendMarkdownTableSourceLine(
      parent,
      raw.slice(cursor),
      sourceStart + cursor,
      constructId,
      lineIndex === 1
    );
  }

  function appendAstTable(parent, node, source, state, context) {
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    if (state?.mode === 'source') {
      const sourceTable = markSourceConstruct(
        createElement('pre', 'markdown-page-table-source'),
        'table-source',
        start,
        end
      );
      appendMarkdownTableSource(
        sourceTable,
        String(source || '').slice(start, end),
        start,
        sourceTable.dataset.markdownConstructId
      );
      parent.append(sourceTable);
      return;
    }
    const table = markSourceConstruct(
      createElement('table', 'markdown-page-table'),
      'table',
      start,
      end
    );
    table.dataset.markdownTableStart = String(start);
    table.dataset.markdownTableEnd = String(end);
    const rows = node.children || [];
    const head = createElement('thead');
    const body = createElement('tbody');
    const interactive = markdownTableInteractionEnabled(state);
    const renderRow = (rowNode, header, bodyRowIndex = -1) => {
      const row = markSourceRange(
        createElement('tr'),
        syntaxNodeStart(rowNode),
        syntaxNodeEnd(rowNode)
      );
      if (!header) row.dataset.markdownTableRowIndex = String(bodyRowIndex);
      (rowNode.children || []).forEach((cellNode, columnIndex) => {
        const cell = markSourceConstruct(
          createElement(header ? 'th' : 'td'),
          'table-cell',
          syntaxNodeStart(cellNode),
          syntaxNodeEnd(cellNode)
        );
        cell.dataset.markdownTableColumnIndex = String(columnIndex);
        cell.dataset.markdownTableRowIndex = String(header ? -1 : bodyRowIndex);
        const alignment = node.align?.[columnIndex];
        if (alignment) cell.style.textAlign = alignment;
        appendAstChildren(cell, cellNode, source, state, context, {
          constructId: cell.dataset.markdownConstructId
        });
        row.append(cell);
      });
      return row;
    };
    if (rows[0]) head.append(renderRow(rows[0], true));
    if (rows[0]) {
      const delimiterStart = syntaxNodeEnd(rows[0]);
      const delimiterEnd = rows[1] ? syntaxNodeStart(rows[1]) : end;
      if (delimiterEnd > delimiterStart) {
        const delimiterRow = createElement('tr', 'markdown-table-delimiter-row');
        const delimiterCell = createElement('td');
        delimiterCell.colSpan = Math.max(1, rows[0].children?.length || 1);
        appendSyntaxMarker(
          delimiterCell,
          source,
          delimiterStart,
          delimiterEnd,
          table.dataset.markdownConstructId,
          'markdown-table-delimiter-marker'
        );
        delimiterRow.append(delimiterCell);
        body.append(delimiterRow);
      }
    }
    rows.slice(1).forEach((rowNode, index) => {
      const row = renderRow(rowNode, false, index);
      const gapStart = syntaxNodeEnd(rowNode);
      const gapEnd = rows[index + 2] ? syntaxNodeStart(rows[index + 2]) : end;
      const lastCell = row.lastElementChild;
      if (lastCell && gapEnd > gapStart) {
        appendSyntaxMarker(
          lastCell,
          source,
          gapStart,
          gapEnd,
          table.dataset.markdownConstructId
        );
      }
      body.append(row);
    });
    table.append(head, body);
    if (!interactive) {
      parent.append(table);
      return;
    }
    const shell = createElement('div', 'markdown-page-table-shell');
    shell.dataset.markdownTableStart = String(start);
    shell.dataset.markdownTableEnd = String(end);
    const addColumn = markMarkdownTableControl(createElement(
      'button', 'markdown-table-add-control markdown-table-add-column'
    ));
    addColumn.type = 'button';
    addColumn.setAttribute('aria-label', 'Append table column');
    addColumn.append(createMarkdownInteractionIcon('plus', 'markdown-table-add-icon'));
    addColumn.addEventListener('pointerdown', stopEditorPointer);
    addColumn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      commitMarkdownTableOperation(state, table, { type: 'append-column' });
    });
    const addRow = markMarkdownTableControl(createElement(
      'button', 'markdown-table-add-control markdown-table-add-row'
    ));
    addRow.type = 'button';
    addRow.setAttribute('aria-label', 'Append table row');
    addRow.append(createMarkdownInteractionIcon('plus', 'markdown-table-add-icon'));
    addRow.addEventListener('pointerdown', stopEditorPointer);
    addRow.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      commitMarkdownTableOperation(state, table, { type: 'append-row' });
    });
    shell.append(table, addColumn, addRow);
    parent.append(shell);
  }

  function groupSemanticListItemBody(item) {
    const children = [...(item?.childNodes || [])];
    const contentStart = children.findIndex((child) => (
      !child?.classList?.contains('filter-checkbox')
      && !child?.classList?.contains('markdown-source-marker')
      && !child?.classList?.contains('markdown-source-indentation')
    ));
    if (contentStart === 0) return null;
    const prefixEnd = contentStart < 0 ? children.length : contentStart;
    const controls = children.slice(0, prefixEnd).filter((child) => (
      child?.classList?.contains('filter-checkbox')
    ));
    const prefixNodes = children.slice(0, prefixEnd).filter((child) => (
      !child?.classList?.contains('filter-checkbox')
    ));
    if (!prefixNodes.some((child) => child?.classList?.contains('markdown-source-marker'))) {
      return null;
    }
    const prefix = createElement('span', 'markdown-page-list-prefix');
    prefix.append(...prefixNodes);
    const body = createElement('div', 'markdown-page-list-item-body');
    body.append(...children.slice(prefixEnd));
    item.replaceChildren(...controls, prefix, body);
    return body;
  }

  function quoteTransitionParts(marker, quoteLineIndex) {
    const start = finiteNumber(marker?.dataset?.markdownSourceStart, 0);
    const end = finiteNumber(marker?.dataset?.markdownSourceEnd, start);
    if (!quoteLineIndex || end <= start) return [];
    const source = String(quoteLineIndex.markdownBody || '');
    if (source.slice(start, end).includes('\r')
      && !source.slice(start, end).includes('\r\n')) {
      return [{ text: source.slice(start, end), start, newline: '' }];
    }
    const parts = [];
    let cursor = start;
    while (cursor < end) {
      const line = quoteLineIndex.lineAtOffset(cursor, 'after');
      if (!line) break;
      const contentEnd = Math.min(line.contentEnd, end);
      const newline = contentEnd === line.contentEnd && line.sourceEnd <= end
        && ['\n', '\r\n'].includes(line.lineEnding)
        ? line.lineEnding
        : '';
      parts.push({
        text: source.slice(cursor, contentEnd),
        start: cursor,
        newline,
        newlineStart: contentEnd
      });
      if (!newline) {
        cursor = contentEnd;
        break;
      }
      cursor = line.sourceEnd;
    }
    if (!parts.length || cursor === end && parts.at(-1)?.newline) {
      parts.push({ text: '', start: cursor, newline: '' });
    } else if (cursor < end) {
      parts.push({ text: source.slice(cursor, end), start: cursor, newline: '' });
    }
    return parts;
  }

  function directChildWithClass(parent, className) {
    return [...(parent?.children || [])].find((child) => (
      child?.classList?.contains(className)
    )) || null;
  }

  function quoteInitialSourceLine(quote) {
    const body = directChildWithClass(quote, 'markdown-page-quote-body');
    return directChildWithClass(body, 'markdown-page-quote-source-line');
  }

  function sourceLineDirectMarker(line) {
    return [...(line?.children || [])].find((child) => (
      child?.classList?.contains('markdown-source-marker')
    )) || null;
  }

  function sourceLineNestedQuote(line) {
    return [...(line?.children || [])].find((child) => (
      child?.classList?.contains('markdown-page-quote')
    )) || null;
  }

  function removeDirectChild(parent, child) {
    if (!parent || !child) return;
    parent.replaceChildren(...[...(parent.childNodes || [])].filter((node) => node !== child));
  }

  function consolidateQuoteSourceLine(line, quoteLineIndex) {
    const marker = sourceLineDirectMarker(line);
    if (!line || !marker) return line;
    marker.classList.add('markdown-page-quote-source-prefix');
    const markerStart = finiteNumber(marker.dataset.markdownSourceStart, 0);
    let markerEnd = finiteNumber(marker.dataset.markdownSourceEnd, 0);
    let nestedQuote = sourceLineNestedQuote(line);
    while (nestedQuote) {
      const nestedLine = quoteInitialSourceLine(nestedQuote);
      const nestedMarker = sourceLineDirectMarker(nestedLine);
      const nestedStart = finiteNumber(nestedMarker?.dataset?.markdownSourceStart, NaN);
      const nestedEnd = finiteNumber(nestedMarker?.dataset?.markdownSourceEnd, NaN);
      if (!nestedLine || !nestedMarker || nestedStart !== markerEnd
        || !Number.isFinite(nestedEnd)
        || quoteLineIndex.prefixSegmentsInRange(nestedStart, nestedEnd).length === 0) break;
      marker.textContent = `${String(marker.textContent || '')}${String(nestedMarker.textContent || '')}`;
      markerEnd = nestedEnd;
      marker.dataset.markdownSourceEnd = String(markerEnd);
      removeDirectChild(nestedLine, nestedMarker);
      nestedLine.classList.add('is-quote-source-continuation');
      nestedQuote.classList.add('markdown-page-quote-source-nested');
      nestedQuote = sourceLineNestedQuote(nestedLine);
    }
    line.dataset.markdownQuoteDepth = String(Math.max(1,
      quoteLineIndex.prefixSegmentsInRange(markerStart, markerEnd).length));
    line.dataset.markdownQuotePrefixStart = marker.dataset.markdownSourceStart;
    line.dataset.markdownQuotePrefixEnd = marker.dataset.markdownSourceEnd;
    return line;
  }

  function createQuoteSourceLine(marker, content, className = '', quoteLineIndex = null) {
    const line = createElement(
      'div',
      `markdown-page-quote-source-line${className ? ` ${className}` : ''}`
    );
    if (marker) line.append(marker);
    if (content) line.append(content);
    return consolidateQuoteSourceLine(line, quoteLineIndex);
  }

  function createQuoteTransition(marker, nextChild, quoteLineIndex) {
    if (!nextChild || !quoteLineIndex) return null;
    const owner = marker.dataset.markdownMarkerFor;
    const parts = quoteTransitionParts(marker, quoteLineIndex);
    if (parts.length < 2) return null;
    const hasIndexedQuotePrefix = parts.slice(1).some((part) => {
      return quoteLineIndex.prefixSegmentsInRange(
        part.start,
        part.start + part.text.length
      ).length > 0;
    });
    if (parts[0].text || !parts[0].newline || !hasIndexedQuotePrefix) return null;
    const transition = createElement('div', 'markdown-page-quote-transition');
    const appendVisibleMarker = (parent, part) => {
      if (!part.text) return null;
      return appendSourceMarker(parent, part.text, part.start, owner);
    };
    const appendBlankLine = (part) => {
      const blankLine = markSourceRange(
        createElement('div', 'markdown-page-quote-blank-line is-interstitial'),
        part.start,
        part.start + part.text.length
      );
      appendVisibleMarker(blankLine, part);
      blankLine.append(document.createElement('br'));
      transition.append(blankLine);
    };

    const first = parts[0];
    if (first.text) appendVisibleMarker(transition, first);
    if (first.newline) {
      transition.append(createHiddenSourceValue(
        first.newline,
        first.newlineStart,
        'markdown-source-structural-break'
      ));
    }

    parts.slice(1, -1).forEach((part) => {
      appendBlankLine(part);
      if (part.newline) {
        transition.append(createHiddenSourceValue(
          part.newline,
          part.newlineStart,
          'markdown-source-structural-break'
        ));
      }
    });

    const finalPart = parts[parts.length - 1];
    const rowMarker = appendVisibleMarker(createElement('div'), finalPart);
    const row = createQuoteSourceLine(
      rowMarker,
      nextChild,
      'markdown-page-prefixed-block-row',
      quoteLineIndex
    );
    transition.append(row);
    return transition;
  }

  function createTrailingQuoteTransition(marker, quoteLineIndex) {
    if (!quoteLineIndex) return null;
    const owner = marker.dataset.markdownMarkerFor;
    const parts = quoteTransitionParts(marker, quoteLineIndex);
    if (parts.length < 2) return null;
    const hasIndexedQuotePrefix = parts.slice(1).some((part) => {
      return quoteLineIndex.prefixSegmentsInRange(
        part.start,
        part.start + part.text.length
      ).length > 0;
    });
    if (parts[0].text || !parts[0].newline || !hasIndexedQuotePrefix) return null;
    const transition = createElement('div', 'markdown-page-quote-transition');
    const appendHiddenBreak = (part) => {
      if (!part.newline) return;
      transition.append(createHiddenSourceValue(
        part.newline,
        part.newlineStart,
        'markdown-source-structural-break'
      ));
    };
    const appendBlankLine = (part) => {
      const blankLine = markSourceRange(
        createElement('div', 'markdown-page-quote-blank-line'),
        part.start,
        part.start + part.text.length
      );
      if (part.text) appendSourceMarker(blankLine, part.text, part.start, owner);
      blankLine.append(document.createElement('br'));
      transition.append(blankLine);
    };

    appendHiddenBreak(parts[0]);
    parts.slice(1).forEach((part) => {
      appendBlankLine(part);
      appendHiddenBreak(part);
    });
    return transition;
  }

  function groupSemanticQuoteBody(quote, quoteLineIndex) {
    const original = [...(quote?.childNodes || [])];
    if (original.length < 2
      || !original[0]?.classList?.contains('markdown-source-marker')) return null;
    const contents = [original[0]];
    for (let index = 1; index < original.length; index += 1) {
      const current = original[index];
      const next = original[index + 1];
      const transition = current?.classList?.contains('markdown-source-marker')
        ? next
          ? createQuoteTransition(current, next, quoteLineIndex)
          : createTrailingQuoteTransition(current, quoteLineIndex)
        : null;
      if (transition) {
        contents.push(transition);
        if (next) index += 1;
      } else {
        contents.push(current);
      }
    }
    const prefix = contents[0];
    const body = createElement('div', 'markdown-page-quote-body');
    const firstContent = contents[1] || null;
    quote.replaceChildren(body);
    body.append(
      createQuoteSourceLine(prefix, firstContent, '', quoteLineIndex),
      ...contents.slice(2)
    );
    return body;
  }

  function splitInterItemGap(value) {
    const source = String(value || '');
    const matches = [...source.matchAll(/\r?\n/g)];
    const last = matches[matches.length - 1];
    if (!last) return { preceding: source, leading: '', leadingOffset: source.length };
    const leadingOffset = last.index + last[0].length;
    return {
      preceding: source.slice(0, leadingOffset),
      leading: source.slice(leadingOffset),
      leadingOffset
    };
  }

  function appendAstNode(parent, node, source, state, context) {
    if (!node) return null;
    const start = syntaxNodeStart(node);
    const end = syntaxNodeEnd(node, start);
    if (node.type === 'text') {
      appendDecodedSyntaxText(parent, node, source, context);
      return null;
    }
    if (node.type === 'inlineCode') {
      appendAstInlineCode(parent, node, source);
      return null;
    }
    if (node.type === 'inlineMath') {
      appendAstMath(parent, node, source, false, state);
      return null;
    }
    if (node.type === 'break') {
      const construct = markSourceConstruct(
        createElement('span', 'markdown-hard-break'),
        'hard-break',
        start,
        end
      );
      const newlineStart = Math.max(start, end - (String(source || '')[end - 2] === '\r' ? 2 : 1));
      appendSyntaxMarker(
        construct,
        source,
        start,
        newlineStart,
        construct.dataset.markdownConstructId,
        'markdown-hard-break-marker'
      );
      const lineBreak = markSourceRange(document.createElement('br'), newlineStart, end);
      lineBreak.dataset.markdownSourceBreak = 'true';
      construct.append(lineBreak);
      parent.append(construct);
      return construct;
    }
    if (node.type === 'html') {
      if (/^<br\s*\/?>$/i.test(String(node.value || '').trim())) {
        const construct = markSourceConstruct(
          createElement('span', 'markdown-safe-html-break'),
          'html-break',
          start,
          end
        );
        appendSyntaxMarker(
          construct,
          source,
          start,
          end,
          construct.dataset.markdownConstructId
        );
        const lineBreak = document.createElement('br');
        lineBreak.dataset.markdownSemanticOnly = 'true';
        lineBreak.contentEditable = 'false';
        construct.append(lineBreak);
        parent.append(construct);
      } else {
        appendMappedText(parent, String(source || '').slice(start, end), start);
      }
      return null;
    }
    if (node.type === 'emphasis' || node.type === 'strong' || node.type === 'delete') {
      const tag = node.type === 'emphasis' ? 'em' : node.type === 'strong' ? 'strong' : 'del';
      const construct = markSourceConstruct(
        createElement(tag, `markdown-page-inline-${node.type}`),
        node.type === 'delete' ? 'strike' : node.type,
        start,
        end
      );
      appendAstChildren(construct, node, source, state, context, {
        constructId: construct.dataset.markdownConstructId
      });
      parent.append(construct);
      return construct;
    }
    if (node.type === 'link' || node.type === 'linkReference') {
      appendAstLink(parent, node, source, state, context);
      return null;
    }
    if (node.type === 'image' || node.type === 'imageReference') {
      return appendAstImageSourceOnly(parent, node, source);
    }
    if (node.type === 'paragraph') {
      const readingQuoteParagraph = context?.readingQuoteDepthTransition === true;
      const paragraph = markSourceConstruct(
        createElement(readingQuoteParagraph ? 'div' : 'p', 'markdown-page-paragraph'),
        'paragraph',
        start,
        end
      );
      if (readingQuoteParagraph) paragraph.setAttribute('role', 'paragraph');
      if (!parent?.classList?.contains('markdown-page-list-item')
        && !parent?.classList?.contains('markdown-page-quote')) {
        paragraph.dataset.markdownPlainPhysicalLines = 'true';
      }
      appendAstChildren(paragraph, node, source, state, context, {
        constructId: paragraph.dataset.markdownConstructId
      });
      parent.append(paragraph);
      return paragraph;
    }
    if (node.type === 'heading') {
      const heading = markSourceConstruct(
        createElement(`h${clamp(node.depth || 1, 1, 6)}`, 'markdown-page-heading'),
        'heading',
        start,
        end
      );
      appendAstChildren(heading, node, source, state, context, {
        constructId: heading.dataset.markdownConstructId
      });
      parent.append(heading);
      return heading;
    }
    if (node.type === 'thematicBreak') {
      const wrapper = markSourceConstruct(
        createElement('div', 'markdown-page-rule-source'),
        'rule',
        start,
        end
      );
      appendSyntaxMarker(wrapper, source, start, end, wrapper.dataset.markdownConstructId);
      parent.append(wrapper);
      return wrapper;
    }
    if (node.type === 'blockquote') {
      const quote = markSourceConstruct(
        createElement('blockquote', 'markdown-page-quote'),
        'quote',
        start,
        end
      );
      const indexedQuote = context?.quoteLineIndex?.astQuoteForNode?.(node) || null;
      if (indexedQuote) {
        quote.dataset.markdownQuoteOwner = indexedQuote.ownerId;
        quote.dataset.markdownQuoteSemanticDepth = String(indexedQuote.semanticDepth);
        quote.dataset.markdownQuoteRegions = indexedQuote.regionIds.join(' ');
      }
      const quoteContext = state?.mode === 'reading'
        && (context?.readingQuoteDepthTransition === true
          || indexedQuote?.readingDepthTransition === true)
        ? { ...context, readingQuoteDepthTransition: true }
        : context;
      appendAstChildren(quote, node, source, state, quoteContext, {
        constructId: quote.dataset.markdownConstructId
      });
      if (indexedQuote) groupSemanticQuoteBody(quote, context.quoteLineIndex);
      parent.append(quote);
      return quote;
    }
    if (node.type === 'list') {
      const indexedList = context?.editableListSemanticIndex?.astListForNode?.(node) || null;
      if (!indexedList) throw new Error('EditableListSemanticIndex missing parser list owner');
      const listDepth = Math.max(0, Math.trunc(finiteNumber(
        indexedList.semanticDepth,
        0
      )));
      const ordered = indexedList.ordered;
      const list = markSourceConstruct(
        createElement(ordered ? 'ol' : 'ul', 'markdown-page-list'),
        ordered ? 'ordered-list' : 'unordered-list',
        start,
        end
      );
      if (!ordered) {
        const markerPresentation = unorderedMarkerForDepth(listDepth);
        list.dataset.markdownUnorderedMarker = markerPresentation.glyph;
        list.dataset.markdownUnorderedMarkerStyle = markerPresentation.listStyleType;
        list.style.listStyleType = markerPresentation.listStyleType;
      }
      if (ordered && Number.isFinite(Number(indexedList.startNumber))) {
        // HTML's default is one, but Markdown also permits an explicit zero
        // start. Preserve the parser-owned start in Reading instead of
        // silently falling back to the browser default.
        list.start = Number(indexedList.startNumber);
      }
      let previousItem = null;
      (node.children || []).forEach((itemNode) => {
        const itemStart = syntaxNodeStart(itemNode);
        const indexedItem = context?.editableListSemanticIndex
          ?.astListItemForNode?.(itemNode) || null;
        if (!indexedItem) {
          throw new Error('EditableListSemanticIndex missing parser list-item owner');
        }
        let leadingSource = '';
        let leadingSourceStart = itemStart;
        if (previousItem && itemStart > previousItem.end) {
          const gapSource = String(source || '').slice(previousItem.end, itemStart);
          const gap = splitInterItemGap(gapSource);
          if (gap.preceding) {
            previousItem.element.append(createSourceBlockGap(
              gap.preceding,
              previousItem.end,
              previousItem.end + gap.preceding.length,
              { betweenBlocks: true }
            ));
          }
          leadingSource = gap.leading;
          leadingSourceStart = previousItem.end + gap.leadingOffset;
        }
        const item = markSourceConstruct(
          createElement('li', 'markdown-page-list-item'),
          'list-item',
          itemStart,
          syntaxNodeEnd(itemNode, itemStart)
        );
        if (indexedItem?.ownLineEmpty === true) {
          item.classList.add('is-empty-list-item');
        }
        if (indexedItem?.task === true) {
          item.classList.add('task-list-item');
          const checkbox = createMarkdownTaskCheckbox(state, itemNode);
          if (checkbox) item.append(checkbox);
        }
        if (leadingSource) {
          if (/^[\t ]+$/.test(leadingSource)) {
            item.append(createHiddenSourceValue(
              leadingSource,
              leadingSourceStart,
              'markdown-source-indentation'
            ));
          } else {
            appendSourceMarker(
              item,
              leadingSource,
              leadingSourceStart,
              item.dataset.markdownConstructId
            );
          }
        }
        appendAstChildren(item, itemNode, source, state, context, {
          constructId: item.dataset.markdownConstructId
        });
        list.append(item);
        previousItem = { element: item, end: syntaxNodeEnd(itemNode, itemStart) };
      });
      if (previousItem && end > previousItem.end) {
        appendSyntaxMarker(
          previousItem.element,
          source,
          previousItem.end,
          end,
          list.dataset.markdownConstructId
        );
      }
      [...list.children].forEach((item) => {
        groupSemanticListItemBody(item);
      });
      parent.append(list);
      return list;
    }
    if (node.type === 'table') {
      appendAstTable(parent, node, source, state, context);
      return null;
    }
    if (node.type === 'code') {
      appendAstCode(parent, node, source, state);
      return null;
    }
    if (node.type === 'math') {
      appendAstMath(parent, node, source, true, state);
      return null;
    }
    if (node.type === 'definition') {
      const definition = markSourceConstruct(
        createElement('div', 'markdown-reference-definition'),
        'definition',
        start,
        end
      );
      appendSyntaxMarker(
        definition,
        source,
        start,
        end,
        definition.dataset.markdownConstructId
      );
      parent.append(definition);
      return definition;
    }
    const fallback = markSourceRange(
      createElement('div', 'markdown-unsupported-source'),
      start,
      end
    );
    appendMappedText(fallback, String(source || '').slice(start, end), start);
    parent.append(fallback);
    return fallback;
  }

  function editableSourceGapLayout(value, {
    betweenBlocks = false,
    hasPrecedingContent = betweenBlocks,
    hasFollowingContent = true
  } = {}) {
    const source = String(value || '');
    let structuralLength = 0;
    if (hasPrecedingContent) {
      if (source.startsWith('\r\n')) structuralLength = 2;
      else if (source.startsWith('\n')) structuralLength = 1;
    }
    const visibleSource = source.slice(structuralLength);
    const visibleLineOffsets = [];
    let lineStart = structuralLength;
    for (let index = structuralLength; index < source.length; index += 1) {
      if (source[index] !== '\n') continue;
      visibleLineOffsets.push(lineStart);
      lineStart = index + 1;
    }
    if (!hasFollowingContent && lineStart === source.length && source.endsWith('\n')) {
      visibleLineOffsets.push(source.length);
    }
    return {
      source,
      structuralLength,
      visibleSource,
      visibleBlankLines: visibleLineOffsets.length,
      visibleLineOffsets
    };
  }

  function createSourceBlockGap(value, start, end, options = {}) {
    const layout = editableSourceGapLayout(value, options);
    if (layout.structuralLength === layout.source.length
      && layout.source.length > 0
      && layout.visibleLineOffsets.length === 0) {
      const structuralBreak = markSourceRange(
        createElement(
          'span',
          'markdown-source-structural-break',
          layout.source
        ),
        start,
        end
      );
      structuralBreak.dataset.markdownSourceValue = layout.source;
      structuralBreak.dataset.markdownStructuralStart = String(start);
      structuralBreak.dataset.markdownStructuralEnd = String(end);
      structuralBreak.setAttribute('aria-hidden', 'true');
      return structuralBreak;
    }
    const gap = markSourceRange(
      createElement('span', 'markdown-source-block-gap'),
      start,
      end
    );
    gap.dataset.markdownStructuralLength = String(layout.structuralLength);
    const appendHiddenSourceCharacter = (character, className = '') => {
      const sourceCharacter = createElement(
        'span',
        `markdown-source-gap-character${className ? ` ${className}` : ''}`,
        character
      );
      sourceCharacter.dataset.markdownSourceValue = character;
      sourceCharacter.setAttribute('aria-hidden', 'true');
      gap.append(sourceCharacter);
    };
    [...layout.source.slice(0, layout.structuralLength)].forEach((character) => {
      appendHiddenSourceCharacter(character, 'markdown-source-structural-break');
    });
    layout.visibleLineOffsets.forEach((localOffset) => {
      if (localOffset === layout.source.length) {
        const line = markSourceRange(
          createElement('span', 'markdown-source-gap-line'),
          end,
          end
        );
        line.dataset.markdownGapOffset = String(localOffset);
        line.append(document.createElement('br'));
        gap.append(line);
        return;
      }
      const newlineIndex = layout.source.indexOf('\n', localOffset);
      if (newlineIndex < 0) return;
      const line = markSourceRange(
        createElement('span', 'markdown-source-gap-line'),
        start + localOffset,
        start + newlineIndex + 1
      );
      line.dataset.markdownGapOffset = String(localOffset);
      const visibleEnd = layout.source[newlineIndex - 1] === '\r'
        ? newlineIndex - 1
        : newlineIndex;
      const visibleText = layout.source.slice(localOffset, visibleEnd);
      if (visibleText) appendMappedText(line, visibleText, start + localOffset);
      if (visibleEnd < newlineIndex) {
        const carriageReturn = createElement(
          'span',
          'markdown-source-gap-character',
          '\r'
        );
        carriageReturn.dataset.markdownSourceValue = '\r';
        carriageReturn.setAttribute('aria-hidden', 'true');
        line.append(carriageReturn);
      }
      const lineBreak = markSourceRange(
        document.createElement('br'),
        start + newlineIndex,
        start + newlineIndex + 1
      );
      lineBreak.dataset.markdownSourceBreak = 'true';
      line.append(lineBreak);
      gap.append(line);
    });
    const newlineMatches = [...layout.source.matchAll(/\r?\n/g)];
    const finalNewline = newlineMatches[newlineMatches.length - 1];
    const trailingOffset = finalNewline
      ? finalNewline.index + finalNewline[0].length
      : layout.structuralLength;
    const trailingSource = layout.source.slice(trailingOffset);
    if (trailingSource) {
      if (/^[\t ]+$/.test(trailingSource)) {
        gap.append(createHiddenSourceValue(
          trailingSource,
          start + trailingOffset,
          'markdown-source-indentation'
        ));
      } else {
        appendMappedText(
          gap,
          trailingSource,
          start + trailingOffset
        );
      }
    }
    return gap;
  }

  function sourceSegments(source) {
    const canonical = String(source || '');
    return blocksForSource(canonical).map((block) => ({
      start: finiteNumber(block.start, 0),
      end: finiteNumber(block.end, finiteNumber(block.start, 0)),
      raw: canonical.slice(block.start, block.end),
      node: block.node || null
    }));
  }

  function invoke(callback, ...args) {
    if (typeof callback === 'function') return callback(...args);
    return undefined;
  }

  function stopEditorPointer(event) {
    event.stopPropagation();
  }

  function commitBody(state, reason) {
    invoke(state.onBodyCommit, {
      paneId: state.paneId,
      pageId: state.page?.id || state.page?.pageId || null,
      markdownBody: state.body,
      commit: true,
      page: state.page,
      mode: state.mode,
      reason
    });
    state.semanticDirty = false;
  }

  function semanticModeEditable(state) {
    return state.mode !== 'reading' && !state.pageEditMode && !state.bodyReadOnly;
  }

  function installSourceSnapshot(state, markdownBody, options = {}) {
    if (!state || typeof model?.createSourceSnapshot !== 'function') {
      throw new Error('Markdown SourceSnapshot support is unavailable.');
    }
    const canonical = typeof markdownBody === 'string'
      ? markdownBody
      : String(markdownBody || '');
    if (!options.force && state.sourceSnapshot?.markdownBody === canonical) {
      state.body = canonical;
      state.sourceVersion = state.sourceSnapshot.version;
      return state.sourceSnapshot;
    }
    clearMarkdownMultiClickAnchor(state);
    const previousSnapshot = options.preserveIdentity === false
      ? null
      : state.sourceSnapshot || null;
    const snapshot = model.createSourceSnapshot(canonical, {
      previousSnapshot,
      ...(Number.isInteger(options.version) ? { version: options.version } : {})
    });
    state.sourceSnapshot = snapshot;
    state.sourceVersion = snapshot.version;
    state.body = snapshot.markdownBody;
    return snapshot;
  }

  function editableProjectionForRoot(bodyRoot) {
    return bodyRoot ? editableProjectionRoots.get(bodyRoot) || null : null;
  }

  function projectionPositionAtOffset(projection, offset, affinity = null) {
    if (!projection) return null;
    const requested = clamp(finiteNumber(offset, 0), 0, projection.snapshot()?.markdownBody.length || 0);
    const candidates = projection.enumerateDeclaredPositions()
      .filter((position) => position.offset === requested);
    if (!candidates.length) return null;
    return affinity
      ? candidates.find((position) => position.affinity === affinity) || candidates[0]
      : candidates[0];
  }

  function numericProjectionSelection(selection) {
    if (!selection?.anchor || !selection?.focus) return null;
    return {
      anchor: selection.anchor.offset,
      focus: selection.focus.offset,
      anchorAffinity: selection.anchor.affinity,
      focusAffinity: selection.focus.affinity,
      anchorPosition: selection.anchor,
      focusPosition: selection.focus,
      sourceVersion: selection.sourceVersion
    };
  }

  function structuredProjectionSelection(projection, selection) {
    if (!projection || !selection) return selection;
    const endpoint = (value, position, affinity) => position
      || (typeof value === 'object' ? value : projectionPositionAtOffset(
        projection,
        value,
        affinity || null
      ));
    const anchor = endpoint(
      selection.anchor,
      selection.anchorPosition,
      selection.anchorAffinity
    );
    const focus = endpoint(
      selection.focus,
      selection.focusPosition,
      selection.focusAffinity
    );
    return anchor && focus ? { anchor, focus, sourceVersion: anchor.sourceVersion } : selection;
  }

  function editablePresentationPlanForState(state) {
    if (!state?.sourceSnapshot) {
      throw new TypeError('Markdown editable rendering requires one canonical SourceSnapshot.');
    }
    if (!editableSyntaxAdapters?.buildEditablePresentationPlan) {
      throw new TypeError('Markdown editable rendering requires the syntax-adapter PresentationPlan.');
    }
    return editableSyntaxAdapters.buildEditablePresentationPlan(state.sourceSnapshot, {
      mode: state.mode,
      model,
      activeOwnerIds: state.editableActiveOwnerIds || [],
      activePhysicalLineIds: state.editableActiveLineIds || [],
      forcedRawOwnerIds: state.editableForcedRawOwnerIds || []
    });
  }

  function editablePresentationOwnerElement(className, ownerId, tagName = 'span') {
    const element = createElement(tagName, `markdown-editable-semantic-presentation ${className}`);
    element.dataset.markdownSemanticOnly = 'true';
    element.dataset.markdownEditablePresentationOwner = String(ownerId || '');
    element.contentEditable = 'false';
    return element;
  }

  function editablePresentationClassToken(value) {
    return String(value || 'source').replace(/[^a-z0-9_-]/gi, '-');
  }

  function editablePresentationConstructs(plan) {
    return Object.values(plan?.constructs || {})
      .filter(Array.isArray)
      .flat();
  }

  function editableLeafHasSemanticRole(leaf, family, role = null, ownerId = null) {
    return (leaf?.planLeaf?.semanticRoles || leaf?.semanticRoles || []).some((descriptor) => (
      descriptor.family === family
      && (role == null || descriptor.role === role)
      && (ownerId == null || String(descriptor.ownerId) === String(ownerId))
    ));
  }

  function editableLeafHasNestedMarkerRole(leaf, family) {
    return (leaf?.planLeaf?.semanticRoles || leaf?.semanticRoles || []).some((descriptor) => (
      descriptor.role === 'marker' && descriptor.family !== family
    ));
  }

  function decorateEditableProjectedLeaves(plan, leaves) {
    const constructsByPresentationId = new Map(editablePresentationConstructs(plan)
      .filter((construct) => construct?.presentationId)
      .map((construct) => [String(construct.presentationId), construct]));
    leaves.forEach((leaf) => {
      const element = leaf.element;
      const primaryKind = editablePresentationClassToken(leaf.kind);
      element.classList.add(`is-${primaryKind}`);
      const roles = leaf.planLeaf?.semanticRoles || [];
      const roleTokens = [];
      const familyTokens = new Set();
      roles.forEach((role) => {
        const family = editablePresentationClassToken(role.family);
        const semanticRole = editablePresentationClassToken(role.role);
        const token = `${family}-${semanticRole}`;
        roleTokens.push(token);
        familyTokens.add(family);
        element.classList.add(`is-${token}`);
        element.classList.add(role.sourceVisible
          ? `is-${token}-source-visible`
          : `is-${token}-source-hidden`);
        if (role.active) element.classList.add(`is-${token}-active`);
        if (role.renderedMounted) {
          element.classList.add(`has-${token}-rendered-presentation`);
        }
        if (family === 'heading' && Number.isFinite(Number(role.depth))) {
          const depth = Math.max(1, Math.min(6, Number(role.depth)));
          element.classList.add(`is-heading-depth-${depth}`);
          element.dataset.markdownHeadingDepth = String(depth);
        }
        if (semanticRole !== 'marker') return;
        const construct = constructsByPresentationId.get(String(role.presentationId || ''));
        if (!construct) return;
        if (Number(role.sourceStart) === Number(construct.start)) {
          element.classList.add('is-opening-marker');
        }
        if (Number(role.sourceEnd) === Number(construct.end)) {
          element.classList.add('is-closing-marker');
        }
      });
      if (roleTokens.length) {
        const markerRoles = roles.filter((role) => role.role === 'marker');
        const sourceVisibilityRoles = markerRoles.length ? markerRoles : roles;
        if (sourceVisibilityRoles.every((role) => role.sourceVisible)) {
          element.classList.add('is-markdown-semantic-source-visible');
        }
        if (roles.some((role) => role.active)) {
          element.classList.add('is-markdown-semantic-active');
        }
        if (roles.some((role) => role.renderedMounted)) {
          element.classList.add('has-markdown-semantic-rendered-presentation');
        }
        element.dataset.markdownSemanticRoles = [...new Set(roleTokens)].join(' ');
        element.dataset.markdownSemanticFamilies = [...familyTokens].join(' ');
      }
    });
  }

  function editableRowsForConstruct(projection, construct) {
    const rows = projection.enumeratePhysicalRows();
    const lineIds = new Set((construct?.lineIds || []).map(String));
    return rows.filter((entry) => (
      lineIds.size > 0
        ? lineIds.has(String(entry.physicalLineId))
        : entry.start < Number(construct?.end)
          && entry.sourceEnd > Number(construct?.start)
    )).sort((left, right) => left.index - right.index);
  }

  function markEditablePresentationRows(rows, className, { collapseContinuations = false } = {}) {
    rows.forEach((entry, index) => {
      entry.element?.classList?.add(className);
      if (collapseContinuations && index > 0) {
        entry.element?.classList?.add('is-editable-presentation-collapsed');
      }
    });
  }

  function editableQuoteRailIntervals(quoteDescriptors = []) {
    const directRegions = Array.isArray(quoteDescriptors?.regions)
      ? quoteDescriptors.regions
      : Array.isArray(quoteDescriptors)
        && quoteDescriptors.every((entry) => (
          Number.isInteger(Number(entry?.firstLineIndex))
          && Array.isArray(entry?.physicalLineIds)
        ))
          ? quoteDescriptors
          : null;
    const regions = directRegions || [...(quoteDescriptors || [])].flatMap((quote) => {
      if (!Array.isArray(quote?.regions)) {
        throw new TypeError('Quote rail presentation requires QuoteLineIndex region metadata.');
      }
      return quote.regions;
    });
    const unique = new Map();
    regions.forEach((region) => {
      const depth = Number(region?.depth);
      const ownerId = String(region?.ownerId || '');
      const firstLineIndex = Number(region?.firstLineIndex);
      const lastLineIndex = Number(region?.lastLineIndex);
      const physicalLineIds = Array.isArray(region?.physicalLineIds)
        ? region.physicalLineIds.map(String)
        : [];
      if (!Number.isInteger(depth) || depth < 1 || !ownerId
        || !Number.isInteger(firstLineIndex) || !Number.isInteger(lastLineIndex)
        || lastLineIndex < firstLineIndex
        || physicalLineIds.length !== lastLineIndex - firstLineIndex + 1
        || physicalLineIds.some((lineId) => !lineId)) {
        throw new TypeError('Quote rail presentation requires QuoteLineIndex region metadata.');
      }
      const id = String(region.id || `${depth}:${ownerId}:${firstLineIndex}:${lastLineIndex}`);
      if (!unique.has(id)) unique.set(id, {
        depth,
        ownerId,
        firstLineIndex,
        lastLineIndex,
        firstPhysicalLineId: String(region.firstPhysicalLineId || physicalLineIds[0]),
        lastPhysicalLineId: String(region.lastPhysicalLineId || physicalLineIds.at(-1)),
        physicalLineIds
      });
    });
    return [...unique.values()].sort((left, right) => (
      left.firstLineIndex - right.firstLineIndex
        || left.depth - right.depth
        || left.lastLineIndex - right.lastLineIndex
    )).map((interval) => Object.freeze({
      ...interval,
      physicalLineIds: Object.freeze([...interval.physicalLineIds])
    }));
  }

  function clearEditableQuoteRailOverlay(state) {
    const layer = state?.quoteRailLayer;
    if (!layer) return false;
    layer.replaceChildren();
    layer.hidden = true;
    return true;
  }

  function editableQuoteRailCoordinateSpace(state) {
    const surface = state?.documentSurface;
    const surfaceRect = surface?.getBoundingClientRect?.();
    if (!surface || !surfaceRect) return null;
    // The Markdown world host owns one explicit uniform CSS zoom. offsetWidth
    // is integer-rounded, so deriving scale from rect/offsetWidth accumulates
    // vertical endpoint drift on fractional document widths.
    const scale = Math.max(0.05, finiteNumber(state.zoom, 1));
    return { surfaceRect, scale };
  }

  function editableQuoteRailRowRect(row, coordinateSpace) {
    const rect = row?.getBoundingClientRect?.();
    if (!rect || !coordinateSpace) return null;
    const { surfaceRect, scale } = coordinateSpace;
    const top = (finiteNumber(rect.top, 0) - finiteNumber(surfaceRect.top, 0)) / scale;
    const bottom = (finiteNumber(rect.bottom, finiteNumber(rect.top, 0))
      - finiteNumber(surfaceRect.top, 0)) / scale;
    const left = (finiteNumber(rect.left, 0) - finiteNumber(surfaceRect.left, 0)) / scale;
    return Number.isFinite(top) && Number.isFinite(bottom) && Number.isFinite(left)
      && bottom > top
      ? { top, bottom, left }
      : null;
  }

  function reconcileEditableQuoteRailOverlay(state) {
    const layer = state?.quoteRailLayer;
    if (!layer) return [];
    layer.replaceChildren();
    layer.hidden = true;
    if (!['source', 'live-preview'].includes(state.mode)
      || !state.editableProjection
      || !state.editablePresentationPlan
      || state.bodyRoot?.contains?.(layer)
      || !state.documentSurface?.contains?.(layer)) return [];

    const coordinateSpace = editableQuoteRailCoordinateSpace(state);
    if (!coordinateSpace) return [];
    const rowsByLineId = new Map(state.editableProjection.enumeratePhysicalRows().map((entry) => (
      [String(entry.physicalLineId), entry.element]
    )));
    const regions = state.sourceSnapshot?.quoteLineIndex
      || state.editablePresentationPlan.constructs?.quoteRegions
      || [];
    const rails = editableQuoteRailIntervals(regions).flatMap((interval) => {
      const rowRects = interval.physicalLineIds.map((physicalLineId) => {
        const row = rowsByLineId.get(String(physicalLineId));
        if (!row || row.hidden === true
          || row.classList?.contains?.('is-markdown-structural-fold-hidden')) return null;
        return editableQuoteRailRowRect(row, coordinateSpace);
      }).filter(Boolean);
      if (!rowRects.length) return [];
      const top = Math.min(...rowRects.map((rect) => rect.top));
      const bottom = Math.max(...rowRects.map((rect) => rect.bottom));
      const left = Math.min(...rowRects.map((rect) => rect.left));
      if (!(bottom > top)) return [];
      const rail = createElement('div', 'markdown-editable-quote-rail');
      rail.contentEditable = 'false';
      rail.dataset.markdownSemanticOnly = 'true';
      rail.dataset.markdownQuoteRailDepth = String(interval.depth);
      rail.dataset.markdownQuoteRailOwner = interval.ownerId;
      rail.dataset.markdownQuoteRailFirstLine = interval.firstPhysicalLineId;
      rail.dataset.markdownQuoteRailLastLine = interval.lastPhysicalLineId;
      rail.setAttribute('aria-hidden', 'true');
      rail.style.setProperty('--markdown-editable-quote-rail-top', `${top}px`);
      rail.style.setProperty('--markdown-editable-quote-rail-height', `${bottom - top}px`);
      rail.style.setProperty('--markdown-editable-quote-rail-left', `${left}px`);
      rail.style.setProperty('--markdown-editable-quote-rail-index', String(interval.depth - 1));
      return [rail];
    });
    if (rails.length) {
      layer.append(...rails);
      layer.hidden = false;
    }
    return rails;
  }

  function clearEditablePresentationMountState(state) {
    clearEditableQuoteRailOverlay(state);
    state?.editableTablePresentations?.clear?.();
    const projection = state?.editableProjection;
    if (!projection) return;
    if (activeCodeLanguageMenu?.button && state.bodyRoot?.contains?.(activeCodeLanguageMenu.button)) {
      closeCodeLanguageMenu();
    }
    projection.enumeratePhysicalRows().forEach((entry) => {
      const row = entry.element;
      // List presentation moves canonical projected leaves into marker/content
      // slots. Restore those leaves to the physical row before an exact
      // projection revision so the revision can reuse them without retaining
      // presentation-only wrappers or controls.
      if (row?.classList?.contains?.('has-editable-list-row-presentation')) {
        const projectedLeaves = projection.enumerateProjectedLeaves()
          .filter((leaf) => (
            String(leaf.physicalLineId) === String(entry.physicalLineId)
              && leaf.element
              && row.contains?.(leaf.element)
          ))
          .sort((left, right) => (
            Number(left.sourceStart) - Number(right.sourceStart)
              || Number(left.sourceEnd) - Number(right.sourceEnd)
          ));
        if (projectedLeaves.length > 0) {
          row.replaceChildren?.(...projectedLeaves.map((leaf) => leaf.element));
        }
      }
      row?.classList?.remove(
        'has-editable-code-presentation',
        'has-editable-math-presentation',
        'has-editable-table-presentation',
        'has-editable-list-row-presentation',
        'is-editable-list-presentation-rendered',
        'is-editable-list-row-active',
        'is-editable-task-list-row',
        'is-hn-sequence-list-row',
        'is-hn-sequence-list-item-row',
        'is-hn-sequence-list-continuation-row',
        'is-editable-presentation-collapsed'
      );
      [...(row?.classList || [])]
        .filter((name) => (
          name.startsWith('is-editable-heading-depth-')
          || /^has-editable-.+-presentation$/.test(name)
        ))
        .forEach((name) => row.classList.remove(name));
      if (!row) return;
      delete row.dataset.editableHeadingDepth;
      delete row.dataset.editableQuoteDepth;
      delete row.dataset.editableQuoteRailDepth;
      delete row.dataset.editableQuoteSourceVisible;
      delete row.dataset.editableListPresentationId;
      delete row.dataset.editableListSourceVisible;
      delete row.dataset.hnListSequenceId;
      delete row.dataset.hnListItemId;
      delete row.dataset.hnListParagraphKind;
      row.style?.removeProperty?.('--markdown-editable-heading-depth');
      row.style?.removeProperty?.('--markdown-editable-quote-depth');
      row.style?.removeProperty?.('--markdown-editable-quote-rail-depth');
      row.style?.removeProperty?.('--hn-sequence-list-marker-columns');
      row.style?.removeProperty?.('--hn-sequence-list-marker-width');
      row.style?.removeProperty?.('--hn-sequence-list-leading-width');
    });
  }

  function linkArrowIdentity(descriptor) {
    const logicalLinkId = String(descriptor?.logicalLinkId || '');
    const start = Number(descriptor?.start);
    const end = Number(descriptor?.end);
    if (!logicalLinkId || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return null;
    }
    return {
      logicalLinkId,
      start,
      end,
      key: JSON.stringify([logicalLinkId, start, end])
    };
  }

  function createLinkArrowController() {
    const arrowsByIdentity = new Map();

    const removeArrow = (key) => {
      const record = arrowsByIdentity.get(key);
      if (!record) return;
      record.control?.remove?.();
      arrowsByIdentity.delete(key);
    };
    const removeAll = () => {
      [...arrowsByIdentity.keys()].forEach(removeArrow);
    };
    const configureArrow = (record, descriptor, state) => {
      record.state = state;
      record.descriptor = descriptor;
      record.control.setAttribute('aria-label', descriptor.safeHref
        ? 'Open ' + descriptor.safeHref
        : 'Link destination unavailable');
      record.control.setAttribute('aria-disabled', String(!descriptor.safeHref));
      record.control.disabled = !descriptor.safeHref;
      record.control.tabIndex = descriptor.safeHref ? 0 : -1;
    };
    const ensureArrow = (identity) => {
      const existing = arrowsByIdentity.get(identity.key);
      if (existing) return existing;
      const control = createElement('button', 'markdown-page-link-navigation');
      control.type = 'button';
      control.contentEditable = 'false';
      control.dataset.markdownSemanticOnly = 'true';
      control.dataset.markdownSemanticControl = 'true';
      control.setAttribute('role', 'button');
      control.append(createMarkdownInteractionIcon(
        'open-link',
        'markdown-page-link-navigation-icon'
      ));
      const record = {
        control,
        state: null,
        descriptor: null
      };
      control.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      control.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const activeState = record.state;
        const activeDescriptor = record.descriptor;
        if (!activeDescriptor?.safeHref
          || !['source', 'live-preview'].includes(activeState?.mode)) return;
        invoke(activeState.onLinkActivate, {
          href: activeDescriptor.safeHref,
          paneId: activeState.paneId || null,
          pageId: activeState.page?.id || activeState.page?.pageId || null,
          event
        });
      });
      arrowsByIdentity.set(identity.key, record);
      return record;
    };
    const detach = () => {
      arrowsByIdentity.forEach((record) => record.control?.remove?.());
    };
    const reconcile = ({ state, mode, links = [], anchors = [] }) => {
      if (mode === 'reading') {
        removeAll();
        return;
      }
      if (!['source', 'live-preview'].includes(mode)) {
        throw new TypeError('Link arrow controller requires Reading, Source, or Live mode.');
      }
      const desired = new Map();
      links.forEach((descriptor) => {
        const identity = linkArrowIdentity(descriptor);
        if (!identity || desired.has(identity.key)) {
          throw new TypeError('Link arrow controller requires unique logical IDs and complete ranges.');
        }
        desired.set(identity.key, { descriptor, identity });
      });
      const currentAnchors = new Map();
      anchors.forEach((anchor) => {
        const identity = linkArrowIdentity(anchor);
        if (!identity || currentAnchors.has(identity.key)
          || !anchor?.rightEdgeAnchor?.parentNode) {
          throw new TypeError('Link arrow controller requires one current whole-link-end anchor.');
        }
        currentAnchors.set(identity.key, anchor.rightEdgeAnchor);
      });
      if (currentAnchors.size !== desired.size
        || [...desired.keys()].some((key) => !currentAnchors.has(key))) {
        throw new TypeError('Link arrow controller requires one anchor for every logical link.');
      }

      [...arrowsByIdentity.keys()]
        .filter((key) => !desired.has(key))
        .forEach(removeArrow);
      desired.forEach(({ descriptor, identity }, key) => {
        const record = ensureArrow(identity);
        configureArrow(record, descriptor, state);
        currentAnchors.get(key).after(record.control);
      });
    };
    const destroy = () => {
      removeAll();
    };

    return Object.freeze({
      detach,
      reconcile,
      destroy
    });
  }

  function collectEditableLinkArrowAnchors(state, plan, leaves, exposedAnchors = []) {
    const root = state?.bodyRoot;
    return (plan?.constructs?.links || []).map((link) => {
      const identity = linkArrowIdentity(link);
      if (!identity) {
        throw new TypeError('Link arrow anchors require one logical ID and complete range.');
      }
      const exposed = exposedAnchors.filter((anchor) => (
        linkArrowIdentity(anchor)?.key === identity.key
        && anchor?.rightEdgeAnchor?.parentNode
        && root?.contains?.(anchor.rightEdgeAnchor)
        && !anchor.rightEdgeAnchor.closest?.('.markdown-editable-table-canonical-depot')
        && !anchor.rightEdgeAnchor.closest?.('.is-editable-presentation-collapsed')
      ));
      if (exposed.length > 1) {
        throw new TypeError('A rendered logical link exposed more than one whole-link-end anchor.');
      }
      const ownerLeaves = leaves.filter((leaf) => (
        leaf.semanticOwnerId === link.ownerId
        || editableLeafHasSemanticRole(leaf, 'link', null, link.ownerId)
      ));
      ownerLeaves.forEach((leaf) => {
        const content = editableLeafHasSemanticRole(leaf, 'link', 'content', link.ownerId);
        const marker = editableLeafHasSemanticRole(leaf, 'link', 'marker', link.ownerId);
        leaf.element.classList.toggle('markdown-editable-link-label', content);
        leaf.element.classList.toggle('markdown-editable-link-source', marker);
        if (link.title) leaf.element.title = link.title;
      });
      const finalOwnerLeaf = ownerLeaves.reduce((current, candidate) => (
        candidate?.element?.parentNode
          && root?.contains?.(candidate.element)
          && candidate.visibility === 'visible'
          && !candidate.element.closest?.('.markdown-editable-table-canonical-depot')
          && !candidate.element.closest?.('.is-editable-presentation-collapsed')
          && (!current || Number(candidate.sourceEnd) >= Number(current.sourceEnd))
          ? candidate
          : current
      ), null);
      if ((state.mode === 'source' || link.active)
        && finalOwnerLeaf
        && Number(finalOwnerLeaf.sourceEnd) !== identity.end) {
        throw new TypeError('An active logical link must expose its complete source-end anchor.');
      }
      const currentAnchors = [
        ...exposed.map((anchor) => anchor.rightEdgeAnchor),
        ...(finalOwnerLeaf?.element ? [finalOwnerLeaf.element] : [])
      ];
      if (currentAnchors.length !== 1) {
        throw new TypeError('A logical link must expose exactly one current presentation anchor.');
      }
      return { ...identity, rightEdgeAnchor: currentAnchors[0] };
    });
  }

  function editableSimplePresentationConstructs(plan) {
    const constructs = plan?.constructs || {};
    const keys = editableSyntaxAdapters?.SEMANTIC_PRESENTATION_KEYS || [
      'headings',
      'emphasis',
      'strong',
      'strikethrough',
      'escapes',
      'inlineCode',
      'codeBlocks'
    ];
    return keys.flatMap((key) => constructs[key] || []);
  }

  function appendEditableSimplePresentation(host, construct, state) {
    if (construct.kind === 'escape') {
      host.textContent = construct.value || construct.contentSource || '';
      return;
    }
    if (construct.kind === 'inline-code') {
      host.textContent = construct.value || construct.contentSource || '';
      return;
    }
    if (construct.node?.children?.length) {
      appendAstChildren(
        host,
        construct.node,
        state.body,
        state,
        markdownAstRenderContext(state, state.sourceSnapshot.parserAst),
        { constructId: construct.ownerId }
      );
      return;
    }
    host.textContent = construct.contentSource || '';
  }

  function mountEditableSimplePresentations(state, projection, plan, leaves) {
    const planAnchors = projection.enumeratePlanActivationAnchors();
    editableSimplePresentationConstructs(plan).forEach((construct) => {
      if (construct.kind === 'code-block') return;
      if (!construct.presentationOwned || !construct.presentation?.renderedMounted) return;
      const firstLeaf = leaves.find((leaf) => (
        construct.start <= leaf.sourceStart && leaf.sourceStart < construct.end
      ));
      const line = state.sourceSnapshot.physicalLineIndex.lineAtOffset(
        construct.start,
        'after'
      );
      const row = projection.enumeratePhysicalRows().find((entry) => (
        entry.physicalLineId === line?.id
      ))?.element;
      if (!row) return;
      const tagName = construct.presentation.tagName || construct.tagName || 'span';
      const classKind = String(construct.kind || 'source').replace(/[^a-z0-9_-]/gi, '-');
      const host = editablePresentationOwnerElement(
        `markdown-editable-simple-presentation markdown-editable-${classKind}-presentation`,
        construct.ownerId,
        tagName
      );
      host.dataset.markdownEditablePresentationId = construct.presentationId;
      appendEditableSimplePresentation(host, construct, state);
      if (firstLeaf?.element?.parentNode) firstLeaf.element.before(host);
      else row.append(host);
      const planAnchor = planAnchors.find((anchor) => (
        anchor.presentationId === construct.presentationId
      ));
      if (planAnchor) projection.registerPlanActivationAnchor(host, planAnchor, {
        kind: `${classKind}-rendered-activation`
      });
      const rows = editableRowsForConstruct(projection, construct);
      markEditablePresentationRows(rows, 'has-editable-simple-presentation', {
        collapseContinuations: !construct.presentation.sourceVisible
      });
      markEditablePresentationRows(rows, `has-editable-${classKind}-presentation`);
    });
  }

  function mountEditableCodePresentations(state, projection, plan, leaves) {
    const planAnchors = projection.enumeratePlanActivationAnchors();
    (plan.constructs.codeBlocks || []).forEach((construct) => {
      if (!construct.presentationOwned || !construct.presentation?.renderedMounted) return;
      const rows = editableRowsForConstruct(projection, construct);
      const firstRow = rows[0]?.element;
      if (!firstRow) return;
      const firstLeaf = leaves.find((leaf) => (
        construct.start <= leaf.sourceStart && leaf.sourceStart < construct.end
      ));
      const codeSource = canonicalCodeBodyText(state.body, construct);
      const language = construct.language || construct.node?.lang || '';
      const highlighted = markdownRuntime?.highlightCode
        ? markdownRuntime.highlightCode(codeSource, language)
        : {
          html: '',
          language: '',
          displayName: language || 'Plain Text',
          declaredLanguage: language,
          known: false
        };
      const shell = markSourceRange(editablePresentationOwnerElement(
        `markdown-editable-code-block-presentation markdown-page-code-shell ${construct.fenced ? 'is-fenced' : 'is-indented'}`,
        construct.ownerId,
        'div'
      ), construct.start, construct.end);
      shell.dataset.markdownEditablePresentationId = construct.presentationId;
      const pre = createElement('pre', 'markdown-page-code-block');
      const code = markSourceRange(createElement(
        'code',
        `markdown-editable-code-block-value hljs${highlighted.language ? ` language-${highlighted.language}` : ''}`
      ), construct.bodyStart, construct.bodyEnd);
      code.spellcheck = false;
      code.dataset.language = language;
      if (highlighted.html) code.innerHTML = highlighted.html;
      else if (codeSource) appendText(code, codeSource);
      else code.append(createElement('br'));
      pre.append(code);
      if (construct.fenced) {
        shell.append(createCodeLanguageControl(state, construct, highlighted, code));
      }
      shell.append(pre);
      if (firstLeaf?.element?.parentNode) firstLeaf.element.before(shell);
      else firstRow.append(shell);
      const planAnchor = planAnchors.find((anchor) => (
        anchor.presentationId === construct.presentationId
      ));
      if (planAnchor) projection.registerPlanActivationAnchor(shell, planAnchor, {
        kind: 'code-block-rendered-activation'
      });
      markEditablePresentationRows(rows, 'has-editable-code-presentation', {
        collapseContinuations: !construct.presentation.sourceVisible
      });
    });
  }

  function mountEditableMathPresentations(state, projection, plan, leaves) {
    plan.constructs.math.forEach((math) => {
      if (plan.constructs.tables.some((table) => (
        !table.invalid && !table.activeRaw
        && table.start <= math.start && math.end <= table.end
      ))) return;
      if (!math.presentation.renderedMounted) return;
      const rows = editableRowsForConstruct(projection, math);
      const firstRow = rows[0]?.element;
      if (!firstRow) return;
      const rendered = editablePresentationOwnerElement(
        `markdown-editable-math-presentation markdown-math-rendered${math.display ? ' is-display' : ''}`,
        math.ownerId,
        math.display ? 'div' : 'span'
      );
      appendRenderedMath(rendered, math.source, math.display, math.contentStart);
      const sourceLeaves = leaves.filter((leaf) => (
        leaf.semanticOwnerId === math.ownerId
        || (math.start <= leaf.sourceStart && leaf.sourceEnd <= math.end)
      ));
      const firstSourceLeaf = sourceLeaves[0];
      const lastSourceLeaf = sourceLeaves.at(-1);
      if (math.presentation.layout === 'source-above-rendered') {
        if (lastSourceLeaf?.element?.parentNode) {
          if (typeof lastSourceLeaf.element.after === 'function') lastSourceLeaf.element.after(rendered);
          else lastSourceLeaf.element.parentNode.append(rendered);
        } else rows.at(-1)?.element?.append(rendered);
      } else if (firstSourceLeaf?.element?.parentNode) firstSourceLeaf.element.before(rendered);
      else firstRow.append(rendered);
      const planAnchor = projection.enumeratePlanActivationAnchors().find((anchor) => (
        anchor.ownerId === math.ownerId || anchor.position.semanticOwnerId === math.ownerId
      ));
      if (planAnchor) projection.registerPlanActivationAnchor(rendered, planAnchor, {
        kind: 'math-rendered-activation'
      });
      else {
        const position = projectionPositionAtOffset(projection, math.contentStart, 'after');
        if (position) projection.registerActivationAnchor(rendered, position, {
          kind: 'math-rendered-presentation',
          semanticOwnerId: math.ownerId,
          semanticOnly: true,
          contentEditable: false
        });
      }
      markEditablePresentationRows(rows, 'has-editable-math-presentation', {
        collapseContinuations: math.presentation.layout === 'rendered-only'
      });
    });
  }

  function editableTableCellDescriptor(table, cell) {
    return table && cell ? {
      tableStart: table.start,
      header: cell.header === true,
      rowIndex: cell.rowIndex,
      columnIndex: cell.columnIndex
    } : null;
  }

  function editableTableCellSlotRange(source, cell) {
    if (!cell || !Number.isInteger(cell.outerStart) || !Number.isInteger(cell.outerEnd)) {
      return null;
    }
    const canonical = typeof source === 'string' ? source : String(source || '');
    const start = cell.outerStart + (canonical[cell.outerStart] === '|' ? 1 : 0);
    const end = cell.outerEnd - (canonical[cell.outerEnd - 1] === '|' ? 1 : 0);
    return start <= end ? { start, end } : null;
  }

  function editableTableCellEffectiveRange(state, table, cell) {
    const semantic = cell ? { start: cell.start, end: cell.end } : null;
    const descriptor = state?.editableActiveTableCell;
    if (!semantic || !editableTableCellDescriptorMatches(descriptor, table, cell)
      || descriptor.sourceVersion !== state.sourceVersion
      || !Number.isInteger(descriptor.effectiveStart)
      || !Number.isInteger(descriptor.effectiveEnd)) return semantic;
    const slot = editableTableCellSlotRange(state.body, cell);
    if (!slot
      || descriptor.effectiveStart < slot.start
      || descriptor.effectiveEnd > slot.end
      || descriptor.effectiveStart > descriptor.effectiveEnd) return semantic;
    return {
      start: descriptor.effectiveStart,
      end: descriptor.effectiveEnd
    };
  }

  function editableTablePresentationKey(table) {
    const firstPhysicalLineId = table?.lineIds?.[0];
    return firstPhysicalLineId == null ? '' : String(firstPhysicalLineId);
  }

  function editableTableCellKey(cell) {
    if (!cell) return '';
    return [
      cell.header === true ? 'header' : 'body',
      Number(cell.rowIndex),
      Number(cell.columnIndex)
    ].join(':');
  }

  function createEditableTableCellEndCaretHost() {
    const host = createElement(
      'span',
      'markdown-editable-table-cell-end-caret',
      '\u200b'
    );
    host.setAttribute('aria-hidden', 'true');
    return host;
  }

  function createEditableTableEmptyCellHost() {
    const host = createElement('span', 'markdown-editable-table-empty-cell', '\u200b');
    host.setAttribute('aria-hidden', 'true');
    return host;
  }

  function editableTableCellDescriptorMatches(descriptor, table, cell) {
    return Boolean(descriptor && table && cell
      && descriptor.tableStart === table.start
      && descriptor.header === (cell.header === true)
      && descriptor.rowIndex === cell.rowIndex
      && descriptor.columnIndex === cell.columnIndex);
  }

  function installEditableActiveTableCell(state, table, cell) {
    const next = editableTableCellDescriptor(table, cell);
    const current = state?.editableActiveTableCell || null;
    const changed = !editableTableCellDescriptorMatches(current, table, cell)
      || Boolean(current) !== Boolean(next)
      || current?.sourceVersion !== state?.sourceVersion;
    if (changed) state.editableActiveTableCell = next ? {
      ...next,
      sourceVersion: state.sourceVersion,
      effectiveStart: cell.start,
      effectiveEnd: cell.end
    } : null;
    return changed;
  }

  function mountEditableTablePresentations(state, projection, plan, leaves) {
    state.editableTablePresentations ||= new Map();
    plan.constructs.tables.forEach((tablePlan) => {
      if (tablePlan.activeRaw || tablePlan.invalid) return;
      const owner = state.sourceSnapshot.semanticIndex.ownerById(tablePlan.ownerId);
      const rows = editableRowsForConstruct(projection, tablePlan);
      const firstRow = rows[0]?.element;
      if (!owner?.node || !firstRow) return;
      const host = editablePresentationOwnerElement(
        'markdown-editable-table-presentation',
        tablePlan.ownerId,
        'div'
      );
      appendAstTable(
        host,
        owner.node,
        state.body,
        state,
        markdownAstRenderContext(state, state.sourceSnapshot.parserAst)
      );
      const firstSourceLeaf = leaves.find((leaf) => (
        leaf.semanticOwnerId === tablePlan.ownerId
      ));
      if (firstSourceLeaf?.element?.parentNode) firstSourceLeaf.element.before(host);
      else firstRow.append(host);
      const canonicalDepot = createElement(
        'span',
        'markdown-editable-table-canonical-depot'
      );
      canonicalDepot.setAttribute('aria-hidden', 'true');
      canonicalDepot.dataset.markdownSemanticOnly = 'true';
      canonicalDepot.contentEditable = 'false';
      host.append(canonicalDepot);
      const tableElement = host.querySelector?.('.markdown-page-table') || null;
      const shell = host.querySelector?.('.markdown-page-table-shell') || tableElement;
      const presentationKey = editableTablePresentationKey(tablePlan);
      const presentation = {
        key: presentationKey,
        tablePlan,
        host,
        shell,
        tableElement,
        canonicalDepot,
        cells: new Map()
      };
      markEditablePresentationRows(rows, 'has-editable-table-presentation', {
        collapseContinuations: true
      });
      tablePlan.cells.filter((cell) => cell.canonical).forEach((cell) => {
        const selector = `${cell.header ? 'th' : 'td'}[data-markdown-table-row-index="${cell.rowIndex}"]`
          + `[data-markdown-table-column-index="${cell.columnIndex}"]`;
        const renderedCell = host.querySelector?.(selector);
        const position = projectionPositionAtOffset(projection, cell.start, 'after');
        if (!renderedCell || !position) return;
        renderedCell.dataset.markdownEditablePresentationOwner = tablePlan.ownerId;
        renderedCell.dataset.markdownEditableTableCell = 'true';
        renderedCell.dataset.markdownEditableTableCellEmpty = String(
          cell.start === cell.end
        );
        const active = editableTableCellDescriptorMatches(
          state.editableActiveTableCell,
          tablePlan,
          cell
        );
        const activeRange = active
          ? editableTableCellEffectiveRange(state, tablePlan, cell)
          : null;
        if (activeRange) {
          markSourceRange(renderedCell, activeRange.start, activeRange.end);
          renderedCell.dataset.markdownConstructId = sourceConstructId(
            'table-cell',
            activeRange.start,
            activeRange.end
          );
          renderedCell.dataset.markdownConstructStart = String(activeRange.start);
          renderedCell.dataset.markdownConstructEnd = String(activeRange.end);
        }
        renderedCell.dataset.markdownEditableTableCellActive = String(active);
        renderedCell.contentEditable = active ? 'true' : 'false';
        const cellRecord = {
          key: editableTableCellKey(cell),
          cellPlan: cell,
          element: renderedCell,
          endHost: null,
          emptyHost: null
        };
        presentation.cells.set(cellRecord.key, cellRecord);
        const cellLeaves = leaves.filter((leaf) => (
          leaf.kind === 'table-cell'
          && leaf.semanticOwnerId === tablePlan.ownerId
          && cell.start <= leaf.sourceStart
          && leaf.sourceEnd <= cell.end
        ));
        projection.registerActivationAnchor(renderedCell, position, {
          kind: active ? 'table-cell-active-background' : 'table-cell-background',
          semanticOwnerId: tablePlan.ownerId,
          semanticOnly: true,
          contentEditable: true,
          visibility: 'visible',
          interactionPolicy: 'editable-table-cell'
        });
        if (!active) {
          canonicalDepot.append(...cellLeaves.map((leaf) => leaf.element));
          return;
        }
        if (cellLeaves.length > 0) {
          renderedCell.replaceChildren(...cellLeaves.map((leaf) => leaf.element));
          const endPosition = projectionPositionAtOffset(
            projection,
            activeRange?.end ?? cell.end,
            'after'
          );
          if (cell.end > cell.start && endPosition) {
            const endHost = createEditableTableCellEndCaretHost();
            renderedCell.append(endHost);
            cellRecord.endHost = endHost;
            projection.registerActivationAnchor(endHost, endPosition, {
              kind: 'table-cell-end-caret',
              semanticOwnerId: tablePlan.ownerId,
              semanticOnly: true,
              contentEditable: true,
              visibility: 'visible',
              interactionPolicy: 'editable-table-cell',
              restoreTarget: true
            });
          }
          return;
        }
        const emptyHost = createEditableTableEmptyCellHost();
        renderedCell.replaceChildren(emptyHost);
        cellRecord.emptyHost = emptyHost;
        const emptyPosition = activeRange
          ? projectionPositionAtOffset(projection, activeRange.end, 'after') || position
          : position;
        projection.registerActivationAnchor(emptyHost, emptyPosition, {
          kind: 'table-empty-cell-caret',
          semanticOwnerId: tablePlan.ownerId,
          semanticOnly: false,
          contentEditable: true,
          visibility: 'visible',
          interactionPolicy: 'editable-table-cell',
          restoreTarget: true
        });
      });
      if (presentationKey) state.editableTablePresentations.set(presentationKey, presentation);
    });
  }

  function editableTableReconciliationShapeMatches(previous, next) {
    if (!previous || !next || previous.invalid || next.invalid
      || previous.activeRaw || next.activeRaw
      || previous.columnCount !== next.columnCount
      || previous.lineEnding !== next.lineEnding
      || previous.continuationPrefix !== next.continuationPrefix
      || previous.header.length !== next.header.length
      || previous.rows.length !== next.rows.length
      || previous.alignments.length !== next.alignments.length
      || previous.alignments.some((alignment, index) => alignment !== next.alignments[index])
      || previous.rows.some((row, index) => row.length !== next.rows[index]?.length)
      || previous.lineIds.length !== next.lineIds.length
      || previous.lineIds.some((lineId, index) => String(lineId) !== String(next.lineIds[index]))) {
      return false;
    }
    const previousCells = previous.cells.filter((cell) => cell.canonical);
    const nextCells = next.cells.filter((cell) => cell.canonical);
    return previousCells.length === nextCells.length
      && previousCells.every((cell, index) => (
        editableTableCellKey(cell) === editableTableCellKey(nextCells[index])
      ));
  }

  function editableTableSourceRangeUpdates(rootElement, activeCellElement, edit) {
    if (!rootElement || !edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      return null;
    }
    const replacement = String(edit.replacement ?? '');
    const delta = replacement.length - (edit.end - edit.start);
    const updates = [];
    const visit = (element) => {
      if (!element || element.nodeType !== 1) return true;
      const sourceStart = Number(element.dataset?.markdownSourceStart);
      const sourceEnd = Number(element.dataset?.markdownSourceEnd);
      if (Number.isFinite(sourceStart) && Number.isFinite(sourceEnd)) {
        let nextStart = sourceStart;
        let nextEnd = sourceEnd;
        const ownsActiveCell = element === activeCellElement
          || element.contains?.(activeCellElement) === true;
        if (ownsActiveCell) {
          if (sourceStart > edit.start || sourceEnd < edit.end) return false;
          nextEnd += delta;
        } else if (sourceEnd <= edit.start) {
          // The range is wholly before the canonical edit.
        } else if (sourceStart >= edit.end) {
          nextStart += delta;
          nextEnd += delta;
        } else {
          return false;
        }
        updates.push({ element, sourceStart: nextStart, sourceEnd: nextEnd });
      }
      return [...(element.childNodes || [])].every(visit);
    };
    return visit(rootElement) ? updates : null;
  }

  function applyEditableTableSourceRangeUpdates(updates) {
    const constructIds = new Map();
    updates.forEach(({ element, sourceStart, sourceEnd }) => {
      const oldConstructId = element.dataset?.markdownConstructId;
      element.dataset.markdownSourceStart = String(sourceStart);
      element.dataset.markdownSourceEnd = String(sourceEnd);
      if (element.dataset?.markdownConstructStart != null) {
        element.dataset.markdownConstructStart = String(sourceStart);
      }
      if (element.dataset?.markdownConstructEnd != null) {
        element.dataset.markdownConstructEnd = String(sourceEnd);
      }
      if (oldConstructId) {
        const parts = String(oldConstructId).split(':');
        const kind = parts.slice(0, -2).join(':');
        if (kind) {
          const nextConstructId = sourceConstructId(kind, sourceStart, sourceEnd);
          constructIds.set(String(oldConstructId), nextConstructId);
          element.dataset.markdownConstructId = nextConstructId;
        }
      }
    });
    updates.forEach(({ element }) => {
      const markerFor = element.dataset?.markdownMarkerFor;
      if (markerFor && constructIds.has(String(markerFor))) {
        element.dataset.markdownMarkerFor = constructIds.get(String(markerFor));
      }
    });
  }

  function createEditableTableProjectedLeaf(leaf) {
    if (!leaf || leaf.kind !== 'table-cell' && leaf.kind !== 'table-structural-source') {
      return null;
    }
    const element = createElement('span');
    const textNode = document.createTextNode(String(leaf.text ?? ''));
    element.append(textNode);
    return { element, textNode };
  }

  function editableTableTopologyRevision(pair, context) {
    const record = pair?.activeRecord;
    const previousCell = record?.cellPlan;
    const nextCell = pair?.nextCellsByKey?.get(pair.activeKey);
    const previousLeaves = context?.previousLeafRecords || [];
    const nextLeaves = context?.nextLeaves || [];
    if (!record?.element || !previousCell || !nextCell
      || (context?.transition === 'empty-to-nonempty'
        && (previousCell.start !== previousCell.end || nextCell.start === nextCell.end))
      || (context?.transition === 'nonempty-to-empty'
        && (previousCell.start === previousCell.end || nextCell.start !== nextCell.end))) {
      return null;
    }

    const previousCellLeafIndices = previousLeaves.flatMap((leaf, index) => (
      leaf?.leaf?.kind === 'table-cell'
        && previousCell.start <= leaf.sourceStart
        && leaf.sourceEnd <= previousCell.end
        ? [index]
        : []
    ));
    const nextCellLeafIndices = nextLeaves.flatMap((leaf, index) => (
      leaf?.kind === 'table-cell'
        && nextCell.start <= leaf.sourceStart
        && leaf.sourceEnd <= nextCell.end
        ? [index]
        : []
    ));

    if (context.transition === 'empty-to-nonempty') {
      if (previousCellLeafIndices.length !== 0 || nextCellLeafIndices.length !== 1
        || nextLeaves.length !== previousLeaves.length + 2 || !record.emptyHost) return null;
      const activeIndex = nextCellLeafIndices[0];
      const splitIndex = activeIndex - 1;
      if (splitIndex < 0 || activeIndex + 1 >= nextLeaves.length
        || previousLeaves[splitIndex]?.leaf?.kind !== 'table-structural-source'
        || nextLeaves[splitIndex]?.kind !== 'table-structural-source'
        || nextLeaves[activeIndex + 1]?.kind !== 'table-structural-source') return null;

      const activeLeaf = createEditableTableProjectedLeaf(nextLeaves[activeIndex]);
      const trailingStructuralLeaf = createEditableTableProjectedLeaf(
        nextLeaves[activeIndex + 1]
      );
      const structuralParent = previousLeaves[splitIndex].element?.parentNode || null;
      const structuralBefore = previousLeaves.slice(splitIndex + 1)
        .map((leaf) => leaf.element)
        .find((element) => element?.parentNode === structuralParent) || null;
      const endHost = createEditableTableCellEndCaretHost();
      if (!activeLeaf || !trailingStructuralLeaf || !structuralParent) return null;

      pair.topologyRevision = {
        transition: context.transition,
        endHost,
        emptyHost: null
      };
      return {
        transition: context.transition,
        bindings: nextLeaves.map((_leaf, nextLeafIndex) => {
          if (nextLeafIndex === activeIndex) {
            return { nextLeafIndex, ...activeLeaf };
          }
          if (nextLeafIndex === activeIndex + 1) {
            return { nextLeafIndex, ...trailingStructuralLeaf };
          }
          return {
            nextLeafIndex,
            previousLeafIndex: nextLeafIndex < activeIndex
              ? nextLeafIndex
              : nextLeafIndex - 2
          };
        }),
        removePreviousLeafIndices: [],
        removeElements: [record.emptyHost],
        discardedActivationAnchorElements: [record.emptyHost],
        placements: [
          { nextLeafIndex: activeIndex, parent: record.element },
          { element: endHost, parent: record.element },
          {
            nextLeafIndex: activeIndex + 1,
            parent: structuralParent,
            ...(structuralBefore ? { before: structuralBefore } : {})
          }
        ]
      };
    }

    if (context.transition === 'nonempty-to-empty') {
      if (previousCellLeafIndices.length !== 1 || nextCellLeafIndices.length !== 0
        || nextLeaves.length !== previousLeaves.length - 2 || !record.endHost) return null;
      const activeIndex = previousCellLeafIndices[0];
      const mergedIndex = activeIndex - 1;
      if (mergedIndex < 0 || activeIndex + 1 >= previousLeaves.length
        || previousLeaves[mergedIndex]?.leaf?.kind !== 'table-structural-source'
        || previousLeaves[activeIndex + 1]?.leaf?.kind !== 'table-structural-source'
        || nextLeaves[mergedIndex]?.kind !== 'table-structural-source') return null;

      const emptyHost = createEditableTableEmptyCellHost();
      pair.topologyRevision = {
        transition: context.transition,
        endHost: null,
        emptyHost
      };
      return {
        transition: context.transition,
        bindings: nextLeaves.map((_leaf, nextLeafIndex) => ({
          nextLeafIndex,
          previousLeafIndex: nextLeafIndex <= mergedIndex
            ? nextLeafIndex
            : nextLeafIndex + 2
        })),
        removePreviousLeafIndices: [activeIndex, activeIndex + 1],
        removeElements: [record.endHost],
        discardedActivationAnchorElements: [record.endHost],
        placements: [{ element: emptyHost, parent: record.element }]
      };
    }
    return null;
  }

  function reconcileEditableTableCellAnchors(state, projection, table, record) {
    const cell = record?.cellPlan;
    if (!projection || !table || !cell || !record.element) return false;
    const activeRange = editableTableCellEffectiveRange(state, table, cell);
    const startPosition = projectionPositionAtOffset(
      projection,
      activeRange?.start ?? cell.start,
      'after'
    );
    if (!startPosition || !projection.registerActivationAnchor(record.element, startPosition, {
      kind: 'table-cell-active-background',
      semanticOwnerId: table.ownerId,
      semanticOnly: true,
      contentEditable: true,
      visibility: 'visible',
      interactionPolicy: 'editable-table-cell'
    })) return false;
    if (record.endHost) {
      const endPosition = projectionPositionAtOffset(
        projection,
        activeRange?.end ?? cell.end,
        'after'
      );
      return Boolean(endPosition && projection.registerActivationAnchor(
        record.endHost,
        endPosition,
        {
          kind: 'table-cell-end-caret',
          semanticOwnerId: table.ownerId,
          semanticOnly: true,
          contentEditable: true,
          visibility: 'visible',
          interactionPolicy: 'editable-table-cell',
          restoreTarget: true
        }
      ));
    }
    const endPosition = projectionPositionAtOffset(
      projection,
      activeRange?.end ?? cell.end,
      'after'
    );
    return Boolean(record.emptyHost && endPosition && projection.registerActivationAnchor(
      record.emptyHost,
      endPosition,
      {
        kind: 'table-empty-cell-caret',
        semanticOwnerId: table.ownerId,
        semanticOnly: false,
        contentEditable: true,
        visibility: 'visible',
        interactionPolicy: 'editable-table-cell',
        restoreTarget: true
      }
    ));
  }

  function editableTableReconciliationPreflight(
    state,
    previousPlan,
    nextPlan,
    request,
    edit
  ) {
    const presentations = state?.editableTablePresentations;
    const previousTables = (previousPlan?.constructs?.tables || []).filter((table) => (
      !table.invalid && !table.activeRaw
    ));
    const nextTablesByKey = new Map((nextPlan?.constructs?.tables || [])
      .filter((table) => !table.invalid && !table.activeRaw)
      .map((table) => [editableTablePresentationKey(table), table]));
    if (state?.mode !== 'live-preview'
      || typeof state.editableProjection?.reconcileExactSourceRevision !== 'function'
      || !(presentations instanceof Map)
      || previousTables.length !== nextTablesByKey.size
      || previousTables.length !== presentations.size
      || !request || !edit) return null;

    const pairs = [];
    for (const previousTable of previousTables) {
      const key = editableTablePresentationKey(previousTable);
      const nextTable = nextTablesByKey.get(key);
      const presentation = presentations.get(key);
      if (!key || !nextTable || !presentation
        || presentation.tablePlan !== previousTable
        || !editableTableReconciliationShapeMatches(previousTable, nextTable)
        || !presentation.host || !presentation.tableElement
        || presentation.cells.size !== previousTable.cells.filter((cell) => cell.canonical).length) {
        return null;
      }
      const isEditedTable = previousTable.start === request.tableStart;
      const activeKey = isEditedTable ? editableTableCellKey(request) : '';
      const activeRecord = activeKey ? presentation.cells.get(activeKey) : null;
      if (isEditedTable && (!activeRecord
        || !editableTableCellDescriptorMatches(
          state.editableActiveTableCell,
          previousTable,
          activeRecord.cellPlan
        )
        || !editableTableCellDescriptorMatches(request, previousTable, activeRecord.cellPlan)
        || request.previousEffectiveStart > edit.start
        || request.previousEffectiveEnd < edit.end)) return null;
      const nextCellsByKey = new Map(nextTable.cells.filter((cell) => cell.canonical)
        .map((cell) => [editableTableCellKey(cell), cell]));
      for (const previousCell of previousTable.cells.filter((cell) => cell.canonical)) {
        const cellKey = editableTableCellKey(previousCell);
        const nextCell = nextCellsByKey.get(cellKey);
        const record = presentation.cells.get(cellKey);
        if (!nextCell || !record || record.cellPlan !== previousCell
          || !record.element) return null;
        if (isEditedTable && cellKey === activeKey) {
          if (nextCell.source !== request.expectedCellSource) return null;
        } else if (nextCell.source !== previousCell.source) return null;
      }
      pairs.push({
        key,
        previousTable,
        nextTable,
        presentation,
        activeKey,
        activeRecord,
        nextCellsByKey,
        topologyRevision: null
      });
    }
    const editedPair = pairs.find((pair) => pair.previousTable.start === request.tableStart);
    if (!editedPair?.activeRecord) return null;
    const sourceRangeUpdates = editableTableSourceRangeUpdates(
      state.bodyRoot,
      editedPair.activeRecord.element,
      edit
    );
    return sourceRangeUpdates ? { pairs, sourceRangeUpdates } : null;
  }

  function applyEditableTablePresentationRevision(state, pairs, sourceRangeUpdates) {
    applyEditableTableSourceRangeUpdates(sourceRangeUpdates);
    pairs.forEach((pair) => {
      const { presentation, nextTable, nextCellsByKey } = pair;
      presentation.host.dataset.markdownEditablePresentationOwner = String(nextTable.ownerId);
      [presentation.shell, presentation.tableElement].filter(Boolean).forEach((element) => {
        element.dataset.markdownTableStart = String(nextTable.start);
        element.dataset.markdownTableEnd = String(nextTable.end);
      });
      markSourceRange(presentation.tableElement, nextTable.start, nextTable.end);
      presentation.tableElement.dataset.markdownConstructId = sourceConstructId(
        'table',
        nextTable.start,
        nextTable.end
      );
      presentation.tableElement.dataset.markdownConstructStart = String(nextTable.start);
      presentation.tableElement.dataset.markdownConstructEnd = String(nextTable.end);
      presentation.cells.forEach((record, key) => {
        const nextCell = nextCellsByKey.get(key);
        record.cellPlan = nextCell;
        record.element.dataset.markdownEditablePresentationOwner = String(nextTable.ownerId);
        record.element.dataset.markdownEditableTableCellEmpty = String(
          nextCell.start === nextCell.end
        );
        const cellRange = key === pair.activeKey
          ? editableTableCellEffectiveRange(state, nextTable, nextCell)
          : nextCell;
        markSourceRange(record.element, cellRange.start, cellRange.end);
        record.element.dataset.markdownConstructId = sourceConstructId(
          'table-cell',
          cellRange.start,
          cellRange.end
        );
        record.element.dataset.markdownConstructStart = String(cellRange.start);
        record.element.dataset.markdownConstructEnd = String(cellRange.end);
      });
      if (pair.topologyRevision && pair.activeRecord) {
        pair.activeRecord.endHost = pair.topologyRevision.endHost;
        pair.activeRecord.emptyHost = pair.topologyRevision.emptyHost;
        if (!reconcileEditableTableCellAnchors(
          state,
          state.editableProjection,
          nextTable,
          pair.activeRecord
        )) {
          throw new TypeError('Editable table topology revision lost its exact caret anchors.');
        }
      }
      presentation.tablePlan = nextTable;
    });
  }

  function reconcileEditableTableRevision(state, previousPlan, nextPlan, request, edit) {
    const preflight = editableTableReconciliationPreflight(
      state,
      previousPlan,
      nextPlan,
      request,
      edit
    );
    if (!preflight) return false;
    const { pairs, sourceRangeUpdates } = preflight;
    const result = state.editableProjection.reconcileExactSourceRevision(
      state.sourceSnapshot,
      {
        mode: state.mode,
        presentationPlan: nextPlan,
        edits: [edit],
        affectedPhysicalLineIds: pairs
          .filter((pair) => pair.activeKey)
          .flatMap((pair) => pair.nextTable.lineIds),
        leafTopologyReconciler: (context) => {
          const pair = pairs.find((candidate) => (
            candidate.activeKey
              && candidate.nextTable.lineIds.some((lineId) => (
                String(lineId) === String(context.physicalLineId)
              ))
          ));
          return pair ? editableTableTopologyRevision(pair, context) : null;
        }
      }
    );
    if (!result) return false;
    state.editablePresentationPlan = nextPlan;
    applyEditableTablePresentationRevision(state, pairs, sourceRangeUpdates);
    decorateEditableProjectedLeaves(nextPlan, state.editableProjection.enumerateProjectedLeaves());
    const foldIndex = reconcileMarkdownStructuralFoldState(state);
    state.markdownFoldVisibility = deriveMarkdownStructuralFoldVisibility(
      foldIndex,
      state.markdownFoldCollapsedKeys
    );
    return result;
  }

  function mountEditableListPresentations(state, projection, plan, leaves) {
    const planAnchors = projection.enumeratePlanActivationAnchors();
    (plan.constructs.listRows || []).forEach((listRow) => {
      const rowEntry = projection.enumeratePhysicalRows().find((entry) => (
        String(entry.physicalLineId) === String(listRow.physicalLineId)
      ));
      const row = rowEntry?.element;
      if (!row) return;
      const listDepth = Math.max(0, Number(listRow.tabDepth || 0));
      row.style?.setProperty?.(
        '--markdown-editable-list-depth',
        String(listDepth)
      );
      row.classList.add('has-editable-list-row-presentation');
      row.classList.toggle('is-editable-task-list-row', listRow.task === true);
      row.classList.toggle('is-editable-list-row-active', listRow.active === true);
      row.classList.toggle(
        'is-editable-list-presentation-rendered',
        listRow.presentation?.renderedMounted === true
      );
      row.dataset.editableListPresentationId = listRow.presentationId;
      row.dataset.editableListSourceVisible = String(
        listRow.presentation?.sourceVisible === true
      );
      if (listRow.hnSequenceList === true) {
        row.classList.add('is-hn-sequence-list-row');
        row.classList.toggle(
          'is-hn-sequence-list-item-row',
          listRow.continuation !== true
        );
        row.classList.toggle(
          'is-hn-sequence-list-continuation-row',
          listRow.continuation === true
        );
        row.dataset.hnListSequenceId = String(listRow.hnSequenceId || '');
        row.dataset.hnListItemId = String(listRow.hnItemId || '');
        row.dataset.hnListParagraphKind = listRow.continuation
          ? 'continuation'
          : 'first';
        const markerColumnWidth = Math.max(
          1,
          Math.trunc(Number(listRow.markerColumnWidth || 1))
        );
        // CSS typed multiplication is not consistently accepted in the
        // packaged Chromium line. Materialize the already-derived structural
        // values as lengths so marker text cannot fall back to the generic
        // 1.25em track and wrap (notably at 9. -> 10.). This remains purely a
        // presentation projection of source-owned Tab depth and marker width.
        const leadingWidthEm = markerColumnWidth + (listDepth * 1.35);
        row.style?.setProperty?.(
          '--hn-sequence-list-marker-columns',
          String(markerColumnWidth)
        );
        row.style?.setProperty?.(
          '--hn-sequence-list-marker-width',
          `${markerColumnWidth}em`
        );
        row.style?.setProperty?.(
          '--hn-sequence-list-leading-width',
          `${Number(leadingWidthEm.toFixed(2))}em`
        );
      }
      const contentLeaf = leaves.find((leaf) => (
        String(leaf.physicalLineId) === String(listRow.physicalLineId)
          && Number(leaf.sourceStart) <= Number(listRow.contentStart)
          && Number(listRow.contentStart) <= Number(leaf.sourceEnd)
          && leaf.visibility === 'visible'
      ));
      const insert = (element) => {
        if (contentLeaf?.element?.parentNode === row) contentLeaf.element.before(element);
        else row.append(element);
      };

      if (listRow.task) {
        if (!listRow.presentation?.renderedMounted) return;
        const createSharedCheckbox = root.filterCheckboxControl?.create;
        if (typeof createSharedCheckbox !== 'function') return;
        const renderedSourceVersion = state.sourceVersion;
        const control = createSharedCheckbox({
          document,
          checked: listRow.checked,
          ariaLabel: listRow.checked ? 'Mark task as incomplete' : 'Mark task as complete',
          onChange: (event) => {
            event.stopPropagation();
            const canonicalState = state.body.slice(
              listRow.taskCheckStart,
              listRow.taskCheckEnd
            );
            const replacement = canonicalState === ' '
              ? 'x'
              : /^[xX]$/.test(canonicalState)
                ? ' '
                : null;
            if (state.mode !== 'live-preview'
              || state.sourceVersion !== renderedSourceVersion
              || replacement === null) {
              event.currentTarget.checked = listRow.checked;
              if (state.sourceVersion !== renderedSourceVersion) refreshEditableProjection(state);
              return;
            }
            const beforeSelection = captureSemanticSelection(state.bodyRoot);
            replaceSemanticSourceRange(
              state,
              listRow.taskCheckStart,
              listRow.taskCheckEnd,
              replacement,
              {
                beforeSelection,
                afterSelection: beforeSelection,
                inputType: 'formatTaskList',
                restoreSelection: false,
                transactionMetadata: {
                  commandKind: 'task-list-toggle',
                  primaryEdit: {
                    start: listRow.taskCheckStart,
                    end: listRow.taskCheckEnd,
                    replacement,
                    kind: 'task-list-toggle'
                  }
                }
              }
            );
            commitBody(state, 'task-list-toggle');
          }
        });
        control.element.classList.add('markdown-editable-task-control');
        control.element.dataset.markdownSemanticOnly = 'true';
        control.element.dataset.markdownSemanticControl = 'true';
        control.element.dataset.markdownEditablePresentationOwner = String(listRow.ownerId);
        control.element.dataset.markdownEditablePresentationId = listRow.presentationId;
        control.element.dataset.markdownEditableTaskOwner = String(listRow.ownerId);
        control.element.contentEditable = 'false';
        insert(control.element);
        return;
      }

      const markerElements = new Set(leaves.filter((leaf) => (
        String(leaf.physicalLineId) === String(listRow.physicalLineId)
          && Number(listRow.markerStart) <= Number(leaf.sourceStart)
          && Number(leaf.sourceEnd) <= Number(listRow.markerEnd)
      )).map((leaf) => leaf.element));
      let markerSlot = null;
      if (markerElements.size > 0) {
        markerSlot = createElement('span', 'markdown-editable-list-marker-slot');
        markerSlot.dataset.markdownEditableListSlot = 'marker';
        markerSlot.dataset.markdownEditablePresentationId = listRow.presentationId;
        if (listRow.hnSequenceList === true) {
          markerSlot.dataset.hnListMarkerCell = 'true';
          if (listRow.continuation !== true) markerSlot.dataset.hnListMarker = 'true';
        }
        markerSlot.setAttribute('role', 'presentation');
        const contentSlot = createElement('span', 'markdown-editable-list-content-slot');
        contentSlot.dataset.markdownEditableListSlot = 'content';
        contentSlot.dataset.markdownEditablePresentationId = listRow.presentationId;
        if (listRow.hnSequenceList === true) {
          contentSlot.dataset.hnListItemContent = 'true';
        }
        contentSlot.setAttribute('role', 'presentation');
        const rowChildren = [...(row.childNodes || [])];
        row.replaceChildren(markerSlot, contentSlot);
        rowChildren.forEach((child) => {
          (markerElements.has(child) ? markerSlot : contentSlot).append(child);
        });
      }
      if (listRow.hnSequenceList === true) return;
      if (!listRow.presentation?.renderedMounted) return;

      const bullet = editablePresentationOwnerElement(
        'markdown-editable-list-bullet',
        listRow.ownerId
      );
      const markerPresentation = unorderedMarkerForDepth(
        Math.max(0, Number(listRow.depth || 1) - 1)
      );
      bullet.dataset.markdownEditablePresentationId = listRow.presentationId;
      bullet.dataset.markdownUnorderedMarkerStyle = markerPresentation.listStyleType;
      bullet.setAttribute('aria-hidden', 'true');
      bullet.textContent = markerPresentation.glyph;
      if (markerSlot) markerSlot.append(bullet);
      else insert(bullet);
      const planAnchor = planAnchors.find((anchor) => (
        anchor.presentationId === listRow.presentationId
      ));
      if (planAnchor) projection.registerPlanActivationAnchor(bullet, planAnchor, {
        kind: 'unordered-list-rendered-activation'
      });
    });
  }

  function mountEditableSyntaxPresentations(state) {
    const projection = state?.editableProjection;
    const plan = state?.editablePresentationPlan;
    if (!projection || !plan) return [];
    const leaves = projection.enumerateProjectedLeaves();
    decorateEditableProjectedLeaves(plan, leaves);
    if (state.mode === 'source') return leaves;
    if (state.mode !== 'live-preview') return leaves;
    mountEditableListPresentations(state, projection, plan, leaves);
    mountEditableTablePresentations(state, projection, plan, leaves);
    mountEditableSimplePresentations(state, projection, plan, leaves);
    mountEditableCodePresentations(state, projection, plan, leaves);
    mountEditableMathPresentations(state, projection, plan, leaves);
    return leaves;
  }

  function decorateEditablePhysicalRows(state) {
    const projection = state?.editableProjection;
    const snapshot = state?.sourceSnapshot;
    if (!projection || !snapshot) return;
    const listIndex = snapshot.editableListSemanticIndex;
    const fenced = new Set(listIndex?.fencedLineIndices || []);
    const planLines = new Map((state.editablePresentationPlan?.lines || []).map((line) => (
      [line.physicalLineId, line]
    )));
    projection.enumeratePhysicalRows().forEach((entry) => {
      const row = entry.element;
      const text = entry.text;
      const list = listIndex?.byLineIndex?.get(entry.index) || null;
      row.classList.toggle('is-editable-list-row', Boolean(list));
      row.classList.toggle('is-editable-ordered-list-row', Boolean(list?.ordered));
      row.classList.toggle('is-editable-unordered-list-row', Boolean(list?.unordered));
      const planLine = planLines.get(entry.physicalLineId);
      const listPresentation = planLine?.metadata?.listRow || null;
      row.classList.toggle('is-editable-task-list-row', Boolean(listPresentation?.task));
      row.classList.toggle('is-editable-list-row-active', Boolean(listPresentation?.active));
      row.classList.toggle(
        'is-editable-list-presentation-rendered',
        Boolean(listPresentation?.renderedMounted)
      );
      const quote = planLine?.metadata?.quote || null;
      const headingRole = (planLine?.leaves || []).flatMap((leaf) => (
        leaf.semanticRoles || []
      )).find((role) => role.family === 'heading');
      const headingDepth = Number.isFinite(Number(headingRole?.depth))
        ? Math.max(1, Math.min(6, Number(headingRole.depth)))
        : null;
      const quoteDepth = quote ? Math.max(1, Number(quote.depth || 1)) : null;
      const quoteSourceVisible = Boolean(quote && (
        state.mode === 'source' || quote.active
      ));
      const quoteRailDepth = quote ? quoteDepth : null;
      row.classList.toggle('is-editable-quote-row', Boolean(quote));
      row.classList.toggle('is-editable-quote-active', Boolean(quote?.active));
      row.classList.toggle('is-editable-quote-source-visible', quoteSourceVisible);
      row.classList.toggle('is-editable-heading-row', headingDepth != null);
      row.classList.toggle('is-editable-paragraph-row', Boolean(
        planLine?.metadata?.paragraphs?.length
      ));
      row.classList.toggle('is-editable-code-row', fenced.has(entry.index));
      row.classList.toggle('is-editable-table-row', Boolean(planLine?.metadata?.tableOwnerId));
      [...row.classList]
        .filter((name) => name.startsWith('is-editable-heading-depth-'))
        .forEach((name) => row.classList.remove(name));
      if (headingDepth != null) {
        row.classList.add(`is-editable-heading-depth-${headingDepth}`);
        row.dataset.editableHeadingDepth = String(headingDepth);
        row.style.setProperty('--markdown-editable-heading-depth', String(headingDepth));
      } else {
        delete row.dataset.editableHeadingDepth;
        row.style.removeProperty('--markdown-editable-heading-depth');
      }
      if (quote) {
        row.dataset.editableQuoteDepth = String(quoteDepth);
        row.dataset.editableQuoteRailDepth = String(quoteRailDepth);
        row.dataset.editableQuoteSourceVisible = String(quoteSourceVisible);
        row.style.setProperty('--markdown-editable-quote-depth', String(quoteDepth));
        row.style.setProperty('--markdown-editable-quote-rail-depth', String(quoteRailDepth));
      } else {
        delete row.dataset.editableQuoteDepth;
        delete row.dataset.editableQuoteRailDepth;
        delete row.dataset.editableQuoteSourceVisible;
        row.style.removeProperty('--markdown-editable-quote-depth');
        row.style.removeProperty('--markdown-editable-quote-rail-depth');
      }
      if (list) {
        row.dataset.editableListKind = list.kind;
        row.dataset.editableListDepth = String(list.depth);
        row.style.setProperty('--markdown-editable-list-depth', String(list.tabDepth));
        if (listPresentation) {
          row.dataset.editableListPresentationId = listPresentation.presentationId;
          row.dataset.editableListSourceVisible = String(listPresentation.sourceVisible);
        }
      } else {
        delete row.dataset.editableListKind;
        delete row.dataset.editableListDepth;
        row.style.removeProperty('--markdown-editable-list-depth');
      }
      if (!listPresentation) {
        delete row.dataset.editableListPresentationId;
        delete row.dataset.editableListSourceVisible;
      }
    });
  }

  function markdownStructuralFoldDescriptor(owner) {
    return {
      kind: owner.kind,
      physicalLineId: owner.physicalLineId,
      lineIndex: owner.lineIndex,
      depth: owner.depth
    };
  }

  function markdownStructuralFoldDescriptorsEqual(left, right) {
    if (left.length !== right.length) return false;
    return left.every((entry, index) => (
      entry.kind === right[index].kind
      && entry.physicalLineId === right[index].physicalLineId
      && entry.lineIndex === right[index].lineIndex
      && entry.depth === right[index].depth
    ));
  }

  function notifyMarkdownStructuralFoldState(state) {
    invoke(state.onFoldStateChange, {
      paneId: state.paneId,
      tabId: state.tabId,
      pageId: state.page?.id || state.page?.pageId || null,
      folds: state.markdownFoldDescriptors.map((entry) => ({ ...entry }))
    });
  }

  function reconcileMarkdownStructuralFoldState(state, { notify = true } = {}) {
    const previousIndex = state.markdownFoldIndex || null;
    const index = buildMarkdownStructuralFoldIndex(state.sourceSnapshot);
    const matched = [];
    const seen = new Set();
    normalizeMarkdownStructuralFoldDescriptors(state.markdownFoldDescriptors).forEach((descriptor) => {
      const exact = descriptor.physicalLineId
        ? index.byPhysicalIdentity.get(`${descriptor.kind}:${descriptor.physicalLineId}`)
        : null;
      const locationMatch = index.owners.find((owner) => (
        owner.kind === descriptor.kind
        && owner.lineIndex === descriptor.lineIndex
        && owner.depth === descriptor.depth
      ));
      const existedInPreviousSnapshot = descriptor.physicalLineId
        ? previousIndex?.byPhysicalIdentity?.has(
          `${descriptor.kind}:${descriptor.physicalLineId}`
        ) === true
        : false;
      // Line/depth is a restart fallback for regenerated runtime line IDs.
      // On first hydration, a serialized runtime ID is only a hint: the
      // process-global ID counter may have reused it for a different row.
      // Once an ID was observed in this view lifecycle, its disappearance
      // means that structural owner was destroyed and must be pruned rather
      // than transferred to an unrelated replacement at the same row.
      const fallback = previousIndex
        ? exact || (!existedInPreviousSnapshot ? locationMatch : null)
        : locationMatch;
      if (!fallback || seen.has(fallback.key)) return;
      seen.add(fallback.key);
      matched.push(fallback);
    });
    const nextDescriptors = matched.map(markdownStructuralFoldDescriptor);
    const previousDescriptors = normalizeMarkdownStructuralFoldDescriptors(
      state.markdownFoldDescriptors
    );
    state.markdownFoldIndex = index;
    state.markdownFoldCollapsedKeys = new Set(matched.map((owner) => owner.key));
    state.markdownFoldDescriptors = nextDescriptors;
    if (notify && !markdownStructuralFoldDescriptorsEqual(
      previousDescriptors,
      nextDescriptors
    )) notifyMarkdownStructuralFoldState(state);
    return index;
  }

  function clearMarkdownStructuralFoldDom(bodyRoot) {
    if (!bodyRoot) return;
    bodyRoot.querySelectorAll?.(
      '.markdown-structural-fold-control, .markdown-structural-reading-list-marker-trigger'
    ).forEach((element) => element.remove());
    bodyRoot.querySelectorAll?.('.is-markdown-structural-fold-hidden').forEach((element) => {
      element.hidden = false;
      element.classList.remove('is-markdown-structural-fold-hidden');
      delete element.dataset.markdownStructuralFoldHidden;
    });
    bodyRoot.querySelectorAll?.('.markdown-structural-fold-owner').forEach((element) => {
      element.classList.remove(
        'markdown-structural-fold-owner',
        'is-markdown-structural-fold-collapsed'
      );
      delete element.dataset.markdownStructuralFoldOwnerKey;
      delete element.dataset.markdownStructuralFoldKind;
      delete element.dataset.markdownStructuralFoldCollapsed;
      delete element.dataset.markdownStructuralFoldTrigger;
      delete element.dataset.markdownSemanticControl;
      element.style?.removeProperty?.('--markdown-structural-list-marker-characters');
      element.style?.removeProperty?.('--markdown-structural-fold-anchor-inline');
    });
    bodyRoot.querySelectorAll?.('.markdown-structural-fold-control-host').forEach((element) => {
      element.classList.remove('markdown-structural-fold-control-host');
      element.style?.removeProperty?.('--markdown-structural-fold-anchor-inline');
    });
    bodyRoot.querySelectorAll?.('[data-markdown-structural-fold-trigger]').forEach((element) => {
      element.classList.remove('markdown-structural-editable-list-marker-trigger');
      delete element.dataset.markdownStructuralFoldOwnerKey;
      delete element.dataset.markdownStructuralFoldTrigger;
      delete element.dataset.markdownSemanticControl;
    });
  }

  function markMarkdownStructuralFoldHidden(element) {
    if (!element) return;
    element.hidden = true;
    element.classList.add('is-markdown-structural-fold-hidden');
    element.dataset.markdownStructuralFoldHidden = 'true';
  }

  function markdownElementLineIndices(state, element) {
    const start = Number(element?.dataset?.markdownSourceStart);
    const end = Number(element?.dataset?.markdownSourceEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    const lines = state.sourceSnapshot?.physicalLineIndex?.lines || [];
    const indices = lines.filter((line) => (
      line.start < end && line.sourceEnd > start
    )).map((line) => line.index);
    if (indices.length || end > start) return indices;
    const line = state.sourceSnapshot?.physicalLineIndex?.lineAtOffset?.(start, 'after');
    return line ? [line.index] : [];
  }

  function readingMarkdownStructuralOwnerElement(state, owner) {
    const candidates = state.bodyRoot?.querySelectorAll?.('[data-markdown-source-start]') || [];
    return [...candidates].find((element) => {
      const kindMatches = owner.kind === 'heading'
        ? element.classList?.contains('markdown-page-heading')
        : element.classList?.contains('markdown-page-list-item');
      if (!kindMatches) return false;
      const start = Number(element.dataset.markdownSourceStart);
      if (!Number.isFinite(start)) return false;
      return state.sourceSnapshot.physicalLineIndex.lineIndexAtOffset(start, 'after')
        === owner.lineIndex;
    }) || null;
  }

  function editableMarkdownStructuralOwnerElement(state, owner) {
    return state.editableProjection?.enumeratePhysicalRows?.().find((entry) => (
      String(entry.physicalLineId) === String(owner.physicalLineId)
    ))?.element || null;
  }

  function editableMarkdownHeadingFoldControlHost(state, owner, fallback) {
    const ownerLine = state.sourceSnapshot?.physicalLineIndex?.lines?.[owner.lineIndex];
    if (!ownerLine || owner.ownerStart <= ownerLine.start) return fallback;
    const leaves = state.editableProjection?.enumerateProjectedLeaves?.() || [];
    const construct = state.editablePresentationPlan?.constructs?.headings?.find((candidate) => (
      Number(candidate.start) === owner.ownerStart
    ));
    const renderedHost = [...(fallback?.querySelectorAll?.(
      '.markdown-editable-heading-presentation'
    ) || [])].find((element) => (
      !construct?.presentationId
      || element.dataset.markdownEditablePresentationId === construct.presentationId
    )) || null;
    const contentCandidates = leaves
      .filter((leaf) => (
        String(leaf.physicalLineId) === String(owner.physicalLineId)
        && leaf.element
        && leaf.visibility === 'visible'
        && Number(leaf.sourceStart) <= owner.safeOffset
        && owner.safeOffset <= Number(leaf.sourceEnd)
      ))
      .sort((left, right) => (
        Number(Number(right.sourceStart) === owner.safeOffset)
          - Number(Number(left.sourceStart) === owner.safeOffset)
        || (Number(left.sourceEnd) - Number(left.sourceStart))
          - (Number(right.sourceEnd) - Number(right.sourceStart))
      ));
    const host = renderedHost
      || contentCandidates[0]?.element
      || fallback?.querySelector?.('.markdown-editable-list-content-slot')
      || fallback;
    const visibleMarkerLeaf = leaves.find((leaf) => (
      String(leaf.physicalLineId) === String(owner.physicalLineId)
      && leaf.element
      && leaf.visibility === 'visible'
      && Number(leaf.sourceStart) <= owner.ownerStart
      && owner.ownerStart < Number(leaf.sourceEnd)
    ));
    const presentationScale = Math.max(0.05, finiteNumber(state.zoom, 1));
    const markerWidth = renderedHost
      ? 0
      : Math.max(
        0,
        (Number(visibleMarkerLeaf?.element?.getBoundingClientRect?.().width) || 0)
          / presentationScale
      );
    host?.classList?.add('markdown-structural-fold-control-host');
    host?.style?.setProperty?.(
      '--markdown-structural-fold-anchor-inline',
      `${-markerWidth}px`
    );
    return host;
  }

  function claimMarkdownStructuralFoldPointer(event) {
    if (event?.button !== undefined && event.button !== 0) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    return true;
  }

  function moveReadingMarkdownSelectionBeforeFold(state, owner) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return false;
    const candidates = state.bodyRoot.querySelectorAll?.(
      '.markdown-page-live-block, [data-markdown-source-start][data-markdown-source-end]'
    ) || [];
    const hiddenElements = [...candidates].filter((element) => {
      const indices = markdownElementLineIndices(state, element);
      return indices.length > 0 && indices.every((lineIndex) => (
        owner.hiddenStartLineIndex <= lineIndex
        && lineIndex < owner.hiddenEndLineIndex
      ));
    });
    const intersectsHidden = Array.from({ length: selection.rangeCount }, (_unused, index) => {
      const range = selection.getRangeAt?.(index);
      return range && hiddenElements.some((element) => {
        try {
          return range.intersectsNode(element);
        } catch (_error) {
          return false;
        }
      });
    }).some(Boolean);
    if (!intersectsHidden) return false;
    const target = readingMarkdownStructuralOwnerElement(state, owner);
    const range = target && document.createRange?.();
    if (!range) return false;
    try {
      state.bodyRoot.focus?.({ preventScroll: true });
      range.selectNodeContents(target);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function moveMarkdownSelectionBeforeFold(state, owner) {
    const projection = state?.editableProjection;
    if (!projection) return moveReadingMarkdownSelectionBeforeFold(state, owner);
    const selection = projection?.getSelection?.();
    if (!selection) return false;
    const logicalWholeBody = activeMarkdownClipboardSelection?.kind === 'whole-body'
      && activeMarkdownClipboardSelection.state === state;
    const inside = (position) => {
      if (!position) return false;
      const lineIndex = state.sourceSnapshot?.physicalLineIndex?.lines?.find((line) => (
        String(line.id) === String(position.physicalLineId)
      ))?.index;
      if (Number.isInteger(lineIndex)
        && owner.hiddenStartLineIndex <= lineIndex
        && lineIndex < owner.hiddenEndLineIndex) return true;
      return owner.hiddenStartOffset <= position.offset
        && position.offset < owner.hiddenEndOffset;
    };
    const selectionStart = Math.min(
      finiteNumber(selection.anchor?.offset, owner.ownerStart),
      finiteNumber(selection.focus?.offset, owner.ownerStart)
    );
    const selectionEnd = Math.max(
      finiteNumber(selection.anchor?.offset, owner.ownerStart),
      finiteNumber(selection.focus?.offset, owner.ownerStart)
    );
    const crossesHiddenRange = selectionStart < owner.hiddenEndOffset
      && owner.hiddenStartOffset < selectionEnd;
    if (!logicalWholeBody
      && !inside(selection.anchor)
      && !inside(selection.focus)
      && !crossesHiddenRange) return false;
    const target = projectionPositionAtOffset(projection, owner.safeOffset, 'after')
      || projectionPositionAtOffset(projection, owner.ownerStart, 'after');
    if (!target) return false;
    const restored = projection.restoreSelection({ anchor: target, focus: target });
    if (restored) {
      markMarkdownEditHistorySelectionBoundary(state.editHistory, {
        sourceVersion: state.sourceVersion,
        anchor: target,
        focus: target
      });
    }
    return restored;
  }

  function toggleMarkdownStructuralFold(state, ownerKey, forceCollapsed = null) {
    const index = state?.markdownFoldIndex || reconcileMarkdownStructuralFoldState(state);
    const owner = index?.byKey?.get(String(ownerKey || ''));
    if (!owner?.foldable) return false;
    const collapsed = state.markdownFoldCollapsedKeys.has(owner.key);
    const nextCollapsed = forceCollapsed === null ? !collapsed : Boolean(forceCollapsed);
    if (nextCollapsed === collapsed) return false;
    if (nextCollapsed) {
      moveMarkdownSelectionBeforeFold(state, owner);
      clearMarkdownClipboardSelection({ state });
      state.markdownFoldCollapsedKeys.add(owner.key);
    } else state.markdownFoldCollapsedKeys.delete(owner.key);
    state.markdownFoldDescriptors = index.owners
      .filter((candidate) => state.markdownFoldCollapsedKeys.has(candidate.key))
      .map(markdownStructuralFoldDescriptor);
    notifyMarkdownStructuralFoldState(state);
    applyMarkdownStructuralFolding(state, { reconcile: false });
    updateDocumentExtent(state);
    return true;
  }

  function installMarkdownStructuralFoldTrigger(state, element, owner) {
    if (!element) return;
    element.dataset.markdownStructuralFoldOwnerKey = owner.key;
    element.dataset.markdownStructuralFoldTrigger = owner.kind;
    element.dataset.markdownSemanticControl = 'true';
    if (element.dataset.markdownStructuralFoldBound === 'true') return;
    element.dataset.markdownStructuralFoldBound = 'true';
    element.addEventListener('pointerdown', (event) => {
      if (state.mode !== 'reading') return;
      if (!element.dataset.markdownStructuralFoldOwnerKey) return;
      claimMarkdownStructuralFoldPointer(event);
    });
    element.addEventListener('click', (event) => {
      if (state.mode !== 'reading') return;
      if (!element.dataset.markdownStructuralFoldOwnerKey) return;
      if (!claimMarkdownStructuralFoldPointer(event)) return;
      toggleMarkdownStructuralFold(
        state,
        element.dataset.markdownStructuralFoldOwnerKey
      );
    });
  }

  function createMarkdownStructuralFoldControl(state, owner, collapsed) {
    const control = createElement(
      'button',
      'nav-folder-disclosure-button markdown-structural-fold-control'
    );
    control.type = 'button';
    control.contentEditable = 'false';
    control.dataset.markdownSemanticControl = 'true';
    control.dataset.markdownSemanticOnly = 'true';
    control.dataset.markdownStructuralFoldOwnerKey = owner.key;
    control.dataset.markdownStructuralFoldKind = owner.kind;
    control.dataset.markdownStructuralFoldCollapsed = String(collapsed);
    control.tabIndex = collapsed ? 0 : -1;
    control.setAttribute('aria-expanded', String(!collapsed));
    control.setAttribute(
      'aria-label',
      collapsed ? `Expand collapsed ${owner.kind}` : `Collapse expanded ${owner.kind}`
    );
    const disclosure = createElement(
      'span',
      'nav-folder-disclosure disclosure-chevron'
    );
    disclosure.setAttribute('aria-hidden', 'true');
    control.append(disclosure);
    control.addEventListener('pointerdown', (event) => {
      claimMarkdownStructuralFoldPointer(event);
    });
    control.addEventListener('mousedown', (event) => {
      claimMarkdownStructuralFoldPointer(event);
    });
    control.addEventListener('click', (event) => {
      if (!claimMarkdownStructuralFoldPointer(event)) return;
      toggleMarkdownStructuralFold(
        state,
        control.dataset.markdownStructuralFoldOwnerKey,
        !collapsed
      );
    });
    return control;
  }

  function readingMarkdownStructuralListMarkerCharacters(state, owner, item) {
    const canonicalLength = Math.max(1, owner.markerEnd - owner.markerStart);
    if (owner.listKind !== 'ordered' || item?.parentElement?.tagName !== 'OL') {
      return canonicalLength;
    }
    const indexedItem = state?.sourceSnapshot?.editableListSemanticIndex
      ?.astListItemForOwner?.(owner.astOwnerId);
    if (Number.isFinite(Number(indexedItem?.readingOrdinal))) {
      return Math.max(1, String(indexedItem.readingOrdinal).length + 1);
    }
    return canonicalLength;
  }

  function appendReadingMarkdownStructuralListMarkerTrigger(
    state,
    owner,
    item,
    markerCharacters = readingMarkdownStructuralListMarkerCharacters(state, owner, item)
  ) {
    const trigger = createElement(
      'span',
      'markdown-structural-reading-list-marker-trigger'
    );
    trigger.contentEditable = 'false';
    trigger.tabIndex = -1;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', 'Toggle list subtree');
    trigger.dataset.markdownSemanticOnly = 'true';
    trigger.style.setProperty(
      '--markdown-structural-marker-characters',
      String(markerCharacters)
    );
    installMarkdownStructuralFoldTrigger(state, trigger, owner);
    item.append(trigger);
    return trigger;
  }

  function alignEditableMarkdownStructuralListMarker(state, owner, row) {
    if (!state?.editableProjection || !row) return null;
    const activeTask = owner.task
      && row.classList?.contains('is-editable-list-row-active');
    if (owner.listKind !== 'ordered' && !activeTask) return null;
    const markerPosition = projectionPositionAtOffset(
      state.editableProjection,
      owner.markerStart,
      'after'
    );
    const markerRect = markerPosition && (
      state.editableProjection.collapsedPositionRect?.(markerPosition)
      || state.editableProjection.positionRect?.(markerPosition)
    );
    const rowRect = row.getBoundingClientRect?.();
    const presentationScale = Math.max(0.05, finiteNumber(state.zoom, 1));
    const inline = (
      Number(markerRect?.left) - Number(rowRect?.left)
    ) / presentationScale;
    if (!Number.isFinite(inline)) return null;
    row.style?.setProperty?.(
      '--markdown-structural-fold-anchor-inline',
      `${inline}px`
    );
    return inline;
  }

  function refreshMarkdownStructuralFoldGeometry(state) {
    if (!state?.editableProjection || state.mode === 'reading') return false;
    const index = state.markdownFoldIndex;
    if (!index) return false;
    let refreshed = false;
    index.foldableOwners.forEach((owner) => {
      const element = editableMarkdownStructuralOwnerElement(state, owner);
      if (!element) return;
      if (owner.kind === 'list') {
        refreshed = alignEditableMarkdownStructuralListMarker(state, owner, element) !== null
          || refreshed;
        return;
      }
      const line = state.sourceSnapshot?.physicalLineIndex?.lines?.[owner.lineIndex];
      if (line && owner.ownerStart > line.start) {
        editableMarkdownHeadingFoldControlHost(state, owner, element);
        refreshed = true;
      }
    });
    reconcileEditableQuoteRailOverlay(state);
    return refreshed;
  }

  function scheduleMarkdownStructuralFoldGeometryRefresh() {
    if (markdownStructuralGeometryFrame) return;
    const refresh = () => {
      markdownStructuralGeometryFrame = 0;
      liveStates.forEach((state) => refreshMarkdownStructuralFoldGeometry(state));
    };
    if (typeof root.requestAnimationFrame === 'function') {
      markdownStructuralGeometryFrame = root.requestAnimationFrame(refresh);
    } else {
      markdownStructuralGeometryFrame = 1;
      Promise.resolve().then(refresh);
    }
  }

  function installMarkdownStructuralGeometryObserver() {
    const geometryDocument = typeof document === 'object'
      ? document
      : root?.document || null;
    if (!markdownStructuralGeometryObserver
      && typeof MutationObserver === 'function'
      && geometryDocument?.documentElement) {
      markdownStructuralGeometryObserver = new MutationObserver(
        scheduleMarkdownStructuralFoldGeometryRefresh
      );
      markdownStructuralGeometryObserver.observe(geometryDocument.documentElement, {
        attributes: true,
        attributeFilter: ['style']
      });
    }
    if (!markdownStructuralFontGeometryInstalled && geometryDocument?.fonts) {
      markdownStructuralFontGeometryInstalled = true;
      geometryDocument.fonts.addEventListener?.(
        'loadingdone',
        scheduleMarkdownStructuralFoldGeometryRefresh
      );
      geometryDocument.fonts.addEventListener?.(
        'loadingerror',
        scheduleMarkdownStructuralFoldGeometryRefresh
      );
      geometryDocument.fonts.ready?.then?.(
        scheduleMarkdownStructuralFoldGeometryRefresh,
        scheduleMarkdownStructuralFoldGeometryRefresh
      );
    }
  }

  function applyReadingMarkdownStructuralVisibility(state, visibility) {
    const candidates = state.bodyRoot?.querySelectorAll?.(
      '.markdown-page-live-block, [data-markdown-source-start][data-markdown-source-end]'
    ) || [];
    [...candidates].forEach((element) => {
      const indices = markdownElementLineIndices(state, element);
      if (indices.length && indices.every((index) => visibility.hiddenLineIndices.has(index))) {
        markMarkdownStructuralFoldHidden(element);
      }
    });
  }

  function applyMarkdownStructuralFolding(state, { reconcile = true } = {}) {
    if (!state?.bodyRoot || !state.sourceSnapshot) return null;
    clearMarkdownStructuralFoldDom(state.bodyRoot);
    const index = reconcile
      ? reconcileMarkdownStructuralFoldState(state)
      : state.markdownFoldIndex || reconcileMarkdownStructuralFoldState(state);
    const visibility = deriveMarkdownStructuralFoldVisibility(
      index,
      state.markdownFoldCollapsedKeys
    );
    state.markdownFoldVisibility = visibility;

    if (state.editableProjection) {
      state.editableProjection.enumeratePhysicalRows().forEach((entry) => {
        if (visibility.hiddenLineIndices.has(entry.index)) {
          markMarkdownStructuralFoldHidden(entry.element);
        }
      });
    } else applyReadingMarkdownStructuralVisibility(state, visibility);

    index.foldableOwners.forEach((owner) => {
      const element = state.editableProjection
        ? editableMarkdownStructuralOwnerElement(state, owner)
        : readingMarkdownStructuralOwnerElement(state, owner);
      if (!element) return;
      element.classList.add('markdown-structural-fold-owner');
      element.dataset.markdownStructuralFoldOwnerKey = owner.key;
      element.dataset.markdownStructuralFoldKind = owner.kind;
      const collapsed = state.markdownFoldCollapsedKeys.has(owner.key);
      element.classList.toggle('is-markdown-structural-fold-collapsed', collapsed);
      element.dataset.markdownStructuralFoldCollapsed = String(collapsed);

      if (owner.kind === 'list') {
        if (state.editableProjection) {
          alignEditableMarkdownStructuralListMarker(state, owner, element);
        }
        else {
          const markerCharacters = readingMarkdownStructuralListMarkerCharacters(
            state,
            owner,
            element
          );
          element.style.setProperty(
            '--markdown-structural-list-marker-characters',
            String(markerCharacters)
          );
          appendReadingMarkdownStructuralListMarkerTrigger(
            state,
            owner,
            element,
            markerCharacters
          );
        }
      } else if (state.mode === 'reading') {
        installMarkdownStructuralFoldTrigger(state, element, owner);
      }
      const controlHost = state.editableProjection && owner.kind === 'heading'
        ? editableMarkdownHeadingFoldControlHost(state, owner, element)
        : element;
      controlHost?.append(createMarkdownStructuralFoldControl(state, owner, collapsed));
    });
    reconcileEditableQuoteRailOverlay(state);
    return visibility;
  }

  function markdownStructuralVisiblePosition(state, position, direction = null) {
    if (!position || !state?.editableProjection
      || !['live-preview', 'source'].includes(state.mode)) return position;
    const visibility = state.markdownFoldVisibility;
    const lines = state.sourceSnapshot?.physicalLineIndex?.lines || [];
    const line = lines.find((candidate) => (
      String(candidate.id) === String(position.physicalLineId)
    ));
    if (!line || !visibility?.hiddenLineIndices?.has(line.index)) return position;
    const forward = direction === 'ArrowRight' || direction === 'ArrowDown';
    const backward = direction === 'ArrowLeft' || direction === 'ArrowUp';
    if (forward || backward) {
      const step = forward ? 1 : -1;
      for (let index = line.index + step; index >= 0 && index < lines.length; index += step) {
        if (visibility.hiddenLineIndices.has(index)) continue;
        const offset = forward ? lines[index].start : lines[index].contentEnd;
        const candidate = projectionPositionAtOffset(
          state.editableProjection,
          offset,
          forward ? 'after' : 'before'
        );
        if (candidate) return candidate;
      }
    }
    const owner = visibility.hiddenByLineIndex.get(line.index)?.find((candidate) => (
      !visibility.hiddenLineIndices.has(candidate.lineIndex)
    )) || visibility.hiddenByLineIndex.get(line.index)?.[0];
    if (owner && forward) {
      const ownerLine = lines[owner.endLineIndex] || lines[owner.lineIndex];
      const endPosition = ownerLine && projectionPositionAtOffset(
        state.editableProjection,
        ownerLine.contentEnd,
        'before'
      );
      if (endPosition) return endPosition;
    }
    return owner
      ? projectionPositionAtOffset(state.editableProjection, owner.safeOffset, 'after') || position
      : position;
  }

  function refreshEditableProjection(state) {
    const projection = state?.editableProjection;
    if (!projection || !state.sourceSnapshot) return null;
    state.linkArrowController.detach();
    clearEditablePresentationMountState(state);
    const plan = editablePresentationPlanForState(state);
    state.editablePresentationPlan = plan;
    const links = plan?.constructs?.links || [];
    const exposedAnchors = [];
    state.linkArrowDescriptorAtRange = (start, end) => {
      const matches = links.filter((link) => (
        Number(link.start) === Number(start)
        && Number(link.end) === Number(end)
      ));
      if (matches.length > 1) {
        throw new TypeError('A whole Markdown range identifies more than one logical link.');
      }
      return matches[0] || null;
    };
    state.linkArrowAnchorSink = (anchor) => exposedAnchors.push(anchor);
    try {
      projection.render(state.sourceSnapshot, {
        mode: state.mode,
        ...(plan ? { presentationPlan: plan } : {})
      });
      decorateEditablePhysicalRows(state);
      const leaves = mountEditableSyntaxPresentations(state);
      const anchors = collectEditableLinkArrowAnchors(
        state,
        plan,
        leaves,
        exposedAnchors
      );
      state.linkArrowController.reconcile({
        state,
        mode: state.mode,
        links,
        anchors
      });
      applyMarkdownStructuralFolding(state);
    } catch (error) {
      state.linkArrowController.detach();
      throw error;
    } finally {
      state.linkArrowAnchorSink = null;
      state.linkArrowDescriptorAtRange = null;
    }
    return projection;
  }

  function editableIdSetsEqual(left, right) {
    const leftSet = left || new Set();
    const rightSet = right || new Set();
    return leftSet.size === rightSet.size
      && [...leftSet].every((value) => rightSet.has(value));
  }

  function editableSelectionPositions(state, selection) {
    const projection = state?.editableProjection;
    if (!projection || !selection) return null;
    const endpoint = (value, explicitPosition, affinity) => {
      const candidate = explicitPosition || (value && typeof value === 'object' ? value : null);
      if (candidate && candidate.sourceVersion === state.sourceVersion) {
        const exact = projectionPositionAtOffset(
          projection,
          candidate.offset,
          candidate.affinity || affinity || null
        );
        if (exact) return exact;
      }
      const offset = candidate?.offset ?? value;
      return projectionPositionAtOffset(projection, offset, candidate?.affinity || affinity || null);
    };
    const anchor = endpoint(
      selection.anchor,
      selection.anchorPosition,
      selection.anchorAffinity
    );
    const focus = endpoint(
      selection.focus,
      selection.focusPosition,
      selection.focusAffinity
    );
    return anchor && focus ? { anchor, focus } : null;
  }

  function editableSelectionIntersects(start, end, anchorOffset, focusOffset) {
    const selectionStart = Math.min(anchorOffset, focusOffset);
    const selectionEnd = Math.max(anchorOffset, focusOffset);
    if (selectionStart === selectionEnd) return start <= selectionStart && selectionStart <= end;
    return start < selectionEnd && end > selectionStart;
  }

  function editableActiveStateForSelection(state, selection) {
    const positions = editableSelectionPositions(state, selection);
    const plan = state?.editablePresentationPlan;
    const ownerIds = new Set();
    const lineIds = new Set();
    if (!positions || !plan || state.mode !== 'live-preview') {
      return { ownerIds, lineIds, positions };
    }
    const anchorOffset = positions.anchor.offset;
    const focusOffset = positions.focus.offset;
    const selectionStart = Math.min(anchorOffset, focusOffset);
    const selectionEnd = Math.max(anchorOffset, focusOffset);
    const activeTableCell = (plan.constructs.tables || []).flatMap((table) => (
      table.cells.filter((cell) => (
        cell.canonical
          && editableTableCellDescriptorMatches(state.editableActiveTableCell, table, cell)
      ))
    ))[0] || null;
    state.sourceSnapshot.physicalLineIndex.lines.forEach((line) => {
      const selected = selectionStart === selectionEnd
        ? line.start <= selectionStart && selectionStart <= line.contentEnd
        : line.start < selectionEnd && line.sourceEnd > selectionStart;
      if (selected && plan.lines.find((entry) => (
        entry.physicalLineId === line.id
      ))?.metadata?.quote) lineIds.add(String(line.id));
    });
    [
      ...editableSimplePresentationConstructs(plan),
      ...(plan.constructs.listRows || []),
      ...(plan.constructs.underlines || []),
      ...plan.constructs.links,
      ...plan.constructs.math
    ].forEach((construct) => {
      if (activeTableCell
        && activeTableCell.start <= construct.start
        && construct.end <= activeTableCell.end) return;
      if (editableSelectionIntersects(
        construct.start,
        construct.end,
        anchorOffset,
        focusOffset
      )) ownerIds.add(String(construct.activationOwnerId || construct.ownerId));
    });
    return { ownerIds, lineIds, positions };
  }

  function editableVisibleTableCellPosition(state, position, direction = null) {
    if (!position || state?.mode !== 'live-preview') return position;
    const table = state.editablePresentationPlan?.constructs?.tables?.find((candidate) => (
      !candidate.invalid
      && candidate.start <= position.offset
      && position.offset <= candidate.end
    ));
    if (!table) return position;
    let projection = state.editableProjection;
    const activate = (candidate, cell = null) => {
      const changed = cell
        ? installEditableActiveTableCell(state, table, cell)
        : Boolean(state.editableActiveTableCell);
      if (!cell && changed) state.editableActiveTableCell = null;
      if (changed && state.bodyRoot) {
        refreshEditableProjection(state);
        projection = state.editableProjection;
      }
      const remapped = projectionPositionAtOffset(
        projection,
        candidate.offset,
        candidate.affinity
      ) || candidate;
      return cell ? {
        ...remapped,
        semanticOwnerId: state.editablePresentationPlan.constructs.tables.find((entry) => (
          entry.start === table.start
        ))?.ownerId || table.ownerId,
        visibility: 'visible',
        interactionPolicy: 'editable-table-cell'
      } : remapped;
    };
    const directCell = table.cells.find((cell) => {
      if (!cell.canonical) return false;
      const range = editableTableCellDescriptorMatches(
        state.editableActiveTableCell,
        table,
        cell
      ) ? editableTableCellEffectiveRange(state, table, cell) : cell;
      return range.start <= position.offset && position.offset <= range.end;
    });
    const directCellIsActive = editableTableCellDescriptorMatches(
      state.editableActiveTableCell,
      table,
      directCell
    );
    if (directCell && (directCellIsActive || (
      position.visibility === 'visible'
      && position.interactionPolicy === 'editable-table-cell'
    ))) {
      return activate(position, directCell);
    }
    const candidates = table.cells.filter((cell) => cell.canonical).flatMap((cell) => (
      [...new Set(Object.values(
        editableTableCellDescriptorMatches(state.editableActiveTableCell, table, cell)
          ? editableTableCellEffectiveRange(state, table, cell)
          : { start: cell.start, end: cell.end }
      ))].map((offset) => {
        const candidate = projectionPositionAtOffset(projection, offset, 'after');
        return candidate ? {
          position: candidate,
          cell
        } : null;
      }).filter(Boolean)
    ));
    if (!candidates.length) return position;
    const forward = direction === 'ArrowRight' || direction === 'ArrowDown';
    const backward = direction === 'ArrowLeft' || direction === 'ArrowUp';
    const ordered = candidates.sort((left, right) => (
      left.position.offset - right.position.offset
    ));
    if (forward) {
      const inTable = ordered.find((candidate) => (
        candidate.position.offset >= position.offset
      ));
      if (inTable) return activate(inTable.position, inTable.cell);
      const afterTable = projection.enumerateDeclaredPositions().find((candidate) => (
        candidate.offset > table.end
        && candidate.visibility === 'visible'
        && !String(candidate.interactionPolicy || '').startsWith('activate-')
      ));
      return afterTable
        ? activate(afterTable)
        : activate(ordered.at(-1).position, ordered.at(-1).cell);
    }
    if (backward) {
      const inTable = [...ordered].reverse().find((candidate) => (
        candidate.position.offset <= position.offset
      ));
      if (inTable) return activate(inTable.position, inTable.cell);
      const beforeTable = [...projection.enumerateDeclaredPositions()].reverse()
        .find((candidate) => (
          candidate.offset < table.start
          && candidate.visibility === 'visible'
          && !String(candidate.interactionPolicy || '').startsWith('activate-')
        ));
      return beforeTable
        ? activate(beforeTable)
        : activate(ordered[0].position, ordered[0].cell);
    }
    const nearest = ordered.sort((left, right) => (
      Math.abs(left.position.offset - position.offset)
        - Math.abs(right.position.offset - position.offset)
      || left.position.offset - right.position.offset
    ))[0];
    return activate(nearest.position, nearest.cell);
  }

  function editableTableCellEditContext(state, selection) {
    if (!state?.editableProjection || state.mode !== 'live-preview') return null;
    const positions = editableSelectionPositions(state, selection);
    const tables = state.editablePresentationPlan?.constructs?.tables || [];
    if (!positions || !tables.length) return null;
    const endpoint = (position) => {
      const table = tables.find((candidate) => (
        !candidate.invalid
        && !candidate.activeRaw
        && candidate.start <= position.offset
        && position.offset <= candidate.end
      ));
      if (!table) return null;
      const activeCell = table.cells.find((candidate) => (
        candidate.canonical
        && editableTableCellDescriptorMatches(
          state.editableActiveTableCell,
          table,
          candidate
        )
        && (() => {
          const range = editableTableCellEffectiveRange(state, table, candidate);
          return range.start <= position.offset && position.offset <= range.end;
        })()
      )) || null;
      const cell = activeCell || table.cells.find((candidate) => (
        candidate.canonical
        && candidate.start <= position.offset
        && position.offset <= candidate.end
      )) || null;
      return { table, cell, position };
    };
    const anchor = endpoint(positions.anchor);
    const focus = endpoint(positions.focus);
    if (!anchor && !focus) return null;
    const sameCell = Boolean(anchor?.cell && focus?.cell
      && String(anchor.table.ownerId) === String(focus.table.ownerId)
      && anchor.cell.header === focus.cell.header
      && anchor.cell.rowIndex === focus.cell.rowIndex
      && anchor.cell.columnIndex === focus.cell.columnIndex);
    return {
      handled: true,
      blocked: !sameCell,
      table: sameCell ? anchor.table : anchor?.table || focus?.table || null,
      cell: sameCell ? anchor.cell : null,
      selection: numericProjectionSelection(positions)
    };
  }

  function installEditableActiveState(state, ownerIds, lineIds) {
    const nextOwners = new Set([...ownerIds].map(String));
    const nextLines = new Set([...lineIds].map(String));
    const changed = !editableIdSetsEqual(state.editableActiveOwnerIds, nextOwners)
      || !editableIdSetsEqual(state.editableActiveLineIds, nextLines);
    if (!changed) return false;
    state.editableActiveOwnerIds = nextOwners;
    state.editableActiveLineIds = nextLines;
    return true;
  }

  function clearEditableLiveActiveState(state, { refresh = true } = {}) {
    if (!state) return false;
    const tableChanged = Boolean(state.editableActiveTableCell);
    if (tableChanged) state.editableActiveTableCell = null;
    const changed = installEditableActiveState(state, new Set(), new Set())
      || tableChanged;
    if (changed && refresh && state.mode === 'live-preview' && state.editableProjection) {
      refreshEditableProjection(state);
    }
    return changed;
  }

  function remapEditableSelection(state, selection) {
    return editableSelectionPositions(state, selection);
  }

  function ensureEditableSelectionVisible(state, selection, options = {}) {
    const current = editableSelectionPositions(state, selection);
    const plan = state?.editablePresentationPlan;
    if (!current || !plan) return current;
    const structurallyVisible = {
      anchor: markdownStructuralVisiblePosition(
        state,
        current.anchor,
        options.direction
      ),
      focus: markdownStructuralVisiblePosition(
        state,
        current.focus,
        options.direction
      )
    };
    if (state.mode !== 'live-preview') return structurallyVisible;
    const visibleCurrent = {
      anchor: editableVisibleTableCellPosition(
        state,
        structurallyVisible.anchor,
        options.direction
      ),
      focus: editableVisibleTableCellPosition(
        state,
        structurallyVisible.focus,
        options.direction
      )
    };
    const ownerIds = new Set(state.editableActiveOwnerIds || []);
    const lineIds = new Set(state.editableActiveLineIds || []);
    [visibleCurrent.anchor, visibleCurrent.focus].forEach((position) => {
      const requiresActivation = position.visibility !== 'visible'
        || String(position.interactionPolicy || '').startsWith('activate-');
      if (!requiresActivation) return;
      const planLine = plan.lines.find((line) => line.physicalLineId === position.physicalLineId);
      if (planLine?.metadata?.quote) lineIds.add(String(position.physicalLineId));
      [
        ...editableSimplePresentationConstructs(plan),
        ...(plan.constructs.listRows || []),
        ...(plan.constructs.underlines || []),
        ...plan.constructs.links,
        ...plan.constructs.math
      ]
        .filter((construct) => construct.start <= position.offset && position.offset <= construct.end)
        .forEach((construct) => ownerIds.add(String(
          construct.activationOwnerId || construct.ownerId
        )));
    });
    if (!installEditableActiveState(state, ownerIds, lineIds)) return visibleCurrent;
    refreshEditableProjection(state);
    return remapEditableSelection(state, visibleCurrent);
  }

  function renderEditableDocumentBlocks(state, bodyRoot) {
    if (!editableProjectionRuntime?.createEditableProjection) {
      throw new Error('The Markdown EditableProjectionIndex is unavailable.');
    }
    const snapshot = installSourceSnapshot(state, state.body);
    if (state.mode !== 'live-preview') {
      state.editableActiveOwnerIds = new Set();
      state.editableActiveLineIds = new Set();
      state.editableForcedRawOwnerIds = new Set();
      state.editableActiveTableCell = null;
    }
    state.editableActiveOwnerIds ||= new Set();
    state.editableActiveLineIds ||= new Set();
    state.editableForcedRawOwnerIds ||= new Set();
    state.editableActiveTableCell ||= null;
    const projection = editableProjectionRuntime.createEditableProjection({
      root: bodyRoot,
      document,
      foundation: editableFoundation,
      mode: state.mode
    });
    state.editableProjection = projection;
    editableProjectionRoots.set(bodyRoot, projection);
    editableStateRoots.set(bodyRoot, state);
    state.semanticBlocks = [];
    refreshEditableProjection(state);
    return projection;
  }

  function exactSemanticTextInsertion(event) {
    if (!event || event.isComposing || event.cancelable === false
      || !['insertText', 'insertReplacementText'].includes(event.inputType)
      || typeof event.data !== 'string') return null;
    // Own trusted text input before Chromium mutates the rendered DOM. Native
    // contenteditable insertion can consume a hidden structural newline or
    // indentation owner when the canonical caret sits at a visual boundary.
    // Paste, drop, replacement, and composition keep their dedicated paths.
    return event.data;
  }

  function notifySemanticBodyInput(state) {
    invoke(state.onBodyInput, {
      paneId: state.paneId,
      pageId: state.page?.id || state.page?.pageId || null,
      markdownBody: state.body,
      commit: false,
      page: state.page,
      mode: state.mode
    });
  }

  function captureSemanticSelection(root) {
    const projection = editableProjectionForRoot(root);
    return projection ? numericProjectionSelection(projection.getSelection()) : null;
  }

  function normalizedMarkdownSelectionRange(sourceLength, selection = {}) {
    const length = Math.max(0, finiteNumber(sourceLength, 0));
    if (selection.kind === 'whole-body') return { start: 0, end: length };
    const anchor = clamp(finiteNumber(selection.anchor, 0), 0, length);
    const focus = clamp(finiteNumber(selection.focus, anchor), 0, length);
    return {
      start: Math.min(anchor, focus),
      end: Math.max(anchor, focus)
    };
  }

  function canonicalMarkdownSelectionText(source, selection = {}) {
    const canonical = typeof source === 'string' ? source : String(source || '');
    const range = normalizedMarkdownSelectionRange(canonical.length, selection);
    return canonical.slice(range.start, range.end);
  }

  function normalizedMarkdownEditSelection(source, selection = null, fallbackOffset = null) {
    const canonical = typeof source === 'string' ? source : String(source || '');
    const fallback = clamp(
      finiteNumber(fallbackOffset, canonical.length),
      0,
      canonical.length
    );
    const affinity = (position, explicit) => (
      position?.affinity === 'before' || explicit === 'before' ? 'before' : 'after'
    );
    return {
      anchor: clamp(finiteNumber(selection?.anchor, fallback), 0, canonical.length),
      focus: clamp(finiteNumber(selection?.focus, fallback), 0, canonical.length),
      anchorAffinity: affinity(selection?.anchorPosition, selection?.anchorAffinity),
      focusAffinity: affinity(selection?.focusPosition, selection?.focusAffinity)
    };
  }

  const MARKDOWN_AUTO_PAIR_CHARACTERS = new Set(['*', '`']);

  function markdownAutoPairOpeningBoundary(character) {
    return !character || /\s/u.test(character);
  }

  function markdownAutoPairClosingBoundary(character, marker) {
    return !character || /\s/u.test(character) || character === marker;
  }

  function markdownTextInsertionEdit(source, selection, text) {
    const canonical = typeof source === 'string' ? source : String(source || '');
    const original = normalizedMarkdownEditSelection(canonical, selection, 0);
    const start = Math.min(original.anchor, original.focus);
    const end = Math.max(original.anchor, original.focus);
    const inserted = typeof text === 'string' ? text : String(text || '');
    const overtypedCloser = start === end
      && inserted.length === 1
      && MARKDOWN_AUTO_PAIR_CHARACTERS.has(inserted)
      && canonical[start] === inserted
      && canonical[start + 1] === inserted;
    if (overtypedCloser) {
      return {
        changed: true,
        source: canonical,
        start,
        end,
        replacement: '',
        selection: { anchor: start + 1, focus: start + 1 },
        autoPaired: false,
        overtypedCloser: true
      };
    }
    const autoPaired = start === end
      && inserted.length === 1
      && MARKDOWN_AUTO_PAIR_CHARACTERS.has(inserted)
      && markdownAutoPairOpeningBoundary(canonical[start - 1] || '')
      && markdownAutoPairClosingBoundary(canonical[start] || '', inserted);
    const replacement = autoPaired ? `${inserted}${inserted}` : inserted;
    const caret = start + inserted.length;
    return {
      changed: start !== end || replacement.length > 0,
      source: `${canonical.slice(0, start)}${replacement}${canonical.slice(end)}`,
      start,
      end,
      replacement,
      selection: { anchor: caret, focus: caret },
      autoPaired
    };
  }

  function escapedEditableTableCellInput(prefix, value, {
    normalizeLineBreaks = false
  } = {}) {
    const input = String(value ?? '');
    if (!normalizeLineBreaks && /[\r\n]/.test(input)) return null;
    const normalized = normalizeLineBreaks
      ? input.replace(/\r\n|\r|\n/g, ' ')
      : input;
    const trailingSlashes = String(prefix || '').match(/\\+$/)?.[0]?.length || 0;
    let slashRun = trailingSlashes;
    let escaped = '';
    for (const character of normalized) {
      if (character === '|') {
        if (slashRun % 2 === 0) escaped += '\\';
        escaped += character;
        slashRun = 0;
        continue;
      }
      escaped += character;
      slashRun = character === '\\' ? slashRun + 1 : 0;
    }
    return escaped;
  }

  function editableTableCellShapePreserved(
    state,
    context,
    nextSource,
    expectedEffectiveSource,
    nextEffectiveRange
  ) {
    if (!context?.table || !context?.cell
      || typeof model?.parseMarkdownTableStructure !== 'function') return null;
    const parsed = model.parseMarkdownTableStructure(nextSource, context.table.start);
    const sourceDelta = nextSource.length - state.body.length;
    if (!parsed
      || parsed.start !== context.table.start
      || parsed.end !== context.table.end + sourceDelta
      || parsed.columnCount !== context.table.columnCount
      || parsed.header.length !== context.table.header.length
      || parsed.rows.length !== context.table.rows.length
      || parsed.lineEnding !== context.table.lineEnding
      || parsed.continuationPrefix !== context.table.continuationPrefix
      || parsed.alignments.some((alignment, index) => (
        alignment !== context.table.alignments[index]
      ))
      || parsed.rows.some((row, index) => (
        row.length !== (context.table.rows[index]?.length || 0)
      ))) return null;
    const parsedCell = context.cell.header
      ? parsed.header[context.cell.columnIndex]
      : parsed.rows[context.cell.rowIndex]?.[context.cell.columnIndex];
    const slot = editableTableCellSlotRange(nextSource, parsedCell);
    if (!parsedCell || !slot || !nextEffectiveRange
      || nextEffectiveRange.start < slot.start
      || nextEffectiveRange.end > slot.end
      || nextEffectiveRange.start > nextEffectiveRange.end
      || nextSource.slice(nextEffectiveRange.start, nextEffectiveRange.end)
        !== expectedEffectiveSource
      || (parsedCell.source === ''
        ? !/^[ \t]*$/.test(expectedEffectiveSource)
        : parsedCell.start < nextEffectiveRange.start
          || parsedCell.end > nextEffectiveRange.end)) return null;
    const unchanged = (cell, header, rowIndex, columnIndex) => {
      if (header === context.cell.header
        && rowIndex === context.cell.rowIndex
        && columnIndex === context.cell.columnIndex) return true;
      const previous = header
        ? context.table.header[columnIndex]
        : context.table.rows[rowIndex]?.[columnIndex];
      return Boolean(previous && cell.source === previous.source);
    };
    const othersUnchanged = parsed.header.every((cell, columnIndex) => (
      unchanged(cell, true, -1, columnIndex)
    )) && parsed.rows.every((row, rowIndex) => row.every((cell, columnIndex) => (
      unchanged(cell, false, rowIndex, columnIndex)
    )));
    return othersUnchanged ? { parsed, parsedCell } : null;
  }

  function recordEditableTableCompositionDiagnostic(state, update = {}) {
    const bodyRoot = state?.bodyRoot;
    if (!bodyRoot?.dataset) return;
    let current = {};
    try {
      current = JSON.parse(bodyRoot.dataset.markdownTableCompositionDiagnostic || '{}');
    } catch (_error) {
      current = {};
    }
    bodyRoot.dataset.markdownTableCompositionDiagnostic = JSON.stringify({
      ...current,
      ...update
    });
  }

  function restoreEditableTableCellCompositionDom(state, context) {
    const projection = state?.editableProjection;
    const presentations = state?.editableTablePresentations;
    const table = context?.table;
    const cell = context?.cell;
    const presentation = presentations instanceof Map && table
      ? presentations.get(editableTablePresentationKey(table))
      : null;
    const record = presentation?.cells?.get(editableTableCellKey(cell)) || null;
    const descriptor = editableTableCellDescriptor(table, cell);
    const reject = (reason) => {
      recordEditableTableCompositionDiagnostic(state, {
        helperReturned: false,
        helperReason: reason,
        descriptor,
        activeDescriptor: state?.editableActiveTableCell || null,
        recordTagName: record?.element?.tagName || null,
        recordClassName: record?.element?.className || null,
        recordConnected: Boolean(record?.element?.isConnected),
        recordIsActiveElement: document.activeElement === record?.element,
        emptyHostConnected: Boolean(record?.emptyHost?.isConnected),
        endHostConnected: Boolean(record?.endHost?.isConnected)
      });
      return false;
    };
    if (!projection) return reject('projection-unavailable');
    if (!(presentations instanceof Map)) return reject('presentation-map-unavailable');
    if (!table) return reject('table-unavailable');
    if (!cell) return reject('cell-unavailable');
    if (!presentation) return reject('presentation-unavailable');
    if (!record?.element) return reject('cell-record-unavailable');
    if (!editableTableCellDescriptorMatches(
      state.editableActiveTableCell,
      table,
      cell
    )) return reject('active-descriptor-mismatch');
    if (!state.bodyRoot?.contains?.(record.element)) return reject('cell-record-disconnected');

    const cellLeaves = projection.enumerateProjectedLeaves().filter((leaf) => (
      leaf.kind === 'table-cell'
      && leaf.semanticOwnerId === table.ownerId
      && cell.start <= leaf.sourceStart
      && leaf.sourceEnd <= cell.end
    ));
    if (cell.start === cell.end) {
      if (cellLeaves.length !== 0) return reject('empty-cell-has-projected-leaves');
      if (!record.emptyHost) return reject('empty-cell-host-unavailable');
      record.emptyHost.textContent = '\u200b';
      record.element.replaceChildren(record.emptyHost);
      if (record.emptyHost.parentNode !== record.element) {
        return reject('empty-cell-host-restore-failed');
      }
      recordEditableTableCompositionDiagnostic(state, {
        helperReturned: true,
        helperReason: 'restored-empty-cell',
        descriptor,
        activeDescriptor: state.editableActiveTableCell,
        recordTagName: record.element.tagName,
        recordClassName: record.element.className,
        recordConnected: Boolean(record.element.isConnected),
        recordIsActiveElement: document.activeElement === record.element,
        emptyHostConnected: Boolean(record.emptyHost.isConnected),
        endHostConnected: false,
        projectedLeafCount: 0
      });
      return true;
    }
    if (cellLeaves.length === 0) return reject('nonempty-cell-has-no-projected-leaves');
    if (!record.endHost) return reject('nonempty-cell-end-host-unavailable');
    for (const leaf of cellLeaves) {
      if (!leaf?.element || !leaf?.textNode || typeof leaf.text !== 'string') {
        return reject('projected-leaf-record-invalid');
      }
      leaf.textNode.nodeValue = leaf.text;
      if (leaf.textNode.parentNode !== leaf.element
        || leaf.element.childNodes.length !== 1) {
        leaf.element.replaceChildren(leaf.textNode);
      }
    }
    record.endHost.textContent = '\u200b';
    record.element.replaceChildren(
      ...cellLeaves.map((leaf) => leaf.element),
      record.endHost
    );
    if (!cellLeaves.every((leaf) => leaf.element.parentNode === record.element)) {
      return reject('projected-leaf-restore-failed');
    }
    if (record.endHost.parentNode !== record.element) {
      return reject('end-host-restore-failed');
    }
    recordEditableTableCompositionDiagnostic(state, {
      helperReturned: true,
      helperReason: 'restored-nonempty-cell',
      descriptor,
      activeDescriptor: state.editableActiveTableCell,
      recordTagName: record.element.tagName,
      recordClassName: record.element.className,
      recordConnected: Boolean(record.element.isConnected),
      recordIsActiveElement: document.activeElement === record.element,
      emptyHostConnected: false,
      endHostConnected: Boolean(record.endHost.isConnected),
      projectedLeafCount: cellLeaves.length
    });
    return true;
  }

  function replaceEditableTableCellRange(state, context, start, end, replacement, options = {}) {
    if (!context?.handled) return null;
    if (context.blocked || !context.cell) return { handled: true, changed: false };
    const safeStart = Math.min(start, end);
    const safeEnd = Math.max(start, end);
    const effectiveRange = editableTableCellEffectiveRange(
      state,
      context.table,
      context.cell
    );
    if (safeStart < effectiveRange.start || safeEnd > effectiveRange.end) {
      return { handled: true, changed: false };
    }
    const inserted = String(replacement ?? '');
    const effectiveSource = state.body.slice(effectiveRange.start, effectiveRange.end);
    const cellStart = safeStart - effectiveRange.start;
    const cellEnd = safeEnd - effectiveRange.start;
    const expectedEffectiveSource = `${effectiveSource.slice(0, cellStart)}`
      + `${inserted}${effectiveSource.slice(cellEnd)}`;
    const nextEffectiveRange = {
      start: effectiveRange.start,
      end: effectiveRange.end + inserted.length - (safeEnd - safeStart)
    };
    const nextSource = `${state.body.slice(0, safeStart)}${inserted}${state.body.slice(safeEnd)}`;
    const shape = editableTableCellShapePreserved(
      state,
      context,
      nextSource,
      expectedEffectiveSource,
      nextEffectiveRange
    );
    if (!shape) {
      return { handled: true, changed: false };
    }
    replaceSemanticSourceRange(state, safeStart, safeEnd, inserted, {
      ...options,
      tableReconciliation: {
        ...editableTableCellDescriptor(context.table, context.cell),
        expectedCellSource: shape.parsedCell.source,
        previousEffectiveStart: effectiveRange.start,
        previousEffectiveEnd: effectiveRange.end,
        nextEffectiveStart: nextEffectiveRange.start,
        nextEffectiveEnd: nextEffectiveRange.end
      }
    });
    return {
      handled: true,
      changed: safeStart !== safeEnd || inserted.length > 0,
      caret: options.afterSelection?.focus ?? safeStart + inserted.length,
      replacement: inserted,
      reconciled: Boolean(state.editableTableReconciliationDiagnostics)
    };
  }

  function applyEditableTableCellTextInput(state, selection, text, {
    inputType = 'insertText',
    timestamp = null,
    normalizeLineBreaks = false,
    recordHistory = true,
    coalesceHistory = true,
    restoreSelection = true,
    transactionMetadata = null
  } = {}) {
    const context = editableTableCellEditContext(state, selection);
    if (!context) return null;
    if (context.blocked) return { handled: true, changed: false };
    if (transactionMetadata?.commandKind === 'composition') {
      const helperReturned = restoreEditableTableCellCompositionDom(state, context);
      recordEditableTableCompositionDiagnostic(state, { helperReturned });
    }
    const normalized = normalizedMarkdownEditSelection(state.body, context.selection, 0);
    const start = Math.min(normalized.anchor, normalized.focus);
    const effectiveRange = editableTableCellEffectiveRange(
      state,
      context.table,
      context.cell
    );
    const safeText = escapedEditableTableCellInput(
      state.body.slice(effectiveRange.start, start),
      text,
      { normalizeLineBreaks }
    );
    if (safeText == null) return { handled: true, changed: false };
    const insertion = markdownTextInsertionEdit(state.body, context.selection, safeText);
    return replaceEditableTableCellRange(
      state,
      context,
      insertion.start,
      insertion.end,
      insertion.replacement,
      {
        afterSelection: insertion.selection,
        beforeSelection: context.selection,
        inputType,
        timestamp,
        recordHistory,
        coalesceHistory,
        restoreSelection,
        transactionMetadata: {
          commandKind: 'table-cell-input',
          ...(transactionMetadata && typeof transactionMetadata === 'object'
            ? transactionMetadata
            : {})
        }
      }
    );
  }

  function applyEditableTableCellDeletion(state, direction, selection = null) {
    const beforeSelection = selection || captureSemanticSelection(state?.bodyRoot);
    const context = editableTableCellEditContext(state, beforeSelection);
    if (!context) return false;
    if (context.blocked || typeof editableFoundation?.applyExactDeletion !== 'function') return true;
    const result = exactMarkdownDeletionResult(state, context.selection, direction);
    if (!result?.changed || result.source === state.body) return true;
    const preparedEdit = singlePreparedCanonicalEdit(result, state.body.length);
    const difference = preparedEdit || sourceDifference(state.body, result.source);
    replaceEditableTableCellRange(
      state,
      context,
      difference.start,
      preparedEdit ? difference.end : difference.previousEnd,
      preparedEdit
        ? difference.replacement
        : result.source.slice(difference.start, difference.nextEnd),
      {
        afterSelection: result.selection,
        beforeSelection: context.selection,
        canonicalResult: preparedEdit ? result : null,
        canonicalResultTransactionKind: 'exact-deletion',
        inputType: direction === 'forward'
          ? 'deleteContentForward'
          : 'deleteContentBackward',
        transactionMetadata: {
          commandKind: 'table-cell-deletion',
          primaryEdit: result.primaryEdits || null,
          renumberEdits: result.renumberEdits || [],
          affectedLineIds: result.affectedPhysicalLineIds || []
        }
      }
    );
    return true;
  }

  function applyEditableTableCellTabNavigation(state, reverse = false) {
    const context = editableTableCellEditContext(
      state,
      captureSemanticSelection(state?.bodyRoot)
    );
    if (!context) return false;
    if (context.blocked || !context.cell) return true;
    const cells = context.table.cells.filter((cell) => cell.canonical);
    const currentIndex = cells.findIndex((cell) => (
      cell.header === context.cell.header
      && cell.rowIndex === context.cell.rowIndex
      && cell.columnIndex === context.cell.columnIndex
    ));
    const target = cells[currentIndex + (reverse ? -1 : 1)] || null;
    if (!target) return true;
    const position = editableVisibleTableCellPosition(
      state,
      projectionPositionAtOffset(state.editableProjection, target.start, 'after')
    );
    if (!position) return true;
    state.editableProjection.restoreSelection({ anchor: position, focus: position });
    markMarkdownEditHistorySelectionBoundary(
      state.editHistory,
      numericProjectionSelection({ anchor: position, focus: position })
    );
    updateLiveMarkerVisibility(state);
    return true;
  }

  const MARKDOWN_FORMAT_MARKERS = Object.freeze({
    bold: Object.freeze({ open: '**', close: '**' }),
    italic: Object.freeze({ open: '*', close: '*' }),
    underline: Object.freeze({ open: '<u>', close: '</u>' })
  });

  function orientedMarkdownSelection(original, start, end) {
    if (original.anchor > original.focus) return { anchor: end, focus: start };
    return { anchor: start, focus: end };
  }

  function toggleMarkdownFormatting(source, selection, kind) {
    const canonical = typeof source === 'string' ? source : String(source || '');
    const original = normalizedMarkdownEditSelection(canonical, selection, 0);
    const range = normalizedMarkdownSelectionRange(canonical.length, original);
    const markers = MARKDOWN_FORMAT_MARKERS[kind];
    if (!markers) return { source: canonical, selection: original };
    const { open, close } = markers;
    const selected = canonical.slice(range.start, range.end);
    const outsideStart = range.start - open.length;
    let exactlyWrappedOutside = outsideStart >= 0
      && canonical.slice(outsideStart, range.start) === open
      && canonical.slice(range.end, range.end + close.length) === close;
    if (kind === 'italic' && exactlyWrappedOutside) {
      let openingRun = 0;
      for (let index = range.start - 1; index >= 0 && canonical[index] === '*'; index -= 1) {
        openingRun += 1;
      }
      let closingRun = 0;
      for (let index = range.end; index < canonical.length && canonical[index] === '*'; index += 1) {
        closingRun += 1;
      }
      // Two surrounding stars are one bold construct, not an italic pair.
      // A single star is italic; three stars are bold+italic and removing the
      // innermost star correctly leaves bold behind.
      exactlyWrappedOutside = openingRun !== 2 && closingRun !== 2;
    }
    if (exactlyWrappedOutside) {
      const nextSource = `${canonical.slice(0, outsideStart)}${selected}`
        + canonical.slice(range.end + close.length);
      return {
        source: nextSource,
        selection: orientedMarkdownSelection(
          original,
          outsideStart,
          outsideStart + selected.length
        )
      };
    }
    const selectedIncludesMarkers = selected.length >= open.length + close.length
      && selected.startsWith(open)
      && selected.endsWith(close);
    if (selectedIncludesMarkers) {
      const inner = selected.slice(open.length, selected.length - close.length);
      const nextSource = `${canonical.slice(0, range.start)}${inner}${canonical.slice(range.end)}`;
      return {
        source: nextSource,
        selection: orientedMarkdownSelection(
          original,
          range.start,
          range.start + inner.length
        )
      };
    }
    const nextSource = `${canonical.slice(0, range.start)}${open}${selected}${close}`
      + canonical.slice(range.end);
    const contentStart = range.start + open.length;
    return {
      source: nextSource,
      selection: original.anchor === original.focus
        ? { anchor: contentStart, focus: contentStart }
        : orientedMarkdownSelection(original, contentStart, contentStart + selected.length)
    };
  }

  function createMarkdownEditHistory(source = '') {
    return {
      currentSource: typeof source === 'string' ? source : String(source || ''),
      undoStack: [],
      redoStack: [],
      selectionEpoch: 0,
      lastSelection: null
    };
  }

  function markdownEditHistoryFor(owner, pageId, source = '') {
    if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) {
      return createMarkdownEditHistory(source);
    }
    let pageHistories = markdownEditHistories.get(owner);
    if (!pageHistories) {
      pageHistories = new Map();
      markdownEditHistories.set(owner, pageHistories);
    }
    const key = pageId || '__empty__';
    let history = pageHistories.get(key);
    if (!history) {
      history = createMarkdownEditHistory(source);
      pageHistories.set(key, history);
    }
    return history;
  }

  function forgetMarkdownEditHistory(owner, pageId = null) {
    if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) return false;
    const pageHistories = markdownEditHistories.get(owner);
    if (!pageHistories) return false;
    if (typeof pageId === 'string' && pageId) return pageHistories.delete(pageId);
    return markdownEditHistories.delete(owner);
  }

  function cloneMarkdownHistoryValue(value) {
    if (Array.isArray(value)) return value.map(cloneMarkdownHistoryValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneMarkdownHistoryValue(entry)])
    );
  }

  function markdownHistoryValuesEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && markdownHistoryValuesEqual(left[key], right[key]));
  }

  function normalizedMarkdownHistorySelection(source, selection = null, fallbackOffset = null) {
    const canonical = typeof source === 'string' ? source : String(source || '');
    const anchorPosition = selection?.anchor;
    const focusPosition = selection?.focus;
    const structured = anchorPosition && focusPosition
      && typeof anchorPosition === 'object'
      && typeof focusPosition === 'object';
    if (structured) {
      const fallback = clamp(
        finiteNumber(
          typeof fallbackOffset === 'object' ? fallbackOffset?.offset : fallbackOffset,
          canonical.length
        ),
        0,
        canonical.length
      );
      const anchor = {
        ...cloneMarkdownHistoryValue(anchorPosition),
        offset: clamp(finiteNumber(anchorPosition.offset, fallback), 0, canonical.length)
      };
      const focus = {
        ...cloneMarkdownHistoryValue(focusPosition),
        offset: clamp(finiteNumber(focusPosition.offset, anchor.offset), 0, canonical.length)
      };
      return {
        ...cloneMarkdownHistoryValue(selection),
        anchor,
        focus
      };
    }
    const normalized = normalizedMarkdownEditSelection(canonical, selection, fallbackOffset);
    if (!selection || typeof selection !== 'object') return normalized;
    return {
      ...cloneMarkdownHistoryValue(selection),
      anchor: normalized.anchor,
      focus: normalized.focus
    };
  }

  function markdownSelectionsEqual(left, right) {
    return Boolean(left && right && markdownHistoryValuesEqual(left, right));
  }

  function markdownHistoryExplicitValue(transaction, key, fallback = null) {
    if (Object.prototype.hasOwnProperty.call(transaction, key)) return transaction[key];
    if (transaction.historyMetadata
      && Object.prototype.hasOwnProperty.call(transaction.historyMetadata, key)) {
      return transaction.historyMetadata[key];
    }
    return fallback;
  }

  function markdownHistoryDefaultCommandKind(inputType) {
    if (inputType === 'insertCompositionText') return 'composition';
    if (inputType === 'insertText' || inputType === 'insertReplacementText') return 'typing';
    if (/^delete/.test(inputType)) return 'delete';
    if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') return 'newline';
    if (inputType === 'formatIndent') return 'indent';
    if (inputType === 'formatOutdent') return 'outdent';
    return inputType || 'edit';
  }

  function markdownEditHistoryPolicy(transaction, inputType) {
    const type = String(inputType || 'insertText');
    const commandKind = String(markdownHistoryExplicitValue(
      transaction,
      'commandKind',
      markdownHistoryDefaultCommandKind(type)
    ));
    const explicitGroup = markdownHistoryExplicitValue(transaction, 'historyGroup', null);
    const explicitKey = markdownHistoryExplicitValue(transaction, 'coalesceKey', null);
    const renumberEdits = markdownHistoryExplicitValue(transaction, 'renumberEdits', []);
    const compositionId = markdownHistoryExplicitValue(transaction, 'compositionId', null);
    const structural = markdownHistoryExplicitValue(transaction, 'structural', false) === true
      || markdownHistoryExplicitValue(transaction, 'listTransform', false) === true
      || (Array.isArray(renumberEdits) && renumberEdits.length > 0);
    const forcedIsolation = markdownHistoryExplicitValue(transaction, 'isolated', false) === true
      || explicitGroup === 'isolated'
      || structural
      || type === 'insertParagraph'
      || type === 'insertLineBreak'
      || type === 'formatIndent'
      || type === 'formatOutdent'
      || type === 'insertFromPaste'
      || type === 'insertFromDrop'
      || type === 'deleteByCut'
      || type === 'deleteByDrag'
      || /^format/.test(type);
    if (forcedIsolation) {
      return {
        commandKind,
        userEvent: explicitKey || String(explicitGroup || commandKind),
        joinable: false,
        isolated: true,
        composition: false,
        compositionId: null
      };
    }
    if (type === 'insertCompositionText') {
      return {
        commandKind,
        userEvent: String(explicitKey || explicitGroup || 'input.type.compose'),
        joinable: true,
        isolated: false,
        composition: true,
        compositionId
      };
    }
    if (type === 'insertText' || type === 'insertReplacementText') {
      return {
        commandKind,
        userEvent: String(explicitKey || explicitGroup || 'input.type'),
        joinable: true,
        isolated: false,
        composition: false,
        compositionId: null
      };
    }
    if (/^delete(?:Content|Word|SoftLine|HardLine)(?:Backward|Forward)$/.test(type)) {
      return {
        commandKind,
        userEvent: String(explicitKey || explicitGroup
          || (type.endsWith('Forward') ? 'delete.forward' : 'delete.backward')),
        joinable: true,
        isolated: false,
        composition: false,
        compositionId: null
      };
    }
    return {
      commandKind,
      userEvent: String(explicitKey || explicitGroup || commandKind),
      joinable: Boolean(explicitGroup && explicitGroup !== 'isolated'),
      isolated: !explicitGroup,
      composition: false,
      compositionId: null
    };
  }

  function markdownHistoryChangedRange(difference) {
    return {
      start: difference.start,
      end: difference.nextEnd
    };
  }

  function markdownHistoryRangesTouch(left, right) {
    return Boolean(left && right
      && left.start <= right.end
      && right.start <= left.end);
  }

  function markdownHistoryRangeAfterChange(range, difference) {
    if (!range) return markdownHistoryChangedRange(difference);
    const mapOffset = (offset) => {
      if (offset <= difference.start) return offset;
      if (offset >= difference.previousEnd) return offset + difference.delta;
      return difference.nextEnd;
    };
    const mappedStart = mapOffset(range.start);
    const mappedEnd = mapOffset(range.end);
    return {
      start: Math.min(mappedStart, mappedEnd, difference.start),
      end: Math.max(mappedStart, mappedEnd, difference.nextEnd)
    };
  }

  function markMarkdownEditHistorySelectionBoundary(history, selection = null) {
    if (!history) return false;
    history.selectionEpoch = finiteNumber(history.selectionEpoch, 0) + 1;
    if (selection) {
      history.lastSelection = normalizedMarkdownHistorySelection(
        history.currentSource,
        selection
      );
    }
    return true;
  }

  function recordMarkdownEditTransaction(history, transaction = {}, {
    coalesce = true,
    recordNoOp = false
  } = {}) {
    if (!history) return false;
    const beforeSource = typeof transaction.beforeSource === 'string'
      ? transaction.beforeSource
      : String(transaction.beforeSource || '');
    const afterSource = typeof transaction.afterSource === 'string'
      ? transaction.afterSource
      : String(transaction.afterSource || '');
    if (beforeSource === afterSource && !recordNoOp) {
      history.currentSource = afterSource;
      return false;
    }
    const beforeSelection = normalizedMarkdownHistorySelection(
      beforeSource,
      transaction.beforeSelection
    );
    const afterSelection = normalizedMarkdownHistorySelection(
      afterSource,
      transaction.afterSelection
    );
    const inputType = String(transaction.inputType || 'insertText');
    const timestamp = finiteNumber(transaction.timestamp, Date.now());
    const difference = sourceDifference(beforeSource, afterSource);
    const policy = markdownEditHistoryPolicy(transaction, inputType);
    const explicitPrimaryEdit = markdownHistoryExplicitValue(transaction, 'primaryEdit', null);
    const primaryEdit = explicitPrimaryEdit == null && difference.changed
      ? {
          start: difference.start,
          end: difference.previousEnd,
          replacement: afterSource.slice(difference.start, difference.nextEnd)
        }
      : cloneMarkdownHistoryValue(explicitPrimaryEdit);
    const renumberEdits = cloneMarkdownHistoryValue(
      markdownHistoryExplicitValue(transaction, 'renumberEdits', [])
    );
    const affectedLineIds = cloneMarkdownHistoryValue(
      markdownHistoryExplicitValue(transaction, 'affectedLineIds', [])
    );
    const historyMetadata = cloneMarkdownHistoryValue(transaction.historyMetadata || null);
    const next = {
      beforeSource,
      afterSource,
      beforeSelection,
      afterSelection,
      inputType,
      timestamp,
      commandKind: policy.commandKind,
      userEvent: policy.userEvent,
      primaryEdit,
      renumberEdits: Array.isArray(renumberEdits) ? renumberEdits : [],
      affectedLineIds: Array.isArray(affectedLineIds) ? affectedLineIds : [],
      historyMetadata,
      compositionId: policy.compositionId,
      changeRange: markdownHistoryChangedRange(difference),
      selectionEpoch: finiteNumber(history.selectionEpoch, 0),
      isolated: !coalesce || recordNoOp || Boolean(policy.isolated),
      noOp: beforeSource === afterSource,
      changeCount: 1
    };
    const previous = history.undoStack[history.undoStack.length - 1];
    const previousDifference = previous
      ? sourceDifference(previous.beforeSource, previous.afterSource)
      : null;
    const previousRange = previous?.changeRange || (previousDifference?.changed
      ? markdownHistoryChangedRange(previousDifference)
      : null);
    const elapsed = timestamp - finiteNumber(previous?.timestamp, 0);
    const sameComposition = Boolean(policy.composition
      && policy.compositionId != null
      && previous?.compositionId === policy.compositionId);
    const canCoalesce = Boolean(coalesce
      && !recordNoOp
      && difference.changed
      && policy.joinable
      && previous
      && !previous?.isolated
      && previous.beforeSource !== previous.afterSource
      && previous.userEvent === policy.userEvent
      && previous.afterSource === beforeSource
      && markdownSelectionsEqual(previous.afterSelection, beforeSelection)
      && finiteNumber(previous.selectionEpoch, 0) === finiteNumber(history.selectionEpoch, 0)
      && markdownHistoryRangesTouch(previousRange, {
        start: difference.start,
        end: difference.previousEnd
      })
      && (sameComposition || (elapsed >= 0 && elapsed < MARKDOWN_HISTORY_COALESCE_MS)));
    if (canCoalesce) {
      previous.afterSource = afterSource;
      previous.afterSelection = afterSelection;
      previous.timestamp = timestamp;
      previous.changeRange = markdownHistoryRangeAfterChange(previousRange, difference);
      const combinedDifference = sourceDifference(previous.beforeSource, afterSource);
      previous.primaryEdit = combinedDifference.changed
        ? {
            start: combinedDifference.start,
            end: combinedDifference.previousEnd,
            replacement: afterSource.slice(combinedDifference.start, combinedDifference.nextEnd)
          }
        : null;
      previous.changeCount = finiteNumber(previous.changeCount, 1) + 1;
    } else {
      history.undoStack.push(next);
      if (history.undoStack.length > MARKDOWN_HISTORY_LIMIT) history.undoStack.shift();
    }
    history.redoStack.length = 0;
    history.currentSource = afterSource;
    history.lastSelection = afterSelection;
    return true;
  }

  function synchronizeMarkdownEditHistory(history, source) {
    if (!history) return null;
    const canonical = typeof source === 'string' ? source : String(source || '');
    if (history.currentSource === canonical) return history;
    history.currentSource = canonical;
    history.undoStack.length = 0;
    history.redoStack.length = 0;
    history.lastSelection = null;
    history.selectionEpoch = finiteNumber(history.selectionEpoch, 0) + 1;
    return history;
  }

  function stepMarkdownEditHistory(history, direction, currentSource) {
    if (!history || (direction !== 'undo' && direction !== 'redo')) return null;
    const canonical = typeof currentSource === 'string'
      ? currentSource
      : String(currentSource || '');
    synchronizeMarkdownEditHistory(history, canonical);
    const sourceStack = direction === 'undo' ? history.undoStack : history.redoStack;
    const targetStack = direction === 'undo' ? history.redoStack : history.undoStack;
    const transaction = sourceStack[sourceStack.length - 1];
    const expectedSource = direction === 'undo'
      ? transaction?.afterSource
      : transaction?.beforeSource;
    if (!transaction || expectedSource !== canonical) return null;
    sourceStack.pop();
    targetStack.push(transaction);
    const source = direction === 'undo'
      ? transaction.beforeSource
      : transaction.afterSource;
    const storedSelection = direction === 'undo'
      ? transaction.beforeSelection
      : transaction.afterSelection;
    const selection = cloneMarkdownHistoryValue(storedSelection);
    history.currentSource = source;
    history.lastSelection = selection;
    history.selectionEpoch = finiteNumber(history.selectionEpoch, 0) + 1;
    return { source, selection, transaction };
  }

  function cloneMarkdownEditTransaction(transaction) {
    return cloneMarkdownHistoryValue(transaction);
  }

  function snapshotMarkdownEditHistory(history) {
    if (!history) return null;
    return {
      currentSource: history.currentSource,
      undoStack: history.undoStack.map(cloneMarkdownEditTransaction),
      redoStack: history.redoStack.map(cloneMarkdownEditTransaction),
      selectionEpoch: finiteNumber(history.selectionEpoch, 0),
      lastSelection: cloneMarkdownHistoryValue(history.lastSelection)
    };
  }

  function restoreMarkdownEditHistorySnapshot(history, snapshot) {
    if (!history || !snapshot) return false;
    history.currentSource = snapshot.currentSource;
    history.undoStack = snapshot.undoStack.map(cloneMarkdownEditTransaction);
    history.redoStack = snapshot.redoStack.map(cloneMarkdownEditTransaction);
    history.selectionEpoch = finiteNumber(snapshot.selectionEpoch, 0);
    history.lastSelection = cloneMarkdownHistoryValue(snapshot.lastSelection);
    return true;
  }

  function statePageId(state) {
    return state?.page?.id || state?.page?.pageId || null;
  }

  function stateOwnsActivePane(state) {
    if (!state?.layer?.isConnected || !liveStates.has(state)) return false;
    const paneElement = state.layer.closest?.('.workspace-pane');
    if (paneElement && !paneElement.classList.contains('is-workspace-pane-active')) return false;
    const activePane = typeof root.getActivePane === 'function' ? root.getActivePane() : null;
    if (!activePane) return !paneElement || paneElement.classList.contains('is-workspace-pane-active');
    if (state.paneId && activePane.id !== state.paneId) return false;
    const activeTab = activePane.session?.activeTab?.();
    if (state.tabId && activeTab?.id !== state.tabId) return false;
    if (statePageId(state) && activeTab?.currentPageId !== statePageId(state)) return false;
    return true;
  }

  function clipboardSelectionMatchesState(selection, state) {
    return Boolean(selection?.state === state
      && selection.paneId === (state?.paneId || null)
      && selection.tabId === (state?.tabId || null)
      && selection.pageId === statePageId(state)
      && stateOwnsActivePane(state));
  }

  function browserSelectionTouchesMarkdown(state = null) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return false;
    const endpoints = [selection.anchorNode, selection.focusNode]
      .map((node) => selectionElement(node))
      .filter(Boolean);
    if (!endpoints.length) return false;
    if (state?.layer) return endpoints.some((element) => (
      element === state.layer || state.layer.contains(element)
    ));
    return endpoints.some((element) => element.closest?.('.markdown-page-layer'));
  }

  function browserSelectionInsideMarkdownBody(state) {
    const body = state?.bodyRoot;
    const selection = window.getSelection?.();
    if (!body || !selection?.rangeCount || selection.isCollapsed
      || String(selection).length === 0) return false;
    const anchor = selectionElement(selection.anchorNode)?.closest?.('.markdown-page-body');
    const focus = selectionElement(selection.focusNode)?.closest?.('.markdown-page-body');
    return anchor === body && focus === body;
  }

  function browserSelectionOutsideMarkdownBody(state) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed
      || String(selection).length === 0) return false;
    return !browserSelectionInsideMarkdownBody(state);
  }

  function clearMarkdownClipboardSelection({ clearBrowserSelection = false, state = null } = {}) {
    const current = activeMarkdownClipboardSelection;
    if (state && current && current.state !== state) return false;
    current?.state?.bodyRoot?.classList?.remove('is-markdown-whole-body-selected');
    activeMarkdownClipboardSelection = null;
    if (clearBrowserSelection && (
      current?.kind === 'whole-body'
      || browserSelectionTouchesMarkdown(state || current?.state || null)
    )) {
      window.getSelection?.()?.removeAllRanges?.();
    }
    return Boolean(current);
  }

  function setMarkdownClipboardSelection(state, selection = {}) {
    if (!state || !stateOwnsActivePane(state)) return null;
    activeMarkdownClipboardSelection?.state?.bodyRoot?.classList?.remove(
      'is-markdown-whole-body-selected'
    );
    const kind = selection.kind === 'title'
      ? 'title'
      : selection.kind === 'whole-body'
        ? 'whole-body'
        : 'partial-body';
    activeMarkdownClipboardSelection = {
      kind,
      state,
      paneId: state.paneId || null,
      tabId: state.tabId || null,
      pageId: statePageId(state),
      anchor: finiteNumber(selection.anchor, 0),
      focus: finiteNumber(selection.focus, selection.anchor)
    };
    if (kind === 'whole-body') {
      state.bodyRoot?.classList?.add('is-markdown-whole-body-selected');
    }
    return activeMarkdownClipboardSelection;
  }

  function selectionStateForElement(element) {
    const layer = element?.closest?.('.markdown-page-layer');
    return layer ? layerStates.get(layer) || null : null;
  }

  function activeMarkdownPageState() {
    for (const state of liveStates) {
      if (stateOwnsActivePane(state)) return state;
    }
    return null;
  }

  function refreshMarkdownClipboardSelectionFromBrowser() {
    const browserSelection = window.getSelection?.();
    if (!browserSelection?.rangeCount) {
      const logicalWhole = activeMarkdownClipboardSelection?.kind === 'whole-body'
        && clipboardSelectionMatchesState(
          activeMarkdownClipboardSelection,
          activeMarkdownClipboardSelection.state
        )
        && document.activeElement === activeMarkdownClipboardSelection.state?.bodyRoot;
      if (!logicalWhole) clearMarkdownClipboardSelection();
      return activeMarkdownClipboardSelection;
    }

    const anchorElement = selectionElement(browserSelection.anchorNode);
    const focusElement = selectionElement(browserSelection.focusNode);
    const anchorBody = anchorElement?.closest?.('.markdown-page-body');
    const focusBody = focusElement?.closest?.('.markdown-page-body');
    const focusedBody = selectionElement(document.activeElement)?.closest?.('.markdown-page-body');
    const focusedState = selectionStateForElement(focusedBody);
    const unboundedFocusedSelection = focusedState
      && stateOwnsActivePane(focusedState)
      && (anchorBody !== focusedBody || focusBody !== focusedBody)
      && browserSelection.containsNode?.(focusedBody, true);
    if (unboundedFocusedSelection) {
      if (focusedState.mode === 'reading' || !semanticModeEditable(focusedState)) {
        browserSelection.removeAllRanges();
      } else {
        restoreSemanticSelection(focusedBody, {
          anchor: 0,
          focus: focusedState.body.length
        });
      }
      return setMarkdownClipboardSelection(focusedState, {
        kind: 'whole-body',
        anchor: 0,
        focus: focusedState.body.length
      });
    }
    if (anchorBody && anchorBody === focusBody) {
      const state = selectionStateForElement(anchorBody);
      const logicalWhole = activeMarkdownClipboardSelection?.kind === 'whole-body'
        && clipboardSelectionMatchesState(activeMarkdownClipboardSelection, state)
        && document.activeElement === state?.bodyRoot;
      if (logicalWhole) return activeMarkdownClipboardSelection;
      if (state && semanticModeEditable(state) && stateOwnsActivePane(state)) {
        const snapshot = captureSemanticSelection(anchorBody);
        if (snapshot && snapshot.anchor !== snapshot.focus) {
          const range = normalizedMarkdownSelectionRange(state.body.length, snapshot);
          if (activeMarkdownClipboardSelection?.kind === 'whole-body'
            && activeMarkdownClipboardSelection.state === state
            && range.start === 0 && range.end === state.body.length) {
            return activeMarkdownClipboardSelection;
          }
          return setMarkdownClipboardSelection(state, {
            kind: 'partial-body',
            anchor: snapshot.anchor,
            focus: snapshot.focus
          });
        }
      }
      clearMarkdownClipboardSelection();
      return null;
    }

    const anchorTitle = anchorElement?.closest?.('[data-markdown-role="title"]');
    const focusTitle = focusElement?.closest?.('[data-markdown-role="title"]');
    if (anchorTitle && anchorTitle === focusTitle) {
      const state = selectionStateForElement(anchorTitle);
      const anchor = textOffsetAtDomPoint(
        anchorTitle,
        browserSelection.anchorNode,
        browserSelection.anchorOffset
      );
      const focus = textOffsetAtDomPoint(
        anchorTitle,
        browserSelection.focusNode,
        browserSelection.focusOffset
      );
      if (state && stateOwnsActivePane(state)
        && Number.isFinite(anchor) && Number.isFinite(focus) && anchor !== focus) {
        return setMarkdownClipboardSelection(state, { kind: 'title', anchor, focus });
      }
    }

    const logicalWhole = activeMarkdownClipboardSelection?.kind === 'whole-body'
      && clipboardSelectionMatchesState(
        activeMarkdownClipboardSelection,
        activeMarkdownClipboardSelection.state
      )
      && document.activeElement === activeMarkdownClipboardSelection.state?.bodyRoot;
    if (!logicalWhole) clearMarkdownClipboardSelection();
    return activeMarkdownClipboardSelection;
  }

  function nativeClipboardControl(target) {
    const element = selectionElement(target);
    const control = element?.closest?.(
      'input, textarea, [contenteditable]:not([contenteditable="false"])'
    );
    if (!control || control.classList?.contains('markdown-page-body')
      || control.dataset?.markdownEditableTableCell === 'true'
      || control.hasAttribute?.('disabled')) return null;
    if (control.matches?.('textarea')) return control;
    if (control.matches?.('input')) {
      const type = String(control.getAttribute?.('type') || control.type || 'text').toLowerCase();
      if (new Set([
        'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio',
        'range', 'reset', 'submit'
      ]).has(type)) return null;
    }
    return control;
  }

  function focusedMarkdownBodyState(event) {
    const target = selectionElement(event?.target);
    const active = selectionElement(document.activeElement);
    if (nativeClipboardControl(target) || nativeClipboardControl(active)) return null;
    const body = target?.closest?.('.markdown-page-body')
      || active?.closest?.('.markdown-page-body');
    const state = selectionStateForElement(body);
    return state && stateOwnsActivePane(state) ? state : null;
  }

  function handleMarkdownSelectAll(event) {
    if (!event || event.defaultPrevented || event.altKey || event.isComposing
      || event.keyCode === 229 || (!event.metaKey && !event.ctrlKey)
      || String(event.key || '').toLowerCase() !== 'a') return false;
    if (nativeClipboardControl(event.target)
      || nativeClipboardControl(document.activeElement)) return false;
    const focusedState = focusedMarkdownBodyState(event);
    const state = focusedState || activeMarkdownPageState();
    if (!state) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!focusedState && state.mode !== 'reading') {
      clearMarkdownClipboardSelection({ clearBrowserSelection: true });
      return true;
    }
    const length = state.body.length;
    if (state.mode === 'reading' || !semanticModeEditable(state)) {
      state.bodyRoot?.focus?.({ preventScroll: true });
      window.getSelection?.()?.removeAllRanges?.();
      setMarkdownClipboardSelection(state, {
        kind: 'whole-body',
        anchor: 0,
        focus: length
      });
      return true;
    }
    restoreSemanticSelection(state.bodyRoot, { anchor: 0, focus: length });
    setMarkdownClipboardSelection(state, {
      kind: 'whole-body',
      anchor: 0,
      focus: length
    });
    updateLiveMarkerVisibility(state);
    return true;
  }

  function validMarkdownBodyClipboardSelection() {
    refreshMarkdownClipboardSelectionFromBrowser();
    const selection = activeMarkdownClipboardSelection;
    if (!selection || selection.kind === 'title'
      || !clipboardSelectionMatchesState(selection, selection.state)) return null;
    if (selection.kind === 'partial-body') {
      const snapshot = captureSemanticSelection(selection.state.bodyRoot);
      if (!snapshot || snapshot.anchor === snapshot.focus) return null;
      setMarkdownClipboardSelection(selection.state, {
        kind: 'partial-body',
        anchor: snapshot.anchor,
        focus: snapshot.focus
      });
    }
    return activeMarkdownClipboardSelection;
  }

  function markdownSelectionForState(state, fallbackOffset = null) {
    const selection = captureSemanticSelection(state?.bodyRoot);
    return normalizedMarkdownEditSelection(
      state?.body || '',
      selection,
      fallbackOffset
    );
  }

  function recordStateMarkdownEdit(state, transaction, options) {
    return recordMarkdownEditTransaction(state?.editHistory, transaction, options);
  }

  function canonicalSourceAfterValidatedEdits(source, edits) {
    if (!Array.isArray(edits)) return null;
    let previousEnd = 0;
    for (const edit of edits) {
      if (!Number.isInteger(edit?.start)
        || !Number.isInteger(edit?.end)
        || edit.start < previousEnd
        || edit.end < edit.start
        || edit.end > source.length
        || typeof edit.replacement !== 'string') return null;
      previousEnd = edit.end;
    }
    let next = source;
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      const edit = edits[index];
      next = `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`;
    }
    return next;
  }

  function canonicalSelectionsMatch(source, left, right) {
    const first = normalizedMarkdownEditSelection(source, left, 0);
    const second = normalizedMarkdownEditSelection(source, right, 0);
    return first.anchor === second.anchor
      && first.focus === second.focus
      && first.anchorAffinity === second.anchorAffinity
      && first.focusAffinity === second.focusAffinity;
  }

  function preparedCanonicalResultMatches(
    result,
    currentSnapshot,
    beforeSource,
    primarySource,
    expectedPrimaryEdit,
    expectedBeforeSelection,
    expectedInputType,
    expectedTransactionKind
  ) {
    const transaction = result?.transaction;
    const snapshot = result?.snapshot;
    const primaryEdit = result?.primaryEdits?.[0];
    return result?.ok === true
      && result.changed === true
      && result.primaryEdits?.length === 1
      && primaryEdit?.start === expectedPrimaryEdit.start
      && primaryEdit.end === expectedPrimaryEdit.end
      && primaryEdit.replacement === expectedPrimaryEdit.replacement
      && canonicalSourceAfterValidatedEdits(primarySource, result.renumberEdits) === result.source
      && result.markdownBody === result.source
      && snapshot?.markdownBody === result.source
      && snapshot.version === currentSnapshot.version + 1
      && transaction?.beforeSource === beforeSource
      && transaction.afterSource === result.source
      && transaction.sourceVersionBefore === currentSnapshot.version
      && transaction.sourceVersionAfter === snapshot.version
      && transaction.inputType === expectedInputType
      && transaction.transactionKind === expectedTransactionKind
      && transaction.primaryEdits === result.primaryEdits
      && transaction.renumberEdits === result.renumberEdits
      && canonicalSelectionsMatch(
        beforeSource,
        transaction.beforeSelection,
        expectedBeforeSelection
      )
      && canonicalSelectionsMatch(
        result.source,
        transaction.afterSelection,
        result.selection
      )
      && Array.isArray(result.renumberEdits)
      && result.selection
      && Number.isFinite(result.selection.anchor)
      && Number.isFinite(result.selection.focus);
  }

  function exactMarkdownDeletionResult(state, selection, direction) {
    if (!state || typeof editableFoundation?.applyExactDeletion !== 'function') return null;
    const snapshot = installSourceSnapshot(state, state.body);
    const normalized = normalizedMarkdownEditSelection(
      snapshot.markdownBody,
      selection,
      0
    );
    return editableFoundation.applyExactDeletion(
      snapshot,
      normalized,
      direction === 'forward' ? 'forward' : 'backward',
      {
        ...(typeof model?.parseMarkdownDocument === 'function'
          ? { parseMarkdown: model.parseMarkdownDocument }
          : {})
      }
    );
  }

  function singlePreparedCanonicalEdit(result, sourceLength) {
    const edit = result?.primaryEdits?.length === 1 ? result.primaryEdits[0] : null;
    if (!Number.isInteger(edit?.start)
      || !Number.isInteger(edit?.end)
      || edit.start < 0
      || edit.end < edit.start
      || edit.end > sourceLength
      || typeof edit.replacement !== 'string') return null;
    return edit;
  }

  function replaceSemanticSourceRange(state, start, end, replacement, {
    caretOffset = null,
    afterSelection = null,
    inputType = 'insertText',
    beforeSelection = null,
    timestamp = null,
    recordHistory = true,
    coalesceHistory = true,
    restoreSelection = true,
    transactionMetadata = null,
    tableReconciliation = null,
    canonicalResult: preparedCanonicalResult = null,
    canonicalResultTransactionKind = null
  } = {}) {
    const previousSource = state.body;
    const safeStart = clamp(Math.min(start, end), 0, previousSource.length);
    const safeEnd = clamp(Math.max(start, end), safeStart, previousSource.length);
    const previousSelection = normalizedMarkdownEditSelection(
      previousSource,
      beforeSelection,
      safeStart
    );
    const rawNextSource = `${previousSource.slice(0, safeStart)}${replacement}${previousSource.slice(safeEnd)}`;
    const nextCaret = Number.isFinite(caretOffset)
      ? clamp(caretOffset, 0, rawNextSource.length)
      : safeStart + replacement.length;
    const rawNextSelection = normalizedMarkdownEditSelection(
      rawNextSource,
      afterSelection,
      nextCaret
    );
    const currentSnapshot = installSourceSnapshot(state, previousSource);
    const previousPresentationPlan = state.editablePresentationPlan;
    const usesPreparedCanonicalResult = preparedCanonicalResultMatches(
      preparedCanonicalResult,
      currentSnapshot,
      previousSource,
      rawNextSource,
      {
        start: safeStart,
        end: safeEnd,
        replacement: String(replacement ?? '')
      },
      previousSelection,
      inputType,
      canonicalResultTransactionKind || transactionMetadata?.commandKind || inputType
    );
    const canonicalResult = usesPreparedCanonicalResult
      ? preparedCanonicalResult
      : editableFoundation.applyCanonicalEdit(
        currentSnapshot,
        {
          anchor: {
            offset: previousSelection.anchor,
            affinity: previousSelection.anchorAffinity
          },
          focus: {
            offset: previousSelection.focus,
            affinity: previousSelection.focusAffinity
          }
        },
        {
          start: safeStart,
          end: safeEnd,
          replacement: String(replacement ?? ''),
          kind: transactionMetadata?.primaryEdit?.kind || 'canonical-source-edit'
        },
        {
          transactionKind: transactionMetadata?.commandKind || inputType,
          inputType,
          parseMarkdown: model.parseMarkdownDocument
        }
      );
    const nextSource = canonicalResult.source;
    const renumberEdits = canonicalResult.renumberEdits || [];
    const nextSelection = usesPreparedCanonicalResult
      ? normalizedMarkdownEditSelection(
        nextSource,
        canonicalResult.selection,
        rawNextSelection.focus
      )
      : {
        anchor: editableFoundation.offsetAfterEdits(
          rawNextSelection.anchor,
          renumberEdits,
          rawNextSelection.anchorAffinity
        ),
        focus: editableFoundation.offsetAfterEdits(
          rawNextSelection.focus,
          renumberEdits,
          rawNextSelection.focusAffinity
        ),
        anchorAffinity: rawNextSelection.anchorAffinity,
        focusAffinity: rawNextSelection.focusAffinity
      };
    const beforeHistorySelection = structuredProjectionSelection(
      state.editableProjection,
      beforeSelection || previousSelection
    );
    state.sourceSnapshot = canonicalResult.snapshot;
    state.sourceVersion = canonicalResult.snapshot.version;
    state.body = canonicalResult.snapshot.markdownBody;
    clearMarkdownMultiClickAnchor(state);
    state.modeExtentFloor = null;
    state.semanticDirty = true;
    state.editableTableReconciliationDiagnostics = null;
    if (tableReconciliation
      && Number.isInteger(tableReconciliation.nextEffectiveStart)
      && Number.isInteger(tableReconciliation.nextEffectiveEnd)) {
      state.editableActiveTableCell = {
        tableStart: tableReconciliation.tableStart,
        header: tableReconciliation.header === true,
        rowIndex: tableReconciliation.rowIndex,
        columnIndex: tableReconciliation.columnIndex,
        sourceVersion: state.sourceVersion,
        effectiveStart: tableReconciliation.nextEffectiveStart,
        effectiveEnd: tableReconciliation.nextEffectiveEnd
      };
    }
    if (state.editableProjection) {
      let reconciled = false;
      if (tableReconciliation
        && renumberEdits.length === 0
        && nextSource === rawNextSource
        && previousPresentationPlan) {
        const nextPresentationPlan = editablePresentationPlanForState(state);
        const diagnostics = reconcileEditableTableRevision(
          state,
          previousPresentationPlan,
          nextPresentationPlan,
          tableReconciliation,
          {
            start: safeStart,
            end: safeEnd,
            replacement: String(replacement ?? '')
          }
        );
        if (diagnostics) {
          state.editableTableReconciliationDiagnostics = diagnostics;
          if (transactionMetadata?.commandKind === 'composition') {
            recordEditableTableCompositionDiagnostic(state, {
              reconciliation: 'exact-revision',
              reconciliationDiagnostics: {
                leavesCreated: Number(diagnostics.leavesCreated || 0),
                leavesRemoved: Number(diagnostics.leavesRemoved || 0),
                rowsCreated: Number(diagnostics.rowsCreated || 0),
                rowsRemoved: Number(diagnostics.rowsRemoved || 0)
              }
            });
          }
          reconciled = true;
        }
      }
      if (!reconciled) {
        if (transactionMetadata?.commandKind === 'composition' && tableReconciliation) {
          recordEditableTableCompositionDiagnostic(state, {
            reconciliation: 'full-refresh-fallback',
            reconciliationDiagnostics: null
          });
        }
        state.editableActiveOwnerIds = new Set();
        state.editableForcedRawOwnerIds = new Set();
        refreshEditableProjection(state);
      }
    } else {
      renderSemanticDocumentBlocks(state, state.bodyRoot);
    }
    if (restoreSelection) restoreSemanticSelection(state.bodyRoot, nextSelection);
    updateLiveMarkerVisibility(state);
    state.pendingEditTransaction = null;
    if (recordHistory) {
      recordStateMarkdownEdit(state, {
        primaryEdit: {
          start: safeStart,
          end: safeEnd,
          replacement: String(replacement ?? '')
        },
        ...(renumberEdits.length > 0 ? { renumberEdits } : {}),
        ...(transactionMetadata && typeof transactionMetadata === 'object'
          ? transactionMetadata
          : {}),
        beforeSource: previousSource,
        afterSource: nextSource,
        beforeSelection: beforeHistorySelection,
        afterSelection: structuredProjectionSelection(
          state.editableProjection,
          nextSelection
        ),
        inputType,
        // Null means "capture now". Number(null) is zero, which previously
        // put keyboard-owned newline transactions outside the 500 ms group
        // used by the following trusted text input.
        timestamp: timestamp == null
          ? Date.now()
          : Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now()
      }, { coalesce: coalesceHistory });
    }
    notifySemanticBodyInput(state);
    return true;
  }

  function applyMarkdownFormattingShortcut(state, kind) {
    if (!state || !semanticModeEditable(state)) return false;
    const beforeSelection = captureSemanticSelection(state.bodyRoot);
    if (!beforeSelection) return false;
    const result = toggleMarkdownFormatting(state.body, beforeSelection, kind);
    if (result.source === state.body) return false;
    const difference = sourceDifference(state.body, result.source);
    return replaceSemanticSourceRange(
      state,
      difference.start,
      difference.previousEnd,
      result.source.slice(difference.start, difference.nextEnd),
      {
        afterSelection: result.selection,
        beforeSelection,
        inputType: kind === 'bold'
          ? 'formatBold'
          : kind === 'italic'
            ? 'formatItalic'
            : 'formatUnderline'
      }
    );
  }

  function applyMarkdownIndentationShortcut(state, direction) {
    if (!state || !semanticModeEditable(state)
      || typeof model?.applyMarkdownIndentation !== 'function') return false;
    const beforeSelection = captureSemanticSelection(state.bodyRoot);
    if (!beforeSelection) return false;
    const result = model.applyMarkdownIndentation(state.body, beforeSelection, direction);
    if (!result?.changed || result.source === state.body) {
      if (direction === 'outdent') {
        markMarkdownEditHistorySelectionBoundary(
          state.editHistory,
          result?.selection || beforeSelection
        );
      }
      return false;
    }
    const difference = sourceDifference(state.body, result.source);
    return replaceSemanticSourceRange(
      state,
      difference.start,
      difference.previousEnd,
      result.source.slice(difference.start, difference.nextEnd),
      {
        afterSelection: result.selection,
        beforeSelection,
        inputType: direction === 'outdent' ? 'formatOutdent' : 'formatIndent',
        transactionMetadata: {
          commandKind: result.transaction?.transactionKind
            || (direction === 'outdent' ? 'ordinary-shift-tab' : 'ordinary-tab'),
          primaryEdit: result.primaryEdits || null,
          renumberEdits: result.renumberEdits || [],
          affectedLineIds: result.affectedPhysicalLineIds || [],
          structural: result.transaction?.structural === true,
          listTransform: result.transaction?.listTransform === true
        }
      }
    );
  }

  function applyMarkdownDeletionShortcut(state, direction) {
    if (!state || !semanticModeEditable(state)
      || typeof editableFoundation?.applyExactDeletion !== 'function') return false;
    const beforeSelection = captureSemanticSelection(state.bodyRoot);
    if (!beforeSelection) return false;
    const result = exactMarkdownDeletionResult(state, beforeSelection, direction);
    if (!result?.changed || result.source === state.body) {
      // Claim source-boundary no-ops so Chromium never performs a second,
      // native mutation after the canonical deletion owner has decided.
      return markdownDeletionAtCanonicalBoundary(
        state.body,
        beforeSelection,
        direction
      );
    }
    const preparedEdit = singlePreparedCanonicalEdit(result, state.body.length);
    const difference = preparedEdit || sourceDifference(state.body, result.source);
    return replaceSemanticSourceRange(
      state,
      difference.start,
      preparedEdit ? difference.end : difference.previousEnd,
      preparedEdit
        ? difference.replacement
        : result.source.slice(difference.start, difference.nextEnd),
      {
        afterSelection: result.selection,
        beforeSelection,
        canonicalResult: preparedEdit ? result : null,
        canonicalResultTransactionKind: 'exact-deletion',
        inputType: direction === 'forward'
          ? 'deleteContentForward'
          : 'deleteContentBackward',
        transactionMetadata: {
          commandKind: 'exact-deletion',
          primaryEdit: result.primaryEdits || null,
          renumberEdits: result.renumberEdits || [],
          affectedLineIds: result.affectedPhysicalLineIds || []
        }
      }
    );
  }

  function markdownDeletionAtCanonicalBoundary(source, selection, direction) {
    const canonical = typeof source === 'string' ? source : String(source || '');
    const normalized = normalizedMarkdownEditSelection(canonical, selection, 0);
    if (normalized.anchor !== normalized.focus) return false;
    return direction === 'forward'
      ? normalized.focus === canonical.length
      : normalized.focus === 0;
  }

  function handleMarkdownClipboardEvent(event, operation) {
    if (!event || event.defaultPrevented) return false;
    const pendingWrite = operation === 'copy' ? pendingMarkdownClipboardWrite : null;
    if (pendingWrite && stateOwnsActivePane(pendingWrite.state)
      && event.clipboardData?.setData) {
      event.clipboardData.setData('text/plain', pendingWrite.text);
      pendingWrite.fulfilled = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
    const activeControl = nativeClipboardControl(document.activeElement)
      || nativeClipboardControl(event.target);
    if (activeControl) return false;
    const focusedState = focusedMarkdownBodyState(event);
    const fallbackState = focusedState ? null : activeMarkdownPageState();
    if (!focusedState && fallbackState
      && browserSelectionOutsideMarkdownBody(fallbackState)) return false;
    const commandState = focusedState || fallbackState;
    if (!commandState) return false;
    if (commandState.mode === 'reading' || !semanticModeEditable(commandState)) {
      const logicalWholeBody = activeMarkdownClipboardSelection?.kind === 'whole-body'
        && clipboardSelectionMatchesState(activeMarkdownClipboardSelection, commandState);
      if (operation === 'copy' && !logicalWholeBody
        && browserSelectionInsideMarkdownBody(commandState)) return false;
      if (operation === 'copy' && event.clipboardData?.setData) {
        event.clipboardData.setData('text/plain', commandState.body);
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (operation === 'cut' && focusedState !== commandState) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    const selection = validMarkdownBodyClipboardSelection();
    if (!selection || selection.state !== commandState) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    const state = selection.state;
    const range = normalizedMarkdownSelectionRange(state.body.length, selection);
    if (selection.kind !== 'whole-body' && range.start === range.end) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    const source = canonicalMarkdownSelectionText(state.body, selection);
    if (!event.clipboardData?.setData) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    event.clipboardData.setData('text/plain', source);
    event.preventDefault();
    event.stopPropagation();
    if (operation === 'cut') {
      const tableContext = editableTableCellEditContext(state, selection);
      if (tableContext) {
        replaceEditableTableCellRange(state, tableContext, range.start, range.end, '', {
          inputType: 'deleteByCut',
          beforeSelection: tableContext.selection
        });
      } else {
        replaceSemanticSourceRange(state, range.start, range.end, '', {
          inputType: 'deleteByCut',
          beforeSelection: { anchor: selection.anchor, focus: selection.focus }
        });
      }
      clearMarkdownClipboardSelection();
    }
    return true;
  }

  function writeCanonicalMarkdownClipboard(state, text, {
    allowAsyncFallback = true
  } = {}) {
    const canonical = typeof text === 'string' ? text : String(text || '');
    const pendingWrite = { state, text: canonical, fulfilled: false };
    pendingMarkdownClipboardWrite = pendingWrite;
    try {
      document.execCommand?.('copy');
    } catch (_error) {
      // The optional async Clipboard API below is the contained fallback.
    } finally {
      if (pendingMarkdownClipboardWrite === pendingWrite) pendingMarkdownClipboardWrite = null;
    }
    if (pendingWrite.fulfilled) return true;
    if (!allowAsyncFallback) return false;
    const writeText = root.navigator?.clipboard?.writeText;
    if (typeof writeText !== 'function') return false;
    Promise.resolve(writeText.call(root.navigator.clipboard, canonical)).catch(() => {});
    return true;
  }

  function writeCanonicalCodeBodyClipboard(state, text) {
    const canonical = typeof text === 'string' ? text : String(text || '');
    const desktopWrite = root.cneDesktop?.writeClipboardText;
    if (typeof desktopWrite === 'function') {
      Promise.resolve(desktopWrite(canonical)).catch(() => {
        writeCanonicalMarkdownClipboard(state, canonical);
      });
      return true;
    }
    return writeCanonicalMarkdownClipboard(state, canonical);
  }

  function handleMarkdownPasteEvent(event) {
    if (!event || event.defaultPrevented) return false;
    const activeControl = nativeClipboardControl(document.activeElement)
      || nativeClipboardControl(event.target);
    if (activeControl) return false;
    const focusedState = focusedMarkdownBodyState(event);
    const fallbackState = focusedState ? null : activeMarkdownPageState();
    if (!focusedState && fallbackState
      && browserSelectionOutsideMarkdownBody(fallbackState)) return false;
    const commandState = focusedState || fallbackState;
    if (!commandState) return false;
    event.preventDefault();
    event.stopPropagation();
    if (!focusedState || !semanticModeEditable(commandState)) return true;
    const selection = captureSemanticSelection(commandState.bodyRoot);
    if (!selection) return true;
    const range = normalizedMarkdownSelectionRange(commandState.body.length, selection);
    const text = event.clipboardData?.getData?.('text/plain');
    if (typeof text !== 'string' || text.length === 0) return true;
    const tableResult = applyEditableTableCellTextInput(
      commandState,
      selection,
      text,
      { inputType: 'insertFromPaste', normalizeLineBreaks: true }
    );
    if (tableResult) {
      clearMarkdownClipboardSelection();
      return true;
    }
    replaceSemanticSourceRange(commandState, range.start, range.end, text, {
      inputType: 'insertFromPaste',
      beforeSelection: selection
    });
    clearMarkdownClipboardSelection();
    return true;
  }

  function markdownRunsOnMacOS() {
    const platform = root.navigator?.userAgentData?.platform
      || root.navigator?.platform
      || '';
    return /mac/i.test(platform);
  }

  function markdownContextMenuPointer(event) {
    return Boolean(event && (
      event.button === 2
      || (event.button === 0 && event.ctrlKey && markdownRunsOnMacOS())
    ));
  }

  function markdownPrimaryModifier(event) {
    if (!event || event.altKey) return false;
    return markdownRunsOnMacOS()
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  }

  function markdownHistoryDirection(event) {
    if (!event || event.repeat || event.isComposing || event.keyCode === 229
      || !markdownPrimaryModifier(event)) return null;
    const key = String(event.key || '').toLowerCase();
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (!markdownRunsOnMacOS() && key === 'y' && !event.shiftKey) return 'redo';
    return null;
  }

  function pendingMarkdownHistoryTransaction(state, direction) {
    const history = state?.editHistory;
    if (!history || (direction !== 'undo' && direction !== 'redo')) return null;
    const stack = direction === 'undo' ? history.undoStack : history.redoStack;
    const transaction = stack[stack.length - 1];
    const expectedSource = direction === 'undo'
      ? transaction?.afterSource
      : transaction?.beforeSource;
    return transaction && expectedSource === state.body ? transaction : null;
  }

  function applyMarkdownEditHistory(state, direction) {
    const transaction = pendingMarkdownHistoryTransaction(state, direction);
    if (!transaction || (!semanticModeEditable(state)
      && transaction.inputType !== 'formatTaskList')) return false;
    const result = stepMarkdownEditHistory(state.editHistory, direction, state.body);
    if (!result) return false;
    clearMarkdownClipboardSelection({ clearBrowserSelection: true, state });
    clearMarkdownMultiClickAnchor(state);
    state.pendingEditTransaction = null;
    installSourceSnapshot(state, result.source);
    state.modeExtentFloor = null;
    state.semanticDirty = true;
    if (state.editableProjection) {
      state.editableActiveOwnerIds = new Set();
      state.editableForcedRawOwnerIds = new Set();
      refreshEditableProjection(state);
    } else {
      renderSemanticDocumentBlocks(state, state.bodyRoot);
    }
    if (semanticModeEditable(state)) restoreSemanticSelection(state.bodyRoot, result.selection);
    updateLiveMarkerVisibility(state);
    updateDocumentExtent(state);
    notifySemanticBodyInput(state);
    return true;
  }

  function handleMarkdownKeyboardCommand(event) {
    if (handleMarkdownSelectAll(event)) return true;
    if (!event || event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
    if (nativeClipboardControl(event.target)
      || nativeClipboardControl(document.activeElement)) return false;
    const focusedState = focusedMarkdownBodyState(event);
    const fallbackState = focusedState ? null : activeMarkdownPageState();
    if (!focusedState && fallbackState
      && browserSelectionOutsideMarkdownBody(fallbackState)) return false;
    const commandState = focusedState || fallbackState;
    const key = String(event.key || '').toLowerCase();
    const formattingKind = key === 'b'
      ? 'bold'
      : key === 'i'
        ? 'italic'
        : key === 'u'
          ? 'underline'
          : null;
    if (focusedState && formattingKind && markdownPrimaryModifier(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (semanticModeEditable(focusedState)) {
        applyMarkdownFormattingShortcut(focusedState, formattingKind);
      }
      return true;
    }
    if (commandState && markdownPrimaryModifier(event) && key === 'c') {
      let source = null;
      if (commandState.mode === 'reading' || !semanticModeEditable(commandState)) {
        const logicalWholeBody = activeMarkdownClipboardSelection?.kind === 'whole-body'
          && clipboardSelectionMatchesState(activeMarkdownClipboardSelection, commandState);
        if (!logicalWholeBody && browserSelectionInsideMarkdownBody(commandState)) return false;
        source = commandState.body;
      } else {
        const selection = validMarkdownBodyClipboardSelection();
        if (selection?.state === commandState) {
          source = canonicalMarkdownSelectionText(commandState.body, selection);
        }
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (source !== null) writeCanonicalMarkdownClipboard(commandState, source);
      return true;
    }
    if (commandState && markdownPrimaryModifier(event) && key === 'x') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!focusedState || !semanticModeEditable(commandState)) return true;
      const selection = validMarkdownBodyClipboardSelection();
      if (!selection || selection.state !== commandState) return true;
      const range = normalizedMarkdownSelectionRange(commandState.body.length, selection);
      if (range.start === range.end) return true;
      const copied = writeCanonicalMarkdownClipboard(
        commandState,
        canonicalMarkdownSelectionText(commandState.body, selection),
        { allowAsyncFallback: false }
      );
      if (!copied) return true;
      const tableContext = editableTableCellEditContext(commandState, selection);
      if (tableContext) {
        replaceEditableTableCellRange(
          commandState,
          tableContext,
          range.start,
          range.end,
          '',
          { inputType: 'deleteByCut', beforeSelection: tableContext.selection }
        );
      } else {
        replaceSemanticSourceRange(commandState, range.start, range.end, '', {
          inputType: 'deleteByCut',
          beforeSelection: { anchor: selection.anchor, focus: selection.focus }
        });
      }
      clearMarkdownClipboardSelection();
      return true;
    }
    if (commandState && markdownPrimaryModifier(event) && key === 'v') {
      if (focusedState && semanticModeEditable(commandState)) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
    const direction = markdownHistoryDirection(event);
    if (!direction) return false;
    const state = focusedState || commandState;
    const transaction = pendingMarkdownHistoryTransaction(state, direction);
    if (!state || !transaction || (!semanticModeEditable(state)
      && transaction.inputType !== 'formatTaskList')) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    applyMarkdownEditHistory(state, direction);
    return true;
  }

  function installMarkdownClipboardListeners() {
    if (markdownClipboardListenersInstalled || typeof document !== 'object'
      || typeof document.addEventListener !== 'function') return;
    markdownClipboardListenersInstalled = true;
    document.addEventListener('keydown', handleMarkdownKeyboardCommand, true);
    document.addEventListener('copy', (event) => {
      handleMarkdownClipboardEvent(event, 'copy');
    }, true);
    document.addEventListener('cut', (event) => {
      handleMarkdownClipboardEvent(event, 'cut');
    }, true);
    document.addEventListener('paste', handleMarkdownPasteEvent, true);
    document.addEventListener('selectionchange', refreshMarkdownClipboardSelectionFromBrowser);
    document.addEventListener('focusin', (event) => {
      const selection = activeMarkdownClipboardSelection;
      if (!selection || selection.kind !== 'whole-body') return;
      const body = selection.state?.bodyRoot;
      const target = selectionElement(event.target);
      if (body && target && (target === body || body.contains(target))) return;
      clearMarkdownClipboardSelection({ clearBrowserSelection: true });
    }, true);
    document.addEventListener('pointerdown', (event) => {
      const selection = activeMarkdownClipboardSelection;
      if (!selection) return;
      if (markdownContextMenuPointer(event)) return;
      const target = selectionElement(event.target);
      const foldControl = target?.closest?.('.markdown-structural-fold-control');
      if (foldControl && selectionStateForElement(foldControl) === selection.state) return;
      const foldTrigger = target?.closest?.('[data-markdown-structural-fold-trigger]');
      if (foldTrigger
        && selectionStateForElement(foldTrigger) === selection.state) return;
      const editor = selection.kind === 'title'
        ? selection.state?.titleElement
        : selection.state?.bodyRoot;
      const insideEditor = Boolean(editor && target && (target === editor || editor.contains(target)));
      clearMarkdownClipboardSelection({
        clearBrowserSelection: selection.kind === 'whole-body' || !insideEditor
      });
    }, true);
    root.addEventListener?.('blur', () => {
      clearMarkdownClipboardSelection({ clearBrowserSelection: true });
    });
  }

  function textPointAtOffset(element, requestedOffset) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, requestedOffset);
    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      const semanticOnly = node.parentElement?.closest?.('[data-markdown-semantic-only="true"]');
      if (!semanticOnly) textNodes.push(node);
      node = walker.nextNode();
    }
    for (let index = 0; index < textNodes.length; index += 1) {
      node = textNodes[index];
      const length = (node.nodeValue || '').length;
      if (remaining < length) return { node, offset: remaining };
      if (remaining === length) {
        const next = textNodes[index + 1];
        return next ? { node: next, offset: 0 } : { node, offset: length };
      }
      remaining -= length;
    }
    const last = textNodes[textNodes.length - 1];
    if (last) return { node: last, offset: (last.nodeValue || '').length };
    return { node: element, offset: element.childNodes.length };
  }

  function restoreSemanticSelection(root, snapshot) {
    const projection = editableProjectionForRoot(root);
    if (!projection) return false;
    const state = editableStateRoots.get(root) || null;
    const positions = state
      ? ensureEditableSelectionVisible(state, snapshot)
      : editableSelectionPositions({ editableProjection: projection }, snapshot);
    if (!positions?.anchor || !positions?.focus) return false;
    root.focus?.({ preventScroll: true });
    return projection.restoreSelection(positions);
  }

  function caretPointFromClient(clientX, clientY) {
    const position = document.caretPositionFromPoint?.(clientX, clientY);
    if (position?.offsetNode) {
      return { node: position.offsetNode, offset: position.offset };
    }
    const range = document.caretRangeFromPoint?.(clientX, clientY);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }

  function textOffsetAtDomPoint(rootElement, node, offset) {
    if (!rootElement || !node
      || !(rootElement === node || rootElement.contains?.(node))) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(rootElement);
      range.setEnd(node, Math.max(0, offset));
      return range.toString().length;
    } catch (_error) {
      return null;
    }
  }

  function clampedCaretPoint(editor, clientX, clientY) {
    const rect = editor?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const inset = 1;
    const x = clamp(clientX, rect.left + inset, rect.right - inset);
    const y = clamp(clientY, rect.top + inset, rect.bottom - inset);
    const point = caretPointFromClient(x, y);
    if (!point || !(editor === point.node || editor.contains?.(point.node))) return null;
    return point;
  }

  function renderedTableCellSourceOffset(state, cell, cellPlan, point, event) {
    let element = selectionElement(point?.node);
    while (element && element !== cell) {
      const sourceStart = finiteNumber(element.dataset?.markdownSourceStart, NaN);
      const sourceEnd = finiteNumber(element.dataset?.markdownSourceEnd, NaN);
      if (Number.isFinite(sourceStart) && Number.isFinite(sourceEnd)) {
        const start = clamp(sourceStart, cellPlan.start, cellPlan.end);
        const end = clamp(sourceEnd, start, cellPlan.end);
        const renderedText = String(element.textContent || '');
        const canonicalText = state.body.slice(start, end);
        const textOffset = textOffsetAtDomPoint(element, point.node, point.offset);
        if (renderedText === canonicalText && Number.isFinite(textOffset)) {
          return clamp(start + textOffset, start, end);
        }
        const rect = element.getBoundingClientRect?.();
        return Number.isFinite(event?.clientX) && rect?.width > 0
          && event.clientX > rect.left + (rect.width / 2)
          ? end
          : start;
      }
      element = element.parentElement;
    }
    return cellPlan.start;
  }

  function editableTableCellPointerPosition(state, event) {
    if (!state?.editableProjection || state.mode !== 'live-preview') return null;
    const cell = event?.target?.closest?.('[data-markdown-editable-table-cell="true"]');
    if (!cell || !state.bodyRoot?.contains?.(cell)) return null;
    const ownerId = String(cell.dataset.markdownEditablePresentationOwner || '');
    const rowIndex = finiteNumber(cell.dataset.markdownTableRowIndex, -1);
    const columnIndex = finiteNumber(cell.dataset.markdownTableColumnIndex, -1);
    const table = state.editablePresentationPlan?.constructs?.tables?.find((candidate) => (
      String(candidate.ownerId) === ownerId
    ));
    const cellPlan = table?.cells?.find((candidate) => (
      candidate.canonical
      && candidate.rowIndex === rowIndex
      && candidate.columnIndex === columnIndex
    ));
    if (!cellPlan) return null;
    const point = caretPointFromClient(event.clientX, event.clientY);
    if (!point || !(cell === point.node || cell.contains?.(point.node))) return null;
    const active = editableTableCellDescriptorMatches(
      state.editableActiveTableCell,
      table,
      cellPlan
    );
    if (!active) {
      const offset = renderedTableCellSourceOffset(
        state,
        cell,
        cellPlan,
        point,
        event
      );
      installEditableActiveTableCell(state, table, cellPlan);
      refreshEditableProjection(state);
      const activated = editableVisibleTableCellPosition(
        state,
        projectionPositionAtOffset(state.editableProjection, offset, 'after')
      );
      return activated ? {
        ...activated,
        semanticOwnerId: state.editablePresentationPlan.constructs.tables.find((candidate) => (
          candidate.start === table.start
        ))?.ownerId || table.ownerId,
        visibility: 'visible',
        interactionPolicy: 'editable-table-cell'
      } : null;
    }
    const exact = state.editableProjection.domToSource(point.node, point.offset);
    const activeRange = editableTableCellEffectiveRange(state, table, cellPlan);
    if (!exact || exact.offset < activeRange.start || exact.offset > activeRange.end) return null;
    return {
      ...exact,
      semanticOwnerId: table.ownerId,
      visibility: 'visible',
      interactionPolicy: 'editable-table-cell'
    };
  }

  function editablePointerPosition(state, event) {
    const table = editableTableCellPointerPosition(state, event);
    if (table) return table;
    const fallback = state?.editableProjection?.pointerToPosition(event) || null;
    if (!state?.editableActiveTableCell) return fallback;
    state.editableActiveTableCell = null;
    refreshEditableProjection(state);
    if (!fallback) return null;
    return projectionPositionAtOffset(
      state.editableProjection,
      fallback.offset,
      fallback.affinity
    );
  }

  function titleOffsetAtPointer(title, clientX, clientY) {
    const textLength = String(title?.textContent || '').length;
    const rect = title?.getBoundingClientRect?.();
    if (!rect) return 0;
    if (clientY < rect.top) return 0;
    if (clientY > rect.bottom) return textLength;
    const point = clampedCaretPoint(title, clientX, clientY);
    const offset = point && textOffsetAtDomPoint(title, point.node, point.offset);
    if (Number.isFinite(offset)) return clamp(offset, 0, textLength);
    return clientX <= rect.left + (rect.width / 2) ? 0 : textLength;
  }

  function pointerIsOutsideEditor(editor, clientX, clientY) {
    const rect = editor?.getBoundingClientRect?.();
    return Boolean(!rect || clientX < rect.left || clientX > rect.right
      || clientY < rect.top || clientY > rect.bottom);
  }

  function pointerIsOutsideSelectionRegion(gesture, clientX, clientY) {
    if (pointerIsOutsideEditor(gesture?.editor, clientX, clientY)) return true;
    const areaRect = gesture?.state?.area?.getBoundingClientRect?.();
    return Boolean(areaRect && (clientX < areaRect.left || clientX > areaRect.right
      || clientY < areaRect.top || clientY > areaRect.bottom));
  }

  function editablePositionPrecedes(left, right) {
    if (!left || !right) return false;
    if (left.offset !== right.offset) return left.offset < right.offset;
    if (left.affinity === right.affinity) return false;
    return left.affinity === 'before';
  }

  function orderedEditableSelection(selection) {
    if (!selection?.anchor || !selection?.focus) return null;
    return editablePositionPrecedes(selection.focus, selection.anchor)
      ? { start: selection.focus, end: selection.anchor }
      : { start: selection.anchor, end: selection.focus };
  }

  function markdownGranularityDragSelection(gesture, movingSelection, pointed) {
    const initial = orderedEditableSelection(gesture?.granularitySelection);
    const moving = orderedEditableSelection(movingSelection);
    const fixed = gesture?.multiClickAnchorPosition;
    if (!initial || !moving || !fixed || !pointed) return null;
    const movingBackward = editablePositionPrecedes(pointed, fixed);
    return movingBackward
      ? { anchor: initial.end, focus: moving.start }
      : { anchor: initial.start, focus: moving.end };
  }

  function extendMarkdownSelectionGesture(gesture, event) {
    const editor = gesture?.editor;
    if (!editor?.isConnected) return false;
    if (gesture.editorType === 'body') {
      const focus = editablePointerPosition(gesture.state, event);
      // Table-cell activation may synchronously replace the Projection while
      // resolving the moving endpoint. Always use the post-hit-test owner.
      const projection = gesture.state?.editableProjection;
      if (!projection || !focus || !gesture.anchorPosition) return false;
      let requested;
      if (gesture.granularity) {
        if (typeof projection.selectTextGranularity !== 'function') return false;
        const granularitySelection = projection.selectTextGranularity(
          focus,
          gesture.granularity,
          { apply: false }
        );
        if (!granularitySelection) return false;
        requested = markdownGranularityDragSelection(
          gesture,
          granularitySelection,
          focus
        );
      } else requested = { anchor: gesture.anchorPosition, focus };
      if (!requested) return false;
      const visible = ensureEditableSelectionVisible(gesture.state, requested);
      const restored = Boolean(visible && gesture.state.editableProjection.restoreSelection(visible));
      if (restored) updateLiveMarkerVisibility(gesture.state);
      return restored;
    }

    const anchor = textPointAtOffset(editor, gesture.anchorTextOffset);
    const focus = textPointAtOffset(
      editor,
      titleOffsetAtPointer(editor, event.clientX, event.clientY)
    );
    const selection = window.getSelection?.();
    if (!selection || !anchor || !focus) return false;
    editor.focus({ preventScroll: true });
    try {
      if (typeof selection.setBaseAndExtent === 'function') {
        selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      } else {
        const range = document.createRange();
        range.setStart(anchor.node, anchor.offset);
        range.setEnd(focus.node, focus.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  function removeMarkdownSelectionGestureListeners(gesture) {
    if (!gesture) return;
    root.removeEventListener('pointermove', gesture.onPointerMove);
    root.removeEventListener('pointerup', gesture.onPointerUp);
    root.removeEventListener('pointercancel', gesture.onPointerCancel);
    root.removeEventListener('blur', gesture.onWindowBlur);
  }

  function clearMarkdownSelectionGesture(gesture = activeMarkdownSelectionGesture) {
    if (!gesture || gesture !== activeMarkdownSelectionGesture) return false;
    root.clearTimeout(markdownSelectionGestureCleanupTimer);
    markdownSelectionGestureCleanupTimer = 0;
    removeMarkdownSelectionGestureListeners(gesture);
    gesture.editor?.classList?.remove('is-markdown-selection-owner');
    gesture.state?.layer?.classList?.remove('is-markdown-selection-gesture-active');
    activeMarkdownSelectionGesture = null;
    return true;
  }

  function finishMarkdownSelectionGesture(gesture, event, { cancelled = false } = {}) {
    if (!gesture || gesture !== activeMarkdownSelectionGesture
      || (event?.pointerId !== undefined && event.pointerId !== gesture.pointerId)) return;
    if (!cancelled && event && pointerIsOutsideSelectionRegion(
      gesture, event.clientX, event.clientY
    )) {
      event.preventDefault?.();
      extendMarkdownSelectionGesture(gesture, event);
    }
    removeMarkdownSelectionGestureListeners(gesture);
    if (cancelled) {
      clearMarkdownSelectionGesture(gesture);
      return;
    }
    gesture.phase = 'released';
    // Keep ownership through the synthetic click dispatched after pointerup.
    // Cleanup in the same task's tail so that click cannot activate Canvas.
    markdownSelectionGestureCleanupTimer = root.setTimeout(() => {
      clearMarkdownSelectionGesture(gesture);
    }, 0);
  }

  function beginMarkdownSelectionGesture(state, editorType, editor, event, options = {}) {
    if (!editor?.isConnected || event.button !== 0 || event.isPrimary === false) return false;
    clearMarkdownClipboardSelection({ state });
    clearMarkdownSelectionGesture();
    if (editorType === 'body') {
      markMarkdownEditHistorySelectionBoundary(
        state.editHistory,
        captureSemanticSelection(state.bodyRoot)
      );
    }
    const projectionAnchor = editorType === 'body'
      ? options.anchorPosition || editablePointerPosition(state, event) || null
      : null;
    const gesture = {
      phase: 'selecting',
      state,
      editor,
      editorType,
      pointerId: options.pointerId ?? event.pointerId,
      paneId: state.paneId || null,
      tabId: state.tabId || null,
      pageId: state.page?.id || state.page?.pageId || null,
      anchorSourceOffset: editorType === 'body'
        ? projectionAnchor?.offset ?? null
        : null,
      anchorPosition: projectionAnchor,
      multiClickAnchorPosition: options.multiClickAnchorPosition || projectionAnchor,
      granularity: options.granularity || null,
      granularitySelection: options.granularitySelection || null,
      anchorTextOffset: editorType === 'title'
        ? titleOffsetAtPointer(editor, event.clientX, event.clientY)
        : null,
      canonicalPointerTracking: editorType === 'body'
    };
    if (gesture.canonicalPointerTracking) event.preventDefault();
    if (editorType === 'body' && gesture.anchorPosition && !options.selectionAlreadyPlaced) {
      restoreSemanticSelection(editor, {
        anchor: gesture.anchorPosition,
        focus: gesture.anchorPosition
      });
      updateLiveMarkerVisibility(state);
    }
    gesture.onPointerMove = (moveEvent) => {
      if (moveEvent.pointerId !== gesture.pointerId
        || gesture !== activeMarkdownSelectionGesture) return;
      moveEvent.preventDefault();
      extendMarkdownSelectionGesture(gesture, moveEvent);
    };
    gesture.onPointerUp = (upEvent) => finishMarkdownSelectionGesture(gesture, upEvent);
    gesture.onPointerCancel = (cancelEvent) => finishMarkdownSelectionGesture(
      gesture, cancelEvent, { cancelled: true }
    );
    gesture.onWindowBlur = () => clearMarkdownSelectionGesture(gesture);
    activeMarkdownSelectionGesture = gesture;
    editor.classList.add('is-markdown-selection-owner');
    state.layer?.classList.add('is-markdown-selection-gesture-active');
    root.addEventListener('pointermove', gesture.onPointerMove, { passive: false });
    root.addEventListener('pointerup', gesture.onPointerUp);
    root.addEventListener('pointercancel', gesture.onPointerCancel);
    root.addEventListener('blur', gesture.onWindowBlur);
    return true;
  }

  function markdownSelectionGestureOwnsPointer(event = null) {
    const gesture = activeMarkdownSelectionGesture;
    if (!gesture) return false;
    return event?.pointerId === undefined || event.pointerId === gesture.pointerId;
  }

  function markdownSelectionGestureOwnsEditor(editor) {
    return Boolean(activeMarkdownSelectionGesture?.editor === editor);
  }

  function primaryMouseTextPointer(event) {
    return Boolean(event?.pointerType === 'mouse'
      && (event.button === undefined || event.button === 0)
      && event.isPrimary !== false
      && !markdownContextMenuPointer(event));
  }

  function clearMarkdownMultiClickAnchor(state) {
    if (!state) return false;
    const changed = Boolean(state.semanticMultiClickAnchor || state.pendingSemanticMousePointer);
    state.semanticMultiClickAnchor = null;
    state.pendingSemanticMousePointer = null;
    return changed;
  }

  function recordMarkdownMultiClickAnchor(state, bodyRoot, position) {
    if (!state || !bodyRoot || !position) return null;
    const anchor = Object.freeze({
      bodyRoot,
      paneId: state.paneId || null,
      tabId: state.tabId || null,
      pageId: state.page?.id || state.page?.pageId || null,
      mode: state.mode,
      sourceVersion: state.sourceVersion,
      position: Object.freeze({ ...position })
    });
    state.semanticMultiClickAnchor = anchor;
    return anchor;
  }

  function currentMarkdownMultiClickAnchorPosition(state, bodyRoot) {
    const saved = state?.semanticMultiClickAnchor;
    const projection = state?.editableProjection;
    if (!saved || !projection || saved.bodyRoot !== bodyRoot
      || saved.paneId !== (state.paneId || null)
      || saved.tabId !== (state.tabId || null)
      || saved.pageId !== (state.page?.id || state.page?.pageId || null)
      || saved.mode !== state.mode
      || saved.sourceVersion !== state.sourceVersion
      || saved.position?.sourceVersion !== state.sourceVersion) return null;
    const dom = projection.sourceToDom?.(saved.position);
    const exact = dom && projection.domToSource?.(dom.node, dom.offset);
    return exact && editableProjectionRuntime?.samePosition?.(exact, saved.position)
      ? exact
      : null;
  }

  function beginCanonicalMarkdownPointerSelection(
    state,
    bodyRoot,
    event,
    { pointerId = event?.pointerId, recordMultiClick = false } = {}
  ) {
    if (!recordMultiClick) clearMarkdownMultiClickAnchor(state);
    state.semanticArrowColumn = null;
    const projection = state.editableProjection;
    const pointed = editablePointerPosition(state, event);
    if (!pointed) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    bodyRoot.focus({ preventScroll: true });
    const current = projection.getSelection();
    const requested = {
      anchor: event.shiftKey && current?.anchor ? current.anchor : pointed,
      focus: pointed
    };
    const visible = ensureEditableSelectionVisible(state, requested);
    if (!visible || !state.editableProjection.restoreSelection(visible)) return false;
    markMarkdownEditHistorySelectionBoundary(
      state.editHistory,
      numericProjectionSelection({
        sourceVersion: state.sourceVersion,
        anchor: visible.anchor,
        focus: visible.focus
      })
    );
    updateLiveMarkerVisibility(state);
    const installed = state.editableProjection.getSelection();
    const gestureAnchor = installed?.anchor || visible.anchor;
    const clickPosition = installed?.focus || visible.focus;
    if (recordMultiClick && !event.shiftKey) {
      recordMarkdownMultiClickAnchor(state, bodyRoot, clickPosition);
    } else clearMarkdownMultiClickAnchor(state);
    beginMarkdownSelectionGesture(state, 'body', bodyRoot, event, {
      pointerId,
      anchorPosition: gestureAnchor,
      selectionAlreadyPlaced: true
    });
    return true;
  }

  function applyMarkdownAnchoredMultiClick(state, bodyRoot, event, pointerId) {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    const anchor = currentMarkdownMultiClickAnchorPosition(state, bodyRoot);
    const projection = state?.editableProjection;
    const previous = projection?.getSelection?.() || null;
    if (!anchor || typeof projection?.selectTextGranularity !== 'function') {
      clearMarkdownSelectionGesture();
      clearMarkdownMultiClickAnchor(state);
      return false;
    }
    bodyRoot.focus({ preventScroll: true });
    const granularity = Number(event.detail) === 2 ? 'word' : 'block';
    const selected = projection.selectTextGranularity(anchor, granularity, { apply: true });
    if (!selected?.anchor || !selected?.focus || selected.collapsed) {
      if (previous?.anchor && previous?.focus) projection.restoreSelection(previous);
      clearMarkdownSelectionGesture();
      clearMarkdownMultiClickAnchor(state);
      return false;
    }
    markMarkdownEditHistorySelectionBoundary(
      state.editHistory,
      numericProjectionSelection({
        sourceVersion: state.sourceVersion,
        anchor: selected.anchor,
        focus: selected.focus
      })
    );
    updateLiveMarkerVisibility(state);
    const installed = state.editableProjection.getSelection() || selected;
    beginMarkdownSelectionGesture(state, 'body', bodyRoot, event, {
      pointerId,
      anchorPosition: anchor,
      multiClickAnchorPosition: anchor,
      selectionAlreadyPlaced: true,
      granularity,
      granularitySelection: installed
    });
    return true;
  }

  function handleMarkdownTextMouseDown(state, bodyRoot, event) {
    if (!semanticModeEditable(state) || !state.editableProjection
      || (event.button !== undefined && event.button !== 0)
      || markdownContextMenuPointer(event)) return false;
    const pending = state.pendingSemanticMousePointer;
    state.pendingSemanticMousePointer = null;
    const detail = Math.max(1, Math.trunc(finiteNumber(event.detail, 1)));
    if (detail === 1 || event.shiftKey) {
      // A new platform click sequence must never inherit an anchor from an
      // earlier failed or control-owned click.
      clearMarkdownMultiClickAnchor(state);
      return beginCanonicalMarkdownPointerSelection(state, bodyRoot, event, {
        pointerId: pending?.pointerId,
        recordMultiClick: !event.shiftKey
      });
    }
    return applyMarkdownAnchoredMultiClick(state, bodyRoot, event, pending?.pointerId);
  }

  function renderSemanticBlockContents(state, blockState) {
    const wrapper = blockState.element;
    wrapper.replaceChildren();
    const source = String(state.body || '');
    const node = blockState.node;
    if (node) {
      const nodeStart = syntaxNodeStart(node, blockState.start);
      const nodeEnd = syntaxNodeEnd(node, nodeStart);
      if (nodeStart > blockState.start) {
        wrapper.append(createSourceBlockGap(
          source.slice(blockState.start, nodeStart),
          blockState.start,
          nodeStart,
          { hasFollowingContent: true }
        ));
      }
      appendAstNode(
        wrapper,
        node,
        source,
        state,
        state.markdownSyntaxContext || { definitions: new Map() }
      );
      if (blockState.end > nodeEnd) {
        wrapper.append(createSourceBlockGap(
          source.slice(nodeEnd, blockState.end),
          nodeEnd,
          blockState.end,
          {
            hasPrecedingContent: true,
            hasFollowingContent: blockState.hasFollowingBlock
          }
        ));
      }
    } else if (blockState.raw) {
      wrapper.append(createSourceBlockGap(
        blockState.raw,
        blockState.start,
        blockState.end,
        { hasFollowingContent: false }
      ));
    } else {
      wrapper.append(createElement('p', 'markdown-page-paragraph'));
    }
  }

  function semanticSyntaxSegments(state) {
    const source = String(state?.body || '');
    const tree = state?.sourceSnapshot?.markdownBody === source
      && state.sourceSnapshot?.parserAst
      ? state.sourceSnapshot.parserAst
      : parseMarkdownSyntax(source);
    const nodes = tree.children || [];
    state.markdownSyntaxTree = tree;
    state.markdownSyntaxContext = markdownAstRenderContext(state, tree);
    if (!nodes.length) return [{ start: 0, end: source.length, raw: source, node: null }];
    return nodes.map((node, index) => {
      const start = index === 0 ? 0 : syntaxNodeStart(node);
      const end = nodes[index + 1] ? syntaxNodeStart(nodes[index + 1]) : source.length;
      return { start, end, raw: source.slice(start, end), node };
    });
  }

  function sourceDifference(previousSource, nextSource) {
    const previous = String(previousSource || '');
    const next = String(nextSource || '');
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) {
      start += 1;
    }
    let previousEnd = previous.length;
    let nextEnd = next.length;
    while (previousEnd > start && nextEnd > start
      && previous[previousEnd - 1] === next[nextEnd - 1]) {
      previousEnd -= 1;
      nextEnd -= 1;
    }
    return {
      start,
      previousEnd,
      nextEnd,
      delta: next.length - previous.length,
      changed: previous !== next
    };
  }

  function selectionElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }
  function renderSemanticDocumentBlocks(state, bodyRoot) {
    if (activeCodeLanguageMenu?.button
      && (bodyRoot === activeCodeLanguageMenu.button
        || bodyRoot.contains(activeCodeLanguageMenu.button))) {
      closeCodeLanguageMenu();
    }
    bodyRoot.replaceChildren();
    state.semanticBlocks = [];
    const segments = semanticSyntaxSegments(state);
    segments.forEach((segment, index) => {
      const wrapper = createElement('section', 'markdown-page-live-block markdown-page-semantic-block');
      const blockState = {
        element: wrapper,
        start: segment.start,
        end: segment.end,
        raw: segment.raw,
        node: segment.node,
        hasFollowingBlock: index < segments.length - 1
      };
      renderSemanticBlockContents(state, blockState);
      configureSemanticBlock(state, blockState);
      state.semanticBlocks.push(blockState);
      bodyRoot.append(wrapper);
    });
    if (state.mode === 'reading' && state.bodyRoot === bodyRoot) {
      applyMarkdownStructuralFolding(state);
    }
  }

  function syncSemanticDocumentInput(state, event = {}, { forceRender = false } = {}) {
    if (!semanticModeEditable(state) || !state.bodyRoot?.isConnected) return;
    // Editable DOM is a projection, never a text authority. Canonical source
    // stays model-owned; native IME candidates are the one deliberate view-local mutation and are
    // suppressed above while their composition record is active. Reject every
    // other unexpected native mutation with the current canonical snapshot.
    const selection = captureSemanticSelection(state.bodyRoot)
      || state.pendingEditTransaction?.beforeSelection
      || { anchor: state.body.length, focus: state.body.length };
    state.pendingEditTransaction = null;
    if (!state.editableProjection) renderEditableDocumentBlocks(state, state.bodyRoot);
    else refreshEditableProjection(state);
    restoreSemanticSelection(state.bodyRoot, selection);
    updateLiveMarkerVisibility(state);
  }

  function clearEditableComposition(state) {
    const composition = state?.editableComposition || null;
    if (!composition) return null;
    if (composition.settleTimer !== null) {
      root.clearTimeout?.(composition.settleTimer);
      composition.settleTimer = null;
    }
    state.editableComposition = null;
    state.semanticCompositionPending = false;
    state.pendingEditTransaction = null;
    return composition;
  }

  function editableBodyRootIsCurrent(state, bodyRoot) {
    return Boolean(state?.bodyRoot === bodyRoot && bodyRoot?.isConnected);
  }

  function clearEditableCompositionTail(state) {
    if (!state) return null;
    const tail = state.editableCompositionTail || null;
    state.editableCompositionTail = null;
    return tail;
  }

  function armEditableCompositionTail(state, composition, event = null) {
    const inputType = String(event?.inputType || '');
    const consumedByFinalInput = [
      'insertText', 'insertFromComposition', 'insertCompositionText'
    ].includes(inputType);
    state.editableCompositionTail = consumedByFinalInput ? null : {
      bodyRoot: state.bodyRoot,
      compositionId: composition.id,
      finalText: String(composition.latestText ?? '')
    };
  }

  function consumeEditableCompositionTail(state, bodyRoot, event) {
    const tail = state?.editableCompositionTail;
    if (!tail || tail.bodyRoot !== bodyRoot) return false;
    const inputType = String(event?.inputType || '');
    if (!['insertText', 'insertFromComposition', 'insertCompositionText'].includes(inputType)) {
      return false;
    }
    const data = typeof event?.data === 'string' ? event.data : '';
    if (data !== tail.finalText) {
      clearEditableCompositionTail(state);
      return false;
    }
    clearEditableCompositionTail(state);
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  function refreshAfterEditableComposition(state, selection, {
    restoreSelection = true
  } = {}) {
    if (!state?.bodyRoot?.isConnected) return false;
    if (state.editableProjection) refreshEditableProjection(state);
    else renderEditableDocumentBlocks(state, state.bodyRoot);
    const restored = restoreSelection
      ? restoreSemanticSelection(state.bodyRoot, selection)
      : true;
    updateLiveMarkerVisibility(state);
    return restored;
  }

  function applyDeferredEditableCompositionPage(state, composition, options = {}) {
    const deferredPatch = composition?.deferredPatch
      || (composition?.deferredPage ? { page: composition.deferredPage } : null);
    const page = deferredPatch?.page;
    if (!page || !pageIsMarkdown(page)) return false;
    if (state.layer && resolveLayerState(state.layer) === state) {
      const ownerRoot = state.bodyRoot;
      updateMarkdownPageLayer(state.layer, deferredPatch);
      if (state.bodyRoot === ownerRoot && ownerRoot?.isConnected) {
        refreshAfterEditableComposition(
          state,
          normalizedMarkdownEditSelection(
            state.body,
            composition.beforeSelection,
            state.body.length
          ),
          options
        );
      }
      return true;
    }
    const previousPageId = state.page?.id || state.page?.pageId || null;
    const nextPageId = page.id || page.pageId || null;
    const nextBody = typeof page.markdownBody === 'string' ? page.markdownBody : '';
    state.page = page;
    state.editHistory = markdownEditHistoryFor(
      state.historyOwner,
      nextPageId,
      nextBody
    );
    synchronizeMarkdownEditHistory(state.editHistory, nextBody);
    installSourceSnapshot(state, nextBody, {
      preserveIdentity: previousPageId === nextPageId
    });
    refreshAfterEditableComposition(state, {
      anchor: state.body.length,
      focus: state.body.length
    }, options);
    return true;
  }

  function settleEditableComposition(state, event = null, {
    restoreSelection = true,
    armTail = true
  } = {}) {
    const active = state?.editableComposition;
    if (!active) return false;
    if (typeof event?.data === 'string') {
      active.latestText = event.data;
      active.cancelled = event.data.length === 0;
    }
    const composition = clearEditableComposition(state);
    if (armTail) armEditableCompositionTail(state, composition, event);
    else clearEditableCompositionTail(state);
    const finalText = composition.latestText;
    const originalSelection = composition.beforeSelection;
    const finalSelection = {
      anchor: composition.from + (finalText?.length || 0),
      focus: composition.from + (finalText?.length || 0)
    };
    if (composition.invalidated || composition.deferredPatch || composition.deferredPage) {
      if (!applyDeferredEditableCompositionPage(state, composition, { restoreSelection })) {
        refreshAfterEditableComposition(state, originalSelection, { restoreSelection });
      }
      return false;
    }
    if (composition.cancelled || finalText === null
      || state.body !== composition.baseSource
      || !semanticModeEditable(state)) {
      refreshAfterEditableComposition(state, originalSelection, { restoreSelection });
      return false;
    }
    if (finalText === composition.baseSource.slice(composition.from, composition.to)) {
      refreshAfterEditableComposition(state, finalSelection, { restoreSelection });
      return false;
    }
    const transactionMetadata = {
      commandKind: 'composition',
      compositionId: composition.id
    };
    const tableResult = applyEditableTableCellTextInput(
      state,
      { anchor: composition.from, focus: composition.to },
      finalText,
      {
        inputType: 'insertCompositionText',
        timestamp: composition.timestamp,
        normalizeLineBreaks: true,
        coalesceHistory: false,
        restoreSelection,
        transactionMetadata
      }
    );
    if (tableResult) {
      if (!tableResult.changed) {
        refreshAfterEditableComposition(state, originalSelection, { restoreSelection });
        return false;
      }
      return true;
    }
    return replaceSemanticSourceRange(
      state,
      composition.from,
      composition.to,
      finalText,
      {
        afterSelection: finalSelection,
        beforeSelection: originalSelection,
        inputType: 'insertCompositionText',
        timestamp: composition.timestamp,
        coalesceHistory: false,
        restoreSelection,
        transactionMetadata
      }
    );
  }

  function scheduleEditableCompositionSettlement(state, event = null) {
    const composition = state?.editableComposition;
    if (!composition) return false;
    if (typeof event?.data === 'string') {
      composition.latestText = event.data;
      composition.cancelled = event.data.length === 0;
    }
    composition.ending = true;
    if (composition.settleTimer !== null) return true;
    composition.settleTimer = root.setTimeout?.(() => {
      if (state.editableComposition === composition) {
        const ownerRoot = composition.ownerRoot;
        const ownerStillFocused = editableBodyRootIsCurrent(state, ownerRoot)
          && (!('activeElement' in document)
            || document.activeElement === ownerRoot
            || ownerRoot.contains?.(document.activeElement));
        settleEditableComposition(state, null, {
          restoreSelection: ownerStillFocused
        });
      }
    }, 0) ?? null;
    if (composition.settleTimer === null) settleEditableComposition(state);
    return true;
  }

  function startEditableComposition(state) {
    if (!state?.editableProjection || !semanticModeEditable(state)) return null;
    if (state.editableComposition?.invalidated) {
      settleEditableComposition(state, null, {
        restoreSelection: false,
        armTail: false
      });
      return null;
    }
    if (state.editableComposition) return state.editableComposition;
    clearEditableCompositionTail(state);
    const selection = captureSemanticSelection(state.bodyRoot)
      || { anchor: state.body.length, focus: state.body.length };
    const normalized = normalizedMarkdownEditSelection(
      state.body,
      selection,
      state.body.length
    );
    const composition = {
      id: `composition-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      baseSource: state.body,
      baseSourceVersion: state.sourceVersion,
      beforeSelection: normalized,
      from: Math.min(normalized.anchor, normalized.focus),
      to: Math.max(normalized.anchor, normalized.focus),
      latestText: null,
      cancelled: false,
      invalidated: false,
      ending: false,
      settleTimer: null,
      deferredPage: null,
      deferredPatch: null,
      ownerRoot: state.bodyRoot,
      pageId: state.page?.id || state.page?.pageId || null,
      timestamp: Date.now()
    };
    state.semanticCompositionPending = true;
    state.editableComposition = composition;
    state.pendingEditTransaction = null;
    return composition;
  }

  function applySemanticNewlineInput(state, {
    inputType = 'insertParagraph',
    timestamp = null
  } = {}) {
    const selection = captureSemanticSelection(state?.bodyRoot);
    if (!selection) return false;
    if (typeof model?.applyMarkdownNewline !== 'function') return false;
    const result = model.applyMarkdownNewline(state.body, selection, { inputType });
    if (!result?.changed || result.source === state.body) return false;
    const difference = sourceDifference(state.body, result.source);
    return replaceSemanticSourceRange(
      state,
      difference.start,
      difference.previousEnd,
      result.source.slice(difference.start, difference.nextEnd),
      {
        afterSelection: result.selection,
        beforeSelection: selection,
        inputType,
        timestamp,
        transactionMetadata: {
          commandKind: result.transaction?.transactionKind || 'newline',
          primaryEdit: result.primaryEdits || null,
          renumberEdits: result.renumberEdits || [],
          affectedLineIds: result.affectedPhysicalLineIds || [],
          structural: result.transaction?.structural === true,
          listTransform: result.transaction?.listTransform === true
        }
      }
    );
  }

  function armSemanticNewlineBeforeInputGuard(state, inputType) {
    const token = {};
    state.semanticNewlineKeydownGuard = { token, inputType };
    root.setTimeout?.(() => {
      if (state.semanticNewlineKeydownGuard?.token === token) {
        state.semanticNewlineKeydownGuard = null;
      }
    }, 0);
  }

  function editableTableVerticalArrowTarget(state, current, key, shiftKey = false) {
    if (!current || !['ArrowUp', 'ArrowDown'].includes(key)) return null;
    const context = editableTableCellEditContext(
      state,
      numericProjectionSelection(current)
    );
    if (!context || context.blocked || !context.cell) return null;
    if (shiftKey) return { handled: true, target: current.focus };
    const rows = [context.table.header, ...context.table.rows];
    const rowPosition = context.cell.header ? 0 : context.cell.rowIndex + 1;
    const targetRow = rows[rowPosition + (key === 'ArrowUp' ? -1 : 1)] || null;
    if (targetRow) {
      const targetCell = targetRow[context.cell.columnIndex]
        || targetRow[targetRow.length - 1]
        || null;
      if (!targetCell) return { handled: true, target: current.focus };
      const relative = clamp(
        current.focus.offset - context.cell.start,
        0,
        context.cell.end - context.cell.start
      );
      return {
        handled: true,
        target: projectionPositionAtOffset(
          state.editableProjection,
          targetCell.start + Math.min(relative, targetCell.end - targetCell.start),
          'after'
        )
      };
    }
    const outside = key === 'ArrowUp'
      ? [...state.editableProjection.enumerateDeclaredPositions()].reverse().find((position) => (
        position.offset < context.table.start
        && position.visibility === 'visible'
        && !String(position.interactionPolicy || '').startsWith('activate-')
      ))
      : state.editableProjection.enumerateDeclaredPositions().find((position) => (
        position.offset > context.table.end
        && position.visibility === 'visible'
        && !String(position.interactionPolicy || '').startsWith('activate-')
      ));
    return { handled: true, target: outside || current.focus };
  }

  function applySemanticArrowNavigation(state, event) {
    if (!state?.bodyRoot || event?.metaKey || event?.ctrlKey || event?.altKey) return false;
    const projection = state.editableProjection;
    const current = projection?.getSelection();
    const key = event?.key;
    if (!projection || !current
      || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return false;
    const declared = projection.enumerateDeclaredPositions();
    const positionIndex = (position) => declared.findIndex((candidate) => (
      editableProjectionRuntime.samePosition(candidate, position)
    ));
    let origin = current.focus;
    let collapseOnly = false;
    if (!event.shiftKey && !current.collapsed) {
      const anchorIndex = positionIndex(current.anchor);
      const focusIndex = positionIndex(current.focus);
      origin = key === 'ArrowLeft' || key === 'ArrowUp'
        ? declared[Math.min(anchorIndex, focusIndex)]
        : declared[Math.max(anchorIndex, focusIndex)];
      collapseOnly = key === 'ArrowLeft' || key === 'ArrowRight';
    }
    const vertical = key === 'ArrowUp' || key === 'ArrowDown';
    const preferredX = vertical
      ? (Number.isFinite(state.semanticArrowColumn)
        ? state.semanticArrowColumn
        : projection.preferredXFor(origin))
      : null;
    const tableVertical = vertical
      ? editableTableVerticalArrowTarget(state, current, key, event.shiftKey)
      : null;
    const target = tableVertical?.handled
      ? tableVertical.target
      : vertical
        ? projection.moveVertical(origin, key === 'ArrowUp' ? 'up' : 'down', preferredX)
      : collapseOnly
        ? origin
        : projection.moveHorizontal(origin, key === 'ArrowLeft' ? 'left' : 'right');
    if (!target) return false;
    event.preventDefault();
    event.stopPropagation();
    clearMarkdownClipboardSelection({ state });
    const next = { anchor: event.shiftKey ? current.anchor : target, focus: target };
    const visible = ensureEditableSelectionVisible(state, next, { direction: key });
    if (!visible || !state.editableProjection.restoreSelection(visible)) return false;
    markMarkdownEditHistorySelectionBoundary(state.editHistory, numericProjectionSelection({
      sourceVersion: state.sourceVersion,
      ...visible
    }));
    state.semanticArrowColumn = vertical ? preferredX : null;
    updateLiveMarkerVisibility(state);
    return true;
  }

  function updateLiveMarkerVisibility(state) {
    if (state.editableComposition
      || !state.editableProjection
      || state.mode !== 'live-preview') return;
    const selection = state.editableProjection.getSelection();
    if (!selection) {
      clearEditableLiveActiveState(state);
      return;
    }
    const active = editableActiveStateForSelection(state, selection);
    if (!installEditableActiveState(state, active.ownerIds, active.lineIds)) return;
    refreshEditableProjection(state);
    const restored = remapEditableSelection(state, active.positions);
    const visible = restored
      ? ensureEditableSelectionVisible(state, restored)
      : null;
    if (visible) state.editableProjection.restoreSelection(visible);
  }

  function clearSemanticSelectionListener(state) {
    if (!state.semanticSelectionListener) return;
    document.removeEventListener('selectionchange', state.semanticSelectionListener);
    state.semanticSelectionListener = null;
  }

  function installSemanticSelectionListener(state) {
    clearSemanticSelectionListener(state);
    state.semanticSelectionListener = () => {
      // DOM reconciliation and programmatic caret restoration also dispatch
      // selectionchange. Treating those as user navigation split every edit
      // into its own Undo group in the real Chromium runtime. Arrow keys and
      // pointer gestures mark explicit history boundaries at their trusted
      // event owners, so this listener remains presentation-only.
      updateLiveMarkerVisibility(state);
    };
    document.addEventListener('selectionchange', state.semanticSelectionListener);
  }

  function restoreSemanticEdit(state) {
    if (typeof state.semanticFocusOriginalBody !== 'string') return false;
    installSourceSnapshot(state, state.semanticFocusOriginalBody);
    state.modeExtentFloor = null;
    state.semanticFocusOriginalBody = null;
    restoreMarkdownEditHistorySnapshot(state.editHistory, state.semanticFocusHistorySnapshot);
    synchronizeMarkdownEditHistory(state.editHistory, state.body);
    state.semanticFocusHistorySnapshot = null;
    state.pendingEditTransaction = null;
    state.semanticDirty = false;
    notifySemanticBodyInput(state);
    commitBody(state, 'cancel');
    renderState(state);
    return true;
  }

  function configureSemanticBlock(state, blockState) {
    const wrapper = blockState.element;
    wrapper.dataset.markdownBlockIndex = String(state.semanticBlocks.length);
    wrapper.dataset.markdownSourceStart = String(blockState.start);
    wrapper.dataset.markdownSourceEnd = String(blockState.end);
    wrapper.setAttribute('aria-label', 'Markdown block');
  }

  function updateSemanticEditorMode(state) {
    if (!state.layer) return;
    ['reading', 'live-preview', 'source'].forEach((mode) => {
      state.layer.classList.toggle(`is-${mode}`, state.mode === mode);
    });
    const editable = semanticModeEditable(state);
    if (!markdownTableInteractionEnabled(state)) {
      clearMarkdownTableContextAnchor(state);
    }
    if (state.bodyRoot) {
      state.bodyRoot.contentEditable = editable ? 'true' : 'false';
      state.bodyRoot.spellcheck = editable;
      state.bodyRoot.tabIndex = 0;
      state.bodyRoot.setAttribute('role', 'textbox');
      state.bodyRoot.setAttribute('aria-multiline', 'true');
      state.bodyRoot.setAttribute('aria-label', 'Markdown document');
      state.bodyRoot.setAttribute('aria-readonly', String(!editable));
    }
    if (!editable) {
      if (activeCodeLanguageMenu) closeCodeLanguageMenu();
      clearEditableLiveActiveState(state, {
        refresh: state.mode === 'live-preview' && Boolean(state.editableProjection)
      });
      return;
    }
    updateLiveMarkerVisibility(state);
  }

  function renderSemanticDocument(state, bodyRoot) {
    if (state.mode === 'reading') {
      state.editableProjection = null;
      state.editablePresentationPlan = null;
      state.linkArrowController.reconcile({
        state,
        mode: 'reading',
        links: [],
        anchors: []
      });
      renderSemanticDocumentBlocks(state, bodyRoot);
    } else renderEditableDocumentBlocks(state, bodyRoot);
    bodyRoot.addEventListener('pointerdown', (event) => {
      const editablePrimaryMouse = semanticModeEditable(state)
        && Boolean(state.editableProjection)
        && primaryMouseTextPointer(event);
      if (editablePrimaryMouse) {
        // Record pointer identity before presentation/control guards. A prior
        // canonical anchor may legitimately continue even when first-click
        // reflow moves the second physical point over a semantic control.
        state.pendingSemanticMousePointer = Object.freeze({
          bodyRoot,
          pointerId: event.pointerId,
          paneId: state.paneId || null,
          tabId: state.tabId || null,
          pageId: state.page?.id || state.page?.pageId || null
        });
      }
      const structuralFoldTrigger = event.target?.closest?.(
        '[data-markdown-structural-fold-trigger]'
      );
      if (structuralFoldTrigger) return;
      const semanticControl = event.target?.closest?.(
        '[data-markdown-semantic-control="true"], '
        + '.markdown-table-add-control, .markdown-code-language-control, '
        + '.markdown-page-link-navigation, .task-list-item .filter-checkbox'
      );
      if (semanticControl) return;
      if (semanticModeEditable(state) && state.editableProjection
        && (event.button === undefined || event.button === 0)
        && !markdownContextMenuPointer(event)) {
        if (editablePrimaryMouse) {
          event.stopPropagation();
          return;
        }
        beginCanonicalMarkdownPointerSelection(state, bodyRoot, event);
        return;
      }
      if (handleMarkdownTablePointerDown(state, event)) return;
      if (event.target?.closest?.('.markdown-code-language-control')) return;
      if (event.target?.closest?.('.markdown-page-link-navigation')) return;
      if (event.target?.closest?.('.task-list-item .filter-checkbox')) return;
      if (semanticModeEditable(state)) {
        state.semanticArrowColumn = null;
        beginMarkdownSelectionGesture(state, 'body', bodyRoot, event);
      } else if (state.mode === 'reading' && !state.pageEditMode
        && !markdownContextMenuPointer(event)) {
        bodyRoot.focus({ preventScroll: true });
      }
    }, true);
    bodyRoot.addEventListener('mousedown', (event) => {
      const detail = Math.max(1, Math.trunc(finiteNumber(event.detail, 1)));
      const continuingSequence = detail >= 2
        && Boolean(currentMarkdownMultiClickAnchorPosition(state, bodyRoot));
      if (!continuingSequence) {
        const structuralFoldTrigger = event.target?.closest?.(
          '[data-markdown-structural-fold-trigger]'
        );
        if (structuralFoldTrigger) {
          clearMarkdownMultiClickAnchor(state);
          return;
        }
        const semanticControl = event.target?.closest?.(
          '[data-markdown-semantic-control="true"], '
          + '.markdown-table-add-control, .markdown-code-language-control, '
          + '.markdown-page-link-navigation, .task-list-item .filter-checkbox'
        );
        if (semanticControl) {
          clearMarkdownMultiClickAnchor(state);
          return;
        }
      }
      handleMarkdownTextMouseDown(state, bodyRoot, event);
    }, true);
    bodyRoot.addEventListener('pointerdown', (event) => {
      if (event.target?.closest?.('.markdown-page-table-shell')) return;
      if (event.target?.closest?.('.markdown-code-language-control')) return;
      if (event.target?.closest?.('.markdown-page-link-navigation')) return;
      if (event.target?.closest?.('.task-list-item .filter-checkbox')) {
        event.stopPropagation();
        return;
      }
      if (!semanticModeEditable(state)) return;
      stopEditorPointer(event);
    });
    bodyRoot.addEventListener('click', (event) => {
      if (handleMarkdownTableClick(state, event)) return;
      if (event.target?.closest?.('.markdown-code-language-control')) return;
      if (event.target?.closest?.('.markdown-page-link-navigation')) return;
      if (event.target?.closest?.('.task-list-item .filter-checkbox')) {
        event.stopPropagation();
        return;
      }
      if (semanticModeEditable(state)) stopEditorPointer(event);
    });
    bodyRoot.addEventListener('contextmenu', (event) => {
      openMarkdownTableContextMenu(state, event);
    });
    bodyRoot.addEventListener('focus', () => {
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      clearEditableCompositionTail(state);
      if (semanticModeEditable(state)
        && typeof state.semanticFocusOriginalBody !== 'string') {
        state.semanticFocusOriginalBody = state.body;
        state.semanticFocusHistorySnapshot = snapshotMarkdownEditHistory(state.editHistory);
      }
      updateLiveMarkerVisibility(state);
    });
    bodyRoot.addEventListener('compositionstart', () => {
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      startEditableComposition(state);
    });
    bodyRoot.addEventListener('compositionupdate', (event) => {
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      const composition = state.editableComposition;
      if (!composition || typeof event?.data !== 'string') return;
      composition.latestText = event.data;
      composition.cancelled = false;
    });
    bodyRoot.addEventListener('compositionend', (event) => {
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      if (!state.editableComposition && state.editableCompositionTail?.bodyRoot === bodyRoot) {
        return;
      }
      state.semanticCompositionPending = false;
      if (scheduleEditableCompositionSettlement(state, event)) return;
      syncSemanticDocumentInput(state, event, { forceRender: true });
    });
    bodyRoot.addEventListener('beforeinput', (event) => {
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      if (consumeEditableCompositionTail(state, bodyRoot, event)) return;
      if (!semanticModeEditable(state)) return;
      state.semanticArrowColumn = null;
      if ((event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak')
        && root.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
          event,
          bodyRoot,
          document.activeElement,
          Boolean(state.semanticCompositionPending || state.editableComposition)
        )) return;
      if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
        event.preventDefault();
        event.stopPropagation();
        const guard = state.semanticNewlineKeydownGuard;
        if (guard) {
          state.semanticNewlineKeydownGuard = null;
          return;
        }
        if (editableTableCellEditContext(
          state,
          captureSemanticSelection(state.bodyRoot)
        )) return;
        state.pendingEditTransaction = {
          beforeSource: state.body,
          beforeSelection: markdownSelectionForState(state),
          inputType: event.inputType,
          timestamp: Date.now()
        };
        applySemanticNewlineInput(state, {
          inputType: event.inputType,
          timestamp: state.pendingEditTransaction.timestamp
        });
        return;
      }
      if ((event.inputType === 'insertCompositionText'
          || event.inputType === 'insertFromComposition')
        && (event.isComposing || state.editableComposition)) {
        const composition = state.editableComposition || startEditableComposition(state);
        if (!composition) return;
        composition.latestText = typeof event.data === 'string' ? event.data : '';
        composition.cancelled = false;
        event.stopPropagation();
        // Chromium owns the provisional replacement range. Rebuilding even an
        // exact projection here detaches that native range and makes successive
        // candidate updates append instead of replace. Publish once below at
        // the composition boundary, matching the HN source editor lifecycle.
        if (event.isComposing && !composition.ending) return;
        event.preventDefault();
        settleEditableComposition(state, event);
        return;
      }
      if (state.editableComposition
        && event.inputType === 'insertText'
        && typeof event.data === 'string') {
        event.preventDefault();
        event.stopPropagation();
        settleEditableComposition(state, event);
        return;
      }
      if (event.isComposing) return;
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        event.stopPropagation();
        applyMarkdownEditHistory(
          state,
          event.inputType === 'historyRedo' ? 'redo' : 'undo'
        );
        return;
      }
      if (state.editableProjection
        && (event.inputType === 'deleteContentBackward'
          || event.inputType === 'deleteContentForward')) {
        event.preventDefault();
        event.stopPropagation();
        if (applyEditableTableCellDeletion(
          state,
          event.inputType.endsWith('Forward') ? 'forward' : 'backward'
        )) return;
        applyMarkdownDeletionShortcut(
          state,
          event.inputType.endsWith('Forward') ? 'forward' : 'backward'
        );
        return;
      }
      state.pendingEditTransaction = {
        beforeSource: state.body,
        beforeSelection: markdownSelectionForState(state),
        inputType: event.inputType || 'insertText',
        timestamp: Date.now()
      };
      const exactText = exactSemanticTextInsertion(event);
      if (exactText == null) return;
      const selection = captureSemanticSelection(state.bodyRoot);
      if (!selection) return;
      const tableResult = applyEditableTableCellTextInput(
        state,
        selection,
        exactText,
        {
          inputType: event.inputType,
          timestamp: state.pendingEditTransaction?.timestamp
        }
      );
      if (tableResult) {
        event.preventDefault();
        state.pendingEditTransaction = null;
        return;
      }
      const insertion = markdownTextInsertionEdit(state.body, selection, exactText);
      event.preventDefault();
      replaceSemanticSourceRange(
        state,
        insertion.start,
        insertion.end,
        insertion.replacement,
        {
          afterSelection: insertion.selection,
          beforeSelection: selection,
          inputType: event.inputType,
          timestamp: state.pendingEditTransaction?.timestamp
        }
      );
    });
    bodyRoot.addEventListener('input', (event) => {
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      if (state.editableComposition) return;
      syncSemanticDocumentInput(state, event);
    });
    bodyRoot.addEventListener('keydown', (event) => {
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      if (state.editableCompositionTail?.bodyRoot === bodyRoot) {
        clearEditableCompositionTail(state);
      }
      if (event.key === 'Escape' && state.tableContextMenuToken) {
        event.preventDefault();
        event.stopPropagation();
        clearMarkdownTableContextAnchor(state);
        return;
      }
      if (!semanticModeEditable(state)) return;
      if (root.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
        event,
        bodyRoot,
        document.activeElement,
        Boolean(state.semanticCompositionPending || state.editableComposition)
      )) return;
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      const modifierOnlyKey = ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key);
      const navigationKey = [
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        'Home', 'End', 'PageUp', 'PageDown'
      ].includes(event.key);
      if (navigationKey
        || (!modifierOnlyKey && !event.metaKey && !event.ctrlKey && !event.altKey)) {
        clearMarkdownClipboardSelection({ state });
      }
      if (applySemanticArrowNavigation(state, event)) return;
      state.semanticArrowColumn = null;
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (applyEditableTableCellTabNavigation(state, event.shiftKey)) {
          event.preventDefault();
          return;
        }
        if (document.activeElement === bodyRoot && stateOwnsActivePane(state)) {
          event.preventDefault();
          applyMarkdownIndentationShortcut(
            state,
            event.shiftKey ? 'outdent' : 'indent'
          );
        }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        commitBody(state, 'shortcut');
        state.semanticFocusOriginalBody = state.body;
        state.semanticFocusHistorySnapshot = snapshotMarkdownEditHistory(state.editHistory);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        restoreSemanticEdit(state);
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        if (applyEditableTableCellDeletion(
          state,
          event.key === 'Delete' ? 'forward' : 'backward'
        )) {
          event.preventDefault();
          return;
        }
        if (applyMarkdownDeletionShortcut(
          state,
          event.key === 'Delete' ? 'forward' : 'backward'
        )) event.preventDefault();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const inputType = event.shiftKey ? 'insertLineBreak' : 'insertParagraph';
        if (editableTableCellEditContext(
          state,
          captureSemanticSelection(state.bodyRoot)
        )) {
          armSemanticNewlineBeforeInputGuard(state, inputType);
          return;
        }
        if (applySemanticNewlineInput(state, { inputType })) {
          armSemanticNewlineBeforeInputGuard(state, inputType);
        }
      }
    });
    bodyRoot.addEventListener('focusout', () => {
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      if (!semanticModeEditable(state)) return;
      settleEditableComposition(state, null, { restoreSelection: false });
      if (!editableBodyRootIsCurrent(state, bodyRoot)) return;
      if (markdownSelectionGestureOwnsEditor(bodyRoot)) {
        root.requestAnimationFrame(() => {
          if (markdownSelectionGestureOwnsEditor(bodyRoot) && bodyRoot.isConnected) {
            bodyRoot.focus({ preventScroll: true });
          }
        });
        return;
      }
      root.requestAnimationFrame(() => {
        if (state.bodyRoot !== bodyRoot || bodyRoot.contains(document.activeElement)) return;
        clearMarkdownMultiClickAnchor(state);
        clearEditableLiveActiveState(state);
        if (typeof state.semanticFocusOriginalBody !== 'string') return;
        state.semanticFocusOriginalBody = null;
        state.semanticFocusHistorySnapshot = null;
        commitBody(state, 'blur');
      });
    });
    updateSemanticEditorMode(state);
    installSemanticSelectionListener(state);
  }

  function createTitle(state) {
    const title = structuredTextShell.createBoundTitle({
      stage: state.stage,
      page: state.page,
      pageId: state.page?.id || state.page?.pageId || null,
      paneId: state.paneId,
      tabId: state.tabId,
      title: state.page?.title || 'Untitled',
      editable: !state.pageEditMode && !state.bodyReadOnly,
      onPointerDown: (event) => {
        beginMarkdownSelectionGesture(state, 'title', title, event);
        stopEditorPointer(event);
      },
      onClick: stopEditorPointer,
      retainFocusOnBlur: () => markdownSelectionGestureOwnsEditor(title),
      onCommit: (detail) => invoke(state.onTitleCommit, detail),
      onResolvedTitle: (resolvedTitle, canonicalPage) => {
        state.page = {
          ...state.page,
          ...(canonicalPage?.id === state.page?.id ? canonicalPage : {}),
          title: resolvedTitle
        };
      }
    });
    title.dataset.markdownRole = 'title';
    return title;
  }

  function createFrameBoundary(state) {
    const boundary = structuredTextShell.createFrameBoundary({
      className: 'markdown-page-frame-boundary',
      handles: true,
      handleClassName: 'markdown-page-frame-handle',
      handleDatasetName: 'markdownFrameSide',
      frameEditor: {
        enabled: () => state.pageEditMode && (
          typeof state.frameBoundaryInteractionEnabled === 'function'
            ? state.frameBoundaryInteractionEnabled() === true
            : state.frameBoundaryInteractionEnabled !== false
        ),
        getFrame: () => state.textFrame,
        getZoom: () => state.zoom,
        setFrame: (nextFrame) => {
          state.textFrame = textFrameForPage({ textFrame: nextFrame });
          applyLayerGeometry(state);
          updateDocumentExtent(state);
        },
        onInput: (nextFrame, detail) => invoke(state.onTextFrameInput, nextFrame, {
          ...detail,
          page: state.page,
          paneId: state.paneId,
          tabId: state.tabId
        }),
        onCommit: (nextFrame, detail) => invoke(state.onTextFrameCommit, nextFrame, {
          ...detail,
          page: state.page,
          paneId: state.paneId,
          tabId: state.tabId
        })
      }
    });
    state.frameBoundary = boundary;
    return boundary;
  }

  function createDocumentExtentElement() {
    const extent = createElement('div', 'markdown-page-document-extent');
    extent.setAttribute('aria-hidden', 'true');
    return extent;
  }

  function normalizedObjectBounds(bounds) {
    if (!bounds || typeof bounds !== 'object') return null;
    const minX = Number(bounds.minX);
    const minY = Number(bounds.minY);
    const maxX = Number(bounds.maxX);
    const maxY = Number(bounds.maxY);
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    return {
      minX,
      minY,
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY)
    };
  }

  function computedPixelValue(element, propertyName, fallback) {
    if (!element || typeof root.getComputedStyle !== 'function') return fallback;
    const value = Number.parseFloat(root.getComputedStyle(element)[propertyName]);
    return Number.isFinite(value) ? value : fallback;
  }

  function intrinsicDocumentMeasurement(state) {
    const surface = state.documentSurface;
    if (!surface) {
      return {
        contentBottom: DOCUMENT_TOP,
        bottomPadding: DOCUMENT_BOTTOM_PADDING,
        naturalHeight: 1
      };
    }
    const bottomPadding = Math.max(
      0,
      computedPixelValue(surface, 'paddingBottom', DOCUMENT_BOTTOM_PADDING)
    );
    const contentNodes = [state.titleElement, state.bodyRoot].filter(Boolean);
    const nodeBottom = contentNodes.reduce((bottom, node) => Math.max(
      bottom,
      finiteNumber(node.offsetTop, 0)
        + Math.max(finiteNumber(node.offsetHeight, 0), finiteNumber(node.scrollHeight, 0))
    ), DOCUMENT_TOP);
    const surfaceHeightWithoutBottomPadding = Math.max(
      DOCUMENT_TOP,
      Math.max(finiteNumber(surface.scrollHeight, 0), finiteNumber(surface.offsetHeight, 0))
        - bottomPadding
    );
    const contentBottom = Math.max(nodeBottom, surfaceHeightWithoutBottomPadding);
    return {
      contentBottom,
      bottomPadding,
      naturalHeight: Math.max(1, contentBottom + bottomPadding - DOCUMENT_TOP)
    };
  }

  function updateMarkdownVisualFrameExtent(state, documentExtent = state?.documentExtent) {
    if (!state) return null;
    const areaRect = state.area?.getBoundingClientRect?.();
    const viewportHeight = Math.max(
      0,
      finiteNumber(state.area?.clientHeight, finiteNumber(areaRect?.height, 0))
    );
    const visual = calculateMarkdownVisualFrameExtent({
      documentTop: finiteNumber(documentExtent?.top, DOCUMENT_TOP),
      documentBottom: finiteNumber(documentExtent?.bottom, DOCUMENT_TOP),
      viewportHeight,
      scale: state.zoom,
      cameraOffsetY: state.cameraOffsetY
    });
    state.visualFrameExtent = visual;
    if (state.frameBoundary) {
      state.frameBoundary.style.height = `${visual.height}px`;
      state.frameBoundary.dataset.visualFrameBottom = String(visual.bottom);
      state.frameBoundary.dataset.documentBottom = String(visual.documentBottom);
      state.frameBoundary.dataset.viewportWorldBottom = String(visual.viewportWorldBottom);
      state.frameBoundary.dataset.contentBottom = String(finiteNumber(
        documentExtent?.contentBottom,
        DOCUMENT_TOP
      ));
      state.frameBoundary.dataset.objectBottom = String(finiteNumber(
        documentExtent?.objectBottom,
        DOCUMENT_TOP
      ));
    }
    if (state.layer) {
      state.layer.dataset.visualFrameBottom = String(visual.bottom);
      state.layer.dataset.documentBottom = String(visual.documentBottom);
      state.layer.dataset.paneViewportHeight = String(visual.viewportHeight);
      state.layer.dataset.viewportWorldBottom = String(visual.viewportWorldBottom);
      state.layer.dataset.contentBottom = String(finiteNumber(
        documentExtent?.contentBottom,
        DOCUMENT_TOP
      ));
      state.layer.dataset.objectBottom = String(finiteNumber(
        documentExtent?.objectBottom,
        DOCUMENT_TOP
      ));
      state.layer.dataset.documentBottomPadding = String(finiteNumber(
        documentExtent?.bottomPadding,
        DOCUMENT_BOTTOM_PADDING
      ));
    }
    return visual;
  }

  function updateDocumentExtent(state, { notify = true, forceNotify = false } = {}) {
    if (!state?.extentElement) return null;
    const measurement = intrinsicDocumentMeasurement(state);
    const objects = normalizedObjectBounds(state.objectBounds);
    const extent = calculateMarkdownDocumentExtent({
      documentTop: DOCUMENT_TOP,
      contentBottom: measurement.contentBottom,
      objectBottom: objects?.maxY,
      bottomPadding: measurement.bottomPadding,
      minimumHeight: MIN_DOCUMENT_HEIGHT,
      provisionalBottom: Math.max(
        finiteNumber(state.provisionalBottom, DOCUMENT_TOP),
        finiteNumber(state.modeExtentFloor, DOCUMENT_TOP)
      )
    });
    const frameGeometry = textFrameEdges(state.textFrame);
    const frameLeft = frameGeometry.leftWorld;
    const frameRight = frameGeometry.rightWorld;
    const left = Math.min(frameLeft, objects?.minX ?? frameLeft);
    const right = Math.max(frameRight, objects?.maxX ?? frameRight);
    const next = {
      ...extent,
      modeContentBottom: Math.max(
        DOCUMENT_TOP + MIN_DOCUMENT_HEIGHT,
        measurement.contentBottom
      ) + measurement.bottomPadding,
      left,
      right,
      width: Math.max(1, right - left)
    };
    const previous = state.documentExtent;
    state.documentExtent = next;
    state.extentElement.style.left = `${next.left}px`;
    state.extentElement.style.top = `${next.top}px`;
    state.extentElement.style.width = `${next.width}px`;
    state.extentElement.style.height = `${next.height}px`;
    if (state.layer) {
      // Keep intrinsic content measurement independent from the visual column.
      // The layer owns the full world-space document height, while the article
      // remains content-sized so a removed or raised Object can shrink it again.
      state.layer.style.height = `${next.height}px`;
      state.layer.style.minHeight = `${measurement.naturalHeight}px`;
    }
    updateMarkdownVisualFrameExtent(state, next);
    const changed = !previous
      || ['left', 'right', 'top', 'bottom'].some(
        (key) => Math.abs(finiteNumber(previous[key], 0) - finiteNumber(next[key], 0)) >= 0.5
      );
    if (notify && (changed || forceNotify)) {
      invoke(state.onDocumentExtentChange, {
        ...next,
        page: state.page,
        paneId: state.paneId
      });
    }
    return next;
  }

  function observeDocumentSurface(state) {
    state.contentResizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'function' || !state.documentSurface) return;
    state.contentResizeObserver = new ResizeObserver(() => {
      reconcileEditableQuoteRailOverlay(state);
      updateDocumentExtent(state);
    });
    state.contentResizeObserver.observe(state.documentSurface);
  }

  function applyLayerGeometry(state) {
    const geometry = textFrameEdges(state.textFrame);
    state.layer.style.width = `${geometry.worldWidth}px`;
    // Keep the text-rendering subtree free of transforms. The camera host owns
    // screen-space translation and the world host owns layout-aware zoom, so
    // the document itself can use its explicit world-space left edge.
    state.layer.style.left = `${geometry.leftWorld}px`;
    state.layer.style.setProperty('--markdown-document-width', `${geometry.worldWidth}px`);
    state.layer.dataset.centerWorldX = String(geometry.centerWorldX);
    state.layer.dataset.leftWorld = String(geometry.leftWorld);
    state.layer.dataset.rightWorld = String(geometry.rightWorld);
    state.layer.dataset.worldWidth = String(geometry.worldWidth);
  }

  function renderState(state) {
    clearMarkdownTableContextAnchor(state);
    structuredTextShell?.cancelFrameBoundaryDrags?.(state.frameBoundary);
    clearMarkdownClipboardSelection({ clearBrowserSelection: true, state });
    structuredTextShell?.destroyBoundTitle?.(state.titleElement);
    if (!state.extentElement.isConnected && state.worldLayer?.isConnected) {
      state.worldLayer.append(state.extentElement);
    }
    if (!state.layer.isConnected && state.worldLayer?.isConnected) {
      state.worldLayer.append(state.layer);
    }
    clearSemanticSelectionListener(state);
    state.semanticFocusOriginalBody = null;
    state.semanticFocusHistorySnapshot = null;
    state.pendingEditTransaction = null;
    installSourceSnapshot(
      state,
      typeof state.body === 'string' ? state.body : String(state.page?.markdownBody || '')
    );
    synchronizeMarkdownEditHistory(state.editHistory, state.body);
    state.linkArrowController?.detach?.();
    state.layer.replaceChildren();
    state.layer.className = 'markdown-page-layer structured-text-page-frame';
    state.layer.classList.add(`is-${state.mode}`);
    state.layer.classList.toggle('is-page-edit-mode', Boolean(state.pageEditMode));
    state.layer.dataset.pageId = state.page?.id || state.page?.pageId || '';
    applyLayerGeometry(state);

    const documentSurface = createElement(
      'article',
      'markdown-page-document structured-text-page-surface'
    );
    state.documentSurface = documentSurface;
    if (state.pageEditMode) documentSurface.inert = true;
    const quoteRailLayer = createElement('div', 'markdown-editable-quote-rail-layer');
    quoteRailLayer.hidden = true;
    quoteRailLayer.contentEditable = 'false';
    quoteRailLayer.dataset.markdownSemanticOnly = 'true';
    quoteRailLayer.setAttribute('aria-hidden', 'true');
    state.quoteRailLayer = quoteRailLayer;
    documentSurface.append(quoteRailLayer);
    state.titleElement = createTitle(state);
    documentSurface.append(state.titleElement);
    const bodyRoot = createElement('div', 'markdown-page-body structured-text-page-body');
    state.bodyRoot = bodyRoot;
    bodyRoot.dataset.markdownRole = 'body';
    renderSemanticDocument(state, bodyRoot);
    state.semanticDirty = false;
    documentSurface.append(bodyRoot);
    state.layer.append(documentSurface);
    state.layer.append(createFrameBoundary(state));
    reconcileEditableQuoteRailOverlay(state);
    scheduleMarkdownStructuralFoldGeometryRefresh();
    updateDocumentExtent(state);
    observeDocumentSurface(state);
  }

  function renderMarkdownPageLayer(options = {}) {
    const { page, stage, area } = options;
    if (!pageIsMarkdown(page) || !(stage instanceof Element)) return null;
    const owningArea = area instanceof Element ? area : stage.parentElement;
    if (!(owningArea instanceof Element)) return null;
    destroyMarkdownPageLayer(stage);
    const presentationHost = createMarkdownPresentationHost(stage, owningArea);
    if (!presentationHost) return null;
    const layer = createElement('div', 'markdown-page-layer');
    const extentElement = createDocumentExtentElement();
    const initialBody = typeof page.markdownBody === 'string' ? page.markdownBody : '';
    const editHistory = markdownEditHistoryFor(
      options.historyOwner,
      page.id || page.pageId || null,
      initialBody
    );
    synchronizeMarkdownEditHistory(editHistory, initialBody);
    const state = {
      layer,
      extentElement,
      stage,
      cameraLayer: presentationHost.cameraLayer,
      worldLayer: presentationHost.worldLayer,
      area: owningArea,
      page,
      paneId: options.paneId || null,
      tabId: options.tabId || null,
      historyOwner: options.historyOwner || null,
      editHistory,
      body: initialBody,
      sourceVersion: 0,
      sourceSnapshot: null,
      editableProjection: null,
      editablePresentationPlan: null,
      quoteRailLayer: null,
      editableActiveOwnerIds: new Set(),
      editableActiveLineIds: new Set(),
      editableForcedRawOwnerIds: new Set(),
      editableActiveTableCell: null,
      editableTablePresentations: new Map(),
      editableTableReconciliationDiagnostics: null,
      linkArrowController: null,
      linkArrowAnchorSink: null,
      linkArrowDescriptorAtRange: null,
      markdownFoldDescriptors: normalizeMarkdownStructuralFoldDescriptors(
        options.markdownStructuralFolds
      ),
      markdownFoldCollapsedKeys: new Set(),
      markdownFoldIndex: null,
      markdownFoldVisibility: null,
      mode: normalizedMode(options.mode),
      zoom: finiteNumber(options.zoom, 1),
      cameraOffsetX: finiteNumber(options.cameraOffsetX, 0),
      cameraOffsetY: finiteNumber(options.cameraOffsetY, 0),
      pageEditMode: Boolean(options.pageEditMode),
      frameBoundaryInteractionEnabled: options.frameBoundaryInteractionEnabled,
      bodyReadOnly: Boolean(options.bodyReadOnly),
      textFrame: textFrameForPage(page),
      semanticBlocks: [],
      semanticDirty: false,
      semanticCompositionPending: false,
      editableComposition: null,
      editableCompositionTail: null,
      semanticNewlineKeydownGuard: null,
      semanticArrowColumn: null,
      pendingSemanticMousePointer: null,
      semanticMultiClickAnchor: null,
      semanticModeSelection: null,
      semanticFocusOriginalBody: null,
      semanticFocusHistorySnapshot: null,
      pendingEditTransaction: null,
      semanticSelectionListener: null,
      tableContextMenuToken: null,
      objectBounds: normalizedObjectBounds(options.objectBounds),
      provisionalBottom: Number.isFinite(Number(options.provisionalBottom))
        ? Number(options.provisionalBottom)
        : null,
      modeExtentFloor: null,
      documentExtent: null,
      visualFrameExtent: null,
      frameBoundary: null,
      onBodyInput: options.onBodyInput,
      onBodyCommit: options.onBodyCommit,
      onTitleCommit: options.onTitleCommit,
      onRecenter: options.onRecenter,
      onLinkActivate: options.onLinkActivate,
      onTextFrameInput: options.onTextFrameInput,
      onTextFrameCommit: options.onTextFrameCommit,
      onDocumentExtentChange: options.onDocumentExtentChange,
      onFoldStateChange: options.onFoldStateChange
    };
    state.linkArrowController = createLinkArrowController();
    layerStates.set(layer, state);
    stageStates.set(stage, state);
    liveStates.add(state);
    state.worldLayer.append(extentElement, layer);
    applyMarkdownPresentationGeometry(state);
    renderState(state);
    return layer;
  }

  function resolveLayerState(target) {
    if (!target) return null;
    if (stageStates.has(target)) return stageStates.get(target);
    if (layerStates.has(target)) return layerStates.get(target);
    if (target.closest) {
      const layer = target.closest('.markdown-page-layer');
      return layer ? layerStates.get(layer) || null : null;
    }
    return null;
  }

  function cancelMarkdownTableInteractionState(state) {
    return clearMarkdownTableContextAnchor(state);
  }

  function cancelMarkdownTableInteraction(target) {
    return cancelMarkdownTableInteractionState(resolveLayerState(target));
  }

  function focusMarkdownDocumentTitle(target, { selectAll = false } = {}) {
    const state = resolveLayerState(target);
    const title = state?.layer?.querySelector?.('[data-markdown-role="title"]');
    return structuredTextShell?.focusBoundTitle?.(title, { selectAll }) === true;
  }

  function updateMarkdownPageLayer(target, patch = {}) {
    const state = resolveLayerState(target);
    if (!state) return null;
    let compositionBoundaryRoot = null;
    const activeComposition = state.editableComposition;
    if (activeComposition) {
      const nextPage = patch.page && pageIsMarkdown(patch.page) ? patch.page : null;
      const nextPageId = nextPage?.id || nextPage?.pageId || null;
      const nextBody = nextPage
        ? (typeof nextPage.markdownBody === 'string' ? nextPage.markdownBody : '')
        : null;
      const differsFromCompositionBase = Boolean(nextPage)
        && (nextPageId !== activeComposition.pageId
          || nextBody !== activeComposition.baseSource);
      if (activeComposition.invalidated
        || activeComposition.deferredPatch
        || differsFromCompositionBase) {
        activeComposition.invalidated = true;
        activeComposition.cancelled = true;
        if (nextPage) activeComposition.deferredPage = nextPage;
        activeComposition.deferredPatch = {
          ...(activeComposition.deferredPatch || {}),
          ...patch
        };
        if (!activeComposition.deferredPatch.page && activeComposition.deferredPage) {
          activeComposition.deferredPatch.page = activeComposition.deferredPage;
        }
        return state.layer;
      }
    }
    if (state.editableComposition && (
      Object.hasOwn(patch, 'markdownStructuralFolds')
      || (Object.hasOwn(patch, 'mode')
        && normalizedMode(patch.mode) !== state.mode)
      || (Object.hasOwn(patch, 'pageEditMode')
        && Boolean(patch.pageEditMode) !== state.pageEditMode)
      || (Object.hasOwn(patch, 'bodyReadOnly')
        && Boolean(patch.bodyReadOnly) !== state.bodyReadOnly)
    )) {
      compositionBoundaryRoot = state.bodyRoot;
      settleEditableComposition(state, null, {
        restoreSelection: false
      });
    }
    let requiresRender = false;
    let requiresExtentUpdate = false;
    let requiresFrameUpdate = false;
    let requiresModeUpdate = false;
    let requiresPresentationUpdate = false;
    let modeSelection = null;
    let pageIdentityChanged = false;
    if (patch.page && pageIsMarkdown(patch.page)) {
      const previousPageId = state.page?.id || state.page?.pageId || null;
      const previousFrame = state.textFrame;
      const previousBody = state.body;
      state.page = patch.page;
      const nextPageId = state.page?.id || state.page?.pageId || null;
      const nextBody = typeof patch.page.markdownBody === 'string' ? patch.page.markdownBody : '';
      const nextFrame = textFrameForPage(patch.page);
      const bodyChanged = nextBody !== previousBody;
      const frameChanged = Math.abs(nextFrame.centerWorldX - previousFrame.centerWorldX) >= 0.01
        || Math.abs(nextFrame.preferredWidth - previousFrame.preferredWidth) >= 0.01;
      state.textFrame = nextFrame;
      if (previousPageId !== nextPageId) {
        pageIdentityChanged = true;
        state.semanticModeSelection = null;
        state.editableActiveOwnerIds = new Set();
        state.editableActiveLineIds = new Set();
        state.editableForcedRawOwnerIds = new Set();
        state.editableActiveTableCell = null;
        state.editablePresentationPlan = null;
        state.markdownFoldDescriptors = [];
        state.markdownFoldCollapsedKeys = new Set();
        state.markdownFoldIndex = null;
        state.markdownFoldVisibility = null;
        clearMarkdownTableContextAnchor(state);
      }
      structuredTextShell?.updateBoundTitle?.(state.titleElement, {
        page: patch.page,
        pageId: nextPageId,
        title: patch.page.title,
        editable: !state.pageEditMode && !state.bodyReadOnly
      });
      if (pageIdentityChanged || bodyChanged) {
        state.editHistory = markdownEditHistoryFor(
          state.historyOwner,
          patch.page.id || patch.page.pageId || null,
          nextBody
        );
        synchronizeMarkdownEditHistory(state.editHistory, nextBody);
        if (bodyChanged) state.modeExtentFloor = null;
        installSourceSnapshot(state, nextBody, {
          preserveIdentity: previousPageId === nextPageId
        });
        requiresRender = true;
      }
      if (frameChanged) requiresFrameUpdate = true;
    }
    if (Object.hasOwn(patch, 'markdownStructuralFolds')) {
      const nextFolds = normalizeMarkdownStructuralFoldDescriptors(
        patch.markdownStructuralFolds
      );
      if (!markdownStructuralFoldDescriptorsEqual(
        normalizeMarkdownStructuralFoldDescriptors(state.markdownFoldDescriptors),
        nextFolds
      )) {
        state.markdownFoldDescriptors = nextFolds;
        state.markdownFoldCollapsedKeys = new Set();
        state.markdownFoldIndex = null;
        state.markdownFoldVisibility = null;
        requiresRender = true;
      } else if (pageIdentityChanged) {
        state.markdownFoldDescriptors = nextFolds;
      }
    }
    if (Object.hasOwn(patch, 'mode')) {
      const mode = normalizedMode(patch.mode);
      if (mode !== state.mode) {
        clearMarkdownMultiClickAnchor(state);
        state.modeExtentFloor = Math.max(
          finiteNumber(state.modeExtentFloor, DOCUMENT_TOP),
          finiteNumber(state.documentExtent?.modeContentBottom, DOCUMENT_TOP)
        );
        clearMarkdownTableContextAnchor(state);
        state.editableActiveOwnerIds = new Set();
        state.editableActiveLineIds = new Set();
        state.editableForcedRawOwnerIds = new Set();
        state.editableActiveTableCell = null;
        const capturedModeSelection = captureSemanticSelection(state.bodyRoot);
        if (capturedModeSelection) state.semanticModeSelection = capturedModeSelection;
        modeSelection = capturedModeSelection || state.semanticModeSelection;
        if (state.semanticDirty) {
          commitBody(state, 'mode-change');
          if (typeof state.semanticFocusOriginalBody === 'string') {
            state.semanticFocusOriginalBody = state.body;
            state.semanticFocusHistorySnapshot = snapshotMarkdownEditHistory(state.editHistory);
          }
        }
        clearMarkdownClipboardSelection({ clearBrowserSelection: true, state });
        requiresModeUpdate = true;
        requiresRender = true;
      }
      state.mode = mode;
    }
    if (Object.hasOwn(patch, 'zoom')) {
      state.zoom = finiteNumber(patch.zoom, state.zoom);
      requiresPresentationUpdate = true;
    }
    if (Object.hasOwn(patch, 'cameraOffsetX')) {
      state.cameraOffsetX = finiteNumber(patch.cameraOffsetX, state.cameraOffsetX);
      requiresPresentationUpdate = true;
    }
    if (Object.hasOwn(patch, 'cameraOffsetY')) {
      state.cameraOffsetY = finiteNumber(patch.cameraOffsetY, state.cameraOffsetY);
      requiresPresentationUpdate = true;
    }
    if (Object.hasOwn(patch, 'objectBounds')) {
      state.objectBounds = normalizedObjectBounds(patch.objectBounds);
      requiresExtentUpdate = true;
    }
    if (Object.hasOwn(patch, 'provisionalBottom')) {
      state.provisionalBottom = Number.isFinite(Number(patch.provisionalBottom))
        ? Number(patch.provisionalBottom)
        : null;
      requiresExtentUpdate = true;
    }
    if (Object.hasOwn(patch, 'pageEditMode')) {
      const pageEdit = Boolean(patch.pageEditMode);
      if (pageEdit !== state.pageEditMode) {
        clearMarkdownTableContextAnchor(state);
      }
      requiresRender ||= pageEdit !== state.pageEditMode;
      state.pageEditMode = pageEdit;
    }
    if (Object.hasOwn(patch, 'frameBoundaryInteractionEnabled')) {
      state.frameBoundaryInteractionEnabled = patch.frameBoundaryInteractionEnabled;
    }
    if (Object.hasOwn(patch, 'bodyReadOnly')) {
      const bodyReadOnly = Boolean(patch.bodyReadOnly);
      if (bodyReadOnly !== state.bodyReadOnly) {
        clearMarkdownTableContextAnchor(state);
      }
      requiresModeUpdate ||= bodyReadOnly !== state.bodyReadOnly;
      state.bodyReadOnly = bodyReadOnly;
      structuredTextShell?.updateBoundTitle?.(state.titleElement, {
        editable: !state.pageEditMode && !state.bodyReadOnly
      });
    }
    if (Object.hasOwn(patch, 'paneId')) state.paneId = patch.paneId || null;
    if (Object.hasOwn(patch, 'tabId')) state.tabId = patch.tabId || null;
    [
      'onBodyInput', 'onBodyCommit', 'onTitleCommit', 'onRecenter',
      'onLinkActivate', 'onTextFrameInput', 'onTextFrameCommit',
      'onDocumentExtentChange', 'onFoldStateChange'
    ].forEach((name) => {
      if (Object.hasOwn(patch, name)) state[name] = patch[name];
    });
    if (requiresPresentationUpdate) applyMarkdownPresentationGeometry(state);
    if (requiresFrameUpdate && !requiresRender) {
      applyLayerGeometry(state);
      updateDocumentExtent(state, { forceNotify: true });
    }
    if (requiresRender) {
      renderState(state);
      if (modeSelection && semanticModeEditable(state)) {
        state.bodyRoot?.focus?.({ preventScroll: true });
        restoreSemanticSelection(state.bodyRoot, modeSelection);
        updateLiveMarkerVisibility(state);
      }
    }
    else {
      if (requiresModeUpdate) {
        updateSemanticEditorMode(state);
        applyMarkdownStructuralFolding(state);
      }
      if (requiresExtentUpdate) updateDocumentExtent(state);
    }
    if (compositionBoundaryRoot
      && state.bodyRoot !== compositionBoundaryRoot
      && state.editableCompositionTail?.bodyRoot === compositionBoundaryRoot) {
      clearEditableCompositionTail(state);
    }
    return state.layer;
  }

  function destroyMarkdownPageLayer(target) {
    const state = resolveLayerState(target);
    if (!state) return false;
    settleEditableComposition(state, null, {
      restoreSelection: false,
      armTail: false
    });
    clearMarkdownTableContextAnchor(state);
    if (activeCodeLanguageMenu?.button
      && state.layer?.contains(activeCodeLanguageMenu.button)) {
      closeCodeLanguageMenu();
    }
    clearMarkdownClipboardSelection({ clearBrowserSelection: true, state });
    if (activeMarkdownSelectionGesture?.state === state) {
      clearMarkdownSelectionGesture(activeMarkdownSelectionGesture);
    }
    state.contentResizeObserver?.disconnect();
    structuredTextShell?.cancelFrameBoundaryDrags?.(state.frameBoundary);
    clearEditableQuoteRailOverlay(state);
    state.linkArrowController?.destroy?.();
    structuredTextShell?.destroyBoundTitle?.(state.titleElement);
    clearSemanticSelectionListener(state);
    if (state.stage && stageStates.get(state.stage) === state) stageStates.delete(state.stage);
    layerStates.delete(state.layer);
    liveStates.delete(state);
    state.extentElement?.remove();
    state.layer?.remove();
    state.cameraLayer?.remove();
    return true;
  }

  function getMarkdownDocumentBounds(target) {
    const state = resolveLayerState(target);
    if (!state) return null;
    const extent = state.documentExtent
      || updateDocumentExtent(state, { notify: false })
      || calculateMarkdownDocumentExtent();
    const visual = state.visualFrameExtent
      || updateMarkdownVisualFrameExtent(state, extent)
      || calculateMarkdownVisualFrameExtent({
        documentTop: extent.top,
        documentBottom: extent.bottom
      });
    const height = extent.height;
    const frame = textFrameEdges(state.textFrame);
    return {
      x: frame.leftWorld,
      y: 0,
      left: frame.leftWorld,
      top: 0,
      right: frame.rightWorld,
      bottom: extent.bottom,
      width: frame.worldWidth,
      height,
      centerWorldX: frame.centerWorldX,
      leftWorld: frame.leftWorld,
      rightWorld: frame.rightWorld,
      worldWidth: frame.worldWidth,
      preferredWidth: frame.preferredWidth,
      contentBottom: extent.contentBottom,
      objectBottom: extent.objectBottom,
      bottomPadding: extent.bottomPadding,
      visualFrameBottom: visual.bottom,
      visualFrameHeight: visual.height,
      viewportWorldBottom: visual.viewportWorldBottom,
      paneViewportHeight: visual.viewportHeight,
      scale: visual.scale,
      cameraOffsetY: visual.cameraOffsetY
    };
  }

  function markdownPageOwnsPointer(target) {
    return Boolean(activeMarkdownSelectionGesture || (target instanceof Element && target.closest(
      '.markdown-page-layer, .markdown-bottom-strip'
    )));
  }

  function createIconButton(label, text) {
    const button = createElement('button', 'markdown-bottom-strip-button', text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('pointerdown', stopEditorPointer);
    return button;
  }

  function updateBottomControlStrip(controller, context = {}) {
    if (!controller?.element) return;
    controller.context = { ...controller.context, ...context };
    const current = controller.context;
    const visible = pageIsMarkdown(current.page) && current.active !== false;
    controller.element.hidden = !visible;
    if (!visible) return;
    controller.modeButton.textContent = current.mode === 'source'
      ? 'Source'
      : current.mode === 'reading'
        ? 'Reading'
        : 'Live Preview';
    const statistics = model?.statistics
      ? model.statistics(current.page?.markdownBody || '')
      : { words: 0, paragraphs: 0, characters: 0 };
    controller.wordCount.textContent = String(statistics.words);
    controller.characterCount.textContent = String(statistics.characters);
    controller.paragraphCount.textContent = String(statistics.paragraphs);
    controller.zoomButton.textContent = `${Math.round(finiteNumber(current.zoom, 1) * 100)}%`;
    controller.modeMenu.querySelectorAll('[data-markdown-mode]').forEach((button) => {
      const selected = button.dataset.markdownMode === normalizedMode(current.mode);
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
  }

  function createMarkdownBottomControlStrip(options = {}) {
    const container = options.container instanceof Element ? options.container : document.body;
    const element = createElement('div', 'markdown-bottom-strip');
    element.hidden = true;
    element.setAttribute('role', 'toolbar');
    element.setAttribute('aria-label', 'Markdown Page controls');
    const modeButton = createIconButton('Markdown view mode', 'Live Preview');
    modeButton.classList.add('markdown-bottom-strip-mode');
    const modeMenu = createElement('div', 'markdown-bottom-strip-mode-menu');
    modeMenu.hidden = true;
    modeMenu.setAttribute('role', 'menu');
    [
      ['live-preview', 'Live Preview'],
      ['source', 'Source'],
      ['reading', 'Reading']
    ].forEach(([mode, label]) => {
      const button = createElement('button', 'markdown-bottom-strip-menu-item', label);
      button.type = 'button';
      button.dataset.markdownMode = mode;
      button.setAttribute('role', 'menuitemradio');
      button.addEventListener('pointerdown', stopEditorPointer);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        modeMenu.hidden = true;
        invoke(controller.context.onModeChange || options.onModeChange, mode);
      });
      modeMenu.append(button);
    });
    const statistics = createElement('span', 'markdown-bottom-strip-stats');
    statistics.setAttribute('aria-label', 'Document statistics');
    const wordCount = createElement('span', 'markdown-bottom-strip-word-count', '0');
    const characterCount = createElement('span', 'markdown-bottom-strip-character-count', '0');
    const paragraphCount = createElement('span', 'markdown-bottom-strip-paragraph-count', '0');
    statistics.append(
      createElement('span', 'markdown-bottom-strip-count-label', 'Count:'),
      wordCount,
      characterCount,
      document.createTextNode('['),
      paragraphCount,
      document.createTextNode(']')
    );
    const zoomOut = createIconButton('Zoom out', '−');
    const zoomButton = createIconButton('Reset zoom', '100%');
    zoomButton.classList.add('markdown-bottom-strip-zoom-value');
    const zoomIn = createIconButton('Zoom in', '+');
    element.append(statistics, modeButton, zoomOut, zoomButton, zoomIn, modeMenu);
    const controller = {
      element,
      modeButton,
      modeMenu,
      wordCount,
      characterCount,
      paragraphCount,
      zoomButton,
      context: {}
    };
    modeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      modeMenu.hidden = !modeMenu.hidden;
    });
    zoomOut.addEventListener('click', () => invoke(controller.context.onZoomOut || options.onZoomOut));
    zoomButton.addEventListener('click', () => invoke(controller.context.onZoomReset || options.onZoomReset));
    zoomIn.addEventListener('click', () => invoke(controller.context.onZoomIn || options.onZoomIn));
    controller.documentClick = () => { modeMenu.hidden = true; };
    document.addEventListener('click', controller.documentClick);
    container.append(element);
    updateBottomControlStrip(controller, options);
    return controller;
  }

  function destroyMarkdownBottomControlStrip(controller) {
    if (!controller) return;
    if (controller.documentClick) document.removeEventListener('click', controller.documentClick);
    controller.element?.remove();
  }

  function editableProjectionForTarget(target) {
    if (!target) return null;
    const direct = editableProjectionForRoot(target);
    if (direct) return direct;
    const state = resolveLayerState(target)
      || selectionStateForElement(selectionElement(target));
    return state?.editableProjection || null;
  }

  function editableProjectionSnapshot(target) {
    return editableProjectionForTarget(target)?.diagnosticSnapshot?.() || null;
  }

  function editableDomPoint(target, position) {
    return editableProjectionForTarget(target)?.sourceToDom(position) || null;
  }

  function editablePositionAtDomPoint(target, node, offset) {
    return editableProjectionForTarget(target)?.domToSource(node, offset) || null;
  }

  function editableSelection(target) {
    return editableProjectionForTarget(target)?.getSelection() || null;
  }

  function restoreEditableSelection(target, selection) {
    const state = resolveLayerState(target)
      || selectionStateForElement(selectionElement(target));
    const projection = state?.editableProjection || editableProjectionForTarget(target);
    if (!projection) return false;
    const visible = state
      ? ensureEditableSelectionVisible(state, selection)
      : editableSelectionPositions({ editableProjection: projection }, selection);
    return Boolean(visible && (state?.editableProjection || projection).restoreSelection(visible));
  }

  function enumerateEditablePositions(target) {
    return editableProjectionForTarget(target)?.enumerateDeclaredPositions?.() || [];
  }

  function markdownStructuralFoldSnapshot(target) {
    const state = resolveLayerState(target)
      || selectionStateForElement(selectionElement(target));
    if (!state) return null;
    const index = state.markdownFoldIndex
      || buildMarkdownStructuralFoldIndex(state.sourceSnapshot);
    const visibility = state.markdownFoldVisibility
      || deriveMarkdownStructuralFoldVisibility(
        index,
        state.markdownFoldCollapsedKeys || new Set()
      );
    return {
      folds: normalizeMarkdownStructuralFoldDescriptors(
        state.markdownFoldDescriptors
      ).map((entry) => ({ ...entry })),
      owners: index.owners.map((owner) => ({
        ...markdownStructuralFoldDescriptor(owner),
        key: owner.key,
        foldable: owner.foldable,
        hiddenStartLineIndex: owner.hiddenStartLineIndex,
        hiddenEndLineIndex: owner.hiddenEndLineIndex,
        hiddenStartOffset: owner.hiddenStartOffset,
        hiddenEndOffset: owner.hiddenEndOffset,
        listKind: owner.listKind || null,
        task: owner.task === true
      })),
      hiddenLineIndices: [...visibility.hiddenLineIndices].sort((left, right) => left - right)
    };
  }

  function textContextMenuCapabilities(target) {
    const element = selectionElement(target);
    const body = element?.closest?.('.markdown-page-body');
    const state = selectionStateForElement(body);
    if (!body || !state || !stateOwnsActivePane(state)) return null;
    const editable = semanticModeEditable(state);
    const logicalWholeBody = activeMarkdownClipboardSelection?.kind === 'whole-body'
      && clipboardSelectionMatchesState(activeMarkdownClipboardSelection, state);
    const selection = editable ? captureSemanticSelection(body) : null;
    const tableContext = editable && selection
      ? editableTableCellEditContext(state, selection)
      : null;
    const canonicalMutationBlocked = tableContext?.blocked === true;
    const selected = logicalWholeBody
      || Boolean(selection && selection.anchor !== selection.focus)
      || browserSelectionInsideMarkdownBody(state);
    return {
      editable,
      canCut: editable && selected && !canonicalMutationBlocked,
      canCopy: selected,
      canPaste: editable && !canonicalMutationBlocked
    };
  }

  installMarkdownClipboardListeners();
  installMarkdownStructuralGeometryObserver();

  const api = Object.freeze({
    pageIsMarkdown,
    calculateMarkdownDocumentExtent,
    calculateMarkdownVisualFrameExtent,
    clampMarkdownVerticalOffset,
    cancelMarkdownTableInteraction,
    renderMarkdownPageLayer,
    updateMarkdownPageLayer,
    destroyMarkdownPageLayer,
    getMarkdownDocumentBounds,
    markdownPageOwnsPointer,
    markdownSelectionGestureOwnsPointer,
    clearMarkdownClipboardSelection,
    normalizedMarkdownSelectionRange,
    canonicalMarkdownSelectionText,
    canonicalCodeBodyText,
    toggleMarkdownFormatting,
    toggleMarkdownTaskItemSource,
    createMarkdownEditHistory,
    forgetMarkdownEditHistory,
    markMarkdownEditHistorySelectionBoundary,
    recordMarkdownEditTransaction,
    stepMarkdownEditHistory,
    normalizeMarkdownStructuralFoldDescriptors,
    markdownHeadingFoldOwners,
    markdownListFoldOwners,
    buildMarkdownStructuralFoldIndex,
    deriveMarkdownStructuralFoldVisibility,
    markdownStructuralFoldSnapshot,
    textContextMenuCapabilities,
    editableProjectionSnapshot,
    editableDomPoint,
    editablePositionAtDomPoint,
    editableSelection,
    restoreEditableSelection,
    enumerateEditablePositions,
    unorderedMarkerForDepth,
    clearEditablePresentationMountState,
    decorateEditableProjectedLeaves,
    mountEditableListPresentations,
    mountEditableMathPresentations,
    appendRenderedMath,
    editableQuoteRailIntervals,
    focusMarkdownDocumentTitle,
    sourceSegments,
    editableSourceGapLayout,
    tableRowSlices,
    normalizedCodeLanguage,
    tokenizeCode,
    parseLatex,
    createMarkdownBottomControlStrip,
    updateMarkdownBottomControlStrip: updateBottomControlStrip,
    destroyMarkdownBottomControlStrip
  });

  root.markdownPageView = api;
  root.pageIsMarkdown = pageIsMarkdown;
  root.calculateMarkdownDocumentExtent = calculateMarkdownDocumentExtent;
  root.clampMarkdownVerticalOffset = clampMarkdownVerticalOffset;
  root.cancelMarkdownTableInteraction = cancelMarkdownTableInteraction;
  root.renderMarkdownPageLayer = renderMarkdownPageLayer;
  root.updateMarkdownPageLayer = updateMarkdownPageLayer;
  root.destroyMarkdownPageLayer = destroyMarkdownPageLayer;
  root.getMarkdownDocumentBounds = getMarkdownDocumentBounds;
  root.markdownPageOwnsPointer = markdownPageOwnsPointer;
  root.markdownSelectionGestureOwnsPointer = markdownSelectionGestureOwnsPointer;
  root.clearMarkdownClipboardSelection = clearMarkdownClipboardSelection;
  root.forgetMarkdownEditHistory = forgetMarkdownEditHistory;
  root.focusMarkdownDocumentTitle = focusMarkdownDocumentTitle;
}(typeof globalThis !== 'undefined' ? globalThis : window));
