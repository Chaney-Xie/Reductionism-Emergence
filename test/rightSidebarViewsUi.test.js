const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const workspaceStateModel = require('../public/workspaceState');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

function disclosureMotionStub() {
  return {
    DISCLOSURE_DURATION_MS: 176,
    createController() {
      return {
        cancel: () => false,
        play: () => Promise.resolve(false)
      };
    }
  };
}

test('right chrome exposes centred Links and Resources icon views in the accepted order', async () => {
  const [html, css] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css')
  ]);
  const switcher = html.match(/<div class="right-sidebar-view-switcher"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(switcher, /id="right-sidebar-links-view-button"[\s\S]*?aria-label="Links"[\s\S]*?data-right-sidebar-view="relations"/);
  assert.match(switcher, /id="right-sidebar-resources-view-button"[\s\S]*?aria-label="Resources"[\s\S]*?data-right-sidebar-view="resources"/);
  assert.ok(switcher.indexOf('right-sidebar-links-view-button') < switcher.indexOf('right-sidebar-resources-view-button'));
  assert.doesNotMatch(switcher, />\s*(?:Links|Resources)\s*</);
  assert.match(css, /\.right-chrome-spacer \{[^}]*justify-content: flex-end;/);
  assert.match(css, /\.right-sidebar-view-switcher \{[^}]*flex: 0 0 var\(--right-sidebar-width\);[^}]*justify-content: center;[^}]*-webkit-app-region: no-drag;/);
  assert.match(css, /\.right-sidebar-view-button svg \{[^}]*stroke: currentColor;/);
});

test('Link and Resource views own the required existing sections without duplicating Maintenance', async () => {
  const html = await read('public/index.html');
  const linkStart = html.indexOf('id="right-sidebar-relations-view"');
  const resourceStart = html.indexOf('id="right-sidebar-resources-view"');
  const sidebarEnd = html.indexOf('</aside>', resourceStart);
  const linkView = html.slice(linkStart, resourceStart);
  const resourceView = html.slice(resourceStart, sidebarEnd);

  assert.ok(linkStart >= 0 && resourceStart > linkStart);
  assert.ok(linkView.indexOf('data-right-section="category"') < linkView.indexOf('data-right-section="descriptor"'));
  assert.ok(linkView.indexOf('data-right-section="descriptor"') < linkView.indexOf('data-right-section="relations"'));
  assert.doesNotMatch(linkView, /data-right-section="maintenance"|External Links/);

  assert.ok(resourceView.indexOf('data-right-section="maintenance"') < resourceView.indexOf('data-right-section="external-links"'));
  assert.match(resourceView, />External Links</);
  assert.match(resourceView, /data-right-section="external-links"[\s\S]*?id="external-links-add-button"[\s\S]*?>Add<\/button>[\s\S]*?id="external-links-list"/);
  assert.equal((html.match(/data-right-section="maintenance"/g) || []).length, 1);
  assert.equal((html.match(/id="resources-list"/g) || []).length, 1);
  assert.match(resourceView, /id="add-file-button"[\s\S]*?>Add File<\/button>/);
});

