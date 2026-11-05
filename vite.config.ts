import { defineConfig, loadEnv } from 'vite';
import { backendTarget } from './scripts/dev-support';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
  const target = backendTarget({ ...loadEnv(mode, process.cwd(), ''), ...process.env });
  return {
    plugins: [react(), tailwindcss()],
    server: {
      watch: { ignored: ['**/.data/**', '**/test-results/**', '**/.npm-cache/**'] },
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', '**/test-results/**'],
      },
      proxy: {
        '/api': target,
        '/ws': {
          target: target.replace(/^http/, 'ws'),
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            three: ['three', '@react-three/fiber', '@react-three/drei'],
          },
        },
      },
    },
  };
});
