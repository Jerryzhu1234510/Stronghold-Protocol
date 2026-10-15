import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const out = 'D:/Codex/2026-10-10/a/outputs/r28-selector';
const { generation } = JSON.parse(readFileSync(out + '/deployment.json', 'utf8'));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const report = { generation, passed: false, viewports: [], errors: [] };
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
    const page = await browser.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.setViewport(viewport);
    const received = page.waitForResponse(response => response.url() === 'https://weishuxieyiwangye.cn:8443/lobby/status.json' && response.status() === 200);
    await page.goto('https://weishuxieyi.icu/', { waitUntil: 'domcontentloaded' });
    assert.equal(new URL(page.url()).pathname, '/_build/' + generation + '/');
    const response = await received;
    const payload = await response.json();
    await page.waitForFunction(() => document.querySelector('#state-8443').textContent === '在线' && !document.querySelector('#refresh-status').disabled);
    const metrics = await page.evaluate(() => Object.fromEntries(['online', 'rooms', 'matches', 'waiting'].map(key => [key, document.querySelector('#' + key + '-8443').textContent])));
    for (const key of Object.keys(metrics)) assert.equal(metrics[key], payload.nodes['8443'][key].toLocaleString('zh-CN'));
    assert.notEqual(await page.$eval('#online-icu', el => el.textContent), '—');
    assert.equal(await page.$eval('[data-enter="8443"]', el => el.href), 'https://weishuxieyiwangye.cn:8443/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await page.$eval('.server-grid', el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.screenshot({ path: out + '/selector-' + viewport.width + '.png' });
    report.viewports.push({ viewport, metrics, cors: response.headers()['access-control-allow-origin'], overflow });
    await page.click('[data-enter="icu"]');
    await page.waitForFunction(generation => location.pathname === '/_build/' + generation + '/game.html', {}, generation);
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await browser.close();
  writeFileSync(out + '/production-browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
