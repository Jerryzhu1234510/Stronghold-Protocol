// i18n-ignore-file: retained standalone Chinese portal/bootstrap configuration, outside the translated game UI.

    // Run before the game connects. Old pages already in a match keep their
    // existing connection; the build guard sends them here after settlement.
    (function () {
      var source = window.location;
      var hosts = ['weishuxieyiwangye.cn'];
      if (source.protocol === 'http:' && hosts.indexOf(source.hostname.toLowerCase()) !== -1) {
        window.__SP_HTTPS_REDIRECTING = true;
        source.replace('https://weishuxieyiwangye.cn:8443/game.html' + source.search + source.hash);
      }
    }());
  