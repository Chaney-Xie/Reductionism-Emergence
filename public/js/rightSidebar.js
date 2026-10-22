/* Right-sidebar sections, Maintenance, relation facets, and Relations rendering.
 * Uses relationFiltersModel for pure filtering and the shared app runtime for page actions.
 */
function rightSectionElement(sectionId) {
  return rightSidebar?.querySelector(`[data-right-section="${sectionId}"]`) || null;
}

function rightSectionExpanded(sectionId) {
  return !collapsedRightSectionIds.has(sectionId);
}

function rightSidebarNestedFoldRegion(foldId, root = rightSidebar) {
  return [...(root?.querySelectorAll?.('[data-right-fold-region]') || [])]
    .find((element) => element.dataset.rightFoldRegion === foldId) || null;
}

const rightSidebarNestedFoldAnimator = disclosureMotionModel.createController({
  root: () => rightSidebar,
  activityClass: 'is-right-sidebar-fold-animating',
  visibilityClass: 'right-sidebar-collapsed',
  resolveRegion: rightSidebarNestedFoldRegion
});

function interruptRightSidebarNestedFoldMotion(reason = 'rerender') {
  return rightSidebarNestedFoldAnimator.cancel(reason) === true;
}

function animateRightSidebarNestedFold(foldId, expanding, render) {
  return rightSidebarNestedFoldAnimator.play({
    disclosureId: foldId,
    expanding,
    render
  });
}

function normalizeRightSidebarView(viewId) {
  return Object.hasOwn(RIGHT_SIDEBAR_VIEW_SECTION_IDS, viewId) ? viewId : 'relations';
}

function rightSidebarViewSectionIds(viewId = rightSidebarView) {
  return RIGHT_SIDEBAR_VIEW_SECTION_IDS[normalizeRightSidebarView(viewId)];
}

function activeRightSidebarViewPanel() {
  return rightSidebarViewPanels.find((panel) => (
    panel.dataset.rightSidebarViewPanel === rightSidebarView
  )) || null;
}

function setRightSidebarView(viewId, { persist = true } = {}) {
  const nextView = normalizeRightSidebarView(viewId);
  interruptRightSidebarNestedFoldMotion('view-change');
  const runtime = activePaneRuntime();
  if (runtime) clearExternalLinkBlockHover(runtime);
  rightSidebarResizeCleanup?.();
  rightSidebarView = nextView;
  for (const panel of rightSidebarViewPanels) {
    panel.hidden = panel.dataset.rightSidebarViewPanel !== nextView;
  }
  for (const button of rightSidebarViewButtons) {
    const active = button.dataset.rightSidebarView === nextView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  updateRightSidebarLayout();
  if (persist) scheduleWorkspaceStateSave();
  return nextView;
}

function nextExpandedRightSection(sectionId, sectionIds = rightSidebarViewSectionIds()) {
  const index = sectionIds.indexOf(sectionId);
  if (index < 0) return null;
  return sectionIds.slice(index + 1).find(rightSectionExpanded) || null;
}

let rightSectionMotionSession = null;
let rightSectionMotionSequence = 0;

function rightSectionMotionStyle(element) {
  const view = element?.ownerDocument?.defaultView
    || (typeof window !== 'undefined' ? window : null);
  if (typeof view?.getComputedStyle === 'function') return view.getComputedStyle(element);
  if (typeof getComputedStyle === 'function') return getComputedStyle(element);
  return null;
}

function rightSectionMotionTranslateY(transform) {
  if (!transform || transform === 'none') return 0;
  const matrix3d = String(transform).match(/^matrix3d\(([^)]+)\)$/);
  if (matrix3d) {
    const values = matrix3d[1].split(',').map(Number);
    return Number.isFinite(values[13]) ? values[13] : 0;
  }
  const matrix = String(transform).match(/^matrix\(([^)]+)\)$/);
  if (matrix) {
    const values = matrix[1].split(',').map(Number);
    return Number.isFinite(values[5]) ? values[5] : 0;
  }
  const translate = String(transform).match(
    /translate(?:3d|Y)?\(\s*(?:[^,]+,\s*)?(-?\d+(?:\.\d+)?)px/
  );
  return translate ? Number.parseFloat(translate[1]) || 0 : 0;
}

function rightSectionMotionTiming() {
  const rootStyle = typeof document !== 'undefined'
    ? rightSectionMotionStyle(document.documentElement)
    : null;
  const rawDuration = rootStyle?.getPropertyValue?.('--sidebar-motion-duration')?.trim() || '';
  const duration = rawDuration.endsWith('ms')
    ? Number.parseFloat(rawDuration)
    : rawDuration.endsWith('s')
      ? Number.parseFloat(rawDuration) * 1000
      : Number.NaN;
  const sharedDuration = typeof disclosureMotionModel !== 'undefined'
    ? Number(disclosureMotionModel.DISCLOSURE_DURATION_MS)
    : Number.NaN;
  return {
    duration: Number.isFinite(duration)
      ? duration
      : (Number.isFinite(sharedDuration) ? sharedDuration : 176),
    easing: rootStyle?.getPropertyValue?.('--sidebar-motion-easing')?.trim()
      || 'cubic-bezier(.2, .75, .25, 1)'
  };
}

