import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--disable-gpu', '--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [], responses = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', msg => { if (msg.type() === 'error') errors.push({ text: msg.text(), location: msg.location() }); });
page.on('response', response => { if (response.status() >= 400) responses.push({ url: response.url(), status: response.status() }); });
try {
  await page.goto('http://127.0.0.1:27630/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '../browser-030.png', fullPage: true });
  const state = await page.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 1800),
    generation: window.__SP_GENERATION, sw: navigator.serviceWorker.controller?.scriptURL }));
  const result = { errors, responses, state };
  await fs.writeFile('../browser-030.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
