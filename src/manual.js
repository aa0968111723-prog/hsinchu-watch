import './lib/mobile-nav.js'

const template = document.getElementById('source-template')
const status = document.getElementById('copy-source-status')

document.getElementById('copy-source-template').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(template.value)
    status.textContent = '已複製格式。'
  } catch {
    template.focus()
    template.select()
    status.textContent = '已選取格式，可用裝置的複製功能。'
  }
})
