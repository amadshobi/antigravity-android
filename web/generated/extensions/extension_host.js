(function(){
/**
 * extensions/namespace.js - Antigravity Extension Host Scope.
 *
 * Runs first in the extensions/extension_host.js bundle IIFE.
 * Establishes the global `window.AGY` API and the Extension Host lifecycle.
 */
'use strict';

if (window.__AGY_EXTENSION_HOST__) return;
window.__AGY_EXTENSION_HOST__ = true;

var VERSION = '2.0.0';
var global = window;

function log(msg, extra) {
  try {
    if (extra !== undefined) {
      console.log('[AGY ExtHost] ' + msg, extra);
    } else {
      console.log('[AGY ExtHost] ' + msg);
    }
  } catch (e) {}
}

function warn(where, err) {
  try {
    console.warn('[AGY ExtHost] ' + where + ':', err && err.message ? err.message : err);
  } catch (e) {}
}

function error(where, err) {
  try {
    console.error('[AGY ExtHost] ' + where + ':', err && err.message ? err.message : err);
  } catch (e) {}
}

/**
 * extensions/dom_hook.js - Resilient DOM observers and insertion points.
 *
 * Provides mutation-resistant injection helpers for custom headers, buttons,
 * sidebars, and status elements even when React re-renders or routes pages.
 */

var _domObservers = [];

function waitForElement(selector, callback, timeoutMs) {
  var existing = document.querySelector(selector);
  if (existing) {
    try { callback(existing); } catch (e) { error('waitForElement callback', e); }
    return function() {};
  }

  var timeout = timeoutMs || 15000;
  var timer = null;
  var observer = new MutationObserver(function() {
    var el = document.querySelector(selector);
    if (el) {
      if (timer) clearTimeout(timer);
      observer.disconnect();
      try { callback(el); } catch (e) { error('waitForElement callback', e); }
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  timer = setTimeout(function() {
    observer.disconnect();
  }, timeout);

  return function() {
    if (timer) clearTimeout(timer);
    observer.disconnect();
  };
}

function observeContainer(selector, onMount) {
  var currentContainer = null;
  var cleanupCurrent = null;

  function check() {
    var el = document.querySelector(selector);
    if (el && el !== currentContainer) {
      if (cleanupCurrent) {
        try { cleanupCurrent(); } catch (e) {}
      }
      currentContainer = el;
      try {
        cleanupCurrent = onMount(el);
      } catch (e) {
        error('observeContainer mount', e);
      }
    }
  }

  var observer = new MutationObserver(check);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
  check();

  return function() {
    observer.disconnect();
    if (cleanupCurrent) {
      try { cleanupCurrent(); } catch (e) {}
    }
  };
}

/**
 * extensions/ui_registry.js - UI Component and Style Injection Engine.
 *
 * Allows extensions to cleanly mount custom header buttons, sidebar panels,
 * status bar pills, and inject custom CSS themes without modifying React JSX.
 */

var _headerContainer = null;
var _statusContainer = null;
var _headerAnchorEl = null;
var _headerRepositionQueued = false;
var _headerWatcherBound = false;

// The app header is `calc(40px + env(safe-area-inset-top))` tall and keeps its
// settings button at the far right, so a fixed top-right overlay would cover it
// (visually and for taps). Dock to the left of that button instead.
var HEADER_ANCHOR_SELECTORS = [
  '[data-testid="mobile-open-settings"]',
  '[data-testid="settings-button"]'
];
var HEADER_EDGE_GAP = 12;
var HEADER_ANCHOR_GAP = 8;
var HEADER_FALLBACK_TOP = 'calc(env(safe-area-inset-top, 0px) + 48px)';

function injectCSS(id, cssContent) {
  var styleId = 'agy-ext-style-' + id;
  var existing = document.getElementById(styleId);
  if (!existing) {
    existing = document.createElement('style');
    existing.id = styleId;
    existing.setAttribute('data-agy-extension', id);
    (document.head || document.documentElement).appendChild(existing);
  }
  existing.textContent = cssContent;

  return function() {
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  };
}

function findHeaderAnchor() {
  for (var i = 0; i < HEADER_ANCHOR_SELECTORS.length; i++) {
    var el = document.querySelector(HEADER_ANCHOR_SELECTORS[i]);
    if (el) return el;
  }
  return null;
}

function positionHeaderContainer() {
  var container = _headerContainer;
  if (!container || !container.parentNode) return;

  var anchor = findHeaderAnchor();
  var viewport = window.innerWidth
    || (document.documentElement && document.documentElement.clientWidth)
    || 0;

  if (anchor && typeof anchor.getBoundingClientRect === 'function') {
    var rect = anchor.getBoundingClientRect();
    // Dock left of the whole top-right button cluster, not just the settings
    // button, so sibling header controls are not covered either.
    var cluster = anchor.parentElement;
    if (cluster && typeof cluster.getBoundingClientRect === 'function') {
      var clusterRect = cluster.getBoundingClientRect();
      if (clusterRect && clusterRect.width > 0 && clusterRect.height > 0
        && clusterRect.width < viewport * 0.6) {
        rect = clusterRect;
      }
    }

    // Only accept a header control in the top-right quadrant. The desktop
    // sidebar also carries a `settings-button`, which must not drag the bar
    // into the sidebar.
    var inHeader = rect && rect.width > 0 && rect.height > 0
      && rect.top < 80
      && rect.left > viewport * 0.5;
    if (inHeader) {
      var right = Math.max(HEADER_EDGE_GAP, viewport - rect.left + HEADER_ANCHOR_GAP);
      container.style.top = Math.round(rect.top + rect.height / 2) + 'px';
      container.style.right = Math.round(right) + 'px';
      container.style.transform = 'translateY(-50%)';
      return;
    }
  }

  // Settings button is not mounted on this screen: sit below the app header
  // rather than covering it.
  container.style.top = HEADER_FALLBACK_TOP;
  container.style.right = HEADER_EDGE_GAP + 'px';
  container.style.transform = 'none';
}

function queueHeaderPosition() {
  if (_headerRepositionQueued) return;
  _headerRepositionQueued = true;

  var schedule = window.requestAnimationFrame || function(cb) { return setTimeout(cb, 16); };
  schedule(function() {
    _headerRepositionQueued = false;
    positionHeaderContainer();
  });
}

function watchHeaderLayout() {
  if (_headerWatcherBound) {
    queueHeaderPosition();
    return;
  }
  _headerWatcherBound = true;

  window.addEventListener('resize', queueHeaderPosition);
  window.addEventListener('orientationchange', queueHeaderPosition);
  if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
    window.visualViewport.addEventListener('resize', queueHeaderPosition);
  }

  // React re-mounts the header on route changes; reposition only when the
  // anchor element itself changes so streaming re-renders stay cheap.
  if (typeof MutationObserver === 'function' && document.body) {
    var observer = new MutationObserver(function() {
      var anchor = findHeaderAnchor();
      if (anchor === _headerAnchorEl) return;
      _headerAnchorEl = anchor;
      queueHeaderPosition();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  _headerAnchorEl = findHeaderAnchor();
  queueHeaderPosition();
}

function ensureHeaderContainer() {
  if (_headerContainer && document.body.contains(_headerContainer)) {
    return _headerContainer;
  }
  _headerContainer = document.getElementById('agy-header-actions-bar');
  if (!_headerContainer) {
    _headerContainer = document.createElement('div');
    _headerContainer.id = 'agy-header-actions-bar';
    _headerContainer.className = 'agy-ext-header-actions flex items-center gap-1.5 z-50';
    _headerContainer.style.cssText = 'position:fixed;top:8px;right:12px;display:flex;align-items:center;gap:6px;z-index:9999;pointer-events:none;';
    document.body.appendChild(_headerContainer);
  }
  watchHeaderLayout();
  return _headerContainer;
}

function ensureStatusContainer() {
  if (_statusContainer && document.body.contains(_statusContainer)) {
    return _statusContainer;
  }
  _statusContainer = document.getElementById('agy-status-bar');
  if (!_statusContainer) {
    _statusContainer = document.createElement('div');
    _statusContainer.id = 'agy-status-bar';
    _statusContainer.className = 'agy-ext-status-bar flex items-center gap-1.5 z-40';
    // No full-width dark strip: that covered the app's input row. Transparent
    // cluster whose pills own their background and pointer events.
    _statusContainer.style.cssText = 'position:fixed;left:12px;bottom:calc(env(safe-area-inset-bottom, 0px) + var(--agy-status-offset, 8px));display:flex;align-items:center;flex-wrap:wrap;gap:6px;max-width:calc(100vw - 24px);background:transparent;border:none;color:#94a3b8;z-index:9998;pointer-events:none;';
    document.body.appendChild(_statusContainer);
  }
  return _statusContainer;
}

function registerHeaderAction(options) {
  if (!options || !options.id) {
    warn('registerHeaderAction', 'Missing action id');
    return function() {};
  }

  var actionId = options.id;
  var label = options.title || actionId;
  var btn = document.createElement('button');
  btn.id = 'agy-action-' + actionId;
  btn.className = 'agy-action-btn p-1.5 rounded-md hover:bg-white/10 active:scale-95 transition-all text-slate-300 hover:text-white';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.type = 'button';
  btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;color:#cbd5e1;pointer-events:auto;';

  if (typeof options.icon === 'string') {
    if (options.icon.trim().startsWith('<svg')) {
      btn.innerHTML = options.icon;
    } else {
      btn.textContent = options.icon;
    }
  } else if (options.title) {
    btn.textContent = options.title;
  }

  if (typeof options.onClick === 'function') {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      try {
        options.onClick(e);
      } catch (err) {
        error('headerAction onClick (' + actionId + ')', err);
      }
    });
  }

  var container = ensureHeaderContainer();
  container.appendChild(btn);

  return function() {
    if (btn && btn.parentNode) {
      btn.parentNode.removeChild(btn);
    }
  };
}

function registerStatusIndicator(options) {
  if (!options || !options.id) {
    warn('registerStatusIndicator', 'Missing indicator id');
    return { update: function() {}, remove: function() {} };
  }

  var clickable = typeof options.onClick === 'function';
  var pill = document.createElement('div');
  pill.id = 'agy-status-pill-' + options.id;
  pill.className = 'agy-status-pill flex items-center gap-1 font-mono text-[11px]';
  pill.style.cssText = 'pointer-events:auto;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:999px;';
  pill.setAttribute('role', clickable ? 'button' : 'status');

  if (typeof options.content === 'string') {
    pill.textContent = options.content;
    if (!options.title) pill.setAttribute('aria-label', options.content);
  } else if (options.content instanceof HTMLElement) {
    pill.appendChild(options.content);
  }
  if (options.title) {
    pill.title = options.title;
    pill.setAttribute('aria-label', options.title);
  }

  if (clickable) {
    pill.tabIndex = 0;
    pill.style.cursor = 'pointer';
    pill.addEventListener('click', function(e) {
      try { options.onClick(e); } catch (err) { error('statusIndicator onClick', err); }
    });
    pill.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      try { options.onClick(e); } catch (err) { error('statusIndicator onClick', err); }
    });
  }

  var container = ensureStatusContainer();
  container.appendChild(pill);

  return {
    update: function(newContent) {
      if (typeof newContent === 'string') {
        pill.textContent = newContent;
        if (!options.title) pill.setAttribute('aria-label', newContent);
      } else if (newContent instanceof HTMLElement) {
        pill.innerHTML = '';
        pill.appendChild(newContent);
      }
    },
    remove: function() {
      if (pill && pill.parentNode) {
        pill.parentNode.removeChild(pill);
      }
    }
  };
}

/**
 * extensions/event_bus.js - Client-side Pub/Sub Event System.
 *
 * Dispatches UI, theme, stream, and tool events to registered extension listeners.
 */

var _listeners = {};
var _lastTheme = null;

function on(event, handler) {
  if (typeof handler !== 'function') return function() {};
  if (!_listeners[event]) {
    _listeners[event] = [];
  }
  _listeners[event].push(handler);

  return function() {
    off(event, handler);
  };
}

function off(event, handler) {
  if (!_listeners[event]) return;
  _listeners[event] = _listeners[event].filter(function(h) {
    return h !== handler;
  });
}

function emit(event, payload) {
  if (!_listeners[event] || !_listeners[event].length) return;
  var handlers = _listeners[event].slice();
  for (var i = 0; i < handlers.length; i++) {
    try {
      handlers[i](payload);
    } catch (e) {
      error('emit handler (' + event + ')', e);
    }
  }
}

// Emits themeChange only when the resolved theme actually changes.
function emitTheme(value) {
  if (!value || value === _lastTheme) return;
  _lastTheme = value;
  emit('themeChange', value);
}

// Wire system theme notifications to extensions
window.addEventListener('agy:theme-change', function(e) {
  emitTheme(e && e.detail ? e.detail : 'system');
});

// Observe HTML theme attribute changes
if (window.MutationObserver) {
  var htmlObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === 'class' || mutations[i].attributeName === 'data-theme') {
        var isDark = document.documentElement.classList.contains('dark');
        emitTheme(isDark ? 'dark' : 'light');
      }
    }
  });
  htmlObserver.observe(document.documentElement, { attributes: true });
}

