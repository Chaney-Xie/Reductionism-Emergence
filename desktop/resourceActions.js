function publicDesktopError(error) {
  return error?.message || 'The desktop resource operation failed.';
}

function createResourceActions({
  getVaultRoot,
  resolveResourcePath,
  openPath,
  revealPath,
  logger = console
}) {
  async function resolve(request, operation) {
    try {
      return await resolveResourcePath(getVaultRoot(), request);
    } catch (error) {
      logger.warn?.(`[desktop:${operation}] rejected resource path`, error);
      return { error: publicDesktopError(error) };
    }
  }

  function successfulResult(resolved) {
    return resolved.relocated
      ? {
        ok: true,
        relocated: true,
        location: resolved.location,
        previousLocation: resolved.previousLocation,
        updatedResourceIds: resolved.updatedResourceIds
      }
      : { ok: true };
  }

  async function openVaultResource(request) {
    const resolved = await resolve(request, 'open-resource');
    if (resolved.error) return { ok: false, error: resolved.error };
    try {
      const shellError = await openPath(resolved.absolutePath);
      if (shellError) {
        logger.error?.('[desktop:open-resource] default application failed', shellError);
        return { ok: false, error: 'No desktop application could open this resource.' };
      }
      return successfulResult(resolved);
    } catch (error) {
      logger.error?.('[desktop:open-resource] shell operation failed', error);
      return { ok: false, error: 'The resource could not be opened.' };
    }
  }

  async function revealVaultResource(request) {
    const resolved = await resolve(request, 'reveal-resource');
    if (resolved.error) return { ok: false, error: resolved.error };
    try {
      await revealPath(resolved.absolutePath);
      return successfulResult(resolved);
    } catch (error) {
      logger.error?.('[desktop:reveal-resource] Finder operation failed', error);
      return { ok: false, error: 'The resource could not be revealed in Finder.' };
    }
  }

  return { openVaultResource, revealVaultResource };
}

module.exports = { createResourceActions, publicDesktopError };
