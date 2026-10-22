const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const animationModel = require('../public/sidebarMembershipMoveAnimation');

const read = (file) => fs.readFile(path.join(__dirname, '..', file), 'utf8');

class FakeClassList {
  constructor(names = []) { this.names = new Set(names); }
  add(...names) { names.forEach((name) => this.names.add(name)); }
  remove(...names) { names.forEach((name) => this.names.delete(name)); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.names.has(name) : Boolean(force);
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
  }
}

class FakeAnimation {
  constructor({ pending = false, element = null, keyframes = [] } = {}) {
    this.element = element;
    this.keyframes = keyframes;
    this.currentStyles = null;
    this.commitStylesCalls = 0;
    this.settled = false;
    this.finished = pending
      ? new Promise((resolve) => { this.resolve = resolve; })
      : Promise.resolve();
  }
  commitStyles() {
    this.commitStylesCalls += 1;
    if (!this.element?.style || !this.currentStyles) return;
    Object.assign(this.element.style, this.currentStyles);
  }
  cancel() {
    if (this.settled) return;
    this.settled = true;
    this.resolve?.();
  }
}

class FakeElement {
  constructor({
    classNames = [],
    dataset = {},
    height = 20,
    width = 180,
    top = 0,
    pendingAnimations = false
  } = {}) {
    this.tagName = 'div';
    this.children = [];
    this.parentElement = null;
    this.dataset = { ...dataset };
    this.classList = new FakeClassList(classNames);
    this.style = {
      display: '',
      setProperty(name, value) { this[name] = String(value); },
      removeProperty(name) { delete this[name]; }
    };
    this.attributes = new Map();
    this.baseHeight = height;
    this.baseWidth = width;
    this.baseTop = top;
    this.pendingAnimations = pendingAnimations;
    this.animationCalls = [];
    this._className = classNames.join(' ');
  }
  set className(value) {
    this._className = String(value);
    this.classList.names = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get className() { return this._className; }
  get isConnected() { return Boolean(this.parentElement); }
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains?.(candidate));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = (element) => {
      if (selector === '[id]') return element.attributes.has('id');
      if (selector === '.nav-folder-button') {
        return element.classList.contains('nav-folder-button');
      }
      if (selector === '.nav-folder[data-folder-id]') {
        return element.classList.contains('nav-folder') && Boolean(element.dataset.folderId);
      }
      if (selector === '.nav-folder-pages[data-navigation-container-id]') {
        return element.classList.contains('nav-folder-pages')
          && Boolean(element.dataset.navigationContainerId);
      }
      return false;
    };
    const found = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (matches(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  cloneNode() {
    return new FakeElement({
      classNames: [...this.classList.names],
      dataset: this.dataset,
      height: this.baseHeight,
      width: this.baseWidth,
      top: this.getBoundingClientRect().top,
      pendingAnimations: this.pendingAnimations
    });
  }
  getBoundingClientRect() {
    if (this.style.display === 'none') {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    const styledHeight = typeof this.style.height === 'string'
      && /^\d+(?:\.\d+)?px$/.test(this.style.height)
      ? Number.parseFloat(this.style.height)
      : null;
    const layoutHeight = styledHeight ?? this.baseHeight;
    let top = this.baseTop;
    if (this.parentElement) {
      top = this.parentElement.baseTop;
      for (const sibling of this.parentElement.children) {
        if (sibling === this) break;
        if (sibling.style.display !== 'none') {
          const siblingHeight = typeof sibling.style.height === 'string'
            && /^\d+(?:\.\d+)?px$/.test(sibling.style.height)
            ? Number.parseFloat(sibling.style.height)
            : sibling.baseHeight;
          top += siblingHeight;
        }
      }
    }
    return {
      left: 0,
      top,
      right: this.baseWidth,
      bottom: top + layoutHeight,
      width: this.baseWidth,
      height: layoutHeight
    };
  }
  animate(keyframes, options) {
    this.animationCalls.push({ keyframes, options });
    const animation = new FakeAnimation({
      pending: this.pendingAnimations,
      element: this,
      keyframes
    });
    this.animationCalls.at(-1).animation = animation;
    return animation;
  }
}

function page(id, options = {}) {
  const { dataset = {}, ...elementOptions } = options;
  return new FakeElement({
    classNames: ['page-link'],
    dataset: {
      pageId: id,
      sidebarMotionId: `page:${id}`,
      ...dataset
    },
    ...elementOptions
  });
}

function emptyHint(options = {}) {
  return new FakeElement({
    classNames: ['nav-folder-empty'],
    height: 20,
    ...options
  });
}

function folder(id, pages, options = {}) {
  const {
    dataset = {},
    regionHeight = 20,
    regionPendingAnimations = false,
    ...wrapperOptions
  } = options;
  const wrapper = new FakeElement({
    classNames: ['nav-folder'],
    dataset: { folderId: id, ...dataset },
    ...wrapperOptions
  });
  const button = new FakeElement({
    classNames: ['nav-folder-button'],
    dataset: { sidebarMotionId: `folder:${id}` }
  });
  const container = new FakeElement({
    classNames: ['nav-folder-pages'],
    dataset: {
      navigationContainerId: `folder:${id}`,
      sidebarMotionRegion: id
    },
    height: regionHeight,
    pendingAnimations: regionPendingAnimations,
    top: 80
  });
  container.append(...pages);
  wrapper.append(button, container);
  wrapper.button = button;
  wrapper.pages = container;
  return wrapper;
}

function collapsedFolder(id, options = {}) {
  const { dataset = {}, ...wrapperOptions } = options;
  const wrapper = new FakeElement({
    classNames: ['nav-folder'],
    dataset: { folderId: id, ...dataset },
    ...wrapperOptions
  });
  const button = new FakeElement({
    classNames: ['nav-folder-button'],
    dataset: { sidebarMotionId: `folder:${id}` }
  });
  wrapper.append(button);
  wrapper.button = button;
  return wrapper;
}

function fakeRuntime({ reducedMotion = false } = {}) {
  const body = new FakeElement();
  const listeners = new Map();
  const resizeObservers = [];
  let requestAnimationFrameCalls = 0;
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      this.disconnected = false;
      resizeObservers.push(this);
    }
    observe(element) { this.targets.add(element); }
    unobserve(element) { this.targets.delete(element); }
    disconnect() {
      this.disconnected = true;
      this.targets.clear();
    }
    trigger(element = [...this.targets][0]) {
      if (!element || this.disconnected) return;
      this.callback([{
        target: element,
        contentRect: element.getBoundingClientRect()
      }], this);
    }
  }
  const documentRef = {
    body,
    createElement: (tagName) => {
      const element = new FakeElement();
      element.tagName = tagName;
      return element;
    }
  };
  const windowRef = {
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: (element) => ({
      boxSizing: element?.style?.boxSizing || 'content-box',
      height: element?.style?.height || `${element?.getBoundingClientRect?.().height || 0}px`,
      minHeight: element?.style?.minHeight || '0px',
      maxHeight: element?.style?.maxHeight || 'none',
      marginTop: element?.style?.marginTop || '0px',
      marginBottom: element?.style?.marginBottom || '0px',
      paddingTop: element?.style?.paddingTop || '4px',
      paddingBottom: element?.style?.paddingBottom || '4px',
      borderTopWidth: element?.style?.borderTopWidth || '0px',
      borderBottomWidth: element?.style?.borderBottomWidth || '0px',
      opacity: element?.style?.opacity || '1',
      overflow: element?.style?.overflow || 'visible',
      pointerEvents: element?.style?.pointerEvents || 'auto',
      transform: element?.style?.transform || 'none',
      transformOrigin: element?.style?.transformOrigin || '50% 50%',
      willChange: element?.style?.willChange || 'auto'
    }),
    ResizeObserver: FakeResizeObserver,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    requestAnimationFrame(callback) {
      requestAnimationFrameCalls += 1;
      return setTimeout(callback, 0);
    },
    cancelAnimationFrame: clearTimeout,
    setTimeout,
    clearTimeout
  };
  return {
    documentRef,
    body,
    listeners,
    resizeObservers,
    requestAnimationFrameCalls: () => requestAnimationFrameCalls,
    windowRef
  };
}

test('stable identities and move descriptors use Page/Folder ids, never indexes', () => {
  assert.equal(animationModel.itemId({ type: 'page', id: 'page_a' }), 'page:page_a');
  assert.equal(animationModel.itemId({ type: 'folder', id: 'folder_a' }), 'folder:folder_a');
  assert.equal(animationModel.rowId(page('page_a')), 'page:page_a');
  assert.equal(animationModel.containerId(null), 'root');
  assert.equal(animationModel.containerId('folder_a'), 'folder:folder_a');
  assert.deepEqual(
    animationModel.normalizeMoveDescriptors([
      { type: 'page', id: 'same', sourceParentFolderId: 'folder_a' },
      { type: 'page', id: 'move', sourceParentFolderId: null },
      { type: 'page', id: 'move', sourceParentFolderId: null }
    ], 'folder_a').map((move) => move.id),
    ['page:move']
  );
});

test('navigation extraction owns one Page and handoff restores it smoothly without a detached ghost', async () => {
  const moving = page('page_a');
  const sibling = page('page_b');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(moving, sibling);
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event)
  });

  const session = coordinator.beginDrag({
    items: [{ type: 'page', id: 'page_a', sourceParentFolderId: null }],
    effectivePageIds: ['page_a'],
    primaryPageId: 'page_a',
    primaryName: 'Untitled | 6',
    pointer: { x: 40, y: 25 }
  });

  assert.ok(session);
  assert.equal(runtime.body.children.length, 1);
  const bubble = runtime.body.children[0];
  assert.equal(bubble.classList.contains('sidebar-membership-drag-stack'), true);
  assert.equal(bubble.dataset.effectivePageCount, '1');
  assert.equal(bubble.children.length, 1, 'one Page has no count suffix or fake backplate node');
  assert.equal(bubble.children[0].textContent, 'Untitled | 6');
  assert.equal(bubble.style.pointerEvents, 'none');
  assert.equal(bubble.style.transform, 'translate3d(54px, 37px, 0)');
  assert.equal(moving.style.height, '0px', 'source extraction happens when drag begins');
  assert.equal(moving.style.opacity, '0');
  assert.equal(moving.style.pointerEvents, 'none');
  assert.equal(moving.classList.contains('is-sidebar-membership-exiting-row'), true);
  assert.equal(sibling.getBoundingClientRect().top, 0, 'remaining layout closes the extracted space');
  assert.equal(moving.animationCalls.length, 1);
  assert.equal(traces[0].phase, 'drag-begin');
  assert.deepEqual(traces[0].details, {
    primaryPageId: 'page_a', effectivePageCount: 1, visibleExits: 1
  });

  assert.equal(coordinator.updateDragPointer(session, 100, 120), true);
  assert.equal(bubble.style.transform, 'translate3d(114px, 132px, 0)');
  assert.equal(coordinator.handoffDrag(session), true);
  assert.equal(runtime.body.children.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(moving.style.height, '');
  assert.equal(moving.classList.contains('is-sidebar-membership-exiting-row'), false);
  assert.equal(coordinator.active, false);
});

