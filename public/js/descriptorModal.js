/* Descriptor modal, global descriptor groups, and Dictionary live-refresh domain.
 * Loaded after app.js so it reuses the existing shared runtime state without changing behavior.
 */
let descriptorEditorMode = 'active';

function descriptorClasses() {
  return Array.isArray(descriptorLibrary?.classes) && descriptorLibrary.classes.length
    ? descriptorLibrary.classes
    : [
      { id: 'class_1', label: 'Class 1' },
      { id: 'class_2', label: 'Class 2' },
      { id: 'class_3', label: 'Class 3' }
    ];
}

function normalizeDescriptorText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function descriptorCompareKey(text) {
  return normalizeDescriptorText(text).toLocaleLowerCase();
}

function descriptorEntryMap() {
  return new Map((descriptorLibrary?.entries || []).map((entry) => [entry.id, entry]));
}

function descriptorEntryByText() {
  return new Map((descriptorLibrary?.entries || []).map((entry) => [descriptorCompareKey(entry.display), entry]));
}

function descriptorEntryByVocabularyId() {
  return new Map((descriptorLibrary?.entries || [])
    .filter((entry) => entry.vocabularyEntryId)
    .map((entry) => [entry.vocabularyEntryId, entry]));
}

function descriptorVocabularyMatch(text, { allowPartial = false } = {}) {
  const query = descriptorCompareKey(text);
  if (!query) return null;
  const entries = vocabularyLibrary?.entries || [];

  for (const entry of entries) {
    if (descriptorCompareKey(entry.display) === query) {
      return { entry, matchedAlias: false, text: entry.display, matchType: 'display-exact' };
    }
  }
  for (const entry of entries) {
    for (const alias of entry.aliases || []) {
      if (descriptorCompareKey(alias) === query) {
        return { entry, matchedAlias: true, text: alias, matchType: 'alias-exact' };
      }
    }
  }
  if (!allowPartial) return null;

  for (const entry of entries) {
    if (descriptorCompareKey(entry.display).startsWith(query)) {
      return { entry, matchedAlias: false, text: entry.display, matchType: 'display-prefix' };
    }
  }
  for (const entry of entries) {
    for (const alias of entry.aliases || []) {
      if (descriptorCompareKey(alias).startsWith(query)) {
        return { entry, matchedAlias: true, text: alias, matchType: 'alias-prefix' };
      }
    }
  }
  for (const entry of entries) {
    if (descriptorCompareKey(entry.display).includes(query)) {
      return { entry, matchedAlias: false, text: entry.display, matchType: 'display-contains' };
    }
  }
  for (const entry of entries) {
    for (const alias of entry.aliases || []) {
      if (descriptorCompareKey(alias).includes(query)) {
        return { entry, matchedAlias: true, text: alias, matchType: 'alias-contains' };
      }
    }
  }
  return null;
}

function emptyDescriptorDraft() {
  return Object.fromEntries(descriptorClasses().map((descriptorClass) => [descriptorClass.id, []]));
}

function emptyDescriptorIdDraft() {
  return Object.fromEntries(descriptorClasses().map((descriptorClass) => [descriptorClass.id, []]));
}

function pageDescriptorDraftForRuntime(runtime) {
  const draft = emptyDescriptorDraft();
  const descriptors = runtime?.currentPage?.descriptors;
  if (!descriptors || typeof descriptors !== 'object' || Array.isArray(descriptors)) return draft;

  for (const descriptorClass of descriptorClasses()) {
    const items = Array.isArray(descriptors[descriptorClass.id]) ? descriptors[descriptorClass.id] : [];
    draft[descriptorClass.id] = items
      .filter((item) => item && typeof item.entryId === 'string')
      .map((item) => ({
        entryId: item.entryId,
        source: item.source || 'manual',
        status: item.status || 'active',
        origins: Array.isArray(item.origins) ? item.origins.map((origin) => ({ ...origin })) : undefined,
        createdAt: item.createdAt
      }));
  }
  return draft;
}

function pageIgnoredDescriptorDraftForRuntime(runtime) {
  const draft = emptyDescriptorDraft();
  const ignored = runtime?.currentPage?.ignoredDescriptors;
  if (!ignored || typeof ignored !== 'object' || Array.isArray(ignored)) return draft;
  for (const descriptorClass of descriptorClasses()) {
    const seen = new Set();
    draft[descriptorClass.id] = (Array.isArray(ignored[descriptorClass.id])
      ? ignored[descriptorClass.id] : [])
      .filter((item) => item && typeof item.entryId === 'string' && !seen.has(item.entryId) && seen.add(item.entryId))
      .map((item) => ({
        entryId: item.entryId,
        createdAt: item.createdAt
      }));
  }
  return draft;
}

function pageIgnoredManualEntryIdsDraftForRuntime(runtime) {
  const draft = emptyDescriptorIdDraft();
  const saved = runtime?.currentPage?.ignoredManualEntryIds
    || runtime?.currentPage?.ignoredManualDescriptorIds;
  const legacyIgnored = runtime?.currentPage?.ignoredDescriptors;
  for (const descriptorClass of descriptorClasses()) {
    const classId = descriptorClass.id;
    const ignoredIds = new Set((ignoredDescriptorDraft?.[classId] || []).map((item) => item.entryId));
    const candidates = [
      ...(Array.isArray(saved?.[classId]) ? saved[classId] : []),
      ...(Array.isArray(legacyIgnored?.[classId]) ? legacyIgnored[classId] : [])
        .filter((item) => item?.restoreManual === true)
        .map((item) => item.entryId)
    ];
    draft[classId] = [...new Set(candidates
      .filter((entryId) => typeof entryId === 'string' && ignoredIds.has(entryId)))];
  }
  return draft;
}

function ignoredDescriptorHadManualState(classId, entryId) {
  return (ignoredManualEntryIdsDraft?.[classId] || []).includes(entryId);
}

function removeIgnoredDescriptor(classId, entryId) {
  ignoredDescriptorDraft[classId] = (ignoredDescriptorDraft[classId] || [])
    .filter((item) => item.entryId !== entryId);
  ignoredManualEntryIdsDraft[classId] = (ignoredManualEntryIdsDraft[classId] || [])
    .filter((candidateId) => candidateId !== entryId);
}

function addIgnoredDescriptor(classId, entryId, rememberManual = false, definition = null) {
  const refs = ignoredDescriptorDraft[classId] || [];
  const existing = refs.find((item) => item.entryId === entryId);
  if (!existing) {
    refs.push({
      entryId,
      display: definition?.display,
      vocabularyEntryId: definition?.vocabularyEntryId,
      createdAt: new Date().toISOString()
    });
  } else if (definition?.display) {
    existing.display ||= definition.display;
    existing.vocabularyEntryId ||= definition.vocabularyEntryId;
  }
  ignoredDescriptorDraft[classId] = refs;
  const provenanceIds = ignoredManualEntryIdsDraft[classId] || [];
  if (rememberManual && !provenanceIds.includes(entryId)) provenanceIds.push(entryId);
  ignoredManualEntryIdsDraft[classId] = provenanceIds;
}

function descriptorChipDisplay(chip) {
  if (chip.display) return chip.display;
  return descriptorEntryMap().get(chip.entryId)?.display || chip.entryId || '';
}

function descriptorChipKey(chip) {
  if (chip.vocabularyEntryId) return `vocab:${chip.vocabularyEntryId}`;
  return chip.entryId || `draft:${descriptorCompareKey(chip.display)}`;
}

