/* Explicit event registration and application bootstrap.
 * Loaded last so every domain function is available before listeners are registered.
 */
initializeWorkspacePaneModel();
initializeWorkspacePaneStackLayout();

markdownModeButton?.addEventListener('click', cycleVaultMarkdownMode);
hnTextModeButton?.addEventListener('click', cycleVaultHnTextMode);
markdownZoomOutButton?.addEventListener('click', () => {
  const runtime = activePaneRuntime();
  if (runtime) zoomActiveMarkdownBy(runtime, 0.9);
});
markdownZoomValueButton?.addEventListener('click', () => {
  const runtime = activePaneRuntime();
  if (runtime) resetActiveMarkdownZoom(runtime);
});
markdownZoomInButton?.addEventListener('click', () => {
  const runtime = activePaneRuntime();
  if (runtime) zoomActiveMarkdownBy(runtime, 1.1);
});
hnTextZoomOutButton?.addEventListener('click', () => {
  const runtime = activePaneRuntime();
  if (runtime) zoomActiveHnTextBy(runtime, 0.9);
});
hnTextZoomValueButton?.addEventListener('click', () => {
  const runtime = activePaneRuntime();
  if (runtime) resetActiveHnTextZoom(runtime);
});
hnTextZoomInButton?.addEventListener('click', () => {
  const runtime = activePaneRuntime();
  if (runtime) zoomActiveHnTextBy(runtime, 1.1);
});

function bindPaneToolbarInteractions(pane) {
  const dom = runtimeForPane(pane)?.dom;
  const region = dom?.toolbarRegion;
  if (!region || region.dataset.paneInteractionsBound === 'true') return;
  region.dataset.paneInteractionsBound = 'true';
  const resolveRuntime = () => {
    const paneId = region.dataset.workspacePaneId;
    const runtime = paneId ? runtimeForPane(paneId) : null;
    return runtimeIsLive(runtime) ? runtime : null;
  };
  const activatePane = () => {
    const runtime = resolveRuntime();
    if (runtime && activePaneRuntime() !== runtime) setActiveWorkspacePane(runtime.paneId);
    return runtime;
  };
  region.addEventListener('pointerdown', activatePane, true);
  dom.pageHistoryBackButton?.addEventListener('click', () => {
    const runtime = activatePane();
    if (!runtime) return;
    navigatePageHistory(runtime, -1);
  });
  dom.pageHistoryForwardButton?.addEventListener('click', () => {
    const runtime = activatePane();
    if (!runtime) return;
    navigatePageHistory(runtime, 1);
  });
  dom.pageTitleDisplay?.addEventListener('click', (event) => {
    const runtime = activatePane();
    if (!runtime) return;
    openTitleEditor(runtime, event);
  });
  dom.editBlockButton?.addEventListener('click', () => {
    const runtime = activatePane();
    if (!runtime) return;
    if (runtime.blockEditMode) saveBlockEdits(runtime);
    else if (runtime.pageEditMode) savePageEdits(runtime);
    else setEditMenuOpen(runtime, runtime.dom.editMenu.hidden);
  });
  dom.editBlockMenuItem?.addEventListener('click', () => {
    const runtime = activatePane();
    if (!runtime) return;
    setEditMenuOpen(runtime, false);
    enterBlockEditMode(runtime);
  });
  dom.editPageMenuItem?.addEventListener('click', () => {
    const runtime = activatePane();
    if (!runtime) return;
    setEditMenuOpen(runtime, false);
    enterPageEditMode(runtime);
  });
  dom.pageTypeMenuTrigger?.addEventListener('click', (event) => {
    const runtime = activatePane();
    if (!runtime) return;
    event.stopPropagation();
    setPageTypeSubmenuOpen(runtime, runtime.dom.pageTypeSubmenu?.hidden);
  });
  dom.pageTypeSubmenu?.addEventListener('click', (event) => {
    const item = event.target.closest?.('[data-page-type]');
    if (!item || item.disabled) return;
    const runtime = activatePane();
    if (!runtime) return;
    convertCurrentPageType(runtime, item.dataset.pageType);
  });
  dom.pageCategoryMenuItem?.addEventListener('click', () => {
    const runtime = activatePane();
    if (!runtime) return;
    openPageMetaModal(runtime, 'category');
  });
  dom.pageDescriptorMenuItem?.addEventListener('click', () => {
    const runtime = activatePane();
    if (!runtime) return;
    openPageMetaModal(runtime, 'descriptor');
  });
  dom.highlightButton?.addEventListener('click', () => {
    const runtime = activatePane();
    if (!runtime) return;
    if (runtime.highlightEditDraft) saveHighlightEdits(runtime);
    else setHighlightMenuOpen(runtime, runtime.dom.highlightMenu?.hidden);
  });
  dom.pageTitle?.addEventListener('blur', () => {
    const runtime = resolveRuntime();
    if (!runtime) return;
    if (runtime.cancelTitleBlur || runtime.titleSaveInProgress) return;
    saveTitle(runtime);
  });
  dom.pageTitle?.addEventListener('input', () => {
    const runtime = resolveRuntime();
    if (runtime) updateTitleDuplicateWarning(runtime);
  });
  dom.pageTitle?.addEventListener('change', () => {
    const runtime = resolveRuntime();
    if (runtime) updateTitleDuplicateWarning(runtime);
  });
  dom.titleForm?.addEventListener('submit', (event) => event.preventDefault());
  dom.pageTitle?.addEventListener('keydown', (event) => {
    const runtime = resolveRuntime();
    if (!runtime) return;
    if (event.key === 'Enter'
      && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
      event,
      runtime.dom.pageTitle
    )) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      runtime.dom.pageTitle.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelTitleEdit(runtime);
    }
  });
}