test('single-Page extraction collapses only the pointer-interacted visible occurrence', () => {
  const canonicalOccurrence = page('duplicate', {
    dataset: { sidebarMotionId: 'root/page:duplicate' }
  });
  const projectedOccurrence = page('duplicate', {
    dataset: { sidebarMotionId: 'category:terminal/page:duplicate' }
  });
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(canonicalOccurrence, projectedOccurrence);
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({ root, ...runtime });

  const session = coordinator.beginDrag({
    items: [{ type: 'page', id: 'duplicate', sourceParentFolderId: null }],
    effectivePageIds: ['duplicate'],
    extractPageIds: ['duplicate'],
    primaryPageId: 'duplicate',
    primaryName: 'Duplicate',
    sourceElement: projectedOccurrence,
    pointer: { x: 20, y: 20 }
  });

  assert.ok(session);
  assert.equal(projectedOccurrence.style.height, '0px');
  assert.equal(projectedOccurrence.style.opacity, '0');
  assert.notEqual(canonicalOccurrence.style.height, '0px');
  assert.equal(canonicalOccurrence.style.opacity, undefined);
  assert.equal(canonicalOccurrence.animationCalls.length, 0);
  assert.equal(coordinator.handoffDrag(session), true);
});

test('explicit multi-selection extracts visible selected rows into one deduplicated English stacked bubble', () => {
  const rows = Array.from({ length: 12 }, (_, index) => page(`page_${index + 1}`));
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(...rows);
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({ root, ...runtime });
  const effectivePageIds = [
    ...rows.map((row) => row.dataset.pageId),
    'page_2',
    'page_12'
  ];

  const session = coordinator.beginDrag({
    items: rows.map((row) => ({
      type: 'page', id: row.dataset.pageId, sourceParentFolderId: null
    })),
    effectivePageIds,
    extractPageIds: effectivePageIds,
    deferredPageIds: [],
    primaryPageId: 'page_1',
    primaryName: 'Name abcdefghijklmnopqrstuvwxyz',
    pointer: { x: 18, y: 22 }
  });

  assert.equal(session.items.length, 12);
  assert.equal(session.effectivePageIds.length, 12);
  assert.equal(session.extractPageIds.length, 12);
  assert.deepEqual(session.deferredPageIds, []);
  assert.equal(runtime.body.children.length, 1, 'a batch never creates twelve floating rows');
  const bubble = runtime.body.children[0];
  assert.equal(bubble.dataset.effectivePageCount, '12');
  assert.equal(bubble.children.length, 2);
  assert.equal(bubble.children[0].textContent, 'Name abcdefghijklmnopqrstuvwxyz');
  assert.equal(bubble.children[1].textContent, ' · 12 files');
  assert.match(bubble.style.boxShadow, /var\(--border-guide\)/, 'multi-file stack has one backplate treatment');
  assert.doesNotMatch(
    bubble.children.map((child) => child.textContent).join(''),
    /等|个文件|1 file(?:\b|$)/
  );
  assert.equal(rows.every((row) => row.style.height === '0px'), true);
  assert.equal(coordinator.handoffDrag(session), true);
});

test('Binding Leader keeps Followers in flow until successful commit, then exits and enters the group in two phases', async () => {
  const leader = page('leader');
  const followerA = page('follower_a', { dataset: { bindingFollowerOf: 'leader' } });
  const followerB = page('follower_b', { dataset: { bindingFollowerOf: 'leader' } });
  const target = folder('target', [page('target-stationary')]);
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(leader, followerA, followerB, target);
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event)
  });
  const session = coordinator.beginDrag({
    items: [{ type: 'page', id: 'leader', sourceParentFolderId: null }],
    effectivePageIds: ['leader', 'follower_a', 'follower_b'],
    extractPageIds: ['leader'],
    deferredPageIds: ['follower_a', 'follower_b'],
    primaryPageId: 'leader',
    primaryName: 'Leader',
    pointer: { x: 40, y: 25 }
  });

  assert.deepEqual(session.extractPageIds, ['leader']);
  assert.deepEqual(session.deferredPageIds, ['follower_a', 'follower_b']);
  assert.equal(leader.style.height, '0px');
  assert.notEqual(followerA.style.height, '0px', 'Follower A stays in normal flow during pointer travel');
  assert.notEqual(followerB.style.height, '0px', 'Follower B stays in normal flow during pointer travel');
  assert.equal(followerA.classList.contains('is-sidebar-membership-exiting-row'), false);
  assert.equal(followerB.classList.contains('is-sidebar-membership-exiting-row'), false);
  assert.equal(session.bubble.dataset.effectivePageCount, '1');
  assert.equal(session.bubble.children.length, 1);

  let followerStateAtRender = null;
  let enteredLeader = null;
  let enteredFollowerA = null;
  let enteredFollowerB = null;
  assert.equal(await coordinator.commitDrag(session, () => {
    followerStateAtRender = [followerA.style.height, followerB.style.height];
    enteredLeader = page('leader');
    enteredFollowerA = page('follower_a', { dataset: { bindingFollowerOf: 'leader' } });
    enteredFollowerB = page('follower_b', { dataset: { bindingFollowerOf: 'leader' } });
    root.replaceChildren(folder('target', [
      enteredLeader, enteredFollowerA, enteredFollowerB, page('target-stationary')
    ]));
  }, { destinationParentFolderId: 'target' }), true);

  assert.deepEqual(followerStateAtRender, ['0px', '0px']);
  const phases = traces.map((event) => event.phase);
  assert.ok(phases.indexOf('drag-commit') < phases.indexOf('drag-deferred-source-start'));
  assert.ok(phases.indexOf('drag-deferred-source-start') < phases.indexOf('drag-deferred-source-complete'));
  assert.ok(phases.indexOf('drag-deferred-source-complete') < phases.indexOf('render'));
  assert.ok(phases.indexOf('render') < phases.indexOf('target-start'));
  assert.ok(phases.indexOf('target-start') < phases.indexOf('target-complete'));
  assert.equal(
    traces.find((event) => event.phase === 'drag-deferred-source-complete')?.details.visibleExits,
    2
  );
  assert.equal(enteredLeader.animationCalls.length, 1);
  assert.equal(enteredFollowerA.animationCalls.length, 1);
  assert.equal(enteredFollowerB.animationCalls.length, 1);
  assert.equal(coordinator.active, false);
});