function newDescriptorDraftId(prefix) {
  const token = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_draft_${token}`;
}

function descriptorDraftDefinitionByDisplay(display) {
  const key = descriptorCompareKey(display);
  for (const groups of [descriptorDraft, ignoredDescriptorDraft]) {
    for (const refs of Object.values(groups || {})) {
      const match = (refs || []).find((ref) => (
        ref?.entryId && descriptorCompareKey(descriptorChipDisplay(ref)) === key
      ));
      if (match) return match;
    }
  }
  return null;
}

function captureDescriptorInputState() {
  const state = new Map();
  const modal = pageMetaModal?.type === 'descriptor' ? pageMetaModal.modal : null;
  if (!modal) return state;
  for (const input of modal.querySelectorAll('[data-descriptor-input]')) {
    state.set(input.dataset.descriptorInput, {
      value: input.value,
      active: document.activeElement === input,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd
    });
  }
  return state;
}

function restoreDescriptorInputState(state, fallbackFocusClassId = null) {
  const modal = pageMetaModal?.type === 'descriptor' ? pageMetaModal.modal : null;
  if (!modal) return;
  let focusInput = null;
  for (const [classId, inputState] of state || []) {
    const input = modal.querySelector(`[data-descriptor-input="${CSS.escape(classId)}"]`);
    if (!input) continue;
    input.value = inputState.value || '';
    input.dispatchEvent(new Event('input'));
    if (inputState.active) {
      focusInput = input;
      const end = input.value.length;
      input.setSelectionRange(
        Math.min(inputState.selectionStart ?? end, end),
        Math.min(inputState.selectionEnd ?? end, end)
      );
    }
  }
  if (!focusInput && fallbackFocusClassId) {
    focusInput = modal.querySelector(
      `[data-descriptor-input="${CSS.escape(fallbackFocusClassId)}"]`
    );
  }
  focusInput?.focus();
}

function rerenderDescriptorEditor(focusClassId = null, { preserveInputs = false } = {}) {
  const body = pageMetaModal?.modal.querySelector('.forced-modal-body');
  if (!body) return;
  const inputState = preserveInputs ? captureDescriptorInputState() : new Map();
  body.replaceChildren(renderDescriptorEditor({
    runtime: pageMetaModal.runtime,
    preserveDraft: true
  }));
  updateDescriptorIgnoredFooter();
  if (preserveInputs) {
    restoreDescriptorInputState(inputState, focusClassId);
  } else if (focusClassId) {
    const input = body.querySelector(`[data-descriptor-input="${CSS.escape(focusClassId)}"]`);
    input?.focus();
  }
}

function vocabularyEntryForDescriptor(entry) {
  if (entry?.vocabularyEntryId) {
    const linked = (vocabularyLibrary?.entries || [])
      .find((candidate) => candidate.id === entry.vocabularyEntryId);
    if (linked) return linked;
  }
  return (vocabularyLibrary?.entries || [])
    .find((candidate) => candidate.display === entry?.display) || null;
}

function closeDescriptorContextMenu() {
  descriptorContextTarget = null;
}

function closeDescriptorGroupContextMenu() {
  descriptorGroupContextTarget = null;
}

function showPageMetaModalStatus(modalOwner, message, isError = false, clearAfter = 0) {
  if (!modalOwner || pageMetaModal !== modalOwner) return false;
  return showRuntimeStatus(modalOwner.runtime, message, isError, clearAfter);
}

async function openDescriptorContextMenu(event, descriptorEntry) {
  if (!window.nativeContextMenu?.available()) return;
  const modalOwner = pageMetaModal;
  const runtime = modalOwner?.runtime;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'descriptor-entry-menu',
    requireMount: false
  });
  if (!operation) return;
  const vocabularyEntry = vocabularyEntryForDescriptor(descriptorEntry);
  const target = {
    kind: 'dictionary',
    descriptorEntryId: descriptorEntry.id,
    vocabularyEntryId: vocabularyEntry?.id || null,
    display: vocabularyEntry?.display || descriptorEntry.display,
    membershipKey: descriptorGroupsModel.membershipKey(descriptorEntry)
  };
  descriptorContextTarget = target;
  const command = await window.nativeContextMenu.open(event, {
    type: 'descriptor-entry',
    targetId: descriptorEntry.id,
    dictionaryAvailable: Boolean(vocabularyEntry)
  });
  if (!command || pageMetaModal !== modalOwner || descriptorContextTarget !== target
    || !runtimeOperationIsCurrent(operation)
    || !(descriptorLibrary?.entries || []).some((entry) => entry.id === descriptorEntry.id)) {
    return closeDescriptorContextMenu();
  }
  if (command === 'rename-descriptor') launchDescriptorDictionaryAction('rename');
  else if (command === 'delete-descriptor') launchDescriptorDictionaryAction('delete');
  else if (command === 'link-descriptor') launchDescriptorDictionaryAction('move');
  else if (command === 'move-descriptor-entry') enterDescriptorGroupMoveMode();
}

async function openActiveDescriptorContextMenu(event, classId, logicalChip) {
  const entryId = logicalChip.refs.find((ref) => ref.entryId)?.entryId;
  if (!descriptorMutation.canExplicitlyExclude(logicalChip.refs) || !entryId) {
    closeDescriptorContextMenu();
    return;
  }
  if (!window.nativeContextMenu?.available()) return;
  const modalOwner = pageMetaModal;
  const runtime = modalOwner?.runtime;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'descriptor-exclude-menu',
    requireMount: false
  });
  if (!operation) return;
  const target = { kind: 'exclude', classId, entryId, chipKey: logicalChip.key };
  descriptorContextTarget = target;
  const command = await window.nativeContextMenu.open(event, {
    type: 'descriptor-exclude', targetId: entryId
  });
  if (command !== 'exclude-descriptor' || pageMetaModal !== modalOwner
    || descriptorContextTarget !== target
    || !runtimeOperationIsCurrent(operation) || target.kind !== 'exclude') {
    return closeDescriptorContextMenu();
  }
  closeDescriptorContextMenu();
  const currentChip = descriptorLogicalChips(descriptorDraft?.[target.classId] || [])
    .find((item) => item.key === target.chipKey);
  if (!currentChip) return;
  try {
    await excludeManualDescriptorFromClass(target.classId, currentChip);
  } catch (error) {
    showPageMetaModalStatus(modalOwner, error.message, true);
  }
}

function openDictionaryAction({ vocabularyEntryId, display, action = 'locate' }, runtime) {
  if (!vocabularyEntryId && !display) {
    if (dictionaryWindow && !dictionaryWindow.closed) {
      dictionaryWindow.focus();
      return;
    }
    dictionaryWindow = window.open(
      '/vocabulary.html',
      'vocabulary-library',
      DICTIONARY_WINDOW_FEATURES
    );
    if (!dictionaryWindow) {
      showRuntimeStatus(runtime, 'Dictionary window could not be opened.', true, 2200);
    }
    return;
  }

  const command = {
    type: 'dictionary-command',
    commandId: `dictionary_command_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    vocabularyEntryId,
    display,
    action
  };
  pendingDictionaryCommand = command;

  if (dictionaryWindow && !dictionaryWindow.closed) {
    dictionaryWindow.focus();
    dictionaryChannel?.postMessage(command);
    return;
  }

  const commandParam = encodeURIComponent(JSON.stringify(command));
  dictionaryWindow = window.open(
    `/vocabulary.html?command=${commandParam}`,
    'vocabulary-library',
    DICTIONARY_WINDOW_FEATURES
  );
  if (!dictionaryWindow) {
    showRuntimeStatus(runtime, 'Dictionary window could not be opened.', true, 2200);
  }
}

function launchDescriptorDictionaryAction(action) {
  if (descriptorContextTarget?.kind !== 'dictionary') return;
  const target = descriptorContextTarget;
  closeDescriptorContextMenu();
  openDictionaryAction({
    vocabularyEntryId: target.vocabularyEntryId,
    display: target.display,
    action
  }, pageMetaModal?.runtime);
}

async function refreshStaleIgnoredDescriptors() {
  const modalOwner = pageMetaModal;
  const runtime = modalOwner?.runtime;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'descriptor-stale-evaluation',
    requireMount: false
  });
  if (!operation) return false;
  try {
    const requestedRevision = currentDescriptorMetadataRevision();
    const evaluation = await request('/api/descriptor-sync-index/evaluate');
    if (pageMetaModal !== modalOwner || !runtimeOperationIsCurrent(operation)
      || requestedRevision === null
      || evaluation.metadataRevision !== requestedRevision
      || currentDescriptorMetadataRevision() !== requestedRevision) {
      return false;
    }
    staleIgnoredDescriptorKeys = new Set(evaluation.staleIgnoredCandidates || []);
    return true;
  } catch (error) {
    console.warn('Unable to classify ignored descriptors.', error);
    return false;
  }
}

const DICTIONARY_REMAP_HISTORY_LIMIT = 2048;
const descriptorDictionaryRemapHistory = new Map();
const vocabularyDictionaryRemapHistory = new Map();

function resolveDictionaryRemapTarget(history, entryId) {
  if (typeof entryId !== 'string' || !entryId) return entryId;
  const path = [];
  const seen = new Set();
  let current = entryId;
  while (history.has(current)) {
    if (seen.has(current)) return entryId;
    seen.add(current);
    path.push(current);
    const next = history.get(current);
    if (typeof next !== 'string' || !next || next === current || seen.has(next)) {
      for (const pathId of path) history.delete(pathId);
      return entryId;
    }
    current = next;
  }
  for (const pathId of path) history.set(pathId, current);
  return current;
}

function recordDictionaryRemapHistory(history, remap) {
  for (const [sourceId, targetId] of Object.entries(remap || {})) {
    if (typeof sourceId !== 'string' || !sourceId
      || typeof targetId !== 'string' || !targetId || sourceId === targetId) {
      continue;
    }
    const resolvedTargetId = resolveDictionaryRemapTarget(history, targetId);
    if (resolvedTargetId === sourceId) continue;
    history.set(sourceId, resolvedTargetId);
  }
  for (const sourceId of [...history.keys()]) resolveDictionaryRemapTarget(history, sourceId);
  while (history.size > DICTIONARY_REMAP_HISTORY_LIMIT) {
    history.delete(history.keys().next().value);
  }
}

function dictionaryRemapHistoryRecord(history) {
  const record = {};
  for (const sourceId of history.keys()) {
    const targetId = resolveDictionaryRemapTarget(history, sourceId);
    if (targetId && targetId !== sourceId) record[sourceId] = targetId;
  }
  return record;
}

function pruneLiveDictionaryRemapSources(history, liveEntryIds) {
  for (const entryId of liveEntryIds) history.delete(entryId);
}

function dictionaryEventWithRecordedRemaps(event) {
  if (event?.type !== 'dictionary-data-changed') return event || {};
  recordDictionaryRemapHistory(
    descriptorDictionaryRemapHistory,
    event.descriptorIdRemap
  );
  recordDictionaryRemapHistory(
    vocabularyDictionaryRemapHistory,
    event.vocabularyEntryIdRemap
  );
  pruneLiveDictionaryRemapSources(
    descriptorDictionaryRemapHistory,
    new Set((descriptorLibrary?.entries || []).map((entry) => entry.id))
  );
  pruneLiveDictionaryRemapSources(
    vocabularyDictionaryRemapHistory,
    new Set((vocabularyLibrary?.entries || []).map((entry) => entry.id))
  );
  return {
    ...event,
    descriptorIdRemap: dictionaryRemapHistoryRecord(descriptorDictionaryRemapHistory),
    vocabularyEntryIdRemap: dictionaryRemapHistoryRecord(vocabularyDictionaryRemapHistory)
  };
}

