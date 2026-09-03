import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const DEV_SERVER_PORT = 24681
const PREVIEW_SERVER_PORT = 24682

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['node-pty', 'koffi'],
        input: {
          index: resolve(__dirname, 'src/core/electron/main/index.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/core/electron/preload/index.ts'),
          htmlPreview: resolve(__dirname, 'src/core/electron/preload/html-preview.ts'),
        },
      },
    },
  },
  renderer: {
    // renderer was moved from src/renderer to src/core/renderer
    root: resolve(__dirname, 'src/core/renderer'),
    plugins: [react(), tailwindcss()],
    server: {
      port: DEV_SERVER_PORT,
      strictPort: true,
    },
    preview: {
      port: PREVIEW_SERVER_PORT,
      strictPort: true,
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/core/renderer/index.html'),
          pdfViewer: resolve(__dirname, 'src/core/renderer/pdf-viewer.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/core/renderer'),
      },
    },
  },
})
