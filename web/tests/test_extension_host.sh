#!/usr/bin/env bash
# test_extension_host.sh - Validates Extension Host bundle structure, load order and runtime API.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_BUNDLE="$WEB_DIR/generated/extensions/extension_host.js"

echo "=== Testing Antigravity Web Extension Host ==="

[ -f "$EXT_BUNDLE" ] || { echo "FAIL: extension_host.js missing!" >&2; exit 1; }
[ -s "$EXT_BUNDLE" ] || { echo "FAIL: extension_host.js is empty!" >&2; exit 1; }

# Verify manifest wiring: every extension fragment is declared and bundled
for src in namespace dom_hook ui_registry event_bus plugin_loader builtins/desktop_mode public_api; do
    grep -Fq "src/extensions/$src.js" "$WEB_DIR/src.manifest" || {
        echo "FAIL: src/extensions/$src.js not declared in src.manifest" >&2
        exit 1
    }
done

# Verify critical API symbols exist in the bundle
for symbol in "window.AGY" "registerPlugin" "injectCSS" "registerHeaderAction" \
              "registerStatusIndicator" "builtin-desktop-mode" "runDisposers"; do
    if grep -Fq "$symbol" "$EXT_BUNDLE"; then
        echo "  [OK] Symbol present: $symbol"
    else
        echo "  [FAIL] Symbol missing: $symbol" >&2
        exit 1
    fi
done

# Verify load order in index.html: extension host must load before the app bundle
grep -Fq 'src="./generated/extensions/extension_host.js"' "$WEB_DIR/index.html" || {
    echo "FAIL: extension_host.js not referenced in index.html" >&2
    exit 1
}
ext_line=$(grep -n 'generated/extensions/extension_host.js' "$WEB_DIR/index.html" | cut -d: -f1)
app_line=$(grep -n 'generated/main.js' "$WEB_DIR/index.html" | cut -d: -f1)
[ -n "$ext_line" ] && [ -n "$app_line" ] && [ "$ext_line" -lt "$app_line" ] || {
    echo "FAIL: extension_host.js must load before generated/main.js" >&2
    exit 1
}
echo "  [OK] extension_host.js loads before generated/main.js"

if command -v node >/dev/null 2>&1; then
    node --check "$EXT_BUNDLE" || { echo "FAIL: extension_host.js is not valid JavaScript" >&2; exit 1; }
    echo "  [OK] node --check passed"
    node "$WEB_DIR/tests/extension_host_smoke.js" || { echo "FAIL: runtime smoke tests failed" >&2; exit 1; }
else
    echo "  [SKIP] node not found; runtime smoke tests skipped"
fi

echo "=== ALL EXTENSION HOST TESTS PASSED ==="
