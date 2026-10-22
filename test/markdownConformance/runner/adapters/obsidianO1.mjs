import { homedir } from 'node:os';
import path from 'node:path';
import {
  LaunchedCdpProcess,
  cdpDelay,
  dispatchTrustedAction
} from './cdpTransport.mjs';
import {
  IsolationSafetyError,
  assertIsolatedChild,
  copyReadOnlyIntoIsolation,
  createIsolatedRuntimeRoot,
  readExactFileObservation,
  removeIsolatedRuntimeRoot,
  sha256File,
  validateIsolatedRuntimeRoot,
  writeIsolatedJson
} from './isolation.mjs';
import {
  buildRuntimeObservation,
  compactActionTraceObservation,
  nonAutomatableObservation,
  scenarioActionSequence,
  scenarioSelection,
  utf8FileBytes
} from './observationModel.mjs';
import { SEMANTIC_DOM_FUNCTION_SOURCE } from './semanticDomRuntime.mjs';
import {
  CANONICAL_LIST_ITEMS_FUNCTION_SOURCE,
  SEMANTIC_LIST_ITEMS_FUNCTION_SOURCE
} from './listObservationRuntime.mjs';

export function obsidianListPresentationFromRuntime({
  sourceItems,
  semanticItems,
  mode,
  surface,
  selection,
  editorActive: editorActiveOverride
}) {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0 && box.width > 0 && box.height > 0;
  };
  const transparentColor = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return true;
    if (normalized === 'transparent') return true;
    const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)$/);
    return Boolean(rgba && Number(rgba[1]) === 0);
  };
  const pseudoFacts = (element, pseudo) => {
    if (!element) return null;
    let style = null;
    try { style = getComputedStyle(element, pseudo); } catch {}
    if (!style) return null;
    const content = String(style.content || '').trim();
    const width = Number.parseFloat(style.width || '0') || 0;
    const height = Number.parseFloat(style.height || '0') || 0;
    const painted = !transparentColor(style.backgroundColor)
      || !transparentColor(style.borderColor)
      || (content && content !== 'none' && content !== 'normal' && content !== '""');
    const rendered = style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0
      && (painted || width > 0 || height > 0);
    return {
      pseudo,
      content: content || null,
      display: style.display || null,
      visibility: style.visibility || null,
      opacity: style.opacity || null,
      color: style.color || null,
      backgroundColor: style.backgroundColor || null,
      borderColor: style.borderColor || null,
      width: style.width || null,
      height: style.height || null,
      rendered
    };
  };
  const customListBulletFacts = (item) => {
    if (!item) return null;
    const bullet = [...item.querySelectorAll('.list-bullet,.list-bullet-after')]
      .find((candidate) => candidate.closest?.('li') === item) || null;
    if (!bullet) return null;
    const before = pseudoFacts(bullet, '::before');
    const after = pseudoFacts(bullet, '::after');
    return {
      className: String(bullet.className || ''),
      elementVisible: visible(bullet),
      before,
      after,
      rendered: visible(bullet) || before?.rendered === true || after?.rendered === true
    };
  };
  const editorLines = mode === 'reading' || !surface
    ? []
    : [...surface.querySelectorAll('.cm-line')];
  const readingListItems = mode === 'reading' && surface
    ? [...surface.querySelectorAll('li')]
    : [];
  const editorActive = typeof editorActiveOverride === 'boolean'
    ? editorActiveOverride
    : mode !== 'reading' && Boolean(document.activeElement?.closest?.('.cm-editor'));
  const activeSourceOffset = editorActive && selection
    ? Math.min(Number(selection.anchor) || 0, Number(selection.focus) || 0)
    : null;
  const itemFacts = sourceItems.map((sourceItem, index) => {
    const semanticItem = semanticItems[index] || null;
    const lineElement = editorLines[sourceItem.line.index] || null;
    const rawMarkers = lineElement ? [...lineElement.querySelectorAll(
      '.cm-formatting-list,.cm-formatting,.list-bullet'
    )].filter((element) => {
      const text = String(element.innerText || element.textContent || '').trim();
      return text === sourceItem.rawMarker;
    }) : [];
    const sourceMarkerVisible = rawMarkers.some(visible);
    const customMarker = sourceItem.kind === 'unordered'
      ? customListBulletFacts(readingListItems[index] || null)
      : null;
    const customMarkerVisible = mode === 'reading' && customMarker?.rendered === true;
    const nativeMarkerVisible = mode === 'reading'
      && semanticItem?.nativeMarker?.rendered === true;
    const depthClass = [lineElement?.className || '', ...rawMarkers.map((element) => (
      element.closest?.('[class*="HyperMD-list-line-"]')?.className || ''
    ))].join(' ');
    const classDepth = Number(/HyperMD-list-line-(\d+)/.exec(depthClass)?.[1]);
    const active = activeSourceOffset != null
      && activeSourceOffset >= sourceItem.line.start
      && activeSourceOffset <= sourceItem.line.end;
    const displayedOrdinal = sourceItem.kind === 'ordered'
      ? sourceMarkerVisible
        ? sourceItem.ordinal
        : nativeMarkerVisible ? semanticItem?.ordinal ?? null : null
      : null;
    const displayedMarker = sourceMarkerVisible
      ? sourceItem.rawMarker
      : customMarkerVisible
        ? 'unordered-bullet'
        : nativeMarkerVisible
        ? sourceItem.kind === 'ordered'
          ? Number.isFinite(Number(semanticItem?.ordinal)) ? String(semanticItem.ordinal) + '.' : null
          : 'unordered-bullet'
        : null;
    const recognized = mode === 'reading'
      ? Boolean(semanticItem)
      : Boolean(lineElement?.matches?.('[class*="HyperMD-list-line"]') || rawMarkers.length);
    return {
      itemPath: sourceItem.path,
      parentPath: sourceItem.parentPath,
      sourceOrder: sourceItem.sourceOrder,
      lineIndex: sourceItem.line.index,
      markerStart: sourceItem.markerRange.start,
      markerEnd: sourceItem.markerRange.end,
      rawMarker: sourceItem.rawMarker,
      rawOrdinal: sourceItem.ordinal,
      kind: sourceItem.kind,
      listDepth: recognized
        ? Number.isFinite(classDepth) && classDepth > 0
          ? classDepth
          : mode === 'reading' ? semanticItem?.listDepth ?? 0 : 0
        : 0,
      quoteDepth: sourceItem.quoteDepth,
      recognized,
      checked: semanticItem?.checked ?? null,
      nativeMarker: semanticItem?.nativeMarker ?? null,
      customMarker,
      displayedMarker,
      displayedOrdinal,
      markerVisible: sourceMarkerVisible || customMarkerVisible || nativeMarkerVisible,
      markerOwner: sourceMarkerVisible ? 'source-marker'
        : customMarkerVisible ? 'custom-generated'
          : nativeMarkerVisible ? 'native-list' : 'none',
      markerOwnerDetail: customMarkerVisible ? 'obsidian-list-bullet' : null,
      active
    };
  });
  const focus = {
    editorActive,
    activeItemPaths: itemFacts.filter((item) => item.active).map((item) => item.itemPath),
    activeLineIndexes: itemFacts.filter((item) => item.active).map((item) => item.lineIndex)
  };
  return { sourceItems, semanticItems, items: itemFacts, focus };
}

