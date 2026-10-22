const searchInput = document.querySelector('#vocab-search');
const listEl = document.querySelector('#vocab-list');
const indexEl = document.querySelector('#vocab-index');
const newWordInput = document.querySelector('#vocab-new-word');
const clearNewWordButton = document.querySelector('#vocab-clear-new-word');
const addExistingButton = document.querySelector('#vocab-add-existing');
const createWordButton = document.querySelector('#vocab-create-word');
const statusEl = document.querySelector('#vocab-status');

let library = { version: 1, entries: [] };
let descriptorRegistry = { version: 1, entries: [] };
let searchText = '';
let addToExistingMode = false;
let highlightedEntryId = null;
let editing = null;
let renameCommitPromise = null;
let aliasContextTarget = null;
let statusTimer = null;
let highlightTimer = null;
let moveSource = null;
let dragMoveSource = null;
let dragLabel = null;
let hintEl = null;
let hintTimer = null;
let hintTrigger = null;
let currentDropTargetEntryId = null;
let libraryReady = false;
const pendingDictionaryCommands = [];
const dictionaryChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('cogneuro-dictionary')
  : null;
const descriptorMetadataInstaller = descriptorMetadataInstallModel.createRevisionInstaller({
  apply: (changeSet) => {
    library = changeSet.vocabulary || library;
    descriptorRegistry = changeSet.descriptorRegistry;
  }
});
const appearanceInvalidationClient = globalThis.vaultAppearanceEventsModel.createInvalidationClient({
  fetchAppearance: () => request('/api/appearance'),
  applyAppearance: (appearance) => {
    appearanceSettingsModel?.applyAppearanceSettings?.(document.documentElement, appearance);
  },
  onError: (error) => console.warn('Vocabulary Appearance refresh failed.', error)
});

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  if (body?.metadataChangeSet) {
    await descriptorMetadataInstaller.install(body, { source: 'request', event: body });
  }
  return body;
}

function showStatus(message, isError = false, clearAfter = 0) {
  clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  if (clearAfter) {
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
      statusEl.classList.remove('error');
    }, clearAfter);
  }
}

function normalizeWord(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function sortedAliases(entry) {
  return [...(entry.aliases || [])].sort((a, b) => a.localeCompare(b));
}

function sortedEntries() {
  return [...(library.entries || [])].sort((a, b) => a.display.localeCompare(b.display));
}

function entryById(entryId) {
  return (library.entries || []).find((entry) => entry.id === entryId);
}

function aliasOriginalIndex(entry, alias) {
  return (entry.aliases || []).findIndex((item) => item === alias);
}

function sourceWord(source) {
  const entry = entryById(source?.entryId);
  if (!entry) return '';
  return source.kind === 'alias' ? entry.aliases?.[source.aliasIndex] || '' : entry.display;
}

function sameVocabularySource(a, b) {
  return a?.entryId === b?.entryId
    && a?.kind === b?.kind
    && (a?.kind !== 'alias' || a?.aliasIndex === b?.aliasIndex);
}

function beginRename(source) {
  const originalValue = sourceWord(source);
  if (!source?.entryId || !source?.kind || !originalValue) return;
  showStatus('');
  editing = {
    entryId: source.entryId,
    kind: source.kind,
    aliasIndex: source.kind === 'alias' ? source.aliasIndex : undefined,
    originalValue,
    draftValue: originalValue
  };
  render();
}

async function beginRenameAfterCurrentCommit(source) {
  if (editing && !sameVocabularySource(editing, source)) {
    const committed = await commitRename();
    if (!committed) return;
  }
  beginRename(source);
}

function sourceHasAliases(source) {
  const entry = entryById(source?.entryId);
  return source?.kind === 'display' && Boolean(entry?.aliases?.length);
}

function beginTemporaryHighlight(entryId, duration = 1200) {
  clearTimeout(highlightTimer);
  clearFloatingHint();
  highlightedEntryId = entryId;
  render();
  scrollToEntry(entryId);
  highlightTimer = setTimeout(() => {
    if (highlightedEntryId === entryId) {
      highlightedEntryId = null;
      render();
    }
  }, duration);
}

function setFloatingHint(message, x = window.innerWidth / 2, y = 80, trigger = null, kind = '') {
  clearTimeout(hintTimer);
  hintTimer = null;
  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.className = 'vocab-floating-hint';
    document.body.append(hintEl);
  }
  hintEl.classList.toggle('vocab-move-follow-hint', kind === 'move');
  hintTrigger = trigger;
  hintEl.textContent = message;
  hintEl.style.left = `${Math.min(x + 10, window.innerWidth - hintEl.offsetWidth - 12)}px`;
  hintEl.style.top = `${Math.min(y + 10, window.innerHeight - hintEl.offsetHeight - 12)}px`;
}

