import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        governance: resolve(__dirname, 'governance.html'),
        archive: resolve(__dirname, 'archive.html'),
        person: resolve(__dirname, 'person.html'),
        topics: resolve(__dirname, 'topics.html'),
        polls: resolve(__dirname, 'polls.html'),
        commentary: resolve(__dirname, 'commentary.html'),
        manual: resolve(__dirname, 'manual.html'),
        compare: resolve(__dirname, 'compare.html'),
      },
    },
  },
})