const OBSIDIAN_LIST_PRESENTATION_FUNCTION_SOURCE = obsidianListPresentationFromRuntime.toString();

export const OBSIDIAN_O1_DEFAULTS = Object.freeze({
  executablePath: '/Applications/Obsidian.app/Contents/MacOS/Obsidian',
  effectiveVersion: '1.13.7',
  electronVersion: '39.7.0',
  chromeVersion: '142.0.7444.265',
  notePath: 'Conformance.md',
  settings: Object.freeze({
    defaultViewMode: 'source',
    livePreview: true,
    strictLineBreaks: false,
    showLineNumber: false,
    showIndentGuide: true,
    useTab: false,
    tabSize: 4,
    autoPairBrackets: true,
    autoPairMarkdown: true,
    smartIndentList: true,
    foldHeading: true,
    foldIndent: true
  })
});

export class AutomationUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AutomationUnavailableError';
    this.details = details;
  }
}

function defaultCachedAsarPath(version = OBSIDIAN_O1_DEFAULTS.effectiveVersion) {
  return path.join(homedir(), 'Library', 'Application Support', 'obsidian', `obsidian-${version}.asar`);
}

function safeRelativeNotePath(value) {
  const normalized = String(value || OBSIDIAN_O1_DEFAULTS.notePath).replace(/\\/g, '/');
  if (!normalized.endsWith('.md')
    || normalized.startsWith('/')
    || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new IsolationSafetyError('Obsidian conformance note must be a safe Vault-relative .md path.', {
      value
    });
  }
  return normalized;
}

function normalizedMode(value) {
  const mode = String(value || 'source').toLowerCase();
  if (['live', 'live-preview', 'livepreview'].includes(mode)) return 'live-preview';
  if (['reading', 'preview', 'read'].includes(mode)) return 'reading';
  if (['source', 'source-mode'].includes(mode)) return 'source';
  throw new AutomationUnavailableError(`Unsupported Obsidian editing mode: ${value}`);
}

function runtimeSetupExpression({ notePath, source, mode, selection, active, fast }) {
  return `(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const notePath = ${JSON.stringify(notePath)};
    const source = ${JSON.stringify(source)};
    const desiredMode = ${JSON.stringify(mode)};
    const desiredSelection = ${JSON.stringify(selection)};
    const desiredActive = ${JSON.stringify(active)};
    const allowFastReset = ${JSON.stringify(fast)};
    let file = app.vault.getAbstractFileByPath(notePath);
    let createdFile = false;
    if (!file) {
      // The Vault adapter can observe a just-created file a little before the
      // metadata cache does.  That race is especially visible in a brand-new
      // disposable Vault after a failed/aborted first setup.  Reconcile only
      // this known isolated fixture path before asking Vault#create to index it.
      if (await app.vault.adapter.exists(notePath)) {
        await app.vault.adapter.remove(notePath);
      }
      file = await app.vault.create(notePath, source);
      createdFile = true;
      await pause(100);
    }
    let reusedEditor = false;
    const existingLeaf = app.workspace.activeLeaf;
    if (allowFastReset && existingLeaf?.view?.file?.path === notePath) {
      if (existingLeaf.view.getMode?.() === 'preview') {
        await app.commands.executeCommandById('markdown:toggle-preview');
        await pause(80);
      }
      const existingEditor = app.workspace.activeEditor?.editor;
      if (existingEditor?.setValue) {
        existingEditor.setValue(source);
        await existingLeaf.view?.save?.();
        reusedEditor = true;
      }
    }
    if (!reusedEditor) {
      if (existingLeaf?.view?.file?.path === notePath) {
        await existingLeaf.setViewState({ type: 'empty', state: {}, active: true });
        await pause(80);
      }
      if (!createdFile) await app.vault.modify(file, source);
      const leaf = existingLeaf || app.workspace.getLeaf(false);
      await leaf.openFile(file, { active: true });
      await pause(180);
    }

    const viewMode = () => app.workspace.activeLeaf?.view?.getMode?.() || null;
    if (desiredMode === 'reading') {
      if (viewMode() !== 'preview') {
        await app.commands.executeCommandById('markdown:toggle-preview');
        await pause(180);
      }
    } else {
      if (viewMode() === 'preview') {
        await app.commands.executeCommandById('markdown:toggle-preview');
        await pause(180);
      }
      const desiredSourceMode = desiredMode === 'source';
      const sourceMode = () => Boolean(app.workspace.activeEditor?.editMode?.sourceMode);
      if (sourceMode() !== desiredSourceMode) {
        await app.commands.executeCommandById('editor:toggle-source');
        await pause(220);
      }
    }

    const activeView = app.workspace.activeLeaf?.view;
    const editor = app.workspace.activeEditor?.editor;
    if (desiredMode !== 'reading') {
      if (!editor?.offsetToPos || !editor?.setSelection) {
        throw new Error('The active Obsidian Markdown editor does not expose offset selection APIs.');
      }
      editor.focus();
      editor.setSelection(
        editor.offsetToPos(desiredSelection.anchor),
        editor.offsetToPos(desiredSelection.focus)
      );
      await pause(80);
      if (desiredMode === 'live-preview' && desiredActive === false) {
        document.activeElement?.blur?.();
        await pause(30);
      }
    }
    const cmSelection = editor?.cm?.state?.selection?.main;
    const actualMode = activeView?.getMode?.() === 'preview'
      ? 'reading'
      : app.workspace.activeEditor?.editMode?.sourceMode
        ? 'source'
        : 'live-preview';
    return {
      notePath: activeView?.file?.path || null,
      mode: actualMode,
      source: editor?.getValue?.() ?? await app.vault.read(file),
      selection: cmSelection ? { anchor: cmSelection.anchor, focus: cmSelection.head } : null,
      requestedSelection: desiredMode === 'reading' ? null : desiredSelection,
      reusedEditor,
      active: desiredMode === 'reading' ? false : document.activeElement?.closest?.('.cm-editor') != null
    };
  })()`;
}