function clearFloatingHint(trigger = null) {
  if (trigger && hintTrigger && trigger !== hintTrigger) return;
  clearTimeout(hintTimer);
  hintTimer = null;
  hintEl?.remove();
  hintEl = null;
  hintTrigger = null;
}

function showFloatingHint(message, x = window.innerWidth / 2, y = 80, duration = 1500) {
  setFloatingHint(message, x, y);
  hintTimer = setTimeout(() => {
    hintEl?.remove();
    hintEl = null;
    hintTimer = null;
    hintTrigger = null;
  }, duration);
}

function notifyDictionaryChanged(change = {}) {
  const event = {
    type: 'dictionary-data-changed',
    eventId: `dictionary_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    operation: change.operation || 'update',
    vocabularyEntryIds: change.vocabularyEntryIds || [],
    descriptorEntryIds: change.descriptorEntryIds || [],
    affectedPageIds: change.affectedPageIds || [],
    descriptorIdRemap: change.descriptorIdRemap || {},
    vocabularyEntryIdRemap: change.vocabularyEntryIdRemap || {},
    metadataChangeSet: change.metadataChangeSet || null
  };
  dictionaryChannel?.postMessage(event);
  if (window.opener && !window.opener.closed) window.opener.postMessage(event, window.location.origin);
}

function moveBlockedMessage(source) {
  if (sourceHasAliases(source)) return 'Cannot move a word that has aliases. Set another word as display first.';
  return '';
}

function validMoveSource(source) {
  return Boolean(source?.entryId && sourceWord(source));
}

function uniqueEntryId(display) {
  const existingIds = new Set((library.entries || []).map((entry) => entry.id));
  const slug = normalizeWord(display)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || Math.random().toString(16).slice(2, 10);
  let id = `vocab_${slug}`;
  let number = 1;
  while (existingIds.has(id)) {
    id = `vocab_${slug}_${number}`;
    number += 1;
  }
  return id;
}

function textConflict(text, skip = {}) {
  const word = normalizeWord(text);
  if (!word) return null;

  for (const entry of library.entries || []) {
    if (!(skip.entryId === entry.id && skip.kind === 'display') && entry.display === word) {
      return { entry, text: entry.display };
    }
    for (let index = 0; index < (entry.aliases || []).length; index += 1) {
      const alias = entry.aliases[index];
      if (skip.entryId === entry.id && skip.kind === 'alias' && skip.aliasIndex === index) continue;
      if (alias === word) return { entry, text: alias };
    }
  }

  return null;
}

function searchMatch() {
  const query = searchText.trim().toLowerCase();
  if (!query) return null;

  const matches = [];
  const entries = sortedEntries();
  const entryOrder = new Map(entries.map((entry, index) => [entry.id, index]));
  for (const entry of entries) {
    const display = entry.display.toLowerCase();
    if (display === query) {
      matches.push({ priority: 1, entryId: entry.id, kind: 'display', text: entry.display });
    } else if (display.startsWith(query)) {
      matches.push({ priority: 3, entryId: entry.id, kind: 'display', text: entry.display });
    } else if (display.includes(query)) {
      matches.push({ priority: 5, entryId: entry.id, kind: 'display', text: entry.display });
    }

    for (const alias of sortedAliases(entry)) {
      const normalizedAlias = alias.toLowerCase();
      if (normalizedAlias === query) {
        matches.push({ priority: 2, entryId: entry.id, kind: 'alias', text: alias });
      } else if (normalizedAlias.startsWith(query)) {
        matches.push({ priority: 4, entryId: entry.id, kind: 'alias', text: alias });
      } else if (normalizedAlias.includes(query)) {
        matches.push({ priority: 6, entryId: entry.id, kind: 'alias', text: alias });
      }
    }
  }

  matches.sort((a, b) => a.priority - b.priority
    || entryOrder.get(a.entryId) - entryOrder.get(b.entryId));
  return matches[0] || null;
}

function locateSearchMatch() {
  const query = searchText.trim();
  if (!query) {
    highlightedEntryId = null;
    render();
    return;
  }

  const match = searchMatch();
  if (!match) {
    highlightedEntryId = null;
    render();
    showStatus(`No match for "${query}".`, true);
    return;
  }

  highlightedEntryId = match.entryId;
  render();
  scrollToEntry(match.entryId);
  showStatus('');
}

function renderIndex(entries) {
  const availableLetters = new Set(entries.map((entry) => entry.display.trim()[0]?.toUpperCase()).filter((letter) => /^[A-Z]$/.test(letter)));
  indexEl.replaceChildren();
  let pointerDown = false;

  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = letter;
    button.disabled = !availableLetters.has(letter);
    button.addEventListener('click', () => jumpToLetter(letter));
    button.addEventListener('pointerdown', () => {
      pointerDown = true;
      jumpToLetter(letter);
    });
    button.addEventListener('pointerenter', () => {
      if (pointerDown && !button.disabled) jumpToLetter(letter);
    });
    indexEl.append(button);
  }

  window.addEventListener('pointerup', () => {
    pointerDown = false;
  }, { once: true });
}

function jumpToLetter(letter) {
  const target = [...listEl.querySelectorAll('.vocab-entry')]
    .find((entry) => entry.dataset.letter === letter);
  target?.scrollIntoView({ block: 'start' });
}

function renderInlineEdit() {
  const input = document.createElement('input');
  input.className = 'vocab-inline-edit';
  input.type = 'text';
  input.value = editing?.draftValue ?? editing?.originalValue ?? '';
  let closed = false;
  let saving = false;

  const commit = async () => {
    if (closed || saving) return;
    saving = true;
    input.readOnly = true;
    if (editing) editing.draftValue = input.value;
    const saved = await commitRename();
    if (saved === false) {
      saving = false;
      input.readOnly = false;
      requestAnimationFrame(() => {
        if (input.isConnected) input.focus();
      });
      return;
    }
    closed = true;
  };

  const cancel = () => {
    if (closed) return;
    closed = true;
    input.removeEventListener('blur', handleBlur);
    cancelRename();
  };

  const handleBlur = () => {
    commit();
  };

  input.addEventListener('input', () => {
    if (editing) editing.draftValue = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter'
      && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(event, input)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  });
  input.addEventListener('blur', handleBlur);
  setTimeout(() => {
    input.focus();
    input.select();
  });
  return input;
}

function addHereButton(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vocab-add-here ui-outline-action';
  button.textContent = 'Add here';
  button.addEventListener('click', () => {
    clearFloatingHint();
    addAliasToEntry(entry.id);
  });
  return button;
}

function showAddToExistingHint(row, entry, event = null) {
  const word = normalizeWord(newWordInput.value);
  if (!addToExistingMode || !word) return;
  const rect = row.getBoundingClientRect();
  setFloatingHint(
    `Add "${word}" to "${entry.display}"`,
    event?.clientX ?? rect.right,
    event?.clientY ?? rect.top,
    row
  );
}

function bindWordAreaInteractions(row, source, entry) {
  row.draggable = true;
  row.addEventListener('dragstart', (event) => startDragMove(event, source));
  row.addEventListener('dragend', endDragMove);

  if (source.kind === 'display') {
    row.addEventListener('dragover', handleDisplayDragOver);
    row.addEventListener('dragleave', clearDropTarget);
    row.addEventListener('drop', (event) => dropOnDisplayWord(event, entry.id));
  }

  row.addEventListener('click', (event) => selectMoveTarget(entry.id, event));
  row.addEventListener('pointerenter', (event) => showAddToExistingHint(row, entry, event));
  row.addEventListener('pointermove', (event) => {
    if (addToExistingMode && normalizeWord(newWordInput.value)) {
      showAddToExistingHint(row, entry, event);
    }
  });
  row.addEventListener('pointerleave', () => {
    if (addToExistingMode) clearFloatingHint(row);
  });
  row.addEventListener('focusin', () => showAddToExistingHint(row, entry));
  row.addEventListener('focusout', (event) => {
    if (!row.contains(event.relatedTarget)) clearFloatingHint(row);
  });

  row.addEventListener('contextmenu', (event) => openVocabContextMenu(event, source));

  if (addToExistingMode && normalizeWord(newWordInput.value)) {
    row.append(addHereButton(entry));
  }
}

function renderEntry(entry) {
  const section = document.createElement('section');
  section.className = 'vocab-entry';
  section.classList.toggle('has-aliases', Boolean(entry.aliases?.length));
  section.dataset.entryId = entry.id;
  section.dataset.letter = entry.display.trim()[0]?.toUpperCase() || '';
  section.classList.toggle('is-highlighted', entry.id === highlightedEntryId);
  section.addEventListener('pointermove', (event) => {
    if (!moveSource || moveSource.entryId === entry.id) return;
    section.classList.add('is-move-hover');
    setFloatingHint(
      `Move "${sourceWord(moveSource)}" to "${entry.display}"`,
      event.clientX,
      event.clientY,
      section,
      'move'
    );
  });
  section.addEventListener('pointerleave', () => {
    if (!moveSource) return;
    section.classList.remove('is-move-hover');
    clearFloatingHint(section);
  });

  const displayRow = document.createElement('div');
  displayRow.className = 'vocab-display-row';
  const display = document.createElement('span');
  display.className = 'vocab-word vocab-display';
  const displaySource = {
    kind: 'display',
    entryId: entry.id
  };
  const editingDisplay = sameVocabularySource(editing, displaySource);
  displayRow.classList.toggle('is-move-source', sameVocabularySource(moveSource, displaySource));

  if (editingDisplay) {
    displayRow.append(renderInlineEdit());
  } else {
    display.textContent = entry.display;
    display.addEventListener('dblclick', async () => {
      await beginRenameAfterCurrentCommit(displaySource);
    });
    displayRow.append(display);
  }
  if (!editingDisplay) bindWordAreaInteractions(displayRow, displaySource, entry);
  displayRow.classList.toggle('is-move-target', currentDropTargetEntryId === entry.id);
  section.append(displayRow);

  for (const alias of sortedAliases(entry)) {
    const originalIndex = aliasOriginalIndex(entry, alias);
    const aliasRow = document.createElement('div');
    aliasRow.className = 'vocab-alias-row';
    const aliasSource = {
      kind: 'alias',
      entryId: entry.id,
      aliasIndex: originalIndex
    };
    const editingAlias = sameVocabularySource(editing, aliasSource);
    aliasRow.classList.toggle('is-move-source', sameVocabularySource(moveSource, aliasSource));

    if (editingAlias) {
      aliasRow.append(renderInlineEdit());
    } else {
      const aliasText = document.createElement('span');
      aliasText.className = 'vocab-alias';
      aliasText.textContent = alias;
      aliasText.addEventListener('dblclick', async () => {
        await beginRenameAfterCurrentCommit(aliasSource);
      });
      aliasRow.append(aliasText);
    }
    if (!editingAlias) bindWordAreaInteractions(aliasRow, aliasSource, entry);
    section.append(aliasRow);
  }

  return section;
}

function render() {
  clearFloatingHint();
  document.body.classList.toggle('add-to-existing-mode', addToExistingMode);
  const entries = sortedEntries();
  listEl.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'vocab-empty';
    empty.textContent = 'No vocabulary entries yet.';
    listEl.append(empty);
  } else {
    for (const entry of entries) listEl.append(renderEntry(entry));
  }
  renderIndex(entries);
  createWordButton.disabled = addToExistingMode || !normalizeWord(newWordInput.value);
  addExistingButton.disabled = !normalizeWord(newWordInput.value);
}

function clientVocabularyPayload(sourceLibrary = library) {
  return {
    version: sourceLibrary.version || 1,
    entries: (sourceLibrary.entries || []).map((entry) => ({
      id: entry.id,
      display: entry.display,
      aliases: sortedAliases(entry)
    }))
  };
}

function cloneVocabularyLibrary(sourceLibrary = library) {
  return {
    version: sourceLibrary.version || 1,
    entries: (sourceLibrary.entries || []).map((entry) => ({
      id: entry.id,
      display: entry.display,
      aliases: [...(entry.aliases || [])]
    }))
  };
}

async function saveLibrary(message = 'Saved', nextLibrary = library, change = {}) {
  const payload = clientVocabularyPayload(nextLibrary);
  const result = await request('/api/vocabulary', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  showStatus(message, false, 1600);
  notifyDictionaryChanged({ ...change, metadataChangeSet: result.metadataChangeSet });
  return library;
}

async function moveWordToEntry(source, targetEntryId, event = null) {
  if (!validMoveSource(source) || !targetEntryId) return;
  const sourceEntry = entryById(source.entryId);
  const targetEntry = entryById(targetEntryId);
  if (!sourceEntry || !targetEntry || sourceEntry.id === targetEntry.id) return;

  const blocked = moveBlockedMessage(source);
  if (blocked) {
    showFloatingHint(blocked, event?.clientX, event?.clientY);
    return;
  }

  const word = sourceWord(source);
  if (!word) return;

  if (source.kind === 'display') {
    const moved = await request('/api/vocabulary/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceEntryId: sourceEntry.id,
        targetEntryId: targetEntry.id
      })
    });
    notifyDictionaryChanged({
      operation: 'move-display',
      vocabularyEntryIds: [sourceEntry.id, targetEntry.id],
      descriptorEntryIds: moved.descriptorEntryIds || [],
      affectedPageIds: moved.affectedPageIds || [],
      descriptorIdRemap: moved.descriptorIdRemap || {},
      vocabularyEntryIdRemap: moved.vocabularyEntryIdRemap || {},
      metadataChangeSet: moved.metadataChangeSet
    });
    showStatus('Moved', false, 1600);
  } else {
    const targetHasWord = targetEntry.display === word || (targetEntry.aliases || []).includes(word);
    if (!targetHasWord) targetEntry.aliases = [...(targetEntry.aliases || []), word];
    sourceEntry.aliases = (sourceEntry.aliases || []).filter((_, index) => index !== source.aliasIndex);
    await saveLibrary('Moved', library, {
      operation: 'move-alias',
      vocabularyEntryIds: [sourceEntry.id, targetEntry.id]
    });
  }
  clearMoveMode();
  beginTemporaryHighlight(targetEntry.id);
}

function scrollToEntry(entryId) {
  requestAnimationFrame(() => {
    listEl.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`)?.scrollIntoView({ block: 'center' });
  });
}

