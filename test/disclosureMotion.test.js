const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const disclosureMotionModel = require('../public/disclosureMotion');

const read = (file) => fs.readFile(path.join(__dirname, '..', file), 'utf8');

class FakeClassList {
  constructor() { this.names = new Set(); }
  add(...names) { names.forEach((name) => this.names.add(name)); }
  remove(...names) { names.forEach((name) => this.names.delete(name)); }
  contains(name) { return this.names.has(name); }
}

class FakeAnimation {
  constructor({ pending = false } = {}) {
    this.cancelled = false;
    this.settled = false;
    this.finished = pending
      ? new Promise((resolve) => { this.resolve = resolve; })
      : Promise.resolve();
  }
  cancel() {
    if (this.settled) return;
    this.cancelled = true;
    this.settled = true;
    this.resolve?.();
  }
  finish() {
    if (this.settled) return;
    this.settled = true;
    this.resolve?.();
  }
}

class FakeElement {
  constructor({ motionId = '', regionId = '', height = 20, pendingAnimations = false } = {}) {
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    if (motionId) this.dataset.motionId = motionId;
    if (regionId) this.dataset.regionId = regionId;
    this.baseHeight = height;
    this.baseWidth = 180;
    this.pendingAnimations = pendingAnimations;
    this.animationCalls = [];
    this.classList = new FakeClassList();
    this.style = {};
  }
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
  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }
  getBoundingClientRect() {
    const inlineHeight = Number.parseFloat(this.style.height);
    const height = Number.isFinite(inlineHeight) ? inlineHeight : this.baseHeight;
    let top = 0;
    if (this.parentElement) {
      top = this.parentElement.getBoundingClientRect().top;
      for (const sibling of this.parentElement.children) {
        if (sibling === this) break;
        top += sibling.getBoundingClientRect().height;
      }
    }
    return {
      left: 0,
      right: this.baseWidth,
      top,
      bottom: top + height,
      width: this.baseWidth,
      height
    };
  }
  animate(keyframes, options) {
    const animation = new FakeAnimation({ pending: this.pendingAnimations });
    this.animationCalls.push({ keyframes, options, animation });
    return animation;
  }
}

function fakeRuntime({ reducedMotion = false } = {}) {
  const body = new FakeElement({ height: 800 });
  const listeners = new Map();
  const observers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  }
  const documentRef = { body };
  const windowRef = {
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: () => ({
      marginTop: '0px',
      paddingTop: '4px',
      paddingBottom: '4px'
    }),
    ResizeObserver: FakeResizeObserver,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    setTimeout,
    clearTimeout
  };
  return { body, documentRef, listeners, observers, windowRef };
}

function createController(root, runtime, resolveRegion) {
  return disclosureMotionModel.createController({
    root,
    ...runtime,
    resolveRegion,
    resolveStableId: (element) => element?.dataset?.motionId || null
  });
}

test('the extracted primitive preserves exact reveal, collapse, and sibling-FLIP frames', async () => {
  const root = new FakeElement({ height: 100 });
  root.append(
    new FakeElement({ motionId: 'heading' }),
    new FakeElement({ motionId: 'below' })
  );
  const runtime = fakeRuntime();
  let region = null;
  let expandedBelow = null;
  const controller = createController(root, runtime, (id) => (
    region?.dataset?.regionId === id ? region : null
  ));

  assert.equal(await controller.play({
    disclosureId: 'group-a',
    expanding: true,
    render: () => {
      region = new FakeElement({ regionId: 'group-a', height: 40 });
      expandedBelow = new FakeElement({ motionId: 'below' });
      root.replaceChildren(
        new FakeElement({ motionId: 'heading' }),
        region,
        expandedBelow
      );
    }
  }), true);

  assert.deepEqual(region.animationCalls[0].keyframes, [
    { clipPath: 'inset(0 0 100% 0)', opacity: 0, transform: 'translate3d(0, -4px, 0)' },
    { clipPath: 'inset(0 0 0 0)', opacity: 1, transform: 'translate3d(0, 0, 0)' }
  ]);
  assert.deepEqual(region.animationCalls[0].options, {
    duration: 176,
    easing: 'cubic-bezier(.2, .75, .25, 1)'
  });
  const siblingFlip = expandedBelow.animationCalls.find((call) => (
    call.keyframes[0].transform === 'translate3d(0px, -40px, 0)'
  ));
  assert.ok(siblingFlip);
  assert.deepEqual(siblingFlip.options, {
    duration: 168,
    easing: 'cubic-bezier(.2, .75, .25, 1)'
  });

  const collapsingRegion = region;
  assert.equal(await controller.play({
    disclosureId: 'group-a',
    expanding: false,
    render: () => {
      region = null;
      root.replaceChildren(
        new FakeElement({ motionId: 'heading' }),
        new FakeElement({ motionId: 'below' })
      );
    }
  }), true);

  assert.deepEqual(collapsingRegion.animationCalls.at(-1).keyframes, [{
    boxSizing: 'border-box',
    height: '40px',
    marginTop: '0px',
    paddingTop: '4px',
    paddingBottom: '4px',
    clipPath: 'inset(0 0 0 0)',
    opacity: 1
  }, {
    boxSizing: 'border-box',
    height: '0px',
    marginTop: '0px',
    paddingTop: '0px',
    paddingBottom: '0px',
    clipPath: 'inset(0 0 100% 0)',
    opacity: 0
  }]);
  assert.deepEqual(collapsingRegion.animationCalls.at(-1).options, {
    duration: 176,
    easing: 'cubic-bezier(.2, .75, .25, 1)',
    fill: 'both'
  });
  assert.equal(controller.active, false);
  assert.equal(runtime.listeners.has('resize'), false);
  assert.equal(runtime.body.classList.contains('is-disclosure-motion-animating'), false);
});

