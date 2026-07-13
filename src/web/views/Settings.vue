<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch, type Ref } from 'vue';
import { ElMessage } from 'element-plus/es/components/message/index.mjs';
import { apiErrorMessage } from '../api/client';
import { endpoints, type CloudflareAccountOption, type CloudflareInspectResult, type CloudflareWorkerOption, type EntryOriginOption } from '../api/endpoints';
import McCfSelect from '../components/McCfSelect.vue';
import McDialog from '../components/McDialog.vue';
import McIcon from '../components/McIcon.vue';
import { usePageRefresh } from '../composables/pageRefresh';
import { invalidateShares } from '../queries/shares';
import { applySettingsCache, getSettingsCache, loadSettings as loadSettingsQuery, loadEntryOrigins as loadEntryOriginsQuery, type SettingsState } from '../queries/settings';

type InspectStatus = 'idle' | 'checking' | 'ok' | 'error';

const settingsLoaded = ref(false);
const maintenanceSaving = ref(false);
const cloudflareTokenSaving = ref(false);
const accountOptions = ref<CloudflareAccountOption[]>([]);
const workerOptions = ref<CloudflareWorkerOption[]>([]);
const entryOriginOptions = ref<EntryOriginOption[]>([]);
const cloudflareDialogOpen = ref(false);
const cloudflareOptionsLoading = ref(false);
const entryOriginLoading = ref(false);
const cloudflareProfileSaving = ref(false);
const adminEntrySaving = ref(false);
const shareEntrySaving = ref(false);
const cloudflareStatus = ref<InspectStatus>('idle');
const cloudflareErrorMessage = ref('');
const tokenInspectStatus = ref<InspectStatus>('idle');
const tokenInspectMessage = ref('');
let tokenInspectTimer: ReturnType<typeof setTimeout> | undefined;
let tokenInspectRunId = 0;

const form = reactive({
  cloudflare: {
    accountId: '',
    apiToken: '',
    workerName: '',
    apiTokenConfigured: false,
    apiTokenMasked: ''
  },
  system: {
    cleanupEnabled: true,
    mailRetentionDays: 30,
    adminBaseUrl: '',
    shareBaseUrl: ''
  }
});

const tokenDraft = reactive({
  apiToken: '',
  accountId: '',
  workerName: ''
});

const tokenPermissionGroups = [
  { key: 'account_settings', type: 'read' },
  { key: 'workers_scripts', type: 'edit' },
  { key: 'zone', type: 'read' },
  { key: 'dns', type: 'edit' },
  { key: 'zone_settings', type: 'edit' },
  { key: 'email_routing_rule', type: 'edit' },
  { key: 'email_routing_address', type: 'edit' }
];

const tokenCreateUrl = computed(() => {
  const params = new URLSearchParams({
    name: 'DoneMail Cloudflare Management Token',
    accountId: '*',
    zoneId: 'all',
    permissionGroupKeys: JSON.stringify(tokenPermissionGroups)
  });
  return `https://dash.cloudflare.com/profile/api-tokens?${params.toString()}`;
});

const cloudflareConfigured = computed(() => Boolean(form.cloudflare.apiTokenConfigured));
const accountSelectOptions = computed(() => accountOptions.value.map((item) => ({ label: `${item.name} (${item.id})`, value: item.id })));
const workerSelectOptions = computed(() => workerOptions.value.map((item) => ({ label: item.name, value: item.name })));
const entrySelectOptions = computed(() => entryOriginOptions.value.map((item) => ({ label: item.label, value: item.value })));
const adminEntrySelectOptions = computed(() => [{ label: '任意', value: '' }, ...entrySelectOptions.value]);
const shareEntrySelectOptions = computed(() => [{ label: '默认', value: '' }, ...entrySelectOptions.value]);
const tokenOptionsReady = computed(() => Boolean(tokenDraft.apiToken.trim() && accountOptions.value.length));
const tokenSaveLabel = computed(() => {
  if (tokenInspectStatus.value === 'checking') return '检测中';
  if (cloudflareTokenSaving.value) return '保存中';
  return '保存';
});

function clearTokenInspectTimer() {
  if (tokenInspectTimer) {
    clearTimeout(tokenInspectTimer);
    tokenInspectTimer = undefined;
  }
}

