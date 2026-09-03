/* Device-local appearance only. No member data or authentication state. */
(() => {
  const key = 'cimientos_appearance';
  const root = document.documentElement;
  function syncButton() {
    const button = document.getElementById('themeBtn');
    if (!button) return;
    const dark = root.dataset.theme === 'dark';
    button.title = dark ? 'Modo claro' : 'Modo oscuro';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(dark));
  }
  function set(mode) {
    root.dataset.theme = mode === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem(key, root.dataset.theme); } catch (_) { /* Storage can be unavailable. */ }
    syncButton();
  }
  let initial = 'light';
  try { initial = localStorage.getItem(key) || initial; } catch (_) { /* Default to light. */ }
  root.dataset.theme = initial === 'dark' ? 'dark' : 'light';
  window.CimientosTheme = { syncButton, toggle: () => set(root.dataset.theme === 'dark' ? 'light' : 'dark') };
})();