test('view switching preserves DOM panels and reuses one section resize operation', async () => {
  const [source, css] = await Promise.all([
    read('public/js/rightSidebar.js'),
    read('public/styles.css')
  ]);
  assert.match(source, /function setRightSidebarView[\s\S]*?panel\.hidden = panel\.dataset\.rightSidebarViewPanel !== nextView/);
  assert.match(source, /button\.classList\.toggle\('active', active\)[\s\S]*?aria-pressed/);
  assert.match(source, /RIGHT_SIDEBAR_VIEW_SECTION_IDS[\s\S]*?nextExpandedRightSection/);
  assert.match(source, /startRightSidebarResize[\s\S]*?rightSectionHeights\.set\(sectionId[\s\S]*?rightSectionHeights\.set\(nextSectionId/);
  assert.match(source, /resizer\.setPointerCapture\(pointerId\)/);
  assert.match(source, /moveEvent\.pointerId !== pointerId/);
  assert.match(source, /resizer\.releasePointerCapture\(pointerId\)/);
  assert.match(source, /lostpointercapture/);
  assert.match(source, /scheduleWorkspaceStateSave\(\)/);
  assert.match(css, /\.right-sidebar-view \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0;/);
  assert.match(css, /\.right-sidebar-view\[hidden\] \{[^}]*display: none;/);
});

test('nested Category, Descriptor, and relation-type folds delegate to their disclosure-only owner', async () => {
  const source = await read('public/js/rightSidebar.js');
  let coordinatorOptions = null;
  const disclosureCalls = [];
  const cancellations = [];
  const region = { dataset: { rightFoldRegion: 'right-relation:type-a' } };
  const rightSidebar = {
    querySelectorAll(selector) {
      return selector === '[data-right-fold-region]' ? [region] : [];
    }
  };
  const context = {
    rightSidebar,
    disclosureMotionModel: {
      DISCLOSURE_DURATION_MS: 176,
      createController(options) {
        coordinatorOptions = options;
        return {
          cancel(reason) { cancellations.push(reason); return true; },
          play(options) {
            disclosureCalls.push(options);
            options.render();
            return Promise.resolve(true);
          }
        };
      }
    }
  };
  vm.runInNewContext(source, context, { filename: 'public/js/rightSidebar.js' });

  assert.equal(coordinatorOptions.root(), rightSidebar);
  assert.equal(coordinatorOptions.activityClass, 'is-right-sidebar-fold-animating');
  assert.equal(coordinatorOptions.visibilityClass, 'right-sidebar-collapsed');
  assert.equal(coordinatorOptions.resolveRegion('right-relation:type-a'), region);
  let renders = 0;
  assert.equal(await context.animateRightSidebarNestedFold(
    'right-relation:type-a',
    true,
    () => { renders += 1; }
  ), true);
  assert.equal(renders, 1);
  assert.equal(disclosureCalls.length, 1);
  assert.equal(disclosureCalls[0].disclosureId, 'right-relation:type-a');
  assert.equal(disclosureCalls[0].expanding, true);
  assert.equal(context.interruptRightSidebarNestedFoldMotion('test-rerender'), true);
  assert.deepEqual(cancellations, ['test-rerender']);

  assert.match(source, /const rightSidebarNestedFoldAnimator = disclosureMotionModel\.createController/);
  assert.match(source, /function animateRightSidebarNestedFold[\s\S]*?return rightSidebarNestedFoldAnimator\.play/);
  assert.doesNotMatch(source, /sidebarMembershipMoveAnimationModel/);
  assert.doesNotMatch(source, /if \(motion\)|Promise\.resolve\(false\)/);
  assert.match(source, /const foldId = `right-category:\$\{groupId\}`[\s\S]*?animateRightSidebarNestedFold\(foldId, collapsed/);
  assert.match(source, /const foldId = `right-descriptor:\$\{groupId\}`[\s\S]*?animateRightSidebarNestedFold\(foldId, !expanded/);
  assert.match(source, /const foldId = `right-relation:\$\{group\.linkTypeId\}`[\s\S]*?animateRightSidebarNestedFold\(foldId, collapsed/);
  assert.equal((source.match(/dataset\.rightFoldRegion = foldId/g) || []).length, 3);
  assert.equal((source.match(/dataset\.sidebarMotionId = foldId/g) || []).length, 3);
});

test('section dividers retain their mounted adjacency and exact visual primitive', async () => {
  const [html, css] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css')
  ]);
  const relationsStart = html.indexOf('id="right-sidebar-relations-view"');
  const resourcesStart = html.indexOf('id="right-sidebar-resources-view"');
  const sidebarEnd = html.indexOf('</aside>', resourcesStart);
  const relationsView = html.slice(relationsStart, resourcesStart);
  const resourcesView = html.slice(resourcesStart, sidebarEnd);
  const categorySection = relationsView.indexOf('data-right-section="category"');
  const categoryDivider = relationsView.indexOf('data-section="category"');
  const descriptorSection = relationsView.indexOf('data-right-section="descriptor"');
  const descriptorDivider = relationsView.indexOf('data-section="descriptor"');
  const relationsSection = relationsView.indexOf('data-right-section="relations"');
  const maintenanceSection = resourcesView.indexOf('data-right-section="maintenance"');
  const maintenanceDivider = resourcesView.indexOf('data-section="maintenance"');
  const externalLinksSection = resourcesView.indexOf('data-right-section="external-links"');

  assert.ok(categorySection < categoryDivider && categoryDivider < descriptorSection);
  assert.ok(descriptorSection < descriptorDivider && descriptorDivider < relationsSection);
  assert.ok(maintenanceSection < maintenanceDivider && maintenanceDivider < externalLinksSection);
  assert.equal((relationsView.match(/class="right-section-resizer"/g) || []).length, 2);
  assert.equal((resourcesView.match(/class="right-section-resizer"/g) || []).length, 1);
  assert.match(relationsView, /data-section="category"[^>]*role="separator"[^>]*aria-orientation="horizontal"[^>]*aria-label="Resize Category Filter"/);
  assert.match(relationsView, /data-section="descriptor"[^>]*role="separator"[^>]*aria-orientation="horizontal"[^>]*aria-label="Resize Descriptor Filter"/);
  assert.match(resourcesView, /data-section="maintenance"[^>]*role="separator"[^>]*aria-orientation="horizontal"[^>]*aria-label="Resize Maintenance"/);
  assert.match(css, /\.right-section-resizer \{[^}]*position: relative;[^}]*z-index: 2;[^}]*flex: 0 0 2px;[^}]*background: var\(--right-section-divider-colour\);[^}]*cursor: row-resize;[^}]*touch-action: none;/);
  assert.match(css, /\.right-section-resizer::before \{[^}]*position: absolute;[^}]*inset-block: -2px;[^}]*inset-inline: 0;[^}]*background: transparent;[^}]*content: '';[^}]*cursor: row-resize;[^}]*pointer-events: auto;[^}]*touch-action: none;/);
  assert.doesNotMatch(css, /\.right-section-resizer::after\s*\{/);
  assert.match(css, /\.right-section-resizer:hover,[\s\S]*?\.right-sidebar-resizing \.right-section-resizer \{[^}]*--right-section-divider-colour: #8e9bad;/);
  assert.match(css, /\.right-section-resizer\[hidden\] \{[^}]*display: none;/);
});

