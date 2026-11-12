#!/usr/bin/env python3
"""
plugin_router.py - Discovers user plugins and attaches runtime event hooks to EventBroker.

Plugins live in ~/.gemini/config/plugins/ (or ~/.gemini/plugins/). A plugin is a
directory with a plugin.json manifest and a runtime script that receives one JSON
event envelope per line on stdin:

    {
      "name": "My Plugin",
      "version": "1.0.0",
      "entrypoints": {"runtime": "hook.py"},
      "events": ["agent.*", "system.error"]
    }

Security model:
  * Disabled by default. Set AGY_ENABLE_PLUGINS=1 to enable home plugins.
  * Workspace plugins (<cwd>/.agents/plugins) additionally require the explicit
    AGY_PLUGINS_ALLOW_WORKSPACE=1 opt-in, so cloning an untrusted repository can
    never execute code on its own.
  * The runtime entrypoint must resolve inside its own plugin directory.
"""
import os
import sys
import json
from fnmatch import fnmatch
from typing import List, Dict, Any, Iterable

ENABLE_ENV = "AGY_ENABLE_PLUGINS"
WORKSPACE_ENV = "AGY_PLUGINS_ALLOW_WORKSPACE"
DEFAULT_TIMEOUT = 5.0
MAX_TIMEOUT = 30.0
STDERR_TAIL = 600


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def plugins_enabled() -> bool:
    """True only when the operator explicitly enabled runtime plugins."""
    return _env_flag(ENABLE_ENV)


def workspace_plugins_allowed() -> bool:
    return plugins_enabled() and _env_flag(WORKSPACE_ENV)


class PluginRuntimeHook:
    def __init__(self, plugin_id: str, plugin_dir: str, manifest: Dict[str, Any]):
        self.plugin_id = plugin_id
        self.plugin_dir = plugin_dir
        self.manifest = manifest
        self.name = manifest.get("name", plugin_id)
        self.version = manifest.get("version", "1.0.0")
        self.runtime_script = self._resolve_runtime_script()
        self.events = self._resolve_events()

    def _resolve_runtime_script(self):
        entrypoints = self.manifest.get("entrypoints")
        runtime_rel = None
        if isinstance(entrypoints, dict):
            runtime_rel = entrypoints.get("runtime")
        if not runtime_rel:
            runtime_rel = self.manifest.get("runtime")
        if not isinstance(runtime_rel, str) or not runtime_rel.strip():
            return None

        plugin_root = os.path.realpath(self.plugin_dir)
        candidate = os.path.realpath(os.path.join(plugin_root, runtime_rel.strip()))
        try:
            if os.path.commonpath([candidate, plugin_root]) != plugin_root:
                return None
        except ValueError:
            # Different drives on Windows: definitely outside the plugin dir.
            return None
        if not os.path.isfile(candidate):
            return None
        return candidate

    def _resolve_events(self) -> List[str]:
        raw = self.manifest.get("events")
        if isinstance(raw, str):
            events = [raw]
        elif isinstance(raw, (list, tuple)):
            events = [e for e in raw if isinstance(e, str) and e.strip()]
        else:
            events = []
        events = [e.strip() for e in events]
        return events or ["*"]

    def matches(self, event_name: str) -> bool:
        return any(fnmatch(event_name, pattern) for pattern in self.events)

    def is_valid(self) -> bool:
        return self.runtime_script is not None


