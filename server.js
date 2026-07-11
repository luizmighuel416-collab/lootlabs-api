import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
  "--disable-gpu",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];

async function waitForTasks(page, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await page.evaluate(() =>
      [...document.querySelectorAll("div[data-i][id]")]
        .filter(el => el.className.startsWith("task ")).length
    );
    if (count > 0) return count;
    await sleep(400);
  }
  throw new Error("Tasks never appeared");
}

async function clickAllTasks(page) {
  const taskIds = await page.evaluate(() =>
    [...document.querySelectorAll("div[data-i][id]")]
      .filter(el => el.className.startsWith("task "))
      .map(el => el.id)
  );

  for (const id of taskIds) {
    const div = await page.$(`[id="${id}"]`);
    if (!div) continue;
    const visible = await div.isVisible().catch(() => false);
    if (!visible) continue;

    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null),
      div.click({ timeout: 5000 }).catch(() => {}),
    ]);

    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      await sleep(25000);
      await popup.close();
    } else {
      await sleep(5000);
    }

    const ready = await page.evaluate(() => {
      const b = document.getElementById("unlockBtn");
      return b && !b.disabled && !b.hasAttribute("disabled");
    });
    if (ready) return;
  }
}

async function waitForUnlock(page, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => {
      const b = document.getElementById("unlockBtn");
      return b && !b.disabled && !b.hasAttribute("disabled");
    });
    if (ok) return await page.$("#unlockBtn");
    await sleep(500);
  }
  throw new Error("Unlock timed out");
}

async function bypassLootLabs(url) {
  const browser = await chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
  });
  try {
    const context = await browser.newContext({
      userAgent: ANDROID_UA,
      viewport: { width: 390, height: 844 },
      locale: "en-US",
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForTasks(page);
    await clickAllTasks(page);
    const btn = await waitForUnlock(page);

    const [newTab] = await Promise.all([
      context.waitForEvent("page", { timeout: 15000 }).catch(() => null),
      btn.click(),
    ]);

    let finalUrl;
    if (newTab) {
      await newTab.waitForLoadState("domcontentloaded").catch(() => {});
      finalUrl = newTab.url();
    } else {
      await page.waitForNavigation({ timeout: 15000, waitUntil: "commit" }).catch(() => {});
      finalUrl = page.url();
    }

    if (!finalUrl || finalUrl.includes("lootlabs") || finalUrl.includes("loot.gg")) {
      const el = await page.$("input[readonly],[id*=result],[class*=result],[id*=link]").catch(() => null);
      if (el) {
        finalUrl = (await el.getAttribute("value").catch(() => null))
          || (await el.innerText().catch(() => null))
          || finalUrl;
      }
    }

    return finalUrl;
  } finally {
    await browser.close();
  }
}

app.post("/bypass", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing 'url' in body" });

  try {
    const result = await bypassLootLabs(url);
    res.json({ success: true, url: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`[API] Running on port ${PORT}`));
