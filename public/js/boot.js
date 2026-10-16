// Static boot diagnostics: CSP allows external scripts, never inline event handlers.
// i18n-ignore-file: pre-module legacy-browser fallback, as public/index.html.
// Boot diagnostics (plain ES5: runs everywhere). A browser too old for the app says so instead of spinning forever:
    // no ES modules (nomodule below), a module graph that cannot load (e.g. import maps: Safari / iOS < 16.4), or no
    // boot after 9 s.
    window.__spBootFail = function (why) {
      var e = document.getElementById('boot-err');
      if (!e || e.getAttribute('data-final')) return;
      var im;
      try { im = !!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap')); } catch (_x) { im = false; }
      e.textContent = why === 'old' || !im
        ? '当前浏览器版本过旧，无法运行本游戏。请升级到 iOS / iPadOS 16.4+（Safari 16.4+）、Chrome / Edge 90+ 或 Firefox 108+ 后刷新。'
        : '游戏脚本加载失败，请检查网络连接后刷新页面。';
      e.setAttribute('data-final', '1');
    };
    // a module graph that fails to link (bare specifier without import-map support) reports here, not on the <script>
    window.addEventListener('error', function (ev) {
      var b = document.getElementById('boot');
      if (!b || b.classList.contains('is-done')) return;
      var message = String(ev && ev.message || '');
      if (/specifier|resolve|import|module|Unexpected token|SyntaxError/i.test(message)) {
        window.__SP_BOOT_DIAGNOSTIC = { message: message, browser: navigator.userAgent };
        window.__spBootFail('load');
        var err = document.getElementById('boot-err'), retry = document.getElementById('boot-retry');
        if (err) err.textContent += '\n' + message;
        if (retry) retry.hidden = false;
      }
    });
  
// If modules never boot (very old browser / blocked script), explain instead of spinning forever.
    setTimeout(function () {
      var b = document.getElementById('boot'), e = document.getElementById('boot-err');
      if (b && !b.classList.contains('is-done') && e && !e.textContent) e.textContent = '加载时间较长…如长时间无响应，请使用最新版 Chrome / Edge / Safari / Firefox 并刷新页面。';
    }, 9000);
  
document.addEventListener('error', function (event) {
  if (event.target && event.target.id === 'sp-main') window.__spBootFail('load');
}, true);

var bootRetry = document.getElementById('boot-retry');
if (bootRetry && bootRetry.addEventListener) bootRetry.addEventListener('click', function () { location.reload(); });