function rightSectionMotionReduced() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch (_error) {
    return false;
  }
}

function rightSectionMotionElements(panel = activeRightSidebarViewPanel()) {
  if (!panel) return { bodies: [], resizers: [] };
  const bodies = rightSidebarViewSectionIds().map((sectionId) => {
    const section = rightSectionElement(sectionId);
    const body = section?.querySelector('.right-section-body') || null;
    const content = body?.firstElementChild || body?.children?.[0] || null;
    return body ? { sectionId, section, body, content } : null;
  }).filter(Boolean);
  const resizers = [...panel.querySelectorAll('.right-section-resizer')].map((resizer) => ({
    sectionId: resizer.dataset.section,
    resizer
  }));
  return { bodies, resizers };
}

function rightSectionMotionSnapshot(panel = activeRightSidebarViewPanel()) {
  const snapshot = { bodies: new Map(), resizers: new Map() };
  const elements = rightSectionMotionElements(panel);
  for (const { sectionId, section, body, content } of elements.bodies) {
    const style = rightSectionMotionStyle(body);
    const contentStyle = rightSectionMotionStyle(content);
    const height = Number(body.getBoundingClientRect?.().height) || 0;
    snapshot.bodies.set(sectionId, {
      height,
      opacity: height > 0 ? Number.parseFloat(style?.opacity || '1') : 0,
      paddingTop: height > 0 ? (style?.paddingTop || '0px') : '0px',
      paddingBottom: height > 0 ? (style?.paddingBottom || '0px') : '0px',
      contentTranslateY: height > 0
        ? rightSectionMotionTranslateY(contentStyle?.transform)
        : 0,
      section,
      body,
      content
    });
  }
  for (const { sectionId, resizer } of elements.resizers) {
    snapshot.resizers.set(sectionId, {
      height: resizer.hidden ? 0 : (Number(resizer.getBoundingClientRect?.().height) || 0),
      opacity: resizer.hidden ? 0 : Number.parseFloat(
        rightSectionMotionStyle(resizer)?.opacity || '1'
      ),
      resizer
    });
  }
  return snapshot;
}

function rememberRightSectionMotionStyle(element, keys) {
  return Object.fromEntries(keys.map((key) => [key, element?.style?.[key] ?? '']));
}

function restoreRightSectionMotionStyle(element, values) {
  if (!element?.style || !values) return;
  for (const [key, value] of Object.entries(values)) element.style[key] = value;
}

function cleanupRightSectionMotion(session, { reconcile = false } = {}) {
  if (!session || session.cleaned) return;
  session.cleaned = true;
  if (session.fallbackTimer) window.clearTimeout(session.fallbackTimer);
  for (const animation of session.animations) {
    try { animation.cancel?.(); } catch (_error) { /* Presentation cleanup is best-effort. */ }
  }
  for (const record of session.bodyRecords) {
    restoreRightSectionMotionStyle(record.body, record.inline);
  }
  for (const record of session.contentRecords) {
    restoreRightSectionMotionStyle(record.content, record.inline);
  }
  for (const record of session.resizerRecords) {
    restoreRightSectionMotionStyle(record.resizer, record.inline);
  }
  if (rightSectionMotionSession === session) rightSectionMotionSession = null;
  if (reconcile) applyRightSidebarLayout();
}

function cancelRightSectionMotion({ reconcile = false } = {}) {
  if (!rightSectionMotionSession) return false;
  const session = rightSectionMotionSession;
  session.cancelled = true;
  cleanupRightSectionMotion(session, { reconcile });
  return true;
}

function applyRightSidebarLayout() {
  if (!rightSidebar) return;
  for (const section of rightSidebar.querySelectorAll('.right-sidebar-section')) {
    const sectionId = section.dataset.rightSection;
    const expanded = rightSectionExpanded(sectionId);
    section.classList.toggle('is-collapsed', !expanded);
    section.querySelector('.right-section-toggle')?.setAttribute('aria-expanded', String(expanded));
    section.style.flex = '0 0 auto';
    const body = section.querySelector('.right-section-body');
    if (body) {
      body.style.height = '';
      body.style.flex = '';
    }
  }
  const activePanel = activeRightSidebarViewPanel();
  if (!activePanel) return;
  const sectionIds = rightSidebarViewSectionIds();
  for (const resizer of activePanel.querySelectorAll('.right-section-resizer')) {
    resizer.hidden = false;
  }

  const sidebarHeight = activePanel.getBoundingClientRect().height
    || rightSidebar.getBoundingClientRect().height;
  if (sidebarHeight <= 0) return;
  const expandedIds = sectionIds.filter(rightSectionExpanded);
  const headerHeight = [...activePanel.querySelectorAll('.right-section-header')]
    .reduce((total, header) => total + header.getBoundingClientRect().height, 0);
  const handleHeight = [...activePanel.querySelectorAll('.right-section-resizer:not([hidden])')]
    .reduce((total, handle) => total + handle.getBoundingClientRect().height, 0);
  const availableForBodies = Math.max(
    RIGHT_SECTION_BODY_MIN_HEIGHT * expandedIds.length,
    sidebarHeight - headerHeight - handleHeight
  );
  let remaining = availableForBodies;
  expandedIds.forEach((sectionId, index) => {
    const remainingSections = expandedIds.length - index - 1;
    const maximum = Math.max(
      RIGHT_SECTION_BODY_MIN_HEIGHT,
      remaining - RIGHT_SECTION_BODY_MIN_HEIGHT * remainingSections
    );
    const preferred = rightSectionHeights.get(sectionId) || RIGHT_SECTION_BODY_MIN_HEIGHT;
    const effective = Math.max(
      RIGHT_SECTION_BODY_MIN_HEIGHT,
      Math.min(maximum, preferred)
    );
    rightSectionEffectiveHeights.set(sectionId, effective);
    remaining -= effective;
    const body = rightSectionElement(sectionId)?.querySelector('.right-section-body');
    if (body) {
      body.style.height = `${effective}px`;
      body.style.flex = `0 0 ${effective}px`;
    }
  });
}