function reconcileDescriptorDraftFromDictionaryEvent(event) {
  if (!descriptorDraft) return;
  const descriptorIdRemap = event.descriptorIdRemap || {};
  const vocabularyIdRemap = event.vocabularyEntryIdRemap || {};
  const validDescriptorIds = new Set((descriptorLibrary?.entries || []).map((entry) => entry.id));
  const validVocabularyIds = new Set((vocabularyLibrary?.entries || []).map((entry) => entry.id));

  for (const classId of Object.keys(descriptorDraft)) {
    const seen = new Set();
    descriptorDraft[classId] = (descriptorDraft[classId] || []).filter((chip) => {
      if (chip.entryId) {
        chip.entryId = descriptorIdRemap[chip.entryId] || chip.entryId;
        if (!validDescriptorIds.has(chip.entryId) && !chip.display) return false;
      }
      if (chip.vocabularyEntryId) {
        chip.vocabularyEntryId = vocabularyIdRemap[chip.vocabularyEntryId] || chip.vocabularyEntryId;
        if (!validVocabularyIds.has(chip.vocabularyEntryId) && !chip.display) return false;
      }
      const key = `${descriptorChipKey(chip)}|${chip.source === 'auto' ? 'auto' : 'manual'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const seenIgnored = new Set();
    ignoredDescriptorDraft[classId] = (ignoredDescriptorDraft?.[classId] || []).filter((ref) => {
      ref.entryId = descriptorIdRemap[ref.entryId] || ref.entryId;
      if ((!validDescriptorIds.has(ref.entryId) && !ref.display) || seenIgnored.has(ref.entryId)) return false;
      seenIgnored.add(ref.entryId);
      return true;
    });

    ignoredManualEntryIdsDraft[classId] = [...new Set(
      (ignoredManualEntryIdsDraft?.[classId] || [])
        .map((entryId) => descriptorIdRemap[entryId] || entryId)
        .filter((entryId) => seenIgnored.has(entryId) && (
          validDescriptorIds.has(entryId)
          || (ignoredDescriptorDraft[classId] || [])
            .some((ref) => ref.entryId === entryId && ref.display)
        ))
    )];
  }
}

function descriptorGroupMembershipRemapFromDictionaryEvent(event) {
  const registryById = new Map((descriptorLibrary?.entries || [])
    .map((entry) => [entry.id, entry]));
  const remap = {};
  for (const entry of registryById.values()) {
    const membershipKey = descriptorGroupsModel.membershipKey(entry);
    if (membershipKey && membershipKey !== entry.id) remap[entry.id] = membershipKey;
  }
  for (const [sourceId, targetId] of Object.entries(event.descriptorIdRemap || {})) {
    const targetEntry = registryById.get(targetId);
    remap[sourceId] = descriptorGroupsModel.membershipKey(targetEntry) || remap[targetId] || targetId;
  }
  Object.assign(remap, event.vocabularyEntryIdRemap || {});
  return remap;
}

function reconcileDescriptorGroupDraftFromDictionaryEvent(event) {
  if (event?.type !== 'dictionary-data-changed' || pageMetaModal?.type !== 'descriptor') return;
  const remap = descriptorGroupMembershipRemapFromDictionaryEvent(event);
  let rebased = descriptorGroupsModel.remapMemberships(descriptorGroupsConfig, remap).config;
  const validMembershipKeys = new Set((descriptorLibrary?.entries || [])
    .map((entry) => descriptorGroupsModel.membershipKey(entry))
    .filter(Boolean));
  const explicitlyRetiredIds = new Set([
    ...Object.keys(event.descriptorIdRemap || {}),
    ...Object.keys(event.vocabularyEntryIdRemap || {}),
    ...(event.descriptorEntryIds || []),
    ...(event.vocabularyEntryIds || [])
  ]);
  const invalidMembershipKeys = Object.keys(rebased.descriptorParentByEntryId || {})
    .filter((entryId) => explicitlyRetiredIds.has(entryId) && !validMembershipKeys.has(entryId));
  rebased = descriptorGroupsModel.removeMemberships(rebased, invalidMembershipKeys).config;
  descriptorGroupsConfig = rebased;

  const activeUndoContext = undoManager.activeContext();
  if (activeUndoContext?.type === 'descriptor-edit') {
    undoManager.beginContext(activeUndoContext);
  }
  if (descriptorGroupRename) {
    descriptorGroupRename.beforeSnapshot = cloneDescriptorUndoSnapshot();
  }
}

function reconcileDescriptorModalDraftsFromDictionaryEvent(event) {
  if (event?.type !== 'dictionary-data-changed' || pageMetaModal?.type !== 'descriptor') {
    return false;
  }
  reconcileDescriptorDraftFromDictionaryEvent(event);
  reconcileDescriptorGroupDraftFromDictionaryEvent(event);
  return true;
}

async function applyDictionaryDataChanged(event) {
  if (!event?.metadataChangeSet) return false;
  const result = await installDescriptorMetadataChangeSet(event.metadataChangeSet, {
    source: 'dictionary-event',
    event
  });
  if (result.stale) {
    const reconciledEvent = dictionaryEventWithRecordedRemaps(event);
    runDescriptorMetadataPresentation(() => {
      if (reconcileDescriptorModalDraftsFromDictionaryEvent(reconciledEvent)) {
        rerenderDescriptorEditor(null, { preserveInputs: true });
      }
    });
  }
  return result.applied;
}

function receiveDictionaryEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'dictionary-ready') {
    if (pendingDictionaryCommand) dictionaryChannel?.postMessage(pendingDictionaryCommand);
    return;
  }
  if (event.type === 'dictionary-command-accepted') {
    if (!event.commandId || pendingDictionaryCommand?.commandId === event.commandId) {
      pendingDictionaryCommand = null;
    }
    return;
  }
  if (event.type !== 'dictionary-data-changed') return;
  if (event.eventId && handledDictionaryEventIds.has(event.eventId)) return;
  if (event.eventId) handledDictionaryEventIds.add(event.eventId);
  dictionarySyncPromise = dictionarySyncPromise
    .then(() => applyDictionaryDataChanged(event))
    .catch((error) => {
      const runtime = activePaneRuntime();
      if (runtime) showRuntimeStatus(runtime, error.message, true, 2400);
    });
}

dictionaryChannel?.addEventListener('message', (event) => receiveDictionaryEvent(event.data));
window.addEventListener('message', (event) => {
  if (event.origin === window.location.origin) receiveDictionaryEvent(event.data);
});

function addDescriptorDraftChip(classId, text, { onError = null } = {}) {
  const before = cloneDescriptorUndoSnapshot();
  const display = normalizeDescriptorText(text);
  if (!display) return false;
  const vocabularyMatch = descriptorVocabularyMatch(display);
  const vocabularyEntry = vocabularyMatch?.entry || null;
  const canonicalDisplay = vocabularyEntry?.display || display;
  const existingEntry = vocabularyEntry
    ? descriptorEntryByVocabularyId().get(vocabularyEntry.id)
      || descriptorEntryByText().get(descriptorCompareKey(canonicalDisplay))
    : descriptorEntryByText().get(descriptorCompareKey(canonicalDisplay));
  const existingDraft = descriptorDraftDefinitionByDisplay(canonicalDisplay);
  const chip = existingEntry
    ? { entryId: existingEntry.id }
    : existingDraft
      ? {
        entryId: existingDraft.entryId,
        display: existingDraft.display || canonicalDisplay,
        vocabularyEntryId: existingDraft.vocabularyEntryId || vocabularyEntry?.id
      }
      : {
        entryId: newDescriptorDraftId('desc'),
        display: canonicalDisplay,
        vocabularyEntryId: vocabularyEntry?.id || newDescriptorDraftId('vocab')
      };
  const chips = descriptorDraft[classId] || [];
  const nextKey = descriptorChipKey(chip);
  const matchingItems = chips.filter((item) => descriptorChipKey(item) === nextKey
    || descriptorCompareKey(descriptorChipDisplay(item)) === descriptorCompareKey(canonicalDisplay));
  if (matchingItems.some((item) => item.source !== 'auto')) {
    onError?.('Descriptor already exists in this class.');
    return false;
  }
  chip.source = 'manual';
  chip.status = 'active';
  chips.push(chip);
  descriptorDraft[classId] = chips;
  removeIgnoredDescriptor(classId, chip.entryId);
  descriptorDraftDirty = true;
  recordDescriptorChange(before);
  return true;
}

function removeDescriptorDraftChip(classId, logicalChip) {
  const before = cloneDescriptorUndoSnapshot();
  const entryId = logicalChip.refs.find((item) => item.entryId)?.entryId;
  const mutation = descriptorMutation.normalRemoval(logicalChip.refs);
  descriptorDraft[classId] = (descriptorDraft[classId] || [])
    .filter((chip) => descriptorChipKey(chip) !== logicalChip.key);
  if (mutation.createIgnored && entryId) {
    addIgnoredDescriptor(classId, entryId, mutation.rememberManual);
  }
  descriptorDraftDirty = true;
  rerenderDescriptorEditor(classId, { preserveInputs: true });
  recordDescriptorChange(before);
}

function excludeManualDescriptorFromClass(classId, logicalChip) {
  const before = cloneDescriptorUndoSnapshot();
  const entryId = logicalChip.refs.find((item) => item.entryId)?.entryId;
  if (!entryId) return;
  descriptorDraft[classId] = (descriptorDraft[classId] || [])
    .filter((chip) => descriptorChipKey(chip) !== logicalChip.key);
  const definition = logicalChip.refs.find((item) => item.display) || logicalChip.chip;
  addIgnoredDescriptor(classId, entryId, true, definition);
  descriptorDraftDirty = true;
  rerenderDescriptorEditor(classId, { preserveInputs: true });
  recordDescriptorChange(before);
}

async function restoreIgnoredDescriptor(classId, ignoredRef) {
  const modalOwner = pageMetaModal;
  const before = cloneDescriptorUndoSnapshot();
  const ignoredManual = ignoredDescriptorHadManualState(classId, ignoredRef.entryId);
  if (!staleIgnoredDescriptorKeys) {
    await refreshStaleIgnoredDescriptors();
    if (pageMetaModal !== modalOwner) return;
  }
  const hasAutoSupport = Boolean(staleIgnoredDescriptorKeys)
    && !ignoredDescriptorIsInactive(classId, ignoredRef.entryId);
  const source = descriptorMutation.restoreSource({ ignoredManual, hasAutoSupport });
  removeIgnoredDescriptor(classId, ignoredRef.entryId);
  const refs = descriptorDraft[classId] || [];
  if (!refs.some((item) => item.entryId === ignoredRef.entryId && item.source === source)) {
    refs.push({
      entryId: ignoredRef.entryId,
      display: ignoredRef.display,
      vocabularyEntryId: ignoredRef.vocabularyEntryId,
      source,
      status: 'active',
      createdAt: new Date().toISOString()
    });
  }
  descriptorDraft[classId] = refs;
  descriptorDraftDirty = true;
  rerenderDescriptorEditor(classId, { preserveInputs: true });
  recordDescriptorChange(before);
}

function moveDescriptorDraftChip(sourceClassId, targetClassId, logicalChip) {
  if (sourceClassId === targetClassId) return;
  const before = cloneDescriptorUndoSnapshot();
  const entryId = logicalChip.refs.find((item) => item.entryId)?.entryId;
  if (!entryId) return;
  const restoreManual = logicalChip.refs.some((item) => item.source !== 'auto');
  descriptorDraft[sourceClassId] = (descriptorDraft[sourceClassId] || [])
    .filter((chip) => descriptorChipKey(chip) !== logicalChip.key);
  const definition = logicalChip.refs.find((item) => item.display) || logicalChip.chip;
  addIgnoredDescriptor(sourceClassId, entryId, restoreManual, definition);
  removeIgnoredDescriptor(targetClassId, entryId);
  const targetRefs = descriptorDraft[targetClassId] || [];
  if (!targetRefs.some((item) => item.entryId === entryId && item.source !== 'auto')) {
    targetRefs.push({
      entryId,
      display: definition?.display,
      vocabularyEntryId: definition?.vocabularyEntryId,
      source: 'manual',
      status: 'active'
    });
  }
  descriptorDraft[targetClassId] = targetRefs;
  descriptorDraftDirty = true;
  rerenderDescriptorEditor(targetClassId, { preserveInputs: true });
  recordDescriptorChange(before);
}

function descriptorLogicalChips(chips) {
  const byKey = new Map();
  for (const chip of chips || []) {
    const key = descriptorChipKey(chip);
    if (!byKey.has(key)) byKey.set(key, { key, refs: [], chip });
    byKey.get(key).refs.push(chip);
  }
  return [...byKey.values()];
}

function renderDescriptorChip(classId, logicalChip) {
  const { key, refs, chip } = logicalChip;
  const hasManual = refs.some((ref) => ref.source !== 'auto');
  const hasAuto = refs.some((ref) => ref.source === 'auto');
  const element = document.createElement('span');
  element.className = 'descriptor-chip';
  element.dataset.entryId = chip.entryId;
  element.dataset.classId = classId;
  element.dataset.chipKey = key;
  element.classList.toggle('auto', hasAuto && !hasManual);
  element.classList.toggle('manual-auto', hasAuto && hasManual);
  element.draggable = true;
  element.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-viewer-descriptor', JSON.stringify({
      sourceClassId: classId,
      chipKey: key
    }));
    element.classList.add('dragging');
  });
  element.addEventListener('dragend', () => element.classList.remove('dragging'));
  if (hasAuto) element.title = hasManual ? 'Manual and automatic descriptor' : 'Automatic descriptor';
  const label = document.createElement('span');
  label.textContent = descriptorChipDisplay(chip);
  element.append(label);
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'descriptor-chip-remove';
  removeButton.setAttribute('aria-label', `Remove ${label.textContent}`);
  removeButton.textContent = '×';
  removeButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    const modalOwner = pageMetaModal;
    try {
      await removeDescriptorDraftChip(classId, logicalChip);
    } catch (error) {
      showPageMetaModalStatus(modalOwner, error.message, true);
    }
  });
  element.append(removeButton);
  return element;
}

function renderIgnoredDescriptorChip(classId, ignoredRef) {
  const chip = document.createElement('span');
  chip.className = 'descriptor-chip ignored';
  chip.classList.toggle('auto', !ignoredDescriptorHadManualState(classId, ignoredRef.entryId));
  const inactive = ignoredDescriptorIsInactive(classId, ignoredRef.entryId);
  chip.classList.toggle('inactive-exclusion', inactive);
  const label = document.createElement('span');
  label.textContent = descriptorEntryMap().get(ignoredRef.entryId)?.display
    || ignoredRef.display
    || ignoredRef.entryId;
  const restoreButton = document.createElement('button');
  restoreButton.type = 'button';
  restoreButton.className = 'descriptor-chip-remove descriptor-chip-restore';
  restoreButton.setAttribute('aria-label', `Restore ${label.textContent}`);
  restoreButton.textContent = '+';
  restoreButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    const modalOwner = pageMetaModal;
    try {
      await restoreIgnoredDescriptor(classId, ignoredRef);
    } catch (error) {
      showPageMetaModalStatus(modalOwner, error.message, true);
    }
  });
  chip.append(label, restoreButton);
  return chip;
}

function ignoredDescriptorIsInactive(classId, entryId) {
  const pageId = pageMetaModal?.runtime?.currentPage?.id;
  if (!pageId || !staleIgnoredDescriptorKeys) return false;
  return staleIgnoredDescriptorKeys.has(`${pageId}|${classId}|${entryId}`);
}

function descriptorGroupItemKey(type, id) {
  return `${type}:${id}`;
}

function selectedDescriptorGroupMoveItems() {
  return [...selectedDescriptorGroupItems].map((key) => {
    const separator = key.indexOf(':');
    return { type: key.slice(0, separator), id: key.slice(separator + 1) };
  });
}

function updateDescriptorGroupSelectionVisuals() {
  const modal = pageMetaModal?.type === 'descriptor' ? pageMetaModal.modal : null;
  if (!modal) return;
  for (const element of modal.querySelectorAll('[data-descriptor-selection-key]')) {
    element.classList.toggle('selected', selectedDescriptorGroupItems.has(
      element.dataset.descriptorSelectionKey
    ));
  }
}

function selectDescriptorGroupItem(key, event, { rightClick = false } = {}) {
  if (rightClick) {
    if (!selectedDescriptorGroupItems.has(key)) {
      selectedDescriptorGroupItems.clear();
      selectedDescriptorGroupItems.add(key);
    }
  } else if (event.shiftKey && descriptorGroupSelectionAnchor) {
    const start = descriptorGroupVisibleOrder.indexOf(descriptorGroupSelectionAnchor);
    const end = descriptorGroupVisibleOrder.indexOf(key);
    if (start >= 0 && end >= 0) {
      if (!(event.metaKey || event.altKey)) selectedDescriptorGroupItems.clear();
      const [from, to] = start < end ? [start, end] : [end, start];
      for (const itemKey of descriptorGroupVisibleOrder.slice(from, to + 1)) {
        selectedDescriptorGroupItems.add(itemKey);
      }
    }
  } else if (event.metaKey || event.altKey) {
    if (selectedDescriptorGroupItems.has(key)) selectedDescriptorGroupItems.delete(key);
    else selectedDescriptorGroupItems.add(key);
  } else {
    selectedDescriptorGroupItems.clear();
    selectedDescriptorGroupItems.add(key);
  }
  descriptorGroupSelectionAnchor = key;
  updateDescriptorGroupSelectionVisuals();
}

function descriptorGroupMoveSourceText(items) {
  if (items.length !== 1) return `${items.length} items`;
  const item = items[0];
  if (item.type === 'group') return descriptorGroupsConfig.groups[item.id]?.name || item.id;
  const entry = (descriptorLibrary?.entries || []).find((candidate) => (
    descriptorGroupsModel.membershipKey(candidate) === item.id
  ));
  return entry?.display || item.id;
}

function clearDescriptorGroupMoveTarget() {
  descriptorGroupMoveHoverNode?.classList.remove('is-move-hover');
  descriptorGroupMoveHoverNode = null;
  descriptorGroupMoveHint?.remove();
  descriptorGroupMoveHint = null;
}

function showDescriptorGroupMoveTarget(node, groupId, event) {
  if (!descriptorGroupMoveMode || !node || !groupId) return;
  const destination = { kind: 'group', groupId };
  if (descriptorGroupDropState(destination).error) {
    clearDescriptorGroupMoveTarget();
    return;
  }
  if (descriptorGroupMoveHoverNode !== node) {
    descriptorGroupMoveHoverNode?.classList.remove('is-move-hover');
    descriptorGroupMoveHoverNode = node;
    node.classList.add('is-move-hover');
  }
  if (!descriptorGroupMoveHint) {
    descriptorGroupMoveHint = document.createElement('div');
    descriptorGroupMoveHint.className = 'descriptor-move-follow-hint';
    document.body.append(descriptorGroupMoveHint);
  }
  const source = descriptorGroupMoveSourceText(descriptorGroupMoveMode.items);
  const destinationName = descriptorGroupsConfig.groups[groupId]?.name || groupId;
  descriptorGroupMoveHint.textContent = `Move “${source}” to “${destinationName}”`;
  descriptorGroupMoveHint.style.left = `${Math.min(
    event.clientX + 10,
    window.innerWidth - descriptorGroupMoveHint.offsetWidth - 12
  )}px`;
  descriptorGroupMoveHint.style.top = `${Math.min(
    event.clientY + 10,
    window.innerHeight - descriptorGroupMoveHint.offsetHeight - 12
  )}px`;
}

function cancelDescriptorGroupMoveMode() {
  descriptorGroupMoveMode = null;
  clearDescriptorGroupMoveTarget();
  pageMetaModal?.modal.classList.remove('descriptor-move-target-pick-mode');
  updateDescriptorGroupSelectionVisuals();
}

function cloneDescriptorUndoValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cloneDescriptorUndoSnapshot() {
  return {
    groups: cloneDescriptorUndoValue(descriptorGroupsConfig),
    descriptors: cloneDescriptorUndoValue(descriptorDraft),
    ignored: cloneDescriptorUndoValue(ignoredDescriptorDraft),
    ignoredManual: cloneDescriptorUndoValue(ignoredManualEntryIdsDraft),
    dirty: descriptorDraftDirty
  };
}

function applyDescriptorUndoSnapshot(snapshot) {
  descriptorGroupRename = null;
  descriptorGroupMoveMode = null;
  descriptorGroupDragSelection = null;
  selectedDescriptorGroupItems.clear();
  descriptorGroupsConfig = cloneDescriptorUndoValue(snapshot.groups);
  descriptorDraft = cloneDescriptorUndoValue(snapshot.descriptors);
  ignoredDescriptorDraft = cloneDescriptorUndoValue(snapshot.ignored);
  ignoredManualEntryIdsDraft = cloneDescriptorUndoValue(snapshot.ignoredManual);
  descriptorDraftDirty = snapshot.dirty;
  if (pageMetaModal?.type === 'descriptor') {
    rerenderDescriptorEditor(null, { preserveInputs: true });
  }
  const runtime = pageMetaModal?.runtime;
  if (runtime && runtime === activePaneRuntime()) {
    renderRelations(runtime, runtime.currentPage || { blocks: [], backlinks: [] });
  }
}

function recordDescriptorChange(before, after = cloneDescriptorUndoSnapshot()) {
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  const undoSnapshot = cloneDescriptorUndoValue(before);
  const redoSnapshot = cloneDescriptorUndoValue(after);
  return undoManager.record({
    undo: () => applyDescriptorUndoSnapshot(undoSnapshot),
    redo: () => applyDescriptorUndoSnapshot(redoSnapshot)
  });
}

function enterDescriptorGroupMoveMode() {
  const items = descriptorGroupsModel.normalizeMoveSelection(
    descriptorGroupsConfig,
    selectedDescriptorGroupMoveItems()
  );
  if (!items.length) return;
  closeDescriptorContextMenu();
  closeDescriptorGroupContextMenu();
  descriptorGroupMoveMode = { items };
  clearDescriptorGroupMoveTarget();
  pageMetaModal?.modal.classList.add('descriptor-move-target-pick-mode');
  updateDescriptorGroupSelectionVisuals();
}

async function performDescriptorGroupMove(destination, items = null) {
  const modalOwner = pageMetaModal;
  const moveItems = items || descriptorGroupMoveMode?.items || descriptorGroupDragSelection
    || selectedDescriptorGroupMoveItems();
  const result = descriptorGroupsModel.moveSelection(descriptorGroupsConfig, moveItems, destination);
  if (result.error) {
    showPageMetaModalStatus(modalOwner, result.error, true, 2200);
    return false;
  }
  const before = cloneDescriptorUndoSnapshot();
  if (result.changed) descriptorGroupsConfig = result.config;
  descriptorGroupMoveMode = null;
  clearDescriptorGroupMoveTarget();
  pageMetaModal?.modal.classList.remove('descriptor-move-target-pick-mode');
  descriptorGroupDragSelection = null;
  selectedDescriptorGroupItems.clear();
  for (const item of result.items) {
    selectedDescriptorGroupItems.add(descriptorGroupItemKey(item.type, item.id));
  }
  rerenderDescriptorBrowser();
  if (result.changed) recordDescriptorChange(before);
  return true;
}

function descriptorGroupDropState(destination) {
  const items = descriptorGroupMoveMode?.items || descriptorGroupDragSelection
    || selectedDescriptorGroupMoveItems();
  return descriptorGroupsModel.moveSelection(descriptorGroupsConfig, items, destination);
}

function bindDescriptorGroupDropTarget(element, destination) {
  element.addEventListener('dragover', (event) => {
    if (!descriptorGroupDragSelection) return;
    event.preventDefault();
    event.stopPropagation();
    const result = descriptorGroupDropState(destination);
    element.classList.toggle('invalid-drop', Boolean(result.error));
    element.classList.toggle('drop-target', !result.error);
    event.dataTransfer.dropEffect = result.error ? 'none' : 'move';
  });
  element.addEventListener('dragleave', () => {
    element.classList.remove('drop-target', 'invalid-drop');
  });
  element.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove('drop-target', 'invalid-drop');
    const modalOwner = pageMetaModal;
    try {
      await performDescriptorGroupMove(destination, descriptorGroupDragSelection);
    } catch (error) {
      showPageMetaModalStatus(modalOwner, error.message, true);
    }
  });
}

function setDescriptorGroupMoving(active) {
  for (const element of document.querySelectorAll('[data-descriptor-selection-key]')) {
    element.classList.toggle(
      'is-moving',
      active && selectedDescriptorGroupItems.has(element.dataset.descriptorSelectionKey)
    );
  }
}

function renderReadOnlyDescriptorChip(entry) {
  const chip = document.createElement('span');
  chip.className = 'descriptor-chip read-only descriptor-global-chip';
  chip.dataset.descriptorEntryId = entry.id;
  if (entry.vocabularyEntryId) chip.dataset.vocabularyEntryId = entry.vocabularyEntryId;
  const membershipKey = descriptorGroupsModel.membershipKey(entry);
  const selectionKey = descriptorGroupItemKey('descriptor', membershipKey);
  chip.dataset.descriptorSelectionKey = selectionKey;
  chip.classList.toggle('selected', selectedDescriptorGroupItems.has(selectionKey));
  chip.draggable = true;
  const display = document.createElement('span');
  display.textContent = entry.display;
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    selectDescriptorGroupItem(selectionKey, event);
  });
  chip.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    selectDescriptorGroupItem(selectionKey, event, { rightClick: true });
    openDescriptorContextMenu(event, entry);
  });
  chip.addEventListener('dragstart', (event) => {
    if (!selectedDescriptorGroupItems.has(selectionKey)) {
      selectedDescriptorGroupItems.clear();
      selectedDescriptorGroupItems.add(selectionKey);
    }
    descriptorGroupDragSelection = selectedDescriptorGroupMoveItems();
    setDescriptorGroupMoving(true);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-viewer-descriptor-group-items', 'move');
  });
  chip.addEventListener('dragend', () => {
    descriptorGroupDragSelection = null;
    setDescriptorGroupMoving(false);
    document.querySelectorAll('.drop-target, .invalid-drop').forEach((target) => (
      target.classList.remove('drop-target', 'invalid-drop')
    ));
  });
  chip.append(display);
  return chip;
}

function descriptorIsUngrouped(entry) {
  const parentId = descriptorGroupsConfig?.descriptorParentByEntryId?.[
    descriptorGroupsModel.membershipKey(entry)
  ];
  return !parentId || !descriptorGroupsConfig?.groups?.[parentId];
}


function uniqueDescriptorGroupId() {
  let id;
  do {
    id = `descriptor_group_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  } while (descriptorGroupsConfig.groups[id]);
  return id;
}

function cancelDescriptorGroupRename() {
  const rename = descriptorGroupRename;
  if (!rename) return;
  descriptorGroupRename = null;
  if (rename.isNew) delete descriptorGroupsConfig.groups[rename.groupId];
  else if (descriptorGroupsConfig.groups[rename.groupId]) descriptorGroupsConfig.groups[rename.groupId].name = rename.previousName;
  rerenderDescriptorBrowser();
}

async function commitDescriptorGroupRename(input) {
  const rename = descriptorGroupRename;
  if (!rename || rename.committing) return;
  rename.committing = true;
  const group = descriptorGroupsConfig.groups[rename.groupId];
  if (!group) {
    descriptorGroupRename = null;
    return;
  }
  const value = input.value.trim() || (rename.isNew ? 'New Group' : rename.previousName);
  const changed = rename.isNew || value !== rename.previousName;
  group.name = value;
  group.updatedAt = new Date().toISOString();
  descriptorGroupRename = null;
  if (changed) recordDescriptorChange(rename.beforeSnapshot);
  rerenderDescriptorBrowser();
}

function beginDescriptorGroupRename(groupId, { isNew = false } = {}) {
  const group = descriptorGroupsConfig.groups[groupId];
  if (!group) return;
  descriptorGroupRename = {
    groupId,
    previousName: group.name,
    isNew,
    committing: false,
    beforeSnapshot: cloneDescriptorUndoSnapshot()
  };
  rerenderDescriptorBrowser();
}

function createDescriptorGroup() {
  if (descriptorGroupRename) cancelDescriptorGroupRename();
  const now = new Date().toISOString();
  const id = uniqueDescriptorGroupId();
  const beforeSnapshot = cloneDescriptorUndoSnapshot();
  descriptorGroupsConfig.groups[id] = { id, name: 'New Group', parentId: null, createdAt: now, updatedAt: now };
  selectedDescriptorGroupItems.clear();
  selectedDescriptorGroupItems.add(descriptorGroupItemKey('group', id));
  descriptorGroupRename = {
    groupId: id,
    previousName: 'New Group',
    isNew: true,
    committing: false,
    beforeSnapshot
  };
  rerenderDescriptorBrowser();
}

async function openDescriptorGroupContextMenu(event, groupId) {
  if (!window.nativeContextMenu?.available()) return;
  const modalOwner = pageMetaModal;
  const runtime = modalOwner?.runtime;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'descriptor-group-menu',
    requireMount: false
  });
  if (!operation) return;
  selectDescriptorGroupItem(descriptorGroupItemKey('group', groupId), event, { rightClick: true });
  const target = { groupId };
  descriptorGroupContextTarget = target;
  const command = await window.nativeContextMenu.open(event, {
    type: 'descriptor-group', targetId: groupId, selectedCount: selectedDescriptorGroupItems.size || 1
  });
  if (!command || pageMetaModal !== modalOwner || descriptorGroupContextTarget !== target
    || !runtimeOperationIsCurrent(operation)
    || !descriptorGroupsConfig.groups[groupId]) return closeDescriptorGroupContextMenu();
  if (command === 'rename-descriptor-group') {
    closeDescriptorGroupContextMenu();
    beginDescriptorGroupRename(groupId);
  } else if (command === 'move-descriptor-group') enterDescriptorGroupMoveMode();
  else if (command === 'delete-descriptor-group') deleteSelectedDescriptorGroup();
}

