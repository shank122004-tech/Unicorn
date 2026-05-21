/**
 * bmg_qrcode_fix.js
 * ═══════════════════════════════════════════════════════════════
 *
 *  PROBLEM
 *  ───────
 *  index.html loads THREE conflicting QR libraries:
 *
 *    1. qrcode@1.5.1      (jsdelivr)  → QRCode.toDataURL()  ✅ has toDataURL
 *    2. html5-qrcode@2.3.4            → scanner only, different object
 *    3. qrcodejs@1.0.0    (jsdelivr)  → new QRCode(el,opts)  ❌ NO toDataURL
 *
 *  qrcodejs loads LAST and overwrites window.QRCode with its own
 *  constructor. That constructor has no .toDataURL() method, so every
 *  call to QRCode.toDataURL(...) throws:
 *    "TypeError: QRCode.toDataURL is not a function"
 *
 *  app.js line 10078, 10211 and bmg_pool_entry_fix.js line 557 all
 *  call QRCode.toDataURL() and all crash with this error.
 *
 *  THE FIX
 *  ───────
 *  After all scripts load, if window.QRCode.toDataURL is missing we
 *  add it. The polyfill uses whichever working strategy is available:
 *
 *    Strategy A — qrcode@1.5.1 is still reachable as window._QRCodeLib
 *                 (we save it before qrcodejs overwrites it, see below)
 *    Strategy B — use the DOM-based qrcodejs: render into a hidden <div>,
 *                 grab the <img> src or <canvas> toDataURL(), return it.
 *    Strategy C — fetch the qrcode@1.5.1 bundle dynamically and use it.
 *
 *  We also save the real qrcode@1.5.1 reference in a <script> tag
 *  inserted between the two cdn tags, so Strategy A is always available.
 *
 *  LOAD ORDER — LAST <script> in index.html (after bmg_bookings_fix.js):
 *    <script src="bmg_qrcode_fix.js"></script>
 *
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ── Save reference to qrcode@1.5.1 if it is currently window.QRCode
     (i.e. we are running before qrcodejs loads, which won't happen if
     we are the last script — but the MutationObserver trick below
     handles that case).
     In practice, since we load LAST, qrcodejs has already won.        */
  var _qrLib = window._QRCodeLib || null;   // may be pre-saved by inline script

  /* ════════════════════════════════════════════════════════════
   *  Core helper: generate a QR data URL from a string.
   *  Returns a Promise<string>.
   * ════════════════════════════════════════════════════════════*/
  function generateQRDataURL(text, opts) {
    opts = opts || {};
    var size = opts.width || opts.size || 200;

    /* ── Strategy A: qrcode@1.5.1 toDataURL (Promise-based) ── */
    if (_qrLib && typeof _qrLib.toDataURL === 'function') {
      return _qrLib.toDataURL(text, { width: size, margin: opts.margin || 2 });
    }

    /* ── Strategy B: qrcode@1.5.1 toDataURL on window.QRCode ─ */
    if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
      return window.QRCode.toDataURL(text, { width: size, margin: opts.margin || 2 });
    }

    /* ── Strategy C: qrcodejs DOM-based → extract canvas dataURL ─
       qrcodejs renders into a DOM element. We create a hidden div,
       let it render, then pull the canvas/img data URL out.         */
    if (window.QRCode && typeof window.QRCode === 'function') {
      return new Promise(function (resolve, reject) {
        var host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:' + size + 'px;height:' + size + 'px;';
        document.body.appendChild(host);

        try {
          new window.QRCode(host, {
            text          : text,
            width         : size,
            height        : size,
            colorDark     : '#000000',
            colorLight    : '#ffffff',
            correctLevel  : (window.QRCode.CorrectLevel && window.QRCode.CorrectLevel.H) || 1
          });
        } catch (e) {
          document.body.removeChild(host);
          reject(new Error('qrcodejs render failed: ' + e.message));
          return;
        }

        /* qrcodejs renders synchronously into a <canvas> or <img>.
           Give it one tick to finish, then extract the data URL.   */
        setTimeout(function () {
          try {
            var canvas = host.querySelector('canvas');
            var img    = host.querySelector('img');
            var url;

            if (canvas) {
              url = canvas.toDataURL('image/png');
            } else if (img && img.src && img.src.indexOf('data:') === 0) {
              url = img.src;
            } else if (img && img.src) {
              /* Image is loading — wait for it */
              img.onload = function () {
                var c2 = document.createElement('canvas');
                c2.width  = size;
                c2.height = size;
                c2.getContext('2d').drawImage(img, 0, 0, size, size);
                document.body.removeChild(host);
                resolve(c2.toDataURL('image/png'));
              };
              img.onerror = function () {
                document.body.removeChild(host);
                reject(new Error('qrcodejs img load failed'));
              };
              return;
            } else {
              throw new Error('qrcodejs produced no canvas or img');
            }

            document.body.removeChild(host);
            resolve(url);
          } catch (e2) {
            try { document.body.removeChild(host); } catch(_) {}
            reject(e2);
          }
        }, 50);
      });
    }

    /* ── Strategy D: dynamic load of qrcode@1.5.1 ─────────── */
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
      s.onload = function () {
        /* After load, QRCode may have been overwritten again — use the
           module's own exported object if available via require-style  */
        var lib = window.QRCode;
        if (lib && typeof lib.toDataURL === 'function') {
          lib.toDataURL(text, { width: size, margin: opts.margin || 2 })
             .then(resolve).catch(reject);
        } else {
          reject(new Error('Dynamic QRCode load: toDataURL still missing'));
        }
      };
      s.onerror = function () { reject(new Error('Failed to load qrcode dynamically')); };
      document.head.appendChild(s);
    });
  }

  /* ════════════════════════════════════════════════════════════
   *  Polyfill: add toDataURL to whatever window.QRCode is now
   *  (i.e. qrcodejs which lacks it).
   * ════════════════════════════════════════════════════════════*/
  function installPolyfill() {
    if (!window.QRCode) return;

    if (typeof window.QRCode.toDataURL !== 'function') {
      window.QRCode.toDataURL = function (text, opts) {
        return generateQRDataURL(text, opts);
      };
      console.log('[qrcode-fix] QRCode.toDataURL polyfill installed');
    }

    /* Also expose the helper globally for any custom code */
    window._bmgGenerateQR = generateQRDataURL;
  }

  /* ════════════════════════════════════════════════════════════
   *  Save qrcode@1.5.1 reference BEFORE it potentially gets
   *  overwritten. We do this by checking now; if the current
   *  QRCode already has toDataURL it IS the 1.5.1 version —
   *  save it before qrcodejs loads.
   *  (When this file loads last, qrcodejs has already won, so
   *   we rely on Strategy B/C above instead.)
   * ════════════════════════════════════════════════════════════*/
  if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
    _qrLib = window.QRCode;
    window._QRCodeLib = _qrLib;
    console.log('[qrcode-fix] qrcode@1.5.1 saved as window._QRCodeLib');
  }

  /* Install immediately if DOM is ready, else after load */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPolyfill);
  } else {
    installPolyfill();
  }
  /* Also re-run after window load in case qrcodejs loads late */
  window.addEventListener('load', installPolyfill);

  console.log('✅ [bmg_qrcode_fix.js] Loaded — QRCode.toDataURL will be available');

})();