test('Binding Leader dragged from a synthetic duplicate moves only canonical membership occurrences', async () => {
  async function runScenario({ collapsedTarget }) {
    const syntheticLeader = page('leader', {
      dataset: { sidebarMotionId: 'folder:dynamic/page:leader' }
    });
    const syntheticFollower = page('follower', {
      dataset: { sidebarMotionId: 'folder:dynamic/page:follower' }
    });
    const canonicalLeader = page('leader', {
      dataset: { sidebarMotionId: 'folder:source/page:leader' }
    });
    const canonicalFollower = page('follower', {
      dataset: {
        sidebarMotionId: 'folder:source/binding:leader:follower:follower',
        bindingFollowerOf: 'leader'
      }
    });
    const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
    root.append(
      folder('dynamic', [syntheticLeader, syntheticFollower]),
      folder('source', [canonicalLeader, canonicalFollower]),
      collapsedTarget
        ? collapsedFolder('target')
        : folder('target', [page('target-stationary')])
    );
    const runtime = fakeRuntime();
    const coordinator = animationModel.createCoordinator({
      root,
      ...runtime,
      sourceDuration: 1,
      phaseGap: 0,
      targetDuration: 1
    });
    const session = coordinator.beginDrag({
      items: [{ type: 'page', id: 'leader', sourceParentFolderId: 'source' }],
      effectivePageIds: ['leader', 'follower'],
      extractPageIds: ['leader'],
      deferredPageIds: ['follower'],
      primaryPageId: 'leader',
      primaryName: 'Leader',
      sourceElement: syntheticLeader,
      pointer: { x: 42, y: 36 }
    });

    assert.equal(syntheticLeader.style.height, '0px');
    assert.equal(syntheticLeader.animationCalls.length, 1);
    assert.notEqual(syntheticFollower.style.height, '0px');
    assert.notEqual(canonicalLeader.style.height, '0px');
    assert.notEqual(canonicalFollower.style.height, '0px');
    assert.equal(canonicalLeader.animationCalls.length, 0);
    assert.equal(canonicalFollower.animationCalls.length, 0);

    let nextSyntheticLeader = null;
    let nextSyntheticFollower = null;
    let destinationLeader = null;
    let destinationFollower = null;
    let nextTarget = null;
    const committed = await coordinator.commitDrag(session, () => {
      nextSyntheticLeader = page('leader', {
        dataset: { sidebarMotionId: 'folder:dynamic/page:leader' }
      });
      nextSyntheticFollower = page('follower', {
        dataset: { sidebarMotionId: 'folder:dynamic/page:follower' }
      });
      nextTarget = collapsedTarget ? collapsedFolder('target') : folder('target', [
        (destinationLeader = page('leader', {
          dataset: { sidebarMotionId: 'folder:target/page:leader' }
        })),
        (destinationFollower = page('follower', {
          dataset: {
            sidebarMotionId: 'folder:target/binding:leader:follower:follower',
            bindingFollowerOf: 'leader'
          }
        })),
        page('target-stationary')
      ]);
      root.replaceChildren(
        folder('dynamic', [nextSyntheticLeader, nextSyntheticFollower]),
        folder('source', []),
        nextTarget
      );
    }, { destinationParentFolderId: 'target' });

    assert.equal(committed, true);
    for (const canonicalRow of [canonicalLeader, canonicalFollower]) {
      assert.equal(
        canonicalRow.animationCalls.some((call) => call.keyframes.at(-1).height === '0px'),
        true,
        `${canonicalRow.dataset.pageId} canonical source occurrence exits at commit`
      );
    }
    assert.equal(
      syntheticFollower.animationCalls.length,
      0,
      'the unchanged synthetic Follower occurrence is not treated as canonical source'
    );
    assert.equal(
      nextSyntheticLeader.animationCalls.some((call) => call.keyframes[0].opacity === 0),
      true,
      'the interacted synthetic Leader occurrence re-enters after canonical render'
    );
    assert.equal(
      nextSyntheticFollower.animationCalls.some((call) => call.keyframes[0].opacity === 0),
      false,
      'the unchanged synthetic Follower is not presented as a moved destination row'
    );

    if (collapsedTarget) {
      assert.equal(nextTarget.pages, undefined);
      assert.equal(nextTarget.button.animationCalls.length, 1);
      assert.equal(destinationLeader, null);
      assert.equal(destinationFollower, null);
    } else {
      assert.deepEqual(nextTarget.pages.children.map((row) => row.dataset.pageId), [
        'leader', 'follower', 'target-stationary'
      ]);
      for (const destinationRow of [destinationLeader, destinationFollower]) {
        assert.equal(
          destinationRow.animationCalls.some((call) => call.keyframes[0].opacity === 0),
          true,
          `${destinationRow.dataset.pageId} destination occurrence enters after commit`
        );
      }
    }
    assert.equal(runtime.body.children.length, 0);
    assert.equal(coordinator.active, false);
  }

  await runScenario({ collapsedTarget: false });
  await runScenario({ collapsedTarget: true });
});

test('invalid navigation drop restores extracted rows and destroys the compact bubble', async () => {
  const moving = page('move');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(moving, page('stationary'));
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event.phase)
  });
  const session = coordinator.beginDrag({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: null }],
    effectivePageIds: ['move'],
    primaryPageId: 'move',
    primaryName: 'Move',
    pointer: { x: 30, y: 30 }
  });

  assert.equal(await coordinator.restoreDrag(session, { reason: 'invalid-target' }), true);
  assert.equal(moving.style.height, '');
  assert.equal(moving.style.opacity, '');
  assert.equal(moving.style.transform, '');
  assert.equal(moving.classList.contains('is-sidebar-membership-exiting-row'), false);
  assert.equal(runtime.body.children.length, 0);
  assert.equal(runtime.body.classList.contains('is-sidebar-membership-move-animating'), false);
  assert.equal(coordinator.active, false);
  assert.deepEqual(traces, [
    'drag-begin', 'drag-restore-start', 'drag-restore-complete', 'cleanup'
  ]);
  assert.equal(moving.animationCalls.length >= 2, true);
  assert.equal(moving.animationCalls.at(-1).keyframes[0].height, '0px');
  assert.equal(moving.animationCalls.at(-1).keyframes.at(-1).height, '20px');
});

