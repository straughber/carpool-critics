/* ========================================================
   CARPOOL CRITICS - INTERFERENCE BURSTS
   A state signal, not a texture. Every call names an effect
   from DESIGN_SYSTEM.md section 13; the CSS does the drawing.
   ======================================================== */
(function () {
  'use strict';

  var FPS = 12;

  function layerFor(host, effect) {
    var layer = host.querySelector(':scope > .intf[data-intf-owned="1"]');
    if (layer) return layer;
    layer = document.createElement('span');
    layer.className = 'intf ';
    layer.setAttribute('aria-hidden', 'true');
    layer.dataset.intfOwned = '1';
    host.appendChild(layer);
    host.classList.add('intf-host');
    return layer;
  }

  function setEffect(layer, effect, still) {
    layer.className = 'intf intf--' + effect + (still ? ' intf--still' : '');
  }

  /**
   * A short state signal. `settle` leaves the still frame in place, which is
   * what a 404 wants: one burst, then the state stays readable without motion.
   */
  function burst(host, effect, frames, options) {
    if (!host) return;
    var opts = options || {};
    var layer = layerFor(host, effect);
    setEffect(layer, effect, false);
    var ms = Math.max(1, frames || 2) / FPS * 1000;
    window.setTimeout(function () {
      if (opts.settle) setEffect(layer, effect, true);
      else if (layer.parentNode) layer.parentNode.removeChild(layer);
    }, ms);
  }

  /** Hold a state while it is true: noise still, head-switch still. */
  function hold(host, effect) {
    if (!host) return null;
    var layer = layerFor(host, effect);
    setEffect(layer, effect, true);
    return layer;
  }

  function clear(host) {
    if (!host) return;
    var layer = host.querySelector(':scope > .intf[data-intf-owned="1"]');
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    host.classList.remove('intf-host');
  }

  function init() {
    document.querySelectorAll('[data-intf-burst]').forEach(function (host) {
      var effect = host.dataset.intfBurst || 'noise';
      var frames = parseInt(host.dataset.intfFrames, 10) || 8;
      var settle = host.dataset.intfSettle === 'true';
      burst(host, effect, frames, { settle: settle });
    });
  }

  window.Interference = { burst: burst, hold: hold, clear: clear };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
