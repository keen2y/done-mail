import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: 'index.html',
        public: 'public.html'
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/vue-router') || id.includes('node_modules/pinia')) {
            return 'vue';
          }
          if (id.includes('@codemirror')) return 'code-editor';
          // Do not force all of element-plus into one chunk — login only needs form/input.
          if (id.includes('@tanstack/vue-query')) return 'query';
          return undefined;
        }
      }
    }
  }
});