test('quick restore resumes from the pending frame while commit keeps the extracted row collapsed until render', async () => {
  const restoreMoving = page('restore-move', { pendingAnimations: true });
  const restoreRoot = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  restoreRoot.append(restoreMoving, page('restore-stationary'));
  const restoreRuntime = fakeRuntime();
  const restoreCoordinator = animationModel.createCoordinator({
    root: restoreRoot,
    ...restoreRuntime,
    sourceDuration: 128,
    targetDuration: 1
  });
  const restoreSession = restoreCoordinator.beginDrag({
    items: [{ type: 'page', id: 'restore-move', sourceParentFolderId: null }],
    effectivePageIds: ['restore-move'],
    primaryPageId: 'restore-move',
    primaryName: 'Restore Move',
    pointer: { x: 20, y: 20 }
  });
  const restoreExtraction = restoreMoving.animationCalls[0];
  assert.equal(restoreExtraction.keyframes[0].height, '20px');
  assert.equal(restoreExtraction.keyframes[0].maxHeight, '20px');
  assert.equal(restoreExtraction.keyframes.at(-1).height, '0px');
  assert.equal(restoreExtraction.keyframes.at(-1).maxHeight, '0px');
  restoreExtraction.animation.currentStyles = {
    height: '11px',
    maxHeight: '11px',
    paddingTop: '2px',
    paddingBottom: '2px',
    opacity: '0.55',
    transform: 'translate3d(0, -1px, 0)'
  };
  restoreMoving.pendingAnimations = false;

  assert.equal(await restoreCoordinator.restoreDrag(restoreSession, {
    reason: 'quick-invalid-drop'
  }), true);
  const restoreAnimation = restoreMoving.animationCalls.at(-1);
  assert.equal(restoreExtraction.animation.commitStylesCalls, 1);
  assert.equal(restoreAnimation.keyframes[0].height, '11px');
  assert.equal(restoreAnimation.keyframes[0].maxHeight, '11px');
  assert.equal(restoreAnimation.keyframes[0].opacity, '0.55');
  assert.notEqual(restoreAnimation.keyframes[0].height, '0px');
  assert.equal(restoreAnimation.keyframes.at(-1).height, '20px');
  assert.equal(restoreAnimation.keyframes.at(-1).maxHeight, '20px');

  const commitMoving = page('commit-move', { pendingAnimations: true });
  const commitRoot = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  commitRoot.append(commitMoving, folder('target', [page('target-stationary')]));
  const commitRuntime = fakeRuntime();
  const commitCoordinator = animationModel.createCoordinator({
    root: commitRoot,
    ...commitRuntime,
    sourceDuration: 128,
    targetDuration: 1
  });
  const commitSession = commitCoordinator.beginDrag({
    items: [{ type: 'page', id: 'commit-move', sourceParentFolderId: null }],
    effectivePageIds: ['commit-move'],
    primaryPageId: 'commit-move',
    primaryName: 'Commit Move',
    pointer: { x: 25, y: 25 }
  });
  const commitExtraction = commitMoving.animationCalls[0];
  commitExtraction.animation.currentStyles = {
    height: '13px',
    maxHeight: '13px',
    opacity: '0.65',
    transform: 'translate3d(0, -1px, 0)'
  };
  commitMoving.pendingAnimations = false;
  let committedHeightAtRender = null;

  assert.equal(await commitCoordinator.commitDrag(commitSession, () => {
    committedHeightAtRender = commitMoving.style.height;
    commitRoot.replaceChildren(folder('target', [
      page('commit-move'), page('target-stationary')
    ]));
  }, { destinationParentFolderId: 'target' }), true);
  assert.equal(commitExtraction.animation.commitStylesCalls, 1);
  assert.equal(committedHeightAtRender, '0px');
  assert.equal(commitCoordinator.active, false);
});

test('session ResizeObserver hands an active drag back to the app owner for smooth restoration', async () => {
  const moving = page('resize-move');
  const root = new FakeElement({
    dataset: { navigationContainerId: 'root' },
    width: 220
  });
  root.append(moving, page('stationary'));
  const runtime = fakeRuntime();
  let restorePromise = null;
  let interruption = null;
  let coordinator = null;
  coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    onInterrupt: ({ session, reason }) => {
      interruption = reason;
      restorePromise = coordinator.restoreDrag(session, { reason });
      return true;
    }
  });
  coordinator.beginDrag({
    items: [{ type: 'page', id: 'resize-move', sourceParentFolderId: null }],
    effectivePageIds: ['resize-move'],
    primaryPageId: 'resize-move',
    primaryName: 'Resize Move',
    pointer: { x: 30, y: 30 }
  });

  assert.equal(runtime.resizeObservers.length, 1);
  const observer = runtime.resizeObservers[0];
  assert.equal(observer.targets.has(root), true);
  observer.trigger(root);
  assert.equal(coordinator.active, true, 'the initial observation does not interrupt the drag');

  root.baseWidth = 268;
  observer.trigger(root);
  assert.equal(interruption, 'sidebar-width-change');
  assert.ok(restorePromise);
  await restorePromise;
  assert.equal(coordinator.active, false);
  assert.equal(observer.disconnected, true);
  assert.equal(moving.style.height, '');
  assert.equal(moving.style.opacity, '');
  assert.equal(moving.classList.contains('is-sidebar-membership-exiting-row'), false);
  assert.equal(runtime.body.children.length, 0);
  assert.equal(runtime.body.classList.contains('is-sidebar-membership-move-animating'), false);
  assert.equal(runtime.listeners.has('resize'), false);
  assert.equal(moving.animationCalls.length, 2,
    'the extraction reverses through the shared row-motion language');
  assert.deepEqual(
    [...runtime.listeners.keys()].filter((type) => type.startsWith('pointer')),
    []
  );
  assert.equal(runtime.requestAnimationFrameCalls(), 0);
});

test('drag commit renders once, opens the expanded target in sorted order, and enters moved rows', async () => {
  const moving = page('beta');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(
    folder('source', [moving, page('source-stationary')]),
    folder('target', [page('alpha'), page('gamma')])
  );
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event.phase)
  });
  const session = coordinator.beginDrag({
    items: [{ type: 'page', id: 'beta', sourceParentFolderId: 'source' }],
    effectivePageIds: ['beta'],
    primaryPageId: 'beta',
    primaryName: 'Beta',
    pointer: { x: 60, y: 60 }
  });
  let renders = 0;
  let inserted = null;
  let shiftedGamma = null;

  const committed = await coordinator.commitDrag(session, () => {
    renders += 1;
    inserted = page('beta');
    shiftedGamma = page('gamma');
    root.replaceChildren(
      folder('source', [page('source-stationary')]),
      folder('target', [page('alpha'), inserted, shiftedGamma])
    );
  }, { destinationParentFolderId: 'target' });

  assert.equal(committed, true);
  assert.equal(renders, 1);
  assert.deepEqual(
    root.children[1].pages.children.map((row) => row.dataset.pageId),
    ['alpha', 'beta', 'gamma'],
    'the rendered comparator result, not pointer position, owns final order'
  );
  assert.equal(inserted.animationCalls.some((call) => call.keyframes[0].opacity === 0), true);
  assert.equal(
    shiftedGamma.animationCalls.some((call) => /translate3d\(0px, -20px, 0\)/.test(
      call.keyframes[0].transform
    )),
    true,
    'existing target rows FLIP to open the sorted destination space'
  );
  assert.equal(runtime.body.children.length, 0);
  assert.equal(coordinator.active, false);
  assert.ok(traces.indexOf('drag-commit') < traces.indexOf('render'));
  assert.ok(traces.indexOf('render') < traces.indexOf('target-start'));
});

test('drag commit into a collapsed Folder keeps it collapsed and animates only its summary', async () => {
  const moving = page('move');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(collapsedFolder('target'), moving);
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    targetDuration: 1
  });
  const session = coordinator.beginDrag({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: null }],
    effectivePageIds: ['move'],
    primaryPageId: 'move',
    primaryName: 'Move',
    pointer: { x: 40, y: 40 }
  });
  let target = null;

  await coordinator.commitDrag(session, () => {
    target = collapsedFolder('target');
    root.replaceChildren(target);
  }, { destinationParentFolderId: 'target' });

  assert.equal(target.pages, undefined, 'motion never invents a hidden destination child list');
  assert.equal(target.button.animationCalls.length, 1);
  assert.equal(root.querySelector('.nav-folder-pages'), null);
  assert.equal(runtime.body.children.length, 0);
});

test('successful visible root-to-folder move runs source exit before sorted target entry', async () => {
  const moving = page('move');
  const stationaryRoot = page('root-stationary');
  const targetBefore = folder('target', [page('zulu')]);
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(moving, stationaryRoot, targetBefore);
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event.phase)
  });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: null }],
    destinationParentFolderId: 'target'
  });
  let rendered = false;
  const completed = await coordinator.play(session, () => {
    rendered = true;
    const targetAfter = folder('target', [page('move'), page('zulu')]);
    root.replaceChildren(page('root-stationary'), targetAfter);
  });

  assert.equal(completed, true);
  assert.equal(rendered, true);
  assert.deepEqual(traces, [
    'captured',
    'source-start',
    'source-complete',
    'render',
    'target-start',
    'target-complete',
    'cleanup'
  ]);
  assert.equal(root.children[1].pages.children[0].dataset.pageId, 'move');
  assert.equal(root.children[1].pages.children[0].animationCalls.length > 0, true);
  assert.equal(moving.animationCalls[0].keyframes.at(-1).height, '0px');
  assert.equal(runtime.body.children.length, 0, 'no detached exit visual is created');
  assert.equal(coordinator.active, false);
});

test('root-to-collapsed-folder closes root and updates only the visible folder summary', async () => {
  const moving = page('move');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(collapsedFolder('target'), moving, page('root-stationary'));
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1
  });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: null }],
    destinationParentFolderId: 'target'
  });
  let renderedTarget = null;
  await coordinator.play(session, () => {
    renderedTarget = collapsedFolder('target');
    root.replaceChildren(renderedTarget, page('root-stationary'));
  });
  assert.equal(renderedTarget.pages, undefined, 'target remains collapsed');
  assert.equal(renderedTarget.button.animationCalls.length, 1, 'folder summary receives one pulse');
  assert.equal(moving.animationCalls[0].keyframes.at(-1).height, '0px');
});

