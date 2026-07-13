import { createRouter, createWebHistory, type RouteComponent } from 'vue-router';
import { ref } from 'vue';
import { loadBootstrap } from './queries/bootstrap';
import { ensureAppShell } from './shell';

export const routerBootstrapped = ref(false);

const CHUNK_RELOAD_KEY = 'done-mail:chunk-reload';

function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically imported module/i.test(
    message
  );
}

function lazyView(loader: () => Promise<{ default: RouteComponent }>) {
  return () =>
    loader().catch((error: unknown) => {
      if (isChunkLoadError(error) && typeof sessionStorage !== 'undefined') {
        // After rebuild, old hashed chunks 404; one hard reload usually fixes it.
        if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
          window.location.reload();
          return new Promise<never>(() => undefined);
        }
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      }
      throw error;
    });
}

const viewLoaders = {
  setup: lazyView(() => import('./views/Setup.vue')),
  login: lazyView(() => import('./views/Login.vue')),
  inbox: lazyView(() => import('./views/Inbox.vue')),
  sharedMails: lazyView(() => import('./views/SharedMails.vue')),
  sharedAccounts: lazyView(() => import('./views/SharedAccounts.vue')),
  domains: lazyView(() => import('./views/Domains.vue')),
  policies: lazyView(() => import('./views/Policies.vue')),
  settings: lazyView(() => import('./views/Settings.vue')),
  logs: lazyView(() => import('./views/Logs.vue'))
};

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/inbox' },
    { path: '/setup', name: 'setup', component: viewLoaders.setup, meta: { public: true, title: '初始化' } },
    { path: '/login', name: 'login', component: viewLoaders.login, meta: { public: true, title: '登录' } },
    { path: '/inbox', name: 'inbox', component: viewLoaders.inbox, meta: { title: '邮箱列表', keepAlive: true } },
    { path: '/shared-mails', name: 'shared-mails', component: viewLoaders.sharedMails, meta: { title: '共享邮件', keepAlive: true } },
    { path: '/shared-accounts', name: 'shared-accounts', component: viewLoaders.sharedAccounts, meta: { title: '共享账户', keepAlive: true } },
    { path: '/domains', name: 'domains', component: viewLoaders.domains, meta: { title: '域名管理', keepAlive: true } },
    { path: '/policies', name: 'policies', component: viewLoaders.policies, meta: { title: '邮件策略', keepAlive: true } },
    { path: '/settings', name: 'settings', component: viewLoaders.settings, meta: { title: '配置中心', keepAlive: true } },
    { path: '/logs', name: 'logs', component: viewLoaders.logs, meta: { title: '异常记录', keepAlive: true } },
    { path: '/:pathMatch(.*)*', redirect: '/inbox' }
  ]
});

router.beforeEach(async (to) => {
  const state = (await loadBootstrap()).auth;

  if (!state.initialized && to.path !== '/setup') {
    return '/setup';
  }
  if (state.initialized && to.path === '/setup') {
    return state.authenticated ? '/inbox' : '/login';
  }
  if (!to.meta.public && !state.authenticated) {
    return '/login';
  }
  if (to.path === '/login' && state.authenticated) {
    return '/inbox';
  }
  // Full UI kit only after auth gate (login/setup stay lean).
  if (!to.meta.public) {
    await ensureAppShell();
  }
  return true;
});

router.afterEach(() => {
  routerBootstrapped.value = true;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  }
});

router.onError((error) => {
  if (!isChunkLoadError(error) || typeof sessionStorage === 'undefined') return;
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    return;
  }
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  window.location.reload();
});

export function preloadAppViews(priority: 'core' | 'all' = 'core') {
  // Warm common routes first; pull the rest only when idle bandwidth allows.
  void viewLoaders.inbox();
  void viewLoaders.settings();
  void viewLoaders.domains();
  if (priority === 'all') {
    void viewLoaders.policies();
    void viewLoaders.sharedMails();
    void viewLoaders.sharedAccounts();
    void viewLoaders.logs();
  }
}

export default router;