function bindWorkspacePaneInteractions(pane) {
  bindPaneToolbarInteractions(pane);
  const initialRuntime = runtimeForPane(pane);
  const area = initialRuntime?.dom?.canvasArea;
  if (!area || area.dataset.paneInteractionsBound === 'true') return;
  area.dataset.paneInteractionsBound = 'true';
  const resolveRuntime = () => {
    const paneId = area.closest?.('.workspace-pane')?.dataset?.workspacePaneId;
    const runtime = paneId ? runtimeForPane(paneId) : null;
    return runtimeIsLive(runtime) ? runtime : null;
  };
  const eventRuntimeCache = new WeakMap();
  const resolveEventRuntime = (event) => {
    if (!event || (typeof event !== 'object' && typeof event !== 'function')) {
      return resolveRuntime();
    }
    if (!eventRuntimeCache.has(event)) eventRuntimeCache.set(event, resolveRuntime());
    return eventRuntimeCache.get(event);
  };
  const activateResolvedRuntime = (runtime) => {
    if (runtime && activePaneRuntime() !== runtime) setActiveWorkspacePane(runtime.paneId);
    return runtime;
  };
  const activatePane = (event) => activateResolvedRuntime(resolveEventRuntime(event));
  area.addEventListener('pointerdown', (event) => {
    const runtime = resolveEventRuntime(event);
    if (!runtime) return;
    if (event.target.closest?.('.info-panel') && typeof activateInfoPanelRuntime === 'function') {
      activateInfoPanelRuntime(runtime);
      return;
    }
    activateResolvedRuntime(runtime);
  }, true);
  area.addEventListener('dragenter', (event) => activatePane(event), true);
  bindImportDropTarget(resolveRuntime, area, 'canvas');
  area.addEventListener('pointerdown', (event) => {
    const runtime = resolveEventRuntime(event);
    if (!runtime) return;
    handleBlockPointerDown(runtime, event);
    handlePageObjectPointerDown(runtime, event);
    handleCanvasTargetPointerDown(runtime, event);
  });
  area.addEventListener('pointermove', (event) => {
    const runtime = resolveEventRuntime(event);
    if (!runtime) return;
    if (activePaneRuntime() !== runtime) return;
    handleBlockPointerMove(runtime, event);
    handlePageObjectPointerMove(runtime, event);
    handleCanvasTargetPointerMove(runtime, event);
  });
  area.addEventListener('pointerup', (event) => {
    const runtime = resolveEventRuntime(event);
    if (!runtime) return;
    finishBlockDrawing(runtime, event, true);
    finishBlockTransform(runtime, event);
    finishPageObjectDrag(runtime, event);
    handleCanvasTargetPointerUp(runtime, event);
  });
  area.addEventListener('pointercancel', (event) => {
    const runtime = resolveEventRuntime(event);
    if (!runtime) return;
    finishBlockDrawing(runtime, event, false);
    finishBlockTransform(runtime, event, false);
    finishPageObjectDrag(runtime, event, false);
    clearCanvasPointerHover(runtime);
  });
  area.addEventListener('pointerleave', (event) => {
    const runtime = resolveEventRuntime(event);
    if (!runtime) return;
    if (activePaneRuntime() !== runtime) return;
    if (typeof temporaryInfoHoverOwnsPoint === 'function'
      && temporaryInfoHoverOwnsPoint(
        runtime,
        runtime.hoveredCanvasBlockId,
        event.relatedTarget,
        event.clientX,
        event.clientY
      )) return;
    clearCanvasPointerHover(runtime);
  });
  area.addEventListener('click', (event) => {
    const runtime = resolveEventRuntime(event);
    if (!runtime) return;
    if (activePaneRuntime() === runtime) handleCanvasTargetClick(runtime, event);
  });
  area.addEventListener('contextmenu', (event) => {
    if (globalThis.nativeContextMenu?.ownsTextContextEvent?.(event)) return;
    const runtime = activatePane(event);
    if (!runtime) return;
    handleCanvasTargetContextMenu(runtime, event);
  });
  area.addEventListener('wheel', (event) => {
    const runtime = activatePane(event);
    if (!runtime) return;
    handleCanvasWheel(runtime, event);
  }, { passive: false });
  area.addEventListener('gesturestart', (event) => {
    const runtime = activatePane(event);
    if (!runtime) return;
    if (!pageWorldIsRenderable(runtime)) return;
    event.preventDefault();
    runtime.gestureStartScale = runtime.canvasView.scale;
  }, { passive: false });
  area.addEventListener('gesturechange', (event) => {
    const runtime = activatePane(event);
    if (!runtime) return;
    if (!pageWorldIsRenderable(runtime)) return;
    event.preventDefault();
    const viewport = runtime.dom.canvasArea.getBoundingClientRect();
    const clientX = Number.isFinite(event.clientX)
      ? event.clientX
      : viewport.left + viewport.width / 2;
    const clientY = Number.isFinite(event.clientY)
      ? event.clientY
      : viewport.top + viewport.height / 2;
    zoomAtPoint(
      runtime,
      clientX,
      clientY,
      runtime.gestureStartScale * zoomControls.gestureZoomFactor(event.scale, zoomSensitivity)
    );
  }, { passive: false });

  const { emptyTabGoToPageButton: go, emptyTabCreatePageButton: create,
    emptyTabCloseButton: close } = initialRuntime.dom;
  go?.addEventListener('click', (event) => {
    const runtime = activatePane(event);
    if (!runtime) return;
    focusEmptyTabPageSearch(runtime);
  });
  create?.addEventListener('click', (event) => {
    const runtime = activatePane(event);
    if (!runtime) return;
    createNewPage({ runtime });
  });
  close?.addEventListener('click', (event) => {
    const runtime = activatePane(event);
    if (!runtime) return;
    const tab = activeTab(runtime);
    if (tab?.currentPageId === null) closeTab(tab.id, runtime.paneId);
  });
}

