/* Shared External Link editor and Page-level External Links interactions. */
let externalLinkEditorId = 0;

function desktopExternalLinksAvailable() {
  return window.cneDesktop?.isDesktop === true
    && typeof window.cneDesktop.selectExternalLinkFile === 'function'
    && typeof window.cneDesktop.openExternalLinkTarget === 'function';
}

function desktopExternalLinkDropAvailable() {
  return window.cneDesktop?.isDesktop === true
    && typeof window.cneDesktop.registerDroppedExternalLinkFile === 'function';
}

function createExternalLinkEditor(runtime, container, {
  initial = null,
  initialMode = externalLinkTargetMode,
  onValidityChange = () => {},
  onModeChange = () => {}
} = {}) {
  container.replaceChildren();
  const editorContext = runtime?.externalLinkEditorContext || null;
  let controller = null;
  let destroyed = false;
  const editorIsCurrent = () => !destroyed
    && runtimeIsLive(runtime)
    && runtime.externalLinkEditorContext === editorContext
    && runtime.externalLinkEditorController === controller;
  const state = {
    displayName: initial?.displayName || '',
    mode: initial?.targetKind || externalLinksModel.normalizeTargetMode(initialMode),
    url: initial?.url || '',
    fileRef: initial?.fileRef || null,
    displayPath: initial?.displayPath || initial?.fileRef?.relativePath || '',
    fileName: initial?.fileName || '',
    error: '',
    displayTouched: false,
    urlTouched: false
  };
  externalLinkEditorId += 1;
  const editorId = `external-link-editor-${externalLinkEditorId}`;

  const root = document.createElement('div');
  root.className = 'external-link-editor';
  const displayRow = document.createElement('label');
  displayRow.className = 'external-link-editor-row';
  const displayLabel = document.createElement('span');
  displayLabel.textContent = 'Display as:';
  const displayInput = document.createElement('input');
  displayInput.type = 'text';
  displayInput.maxLength = 512;
  displayInput.value = state.displayName;
  const displayError = document.createElement('span');
  displayError.id = `${editorId}-display-error`;
  displayError.className = 'external-link-editor-error external-link-field-error';
  displayError.setAttribute('role', 'status');
  displayError.hidden = true;
  displayInput.setAttribute('aria-describedby', displayError.id);
  displayRow.append(displayLabel, displayInput, displayError);

  const targetRow = document.createElement('div');
  targetRow.className = 'external-link-editor-row external-link-target-row';
  const targetLabel = document.createElement('label');
  const urlEditorAnchor = document.createElement('span');
  urlEditorAnchor.className = 'external-link-url-anchor';
  const urlInput = document.createElement('textarea');
  urlInput.rows = 1;
  urlInput.className = 'external-link-url-input';
  urlInput.value = state.url;
  urlInput.setAttribute('aria-label', 'URL');
  const targetError = document.createElement('span');
  targetError.id = `${editorId}-target-error`;
  targetError.className = 'external-link-editor-error external-link-field-error';
  targetError.setAttribute('role', 'status');
  targetError.hidden = true;
  urlInput.setAttribute('aria-describedby', targetError.id);
  const fileButton = document.createElement('button');
  fileButton.type = 'button';
  fileButton.className = 'external-link-file-path ui-outline-action';
  const orLabel = document.createElement('span');
  orLabel.className = 'external-link-or-label';
  orLabel.textContent = '/ Or';
  const switchButton = document.createElement('button');
  switchButton.type = 'button';
  switchButton.className = 'external-link-mode-action ui-outline-action';
  targetRow.append(targetLabel, urlEditorAnchor, fileButton, orLabel, switchButton, targetError);

  const generalError = document.createElement('div');
  generalError.className = 'external-link-editor-error';
  generalError.setAttribute('role', 'status');
  generalError.hidden = true;
  root.append(displayRow, targetRow, generalError);
  container.append(root);

  function draft() {
    return {
      displayName: state.displayName,
      targetKind: state.mode,
      url: state.mode === 'url' ? state.url : null,
      fileRef: state.mode === 'file' ? state.fileRef : null
    };
  }

  function validation() {
    return externalLinksModel.validateDraft(draft());
  }

  function notify() {
    const result = validation();
    const errors = result.errors || {};
    const showDisplayError = Boolean(errors.displayName)
      && (state.displayTouched || state.url.trim() || state.fileRef);
    const showTargetError = state.mode === 'url'
      ? Boolean(errors.url) && (state.urlTouched || state.displayName.trim())
      : Boolean(errors.fileRef) && Boolean(state.displayName.trim());
    displayError.textContent = showDisplayError ? errors.displayName : '';
    displayError.hidden = !showDisplayError;
    targetError.textContent = showTargetError
      ? (state.mode === 'url' ? errors.url : errors.fileRef)
      : '';
    targetError.hidden = !showTargetError;
    displayInput.setAttribute('aria-invalid', String(showDisplayError));
    urlInput.setAttribute('aria-invalid', String(state.mode === 'url' && showTargetError));
    fileButton.setAttribute('aria-invalid', String(state.mode === 'file' && showTargetError));
    fileButton.setAttribute('aria-describedby', targetError.id);
    generalError.textContent = state.error;
    generalError.hidden = !state.error;
    onValidityChange(result.valid, result);
  }

  function renderMode() {
    const urlMode = state.mode === 'url';
    targetLabel.textContent = urlMode ? 'URL:' : 'Path:';
    urlEditorAnchor.hidden = !urlMode;
    fileButton.hidden = urlMode;
    if (urlMode && !urlEditorAnchor.contains(urlInput)) urlEditorAnchor.append(urlInput);
    fileButton.textContent = state.displayPath || 'Select a file';
    fileButton.classList.toggle('is-placeholder', !state.displayPath);
    switchButton.textContent = urlMode ? 'Select' : 'URL';
    switchButton.disabled = urlMode && !desktopExternalLinksAvailable();
    notify();
  }

  function setMode(mode) {
    state.mode = externalLinksModel.normalizeTargetMode(mode);
    externalLinkTargetMode = state.mode;
    state.error = '';
    renderMode();
    onModeChange(state.mode);
    scheduleWorkspaceStateSave();
  }

  async function chooseFile() {
    if (!desktopExternalLinksAvailable()) {
      state.error = 'Local file selection is available in the desktop app.';
      notify();
      return;
    }
    const operation = captureRuntimeOperation(runtime, {
      scope: 'external-link-file-selection'
    });
    const result = await window.cneDesktop.selectExternalLinkFile();
    if (!runtimeOperationIsCurrent(operation) || !editorIsCurrent()) return;
    if (result?.cancelled) return;
    if (!result?.ok) {
      state.error = result?.error || 'The selected file could not be linked.';
      notify();
      return;
    }
    applyDroppedTarget({ targetKind: 'file', ...result });
  }

  function applyDroppedTarget(target) {
    if (target?.targetKind === 'url') {
      const url = externalLinksModel.normalizeWebUrl(target.url);
      if (!url) return false;
      state.url = url;
      state.urlTouched = true;
      state.fileRef = null;
      state.displayPath = '';
      state.fileName = '';
      urlInput.value = url;
      if (!state.displayName.trim() && target.displayName) {
        state.displayName = externalLinksModel.normalizeDisplayName(target.displayName);
        displayInput.value = state.displayName;
      }
      state.error = '';
      setMode('url');
      return true;
    }
    if (target?.targetKind !== 'file' || !target.fileRef) return false;
    state.fileRef = target.fileRef;
    state.displayPath = target.displayPath || target.fileName || target.fileRef?.relativePath || '';
    state.fileName = target.fileName || '';
    state.url = '';
    urlInput.value = '';
    if (!state.displayName.trim()) {
      state.displayName = externalLinksModel.displayNameAfterFileSelection(
        state.displayName, state.fileName
      );
      displayInput.value = state.displayName;
    }
    state.error = '';
    setMode('file');
    return true;
  }

  function collapseUrlEditor() {
    urlInput.classList.remove('is-expanded');
    for (const property of ['position', 'left', 'top', 'width', 'height']) {
      urlInput.style.removeProperty(property);
    }
  }

  function expandUrlEditor() {
    const rect = urlEditorAnchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(280, rect.width) - 8));
    const availableBelow = window.innerHeight - rect.top - 8;
    urlInput.classList.add('is-expanded');
    urlInput.style.position = 'fixed';
    urlInput.style.left = `${left}px`;
    urlInput.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 80))}px`;
    urlInput.style.width = `${Math.min(Math.max(280, rect.width), window.innerWidth - left - 8)}px`;
    urlInput.style.height = `${Math.max(48, Math.min(88, availableBelow))}px`;
  }

  displayInput.addEventListener('input', () => {
    state.displayName = displayInput.value;
    state.displayTouched = true;
    state.error = '';
    notify();
  });
  urlInput.addEventListener('input', () => {
    state.url = urlInput.value;
    state.urlTouched = true;
    if (state.url.trim()) {
      state.fileRef = null;
      state.displayPath = '';
      state.fileName = '';
    }
    state.error = '';
    notify();
  });
  urlInput.addEventListener('focus', () => requestAnimationFrame(expandUrlEditor));
  urlInput.addEventListener('blur', collapseUrlEditor);
  fileButton.addEventListener('click', chooseFile);
  switchButton.addEventListener('click', () => {
    if (state.mode === 'url') chooseFile();
    else setMode('url');
  });

  renderMode();
  if (initial?.targetKind === 'file' && initial.fileRef
    && typeof window.cneDesktop?.describeExternalLinkFile === 'function') {
    const operation = captureRuntimeOperation(runtime, {
      scope: 'external-link-file-description'
    });
    window.cneDesktop.describeExternalLinkFile(initial.fileRef).then((result) => {
      if (!runtimeOperationIsCurrent(operation) || !editorIsCurrent()
        || !result?.ok || state.fileRef !== initial.fileRef) return;
      state.displayPath = result.displayPath || state.displayPath;
      state.fileName = result.fileName || state.fileName;
      renderMode();
    });
  }

  controller = {
    focus: () => displayInput.focus(),
    applyDroppedTarget,
    getDraft: draft,
    getValidation: validation,
    setError(message) { state.error = message || ''; notify(); },
    destroy() {
      destroyed = true;
      collapseUrlEditor();
      container.replaceChildren();
    }
  };
  return controller;
}

function externalLinksForPage(page) {
  return externalLinksModel.normalizeExternalLinks(page?.externalLinks);
}

function externalLinksForBlock(runtime, blockId, page = runtime.currentPage) {
  return externalLinksForPage(page).filter((link) => link.sourceBlockId === blockId);
}

function clickableBlockTargets(runtime, block) {
  return [
    ...getBlockLinks(block).map((link) => ({
      kind: link.targetType === 'page' && link.targetPageId ? 'page' : 'unsupported',
      id: link.id,
      label: pageIndex?.pages?.find((page) => page.id === link.targetPageId)?.title
        || link.label
        || link.targetPageId
        || link.id,
      link
    })),
    ...externalLinksForBlock(runtime, block.id).map((link) => ({
      kind: 'external', id: link.id, label: link.displayName, link
    }))
  ];
}

async function openExternalLinkTarget(runtime, link) {
  if (runtime !== activePaneRuntime()) return false;
  if (!desktopExternalLinksAvailable()) {
    showRuntimeStatus(runtime, 'External targets are available in the desktop app.', true, 2200);
    return false;
  }
  const operation = captureRuntimeOperation(runtime, {
    scope: 'external-link-open'
  });
  const result = await window.cneDesktop.openExternalLinkTarget({
    targetKind: link.targetKind,
    url: link.targetKind === 'url' ? link.url : null,
    fileRef: link.targetKind === 'file' ? link.fileRef : null
  });
  if (!runtimeOperationIsCurrent(operation)) return false;
  if (!result?.ok) {
    showRuntimeStatus(runtime, result?.error || 'The external target could not be opened.', true, 2400);
    return false;
  }
  return true;
}

function closeBlockLinkChoicePopover() {
  if (!blockLinkChoicePopover) return;
  blockLinkChoicePopover.hidden = true;
  blockLinkChoicePopover.replaceChildren();
}

function positionFloatingPopover(popover, anchor, { side = 'below' } = {}) {
  popover.hidden = false;
  const anchorRect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8));
  const below = anchorRect.bottom + 6;
  const top = side === 'below' && below + height <= window.innerHeight - 8
    ? below
    : Math.max(8, anchorRect.top - height - 6);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function openBlockLinkChoice(runtime, block, anchor) {
  closeBlockLinkChoicePopover();
  if (runtime !== activePaneRuntime() || !blockIsInteractive(runtime, block)) return;
  for (const target of clickableBlockTargets(runtime, block)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'block-link-choice-row';
    button.textContent = target.label || target.id;
    button.addEventListener('click', () => {
      closeBlockLinkChoicePopover();
      if (runtime !== activePaneRuntime()) return;
      if (target.kind === 'page') navigateCurrentTabToPage(runtime, target.link.targetPageId);
      else if (target.kind === 'external') openExternalLinkTarget(runtime, target.link);
      else showRuntimeStatus(runtime, 'This block link type is not available yet.', false, 2400);
    });
    blockLinkChoicePopover.append(button);
  }
  positionFloatingPopover(blockLinkChoicePopover, anchor);
}

function closeSidebarExternalLinkEditor(runtime) {
  if (!runtime || !externalLinkSidebarPopover || externalLinkSidebarPopover.hidden
    || runtime?.externalLinkEditorContext?.kind === 'block') return;
  externalLinkSidebarPopover.hidden = true;
  runtime.externalLinkEditorController?.destroy();
  runtime.externalLinkEditorController = null;
  runtime.externalLinkEditorContext = null;
  clearExternalLinkDropFeedback();
}

function clearExternalLinkBlockHover(runtime) {
  if (!runtime?.externalLinkHoveredBlockId) return;
  const overlay = blockOverlay(runtime, runtime.externalLinkHoveredBlockId);
  if (overlay) setBlockState(runtime, overlay, 'external-link-hover', null);
  runtime.externalLinkHoveredBlockId = null;
}

function setExternalLinkBlockHover(runtime, link, active) {
  if (!runtimeIsLive(runtime) || (active && runtime !== activePaneRuntime())) return;
  const sourceBlockId = typeof link?.sourceBlockId === 'string' ? link.sourceBlockId : null;
  if (!active) {
    if (sourceBlockId === runtime.externalLinkHoveredBlockId) clearExternalLinkBlockHover(runtime);
    return;
  }

  clearExternalLinkBlockHover(runtime);
  if (!sourceBlockId
    || !(runtime.currentPage?.blocks || []).some((block) => block.id === sourceBlockId)) return;
  const overlay = blockOverlay(runtime, sourceBlockId);
  if (!overlay) return;
  runtime.externalLinkHoveredBlockId = sourceBlockId;
  setBlockState(runtime, overlay, 'external-link-hover', BLOCK_STATE.ACTIVE);
}

function positionSidebarExternalLinkPopover(runtime) {
  if (runtime?.externalLinkEditorContext?.kind !== 'sidebar') return;
  if (!externalLinksAddButton || externalLinkSidebarPopover.hidden) return;
  positionFloatingPopover(externalLinkSidebarPopover, externalLinksAddButton);
}

function openSidebarExternalLinkEditor(runtime, link = null) {
  if (runtime !== activePaneRuntime() || !runtime?.currentPage || !externalLinksAddButton) return;
  clearExternalLinkBlockHover(runtime);
  closeAddLinkPopover(runtime);
  for (const candidate of livingPaneRuntimes()) {
    if (candidate.externalLinkEditorContext?.kind === 'sidebar') {
      closeSidebarExternalLinkEditor(candidate);
    }
  }
  runtime.externalLinkEditorContext = {
    kind: 'sidebar', pageId: runtime.currentPage.id, externalLinkId: link?.id || null,
    sourceBlockId: link?.sourceBlockId || null
  };
  externalLinkSidebarConfirm.textContent = link ? 'Save' : 'Add';
  runtime.externalLinkEditorController = createExternalLinkEditor(runtime, externalLinkSidebarEditor, {
    initial: link,
    initialMode: link?.targetKind || externalLinkTargetMode,
    onValidityChange(valid) { externalLinkSidebarConfirm.disabled = !valid; }
  });
  externalLinkSidebarPopover.hidden = false;
  positionSidebarExternalLinkPopover(runtime);
  runtime.externalLinkEditorController.focus();
}

async function saveSidebarExternalLink(runtime) {
  const context = runtime?.externalLinkEditorContext;
  const controller = runtime?.externalLinkEditorController;
  const validation = controller?.getValidation();
  if (context?.kind !== 'sidebar' || !validation?.valid
    || runtime !== activePaneRuntime() || runtime.currentPage?.id !== context.pageId) return;
  const operation = captureRuntimeOperation(runtime, {
    pageId: context.pageId,
    scope: 'sidebar-external-link-save'
  });
  const editorIntentIsCurrent = () => runtimeOperationIsCurrent(operation)
    && runtime === activePaneRuntime()
    && runtime.externalLinkEditorContext === context
    && runtime.externalLinkEditorController === controller;
  externalLinkSidebarConfirm.disabled = true;
  try {
    const suffix = context.externalLinkId
      ? `/external-links/${encodeURIComponent(context.externalLinkId)}`
      : '/external-links';
    const saved = await request(pageApiUrl(context.pageId, suffix), {
      method: context.externalLinkId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validation.value, sourceBlockId: context.sourceBlockId })
    });
    const operationIsCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(saved.page, {
      originRuntime: operationIsCurrent ? runtime : null
    });
    if (!operationIsCurrent) return;
    if (editorIntentIsCurrent()) closeSidebarExternalLinkEditor(runtime);
    if (runtime === activePaneRuntime()) renderExternalLinks(runtime, canonical);
    renderBlockOverlays(runtime, canonical.blocks);
  } catch (error) {
    if (editorIntentIsCurrent()) {
      controller?.setError(error.message);
      externalLinkSidebarConfirm.disabled = false;
    }
  }
}

async function deleteExternalLink(runtime, link) {
  if (!runtime?.currentPage || !link) return;
  const pageId = runtime.currentPage.id;
  const operation = captureRuntimeOperation(runtime, {
    pageId,
    scope: 'external-link-delete'
  });
  try {
    const saved = await request(pageApiUrl(
      pageId, `/external-links/${encodeURIComponent(link.id)}`
    ), { method: 'DELETE' });
    const operationIsCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(saved.page, {
      originRuntime: operationIsCurrent ? runtime : null
    });
    if (!operationIsCurrent) return;
    if (runtime === activePaneRuntime()) renderExternalLinks(runtime, canonical);
    renderBlockOverlays(runtime, canonical.blocks);
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, error.message, true, 2400);
    }
  }
}

async function openExternalLinkContextMenu(runtime, event, link) {
  if (runtime !== activePaneRuntime() || !window.nativeContextMenu?.available()) return;
  const pageId = runtime.currentPage?.id;
  const operation = captureRuntimeOperation(runtime, {
    pageId,
    scope: 'external-link-menu'
  });
  const command = await window.nativeContextMenu.open(event, {
    type: 'external-link', targetId: link.id
  });
  if (!command || !runtimeOperationIsCurrent(operation)) return;
  const fresh = externalLinksForPage(runtime.currentPage).find((item) => item.id === link.id);
  if (!fresh) return;
  if (command === 'open-external-link') openExternalLinkTarget(runtime, fresh);
  else if (command === 'edit-external-link') openSidebarExternalLinkEditor(runtime, fresh);
  else if (command === 'delete-external-link') deleteExternalLink(runtime, fresh);
}

function renderExternalLinks(runtime, page) {
  if (runtime !== activePaneRuntime() || !externalLinksList) return;
  clearExternalLinkBlockHover(runtime);
  externalLinksList.replaceChildren();
  if (externalLinksAddButton) externalLinksAddButton.disabled = !page?.id;
  const links = externalLinksForPage(page).sort((left, right) => (
    navigationSort.compareVisibleNames(left.displayName, right.displayName, (value) => value)
      || left.id.localeCompare(right.id)
  ));
  if (!links.length) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = 'No external links.';
    externalLinksList.append(empty);
    return;
  }
  for (const link of links) {
    const item = document.createElement('li');
    item.className = 'external-link-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'external-link-row file-typography';
    button.textContent = link.displayName;
    const tooltip = document.createElement('span');
    tooltip.className = 'external-link-tooltip system-typography';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = externalLinksModel.targetLabel(link);
    if (link.targetKind === 'file' && typeof window.cneDesktop?.describeExternalLinkFile === 'function') {
      const operation = captureRuntimeOperation(runtime, {
        pageId: page?.id,
        scope: 'external-link-tooltip'
      });
      window.cneDesktop.describeExternalLinkFile(link.fileRef).then((result) => {
        if (runtimeOperationIsCurrent(operation)
          && result?.ok && button.isConnected) tooltip.textContent = result.displayPath;
      });
    }
    button.addEventListener('click', () => openExternalLinkTarget(runtime, link));
    button.addEventListener('contextmenu', (event) => openExternalLinkContextMenu(runtime, event, link));
    button.addEventListener('mouseenter', () => setExternalLinkBlockHover(runtime, link, true));
    button.addEventListener('mouseleave', () => setExternalLinkBlockHover(runtime, link, false));
    const positionTooltip = () => {
      const rect = button.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 448))}px`;
      tooltip.style.top = `${Math.min(window.innerHeight - 40, rect.bottom + 4)}px`;
    };
    button.addEventListener('pointerenter', positionTooltip);
    button.addEventListener('focus', positionTooltip);
    item.append(button, tooltip);
    externalLinksList.append(item);
  }
}