test('separate controllers retain independent sessions and deterministic cancellation', async () => {
  const leftRoot = new FakeElement({ height: 100 });
  const rightRoot = new FakeElement({ height: 100 });
  const leftRuntime = fakeRuntime();
  const rightRuntime = fakeRuntime();
  let leftRegion = null;
  let rightRegion = null;
  const left = createController(leftRoot, leftRuntime, () => leftRegion);
  const right = createController(rightRoot, rightRuntime, () => rightRegion);

  const leftPlay = left.play({
    disclosureId: 'left',
    expanding: true,
    render: () => {
      leftRegion = new FakeElement({ regionId: 'left', height: 30, pendingAnimations: true });
      leftRoot.replaceChildren(leftRegion);
    }
  });
  const rightPlay = right.play({
    disclosureId: 'right',
    expanding: true,
    render: () => {
      rightRegion = new FakeElement({ regionId: 'right', height: 30, pendingAnimations: true });
      rightRoot.replaceChildren(rightRegion);
    }
  });
  await Promise.resolve();

  assert.equal(left.active, true);
  assert.equal(right.active, true);
  assert.equal(left.cancel('left-only'), true);
  assert.equal(right.active, true);
  assert.equal(rightRegion.animationCalls[0].animation.cancelled, false);
  rightRegion.animationCalls[0].animation.finish();

  assert.equal(await leftPlay, false);
  assert.equal(await rightPlay, true);
  assert.equal(left.active, false);
  assert.equal(right.active, false);
});

test('rapid reversal keeps the current canonical frame and completes only the latest intent', async () => {
  const root = new FakeElement({ height: 100 });
  root.append(new FakeElement({ motionId: 'heading' }));
  const runtime = fakeRuntime();
  let region = null;
  let expandRenders = 0;
  let collapseRenders = 0;
  const controller = createController(root, runtime, () => region);

  const expanding = controller.play({
    disclosureId: 'rapid',
    expanding: true,
    render: () => {
      expandRenders += 1;
      region = new FakeElement({ regionId: 'rapid', height: 40, pendingAnimations: true });
      root.replaceChildren(new FakeElement({ motionId: 'heading' }), region);
    }
  });
  await Promise.resolve();
  const interruptedAnimation = region.animationCalls[0].animation;
  region.pendingAnimations = false;

  const collapsingRegion = region;
  const collapsing = controller.play({
    disclosureId: 'rapid',
    expanding: false,
    render: () => {
      collapseRenders += 1;
      region = null;
      root.replaceChildren(new FakeElement({ motionId: 'heading' }));
    }
  });

  assert.equal(await expanding, false);
  assert.equal(await collapsing, true);
  assert.equal(interruptedAnimation.cancelled, true);
  assert.equal(
    collapsingRegion.classList.contains('is-disclosure-motion-animated-row'),
    false
  );
  assert.equal(expandRenders, 1);
  assert.equal(collapseRenders, 1);
  assert.equal(
    collapsingRegion.animationCalls.at(-1).keyframes[0].height,
    '40px',
    'the existing contract restarts from canonical mounted geometry, not sampled opacity'
  );
  assert.equal(controller.active, false);
});

