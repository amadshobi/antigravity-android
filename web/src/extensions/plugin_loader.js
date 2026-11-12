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
