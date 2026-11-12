#!/usr/bin/env python3
"""
test_plugin_router.py - Unit tests for PluginRouter and runtime plugin hooks.

Covers discovery, event filtering, the opt-in trust gates, path containment,
timeout cleanup and handler re-attachment.
"""
import unittest
import os
import sys
import json
import io
import time
import tempfile
import shutil
from contextlib import redirect_stderr

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
IO_ROOT = os.path.dirname(TESTS_DIR)
sys.path.insert(0, os.path.join(IO_ROOT, "core_bus"))

import envelope
from event_broker import EventBroker
import plugin_router
from plugin_router import PluginRouter

ENV_KEYS = ("AGY_ENABLE_PLUGINS", "AGY_PLUGINS_ALLOW_WORKSPACE", "HOME", "USERPROFILE")


class TestPluginRouter(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.old_env = {key: os.environ.get(key) for key in ENV_KEYS}
        self.old_cwd = os.getcwd()
        # Isolate discovery: point HOME at the sandbox so real plugins never leak in.
        os.environ["HOME"] = self.tmp_dir
        os.environ["USERPROFILE"] = self.tmp_dir
        os.environ["AGY_ENABLE_PLUGINS"] = "1"
        os.environ.pop("AGY_PLUGINS_ALLOW_WORKSPACE", None)

    def tearDown(self):
        os.chdir(self.old_cwd)
        for key, value in self.old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _write_plugin(self, name, manifest, hook_source, root=None):
        root = root or self.tmp_dir
        plugin_dir = os.path.join(root, name)
        os.makedirs(plugin_dir, exist_ok=True)
        with open(os.path.join(plugin_dir, "plugin.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with open(os.path.join(plugin_dir, "hook.py"), "w", encoding="utf-8") as f:
            f.write(hook_source)
        return plugin_dir

    def _log_hook(self, log_path):
        return (
            "import sys, json\n"
            "data = json.load(sys.stdin)\n"
            "with open(" + json.dumps(log_path) + ", 'a', encoding='utf-8') as f:\n"
            "    f.write(data['event'] + '\\n')\n"
        )

    def _read_log(self, log_path):
        if not os.path.isfile(log_path):
            return []
        with open(log_path, "r", encoding="utf-8") as f:
            return [line for line in f.read().splitlines() if line]

    def test_01_disabled_by_default(self):
        log_path = os.path.join(self.tmp_dir, "received.log")
        self._write_plugin(
            "test-plugin",
            {"name": "Test", "entrypoints": {"runtime": "hook.py"}, "events": ["agent.*"]},
            self._log_hook(log_path),
        )
        os.environ.pop("AGY_ENABLE_PLUGINS", None)

        router = PluginRouter(extra_search_paths=[self.tmp_dir])
        self.assertEqual(router.hooks, [])

        broker = EventBroker()
        self.assertEqual(router.attach_to_broker(broker), 0)
        broker.publish(envelope.create_event("agent.custom_event", "test_source"))
        self.assertEqual(self._read_log(log_path), [])

    def test_02_discover_and_dispatch_only_matching_events(self):
        log_path = os.path.join(self.tmp_dir, "received.log")
        self._write_plugin(
            "test-plugin",
            {"name": "Test", "entrypoints": {"runtime": "hook.py"}, "events": ["agent.*"]},
            self._log_hook(log_path),
        )

        router = PluginRouter(extra_search_paths=[self.tmp_dir], include_default_paths=False)
        self.assertEqual(len(router.hooks), 1)
        self.assertEqual(router.hooks[0].plugin_id, "test-plugin")

        broker = EventBroker()
        self.assertEqual(router.attach_to_broker(broker), 1)

        broker.publish(envelope.create_event("agent.custom_event", "test_source", {"hello": "world"}))
        broker.publish(envelope.create_event("system.boot", "test_source"))

        self.assertEqual(self._read_log(log_path), ["agent.custom_event"])

    def test_03_rejects_runtime_outside_plugin_dir(self):
        evil_script = os.path.join(self.tmp_dir, "evil.py")
        with open(evil_script, "w", encoding="utf-8") as f:
            f.write("print('pwned')\n")
        self._write_plugin(
            "escape-plugin",
            {"name": "Escape", "entrypoints": {"runtime": "../evil.py"}},
            "print('placeholder')\n",
        )

        router = PluginRouter(extra_search_paths=[self.tmp_dir], include_default_paths=False)
        self.assertEqual(router.hooks, [])
        self.assertEqual(router.attach_to_broker(EventBroker()), 0)

        self._write_plugin(
            "absolute-plugin",
            {"name": "Absolute", "runtime": evil_script},
            "print('placeholder')\n",
        )
        router.reload_plugins()
        self.assertEqual(router.hooks, [])

    def test_04_timeout_kills_plugin(self):
        self._write_plugin(
            "hang-plugin",
            {"name": "Hang", "entrypoints": {"runtime": "hook.py"}},
            "import time\ntime.sleep(30)\n",
        )

        router = PluginRouter(extra_search_paths=[self.tmp_dir], include_default_paths=False)
        broker = EventBroker(dispatch_timeout=0.3)
        router.attach_to_broker(broker)

        captured = io.StringIO()
        start = time.time()
        with redirect_stderr(captured):
            broker.publish(envelope.create_event("agent.hang", "test_source"))
        elapsed = time.time() - start

        self.assertLess(elapsed, 5.0, "timeout must not block on the plugin")
        self.assertIn("timed out", captured.getvalue())

    def test_05_plugin_failure_is_reported(self):
        self._write_plugin(
            "broken-plugin",
            {"name": "Broken", "entrypoints": {"runtime": "hook.py"}},
            "import sys\nsys.stderr.write('boom from plugin')\nsys.exit(3)\n",
        )

        router = PluginRouter(extra_search_paths=[self.tmp_dir], include_default_paths=False)
        broker = EventBroker(dispatch_timeout=2.0)
        router.attach_to_broker(broker)

        captured = io.StringIO()
        with redirect_stderr(captured):
            broker.publish(envelope.create_event("agent.broken", "test_source"))

        output = captured.getvalue()
        self.assertIn("exited with 3", output)
        self.assertIn("boom from plugin", output)

    def test_06_reload_reattaches_without_duplicating_handlers(self):
        log_path = os.path.join(self.tmp_dir, "received.log")
        self._write_plugin(
            "test-plugin",
            {"name": "Test", "entrypoints": {"runtime": "hook.py"}, "events": ["agent.*"]},
            self._log_hook(log_path),
        )

        router = PluginRouter(extra_search_paths=[self.tmp_dir], include_default_paths=False)
        broker = EventBroker(dispatch_timeout=2.0)
        self.assertEqual(router.attach_to_broker(broker), 1)

        broker.publish(envelope.create_event("agent.one", "test_source"))
        router.reload_plugins()
        broker.publish(envelope.create_event("agent.two", "test_source"))

        self.assertEqual(self._read_log(log_path), ["agent.one", "agent.two"])

    def test_07_workspace_plugins_require_explicit_opt_in(self):
        workspace = os.path.join(self.tmp_dir, "workspace")
        plugin_root = os.path.join(workspace, ".agents", "plugins")
        log_path = os.path.join(self.tmp_dir, "workspace.log")
        self._write_plugin(
            "workspace-plugin",
            {"name": "Workspace", "entrypoints": {"runtime": "hook.py"}, "events": ["*"]},
            self._log_hook(log_path),
            root=plugin_root,
        )
        os.chdir(workspace)

        router = PluginRouter()
        self.assertEqual(router.hooks, [])

        os.environ["AGY_PLUGINS_ALLOW_WORKSPACE"] = "1"
        router.reload_plugins()
        self.assertEqual(len(router.hooks), 1)
        self.assertEqual(router.hooks[0].plugin_id, "workspace-plugin")


if __name__ == "__main__":
    unittest.main()