function runtimeCaptureExpression(notePath) {
  return `(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    const view = app.workspace.activeLeaf?.view;
    await view?.save?.();
    await pause(100);
    const editor = app.workspace.activeEditor?.editor;
    const cmSelection = editor?.cm?.state?.selection?.main;
    const source = editor?.getValue?.() ?? (file ? await app.vault.read(file) : '');
    const mode = view?.getMode?.() === 'preview'
      ? 'reading'
      : app.workspace.activeEditor?.editMode?.sourceMode
        ? 'source'
        : 'live-preview';
    const activeLeaf = document.querySelector('.workspace-leaf.mod-active')
      || document.querySelector('.workspace-leaf');
    const surface = mode === 'reading'
      ? activeLeaf?.querySelector('.markdown-preview-view')
      : activeLeaf?.querySelector('.cm-editor');
    const capturedEditorActive = mode !== 'reading'
      && Boolean(document.activeElement?.closest?.('.cm-editor'));
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        x: value.x, y: value.y, left: value.left, top: value.top,
        right: value.right, bottom: value.bottom, width: value.width, height: value.height
      };
    };
    const typeFor = (element) => {
      const tag = element.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'blockquote') return 'quote';
      if (tag === 'ol') return 'ordered-list';
      if (tag === 'ul') return element.querySelector(':scope > li input[type="checkbox"]') ? 'task-list' : 'unordered-list';
      if (tag === 'li') return element.querySelector(':scope input[type="checkbox"]') ? 'task-list-item' : 'list-item';
      if (tag === 'pre') return 'fenced-code';
      if (tag === 'code') return element.closest('pre') ? 'fenced-code-body' : 'inline-code';
      if (tag === 'table') return 'table';
      if (tag === 'tr') return 'table-row';
      if (tag === 'th') return 'table-header-cell';
      if (tag === 'td') return 'table-cell';
      if (tag === 'hr') return 'thematic-break';
      if (tag === 'input') return 'task-checkbox';
      return 'rendered-inline';
    };
    const genericElements = surface ? [...surface.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,blockquote,ol,ul,li,pre,code,table,tr,th,td,hr,input[type="checkbox"],mjx-container,.katex'
    )].map((element) => ({
      type: typeFor(element),
      depth: element.matches('blockquote')
        ? (() => {
            let depth = 1;
            let quote = element.parentElement?.closest?.('blockquote');
            while (quote) { depth += 1; quote = quote.parentElement?.closest?.('blockquote'); }
            return depth;
          })()
        : element.matches('li')
          ? (() => {
              let depth = 0;
              let list = element.parentElement?.closest?.('ol,ul');
              while (list) { depth += 1; list = list.parentElement?.closest?.('ol,ul'); }
              return depth;
            })()
          : 0,
      headingDepth: /^H[1-6]$/.test(element.tagName) ? Number(element.tagName.slice(1)) : 0,
      text: (element.innerText || element.textContent || '').slice(0, 1000),
      checked: element.matches('input[type="checkbox"]') ? Boolean(element.checked) : null,
      visible: visible(element)
    })) : [];
    const editorSemantic = surface ? [
      ['.cm-header', 'heading'],
      ['.cm-strong', 'strong'],
      ['.cm-em', 'emphasis'],
      ['.cm-strikethrough', 'strikethrough'],
      ['.cm-inline-code', 'inline-code'],
      ['.cm-hmd-codeblock', 'fenced-code'],
      ['.cm-link', 'link'],
      ['.cm-math', 'math'],
      ['.HyperMD-quote', 'quote-line'],
      ['.HyperMD-list-line', 'list-line']
    ].flatMap(([selector, type]) => [...surface.querySelectorAll(selector)].map((element) => ({
      type,
      depth: 0,
      headingDepth: 0,
      text: (element.innerText || element.textContent || '').slice(0, 1000),
      checked: null,
      visible: visible(element)
    }))) : [];
    const markerElements = surface ? [...surface.querySelectorAll(
      '.cm-formatting, .list-bullet, input[type="checkbox"]'
    )] : [];
    const markers = markerElements.map((element) => ({
      text: (element.innerText || element.textContent || (element.checked ? '[x]' : '[ ]')).trim(),
      visible: visible(element),
      kind: element.matches('input[type="checkbox"]') ? 'task' : 'syntax'
    }));
    const lineElements = surface
      ? (mode === 'reading'
        ? [...surface.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr')]
        : [...surface.querySelectorAll('.cm-line')])
      : [];
    const geometryLines = lineElements.map((element, index) => {
      let sourceStart = null;
      let sourceEnd = null;
      if (mode !== 'reading' && editor?.posToOffset) {
        try {
          sourceStart = editor.posToOffset({ line: index, ch: 0 });
          sourceEnd = editor.posToOffset({ line: index, ch: editor.getLine(index)?.length || 0 });
        } catch {}
      }
      return {
        index,
        text: element.innerText || element.textContent || '',
        sourceStart,
        sourceEnd,
        rect: rect(element)
      };
    });
    let runtimeVersion = null;
    let shellVersion = null;
    try { runtimeVersion = require('electron').ipcRenderer.sendSync('version'); } catch {}
    try { shellVersion = require('electron').remote?.app?.getVersion?.() || null; } catch {}
    let semantic = null;
    let semanticCapture = 'active-view';
    let semanticError = null;
    let semanticRoot = null;
    try {
      semanticRoot = document.createElement('div');
      semanticRoot.style.cssText = 'position:fixed;left:-100000px;top:0;width:800px;pointer-events:none';
      document.body.append(semanticRoot);
      const { MarkdownRenderer } = require('obsidian');
      await MarkdownRenderer.render(app, source, semanticRoot, ${JSON.stringify(notePath)}, view);
      semantic = (${SEMANTIC_DOM_FUNCTION_SOURCE})(semanticRoot);
      semanticCapture = 'obsidian-markdown-renderer';
    } catch (error) {
      semanticError = { name: error?.name || 'Error', message: error?.message || String(error) };
      // Obsidian does not expose its plugin API module to this renderer's
      // CommonJS loader.  Use the product's own reading-view command as the
      // authoritative renderer, observe that DOM, then restore the prior mode.
      // Presentation/selection facts above were captured before this temporary
      // transition, so this only supplies the shared semantic observation.
      if (mode === 'reading') {
        semantic = (${SEMANTIC_DOM_FUNCTION_SOURCE})(surface || document.createElement('div'));
        semanticCapture = 'reading-view';
      } else {
        await app.commands.executeCommandById('markdown:toggle-preview');
        await pause(180);
        const previewSurface = (document.querySelector('.workspace-leaf.mod-active')
          || document.querySelector('.workspace-leaf'))?.querySelector('.markdown-preview-view');
        semantic = (${SEMANTIC_DOM_FUNCTION_SOURCE})(previewSurface || document.createElement('div'));
        semanticCapture = 'temporary-reading-view';
        await app.commands.executeCommandById('markdown:toggle-preview');
        await pause(180);
      }
    } finally {
      semanticRoot?.remove?.();
    }
    const sourceListItems = (${CANONICAL_LIST_ITEMS_FUNCTION_SOURCE})(source);
    const semanticListItems = mode === 'reading'
      ? (${SEMANTIC_LIST_ITEMS_FUNCTION_SOURCE})(surface || document.createElement('div'))
      : (semantic?.nodes || [])
        .filter((node) => node.type === 'listItem')
        .map((node, index) => ({
          path: String(index),
          parentPath: null,
          domOrder: index,
          listDepth: Number(node.listDepth) || 0,
          ordered: node.ordinal != null && Number.isFinite(Number(node.ordinal)),
          ordinal: node.ordinal != null && Number.isFinite(Number(node.ordinal))
            ? Number(node.ordinal) : null,
          checked: typeof node.checked === 'boolean' ? node.checked : null,
          nativeMarker: null
        }));
    const listPresentation = (${OBSIDIAN_LIST_PRESENTATION_FUNCTION_SOURCE})({
      sourceItems: sourceListItems,
      semanticItems: semanticListItems,
      mode,
      surface,
      selection: cmSelection ? { anchor: cmSelection.anchor, focus: cmSelection.head } : null,
      editorActive: capturedEditorActive
    });
    const settingNames = [
      'defaultViewMode', 'livePreview', 'strictLineBreaks', 'showLineNumber',
      'showIndentGuide', 'useTab', 'tabSize', 'autoPairBrackets',
      'autoPairMarkdown', 'smartIndentList', 'foldHeading', 'foldIndent'
    ];
    const settings = Object.fromEntries(settingNames.map((name) => [name, app.vault.getConfig(name)]));
    const orderedListEntries = (semantic?.nodes || [])
      .filter((node) => node.type === 'listItem'
        && node.ordinal != null
        && Number.isFinite(Number(node.ordinal)))
      .map((node) => ({
        listDepth: Number(node.listDepth) || 0,
        ordinal: Number(node.ordinal)
      }));
    const visibleOrderedMarkerOrdinals = markers
      .filter((marker) => marker.visible && /^[0-9]+[.)]$/.test(marker.text))
      .map((marker) => Number.parseInt(marker.text, 10));
    return {
      source,
      selection: cmSelection ? {
        anchor: cmSelection.anchor,
        focus: cmSelection.head,
        from: cmSelection.from,
        to: cmSelection.to
      } : null,
      mode,
      active: listPresentation.focus.editorActive,
      visibleText: surface?.innerText || '',
      semantic,
      semanticCapture,
      semanticError,
      semanticElements: [...genericElements, ...editorSemantic],
      markers,
      renderedState: mode === 'source' ? 'raw' : mode === 'reading' ? 'rendered' : 'mixed',
      presentationFacts: {
        orderedList: {
          entries: orderedListEntries,
          rendered: orderedListEntries.length > 0
            && visibleOrderedMarkerOrdinals.length === orderedListEntries.length
            && orderedListEntries.every((entry, index) => (
              entry.ordinal === visibleOrderedMarkerOrdinals[index]
            )),
          visibleMarkerOrdinals: visibleOrderedMarkerOrdinals
        },
        list: listPresentation,
        focus: listPresentation.focus
      },
      geometry: {
        viewport: rect(document.documentElement),
        editor: rect(surface),
        lines: geometryLines
      },
      versions: {
        obsidian: runtimeVersion,
        shell: shellVersion,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      settings,
      activeFile: app.workspace.getActiveFile?.()?.path || null,
      vaultName: app.vault.getName?.() || null,
      vaultBasePath: app.vault.adapter?.basePath || app.vault.adapter?.path || null,
      targetUrl: location.href
    };
  })()`;
}

