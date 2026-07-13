<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus/es/components/message/index.mjs';
import { apiErrorMessage, changeAdminKey, logoutSession } from './api/client';
import McConfirmDialog from './components/McConfirmDialog.vue';
import McDialog from './components/McDialog.vue';
import McIcon from './components/McIcon.vue';
import { footerMetrics } from './composables/footerStatus';
import { pageRefreshing, runPageRefresh } from './composables/pageRefresh';
import {
  checkForUpdate,
  dismissUpdate,
  fetchLatestRelease,
  formatVersionLabel,
  renderReleaseNotesHtml,
  type UpdateInfo
} from './composables/updateCheck';
import { DOCS_UPDATE_URL } from '../shared/version';
import { loadBootstrap } from './queries/bootstrap';
import { queryKeys } from './queries/keys';
import { queryClient } from './queryClient';
import { preloadAppViews, routerBootstrapped } from './router';
import type { SettingsState } from '../shared/types';

const route = useRoute();
const router = useRouter();

const isAuthPage = computed(() => route.path === '/login' || route.path === '/setup');
const title = computed(() => String(route.meta.title || 'DoneMail'));
const menuOpen = ref(false);
const navOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);
const securityDialogOpen = ref(false);
const updateDialogOpen = ref(false);
const updateChecking = ref(false);
const updateInfo = ref<UpdateInfo | null>(null);
const updateError = ref('');
const savingAdminKey = ref(false);
const cloudflareReady = ref(true);
const needsCloudflareSetup = computed(() => !isAuthPage.value && routerBootstrapped.value && !cloudflareReady.value);
/** Pulse nav only when CF missing AND user is not already on 配置中心 */
const showSettingsNavAttention = computed(() => needsCloudflareSetup.value && route.path !== '/settings');
const updateDialogTitle = computed(() => {
  if (updateChecking.value) return '检查更新';
  if (updateError.value) return '检查更新';
  if (updateInfo.value?.hasUpdate) return '发现新版本';
  return '已是最新版本';
});
const updateNotesHtml = computed(() =>
  updateInfo.value?.notes ? renderReleaseNotesHtml(updateInfo.value.notes) : ''
);
const showUpdateAvailable = computed(
  () => Boolean(updateInfo.value?.hasUpdate && !updateDialogOpen.value)
);
const adminKeyForm = ref({
  currentKey: '',
  newKey: '',
  confirmKey: ''
});
let appViewsPreloaded = false;
let updateChecked = false;

const closeAppMenusKey = Symbol.for('done-mail.close-app-menus');

const navGroups = [
  [{ path: '/inbox', label: '邮箱列表', icon: 'mail' }],
  [
    { path: '/policies', label: '邮件策略', icon: 'policy' },
    { path: '/shared-mails', label: '共享邮件', icon: 'link' },
    { path: '/shared-accounts', label: '共享账户', icon: 'users' }
  ],
  [
    { path: '/domains', label: '域名管理', icon: 'globe' },
    { path: '/logs', label: '异常记录', icon: 'file' },
    { path: '/settings', label: '配置中心', icon: 'settings' }
  ]
];

async function logout() {
  closeAppMenus();
  await logoutSession();
  router.push('/login');
}

function refreshPage() {
  void runPageRefresh();
}

function openDocs() {
  closeAppMenus();
  window.open('https://sow.us.kg', '_blank', 'noopener,noreferrer');
}

function openSecurityDialog() {
  closeAppMenus();
  adminKeyForm.value = {
    currentKey: '',
    newKey: '',
    confirmKey: ''
  };
  securityDialogOpen.value = true;
}

async function saveAdminKey() {
  const currentKey = adminKeyForm.value.currentKey.trim();
  const newKey = adminKeyForm.value.newKey.trim();
  const confirmKey = adminKeyForm.value.confirmKey.trim();

  if (!currentKey) {
    ElMessage.error('请填写当前管理员 Key');
    return;
  }
  if (!newKey) {
    ElMessage.error('请填写新管理员 Key');
    return;
  }
  if (newKey !== confirmKey) {
    ElMessage.error('两次输入的新管理员 Key 不一致');
    return;
  }

  savingAdminKey.value = true;
  try {
    await changeAdminKey(currentKey, newKey);
    securityDialogOpen.value = false;
    adminKeyForm.value = {
      currentKey: '',
      newKey: '',
      confirmKey: ''
    };
    ElMessage.success('管理员 Key 已更新');
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '修改管理员 Key 失败'));
  } finally {
    savingAdminKey.value = false;
  }
}