async function createWord() {
  const display = normalizeWord(newWordInput.value);
  if (!display) return;
  const conflict = textConflict(display);
  if (conflict) {
    showStatus(`"${display}" already exists.`, true);
    return;
  }

  const entry = {
    id: uniqueEntryId(display),
    display,
    aliases: []
  };
  library.entries.push(entry);
  await saveLibrary('Word created', library, {
    operation: 'create-display',
    vocabularyEntryIds: [entry.id]
  });
  newWordInput.value = '';
  beginTemporaryHighlight(entry.id);
}

function enterAddToExistingMode() {
  const word = normalizeWord(newWordInput.value);
  if (!word) return;
  const conflict = textConflict(word);
  if (conflict) {
    showStatus(`"${word}" already exists.`, true);
    return;
  }
  addToExistingMode = true;
  showStatus('');
  render();
}

function exitAddToExistingMode() {
  addToExistingMode = false;
  showStatus('');
  clearFloatingHint();
  render();
}

async function addAliasToEntry(entryId) {
  const alias = normalizeWord(newWordInput.value);
  if (!alias) return;
  const conflict = textConflict(alias);
  if (conflict) {
    showStatus(`"${alias}" already exists.`, true);
    return;
  }
  const entry = entryById(entryId);
  if (!entry) return;
  entry.aliases = [...(entry.aliases || []), alias];
  await saveLibrary('Alias added', library, {
    operation: 'add-alias',
    vocabularyEntryIds: [entry.id]
  });
  newWordInput.value = '';
  addToExistingMode = false;
  beginTemporaryHighlight(entry.id);
}