function runtimeActionTraceCaptureExpression() {
  return `(() => {
    const editor = app.workspace.activeEditor?.editor;
    const view = app.workspace.activeLeaf?.view;
    const cmSelection = editor?.cm?.state?.selection?.main;
    const source = editor?.getValue?.() ?? view?.data ?? '';
    const mode = view?.getMode?.() === 'preview'
      ? 'reading'
      : app.workspace.activeEditor?.editMode?.sourceMode
        ? 'source'
        : 'live-preview';
    const activeLeaf = document.querySelector('.workspace-leaf.mod-active')
      || document.querySelector('.workspace-leaf');
    const surface = mode === 'reading'
      ? activeLeaf?.querySelector('.markdown-preview-view')
      : activeLeaf?.querySelector('.cm-editor');
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0 && box.width > 0 && box.height > 0;
    };
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        x: value.x, y: value.y, left: value.left, top: value.top,
        right: value.right, bottom: value.bottom, width: value.width, height: value.height
      };
    };
    const markers = surface ? [...surface.querySelectorAll(
      '.cm-formatting, .list-bullet, input[type="checkbox"]'
    )].map((element) => ({
      text: (element.innerText || element.textContent || (element.checked ? '[x]' : '[ ]')).trim(),
      visible: visible(element),
      kind: element.matches('input[type="checkbox"]') ? 'task' : 'syntax'
    })) : [];
    const lineElements = surface
      ? (mode === 'reading'
        ? [...surface.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr')]
        : [...surface.querySelectorAll('.cm-line')])
      : [];
    const geometryLines = lineElements.map((element, index) => {
      let sourceStart = null;
      let sourceEnd = null;
      if (mode !== 'reading' && editor?.posToOffset) {
        try {
          sourceStart = editor.posToOffset({ line: index, ch: 0 });
          sourceEnd = editor.posToOffset({ line: index, ch: editor.getLine(index)?.length || 0 });
        } catch {}
      }
      return {
        index,
        text: element.innerText || element.textContent || '',
        sourceStart,
        sourceEnd,
        rect: rect(element)
      };
    });
    const semantic = (${SEMANTIC_DOM_FUNCTION_SOURCE})(
      surface || document.createElement('div')
    );
    const sourceListItems = (${CANONICAL_LIST_ITEMS_FUNCTION_SOURCE})(source);
    const semanticListItems = mode === 'reading'
      ? (${SEMANTIC_LIST_ITEMS_FUNCTION_SOURCE})(surface || document.createElement('div'))
      : [];
    const listPresentation = (${OBSIDIAN_LIST_PRESENTATION_FUNCTION_SOURCE})({
      sourceItems: sourceListItems,
      semanticItems: semanticListItems,
      mode,
      surface,
      selection: cmSelection ? { anchor: cmSelection.anchor, focus: cmSelection.head } : null
    });
    return {
      source,
      selection: cmSelection ? {
        anchor: cmSelection.anchor,
        focus: cmSelection.head,
        from: cmSelection.from,
        to: cmSelection.to
      } : null,
      mode,
      active: listPresentation.focus.editorActive,
      visibleText: surface?.innerText || '',
      semantic,
      markers,
      renderedState: mode === 'source' ? 'raw' : mode === 'reading' ? 'rendered' : 'mixed',
      presentationFacts: {
        list: listPresentation,
        focus: listPresentation.focus
      },
      geometry: {
        viewport: rect(document.documentElement),
        editor: rect(surface),
        lines: geometryLines
      },
      activeFile: app.workspace.getActiveFile?.()?.path || null,
      targetUrl: location.href
    };
  })()`;
}