test('expanded-folder-to-root closes the child list before root entry', async () => {
  const moving = page('move');
  const source = folder('source', [moving, page('source-stationary')]);
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(source, page('root-stationary'));
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event.phase)
  });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: 'source' }],
    destinationParentFolderId: null
  });
  let inserted = null;
  await coordinator.play(session, () => {
    inserted = page('move');
    root.replaceChildren(
      folder('source', [page('source-stationary')]),
      inserted,
      page('root-stationary')
    );
  });
  assert.ok(traces.indexOf('source-complete') < traces.indexOf('render'));
  assert.ok(traces.indexOf('render') < traces.indexOf('target-start'));
  assert.equal(moving.animationCalls.length, 1);
  assert.equal(inserted.animationCalls.length, 1);
});

test('expanded-folder-to-expanded-folder uses two distinct visible child phases', async () => {
  const moving = page('move');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(
    folder('source', [moving, page('source-stationary')]),
    folder('target', [page('target-stationary')])
  );
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1
  });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: 'source' }],
    destinationParentFolderId: 'target'
  });
  let inserted = null;
  await coordinator.play(session, () => {
    inserted = page('move');
    root.replaceChildren(
      folder('source', [page('source-stationary')]),
      folder('target', [inserted, page('target-stationary')])
    );
  });
  assert.equal(moving.animationCalls.length, 1);
  assert.equal(inserted.animationCalls.length, 1);
});

test('expanded-folder-to-collapsed-folder animates source plus target summary without reveal', async () => {
  const moving = page('move');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(folder('source', [moving]), collapsedFolder('target'));
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1
  });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: 'source' }],
    destinationParentFolderId: 'target'
  });
  let renderedTarget = null;
  await coordinator.play(session, () => {
    renderedTarget = collapsedFolder('target');
    root.replaceChildren(folder('source', []), renderedTarget);
  });
  assert.equal(moving.animationCalls.length, 1);
  assert.equal(renderedTarget.pages, undefined);
  assert.equal(renderedTarget.button.animationCalls.length, 1);
});

test('collapsed source creates no fake child exit while expanded target receives the row', async () => {
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(collapsedFolder('source'), folder('target', [page('target-stationary')]));
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event)
  });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: 'source' }],
    destinationParentFolderId: 'target'
  });
  let renderedSource = null;
  let inserted = null;
  await coordinator.play(session, () => {
    renderedSource = collapsedFolder('source');
    inserted = page('move');
    root.replaceChildren(
      renderedSource,
      folder('target', [inserted, page('target-stationary')])
    );
  });
  const sourceComplete = traces.find((event) => event.phase === 'source-complete');
  assert.equal(sourceComplete.details.visibleExits, 0);
  assert.equal(renderedSource.pages, undefined);
  assert.equal(inserted.animationCalls.length, 1);
  assert.equal(runtime.body.children.length, 0);
});

test('folder membership moves animate by stable folder id for root and nested targets', async () => {
  const movingToRoot = folder('moving-root', []);
  const parent = folder('parent', [movingToRoot]);
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(parent);
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1
  });
  const rootSession = coordinator.capture({
    items: [{ type: 'folder', id: 'moving-root', sourceParentFolderId: 'parent' }],
    destinationParentFolderId: null
  });
  let insertedAtRoot = null;
  await coordinator.play(rootSession, () => {
    insertedAtRoot = folder('moving-root', []);
    root.replaceChildren(insertedAtRoot, folder('parent', []));
  });
  assert.equal(movingToRoot.animationCalls.length, 1);
  assert.equal(insertedAtRoot.button.animationCalls.length, 1);

  const movingNested = insertedAtRoot;
  root.replaceChildren(
    folder('source', [movingNested]),
    folder('target', [page('target-stationary')])
  );
  const nestedSession = coordinator.capture({
    items: [{ type: 'folder', id: 'moving-root', sourceParentFolderId: 'source' }],
    destinationParentFolderId: 'target'
  });
  let insertedNested = null;
  await coordinator.play(nestedSession, () => {
    insertedNested = folder('moving-root', []);
    root.replaceChildren(
      folder('source', []),
      folder('target', [insertedNested, page('target-stationary')])
    );
  });
  assert.equal(insertedNested.button.animationCalls.length, 1);
  assert.equal(animationModel.rowId(insertedNested), 'folder:moving-root');
});

test('successful Page and Folder creation enters only at the canonical sorted position', async () => {
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(page('alpha'), page('gamma'));
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event.phase)
  });
  const pageSession = coordinator.captureMutation({
    enteringItems: [{ type: 'page', id: 'beta' }]
  });
  let insertedPage = null;
  let shiftedGamma = null;
  await coordinator.playMutation(pageSession, () => {
    insertedPage = page('beta');
    shiftedGamma = page('gamma');
    root.replaceChildren(page('alpha'), insertedPage, shiftedGamma);
  });

  assert.deepEqual(root.children.map((row) => row.dataset.pageId), ['alpha', 'beta', 'gamma']);
  assert.equal(insertedPage.animationCalls[0].keyframes[0].opacity, 0);
  assert.equal(
    shiftedGamma.animationCalls.some((call) => /translate3d\(0px, -20px, 0\)/.test(
      call.keyframes[0].transform
    )),
    true,
    'existing rows open space around the final sorted Page position'
  );
  assert.equal(traces.includes('mutation-source-start'), false, 'creation has no fake exit');

  const folderSession = coordinator.captureMutation({
    enteringItems: [{ type: 'folder', id: 'delta' }]
  });
  let insertedFolder = null;
  await coordinator.playMutation(folderSession, () => {
    insertedFolder = collapsedFolder('delta');
    root.replaceChildren(page('alpha'), page('beta'), insertedFolder, page('gamma'));
  });
  assert.equal(insertedFolder.button.animationCalls[0].keyframes[0].opacity, 0);
  assert.equal(coordinator.active, false);
});

test('deleting an expanded Folder closes its complete visible subtree as one coherent region', async () => {
  const nestedPage = page('nested-page');
  const expanded = folder('delete-me', [
    page('child-page'),
    folder('nested-folder', [nestedPage], { height: 40, regionHeight: 20 })
  ], { height: 80, regionHeight: 60 });
  const below = page('below');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(expanded, below);
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    sourceDuration: 1,
    phaseGap: 1,
    targetDuration: 1,
    onTrace: (event) => traces.push(event.phase)
  });
  const session = coordinator.captureMutation({
    exitingItems: [
      { type: 'folder', id: 'delete-me' },
      { type: 'page', id: 'child-page' },
      { type: 'page', id: 'nested-page' }
    ]
  });
  await coordinator.playMutation(session, () => root.replaceChildren(page('below')));

  assert.equal(expanded.animationCalls.length, 1, 'one outer Folder region owns the exit');
  assert.equal(expanded.animationCalls[0].keyframes.at(-1).height, '0px');
  assert.equal(expanded.pages.animationCalls.length, 0, 'the child region does not animate separately');
  assert.equal(nestedPage.animationCalls.length, 0, 'descendants do not stagger independently');
  assert.ok(traces.indexOf('mutation-source-complete') < traces.indexOf('render'));
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].dataset.pageId, 'below');
  assert.equal(coordinator.active, false);
});

