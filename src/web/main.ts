import { createApp } from 'vue';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import App from './App.vue';
import { registerAuthElementPlus } from './element-plus-auth';
import { prefetchBootstrap } from './queries/bootstrap';
import { queryClient } from './queryClient';
import router from './router';
import { bindAppShell } from './shell';
import './styles/auth.css';

// Overlap bootstrap network with module parse / Vue boot.
prefetchBootstrap();

const app = createApp(App);

bindAppShell(app);
app.use(router);
app.use(createPinia());
app.use(VueQueryPlugin, { queryClient });
registerAuthElementPlus(app);
app.mount('#app');
