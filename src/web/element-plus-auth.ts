import type { App } from 'vue';
import { ElForm, ElFormItem } from 'element-plus/es/components/form/index.mjs';
import { ElInput } from 'element-plus/es/components/input/index.mjs';
import { provideGlobalConfig } from 'element-plus/es/components/config-provider/index.mjs';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/theme-chalk/base.css';
import 'element-plus/theme-chalk/el-form.css';
import 'element-plus/theme-chalk/el-form-item.css';
import 'element-plus/theme-chalk/el-icon.css';
import 'element-plus/theme-chalk/el-input.css';
import 'element-plus/theme-chalk/el-message.css';
import 'element-plus/theme-chalk/el-overlay.css';
import 'element-plus/theme-chalk/el-popper.css';

const components = [ElForm, ElFormItem, ElInput];

export function registerAuthElementPlus(app: App) {
  provideGlobalConfig({ locale: zhCn }, app, true);
  for (const component of components) {
    app.use(component);
  }
}
