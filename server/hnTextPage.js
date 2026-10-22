const hnTextModel = require('../public/hnText');

const STALE_CNE_REVISION = 'STALE_CNE_REVISION';

function firstValidationMessage(validation, fallback) {
  const first = Array.isArray(validation?.errors) ? validation.errors[0] : null;
  return typeof first?.message === 'string' && first.message
    ? first.message
    : fallback;
}

function invalidSave(error, details = {}) {
  return {
    ok: false,
    status: 400,
    error,
    ...details
  };
}

function validationDetails(validation) {
  return Array.isArray(validation?.errors) && validation.errors.length
    ? { errors: hnTextModel.cloneJson(validation.errors) }
    : {};
}

function planHnTextRevisionSave(currentEnvelope, candidateEnvelope, baseRevision) {
  const currentValidation = hnTextModel.validatePersistedEnvelope(currentEnvelope);
  if (!currentValidation.ok) {
    return {
      ok: false,
      status: 422,
      error: firstValidationMessage(
        currentValidation,
        'The stored HN Text document is invalid.'
      ),
      ...validationDetails(currentValidation)
    };
  }

  let preparedCurrentEnvelope = hnTextModel.normalizeEnvelope(currentEnvelope);
  if (currentEnvelope.schemaVersion !== hnTextModel.HN_SCHEMA_VERSION) {
    const migration = hnTextModel.migrateLegacyEnvelope(currentEnvelope);
    if (!migration.ok) {
      return {
        ok: false,
        status: 422,
        error: migration.error || firstValidationMessage(
          migration,
          'The stored HN Text document cannot be migrated safely.'
        ),
        ...(migration.readOnly === true ? { readOnly: true } : {}),
        ...validationDetails(migration)
      };
    }
    preparedCurrentEnvelope = migration.value;
  }

  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    return invalidSave('baseRevision must be a non-negative safe integer.');
  }

  const currentRevision = currentEnvelope.revision;
  if (baseRevision !== currentRevision) {
    return {
      ok: false,
      status: 409,
      code: STALE_CNE_REVISION,
      error: 'The HN Text document changed before this save was applied.',
      baseRevision,
      currentRevision
    };
  }

  const candidateValidation = hnTextModel.validateCurrentEnvelope(candidateEnvelope);
  if (!candidateValidation.ok) {
    return invalidSave(firstValidationMessage(
      candidateValidation,
      'The HN Text document is invalid.'
    ), validationDetails(candidateValidation));
  }

  if (candidateEnvelope.revision !== baseRevision) {
    return invalidSave('cneText.revision must equal baseRevision.');
  }

  if (candidateEnvelope.schemaVersion !== preparedCurrentEnvelope.schemaVersion) {
    return invalidSave('cneText schemaVersion cannot downgrade or skip a migration.');
  }

  if (baseRevision === Number.MAX_SAFE_INTEGER) {
    return invalidSave('The HN Text revision cannot be incremented safely.');
  }

  const normalized = hnTextModel.normalizeEnvelope(candidateEnvelope);
  return {
    ok: true,
    value: {
      ...normalized,
      revision: baseRevision + 1
    },
    previousRevision: baseRevision,
    revision: baseRevision + 1
  };
}

module.exports = {
  STALE_CNE_REVISION,
  planHnTextRevisionSave
};