export class ObsidianO1Adapter {
  constructor(options = {}) {
    this.options = {
      executablePath: OBSIDIAN_O1_DEFAULTS.executablePath,
      effectiveVersion: OBSIDIAN_O1_DEFAULTS.effectiveVersion,
      cachedAsarPath: null,
      notePath: OBSIDIAN_O1_DEFAULTS.notePath,
      settings: {},
      keepArtifacts: false,
      traceActions: false,
      launchTimeoutMs: 35_000,
      settleMs: 120,
      fastSetup: false,
      ...options
    };
    this.isolation = null;
    this.process = null;
    this.notePath = safeRelativeNotePath(this.options.notePath);
    this.noteFile = null;
    this.runtimeMetadata = null;
    this.lastSetupAttemptCount = 0;
    this.closed = false;
    this.currentScenario = null;
  }

  static async launch(options = {}) {
    const adapter = new ObsidianO1Adapter(options);
    try {
      await adapter.launch();
      return adapter;
    } catch (error) {
      await adapter.close().catch(() => {});
      throw error;
    }
  }

  get client() {
    if (!this.process?.client) throw new AutomationUnavailableError('Obsidian CDP client is not available.');
    return this.process.client;
  }

  async launch() {
    if (this.process) return this;
    const effectiveVersion = this.options.effectiveVersion;
    const cachedAsarPath = this.options.cachedAsarPath || defaultCachedAsarPath(effectiveVersion);
    this.isolation = await createIsolatedRuntimeRoot('obsidian-o1', {
      label: this.options.label || ''
    });
    await validateIsolatedRuntimeRoot(this.isolation);
    const obsidianDirectory = path.join(this.isolation.vault, '.obsidian');
    const copiedAsarPath = path.join(this.isolation.profile, `obsidian-${effectiveVersion}.asar`);
    await copyReadOnlyIntoIsolation(this.isolation.root, cachedAsarPath, copiedAsarPath);
    const [sourceAsarSha256, copiedAsarSha256] = await Promise.all([
      sha256File(cachedAsarPath),
      sha256File(copiedAsarPath)
    ]);
    if (sourceAsarSha256 !== copiedAsarSha256) {
      throw new IsolationSafetyError('Effective Obsidian ASAR copy failed integrity validation.', {
        cachedAsarPath,
        copiedAsarPath,
        sourceAsarSha256,
        copiedAsarSha256
      });
    }
    this.noteFile = path.join(this.isolation.vault, ...this.notePath.split('/'));
    const settings = { ...OBSIDIAN_O1_DEFAULTS.settings, ...this.options.settings };
    await writeIsolatedJson(
      this.isolation.root,
      path.join(obsidianDirectory, 'app.json'),
      settings
    );
    const vaultId = this.options.vaultId || 'c0dec0dec0dec0de';
    await writeIsolatedJson(
      this.isolation.root,
      path.join(this.isolation.profile, 'obsidian.json'),
      { vaults: { [vaultId]: { path: this.isolation.vault, ts: Date.now(), open: true } } }
    );

    this.process = await LaunchedCdpProcess.launch({
      executablePath: this.options.executablePath,
      timeoutMs: this.options.launchTimeoutMs,
      args: ({ port }) => [
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
        '--headless',
        '--disable-gpu',
        `--user-data-dir=${this.isolation.profile}`
      ],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      targetPredicate: (target) => target.type === 'page'
        && target.url === 'app://obsidian.md/index.html'
    });
    await this.client.waitForValue(
      `typeof app !== 'undefined' && Boolean(app.vault) && Boolean(app.workspace)`,
      { timeoutMs: 20_000, description: 'isolated Obsidian application API' }
    );
    await this.client.evaluate(`new Promise((resolve) => {
      if (app.workspace.layoutReady && app.workspace.rootSplit) return resolve(true);
      app.workspace.onLayoutReady(() => resolve(true));
    })`, { timeoutMs: 20_000 });
    await this.client.waitForValue(
      `Boolean(app.workspace.layoutReady) && Boolean(app.workspace.rootSplit)`,
      { timeoutMs: 20_000, description: 'isolated Obsidian workspace layout' }
    );
    const safetyProbe = await this.client.evaluate(`(() => ({
      targetUrl: location.href,
      vaultBasePath: app.vault.adapter?.basePath || app.vault.adapter?.path || null,
      activeFile: app.workspace.getActiveFile?.()?.path || null
    }))()`);
    const runtimeVault = safetyProbe.vaultBasePath ? path.resolve(safetyProbe.vaultBasePath) : null;
    if (safetyProbe.targetUrl !== 'app://obsidian.md/index.html'
      || runtimeVault !== path.resolve(this.isolation.vault)) {
      throw new IsolationSafetyError('Obsidian runtime did not bind to the disposable Vault/profile.', {
        expectedVault: this.isolation.vault,
        safetyProbe
      });
    }
    this.runtimeMetadata = {
      effectiveVersion,
      expectedElectronVersion: OBSIDIAN_O1_DEFAULTS.electronVersion,
      expectedChromeVersion: OBSIDIAN_O1_DEFAULTS.chromeVersion,
      cachedAsarPath,
      copiedAsarPath,
      asarSha256: copiedAsarSha256,
      target: this.process.target,
      settings,
      isolatedRoot: this.isolation.root,
      isolatedProfile: this.isolation.profile,
      isolatedVault: this.isolation.vault
    };
    return this;
  }

