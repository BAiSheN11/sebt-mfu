/**
 * Standalone Vite config for deployment to Vercel/Netlify.
 * Uses standard Vite (not the Lark preset) so no platform runtime is injected.
 */
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'sebt-title',
      transformIndexHtml(html) {
        return html
          .replace(/<title>.*?<\/title>/, '<title>SEBT.mfu</title>')
          .replace(/content="\{\{appName\}\}"/g, 'content="SEBT.mfu"')
          .replace(/\{\{appName\}\}/g, 'SEBT.mfu')
      },
    },
  ],
  resolve: {
    alias: [
      { find: '@lark-apaas/client-toolkit-lite/styles.css', replacement: path.resolve(__dirname, 'src/shims/empty.css') },
      { find: '@lark-apaas/client-toolkit-lite', replacement: path.resolve(__dirname, 'src/shims/lark-client-shim.tsx') },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: '@shared', replacement: path.resolve(__dirname, 'shared') },
    ],
  },
  build: {
    outDir: 'dist-standalone',
  },
})