function externalLinkDropUrl(dataTransfer) {
  if (!dataTransfer) return null;
  const read = (type) => {
    try { return dataTransfer.getData(type) || ''; } catch { return ''; }
  };
  return externalLinksModel.externalLinkUrlFromDropData({
    uriList: read('text/uri-list'),
    html: read('text/html'),
    plainText: read('text/plain')
  });
}

function externalLinkDropCandidate(dataTransfer) {
  if (!dataTransfer) return null;
  const files = Array.from(dataTransfer.files || []);
  const hasFileItem = Array.from(dataTransfer.items || []).some((item) => item.kind === 'file');
  if (files.length || hasFileItem) return { targetKind: 'file', files };
  return externalLinkDropUrl(dataTransfer);
}

function externalLinkDragMayContainTarget(dataTransfer) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || [], (type) => String(type).toLowerCase());
  return types.includes('files')
    || types.includes('text/uri-list')
    || types.includes('text/html')
    || types.includes('text/plain');
}

function clearExternalLinkDropFeedback() {
  document.querySelectorAll('.is-external-link-drop-target').forEach((element) => {
    element.classList.remove('is-external-link-drop-target');
  });
}

async function resolveExternalLinkDrop(runtime, candidate, operation = null) {
  if (candidate?.targetKind === 'url') return candidate;
  if (candidate?.targetKind !== 'file' || !candidate.files.length
    || !desktopExternalLinkDropAvailable()) return null;
  const result = await window.cneDesktop.registerDroppedExternalLinkFile(candidate.files);
  if (operation && !runtimeOperationIsCurrent(operation)) return null;
  if (!result?.ok) {
    showRuntimeStatus(runtime, result?.error || 'The dropped file could not be linked.', true, 2400);
    return null;
  }
  return { targetKind: 'file', ...result };
}