test('create/delete reuse membership row phases while skipping only the move phase gap', async () => {
  const phaseGap = 777;
  const timedRuntime = () => {
    const runtime = fakeRuntime();
    const timerDelays = [];
    runtime.windowRef.setTimeout = (callback, delay = 0) => {
      timerDelays.push(delay);
      return setTimeout(callback, 0);
    };
    runtime.windowRef.clearTimeout = clearTimeout;
    return { runtime, timerDelays };
  };

  const deletingRow = page('beta');
  const deleteRoot = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  deleteRoot.append(page('alpha'), deletingRow, page('gamma'));
  const deleteTiming = timedRuntime();
  const deleteTraces = [];
  const deleteCoordinator = animationModel.createCoordinator({
    root: deleteRoot,
    ...deleteTiming.runtime,
    sourceDuration: 1,
    phaseGap,
    targetDuration: 1,
    onTrace: (event) => deleteTraces.push(event.phase)
  });
  await deleteCoordinator.playMutation(deleteCoordinator.captureMutation({
    exitingItems: [{ type: 'page', id: 'beta' }]
  }), () => deleteRoot.replaceChildren(page('alpha'), page('gamma')));

  assert.equal(deleteTiming.timerDelays.includes(phaseGap), false,
    'simple deletion renders immediately after its full source exit');
  assert.ok(deleteTraces.indexOf('mutation-source-complete')
    < deleteTraces.indexOf('render'));

  const movingRow = page('beta');
  const moveRoot = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  moveRoot.append(page('alpha'), movingRow, page('gamma'), folder('target', [page('delta')]));
  const moveTiming = timedRuntime();
  const moveCoordinator = animationModel.createCoordinator({
    root: moveRoot,
    ...moveTiming.runtime,
    sourceDuration: 1,
    phaseGap,
    targetDuration: 1
  });
  const moveSession = moveCoordinator.capture({
    items: [{ type: 'page', id: 'beta', sourceParentFolderId: null }],
    destinationParentFolderId: 'target'
  });
  let movedInsertion = null;
  await moveCoordinator.play(moveSession, () => {
    movedInsertion = page('beta');
    moveRoot.replaceChildren(
      page('alpha'),
      page('gamma'),
      folder('target', [movedInsertion, page('delta')])
    );
  });

  assert.equal(moveTiming.timerDelays.includes(phaseGap), true,
    'membership movement retains its accepted two-phase gap');
  assert.deepEqual(
    deletingRow.animationCalls[0].keyframes,
    movingRow.animationCalls[0].keyframes,
    'delete uses the exact membership source-extraction keyframes'
  );
  assert.deepEqual(
    deletingRow.animationCalls[0].options,
    movingRow.animationCalls[0].options,
    'delete uses the exact membership source-extraction timing and easing'
  );

  const createRoot = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  createRoot.append(page('alpha'), page('gamma'));
  const createTiming = timedRuntime();
  const createCoordinator = animationModel.createCoordinator({
    root: createRoot,
    ...createTiming.runtime,
    sourceDuration: 1,
    phaseGap,
    targetDuration: 1
  });
  let createdInsertion = null;
  await createCoordinator.playMutation(createCoordinator.captureMutation({
    enteringItems: [{ type: 'page', id: 'beta' }]
  }), () => {
    createdInsertion = page('beta');
    createRoot.replaceChildren(page('alpha'), createdInsertion, page('gamma'));
  });

  assert.equal(createTiming.timerDelays.includes(phaseGap), false);
  assert.deepEqual(
    createdInsertion.animationCalls[0].keyframes,
    movedInsertion.animationCalls[0].keyframes,
    'create uses the exact membership destination-entry keyframes'
  );
  assert.deepEqual(
    createdInsertion.animationCalls[0].options,
    movedInsertion.animationCalls[0].options,
    'create uses the exact membership destination-entry timing and easing'
  );
});

test('create/delete settlement carries Folder empty hints with neighboring rows', async () => {
  const runMutation = async ({ enteringItems = [], exitingItems = [], beforeTop, afterTop }) => {
    const beforeHint = emptyHint();
    const beforeLower = folder('lower', [beforeHint], { height: 40, top: beforeTop });
    beforeLower.pages.baseTop = beforeTop + 30;
    const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
    const deleting = exitingItems.length ? page('delete-me') : null;
    root.append(...(deleting ? [deleting] : []), beforeLower);
    const runtime = fakeRuntime();
    const coordinator = animationModel.createCoordinator({ root, ...runtime });
    let afterHint = null;
    let afterLower = null;
    const session = coordinator.captureMutation({ enteringItems, exitingItems });

    assert.equal(await coordinator.playMutation(session, () => {
      afterHint = emptyHint();
      afterLower = folder('lower', [afterHint], { height: 40, top: afterTop });
      afterLower.pages.baseTop = afterTop + 30;
      root.replaceChildren(...(enteringItems.length ? [page('created')] : []), afterLower);
    }), true);

    const headerFlip = afterLower.button.animationCalls.find((call) => (
      call.keyframes[0].transform !== 'translate3d(0, 0, 0)'
    ));
    const hintFlip = afterHint.animationCalls.find((call) => (
      call.keyframes[0].transform !== 'translate3d(0, 0, 0)'
    ));
    assert.ok(headerFlip);
    assert.ok(hintFlip);
    assert.deepEqual(hintFlip.keyframes, headerFlip.keyframes);
    assert.deepEqual(hintFlip.options, headerFlip.options);
  };

  await runMutation({
    enteringItems: [{ type: 'page', id: 'created' }],
    beforeTop: 20,
    afterTop: 40
  });
  await runMutation({
    exitingItems: [{ type: 'page', id: 'delete-me' }],
    beforeTop: 40,
    afterTop: 20
  });
});

test('a superseding mutation renders the prior canonical result and clears all stale exit styles', async () => {
  const deleting = page('delete', { pendingAnimations: true });
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(deleting, page('stationary'));
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({ root, ...runtime });
  let deleteRenders = 0;
  const deletingSession = coordinator.captureMutation({
    exitingItems: [{ type: 'page', id: 'delete' }]
  });
  const deletingPromise = coordinator.playMutation(deletingSession, () => {
    deleteRenders += 1;
    root.replaceChildren(page('stationary'));
  });
  await Promise.resolve();

  const creatingSession = coordinator.captureMutation({
    enteringItems: [{ type: 'page', id: 'created' }]
  });
  let inserted = null;
  await coordinator.playMutation(creatingSession, () => {
    inserted = page('created');
    root.replaceChildren(inserted, page('stationary'));
  });
  assert.equal(await deletingPromise, false);
  assert.equal(deleteRenders, 1, 'interruption still commits the successful canonical deletion render');
  assert.equal(deleting.classList.contains('is-sidebar-membership-exiting-row'), false);
  assert.equal(deleting.style.height, '');
  assert.equal(inserted.animationCalls.length, 1);
  assert.equal(runtime.body.classList.contains('is-sidebar-membership-move-animating'), false);
  assert.equal(coordinator.active, false);
});

test('Folder expansion reveals one coherent region and moves lower stable rows', async () => {
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(collapsedFolder('parent', { height: 20 }), page('below'));
  const runtime = fakeRuntime();
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    targetDuration: 1,
    onTrace: (event) => traces.push(event.phase)
  });
  let expanded = null;
  let below = null;
  let nestedPage = null;

  const completed = await coordinator.playDisclosure({
    folderId: 'parent',
    expanding: true,
    render: () => {
      nestedPage = page('nested-page');
      expanded = folder('parent', [
        page('child-page'),
        folder('nested-folder', [nestedPage], { height: 40, regionHeight: 20 })
      ], { height: 80, regionHeight: 60 });
      below = page('below');
      root.replaceChildren(expanded, below);
    }
  });

  assert.equal(completed, true);
  assert.equal(expanded.pages.animationCalls.length, 1);
  assert.deepEqual(expanded.pages.animationCalls[0].keyframes.map((frame) => frame.clipPath), [
    'inset(0 0 100% 0)', 'inset(0 0 0 0)'
  ]);
  assert.equal(nestedPage.animationCalls.length, 0, 'nested descendants do not waterfall independently');
  assert.equal(
    below.animationCalls.some((call) => /translate3d\(0px, -60px, 0\)/.test(
      call.keyframes[0].transform
    )),
    true
  );
  assert.deepEqual(traces, [
    'disclosure-start', 'render', 'disclosure-complete', 'cleanup'
  ]);
  assert.equal(coordinator.active, false);
});

test('Folder empty hints share the exact stable-row FLIP instead of jumping ahead', async () => {
  const beforeHint = emptyHint();
  const beforeLower = folder('lower', [beforeHint], { height: 40, top: 20 });
  beforeLower.pages.baseTop = 50;
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(collapsedFolder('parent', { height: 20 }), beforeLower);
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({ root, ...runtime });
  let afterHint = null;
  let afterLower = null;

  assert.equal(await coordinator.playDisclosure({
    folderId: 'parent',
    expanding: true,
    render: () => {
      const expanded = folder('parent', [page('child')], {
        height: 80,
        regionHeight: 60
      });
      afterHint = emptyHint();
      afterLower = folder('lower', [afterHint], { height: 40, top: 80 });
      afterLower.pages.baseTop = 110;
      root.replaceChildren(expanded, afterLower);
    }
  }), true);

  const headerFlip = afterLower.button.animationCalls.find((call) => (
    call.keyframes[0].transform === 'translate3d(0px, -60px, 0)'
  ));
  const hintFlip = afterHint.animationCalls.find((call) => (
    call.keyframes[0].transform === 'translate3d(0px, -60px, 0)'
  ));
  assert.ok(headerFlip, 'the neighboring Folder header receives its stable-row FLIP');
  assert.ok(hintFlip, 'the existing empty hint receives the same inverse geometry');
  assert.deepEqual(hintFlip.keyframes, headerFlip.keyframes);
  assert.deepEqual(hintFlip.options, headerFlip.options);
  assert.equal(afterHint.classList.contains('is-sidebar-membership-animated-row'), false);
  assert.equal(coordinator.active, false);
});