test('collapse interrupted by expansion reconciles the old render before revealing the latest state', async () => {
  const root = new FakeElement({ height: 100 });
  let region = new FakeElement({ regionId: 'reverse', height: 40, pendingAnimations: true });
  root.append(new FakeElement({ motionId: 'heading' }), region);
  const runtime = fakeRuntime();
  const controller = createController(root, runtime, () => region);
  let collapseRenders = 0;
  let expandRenders = 0;

  const collapsingRegion = region;
  const collapsing = controller.play({
    disclosureId: 'reverse',
    expanding: false,
    render: () => {
      collapseRenders += 1;
      region = null;
      root.replaceChildren(new FakeElement({ motionId: 'heading' }));
    }
  });
  await Promise.resolve();

  let expandedRegion = null;
  const expanding = controller.play({
    disclosureId: 'reverse',
    expanding: true,
    render: () => {
      expandRenders += 1;
      expandedRegion = new FakeElement({ regionId: 'reverse', height: 40 });
      region = expandedRegion;
      root.replaceChildren(new FakeElement({ motionId: 'heading' }), expandedRegion);
    }
  });

  assert.equal(await collapsing, false);
  assert.equal(await expanding, true);
  assert.equal(collapseRenders, 1);
  assert.equal(expandRenders, 1);
  assert.equal(collapsingRegion.animationCalls[0].animation.cancelled, true);
  assert.deepEqual(
    expandedRegion.animationCalls[0].keyframes.map((frame) => frame.clipPath),
    ['inset(0 0 100% 0)', 'inset(0 0 0 0)']
  );
  assert.equal(controller.active, false);
});

test('owner destruction commits a required collapse render once and clears every effect', async () => {
  const root = new FakeElement({ height: 100 });
  let region = new FakeElement({ regionId: 'destroy', height: 40, pendingAnimations: true });
  root.append(new FakeElement({ motionId: 'heading' }), region);
  const runtime = fakeRuntime();
  const controller = createController(root, runtime, () => region);
  let renders = 0;

  const collapsing = controller.play({
    disclosureId: 'destroy',
    expanding: false,
    render: () => {
      renders += 1;
      region = null;
      root.replaceChildren(new FakeElement({ motionId: 'heading' }));
    }
  });
  await Promise.resolve();

  assert.equal(controller.destroy(), true);
  assert.equal(await collapsing, false);
  assert.equal(renders, 1);
  assert.equal(controller.active, false);
  assert.equal(runtime.listeners.has('resize'), false);
  assert.equal(runtime.observers.every((observer) => observer.disconnected), true);
  assert.equal(runtime.body.classList.contains('is-disclosure-motion-animating'), false);
});

test('reduced motion performs one immediate render with no animation', async () => {
  const root = new FakeElement({ height: 100 });
  const runtime = fakeRuntime({ reducedMotion: true });
  let region = null;
  let renders = 0;
  const controller = createController(root, runtime, () => region);

  assert.equal(await controller.play({
    disclosureId: 'reduced',
    expanding: true,
    render: () => {
      renders += 1;
      region = new FakeElement({ regionId: 'reduced', height: 30 });
      root.replaceChildren(region);
    }
  }), true);

  assert.equal(renders, 1);
  assert.equal(region.animationCalls.length, 0);
  assert.equal(controller.active, false);
});

test('repository wiring exposes one neutral primitive without Right membership coupling', async () => {
  const [primitive, membership, rightSidebar, html] = await Promise.all([
    read('public/disclosureMotion.js'),
    read('public/sidebarMembershipMoveAnimation.js'),
    read('public/js/rightSidebar.js'),
    read('public/index.html')
  ]);

  assert.match(primitive, /function createController/);
  assert.doesNotMatch(primitive, /beginDrag|commitDrag|captureMutation|drag-stack|pageBinding|fetch\s*\(|request\s*\(/);
  assert.doesNotMatch(primitive, /Category|Descriptor|Relations|navigationFolderToggleWrites/);
  assert.match(membership, /disclosureMotionModel\?\.createController/);
  assert.doesNotMatch(membership, /clipPath: 'inset\(0 0 100% 0\)'/);
  assert.match(rightSidebar, /disclosureMotionModel\.createController/);
  assert.doesNotMatch(rightSidebar, /sidebarMembershipMoveAnimationModel/);

  const primitiveIndex = html.indexOf('disclosureMotion.js');
  const membershipIndex = html.indexOf('sidebarMembershipMoveAnimation.js');
  const rightIndex = html.indexOf('js/rightSidebar.js');
  assert.ok(primitiveIndex >= 0 && primitiveIndex < membershipIndex);
  assert.ok(primitiveIndex < rightIndex);
});
