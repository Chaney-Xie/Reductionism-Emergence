const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const textEditing = require('../public/textEditing');

function editableElement(kind = 'input') {
  const editable = {
    matches: (selector) => selector === '[contenteditable="false"]' ? false : false,
    hasAttribute: () => false
  };
  return {
    nodeType: 1,
    closest: (selector) => selector.includes(kind) ? editable : null
  };
}

function imeHarness() {
  const listeners = new Map();
  const documentRef = {
    activeElement: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      const index = registered.indexOf(listener);
      if (index >= 0) registered.splice(index, 1);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
  const surface = (kind = 'input') => {
    const element = {
      nodeType: 1,
      ownerDocument: documentRef,
      matches: (selector) => selector === '[contenteditable="false"]' ? false : false,
      hasAttribute: () => false,
      closest: (selector) => selector.includes(kind) ? element : null
    };
    return element;
  };
  return { documentRef, surface };
}

test('one focus-local owner carries an IME Enter through compositionend until keyup', () => {
  const { documentRef, surface } = imeHarness();
  const input = surface('input');
  const otherPaneInput = surface('input');
  documentRef.activeElement = input;
  const owner = textEditing.installImeCompositionOwnership(documentRef);
  assert.strictEqual(textEditing.installImeCompositionOwnership(documentRef), owner,
    'one document has one non-blocking composition observer');

  documentRef.dispatch('compositionstart', { target: input });
  let prevented = 0;
  let stopped = 0;
  const enter = {
    key: 'Enter', keyCode: 13, isComposing: false, target: input,
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  };
  documentRef.dispatch('keydown', enter);
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(enter, input), true);

  documentRef.dispatch('compositionend', { target: input, data: '你好' });
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(enter, input), true,
    'the same physical key event stays IME-owned after compositionend');
  assert.equal(prevented, 0, 'the shared owner never prevents native composition settlement');
  assert.equal(stopped, 0, 'the shared owner never blocks target or global listeners');
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent({
    inputType: 'insertParagraph', target: input
  }, input), true, 'the composition-ending keypress tail owns later beforeinput');
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent({
    key: 'Enter', keyCode: 13, target: otherPaneInput
  }, otherPaneInput), false, 'Pane B does not inherit Pane A composition ownership');

  documentRef.dispatch('keyup', { key: 'Enter', keyCode: 13, target: input });
  const nextEnter = { key: 'Enter', keyCode: 13, isComposing: false, target: input };
  documentRef.dispatch('keydown', nextEnter);
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(nextEnter, input), false,
    'the next ordinary Enter resumes Viewer command ownership');

  const editorRoot = surface('contenteditable');
  const nestedEditable = surface('contenteditable');
  editorRoot.contains = (candidate) => candidate === editorRoot || candidate === nestedEditable;
  nestedEditable.contains = (candidate) => candidate === nestedEditable;
  documentRef.activeElement = nestedEditable;
  documentRef.dispatch('compositionstart', { target: nestedEditable });
  const retargetedEnter = {
    key: 'Enter', keyCode: 13, isComposing: false, target: nestedEditable
  };
  documentRef.dispatch('keydown', retargetedEnter);
  documentRef.dispatch('compositionend', { target: nestedEditable, data: 'candidate' });
  documentRef.activeElement = editorRoot;
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent({
    inputType: 'insertParagraph', target: editorRoot
  }, editorRoot), true,
  'the held keypress tail follows focus only within the same nested editor');
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent({
    inputType: 'insertParagraph', target: otherPaneInput
  }, otherPaneInput), false,
  'a related-surface tail never crosses into another Pane');
  documentRef.dispatch('keyup', { key: 'Enter', keyCode: 13, target: editorRoot });
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent({
    inputType: 'insertParagraph', target: nestedEditable
  }, nestedEditable), false,
  'a retargeted keyup retires the original nested editable tail');
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent({
    inputType: 'insertParagraph', target: editorRoot
  }, editorRoot), false,
  'a retargeted keyup also leaves the outer editor ordinary');
  documentRef.activeElement = input;

  documentRef.dispatch('compositionstart', { target: input });
  const rawLatinEnter = { key: 'Enter', keyCode: 13, isComposing: false, target: input };
  documentRef.dispatch('keydown', rawLatinEnter);
  documentRef.dispatch('compositionend', { target: input, data: 'raw latin' });
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(rawLatinEnter, input), true,
    'composition ownership does not depend on candidate language or authored characters');
  documentRef.dispatch('keyup', { key: 'Enter', keyCode: 13, target: input });

  documentRef.dispatch('compositionstart', { target: input });
  const strandedEnter = { key: 'Enter', keyCode: 13, isComposing: false, target: input };
  documentRef.dispatch('keydown', strandedEnter);
  documentRef.dispatch('compositionend', { target: input, data: 'candidate' });
  const afterStrandedTail = {
    key: 'Enter', keyCode: 13, isComposing: false, target: input
  };
  documentRef.dispatch('keydown', afterStrandedTail);
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(afterStrandedTail, input), false,
    'a missing keyup cannot force an ordinary later keypress to require an extra Enter');

  const legacy = { key: 'Process', keyCode: 229, isComposing: false, target: input };
  documentRef.dispatch('keydown', legacy);
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(legacy, input), true);
  documentRef.dispatch('keyup', { key: 'Process', keyCode: 229, target: input });
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(
    { key: 'Enter', target: input }, input, null, true
  ), true, 'an editor may expose its existing Pane-local lifecycle to the shared predicate');
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(
    { key: 'Escape', target: input }, input, null, true
  ), false, 'the shared lifecycle permission owner is scoped to Enter');
  assert.equal(textEditing.isImeCompositionOwnedKeyEvent(
    { key: 'Tab', isComposing: true, target: input }, input, null, true
  ), false, 'the Enter repair does not absorb Tab into the shared command predicate');
  assert.equal(textEditing.shouldPreserveNativeEditing({
    key: 'Tab', isComposing: true, target: input
  }, input), true, 'pre-existing generic native composition preservation remains intact');
  owner.dispose();
});