function cancelRename() {
  editing = null;
  showStatus('');
  render();
  return true;
}

async function commitRename() {
  if (renameCommitPromise) return renameCommitPromise;
  renameCommitPromise = commitRenameNow()
    .finally(() => {
      renameCommitPromise = null;
    });
  return renameCommitPromise;
}

async function commitRenameNow() {
  if (!editing) return true;
  const state = { ...editing };
  const entry = entryById(state.entryId);
  if (!entry) return cancelRename();

  const rawDraftValue = state.draftValue ?? '';
  const nextText = normalizeWord(rawDraftValue);
  editing.draftValue = rawDraftValue;
  if (!nextText) {
    showStatus('Name cannot be empty.', true);
    return false;
  }
  if (nextText === state.originalValue) return cancelRename();

  const skip = {
    entryId: state.entryId,
    kind: state.kind,
    aliasIndex: state.kind === 'alias' ? state.aliasIndex : undefined
  };
  const conflict = textConflict(nextText, skip);
  if (conflict) {
    showStatus(`"${nextText}" already exists.`, true);
    return false;
  }

  const nextLibrary = cloneVocabularyLibrary();
  const nextEntry = (nextLibrary.entries || []).find((item) => item.id === state.entryId);
  if (!nextEntry) return cancelRename();

  if (state.kind === 'display') {
    nextEntry.display = nextText;
  } else {
    let aliasIndex = state.aliasIndex;
    if (nextEntry.aliases?.[aliasIndex] !== state.originalValue) {
      aliasIndex = (nextEntry.aliases || []).findIndex((alias) => alias === state.originalValue);
    }
    if (aliasIndex < 0) return cancelRename();
    nextEntry.aliases[aliasIndex] = nextText;
  }

  try {
    await saveLibrary('Renamed', nextLibrary, {
      operation: state.kind === 'display' ? 'rename-display' : 'rename-alias',
      vocabularyEntryIds: [state.entryId]
    });
    editing = null;
    render();
    scrollToEntry(state.entryId);
    return true;
  } catch (error) {
    showStatus(error.message, true);
    editing = state;
    editing.draftValue = rawDraftValue || state.draftValue || state.originalValue;
    return false;
  }
}

