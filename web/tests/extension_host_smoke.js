#!/usr/bin/env node
/**
 * extension_host_smoke.js - Headless behavioural smoke test for the AGY Extension Host.
 *
 * Loads the generated bundle in a vm sandbox with a minimal DOM stub and exercises
 * the public API: plugin registration/reload cleanup, CSS injection, header actions,
 * status indicators and accessibility attributes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BUNDLE = path.join(__dirname, '..', 'generated', 'extensions', 'extension_host.js');
const assert = require('assert');

if (!fs.existsSync(BUNDLE)) {
  console.error('FAIL: extension_host.js missing at ' + BUNDLE);
  process.exit(1);
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.parentNode = null;
    this.textContent = '';
    this.innerHTML = '';
    this.id = '';
    this.className = '';
    this.title = '';
    this.tabIndex = -1;
    this.type = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  dispatch(type, event) {
    (this.listeners[type] || []).forEach((handler) => handler(event || {}));
  }
}

function createSandbox() {
  const documentElement = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const store = new Map();

  const findElement = (root, id) => {
    if (root.id === id) return root;
    for (const child of root.children) {
      const found = findElement(child, id);
      if (found) return found;
    }
    return null;
  };

  const document = {
    documentElement,
    head,
    body,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => findElement(documentElement, id),
    querySelector: () => null,
  };

  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    HTMLElement: FakeElement,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (timer) => clearTimeout(timer),
    _elements: { head, body, documentElement },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  return sandbox;
}

function loadHost() {
  const code = fs.readFileSync(BUNDLE, 'utf8');
  const sandbox = createSandbox();
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'extension_host.js' });
  return sandbox;
}

function findById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  [OK] ' + name);
  } catch (error) {
    failures += 1;
    console.error('  [FAIL] ' + name + ': ' + error.message);
  }
}

console.log('=== Extension Host behavioural smoke test ===');

const sandbox = loadHost();
const api = sandbox.window.AGY;

check('window.AGY is exposed with a version', () => {
  assert.ok(api && typeof api === 'object', 'window.AGY missing');
  assert.strictEqual(api.version, '2.0.0');
});

check('plugins.register activates a valid plugin', () => {
  let activatedId = null;
  const ok = api.plugins.register('smoke-plugin', {
    name: 'Smoke',
    activate: (ctx) => { activatedId = ctx.id; },
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(activatedId, 'smoke-plugin');
  assert.strictEqual(api.plugins.list().map((p) => p.id).sort().join(','), 'builtin-desktop-mode,smoke-plugin');
});

check('plugins.register rejects invalid definitions', () => {
  assert.strictEqual(api.plugins.register('', { activate() {} }), false);
  assert.strictEqual(api.plugins.register('broken', {}), false);
  assert.strictEqual(api.plugins.get('broken'), undefined);
});

check('re-registering a plugin disposes its previous UI', () => {
  const register = () => api.plugins.register('ui-plugin', {
    activate: (ctx) => {
      ctx.ui.injectCSS('theme', '.agy-ext-status-bar{color:red}');
      ctx.ui.registerHeaderAction({ id: 'ui-plugin-action', title: 'UI', icon: 'x', onClick() {} });
    },
  });
  register();
  register();
  const headerBar = findById(sandbox._elements.body, 'agy-header-actions-bar');
  const actions = headerBar.children.filter((c) => c.id === 'agy-action-ui-plugin-action');
  assert.strictEqual(actions.length, 1, 'expected exactly one header action after reload');
  const styles = sandbox._elements.head.children.filter((c) => c.id === 'agy-ext-style-ui-plugin_theme');
  assert.strictEqual(styles.length, 1, 'expected exactly one injected style after reload');
});

check('header actions expose an accessible name', () => {
  const btn = findById(sandbox._elements.body, 'agy-action-ui-plugin-action');
  assert.strictEqual(btn.getAttribute('aria-label'), 'UI');
  assert.strictEqual(btn.type, 'button');
});

check('status indicators are keyboard accessible when clickable', () => {
  let clicks = 0;
  let indicator = null;
  api.plugins.register('status-plugin', {
    activate: (ctx) => {
      indicator = ctx.ui.registerStatusIndicator({ id: 'status', content: 'ready', onClick: () => { clicks += 1; } });
    },
  });
  const pill = findById(sandbox._elements.body, 'agy-status-pill-status');
  assert.strictEqual(pill.getAttribute('role'), 'button');
  assert.strictEqual(pill.tabIndex, 0);
  pill.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.strictEqual(clicks, 1, 'Enter must trigger the indicator action');
  indicator.update('busy');
  assert.strictEqual(pill.textContent, 'busy');
});

check('a plugin that throws during activate leaves no UI behind', () => {
  const ok = api.plugins.register('throwing', {
    activate: (ctx) => {
      ctx.ui.registerHeaderAction({ id: 'throwing-action', title: 'Throwing' });
      throw new Error('boom');
    },
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(findById(sandbox._elements.body, 'agy-action-throwing-action'), null);
});

console.log(failures === 0 ? '=== ALL SMOKE TESTS PASSED ===' : '=== ' + failures + ' SMOKE TEST(S) FAILED ===');
process.exit(failures === 0 ? 0 : 1);
