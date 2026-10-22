(function exposeHnPageDocumentSessionModel(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const api = factory(isCommonJs ? require('../hnText') : root?.hnTextModel);
  if (isCommonJs) module.exports = api;
  if (root) root.hnPageDocumentSessionModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (hnTextModel) => {
  'use strict';

  if (!hnTextModel) throw new Error('HN Text source sessions require hnTextModel.');

  const SELECTION_AFFINITIES = Object.freeze({
    BEFORE: 'before',
    AFTER: 'after',
    // Kept as semantic aliases for older callers while source projections use
    // the shared before/after vocabulary.
    BACKWARD: 'before',
    FORWARD: 'after'
  });

  function integerRevision(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function clamp(value, lower, upper) {
    const finite = Number.isFinite(Number(value)) ? Number(value) : lower;
    return Math.min(upper, Math.max(lower, finite));
  }

  function selectionOffset(value, fallback = 0) {
    return Number.isFinite(Number(value?.offset)) ? Number(value.offset)
      : Number.isFinite(Number(value)) ? Number(value)
        : fallback;
  }

  function selectionAffinity(value, fallback = SELECTION_AFFINITIES.AFTER) {
    const candidate = typeof value === 'string' ? value : value?.affinity;
    if (candidate === 'before' || candidate === 'backward') {
      return SELECTION_AFFINITIES.BEFORE;
    }
    if (candidate === 'after' || candidate === 'forward') {
      return SELECTION_AFFINITIES.AFTER;
    }
    return fallback;
  }

  function normalizeSelection(source, value = null, fallback = 0) {
    const length = typeof source === 'string' ? source.length : 0;
    const anchorInput = value?.anchor ?? value?.start ?? fallback;
    const focusInput = value?.focus ?? value?.end ?? anchorInput;
    return Object.freeze({
      anchor: clamp(selectionOffset(anchorInput, fallback), 0, length),
      focus: clamp(selectionOffset(focusInput, selectionOffset(anchorInput, fallback)), 0, length),
      anchorAffinity: selectionAffinity(
        value?.anchorAffinity ?? anchorInput,
        SELECTION_AFFINITIES.AFTER
      ),
      focusAffinity: selectionAffinity(
        value?.focusAffinity ?? focusInput,
        SELECTION_AFFINITIES.AFTER
      )
    });
  }

  function normalizeUnboundedSelection(value = null, fallback = 0) {
    const anchorInput = value?.anchor ?? value?.start ?? fallback;
    const focusInput = value?.focus ?? value?.end ?? anchorInput;
    return Object.freeze({
      anchor: clamp(selectionOffset(anchorInput, fallback), 0, Number.MAX_SAFE_INTEGER),
      focus: clamp(
        selectionOffset(focusInput, selectionOffset(anchorInput, fallback)),
        0,
        Number.MAX_SAFE_INTEGER
      ),
      anchorAffinity: selectionAffinity(
        value?.anchorAffinity ?? anchorInput,
        SELECTION_AFFINITIES.AFTER
      ),
      focusAffinity: selectionAffinity(
        value?.focusAffinity ?? focusInput,
        SELECTION_AFFINITIES.AFTER
      )
    });
  }

  function cloneSelection(selection) {
    return selection ? { ...selection } : null;
  }

  function createPaneLocalState(value = {}) {
    return {
      // The source is session-owned and may not be available when a living Tab
      // restores its view state. Preserve numeric offsets here; subscribe()
      // clamps them once against the authoritative source.
      selection: normalizeUnboundedSelection(
        value.selection ?? value.selectionBookmark ?? null
      ),
      focused: value.focused === true,
      camera: value.camera && typeof value.camera === 'object'
        ? { ...value.camera } : null
    };
  }

  function acknowledgedRevision(response) {
    return integerRevision(response?.cneText?.revision)
      ?? integerRevision(response?.page?.cneText?.revision)
      ?? integerRevision(response?.revision);
  }

  function staleRevisionError(error) {
    return error?.code === 'STALE_CNE_REVISION'
      || error?.status === 409
      || error?.statusCode === 409
      || error?.response?.status === 409
      || error?.body?.error?.code === 'STALE_CNE_REVISION';
  }

  function conflictDiagnostic(error) {
    return Object.freeze({
      code: error?.code || error?.body?.error?.code || 'STALE_CNE_REVISION',
      status: error?.status || error?.statusCode || error?.response?.status || 409,
      message: error?.message || 'HN Text has a stale persisted revision.'
    });
  }

  function cloneMigrationFailure(value) {
    if (!value) return null;
    return Object.freeze({
      error: value.error,
      errors: Object.freeze((value.errors || []).map((entry) => Object.freeze({ ...entry }))),
      legacyEnvelope: hnTextModel.cloneJson(value.legacyEnvelope)
    });
  }

  function normalizeCoreTransaction(source, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('HN source transactions require { from, to, insert }.');
    }
    const extras = Object.keys(value).filter((key) => !['from', 'to', 'insert'].includes(key));
    if (extras.length) {
      throw new TypeError(`HN source transactions contain unsupported fields: ${extras.join(', ')}.`);
    }
    const { from, to, insert } = value;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)
      || from < 0 || to < from || to > source.length) {
      throw new RangeError('HN source transaction offsets are outside the canonical source.');
    }
    if (typeof insert !== 'string') {
      throw new TypeError('HN source transaction insert must be a string.');
    }
    return Object.freeze({ from, to, insert });
  }

  function mapOffset(offset, affinity, transaction) {
    const { from, to, insert } = transaction;
    const delta = insert.length - (to - from);
    if (offset < from) return offset;
    if (offset > to) return offset + delta;
    if (from === to) {
      return affinity === SELECTION_AFFINITIES.BEFORE ? from : from + insert.length;
    }
    if (offset === from) return from;
    if (offset === to) return from + insert.length;
    return affinity === SELECTION_AFFINITIES.BEFORE ? from : from + insert.length;
  }

  function mapSelection(selection, transaction, nextSource) {
    return normalizeSelection(nextSource, {
      anchor: mapOffset(selection.anchor, selection.anchorAffinity, transaction),
      focus: mapOffset(selection.focus, selection.focusAffinity, transaction),
      anchorAffinity: selection.anchorAffinity,
      focusAffinity: selection.focusAffinity
    });
  }

  function snapshotPaneSelections(paneStates) {
    const result = new Map();
    for (const [viewId, paneState] of paneStates) {
      result.set(viewId, cloneSelection(paneState.selection));
    }
    return result;
  }

  function restorePaneSelections(paneStates, stored, source) {
    for (const [viewId, paneState] of paneStates) {
      paneState.selection = normalizeSelection(source, stored.get(viewId) || paneState.selection);
    }
  }

  class HnPageDocumentSession {
    constructor({
      pageId,
      cneText,
      save,
      saveDelayMs = 120,
      onDocumentChange = null,
      onSourceChange = null,
      onPersisted = null,
      onError = null
    } = {}) {
      if (typeof pageId !== 'string' || !pageId) {
        throw new TypeError('HN Page source sessions require a Page ID.');
      }
      if (typeof save !== 'function') {
        throw new TypeError('HN Page source sessions require a revisioned save callback.');
      }
      const persisted = hnTextModel.validatePersistedEnvelope(cneText);
      if (!persisted.ok) {
        throw new TypeError(persisted.error || 'Invalid persisted HN Text content.');
      }
      const migration = hnTextModel.migrateLegacyEnvelope(cneText);
      const migratedEnvelope = migration.ok ? migration.value : null;
      this.pageId = pageId;
      this.schemaVersion = migratedEnvelope?.schemaVersion ?? cneText.schemaVersion;
      this.revision = migratedEnvelope?.revision ?? cneText.revision;
      this.source = migration.ok ? migratedEnvelope.source : null;
      this.anchors = migration.ok ? hnTextModel.cloneJson(migratedEnvelope.anchors) : null;
      this.legacyMigrated = migration.ok && migration.legacy === true;
      this.legacySchemaVersion = migration.ok ? migration.legacySchemaVersion ?? null
        : cneText.schemaVersion;
      this.migrationFailure = migration.ok ? null : cloneMigrationFailure(migration);
      this.save = save;
      this.saveDelayMs = Math.max(0, Number(saveDelayMs) || 0);
      this.onDocumentChange = typeof onDocumentChange === 'function' ? onDocumentChange
        : typeof onSourceChange === 'function' ? onSourceChange : null;
      this.onPersisted = typeof onPersisted === 'function' ? onPersisted : null;
      this.onError = typeof onError === 'function' ? onError : null;
      this.subscribers = new Map();
      this.paneStates = new Map();
      this.viewReferenceIds = new Map();
      this.references = new Set();
      this.focusedViewId = null;
      this.sourceVersion = 0;
      this.undoStack = [];
      this.redoStack = [];
      this.documentGeneration = 0;
      this.persistedGeneration = 0;
      this.saveTimer = null;
      this.saveLoopPromise = null;
      this.lastSaveError = null;
      this.conflict = null;
      this.conversionLocked = false;
      this.disposed = false;
      this.mountEpoch = 0;
    }

    assertLive() {
      if (this.disposed) throw new Error(`HN Page session is disposed: ${this.pageId}.`);
    }

    get referenceCount() {
      return this.references.size;
    }

    get subscriberCount() {
      return this.subscribers.size;
    }

    get retainedPaneStateCount() {
      return this.paneStates.size;
    }

    get historyDepth() {
      return Object.freeze({ undo: this.undoStack.length, redo: this.redoStack.length });
    }

    get saveStatus() {
      return Object.freeze({
        dirty: this.persistedGeneration < this.documentGeneration,
        saving: Boolean(this.saveLoopPromise),
        revision: this.revision,
        sourceVersion: this.sourceVersion,
        documentGeneration: this.documentGeneration,
        persistedGeneration: this.persistedGeneration,
        conflicted: Boolean(this.conflict),
        conversionLocked: this.conversionLocked,
        migrationFailed: Boolean(this.migrationFailure),
        readOnly: Boolean(this.conflict) || this.conversionLocked || Boolean(this.migrationFailure),
        conflict: this.conflict,
        migrationFailure: this.migrationFailure,
        error: this.lastSaveError
      });
    }

    currentEnvelope() {
      if (this.migrationFailure) {
        return hnTextModel.cloneJson(this.migrationFailure.legacyEnvelope);
      }
      return {
        schemaVersion: hnTextModel.HN_SCHEMA_VERSION,
        revision: this.revision,
        source: this.source,
        anchors: hnTextModel.cloneJson(this.anchors)
      };
    }

    currentSnapshot() {
      return Object.freeze({
        pageId: this.pageId,
        schemaVersion: this.schemaVersion,
        revision: this.revision,
        source: this.source,
        anchors: this.anchors ? Object.freeze(hnTextModel.cloneJson(this.anchors)) : null,
        sourceVersion: this.sourceVersion,
        legacyMigrated: this.legacyMigrated,
        legacySchemaVersion: this.legacySchemaVersion,
        readOnly: this.saveStatus.readOnly,
        conflict: this.conflict,
        conversionLocked: this.conversionLocked,
        migrationFailure: this.migrationFailure
      });
    }

    diagnostics() {
      return Object.freeze({
        pageId: this.pageId,
        revision: this.revision,
        sourceVersion: this.sourceVersion,
        subscriberCount: this.subscriberCount,
        referenceCount: this.referenceCount,
        retainedPaneStateCount: this.retainedPaneStateCount,
        focusedViewId: this.focusedViewId,
        mountEpoch: this.mountEpoch,
        historyDepth: this.historyDepth,
        saveStatus: this.saveStatus
      });
    }

    retain(referenceId) {
      this.assertLive();
      if (typeof referenceId !== 'string' || !referenceId) {
        throw new TypeError('HN Page session references require a stable ID.');
      }
      this.references.add(referenceId);
      const conventionalViewId = `${referenceId}:${this.pageId}`;
      if (!this.viewReferenceIds.has(conventionalViewId)) {
        this.viewReferenceIds.set(conventionalViewId, referenceId);
      }
      return this.referenceCount;
    }

    release(referenceId) {
      this.references.delete(referenceId);
      for (const [viewId, ownerReferenceId] of this.viewReferenceIds) {
        if (ownerReferenceId !== referenceId) continue;
        this.viewReferenceIds.delete(viewId);
        this.paneStates.delete(viewId);
      }
      return this.referenceCount;
    }

    bindViewReference(viewId, referenceId) {
      this.assertLive();
      if (typeof viewId !== 'string' || !viewId
        || typeof referenceId !== 'string' || !this.references.has(referenceId)) {
        throw new TypeError('HN view state must bind to a retained Tab reference.');
      }
      this.viewReferenceIds.set(viewId, referenceId);
      return true;
    }

    paneStateForView(viewId) {
      return this.paneStates.get(viewId) || null;
    }

    selectionForView(viewId) {
      const paneState = this.paneStates.get(viewId);
      return paneState ? Object.freeze(cloneSelection(paneState.selection)) : null;
    }

    subscribe(viewId, subscriber) {
      this.assertLive();
      if (typeof viewId !== 'string' || !viewId || typeof subscriber?.updateState !== 'function') {
        throw new TypeError('HN session subscribers require viewId and updateState().');
      }
      if (this.subscribers.has(viewId)) {
        throw new Error(`HN view is already subscribed: ${viewId}.`);
      }
      if (subscriber.referenceId) this.bindViewReference(viewId, subscriber.referenceId);
      const paneState = this.paneStates.get(viewId)
        || subscriber.paneState
        || createPaneLocalState();
      paneState.selection = normalizeSelection(this.source || '', paneState.selection);
      paneState.focused = paneState.focused === true;
      this.paneStates.set(viewId, paneState);
      const record = { ...subscriber, paneState };
      this.subscribers.set(viewId, record);
      this.mountEpoch += 1;
      record.updateState(this.currentSnapshot(), Object.freeze({
        reason: 'subscribe',
        pageId: this.pageId,
        originViewId: null,
        transaction: null,
        sourceVersionBefore: this.sourceVersion,
        sourceVersionAfter: this.sourceVersion,
        inputType: null,
        compositionId: null,
        historyAction: null
      }));
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        const removed = this.subscribers.delete(viewId);
        if (this.focusedViewId === viewId) this.focusedViewId = null;
        record.paneState.focused = false;
        if (removed) record.onDispose?.();
        return removed;
      };
    }

    captureSelection(viewId, selection = null) {
      const record = this.subscribers.get(viewId);
      if (!record || this.focusedViewId !== viewId) return false;
      record.paneState.selection = normalizeSelection(this.source || '', selection);
      return true;
    }

    setFocusedView(viewId, { restore = true } = {}) {
      this.assertLive();
      const incoming = this.subscribers.get(viewId);
      if (!incoming) throw new Error(`Unknown HN view: ${viewId}.`);
      const outgoingId = this.focusedViewId;
      if (outgoingId && outgoingId !== viewId) {
        const outgoing = this.subscribers.get(outgoingId);
        if (outgoing) outgoing.paneState.focused = false;
      }
      this.focusedViewId = viewId;
      incoming.paneState.focused = true;
      return restore ? this.restoreSelection(viewId) : true;
    }

    clearFocusedView(viewId) {
      this.assertLive();
      if (this.focusedViewId !== viewId) return false;
      const outgoing = this.subscribers.get(viewId);
      if (outgoing) outgoing.paneState.focused = false;
      this.focusedViewId = null;
      this.publish('blur', viewId);
      return true;
    }

    restoreSelection(viewId) {
      const record = this.subscribers.get(viewId);
      if (!record || this.focusedViewId !== viewId) return null;
      record.paneState.selection = normalizeSelection(this.source || '', record.paneState.selection);
      return Object.freeze(cloneSelection(record.paneState.selection));
    }

    publish(reason, originViewId, detail = {}) {
      const metadata = Object.freeze({
        reason,
        pageId: this.pageId,
        originViewId,
        transaction: detail.transaction || null,
        sourceVersionBefore: detail.sourceVersionBefore ?? this.sourceVersion,
        sourceVersionAfter: detail.sourceVersionAfter ?? this.sourceVersion,
        inputType: detail.inputType || null,
        compositionId: detail.compositionId || null,
        historyAction: detail.historyAction || null
      });
      const snapshot = this.currentSnapshot();
      for (const record of this.subscribers.values()) record.updateState(snapshot, metadata);
    }

    setConversionLocked(locked) {
      this.assertLive();
      const next = Boolean(locked);
      if (this.conversionLocked === next) return false;
      this.conversionLocked = next;
      this.publish('conversion-lock', null);
      return true;
    }

    assertMutable() {
      if (this.migrationFailure) {
        const error = new Error(this.migrationFailure.error || 'Unsupported legacy CNE Text content.');
        error.code = 'HN_SESSION_UNSUPPORTED_LEGACY';
        error.migrationFailure = this.migrationFailure;
        throw error;
      }
      if (this.conversionLocked) {
        const error = new Error(
          `HN source edits are frozen during Page Type conversion: ${this.pageId}.`
        );
        error.code = 'HN_SESSION_CONVERSION_LOCKED';
        throw error;
      }
      if (this.conflict) {
        const error = new Error(
          `HN source edits are frozen after a stale revision conflict: ${this.pageId}.`
        );
        error.code = 'HN_SESSION_CONFLICTED';
        error.status = this.conflict.status;
        error.conflict = this.conflict;
        throw error;
      }
    }

    recordHistory(entry, { compositionId = null } = {}) {
      const previous = this.undoStack[this.undoStack.length - 1];
      if (compositionId && previous
        && previous.compositionId === compositionId
        && previous.originViewId === entry.originViewId
        && previous.afterSource === entry.beforeSource) {
        previous.afterSource = entry.afterSource;
        previous.afterSelections = entry.afterSelections;
        previous.sourceVersionAfter = entry.sourceVersionAfter;
        previous.transactions.push(...entry.transactions);
      } else {
        this.undoStack.push(entry);
      }
      this.redoStack.length = 0;
    }

    applySourceTransaction(viewId, transactionValue, options = {}) {
      this.assertLive();
      if (!this.subscribers.has(viewId)) throw new Error(`Unknown HN view: ${viewId}.`);
      if (this.focusedViewId !== viewId) {
        throw new Error(`HN source transaction rejected from inactive view: ${viewId}.`);
      }
      this.assertMutable();
      if (options.sourceVersion !== undefined && options.sourceVersion !== this.sourceVersion) {
        const error = new Error('HN source transaction was not created from the authoritative Page source.');
        error.code = 'HN_SESSION_STALE_SOURCE';
        error.expectedSourceVersion = this.sourceVersion;
        error.receivedSourceVersion = options.sourceVersion;
        throw error;
      }
      const transaction = normalizeCoreTransaction(this.source, transactionValue);
      const sourceVersionBefore = this.sourceVersion;
      const beforeSource = this.source;
      const beforeSelections = snapshotPaneSelections(this.paneStates);
      const nextSource = beforeSource.slice(0, transaction.from)
        + transaction.insert
        + beforeSource.slice(transaction.to);
      if (nextSource === beforeSource) {
        if (options.selection) this.captureSelection(viewId, options.selection);
        this.publish('selection', viewId, {
          transaction,
          sourceVersionBefore,
          sourceVersionAfter: sourceVersionBefore,
          inputType: options.inputType,
          compositionId: options.compositionId
        });
        return Object.freeze({
          changed: false,
          source: this.source,
          sourceVersion: this.sourceVersion,
          transaction
        });
      }
      for (const paneState of this.paneStates.values()) {
        paneState.selection = mapSelection(paneState.selection, transaction, nextSource);
      }
      const origin = this.paneStates.get(viewId);
      origin.selection = options.selection
        ? normalizeSelection(nextSource, options.selection, transaction.from + transaction.insert.length)
        : normalizeSelection(nextSource, {
          anchor: transaction.from + transaction.insert.length,
          focus: transaction.from + transaction.insert.length
        });
      this.source = nextSource;
      this.sourceVersion += 1;
      const afterSelections = snapshotPaneSelections(this.paneStates);
      const historyEntry = {
        beforeSource,
        afterSource: nextSource,
        beforeSelections,
        afterSelections,
        originViewId: viewId,
        sourceVersionBefore,
        sourceVersionAfter: this.sourceVersion,
        inputType: options.inputType || 'insertText',
        compositionId: options.compositionId || null,
        transactions: [transaction]
      };
      if (options.addToHistory !== false) {
        this.recordHistory(historyEntry, { compositionId: options.compositionId || null });
      } else {
        this.redoStack.length = 0;
      }
      this.documentGeneration += 1;
      this.publish('source', viewId, {
        transaction,
        sourceVersionBefore,
        sourceVersionAfter: this.sourceVersion,
        inputType: options.inputType,
        compositionId: options.compositionId
      });
      const cneText = this.currentEnvelope();
      this.onDocumentChange?.(Object.freeze({
        pageId: this.pageId,
        cneText: hnTextModel.cloneJson(cneText),
        snapshot: this.currentSnapshot(),
        source: this.source,
        sourceVersion: this.sourceVersion,
        originViewId: viewId,
        transaction
      }));
      this.scheduleSave();
      return Object.freeze({
        changed: true,
        source: this.source,
        sourceVersion: this.sourceVersion,
        transaction
      });
    }

    applyHistory(viewId, direction) {
      this.assertLive();
      if (this.focusedViewId !== viewId || (direction !== 'undo' && direction !== 'redo')) return false;
      if (this.saveStatus.readOnly) return false;
      const sourceStack = direction === 'undo' ? this.undoStack : this.redoStack;
      const targetStack = direction === 'undo' ? this.redoStack : this.undoStack;
      const entry = sourceStack[sourceStack.length - 1];
      const expectedSource = direction === 'undo' ? entry?.afterSource : entry?.beforeSource;
      if (!entry || expectedSource !== this.source) return false;
      sourceStack.pop();
      targetStack.push(entry);
      const sourceVersionBefore = this.sourceVersion;
      this.source = direction === 'undo' ? entry.beforeSource : entry.afterSource;
      restorePaneSelections(
        this.paneStates,
        direction === 'undo' ? entry.beforeSelections : entry.afterSelections,
        this.source
      );
      this.sourceVersion += 1;
      this.documentGeneration += 1;
      this.publish('history', viewId, {
        sourceVersionBefore,
        sourceVersionAfter: this.sourceVersion,
        inputType: direction === 'undo' ? 'historyUndo' : 'historyRedo',
        compositionId: entry.compositionId,
        historyAction: direction
      });
      const cneText = this.currentEnvelope();
      this.onDocumentChange?.(Object.freeze({
        pageId: this.pageId,
        cneText: hnTextModel.cloneJson(cneText),
        snapshot: this.currentSnapshot(),
        source: this.source,
        sourceVersion: this.sourceVersion,
        originViewId: viewId,
        transaction: null,
        historyAction: direction
      }));
      this.scheduleSave();
      return true;
    }

    undo(viewId) {
      return this.applyHistory(viewId, 'undo');
    }

    redo(viewId) {
      return this.applyHistory(viewId, 'redo');
    }

    scheduleSave() {
      if (this.saveTimer !== null || this.disposed || this.migrationFailure) return;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        void this.drainSaveQueue().catch((error) => {
          this.lastSaveError = error;
          this.onError?.(error);
        });
      }, this.saveDelayMs);
      this.saveTimer.unref?.();
    }

    async drainSaveQueue() {
      if (this.migrationFailure) return this.currentEnvelope();
      if (this.conflict) {
        const error = this.lastSaveError || new Error(this.conflict.message);
        error.code ||= this.conflict.code;
        error.status ||= this.conflict.status;
        error.pageId ||= this.pageId;
        throw error;
      }
      if (this.saveLoopPromise) return this.saveLoopPromise;
      const run = async () => {
        while (this.persistedGeneration < this.documentGeneration) {
          const generation = this.documentGeneration;
          const baseRevision = this.revision;
          const cneText = this.currentEnvelope();
          let response;
          try {
            response = await this.save(Object.freeze({
              pageId: this.pageId,
              baseRevision,
              cneText: hnTextModel.cloneJson(cneText)
            }));
          } catch (error) {
            error.pageId ||= this.pageId;
            this.lastSaveError = error;
            if (staleRevisionError(error)) {
              this.conflict = conflictDiagnostic(error);
              this.publish('conflict', null);
            }
            throw error;
          }
          const revision = acknowledgedRevision(response);
          if (revision !== baseRevision + 1) {
            const error = new Error(
              `HN save acknowledgement must advance revision ${baseRevision} to ${baseRevision + 1}.`
            );
            error.pageId = this.pageId;
            throw error;
          }
          this.revision = revision;
          this.schemaVersion = hnTextModel.HN_SCHEMA_VERSION;
          this.persistedGeneration = generation;
          this.lastSaveError = null;
          this.legacyMigrated = false;
          this.legacySchemaVersion = null;
          this.publish('persisted', null);
          this.onPersisted?.(Object.freeze({
            pageId: this.pageId,
            revision,
            generation,
            response
          }));
        }
        return this.currentEnvelope();
      };
      this.saveLoopPromise = run().finally(() => {
        this.saveLoopPromise = null;
      });
      return this.saveLoopPromise;
    }

    async flush() {
      this.assertLive();
      if (this.saveTimer !== null) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      if (!this.migrationFailure
        && (this.persistedGeneration < this.documentGeneration || this.saveLoopPromise)) {
        await this.drainSaveQueue();
      }
      return this.currentEnvelope();
    }

    async dispose({ flush = true } = {}) {
      if (this.disposed) return;
      if (flush) await this.flush();
      if (this.saveTimer !== null) clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.disposed = true;
      for (const record of this.subscribers.values()) record.onDispose?.();
      this.subscribers.clear();
      this.paneStates.clear();
      this.viewReferenceIds.clear();
      this.references.clear();
      this.focusedViewId = null;
      this.conversionLocked = false;
    }
  }

  class HnPageDocumentSessionRegistry {
    constructor(options = {}) {
      this.options = { ...options };
      this.sessions = new Map();
    }

    get(pageId) {
      return this.sessions.get(pageId) || null;
    }

    acquire(pageId, cneText, { referenceId, ...options } = {}) {
      let session = this.sessions.get(pageId);
      if (!session) {
        session = new HnPageDocumentSession({
          ...this.options,
          ...options,
          pageId,
          cneText
        });
        this.sessions.set(pageId, session);
      }
      if (referenceId) session.retain(referenceId);
      return session;
    }

    async release(pageId, referenceId) {
      const session = this.sessions.get(pageId);
      if (!session) return false;
      session.release(referenceId);
      if (session.referenceCount > 0) return false;
      await session.flush();
      if (session.referenceCount > 0) return false;
      await session.dispose({ flush: false });
      if (this.sessions.get(pageId) === session) this.sessions.delete(pageId);
      return true;
    }

    async flushAll() {
      return Promise.all([...this.sessions.values()].map((session) => session.flush()));
    }

    async disposeAll() {
      const sessions = [...this.sessions.values()];
      await Promise.all(sessions.map((session) => session.dispose()));
      this.sessions.clear();
    }

    async discard(pageId, { flush = false } = {}) {
      const session = this.sessions.get(pageId);
      if (!session) return false;
      if (this.sessions.get(pageId) === session) this.sessions.delete(pageId);
      await session.dispose({ flush });
      return true;
    }
  }

  function createHnPageDocumentSession(options) {
    return new HnPageDocumentSession(options);
  }

  function createHnPageDocumentSessionRegistry(options) {
    return new HnPageDocumentSessionRegistry(options);
  }

  return Object.freeze({
    SELECTION_AFFINITIES,
    normalizeSelection,
    createPaneLocalState,
    staleRevisionError,
    HnPageDocumentSession,
    createHnPageDocumentSession,
    HnPageDocumentSessionRegistry,
    createHnPageDocumentSessionRegistry
  });
}));
