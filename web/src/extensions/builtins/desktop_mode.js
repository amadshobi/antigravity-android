/**
 * extensions/builtins/desktop_mode.js - Built-in Desktop Mode Extension.
 *
 * Provides responsive desktop/mobile viewport toggle via AGY Extension API,
 * replacing brittle AST/regex modifications of upstream React bundles.
 */

function initDesktopModeExtension() {
  registerPlugin('builtin-desktop-mode', {
    name: 'Desktop View Mode',
    version: '1.0.0',
    activate: function(ctx) {
      function getDesktopState() {
        try {
          if (window.Android && typeof window.Android.isDesktopMode === 'function') {
            return window.Android.isDesktopMode();
          }
          var s = localStorage.getItem('ag_desktop_mode');
          return s === 'true';
        } catch (_) {
          return false;
        }
      }

      function applyDesktopState(enabled) {
        try {
          localStorage.setItem('ag_desktop_mode', String(enabled));
          if (window.Android && typeof window.Android.setDesktopMode === 'function') {
            window.Android.setDesktopMode(enabled);
          }
        } catch (_) {}
      }

      var isDesktop = getDesktopState();

      var desktopSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
      var mobileSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';

      ctx.ui.registerHeaderAction({
        id: 'desktop-mode-toggle',
        title: isDesktop ? 'Desktop Mode: ON (Click for Mobile)' : 'Desktop Mode: OFF (Click for Desktop)',
        icon: isDesktop ? desktopSvg : mobileSvg,
        onClick: function() {
          isDesktop = !isDesktop;
          applyDesktopState(isDesktop);
          var btn = document.getElementById('agy-action-desktop-mode-toggle');
          if (btn) {
            btn.innerHTML = isDesktop ? desktopSvg : mobileSvg;
            btn.title = isDesktop ? 'Desktop Mode: ON (Click for Mobile)' : 'Desktop Mode: OFF (Click for Desktop)';
          }
        }
      });
    }
  });
}
