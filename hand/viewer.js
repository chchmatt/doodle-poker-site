// The viewer of a published hand on the website (doodlepoker.com/hand/<cards>/?id=<id>): plain JavaScript, no framework and no build step. scripts/make-site.js copies this file to hand/viewer.js in the site.
// It loads ../../hands/<id>.json (the shape of src/game/published-hand.ts), checks it, and shows the table, the cards, the actions and the pot, a step at a time. The functions that work things out
// (comboOf, frames) are plain and are tested by npm test; the part that draws needs a page.
(function (root) {
  'use strict';
  var RANKS = '23456789TJQKA';
  var SUITS = 'shdc';
  var NAMES = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

  /** The name of a hand's two hole cards in an address: higher rank first, and for a pair the suits in the order s, h, d, c ("Kc9c", "AsAc"); null if they are not two different cards. */
  function comboOf(cards) {
    if (!cards || cards.length !== 2 || cards[0] === cards[1]) return null;
    for (var i = 0; i < 2; i++) if (typeof cards[i] !== 'string' || cards[i].length !== 2 || RANKS.indexOf(cards[i][0]) < 0 || SUITS.indexOf(cards[i][1]) < 0) return null;
    var c = cards.slice().sort(function (a, b) {
      return RANKS.indexOf(b[0]) - RANKS.indexOf(a[0]) || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]);
    });
    return c[0] + c[1];
  }

  function money(h, n) {
    return h.currency + String(Math.round(n * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function labelOf(h, seat) {
    for (var i = 0; i < h.seats.length; i++) if (h.seats[i].seat === seat) return h.seats[i].label;
    return '?';
  }

  /** Is this a published hand the viewer can show, for the page of this combination of cards? */
  function usable(h, combo) {
    if (!h || h.v !== 1 || !Array.isArray(h.seats) || h.seats.length < 2 || !h.hero || !Array.isArray(h.streets)) return false;
    if (comboOf(h.hero.cards) !== combo) return false;
    return h.seats.some(function (s) {
      return s.seat === h.hero.seat;
    });
  }

  /**
   * The hand as a list of frames to step through: the blinds in, then for each street its cards and its actions, then the result. Each frame has the whole table as it is then: what each seat has left, what it
   * has put in on this street, who has folded, what each last did, the board so far and the pot.
   */
  function frames(h) {
    var stacks = {};
    var bets = {};
    var said = {};
    var folded = {};
    h.seats.forEach(function (s) {
      stacks[s.seat] = s.stack - (h.stakes.ante || 0);
      bets[s.seat] = 0;
    });
    var out = [];
    var board = [];
    var shownCards = {};
    function snap(text, extra) {
      var f = { text: text, stacks: Object.assign({}, stacks), bets: Object.assign({}, bets), said: Object.assign({}, said), folded: Object.assign({}, folded), board: board.slice(), pot: 0, acting: null, street: 'preflop', heading: false, cards: Object.assign({}, shownCards) };
      return Object.assign(f, extra || {});
    }
    var blindText = [];
    h.blinds.forEach(function (b) {
      stacks[b.seat] -= b.amount;
      bets[b.seat] = b.amount;
      said[b.seat] = 'posts ' + money(h, b.amount);
      blindText.push(labelOf(h, b.seat) + ' posts ' + money(h, b.amount));
    });
    out.push(snap(blindText.length ? blindText.join(', ') : 'The hand begins', { pot: h.pot0, street: 'preflop', heading: true, headline: 'Blinds' }));
    var pot = h.pot0;
    h.streets.forEach(function (st) {
      if (st.street !== 'preflop') {
        bets = {};
        said = {};
        h.seats.forEach(function (s) {
          bets[s.seat] = 0;
        });
        board = board.concat(st.board);
        out.push(snap(NAMES[st.street] + ': ' + st.board.join(' '), { pot: pot, street: st.street, heading: true, headline: NAMES[st.street], dealt: st.board.slice() }));
      }
      st.actions.forEach(function (a) {
        pot = a.pot;
        var seat = a.seat;
        var text;
        if (a.act === 'pot') text = 'The pot is now ' + money(h, a.pot);
        else {
          var who = labelOf(h, seat);
          stacks[seat] -= a.put;
          bets[seat] = (bets[seat] || 0) + a.put;
          if (a.act === 'fold') {
            folded[seat] = true;
            text = who + ' folds';
            said[seat] = 'folds';
          } else if (a.act === 'check') {
            text = who + ' checks';
            said[seat] = 'checks';
          } else if (a.act === 'call') {
            text = who + ' calls ' + money(h, a.amount === undefined ? a.put : a.amount);
            said[seat] = 'calls ' + money(h, a.put);
          } else if (a.act === 'bet') {
            text = who + ' bets ' + money(h, a.amount === undefined ? a.put : a.amount);
            said[seat] = 'bets ' + money(h, a.put);
          } else {
            text = who + ' raises to ' + money(h, a.amount === undefined ? a.put : a.amount);
            said[seat] = 'raises to ' + money(h, a.amount === undefined ? a.put : a.amount);
          }
          if (a.allIn) text += ' (all in)';
        }
        out.push(snap(text, { pot: a.pot, acting: seat === undefined ? null : seat, street: st.street, action: true }));
      });
    });
    // the result: the bet nobody called goes back, the pot is taken, the cards that were turned over are seen
    var bits = [];
    if (h.returned) {
      stacks[h.returned.seat] += h.returned.amount;
      bits.push('An uncalled ' + money(h, h.returned.amount) + ' goes back to ' + labelOf(h, h.returned.seat));
    }
    var names = [];
    (h.collected || []).forEach(function (c) {
      stacks[c.seat] += c.amount;
      names.push(labelOf(h, c.seat) + ' collects ' + money(h, c.amount));
    });
    if (names.length) bits.push(names.join(', '));
    (h.shown || []).forEach(function (s) {
      shownCards[s.seat] = s.cards;
    });
    bits.push('Pot ' + money(h, h.pot) + (h.rake ? ', rake ' + money(h, h.rake) : ''));
    bets = {};
    said = {};
    h.seats.forEach(function (s) {
      bets[s.seat] = 0;
    });
    out.push(snap(bits.join('. '), { pot: h.pot, street: 'river', heading: true, headline: 'Result', result: true }));
    return out;
  }

  // ---- drawing (needs a page) ----
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function card(c, cls) {
    var r = c[0] === 'T' ? '10' : c[0];
    var red = c[1] === 'h' || c[1] === 'd';
    return '<span class="pc' + (red ? ' red' : '') + (cls ? ' ' + cls : '') + '" aria-label="' + r + ' of ' + { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[c[1]] + '"><b>' + r + '</b><i class="su su-' + c[1] + '"></i></span>';
  }
  function cardsText(cards) {
    return cards
      .map(function (c) {
        return (c[0] === 'T' ? '10' : c[0]) + { s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]];
      })
      .join(' ');
  }
  function missing(el) {
    el.innerHTML = '<h2>Hand not found</h2><p>This link does not lead to a hand. The address may have a typo, or the hand may have been taken down.</p><div class="buttons"><a class="button" href="../../">Doodle Poker home</a></div>';
    el.removeAttribute('aria-busy');
  }

  function show(el, h) {
    var all = frames(h);
    var at = Math.max(0, Math.min(all.length - 1, Math.floor(Number(new URLSearchParams(location.search).get('step')) || 0))); // (?step=7 opens at that step: a link to a moment of the hand)
    var n = h.seats.length;
    var heroIndex = 0;
    h.seats.forEach(function (s, i) {
      if (s.seat === h.hero.seat) heroIndex = i;
    });
    var date = new Date(h.playedAt);
    var when = isNaN(date) ? '' : date.getUTCDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][date.getUTCMonth()] + ' ' + date.getUTCFullYear();
    var stakes = h.currency + h.stakes.sb + '/' + h.currency + h.stakes.bb + (h.code ? ' ' + h.code : '');
    document.title = cardsText(h.hero.cards) + ' — ' + stakes + ', pot ' + money(h, h.pot) + ' | Doodle Poker';
    var meta = ["No Limit Hold’em", stakes, h.max + '-max'];
    if (when) meta.push(when);
    if (h.number) meta.push('Hand #' + h.number);
    el.innerHTML =
      '<p class="hv-meta">' + esc(meta.join(' · ')) + '</p>' +
      '<div class="hv-table" id="hv-table"></div>' +
      '<div class="hv-controls" role="group" aria-label="Step through the hand">' +
      '<button type="button" id="hv-start">Start</button><button type="button" id="hv-back">◀ Back</button><button type="button" id="hv-next" class="primary">Next ▶</button><button type="button" id="hv-all">Show everything</button>' +
      '</div>' +
      '<p class="hv-now" id="hv-now" aria-live="polite"></p>' +
      '<ol class="hv-log" id="hv-log"></ol>';
    el.removeAttribute('aria-busy');
    var tableEl = el.querySelector('#hv-table');
    var nowEl = el.querySelector('#hv-now');
    var logEl = el.querySelector('#hv-log');
    function draw() {
      var f = all[at];
      var seatsHtml = h.seats
        .map(function (s, i) {
          var ang = ((90 + ((i - heroIndex) * 360) / n) * Math.PI) / 180;
          var x = 50 + 36 * Math.cos(ang);
          var y = 50 + 40 * Math.sin(ang);
          var cards = s.hero ? h.hero.cards : f.cards[s.seat];
          var cls = 'hv-seat' + (s.hero ? ' hero' : '') + (f.folded[s.seat] ? ' folded' : '') + (f.acting === s.seat ? ' acting' : '') + (f.result && (h.collected || []).some(function (c) { return c.seat === s.seat; }) ? ' won' : '');
          return (
            '<div class="' + cls + '" style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%">' +
            (s.seat === h.button ? '<span class="hv-btn" title="Dealer button">D</span>' : '') +
            (cards ? '<div class="hv-hole">' + cards.map(function (c) { return card(c, 'sm'); }).join('') + '</div>' : '') +
            '<div class="hv-name">' + esc(s.label) + '</div>' +
            '<div class="hv-stack">' + money(h, f.stacks[s.seat]) + '</div>' +
            '<div class="hv-said">' + (f.said[s.seat] ? esc(f.said[s.seat]) : '&nbsp;') + '</div>' +
            '</div>'
          );
        })
        .join('');
      var boardHtml = '';
      for (var i = 0; i < 5; i++) boardHtml += f.board[i] ? card(f.board[i], 'md') : '<span class="pc empty md"></span>';
      tableEl.innerHTML = '<div class="hv-felt"></div>' + seatsHtml + '<div class="hv-mid"><div class="hv-board">' + boardHtml + '</div><div class="hv-pot">Pot ' + money(h, f.pot) + '</div></div>';
      nowEl.textContent = f.text;
      var log = '';
      for (var j = 0; j <= at; j++) {
        var g = all[j];
        log += g.heading ? '<li class="hv-head' + (j === at ? ' now' : '') + '">' + esc(g.headline) + (g.dealt ? ' ' + g.dealt.map(function (c) { return card(c, 'sm'); }).join('') : '') + (j === 0 || g.result ? ' <span class="hv-sum">' + esc(g.text) + '</span>' : '') + '</li>' : '<li' + (j === at ? ' class="now"' : '') + '>' + esc(g.text) + ' <em>pot ' + money(h, g.pot) + '</em></li>';
      }
      logEl.innerHTML = log;
      el.querySelector('#hv-back').disabled = at === 0;
      el.querySelector('#hv-start').disabled = at === 0;
      el.querySelector('#hv-next').disabled = at === all.length - 1;
      el.querySelector('#hv-all').disabled = at === all.length - 1;
    }
    function go(to) {
      at = Math.max(0, Math.min(all.length - 1, to));
      draw();
    }
    el.querySelector('#hv-start').onclick = function () { go(0); };
    el.querySelector('#hv-back').onclick = function () { go(at - 1); };
    el.querySelector('#hv-next').onclick = function () { go(at + 1); };
    el.querySelector('#hv-all').onclick = function () { go(all.length - 1); };
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
    });
    draw();
  }

  function start() {
    var el = document.getElementById('hand');
    if (!el) return;
    var combo = el.getAttribute('data-combo');
    var id = new URLSearchParams(location.search).get('id');
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return missing(el);
    fetch('../../hands/' + id + '.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then(function (h) {
        if (!usable(h, combo)) return missing(el);
        show(el, h);
      })
      .catch(function () {
        missing(el);
      });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { comboOf: comboOf, frames: frames, usable: usable, money: money };
  else root.DoodlePokerHand = { comboOf: comboOf, frames: frames };
})(typeof window !== 'undefined' ? window : this);
