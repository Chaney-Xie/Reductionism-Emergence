const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = require('../../public/markdownPage');
const filterCheckboxControl = require('../../public/filterCheckbox');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.filter(Boolean).forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }

  [Symbol.iterator]() {
    return this.values[Symbol.iterator]();
  }
}

class FakeText {
  constructor(value = '') {
    this.nodeType = 3;
    this.nodeValue = String(value);
    this.parentElement = null;
    this.parentNode = null;
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value) {
    this.nodeValue = String(value || '');
  }
}

class FakeElement {
  constructor({
    dataset = {},
    tagName = 'div',
    children = [],
    nodeType = 1,
    namespaceURI = 'http://www.w3.org/1999/xhtml'
  } = {}) {
    this.nodeType = nodeType;
    this.dataset = { ...dataset };
    this.tagName = String(tagName).toUpperCase();
    this.namespaceURI = namespaceURI;
    this.childNodes = [];
    this.parentElement = null;
    this.parentNode = null;
    this.style = {
      values: new Map(),
      setProperty(name, value) {
        this.values.set(String(name), String(value));
      },
      removeProperty(name) {
        this.values.delete(String(name));
      },
      getPropertyValue(name) {
        return this.values.get(String(name)) || '';
      }
    };
    this.attributes = {};
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.contentEditable = 'inherit';
    this.spellcheck = true;
    this.tabIndex = 0;
    this.disabled = false;
    this.checked = false;
    this.append(...children);
  }

  get children() {
    return this.childNodes.filter((child) => child?.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  get className() {
    return [...this.classList].join(' ');
  }

  set className(value) {
    this.classList.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent || '').join('');
  }

  set textContent(value) {
    this.replaceChildren();
    if (value !== undefined && value !== null && String(value)) {
      this.append(new FakeText(value));
    }
  }

  append(...nodes) {
    nodes.flat().filter((node) => node !== null && node !== undefined).forEach((node) => {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      child.parentElement = this.nodeType === 1 ? this : this.parentElement;
      child.parentNode = this;
      this.childNodes.push(child);
    });
  }

  before(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const insertionIndex = parent.childNodes.indexOf(this);
    nodes.flat().forEach((node, offset) => {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      child.parentElement = parent.nodeType === 1 ? parent : parent.parentElement;
      child.parentNode = parent;
      parent.childNodes.splice(insertionIndex + offset, 0, child);
    });
  }

  after(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const insertionIndex = parent.childNodes.indexOf(this) + 1;
    nodes.flat().forEach((node, offset) => {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      child.parentElement = parent.nodeType === 1 ? parent : parent.parentElement;
      child.parentNode = parent;
      parent.childNodes.splice(insertionIndex + offset, 0, child);
    });
  }

  remove() {
    const parent = this.parentNode;
    if (!parent) return;
    const index = parent.childNodes.indexOf(this);
    if (index >= 0) parent.childNodes.splice(index, 1);
    this.parentElement = null;
    this.parentNode = null;
  }

  replaceChildren(...nodes) {
    this.childNodes.forEach((child) => {
      child.parentElement = null;
      child.parentNode = null;
    });
    this.childNodes = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  matches(selector) {
    return selector.split(',').some((candidate) => {
      const value = candidate.trim();
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      const dataAttributes = [...value.matchAll(
        /\[data-([a-z0-9-]+)(?:=["']([^"']*)["'])?\]/gi
      )];
      if (dataAttributes.length) {
        return dataAttributes.every(([, name, expected]) => {
          const property = name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
          return Object.hasOwn(this.dataset, property)
            && (expected === undefined || this.dataset[property] === expected);
        });
      }
      const attribute = value.match(/^([a-z0-9-]+)?\[type=['"]?([^'"\]]+)['"]?\]$/i);
      if (attribute) {
        return (!attribute[1] || attribute[1].toUpperCase() === this.tagName)
          && this.type === attribute[2];
      }
      return value.toLowerCase() === this.tagName.toLowerCase();
    });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches?.(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => (
      child === node || (typeof child.contains === 'function' && child.contains(node))
    ));
  }

  querySelectorAll(selector) {
    return descendants(this).filter((element) => element !== this && element.matches?.(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeDocumentFragment extends FakeElement {
  constructor() {
    super({ tagName: '#document-fragment', nodeType: 11 });
  }
}

const fakeDocument = {
  body: new FakeElement({ tagName: 'body' }),
  createElement(tagName) {
    return new FakeElement({ tagName });
  },
  createElementNS(namespaceURI, tagName) {
    return new FakeElement({ tagName, namespaceURI });
  },
  createTextNode(value) {
    return new FakeText(value);
  },
  createDocumentFragment() {
    return new FakeDocumentFragment();
  },
  addEventListener() {},
  removeEventListener() {}
};

const fakeWindow = {
  getSelection() {
    return null;
  }
};

function descendants(node) {
  const result = [];
  const visit = (current) => {
    if (!current) return;
    result.push(current);
    (current.childNodes || []).forEach(visit);
  };
  visit(node);
  return result;
}

function loadMarkdownPageViewInternals(names = [], environment = {}) {
  const structuredTextFrameSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'structuredTextFrame.js'),
    'utf8'
  );
  const structuredTextShellSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'structuredTextPageShell.js'),
    'utf8'
  );
  let source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'markdownPageView.js'),
    'utf8'
  );
  const available = names.filter((name) => source.includes(`function ${name}(`));
  source = source.replace(
    '  const api = Object.freeze({',
    `  globalThis.__markdownTestInternals = { ${available.join(', ')} };\n\n  const api = Object.freeze({`
  );
  const context = {
    globalThis: {
      markdownPageModel: markdown,
      filterCheckboxControl,
      ...(environment.globalThis || {})
    },
    window: environment.window || fakeWindow,
    Node: { TEXT_NODE: 3, DOCUMENT_FRAGMENT_NODE: 11, ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4 },
    Element: FakeElement,
    document: environment.document
      ? { ...fakeDocument, ...environment.document }
      : fakeDocument
  };
  vm.runInNewContext(structuredTextFrameSource, context);
  vm.runInNewContext(structuredTextShellSource, context);
  vm.runInNewContext(source, context);
  return {
    ...context.globalThis.markdownPageView,
    ...context.globalThis.__markdownTestInternals
  };
}

function renderSemanticSegments(view, source, stateOverrides = {}) {
  const state = { body: source, mode: 'live-preview', ...stateOverrides };
  const segments = view.semanticSyntaxSegments(state);
  state.semanticBlocks = segments.map((segment, index) => ({
    ...segment,
    hasFollowingBlock: index < segments.length - 1,
    element: new FakeElement({ tagName: 'section' })
  }));
  state.semanticBlocks.forEach((block) => view.renderSemanticBlockContents(state, block));
  return { state, segments, blocks: state.semanticBlocks };
}

module.exports = {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
};
