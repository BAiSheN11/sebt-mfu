import path from 'path'
import { defineConfig } from '@lark-apaas/coding-preset-vite-react'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  plugins: [
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
})
