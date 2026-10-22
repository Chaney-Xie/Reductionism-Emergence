(function initCategoryBatch(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.categoryBatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const INSTRUCTION_STATES = Object.freeze(['neutral', 'add', 'remove']);

  function nextInstructionState(value) {
    const index = INSTRUCTION_STATES.indexOf(value);
    return INSTRUCTION_STATES[(index + 1) % INSTRUCTION_STATES.length];
  }

  function normalizeStableIds(values) {
    if (!Array.isArray(values)) return [];
    const result = [];
    const seen = new Set();
    for (const value of values) {
      if (typeof value !== 'string' || !/^[a-z0-9_-]+$/i.test(value) || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  function instructionPayload(instructions) {
    const entries = instructions instanceof Map
      ? [...instructions.entries()]
      : Object.entries(instructions || {});
    const addCategoryIds = [];
    const removeCategoryIds = [];
    for (const [categoryId, instruction] of entries) {
      if (typeof categoryId !== 'string') continue;
      if (instruction === 'add') addCategoryIds.push(categoryId);
      if (instruction === 'remove') removeCategoryIds.push(categoryId);
    }
    return { addCategoryIds, removeCategoryIds };
  }

  function applyCategoryInstructions(currentCategoryIds, addCategoryIds, removeCategoryIds) {
    const removed = new Set(removeCategoryIds || []);
    const result = [];
    const seen = new Set();
    for (const categoryId of currentCategoryIds || []) {
      if (typeof categoryId !== 'string' || removed.has(categoryId) || seen.has(categoryId)) continue;
      seen.add(categoryId);
      result.push(categoryId);
    }
    for (const categoryId of addCategoryIds || []) {
      if (typeof categoryId !== 'string' || seen.has(categoryId)) continue;
      seen.add(categoryId);
      result.push(categoryId);
    }
    return result;
  }

  return {
    INSTRUCTION_STATES,
    applyCategoryInstructions,
    instructionPayload,
    nextInstructionState,
    normalizeStableIds
  };
}));