/**
 * extensions/plugin_loader.js - Plugin Lifecycle and Activation Engine.
 *
 * Manages plugin registration, activation contexts, isolated storage,
 * and dynamic script loading for third-party extensions.
 */

var _plugins = {};

function createPluginStorage(pluginId) {
  var prefix = 'agy_ext_' + pluginId + '_';
  return {
    get: function(key, defaultVal) {
      try {
        var raw = localStorage.getItem(prefix + key);
        if (raw === null) return defaultVal;
        return JSON.parse(raw);
      } catch (e) {
        return defaultVal;
      }
    },
    set: function(key, val) {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(val));
      } catch (e) {
        warn('storage.set', e);
      }
    },
    remove: function(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch (e) {}
    }
  };
}

function runDisposers(disposers) {
  for (var i = disposers.length - 1; i >= 0; i--) {
    try {
      if (typeof disposers[i] === 'function') disposers[i]();
    } catch (e) {
      warn('plugin dispose', e);
    }
  }
  disposers.length = 0;
}

function registerPlugin(id, definition) {
  if (!id || typeof id !== 'string') {
    error('registerPlugin', 'Invalid plugin id');
    return false;
  }
  if (!definition || typeof definition.activate !== 'function') {
    error('registerPlugin', 'Plugin ' + id + ' must provide an activate(context) function');
    return false;
  }

  if (_plugins[id]) {
    log('Plugin already registered, reloading: ' + id);
    if (typeof _plugins[id].deactivate === 'function') {
      try { _plugins[id].deactivate(); } catch (e) { warn('deactivate', e); }
    }
    runDisposers(_plugins[id].disposers);
  }

  var disposers = [];

  var context = {
    id: id,
    name: definition.name || id,
    version: definition.version || '1.0.0',
    storage: createPluginStorage(id),
    ui: {
      injectCSS: function(cssId, content) {
        var dispose = injectCSS(id + '_' + cssId, content);
        disposers.push(dispose);
        return dispose;
      },
      registerHeaderAction: function(options) {
        var dispose = registerHeaderAction(options);
        disposers.push(dispose);
        return dispose;
      },
      registerStatusIndicator: function(options) {
        var indicator = registerStatusIndicator(options);
        disposers.push(function() { indicator.remove(); });
        return indicator;
      },
      waitForElement: function(selector, callback, timeoutMs) {
        var dispose = waitForElement(selector, callback, timeoutMs);
        disposers.push(dispose);
        return dispose;
      },
      observeContainer: function(selector, onMount) {
        var dispose = observeContainer(selector, onMount);
        disposers.push(dispose);
        return dispose;
      }
    },
    events: {
      on: function(event, handler) {
        var dispose = on(event, handler);
        disposers.push(dispose);
        return dispose;
      },
      off: off,
      emit: emit
    }
  };

  try {
    definition.activate(context);
    _plugins[id] = {
      id: id,
      name: definition.name || id,
      version: definition.version || '1.0.0',
      definition: definition,
      deactivate: definition.deactivate,
      disposers: disposers
    };
    log('Plugin activated: ' + id + ' (v' + (definition.version || '1.0.0') + ')');
    emit('pluginActivated', { id: id });
    return true;
  } catch (err) {
    runDisposers(disposers);
    error('activate plugin ' + id, err);
    return false;
  }
}

