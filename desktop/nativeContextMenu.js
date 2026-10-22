const CONTEXT_MENU_TYPES = new Set([
  'navigation-background',
  'navigation-page',
  'navigation-folder',
  'block',
  'block-edit',
  'page-object',
  'maintenance-resource',
  'external-link',
  'relation',
  'descriptor-entry',
  'descriptor-exclude',
  'descriptor-group',
  'dictionary-entry',
  'tab-list',
  'vault-switcher',
  'markdown-table-cell',
  'block-colour-preset'
]);

function validContextMenuRequest(value) {
  if (!value || typeof value !== 'object' || !CONTEXT_MENU_TYPES.has(value.type)) return null;
  const targetId = typeof value.targetId === 'string' ? value.targetId.trim().slice(0, 256) : '';
  if (!targetId) return null;
  if (value.type === 'tab-list' || value.type === 'vault-switcher') {
    if (value.type === 'vault-switcher') {
      const vaults = Array.isArray(value.vaults)
        ? value.vaults.slice(0, 256).map((vault) => {
          const vaultId = typeof vault?.vaultId === 'string'
            ? vault.vaultId.trim().slice(0, 256)
            : '';
          const displayName = typeof vault?.displayName === 'string'
            ? vault.displayName.trim().slice(0, 512)
            : '';
          return vaultId && displayName
            ? { vaultId, displayName, open: vault.open === true }
            : null;
        }).filter(Boolean)
        : [];
      return { type: value.type, targetId, currentVaultId: targetId, vaults };
    }
    const tabs = Array.isArray(value.tabs)
      ? value.tabs.slice(0, 256).map((tab) => {
        const id = typeof tab?.id === 'string' ? tab.id.trim().slice(0, 256) : '';
        if (!id) return null;
        const title = typeof tab.title === 'string' && tab.title.length
          ? tab.title.slice(0, 512)
          : 'New Tab';
        return { id, title };
      }).filter(Boolean)
      : [];
    const activeTabId = typeof value.activeTabId === 'string'
      ? value.activeTabId.trim().slice(0, 256)
      : '';
    return { type: value.type, targetId, activeTabId, tabs };
  }
  if (value.type === 'markdown-table-cell') {
    const isHeader = value.isHeader === true;
    const isFirstColumn = value.isFirstColumn === true;
    const isTopLeft = isHeader && isFirstColumn && value.isTopLeft === true;
    return {
      type: value.type,
      targetId,
      isHeader,
      isFirstColumn,
      isTopLeft,
      canMoveRowUp: !isHeader && value.canMoveRowUp === true,
      canMoveRowDown: !isHeader && value.canMoveRowDown === true,
      canMoveColumnLeft: value.canMoveColumnLeft === true,
      canMoveColumnRight: value.canMoveColumnRight === true
    };
  }
  return {
    type: value.type,
    targetId,
    selectedCount: Number.isInteger(value.selectedCount)
      ? Math.max(1, Math.min(value.selectedCount, 10000))
      : 1,
    selectedPageCount: Number.isInteger(value.selectedPageCount)
      ? Math.max(0, Math.min(value.selectedPageCount, 10000))
      : 1,
    canSetDefault: value.canSetDefault === true,
    isDefault: value.isDefault === true,
    isPinned: value.isPinned === true,
    synthetic: value.synthetic === true,
    bindingRole: ['unbound', 'leader', 'follower'].includes(value.bindingRole)
      ? value.bindingRole
      : 'unbound',
    canBindToLeader: value.canBindToLeader === true,
    canStopBinding: value.canStopBinding === true,
    canSetBindingLeader: value.canSetBindingLeader === true,
    canMoveNavigation: value.canMoveNavigation !== false,
    canStickNavigation: value.canStickNavigation !== false,
    canOpen: value.canOpen === true,
    canToggleVisibility: value.canToggleVisibility === true,
    isVisible: value.isVisible !== false,
    relationCount: Number.isInteger(value.relationCount)
      ? Math.max(1, Math.min(value.relationCount, 10000))
      : 1,
    dictionaryAvailable: value.dictionaryAvailable !== false,
    isAlias: value.isAlias === true,
    canMove: value.canMove === true,
    deleteEnabled: value.deleteEnabled !== false,
    canBringForward: value.canBringForward === true,
    canBringToFront: value.canBringToFront === true,
    canSendBackward: value.canSendBackward === true,
    canSendToBack: value.canSendToBack === true
  };
}

