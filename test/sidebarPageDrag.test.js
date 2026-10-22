const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const drag = require('../public/sidebarPageDrag');
const tabLayout = require('../public/tabStripLayout');

const read = (file) => fs.readFile(path.join(__dirname, '..', file), 'utf8');

test('sidebar Page drag geometry resolves the first crossed name or Sidebar boundary', () => {
  const sourceNameRect = {
    left: 40,
    right: 200,
    top: 100,
    bottom: 120,
    width: 160,
    height: 20
  };
  const routing = {
    startX: 100,
    startY: 110,
    sourceNameRect,
    sidebarLeft: 0,
    sidebarRight: 220
  };

  assert.equal(drag.movementExceeded(10, 10, 13, 13), false);
  assert.equal(drag.movementExceeded(10, 10, 16, 10), true);

  let rememberedDecision = drag.boundaryDecisionForSegment(null, {
    ...routing,
    previousX: 210,
    previousY: 119,
    clientX: 212,
    clientY: 122
  });
  assert.equal(rememberedDecision, 'navigation',
    'a name-boundary crossing is retained even before the drag threshold');
  rememberedDecision = drag.boundaryDecisionForSegment(rememberedDecision, {
    ...routing,
    previousX: 212,
    previousY: 122,
    clientX: 225,
    clientY: 122
  });
  assert.equal(rememberedDecision, 'navigation',
    'a later right-edge crossing cannot replace the first route decision');
  assert.equal(drag.nextPhase('undecided-drag', {
    boundaryDecision: rememberedDecision
  }), 'navigation-extracted');

  let rememberedSpatial = drag.boundaryDecisionForSegment(null, {
    ...routing,
    previousX: 218,
    previousY: 110,
    clientX: 221,
    clientY: 110
  });
  assert.equal(rememberedSpatial, 'spatial');
  rememberedSpatial = drag.boundaryDecisionForSegment(rememberedSpatial, {
    ...routing,
    previousX: 221,
    previousY: 110,
    clientX: 221,
    clientY: 116
  });
  assert.equal(rememberedSpatial, 'spatial');
  assert.equal(drag.nextPhase('undecided-drag', {
    boundaryDecision: rememberedSpatial
  }), 'spatial-preview');

  const verticalFirst = drag.segmentBoundaryCrossings({
    ...routing,
    previousX: 180,
    previousY: 110,
    clientX: 240,
    clientY: 130
  });
  assert.equal(verticalFirst.first?.kind, 'navigation');
  assert.equal(verticalFirst.first?.edge, 'bottom');
  assert.ok(verticalFirst.navigation.t < verticalFirst.spatial.t);
  assert.equal(drag.nextPhase('undecided-drag', {
    boundaryDecision: verticalFirst.first?.kind
  }), 'navigation-extracted');

  const rightFirst = drag.segmentBoundaryCrossings({
    ...routing,
    previousX: 215,
    previousY: 110,
    clientX: 240,
    clientY: 130
  });
  assert.equal(rightFirst.first?.kind, 'spatial');
  assert.equal(rightFirst.navigation, null);
  assert.ok(rightFirst.spatial.t < 1);
  assert.equal(drag.nextPhase('undecided-drag', {
    boundaryDecision: rightFirst.first?.kind
  }), 'spatial-preview');

  const exactTie = drag.segmentBoundaryCrossings({
    ...routing,
    previousX: 210,
    previousY: 110,
    clientX: 230,
    clientY: 130
  });
  assert.equal(exactTie.navigation.t, exactTie.spatial.t);
  assert.equal(exactTie.first?.kind, 'navigation');
  assert.equal(drag.nextPhase('undecided-drag', {
    boundaryDecision: exactTie.first?.kind
  }), 'navigation-extracted');

  assert.equal(drag.nextPhase('undecided-drag', {
    boundaryDecision: null
  }), 'undecided-drag');
  assert.equal(drag.nextPhase('undecided-drag', {
    boundaryDecision: 'spatial',
    spatialPreviewEligible: false
  }), 'navigation-extracted');
  assert.equal(drag.nextPhase('navigation-extracted', {
    previousX: 219,
    clientX: 221,
    sidebarRight: 220,
    spatialPreviewEligible: true
  }), 'spatial-preview');
  assert.equal(drag.nextPhase('navigation-extracted', {
    previousX: 219,
    clientX: 240,
    sidebarRight: 220,
    spatialPreviewEligible: false
  }), 'navigation-extracted');

  const slots = [
    { left: 100, width: 80 },
    { left: 180, width: 120 }
  ];
  assert.equal(tabLayout.insertionIndexAtPoint(slots, 120), 0);
  assert.equal(tabLayout.insertionIndexAtPoint(slots, 150), 1);
  assert.equal(tabLayout.insertionIndexAtPoint(slots, 260), 2);
});