async function deleteSelectedDescriptorGroup() {
  const groupId = descriptorGroupContextTarget?.groupId;
  closeDescriptorGroupContextMenu();
  const group = descriptorGroupsConfig.groups[groupId];
  if (!group) return;
  const hasChildren = descriptorGroupsModel.childGroupIds(descriptorGroupsConfig, groupId).length > 0;
  const hasDescriptors = Object.values(descriptorGroupsConfig.descriptorParentByEntryId || {}).includes(groupId);
  if ((hasChildren || hasDescriptors) && !window.confirm(
    `Delete group "${group.name}"?\n\nIts descriptors and child groups will be moved one level outward.\nNothing inside the group will be deleted.`
  )) return;
  const before = cloneDescriptorUndoSnapshot();
  const result = descriptorGroupsModel.deleteGroup(descriptorGroupsConfig, groupId);
  if (!result.changed) return;
  descriptorGroupsConfig = result.config;
  expandedDescriptorGroupIds.delete(groupId);
  selectedDescriptorGroupItems.delete(descriptorGroupItemKey('group', groupId));
  rerenderDescriptorBrowser();
  recordDescriptorChange(before);
}

function descriptorEntriesForGroup(groupId) {
  return (descriptorLibrary?.entries || [])
    .filter((entry) => descriptorGroupsConfig.descriptorParentByEntryId?.[descriptorGroupsModel.membershipKey(entry)] === groupId)
    .sort((a, b) => a.display.localeCompare(b.display, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

function renderDescriptorGroupNode(groupId, depth = 0) {
  const group = descriptorGroupsConfig.groups[groupId];
  const node = document.createElement('div');
  node.className = 'descriptor-group-node';
  node.dataset.descriptorGroupId = groupId;
  const row = document.createElement('div');
  row.className = 'descriptor-group-row';
  row.classList.toggle('is-renaming', descriptorGroupRename?.groupId === groupId);
  row.draggable = descriptorGroupRename?.groupId !== groupId;
  const selectionKey = descriptorGroupItemKey('group', groupId);
  row.dataset.descriptorSelectionKey = selectionKey;
  row.classList.toggle('selected', selectedDescriptorGroupItems.has(selectionKey));
  descriptorGroupVisibleOrder.push(selectionKey);
  const expanded = expandedDescriptorGroupIds.has(groupId);
  row.setAttribute('aria-expanded', String(expanded));
  const disclosure = document.createElement('span');
  disclosure.className = 'descriptor-group-disclosure disclosure-chevron';
  disclosure.setAttribute('aria-hidden', 'true');
  row.append(disclosure);

  if (descriptorGroupRename?.groupId === groupId) {
    const input = document.createElement('input');
    input.className = 'descriptor-group-rename-input';
    input.value = group.name;
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      if (globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(event, input)) return;
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commitDescriptorGroupRename(input);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelDescriptorGroupRename();
      }
    });
    input.addEventListener('blur', () => commitDescriptorGroupRename(input));
    row.append(input);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  } else {
    const name = document.createElement('span');
    name.className = 'descriptor-group-name';
    name.textContent = group.name;
    name.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      beginDescriptorGroupRename(groupId);
    });
    row.append(name);
  }

  row.addEventListener('click', (event) => {
    event.stopPropagation();
    if (descriptorGroupMoveMode) {
      const modalOwner = pageMetaModal;
      performDescriptorGroupMove({ kind: 'group', groupId })
        .catch((error) => showPageMetaModalStatus(modalOwner, error.message, true));
      return;
    }
    selectDescriptorGroupItem(selectionKey, event);
    if (expanded) expandedDescriptorGroupIds.delete(groupId);
    else expandedDescriptorGroupIds.add(groupId);
    rerenderDescriptorBrowser();
  });
  row.addEventListener('contextmenu', (event) => openDescriptorGroupContextMenu(event, groupId));
  row.addEventListener('dragstart', (event) => {
    if (!selectedDescriptorGroupItems.has(selectionKey)) {
      selectedDescriptorGroupItems.clear();
      selectedDescriptorGroupItems.add(selectionKey);
    }
    descriptorGroupDragSelection = selectedDescriptorGroupMoveItems();
    setDescriptorGroupMoving(true);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-viewer-descriptor-group-items', 'move');
  });
  row.addEventListener('dragend', () => {
    descriptorGroupDragSelection = null;
    setDescriptorGroupMoving(false);
    document.querySelectorAll('.drop-target, .invalid-drop').forEach((target) => target.classList.remove('drop-target', 'invalid-drop'));
  });
  bindDescriptorGroupDropTarget(row, { kind: 'group', groupId });
  node.append(row);

  if (expanded) {
    const contents = document.createElement('div');
    contents.className = 'descriptor-group-contents';
    // Keep each group tree readable: nested groups come before the descriptors
    // directly assigned to this group. Both collections are already rendered
    // from alphabetically sorted copies, without changing stored group data.
    for (const childId of descriptorGroupsModel.childGroupIds(descriptorGroupsConfig, groupId)) {
      contents.append(renderDescriptorGroupNode(childId, depth + 1));
    }
    const descriptors = descriptorEntriesForGroup(groupId);
    if (descriptors.length) {
      const list = document.createElement('div');
      list.className = 'descriptor-group-descriptors';
      for (const entry of descriptors) {
        descriptorGroupVisibleOrder.push(descriptorGroupItemKey('descriptor', descriptorGroupsModel.membershipKey(entry)));
        list.append(renderReadOnlyDescriptorChip(entry));
      }
      contents.append(list);
    }
    node.append(contents);
  }
  return node;
}

