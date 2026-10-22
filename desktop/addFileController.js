function validMutationBody(body) {
  return body && typeof body === 'object'
    && body.page && typeof body.page === 'object'
    && body.pageIndex && Array.isArray(body.pageIndex.pages)
    && Array.isArray(body.linked);
}

async function executeAddFiles({ pageId, selectedPaths, prepareFiles, requestMutation, source = 'picker', log = () => {} }) {
  if (!/^[a-z0-9_-]+$/i.test(pageId || '')) return { ok: false, error: 'A valid current page is required.' };
  let prepared;
  try {
    prepared = await prepareFiles({ selectedPaths });
  } catch (error) {
    log('prepare-failed', { source, code: error.code || null, error: error.message });
    return { ok: false, error: error.message || 'Could not prepare the selected files.' };
  }
  if (!prepared?.ok) return prepared || { ok: false, error: 'File selection failed.' };

  let mutation;
  try {
    mutation = await requestMutation(prepared.files);
  } catch (error) {
    await prepared.rollbackCopies?.().catch((rollbackError) => log('copy-rollback-failed', {
      error: rollbackError.message
    }));
    return { ok: false, error: 'Could not add files to this page.' };
  }
  if (!mutation?.ok) {
    await prepared.rollbackCopies?.().catch((rollbackError) => log('copy-rollback-failed', {
      error: rollbackError.message
    }));
    return { ok: false, error: mutation?.body?.error || 'Could not add files to this page.' };
  }
  if (!validMutationBody(mutation.body)) {
    return {
      ok: false,
      mutationSucceeded: true,
      error: 'Files were added, but the page could not be refreshed.'
    };
  }
  return { ok: true, mutationSucceeded: true, copiedCount: prepared.copiedCount, ...mutation.body };
}

module.exports = { executeAddFiles, validMutationBody };
