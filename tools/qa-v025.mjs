import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out = path.resolve('../../outputs/v025-compatible-integration');
mkdirSync(out, { recursive: true });
const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [], messages = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') messages.push(m.text().slice(0, 300)); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${server.port}/game.html`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForSelector('.title-screen', { timeout: 12000 }); }
  catch (error) {
    await page.screenshot({ path: path.join(out, 'boot-error.png') });
    console.log(JSON.stringify({ errors, messages, body: await page.evaluate(() => document.body.innerText.slice(0, 1200)) }));
    throw error;
  }
  console.log(JSON.stringify({ boot: true, errors, messages }));
} finally {
  writeFileSync(path.join(out, 'browser-diagnostics.json'), JSON.stringify({ errors, messages }, null, 2));
  await browser.close(); await server.close();
}