test('nested Folder collapse closes its complete visible descendant region as one area', async () => {
  const nestedPage = page('nested-page');
  const nested = folder('nested-folder', [nestedPage], { height: 40, regionHeight: 20 });
  const expanded = folder('parent', [page('child-page'), nested], {
    height: 80,
    regionHeight: 60
  });
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(expanded, page('below'));
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({ root, ...runtime, targetDuration: 1 });
  let collapsed = null;

  const completed = await coordinator.playDisclosure({
    folderId: 'parent',
    expanding: false,
    render: () => {
      collapsed = collapsedFolder('parent', { height: 20 });
      root.replaceChildren(collapsed, page('below'));
    }
  });

  assert.equal(completed, true);
  assert.equal(expanded.pages.animationCalls.length, 1);
  assert.equal(expanded.pages.animationCalls[0].keyframes[0].height, '60px');
  assert.equal(expanded.pages.animationCalls[0].keyframes.at(-1).height, '0px');
  assert.equal(expanded.pages.animationCalls[0].keyframes.at(-1).clipPath, 'inset(0 0 100% 0)');
  assert.equal(nested.pages.animationCalls.length, 0);
  assert.equal(nestedPage.animationCalls.length, 0);
  assert.equal(collapsed.pages, undefined);
  assert.equal(coordinator.active, false);
});

test('custom disclosure owners reuse the exact Sidebar region choreography and scoped classes', async () => {
  const root = new FakeElement();
  const runtime = fakeRuntime();
  let region = null;
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    activityClass: 'is-right-sidebar-fold-animating',
    visibilityClass: 'right-sidebar-collapsed',
    resolveDisclosureRegion: (foldId) => (
      region?.dataset?.rightFoldRegion === foldId ? region : null
    )
  });

  let renders = 0;
  assert.equal(await coordinator.playDisclosure({
    folderId: 'right-relation:link-type-a',
    expanding: true,
    render: () => {
      renders += 1;
      region = new FakeElement({
        dataset: { rightFoldRegion: 'right-relation:link-type-a' },
        height: 48
      });
      root.replaceChildren(region);
    }
  }), true);
  assert.equal(renders, 1);
  assert.equal(region.animationCalls.length, 1);
  assert.deepEqual(
    region.animationCalls[0].keyframes.map((frame) => frame.clipPath),
    ['inset(0 0 100% 0)', 'inset(0 0 0 0)']
  );
  assert.equal(region.animationCalls[0].options.duration, animationModel.DISCLOSURE_DURATION_MS);
  assert.equal(region.animationCalls[0].options.easing, 'cubic-bezier(.2, .75, .25, 1)');
  assert.equal(runtime.body.classList.contains('is-right-sidebar-fold-animating'), false);
  assert.equal(runtime.body.classList.contains('is-sidebar-membership-move-animating'), false);

  const collapsingRegion = region;
  assert.equal(await coordinator.playDisclosure({
    folderId: 'right-relation:link-type-a',
    expanding: false,
    render: () => {
      renders += 1;
      region = null;
      root.replaceChildren();
    }
  }), true);
  assert.equal(renders, 2);
  assert.deepEqual(
    collapsingRegion.animationCalls.at(-1).keyframes.map((frame) => frame.height),
    ['48px', '0px']
  );
  assert.deepEqual(
    collapsingRegion.animationCalls.at(-1).keyframes.map((frame) => frame.opacity),
    [1, 0]
  );
  assert.equal(coordinator.active, false);
});

test('rapid disclosure interruption renders the latest state once and clears every effect', async () => {
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(collapsedFolder('parent'), page('below'));
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({ root, ...runtime });
  let expanded = null;
  let expandRenders = 0;
  let collapseRenders = 0;

  const expanding = coordinator.playDisclosure({
    folderId: 'parent',
    expanding: true,
    render: () => {
      expandRenders += 1;
      expanded = folder('parent', [page('child')], {
        height: 60,
        regionHeight: 40,
        regionPendingAnimations: true
      });
      root.replaceChildren(expanded, page('below'));
    }
  });
  await Promise.resolve();
  const collapsing = coordinator.playDisclosure({
    folderId: 'parent',
    expanding: false,
    render: () => {
      collapseRenders += 1;
      root.replaceChildren(collapsedFolder('parent'), page('below'));
    }
  });
  await Promise.resolve();
  assert.equal(coordinator.cancel('rapid-toggle-test'), true);
  assert.equal(await expanding, false);
  assert.equal(await collapsing, false);
  await Promise.resolve();

  assert.equal(expandRenders, 1);
  assert.equal(collapseRenders, 1, 'interrupted collapse still reconciles its required render');
  assert.equal(runtime.body.classList.contains('is-sidebar-membership-move-animating'), false);
  assert.equal(runtime.listeners.has('resize'), false);
  assert.equal(expanded.pages.classList.contains('is-sidebar-membership-animated-row'), false);
  assert.equal(coordinator.active, false);
});

test('reduced motion applies drag extraction immediately and skips row animations', () => {
  const moving = page('move');
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(moving, page('stationary'));
  const runtime = fakeRuntime({ reducedMotion: true });
  const coordinator = animationModel.createCoordinator({ root, ...runtime });
  const session = coordinator.beginDrag({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: null }],
    effectivePageIds: ['move'],
    primaryPageId: 'move',
    primaryName: 'Move',
    pointer: { x: 10, y: 10 }
  });

  assert.equal(moving.style.height, '0px');
  assert.equal(moving.style.opacity, '0');
  assert.equal(moving.animationCalls.length, 0);
  assert.equal(coordinator.handoffDrag(session), true);
  assert.equal(moving.style.height, '');
  assert.equal(runtime.body.children.length, 0);
});

test('reduced-motion Binding Leader commit reconciles the whole group immediately into a collapsed target', async () => {
  const leader = page('leader');
  const follower = page('follower', { dataset: { bindingFollowerOf: 'leader' } });
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(leader, follower, collapsedFolder('target'));
  const runtime = fakeRuntime({ reducedMotion: true });
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    onTrace: (event) => traces.push(event.phase)
  });
  const session = coordinator.beginDrag({
    items: [{ type: 'page', id: 'leader', sourceParentFolderId: null }],
    effectivePageIds: ['leader', 'follower'],
    extractPageIds: ['leader'],
    deferredPageIds: ['follower'],
    primaryPageId: 'leader',
    primaryName: 'Leader',
    pointer: { x: 10, y: 10 }
  });
  assert.equal(leader.style.height, '0px');
  assert.notEqual(follower.style.height, '0px');

  let renderedTarget = null;
  assert.equal(await coordinator.commitDrag(session, () => {
    renderedTarget = collapsedFolder('target');
    root.replaceChildren(renderedTarget);
  }, { destinationParentFolderId: 'target' }), true);
  assert.deepEqual(traces, ['drag-begin', 'reduced-motion-render', 'cleanup']);
  assert.equal(leader.animationCalls.length, 0);
  assert.equal(follower.animationCalls.length, 0);
  assert.equal(renderedTarget.pages, undefined);
  assert.equal(renderedTarget.button.animationCalls.length, 0);
  assert.equal(coordinator.active, false);
});

test('reduced-motion disclosure performs exactly one immediate render', async () => {
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(collapsedFolder('parent'));
  const runtime = fakeRuntime({ reducedMotion: true });
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    onTrace: (event) => traces.push(event.phase)
  });
  let renders = 0;
  let expanded = null;
  const completed = await coordinator.playDisclosure({
    folderId: 'parent',
    expanding: true,
    render: () => {
      renders += 1;
      expanded = folder('parent', [page('child')]);
      root.replaceChildren(expanded);
    }
  });

  assert.equal(completed, true);
  assert.equal(renders, 1);
  assert.equal(expanded.pages.animationCalls.length, 0);
  assert.deepEqual(traces, ['reduced-motion-render', 'cleanup']);
  assert.equal(coordinator.active, false);
});