function commandItem(label, commandId, onCommand, options = {}) {
  return { label, click: () => onCommand(commandId), ...options };
}

function selectedTextPresent(value) {
  return typeof value === 'string' && value.length > 0;
}

function normalizedTextContextDescriptor(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    textOwned: typeof value.textOwned === 'boolean' ? value.textOwned : null,
    suppress: value.suppress === true,
    owner: ['ordinary', 'markdown', 'cne', 'read-only'].includes(value.owner)
      ? value.owner
      : null,
    editable: typeof value.editable === 'boolean' ? value.editable : null,
    canCut: typeof value.canCut === 'boolean' ? value.canCut : null,
    canCopy: typeof value.canCopy === 'boolean' ? value.canCopy : null,
    canPaste: typeof value.canPaste === 'boolean' ? value.canPaste : null,
    lookUpSelectionToken: Number.isSafeInteger(value.lookUpSelectionToken)
      && value.lookUpSelectionToken > 0
      ? value.lookUpSelectionToken
      : null
  };
}

function deriveTextContextMenuCapabilities(params, semanticDescriptor = null) {
  if (!params || typeof params !== 'object') return null;
  const descriptor = normalizedTextContextDescriptor(semanticDescriptor);
  if (descriptor?.suppress || descriptor?.textOwned === false) return null;
  const hasSelection = selectedTextPresent(params.selectionText);
  const rendererEditable = params.isEditable === true;
  const textOwned = descriptor?.textOwned === true || rendererEditable || hasSelection;
  if (!textOwned || (!rendererEditable && !hasSelection)) return null;

  const editable = rendererEditable && descriptor?.editable !== false;
  const editFlags = params.editFlags && typeof params.editFlags === 'object'
    ? params.editFlags
    : {};
  const permitted = (flagName, semanticName) => (
    editFlags[flagName] === true && descriptor?.[semanticName] !== false
  );
  return Object.freeze({
    owner: descriptor?.owner || (editable ? 'ordinary' : 'read-only'),
    editable,
    hasSelection,
    canCut: editable && hasSelection && permitted('canCut', 'canCut'),
    canCopy: hasSelection && permitted('canCopy', 'canCopy'),
    canPaste: editable && permitted('canPaste', 'canPaste')
  });
}

function buildNativeTextContextMenuTemplate(params, {
  platform = process.platform,
  hasValidFrame = false,
  semanticDescriptor = null,
  onLookUp = null
} = {}) {
  const capabilities = deriveTextContextMenuCapabilities(params, semanticDescriptor);
  if (!capabilities) return null;
  const template = [];
  if (capabilities.editable && capabilities.hasSelection) {
    template.push(
      { role: 'cut', enabled: capabilities.canCut },
      { role: 'copy', enabled: capabilities.canCopy },
      { role: 'paste', enabled: capabilities.canPaste }
    );
  } else if (capabilities.editable) {
    template.push({ role: 'paste', enabled: capabilities.canPaste });
  } else if (capabilities.hasSelection) {
    template.push({ role: 'copy', enabled: capabilities.canCopy });
  }
  if (platform === 'darwin' && capabilities.hasSelection && hasValidFrame) {
    if (template.length) template.push({ type: 'separator' });
    template.push(
      {
        label: 'Look Up',
        enabled: typeof onLookUp === 'function',
        click: () => onLookUp?.()
      },
      { role: 'services' }
    );
  }
  return template.length ? template : null;
}

function validContextMenuFrame(frame) {
  if (!frame || typeof frame !== 'object' || typeof frame.isDestroyed !== 'function') return null;
  try {
    if (frame.isDestroyed() || frame.detached === true) return null;
  } catch {
    return null;
  }
  return frame;
}

