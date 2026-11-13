import { chromium } from 'playwright'

const origin = process.argv[2] || 'http://127.0.0.1:4181'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
try {
  const response = await page.goto(origin + '/asset-lab.html', { waitUntil: 'domcontentloaded' })
  if (!response?.ok()) throw new Error('asset-lab status ' + response?.status())
  const card = page.locator('article', { has: page.getByRole('heading', { name: '吳旭智官方肖像' }) })
  await card.waitFor()
  await card.getByRole('button', { name: '看來源與尺寸' }).click()
  await page.locator('#alDetail').getByText('portrait-wu-moi').waitFor()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  const count = await page.locator('#alCount').innerText()
  if (overflow) throw new Error('asset-lab overflow')
  console.log(JSON.stringify({ artLab: 'passed', count, overflow }))
} finally {
  await browser.close()
}