function closeAppMenus() {
  menuOpen.value = false;
  navOpen.value = false;
}

function toggleNav() {
  menuOpen.value = false;
  navOpen.value = !navOpen.value;
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (menuOpen.value) {
    if (!(event.target instanceof Node && menuRef.value?.contains(event.target))) {
      menuOpen.value = false;
    }
  }
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeAppMenus();
}

function scheduleAppViewPreload() {
  if (appViewsPreloaded || !routerBootstrapped.value || isAuthPage.value) return;
  appViewsPreloaded = true;

  const idleCallback = window.requestIdleCallback || ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 300));
  // Core routes first; remaining chunks a bit later to avoid first-paint spike.
  idleCallback(() => preloadAppViews('core'), { timeout: 1200 });
  window.setTimeout(() => {
    idleCallback(() => preloadAppViews('all'), { timeout: 2500 });
  }, 1800);
}

function syncCloudflareReadyFromCache() {
  const settings = queryClient.getQueryData<SettingsState>(queryKeys.settings);
  if (settings?.cloudflare) {
    cloudflareReady.value = Boolean(settings.cloudflare.apiTokenConfigured);
    return;
  }
  const bootstrap = queryClient.getQueryData<{ settings?: SettingsState }>(queryKeys.bootstrap);
  if (bootstrap?.settings?.cloudflare) {
    cloudflareReady.value = Boolean(bootstrap.settings.cloudflare.apiTokenConfigured);
  }
}

function refreshCloudflareReadyFromBootstrap() {
  void loadBootstrap()
    .then((bootstrap) => {
      cloudflareReady.value = Boolean(bootstrap.settings?.cloudflare?.apiTokenConfigured);
    })
    .catch(() => {
      // keep previous flag
    });
}

async function scheduleUpdateCheck() {
  if (updateChecked || !routerBootstrapped.value || isAuthPage.value) return;
  updateChecked = true;
  try {
    const bootstrap = await loadBootstrap();
    cloudflareReady.value = Boolean(bootstrap.settings?.cloudflare?.apiTokenConfigured);
    const info = await checkForUpdate(bootstrap.version || undefined);
    if (!info) return;
    // Soft notice only: keep data ready for menu「检查更新」, do not interrupt first-run flow.
    updateError.value = '';
    updateInfo.value = info;
  } catch {
    // ignore network failures
  }
}

async function manualCheckUpdate() {
  closeAppMenus();
  updateError.value = '';
  updateInfo.value = null;
  updateChecking.value = true;
  updateDialogOpen.value = true;
  try {
    const bootstrap = await loadBootstrap();
    cloudflareReady.value = Boolean(bootstrap.settings?.cloudflare?.apiTokenConfigured);
    const result = await fetchLatestRelease(bootstrap.version || undefined);
    if (result.status === 'error') {
      updateError.value = result.message;
      updateInfo.value = null;
      return;
    }
    updateInfo.value = result.info;
  } catch {
    updateError.value = '检查更新失败，请稍后重试';
    updateInfo.value = null;
  } finally {
    updateChecking.value = false;
  }
}

function skipUpdate() {
  if (updateInfo.value?.hasUpdate) dismissUpdate(updateInfo.value.latest);
  updateDialogOpen.value = false;
}

function closeUpdateDialog() {
  updateDialogOpen.value = false;
}

function openUpgradeGuide() {
  window.open(DOCS_UPDATE_URL, '_blank', 'noopener,noreferrer');
}

function openReleaseNotes() {
  if (!updateInfo.value?.releaseUrl) return;
  window.open(updateInfo.value.releaseUrl, '_blank', 'noopener,noreferrer');
}

let unsubscribeQueryCache: (() => void) | undefined;

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleDocumentKeydown);
  unsubscribeQueryCache = queryClient.getQueryCache().subscribe((event) => {
    const key = event?.query?.queryKey?.[0];
    if (key === 'settings' || key === 'bootstrap') syncCloudflareReadyFromCache();
  });
  syncCloudflareReadyFromCache();
  scheduleAppViewPreload();
  scheduleUpdateCheck();
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
  document.removeEventListener('keydown', handleDocumentKeydown);
  unsubscribeQueryCache?.();
});

watch([routerBootstrapped, isAuthPage], () => {
  scheduleAppViewPreload();
  scheduleUpdateCheck();
  if (routerBootstrapped.value && !isAuthPage.value) refreshCloudflareReadyFromBootstrap();
});

