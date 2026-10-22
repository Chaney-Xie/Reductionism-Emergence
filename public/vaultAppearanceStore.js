(function initVaultAppearanceStore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.vaultAppearanceStoreModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_ENDPOINT = '/api/appearance';

  function cloneJson(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    return Object.freeze(value);
  }

  function sameJson(first, second) {
    return first === second || JSON.stringify(first) === JSON.stringify(second);
  }

  function createHttpAppearancePersistence(request, endpointOrOptions = DEFAULT_ENDPOINT) {
    if (typeof request !== 'function') {
      throw new TypeError('Appearance HTTP persistence requires a request function.');
    }
    const endpoint = typeof endpointOrOptions === 'string'
      ? endpointOrOptions
      : endpointOrOptions?.endpoint || DEFAULT_ENDPOINT;
    return Object.freeze({
      persist(appearance) {
        return request(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appearance)
        });
      },
      refetch() {
        return request(endpoint);
      }
    });
  }

  function createVaultAppearanceStore(options = {}) {
    const model = options.model;
    const persistence = options.persistence || {};
    const persist = options.persist || persistence.persist;
    const refetch = options.refetch || persistence.refetch;
    const notifyCommitted = options.notifyCommitted;
    const logger = options.logger;

    if (typeof model?.normalizeAppearanceSettings !== 'function'
      || typeof model?.validateAppearanceSettings !== 'function') {
      throw new TypeError('VaultAppearanceStore requires the Appearance settings model.');
    }
    if (typeof persist !== 'function') {
      throw new TypeError('VaultAppearanceStore requires one ordinary persistence function.');
    }
    if (typeof refetch !== 'function') {
      throw new TypeError('VaultAppearanceStore requires one canonical refetch function.');
    }

    function reportIsolatedError(message, error) {
      try {
        logger?.error?.(message, error);
      } catch {
        // Diagnostics must never become another store failure owner.
      }
    }

    function freezeNormalized(value) {
      const normalized = model.normalizeAppearanceSettings(value);
      const validation = model.validateAppearanceSettings(normalized);
      if (!validation?.ok) {
        throw new TypeError(validation?.error || 'Appearance settings are invalid.');
      }
      return deepFreeze(cloneJson(validation.appearance || normalized));
    }

    function freezeAuthoritativeResponse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Appearance persistence returned no authoritative Appearance document.');
      }
      return freezeNormalized(value);
    }

    function reduceSnapshot(base, reducer) {
      const draft = cloneJson(base);
      const returned = reducer(draft);
      if (returned && typeof returned.then === 'function') {
        throw new TypeError('Appearance intent reducers must be synchronous.');
      }
      const candidate = returned === undefined ? draft : returned;
      const validation = model.validateAppearanceSettings(candidate);
      if (!validation?.ok) {
        throw new TypeError(validation?.error || 'Appearance intent produced invalid settings.');
      }
      return deepFreeze(cloneJson(
        validation.appearance || model.normalizeAppearanceSettings(candidate)
      ));
    }

    let authoritative = freezeNormalized(options.initialAppearance);
    let current = authoritative;
    let generation = 0;
    let nextIntentId = 0;
    let outstandingOperations = 0;
    let tail = Promise.resolve();
    let notificationPending = false;
    let notificationMeta = null;
    const intents = [];
    const subscribers = new Set();

    function metadata(extra = {}) {
      return Object.freeze({
        generation,
        pendingIntentCount: intents.length,
        ...extra
      });
    }

    function emit(snapshot, meta) {
      for (const subscriber of [...subscribers]) {
        try {
          subscriber(snapshot, meta);
        } catch (error) {
          reportIsolatedError('Vault Appearance subscriber failed.', error);
        }
      }
    }

    function installCurrent(next, details = {}, force = false) {
      if (!force && sameJson(current, next)) return false;
      current = next;
      generation += 1;
      emit(current, metadata(details));
      return true;
    }

    function replayPendingIntents(base) {
      return intents.reduce(
        (snapshot, entry) => reduceSnapshot(snapshot, entry.reducer),
        base
      );
    }

    function removeIntent(entry) {
      const index = intents.indexOf(entry);
      if (index >= 0) intents.splice(index, 1);
    }

    function markNotification(details) {
      notificationPending = true;
      notificationMeta = details;
    }

    function publishCommittedIfQuiescent() {
      if (!notificationPending || outstandingOperations !== 0 || intents.length !== 0) return;
      notificationPending = false;
      const details = metadata({
        ...(notificationMeta || {}),
        reason: 'committed',
        authoritative: true
      });
      notificationMeta = null;
      if (typeof notifyCommitted !== 'function') return;
      try {
        const result = notifyCommitted(current, details);
        result?.catch?.((error) => {
          reportIsolatedError('Vault Appearance committed notification failed.', error);
        });
      } catch (error) {
        reportIsolatedError('Vault Appearance committed notification failed.', error);
      }
    }

    function enqueue(executor) {
      outstandingOperations += 1;
      const operation = tail.then(executor);
      tail = operation.then(
        () => {
          outstandingOperations -= 1;
          publishCommittedIfQuiescent();
        },
        () => {
          outstandingOperations -= 1;
          publishCommittedIfQuiescent();
        }
      );
      return operation;
    }

    async function recoverAfterFailure(entry, details) {
      if (entry) removeIntent(entry);
      let recovered = false;
      try {
        authoritative = freezeAuthoritativeResponse(await refetch());
        recovered = true;
      } catch (error) {
        reportIsolatedError('Vault Appearance canonical recovery failed.', error);
      }
      const rebased = replayPendingIntents(authoritative);
      installCurrent(rebased, {
        ...details,
        reason: 'recovered',
        authoritative: intents.length === 0
      });
      return recovered;
    }

    function update(reducer, updateOptions = {}) {
      if (typeof reducer !== 'function') {
        throw new TypeError('Vault Appearance updates require a deterministic reducer.');
      }
      const label = updateOptions.label || 'appearance-update';
      const entry = Object.freeze({
        id: ++nextIntentId,
        label,
        reducer
      });

      const optimistic = reduceSnapshot(current, reducer);
      intents.push(entry);
      installCurrent(optimistic, {
        reason: 'optimistic',
        label,
        intentId: entry.id,
        authoritative: false
      });

      return enqueue(async () => {
        try {
          const candidate = reduceSnapshot(authoritative, reducer);
          authoritative = freezeAuthoritativeResponse(await persist(candidate));
          removeIntent(entry);
          const rebased = replayPendingIntents(authoritative);
          installCurrent(rebased, {
            reason: 'accepted',
            label,
            intentId: entry.id,
            authoritative: intents.length === 0
          });
          if (updateOptions.notifyCommitted !== false && updateOptions.publish !== false) {
            markNotification({ label, intentId: entry.id, kind: 'update' });
          }
          return current;
        } catch (error) {
          const recovered = await recoverAfterFailure(entry, {
            label,
            intentId: entry.id
          });
          if (recovered && updateOptions.notifyCommitted !== false
            && updateOptions.publish !== false) {
            markNotification({ label, intentId: entry.id, kind: 'recovery' });
          }
          throw error;
        }
      });
    }

    function replace(value, replaceOptions = {}) {
      const replacement = freezeNormalized(value);
      return update(() => cloneJson(replacement), {
        label: replaceOptions.label || 'appearance-replace',
        notifyCommitted: replaceOptions.notifyCommitted,
        publish: replaceOptions.publish
      });
    }

    function transaction(operation, transactionOptions = {}) {
      if (typeof operation !== 'function') {
        throw new TypeError('Vault Appearance transactions require an operation function.');
      }
      const label = transactionOptions.label || 'appearance-transaction';
      const selectAppearance = transactionOptions.selectAppearance
        || ((result) => result?.appearance);

      return enqueue(async () => {
        try {
          const result = await operation(authoritative);
          authoritative = freezeAuthoritativeResponse(selectAppearance(result));
          const rebased = replayPendingIntents(authoritative);
          installCurrent(rebased, {
            reason: 'transaction-accepted',
            label,
            authoritative: intents.length === 0
          });
          if (transactionOptions.notifyCommitted !== false
            && transactionOptions.publish !== false) {
            markNotification({ label, kind: 'transaction' });
          }
          return result;
        } catch (error) {
          const recovered = await recoverAfterFailure(null, { label });
          if (recovered && transactionOptions.notifyCommitted !== false
            && transactionOptions.publish !== false) {
            markNotification({ label, kind: 'transaction-recovery' });
          }
          throw error;
        }
      });
    }

    function load(loadOptions = {}) {
      const label = loadOptions.label || 'appearance-load';
      return enqueue(async () => {
        authoritative = freezeAuthoritativeResponse(await refetch());
        const rebased = replayPendingIntents(authoritative);
        installCurrent(rebased, {
          reason: 'loaded',
          label,
          authoritative: intents.length === 0
        });
        if (loadOptions.notifyCommitted === true || loadOptions.publish === true) {
          markNotification({ label, kind: 'load' });
        }
        return current;
      });
    }

    function subscribe(subscriber, subscribeOptions = {}) {
      if (typeof subscriber !== 'function') {
        throw new TypeError('Vault Appearance subscribers must be functions.');
      }
      subscribers.add(subscriber);
      if (subscribeOptions.emitCurrent !== false) {
        try {
          subscriber(current, metadata({ reason: 'subscribed', authoritative: intents.length === 0 }));
        } catch (error) {
          reportIsolatedError('Vault Appearance subscriber failed.', error);
        }
      }
      return () => subscribers.delete(subscriber);
    }

    function snapshot() {
      return current;
    }

    function authoritativeSnapshot() {
      return authoritative;
    }

    function flush() {
      return tail.then(() => current);
    }

    return Object.freeze({
      authoritativeSnapshot,
      flush,
      load,
      replace,
      snapshot,
      subscribe,
      transaction,
      update
    });
  }

  return Object.freeze({
    DEFAULT_ENDPOINT,
    createHttpAppearancePersistence,
    createVaultAppearanceStore
  });
}));