function closeAliasContextMenu() {
  aliasContextTarget = null;
}

function moveLabelFor(source) {
  return `Move "${sourceWord(source)}"`;
}

function startDragMove(event, source) {
  if (!validMoveSource(source)) return;
  const blocked = moveBlockedMessage(source);
  if (blocked) {
    event.preventDefault();
    showFloatingHint(blocked, event.clientX, event.clientY);
    return;
  }
  dragMoveSource = source;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', sourceWord(source));
  dragLabel = document.createElement('div');
  dragLabel.className = 'vocab-floating-hint';
  dragLabel.textContent = moveLabelFor(source);
  document.body.append(dragLabel);
  moveDragLabel(event);
}

function moveDragLabel(event) {
  if (!dragLabel) return;
  dragLabel.style.left = `${event.clientX + 12}px`;
  dragLabel.style.top = `${event.clientY + 12}px`;
}

function endDragMove() {
  dragMoveSource = null;
  dragLabel?.remove();
  dragLabel = null;
  clearDropTarget();
}

function clearDropTarget() {
  if (!currentDropTargetEntryId) return;
  currentDropTargetEntryId = null;
  for (const element of document.querySelectorAll('.vocab-display-row.is-move-target')) {
    element.classList.remove('is-move-target');
  }
  if (dragMoveSource && dragLabel) dragLabel.textContent = moveLabelFor(dragMoveSource);
}