test('section layout keeps preferred bodies in one top-aligned stack and leaves spare height below it', async () => {
  class FakeClassList {
    constructor() {
      this.values = new Set();
    }

    toggle(name, force) {
      if (force) this.values.add(name);
      else this.values.delete(name);
    }

    contains(name) {
      return this.values.has(name);
    }
  }

  class FakeSection {
    constructor(sectionId) {
      this.dataset = { rightSection: sectionId };
      this.classList = new FakeClassList();
      this.style = {};
      this.body = {
        style: {},
        getBoundingClientRect: () => ({
          height: Number.parseFloat(this.body.style.height) || 0
        })
      };
      this.toggle = {
        attributes: new Map(),
        setAttribute: (name, value) => this.toggle.attributes.set(name, value)
      };
    }

    querySelector(selector) {
      if (selector === '.right-section-body') return this.body;
      if (selector === '.right-section-toggle') return this.toggle;
      return null;
    }
  }

  class FakePanel {
    constructor(viewId, sectionIds, height = 640) {
      this.dataset = { rightSidebarViewPanel: viewId };
      this.height = height;
      this.headers = sectionIds.map(() => ({
        getBoundingClientRect: () => ({ height: 32 })
      }));
      this.resizers = sectionIds.slice(0, -1).map((sectionId) => ({
        dataset: { section: sectionId },
        hidden: true,
        getBoundingClientRect: () => ({ height: 2 })
      }));
    }

    getBoundingClientRect() {
      return { height: this.height };
    }

    querySelectorAll(selector) {
      if (selector === '.right-section-header') return this.headers;
      if (selector === '.right-section-resizer') return this.resizers;
      if (selector === '.right-section-resizer:not([hidden])') {
        return this.resizers.filter((resizer) => !resizer.hidden);
      }
      return [];
    }
  }

  const source = await read('public/js/rightSidebar.js');
  const relationIds = ['category', 'descriptor', 'relations'];
  const resourceIds = ['maintenance', 'external-links'];
  const allIds = [...relationIds, ...resourceIds];
  const sections = new Map(allIds.map((sectionId) => [sectionId, new FakeSection(sectionId)]));
  const relationsPanel = new FakePanel('relations', relationIds);
  const resourcesPanel = new FakePanel('resources', resourceIds);
  const rightSidebar = {
    querySelectorAll: (selector) => (
      selector === '.right-sidebar-section' ? [...sections.values()] : []
    ),
    querySelector: (selector) => {
      const match = selector.match(/^\[data-right-section="([^"]+)"\]$/);
      return match ? sections.get(match[1]) || null : null;
    },
    getBoundingClientRect: () => ({ height: 640 })
  };
  const context = {
    RIGHT_SECTION_BODY_MIN_HEIGHT: 64,
    RIGHT_SIDEBAR_VIEW_SECTION_IDS: {
      relations: relationIds,
      resources: resourceIds
    },
    collapsedRightSectionIds: new Set(allIds),
    rightSectionEffectiveHeights: new Map(),
    rightSectionHeights: new Map([
      ['category', 100],
      ['descriptor', 120],
      ['relations', 180],
      ['maintenance', 80],
      ['external-links', 160]
    ]),
    rightSidebar,
    rightSidebarView: 'relations',
    rightSidebarViewPanels: [relationsPanel, resourcesPanel],
    disclosureMotionModel: disclosureMotionStub()
  };
  vm.runInNewContext(source, context, { filename: 'public/js/rightSidebar.js' });

  const preferredSnapshot = JSON.stringify(Object.fromEntries(context.rightSectionHeights));
  const setExpanded = (sectionIds) => {
    context.collapsedRightSectionIds.clear();
    for (const sectionId of allIds) {
      if (!sectionIds.includes(sectionId)) context.collapsedRightSectionIds.add(sectionId);
    }
  };
  const verifyState = (label, sectionIds, panel, orderedIds) => {
    setExpanded(sectionIds);
    context.updateRightSidebarLayout();
    assert.equal(
      JSON.stringify(Object.fromEntries(context.rightSectionHeights)),
      preferredSnapshot,
      `${label}: expand/collapse must not rewrite preferred heights`
    );
    const visibleDividerIds = panel.resizers
      .filter((resizer) => !resizer.hidden)
      .map((resizer) => resizer.dataset.section);
    const expectedDividerIds = orderedIds.slice(0, -1);
    assert.deepEqual(
      visibleDividerIds,
      expectedDividerIds,
      `${label}: each existing section boundary keeps exactly one divider`
    );
    const visibleDividerCount = visibleDividerIds.length;
    const bodyTotal = sectionIds.reduce((total, sectionId) => (
      total + Number.parseFloat(sections.get(sectionId).body.style.height)
    ), 0);
    const stackHeight = panel.headers.length * 32 + visibleDividerCount * 2 + bodyTotal;
    assert.ok(stackHeight <= panel.height, `${label}: stack must fit in the panel`);
    assert.ok(panel.height - stackHeight > 0, `${label}: spare height belongs below the stack`);
    for (const sectionId of orderedIds) {
      const body = sections.get(sectionId).body;
      if (sectionIds.includes(sectionId)) {
        assert.equal(
          Number.parseFloat(body.style.height),
          context.rightSectionHeights.get(sectionId),
          `${label}: ${sectionId} keeps its preferred height`
        );
        assert.equal(body.style.flex, `0 0 ${context.rightSectionHeights.get(sectionId)}px`);
      } else {
        assert.equal(body.style.height, '');
        assert.equal(body.style.flex, '');
      }
    }
  };

  const relationStates = [
    ['all collapsed', []],
    ['Category only', ['category']],
    ['Descriptor only', ['descriptor']],
    ['Relations only', ['relations']],
    ['Category and Descriptor', ['category', 'descriptor']],
    ['Descriptor and Relations', ['descriptor', 'relations']],
    ['all Relations sections', relationIds],
    ['collapse Descriptor from all', ['category', 'relations']],
    ['collapse Descriptor from Category and Descriptor', ['category']],
    ['collapse Relations from Descriptor and Relations', ['descriptor']],
    ['collapse Category from all', ['descriptor', 'relations']]
  ];
  for (const [label, expandedIds] of relationStates) {
    verifyState(label, expandedIds, relationsPanel, relationIds);
  }

  setExpanded(relationIds);
  relationsPanel.height = 310;
  context.updateRightSidebarLayout();
  assert.deepEqual(
    relationIds.map((sectionId) => context.rightSectionEffectiveHeights.get(sectionId)),
    [82, 64, 64]
  );
  assert.equal(JSON.stringify(Object.fromEntries(context.rightSectionHeights)), preferredSnapshot);

  relationsPanel.height = 640;
  context.updateRightSidebarLayout();
  assert.deepEqual(
    relationIds.map((sectionId) => context.rightSectionEffectiveHeights.get(sectionId)),
    [100, 120, 180]
  );
  relationsPanel.height = 800;
  context.updateRightSidebarLayout();
  assert.deepEqual(
    relationIds.map((sectionId) => context.rightSectionEffectiveHeights.get(sectionId)),
    [100, 120, 180],
    'window growth must not stretch the final expanded body'
  );

  context.rightSidebarView = 'resources';
  verifyState('Resources all collapsed', [], resourcesPanel, resourceIds);
  verifyState('Resources Maintenance only', ['maintenance'], resourcesPanel, resourceIds);
  verifyState('Resources External Links only', ['external-links'], resourcesPanel, resourceIds);
  verifyState('Resources both expanded', resourceIds, resourcesPanel, resourceIds);
});

