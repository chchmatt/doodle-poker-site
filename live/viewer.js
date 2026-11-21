// The page of a LIVE stack on the website (doodlepoker.com/live/?id=<id>): plain JavaScript, no framework and no build step. scripts/make-site.js copies this file to live/viewer.js in the site.
// It loads the page's one small file by ?id= from the cloud's storage (or this site's own live/ for a sample), checks it, draws the chart of the stack as the app draws it (a pen line on paper), the newest figure large,
// how long it has been going, the status, when it was last updated, a tournament's things and the player's notes in order, and looks again every half minute until the session is over. The functions that work things out
// (usable, money, chartPath, render, sourceOf) are plain and are tested by npm test; only start() needs a page.
(function (root) {
  'use strict';
  var BLOB = 'https://doodlepokerhands.blob.core.windows.net'; // (where a live page lives: live/<id>.json)
  var EVERY = 30000; // (it looks again this often while the session is going)
  var QUIET = 20 * 60000; // (a page that is going and has not been updated for this long says it has gone quiet)

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** Where a page's file is: the cloud's storage for an id the cloud made (22 letters and digits), or this site's own for the samples (sample-cash). Null for anything else. */
  function sourceOf(id) {
    if (/^[0-9A-Za-z]{22}$/.test(id)) return BLOB + '/live/' + id + '.json';
    if (/^sample-[a-z]{1,12}$/.test(id)) return '/live/' + id + '.json';
    return null;
  }

  /** Is this a live page the viewer can show? */
  function usable(p) {
    return !!p && p.v === 1 && Array.isArray(p.points) && Array.isArray(p.notes) && typeof p.status === 'string' && typeof p.startedAt === 'number' && typeof p.updatedAt === 'number' && ['shape', 'bb', 'money', 'chips'].indexOf(p.kind) >= 0;
  }

  function commas(n) {
    return String(Math.round(n * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** A figure in the kind the page shows: money with its symbol, big blinds with BB, chips plain; the shape only has no figures. */
  function money(p, n) {
    if (p.kind === 'money') return (n < 0 ? '−' : '') + (p.currency || '') + commas(Math.abs(n));
    if (p.kind === 'bb') return commas(n) + ' BB';
    if (p.kind === 'chips') return commas(n);
    return '';
  }
  function cost(p, n) {
    return (p.currency || '') + commas(n);
  }

  function duration(ms) {
    var m = Math.max(0, Math.floor(ms / 60000));
    var h = Math.floor(m / 60);
    return h ? h + ' h ' + (m % 60) + ' min' : m + ' min';
  }
  function ago(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 45) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
    var h = Math.round(m / 60);
    if (h < 48) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
    var d = Math.round(h / 24);
    return d + ' day' + (d === 1 ? '' : 's') + ' ago';
  }
  function clock(t) {
    var d = new Date(t);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  /**
   * The line as an SVG path in a box of w by h: time goes across, the stack up. A little deterministic wobble (the same every time, so a page does not shake on each look) gives the pen-drawn look. Returns the path text and the
   * place of the last point.
   */
  function chartPath(points, w, h) {
    var pad = 14;
    if (!points.length) return { d: '', x: 0, y: 0 };
    var t0 = points[0].t;
    var t1 = points[points.length - 1].t;
    var lo = Infinity;
    var hi = -Infinity;
    points.forEach(function (p) {
      lo = Math.min(lo, p.v);
      hi = Math.max(hi, p.v);
    });
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    var xs = [];
    var ys = [];
    points.forEach(function (p, i) {
      var fx = t1 === t0 ? (points.length === 1 ? 0.5 : i / (points.length - 1)) : (p.t - t0) / (t1 - t0);
      xs.push(pad + fx * (w - 2 * pad) + Math.sin(i * 2.7) * 0.6);
      ys.push(h - pad - ((p.v - lo) / (hi - lo)) * (h - 2 * pad) + Math.cos(i * 3.1) * 0.6);
    });
    // (a step line: the stack is what it was until the next thing changed it; the corners are rounded by the pen's line join)
    var d = 'M' + xs[0].toFixed(1) + ' ' + ys[0].toFixed(1);
    for (var i = 1; i < xs.length; i++) d += ' L' + xs[i].toFixed(1) + ' ' + ys[i - 1].toFixed(1) + ' L' + xs[i].toFixed(1) + ' ' + ys[i].toFixed(1);
    return { d: d, x: xs[xs.length - 1], y: ys[ys.length - 1], lo: lo, hi: hi };
  }

  var STATUS = { going: 'LIVE', break: 'On a break', over: 'Session over', stopped: 'Page ended' };

  /** The words about a tournament: the buy-in, the rebuys and add-ons so far, the blind level and the players left. */
  function tournamentHtml(p) {
    var t = p.t;
    if (!t) return '';
    var rows = [];
    if (t.buyIn !== undefined) rows.push(['Buy-in', cost(p, t.buyIn) + (t.fee ? ' + ' + cost(p, t.fee) + ' fee' : '')]);
    if (t.rebuys !== undefined) rows.push(['Rebuys', t.rebuys + (t.rebuyCost ? ' (' + cost(p, t.rebuyCost) + ')' : '')]);
    if (t.addOns !== undefined) rows.push(['Add-ons', t.addOns + (t.addOnCost ? ' (' + cost(p, t.addOnCost) + ')' : '')]);
    if (t.level !== undefined) rows.push(['Blind level', String(t.level)]);
    if (t.left !== undefined) rows.push(['Players left', t.left + (t.of ? ' of ' + t.of : '')]);
    if (!rows.length) return '';
    return (
      '<ul class="lv-facts">' +
      rows
        .map(function (r) {
          return '<li><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></li>';
        })
        .join('') +
      '</ul>'
    );
  }

  /** The whole page as HTML, for the page as it is and the time it is now. */
  function render(p, now) {
    var last = p.points[p.points.length - 1];
    var over = p.status === 'over' || p.status === 'stopped';
    var end = over ? p.endedAt || p.updatedAt : now;
    var quiet = !over && now - p.updatedAt > QUIET;
    var chart = chartPath(p.points, 560, 220);
    var who = p.name ? esc(p.name) + (p.name.slice(-1) === 's' ? '’ session' : '’s session') : 'A poker session';
    var meta = [p.game];
    if (p.stakes) meta.push(p.stakes);
    if (p.place) meta.push(p.place);
    var big = p.kind === 'shape' ? '<p class="lv-shape">The shape only: no amounts are shared.</p>' : last ? '<p class="lv-big" aria-label="Stack now">' + esc(money(p, last.v)) + '</p><p class="lv-label">Stack now</p>' : '';
    var lows =
      p.kind === 'shape' || !last
        ? ''
        : '<p class="lv-range">Lowest ' + esc(money(p, chart.lo)) + ' · Highest ' + esc(money(p, chart.hi)) + '</p>';
    var notes = p.notes.length
      ? '<h2 class="lv-h">Updates</h2><ol class="lv-notes">' +
        p.notes
          .map(function (n) {
            return '<li><em>' + esc(clock(n.t)) + '</em> ' + esc(n.text) + '</li>';
          })
          .join('') +
        '</ol>'
      : '';
    return (
      '<p class="lv-status s-' + esc(p.status) + (quiet ? ' quiet' : '') + '"><span class="lv-dot"></span>' + esc(STATUS[p.status] || p.status) + '</p>' +
      '<h1 class="lv-title">' + who + '</h1>' +
      (p.words ? '<p class="lv-words">' + esc(p.words) + '</p>' : '') +
      '<p class="lv-meta">' + esc(meta.join(' · ')) + '</p>' +
      big +
      '<svg class="lv-chart" viewBox="0 0 560 220" role="img" aria-label="The stack through the session">' +
      '<path d="M14 206 L546 206" class="lv-base"/>' +
      (chart.d ? '<path d="' + chart.d + '" class="lv-line"/><circle cx="' + chart.x.toFixed(1) + '" cy="' + chart.y.toFixed(1) + '" r="6" class="lv-end"/>' : '') +
      '</svg>' +
      lows +
      '<p class="lv-time">' + (over ? 'Played for ' : 'Going for ') + esc(duration(end - p.startedAt)) + '</p>' +
      '<p class="lv-updated' + (quiet ? ' quiet' : '') + '">Last updated ' + esc(ago(now - p.updatedAt)) + (quiet ? '. It has gone quiet: no news for a while.' : '') + (over ? '' : '. This page looks again every half minute.') + '</p>' +
      tournamentHtml(p) +
      notes
    );
  }

  function gone(el) {
    el.innerHTML = '<h2>This live page is not here</h2><p>It may have ended and been taken down, or the address may have a typo. Nothing is wrong: the person who shared it can start another.</p><div class="buttons"><a class="button" href="/">Doodle Poker home</a></div>';
    el.removeAttribute('aria-busy');
  }

  function start() {
    var el = document.getElementById('live');
    if (!el) return;
    var id = new URLSearchParams(location.search).get('id');
    var source = id ? sourceOf(id) : null;
    if (!source) return gone(el);
    var page = null;
    var timer = null;
    var sample = /^sample-/.test(id); // (a sample is shown as it was a few minutes after its last update, so it looks the way a live page does)
    function draw() {
      if (!page) return;
      el.innerHTML = render(page, sample ? page.updatedAt + 240000 : Date.now());
      el.removeAttribute('aria-busy');
      document.title = (page.name ? page.name + ' — ' : '') + (STATUS[page.status] || 'Live') + ' | Doodle Poker';
    }
    function load() {
      fetch(source, { cache: 'no-cache' })
        .then(function (r) {
          if (!r.ok) {
            var no = new Error('not found');
            no.gone = r.status === 404 || r.status === 403;
            throw no;
          }
          return r.json();
        })
        .then(function (p) {
          if (!usable(p)) return gone(el);
          page = p;
          draw();
          if (p.status === 'over' || p.status === 'stopped') clearInterval(timer);
        })
        .catch(function (e) {
          // (a page we already showed that cannot be reached for a moment stays on the screen; one that never loaded, or was taken down, says so)
          if (!page || (e && e.gone)) {
            clearInterval(timer);
            gone(el);
          } else draw();
        });
    }
    load();
    timer = setInterval(load, EVERY);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { usable: usable, money: money, chartPath: chartPath, render: render, sourceOf: sourceOf, ago: ago, duration: duration };
  else root.DoodlePokerLive = { render: render };
})(typeof window !== 'undefined' ? window : this);
