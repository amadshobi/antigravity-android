/**
 * extensions/event_bus.js - Client-side Pub/Sub Event System.
 *
 * Dispatches UI, theme, stream, and tool events to registered extension listeners.
 */

var _listeners = {};

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

// Wire system theme notifications to extensions
window.addEventListener('agy:theme-change', function(e) {
  emit('themeChange', e && e.detail ? e.detail : 'system');
});

// Observe HTML theme attribute changes
if (window.MutationObserver) {
  var htmlObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === 'class' || mutations[i].attributeName === 'data-theme') {
        var isDark = document.documentElement.classList.contains('dark');
        emit('themeChange', isDark ? 'dark' : 'light');
      }
    }
  });
  htmlObserver.observe(document.documentElement, { attributes: true });
}
