#!/usr/bin/env bash
# test_extension_host.sh - Validates Extension Host bundle structure and API symbols.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_BUNDLE="$WEB_DIR/generated/extensions/extension_host.js"

echo "=== Testing Antigravity Web Extension Host ==="

[ -f "$EXT_BUNDLE" ] || { echo "FAIL: extension_host.js missing!" >&2; exit 1; }
[ -s "$EXT_BUNDLE" ] || { echo "FAIL: extension_host.js is empty!" >&2; exit 1; }

# Verify critical API symbols exist in bundle
for symbol in "window.AGY" "registerPlugin" "injectCSS" "registerHeaderAction" "registerStatusIndicator" "builtin-desktop-mode"; do
    if grep -Fq "$symbol" "$EXT_BUNDLE"; then
        echo "  [OK] Symbol present: $symbol"
    else
        echo "  [FAIL] Symbol missing: $symbol" >&2
        exit 1
    fi
done

# Verify load order in index.html
grep -Fq 'src="./generated/extensions/extension_host.js"' "$WEB_DIR/index.html" || {
    echo "FAIL: extension_host.js not referenced in index.html" >&2
    exit 1
}
echo "  [OK] extension_host.js correctly referenced in index.html"

echo "=== ALL EXTENSION HOST TESTS PASSED ==="