  async setup(scenario) {
    const source = typeof scenario?.initialSource === 'string' ? scenario.initialSource : '';
    const mode = normalizedMode(scenario?.mode || 'source');
    const selection = scenarioSelection(scenario, source);
    await assertIsolatedChild(this.isolation.root, this.noteFile);
    const requestedActive = scenario?.state?.active !== false;
    const setupRequest = {
      notePath: this.notePath,
      source,
      mode,
      selection,
      active: requestedActive
    };
    let result = null;
    let setupAttemptCount = 0;
    const setupReached = (candidate) => Boolean(
      candidate?.notePath === this.notePath
      && candidate.source === source
      && candidate.mode === mode
      && (mode === 'reading' || (
        candidate.selection?.anchor === selection.anchor
        && candidate.selection?.focus === selection.focus
      ))
      && (mode !== 'live-preview' || candidate.active === requestedActive)
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      setupAttemptCount = attempt + 1;
      result = await this.client.evaluate(runtimeSetupExpression({
        ...setupRequest,
        fast: attempt === 0 && Boolean(this.options.fastSetup)
      }), { timeoutMs: 20_000 });
      if (setupReached(result)) break;
      await cdpDelay(120);
    }
    this.lastSetupAttemptCount = setupAttemptCount;
    if (result.notePath !== this.notePath || result.source !== source || result.mode !== mode) {
      throw new AutomationUnavailableError('Obsidian scenario setup did not reach the requested state.', {
        requested: { notePath: this.notePath, source, mode, selection },
        actual: result
      });
    }
    if (mode !== 'reading' && (
      result.selection?.anchor !== selection.anchor
      || result.selection?.focus !== selection.focus
    )) {
      throw new AutomationUnavailableError('Obsidian could not establish the exact source selection.', {
        requested: selection,
        actual: result.selection
      });
    }
    if (mode === 'live-preview' && result.active !== requestedActive) {
      throw new AutomationUnavailableError('Obsidian could not establish the requested active/inactive Live Preview state.', {
        requestedActive,
        actualActive: result.active
      });
    }
    this.currentScenario = scenario;
    return result;
  }

  async sourceCoordinates(offset) {
    return this.client.evaluate(`(() => {
      const editor = app.workspace.activeEditor?.editor;
      const cm = editor?.cm;
      if (!cm?.coordsAtPos) return null;
      const sourceLength = editor.getValue().length;
      const position = Math.max(0, Math.min(sourceLength, ${Number(offset)}));
      const box = cm.coordsAtPos(position, 1) || cm.coordsAtPos(position, -1);
      return box ? { x: box.left + 1, y: (box.top + box.bottom) / 2, offset: position } : null;
    })()`);
  }

