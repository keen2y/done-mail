import type { App } from 'vue';

let appRef: App | null = null;
let shellReady: Promise<void> | null = null;

export function bindAppShell(app: App) {
  appRef = app;
}

/** Load full console styles + Element Plus components (skip on login/setup). */
export async function ensureAppShell() {
  if (!shellReady) {
    shellReady = (async () => {
      const [{ registerElementPlus }] = await Promise.all([import('./element-plus'), import('./styles/shell.css')]);
      if (appRef) registerElementPlus(appRef);
    })();
  }
  await shellReady;
}
