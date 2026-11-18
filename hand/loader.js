// The first script of a hand page (hand/loader.js in the site): it loads the app's own table (hand/app/viewer.js: Skia drawn in the browser) and, if the browser cannot run it or it fails, the plain viewer (hand/viewer.js).
(function () {
  'use strict';
  var here = document.currentScript && document.currentScript.src;
  var base = here ? here.slice(0, here.lastIndexOf('/') + 1) : '/hand/';
  var plainLoaded = false;
  function plain() {
    if (plainLoaded) return;
    plainLoaded = true;
    var s = document.createElement('script');
    s.src = base + 'viewer.js';
    document.head.appendChild(s);
  }
  var canDraw = typeof WebAssembly === 'object' && !!document.createElement('canvas').getContext;
  if (!canDraw) return plain();
  window.__doodleViewerFailed = plain;
  var s = document.createElement('script');
  s.src = base + 'app/viewer.js';
  s.onerror = plain;
  document.head.appendChild(s);
})();