test('sidebar Page drag routing uses only the source row portion visible in the scrollport', () => {
  const clipped = drag.visibleRectWithinClip(
    { left: 40, right: 200, top: 80, bottom: 120 },
    { left: 20, right: 220, top: 100, bottom: 300 }
  );
  assert.deepEqual(clipped, {
    left: 40,
    right: 200,
    top: 100,
    bottom: 120,
    width: 160,
    height: 20
  });
  assert.equal(drag.segmentBoundaryCrossings({
    previousX: 215,
    previousY: 101,
    clientX: 225,
    clientY: 95,
    sourceNameRect: clipped,
    sidebarLeft: 0,
    sidebarRight: 220
  }).first?.kind, 'navigation', 'leaving the visible top edge wins before the right edge');
  assert.equal(drag.visibleRectWithinClip(
    { left: 40, right: 200, top: 80, bottom: 90 },
    { left: 20, right: 220, top: 100, bottom: 300 }
  ), null);
});

test('sidebar Tab entry derives its first insertion index from post-layout slot geometry', async () => {
  const listLeft = 236;
  const scrollLeft = 0;
  const stationaryTabs = Array.from({ length: 5 }, (_, index) => ({
    left: 8 + (index * 117),
    width: 117
  }));
  const insertionForClientX = (clientX) => tabLayout.insertionIndexAtPoint(
    stationaryTabs,
    clientX - listLeft + scrollLeft
  );
  assert.equal(insertionForClientX(244), 0);
  assert.equal(insertionForClientX(361), 1);
  assert.equal(insertionForClientX(595), 3);
  assert.equal(insertionForClientX(1009), 5);

  const app = await read('public/app.js');
  const entry = app.slice(
    app.indexOf('function beginSidebarTabStripEntry'),
    app.indexOf('function clearSidebarTabLayoutParticipation')
  );
  assert.match(entry, /updateTabStripLayout\(\{[\s\S]*?provisionalTabWillBeActive: true[\s\S]*?const stationaryTabs = tabReorderSlots\(list\)[\s\S]*?const width = Math\.max/);
  assert.match(entry, /pointerContentX = state\.lastClientX - listRect\.left \+ list\.scrollLeft/);
  assert.match(entry, /insertionIndexAtPoint\(\s*stationaryTabs,\s*pointerContentX\s*\)/);
  assert.doesNotMatch(entry, /target\.insertionIndex/);
  assert.match(entry, /const plus = strip\.querySelector\('\.viewer-tab-add'\)[\s\S]*?plus\.style\.transform = ''/);

  const sorting = app.slice(
    app.indexOf('function applySharedTabSortingVisuals'),
    app.indexOf('function applySharedTabSortingPreview')
  );
  assert.doesNotMatch(sorting, /state\.source\.type === 'sidebar-page'/);
  assert.doesNotMatch(sorting, /viewer-tab-add/);
  assert.doesNotMatch(sorting, /translate3d\(\$\{state\.draggedSlot\.width\}px/);
});

test('sidebar Page rows stay live until the first name or Sidebar boundary crossing', async () => {
  const [app, navigation, css, html] = await Promise.all([
    read('public/app.js'),
    read('public/js/navigation.js'),
    read('public/styles.css'),
    read('public/index.html')
  ]);
  assert.match(html, /sidebarPageDrag\.js\?v=sidebar-page-drag-v02/);
  assert.match(navigation, /button\.draggable = false/);
  assert.match(navigation, /pointerdown[\s\S]*?beginSidebarPageDrag\(event, button, page\.id\)/);
  assert.match(navigation, /consumeSidebarPageDragClick\(page\.id\)[\s\S]*?const runtime = activePaneRuntime\(\)[\s\S]*?if \(runtime\?\.linkPickMode\)/);
  assert.match(app, /function beginSidebarPageDrag[\s\S]*?beginSharedPageDrag\(\{[\s\S]*?type: 'sidebar-page'[\s\S]*?setPointerCapture/);
  assert.match(app, /function prepareSharedPagePreview[\s\S]*?renderTabPagePreview\(runtime, tab, state\.pageTitle\)/);
  const sharedBegin = app.slice(
    app.indexOf('function beginSharedPageDrag'),
    app.indexOf('function destroySharedPagePreview')
  );
  assert.match(sharedBegin, /dragState\.preparePreview !== false[\s\S]*?prepareSharedPageDragPreview\(dragState\)/);
  const sidebarBegin = app.slice(
    app.indexOf('function beginSidebarPageDrag'),
    app.indexOf('function cancelSidebarPageDrag')
  );
  assert.match(sidebarBegin, /preparePreview: false/);

  const compactStart = app.slice(
    app.indexOf('function startSidebarPageDrag'),
    app.indexOf('function startSidebarPageNavigationExtraction')
  );
  assert.match(compactStart, /state\.phase = 'undecided-drag'/);
  assert.match(compactStart, /navigationPageDragDescriptor\(state\.pageId\)/);
  assert.doesNotMatch(compactStart, /beginSidebarPageNavigationDrag|is-sidebar-page-navigation-drag-source|updateSidebarPageNavigationPresentation/);
  assert.doesNotMatch(compactStart, /prepareSharedPageDragPreview|unfoldSharedPagePreviewFromRect|updateSidebarPageDropTarget|scheduleSidebarPageDragVisuals/);

  const extraction = app.slice(
    app.indexOf('function startSidebarPageNavigationExtraction'),
    app.indexOf('function transitionSidebarPageDragToPreview')
  );
  assert.match(extraction, /state\.phase !== 'undecided-drag'/);
  assert.match(extraction, /beginSidebarPageNavigationDrag\([\s\S]*?state\.lastClientX,[\s\S]*?state\.lastClientY/);
  assert.match(extraction, /state\.phase = 'navigation-extracted'/);
  assert.match(extraction, /is-sidebar-page-navigation-drag-source/);
  assert.match(extraction, /updateSidebarPageNavigationPresentation\(state\)/);

  const transition = app.slice(
    app.indexOf('function transitionSidebarPageDragToPreview'),
    app.indexOf('async function commitSidebarPageDrop')
  );
  assert.match(transition, /\['undecided-drag', 'navigation-extracted'\]\.includes\(state\.phase\)/);
  assert.match(transition, /navigationDragDescriptor\?\.spatialPreviewEligible === false\) return false/);
  assert.match(transition, /navigationWasExtracted = state\.phase === 'navigation-extracted'/);
  assert.match(transition, /clearSidebarPageNavigationPresentation\(state\)[\s\S]*?navigationWasExtracted[\s\S]*?handoffSidebarPageNavigationDragToPreview\(state\.navigationDragDescriptor\)[\s\S]*?state\.navigationDragDescriptor = null[\s\S]*?state\.phase = 'spatial-preview'/);
  assert.match(transition, /prepareSharedPageDragPreview\(state\)[\s\S]*?unfoldSharedPagePreviewFromRect\(state, state\.source\.originRect\)/);
  assert.match(transition, /updateSidebarPageDropTarget\(state\)[\s\S]*?scheduleSidebarPageDragVisuals\(\)/);

  const pointerMove = app.slice(
    app.indexOf('function handleSidebarPageDragPointerMove'),
    app.indexOf('function handleSidebarPageDragPointerUp')
  );
  assert.match(pointerMove, /const previousX = state\.lastClientX[\s\S]*?const previousY = state\.lastClientY/);
  assert.match(pointerMove, /const liveSidebarRect = leftSidebar\.getBoundingClientRect\(\)/);
  assert.match(pointerMove, /state\.routingBoundaryDecision = sidebarPageDragModel\.boundaryDecisionForSegment/);
  assert.ok(
    pointerMove.indexOf('boundaryDecisionForSegment') < pointerMove.indexOf('movementExceeded'),
    'boundary history is captured before the threshold early-return'
  );
  assert.match(pointerMove, /sidebarPageDragModel\.nextPhase\(state\.phase/);
  assert.match(pointerMove, /sidebarPageDragModel\.nextPhase\(state\.phase, \{[\s\S]*?previousX,[\s\S]*?boundaryDecision: state\.routingBoundaryDecision/);
  assert.match(pointerMove, /const navigationStarted = nextPhase === 'navigation-extracted'[\s\S]*?state\.phase === 'undecided-drag'/);
  assert.match(pointerMove, /navigationStarted && !startSidebarPageNavigationExtraction\(state\)/);
  assert.match(pointerMove, /navigationStarted[\s\S]*?event\.clientX > liveSidebarRect\.right[\s\S]*?transitionSidebarPageDragToPreview\(state\)/);
  assert.match(pointerMove, /nextPhase === 'spatial-preview'[\s\S]*?transitionSidebarPageDragToPreview\(state\)/);
  assert.match(pointerMove, /navigationDragDescriptor\?\.spatialPreviewEligible !== false/);
  assert.doesNotMatch(pointerMove, /leftSidebarExpandedWidth|left-sidebar-scroll-region|220/);

  const pointerUp = app.slice(
    app.indexOf('function handleSidebarPageDragPointerUp'),
    app.indexOf('function handleSidebarPageDragPointerCancel')
  );
  assert.match(pointerUp, /state\.phase === 'pressing' \|\| state\.phase === 'undecided-drag'[\s\S]*?handleSidebarPageDragPointerMove\(event\)/);
  assert.ok(
    pointerUp.indexOf('handleSidebarPageDragPointerMove(event)')
      < pointerUp.indexOf('state.lastClientX = event.clientX'),
    'the release segment is routed before final pointer coordinates overwrite its start'
  );

  const extractionStart = app.slice(
    app.indexOf('function startSidebarPageNavigationExtraction'),
    app.indexOf('function transitionSidebarPageDragToPreview')
  );
  assert.match(extractionStart, /beginSidebarPageNavigationDrag\([\s\S]*?state\.sourceRow/);
  assert.match(navigation, /function beginSidebarPageNavigationDrag\([^)]*sourceElement = null\)/);
  assert.match(navigation, /sourceElement: descriptor\.explicitMultiSelection \? null : sourceElement/);

  assert.match(navigation, /function commitSidebarPageNavigationMembershipDrop[\s\S]*?sidebarPageNavigationPayload\(descriptor\)[\s\S]*?motionSession: descriptor\.motionSession/);
  const invalidNavigationReturn = app.slice(
    app.indexOf('function beginSidebarPageDragReturn'),
    app.indexOf('function applySidebarPageDragVisuals')
  );
  assert.match(invalidNavigationReturn, /state\.phase === 'navigation-extracted'[\s\S]*?releaseSidebarPageDragOwnership\(state\)[\s\S]*?restoreSidebarPageNavigationDrag\(descriptor, 'navigation-cancel'\)[\s\S]*?return/);
  assert.match(invalidNavigationReturn, /state\.phase === 'pressing' \|\| state\.phase === 'undecided-drag'[\s\S]*?finishSidebarPageDrag\(state\)/);
  assert.match(invalidNavigationReturn, /animateSharedPagePreviewReturn/);
  assert.match(app, /function animateSharedPagePreviewReturn[\s\S]*?event\.propertyName !== 'transform'/);
  assert.match(css, /\.page-link\.is-sidebar-page-navigation-drag-source/);
  assert.match(css, /\.page-link\.is-sidebar-page-drag-source/);
  assert.match(css, /\.viewer-tab-strip\.is-page-preview-tab-drop-target::before/);
  assert.doesNotMatch(app, /sidebar-page-preview-title|is-sidebar-page-preview/);
  assert.doesNotMatch(css, /sidebar-page-preview-title|is-sidebar-page-preview/);

  const begin = app.slice(
    app.indexOf('function beginSidebarPageDrag'),
    app.indexOf('function cancelSidebarPageDrag')
  );
  assert.doesNotMatch(begin, /querySelector\?\.\('\.nav-page-label-text'\)/);
  assert.match(begin, /const sourceRect = sourceRow\.getBoundingClientRect\(\)[\s\S]*?sourceRow\.closest\?\.\('\.left-sidebar-scroll-region'\)[\s\S]*?visibleRectWithinClip\([\s\S]*?sourceRect,[\s\S]*?sourceClipRect/);
  assert.match(begin, /phase: 'pressing'[\s\S]*?preparePreview: false[\s\S]*?sourceNameRect,[\s\S]*?routingBoundaryDecision: null/);
});

test('navigation membership targets keep root and invalid destinations visually quiet', async () => {
  const [navigation, css] = await Promise.all([
    read('public/js/navigation.js'),
    read('public/styles.css')
  ]);
  const target = navigation.slice(
    navigation.indexOf('function updateSidebarPageNavigationMembershipTarget'),
    navigation.indexOf('async function commitSidebarPageNavigationMembershipDrop')
  );
  assert.match(target, /folderElement\.classList\.toggle\('is-drop-target', !error\)/);
  assert.match(target, /kind: 'folder'[\s\S]*?invalid: Boolean\(error\)/);
  assert.match(target, /kind: 'root'[\s\S]*?invalid: Boolean\(error\)/);
  assert.doesNotMatch(target, /is-invalid-drop-target/);
  assert.doesNotMatch(target, /classList\.(?:add|toggle)\([^)]*is-navigation-root/);
  assert.doesNotMatch(css, /\.nav-folder\.is-invalid-drop-target > \.nav-folder-button/);
  assert.doesNotMatch(css, /\.left-sidebar-scroll-region\.is-navigation-root-(?:drop-target|invalid-drop-target)/);
  assert.doesNotMatch(css, /nav-insert-indicator|--nav-insert-depth/);
});

test('sidebar and detached Tabs share Preview sizing, movement, and Tab midpoint targeting', async () => {
  const app = await read('public/app.js');
  assert.match(app, /function sharedPagePreviewViewportSize[\s\S]*?workspacePaneRoot\?\.clientWidth[\s\S]*?workspacePaneRoot\?\.clientHeight/);
  assert.match(app, /function renderTabPagePreview\(runtime, tab, pageTitle\)[\s\S]*?sharedPagePreviewViewportSize\(runtime\)/);
  assert.match(app, /function positionTabPagePreview\(state\) \{\s*positionSharedPagePreview\(state\)/);
  assert.match(app, /function applySidebarPageDragVisuals[\s\S]*?positionSharedPagePreview\(state\)/);
  assert.match(app, /function detachTabReorder[\s\S]*?showSharedPagePreviewInPageMode\(state, liveTabRect\)/);
  assert.match(app, /function pagePreviewTabDropTarget[\s\S]*?tabStripLayoutModel\.insertionIndexAtPoint\(rects, clientX\)/);
  assert.match(app, /function updateTabStripLayout\(\{[\s\S]*?provisionalInactiveTabCount = null,[\s\S]*?provisionalTabWillBeActive = null[\s\S]*?layoutTabCount = tabs\.length \+ provisionalCount[\s\S]*?preferredTabsWidth = layoutTabCount \* tabStripLayoutModel\.PREFERRED_TAB_WIDTH[\s\S]*?tabCount: layoutTabCount/);
  assert.match(app, /renderedActiveWidth = provisionalWillBeActive && provisionalCount > 0[\s\S]*?provisionalTabWidth: provisionalWillBeActive && provisionalCount > 0[\s\S]*?sizing\.activeWidth/);
  assert.match(app, /function beginSidebarTabStripEntry[\s\S]*?provisionalInactiveTabCount: 1,[\s\S]*?provisionalTabWillBeActive: true[\s\S]*?const stationaryTabs = tabReorderSlots\(list\)[\s\S]*?provisionalSizing\?\.provisionalTabWidth/);
  assert.match(app, /function clearSidebarTabLayoutParticipation[\s\S]*?updateTabStripLayout\(\{ provisionalInactiveTabCount: 0 \}\)/);
});

test('successful sidebar Page drops reuse a target-Pane Tab before creating a clean view', async () => {
  const app = await read('public/app.js');
  const commit = app.match(/async function commitSidebarPageDrop\(state, target\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(commit, /finishSidebarPageDrag\(state\)/);
  assert.match(commit, /target\.kind === 'empty-tab'[\s\S]*?populateActiveEmptyTab\(activePaneRuntime\(\), pageId\)/);
  const tabStripCommit = app.slice(
    app.indexOf("if (target.kind === 'tab-strip')"),
    app.indexOf('function finishSharedPageDragForPaneCommit')
  );
  assert.match(tabStripCommit, /workspaceTabForPageInPane\(target\.ownerPaneId, pageId\)[\s\S]*?activateWorkspaceTab\(existing\)/);
  assert.match(tabStripCommit, /openPageInNewTab\(activePaneRuntime\(\), pageId/);
  assert.match(tabStripCommit, /openPageInWorkspacePane\(/);
  const tabCommit = app.slice(
    app.indexOf('async function commitSidebarTabReorder'),
    app.indexOf('function handleTabReorderPointerUp')
  );
  assert.match(tabCommit, /const insertionIndex = state\.provisionalIndex/);
  assert.match(tabCommit, /workspaceTabForPageInPane\(getActivePane\(\)\?\.id, pageId\)[\s\S]*?activateWorkspaceTab\(existing\)/);
  assert.match(tabCommit, /openPageInNewTab\(activePaneRuntime\(\), pageId, \{[\s\S]*?insertionIndex,[\s\S]*?pageTitle: draggedPageTitle,[\s\S]*?onTabRendered: finishAfterTabRender/);
  assert.match(app, /function commitSharedPageDrag[\s\S]*?tabReorderState === state[\s\S]*?commitMode === 'create-new-tab'[\s\S]*?commitSidebarTabReorder\(state\)/);
  assert.match(app, /async function openPageInNewTab\(runtime, pageId, \{[\s\S]*?pageTitle: requestedPageTitle = null,[\s\S]*?onTabRendered = null[\s\S]*?runtime\.session\.createTab\(pageId, \{ insertionIndex \}\)[\s\S]*?applyTabTitlePresentation\(tabElement, requestedPageTitle\)[\s\S]*?onTabRendered\?\.\(tab, tabElement\)/);
});

test('first main-strip entry hands Sidebar ownership to the Tab reorder controller once', async () => {
  const app = await read('public/app.js');
  const handoff = app.slice(
    app.indexOf('function handoffSidebarPageDragToTabReorder'),
    app.indexOf('function beginSidebarTabStripEntry')
  );
  assert.match(handoff, /releaseSidebarPageDragOwnership\(state\)/);
  assert.match(handoff, /state\.phase = 'reordering'/);
  assert.match(handoff, /state\.gestureIntent = 'horizontal-reorder'/);
  assert.match(handoff, /state\.startClientX = state\.lastClientX[\s\S]*?state\.startClientY = state\.lastClientY/);
  assert.match(handoff, /tabReorderState = state[\s\S]*?addTabReorderPointerListeners\(\)/);
  assert.match(handoff, /state\.element\.setPointerCapture\?\.\(state\.pointerId\)/);

  const release = app.slice(
    app.indexOf('function releaseSidebarPageDragOwnership'),
    app.indexOf('function clearSidebarPageDropIndicators')
  );
  assert.match(release, /cancelAnimationFrame\(sidebarPageDragFrame\)/);
  assert.match(release, /removeSidebarPageDragPointerListeners\(\)/);
  assert.match(release, /sidebarPageDragState === state\) sidebarPageDragState = null/);

  const sidebarMove = app.slice(
    app.indexOf('function handleSidebarPageDragPointerMove'),
    app.indexOf('function handleSidebarPageDragPointerUp')
  );
  assert.doesNotMatch(sidebarMove, /tab-preview|handleTabReorderPointerMove|applyTabReorderVisuals/);
  assert.doesNotMatch(app, /function exitSidebarTabStrip|function applySidebarTabPreviewVisuals/);

  const tabMove = app.slice(
    app.indexOf('function handleTabReorderPointerMove'),
    app.indexOf('function liveOriginalTabRect')
  );
  assert.match(tabMove, /pointerExceedsTabDetachThreshold\(state\)/);
  assert.match(tabMove, /enterTabStripFromPreview\(state, target\)/);

  const cleanup = app.slice(
    app.indexOf('function clearTabReorderTransforms'),
    app.indexOf('function cancelTabReorder')
  );
  assert.match(cleanup, /tabContractElement\?\.removeEventListener/);
  assert.match(cleanup, /tabContractElement\?\.remove\(\)/);
  assert.match(cleanup, /releaseSidebarPageDragOwnership\(state\)/);
});

test('Sidebar-origin detach removes only prospective strip participation and rebuilds it on re-entry', async () => {
  const app = await read('public/app.js');
  const layout = app.slice(
    app.indexOf('function updateTabStripLayout'),
    app.indexOf('function scheduleTabStripLayout')
  );
  assert.match(layout, /tabReorderState\.phase === 'reordering'/);
  assert.match(layout, /sidebarStripParticipationActive !== false/);
  assert.doesNotMatch(layout, /\['reordering', 'detached-preview'\]/);

  const clearParticipation = app.slice(
    app.indexOf('function clearSidebarProspectiveTabStripParticipation'),
    app.indexOf('function restoreSidebarProspectiveTabStripParticipation')
  );
  assert.match(clearParticipation, /source\?\.type !== 'sidebar-page'/);
  assert.match(clearParticipation, /const oldRects = new Map[\s\S]*?slot\.element\.getBoundingClientRect\(\)/);
  assert.match(clearParticipation, /const oldPlusRect = plus\?\.getBoundingClientRect\(\) \|\| null/);
  assert.match(clearParticipation, /clearTabReorderSlotPresentation\(state\)/);
  assert.match(clearParticipation, /slot\.element\.style\.transform = ''|clearTabReorderSlotPresentation/);
  assert.match(clearParticipation, /plus\.style\.transform = ''/);
  assert.match(clearParticipation, /state\.sidebarStripParticipationActive = false/);
  assert.match(clearParticipation, /provisionalInactiveTabCount: 0,[\s\S]*?provisionalTabWillBeActive: false/);
  assert.match(clearParticipation, /settleTabStripGeometry\(oldRects, \{[\s\S]*?oldPlusRect,[\s\S]*?layoutOptions/);
  assert.match(clearParticipation, /state\.slots = \[\.\.\.\(state\.stationaryTabs \|\| \[\]\)\][\s\S]*?state\.draggedSlot = null[\s\S]*?state\.provisionalSlotRects = null/);
  assert.doesNotMatch(clearParticipation, /applyDetachedSourceGap|detachedOffsets/);

  const restoreParticipation = app.slice(
    app.indexOf('function restoreSidebarProspectiveTabStripParticipation'),
    app.indexOf('function detachTabReorder')
  );
  assert.match(restoreParticipation, /provisionalInactiveTabCount: 1,[\s\S]*?provisionalTabWillBeActive: true/);
  assert.match(restoreParticipation, /const stationaryTabs = tabReorderSlots\(list\)/);
  assert.match(restoreParticipation, /insertionIndexAtPoint\([\s\S]*?stationaryTabs,[\s\S]*?pointerContentX/);
  assert.match(restoreParticipation, /slots\.splice\(originIndex, 0, draggedSlot\)/);
  assert.match(restoreParticipation, /state\.sidebarStripParticipationActive = true/);

  const detach = app.slice(
    app.indexOf('function detachTabReorder'),
    app.indexOf('function enterTabStripFromPreview')
  );
  assert.match(detach, /state\.source\?\.type === 'sidebar-page'[\s\S]*?clearSidebarProspectiveTabStripParticipation\(state\)[\s\S]*?else \{[\s\S]*?applyDetachedSourceGap\(state\)/);

  const reentry = app.slice(
    app.indexOf('function enterTabStripFromPreview'),
    app.indexOf('function currentStationaryTabSlotGeometry')
  );
  assert.match(reentry, /restoreSidebarProspectiveTabStripParticipation\(state, target\)/);
  assert.doesNotMatch(reentry, /sidebarPageDragState|scheduleSidebarPageDragVisuals/);

  const settle = app.slice(
    app.indexOf('function settleTabStripGeometry'),
    app.indexOf('function settleCommittedTabReorder')
  );
  assert.match(settle, /updateTabStripLayout\(layoutOptions\)/);
  assert.match(settle, /const finalRects = new Map[\s\S]*?getBoundingClientRect\(\)/);
  assert.match(settle, /setTabSettleWidth\(element, previous\.width\)/);
  assert.match(settle, /previous\.left - initial\.left/);
  assert.match(settle, /oldPlusRect\.left - finalPlusRect\.left/);
  assert.match(settle, /window\.requestAnimationFrame[\s\S]*?is-tab-reorder-settling[\s\S]*?translate3d\(0, 0, 0\)/);
  assert.match(settle, /TAB_REORDER_SETTLE_DURATION/);

  const css = await read('public/styles.css');
  assert.match(css, /\.viewer-tab\.is-tab-reorder-settling \{[^}]*flex-basis 140ms ease[^}]*width 140ms ease[^}]*min-width 140ms ease[^}]*max-width 140ms ease/);
  assert.match(css, /\.viewer-tab-add\.is-tab-reorder-settling \{[^}]*transform 140ms ease/);
});

test('Viewer uses one ordered symmetric Pane model and retires recursive static secondary Panes', async () => {
  const [app, html, css, paneModel] = await Promise.all([
    read('public/app.js'), read('public/index.html'), read('public/styles.css'),
    read('public/workspacePanes.js')
  ]);
  assert.match(html, /id="workspace-pane-root"[\s\S]*?data-workspace-pane-id="main-pane"/);
  assert.match(html, /workspacePanes\.js\?v=pane-stack-v04/);
  assert.match(paneModel, /panes: \[\][\s\S]*?activePaneId: null/);
  assert.match(app, /function getActivePane\(\)[\s\S]*?workspace\.activePane\(\)/);
  assert.match(app, /function activePaneRuntime\(\)[\s\S]*?runtimeForPane\(workspace\.state\.activePaneId\)/);
  assert.doesNotMatch(app, /function getActivePaneSession\(/);
  assert.match(app, /function createAllocatedWorkspacePane[\s\S]*?workspace\.addPaneAllocated[\s\S]*?createPaneCanvasElement/);
  assert.doesNotMatch(app, /createWorkspacePaneForPage|hnPanePhase1/);
  assert.match(css, /\.workspace-pane-root \{[^}]*flex-direction: row/);
  assert.match(css, /\.workspace-pane-tab-collection \{[^}]*display: flex/);
  assert.doesNotMatch(app, /secondaryWorkspacePanes|renderSecondaryWorkspacePane|createSecondaryWorkspacePane/);
  assert.doesNotMatch(css, /workspace-pane-split|workspace-pane-static-content|workspace-secondary-pane/);
});