for (const pane of workspace.state.panes) bindWorkspacePaneInteractions(pane);

function preservePageEditorSelectionForSidebarToggle(event) {
  if (event.button === 0) event.preventDefault();
}

function addLinkPopoverRuntime() {
  return livingPaneRuntimes().find((runtime) => (
    runtime.addLinkTarget
      || runtime.linkPickMode
      || runtime.externalLinkEditorContext?.kind === 'block'
  )) || activePaneRuntime();
}

// Sidebar toggles change shell geometry, not the active editing target. Keep a
// pointer click from focusing the chrome button and replacing the Markdown/HN
// browser selection; keyboard activation retains normal button focus behavior.
leftSidebarToggle?.addEventListener('mousedown', preservePageEditorSelectionForSidebarToggle);
rightSidebarToggle?.addEventListener('mousedown', preservePageEditorSelectionForSidebarToggle);
leftSidebarToggle?.addEventListener('pointerdown', preservePageEditorSelectionForSidebarToggle);
rightSidebarToggle?.addEventListener('pointerdown', preservePageEditorSelectionForSidebarToggle);
leftSidebarToggle?.addEventListener('click', toggleLeftSidebar);
rightSidebarToggle?.addEventListener('click', toggleRightSidebar);
vocabularyLibraryButton?.addEventListener('click', () => {
  openDictionaryAction({ action: 'locate' }, activePaneRuntime());
});
searchButton?.addEventListener('click', () => {
  if (!leftSidebarOpen) {
    setLeftSidebarOpen(true);
    descriptorSearchOpen = true;
    renderDescriptorSearchPanel({ focus: true });
    scheduleWorkspaceStateSave();
    return;
  }
  descriptorSearchOpen = !descriptorSearchOpen;
  renderDescriptorSearchPanel({ focus: descriptorSearchOpen });
  scheduleWorkspaceStateSave();
});
newPageButton.addEventListener('click', async () => {
  const runtime = activePaneRuntime();
  if (!runtime) return;
  if (runtime.linkPickMode) {
    if (!window.confirm('Add link to new page?')) return;
    setAddLinkSelection(runtime, 'new-page');
    await confirmAddLinkNewPage(runtime);
    setLeftSidebarOpen(true);
    return;
  }
  createNewPage({ runtime });
});
newFolderButton?.addEventListener('click', createNewFolder);
navigationSortButton?.addEventListener('click', toggleNavigationSortMenu);
navigationSortMenu?.addEventListener('keydown', handleNavigationSortMenuKeyDown);
window.addEventListener('resize', () => {
  if (navigationSortMenu && !navigationSortMenu.hidden) positionNavigationSortMenu();
});
filterButton?.addEventListener('click', () => {
  if (!leftSidebarOpen) {
    setLeftSidebarOpen(true);
    filterPanelOpen = true;
    renderFilterPanel();
    scheduleWorkspaceStateSave();
    return;
  }
  filterPanelOpen = !filterPanelOpen;
  renderFilterPanel();
  scheduleWorkspaceStateSave();
});
addFileButton?.addEventListener('click', () => {
  const runtime = activePaneRuntime();
  if (runtime) addFilesToCurrentPage(runtime);
});
bindImportDropTarget(activePaneRuntime, maintenanceSection, 'maintenance');