function renderDescriptorBrowser() {
  descriptorGroupVisibleOrder = [];
  const entries = descriptorLibrary?.entries || [];
  const ungroupedEntries = entries.filter(descriptorIsUngrouped)
    .sort((a, b) => a.display.localeCompare(b.display, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  const upperArea = document.createElement('div');
  upperArea.className = 'descriptor-browser';
  upperArea.style.setProperty('--descriptor-ungrouped-width', `${descriptorBrowserRightWidth}px`);

  const groupedPane = document.createElement('section');
  groupedPane.className = 'descriptor-browser-pane grouped';
  const groupedHeading = document.createElement('div');
  groupedHeading.className = 'descriptor-browser-heading';
  const groupedTitle = document.createElement('h3');
  groupedTitle.textContent = 'Grouped descriptors';
  const addGroup = document.createElement('button');
  addGroup.type = 'button';
  addGroup.className = 'descriptor-add-group-button ui-solid-action ui-primary-action';
  addGroup.textContent = 'Add Group';
  addGroup.addEventListener('click', (event) => {
    event.stopPropagation();
    createDescriptorGroup();
  });
  groupedHeading.append(groupedTitle, addGroup);
  groupedHeading.addEventListener('click', (event) => {
    if (event.target === addGroup) return;
    if (descriptorGroupMoveMode) {
      cancelDescriptorGroupMoveMode();
      return;
    }
    selectedDescriptorGroupItems.clear();
    updateDescriptorGroupSelectionVisuals();
  });
  bindDescriptorGroupDropTarget(groupedHeading, { kind: 'root' });

  const groupedScroll = document.createElement('div');
  groupedScroll.className = 'descriptor-browser-scroll descriptor-group-tree';
  const rootGroupIds = descriptorGroupsModel.childGroupIds(descriptorGroupsConfig, null);
  if (!rootGroupIds.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No descriptor groups';
    groupedScroll.append(empty);
  } else {
    for (const groupId of rootGroupIds) groupedScroll.append(renderDescriptorGroupNode(groupId));
  }
  groupedScroll.addEventListener('click', (event) => {
    if (event.target === groupedScroll) {
      selectedDescriptorGroupItems.clear();
      updateDescriptorGroupSelectionVisuals();
    }
  });
  groupedScroll.addEventListener('pointermove', (event) => {
    if (!descriptorGroupMoveMode) return;
    const node = event.target.closest?.('.descriptor-group-node');
    const groupId = node?.dataset.descriptorGroupId;
    if (!node || !groupId) {
      clearDescriptorGroupMoveTarget();
      return;
    }
    showDescriptorGroupMoveTarget(node, groupId, event);
  });
  groupedScroll.addEventListener('pointerleave', clearDescriptorGroupMoveTarget);
  groupedScroll.addEventListener('click', (event) => {
    if (!descriptorGroupMoveMode) return;
    const node = event.target.closest?.('.descriptor-group-node');
    const groupId = node?.dataset.descriptorGroupId;
    if (!node || !groupId || descriptorGroupDropState({ kind: 'group', groupId }).error) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const modalOwner = pageMetaModal;
    performDescriptorGroupMove({ kind: 'group', groupId })
      .catch((error) => showPageMetaModalStatus(modalOwner, error.message, true));
  }, true);
  groupedPane.append(groupedHeading, groupedScroll);

  const divider = document.createElement('div');
  divider.className = 'descriptor-browser-divider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-label', 'Resize ungrouped descriptors pane');
  divider.addEventListener('pointerdown', (event) => startDescriptorDividerDrag(event, upperArea));

  const ungroupedPane = document.createElement('section');
  ungroupedPane.className = 'descriptor-browser-pane ungrouped';
  const ungroupedHeading = document.createElement('h3');
  ungroupedHeading.textContent = 'Ungrouped';
  const ungroupedScroll = document.createElement('div');
  ungroupedScroll.className = 'descriptor-browser-scroll descriptor-browser-list';
  if (!ungroupedEntries.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No ungrouped descriptors';
    ungroupedScroll.append(empty);
  } else {
    for (const entry of ungroupedEntries) {
      descriptorGroupVisibleOrder.push(descriptorGroupItemKey('descriptor', descriptorGroupsModel.membershipKey(entry)));
      ungroupedScroll.append(renderReadOnlyDescriptorChip(entry));
    }
  }
  ungroupedPane.addEventListener('click', (event) => {
    if (descriptorGroupMoveMode) {
      const modalOwner = pageMetaModal;
      performDescriptorGroupMove({ kind: 'ungrouped' })
        .catch((error) => showPageMetaModalStatus(modalOwner, error.message, true));
    }
    else if (event.target === ungroupedPane || event.target === ungroupedScroll) {
      selectedDescriptorGroupItems.clear();
      updateDescriptorGroupSelectionVisuals();
    }
  });
  bindDescriptorGroupDropTarget(ungroupedPane, { kind: 'ungrouped' });
  ungroupedPane.append(ungroupedHeading, ungroupedScroll);
  upperArea.append(groupedPane, divider, ungroupedPane);
  return upperArea;
}

function rerenderDescriptorBrowser() {
  clearDescriptorGroupMoveTarget();
  const existing = pageMetaModal?.type === 'descriptor' ? pageMetaModal.modal.querySelector('.descriptor-browser') : null;
  if (!existing) return;
  const groupedScrollTop = existing.querySelector('.descriptor-browser-pane.grouped .descriptor-browser-scroll')?.scrollTop || 0;
  const ungroupedScrollTop = existing.querySelector('.descriptor-browser-pane.ungrouped .descriptor-browser-scroll')?.scrollTop || 0;
  const replacement = renderDescriptorBrowser();
  existing.replaceWith(replacement);
  const groupedScroll = replacement.querySelector('.descriptor-browser-pane.grouped .descriptor-browser-scroll');
  const ungroupedScroll = replacement.querySelector('.descriptor-browser-pane.ungrouped .descriptor-browser-scroll');
  if (groupedScroll) groupedScroll.scrollTop = groupedScrollTop;
  if (ungroupedScroll) ungroupedScroll.scrollTop = ungroupedScrollTop;
}

function startDescriptorDividerDrag(event, upperArea) {
  if (event.button !== 0) return;
  event.preventDefault();

  descriptorDividerDragCleanup?.();
  document.body.classList.add('descriptor-divider-dragging');

  const onPointerMove = (moveEvent) => {
    const bounds = upperArea.getBoundingClientRect();
    const minLeftWidth = 220;
    const minRightWidth = 110;
    const dividerWidth = 7;
    const maxRightWidth = Math.max(minRightWidth, bounds.width - minLeftWidth - dividerWidth);
    descriptorBrowserRightWidth = Math.min(
      maxRightWidth,
      Math.max(minRightWidth, bounds.right - moveEvent.clientX - (dividerWidth / 2))
    );
    upperArea.style.setProperty('--descriptor-ungrouped-width', `${descriptorBrowserRightWidth}px`);
  };

  const stopDragging = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
    document.body.classList.remove('descriptor-divider-dragging');
    descriptorDividerDragCleanup = null;
  };

  descriptorDividerDragCleanup = stopDragging;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
}