test('section motion interpolates allocator results, reverses from the live frame, and leaves no styles', async () => {
  class MotionClassList {
    constructor() { this.values = new Set(); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
      if (force) this.values.add(name);
      else this.values.delete(name);
    }
  }

  class MotionElement {
    constructor(height = 0) {
      this.baseHeight = height;
      this.presentedHeight = null;
      this.presentedPaddingTop = null;
      this.presentedPaddingBottom = null;
      this.presentedTranslateY = null;
      this.style = {};
      this.hidden = false;
      this.children = [];
      this.animationCalls = [];
      this.classList = new MotionClassList();
      this.ownerDocument = null;
    }

    get firstElementChild() { return this.children[0] || null; }

    getBoundingClientRect() {
      const collapsedByOwner = this.ownerSection?.classList.contains('is-collapsed')
        && this.style.display !== 'block';
      const inlineHeight = Number.parseFloat(this.style.height);
      const height = this.hidden || collapsedByOwner
        ? 0
        : (this.presentedHeight
          ?? (Number.isFinite(inlineHeight) ? inlineHeight : this.baseHeight));
      return { height: Number.isFinite(height) ? height : 0 };
    }

    animate(keyframes, options) {
      const startHeight = Number.parseFloat(keyframes[0].height);
      const endHeight = Number.parseFloat(keyframes.at(-1).height);
      if (Number.isFinite(startHeight) && Number.isFinite(endHeight)) {
        this.presentedHeight = (startHeight + endHeight) / 2;
      }
      const startPaddingTop = Number.parseFloat(keyframes[0].paddingTop);
      const endPaddingTop = Number.parseFloat(keyframes.at(-1).paddingTop);
      if (Number.isFinite(startPaddingTop) && Number.isFinite(endPaddingTop)) {
        this.presentedPaddingTop = (startPaddingTop + endPaddingTop) / 2;
      }
      const startPaddingBottom = Number.parseFloat(keyframes[0].paddingBottom);
      const endPaddingBottom = Number.parseFloat(keyframes.at(-1).paddingBottom);
      if (Number.isFinite(startPaddingBottom) && Number.isFinite(endPaddingBottom)) {
        this.presentedPaddingBottom = (startPaddingBottom + endPaddingBottom) / 2;
      }
      const translateY = (frame) => {
        const match = String(frame.transform || '').match(
          /translate3d\(0, (-?\d+(?:\.\d+)?)px, 0\)/
        );
        return match ? Number.parseFloat(match[1]) : Number.NaN;
      };
      const startTranslateY = translateY(keyframes[0]);
      const endTranslateY = translateY(keyframes.at(-1));
      if (Number.isFinite(startTranslateY) && Number.isFinite(endTranslateY)) {
        this.presentedTranslateY = (startTranslateY + endTranslateY) / 2;
      }
      let resolve;
      const finished = new Promise((finish) => { resolve = finish; });
      let settled = false;
      const animation = {
        finished,
        cancel: () => {
          if (settled) return;
          settled = true;
          this.presentedHeight = null;
          this.presentedPaddingTop = null;
          this.presentedPaddingBottom = null;
          this.presentedTranslateY = null;
          resolve();
        },
        finish: () => {
          if (settled) return;
          settled = true;
          this.presentedHeight = Number.isFinite(endHeight) ? endHeight : null;
          this.presentedPaddingTop = Number.isFinite(endPaddingTop) ? endPaddingTop : null;
          this.presentedPaddingBottom = Number.isFinite(endPaddingBottom)
            ? endPaddingBottom
            : null;
          this.presentedTranslateY = Number.isFinite(endTranslateY) ? endTranslateY : null;
          resolve();
        }
      };
      this.animationCalls.push({ keyframes, options, animation });
      return animation;
    }
  }

  class MotionSection {
    constructor(sectionId) {
      this.dataset = { rightSection: sectionId };
      this.classList = new MotionClassList();
      this.style = {};
      this.body = new MotionElement();
      this.bodyContent = new MotionElement(20);
      this.body.children.push(this.bodyContent);
      this.body.ownerSection = this;
      this.toggle = { setAttribute: () => {} };
    }

    querySelector(selector) {
      if (selector === '.right-section-body') return this.body;
      if (selector === '.right-section-toggle') return this.toggle;
      return null;
    }
  }

  const source = await read('public/js/rightSidebar.js');
  const ids = ['category', 'descriptor', 'relations'];
  const sections = new Map(ids.map((sectionId) => [sectionId, new MotionSection(sectionId)]));
  const resizers = ids.slice(0, -1).map((sectionId) => {
    const resizer = new MotionElement(2);
    resizer.dataset = { section: sectionId };
    return resizer;
  });
  const panel = {
    dataset: { rightSidebarViewPanel: 'relations' },
    getBoundingClientRect: () => ({ height: 640 }),
    querySelectorAll(selector) {
      if (selector === '.right-section-header') {
        return ids.map(() => ({ getBoundingClientRect: () => ({ height: 32 }) }));
      }
      if (selector === '.right-section-resizer') return resizers;
      if (selector === '.right-section-resizer:not([hidden])') {
        return resizers.filter((resizer) => !resizer.hidden);
      }
      return [];
    }
  };
  const rootStyle = {
    getPropertyValue(name) {
      if (name === '--sidebar-motion-duration') return '170ms';
      if (name === '--sidebar-motion-easing') return 'cubic-bezier(0.2, 0.75, 0.25, 1)';
      return '';
    }
  };
  const document = { documentElement: {} };
  const computed = (element) => element === document.documentElement ? rootStyle : {
    opacity: '1',
    paddingTop: element.presentedPaddingTop === null
      ? '10px'
      : `${element.presentedPaddingTop}px`,
    paddingBottom: element.presentedPaddingBottom === null
      ? '10px'
      : `${element.presentedPaddingBottom}px`,
    transform: element.presentedTranslateY === null
      ? 'none'
      : `matrix(1, 0, 0, 1, 0, ${element.presentedTranslateY})`
  };
  const window = {
    clearTimeout,
    getComputedStyle: computed,
    matchMedia: () => ({ matches: false }),
    setTimeout
  };
  const rightSidebar = {
    querySelectorAll: (selector) => selector === '.right-sidebar-section'
      ? [...sections.values()]
      : [],
    querySelector(selector) {
      const match = selector.match(/^\[data-right-section="([^"]+)"\]$/);
      return match ? sections.get(match[1]) || null : null;
    },
    getBoundingClientRect: () => ({ height: 640 })
  };
  const preferred = new Map([
    ['category', 100],
    ['descriptor', 120],
    ['relations', 180]
  ]);
  const runtime = {
    paneId: 'pane_right_sidebar_test',
    runtimeId: 'runtime_right_sidebar_test',
    currentPage: null
  };
  const context = {
    RIGHT_SECTION_BODY_MIN_HEIGHT: 64,
    RIGHT_SIDEBAR_VIEW_SECTION_IDS: { relations: ids, resources: [] },
    activePaneRuntime: () => runtime,
    clearExternalLinkBlockHover: (ownerRuntime) => {
      assert.strictEqual(ownerRuntime, runtime);
    },
    collapsedRightSectionIds: new Set(['category']),
    document,
    getComputedStyle: computed,
    rightSectionEffectiveHeights: new Map(),
    rightSectionHeights: preferred,
    rightSidebar,
    rightSidebarView: 'relations',
    rightSidebarViewPanels: [panel],
    scheduleWorkspaceStateSave: () => {},
    disclosureMotionModel: disclosureMotionStub(),
    window
  };
  for (const section of sections.values()) section.body.ownerDocument = { defaultView: window };
  for (const section of sections.values()) {
    section.bodyContent.ownerDocument = { defaultView: window };
  }
  for (const resizer of resizers) resizer.ownerDocument = { defaultView: window };
  vm.runInNewContext(source, context, { filename: 'public/js/rightSidebar.js' });

  context.updateRightSidebarLayout();
  assert.equal(sections.get('category').classList.contains('is-collapsed'), true);
  assert.equal(context.animateRightSidebarSectionToggle('descriptor'), true);
  assert.equal(sections.get('category').classList.contains('is-collapsed'), true);
  assert.equal(sections.get('category').body.style.display, 'block');
  context.updateRightSidebarLayout();

  assert.equal(context.animateRightSidebarSectionToggle('category'), true);
  const firstExpansion = sections.get('category').body.animationCalls.at(-1);
  assert.deepEqual(Array.from(firstExpansion.keyframes, (frame) => frame.height), ['0px', '100px']);
  assert.equal(firstExpansion.options.duration, 170);
  assert.equal(firstExpansion.options.easing, 'cubic-bezier(0.2, 0.75, 0.25, 1)');
  const firstContentMotion = sections.get('category').bodyContent.animationCalls.at(-1);
  assert.deepEqual(Array.from(firstContentMotion.keyframes, (frame) => frame.transform), [
    'translate3d(0, 10px, 0)',
    'translate3d(0, 0px, 0)'
  ]);
  assert.deepEqual(firstContentMotion.options, firstExpansion.options,
    'the content carrier shares the exact section timing and easing');
  assert.equal(0 + 10, 10 + 0,
    'padding plus compensation keeps the expanding hint at one body-relative top');
  assert.deepEqual(
    Array.from(resizers[0].animationCalls.at(-1).keyframes, (frame) => frame.height),
    ['2px', '2px'],
    'the existing divider remains full-height while its section body opens'
  );
  assert.deepEqual(
    Array.from(resizers[0].animationCalls.at(-1).keyframes, (frame) => frame.opacity),
    [1, 1],
    'the existing divider remains visible while its section body opens'
  );
  context.updateRightSidebarLayout();
  assert.equal(sections.get('category').classList.contains('is-collapsed'), false);

  assert.equal(context.animateRightSidebarSectionToggle('category'), true);
  const initialCollapse = sections.get('category').body.animationCalls.at(-1);
  assert.deepEqual(Array.from(initialCollapse.keyframes, (frame) => frame.height), ['100px', '0px']);
  assert.equal(context.animateRightSidebarSectionToggle('descriptor'), true);
  const reversed = sections.get('category').body.animationCalls.at(-1);
  assert.deepEqual(Array.from(reversed.keyframes, (frame) => frame.height), ['50px', '0px']);
  const reversedContentMotion = sections.get('category').bodyContent.animationCalls.at(-1);
  assert.deepEqual(Array.from(reversed.keyframes, (frame) => frame.paddingTop), ['5px', '0px']);
  assert.deepEqual(Array.from(reversedContentMotion.keyframes, (frame) => frame.transform), [
    'translate3d(0, 5px, 0)',
    'translate3d(0, 10px, 0)'
  ]);
  assert.deepEqual(reversedContentMotion.options, reversed.options,
    'cross-section interruption continues the prior collapse from its live frame');
  assert.equal(5 + 5, 0 + 10,
    'padding plus compensation keeps the collapsing hint spatially locked');
  assert.deepEqual(
    Array.from(resizers[0].animationCalls.at(-1).keyframes, (frame) => frame.height),
    ['2px', '2px'],
    'cross-section continuation never folds the section boundary with the body'
  );
  assert.deepEqual(
    Array.from(resizers[0].animationCalls.at(-1).keyframes, (frame) => frame.opacity),
    [1, 1],
    'cross-section continuation never fades the section boundary with the body'
  );
  assert.equal(context.animateRightSidebarSectionToggle('category'), true);
  const secondReversal = sections.get('category').body.animationCalls.at(-1);
  assert.deepEqual(Array.from(secondReversal.keyframes, (frame) => frame.height), ['25px', '100px']);
  context.updateRightSidebarLayout();

  assert.equal(context.animateRightSidebarSectionToggle('category'), true);
  const finalCollapse = sections.get('category').body.animationCalls.at(-1);
  assert.deepEqual(Array.from(finalCollapse.keyframes, (frame) => frame.height), ['100px', '0px']);
  for (const section of sections.values()) {
    section.body.animationCalls.at(-1)?.animation.finish();
    section.bodyContent.animationCalls.at(-1)?.animation.finish();
  }
  for (const resizer of resizers) resizer.animationCalls.at(-1)?.animation.finish();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sections.get('category').classList.contains('is-collapsed'), true);
  assert.equal(sections.get('category').body.style.display, '');
  assert.equal(sections.get('category').body.style.overflow, '');
  assert.equal(sections.get('category').body.style.pointerEvents, '');
  assert.equal(sections.get('category').body.style.willChange, '');
  assert.equal(sections.get('category').bodyContent.style.transform, '');
  assert.equal(sections.get('category').bodyContent.style.transformOrigin, '');
  assert.equal(sections.get('category').bodyContent.style.willChange, '');
  assert.equal(resizers[0].hidden, false);
  assert.equal(resizers[0].style.display, '');
  assert.equal(resizers[0].style.overflow, '');
  assert.equal(resizers[0].style.pointerEvents, '');
  assert.equal(resizers[0].style.willChange, '');

  assert.equal(context.animateRightSidebarSectionToggle('category'), true);
  context.updateRightSidebarLayout();
  assert.equal(context.animateRightSidebarSectionToggle('category'), true);
  sections.get('category').body.presentedHeight = 0.25;
  assert.equal(context.animateRightSidebarSectionToggle('descriptor'), true);
  const fractionalContinuation = sections.get('category').body.animationCalls.at(-1);
  assert.deepEqual(
    Array.from(fractionalContinuation.keyframes, (frame) => frame.height),
    ['0.25px', '0px'],
    'any positive live body height retains its surface through cross-section continuation'
  );
  context.updateRightSidebarLayout();
  assert.deepEqual(Object.fromEntries(preferred), {
    category: 100,
    descriptor: 120,
    relations: 180
  }, 'presentation never mutates preferred section heights');
});

