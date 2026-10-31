/* ========================================================
   CARPOOL CRITICS - ASCII AUDIO VISUALIZER (web renderer)
   One envelope, two renderers. This consumes the quantized
   glyph indices written by tools/ascii_visualizer.py, or
   generates a deterministic idle strip when there is no audio.
   The mapping lives in Python; this file only draws indices.
   Contract: DESIGN_SYSTEM.md section 12.7
   ======================================================== */
(function () {
  'use strict';

  var STYLES = {
    bars: { glyphs: '▁▂▃▄▅▆▇█', rows: 1 },
    cells: { glyphs: '░▒▓█', rows: 1 },
    spectrum: { glyphs: '█', rows: 4 }
  };

  function idleFrames(width, style, seconds) {
    var spec = STYLES[style] || STYLES.bars;
    var levels = style === 'spectrum' ? spec.rows : spec.glyphs.length - 1;
    var fps = 12;
    var frames = [];
    var state = 0x5EED;
    for (var frame = 0; frame < fps * (seconds || 4); frame += 1) {
      var row = [];
      for (var band = 0; band < width; band += 1) {
        state = (1103515245 * state + 12345) & 0x7FFFFFFF;
        var noise = (state % 1000) / 1000;
        var envelope = 0.35 + 0.45 * Math.abs(Math.sin((frame / fps) * 1.7 + band * 0.31));
        row.push(Math.min(levels, Math.round((envelope * 0.7 + noise * 0.3) * levels)));
      }
      frames.push(row);
    }
    return frames;
  }

  function draw(frame, glyphs, style, rows) {
    if (style === 'spectrum') {
      var lines = [];
      var span = rows || 4;
      for (var row = span - 1; row >= 0; row -= 1) {
        lines.push(frame.map(function (level) {
          return level > row ? '█' : ' ';
        }).join(''));
      }
      return lines.join('\n');
    }
    return frame.map(function (level) {
      return glyphs[Math.min(level, glyphs.length - 1)];
    }).join('');
  }

  function stop(element) {
    if (element._vizRAF) window.cancelAnimationFrame(element._vizRAF);
    element._vizRAF = null;
  }

  function drawIdleFrame(element, frames, style, glyphs, rows) {
    element.textContent = draw(frames[Math.floor(frames.length / 3)], glyphs, style, rows);
  }

  function startIdle(element) {
    stop(element);
    var style = element.dataset.style || 'bars';
    var spec = STYLES[style] || STYLES.bars;
    var width = parseInt(element.dataset.width, 10) || 32;
    var rows = parseInt(element.dataset.rows, 10) || spec.rows;
    var fps = parseInt(element.dataset.fps, 10) || 12;
    var frames = idleFrames(width, style, 4);
    element._viz = null;
    drawIdleFrame(element, frames, style, spec.glyphs, rows);

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var start = null;
    var last = -1;
    function tick(now) {
      if (start === null) start = now;
      var index = Math.floor(((now - start) / 1000) * fps) % frames.length;
      if (index !== last) {
        last = index;
        element.textContent = draw(frames[index], spec.glyphs, style, rows);
      }
      element._vizRAF = window.requestAnimationFrame(tick);
    }
    element._vizRAF = window.requestAnimationFrame(tick);
  }

  function indexAt(element, seconds) {
    var viz = element._viz;
    if (!viz || !viz.frames) return 0;
    var index = Math.floor(seconds * viz.fps);
    if (index < 0) index = 0;
    return index % viz.frames;
  }

  function drawSignalFrame(element, index) {
    var viz = element._viz;
    if (!viz) return;
    var start = index * viz.width;
    var row = Array.prototype.slice.call(viz.data.subarray(start, start + viz.width));
    element.textContent = draw(row, viz.glyphs, viz.style, viz.rows);
  }

  function startLoop(element) {
    stop(element);
    var viz = element._viz;
    if (!viz) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      drawSignalFrame(element, Math.floor(viz.frames / 3));
      return;
    }
    var start = null;
    var last = -1;
    function tick(now) {
      if (start === null) start = now;
      var index = Math.floor(((now - start) / 1000) * viz.fps) % viz.frames;
      if (index !== last) {
        last = index;
        drawSignalFrame(element, index);
      }
      element._vizRAF = window.requestAnimationFrame(tick);
    }
    element._vizRAF = window.requestAnimationFrame(tick);
  }

  function loadSignal(element, meta) {
    stop(element);
    if (!meta || !meta.url) {
      startIdle(element);
      return Promise.resolve(false);
    }
    return fetch(meta.url, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        var width = parseInt(meta.width, 10) || 32;
        var data = new Uint8Array(buffer);
        var frames = Math.floor(data.length / width);
        if (!frames) throw new Error('empty envelope');
        element._viz = {
          data: data,
          width: width,
          frames: frames,
          fps: parseInt(meta.fps, 10) || 12,
          rows: parseInt(meta.rows, 10) || 1,
          style: meta.style || element.dataset.style || 'bars',
          glyphs: (meta.glyphs || STYLES.bars.glyphs)
        };
        // Frame zero immediately: a hidden tab has no rAF and an empty <pre>
        // collapses the layout.
        drawSignalFrame(element, 0);
        if (element._playing) syncToPlayer(element);
        else startLoop(element);
        return true;
      })
      .catch(function () {
        element._viz = null;
        startIdle(element);
        return false;
      });
  }

  /** Map the playing video's clock onto the envelope; no clock, no claim. */
  function syncToPlayer(element) {
    stop(element);
    var player = element._player;
    var viz = element._viz;
    if (!player || !viz || typeof player.getCurrentTime !== 'function') {
      startLoop(element);
      return;
    }
    function drawNow() {
      var index = indexAt(element, player.getCurrentTime() || 0);
      element._lastSignalIndex = index;
      drawSignalFrame(element, index);
    }
    // Draw the current playhead synchronously: a throttled tab may not deliver
    // an rAF, and a strip that waits for one reads as broken.
    try {
      drawNow();
    } catch (err) {
      startLoop(element);
      return;
    }
    function tick() {
      try {
        drawNow();
      } catch (err) {
        startLoop(element);
        return;
      }
      element._vizRAF = window.requestAnimationFrame(tick);
    }
    element._vizRAF = window.requestAnimationFrame(tick);
  }

  function attachPlayer(element, player) {
    element._player = player;
  }

  function setPlaying(element, playing) {
    element._playing = Boolean(playing);
    if (!element) return;
    if (playing && element._viz) syncToPlayer(element);
    else stop(element);
    if (!playing && element._viz) {
      // Freeze on the last frame drawn; the strip is a reading, not a toy.
      drawSignalFrame(element, element._lastSignalIndex || 0);
    }
  }

  function mount(element) {
    if (element.dataset.asciiVizReady === '1') return;
    element.dataset.asciiVizReady = '1';
    if (element.dataset.envelope) {
      loadSignal(element, { url: element.dataset.envelope });
    } else {
      startIdle(element);
    }
  }

  function init() {
    var nodes = document.querySelectorAll('[data-ascii-viz]');
    for (var i = 0; i < nodes.length; i += 1) mount(nodes[i]);
  }

  window.AsciiVisualizer = {
    mount: mount,
    loadSignal: loadSignal,
    attachPlayer: attachPlayer,
    setPlaying: setPlaying,
    stop: stop,
    idleFrames: idleFrames,
    STYLES: STYLES
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
