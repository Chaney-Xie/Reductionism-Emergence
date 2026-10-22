(function exposeUndoManager(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.undoManagerModel = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function validCommand(command) {
    return Boolean(command
      && typeof command.undo === 'function'
      && typeof command.redo === 'function');
  }

  function createUndoManager() {
    let context = null;

    function beginContext({ id, type, ownerId = null } = {}) {
      if (!id || !type) throw new Error('Undo contexts require stable id and type values.');
      context = { id, type, ownerId, undoStack: [], redoStack: [] };
      return context;
    }

    function record(command) {
      if (!context || !validCommand(command)) return false;
      context.undoStack.push(command);
      context.redoStack = [];
      return true;
    }

    function execute(command) {
      if (!context || !validCommand(command)) return false;
      command.redo();
      return record(command);
    }

    function undo() {
      if (!context?.undoStack.length) return false;
      const command = context.undoStack.pop();
      command.undo();
      context.redoStack.push(command);
      return true;
    }

    function redo() {
      if (!context?.redoStack.length) return false;
      const command = context.redoStack.pop();
      command.redo();
      context.undoStack.push(command);
      return true;
    }

    function clearContext() {
      context = null;
    }

    return Object.freeze({
      beginContext,
      record,
      execute,
      undo,
      redo,
      commitContext: clearContext,
      cancelContext: clearContext,
      clearContext,
      activeContext: () => context
        ? { id: context.id, type: context.type, ownerId: context.ownerId }
        : null,
      canUndo: () => Boolean(context?.undoStack.length),
      canRedo: () => Boolean(context?.redoStack.length)
    });
  }

  return Object.freeze({ createUndoManager });
}));
