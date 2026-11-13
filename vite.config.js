import { defineConfig } from 'vite'
import { existsSync } from 'node:fs'
import { resolve } from 'path'

const input = {
  main: resolve(__dirname, 'index.html'),
  governance: resolve(__dirname, 'governance.html'),
  archive: resolve(__dirname, 'archive.html'),
  lab: resolve(__dirname, 'ui-lab.html'),
  person: resolve(__dirname, 'person.html'),
  topics: resolve(__dirname, 'topics.html'),
  polls: resolve(__dirname, 'polls.html'),
  commentary: resolve(__dirname, 'commentary.html'),
  manual: resolve(__dirname, 'manual.html'),
  compare: resolve(__dirname, 'compare.html'),
  civic: resolve(__dirname, 'civic.html'),
}
if (existsSync(resolve(__dirname, 'atlas.html'))) {
  input.atlas = resolve(__dirname, 'atlas.html')
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input },
  },
})