function createNativeLookUpCommand({
  webContents,
  frame,
  restoreSelection = null,
  releaseSelection = null,
  schedule = setImmediate,
  scheduleRestore = (callback) => setTimeout(callback, 1000)
} = {}) {
  const originatingFrame = validContextMenuFrame(frame);
  if (!originatingFrame
    || !webContents
    || typeof webContents.showDefinitionForSelection !== 'function'
    || typeof schedule !== 'function'
    || typeof scheduleRestore !== 'function') return null;
  let requested = false;
  let closed = false;
  let cancelled = false;
  let definitionCommitted = false;
  let selectionFinalized = false;
  let releaseAttempted = false;
  const invokeRelease = () => {
    if (releaseAttempted) return false;
    releaseAttempted = true;
    try {
      const result = releaseSelection?.();
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => false);
      }
    } catch {
      // The renderer selection contract is best-effort during teardown.
    }
    return true;
  };
  const release = () => {
    if (selectionFinalized) return false;
    selectionFinalized = true;
    invokeRelease();
    return true;
  };
  const restore = () => {
    if (selectionFinalized) return false;
    selectionFinalized = true;
    try {
      const result = restoreSelection?.() ?? false;
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then((restored) => {
          if (restored !== true) invokeRelease();
        }, invokeRelease);
      } else if (result !== true) {
        invokeRelease();
      }
      return result;
    } catch {
      invokeRelease();
      return false;
    }
  };
  return Object.freeze({
    request() {
      if (closed || cancelled || requested) return false;
      requested = true;
      return true;
    },
    afterPopupClosed() {
      if (closed || cancelled) return false;
      closed = true;
      if (!requested) {
        release();
        return false;
      }
      requested = false;
      try {
        schedule(() => {
          if (cancelled || webContents.isDestroyed?.()
            || validContextMenuFrame(originatingFrame) !== originatingFrame) {
            release();
            return;
          }
          try {
            webContents.showDefinitionForSelection();
            definitionCommitted = true;
          } catch {
            release();
            return;
          }
          if (typeof restoreSelection === 'function') {
            try {
              scheduleRestore(() => {
                if (webContents.isDestroyed?.()
                  || validContextMenuFrame(originatingFrame) !== originatingFrame) {
                  release();
                  return;
                }
                restore();
              });
            } catch {
              release();
            }
          } else {
            release();
          }
        });
      } catch {
        release();
      }
      return true;
    },
    cancel() {
      if (cancelled || definitionCommitted || selectionFinalized) return false;
      cancelled = true;
      closed = true;
      requested = false;
      release();
      return true;
    }
  });
}

