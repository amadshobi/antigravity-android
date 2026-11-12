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
