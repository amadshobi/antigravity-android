/**
 * extensions/public_api.js - Expose window.AGY Extension API.
 *
 * Final fragment of extensions/extension_host.js bundle.
 */

var AGY = {
  version: VERSION,
  plugins: {
    register: registerPlugin,
    get: getPlugin,
    list: listPlugins,
    loadScript: loadExtensionScript
  },
  ui: {
    injectCSS: injectCSS,
    registerHeaderAction: registerHeaderAction,
    registerStatusIndicator: registerStatusIndicator,
    waitForElement: waitForElement,
    observeContainer: observeContainer
  },
  events: {
    on: on,
    off: off,
    emit: emit
  }
};

window.AGY = AGY;

// Initialize built-in extensions
try {
  if (typeof initDesktopModeExtension === 'function') {
    initDesktopModeExtension();
  }
} catch (e) {
  warn('initBuiltins', e);
}

log('Extension Host ready (v' + VERSION + ')');