document.addEventListener('pointerdown', (event) => {
  if (pageMetaModal) return;
  const runtime = activePaneRuntime();
  if (!runtime) return;
  const dom = runtime.dom;

  if (!dom.titleForm.hidden && !dom.titleForm.contains(event.target)) {
    dom.pageTitle.blur();
  }

  if (!dom.editMenu.hidden && !dom.editMenuContainer.contains(event.target)) {
    setEditMenuOpen(runtime, false);
  }

  for (const candidate of livingPaneRuntimes()) {
    const candidateDom = candidate.dom;
    if (candidateDom?.highlightMenu && !candidateDom.highlightMenu.hidden
      && !candidateDom.highlightMenuContainer?.contains(event.target)) {
      setHighlightMenuOpen(candidate, false);
    }
  }

  if (navigationMoveMode && !pageList.contains(event.target)) {
    closeNavigationMoveMenu();
  }

  if (navigationSortMenu && !navigationSortMenu.hidden
    && !navigationSortMenu.contains(event.target)
    && !navigationSortButton?.contains(event.target)) {
    closeNavigationSortMenu();
  }

  const linkRuntime = addLinkPopoverRuntime();
  if (!addLinkPopover.hidden && !addLinkPopover.contains(event.target)
    && !linkRuntime?.linkPickMode) {
    closeAddLinkPopover(linkRuntime);
  }
});

document.addEventListener('keydown', (event) => {
  if (globalThis.textEditingModel?.handleNativeInputHistoryShortcut?.(
    event,
    document.activeElement,
    (direction) => document.execCommand(direction)
  )) return;
  if (globalThis.textEditingModel?.shouldPreserveNativeEditing?.(event, document.activeElement)) return;
  if (event.key === 'Enter'
    && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(
      event,
      document.activeElement
    )) return;
  if (handleApplicationUndoRedo(event)) return;
  if (pageMetaModal) return;
  if (handlePageHistoryKeyDown(event)) return;
  const runtime = activePaneRuntime();
  if (!runtime) return;
  const dom = runtime.dom;

  if (!addLinkPopover.hidden) {
    const linkRuntime = addLinkPopoverRuntime();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAddLinkPopover(linkRuntime);
      return;
    }

    if (event.key === 'Enter' && addLinkPopover.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      if (!addLinkConfirmButton.disabled) confirmAddLink(linkRuntime);
      return;
    }
  }

  if (!runtime.blockEditMode && !runtime.pageEditMode && !runtime.highlightEditDraft) {
    if (event.key === 'Escape'
      && (!dom.editMenu.hidden || navigationMoveMode
        || (navigationSortMenu && !navigationSortMenu.hidden)
        || !addLinkPopover.hidden
        || (dom.highlightMenu && !dom.highlightMenu.hidden))) {
      event.preventDefault();
      setEditMenuOpen(runtime, false);
      setHighlightMenuOpen(runtime, false);
      closePageContextMenu();
      closeFolderContextMenu();
      closeNavigationMoveMenu();
      closeNavigationSortMenu();
      closeRelationContextMenu();
      closeResourceContextMenu();
      closeAddLinkPopover(runtime);
      dom.editBlockButton.focus();
    }
    return;
  }

  if (runtime.blockEditMode && runtime.selectedBlockId
    && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    deleteDraftBlock(runtime, runtime.selectedBlockId);
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (runtime.highlightEditDraft) saveHighlightEdits(runtime);
    else if (runtime.pageEditMode) savePageEdits(runtime);
    else saveBlockEdits(runtime);
    return;
  }

  if (event.key === 'Enter' && !isTextEditingElement(document.activeElement)) {
    event.preventDefault();
    if (runtime.highlightEditDraft) saveHighlightEdits(runtime);
    else if (runtime.pageEditMode) savePageEdits(runtime);
    else saveBlockEdits(runtime);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    if (navigationMoveMode) closeNavigationMoveMenu();
    if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
    else if (runtime.pageEditMode) cancelPageEdits(runtime);
    else cancelBlockEdits(runtime);
  }
});

