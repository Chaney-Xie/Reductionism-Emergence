(function exposeDescriptorMutation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.descriptorMutation = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function stateFromRefs(refs = []) {
    return {
      manual: refs.some((ref) => ref?.source !== 'auto'),
      auto: refs.some((ref) => ref?.source === 'auto')
    };
  }

  function normalRemoval(refs = []) {
    const state = stateFromRefs(refs);
    return {
      ...state,
      createIgnored: state.auto,
      rememberManual: state.manual && state.auto
    };
  }

  function canExplicitlyExclude(refs = []) {
    const state = stateFromRefs(refs);
    return state.manual && !state.auto;
  }

  function restoreSource({ ignoredManual = false, hasAutoSupport = false } = {}) {
    return ignoredManual || !hasAutoSupport ? 'manual' : 'auto';
  }

  return { stateFromRefs, normalRemoval, canExplicitlyExclude, restoreSource };
}));
