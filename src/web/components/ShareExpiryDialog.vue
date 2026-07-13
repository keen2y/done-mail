<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import McCfSelect from './McCfSelect.vue';
import McDialog from './McDialog.vue';

type ExpiryUnit = 'hour' | 'day' | 'month' | 'year';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    saving?: boolean;
    allowRegenerate?: boolean;
    expiresAt?: string | null;
  }>(),
  {
    saving: false,
    allowRegenerate: false
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [ttlHours: number | null];
  regenerate: [];
  closed: [];
}>();

const draft = reactive({
  ttlValue: 1,
  ttlUnit: 'month' as ExpiryUnit,
  permanent: false
});

const expiryUnits: Array<{ label: string; value: ExpiryUnit; hours: number }> = [
  { label: '小时', value: 'hour', hours: 1 },
  { label: '天', value: 'day', hours: 24 },
  { label: '月', value: 'month', hours: 24 * 30 },
  { label: '年', value: 'year', hours: 24 * 365 }
];

const open = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const ttlInputValue = computed<number | undefined>({
  get: () => (draft.permanent ? undefined : draft.ttlValue),
  set: (value) => {
    const next = Number(value);
    draft.ttlValue = Number.isFinite(next) ? Math.max(Math.floor(next), 1) : 1;
  }
});

const ttlUnitValue = computed<string>({
  get: () => (draft.permanent ? '' : draft.ttlUnit),
  set: (value) => {
    if (expiryUnits.some((item) => item.value === value)) {
      draft.ttlUnit = value as ExpiryUnit;
    }
  }
});

function resetDraft() {
  if (props.expiresAt === null) {
    draft.permanent = true;
    draft.ttlValue = 1;
    draft.ttlUnit = 'month';
    return;
  }

  draft.permanent = false;
  if (!props.expiresAt) {
    draft.ttlValue = 1;
    draft.ttlUnit = 'month';
    return;
  }

  const ms = new Date(props.expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) {
    draft.ttlValue = 1;
    draft.ttlUnit = 'day';
    return;
  }

  const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
  if (hours % (24 * 365) === 0) {
    draft.ttlUnit = 'year';
    draft.ttlValue = hours / (24 * 365);
  } else if (hours % (24 * 30) === 0) {
    draft.ttlUnit = 'month';
    draft.ttlValue = hours / (24 * 30);
  } else if (hours % 24 === 0) {
    draft.ttlUnit = 'day';
    draft.ttlValue = hours / 24;
  } else {
    draft.ttlUnit = 'hour';
    draft.ttlValue = hours;
  }
}

function ttlPayload() {
  if (draft.permanent) return null;
  const unit = expiryUnits.find((item) => item.value === draft.ttlUnit);
  return Math.max(Math.floor(Number(draft.ttlValue) || 1), 1) * (unit?.hours || 1);
}

function save() {
  emit('save', ttlPayload());
}

watch(
  () => props.modelValue,
  (value) => {
    if (value) resetDraft();
  }
);
</script>

<template>
  <McDialog
    v-model="open"
    :title="title"
    size="md"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @closed="emit('closed')"
  >
    <el-form label-position="top" class="mc-share-dialog-form" @submit.prevent="save">
      <slot name="default"></slot>
      <el-form-item label="有效期">
        <div class="mc-share-expiry-control">
          <el-input-number v-model="ttlInputValue" :disabled="draft.permanent" :controls="!draft.permanent" :min="1" :max="87600" controls-position="right" />
          <McCfSelect v-model="ttlUnitValue" class="mc-share-expiry-unit" :options="expiryUnits" :disabled="saving || draft.permanent" select-only />
          <button type="button" class="mc-share-permanent-button" :class="{ active: draft.permanent }" :aria-pressed="draft.permanent" :disabled="saving" @click="draft.permanent = !draft.permanent">不限</button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <button v-if="allowRegenerate" type="button" class="mc-action-secondary" :disabled="saving" @click="emit('regenerate')">重置 Key</button>
      <span class="mc-dialog-spacer"></span>
      <button type="button" class="mc-action-secondary" :disabled="saving" @click="open = false">取消</button>
      <button type="button" class="mc-action-primary" :disabled="saving" @click="save">
        <span v-if="saving" class="mc-button-spinner"></span>
        {{ saving ? '保存中' : '保存' }}
      </button>
    </template>
  </McDialog>
</template>
