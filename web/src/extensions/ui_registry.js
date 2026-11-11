/**
 * extensions/ui_registry.js - UI Component and Style Injection Engine.
 *
 * Allows extensions to cleanly mount custom header buttons, sidebar panels,
 * status bar pills, and inject custom CSS themes without modifying React JSX.
 */

var _injectedStyles = {};
var _headerActions = [];
var _statusIndicators = [];
var _headerContainer = null;
var _statusContainer = null;

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
  _injectedStyles[id] = existing;

  return function() {
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    delete _injectedStyles[id];
  };
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
    _headerContainer.style.cssText = 'position:fixed;top:8px;right:12px;display:flex;align-items:center;gap:6px;z-index:9999;pointer-events:auto;';
    document.body.appendChild(_headerContainer);
  }
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
    _statusContainer.className = 'agy-ext-status-bar flex items-center justify-between px-3 text-xs z-40';
    _statusContainer.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:24px;display:flex;align-items:center;justify-content:space-between;background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);border-top:1px solid rgba(255,255,255,0.08);color:#94a3b8;z-index:9998;pointer-events:auto;';
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
  var btn = document.createElement('button');
  btn.id = 'agy-action-' + actionId;
  btn.className = 'agy-action-btn p-1.5 rounded-md hover:bg-white/10 active:scale-95 transition-all text-slate-300 hover:text-white';
  btn.title = options.title || actionId;
  btn.type = 'button';
  btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;color:#cbd5e1;';

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

  _headerActions.push({ id: actionId, element: btn });

  return function() {
    if (btn && btn.parentNode) {
      btn.parentNode.removeChild(btn);
    }
    _headerActions = _headerActions.filter(function(a) { return a.id !== actionId; });
  };
}

function registerStatusIndicator(options) {
  if (!options || !options.id) {
    warn('registerStatusIndicator', 'Missing indicator id');
    return function() {};
  }

  var pill = document.createElement('div');
  pill.id = 'agy-status-pill-' + options.id;
  pill.className = 'agy-status-pill px-2 py-0.5 flex items-center gap-1 font-mono text-[11px]';

  if (typeof options.content === 'string') {
    pill.textContent = options.content;
  } else if (options.content instanceof HTMLElement) {
    pill.appendChild(options.content);
  }

  if (typeof options.onClick === 'function') {
    pill.style.cursor = 'pointer';
    pill.addEventListener('click', function(e) {
      try { options.onClick(e); } catch (err) { error('statusIndicator onClick', err); }
    });
  }

  var container = ensureStatusContainer();
  container.appendChild(pill);
  _statusIndicators.push({ id: options.id, element: pill });

  return {
    update: function(newContent) {
      if (typeof newContent === 'string') {
        pill.textContent = newContent;
      } else if (newContent instanceof HTMLElement) {
        pill.innerHTML = '';
        pill.appendChild(newContent);
      }
    },
    remove: function() {
      if (pill && pill.parentNode) {
        pill.parentNode.removeChild(pill);
      }
      _statusIndicators = _statusIndicators.filter(function(s) { return s.id !== options.id; });
    }
  };
}