test('reduced motion commits the sorted render without source or target animation', async () => {
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  const moving = page('move');
  root.append(moving);
  const runtime = fakeRuntime({ reducedMotion: true });
  const traces = [];
  const coordinator = animationModel.createCoordinator({
    root,
    ...runtime,
    onTrace: (event) => traces.push(event.phase)
  });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: null }],
    destinationParentFolderId: 'target'
  });
  await coordinator.play(session, () => root.replaceChildren());
  assert.deepEqual(traces, ['captured', 'reduced-motion-render', 'cleanup']);
  assert.equal(moving.animationCalls.length, 0);
  assert.equal(runtime.body.children.length, 0);
});

test('interruption restores the live row and removes animation classes cleanly', async () => {
  const moving = page('move', { pendingAnimations: true });
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(moving, page('stationary', { pendingAnimations: true }));
  const runtime = fakeRuntime();
  const coordinator = animationModel.createCoordinator({ root, ...runtime });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: null }],
    destinationParentFolderId: 'target'
  });
  const playing = coordinator.play(session, () => {});
  await Promise.resolve();
  assert.equal(coordinator.cancel('test-interruption'), true);
  assert.equal(await playing, false);
  assert.equal(moving.style.display, '');
  assert.equal(runtime.body.children.length, 0);
  assert.equal(runtime.body.classList.contains('is-sidebar-membership-move-animating'), false);
  assert.equal(coordinator.active, false);
});

test('sidebar visibility interruption cancels effects and commits the final render once', async () => {
  const moving = page('move', { pendingAnimations: true });
  const root = new FakeElement({ dataset: { navigationContainerId: 'root' } });
  root.append(moving, page('stationary', { pendingAnimations: true }));
  const runtime = fakeRuntime();
  let observer = null;
  runtime.windowRef.MutationObserver = class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe() {}
    disconnect() { this.disconnected = true; }
    trigger() { this.callback(); }
  };
  const coordinator = animationModel.createCoordinator({ root, ...runtime });
  const session = coordinator.capture({
    items: [{ type: 'page', id: 'move', sourceParentFolderId: null }],
    destinationParentFolderId: 'target'
  });
  let renders = 0;
  const playing = coordinator.play(session, () => {
    renders += 1;
    root.replaceChildren(page('stationary'));
  });
  await Promise.resolve();
  runtime.body.classList.add('left-sidebar-collapsed');
  observer.trigger();
  assert.equal(await playing, false);
  assert.equal(renders, 1);
  assert.equal(observer.disconnected, true);
  assert.equal(runtime.body.classList.contains('is-sidebar-membership-move-animating'), false);
  assert.equal(coordinator.active, false);
});

test('membership motion retains its facade while disclosure choreography has one neutral owner', async () => {
  const [navigation, moduleSource, disclosureSource, rightSidebar, css, html, app, drag] = await Promise.all([
    read('public/js/navigation.js'),
    read('public/sidebarMembershipMoveAnimation.js'),
    read('public/disclosureMotion.js'),
    read('public/js/rightSidebar.js'),
    read('public/styles.css'),
    read('public/index.html'),
    read('public/app.js'),
    read('public/sidebarPageDrag.js')
  ]);
  assert.match(html, /disclosureMotion\.js\?v=disclosure-motion-v01/);
  assert.match(html, /sidebarMembershipMoveAnimation\.js\?v=sidebar-drag-folder-motion-v02/);
  assert.ok(html.indexOf('disclosureMotion.js') < html.indexOf('sidebarMembershipMoveAnimation.js'));
  assert.match(navigation, /navigationMembershipParentFolderId/);
  assert.equal(
    (navigation.match(/sidebarMembershipMoveAnimationModel\.createCoordinator/g) || []).length,
    1
  );
  assert.match(navigation, /function beginSidebarPageNavigationDrag[\s\S]*?sidebarMembershipMoveAnimator\?\.beginDrag/);
  assert.match(navigation, /onInterrupt: \(\{ reason \}\) => \([\s\S]*?cancelSidebarPageDrag\(\{ immediate: reason === 'sidebar-visibility-change' \}\)/);
  assert.match(navigation, /function interruptSidebarMembershipMoveAnimation[\s\S]*?cancelSidebarPageDrag\(\{ immediate: false \}\)/);
  assert.match(navigation, /function updateSidebarPageNavigationDragPointer[\s\S]*?sidebarMembershipMoveAnimator\?\.updateDragPointer/);
  assert.match(navigation, /function restoreSidebarPageNavigationDrag[\s\S]*?sidebarMembershipMoveAnimator\?\.restoreDrag/);
  assert.match(navigation, /function handoffSidebarPageNavigationDragToPreview[\s\S]*?sidebarMembershipMoveAnimator\?\.handoffDrag/);
  assert.match(navigation, /function toggleNavigationFolder[\s\S]*?sidebarMembershipMoveAnimator\?\.playDisclosure/);
  assert.match(navigation, /if \(moved\.changed === false\) \{[\s\S]*?renderPageList\(\{ membershipAnimationRender: true \}\)[\s\S]*?return false/);
  assert.match(navigation, /if \(motionSession\) \{[\s\S]*?sidebarMembershipMoveAnimator\?\.commitDrag/);
  assert.match(navigation, /await sidebarMembershipMoveAnimator\.play\([\s\S]*?renderPageList\(\{ membershipAnimationRender: true \}\)/);
  assert.match(navigation, /folderPageList\.dataset\.navigationContainerId = `folder:\$\{folder\.id\}`/);
  assert.match(navigation, /button\.dataset\.sidebarMotionId/);
  assert.match(navigation, /folderButton\.dataset\.sidebarMotionId/);
  assert.match(navigation, /folderPageList\.dataset\.sidebarMotionRegion/);
  assert.match(navigation, /interruptSidebarMembershipMoveAnimation\('rerender'\)/);
  assert.doesNotMatch(navigation, /destination[\s\S]{0,100}\bindex\b/);
  assert.doesNotMatch(navigation, /nav-insert-indicator/);
  assert.doesNotMatch(css, /\.nav-insert-indicator/);
  assert.match(css, /\.is-sidebar-membership-exiting-row/);
  assert.doesNotMatch(css, /sidebar-membership-exit-ghost/);
  assert.match(moduleSource, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(moduleSource, /cloneNode|ghost/);
  assert.doesNotMatch(moduleSource, /\b(?:fetch|request)\s*\(|localStorage|indexedDB|pageBinding/);
  assert.match(moduleSource, /disclosureMotionModel\?\.createController/);
  assert.doesNotMatch(moduleSource, /clipPath: 'inset\(0 0 100% 0\)'/);
  assert.match(disclosureSource, /async function play\(\{ disclosureId, expanding, render \}/);
  assert.match(disclosureSource, /clipPath: 'inset\(0 0 100% 0\)'/);
  assert.doesNotMatch(disclosureSource, /beginDrag|commitDrag|captureMutation|drag-stack/);
  assert.match(rightSidebar, /disclosureMotionModel\.createController/);
  assert.doesNotMatch(rightSidebar, /sidebarMembershipMoveAnimationModel/);
  assert.match(moduleSource, /className = 'sidebar-membership-drag-stack file-typography'/);
  assert.match(moduleSource, /suffix\.textContent = ` · \$\{count\} files`/);
  assert.doesNotMatch(moduleSource, /等|个文件/);
  for (const method of [
    'beginDrag', 'updateDragPointer', 'restoreDrag', 'handoffDrag', 'commitDrag',
    'capture', 'play', 'playDisclosure', 'cancel'
  ]) {
    assert.match(moduleSource, new RegExp(`\\b${method}\\b`));
  }
  assert.match(moduleSource, /async function playSourcePhase/);
  assert.match(moduleSource, /async function playTargetPhase/);
  assert.match(moduleSource, /async function runMoveChoreography\(session, sourcePhase\)[\s\S]*?const sourceAnimated = await sourcePhase\(\)[\s\S]*?invokeRender\(session, 'render'\)[\s\S]*?await playTargetPhase\(session, beforeTarget\)/);
  assert.match(moduleSource, /return await runMoveChoreography\(session, \(\) => playSourcePhase\(session\)\)/);
  assert.match(moduleSource, /return await runMoveChoreography\([\s\S]*?\(\) => playDragCommitSourcePhase\(session, pointerFrames\)/);
  assert.doesNotMatch(moduleSource, /canvas|pane-edge|tab-strip|invalid-return|Preview/);
  assert.match(app, /function transitionSidebarPageDragToPreview[\s\S]*?handoffSidebarPageNavigationDragToPreview[\s\S]*?prepareSharedPageDragPreview/);
  assert.match(app, /function beginSidebarPageDragReturn/);
  assert.match(drag, /function nextPhase/);
});
