if (require.main === module) {
  const { applicationDataRoot, ensureCurrentVault } = require('./server/vaultContext');
  const { createVaultServerContext } = require('./server/appServer');
  (async () => {
    const vault = await ensureCurrentVault({
      appDataRoot: applicationDataRoot(),
      legacyRoot: __dirname
    });
    const context = createVaultServerContext({
      appRoot: __dirname,
      vaultId: vault.vaultId,
      vaultRoot: vault.vaultRoot
    });
    await context.start({ port: process.env.PORT || 3000 });
  })().catch((error) => {
    console.error('Could not start Viewer server:', error);
    process.exit(1);
  });
}

if (require.main !== module) module.exports = require('./server/appServer');