test('shared editing boundary preserves native Command/Control editing shortcuts only in editable targets', () => {
  for (const key of ['a', 'x', 'c', 'v', 'z']) {
    assert.equal(textEditing.shouldPreserveNativeEditing({
      key, metaKey: true, ctrlKey: false, altKey: false, target: editableElement('input')
    }), true);
    assert.equal(textEditing.shouldPreserveNativeEditing({
      key, metaKey: false, ctrlKey: true, altKey: false, target: editableElement('textarea')
    }), true);
  }
  assert.equal(textEditing.shouldPreserveNativeEditing({
    key: 'z', shiftKey: true, metaKey: true, altKey: false, target: editableElement('contenteditable')
  }), true);
  assert.equal(textEditing.shouldPreserveNativeEditing({
    key: 'c', metaKey: true, altKey: false,
    target: { nodeType: 1, closest: () => null }
  }), false);
});

function nativeTextInput(type = 'text') {
  const control = {
    nodeType: 1,
    tagName: 'INPUT',
    type,
    hasAttribute: () => false,
    closest: (selector) => selector === 'input, textarea' ? control : null
  };
  return control;
}

function historyEvent(target, overrides = {}) {
  const state = { prevented: false, stopped: false };
  return {
    key: 'z',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target,
    preventDefault: () => { state.prevented = true; },
    stopImmediatePropagation: () => { state.stopped = true; },
    state,
    ...overrides
  };
}

test('focused native text inputs consume Undo and Redo without leaving the editor', () => {
  const input = nativeTextInput();
  const commands = [];
  const undo = historyEvent(input);
  assert.equal(textEditing.handleNativeInputHistoryShortcut(
    undo, input, (command) => commands.push(command)
  ), true);
  assert.deepEqual(commands, ['undo']);
  assert.deepEqual(undo.state, { prevented: true, stopped: true });

  const redo = historyEvent(input, { shiftKey: true });
  assert.equal(textEditing.handleNativeInputHistoryShortcut(
    redo, input, (command) => commands.push(command)
  ), true);
  assert.deepEqual(commands, ['undo', 'redo']);
  assert.deepEqual(redo.state, { prevented: true, stopped: true });

  const controlRedo = historyEvent(input, {
    key: 'y', metaKey: false, ctrlKey: true
  });
  assert.equal(textEditing.handleNativeInputHistoryShortcut(
    controlRedo, input, (command) => commands.push(command)
  ), true);
  assert.equal(commands.at(-1), 'redo');
});

test('native input history routing leaves contenteditable and non-text controls to their owners', () => {
  const contenteditable = editableElement('contenteditable');
  const markdownUndo = historyEvent(contenteditable);
  assert.equal(textEditing.handleNativeInputHistoryShortcut(markdownUndo, contenteditable), false);
  assert.deepEqual(markdownUndo.state, { prevented: false, stopped: false });

  const checkbox = nativeTextInput('checkbox');
  const checkboxUndo = historyEvent(checkbox);
  assert.equal(textEditing.handleNativeInputHistoryShortcut(checkboxUndo, checkbox), false);
  assert.deepEqual(checkboxUndo.state, { prevented: false, stopped: false });
});

test('Electron Edit roles preserve native controls while Markdown owns its canonical clipboard', async () => {
  const root = path.join(__dirname, '..');
  const [main, index, vocabularyHtml, bootstrap, vault, descriptor, vocabulary, markdownView] = await Promise.all([
    fs.readFile(path.join(root, 'desktop/main.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/vocabulary.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/appBootstrap.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/descriptorModal.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/vocabulary.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/markdownPageView.js'), 'utf8')
  ]);
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    assert.match(main, new RegExp(`role: '${role}'`));
  }
  assert.match(index, /textEditing\.js[\s\S]*?app\.js/);
  assert.match(vocabularyHtml, /textEditing\.js[\s\S]*?vocabulary\.js/);
  assert.match(bootstrap, /handleNativeInputHistoryShortcut[\s\S]*?shouldPreserveNativeEditing/);
  assert.match(vault, /handleVaultSettingsKeyDown[\s\S]*?shouldPreserveNativeEditing/);
  assert.match(descriptor, /const onKeyDown = \(event\) => \{[\s\S]*?shouldPreserveNativeEditing/);
  assert.match(vocabulary, /document\.addEventListener\('keydown',[\s\S]*?shouldPreserveNativeEditing/);
  assert.doesNotMatch(`${bootstrap}\n${vault}`, /navigator\.clipboard|clipboardData\.setData/);
  assert.match(markdownView, /document\.addEventListener\('copy',[\s\S]*?handleMarkdownClipboardEvent\(event, 'copy'\)/);
  assert.match(markdownView, /clipboardData\.setData\('text\/plain', source\)/);
  assert.match(markdownView, /function nativeClipboardControl\([\s\S]*?input, textarea, \[contenteditable\][\s\S]*?markdown-page-body/);
  assert.match(markdownView, /'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio',[\s\S]*?'range', 'reset', 'submit'/);
});
