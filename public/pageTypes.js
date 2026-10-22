(function exposePageTypesModel(root, factory) {
  const structuredTextFrameModel = (() => {
    if (root?.structuredTextFrameModel) return root.structuredTextFrameModel;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // eslint-disable-next-line global-require
      return require('./structuredTextFrame');
    }
    throw new Error('The shared structured-text frame model is unavailable.');
  })();
  const hnTextModel = (() => {
    if (root?.hnTextModel) return root.hnTextModel;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // eslint-disable-next-line global-require
      return require('./hnText');
    }
    throw new Error('The shared HN Text model is unavailable.');
  })();
  const api = factory(hnTextModel, structuredTextFrameModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.pageTypesModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (
  hnTextModel,
  structuredTextFrameModel
) => {
  const PAGE_TYPES = Object.freeze({
    CANVAS: 'canvas',
    MARKDOWN: 'markdown',
    HN_TEXT: 'cne-text'
  });
  const LEGACY_DEFAULT_PAGE_TYPE = PAGE_TYPES.CANVAS;
  const DEFAULT_SETTINGS = Object.freeze({
    defaultPageType: LEGACY_DEFAULT_PAGE_TYPE
  });
  const HN_TEXT_SCHEMA_VERSION = hnTextModel.HN_SCHEMA_VERSION;
  const {
    DEFAULT_TEXT_FRAME,
    MIN_FRAME_WIDTH,
    MAX_FRAME_WIDTH,
    normalizeTextFrame,
    validateTextFrame,
    validateTextFramePartial,
    edgesForFrame,
    frameFromEdges,
    resizeBoundary,
    beginBoundaryDrag,
    updateBoundaryDrag,
    projectFrame,
    resolveViewportResize,
    migrateLegacyFrameViewState
  } = structuredTextFrameModel;
  const definitions = new Map();
  const conversions = new Map();

  function normalizedTypeId(value) {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  function recordPageType(record) {
    if (!Object.hasOwn(record, 'type')) return LEGACY_DEFAULT_PAGE_TYPE;
    return normalizedTypeId(record.type);
  }

  function describedType(value) {
    if (typeof value === 'string') return value || '(empty)';
    if (value === null) return 'null';
    if (value === undefined) return 'missing';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function validRegisteredTypeId(value) {
    return typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
  }

  function normalizePageType(value) {
    return normalizedTypeId(value);
  }

  function normalizePartialSaveFields(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
    return Object.freeze(Object.fromEntries(
      Object.entries(value).filter(([, validator]) => typeof validator === 'function')
    ));
  }

  function normalizedDefinition(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !validRegisteredTypeId(value.id)) {
      throw new TypeError('Page Type definitions require a stable lowercase id.');
    }
    return Object.freeze({
      id: value.id,
      label: typeof value.label === 'string' && value.label.trim()
        ? value.label.trim() : value.id,
      order: Number.isFinite(value.order) ? value.order : 100,
      rendererId: typeof value.rendererId === 'string' && value.rendererId
        ? value.rendererId : value.id,
      navigationBadge: typeof value.navigationBadge === 'string' && value.navigationBadge.trim()
        ? value.navigationBadge.trim() : null,
      fileImportPlacementId: typeof value.fileImportPlacementId === 'string'
        && value.fileImportPlacementId
        ? value.fileImportPlacementId : null,
      creatable: value.creatable !== false,
      vaultDefaultEligible: value.vaultDefaultEligible === true,
      pageTypeMenuVisible: value.pageTypeMenuVisible !== false,
      capabilities: Object.freeze(Array.isArray(value.capabilities)
        ? [...new Set(value.capabilities.filter((item) => typeof item === 'string' && item))]
        : []),
      createContent: typeof value.createContent === 'function'
        ? value.createContent : () => ({}),
      normalizePage: typeof value.normalizePage === 'function'
        ? value.normalizePage : (page) => page,
      validatePage: typeof value.validatePage === 'function'
        ? value.validatePage : () => ({ ok: true }),
      partialSaveFields: normalizePartialSaveFields(value.partialSaveFields),
      disposalHookId: typeof value.disposalHookId === 'string' && value.disposalHookId
        ? value.disposalHookId : null
    });
  }

  function registerPageType(value, { replace = false } = {}) {
    const definition = normalizedDefinition(value);
    if (definitions.has(definition.id) && !replace) {
      throw new Error(`Page Type is already registered: ${definition.id}`);
    }
    definitions.set(definition.id, definition);
    return definition;
  }

  function pageTypeDefinition(value) {
    const type = normalizePageType(value);
    return type ? definitions.get(type) || null : null;
  }

  function pageTypeIsRegistered(value) {
    return Boolean(pageTypeDefinition(value));
  }

  function orderedPageTypes(predicate = () => true) {
    return [...definitions.values()]
      .filter(predicate)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }

  function registeredPageTypes() {
    return orderedPageTypes();
  }

  function pageTypesForMenu() {
    return orderedPageTypes((definition) => definition.pageTypeMenuVisible);
  }

  function vaultDefaultPageTypes() {
    return orderedPageTypes((definition) => definition.vaultDefaultEligible);
  }

  function pageTypeLabel(value) {
    return pageTypeDefinition(value)?.label || `Unsupported (${describedType(value)})`;
  }

  function pageTypeNavigationBadge(value) {
    return pageTypeDefinition(value)?.navigationBadge || null;
  }

  function pageTypeRendererId(value) {
    return pageTypeDefinition(value)?.rendererId || null;
  }

  function pageTypeSupports(value, capability) {
    return typeof capability === 'string'
      && Boolean(pageTypeDefinition(value)?.capabilities.includes(capability));
  }

  function normalizePageRecord(page) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) return page;
    const type = recordPageType(page);
    if (!Object.hasOwn(page, 'type')) page.type = type;
    const definition = pageTypeDefinition(type);
    if (!definition) return page;
    const normalized = definition.normalizePage(page);
    if (normalized !== undefined && normalized !== page) {
      throw new TypeError(`${definition.label} Page normalizers must update the supplied record in place.`);
    }
    if (page.type !== type) {
      page.type = type;
      throw new Error(`${definition.label} Page normalizers cannot change Page type identity.`);
    }
    return page;
  }

  function validatePageRecord(page) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) {
      return { ok: false, error: 'Page must be an object.' };
    }
    const definition = pageTypeDefinition(page.type);
    if (!definition) {
      return { ok: false, error: `Unsupported Page Type: ${describedType(page.type)}.` };
    }
    return definition.validatePage(page);
  }

  function createPageRecord(envelope, requestedType = LEGACY_DEFAULT_PAGE_TYPE) {
    const type = normalizePageType(requestedType);
    const definition = pageTypeDefinition(type);
    if (!definition || !definition.creatable) {
      throw new Error(`Unsupported Page Type: ${describedType(requestedType)}.`);
    }
    const content = definition.createContent();
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new TypeError(`${definition.label} Page content factories must return an object.`);
    }
    const page = {
      ...content,
      ...(envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? envelope : {}),
      type
    };
    normalizePageRecord(page);
    const validation = definition.validatePage(page);
    if (!validation.ok) throw new Error(validation.error || `Invalid ${definition.label} Page.`);
    return page;
  }

  function normalizePageIndexEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const type = recordPageType(entry);
    if (!Object.hasOwn(entry, 'type')) entry.type = type;
    for (const definition of definitions.values()) {
      for (const field of Object.keys(definition.partialSaveFields)) delete entry[field];
    }
    return entry;
  }

  function validateVaultDefaultPageType(value) {
    const type = normalizePageType(value);
    const definition = pageTypeDefinition(type);
    if (!definition || !definition.vaultDefaultEligible) {
      return { ok: false, error: 'Default Page Type must be a registered eligible type.' };
    }
    return { ok: true, type };
  }

  function normalizeVaultDefaultPageType(value) {
    return normalizePageType(value);
  }

  function normalizeSettings(value) {
    return {
      defaultPageType: value && typeof value === 'object' && !Array.isArray(value)
        && Object.hasOwn(value, 'defaultPageType')
        ? normalizeVaultDefaultPageType(value.defaultPageType)
        : LEGACY_DEFAULT_PAGE_TYPE
    };
  }

  function validateSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Page Type settings must be an object.' };
    }
    const validation = validateVaultDefaultPageType(value.defaultPageType);
    if (!validation.ok) return validation;
    return { ok: true, settings: { defaultPageType: validation.type } };
  }

  function validatePageTypePartialSave(page, field, value) {
    const definition = pageTypeDefinition(page?.type);
    if (!definition) {
      return { ok: false, error: `Unsupported Page Type: ${describedType(page?.type)}.` };
    }
    const validator = definition.partialSaveFields[field];
    if (!validator) {
      return { ok: false, error: `${definition.label} does not support saving ${field}.` };
    }
    return validator(value, page);
  }

  function pageTypePartialSaveFields(value) {
    return Object.keys(pageTypeDefinition(value)?.partialSaveFields || {});
  }

  function registeredPartialSaveFields() {
    return [...new Set(registeredPageTypes()
      .flatMap((definition) => Object.keys(definition.partialSaveFields)))];
  }

  function conversionKey(sourceType, targetType) {
    return `${normalizePageType(sourceType)}\u0000${normalizePageType(targetType)}`;
  }

  function registerPageTypeConversion(sourceType, targetType, handlers = {}) {
    const source = normalizePageType(sourceType);
    const target = normalizePageType(targetType);
    if (!pageTypeIsRegistered(source) || !pageTypeIsRegistered(target) || source === target) {
      throw new Error(`Invalid Page Type conversion: ${source} -> ${target}.`);
    }
    if (typeof handlers.eligibility !== 'function' || typeof handlers.convert !== 'function') {
      throw new TypeError('Page Type conversions require eligibility and convert handlers.');
    }
    conversions.set(conversionKey(source, target), Object.freeze({
      sourceType: source,
      targetType: target,
      eligibility: handlers.eligibility,
      convert: handlers.convert
    }));
  }

  function pageTypeConversion(page, targetType) {
    const source = normalizePageType(page?.type);
    const target = normalizePageType(targetType);
    return conversions.get(conversionKey(source, target)) || null;
  }

  function conversionEligibility(page, targetType) {
    const source = normalizePageType(page?.type);
    const target = normalizePageType(targetType);
    if (source === target && pageTypeIsRegistered(source)) return { allowed: true, reasons: [] };
    if (!pageTypeIsRegistered(source)) {
      return { allowed: false, reasons: [`Unsupported source Page Type: ${source}.`] };
    }
    if (!pageTypeIsRegistered(target)) {
      return { allowed: false, reasons: [`Unsupported target Page Type: ${target}.`] };
    }
    const conversion = pageTypeConversion(page, target);
    return conversion
      ? conversion.eligibility(page, target)
      : { allowed: false, reasons: [`Conversion from ${source} to ${target} is not supported.`] };
  }

  function convertPage(page, targetType) {
    const target = normalizePageType(targetType);
    const eligibility = conversionEligibility(page, target);
    if (!eligibility.allowed) return { ok: false, ...eligibility };
    const source = normalizePageType(page?.type);
    if (source === target) {
      return { ok: true, allowed: true, reasons: [], page: normalizePageRecord({ ...page }) };
    }
    const conversion = pageTypeConversion(page, target);
    if (!conversion) return { ok: false, ...eligibility };
    const result = conversion.convert(page, target);
    if (!result?.ok) return result || { ok: false, ...eligibility };
    return { ...result, page: normalizePageRecord(result.page) };
  }

  function conversionTargetPageTypes(page) {
    const source = normalizePageType(page?.type);
    const targets = new Set([source]);
    for (const conversion of conversions.values()) {
      if (conversion.sourceType === source) targets.add(conversion.targetType);
    }
    return [...targets]
      .map((type) => pageTypeDefinition(type))
      .filter(Boolean)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }

  function createHnTextPlaceholder() {
    return hnTextModel.createEmptyEnvelope();
  }

  function normalizeHnTextPlaceholder(value) {
    return hnTextModel.normalizeEnvelope(value);
  }

  function validateHnTextPlaceholder(value) {
    const validation = hnTextModel.validatePersistedEnvelope(value);
    if (!validation.ok) {
      const first = Array.isArray(validation.errors) ? validation.errors[0] : null;
      return {
        ok: false,
        error: typeof first?.message === 'string' && first.message
          ? first.message
          : 'HN Text content is invalid.',
        errors: Array.isArray(validation.errors) ? validation.errors : []
      };
    }
    return { ok: true, value: normalizeHnTextPlaceholder(value) };
  }

  function validateCurrentHnTextPlaceholder(value) {
    const validation = hnTextModel.validateCurrentEnvelope(value);
    if (!validation.ok) {
      const first = Array.isArray(validation.errors) ? validation.errors[0] : null;
      return {
        ok: false,
        error: typeof first?.message === 'string' && first.message
          ? first.message
          : 'HN Text content is invalid.',
        errors: Array.isArray(validation.errors) ? validation.errors : []
      };
    }
    return { ok: true, value: normalizeHnTextPlaceholder(value) };
  }

  function hnTextPlaceholderIsEmpty(value) {
    const migration = hnTextModel.migratePersistedEnvelope(value);
    return Boolean(migration?.ok
      && hnTextModel.isCanonicalEmptyEnvelope(migration.envelope));
  }

  registerPageType({
    id: PAGE_TYPES.CANVAS,
    label: 'Canvas',
    navigationBadge: 'CANVAS',
    order: 10,
    rendererId: 'canvas',
    fileImportPlacementId: 'canvas',
    capabilities: ['canvas', 'page-edit', 'file-import', 'preview'],
    vaultDefaultEligible: true,
    createContent: () => ({}),
    normalizePage: (page) => {
      delete page.markdownBody;
      delete page.textFrame;
      return page;
    }
  });

  registerPageType({
    id: PAGE_TYPES.HN_TEXT,
    label: 'HN Text',
    navigationBadge: 'HN',
    order: 30,
    rendererId: 'cne-text',
    capabilities: ['page-edit', 'preview', 'structured-text'],
    vaultDefaultEligible: true,
    createContent: () => ({
      cneText: createHnTextPlaceholder(),
      textFrame: normalizeTextFrame(null)
    }),
    normalizePage: (page) => {
      page.cneText = Object.hasOwn(page, 'cneText')
        ? normalizeHnTextPlaceholder(page.cneText)
        : createHnTextPlaceholder();
      page.textFrame = normalizeTextFrame(page.textFrame);
      return page;
    },
    validatePage: (page) => {
      const hnValidation = validateHnTextPlaceholder(page?.cneText);
      return hnValidation.ok ? validateTextFrame(page?.textFrame) : hnValidation;
    },
    partialSaveFields: {
      cneText: validateCurrentHnTextPlaceholder,
      textFrame: (value, page) => validateTextFramePartial(value, page?.textFrame)
    }
  });

  return Object.freeze({
    PAGE_TYPES,
    LEGACY_DEFAULT_PAGE_TYPE,
    DEFAULT_SETTINGS,
    HN_TEXT_SCHEMA_VERSION,
    DEFAULT_TEXT_FRAME,
    MIN_FRAME_WIDTH,
    MAX_FRAME_WIDTH,
    normalizeTextFrame,
    validateTextFrame,
    validateTextFramePartial,
    edgesForFrame,
    frameFromEdges,
    resizeBoundary,
    beginBoundaryDrag,
    updateBoundaryDrag,
    projectFrame,
    resolveViewportResize,
    migrateLegacyFrameViewState,
    registerPageType,
    registerPageTypeConversion,
    registeredPageTypes,
    pageTypesForMenu,
    vaultDefaultPageTypes,
    pageTypeDefinition,
    pageTypeIsRegistered,
    pageTypeLabel,
    pageTypeNavigationBadge,
    pageTypeRendererId,
    pageTypeSupports,
    normalizePageType,
    normalizePageRecord,
    validatePageRecord,
    createPageRecord,
    normalizePageIndexEntry,
    validateVaultDefaultPageType,
    normalizeVaultDefaultPageType,
    normalizeSettings,
    validateSettings,
    validatePageTypePartialSave,
    pageTypePartialSaveFields,
    registeredPartialSaveFields,
    conversionEligibility,
    conversionTargetPageTypes,
    convertPage,
    createHnTextPlaceholder,
    normalizeHnTextPlaceholder,
    validateHnTextPlaceholder,
    validateCurrentHnTextPlaceholder,
    hnTextPlaceholderIsEmpty
  });
}));