window.addEventListener('blur', () => {
  if (navigationMoveMode) closeNavigationMoveMenu();
});

addLinkNewPageButton.addEventListener('click', () => {
  const runtime = addLinkPopoverRuntime();
  if (!runtime) return;
  exitLinkPickMode(runtime);
  setAddLinkSelection(runtime, 'new-page');
});

addLinkExistingPageButton.addEventListener('click', () => {
  const runtime = addLinkPopoverRuntime();
  if (runtime) enterLinkPickMode(runtime);
});
addLinkCancelButton.addEventListener('click', () => {
  const runtime = addLinkPopoverRuntime();
  if (runtime) closeAddLinkPopover(runtime);
});
addLinkConfirmButton.addEventListener('click', () => {
  const runtime = addLinkPopoverRuntime();
  if (runtime) confirmAddLink(runtime);
});

async function start() {
  try {
    initializeCanvasImageResolution();
    await loadControlSettings();
    const [loadedProject, descriptorMetadataSnapshot, loadedNavigation, loadedLinkTypes,
      loadedCategoryConfig, , loadedVaultPreferences] = await Promise.all([
      request('/api/project'),
      request('/api/descriptor-metadata/snapshot'),
      request('/api/navigation'),
      request('/api/link-types'),
      request('/api/categories'),
      vaultAppearanceStore.load({ label: 'startup', publish: false }),
      request('/api/vault-preferences').then((value) => ({
        ...pageTypesModel.normalizeSettings(value),
        ...markdownPageModel.normalizeSettings(value),
        ...hnTextModel.normalizeSettings(value)
      }))
    ]);
    project = loadedProject;
    navigation = loadedNavigation;
    linkTypes = loadedLinkTypes;
    categoryConfig = loadedCategoryConfig;
    vaultPreferences = loadedVaultPreferences;
    await installDescriptorMetadataChangeSet(descriptorMetadataSnapshot, {
      source: 'startup',
      render: false
    });
    applyVaultMarkdownPreferences(vaultPreferences, { rerender: false });
    renderVaultPageTypePreference();
    await loadNavigationSortMode();
    const savedWorkspaceState = await loadWorkspaceState();
    restoreWorkspaceState(savedWorkspaceState);
    if (navigationSortButton) navigationSortButton.disabled = false;
    renderLinkTypeOptions();
    if (sidebarProjectName) {
      const vaultName = sidebarProjectName.querySelector('.vault-switch-name');
      if (vaultName) vaultName.textContent = project.projectName;
      else sidebarProjectName.textContent = project.projectName;
    }
    setLeftSidebarOpen(leftSidebarOpen);
    setRightSidebarOpen(rightSidebarOpen);
    enableSidebarMotionAfterRestore();
    initializeRightSidebar();
    renderDescriptorSearchPanel();
    renderFilterPanel();
    renderPageList();
    resetWorkspacePanes();
    const startupRuntime = activePaneRuntime();
    startupRuntime.session.reset(null);
    renderTabStrip({ ensureActiveVisible: true });

    const orderedPages = pagesInSidebarOrder();
    const preferredPageId = project.lastOpenedPageId;
    const preferredPage = pageIndex.pages.find((page) => page.id === preferredPageId);
    const startupCandidates = preferredPage
      ? [preferredPage, ...orderedPages.filter((page) => page.id !== preferredPage.id)]
      : orderedPages;

    let pageOpened = false;
    for (const page of startupCandidates) {
      if (await loadPage(startupRuntime, page, {
        showErrors: false,
        historyMode: 'replace',
        saveCurrentView: false
      })) {
        pageOpened = true;
        break;
      }
    }

    if (!pageOpened) renderEmptyTab(startupRuntime, 'No valid pages are available.');

    enableWorkspaceStatePersistence();
  } catch (error) {
    const runtime = activePaneRuntime();
    if (runtime) showRuntimeStatus(runtime, error.message, true);
  }
}

start();