  async reopen() {
    const result = await this.client.evaluate(`(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const leaf = app.workspace.activeLeaf || app.workspace.getLeaf(false);
      await leaf?.view?.save?.();
      await leaf?.setViewState?.({ type: 'empty', state: {}, active: true });
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(this.notePath)});
      await leaf.openFile(file, { active: true });
      await pause(220);
      return { activeFile: app.workspace.getActiveFile?.()?.path || null };
    })()`);
    if (result.activeFile !== this.notePath) {
      throw new AutomationUnavailableError('Obsidian failed to reopen the isolated note.', result);
    }
  }

  async switchMode() {
    return this.client.evaluate(`(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const mode = () => app.workspace.activeLeaf?.view?.getMode?.() === 'preview'
        ? 'reading'
        : app.workspace.activeEditor?.editMode?.sourceMode
          ? 'source'
          : 'live-preview';
      const before = mode();
      const desired = before === 'live-preview' ? 'source' : before === 'source' ? 'reading' : 'live-preview';
      if (before === 'live-preview') {
        await app.commands.executeCommandById('editor:toggle-source');
      } else if (before === 'source') {
        await app.commands.executeCommandById('markdown:toggle-preview');
      } else {
        await app.commands.executeCommandById('markdown:toggle-preview');
        await pause(100);
        if (app.workspace.activeEditor?.editMode?.sourceMode) {
          await app.commands.executeCommandById('editor:toggle-source');
        }
      }
      await pause(180);
      return { before, desired, after: mode() };
    })()`);
  }

  async dispatch(rawAction) {
    const action = typeof rawAction === 'string' ? rawAction : { ...rawAction };
    const type = typeof action === 'string'
      ? action.toLowerCase()
      : String(action.type || action.kind || action.op || '').toLowerCase();
    const command = typeof action === 'object' ? String(action.command || '').toLowerCase() : '';
    if (['inspect'].includes(type)
      || (type === 'selection' && command === 'select-target')) {
      return;
    }
    if (type === 'blur' || command === 'blur' || action.target === 'outside-editor') {
      await this.client.evaluate(`(() => {
        document.activeElement?.blur?.();
        document.querySelector('.workspace-tabs')?.focus?.({ preventScroll: true });
        return document.activeElement?.closest?.('.cm-editor') == null;
      })()`);
    } else if (type === 'reopen' || command === 'reopen-note' || String(action).toLowerCase() === 'reopen') {
      await this.reopen();
    } else if (type === 'mode' || type === 'switch-mode'
      || (type === 'application' && command === 'switch-mode')) {
      const switched = await this.switchMode();
      if (switched.after !== switched.desired) {
        throw new AutomationUnavailableError('Obsidian mode switch did not reach the expected next mode.', switched);
      }
    } else if (['click', 'mouse'].includes(type)
      && Number.isFinite(Number(action.offset))
      && !Number.isFinite(Number(action.x))) {
      const point = await this.sourceCoordinates(action.offset);
      if (!point) throw new AutomationUnavailableError('Could not map Obsidian source offset to viewport coordinates.', action);
      await this.client.click({ ...action, ...point });
    } else if (type === 'select' && Number.isFinite(Number(action.anchor))
      && Number.isFinite(Number(action.focus))) {
      const [start, end] = await Promise.all([
        this.sourceCoordinates(action.anchor),
        this.sourceCoordinates(action.focus)
      ]);
      if (!start || !end) throw new AutomationUnavailableError('Could not map Obsidian selection to viewport coordinates.', action);
      await this.client.drag(start, end, action);
    } else {
      const handled = await dispatchTrustedAction(this.client, action, { platform: 'darwin' });
      if (!handled) throw new AutomationUnavailableError('Unsupported Obsidian scenario action.', { action });
    }
    await cdpDelay(this.options.settleMs);
  }

  captureRuntime() {
    return this.client.evaluate(runtimeCaptureExpression(this.notePath), { timeoutMs: 20_000 });
  }

  captureActionTraceRuntime() {
    return this.client.evaluate(runtimeActionTraceCaptureExpression(), { timeoutMs: 5_000 });
  }

  async captureActionTrace(scenario = this.currentScenario || {}) {
    const runtime = await this.captureActionTraceRuntime();
    const source = typeof runtime.source === 'string' ? runtime.source : '';
    return buildRuntimeObservation({
      scenarioId: scenario.id || 'obsidian-o1-scenario',
      evidenceLevel: 'O1',
      automatable: true,
      source,
      fileBytes: utf8FileBytes(source, { kind: 'obsidian-editor-buffer-action-trace' }),
      selection: runtime.selection,
      runtime,
      metadata: {
        adapter: 'obsidian-o1',
        mode: runtime.mode,
        active: runtime.active,
        versions: {
          obsidian: this.options.effectiveVersion,
          electron: OBSIDIAN_O1_DEFAULTS.electronVersion,
          chrome: OBSIDIAN_O1_DEFAULTS.chromeVersion
        },
        settings: this.runtimeMetadata?.settings || this.options.settings,
        activeFile: runtime.activeFile,
        isolated: true,
        artifactsRetained: Boolean(this.options.keepArtifacts),
        runtimeExpectation: {
          obsidian: this.options.effectiveVersion,
          electron: OBSIDIAN_O1_DEFAULTS.electronVersion,
          chrome: OBSIDIAN_O1_DEFAULTS.chromeVersion
        },
        asarSha256: this.runtimeMetadata?.asarSha256,
        setupAttemptCount: this.lastSetupAttemptCount,
        actionTraceCapture: {
          timingPreserving: true,
          sourceAuthority: 'editor-buffer',
          persistedFileAuthorityAtFinalObservation: true
        }
      },
      raw: { editorSource: source }
    });
  }

