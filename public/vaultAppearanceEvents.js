(function initVaultAppearanceEvents(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.vaultAppearanceEventsModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CHANNEL_NAME = 'cogneuro-vault-appearance';
  const MESSAGE_TYPE = 'vault-appearance-changed';

  function defaultBroadcastChannel() {
    return typeof globalThis !== 'undefined' ? globalThis.BroadcastChannel : undefined;
  }

  function reportError(onError, error, context) {
    try {
      onError?.(error, context);
    } catch {
      // Error reporting must never become another synchronization owner.
    }
  }

  function openChannel({ BroadcastChannelImpl, channelName, onError, owner }) {
    const Channel = BroadcastChannelImpl === undefined
      ? defaultBroadcastChannel()
      : BroadcastChannelImpl;
    if (typeof Channel !== 'function') return null;
    try {
      return new Channel(channelName);
    } catch (error) {
      reportError(onError, error, { owner, phase: 'open' });
      return null;
    }
  }

  function createPublisher({
    BroadcastChannelImpl,
    channelName = CHANNEL_NAME,
    onError
  } = {}) {
    const channel = openChannel({
      BroadcastChannelImpl,
      channelName,
      onError,
      owner: 'publisher'
    });
    let closed = false;

    function publish({ generation } = {}) {
      if (closed || !channel) return false;
      const message = { type: MESSAGE_TYPE };
      if (Number.isSafeInteger(generation) && generation >= 0) message.generation = generation;
      try {
        channel.postMessage(message);
        return true;
      } catch (error) {
        reportError(onError, error, { owner: 'publisher', phase: 'publish' });
        return false;
      }
    }

    function close() {
      if (closed) return;
      closed = true;
      try {
        channel?.close?.();
      } catch (error) {
        reportError(onError, error, { owner: 'publisher', phase: 'close' });
      }
    }

    return Object.freeze({ publish, close });
  }

  function isAppearanceInvalidation(message) {
    return Boolean(message && typeof message === 'object' && message.type === MESSAGE_TYPE);
  }

  function createInvalidationClient({
    BroadcastChannelImpl,
    channelName = CHANNEL_NAME,
    fetchAppearance,
    applyAppearance,
    onError
  } = {}) {
    if (typeof fetchAppearance !== 'function') {
      throw new TypeError('fetchAppearance must be a function.');
    }
    if (typeof applyAppearance !== 'function') {
      throw new TypeError('applyAppearance must be a function.');
    }

    const channel = openChannel({
      BroadcastChannelImpl,
      channelName,
      onError,
      owner: 'client'
    });
    let closed = false;
    let refreshGeneration = 0;

    async function refresh({ reason = 'manual' } = {}) {
      if (closed) return Object.freeze({ applied: false, closed: true });
      const generation = ++refreshGeneration;
      let appearance;
      try {
        appearance = await fetchAppearance();
      } catch (error) {
        if (!closed && generation === refreshGeneration) {
          reportError(onError, error, {
            owner: 'client', phase: 'fetch', reason, generation
          });
        }
        return Object.freeze({
          applied: false,
          stale: closed || generation !== refreshGeneration,
          error
        });
      }

      if (closed || generation !== refreshGeneration) {
        return Object.freeze({ applied: false, stale: true });
      }

      try {
        applyAppearance(appearance, { reason, generation });
      } catch (error) {
        if (!closed && generation === refreshGeneration) {
          reportError(onError, error, {
            owner: 'client', phase: 'apply', reason, generation
          });
        }
        return Object.freeze({ applied: false, error });
      }

      return Object.freeze({ applied: true, appearance, generation });
    }

    function onMessage(event) {
      if (!isAppearanceInvalidation(event?.data)) return;
      void refresh({ reason: 'notification' });
    }

    if (channel?.addEventListener) channel.addEventListener('message', onMessage);
    else if (channel) channel.onmessage = onMessage;

    function close() {
      if (closed) return;
      closed = true;
      refreshGeneration += 1;
      try {
        if (channel?.removeEventListener) channel.removeEventListener('message', onMessage);
        else if (channel?.onmessage === onMessage) channel.onmessage = null;
        channel?.close?.();
      } catch (error) {
        reportError(onError, error, { owner: 'client', phase: 'close' });
      }
    }

    return Object.freeze({ refresh, close });
  }

  return Object.freeze({
    CHANNEL_NAME,
    MESSAGE_TYPE,
    isAppearanceInvalidation,
    createPublisher,
    createInvalidationClient
  });
}));
