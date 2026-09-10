// Windows-only test distribution of the selective-Todoist fork.
// Preserve the official 5.0 app identity and profile for an in-place update.
// No signing secrets and no release publishing are used by this configuration.
const base = require('./electron-builder.config.cjs');

module.exports = {
  ...base,
  appId: 'com.dayglance.app',
  productName: 'dayGLANCE',
  buildVersion: '5.0.0.1',
  publish: null,
  directories: { ...base.directories, output: 'dist-todoist-windows' },
  win: {
    ...base.win,
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'dayGLANCE-5.0.0-Todoist-Windows-${arch}-Setup.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
    installerLanguages: ['en_US', 'zh_CN'],
    displayLanguageSelector: true,
    uninstallDisplayName: 'dayGLANCE (Todoist test build)',
  },
};