function updateRightSidebarLayout() {
  cancelRightSectionMotion();
  applyRightSidebarLayout();
}

function animateRightSidebarSectionToggle(sectionId) {
  interruptRightSidebarNestedFoldMotion('section-toggle');
  const panel = activeRightSidebarViewPanel();
  const before = rightSectionMotionSnapshot(panel);
  cancelRightSectionMotion();
  const expanding = collapsedRightSectionIds.has(sectionId);
  if (expanding) collapsedRightSectionIds.delete(sectionId);
  else collapsedRightSectionIds.add(sectionId);
  const runtime = activePaneRuntime();
  if (sectionId === 'external-links' && !expanding && runtime) {
    clearExternalLinkBlockHover(runtime);
  }
  applyRightSidebarLayout();
  scheduleWorkspaceStateSave();

  if (!panel || rightSectionMotionReduced()) return true;
  const { duration, easing } = rightSectionMotionTiming();
  const session = {
    id: ++rightSectionMotionSequence,
    sectionId,
    expanding,
    animations: [],
    bodyRecords: [],
    contentRecords: [],
    resizerRecords: [],
    fallbackTimer: 0,
    cancelled: false,
    cleaned: false
  };
  rightSectionMotionSession = session;
  const elements = rightSectionMotionElements(panel);

  for (const { sectionId: bodySectionId, body, content } of elements.bodies) {
    const start = before.bodies.get(bodySectionId) || {
      height: 0,
      opacity: 0,
      paddingTop: '0px',
      paddingBottom: '0px',
      contentTranslateY: 0
    };
    const expanded = rightSectionExpanded(bodySectionId);
    const targetHeight = expanded
      ? (rightSectionEffectiveHeights.get(bodySectionId)
        || Number.parseFloat(body.style.height)
        || 0)
      : 0;
    const targetStyle = rightSectionMotionStyle(body);
    const target = {
      height: targetHeight,
      opacity: expanded ? 1 : 0,
      paddingTop: expanded ? (targetStyle?.paddingTop || '0px') : '0px',
      paddingBottom: expanded ? (targetStyle?.paddingBottom || '0px') : '0px'
    };
    const inline = rememberRightSectionMotionStyle(body, [
      'display', 'minHeight', 'overflow', 'pointerEvents', 'willChange'
    ]);
    session.bodyRecords.push({ body, inline });
    body.style.display = 'block';
    body.style.minHeight = '0px';
    body.style.overflow = 'hidden';
    body.style.pointerEvents = 'none';
    body.style.willChange = 'height, flex-basis, padding, opacity';
    if (typeof body.animate !== 'function') continue;
    const animation = body.animate([{
      height: `${start.height}px`,
      flexBasis: `${start.height}px`,
      paddingTop: start.paddingTop,
      paddingBottom: start.paddingBottom,
      opacity: start.opacity
    }, {
      height: `${target.height}px`,
      flexBasis: `${target.height}px`,
      paddingTop: target.paddingTop,
      paddingBottom: target.paddingBottom,
      opacity: target.opacity
    }], { duration, easing, fill: 'both' });
    session.animations.push(animation);

    if (!content || typeof content.animate !== 'function') continue;
    const startPaddingTop = Number.parseFloat(start.paddingTop) || 0;
    const targetPaddingTop = Number.parseFloat(target.paddingTop) || 0;
    const sampledTranslateY = Number(start.contentTranslateY) || 0;
    const startTranslateY = expanded && start.height <= 0.5
      ? targetPaddingTop - startPaddingTop
      : sampledTranslateY;
    const targetTranslateY = expanded
      ? 0
      : startTranslateY + startPaddingTop - targetPaddingTop;
    if (Math.abs(startTranslateY - targetTranslateY) < 0.01) continue;
    const contentInline = rememberRightSectionMotionStyle(content, [
      'transform', 'transformOrigin', 'willChange'
    ]);
    session.contentRecords.push({ content, inline: contentInline });
    content.style.transformOrigin = 'top';
    content.style.willChange = 'transform';
    const contentAnimation = content.animate([{
      transform: `translate3d(0, ${startTranslateY}px, 0)`
    }, {
      transform: `translate3d(0, ${targetTranslateY}px, 0)`
    }], { duration, easing, fill: 'both' });
    session.animations.push(contentAnimation);
  }

  for (const { sectionId: resizerSectionId, resizer } of elements.resizers) {
    const start = before.resizers.get(resizerSectionId) || { height: 0, opacity: 0 };
    const targetHeight = Number(resizer.getBoundingClientRect?.().height);
    const inline = rememberRightSectionMotionStyle(resizer, [
      'display', 'height', 'minHeight', 'maxHeight', 'overflow', 'pointerEvents', 'willChange'
    ]);
    session.resizerRecords.push({ resizer, inline });
    resizer.hidden = false;
    resizer.style.display = 'block';
    resizer.style.overflow = 'hidden';
    resizer.style.pointerEvents = 'none';
    resizer.style.willChange = 'height, flex-basis, opacity';
    if (typeof resizer.animate !== 'function') continue;
    const animation = resizer.animate([{
      height: `${start.height}px`,
      minHeight: '0px',
      maxHeight: `${start.height}px`,
      flexBasis: `${start.height}px`,
      opacity: start.opacity
    }, {
      height: `${targetHeight}px`,
      minHeight: '0px',
      maxHeight: `${targetHeight}px`,
      flexBasis: `${targetHeight}px`,
      opacity: 1
    }], { duration, easing, fill: 'both' });
    session.animations.push(animation);
  }

  const settle = () => {
    if (rightSectionMotionSession !== session || session.cancelled) return;
    cleanupRightSectionMotion(session);
    applyRightSidebarLayout();
  };
  session.fallbackTimer = window.setTimeout(settle, duration + 80);
  if (session.animations.length) {
    Promise.allSettled(session.animations.map((animation) => animation.finished)).then(settle);
  } else {
    Promise.resolve().then(settle);
  }
  return true;
}