function resetTokenDraft() {
  clearTokenInspectTimer();
  tokenInspectRunId += 1;
  tokenDraft.apiToken = '';
  tokenDraft.accountId = '';
  tokenDraft.workerName = '';
  tokenInspectStatus.value = 'idle';
  tokenInspectMessage.value = '';
  seedCloudflareOptions();
}

function openCloudflareDialog() {
  resetTokenDraft();
  cloudflareDialogOpen.value = true;
}

function openTokenPage() {
  window.open(tokenCreateUrl.value, '_blank', 'noopener,noreferrer');
}

function inspectPassed(data: CloudflareInspectResult) {
  return data.errors.length === 0 && data.accounts.length > 0;
}

function summarizeInspectError(data: CloudflareInspectResult) {
  return data.errors[0] || 'Cloudflare 令牌检测失败，请确认至少包含账号读取权限。';
}

function assignSystemConfig(system: Partial<typeof form.system>) {
  form.system.cleanupEnabled = system.cleanupEnabled === undefined ? true : system.cleanupEnabled === true;
  form.system.mailRetentionDays = Math.max(Math.floor(Number(system.mailRetentionDays ?? 30) || 30), 1);
  form.system.adminBaseUrl = String(system.adminBaseUrl || '');
  form.system.shareBaseUrl = String(system.shareBaseUrl || '');
}

function applyCloudflareInspectResult(data: CloudflareInspectResult, target: 'saved' | 'draft') {
  accountOptions.value = data.accounts;
  workerOptions.value = data.workers;

  const current = target === 'draft' ? tokenDraft : form.cloudflare;
  if (!current.accountId && data.accountId) {
    current.accountId = data.accountId;
  }
  if (!current.workerName && data.workerName) {
    current.workerName = data.workerName;
  }

  return {
    ok: inspectPassed(data),
    message: summarizeInspectError(data)
  };
}

function seedCloudflareOptions() {
  accountOptions.value = form.cloudflare.accountId ? [{ id: form.cloudflare.accountId, name: form.cloudflare.accountId }] : [];
  workerOptions.value = form.cloudflare.workerName ? [{ id: form.cloudflare.workerName, name: form.cloudflare.workerName }] : [];
}

function seedEntryOriginOptions() {
  entryOriginOptions.value = entryOriginCandidates();
}

function currentEntryOrigin() {
  return window.location.origin.replace(/\/+$/, '');
}

