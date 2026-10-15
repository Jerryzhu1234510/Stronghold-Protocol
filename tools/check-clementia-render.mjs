/* global window */
// Headless Edge smoke test of the production Spine loader and actor, for both facings × every skill.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '../../outputs/clementia-upstream');
const html = `<!doctype html><meta charset="utf-8"><title>Clementia local model test</title>
<style>body{margin:0;background:#091713;color:#abffdf;font:16px system-ui}h1,p{margin:12px 24px}canvas{display:block}</style>
<h1>克莱门莎 · 本地动画测试</h1><p>正面 / 背面 × 三个技能 · 现有游戏渲染器</p>
<script src="/vendor/pixi.min.js"></script><script src="/vendor/pixi-spine.js"></script>
<script type="module">
import { SpineActor } from '/js/render/spine.js';
import { loadSpineData } from '/js/assets.js';
try {
  const manifest=await (await fetch('/data/assets.json')).json();
  const app=new PIXI.Application({width:1200,height:620,backgroundColor:0x091713,antialias:true,autoStart:false});
  document.body.append(app.view);
  const checks=[];
  for (const [row,side] of ['front','back'].entries()) {
    const entry=manifest.chars.char_4231_clemnt.spine[side];
    const data=await loadSpineData(entry);
    for (let skill=0;skill<3;skill++) {
      const actor=new SpineActor(data,entry); actor.setSkillIndex(skill);
      actor.spine.position.set(200+skill*400,250+row*300); actor.spine.scale.set(.55);
      app.stage.addChild(actor.spine);
      actor.setSkill(true); actor.update(.6); actor.attack(.6); actor.update(.12);
      const label=new PIXI.Text((side==='front'?'正面':'背面')+' · 技能 '+(skill+1),{fill:0xabffdf,fontSize:20});
      label.position.set(145+skill*400,20+row*300); app.stage.addChild(label);
      const track=actor.spine.state.getCurrent(0)?.animation?.name;
      if (!track || !track.includes('Skill')) throw Error('Skill animation not selected: '+side+' '+skill+' '+track);
      const bounds=actor.spine.getLocalBounds();
      if (!(bounds.width>0 && bounds.height>0)) throw Error('Empty model bounds');
      checks.push({side,skill:skill+1,track,width:bounds.width,height:bounds.height});
    }
  }
  app.render(); window.__qa={passed:true,checks};
} catch (e) {window.__qa={passed:false,error:String(e),stack:e.stack};}
</script>`;
const bad = [];
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const parent = path.startsWith('/data/') ? root : resolve(root, 'public');
    const target = resolve(parent, `.${path}`);
    if (!target.startsWith(parent + '\\')) throw new Error('Outside static root');
    const mime = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.atlas': 'text/plain' };
    res.setHeader('content-type', mime[extname(target)] ?? 'application/octet-stream');
    res.end(await readFile(target));
  } catch (e) { bad.push({ url: req.url, error: String(e) }); res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 1200, height: 720 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__qa, { timeout: 45000 });
  const report = { ...(await page.evaluate(() => window.__qa)), errors, missing: bad };
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'browser-render.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: resolve(out, 'browser-render.png') });
  console.log(JSON.stringify(report));
  assert.equal(report.passed, true); assert.deepEqual(errors, []); assert.deepEqual(bad, []);
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