function bindExternalLinkDropTarget(element, contextKind) {
  if (!element) return;
  const validCandidate = (event) => externalLinkDropCandidate(event.dataTransfer);
  const ownerRuntime = () => {
    const activeRuntime = activePaneRuntime();
    if (contextKind === 'block') {
      return activeRuntime?.externalLinkEditorContext?.kind === 'block' ? activeRuntime : null;
    }
    if (element === externalLinkSidebarPopover) {
      return activeRuntime?.externalLinkEditorContext?.kind === 'sidebar' ? activeRuntime : null;
    }
    return activeRuntime;
  };

  element.addEventListener('dragenter', (event) => {
    const runtime = ownerRuntime();
    if (!runtime?.currentPage || (contextKind === 'block' && addLinkPopover.hidden)) return;
    const candidate = validCandidate(event);
    if (!candidate && !externalLinkDragMayContainTarget(event.dataTransfer)) return;
    event.preventDefault();
    if (candidate) element.classList.add('is-external-link-drop-target');
  });
  element.addEventListener('dragover', (event) => {
    const runtime = ownerRuntime();
    if (!runtime?.currentPage || (contextKind === 'block' && addLinkPopover.hidden)) return;
    const candidate = validCandidate(event);
    if (!candidate && !externalLinkDragMayContainTarget(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'link';
    if (candidate) element.classList.add('is-external-link-drop-target');
  });
  element.addEventListener('dragleave', (event) => {
    if (!element.contains(event.relatedTarget)) {
      element.classList.remove('is-external-link-drop-target');
    }
  });
  element.addEventListener('drop', async (event) => {
    const runtime = ownerRuntime();
    const candidate = validCandidate(event);
    if (!candidate || !runtime?.currentPage
      || (contextKind === 'block' && addLinkPopover.hidden)) return;
    event.preventDefault();
    event.stopPropagation();
    clearExternalLinkDropFeedback();
    const pageId = runtime.currentPage.id;
    const linkTarget = runtime.addLinkTarget;
    const linkSelection = runtime.addLinkSelection;
    const editorContext = runtime.externalLinkEditorContext;
    const editorController = runtime.externalLinkEditorController;
    const sourceBlockId = contextKind === 'block' ? runtime.addLinkTarget?.blockId : null;
    const operation = captureRuntimeOperation(runtime, {
      pageId,
      scope: 'external-link-drop'
    });
    const target = await resolveExternalLinkDrop(runtime, candidate, operation);
    if (!target || !runtimeOperationIsCurrent(operation)
      || runtime !== activePaneRuntime()
      || runtime.addLinkTarget !== linkTarget
      || runtime.addLinkSelection !== linkSelection
      || runtime.externalLinkEditorContext !== editorContext
      || runtime.externalLinkEditorController !== editorController) return;
    if (contextKind === 'block') {
      if (!sourceBlockId || runtime.addLinkTarget?.blockId !== sourceBlockId
        || addLinkPopover.hidden) return;
      if (runtime.addLinkSelection !== 'external') activateBlockExternalLinkEditor(runtime);
    } else if (runtime.externalLinkEditorContext?.kind !== 'sidebar') {
      openSidebarExternalLinkEditor(runtime);
    }
    runtime.externalLinkEditorController?.applyDroppedTarget(target);
  });
}

function activateBlockExternalLinkEditor(runtime) {
  if (runtime !== activePaneRuntime()) return;
  exitLinkPickMode(runtime);
  setAddLinkSelection(runtime, 'external');
}

function mountBlockExternalLinkEditor(runtime) {
  if (runtime !== activePaneRuntime()) return;
  runtime.externalLinkEditorController?.destroy();
  runtime.externalLinkEditorContext = {
    kind: 'block',
    pageId: runtime.currentPage?.id || null,
    sourceBlockId: runtime.addLinkTarget?.blockId || null
  };
  runtime.externalLinkEditorController = createExternalLinkEditor(runtime, addLinkExternalEditor, {
    initialMode: externalLinkTargetMode,
    onValidityChange(valid) {
      if (runtime.addLinkSelection === 'external') {
        addLinkConfirmButton.disabled = runtime.addLinkInProgress || !valid;
      }
    }
  });
  const editorContext = runtime.externalLinkEditorContext;
  const editorController = runtime.externalLinkEditorController;
  const linkTarget = runtime.addLinkTarget;
  const anchor = runtime.addLinkTarget?.blockId
    ? blockOverlay(runtime, runtime.addLinkTarget.blockId)
    : null;
  if (anchor) requestAnimationFrame(() => {
    if (runtime !== activePaneRuntime()
      || runtime.externalLinkEditorContext !== editorContext
      || runtime.externalLinkEditorController !== editorController
      || runtime.addLinkTarget !== linkTarget
      || runtime.addLinkSelection !== 'external') return;
    positionAddLinkPopover(runtime, anchor);
  });
}

async function confirmBlockExternalLink(runtime) {
  const editorContext = runtime?.externalLinkEditorContext;
  const controller = runtime?.externalLinkEditorController;
  const validation = controller?.getValidation();
  if (runtime !== activePaneRuntime() || !runtime?.currentPage || !runtime.addLinkTarget
    || runtime.addLinkSelection !== 'external' || !validation?.valid) return;
  const pageId = runtime.currentPage.id;
  const linkTarget = runtime.addLinkTarget;
  const sourceBlockId = runtime.addLinkTarget.blockId;
  const operation = captureRuntimeOperation(runtime, {
    pageId,
    scope: 'block-external-link-save'
  });
  const editorIntentIsCurrent = () => runtimeOperationIsCurrent(operation)
    && runtime === activePaneRuntime()
    && runtime.externalLinkEditorContext === editorContext
    && runtime.externalLinkEditorController === controller
    && runtime.addLinkTarget === linkTarget
    && runtime.addLinkSelection === 'external';
  runtime.addLinkInProgress = true;
  addLinkConfirmButton.disabled = true;
  try {
    const saved = await request(pageApiUrl(pageId, '/external-links'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validation.value, sourceBlockId })
    });
    const operationIsCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(saved.page, {
      originRuntime: operationIsCurrent ? runtime : null
    });
    if (!operationIsCurrent) return;
    if (editorIntentIsCurrent()) closeAddLinkPopover(runtime);
    if (runtime === activePaneRuntime()) renderExternalLinks(runtime, canonical);
    renderBlockOverlays(runtime, canonical.blocks);
    showRuntimeStatus(runtime, 'External Link added', false, 1800);
  } catch (error) {
    if (editorIntentIsCurrent()) controller?.setError(error.message);
  } finally {
    runtime.addLinkInProgress = false;
    if (editorIntentIsCurrent()) {
      const result = controller?.getValidation();
      addLinkConfirmButton.disabled = !result?.valid;
    }
  }
}

externalLinksAddButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  const runtime = activePaneRuntime();
  if (runtime) openSidebarExternalLinkEditor(runtime);
});
externalLinkSidebarCancel?.addEventListener('click', () => {
  const runtime = livingPaneRuntimes().find((candidate) => (
    candidate.externalLinkEditorContext?.kind === 'sidebar'
  ));
  if (runtime) closeSidebarExternalLinkEditor(runtime);
});
externalLinkSidebarConfirm?.addEventListener('click', () => {
  const runtime = livingPaneRuntimes().find((candidate) => (
    candidate.externalLinkEditorContext?.kind === 'sidebar'
  ));
  if (runtime) saveSidebarExternalLink(runtime);
});
addLinkOthersButton?.addEventListener('click', () => {
  const runtime = livingPaneRuntimes().find((candidate) => (
    candidate.addLinkTarget
      || candidate.linkPickMode
      || candidate.externalLinkEditorContext?.kind === 'block'
  )) || activePaneRuntime();
  if (runtime) activateBlockExternalLinkEditor(runtime);
});

const externalLinksSectionBody = externalLinksList?.closest('.right-section-body');
bindExternalLinkDropTarget(externalLinksSectionBody, 'sidebar');
bindExternalLinkDropTarget(externalLinkSidebarPopover, 'sidebar');
bindExternalLinkDropTarget(addLinkPopover, 'block');

