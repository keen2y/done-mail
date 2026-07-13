<script setup lang="ts">
import { computed } from 'vue';

export type McDialogSize = 'sm' | 'md' | 'lg';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    size?: McDialogSize;
    showClose?: boolean;
    closeOnClickModal?: boolean;
    closeOnPressEscape?: boolean;
    destroyOnClose?: boolean;
    appendToBody?: boolean;
  }>(),
  {
    size: 'md',
    showClose: true,
    closeOnClickModal: true,
    closeOnPressEscape: true,
    destroyOnClose: false,
    appendToBody: true
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  open: [];
  closed: [];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
});

const widthMap: Record<McDialogSize, string> = {
  sm: '420px',
  md: '520px',
  lg: '640px'
};

const dialogWidth = computed(() => widthMap[props.size] || widthMap.md);
const dialogClass = computed(() => `mc-dialog mc-dialog--${props.size}`);
</script>

<template>
  <el-dialog
    v-model="open"
    :title="title"
    :width="dialogWidth"
    :class="dialogClass"
    align-center
    :append-to-body="appendToBody"
    :show-close="showClose"
    :close-on-click-modal="closeOnClickModal"
    :close-on-press-escape="closeOnPressEscape"
    :destroy-on-close="destroyOnClose"
    @open="emit('open')"
    @closed="emit('closed')"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <div class="mc-dialog-actions">
        <slot name="footer" />
      </div>
    </template>
  </el-dialog>
</template>
