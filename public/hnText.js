(function exposeHnTextModel(root, factory) {
  const numbering = typeof module === 'object' && module.exports
    ? require('./hnListNumbering')
    : root?.hnListNumbering;
  const countModel = typeof module === 'object' && module.exports
    ? require('./structuredTextCount')
    : root?.structuredTextCountModel;
  const markdownRuntime = typeof module === 'object' && module.exports
    ? require('./vendor/markdownRuntime')
    : root?.markdownRuntime;
  const api = factory(numbering, countModel, markdownRuntime);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.hnTextModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (
  hnListNumbering,
  structuredTextCountModel,
  legacyMarkdownRuntime
) => {
  if (!hnListNumbering
    || !hnListNumbering.SCHEMES
    || !Array.isArray(hnListNumbering.SCHEME_VALUES)) {
    throw new Error('hnListNumbering must load before hnTextModel.');
  }
  if (!structuredTextCountModel?.statisticsFromTextBlocks) {
    throw new Error('structuredTextCountModel must load before hnTextModel.');
  }
  const HN_PAGE_TYPE = 'cne-text';
  const LEGACY_CNE_SCHEMA_VERSION = 1;
  const STRUCTURED_CNE_SCHEMA_VERSION = 2;
  const HN_SCHEMA_VERSION = 3;
  const HN_TEXT_MODES = Object.freeze({
    EDIT: 'edit',
    BROWSER: 'browser'
  });
  const HN_TEXT_MODE_VALUES = Object.freeze(Object.values(HN_TEXT_MODES));
  const HN_TEXT_MODE_SET = new Set(HN_TEXT_MODE_VALUES);
  const DEFAULT_SETTINGS = Object.freeze({ cneTextMode: HN_TEXT_MODES.EDIT });
  const BLOCK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  const BLOCK_TYPES = Object.freeze(['paragraph', 'heading']);
  const LIST_NODE_TYPES = Object.freeze(['list_sequence', 'list_item']);
  const MARK_TYPES = Object.freeze(['strong', 'emphasis', 'strikethrough']);
  const BLOCK_TYPE_SET = new Set(BLOCK_TYPES);
  const COUNT_ROOT_TYPE_SET = new Set([...BLOCK_TYPES, 'list_sequence']);
  const LIST_SCHEMES = hnListNumbering.SCHEME_VALUES;
  const LIST_SCHEME_SET = new Set(LIST_SCHEMES);
  const ROMAN_SCHEMES = new Set([
    hnListNumbering.SCHEMES.UPPER_ROMAN_LEFT,
    hnListNumbering.SCHEMES.LOWER_ROMAN_LEFT
  ]);
  const MARK_TYPE_SET = new Set(MARK_TYPES);
  let fallbackIdSequence = 0;

  function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneJson(value, seen = new WeakMap()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) throw new TypeError('HN Text values must not contain cycles.');
    const clone = Array.isArray(value) ? [] : {};
    seen.set(value, clone);
    if (Array.isArray(value)) {
      value.forEach((item) => clone.push(cloneJson(item, seen)));
    } else {
      Object.keys(value).forEach((key) => {
        clone[key] = cloneJson(value[key], seen);
      });
    }
    seen.delete(value);
    return clone;
  }

  function defaultBlockId() {
    const token = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replaceAll('-', '')
      : `${Date.now().toString(36)}${(++fallbackIdSequence).toString(36)}`;
    return `cne_block_${token}`;
  }

  function createBlockId(idFactory = null) {
    const candidate = idFactory ? idFactory() : defaultBlockId();
    if (typeof candidate !== 'string' || !BLOCK_ID_PATTERN.test(candidate)) {
      throw new TypeError('HN block ID factories must return a valid stable ID.');
    }
    return candidate;
  }

  function createEmptyDocument() {
    return { type: 'doc', content: [] };
  }

  function createEmptyEnvelope() {
    return {
      schemaVersion: HN_SCHEMA_VERSION,
      revision: 0,
      source: '',
      anchors: {}
    };
  }

  function inlineText(value, marks = []) {
    const text = String(value ?? '');
    if (!text) return null;
    const normalizedMarks = [...new Set((Array.isArray(marks) ? marks : [])
      .map((mark) => typeof mark === 'string' ? mark : mark?.type)
      .filter((type) => MARK_TYPE_SET.has(type)))]
      .map((type) => ({ type }));
    return {
      type: 'text',
      text,
      ...(normalizedMarks.length ? { marks: normalizedMarks } : {})
    };
  }

  function createParagraph(text = '', { idFactory = null, marks = [] } = {}) {
    const child = inlineText(text, marks);
    return {
      type: 'paragraph',
      attrs: { id: createBlockId(idFactory) },
      ...(child ? { content: [child] } : {})
    };
  }

  function createHeading(text = '', {
    idFactory = null,
    level = 1,
    marks = []
  } = {}) {
    if (!Number.isInteger(level) || level < 1 || level > 6) {
      throw new RangeError('HN heading levels must be integers from 1 through 6.');
    }
    const child = inlineText(text, marks);
    return {
      type: 'heading',
      attrs: { id: createBlockId(idFactory), level },
      ...(child ? { content: [child] } : {})
    };
  }

  function canonicalListSequenceAttrs({
    idFactory = null,
    scheme = hnListNumbering.SCHEMES.DECIMAL,
    startOrdinal = 1,
    dottedPrefix
  } = {}) {
    if (!LIST_SCHEME_SET.has(scheme)) {
      throw new TypeError(`Unsupported HN List numbering scheme: ${String(scheme)}.`);
    }
    if (!Number.isSafeInteger(startOrdinal) || startOrdinal < 1) {
      throw new RangeError('HN List startOrdinal must be a positive safe integer.');
    }
    const isDotted = scheme === hnListNumbering.SCHEMES.DOTTED_DECIMAL;
    if (isDotted) {
      if (!Array.isArray(dottedPrefix) || dottedPrefix.length === 0
        || !dottedPrefix.every((ordinal) => Number.isSafeInteger(ordinal) && ordinal > 0)) {
        throw new TypeError('Dotted-decimal HN Lists require a non-empty positive-safe dottedPrefix.');
      }
    } else if (dottedPrefix !== undefined) {
      throw new TypeError('Only dotted-decimal HN Lists may define dottedPrefix.');
    }
    return {
      id: createBlockId(idFactory),
      scheme,
      startOrdinal,
      ...(isDotted ? { dottedPrefix: [...dottedPrefix] } : {})
    };
  }

  function createListItem(paragraphs = null, {
    idFactory = null,
    childSequence = null
  } = {}) {
    const paragraphNodes = paragraphs === null
      ? [createParagraph('', { idFactory })]
      : cloneJson(paragraphs);
    if (!Array.isArray(paragraphNodes) || paragraphNodes.length === 0
      || paragraphNodes.some((node) => node?.type !== 'paragraph')) {
      throw new TypeError('HN List items require one or more Paragraph nodes.');
    }
    if (childSequence !== null && childSequence?.type !== 'list_sequence') {
      throw new TypeError('A HN List item child must be a ListSequence.');
    }
    const listItem = {
      type: 'list_item',
      attrs: { id: createBlockId(idFactory) },
      content: [
        ...paragraphNodes,
        ...(childSequence === null ? [] : [cloneJson(childSequence)])
      ]
    };
    const errors = [];
    validateListItemNode(listItem, 'listItem', errors, new Set());
    if (errors.length) throw new TypeError(errors[0].message);
    return listItem;
  }

  function createListSequence(items = null, options = {}) {
    const attrs = canonicalListSequenceAttrs(options);
    const itemNodes = items === null
      ? [createListItem(null, { idFactory: options.idFactory ?? null })]
      : cloneJson(items);
    if (!Array.isArray(itemNodes) || itemNodes.length === 0
      || itemNodes.some((node) => node?.type !== 'list_item')) {
      throw new TypeError('HN List sequences require one or more ListItem nodes.');
    }
    const sequence = { type: 'list_sequence', attrs, content: itemNodes };
    const validation = validateDocument({ type: 'doc', content: [sequence] });
    if (!validation.ok) throw new TypeError(validation.error);
    return sequence;
  }

  // Normalization is intentionally non-destructive. Persisted legacy envelopes,
  // malformed values, and future schemas survive unchanged (apart from cloning)
  // so validation/migration remains an explicit caller-owned operation.
  function normalizeDocument(value) {
    return value && typeof value === 'object' ? cloneJson(value) : value;
  }

  function normalizeEnvelope(value) {
    return value && typeof value === 'object' ? cloneJson(value) : value;
  }

  function errorAt(errors, path, code, message) {
    errors.push(Object.freeze({ path, code, message }));
  }

  function unexpectedKeys(value, allowedKeys) {
    return Object.keys(value).filter((key) => !allowedKeys.has(key));
  }

  function validateMark(mark, path, errors) {
    if (!isPlainRecord(mark)) {
      errorAt(errors, path, 'mark-object', 'Mark must be an object.');
      return null;
    }
    const extras = unexpectedKeys(mark, new Set(['type']));
    if (extras.length) {
      errorAt(errors, path, 'mark-fields', `Mark contains unsupported fields: ${extras.join(', ')}.`);
    }
    if (!MARK_TYPE_SET.has(mark.type)) {
      errorAt(errors, `${path}.type`, 'mark-type', `Unsupported HN mark: ${String(mark.type)}.`);
      return null;
    }
    return mark.type;
  }

  function validateTextNode(node, path, errors) {
    const extras = unexpectedKeys(node, new Set(['type', 'text', 'marks']));
    if (extras.length) {
      errorAt(errors, path, 'text-fields', `Text contains unsupported fields: ${extras.join(', ')}.`);
    }
    if (typeof node.text !== 'string' || node.text.length === 0) {
      errorAt(errors, `${path}.text`, 'text-value', 'Text nodes require a non-empty string.');
    }
    if (!Object.hasOwn(node, 'marks')) return;
    if (!Array.isArray(node.marks)) {
      errorAt(errors, `${path}.marks`, 'marks-array', 'Text marks must be an array.');
      return;
    }
    const seenMarks = new Set();
    node.marks.forEach((mark, index) => {
      const type = validateMark(mark, `${path}.marks[${index}]`, errors);
      if (type && seenMarks.has(type)) {
        errorAt(errors, `${path}.marks[${index}]`, 'duplicate-mark', `Duplicate ${type} mark.`);
      }
      if (type) seenMarks.add(type);
    });
  }

  function validateStableId(attrs, path, errors, ids, label) {
    if (typeof attrs.id !== 'string' || !BLOCK_ID_PATTERN.test(attrs.id)) {
      errorAt(errors, `${path}.id`, 'structural-id',
        `${label} requires a valid stable ID.`);
    } else if (ids.has(attrs.id)) {
      errorAt(errors, `${path}.id`, 'duplicate-structural-id',
        `Duplicate HN structural ID: ${attrs.id}.`);
    } else {
      ids.add(attrs.id);
    }
  }

  function validateTextBlockNode(node, path, errors, ids, { allowHeading = true } = {}) {
    if (!isPlainRecord(node)) {
      errorAt(errors, path, 'block-object', 'HN blocks must be objects.');
      return;
    }
    if (!BLOCK_TYPE_SET.has(node.type) || (!allowHeading && node.type === 'heading')) {
      errorAt(errors, `${path}.type`, 'block-type', `Unsupported HN block: ${String(node.type)}.`);
      return;
    }
    const extras = unexpectedKeys(node, new Set(['type', 'attrs', 'content']));
    if (extras.length) {
      errorAt(errors, path, 'block-fields', `Block contains unsupported fields: ${extras.join(', ')}.`);
    }
    if (!isPlainRecord(node.attrs)) {
      errorAt(errors, `${path}.attrs`, 'block-attrs', 'HN blocks require an attrs object.');
    } else {
      const expectedAttrs = node.type === 'heading'
        ? new Set(['id', 'level']) : new Set(['id']);
      const extraAttrs = unexpectedKeys(node.attrs, expectedAttrs);
      if (extraAttrs.length) {
        errorAt(errors, `${path}.attrs`, 'block-attr-fields',
          `Block attrs contain unsupported fields: ${extraAttrs.join(', ')}.`);
      }
      validateStableId(node.attrs, `${path}.attrs`, errors, ids, 'HN blocks');
      if (node.type === 'heading'
        && (!Number.isInteger(node.attrs.level) || node.attrs.level < 1 || node.attrs.level > 6)) {
        errorAt(errors, `${path}.attrs.level`, 'heading-level',
          'HN heading levels must be integers from 1 through 6.');
      }
    }
    if (!Object.hasOwn(node, 'content')) return;
    if (!Array.isArray(node.content)) {
      errorAt(errors, `${path}.content`, 'inline-array', 'Block content must be an array.');
      return;
    }
    node.content.forEach((child, index) => {
      const childPath = `${path}.content[${index}]`;
      if (!isPlainRecord(child)) {
        errorAt(errors, childPath, 'inline-object', 'Inline content must be an object.');
      } else if (child.type !== 'text') {
        errorAt(errors, `${childPath}.type`, 'inline-type',
          `Unsupported HN inline node: ${String(child.type)}.`);
      } else {
        validateTextNode(child, childPath, errors);
      }
    });
  }

  function validateListSequenceAttrs(attrs, path, errors, ids) {
    if (!isPlainRecord(attrs)) {
      errorAt(errors, path, 'list-sequence-attrs', 'HN ListSequence requires an attrs object.');
      return;
    }
    const extras = unexpectedKeys(attrs,
      new Set(['id', 'scheme', 'startOrdinal', 'dottedPrefix']));
    if (extras.length) {
      errorAt(errors, path, 'list-sequence-attr-fields',
        `ListSequence attrs contain unsupported fields: ${extras.join(', ')}.`);
    }
    validateStableId(attrs, path, errors, ids, 'HN ListSequence');
    if (!LIST_SCHEME_SET.has(attrs.scheme)) {
      errorAt(errors, `${path}.scheme`, 'list-scheme',
        `Unsupported HN List numbering scheme: ${String(attrs.scheme)}.`);
    }
    if (!Number.isSafeInteger(attrs.startOrdinal) || attrs.startOrdinal < 1) {
      errorAt(errors, `${path}.startOrdinal`, 'list-start-ordinal',
        'HN List startOrdinal must be a positive safe integer.');
    }
    const isDotted = attrs.scheme === hnListNumbering.SCHEMES.DOTTED_DECIMAL;
    if (isDotted) {
      if (!Object.hasOwn(attrs, 'dottedPrefix')
        || !Array.isArray(attrs.dottedPrefix)
        || attrs.dottedPrefix.length === 0) {
        errorAt(errors, `${path}.dottedPrefix`, 'list-dotted-prefix',
          'Dotted-decimal HN Lists require a non-empty dottedPrefix.');
      } else {
        attrs.dottedPrefix.forEach((ordinal, index) => {
          if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
            errorAt(errors, `${path}.dottedPrefix[${index}]`, 'list-dotted-prefix-ordinal',
              'Dotted-decimal prefix ordinals must be positive safe integers.');
          }
        });
      }
    } else if (Object.hasOwn(attrs, 'dottedPrefix')) {
      errorAt(errors, `${path}.dottedPrefix`, 'list-unexpected-dotted-prefix',
        'Only dotted-decimal HN Lists may define dottedPrefix.');
    }
  }

  function validateListItemNode(node, path, errors, ids) {
    if (!isPlainRecord(node)) {
      errorAt(errors, path, 'list-item-object', 'HN ListItem must be an object.');
      return;
    }
    if (node.type !== 'list_item') {
      errorAt(errors, `${path}.type`, 'list-item-type', 'ListSequence children must be ListItem nodes.');
      return;
    }
    const extras = unexpectedKeys(node, new Set(['type', 'attrs', 'content']));
    if (extras.length) {
      errorAt(errors, path, 'list-item-fields',
        `ListItem contains unsupported fields: ${extras.join(', ')}.`);
    }
    if (!isPlainRecord(node.attrs)) {
      errorAt(errors, `${path}.attrs`, 'list-item-attrs', 'HN ListItem requires an attrs object.');
    } else {
      const attrExtras = unexpectedKeys(node.attrs, new Set(['id']));
      if (attrExtras.length) {
        errorAt(errors, `${path}.attrs`, 'list-item-attr-fields',
          `ListItem attrs contain unsupported fields: ${attrExtras.join(', ')}.`);
      }
      validateStableId(node.attrs, `${path}.attrs`, errors, ids, 'HN ListItem');
    }
    if (!Array.isArray(node.content)) {
      errorAt(errors, `${path}.content`, 'list-item-content',
        'HN ListItem content must be an array.');
      return;
    }
    let paragraphCount = 0;
    let childSequenceCount = 0;
    node.content.forEach((child, index) => {
      const childPath = `${path}.content[${index}]`;
      if (isPlainRecord(child) && child.type === 'paragraph' && childSequenceCount === 0) {
        paragraphCount += 1;
        validateTextBlockNode(child, childPath, errors, ids, { allowHeading: false });
      } else if (isPlainRecord(child) && child.type === 'list_sequence'
        && index === node.content.length - 1 && childSequenceCount === 0) {
        childSequenceCount += 1;
        validateListSequenceNode(child, childPath, errors, ids);
      } else {
        errorAt(errors, childPath, 'list-item-child',
          'ListItem content must be Paragraph+ followed by at most one child ListSequence.');
      }
    });
    if (paragraphCount === 0) {
      errorAt(errors, `${path}.content`, 'list-item-paragraphs',
        'HN ListItem requires one or more Paragraph children.');
    }
  }

  function validateListSequenceNode(node, path, errors, ids) {
    if (!isPlainRecord(node)) {
      errorAt(errors, path, 'list-sequence-object', 'HN ListSequence must be an object.');
      return;
    }
    if (node.type !== 'list_sequence') {
      errorAt(errors, `${path}.type`, 'list-sequence-type',
        'HN structural list roots must be ListSequence nodes.');
      return;
    }
    const extras = unexpectedKeys(node, new Set(['type', 'attrs', 'content']));
    if (extras.length) {
      errorAt(errors, path, 'list-sequence-fields',
        `ListSequence contains unsupported fields: ${extras.join(', ')}.`);
    }
    validateListSequenceAttrs(node.attrs, `${path}.attrs`, errors, ids);
    if (!Array.isArray(node.content) || node.content.length === 0) {
      errorAt(errors, `${path}.content`, 'list-sequence-content',
        'HN ListSequence requires one or more ListItem children.');
      return;
    }
    if (Number.isSafeInteger(node.attrs?.startOrdinal) && node.attrs.startOrdinal > 0) {
      const finalOrdinal = node.attrs.startOrdinal + (node.content.length - 1);
      if (!Number.isSafeInteger(finalOrdinal)) {
        errorAt(errors, `${path}.attrs.startOrdinal`, 'list-sequence-range',
          'HN List generated ordinals must remain positive safe integers.');
      } else if (ROMAN_SCHEMES.has(node.attrs?.scheme) && finalOrdinal > 3999) {
        errorAt(errors, `${path}.attrs.startOrdinal`, 'list-roman-range',
          'HN Roman List ordinals must not exceed 3999.');
      }
    }
    node.content.forEach((item, index) => {
      validateListItemNode(item, `${path}.content[${index}]`, errors, ids);
    });
  }

  function validationResult(errors, value) {
    if (errors.length) {
      return Object.freeze({
        ok: false,
        error: errors[0].message,
        errors: Object.freeze(errors)
      });
    }
    return Object.freeze({ ok: true, value: cloneJson(value), errors: Object.freeze([]) });
  }

  function validateDocumentForSchema(value, { allowLists }) {
    const errors = [];
    if (!isPlainRecord(value)) {
      errorAt(errors, 'document', 'document-object', 'HN document must be an object.');
      return validationResult(errors, value);
    }
    const extras = unexpectedKeys(value, new Set(['type', 'content']));
    if (extras.length) {
      errorAt(errors, 'document', 'document-fields',
        `HN document contains unsupported fields: ${extras.join(', ')}.`);
    }
    if (value.type !== 'doc') {
      errorAt(errors, 'document.type', 'document-type', 'HN document type must be doc.');
    }
    if (!Array.isArray(value.content)) {
      errorAt(errors, 'document.content', 'document-content', 'HN document content must be an array.');
    } else {
      const ids = new Set();
      value.content.forEach((block, index) => {
        const path = `document.content[${index}]`;
        if (allowLists && isPlainRecord(block) && block.type === 'list_sequence') {
          validateListSequenceNode(block, path, errors, ids);
        } else {
          validateTextBlockNode(block, path, errors, ids);
        }
      });
    }
    return validationResult(errors, value);
  }

  function validateDocument(value) {
    return validateDocumentForSchema(value, { allowLists: true });
  }

  function validateEnvelopeForSchema(value, { schemaVersion, allowLists }) {
    const errors = [];
    if (!isPlainRecord(value)) {
      errorAt(errors, 'cneText', 'envelope-object', 'HN Text content must be an object.');
      return validationResult(errors, value);
    }
    const extras = unexpectedKeys(value, new Set(['schemaVersion', 'revision', 'document']));
    if (extras.length) {
      errorAt(errors, 'cneText', 'envelope-fields',
        `HN Text content contains unsupported fields: ${extras.join(', ')}.`);
    }
    if (value.schemaVersion !== schemaVersion) {
      errorAt(errors, 'cneText.schemaVersion', 'schema-version',
        `HN Text schemaVersion must be ${schemaVersion}.`);
    }
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
      errorAt(errors, 'cneText.revision', 'revision',
        'HN Text revision must be a nonnegative safe integer.');
    }
    const documentValidation = validateDocumentForSchema(value.document, { allowLists });
    if (!documentValidation.ok) errors.push(...documentValidation.errors);
    return validationResult(errors, value);
  }

  function validateLegacyV1Envelope(value) {
    return validateEnvelopeForSchema(value, {
      schemaVersion: LEGACY_CNE_SCHEMA_VERSION,
      allowLists: false
    });
  }

  function validateLegacyV2Envelope(value) {
    return validateEnvelopeForSchema(value, {
      schemaVersion: STRUCTURED_CNE_SCHEMA_VERSION,
      allowLists: true
    });
  }

  function validateAnchors(value, path, errors) {
    if (!isPlainRecord(value)) {
      errorAt(errors, path, 'anchors-object', 'HN Text anchors must be an object.');
      return;
    }
    const keys = Object.keys(value);
    if (keys.length) {
      errorAt(errors, path, 'anchors-fields',
        `HN Text schema ${HN_SCHEMA_VERSION} does not yet support anchor entries: ${keys.join(', ')}.`);
    }
  }

  function validateCurrentEnvelope(value) {
    const errors = [];
    if (!isPlainRecord(value)) {
      errorAt(errors, 'cneText', 'envelope-object', 'HN Text content must be an object.');
      return validationResult(errors, value);
    }
    const extras = unexpectedKeys(value,
      new Set(['schemaVersion', 'revision', 'source', 'anchors']));
    if (extras.length) {
      errorAt(errors, 'cneText', 'envelope-fields',
        `HN Text content contains unsupported fields: ${extras.join(', ')}.`);
    }
    if (value.schemaVersion !== HN_SCHEMA_VERSION) {
      errorAt(errors, 'cneText.schemaVersion', 'schema-version',
        `HN Text schemaVersion must be ${HN_SCHEMA_VERSION}.`);
    }
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
      errorAt(errors, 'cneText.revision', 'revision',
        'HN Text revision must be a nonnegative safe integer.');
    }
    if (typeof value.source !== 'string') {
      errorAt(errors, 'cneText.source', 'source-string',
        'HN Text source must be a string.');
    }
    validateAnchors(value.anchors, 'cneText.anchors', errors);
    return validationResult(errors, value);
  }

  function validateLegacyPersistedShape(value) {
    const errors = [];
    if (!isPlainRecord(value)) {
      errorAt(errors, 'cneText', 'envelope-object', 'HN Text content must be an object.');
      return validationResult(errors, value);
    }
    const extras = unexpectedKeys(value, new Set(['schemaVersion', 'revision', 'document']));
    if (extras.length) {
      errorAt(errors, 'cneText', 'envelope-fields',
        `Legacy CNE Text content contains unsupported fields: ${extras.join(', ')}.`);
    }
    if (value.schemaVersion !== LEGACY_CNE_SCHEMA_VERSION
      && value.schemaVersion !== STRUCTURED_CNE_SCHEMA_VERSION) {
      errorAt(errors, 'cneText.schemaVersion', 'schema-version',
        `Unsupported persisted HN Text schemaVersion: ${String(value.schemaVersion)}.`);
    }
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
      errorAt(errors, 'cneText.revision', 'revision',
        'HN Text revision must be a nonnegative safe integer.');
    }
    if (!isPlainRecord(value.document)) {
      errorAt(errors, 'document', 'document-object', 'Legacy CNE document must be an object.');
    } else {
      if (value.document.type !== 'doc') {
        errorAt(errors, 'document.type', 'document-type', 'Legacy CNE document type must be doc.');
      }
      if (!Array.isArray(value.document.content)) {
        errorAt(errors, 'document.content', 'document-content',
          'Legacy CNE document content must be an array.');
      }
    }
    return validationResult(errors, value);
  }

  function validatePersistedEnvelope(value) {
    if (!isPlainRecord(value)) {
      return validateCurrentEnvelope(value);
    }
    if (value.schemaVersion === HN_SCHEMA_VERSION) return validateCurrentEnvelope(value);
    if (value.schemaVersion === STRUCTURED_CNE_SCHEMA_VERSION
      || value.schemaVersion === LEGACY_CNE_SCHEMA_VERSION) {
      return validateLegacyPersistedShape(value);
    }
    const errors = [];
    errorAt(errors, 'cneText.schemaVersion', 'schema-version',
      `Unsupported persisted HN Text schemaVersion: ${String(value.schemaVersion)}.`);
    return validationResult(errors, value);
  }

  const validateEnvelope = validateCurrentEnvelope;

  const LEGACY_MARK_ORDERS = Object.freeze([
    Object.freeze(['strong', 'emphasis', 'strikethrough']),
    Object.freeze(['emphasis', 'strong', 'strikethrough']),
    Object.freeze(['strong', 'strikethrough', 'emphasis']),
    Object.freeze(['emphasis', 'strikethrough', 'strong']),
    Object.freeze(['strikethrough', 'strong', 'emphasis']),
    Object.freeze(['strikethrough', 'emphasis', 'strong'])
  ]);

  function legacyInlineStrategies() {
    const strategies = [];
    const seen = new Set();
    for (const encodeWhitespace of [false, true]) {
      for (const markOrder of LEGACY_MARK_ORDERS) {
        for (const strong of ['**', '__']) {
          for (const emphasis of ['*', '_']) {
            const delimiters = { strong, emphasis, strikethrough: '~~' };
            const key = JSON.stringify([markOrder, delimiters, encodeWhitespace]);
            if (seen.has(key)) continue;
            seen.add(key);
            strategies.push(Object.freeze({
              markOrder,
              delimiters: Object.freeze(delimiters),
              encodeWhitespace
            }));
          }
        }
      }
    }
    return Object.freeze(strategies);
  }

  const LEGACY_INLINE_STRATEGIES = legacyInlineStrategies();

  function escapeLegacyMarkdownText(value, { encodeWhitespace = false } = {}) {
    return String(value ?? '').replace(
      encodeWhitespace
        ? /\s|[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/gu
        : /[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/g,
      (character) => encodeWhitespace && /\s/u.test(character)
        ? `&#${character.codePointAt(0)};`
        : `\\${character}`
    );
  }

  function orderedLegacyMarks(node, markOrder = MARK_TYPES) {
    const present = new Set((Array.isArray(node?.marks) ? node.marks : [])
      .map((mark) => mark?.type));
    return markOrder.filter((type) => present.has(type));
  }

  function serializeLegacyInlineCandidate(content, strategy) {
    const nodes = Array.isArray(content) ? content : [];
    let activeMarks = [];
    let source = '';
    for (const node of nodes) {
      const nextMarks = orderedLegacyMarks(node, strategy.markOrder);
      let shared = 0;
      while (shared < activeMarks.length && shared < nextMarks.length
        && activeMarks[shared] === nextMarks[shared]) shared += 1;
      for (let index = activeMarks.length - 1; index >= shared; index -= 1) {
        source += strategy.delimiters[activeMarks[index]];
      }
      for (let index = shared; index < nextMarks.length; index += 1) {
        source += strategy.delimiters[nextMarks[index]];
      }
      source += escapeLegacyMarkdownText(node?.text, {
        encodeWhitespace: strategy.encodeWhitespace
      });
      activeMarks = nextMarks;
    }
    for (let index = activeMarks.length - 1; index >= 0; index -= 1) {
      source += strategy.delimiters[activeMarks[index]];
    }
    return source;
  }

  function normalizedLegacyInlineRuns(content) {
    const runs = [];
    for (const node of Array.isArray(content) ? content : []) {
      const marks = orderedLegacyMarks(node).slice().sort();
      const previous = runs[runs.length - 1];
      if (previous && previous.marks.join('\u0000') === marks.join('\u0000')) {
        previous.text += node.text;
      } else {
        runs.push({ text: node.text, marks });
      }
    }
    return runs;
  }

  function parsedLegacyInlineRuns(source) {
    if (typeof legacyMarkdownRuntime?.parseMarkdown !== 'function') return null;
    let tree;
    try {
      tree = legacyMarkdownRuntime.parseMarkdown(source);
    } catch {
      return null;
    }
    if (!tree || tree.type !== 'root' || tree.children?.length !== 1
      || tree.children[0]?.type !== 'paragraph') return null;
    const runs = [];
    let unsupported = false;
    const visit = (node, activeMarks = []) => {
      if (unsupported || !node) return;
      if (node.type === 'text') {
        const marks = [...activeMarks].sort();
        const previous = runs[runs.length - 1];
        if (previous && previous.marks.join('\u0000') === marks.join('\u0000')) {
          previous.text += node.value;
        } else {
          runs.push({ text: node.value, marks });
        }
        return;
      }
      const markType = node.type === 'strong' ? 'strong'
        : node.type === 'emphasis' ? 'emphasis'
          : node.type === 'delete' ? 'strikethrough' : null;
      if (node.type !== 'paragraph' && !markType) {
        unsupported = true;
        return;
      }
      const nextMarks = markType ? [...activeMarks, markType] : activeMarks;
      for (const child of Array.isArray(node.children) ? node.children : []) {
        visit(child, nextMarks);
      }
    };
    visit(tree.children[0]);
    return unsupported ? null : runs;
  }

  function legacyInlineRoundTrips(content, source) {
    const expected = normalizedLegacyInlineRuns(content);
    if (expected.length === 0) return source === '';
    const parsed = parsedLegacyInlineRuns(source);
    return parsed !== null && JSON.stringify(parsed) === JSON.stringify(expected);
  }

  function encodeLegacyTextAsNumericEntities(value) {
    return Array.from(String(value ?? ''), (character) => (
      `&#x${character.codePointAt(0).toString(16)};`
    )).join('');
  }

  function encodeLegacyTextForRobustRoundTrip(value) {
    return Array.from(String(value ?? ''), (character) => {
      const codePoint = character.codePointAt(0);
      const numericReferenceIsLossy = (codePoint >= 0x01 && codePoint <= 0x08)
        || codePoint === 0x0b
        || (codePoint >= 0x0e && codePoint <= 0x1f)
        || (codePoint >= 0x7f && codePoint <= 0x9f)
        || (codePoint >= 0xd800 && codePoint <= 0xdfff);
      return numericReferenceIsLossy
        ? character
        : `&#x${codePoint.toString(16)};`;
    }).join('');
  }

  function serializeLegacyMarkAtom(run, family, encodeText) {
    const encoded = encodeText(run.text);
    const strong = run.marks.includes('strong');
    const emphasis = run.marks.includes('emphasis');
    if (!strong && !emphasis) return encoded;
    const strongDelimiter = family === 0 ? '**' : '__';
    const emphasisDelimiter = family === 0 ? '_' : '*';
    if (strong && emphasis) {
      return `${strongDelimiter}${emphasisDelimiter}${encoded}`
        + `${emphasisDelimiter}${strongDelimiter}`;
    }
    const delimiter = strong ? strongDelimiter : emphasisDelimiter;
    return `${delimiter}${encoded}${delimiter}`;
  }

  // A fixed global mark nesting order cannot represent every valid sequence of
  // overlapping legacy mark runs without adjacent delimiters coalescing. This
  // final deterministic strategies keep each strong/emphasis run independent,
  // alternates delimiter families at run boundaries, and wraps one maximal
  // strikethrough region at a time. Escaped whitespace is tried before fully
  // numeric text so controls which CommonMark preserves do not get rejected
  // unnecessarily. The round-trip check below remains authoritative for
  // characters CommonMark cannot preserve (for example NUL).
  function serializeLegacyInlineRobust(content, encodeText) {
    const runs = normalizedLegacyInlineRuns(content);
    let family = 0;
    let source = '';
    for (let index = 0; index < runs.length;) {
      const strike = runs[index].marks.includes('strikethrough');
      let end = index + 1;
      while (strike && end < runs.length
        && runs[end].marks.includes('strikethrough')) end += 1;
      let region = '';
      for (let runIndex = index; runIndex < end; runIndex += 1) {
        region += serializeLegacyMarkAtom(runs[runIndex], family, encodeText);
        if (runs[runIndex].marks.includes('strong')
          || runs[runIndex].marks.includes('emphasis')) family = family === 0 ? 1 : 0;
      }
      source += strike ? `~~${region}~~` : region;
      index = end;
    }
    return source;
  }

  function serializeLegacyInline(content, { path = 'inline' } = {}) {
    const nodes = Array.isArray(content) ? content : [];
    if (nodes.length === 0) return '';
    for (const strategy of LEGACY_INLINE_STRATEGIES) {
      const source = serializeLegacyInlineCandidate(nodes, strategy);
      if (legacyInlineRoundTrips(nodes, source)) return source;
    }
    const robustCandidates = [
      serializeLegacyInlineRobust(nodes, (value) => (
        escapeLegacyMarkdownText(value, { encodeWhitespace: true })
      )),
      serializeLegacyInlineRobust(nodes, encodeLegacyTextForRobustRoundTrip),
      serializeLegacyInlineRobust(nodes, encodeLegacyTextAsNumericEntities)
    ];
    for (const source of robustCandidates) {
      if (legacyInlineRoundTrips(nodes, source)) return source;
    }
    const error = new TypeError(
      'Legacy inline content cannot be represented losslessly as Markdown-compatible source.'
    );
    error.code = 'UNSUPPORTED_LEGACY_CNE_INLINE_SOURCE';
    error.errors = Object.freeze([Object.freeze({
      path,
      code: 'legacy-inline-roundtrip',
      message: error.message
    })]);
    throw error;
  }

  function legacyRoman(value, lowerCase = false) {
    const digits = [
      [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
      [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
      [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
    ];
    let remaining = value;
    let token = '';
    for (const [ordinal, digit] of digits) {
      while (remaining >= ordinal) {
        token += digit;
        remaining -= ordinal;
      }
    }
    return lowerCase ? token.toLowerCase() : token;
  }

  function legacyAlpha(value) {
    let remaining = value;
    let token = '';
    while (remaining > 0) {
      remaining -= 1;
      token = String.fromCharCode(97 + (remaining % 26)) + token;
      remaining = Math.floor(remaining / 26);
    }
    return token;
  }

  function legacyListMarker(sequence, itemIndex) {
    const ordinal = sequence.attrs.startOrdinal + itemIndex;
    if (sequence.attrs.scheme === hnListNumbering.SCHEMES.DECIMAL) return `${ordinal}.`;
    if (sequence.attrs.scheme === hnListNumbering.SCHEMES.DOTTED_DECIMAL) {
      return `${[...sequence.attrs.dottedPrefix, ordinal].join('.')}.`;
    }
    if (sequence.attrs.scheme === hnListNumbering.SCHEMES.UPPER_ROMAN_LEFT) {
      return `(${legacyRoman(ordinal)}`;
    }
    if (sequence.attrs.scheme === hnListNumbering.SCHEMES.LOWER_ROMAN_LEFT) {
      return `(${legacyRoman(ordinal, true)}`;
    }
    return `(${legacyAlpha(ordinal)}`;
  }

  function serializeLegacyTextBlock(node) {
    const text = serializeLegacyInline(node.content);
    return node.type === 'heading' ? `${'#'.repeat(node.attrs.level)} ${text}` : text;
  }

  function serializeLegacyListSequence(sequence, depth = 0) {
    const indent = '\t'.repeat(depth);
    const items = [];
    sequence.content.forEach((item, itemIndex) => {
      const paragraphs = item.content.filter((child) => child.type === 'paragraph');
      const childSequence = item.content.find((child) => child.type === 'list_sequence') || null;
      const marker = legacyListMarker(sequence, itemIndex);
      const continuationPrefix = `${indent}${' '.repeat(marker.length + 1)}`;
      const lines = [
        `${indent}${marker} ${serializeLegacyInline(paragraphs[0]?.content)}`
      ];
      paragraphs.slice(1).forEach((paragraph) => {
        lines.push(`${continuationPrefix}${serializeLegacyInline(paragraph.content)}`);
      });
      if (childSequence) lines.push(serializeLegacyListSequence(childSequence, depth + 1));
      items.push(lines.join('\n'));
    });
    return items.join('\n');
  }

  function serializeLegacyDocumentToSource(documentValue, { schemaVersion = null } = {}) {
    const allowLists = schemaVersion === STRUCTURED_CNE_SCHEMA_VERSION;
    const validation = validateDocumentForSchema(documentValue, { allowLists });
    if (!validation.ok) {
      const error = new TypeError(validation.error || 'Unsupported legacy CNE document.');
      error.code = 'UNSUPPORTED_LEGACY_CNE_CONTENT';
      error.errors = validation.errors;
      throw error;
    }
    return documentValue.content.map((node) => (
      node.type === 'list_sequence'
        ? serializeLegacyListSequence(node)
        : serializeLegacyTextBlock(node)
    )).join('\n\n');
  }

  function legacyMigrationFailure(value, validation) {
    const errors = Array.isArray(validation?.errors) ? validation.errors : Object.freeze([]);
    return Object.freeze({
      ok: false,
      readOnly: true,
      legacy: true,
      error: validation?.error || 'Unsupported legacy CNE Text content.',
      errors,
      legacyEnvelope: cloneJson(value)
    });
  }

  function migrateLegacyEnvelope(value) {
    const persisted = validatePersistedEnvelope(value);
    if (!persisted.ok) {
      return Object.freeze({
        ok: false,
        readOnly: true,
        legacy: value?.schemaVersion === LEGACY_CNE_SCHEMA_VERSION
          || value?.schemaVersion === STRUCTURED_CNE_SCHEMA_VERSION,
        error: persisted.error || 'Invalid persisted HN Text content.',
        errors: persisted.errors,
        legacyEnvelope: value && typeof value === 'object' ? cloneJson(value) : value
      });
    }
    if (value.schemaVersion === HN_SCHEMA_VERSION) {
      const envelope = cloneJson(value);
      return Object.freeze({
        ok: true,
        readOnly: false,
        legacy: false,
        migrated: false,
        value: envelope,
        envelope
      });
    }
    const detailed = value.schemaVersion === LEGACY_CNE_SCHEMA_VERSION
      ? validateLegacyV1Envelope(value)
      : validateLegacyV2Envelope(value);
    if (!detailed.ok) return legacyMigrationFailure(value, detailed);
    let source;
    try {
      source = serializeLegacyDocumentToSource(value.document, {
        schemaVersion: value.schemaVersion
      });
    } catch (error) {
      return legacyMigrationFailure(value, {
        error: error.message,
        errors: Array.isArray(error.errors) ? error.errors : Object.freeze([
          Object.freeze({
            path: 'cneText.document',
            code: error.code || 'legacy-serialization',
            message: error.message
          })
        ])
      });
    }
    const envelope = {
      schemaVersion: HN_SCHEMA_VERSION,
      revision: value.revision,
      source,
      anchors: {}
    };
    return Object.freeze({
      ok: true,
      readOnly: false,
      legacy: true,
      migrated: true,
      legacySchemaVersion: value.schemaVersion,
      value: envelope,
      envelope
    });
  }

  const migratePersistedEnvelope = migrateLegacyEnvelope;

  function normalizeHnTextMode(value) {
    return HN_TEXT_MODE_SET.has(value) ? value : HN_TEXT_MODES.EDIT;
  }

  function validateHnTextMode(value) {
    if (!HN_TEXT_MODE_SET.has(value)) {
      return { ok: false, error: 'HN Text mode must be edit or browser.' };
    }
    return { ok: true, mode: value };
  }

  function normalizeSettings(value) {
    return {
      cneTextMode: normalizeHnTextMode(value?.cneTextMode)
    };
  }

  function validateSettings(value) {
    if (!isPlainRecord(value)) {
      return { ok: false, error: 'HN Text settings must be an object.' };
    }
    if (Object.hasOwn(value, 'cneTextMode')) {
      const validation = validateHnTextMode(value.cneTextMode);
      if (!validation.ok) return validation;
    }
    return { ok: true, settings: normalizeSettings(value) };
  }

  function isCanonicalEmptyDocument(value) {
    if (!validateDocument(value).ok) return false;
    if (value.content.length === 0) return true;
    if (value.content.length !== 1) return false;
    const [onlyBlock] = value.content;
    if (onlyBlock.type !== 'paragraph') return false;
    return !Object.hasOwn(onlyBlock, 'content')
      || (Array.isArray(onlyBlock.content) && onlyBlock.content.length === 0);
  }

  function isCanonicalEmptyEnvelope(value) {
    return validateCurrentEnvelope(value).ok
      && value.source === ''
      && Object.keys(value.anchors).length === 0;
  }

  function textualContent(value) {
    if (typeof value === 'string') return value;
    if (isPlainRecord(value) && typeof value.source === 'string') return value.source;
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'text' && typeof node.text === 'string') return node.text;
      if (!Array.isArray(node.content)) return '';
      const separator = node.type === 'doc'
        || node.type === 'list_sequence'
        || node.type === 'list_item'
        ? '\n' : '';
      return node.content.map(visit).join(separator);
    }
    return visit(value) || '';
  }

  function graphemes(value, locale = undefined) {
    const source = String(value ?? '');
    if (typeof Intl?.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
      return [...segmenter.segment(source)].map(({ segment }) => segment);
    }
    return Array.from(source);
  }

  function countTextGraphemes(documentValue, locale = undefined) {
    return graphemes(textualContent(documentValue), locale)
      .filter((segment) => !/^\s+$/u.test(segment)).length;
  }

  function statistics(documentValue) {
    const source = typeof documentValue === 'string'
      ? documentValue
      : typeof documentValue?.source === 'string' ? documentValue.source : null;
    if (source !== null) {
      const blocks = source.split(/(?:\r?\n){2,}/u);
      return structuredTextCountModel.statisticsFromTextBlocks(blocks);
    }
    const blocks = (Array.isArray(documentValue?.content) ? documentValue.content : [])
      .filter((node) => COUNT_ROOT_TYPE_SET.has(node?.type))
      .map((node) => textualContent(node));
    return structuredTextCountModel.statisticsFromTextBlocks(blocks);
  }

  function textFromUnknownNode(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    if (value.type === 'text' && typeof value.text === 'string') return value.text;
    return Array.isArray(value.content) ? value.content.map(textFromUnknownNode).join('') : '';
  }

  function sanitizedInlineContent(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    value.forEach((child) => {
      const text = textFromUnknownNode(child);
      if (!text) return;
      const allowedMarks = isPlainRecord(child) && Array.isArray(child.marks)
        ? child.marks.map((mark) => mark?.type).filter((type) => MARK_TYPE_SET.has(type))
        : [];
      const node = inlineText(text, allowedMarks);
      if (node) result.push(node);
    });
    return result;
  }

  function validPasteSequenceAttrs(attrs, itemCount) {
    if (!isPlainRecord(attrs) || !LIST_SCHEME_SET.has(attrs.scheme)
      || !Number.isSafeInteger(attrs.startOrdinal) || attrs.startOrdinal < 1) return false;
    const finalOrdinal = attrs.startOrdinal + (itemCount - 1);
    if (!Number.isSafeInteger(finalOrdinal)) return false;
    if (ROMAN_SCHEMES.has(attrs.scheme) && finalOrdinal > 3999) return false;
    if (attrs.scheme === hnListNumbering.SCHEMES.DOTTED_DECIMAL) {
      return Array.isArray(attrs.dottedPrefix)
        && attrs.dottedPrefix.length > 0
        && attrs.dottedPrefix.every((ordinal) => Number.isSafeInteger(ordinal) && ordinal > 0);
    }
    return !Object.hasOwn(attrs, 'dottedPrefix');
  }

  function isSupportedPastedListItem(value) {
    if (!isPlainRecord(value) || value.type !== 'list_item'
      || !Array.isArray(value.content) || value.content.length === 0) return false;
    let paragraphCount = 0;
    let childSequenceCount = 0;
    return value.content.every((child, index) => {
      if (isPlainRecord(child) && child.type === 'paragraph' && childSequenceCount === 0) {
        paragraphCount += 1;
        return true;
      }
      if (isPlainRecord(child) && child.type === 'list_sequence'
        && index === value.content.length - 1 && childSequenceCount === 0) {
        childSequenceCount += 1;
        return isSupportedPastedListSequence(child);
      }
      return false;
    }) && paragraphCount > 0;
  }

  function isSupportedPastedListSequence(value) {
    return isPlainRecord(value)
      && value.type === 'list_sequence'
      && Array.isArray(value.content)
      && value.content.length > 0
      && validPasteSequenceAttrs(value.attrs, value.content.length)
      && value.content.every(isSupportedPastedListItem);
  }

  function sanitizePastedParagraph(value, idFactory) {
    const inline = sanitizedInlineContent(value?.content);
    return {
      type: 'paragraph',
      attrs: { id: createBlockId(idFactory) },
      ...(inline.length ? { content: inline } : {})
    };
  }

  function sanitizePastedListItem(value, idFactory) {
    const paragraphs = [];
    let childSequence = null;
    value.content.forEach((child) => {
      if (child.type === 'paragraph') paragraphs.push(sanitizePastedParagraph(child, idFactory));
      else childSequence = sanitizePastedListSequence(child, idFactory);
    });
    return {
      type: 'list_item',
      attrs: { id: createBlockId(idFactory) },
      content: [...paragraphs, ...(childSequence ? [childSequence] : [])]
    };
  }

  function sanitizePastedListSequence(value, idFactory) {
    return {
      type: 'list_sequence',
      attrs: {
        id: createBlockId(idFactory),
        scheme: value.attrs.scheme,
        startOrdinal: value.attrs.startOrdinal,
        ...(value.attrs.scheme === hnListNumbering.SCHEMES.DOTTED_DECIMAL
          ? { dottedPrefix: [...value.attrs.dottedPrefix] } : {})
      },
      content: value.content.map((item) => sanitizePastedListItem(item, idFactory))
    };
  }

  function sanitizePastedDocument(value, { idFactory = null } = {}) {
    if (typeof value === 'string') {
      const lines = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
      return {
        type: 'doc',
        content: lines.map((line) => createParagraph(line, { idFactory }))
      };
    }
    const candidates = isPlainRecord(value) && value.type === 'doc' && Array.isArray(value.content)
      ? value.content : [];
    const blocks = candidates.map((candidate) => {
      if (isSupportedPastedListSequence(candidate)) {
        return sanitizePastedListSequence(candidate, idFactory);
      }
      const inline = sanitizedInlineContent(candidate?.content);
      if (candidate?.type === 'heading'
        && Number.isInteger(candidate?.attrs?.level)
        && candidate.attrs.level >= 1 && candidate.attrs.level <= 6) {
        return {
          type: 'heading',
          attrs: { id: createBlockId(idFactory), level: candidate.attrs.level },
          ...(inline.length ? { content: inline } : {})
        };
      }
      const fallbackText = inline.length ? inline : sanitizedInlineContent([candidate]);
      return {
        type: 'paragraph',
        attrs: { id: createBlockId(idFactory) },
        ...(fallbackText.length ? { content: fallbackText } : {})
      };
    });
    return { type: 'doc', content: blocks };
  }

  return Object.freeze({
    HN_PAGE_TYPE,
    LEGACY_CNE_SCHEMA_VERSION,
    STRUCTURED_CNE_SCHEMA_VERSION,
    HN_SCHEMA_VERSION,
    HN_TEXT_MODES,
    HN_TEXT_MODE_VALUES,
    DEFAULT_SETTINGS,
    BLOCK_ID_PATTERN,
    BLOCK_TYPES,
    LIST_NODE_TYPES,
    LIST_SCHEMES,
    MARK_TYPES,
    isPlainRecord,
    cloneJson,
    createBlockId,
    createEmptyDocument,
    createEmptyEnvelope,
    createParagraph,
    createHeading,
    createListItem,
    createListSequence,
    normalizeDocument,
    normalizeEnvelope,
    validateLegacyV1Envelope,
    validateLegacyV2Envelope,
    validateLegacyPersistedShape,
    validateDocument,
    validateCurrentEnvelope,
    validatePersistedEnvelope,
    validateEnvelope,
    escapeLegacyMarkdownText,
    serializeLegacyInline,
    serializeLegacyDocumentToSource,
    migrateLegacyEnvelope,
    migratePersistedEnvelope,
    normalizeHnTextMode,
    validateHnTextMode,
    normalizeSettings,
    validateSettings,
    isCanonicalEmptyDocument,
    isCanonicalEmptyEnvelope,
    textualContent,
    graphemes,
    countTextGraphemes,
    statistics,
    sanitizePastedDocument
  });
}));