document.addEventListener('pointerdown', (event) => {
  if (!externalLinkSidebarPopover?.hidden
    && !externalLinkSidebarPopover.contains(event.target)
    && !externalLinksAddButton?.contains(event.target)) {
    const runtime = livingPaneRuntimes().find((candidate) => (
      candidate.externalLinkEditorContext?.kind === 'sidebar'
    ));
    if (runtime) closeSidebarExternalLinkEditor(runtime);
  }
  if (!blockLinkChoicePopover?.hidden && !blockLinkChoicePopover.contains(event.target)) {
    closeBlockLinkChoicePopover();
  }
});
document.addEventListener('keydown', (event) => {
  if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)) return;
  if (event.key !== 'Escape') return;
  clearExternalLinkDropFeedback();
  if (!externalLinkSidebarPopover?.hidden) {
    event.preventDefault();
    const runtime = livingPaneRuntimes().find((candidate) => (
      candidate.externalLinkEditorContext?.kind === 'sidebar'
    ));
    if (runtime) closeSidebarExternalLinkEditor(runtime);
  } else if (!blockLinkChoicePopover?.hidden) {
    event.preventDefault();
    closeBlockLinkChoicePopover();
  }
});
externalLinkSidebarPopover?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter'
    && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
      event,
      event.target
    )) return;
  if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)) return;
  if (event.key === 'Enter' && !externalLinkSidebarConfirm.disabled) {
    event.preventDefault();
    const runtime = livingPaneRuntimes().find((candidate) => (
      candidate.externalLinkEditorContext?.kind === 'sidebar'
    ));
    if (runtime) saveSidebarExternalLink(runtime);
  }
});
window.addEventListener('resize', () => {
  const runtime = livingPaneRuntimes().find((candidate) => (
    candidate.externalLinkEditorContext?.kind === 'sidebar'
  ));
  if (runtime) positionSidebarExternalLinkPopover(runtime);
  if (!blockLinkChoicePopover?.hidden) closeBlockLinkChoicePopover();
});