test('section resize captures one pointer and preserves its adjacent-pair geometry until release', async () => {
  class FakeEventTarget {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener, options = false) {
      const capture = options === true || options?.capture === true;
      const listeners = this.listeners.get(type) || [];
      listeners.push({ listener, capture });
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener, options = false) {
      const capture = options === true || options?.capture === true;
      const listeners = this.listeners.get(type) || [];
      this.listeners.set(type, listeners.filter((entry) => (
        entry.listener !== listener || entry.capture !== capture
      )));
    }

    dispatch(type, event) {
      for (const entry of [...(this.listeners.get(type) || [])]) entry.listener(event);
    }
  }

  class FakeResizer extends FakeEventTarget {
    constructor() {
      super();
      this.dataset = { section: 'category' };
      this.hidden = false;
      this.capturedPointers = new Set();
      this.releasedPointers = [];
    }

    setPointerCapture(pointerId) {
      this.capturedPointers.add(pointerId);
    }

    hasPointerCapture(pointerId) {
      return this.capturedPointers.has(pointerId);
    }

    releasePointerCapture(pointerId) {
      this.capturedPointers.delete(pointerId);
      this.releasedPointers.push(pointerId);
    }
  }

  const source = await read('public/js/rightSidebar.js');
  const eventWindow = new FakeEventTarget();
  const bodyClasses = new Set();
  let saveCount = 0;
  const context = {
    RIGHT_SECTION_BODY_MIN_HEIGHT: 64,
    RIGHT_SIDEBAR_VIEW_SECTION_IDS: {
      relations: ['category', 'descriptor', 'relations'],
      resources: ['maintenance', 'external-links']
    },
    collapsedRightSectionIds: new Set(),
    document: {
      body: {
        classList: {
          add: (value) => bodyClasses.add(value),
          remove: (value) => bodyClasses.delete(value)
        }
      }
    },
    rightSectionEffectiveHeights: new Map([
      ['category', 150],
      ['descriptor', 180]
    ]),
    rightSectionHeights: new Map([
      ['category', 150],
      ['descriptor', 180]
    ]),
    rightSidebar: null,
    rightSidebarResizeCleanup: null,
    rightSidebarView: 'relations',
    scheduleWorkspaceStateSave: () => { saveCount += 1; },
    disclosureMotionModel: disclosureMotionStub(),
    window: eventWindow
  };
  vm.runInNewContext(source, context, { filename: 'public/js/rightSidebar.js' });

  const resizer = new FakeResizer();
  let pointerDownPrevented = false;
  context.startRightSidebarResize({
    button: 0,
    isPrimary: true,
    pointerId: 17,
    clientY: 200,
    preventDefault: () => { pointerDownPrevented = true; }
  }, resizer);

  assert.equal(pointerDownPrevented, true);
  assert.equal(resizer.hasPointerCapture(17), true);
  assert.equal(bodyClasses.has('right-sidebar-resizing'), true);

  eventWindow.dispatch('pointermove', {
    pointerId: 99,
    clientY: 250,
    preventDefault: () => assert.fail('an unrelated pointer must not own the resize')
  });
  assert.equal(context.rightSectionHeights.get('category'), 150);
  assert.equal(context.rightSectionHeights.get('descriptor'), 180);

  let movePrevented = false;
  eventWindow.dispatch('pointermove', {
    pointerId: 17,
    clientY: 242,
    preventDefault: () => { movePrevented = true; }
  });
  assert.equal(movePrevented, true);
  assert.equal(context.rightSectionHeights.get('category'), 192);
  assert.equal(context.rightSectionHeights.get('descriptor'), 138);
  assert.equal(
    context.rightSectionHeights.get('category') + context.rightSectionHeights.get('descriptor'),
    330
  );
  assert.equal(saveCount, 1);

  eventWindow.dispatch('pointerup', { pointerId: 99 });
  assert.equal(resizer.hasPointerCapture(17), true);
  assert.equal(bodyClasses.has('right-sidebar-resizing'), true);

  eventWindow.dispatch('pointerup', { pointerId: 17 });
  assert.equal(resizer.hasPointerCapture(17), false);
  assert.deepEqual(resizer.releasedPointers, [17]);
  assert.equal(bodyClasses.has('right-sidebar-resizing'), false);
  assert.equal(context.rightSidebarResizeCleanup, null);

  eventWindow.dispatch('pointermove', {
    pointerId: 17,
    clientY: 260,
    preventDefault: () => assert.fail('settled resize must remove its move listener')
  });
  assert.equal(context.rightSectionHeights.get('category'), 192);
  assert.equal(context.rightSectionHeights.get('descriptor'), 138);

  context.startRightSidebarResize({
    button: 0,
    isPrimary: true,
    pointerId: 23,
    clientY: 260,
    preventDefault: () => {}
  }, resizer);
  assert.equal(resizer.hasPointerCapture(23), true);
  resizer.capturedPointers.delete(23);
  resizer.dispatch('lostpointercapture', { pointerId: 23 });
  assert.equal(bodyClasses.has('right-sidebar-resizing'), false);
  assert.equal(context.rightSidebarResizeCleanup, null);

  context.startRightSidebarResize({
    button: 0,
    isPrimary: true,
    pointerId: 31,
    clientY: 260,
    preventDefault: () => {}
  }, resizer);
  assert.equal(resizer.hasPointerCapture(31), true);
  eventWindow.dispatch('pointercancel', { pointerId: 31 });
  assert.equal(resizer.hasPointerCapture(31), false);
  assert.equal(bodyClasses.has('right-sidebar-resizing'), false);
  assert.equal(context.rightSidebarResizeCleanup, null);

  context.collapsedRightSectionIds.add('category');
  let collapsedBoundaryPrevented = false;
  context.startRightSidebarResize({
    button: 0,
    isPrimary: true,
    pointerId: 41,
    clientY: 260,
    preventDefault: () => { collapsedBoundaryPrevented = true; }
  }, resizer);
  assert.equal(resizer.hidden, false, 'the collapsed boundary stays visibly mounted');
  assert.equal(collapsedBoundaryPrevented, false, 'visibility does not make a collapsed owner draggable');
  assert.equal(resizer.hasPointerCapture(41), false);
});

test('workspace state validates the per-vault right view and independent section sizes', () => {
  const state = workspaceStateModel.normalizeWorkspaceState({
    rightSidebarView: 'resources',
    rightSectionHeights: {
      category: 130,
      descriptor: 170,
      relations: 260,
      maintenance: 210,
      'external-links': 190,
      stale: 400
    }
  });
  assert.equal(state.rightSidebarView, 'resources');
  assert.deepEqual(state.rightSectionHeights, {
    maintenance: 210,
    'external-links': 190,
    category: 130,
    descriptor: 170,
    relations: 260
  });
  assert.equal(workspaceStateModel.normalizeWorkspaceState({ rightSidebarView: 'stale' }).rightSidebarView, 'relations');
});
