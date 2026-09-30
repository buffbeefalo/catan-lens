// Light or dark: follows the device until the viewer picks one with the header switch, then remembers that pick
// in this browser. The page head applies a saved pick before the first paint (see index.html), so there is no flash.
const KEY = 'catan-lens.theme';
const media = matchMedia('(prefers-color-scheme: dark)');
const root = document.documentElement;

export const currentTheme = () => root.dataset.theme || (media.matches ? 'dark' : 'light');

function label(button) {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  button.setAttribute('aria-label', `Switch to ${next} theme`);
  button.title = `Switch to ${next} theme`;
}

export function setupThemeSwitch(button) {
  if (!button) return;
  label(button);
  media.addEventListener('change', () => label(button));
  button.addEventListener('click', () => {
    root.dataset.theme = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, root.dataset.theme); } catch { /* private mode: the pick lasts for this page only */ }
    label(button);
  });
}
