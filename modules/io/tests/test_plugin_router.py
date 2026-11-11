#!/usr/bin/env python3
"""
test_plugin_router.py - Unit tests for PluginRouter and runtime plugin hooks.
"""
import unittest
import os
import sys
import tempfile
import shutil
import json

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
IO_ROOT = os.path.dirname(TESTS_DIR)
sys.path.insert(0, os.path.join(IO_ROOT, "core_bus"))

import envelope
from event_broker import EventBroker
from plugin_router import PluginRouter

class TestPluginRouter(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_01_discover_and_dispatch(self):
        # 1. Create a mock plugin with runtime hook
        plugin_dir = os.path.join(self.tmp_dir, "test-plugin")
        os.makedirs(plugin_dir)

        manifest = {
            "name": "Test Plugin",
            "version": "1.0.0",
            "entrypoints": {
                "runtime": "hook.py"
            },
            "events": ["agent.*"]
        }
        with open(os.path.join(plugin_dir, "plugin.json"), "w") as f:
            json.dump(manifest, f)

        out_log = os.path.join(plugin_dir, "received.log")
        hook_py = os.path.join(plugin_dir, "hook.py")
        with open(hook_py, "w") as f:
            f.write(f"""import sys, json
data = json.load(sys.stdin)
with open("{out_log}", "w") as f:
    f.write(data["event"])
""")

        # 2. Initialize router with search path pointing to tmp_dir
        router = PluginRouter(extra_search_paths=[self.tmp_dir])
        self.assertEqual(len(router.hooks), 1)
        self.assertEqual(router.hooks[0].plugin_id, "test-plugin")

        # 3. Attach to broker
        broker = EventBroker()
        attached = router.attach_to_broker(broker)
        self.assertEqual(attached, 1)

        # 4. Publish event
        ev = envelope.create_event("agent.custom_event", "test_source", {"hello": "world"})
        broker.publish(ev)

        # 5. Verify the plugin received the event via stdin
        self.assertTrue(os.path.isfile(out_log), "Expected plugin to generate output log")
        with open(out_log, "r") as f:
            content = f.read()
        self.assertEqual(content, "agent.custom_event")

if __name__ == "__main__":
    unittest.main()
