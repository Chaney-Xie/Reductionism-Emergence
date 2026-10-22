const path = require('node:path');

module.exports = {
  packagerConfig: {
    name: 'Reductionism & Emergence',
    executableName: 'Reductionism & Emergence',
    icon: path.resolve(__dirname, 'assets', 'reductionism-emergence.icns'),
    asar: true,
    ignore: [
      /^\/data(?:\/|$)/,
      /^\/assets(?:\/|$)/,
      /^\/(?:data|assets)\.legacy-backup(?:\/|$)/,
      /^\/test(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/backups?(?:\/|$)/,
      /^\/\.git(?:\/|$)/,
      /^\/\.codex(?:\/|$)/,
      /^\/(?:REFACTOR_REPORT|CLEANUP_REPORT|DESKTOP_MIGRATION_REPORT)\.md$/,
      /^\/交互及功能\.md$/
    ]
  },
  makers: [{
    name: '@electron-forge/maker-zip',
    platforms: ['darwin'],
    config: {}
  }]
};
