import { chromium, devices } from "/Users/styserg/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const OUT = process.argv[2]; const BASE = "http://localhost:3111";
const targets = [
  { name: "desktop1440", opts: { viewport: { width: 1440, height: 900 } } },
  { name: "tablet834", opts: { viewport: { width: 834, height: 1112 } } },
  { name: "pixel7", opts: { ...devices["Pixel 7"] } },
];
const browser = await chromium.launch();
for (const t of targets) {
  const ctx = await browser.newContext(t.opts);
  for (const p of ["home:/", "rooms:/rooms"]) {
    const [tag, path] = p.split(":");
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight + 600; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${t.name}-${tag}-full.png`, fullPage: true });
    const h = t.opts.viewport ? t.opts.viewport.height : 915;
    for (let i = 0; i < 3; i++) { await page.evaluate((y) => window.scrollTo(0, y), i * h); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${t.name}-${tag}-s${i}.png` }); }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