class PluginRouter:
    def __init__(
        self,
        extra_search_paths: List[str] = None,
        include_default_paths: bool = True,
    ):
        self.include_default_paths = include_default_paths
        self.extra_search_paths = [p for p in (extra_search_paths or []) if p]
        self.search_paths = self._build_search_paths()
        self.hooks: List[PluginRuntimeHook] = []
        self._attached: Dict[int, Dict[str, Any]] = {}
        self.reload_plugins()

    def _build_search_paths(self) -> List[str]:
        paths = list(self.extra_search_paths)
        if self.include_default_paths:
            home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or ""
            if home:
                paths.append(os.path.join(home, ".gemini", "config", "plugins"))
                paths.append(os.path.join(home, ".gemini", "plugins"))
            if workspace_plugins_allowed():
                paths.append(os.path.join(os.getcwd(), ".agents", "plugins"))
        return paths

    def reload_plugins(self) -> List[PluginRuntimeHook]:
        attached_brokers = [entry["broker"] for entry in self._attached.values()]
        for broker in attached_brokers:
            self.detach_from_broker(broker)

        self.search_paths = self._build_search_paths()
        self.hooks = []
        if not plugins_enabled():
            return self.hooks

        seen_ids = set()
        seen_dirs = set()
        for search_root in self.search_paths:
            if not os.path.isdir(search_root):
                continue
            try:
                entries = sorted(os.listdir(search_root))
            except OSError as e:
                print(f"[PluginRouter] Cannot read {search_root}: {e}", file=sys.stderr)
                continue

            for item in entries:
                plugin_dir = os.path.realpath(os.path.join(search_root, item))
                if plugin_dir in seen_dirs or not os.path.isdir(plugin_dir):
                    continue
                seen_dirs.add(plugin_dir)

                manifest_file = os.path.join(plugin_dir, "plugin.json")
                if not os.path.isfile(manifest_file):
                    continue
                try:
                    with open(manifest_file, "r", encoding="utf-8") as f:
                        manifest = json.load(f)
                    if not isinstance(manifest, dict):
                        raise ValueError("plugin.json must contain a JSON object")
                    hook = PluginRuntimeHook(item, plugin_dir, manifest)
                except Exception as e:
                    print(f"[PluginRouter] Failed loading manifest in {plugin_dir}: {e}", file=sys.stderr)
                    continue

                if not hook.is_valid():
                    print(f"[PluginRouter] Skipping {item}: no usable runtime script", file=sys.stderr)
                    continue
                if hook.plugin_id in seen_ids:
                    print(f"[PluginRouter] Skipping duplicate plugin id '{hook.plugin_id}'", file=sys.stderr)
                    continue

                seen_ids.add(hook.plugin_id)
                self.hooks.append(hook)

        for broker in attached_brokers:
            self.attach_to_broker(broker)
        return self.hooks

    def attach_to_broker(self, broker) -> int:
        """Registers one filtered handler per plugin. Returns the plugin count."""
        if not plugins_enabled():
            return 0

        if id(broker) in self._attached:
            self.detach_from_broker(broker)

        registrations = []
        for hook in self.hooks:
            def make_handler(h: PluginRuntimeHook, dispatch_timeout: float):
                def handler_fn(event_dict):
                    event_name = event_dict.get("event", "")
                    if h.matches(event_name):
                        self._dispatch_to_plugin(h, event_dict, dispatch_timeout)
                handler_fn.__name__ = f"plugin_{h.plugin_id}"
                return handler_fn

            timeout = self._resolve_timeout(broker)
            handler = make_handler(hook, timeout)
            broker.register_handler("*", handler)
            registrations.append(("*", handler))

        self._attached[id(broker)] = {"broker": broker, "registrations": registrations}
        return len(registrations)

    def detach_from_broker(self, broker) -> int:
        entry = self._attached.pop(id(broker), None)
        if not entry:
            return 0
        removed = 0
        for pattern, handler in entry["registrations"]:
            try:
                if broker.unregister_handler(pattern, handler):
                    removed += 1
            except Exception as e:
                print(f"[PluginRouter] Detach failed: {e}", file=sys.stderr)
        return removed

    @staticmethod
    def _resolve_timeout(broker) -> float:
        timeout = getattr(broker, "dispatch_timeout", DEFAULT_TIMEOUT) or DEFAULT_TIMEOUT
        try:
            timeout = float(timeout)
        except (TypeError, ValueError):
            timeout = DEFAULT_TIMEOUT
        return max(0.1, min(timeout, MAX_TIMEOUT))

    def _build_command(self, hook: PluginRuntimeHook) -> List[str]:
        script = hook.runtime_script
        if script.endswith(".py"):
            return [sys.executable, script]
        if script.endswith(".sh"):
            shell = "/system/bin/sh" if os.path.isfile("/system/bin/sh") else "bash"
            return [shell, script]
        return [script]

    def _dispatch_to_plugin(self, hook: PluginRuntimeHook, event_dict: Dict[str, Any], timeout: float):
        import subprocess

        payload = json.dumps(event_dict).encode("utf-8")
        try:
            proc = subprocess.Popen(
                self._build_command(hook),
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                cwd=hook.plugin_dir,
            )
        except Exception as e:
            print(f"[PluginRouter] Cannot start plugin {hook.plugin_id}: {e}", file=sys.stderr)
            return

        try:
            _, stderr = proc.communicate(input=payload, timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                proc.communicate(timeout=1.0)
            except Exception:
                pass
            print(f"[PluginRouter] Plugin {hook.plugin_id} timed out after {timeout:.1f}s and was killed",
                  file=sys.stderr)
            return
        except Exception as e:
            try:
                proc.kill()
                proc.wait()
            except Exception:
                pass
            print(f"[PluginRouter] Error executing plugin {hook.plugin_id}: {e}", file=sys.stderr)
            return

        if proc.returncode != 0:
            detail = (stderr or b"").decode("utf-8", "replace").strip()
            if len(detail) > STDERR_TAIL:
                detail = "..." + detail[-STDERR_TAIL:]
            print(f"[PluginRouter] Plugin {hook.plugin_id} exited with {proc.returncode}"
                  + (f": {detail}" if detail else ""), file=sys.stderr)


def attach_plugins(broker) -> int:
    """Entrypoint helper: attaches runtime plugins when explicitly enabled."""
    if not plugins_enabled():
        return 0
    try:
        router = PluginRouter()
        count = router.attach_to_broker(broker)
        if count:
            print(f"[PluginRouter] Attached {count} plugin(s)", file=sys.stderr)
        return count
    except Exception as e:
        print(f"[PluginRouter] Failed to attach plugins: {e}", file=sys.stderr)
        return 0