function startRightSidebarResize(event, resizer) {
  if (event.button !== 0 || event.isPrimary === false || resizer.hidden) return;
  const sectionId = resizer.dataset.section;
  const nextSectionId = nextExpandedRightSection(sectionId);
  if (!nextSectionId || !rightSectionExpanded(sectionId)) return;
  event.preventDefault();
  cancelRightSectionMotion({ reconcile: true });
  rightSidebarResizeCleanup?.();

  const pointerId = event.pointerId;
  const startY = event.clientY;
  const startHeight = rightSectionEffectiveHeights.get(sectionId)
    || rightSectionHeights.get(sectionId)
    || RIGHT_SECTION_BODY_MIN_HEIGHT;
  const nextStartHeight = rightSectionEffectiveHeights.get(nextSectionId)
    || rightSectionHeights.get(nextSectionId)
    || RIGHT_SECTION_BODY_MIN_HEIGHT;
  document.body.classList.add('right-sidebar-resizing');
  let finished = false;

  const onMove = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    moveEvent.preventDefault();
    const requestedDelta = moveEvent.clientY - startY;
    const delta = Math.max(
      RIGHT_SECTION_BODY_MIN_HEIGHT - startHeight,
      Math.min(nextStartHeight - RIGHT_SECTION_BODY_MIN_HEIGHT, requestedDelta)
    );
    rightSectionHeights.set(sectionId, startHeight + delta);
    rightSectionHeights.set(nextSectionId, nextStartHeight - delta);
    updateRightSidebarLayout();
    scheduleWorkspaceStateSave();
  };
  const stop = (stopEvent) => {
    if (finished) return;
    if (stopEvent?.pointerId !== undefined && stopEvent.pointerId !== pointerId) return;
    finished = true;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', stop, true);
    window.removeEventListener('pointercancel', stop, true);
    resizer.removeEventListener('lostpointercapture', stop);
    document.body.classList.remove('right-sidebar-resizing');
    rightSidebarResizeCleanup = null;
    if (resizer.hasPointerCapture?.(pointerId)) {
      try {
        resizer.releasePointerCapture(pointerId);
      } catch (_error) {
        // Chromium may already have released capture after pointer cancellation.
      }
    }
  };
  rightSidebarResizeCleanup = () => stop();
  window.addEventListener('pointermove', onMove, { capture: true, passive: false });
  window.addEventListener('pointerup', stop, true);
  window.addEventListener('pointercancel', stop, true);
  resizer.addEventListener('lostpointercapture', stop);
  try {
    resizer.setPointerCapture(pointerId);
  } catch (_error) {
    stop();
  }
}

function initializeRightSidebar() {
  if (!rightSidebar || rightSidebar.dataset.initialized === 'true') return;
  rightSidebar.dataset.initialized = 'true';
  for (const button of rightSidebarViewButtons) {
    button.addEventListener('click', () => setRightSidebarView(button.dataset.rightSidebarView));
  }
  for (const toggle of rightSidebar.querySelectorAll('.right-section-toggle')) {
    toggle.addEventListener('click', () => {
      const sectionId = toggle.closest('.right-sidebar-section')?.dataset.rightSection;
      if (!sectionId) return;
      animateRightSidebarSectionToggle(sectionId);
    });
  }
  rightCategoryClear?.addEventListener('click', clearRightCategoryFilters);
  rightDescriptorClear?.addEventListener('click', clearRightDescriptorFilters);
  for (const resizer of rightSidebar.querySelectorAll('.right-section-resizer')) {
    resizer.addEventListener('pointerdown', (event) => startRightSidebarResize(event, resizer));
  }
  window.addEventListener('resize', updateRightSidebarLayout);
  setRightSidebarView(rightSidebarView, { persist: false });
}