  async capture(scenario = this.currentScenario || {}) {
    let runtime = null;
    let captureAttemptCount = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      captureAttemptCount = attempt + 1;
      runtime = await this.captureRuntime();
      const readingSurfacePending = runtime?.mode === 'reading'
        && String(runtime.source || '').trim().length > 0
        && String(runtime.visibleText || '').trim().length === 0
        && !(runtime.semantic?.nodes || []).length;
      if (!readingSurfacePending) break;
      await cdpDelay(160);
    }
    let fileBytes = null;
    const deadline = Date.now() + 4_000;
    do {
      fileBytes = await readExactFileObservation(this.isolation.root, this.noteFile);
      if (fileBytes.utf8 === runtime.source) break;
      await cdpDelay(80);
    } while (Date.now() < deadline);
    const fileEditorMatch = fileBytes.utf8 === runtime.source;
    const effectiveSource = fileBytes.utf8;
    return buildRuntimeObservation({
      scenarioId: scenario.id || 'obsidian-o1-scenario',
      evidenceLevel: 'O1',
      automatable: fileEditorMatch,
      source: effectiveSource,
      fileBytes: { ...fileBytes, kind: 'actual-markdown-file' },
      selection: runtime.selection,
      runtime,
      metadata: {
        adapter: 'obsidian-o1',
        mode: runtime.mode,
        active: runtime.active,
        versions: runtime.versions,
        settings: runtime.settings,
        targetUrl: runtime.targetUrl,
        activeFile: runtime.activeFile,
        isolated: true,
        isolatedRoot: this.isolation.root,
        isolatedProfile: this.isolation.profile,
        isolatedVault: this.isolation.vault,
        artifactsRetained: Boolean(this.options.keepArtifacts),
        fileEditorMatch,
        runtimeExpectation: {
          obsidian: this.options.effectiveVersion,
          electron: OBSIDIAN_O1_DEFAULTS.electronVersion,
          chrome: OBSIDIAN_O1_DEFAULTS.chromeVersion
        },
        asarSha256: this.runtimeMetadata?.asarSha256,
        setupAttemptCount: this.lastSetupAttemptCount,
        captureAttemptCount
      },
      raw: {
        editorSource: runtime.source,
        fileBytes,
        processLog: this.process.log
      }
    });
  }

  async runScenario(scenario) {
    const actions = scenarioActionSequence(scenario);
    const traceActions = this.options.traceActions === true;
    const actionTrace = [];
    let finalObservation = null;
    let lastTraceObservation = null;
    let activeActionIndex = null;
    try {
      await this.setup(scenario);
      for (let index = 0; index < actions.length; index += 1) {
        const rawAction = actions[index];
        activeActionIndex = index;
        const action = rawAction?.type === 'mouse' && rawAction.command === 'click'
          && !Number.isFinite(Number(rawAction.offset))
          ? { ...rawAction, offset: scenario?.boundary?.offset ?? scenario?.initialSelection?.focus }
          : rawAction;
        await this.dispatch(action);
        if (traceActions) {
          const captureStartedAt = Date.now();
          lastTraceObservation = await this.captureActionTrace(scenario);
          lastTraceObservation.metadata = {
            ...lastTraceObservation.metadata,
            actionTraceCaptureDurationMs: Date.now() - captureStartedAt
          };
          actionTrace.push({
            index,
            action: rawAction,
            observation: compactActionTraceObservation(lastTraceObservation)
          });
        }
        activeActionIndex = null;
      }
      finalObservation = await this.capture(scenario);
      if (traceActions) {
        finalObservation.actionTrace = actionTrace;
        finalObservation.metadata = {
          ...finalObservation.metadata,
          actionTrace: {
            enabled: true,
            expectedActionCount: actions.length,
            capturedActionCount: actionTrace.length,
            complete: true,
            finalObservationReused: false,
            timingPreservingIntermediateCapture: true
          }
        };
      }
      return finalObservation;
    } catch (error) {
      if (error instanceof IsolationSafetyError) throw error;
      const failed = nonAutomatableObservation({
        scenarioId: scenario?.id || 'obsidian-o1-scenario',
        evidenceLevel: 'O1',
        source: finalObservation?.source
          ?? lastTraceObservation?.source
          ?? (typeof scenario?.initialSource === 'string' ? scenario.initialSource : ''),
        error,
        metadata: {
          adapter: 'obsidian-o1',
          isolated: true,
          isolatedRoot: this.isolation?.root || null,
          targetUrl: this.process?.target?.url || null
        }
      });
      if (traceActions) {
        if (activeActionIndex != null && !actionTrace.some(({ index }) => index === activeActionIndex)) {
          actionTrace.push({
            index: activeActionIndex,
            action: actions[activeActionIndex],
            observation: compactActionTraceObservation(failed)
          });
        }
        failed.actionTrace = actionTrace;
        failed.metadata = {
          ...failed.metadata,
          actionTrace: {
            enabled: true,
            expectedActionCount: actions.length,
            capturedActionCount: actionTrace.length,
            complete: false,
            finalObservationReused: false
          }
        };
      }
      return failed;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.process?.stop().catch(() => {});
    this.process = null;
    if (this.isolation && !this.options.keepArtifacts) {
      await removeIsolatedRuntimeRoot(this.isolation.root, {
        expectedToken: this.isolation.sentinel.token
      });
    }
  }
}

export async function runObsidianO1Scenario(scenario, options = {}) {
  let adapter;
  try {
    adapter = await ObsidianO1Adapter.launch(options);
    return await adapter.runScenario(scenario);
  } catch (error) {
    if (error instanceof IsolationSafetyError) throw error;
    return nonAutomatableObservation({
      scenarioId: scenario?.id || 'obsidian-o1-scenario',
      evidenceLevel: 'O1',
      source: typeof scenario?.initialSource === 'string' ? scenario.initialSource : '',
      error,
      metadata: { adapter: 'obsidian-o1', isolated: true }
    });
  } finally {
    await adapter?.close();
  }
}