function renderDescriptorClassEditor(descriptorClass) {
  const section = document.createElement('section');
  section.className = 'descriptor-class-editor';
  const heading = document.createElement('h4');
  heading.textContent = descriptorClass.label || descriptorClass.id;

  const field = document.createElement('div');
  field.className = 'descriptor-token-field';
  field.dataset.descriptorDropClass = descriptorClass.id;
  const chips = descriptorDraft[descriptorClass.id] || [];
  for (const logicalChip of descriptorLogicalChips(chips)) {
    field.append(renderDescriptorChip(descriptorClass.id, logicalChip));
  }

  field.addEventListener('contextmenu', (event) => {
    const chipElement = event.target.closest('.descriptor-chip[data-entry-id][data-class-id]');
    if (!chipElement || !field.contains(chipElement)) return;
    const classId = chipElement.dataset.classId;
    const entryId = chipElement.dataset.entryId;
    const logicalChip = descriptorLogicalChips(descriptorDraft?.[classId] || [])
      .find((item) => item.refs.some((ref) => ref.entryId === entryId));
    if (logicalChip) openActiveDescriptorContextMenu(event, classId, logicalChip);
  });

  field.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('application/x-viewer-descriptor')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    field.classList.add('drop-target');
  });
  field.addEventListener('dragleave', () => field.classList.remove('drop-target'));
  field.addEventListener('drop', async (event) => {
    field.classList.remove('drop-target');
    event.preventDefault();
    const modalOwner = pageMetaModal;
    try {
      const data = JSON.parse(event.dataTransfer.getData('application/x-viewer-descriptor'));
      const logicalChip = descriptorLogicalChips(descriptorDraft[data.sourceClassId] || [])
        .find((item) => item.key === data.chipKey);
      if (logicalChip) await moveDescriptorDraftChip(data.sourceClassId, descriptorClass.id, logicalChip);
    } catch (error) {
      showPageMetaModalStatus(modalOwner, error.message, true);
    }
  });

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'descriptor-input';
  input.dataset.descriptorInput = descriptorClass.id;
  input.placeholder = chips.length ? '' : 'Type descriptor and press Enter';

  const helper = document.createElement('div');
  helper.className = 'descriptor-input-helper';
  helper.hidden = true;

  const updateInputHelper = ({ error = '' } = {}) => {
    helper.classList.toggle('error', Boolean(error));
    if (error) {
      helper.textContent = error;
      helper.hidden = false;
      return;
    }

    const exactMatch = descriptorVocabularyMatch(input.value);
    if (exactMatch?.matchedAlias) {
      helper.textContent = `Will be displayed as "${exactMatch.entry.display}"`;
      helper.hidden = false;
      return;
    }

    const suggestion = descriptorVocabularyMatch(input.value, { allowPartial: true });
    const currentText = normalizeDescriptorText(input.value);
    if (suggestion && descriptorCompareKey(suggestion.text) !== descriptorCompareKey(currentText)) {
      helper.textContent = `Tab → ${suggestion.text}`;
      helper.hidden = false;
      return;
    }

    helper.textContent = '';
    helper.hidden = true;
  };

  input.addEventListener('input', () => updateInputHelper());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter'
      && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(event, input)) return;
    if (event.key === 'Tab') {
      const suggestion = descriptorVocabularyMatch(input.value, { allowPartial: true });
      if (suggestion
        && descriptorCompareKey(suggestion.text) !== descriptorCompareKey(input.value)) {
        event.preventDefault();
        event.stopPropagation();
        input.value = suggestion.text;
        updateInputHelper();
        input.focus();
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (addDescriptorDraftChip(descriptorClass.id, input.value, {
        onError: (message) => updateInputHelper({ error: message })
      })) {
        input.value = '';
        rerenderDescriptorEditor(descriptorClass.id);
      }
      return;
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && input.value === '') {
      const removableChip = [...descriptorLogicalChips(descriptorDraft[descriptorClass.id] || [])].pop();
      if (removableChip) {
        event.preventDefault();
        const modalOwner = pageMetaModal;
        try {
          removeDescriptorDraftChip(descriptorClass.id, removableChip);
        } catch (error) {
          showPageMetaModalStatus(modalOwner, error.message, true);
        }
      }
    }
  });
  field.addEventListener('click', () => {
    input.focus();
  });
  field.append(input);

  section.append(heading, field, helper);
  return section;
}