function handleDisplayDragOver(event) {
  if (!dragMoveSource) return;
  const targetEntryId = event.currentTarget.closest('.vocab-entry')?.dataset.entryId;
  if (!targetEntryId || targetEntryId === dragMoveSource.entryId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  moveDragLabel(event);
  if (currentDropTargetEntryId !== targetEntryId) {
    clearDropTarget();
    currentDropTargetEntryId = targetEntryId;
    event.currentTarget.classList.add('is-move-target');
  }
  const targetEntry = entryById(targetEntryId);
  if (dragLabel && targetEntry) {
    dragLabel.textContent = `Move "${sourceWord(dragMoveSource)}" to "${targetEntry.display}"`;
  }
}

async function dropOnDisplayWord(event, targetEntryId) {
  if (!dragMoveSource) return;
  event.preventDefault();
  const source = dragMoveSource;
  endDragMove();
  await moveWordToEntry(source, targetEntryId, event);
}

function clearMoveMode() {
  moveSource = null;
  document.body.classList.remove('move-target-pick-mode');
  showStatus('');
  clearFloatingHint();
  render();
}

function beginMoveMode(source, event) {
  const blocked = moveBlockedMessage(source);
  if (blocked) {
    showFloatingHint(blocked, event?.clientX, event?.clientY);
    return;
  }
  moveSource = source;
  document.body.classList.add('move-target-pick-mode');
  showStatus('');
  render();
}

async function selectMoveTarget(targetEntryId, event) {
  if (!moveSource) return;
  await moveWordToEntry(moveSource, targetEntryId, event);
}

async function openVocabContextMenu(event, target) {
  if (!window.nativeContextMenu?.available()) return;
  event.preventDefault();
  event.stopPropagation();
  clearFloatingHint();
  if (editing && !sameVocabularySource(editing, target)) {
    const committed = await commitRename();
    if (!committed) return;
  }
  aliasContextTarget = target;
  const isAlias = target.kind === 'alias';
  const canMove = isAlias || !sourceHasAliases(target);
  const originalWord = sourceWord(target);
  const command = await window.nativeContextMenu.open(event, {
    type: 'dictionary-entry',
    targetId: target.entryId,
    isAlias,
    canMove
  });
  const entry = entryById(target.entryId);
  const targetStillExists = Boolean(entry) && (target.kind === 'display'
    ? entry.display === originalWord
    : entry.aliases?.[target.aliasIndex] === originalWord);
  if (!command || !targetStillExists) return closeAliasContextMenu();
  aliasContextTarget = target;
  if (command === 'rename-dictionary-entry') renameContextVocabularyItem();
  else if (command === 'set-display-word') setAliasAsDisplayWord();
  else if (command === 'set-another-word') setAliasAsAnotherWord();
  else if (command === 'move-dictionary-entry') moveContextVocabularyItem();
  else if (command === 'delete-dictionary-entry') deleteContextVocabularyItem();
}

function renameContextVocabularyItem() {
  if (!aliasContextTarget) return;
  const target = aliasContextTarget;
  closeAliasContextMenu();
  beginRename(target);
}

async function setAliasAsDisplayWord() {
  if (!aliasContextTarget || aliasContextTarget.kind !== 'alias') return;
  const entry = entryById(aliasContextTarget.entryId);
  const alias = entry?.aliases?.[aliasContextTarget.aliasIndex];
  if (!entry || !alias) return closeAliasContextMenu();
  const oldDisplay = entry.display;
  entry.display = alias;
  entry.aliases[aliasContextTarget.aliasIndex] = oldDisplay;
  closeAliasContextMenu();
  await saveLibrary('Display word updated', library, {
    operation: 'set-display',
    vocabularyEntryIds: [entry.id]
  });
  beginTemporaryHighlight(entry.id);
}

async function setAliasAsAnotherWord() {
  if (!aliasContextTarget || aliasContextTarget.kind !== 'alias') return;
  const entry = entryById(aliasContextTarget.entryId);
  const alias = entry?.aliases?.[aliasContextTarget.aliasIndex];
  if (!entry || !alias) return closeAliasContextMenu();

  const conflict = textConflict(alias, {
    entryId: entry.id,
    kind: 'alias',
    aliasIndex: aliasContextTarget.aliasIndex
  });
  if (conflict) {
    closeAliasContextMenu();
    showFloatingHint('Cannot create word: already exists');
    return;
  }

  const newEntry = {
    id: uniqueEntryId(alias),
    display: alias,
    aliases: []
  };
  entry.aliases.splice(aliasContextTarget.aliasIndex, 1);
  library.entries.push(newEntry);
  closeAliasContextMenu();
  await saveLibrary('Word created', library, {
    operation: 'set-another-word',
    vocabularyEntryIds: [entry.id, newEntry.id]
  });
  beginTemporaryHighlight(newEntry.id);
}

async function deleteAlias() {
  const entry = entryById(aliasContextTarget?.entryId);
  const alias = entry?.aliases?.[aliasContextTarget?.aliasIndex];
  if (!entry || !alias) return closeAliasContextMenu();

  entry.aliases.splice(aliasContextTarget.aliasIndex, 1);
  closeAliasContextMenu();
  await saveLibrary('Alias deleted', library, {
    operation: 'delete-alias',
    vocabularyEntryIds: [entry.id]
  });
  render();
  scrollToEntry(entry.id);
}

async function deleteDisplayWord() {
  const entry = entryById(aliasContextTarget?.entryId);
  if (!entry) return closeAliasContextMenu();

  const referencedDescriptors = (descriptorRegistry.entries || [])
    .filter((descriptor) => (
      descriptor.vocabularyEntryId === entry.id
      || (!descriptor.vocabularyEntryId && descriptor.display === entry.display)
    ));
  const hasAliases = (entry.aliases || []).length > 0;
  const message = referencedDescriptors.length
    ? `This word is used by descriptors. Delete this word and remove its descriptors from all pages?\n\nThis will remove ${referencedDescriptors.length} descriptor(s).`
    : hasAliases
      ? 'Delete this word and its aliases?'
      : 'Delete this word?';
  if (!window.confirm(message)) {
    closeAliasContextMenu();
    return;
  }

  closeAliasContextMenu();
  const deleted = await request(`/api/vocabulary/${encodeURIComponent(entry.id)}`, {
    method: 'DELETE'
  });
  if (highlightedEntryId === entry.id) highlightedEntryId = null;
  showStatus(deleted.descriptorsDeleted
    ? `Word deleted; ${deleted.descriptorsDeleted} descriptor(s) removed from ${deleted.pagesAffected} page(s).`
    : 'Word deleted', false, 2200);
  notifyDictionaryChanged({
    operation: 'delete-display',
    vocabularyEntryIds: [entry.id],
    descriptorEntryIds: deleted.descriptorEntryIds || [],
    affectedPageIds: deleted.affectedPageIds || [],
    metadataChangeSet: deleted.metadataChangeSet
  });
  render();
}

async function deleteContextVocabularyItem() {
  try {
    if (!aliasContextTarget) return;
    if (aliasContextTarget.kind === 'alias') await deleteAlias();
    else await deleteDisplayWord();
  } catch (error) {
    showStatus(error.message, true);
  }
}

function moveContextVocabularyItem(event) {
  if (!aliasContextTarget) return;
  const source = aliasContextTarget;
  closeAliasContextMenu();
  beginMoveMode(source, event);
}

function dictionaryEntryForCommand(command) {
  if (command?.vocabularyEntryId) {
    const byId = entryById(command.vocabularyEntryId);
    if (byId) return byId;
  }
  const display = normalizeWord(command?.display);
  return display
    ? (library.entries || []).find((entry) => entry.display === display)
    : null;
}

async function runDictionaryCommand(command) {
  const entry = dictionaryEntryForCommand(command);
  if (!entry) {
    showStatus('Vocabulary entry is unavailable.', true, 2200);
    return;
  }

  if (editing) {
    const committed = await commitRename();
    if (!committed) return;
  }
  clearMoveMode();
  exitAddToExistingMode();
  highlightedEntryId = entry.id;
  render();
  scrollToEntry(entry.id);

  const source = { kind: 'display', entryId: entry.id };
  if (command.action === 'rename') {
    beginRename(source);
  } else if (command.action === 'delete') {
    aliasContextTarget = source;
    await deleteDisplayWord();
  } else if (command.action === 'move') {
    beginMoveMode(source);
  }

  dictionaryChannel?.postMessage({
    type: 'dictionary-command-accepted',
    commandId: command.commandId || null
  });
}

function receiveDictionaryCommand(command) {
  if (!command || command.type !== 'dictionary-command') return;
  if (!libraryReady) {
    pendingDictionaryCommands.push(command);
    dictionaryChannel?.postMessage({
      type: 'dictionary-command-accepted',
      commandId: command.commandId || null
    });
    return;
  }
  runDictionaryCommand(command).catch((error) => showStatus(error.message, true));
}

function receiveDictionaryDataChanged(event) {
  if (event?.type !== 'dictionary-data-changed' || !event.metadataChangeSet) return;
  descriptorMetadataInstaller.install(event.metadataChangeSet, {
      source: 'dictionary-event',
      event
    }).then((result) => {
      if (result.applied && libraryReady) render();
    }).catch((error) => showStatus(error.message, true));
}

dictionaryChannel?.addEventListener('message', (event) => {
  receiveDictionaryCommand(event.data);
  receiveDictionaryDataChanged(event.data);
});
window.addEventListener('message', (event) => {
  if (event.origin === window.location.origin) receiveDictionaryDataChanged(event.data);
});

const initialDictionaryCommandText = new URLSearchParams(window.location.search).get('command');
if (initialDictionaryCommandText) {
  try {
    receiveDictionaryCommand(JSON.parse(initialDictionaryCommandText));
    window.history.replaceState(null, '', window.location.pathname);
  } catch {
    showStatus('Dictionary command could not be read.', true, 2200);
  }
}

searchInput.addEventListener('input', () => {
  searchText = searchInput.value;
  locateSearchMatch();
});

newWordInput.addEventListener('input', render);
clearNewWordButton.addEventListener('click', () => {
  newWordInput.value = '';
  render();
  newWordInput.focus();
});
createWordButton.addEventListener('click', createWord);
addExistingButton.addEventListener('click', enterAddToExistingMode);
document.addEventListener('pointerdown', (event) => {
  if (hintEl && (!hintTrigger || !hintTrigger.contains(event.target))) clearFloatingHint();
});

listEl.addEventListener('scroll', clearFloatingHint, { passive: true });
window.addEventListener('pagehide', clearFloatingHint);
window.addEventListener('pagehide', () => appearanceInvalidationClient.close());
window.addEventListener('blur', clearFloatingHint);

document.addEventListener('dragover', (event) => {
  if (dragMoveSource) moveDragLabel(event);
});

document.addEventListener('keydown', (event) => {
  if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)) return;
  if (event.key !== 'Escape') return;
  if (hintEl) clearFloatingHint();
  if (editing) {
    event.preventDefault();
    cancelRename();
    return;
  }
  if (moveSource) {
    event.preventDefault();
    clearMoveMode();
    return;
  }
  if (addToExistingMode) {
    event.preventDefault();
    exitAddToExistingMode();
  }
});

async function start() {
  try {
    const [descriptorMetadataSnapshot] = await Promise.all([
      request('/api/descriptor-metadata/snapshot'),
      appearanceInvalidationClient.refresh({ reason: 'startup' })
    ]);
    await descriptorMetadataInstaller.install(descriptorMetadataSnapshot, {
      source: 'startup'
    });
    libraryReady = true;
    render();
    dictionaryChannel?.postMessage({ type: 'dictionary-ready' });
    while (pendingDictionaryCommands.length) {
      await runDictionaryCommand(pendingDictionaryCommands.shift());
    }
  } catch (error) {
    showStatus(error.message, true);
  }
}

start();
