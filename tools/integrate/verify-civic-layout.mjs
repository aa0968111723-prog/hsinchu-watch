import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.argv[2] || 'http://127.0.0.1:4178'
const browser = await chromium.launch()
const page = await browser.newPage()
const widths = [320, 390, 430, 768, 1280]
const routes = ['/civic.html', '/index.html', '/governance.html', '/archive.html', '/maps.html', '/compare.html']
const problems = []
try {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 })
    for (const path of routes) {
      const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded' })
      if (!response?.ok()) problems.push(`${path} status ${response?.status()} at ${width}`)
      if (path === '/civic.html') await page.getByRole('heading', { name: '治理來源' }).waitFor()
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
        primary: document.querySelectorAll('nav[aria-label="主選單"] a').length,
        civic: document.querySelectorAll('nav.civic-nav a').length,
        civicShort: [...document.querySelectorAll('nav.civic-nav a')].some(link => {
          const rect = link.getBoundingClientRect()
          return rect.height < 44 || rect.width < 44
        }),
      }))
      if (metrics.overflow) problems.push(`${path} overflow ${metrics.scroll}>${metrics.inner} at ${width}`)
      if (metrics.civic !== 9) problems.push(`${path} civic links ${metrics.civic}`)
      const expectedPrimary = path === '/governance.html' || path === '/archive.html' ? 5 : 6
      if (metrics.primary !== expectedPrimary) problems.push(`${path} primary ${metrics.primary}`)
      if (width <= 430 && metrics.civicShort) problems.push(`${path} civic touch target at ${width}`)
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(origin + '/civic.html', { waitUntil: 'networkidle' })
  const feed = JSON.parse(await readFile(new URL('../../public/data/civic/feed.json', import.meta.url), 'utf8'))
  const text = await page.locator('main').innerText()
  for (const needle of ['9164', '6958', '尚未收錄', feed.last_success_at, '尚未接入', '實支 尚未取得', '鄭朝方', '邱臣遠', '待定位', '不是驗收或成效']) {
    if (!text.includes(needle)) problems.push('missing ' + needle)
  }
  if (/\bunknown\b/.test(text)) problems.push('raw unknown status')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const duration = await page.locator('nav.civic-nav a').first().evaluate(element => getComputedStyle(element).transitionDuration)
  if (duration !== '0s') problems.push('reduced motion ' + duration)
  await page.getByRole('button', { name: '重試未載入的檔案' }).click()
  await page.getByRole('heading', { name: '正式候選人' }).waitFor()
  await page.locator('nav.civic-nav a', { hasText: '中央與法案' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.hash === '#central')
  const current = await page.locator('nav.civic-nav a.is-here').innerText()
  if (current !== '中央與法案') problems.push('current section ' + current)
  await page.screenshot({ path: 'tools/integrate/reports/civic-390.png' })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.screenshot({ path: 'tools/integrate/reports/civic-320.png' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: 'tools/integrate/reports/civic-1280.png' })
  console.log(JSON.stringify({ civicLayout: problems.length ? 'failed' : 'passed', problems }))
} finally {
  await browser.close()
}
process.exit(problems.length ? 1 : 0)