watch(
  () => route.path,
  () => {
    navOpen.value = false;
    menuOpen.value = false;
    if (route.path === '/settings') refreshCloudflareReadyFromBootstrap();
  }
);

provide(closeAppMenusKey, closeAppMenus);
</script>

<template>
  <main v-if="!routerBootstrapped" class="login-shell login-boot-shell" aria-label="正在加载"></main>
  <router-view v-else-if="isAuthPage" />
  <div v-else class="mc-page" :class="{ 'mc-page--nav-open': navOpen }">
    <button
      v-if="navOpen"
      type="button"
      class="mc-nav-backdrop"
      aria-label="关闭导航"
      @click="navOpen = false"
    ></button>
    <div class="mc-frame">
      <aside class="mc-sidebar" :class="{ 'is-open': navOpen }" aria-label="主导航">
        <div class="mc-brand">
          <img src="/static/logo-mark.svg" alt="DoneMail" />
          <span>DoneMail</span>
          <button type="button" class="mc-nav-close" aria-label="关闭导航" @click="navOpen = false">
            <McIcon name="close" :size="18" />
          </button>
        </div>

        <nav class="mc-nav">
          <div v-for="(group, groupIndex) in navGroups" :key="groupIndex" class="mc-nav-group">
            <router-link
              v-for="item in group"
              :key="item.path"
              :to="item.path"
              class="mc-nav-item"
              :class="{
                active: route.path === item.path,
                'is-attention': item.path === '/settings' && showSettingsNavAttention
              }"
              @click="navOpen = false"
            >
              <span class="mc-nav-item-icon">
                <McIcon :name="item.icon" :size="20" />
              </span>
              <span class="mc-nav-item-label">{{ item.label }}</span>
              <template v-if="item.path === '/settings' && showSettingsNavAttention">
                <i v-for="n in 8" :key="n" class="mc-spark" :class="`mc-spark--n${n}`" aria-hidden="true"></i>
              </template>
            </router-link>
          </div>
        </nav>

        <div class="mc-sidebar-footer">
          <a class="mc-sidebar-link" href="https://github.com/keen2y/done-mail" target="_blank" rel="noopener noreferrer">
            <McIcon name="github" :size="18" />
            <span>GitHub</span>
          </a>
        </div>
      </aside>

      <main class="mc-main">
        <header class="mc-header">
          <div class="mc-header-left">
            <button type="button" class="mc-nav-toggle" aria-label="打开导航" :aria-expanded="navOpen" @click="toggleNav">
              <McIcon name="menu" :size="20" />
            </button>
            <div class="mc-top-title">{{ title }}</div>
          </div>
          <div class="mc-user-actions">
            <button
              type="button"
              :class="{ 'is-refreshing': pageRefreshing }"
              :disabled="pageRefreshing"
              :aria-label="pageRefreshing ? '正在刷新' : '刷新当前页面'"
              :title="pageRefreshing ? '正在刷新' : '刷新当前页面'"
              @click="refreshPage"
            >
              <McIcon name="refresh" :size="19" />
            </button>
            <div ref="menuRef" class="mc-menu-wrap">
              <button class="mc-menu-trigger" type="button" aria-label="打开菜单" @click="menuOpen = !menuOpen">
                <McIcon name="down" :size="17" :stroke-width="2" />
              </button>
              <div v-if="menuOpen" class="mc-menu-surface mc-user-menu">
                <button type="button" class="mc-menu-item" @click="openDocs"><McIcon name="docs" :size="16" />使用文档</button>
                <button type="button" class="mc-menu-item" @click="openSecurityDialog"><McIcon name="settings" :size="16" />修改密钥</button>
                <button
                  type="button"
                  class="mc-menu-item"
                  :class="{ 'mc-menu-item--accent': showUpdateAvailable }"
                  :disabled="updateChecking"
                  @click="manualCheckUpdate"
                >
                  <McIcon name="refresh" :size="16" />
                  检查更新
                </button>
                <button type="button" class="mc-menu-item" @click="logout"><McIcon name="logout" :size="16" />退出登录</button>
              </div>
            </div>
          </div>
        </header>

        <div class="mc-route-shell">
          <router-view v-slot="{ Component, route: viewRoute }">
            <keep-alive :max="6">
              <component
                :is="Component"
                v-if="Component"
                :key="String(viewRoute.name || viewRoute.path)"
              />
            </keep-alive>
          </router-view>
        </div>

        <footer class="mc-footer">
          <div v-if="footerMetrics.length > 0" class="mc-footer-metrics">
            <span v-for="item in footerMetrics" :key="`${item.label}-${item.unit}`" class="mc-footer-metric">
              <span>{{ item.label }}</span>
              <b>{{ item.value }}</b>
              <span v-if="item.unit">{{ item.unit }}</span>
            </span>
          </div>
        </footer>
      </main>
    </div>

    <McDialog
      v-model="securityDialogOpen"
      title="修改密钥"
      size="sm"
      destroy-on-close
      :close-on-click-modal="false"
    >
      <div class="mc-key-dialog-form">
        <el-form-item label="当前密钥">
          <el-input v-model="adminKeyForm.currentKey" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新设密钥">
          <el-input v-model="adminKeyForm.newKey" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认密钥">
          <el-input v-model="adminKeyForm.confirmKey" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </div>
      <template #footer>
        <button type="button" class="mc-action-secondary" :disabled="savingAdminKey" @click="securityDialogOpen = false">取消</button>
        <button type="button" class="mc-action-primary" :disabled="savingAdminKey" @click="saveAdminKey">
          <span v-if="savingAdminKey" class="mc-button-spinner"></span>
          {{ savingAdminKey ? '保存中' : '保存' }}
        </button>
      </template>
    </McDialog>
    <McDialog
      v-model="updateDialogOpen"
      :title="updateDialogTitle"
      size="md"
      :close-on-click-modal="false"
      @closed="updateInfo = null; updateError = ''; updateChecking = false"
    >
      <div class="mc-update-dialog">
        <div v-if="updateChecking" class="mc-update-state">
          <span class="mc-button-spinner"></span>
          <p>正在从 GitHub 检查最新版本…</p>
        </div>

        <div v-else-if="updateError" class="mc-update-state mc-update-state--error">
          <p>{{ updateError }}</p>
        </div>

        <template v-else-if="updateInfo">
          <div class="mc-update-versions" :class="{ 'is-latest': !updateInfo.hasUpdate }">
            <div class="mc-update-version-item">
              <span>当前版本</span>
              <b>{{ formatVersionLabel(updateInfo.current) }}</b>
            </div>
            <div class="mc-update-version-item">
              <span>{{ updateInfo.hasUpdate ? '最新版本' : '线上版本' }}</span>
              <b>{{ formatVersionLabel(updateInfo.latest) }}</b>
            </div>
          </div>

          <p v-if="!updateInfo.hasUpdate" class="mc-update-hint">
            当前已是最新版本，无需更新。
          </p>
          <template v-else>
            <div class="mc-update-steps">
              <p class="mc-update-hint">按下面步骤同步你的 GitHub Fork 后，Cloudflare 会自动重新部署：</p>
              <ol class="mc-update-steps-list">
                <li>打开你 <b>Fork</b> 出来的 GitHub 仓库</li>
                <li>点击 <b>Sync fork</b> → <b>Update branch</b></li>
                <li>等待 Cloudflare 自动构建部署后，再检查一次版本</li>
              </ol>
            </div>
            <div v-if="updateNotesHtml" class="mc-update-notes">
              <div class="mc-update-notes-title">更新日志</div>
              <div class="mc-update-notes-body" v-html="updateNotesHtml"></div>
            </div>
            <div v-else class="mc-update-notes mc-update-notes--empty">
              <div class="mc-update-notes-title">更新日志</div>
              <p>本次发布未填写更新说明。</p>
            </div>
          </template>
        </template>
      </div>
      <template #footer>
        <template v-if="updateChecking">
          <button type="button" class="mc-action-secondary" @click="closeUpdateDialog">关闭</button>
        </template>
        <template v-else-if="updateError">
          <button type="button" class="mc-action-secondary" @click="closeUpdateDialog">关闭</button>
          <button type="button" class="mc-action-primary" @click="manualCheckUpdate">重试</button>
        </template>
        <template v-else-if="updateInfo?.hasUpdate">
          <button type="button" class="mc-action-secondary" @click="skipUpdate">稍后提醒</button>
          <button type="button" class="mc-action-secondary" @click="openReleaseNotes">Release</button>
          <button type="button" class="mc-action-primary" @click="openUpgradeGuide">如何更新</button>
        </template>
        <template v-else>
          <button type="button" class="mc-action-primary" @click="closeUpdateDialog">知道了</button>
        </template>
      </template>
    </McDialog>
    <McConfirmDialog />
  </div>
</template>