function getPlugin(id) {
  return _plugins[id];
}

function listPlugins() {
  var list = [];
  for (var k in _plugins) {
    if (_plugins.hasOwnProperty(k)) {
      list.push({
        id: _plugins[k].id,
        name: _plugins[k].name,
        version: _plugins[k].version
      });
    }
  }
  return list;
}

function loadExtensionScript(url, onLoad, onError) {
  var s = document.createElement('script');
  s.src = url;
  s.async = true;
  s.onload = function() {
    log('Extension script loaded: ' + url);
    if (typeof onLoad === 'function') onLoad();
  };
  s.onerror = function(e) {
    error('Extension script failed: ' + url, e);
    if (typeof onError === 'function') onError(e);
  };
  document.head.appendChild(s);
}

/**
 * extensions/builtins/desktop_mode.js - Built-in Desktop Mode Extension.
 *
 * Quick-access desktop/mobile viewport toggle in the global header, wired to the
 * same state as the Appearance settings switch (window.Android Desktop Mode bridge
 * + the `ag_desktop_mode` localStorage key). The settings switch is still injected
 * into main.js by web/patch_main.py; this builtin only adds a second, always-visible
 * entry point, so both controls must keep sharing one source of truth.
 */

function initDesktopModeExtension() {
  registerPlugin('builtin-desktop-mode', {
    name: 'Desktop View Mode',
    version: '1.0.0',
    activate: function(ctx) {
      function getDesktopState() {
        try {
          if (window.Android && typeof window.Android.isDesktopMode === 'function') {
            return window.Android.isDesktopMode();
          }
          var s = localStorage.getItem('ag_desktop_mode');
          return s === 'true';
        } catch (_) {
          return false;
        }
      }

      function applyDesktopState(enabled) {
        try {
          localStorage.setItem('ag_desktop_mode', String(enabled));
          if (window.Android && typeof window.Android.setDesktopMode === 'function') {
            window.Android.setDesktopMode(enabled);
          }
        } catch (_) {}
      }

      var isDesktop = getDesktopState();

      var desktopSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
      var mobileSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';

      ctx.ui.registerHeaderAction({
        id: 'desktop-mode-toggle',
        title: isDesktop ? 'Desktop Mode: ON (Click for Mobile)' : 'Desktop Mode: OFF (Click for Desktop)',
        icon: isDesktop ? desktopSvg : mobileSvg,
        onClick: function() {
          isDesktop = !isDesktop;
          applyDesktopState(isDesktop);
          var btn = document.getElementById('agy-action-desktop-mode-toggle');
          if (btn) {
            btn.innerHTML = isDesktop ? desktopSvg : mobileSvg;
            btn.title = isDesktop ? 'Desktop Mode: ON (Click for Mobile)' : 'Desktop Mode: OFF (Click for Desktop)';
          }
        }
      });
    }
  });
}

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


})();