function buildNativeContextMenuTemplate(rawContext, onCommand) {
  const context = validContextMenuRequest(rawContext);
  if (!context || typeof onCommand !== 'function') return null;

  switch (context.type) {
    case 'vault-switcher':
      return [
        ...context.vaults.map((vault) => commandItem(
          vault.displayName,
          `switch-vault:${vault.vaultId}`,
          onCommand,
          {
            type: 'radio',
            checked: vault.vaultId === context.currentVaultId,
            ...(vault.open && vault.vaultId !== context.currentVaultId ? { sublabel: 'Open' } : {})
          }
        )),
        { type: 'separator' },
        commandItem('+ Add New Vault', 'add-new-vault', onCommand),
        commandItem('Vault Settings…', 'open-vault-settings', onCommand)
      ];
    case 'tab-list':
      return [
        commandItem('Close All Tabs', 'close-all-tabs', onCommand),
        { type: 'separator' },
        ...context.tabs.map((tab) => commandItem(
          tab.title,
          `activate-tab:${tab.id}`,
          onCommand,
          { type: 'radio', checked: tab.id === context.activeTabId }
        ))
      ];
    case 'markdown-table-cell': {
      const alignmentItem = {
        label: 'Align',
        submenu: [
          commandItem('Left', 'align-table-column-left', onCommand),
          commandItem('Centre', 'align-table-column-centre', onCommand),
          commandItem('Right', 'align-table-column-right', onCommand)
        ]
      };
      const sortItems = (axis) => [
        commandItem(
          'Alphabetical A → Z',
          `sort-table-${axis}-alpha-asc`,
          onCommand
        ),
        commandItem(
          'Alphabetical Z → A',
          `sort-table-${axis}-alpha-desc`,
          onCommand
        ),
        commandItem(
          'Numeric ascending',
          `sort-table-${axis}-numeric-asc`,
          onCommand
        ),
        commandItem(
          'Numeric descending',
          `sort-table-${axis}-numeric-desc`,
          onCommand
        )
      ];
      const sortSubmenu = (label, axis) => ({
        label,
        submenu: sortItems(axis)
      });
      const columnInsertionItems = [
        commandItem('Insert column left', 'insert-table-column-left', onCommand),
        commandItem('Insert column right', 'insert-table-column-right', onCommand)
      ];
      const columnMovementItems = [
        commandItem('Move column left', 'move-table-column-left', onCommand, {
          enabled: context.canMoveColumnLeft
        }),
        commandItem('Move column right', 'move-table-column-right', onCommand, {
          enabled: context.canMoveColumnRight
        })
      ];
      if (context.isHeader) {
        const rowSort = sortSubmenu(
          context.isTopLeft ? 'Sort rows by first column' : 'Sort rows by this column',
          'rows'
        );
        return [
          alignmentItem,
          { type: 'separator' },
          commandItem('Insert row below', 'insert-table-row-below', onCommand),
          ...columnInsertionItems,
          { type: 'separator' },
          ...columnMovementItems,
          { type: 'separator' },
          rowSort,
          ...(context.isTopLeft
            ? [sortSubmenu('Sort columns by Header row', 'columns')]
            : [])
        ];
      }
      return [
        alignmentItem,
        { type: 'separator' },
        commandItem('Insert row above', 'insert-table-row-above', onCommand),
        commandItem('Insert row below', 'insert-table-row-below', onCommand),
        ...columnInsertionItems,
        { type: 'separator' },
        commandItem('Move row up', 'move-table-row-up', onCommand, {
          enabled: context.canMoveRowUp
        }),
        commandItem('Move row down', 'move-table-row-down', onCommand, {
          enabled: context.canMoveRowDown
        }),
        ...columnMovementItems,
        ...(context.isFirstColumn
          ? [
              { type: 'separator' },
              sortSubmenu('Sort columns by this row', 'columns')
            ]
          : [])
      ];
    }
    case 'block':
      return [commandItem('Add Link', 'add-block-link', onCommand)];
    case 'block-colour-preset':
      return [
        commandItem('Delete Colour', 'delete-colour', onCommand),
        commandItem('Preview', 'preview-colour', onCommand)
      ];
    case 'block-edit':
      return [
        commandItem('Bring Forward', 'bring-forward', onCommand, {
          enabled: context.canBringForward
        }),
        commandItem('Bring to Front', 'bring-to-front', onCommand, {
          enabled: context.canBringToFront
        }),
        commandItem('Send Backward', 'send-backward', onCommand, {
          enabled: context.canSendBackward
        }),
        commandItem('Send to Back', 'send-to-back', onCommand, {
          enabled: context.canSendToBack
        }),
        { type: 'separator' },
        commandItem('Delete', 'delete-block', onCommand)
      ];
    case 'page-object':
      return [
        commandItem('Bring Forward', 'bring-forward', onCommand, {
          enabled: context.canBringForward
        }),
        commandItem('Bring to Front', 'bring-to-front', onCommand, {
          enabled: context.canBringToFront
        }),
        commandItem('Send Backward', 'send-backward', onCommand, {
          enabled: context.canSendBackward
        }),
        commandItem('Send to Back', 'send-to-back', onCommand, {
          enabled: context.canSendToBack
        })
      ];
    case 'navigation-background':
      return [
        commandItem('New Page', 'new-page', onCommand),
        commandItem('New Folder', 'new-folder', onCommand)
      ];
    case 'navigation-page':
      return [
        commandItem('Open in New Tab', 'open-page-in-new-tab', onCommand),
        { type: 'separator' },
        commandItem('Rename', 'rename-page', onCommand, {
          visible: !context.synthetic && context.selectedCount === 1
        }),
        commandItem('Edit Category', 'edit-page-categories', onCommand, {
          visible: context.selectedPageCount > 1
        }),
        commandItem('Set as default', 'toggle-default-page', onCommand, {
          type: 'checkbox', checked: context.isDefault, visible: context.canSetDefault
        }),
        commandItem('Stick on top', 'toggle-stick-page', onCommand, {
          type: 'checkbox', checked: context.isPinned,
          visible: !context.synthetic && context.canStickNavigation
        }),
        commandItem('Bind to Leader', 'bind-to-leader', onCommand, {
          visible: context.canBindToLeader
        }),
        commandItem('Stop Binding', 'stop-binding', onCommand, {
          visible: context.canStopBinding
        }),
        commandItem('Set as Leader', 'set-binding-leader', onCommand, {
          visible: context.canSetBindingLeader
        }),
        commandItem('Move…', 'move-navigation', onCommand, {
          visible: context.canMoveNavigation
        }),
        commandItem('Delete', 'delete-page', onCommand, { enabled: context.deleteEnabled })
      ];
    case 'navigation-folder':
      return [
        commandItem('New Folder', 'new-folder-in-folder', onCommand),
        commandItem('New Page', 'new-page-in-folder', onCommand),
        { type: 'separator' },
        commandItem('Rename', 'rename-folder', onCommand, {
          visible: context.selectedCount === 1
        }),
        commandItem('Stick on top', 'toggle-stick-folder', onCommand, {
          type: 'checkbox', checked: context.isPinned, visible: context.canStickNavigation
        }),
        commandItem('Move…', 'move-navigation', onCommand, {
          visible: context.canMoveNavigation
        }),
        commandItem('Delete', 'delete-folder', onCommand, { enabled: context.deleteEnabled })
      ];
    case 'maintenance-resource': {
      const template = [
        commandItem('Open', 'open-resource', onCommand, { visible: context.canOpen }),
        commandItem('Reveal in Finder', 'reveal-resource', onCommand, { visible: context.canOpen })
      ];
      if (context.canOpen) template.push({ type: 'separator' });
      template.push(
        commandItem(context.isVisible ? 'Hide' : 'Show', 'toggle-resource-visibility', onCommand, {
          enabled: context.canToggleVisibility
        }),
        commandItem('Delete', 'delete-resource', onCommand)
      );
      return template;
    }
    case 'external-link':
      return [
        commandItem('Open', 'open-external-link', onCommand),
        commandItem('Edit', 'edit-external-link', onCommand),
        { type: 'separator' },
        commandItem('Delete', 'delete-external-link', onCommand)
      ];
    case 'relation':
      return [commandItem(
        context.relationCount > 1 ? `Delete all ${context.relationCount} links` : 'Delete',
        'delete-relation',
        onCommand,
        { enabled: context.deleteEnabled }
      )];
    case 'descriptor-entry':
      return [
        commandItem('Rename', 'rename-descriptor', onCommand, { enabled: context.dictionaryAvailable }),
        commandItem('Delete', 'delete-descriptor', onCommand, { enabled: context.dictionaryAvailable }),
        commandItem('Link to existing word', 'link-descriptor', onCommand, {
          enabled: context.dictionaryAvailable
        }),
        commandItem('Move', 'move-descriptor-entry', onCommand)
      ];
    case 'descriptor-exclude':
      return [commandItem('Exclude from this class', 'exclude-descriptor', onCommand)];
    case 'descriptor-group':
      return [
        commandItem('Rename', 'rename-descriptor-group', onCommand),
        commandItem('Move', 'move-descriptor-group', onCommand),
        commandItem('Delete', 'delete-descriptor-group', onCommand)
      ];
    case 'dictionary-entry':
      return [
        commandItem('Rename', 'rename-dictionary-entry', onCommand),
        commandItem('Set as display word', 'set-display-word', onCommand, { visible: context.isAlias }),
        commandItem('Set as another word', 'set-another-word', onCommand, { visible: context.isAlias }),
        commandItem('Move to...', 'move-dictionary-entry', onCommand, { visible: context.canMove }),
        commandItem(context.isAlias ? 'Delete alias' : 'Delete word', 'delete-dictionary-entry', onCommand)
      ];
    default:
      return null;
  }
}

module.exports = {
  buildNativeContextMenuTemplate,
  buildNativeTextContextMenuTemplate,
  createNativeLookUpCommand,
  deriveTextContextMenuCapabilities,
  validContextMenuFrame,
  validContextMenuRequest
};
