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
