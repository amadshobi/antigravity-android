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