function entryOriginCandidates(options: EntryOriginOption[] = []) {
  const current = currentEntryOrigin();
  const candidates: EntryOriginOption[] = [
    { label: current.replace(/^https?:\/\//, ''), value: current, source: 'current_site' }
  ];
  if (form.system.adminBaseUrl && form.system.adminBaseUrl !== current) {
    candidates.push({ label: form.system.adminBaseUrl.replace(/^https?:\/\//, ''), value: form.system.adminBaseUrl, source: 'custom_domain' });
  }
  if (form.system.shareBaseUrl && form.system.shareBaseUrl !== current) {
    candidates.push({ label: form.system.shareBaseUrl.replace(/^https?:\/\//, ''), value: form.system.shareBaseUrl, source: 'custom_domain' });
  }
  candidates.push(...options);
  const seen = new Set<string>();
  return candidates.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

function applySettings(data: SettingsState) {
  suppressMaintenanceAutoSave = true;
  cloudflareStatus.value = 'idle';
  cloudflareErrorMessage.value = '';
  Object.assign(form.cloudflare, data.cloudflare);
  assignSystemConfig(data.system);
  seedCloudflareOptions();
  seedEntryOriginOptions();
  settingsLoaded.value = true;
  applySettingsCache(data);
  void Promise.resolve().then(() => {
    suppressMaintenanceAutoSave = false;
  });
}

async function loadSettings(force = false) {
  applySettings(await loadSettingsQuery(force));
}

function seedCachedSettings() {
  const cached = getSettingsCache();
  if (cached) applySettings(cached);
}

async function loadEntryOrigins(force = false) {
  if (!form.cloudflare.apiTokenConfigured || !form.cloudflare.accountId || !form.cloudflare.workerName) return;
  if (entryOriginLoading.value) return;
  if (!force && entryOriginOptions.value.length > 1) return;
  entryOriginLoading.value = true;
  try {
    entryOriginOptions.value = entryOriginCandidates(await loadEntryOriginsQuery(force));
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '入口地址读取失败'));
  } finally {
    entryOriginLoading.value = false;
  }
}

function ensureEntryOrigins() {
  void loadEntryOrigins(true);
}

async function saveSettingsPatch(
  saving: Ref<boolean>,
  payload: Record<string, unknown>,
  successMessage: string,
  fallbackMessage: string,
  afterSave?: () => void,
  onError?: () => void
) {
  saving.value = true;
  try {
    const next = applySettingsCache(await endpoints.saveSettings(payload));
    applySettings(next);
    afterSave?.();
    if (successMessage) ElMessage.success(successMessage);
  } catch (error) {
    onError?.();
    ElMessage.error(apiErrorMessage(error, fallbackMessage));
  } finally {
    saving.value = false;
  }
}

async function saveMailMaintenanceSettings(showMessage = true) {
  await saveSettingsPatch(
    maintenanceSaving,
    {
      system: {
        cleanupEnabled: form.system.cleanupEnabled,
        mailRetentionDays: form.system.mailRetentionDays
      }
    },
    showMessage ? '邮件维护已保存' : '',
    '邮件维护保存失败'
  );
}

let maintenanceAutoSaveTimer: ReturnType<typeof setTimeout> | undefined;
let maintenanceReady = false;
let suppressMaintenanceAutoSave = false;

function scheduleMailMaintenanceAutoSave() {
  if (suppressMaintenanceAutoSave || !settingsLoaded.value || !maintenanceReady || maintenanceSaving.value) return;
  if (maintenanceAutoSaveTimer) clearTimeout(maintenanceAutoSaveTimer);
  maintenanceAutoSaveTimer = setTimeout(() => {
    void commitMailMaintenanceAutoSave();
  }, 450);
}

async function commitMailMaintenanceAutoSave() {
  form.system.mailRetentionDays = Math.max(Math.floor(Number(form.system.mailRetentionDays) || 30), 1);
  await saveMailMaintenanceSettings(false);
}

async function saveCloudflareProfile(showMessage = true) {
  if (!form.cloudflare.apiTokenConfigured) {
    ElMessage.error('请先填写 Cloudflare 接口令牌');
    return;
  }

  if (!form.cloudflare.accountId) {
    ElMessage.error('请选择账号 ID');
    return;
  }

  if (!form.cloudflare.workerName) {
    ElMessage.error('请选择 Worker');
    return;
  }

  cloudflareProfileSaving.value = true;
  try {
    const next = applySettingsCache(await endpoints.saveSettings({
      cloudflare: {
        accountId: form.cloudflare.accountId,
        workerName: form.cloudflare.workerName
      }
    }));
    applySettings(next);
    if (showMessage) ElMessage.success('Cloudflare 配置已保存');
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, 'Cloudflare 配置保存失败'));
  } finally {
    cloudflareProfileSaving.value = false;
  }
}

async function saveAdminEntrySettings(previousValue: string) {
  await saveSettingsPatch(
    adminEntrySaving,
    {
      system: {
        adminBaseUrl: form.system.adminBaseUrl
      }
    },
    '后台入口已保存',
    '后台入口保存失败',
    () => {
      void invalidateShares();
    },
    () => {
      form.system.adminBaseUrl = previousValue;
    }
  );
}

function handleAdminEntryChange() {
  const previous = getSettingsCache()?.system.adminBaseUrl || '';
  void saveAdminEntrySettings(previous);
}

async function saveShareEntrySettings(previousValue: string) {
  await saveSettingsPatch(
    shareEntrySaving,
    {
      system: {
        shareBaseUrl: form.system.shareBaseUrl
      }
    },
    '共享入口已保存',
    '共享入口保存失败',
    () => {
      void invalidateShares();
    },
    () => {
      form.system.shareBaseUrl = previousValue;
    }
  );
}

function handleShareEntryChange() {
  const previous = getSettingsCache()?.system.shareBaseUrl || '';
  void saveShareEntrySettings(previous);
}

async function loadCloudflareOptions(force = false) {
  if (!form.cloudflare.apiTokenConfigured) {
    return;
  }
  if (!force && accountOptions.value.length > 1 && workerOptions.value.length > 0) {
    return;
  }

  cloudflareStatus.value = 'checking';
  cloudflareErrorMessage.value = '';
  cloudflareOptionsLoading.value = true;
  try {
    const data = await endpoints.testCloudflare({
      cloudflare: {
        accountId: form.cloudflare.accountId
      }
    });
    const result = applyCloudflareInspectResult(data, 'saved');
    cloudflareStatus.value = result.ok ? 'ok' : 'error';
    cloudflareErrorMessage.value = result.ok ? '' : result.message;
  } catch (error) {
    console.error('Cloudflare options load failed', error);
    cloudflareStatus.value = 'error';
    cloudflareErrorMessage.value = apiErrorMessage(error, 'Cloudflare 令牌检测失败');
  } finally {
    cloudflareOptionsLoading.value = false;
  }
}

function ensureCloudflareOptions() {
  void loadCloudflareOptions();
}

async function handleCloudflareAccountChange() {
  form.cloudflare.workerName = '';
  await loadCloudflareOptions(true);
  if (workerOptions.value.length === 1) {
    form.cloudflare.workerName = workerOptions.value[0].name;
  }
  if (form.cloudflare.workerName) {
    await saveCloudflareProfile(false);
  }
}

function handleCloudflareWorkerChange() {
  void saveCloudflareProfile();
}

function resetCloudflareDialogState() {
  resetTokenDraft();
}

async function inspectTokenDraft() {
  const apiToken = tokenDraft.apiToken.trim();
  if (!apiToken) {
    tokenInspectStatus.value = 'idle';
    tokenInspectMessage.value = '';
    return false;
  }

  const runId = ++tokenInspectRunId;
  tokenInspectStatus.value = 'checking';
  tokenInspectMessage.value = '';

  try {
    const data = await endpoints.testCloudflare({
      cloudflare: {
        apiToken,
        accountId: tokenDraft.accountId
      }
    });
    if (runId !== tokenInspectRunId) return false;
    const result = applyCloudflareInspectResult(data, 'draft');
    tokenInspectStatus.value = result.ok ? 'ok' : 'error';
    tokenInspectMessage.value = result.ok ? '' : result.message;
    return result.ok;
  } catch (error) {
    if (runId !== tokenInspectRunId) return false;
    tokenInspectStatus.value = 'error';
    tokenInspectMessage.value = apiErrorMessage(error, 'Cloudflare 令牌检测失败');
    accountOptions.value = [];
    workerOptions.value = [];
    return false;
  }
}

function scheduleTokenInspect(value: string) {
  if (!cloudflareDialogOpen.value) return;

  clearTokenInspectTimer();
  tokenInspectRunId += 1;
  tokenDraft.accountId = '';
  tokenDraft.workerName = '';
  tokenInspectMessage.value = '';

  if (!value.trim()) {
    tokenInspectStatus.value = 'idle';
    seedCloudflareOptions();
    return;
  }

  tokenInspectStatus.value = 'checking';
  accountOptions.value = [];
  workerOptions.value = [];
  tokenInspectTimer = setTimeout(() => {
    void inspectTokenDraft();
  }, 550);
}

function handleTokenAccountChange() {
  tokenDraft.workerName = '';
  void inspectTokenDraft();
}

async function saveCloudflareToken() {
  if (!tokenDraft.apiToken.trim()) {
    ElMessage.error('请填写 Cloudflare 接口令牌');
    return;
  }

  if (tokenInspectStatus.value === 'checking') {
    ElMessage.error('令牌正在检测，请稍后保存');
    return;
  }

  if (tokenInspectStatus.value === 'idle' && !(await inspectTokenDraft())) {
    ElMessage.error(tokenInspectMessage.value || 'Cloudflare 令牌检测失败');
    return;
  }

  if (tokenInspectStatus.value === 'error') {
    ElMessage.error(tokenInspectMessage.value || 'Cloudflare 令牌检测失败');
    return;
  }

  if (!tokenDraft.accountId) {
    ElMessage.error('请选择账号 ID');
    return;
  }

  if (!tokenDraft.workerName) {
    ElMessage.error('请选择 Worker');
    return;
  }

  cloudflareTokenSaving.value = true;
  try {
    const next = applySettingsCache(await endpoints.saveSettings({
      cloudflare: {
        accountId: tokenDraft.accountId,
        workerName: tokenDraft.workerName,
        apiToken: tokenDraft.apiToken
      },
    }));
    applySettings(next);
    ElMessage.success('Cloudflare 配置已保存');
    cloudflareDialogOpen.value = false;
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, 'Cloudflare 配置保存失败'));
  } finally {
    cloudflareTokenSaving.value = false;
  }
}

watch(() => tokenDraft.apiToken, scheduleTokenInspect);

watch(
  () => [form.system.cleanupEnabled, form.system.mailRetentionDays] as const,
  () => scheduleMailMaintenanceAutoSave()
);

onMounted(() => {
  seedCachedSettings();
  void loadSettings(!settingsLoaded.value).finally(() => {
    maintenanceReady = true;
  });
});
onActivated(() => {
  // keep-alive return: soft refresh so CF status / retention stay in sync
  if (!settingsLoaded.value) return;
  maintenanceReady = false;
  void loadSettings(true).finally(() => {
    maintenanceReady = true;
  });
});
onBeforeUnmount(() => {
  clearTokenInspectTimer();
  if (maintenanceAutoSaveTimer) clearTimeout(maintenanceAutoSaveTimer);
});
usePageRefresh(async () => {
  maintenanceReady = false;
  await loadSettings(true);
  maintenanceReady = true;
});
</script>

<template>
  <div class="page">
    <div v-if="settingsLoaded" class="mc-config-stream">
      <section class="mc-config-block">
        <header class="mc-config-block-head">
          <div class="mc-config-block-copy">
            <div class="mc-heading-line">
              <h3>Cloudflare</h3>
              <span v-if="cloudflareStatus === 'ok' || cloudflareStatus === 'error'" class="mc-heading-status-dot" :class="cloudflareStatus"></span>
            </div>
            <p>连接账号后可管理域名、邮箱路由与策略转发。</p>
          </div>
          <button v-if="cloudflareConfigured" type="button" class="mc-action-secondary" @click="openCloudflareDialog">更新令牌</button>
        </header>

        <div v-if="!cloudflareConfigured" class="mc-config-empty">
          <p>尚未连接 Cloudflare。填写接口令牌后，即可在域名管理中添加主域与子域。</p>
          <button type="button" class="mc-action-primary mc-action-attention" @click="openCloudflareDialog">
            <span>开始配置</span>
            <i v-for="n in 24" :key="n" class="mc-spark" :class="`mc-spark--n${n}`" aria-hidden="true"></i>
          </button>
        </div>

        <div v-else class="mc-config-fields">
          <div class="mc-field-grid mc-field-grid--config">
            <el-form-item label="账号 ID">
              <McCfSelect
                v-model="form.cloudflare.accountId"
                :options="accountSelectOptions"
                allow-input
                :loading="cloudflareOptionsLoading"
                :disabled="cloudflareProfileSaving"
                placeholder="选择或输入账号 ID"
                @change="handleCloudflareAccountChange"
                @open="ensureCloudflareOptions"
              />
            </el-form-item>
            <el-form-item label="Worker">
              <McCfSelect
                v-model="form.cloudflare.workerName"
                :options="workerSelectOptions"
                allow-input
                :loading="cloudflareOptionsLoading"
                :disabled="cloudflareProfileSaving"
                placeholder="选择或输入 Worker"
                @change="handleCloudflareWorkerChange"
                @open="ensureCloudflareOptions"
              />
            </el-form-item>
            <el-form-item label="后台入口">
              <McCfSelect
                v-model="form.system.adminBaseUrl"
                :options="adminEntrySelectOptions"
                select-only
                :loading="entryOriginLoading"
                placeholder="任意"
                :disabled="adminEntrySaving"
                @change="handleAdminEntryChange"
                @open="ensureEntryOrigins"
              />
            </el-form-item>
            <el-form-item label="共享入口">
              <McCfSelect
                v-model="form.system.shareBaseUrl"
                :options="shareEntrySelectOptions"
                select-only
                :loading="entryOriginLoading"
                placeholder="默认"
                :disabled="shareEntrySaving"
                @change="handleShareEntryChange"
                @open="ensureEntryOrigins"
              />
            </el-form-item>
          </div>
          <div v-if="cloudflareStatus === 'error' && cloudflareErrorMessage" class="mc-config-alert">
            <span>×</span>
            <p>{{ cloudflareErrorMessage }}</p>
          </div>
        </div>
      </section>

      <section class="mc-config-block">
        <header class="mc-config-block-head">
          <div class="mc-config-block-copy">
            <h3>邮件维护</h3>
            <p>修改后自动保存。控制过期邮件清理，减轻存储占用。</p>
          </div>
          <span v-if="maintenanceSaving" class="mc-config-autosave">保存中…</span>
        </header>
        <div class="mc-config-fields mc-config-fields--row">
          <div class="mc-settings-switch-field">
            <span>定时清理</span>
            <el-switch v-model="form.system.cleanupEnabled" :disabled="maintenanceSaving" />
          </div>
          <div class="mc-settings-field mc-settings-number-field">
            <span>邮件保留天数</span>
            <div class="mc-settings-number">
              <el-input-number v-model="form.system.mailRetentionDays" :min="1" :max="3650" :disabled="maintenanceSaving" />
              <span>天</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="mc-config-stream mc-config-stream--skeleton" aria-hidden="true">
      <section class="mc-config-block">
        <span class="mc-settings-skeleton-line short"></span>
        <span class="mc-settings-skeleton-line"></span>
        <span class="mc-settings-skeleton-line medium"></span>
      </section>
      <section class="mc-config-block">
        <span class="mc-settings-skeleton-line short"></span>
        <span class="mc-settings-skeleton-line medium"></span>
      </section>
    </div>

    <McDialog
      v-model="cloudflareDialogOpen"
      title="配置接口令牌"
      size="lg"
      destroy-on-close
      @closed="resetCloudflareDialogState"
    >
      <div class="mc-token-cards">
        <section class="mc-token-card">
          <div class="mc-token-card-row">
            <span class="mc-token-card-num">1</span>
            <h4 class="mc-token-card-title">创建令牌</h4>
            <button type="button" class="mc-token-card-action" @click="openTokenPage">
              打开创建页
              <McIcon name="right" :size="14" />
            </button>
          </div>
        </section>

        <section class="mc-token-card">
          <div class="mc-token-card-row">
            <span class="mc-token-card-num">2</span>
            <h4 class="mc-token-card-title">复制令牌</h4>
          </div>
        </section>

        <section class="mc-token-card mc-token-card--form">
          <div class="mc-token-card-row">
            <span class="mc-token-card-num">3</span>
            <h4 class="mc-token-card-title">粘贴保存</h4>
            <div class="mc-token-card-field">
              <el-input
                v-model.trim="tokenDraft.apiToken"
                type="password"
                show-password
                placeholder="粘贴接口令牌"
              />
            </div>
          </div>

          <div v-if="tokenInspectMessage" class="mc-config-alert mc-config-alert--dialog">
            <span>×</span>
            <div>
              <p>{{ tokenInspectMessage }}</p>
              <button type="button" class="mc-alert-link" @click="openTokenPage">重新打开创建页</button>
            </div>
          </div>

          <template v-if="tokenOptionsReady">
            <div class="mc-token-card-row mc-token-card-row--sub">
              <span class="mc-token-card-num mc-token-card-num--spacer" aria-hidden="true"></span>
              <span class="mc-token-card-title mc-token-card-label">账号 ID</span>
              <div class="mc-token-card-field">
                <McCfSelect
                  v-model="tokenDraft.accountId"
                  :options="accountSelectOptions"
                  allow-input
                  :disabled="tokenInspectStatus === 'checking'"
                  placeholder="选择账号 ID"
                  @change="handleTokenAccountChange"
                />
              </div>
            </div>
            <div class="mc-token-card-row mc-token-card-row--sub">
              <span class="mc-token-card-num mc-token-card-num--spacer" aria-hidden="true"></span>
              <span class="mc-token-card-title mc-token-card-label">Worker</span>
              <div class="mc-token-card-field">
                <McCfSelect
                  v-model="tokenDraft.workerName"
                  :options="workerSelectOptions"
                  allow-input
                  :disabled="tokenInspectStatus === 'checking' || !tokenDraft.accountId"
                  placeholder="选择 Worker"
                />
              </div>
            </div>
          </template>
        </section>
      </div>

      <template #footer>
        <button type="button" class="mc-action-secondary" :disabled="cloudflareTokenSaving" @click="cloudflareDialogOpen = false">取消</button>
        <button type="button" class="mc-action-primary" :disabled="cloudflareTokenSaving || tokenInspectStatus === 'checking'" @click="saveCloudflareToken">
          <span v-if="cloudflareTokenSaving || tokenInspectStatus === 'checking'" class="mc-button-spinner"></span>
          {{ tokenSaveLabel }}
        </button>
      </template>
    </McDialog>

  </div>
</template>