function resetRightRelationFilters() {
  selectedRightCategoryIds.clear();
  selectedRightDescriptorGroupIds.clear();
}

function initializeRightCategoryGroupsCollapsed() {
  if (rightCategoryGroupsInitialized) return;
  for (const root of categoryRoots()) {
    collapsedRightCategoryGroupIds.add(root.id || root.label || 'category-group');
  }
  rightCategoryGroupsInitialized = true;
}

function updateRightFilterHeaderActions() {
  if (rightCategoryClear) rightCategoryClear.hidden = selectedRightCategoryIds.size === 0;
  if (rightDescriptorClear) rightDescriptorClear.hidden = selectedRightDescriptorGroupIds.size === 0;
}

function clearRightCategoryFilters() {
  selectedRightCategoryIds.clear();
  const runtime = activePaneRuntime();
  if (runtime) renderRelations(runtime, runtime.currentPage || { blocks: [], backlinks: [] });
}

function clearRightDescriptorFilters() {
  selectedRightDescriptorGroupIds.clear();
  const runtime = activePaneRuntime();
  if (runtime) renderRelations(runtime, runtime.currentPage || { blocks: [], backlinks: [] });
}

function renderRightCategoryFilter(runtime, { rightSidebarFoldRender = false } = {}) {
  if (runtime !== activePaneRuntime() || !rightCategoryFilter) return;
  if (!rightSidebarFoldRender) interruptRightSidebarNestedFoldMotion('category-rerender');
  initializeRightCategoryGroupsCollapsed();
  rightCategoryFilter.replaceChildren();
  updateRightFilterHeaderActions();

  const roots = categoryRoots();
  if (!roots.length) {
    const empty = document.createElement('p');
    empty.className = 'right-filter-empty';
    empty.textContent = 'No categories configured.';
    rightCategoryFilter.append(empty);
    return;
  }

  for (const root of roots) {
    const groupId = root.id || root.label || 'category-group';
    const collapsed = collapsedRightCategoryGroupIds.has(groupId);
    const foldId = `right-category:${groupId}`;
    const group = document.createElement('section');
    group.className = 'right-filter-group';
    group.dataset.sidebarMotionId = foldId;
    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'right-filter-group-heading';
    heading.setAttribute('aria-expanded', String(!collapsed));
    const disclosure = document.createElement('span');
    disclosure.className = 'disclosure-chevron';
    disclosure.setAttribute('aria-hidden', 'true');
    const headingLabel = document.createElement('span');
    headingLabel.textContent = root.label || root.id || 'Category';
    heading.append(disclosure, headingLabel);
    heading.addEventListener('click', () => {
      if (collapsed) collapsedRightCategoryGroupIds.delete(groupId);
      else collapsedRightCategoryGroupIds.add(groupId);
      void animateRightSidebarNestedFold(foldId, collapsed, () => {
        if (runtime === activePaneRuntime()) {
          renderRightCategoryFilter(runtime, { rightSidebarFoldRender: true });
        }
      });
    });
    group.append(heading);

    const items = document.createElement('div');
    items.className = 'right-filter-items';
    items.dataset.rightFoldRegion = foldId;
    items.hidden = collapsed;
    const addItems = (nodes, depth = 0) => {
      for (const node of nodes || []) {
        if (node?.type === 'item') {
          const label = document.createElement('label');
          label.className = 'right-filter-checkbox';
          label.style.setProperty('--right-filter-depth', String(depth));
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = selectedRightCategoryIds.has(node.id);
          input.addEventListener('change', () => {
            if (input.checked) selectedRightCategoryIds.add(node.id);
            else selectedRightCategoryIds.delete(node.id);
            if (runtime === activePaneRuntime()) {
              renderRelations(runtime, runtime.currentPage || { blocks: [], backlinks: [] });
            }
          });
          const text = document.createElement('span');
          text.textContent = node.label || node.id;
          label.append(input, text);
          items.append(label);
        } else addItems(node?.children || [], depth + 1);
      }
    };
    addItems(root.children || []);
    group.append(items);
    rightCategoryFilter.append(group);
  }
}