function updateDescriptorIgnoredFooter() {
  const button = pageMetaModal?.modal.querySelector('[data-descriptor-ignored-toggle]');
  if (!button) return;
  const ignoredMode = descriptorEditorMode === 'ignored';
  button.textContent = ignoredMode ? 'Active' : 'Ignored';
  button.classList.toggle('active', ignoredMode);
  button.setAttribute('aria-pressed', String(ignoredMode));
}

function renderIgnoredDescriptorClassEditor(descriptorClass) {
  const section = document.createElement('section');
  section.className = 'descriptor-class-editor descriptor-ignored-section';
  const heading = document.createElement('h4');
  heading.textContent = descriptorClass.label || descriptorClass.id;
  const field = document.createElement('div');
  field.className = 'descriptor-token-field descriptor-ignored-token-field';
  for (const ref of ignoredDescriptorDraft?.[descriptorClass.id] || []) {
    field.append(renderIgnoredDescriptorChip(descriptorClass.id, ref));
  }
  section.append(heading, field);
  return section;
}

function renderDescriptorEditor({ runtime = pageMetaModal?.runtime, preserveDraft = false } = {}) {
  if (!preserveDraft || !descriptorDraft) descriptorDraft = pageDescriptorDraftForRuntime(runtime);
  if (!preserveDraft || !ignoredDescriptorDraft) {
    ignoredDescriptorDraft = pageIgnoredDescriptorDraftForRuntime(runtime);
  }
  if (!preserveDraft || !ignoredManualEntryIdsDraft) {
    ignoredManualEntryIdsDraft = pageIgnoredManualEntryIdsDraftForRuntime(runtime);
  }

  const container = document.createElement('div');
  container.className = 'descriptor-editor';

  const upperArea = renderDescriptorBrowser();

  const pageSection = document.createElement('section');
  pageSection.className = 'descriptor-editor-section descriptor-page-editor';
  const pageHeading = document.createElement('h3');
  pageHeading.textContent = descriptorEditorMode === 'ignored'
    ? 'Ignored descriptors'
    : 'This page descriptors';
  const pageHeader = document.createElement('div');
  pageHeader.className = 'descriptor-page-header';
  pageHeader.append(pageHeading);
  pageSection.append(pageHeader);
  const classList = document.createElement('div');
  classList.className = 'descriptor-class-list';
  for (const descriptorClass of descriptorClasses()) {
    classList.append(descriptorEditorMode === 'ignored'
      ? renderIgnoredDescriptorClassEditor(descriptorClass)
      : renderDescriptorClassEditor(descriptorClass));
  }
  pageSection.append(classList);

  container.append(upperArea, pageSection);
  return container;
}

function pageMetaModalContent(runtime, type, options = {}) {
  if (type === 'category') {
    return {
      title: options.batch ? 'Batch Edit Category' : 'Page Category',
      body: () => renderCategoryEditor(runtime, options)
    };
  }

  if (type === 'descriptor') {
    return {
      title: 'Page Descriptor',
      body: () => renderDescriptorEditor({ runtime })
    };
  }

  return null;
}

