#!/usr/bin/env python3
"""
plugin_router.py - Discovers user plugins and attaches runtime event hooks to EventBroker.

Allows external plugins placed in ~/.gemini/config/plugins/ or workspace .agents/plugins/
to subscribe to and intercept core event streams without modifying Antigravity source code.
"""
import os
import sys
import json
import glob
from typing import List, Dict, Any

class PluginRuntimeHook:
    def __init__(self, plugin_id: str, plugin_dir: str, manifest: Dict[str, Any]):
        self.plugin_id = plugin_id
        self.plugin_dir = plugin_dir
        self.manifest = manifest
        self.name = manifest.get("name", plugin_id)
        self.version = manifest.get("version", "1.0.0")

        # Resolve runtime script
        entrypoints = manifest.get("entrypoints", {})
        runtime_rel = entrypoints.get("runtime") or manifest.get("runtime")
        self.runtime_script = os.path.join(plugin_dir, runtime_rel) if runtime_rel else None

        # Resolve subscribed patterns (defaults to all events if unspecified)
        self.events = manifest.get("events") or ["*"]

    def is_valid(self) -> bool:
        return self.runtime_script is not None and os.path.isfile(self.runtime_script)


class PluginRouter:
    def __init__(self, extra_search_paths: List[str] = None):
        self.search_paths = self._build_search_paths(extra_search_paths)
        self.hooks: List[PluginRuntimeHook] = []
        self.reload_plugins()

    def _build_search_paths(self, extra_paths: List[str] = None) -> List[str]:
        paths = []
        if extra_paths:
            paths.extend(extra_paths)

        home = os.environ.get("HOME", "")
        if home:
            paths.append(os.path.join(home, ".gemini", "config", "plugins"))
            paths.append(os.path.join(home, ".gemini", "plugins"))

        cwd = os.getcwd()
        paths.append(os.path.join(cwd, ".agents", "plugins"))
        return [p for p in paths if p]

    def reload_plugins(self) -> List[PluginRuntimeHook]:
        self.hooks = []
        discovered_dirs = set()

        for search_root in self.search_paths:
            if not os.path.isdir(search_root):
                continue
            for item in os.listdir(search_root):
                plugin_dir = os.path.join(search_root, item)
                if not os.path.isdir(plugin_dir) or plugin_dir in discovered_dirs:
                    continue

                manifest_file = os.path.join(plugin_dir, "plugin.json")
                if os.path.isfile(manifest_file):
                    try:
                        with open(manifest_file, "r", encoding="utf-8") as f:
                            manifest = json.load(f)
                        hook = PluginRuntimeHook(item, plugin_dir, manifest)
                        if hook.is_valid():
                            self.hooks.append(hook)
                            discovered_dirs.add(plugin_dir)
                    except Exception as e:
                        print(f"[PluginRouter] Failed loading manifest in {plugin_dir}: {e}", file=sys.stderr)

        return self.hooks

    def attach_to_broker(self, broker) -> int:
        """
        Attaches all discovered plugin runtime scripts as output handlers in the EventBroker.
        """
        attached_count = 0
        for hook in self.hooks:
            for pattern in hook.events:
                # Register a dispatcher callback with the broker
                def make_handler(h: PluginRuntimeHook):
                    def handler_fn(event_dict):
                        self._dispatch_to_plugin(h, event_dict)
                    handler_fn.__name__ = f"plugin_{h.plugin_id}"
                    return handler_fn

                broker.register_handler(pattern, make_handler(hook))
                attached_count += 1
        return attached_count

    def _dispatch_to_plugin(self, hook: PluginRuntimeHook, event_dict: Dict[str, Any]):
        import subprocess
        script = hook.runtime_script
        payload = json.dumps(event_dict).encode("utf-8")

        cmd = [script]
        if script.endswith(".py"):
            cmd = [sys.executable, script]
        elif script.endswith(".sh"):
            cmd = ["/system/bin/sh" if os.path.exists("/system/bin/sh") else "bash", script]

        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                cwd=hook.plugin_dir
            )
            proc.communicate(input=payload, timeout=5.0)
        except Exception as e:
            print(f"[PluginRouter] Error executing plugin {hook.plugin_id}: {e}", file=sys.stderr)