function renderRightDescriptorGroupNode(runtime, groupId, depth = 0) {
  const group = descriptorGroupsConfig?.groups?.[groupId];
  const count = rightRelationFilterContext?.descriptorGroupCounts?.get(groupId) || 0;
  if (!group || count === 0) return null;
  const visibleChildren = descriptorGroupsModel.childGroupIds(descriptorGroupsConfig, groupId)
    .filter((childId) => (rightRelationFilterContext.descriptorGroupCounts.get(childId) || 0) > 0);
  const expanded = expandedRightDescriptorGroupIds.has(groupId);
  const foldId = `right-descriptor:${groupId}`;
  const node = document.createElement('div');
  node.className = 'right-descriptor-filter-node';
  node.dataset.sidebarMotionId = foldId;
  const row = document.createElement('div');
  row.className = 'right-descriptor-filter-row';
  row.style.setProperty('--right-filter-depth', String(depth));

  const disclosure = document.createElement('button');
  disclosure.type = 'button';
  disclosure.className = 'right-descriptor-disclosure';
  disclosure.disabled = visibleChildren.length === 0;
  disclosure.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${group.name}`);
  disclosure.setAttribute('aria-expanded', String(expanded));
  if (visibleChildren.length) {
    const chevron = document.createElement('span');
    chevron.className = 'disclosure-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    disclosure.append(chevron);
  }
  disclosure.addEventListener('click', () => {
    if (expanded) expandedRightDescriptorGroupIds.delete(groupId);
    else expandedRightDescriptorGroupIds.add(groupId);
    void animateRightSidebarNestedFold(foldId, !expanded, () => {
      if (runtime === activePaneRuntime()) {
        renderRightDescriptorFilter(runtime, { rightSidebarFoldRender: true });
      }
    });
  });

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = selectedRightDescriptorGroupIds.has(groupId);
  input.setAttribute('aria-label', `Filter by ${group.name}`);
  input.addEventListener('change', () => {
    if (input.checked) selectedRightDescriptorGroupIds.add(groupId);
    else selectedRightDescriptorGroupIds.delete(groupId);
    if (runtime === activePaneRuntime()) {
      renderRelations(runtime, runtime.currentPage || { blocks: [], backlinks: [] });
    }
  });
  const name = document.createElement('span');
  name.className = 'right-descriptor-filter-name';
  name.textContent = group.name;
  const countEl = document.createElement('span');
  countEl.className = 'right-descriptor-filter-count';
  countEl.textContent = String(count);
  row.append(disclosure, input, name, countEl);
  node.append(row);

  if (expanded && visibleChildren.length) {
    const children = document.createElement('div');
    children.className = 'right-descriptor-filter-children';
    children.dataset.rightFoldRegion = foldId;
    for (const childId of visibleChildren) {
      const child = renderRightDescriptorGroupNode(runtime, childId, depth + 1);
      if (child) children.append(child);
    }
    node.append(children);
  }
  return node;
}

function renderRightDescriptorFilter(runtime, { rightSidebarFoldRender = false } = {}) {
  if (runtime !== activePaneRuntime() || !rightDescriptorFilter) return;
  if (!rightSidebarFoldRender) interruptRightSidebarNestedFoldMotion('descriptor-rerender');
  rightDescriptorFilter.replaceChildren();
  updateRightFilterHeaderActions();
  const roots = descriptorGroupsModel.childGroupIds(descriptorGroupsConfig || {}, null);
  let rendered = 0;
  for (const groupId of roots) {
    const node = renderRightDescriptorGroupNode(runtime, groupId);
    if (node) {
      rightDescriptorFilter.append(node);
      rendered += 1;
    }
  }
  if (!rendered) {
    const empty = document.createElement('p');
    empty.className = 'right-filter-empty';
    empty.textContent = 'No matching descriptor groups.';
    rightDescriptorFilter.append(empty);
  }
}

function renderMaintenanceResources(runtime, page) {
  if (runtime !== activePaneRuntime()) return;
  const imageObjects = (page.objects || []).filter((object) => isDisplayableObject(object));
  const imageObjectSet = new Set(imageObjects);
  const objectIds = new Set(imageObjects.map((object) => object.id));
  const additionalResources = (page.maintenanceResources || [])
    .filter((resource) => !resource.objectId || !objectIds.has(resource.objectId));
  const resources = [...imageObjects, ...additionalResources];

  resourcesList.replaceChildren();
  if (!resources.length) {
    const item = document.createElement('li');
    item.className = 'muted';
    item.textContent = 'No maintenance files.';
    resourcesList.append(item);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const resource of resources) {
    const item = document.createElement('li');
    item.className = 'resource-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'resource-item-button file-typography';
    button.dataset.resourceId = resource.id;
    button.dataset.resourceKind = imageObjectSet.has(resource) ? 'object' : 'resource';
    button.textContent = itemLabel(resource);
    button.addEventListener('contextmenu', (event) => openResourceContextMenu(runtime, event, resource));
    item.addEventListener('click', resourceLocationsModel.createResourceRowOpenClickHandler(
      resource,
      (target) => {
        if (runtime === activePaneRuntime()) openResourceInDesktop(runtime, target);
      }
    ));

    if (isDisplayableObject(resource)) {
      button.classList.add('is-displayable');
      if (!isVisibleObject(resource)) {
        button.classList.add('is-hidden');
        button.append(' ');
        const meta = document.createElement('span');
        meta.className = 'resource-item-meta';
        meta.textContent = '(hidden)';
        button.append(meta);
      }
    } else {
      button.classList.add('is-maintenance-resource');
      if (resource.resourceType) {
        button.append(' ');
        const meta = document.createElement('span');
        meta.className = 'resource-item-meta';
        meta.textContent = `(${resource.resourceType})`;
        button.append(meta);
      }
    }

    item.append(button);
    if (isDesktopResourceActionAvailable(resource)) {
      const revealButton = document.createElement('button');
      revealButton.type = 'button';
      revealButton.className = 'resource-reveal-button';
      revealButton.title = 'Reveal in Finder';
      revealButton.setAttribute('aria-label', 'Reveal in Finder');
      const revealIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      revealIcon.setAttribute('viewBox', '0 0 16 16');
      revealIcon.setAttribute('aria-hidden', 'true');
      const revealLens = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      revealLens.setAttribute('cx', '6.5');
      revealLens.setAttribute('cy', '6.5');
      revealLens.setAttribute('r', '4');
      const revealHandle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      revealHandle.setAttribute('d', 'm9.5 9.5 4 4');
      revealIcon.append(revealLens, revealHandle);
      revealButton.append(revealIcon);
      revealButton.addEventListener('click', resourceLocationsModel.createRevealIconClickHandler(
        resource,
        (target) => {
          if (runtime === activePaneRuntime()) revealResourceInDesktop(runtime, target);
        }
      ));
      item.append(revealButton);
    }
    fragment.append(item);

    const location = resourceLocationsModel.tryNormalizeResourceLocation(resource);
    if (location && location.type !== 'vault' && page.id) {
      const operation = captureRuntimeOperation(runtime, {
        pageId: page.id,
        scope: 'maintenance-resource-availability'
      });
      const availabilityUrl = pageApiUrl(
        page.id,
        `/resources/${encodeURIComponent(resource.id)}/content`
      );
      fetch(availabilityUrl, { method: 'HEAD', cache: 'no-store' })
        .then((response) => {
          if (response.ok || !button.isConnected || !runtimeOperationIsCurrent(operation)
            || runtime !== activePaneRuntime()) return;
          button.classList.add('is-missing');
          const meta = document.createElement('span');
          meta.className = 'resource-item-meta resource-missing-meta';
          meta.textContent = ' (missing)';
          button.append(meta);
        })
        .catch(() => {
          // Availability is advisory; Open/Reveal report the actionable desktop error.
        });
    }
  }
  resourcesList.append(fragment);
}

function closeResourceContextMenu() {
  resourceContextTarget = null;
}

async function openResourceContextMenu(runtime, event, resource) {
  if (runtime !== activePaneRuntime() || !window.nativeContextMenu?.available()) return;

  closePageContextMenu();
  closeFolderContextMenu();
  closeRelationContextMenu();
  closeAddLinkPopover(runtime);
  const desktopActionsAvailable = isDesktopResourceActionAvailable(resource);
  const pageId = runtime.currentPage?.id;
  const operation = captureRuntimeOperation(runtime, {
    pageId,
    scope: 'maintenance-resource-menu'
  });
  const command = await window.nativeContextMenu.open(event, {
    type: 'maintenance-resource',
    targetId: resource.id,
    canOpen: desktopActionsAvailable,
    canToggleVisibility: isDisplayableObject(resource),
    isVisible: isVisibleObject(resource)
  });
  if (!command || !runtimeOperationIsCurrent(operation)
    || runtime !== activePaneRuntime()) return closeResourceContextMenu();
  const freshResource = [
    ...(runtime.currentPage?.objects || []),
    ...(runtime.currentPage?.maintenanceResources || [])
  ].find((candidate) => candidate.id === resource.id);
  if (!freshResource) return closeResourceContextMenu();
  resourceContextTarget = { runtime, token: operation, resource: freshResource };
  if (command === 'open-resource') openResourceInDesktop(runtime, freshResource);
  else if (command === 'reveal-resource') revealResourceInDesktop(runtime, freshResource);
  else if (command === 'toggle-resource-visibility') toggleResourceVisibility(runtime);
  else if (command === 'delete-resource') deleteContextResource(runtime);
}

function setRelationHoverBlocks(runtime, instances, active) {
  if (runtime !== activePaneRuntime()) return;
  for (const instance of instances || []) {
    if (instance.kind !== 'outgoing') continue;
    const overlay = blockOverlay(runtime, instance.sourceBlockId);
    if (overlay) {
      setBlockState(runtime, overlay, 'relation-hover', active ? BLOCK_STATE.ACTIVE : null);
    }
  }
}

function relationGroupCollapsedKey(linkTypeId) {
  return `relation:${linkTypeId}`;
}

function renderRelationGroup(runtime, { group, pageLabelForRow }) {
  const groupItem = document.createElement('li');
  groupItem.className = 'relation-group';
  const collapsedKey = relationGroupCollapsedKey(group.linkTypeId);
  const collapsed = collapsedRelationGroupIds.has(collapsedKey);
  const foldId = `right-relation:${group.linkTypeId}`;
  groupItem.dataset.sidebarMotionId = foldId;

  const heading = document.createElement('button');
  heading.type = 'button';
  heading.className = 'relation-group-heading';
  heading.setAttribute('aria-expanded', String(!collapsed));
  const disclosure = document.createElement('span');
  disclosure.className = 'disclosure-chevron';
  disclosure.setAttribute('aria-hidden', 'true');
  const headingLabel = document.createElement('span');
  headingLabel.textContent = group.label;
  heading.append(disclosure, headingLabel);
  heading.addEventListener('click', () => {
    if (collapsedRelationGroupIds.has(collapsedKey)) collapsedRelationGroupIds.delete(collapsedKey);
    else collapsedRelationGroupIds.add(collapsedKey);
    void animateRightSidebarNestedFold(foldId, collapsed, () => {
      if (runtime === activePaneRuntime()) {
        renderRelations(
          runtime,
          runtime.currentPage || { blocks: [], backlinks: [] },
          { rightSidebarFoldRender: true }
        );
      }
    });
  });
  groupItem.append(heading);

  if (!collapsed) {
    const rows = document.createElement('ul');
    rows.className = 'relation-group-rows';
    rows.dataset.rightFoldRegion = foldId;
    for (const row of group.rows) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'relation-button file-typography';
      button.textContent = pageLabelForRow(row);
      if (row.instances.length > 1) {
        button.title = `${row.instances.length} underlying links`;
      }
      button.addEventListener('click', () => {
        if (runtime === activePaneRuntime()) navigateCurrentTabToPage(runtime, row.pageId);
      });
      button.addEventListener('contextmenu', (event) => openRelationContextMenu(runtime, event, {
        instances: row.instances
      }));
      button.addEventListener('mouseenter', () => setRelationHoverBlocks(runtime, row.instances, true));
      button.addEventListener('mouseleave', () => setRelationHoverBlocks(runtime, row.instances, false));
      button.dataset.counterpartPageId = row.pageId;
      item.append(button);
      rows.append(item);
    }
    groupItem.append(rows);
  }

  return groupItem;
}

function relationInstancesForPage(page) {
  const pagesById = new Map((pageIndex?.pages || []).map((entry) => [entry.id, entry]));
  const relationInstances = [];
  for (const block of page.blocks || []) {
    for (const link of pageLinks(block)) {
      relationInstances.push({
        kind: 'outgoing',
        displayedLinkTypeId: link.linkTypeId || link.type || '',
        counterpartPageId: link.targetPageId,
        counterpartTitle: pagesById.get(link.targetPageId)?.title || link.label || link.targetPageId,
        sourcePageId: page.id,
        sourceBlockId: block.id,
        sourceLinkId: link.id,
        targetPageId: link.targetPageId,
        raw: link
      });
    }
  }
  for (const backlink of pageBacklinks(page)) {
    relationInstances.push({
      kind: 'backlink',
      displayedLinkTypeId: backlink.linkTypeId || backlink.linkType || '',
      counterpartPageId: backlink.sourcePageId,
      counterpartTitle: pagesById.get(backlink.sourcePageId)?.title || backlink.label || backlink.sourcePageId,
      sourcePageId: backlink.sourcePageId,
      sourceBlockId: backlink.sourceBlockId,
      sourceLinkId: backlink.sourceLinkId,
      targetPageId: page.id,
      raw: backlink
    });
  }
  return relationInstances;
}

function renderRelations(runtime, page, { rightSidebarFoldRender = false } = {}) {
  if (runtime !== activePaneRuntime()) return;
  if (!rightSidebarFoldRender) interruptRightSidebarNestedFoldMotion('relations-rerender');
  relationsList.replaceChildren();
  const pagesById = new Map((pageIndex?.pages || []).map((entry) => [entry.id, entry]));
  const relationInstances = relationInstancesForPage(page);
  rightRelationFilterContext = relationFiltersModel.buildRelationFilterContext({
    relationInstances,
    pageIndex: pageIndex || { pages: [] },
    categoryConfig: categoryConfig || {},
    descriptorGroups: descriptorGroupsConfig || {},
    descriptorEntries: descriptorLibrary?.entries || []
  });
  renderRightCategoryFilter(runtime, { rightSidebarFoldRender: true });
  renderRightDescriptorFilter(runtime, { rightSidebarFoldRender: true });

  const filteredInstances = relationFiltersModel.filterRelationInstances(
    relationInstances,
    rightRelationFilterContext,
    {
      categoryIds: selectedRightCategoryIds,
      descriptorGroupIds: selectedRightDescriptorGroupIds
    }
  );

  const relationGroups = groupedRelationEntries(filteredInstances);

  if (!relationGroups.length) {
    const item = document.createElement('li');
    item.className = 'muted';
    item.textContent = 'No relations.';
    relationsList.append(item);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const group of relationGroups) {
    group.rows.sort((a, b) => {
      const labelA = pagesById.get(a.pageId)?.title || a.instances[0]?.counterpartTitle || a.pageId;
      const labelB = pagesById.get(b.pageId)?.title || b.instances[0]?.counterpartTitle || b.pageId;
      return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
    });
    fragment.append(renderRelationGroup(runtime, {
      group,
      pageLabelForRow: (row) => pagesById.get(row.pageId)?.title || row.instances[0]?.counterpartTitle || row.pageId
    }));
  }
  relationsList.append(fragment);
}