function closePageMetaModal({ saved = false } = {}) {
  if (!pageMetaModal) return;
  const closingDescriptorContext = pageMetaModal.type === 'descriptor';
  const closingRuntime = pageMetaModal.runtime;

  descriptorDividerDragCleanup?.();
  closeDescriptorContextMenu();
  closeDescriptorGroupContextMenu();
  if (descriptorGroupRename) {
    if (descriptorGroupRename.isNew) delete descriptorGroupsConfig.groups[descriptorGroupRename.groupId];
    else if (descriptorGroupsConfig.groups[descriptorGroupRename.groupId]) {
      descriptorGroupsConfig.groups[descriptorGroupRename.groupId].name = descriptorGroupRename.previousName;
    }
  }
  descriptorGroupRename = null;
  descriptorGroupMoveMode = null;
  clearDescriptorGroupMoveTarget();
  descriptorGroupDragSelection = null;
  selectedDescriptorGroupItems.clear();
  if (closingDescriptorContext) {
    if (saved) undoManager.commitContext();
    else {
      if (originalDescriptorGroupsConfig) {
        descriptorGroupsConfig = cloneDescriptorUndoValue(originalDescriptorGroupsConfig);
      }
      undoManager.cancelContext();
    }
    originalDescriptorGroupsConfig = null;
  }
  document.removeEventListener('keydown', pageMetaModal.onKeyDown, true);
  document.removeEventListener('pointerdown', pageMetaModal.onPointerDown, true);
  window.removeEventListener('blur', pageMetaModal.onWindowBlur);
  pageMetaModal.overlay.remove();
  pageMetaModal.modal.remove();
  pageMetaModal = null;
  descriptorDraft = null;
  ignoredDescriptorDraft = null;
  ignoredManualEntryIdsDraft = null;
  descriptorDraftDirty = false;
  descriptorEditorMode = 'active';

  if (closingDescriptorContext) {
    if (closingRuntime === activePaneRuntime()) {
      renderRelations(
        closingRuntime,
        closingRuntime.currentPage || { blocks: [], backlinks: [] }
      );
    }
  }

  if (saved && runtimeIsLive(closingRuntime)) {
    showRuntimeStatus(closingRuntime, 'Saved', false, 1200);
  }
}

async function savePageMetaModal() {
  if (!pageMetaModal) return;
  const modalOwner = pageMetaModal;
  const runtime = modalOwner.runtime;
  const pageId = runtime?.currentPage?.id || null;

  if (modalOwner.type === 'descriptor') {
    if (!pageId) return;
    const operation = captureRuntimeOperation(runtime, {
      pageId,
      scope: 'descriptor-modal-save'
    });
    if (!operation) return;
    showRuntimeStatus(runtime, 'Saving…');
    try {
      const descriptorGroupsChanged = !transactionalValuesEqual(
        originalDescriptorGroupsConfig,
        descriptorGroupsConfig
      );
      const savedPage = await request(pageApiUrl(pageId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descriptors: descriptorDraft || emptyDescriptorDraft(),
          ignoredDescriptors: ignoredDescriptorDraft || emptyDescriptorDraft(),
          ignoredManualEntryIds: ignoredManualEntryIdsDraft || emptyDescriptorIdDraft(),
          ...(descriptorGroupsChanged ? { descriptorGroups: descriptorGroupsConfig } : {})
        })
      });

      const operationIsCurrent = runtimeOperationIsCurrent(operation);
      commitCanonicalPage(savedPage, {
        originRuntime: operationIsCurrent ? runtime : null
      });
      if (operationIsCurrent && pageMetaModal === modalOwner) {
        closePageMetaModal({ saved: true });
      }
    } catch (error) {
      if (runtimeOperationIsCurrent(operation) && pageMetaModal === modalOwner) {
        showRuntimeStatus(runtime, error.message, true);
      }
    }
    return;
  }

  if (modalOwner.type !== 'category') {
    closePageMetaModal({ saved: true });
    return;
  }

  if (modalOwner.mode === 'batch') {
    const pageIds = [...modalOwner.pageIds];
    const instructions = categoryBatch.instructionPayload(modalOwner.categoryInstructions);
    const operation = captureRuntimeOperation(runtime, {
      scope: 'category-batch-save'
    });
    if (!operation) return;
    showRuntimeStatus(runtime, 'Saving…');
    try {
      const result = await request('/api/pages/categories/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds, ...instructions })
      });

      const operationIsCurrent = runtimeOperationIsCurrent(operation);
      adoptCategoryCommandPages(result.pages || [], {
        originRuntime: operationIsCurrent ? runtime : null
      });
      navigation = result.navigation;
      renderPageList();
      if (operationIsCurrent && pageMetaModal === modalOwner) {
        closePageMetaModal({ saved: true });
      }
    } catch (error) {
      if (runtimeOperationIsCurrent(operation) && pageMetaModal === modalOwner) {
        showRuntimeStatus(runtime, error.message, true);
      }
    }
    return;
  }

  const categories = selectedCategoryIdsFromModal();
  if (!pageId) return;
  const operation = captureRuntimeOperation(runtime, {
    pageId,
    scope: 'category-modal-save'
  });
  if (!operation) return;
  showRuntimeStatus(runtime, 'Saving…');
  try {
    const savedPageResponse = await request(pageApiUrl(pageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories })
    });
    navigation = await request('/api/navigation');
    const operationIsCurrent = runtimeOperationIsCurrent(operation);
    adoptCategoryCommandPages([savedPageResponse], {
      originRuntime: operationIsCurrent ? runtime : null
    });
    renderPageList();
    if (operationIsCurrent && pageMetaModal === modalOwner) {
      closePageMetaModal({ saved: true });
    }
  } catch (error) {
    if (runtimeOperationIsCurrent(operation) && pageMetaModal === modalOwner) {
      showRuntimeStatus(runtime, error.message, true);
    }
  }
}

function openPageMetaModal(runtime, type, options = {}) {
  if (runtime !== activePaneRuntime()) return;
  const pageIds = type === 'category'
    ? categoryBatch.normalizeStableIds(options.pageIds)
    : [];
  const batch = type === 'category' && pageIds.length > 1;
  const categoryInstructions = new Map();
  const content = pageMetaModalContent(runtime, type, {
    batch,
    instructions: categoryInstructions
  });
  if (!content || (!runtime?.currentPage && !batch)) return;

  if (typeof closeNavigationSortMenu === 'function') closeNavigationSortMenu();
  if (typeof closeNavigationMoveMenu === 'function') closeNavigationMoveMenu();

  if (runtime.blockEditMode || runtime.pageEditMode) {
    showRuntimeStatus(
      runtime,
      'Finish the current edit mode before editing page metadata.',
      true,
      2400
    );
    setEditMenuOpen(runtime, false);
    return;
  }

  closePageMetaModal();
  if (type === 'descriptor') {
    originalDescriptorGroupsConfig = cloneDescriptorUndoValue(descriptorGroupsConfig);
    descriptorGroupsConfig = cloneDescriptorUndoValue(descriptorGroupsConfig);
    undoManager.beginContext({
      id: `descriptor-edit:${runtime.currentPage.id}`,
      type: 'descriptor-edit',
      ownerId: runtime.currentPage.id
    });
    descriptorEditorMode = 'active';
    descriptorDraftDirty = false;
    staleIgnoredDescriptorKeys = null;
  }
  closeAddLinkPopover(runtime);
  closePageContextMenu();
  closeFolderContextMenu();
  closeRelationContextMenu();
  closeResourceContextMenu();
  closeDescriptorContextMenu();
  closeDescriptorGroupContextMenu();
  setEditMenuOpen(runtime, false);

  const overlay = document.createElement('div');
  overlay.className = 'forced-modal-overlay';
  overlay.setAttribute('aria-hidden', 'true');

  const modal = document.createElement('section');
  modal.className = 'forced-modal';
  modal.dataset.modalType = type;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'page-meta-modal-title');
  modal.tabIndex = -1;

  const title = document.createElement('h2');
  title.id = 'page-meta-modal-title';
  title.textContent = content.title;

  const body = document.createElement('div');
  body.className = 'forced-modal-body';
  if (typeof content.body === 'function') body.append(content.body());
  else body.textContent = content.body;

  const actions = document.createElement('div');
  actions.className = 'forced-modal-actions';

  const leftActions = document.createElement('div');
  leftActions.className = 'forced-modal-actions-left';
  const rightActions = document.createElement('div');
  rightActions.className = 'forced-modal-actions-right';

  if (type === 'descriptor') {
    const ignoredButton = document.createElement('button');
    ignoredButton.type = 'button';
    ignoredButton.className = 'descriptor-ignored-toggle ui-solid-action ui-primary-action';
    ignoredButton.dataset.descriptorIgnoredToggle = '';
    ignoredButton.textContent = 'Ignored';
    ignoredButton.setAttribute('aria-pressed', 'false');
    ignoredButton.addEventListener('click', () => {
      descriptorEditorMode = descriptorEditorMode === 'ignored' ? 'active' : 'ignored';
      rerenderDescriptorEditor(null, { preserveInputs: true });
    });
    leftActions.append(ignoredButton);
  }

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'ui-outline-action ui-cancel-action';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', () => closePageMetaModal());

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'ui-solid-action ui-primary-action';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', savePageMetaModal);

  rightActions.append(cancelButton, saveButton);
  actions.append(leftActions, rightActions);
  modal.append(title, body, actions);

  const onKeyDown = (event) => {
    if (event.key === 'Enter'
      && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
        event,
        event.target
      )) return;
    if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)) return;
    if (event.target instanceof HTMLInputElement
      && event.target.classList.contains('descriptor-group-rename-input')) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (descriptorGroupMoveMode) {
        cancelDescriptorGroupMoveMode();
        return;
      }
      closePageMetaModal();
    }

    if (event.key === 'Enter') {
      if (pageMetaModal?.type === 'descriptor'
        && event.target instanceof HTMLInputElement
        && event.target.classList.contains('descriptor-input')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      savePageMetaModal();
    }
  };
  const onPointerDown = (event) => {
    if (!descriptorGroupMoveMode) return;
    const groupedPane = modal.querySelector('.descriptor-browser-pane.grouped');
    if (groupedPane?.contains(event.target)) return;
    cancelDescriptorGroupMoveMode();
  };
  const onWindowBlur = () => {
    if (descriptorGroupMoveMode) cancelDescriptorGroupMoveMode();
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('blur', onWindowBlur);

  document.body.append(overlay, modal);
  pageMetaModal = {
    runtime,
    token: captureRuntimeOperation(runtime, {
      scope: 'page-meta-modal',
      requireMount: false
    }),
    type,
    mode: batch ? 'batch' : 'single',
    pageIds: batch ? pageIds : [],
    categoryInstructions,
    overlay,
    modal,
    onKeyDown,
    onPointerDown,
    onWindowBlur
  };
  modal.focus();
  if (type === 'descriptor') {
    refreshStaleIgnoredDescriptors().then(() => {
      if (pageMetaModal?.modal === modal) rerenderDescriptorEditor(null, { preserveInputs: true });
    });
  }
}
