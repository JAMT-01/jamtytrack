
'use strict';
(function () {
  var NAV_FLAG = 'data-jamtytrack-habits-nav';

  /* Ten calendar weeks: the contribution-graph shape is immediately readable,
     but still compact enough for the app's narrowest supported phone. This is
     the same 70-day ceiling returned by worker/habits.ts. */
  var GRID_WEEKS = 10;

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) for (var key in attrs) node.setAttribute(key, attrs[key]);
    if (text != null) node.textContent = text;
    return node;
  }

  function trim(value) {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  function addDays(date, amount) {
    var p = date.split('-');
    var next = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + amount, 12));
    return next.getUTCFullYear() + '-' +
      String(next.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(next.getUTCDate()).padStart(2, '0');
  }

  function fmtDate(isoDate) {
    var p = isoDate.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12))
      .toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function fmtMonth(isoDate) {
    var p = isoDate.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12))
      .toLocaleDateString(undefined, { month: 'short' });
  }

  /* Monday is row zero. Date#getUTCDay uses Sunday as zero. */
  function weekdayIndex(isoDate) {
    var p = isoDate.split('-');
    return (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)).getUTCDay() + 6) % 7;
  }

  /* ------------------------------------------------------------- theming */
  /*
   * Read from the app, not hardcoded — see PROGRESS-PHOTOS.md §9. The first
   * version of the photos UI shipped a fixed dark palette into a light lime app
   * and looked pasted in from somewhere else. Sampling the live page is what
   * fixed it, and it keeps following the app if the theme is ever changed.
   */

  function parseColor(value) {
    var text = String(value || '').trim();
    var m = text.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(/[,\s\/]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3 && !(p.length > 3 && p[3] === 0)) return { r: p[0], g: p[1], b: p[2] };
      return null;
    }
    var hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hex) return null;
    var h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  function toCss(c) { return 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')'; }
  function rgba(c, a) { return 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + a + ')'; }
  function mix(a, b, amount) {
    return { r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount };
  }
  function luminance(c) { return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255; }
  function saturation(c) {
    var hi = Math.max(c.r, c.g, c.b), lo = Math.min(c.r, c.g, c.b);
    return hi === 0 ? 0 : (hi - lo) / hi;
  }

  function pageBackground() {
    var node = document.body;
    while (node) {
      var c = parseColor(getComputedStyle(node).backgroundColor);
      if (c) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255 };
  }

  function accentColor(pageBg, textColor) {
    var rootStyle = getComputedStyle(document.documentElement);
    var names = ['--accent', '--primary', '--brand', '--color-accent', '--color-primary',
      '--accent-color', '--primary-color', '--brand-color', '--theme-color', '--color-brand',
      '--lime', '--green', '--highlight', '--accent-1', '--c-accent'];
    for (var i = 0; i < names.length; i++) {
      var declared = parseColor(rootStyle.getPropertyValue(names[i]));
      if (declared && saturation(declared) > 0.15) return declared;
    }

    /* Scan DESCENDANTS of controls, not just the controls. This app puts its
       lime accent on a chip inside a pale card and on icon/heading text; the
       buttons themselves are near-white. Reading only button backgrounds is what
       once produced a blue button in a green app. */
    var tally = {};
    var best = null;
    function consider(color, weight) {
      if (!color || saturation(color) < 0.3) return;
      if (Math.abs(luminance(color) - luminance(pageBg)) < 0.06) return;
      var key = toCss(color);
      tally[key] = (tally[key] || 0) + weight;
      if (!best || tally[key] > tally[toCss(best)]) best = color;
    }

    var controls = document.querySelectorAll('button, a, [role="button"], [role="tab"]');
    for (var j = 0; j < controls.length && j < 200; j++) {
      consider(parseColor(getComputedStyle(controls[j]).backgroundColor), 3);
      var inner = controls[j].querySelectorAll('*');
      for (var k = 0; k < inner.length && k < 12; k++) {
        var innerStyle = getComputedStyle(inner[k]);
        consider(parseColor(innerStyle.backgroundColor), 2);
        consider(parseColor(innerStyle.color), 1);
      }
    }

    var texts = document.querySelectorAll('h1, h2, h3, h4, strong, b, [class*="accent" i], [class*="label" i]');
    for (var m = 0; m < texts.length && m < 120; m++) {
      consider(parseColor(getComputedStyle(texts[m]).color), 1);
    }

    if (best) return best;
    return textColor || (luminance(pageBg) > 0.5 ? { r: 30, g: 30, b: 32 } : { r: 235, g: 235, b: 240 });
  }

  function readTheme() {
    var bodyStyle = getComputedStyle(document.body);
    var rootStyle = getComputedStyle(document.documentElement);
    var bg = pageBackground();
    var dark = luminance(bg) < 0.5;
    function variable(names) {
      for (var i = 0; i < names.length; i++) {
        var found = parseColor(rootStyle.getPropertyValue(names[i]));
        if (found) return found;
      }
      return null;
    }

    var text = variable(['--ink', '--text', '--color-text']) || parseColor(bodyStyle.color) ||
      (dark ? { r: 245, g: 245, b: 247 } : { r: 20, g: 20, b: 22 });
    var accent = accentColor(bg, text);
    var surface = variable(['--surface', '--card', '--color-surface']) ||
      (dark ? mix(bg, { r: 255, g: 255, b: 255 }, 0.07) : mix(bg, { r: 255, g: 255, b: 255 }, 0.72));
    var soft = variable(['--soft', '--sunken', '--color-soft']) ||
      (dark ? mix(bg, { r: 255, g: 255, b: 255 }, 0.1) : mix(bg, { r: 0, g: 0, b: 0 }, 0.045));
    var line = variable(['--line', '--border', '--color-border']) || mix(text, bg, 0.86);
    var muted = variable(['--muted', '--color-muted']) || mix(text, bg, 0.45);

    var radiusTally = {};
    var radius = '';
    var controls = document.querySelectorAll('button, input, select, textarea');
    for (var k = 0; k < controls.length && k < 200; k++) {
      var r = getComputedStyle(controls[k]).borderRadius;
      if (!r || r === '0px' || r.indexOf('%') !== -1) continue;
      radiusTally[r] = (radiusTally[r] || 0) + 1;
      if (!radius || radiusTally[r] > radiusTally[radius]) radius = r;
    }
    if (!radius) radius = '10px';

    /* Controls are pills in Jamtytrack, while cards use a restrained 18-26px
       curve. Sampling card-like surfaces separately prevents a 999px button
       radius from turning every habit into a capsule. */
    var cardRadiusTally = {};
    var cardRadius = '';
    var cards = document.querySelectorAll('[class*="card" i], [class*="panel" i], [class*="overview" i]');
    for (var m = 0; m < cards.length && m < 120; m++) {
      var cr = parseFloat(getComputedStyle(cards[m]).borderRadius);
      if (!Number.isFinite(cr) || cr < 12 || cr > 36) continue;
      var crKey = Math.round(cr) + 'px';
      cardRadiusTally[crKey] = (cardRadiusTally[crKey] || 0) + 1;
      if (!cardRadius || cardRadiusTally[crKey] > cardRadiusTally[cardRadius]) cardRadius = crKey;
    }
    if (!cardRadius) cardRadius = '22px';

    var declaredShadow = rootStyle.getPropertyValue('--shadow').trim();

    return {
      font: bodyStyle.fontFamily || '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      mono: '"DM Mono",ui-monospace,"SFMono-Regular",Consolas,monospace',
      radius: radius,
      cardRadius: cardRadius,
      bg: toCss(bg),
      surface: toCss(surface),
      soft: toCss(soft),
      text: toCss(text),
      muted: toCss(muted),
      border: toCss(line),
      accent: toCss(accent),
      accentFaint: rgba(accent, 0.12),
      accentMid: rgba(accent, 0.42),
      onAccent: luminance(accent) > 0.6 ? '#000' : '#fff',
      shadow: dark ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.18)',
      cardShadow: declaredShadow || (dark ? '0 10px 28px rgba(0,0,0,.22)' : '0 1px 2px rgba(20,18,14,.04),0 8px 22px rgba(20,18,14,.05)'),
      danger: dark ? '#ff6961' : '#c0392b',
      warn: dark ? '#ffd60a' : '#a16207'
    };
  }

  function buildStyle(t) {
    return ':host{all:initial;}' +
    '*{box-sizing:border-box;font-family:' + t.font + ';}' +
    '.fab{position:fixed;right:16px;bottom:calc(152px + env(safe-area-inset-bottom));z-index:2147483000;' +
      'width:52px;height:52px;border:0;border-radius:50%;background:' + t.accent + ';color:' + t.onAccent + ';' +
      'font-size:23px;box-shadow:0 6px 20px ' + t.shadow + ';cursor:pointer;display:flex;align-items:center;' +
      'justify-content:center;}' +
    /*
     * FULL-BLEED, LIKE ONE OF THE APP'S PAGES.
     *
     * This previously stopped short of the nav (bottom: navReserve()) and had a
     * 22px bottom radius plus a drop shadow. That is the anatomy of a card
     * floating on top of something — which is precisely why it still read as an
     * overlay even once the nav pill moved onto it.
     *
     * The app's own screens do the opposite: .page fills the viewport and
     * .mobile-bar is a FLOATING bar (fixed, bottom:18px, inset 14px each side)
     * that hovers over the content scrolling beneath it. So the sheet now runs
     * edge to edge with square corners and no shadow, and the nav clearance
     * moved into padding-bottom — see applyReserve(). Same pixels of clearance,
     * but the panel now reads as the screen rather than a thing on top of it.
     *
     * overscroll-behavior:contain stops a scroll that reaches the end of this
     * panel from chaining into the page underneath. Without it the app scrolls
     * behind the sheet, which on a phone reads as the whole screen juddering.
     */
    /*
     * z-index 40 — UNDER the app's floating nav, not over everything.
     *
     * The app's ladder (src/styles.css): content 1-2, .mobile-bar 50,
     * .saved-toast 60, .photo-viewer 80, .modal-backdrop 100. At 40 this covers
     * every page element and the bar still floats on top of it, which is exactly
     * how the app's own screens sit under that bar. A maximal z-index painted
     * over the nav instead, hiding the tabs — and a panel that hides the
     * navigation is a modal by definition, however it is styled.
     *
     * This works only because the host is position:absolute with z-index auto
     * and so creates no stacking context; the sheet competes at the root. See
     * the note in mount().
     */
    '.sheet{position:fixed;inset:0;z-index:40;background:' + t.bg + ';color:' + t.text + ';' +
      'overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0;}' +
    /* Matches .page-header on mobile: 27px/-.03em title, 58px min-height, and
       the same 15px gutter .page uses. Deliberately NOT sticky — the app's page
       headers scroll away, and a pinned bar with a close button is modal chrome. */
    '.bar{display:flex;align-items:center;gap:12px;min-height:58px;' +
      'padding:calc(24px + env(safe-area-inset-top)) 15px 0;}' +
    '.bar h2{margin:0;font-size:27px;font-weight:700;letter-spacing:-.03em;line-height:1.08;flex:1;}' +
    '.x{background:none;border:0;color:' + t.muted + ';font-size:26px;line-height:1;cursor:pointer;padding:4px 8px;}' +
    '.tabs{display:flex;gap:2px;margin:18px 15px 4px;padding:3px;border-radius:999px;background:' + t.soft + ';}' +
    '.tab{flex:1;padding:9px 12px;border:0;border-radius:999px;background:transparent;' +
      'color:' + t.muted + ';font-size:13px;font-weight:600;cursor:pointer;transition:background .16s,color .16s,box-shadow .16s;}' +
    '.tab[aria-selected="true"]{background:' + t.surface + ';color:' + t.text + ';box-shadow:' + t.cardShadow + ';}' +
    '.body{padding:14px 16px;width:min(100%,720px);margin:0 auto;}' +
    '.hint{color:' + t.muted + ';font-size:13px;line-height:1.45;margin:4px 0 16px;}' +
    '.warn{border:1px solid ' + t.warn + ';border-radius:' + t.radius + ';padding:10px 12px;margin:0 0 14px;' +
      'font-size:13px;line-height:1.45;color:' + t.text + ';}' +
    '.warn b{color:' + t.warn + ';}' +

    /* habit card */
    '.card{border:0;border-radius:' + t.cardRadius + ';padding:19px;margin:0 0 14px;' +
      'background:' + t.surface + ';box-shadow:' + t.cardShadow + ';overflow:hidden;}' +
    '.top{display:flex;align-items:center;gap:12px;}' +
    '.emoji{flex:none;width:50px;height:50px;border-radius:18px;background:' + t.accentFaint + ';' +
      'font-size:25px;line-height:1;display:grid;place-items:center;}' +
    '.who{flex:1;min-width:0;}' +
    '.who h3{margin:0 0 4px;font-size:18px;font-weight:700;letter-spacing:-.025em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.sub{color:' + t.muted + ';font-size:13px;margin:0;}' +
    '.check{flex:none;width:50px;height:50px;border-radius:50%;border:2px solid ' + t.border + ';' +
      'background:transparent;color:' + t.muted + ';font-size:20px;cursor:pointer;display:flex;' +
      'align-items:center;justify-content:center;transition:background .16s,border-color .16s,transform .12s,box-shadow .16s;}' +
    '.check[aria-pressed="false"]:after{content:"";width:12px;height:12px;border-radius:50%;background:' + t.soft + ';}' +
    '.check[aria-pressed="true"]{background:' + t.accent + ';border-color:' + t.accent + ';color:' + t.onAccent + ';' +
      'box-shadow:0 7px 18px ' + t.accentMid + ';}' +
    '.check:active:not([disabled]){transform:scale(.94);}' +
    '.check[disabled]{opacity:.45;cursor:default;}' +
    '.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 0;padding:0;}' +
    '.stats[data-count="2"]{grid-template-columns:repeat(2,minmax(0,1fr));}' +
    '.stat{min-width:0;padding:11px 10px;border-radius:14px;background:' + t.soft + ';font:500 8px/1.25 ' + t.mono + ';' +
      'letter-spacing:.06em;text-transform:uppercase;color:' + t.muted + ';}' +
    '.stat b{display:block;margin:0 0 3px;font:700 17px/1.2 ' + t.font + ';letter-spacing:-.025em;' +
      'text-transform:none;color:' + t.text + ';font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +

    /* Contribution calendar: weeks run left-to-right; weekdays run downward. */
    '.activity{position:relative;margin:18px 0 0;padding:17px 14px 13px;border-radius:20px;overflow:hidden;' +
      'background:radial-gradient(circle at 100% 0%,' + t.accentFaint + ' 0,transparent 46%),' + t.soft + ';}' +
    '.activity-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin:0 2px 15px;}' +
    '.activity-kicker{display:block;margin:0 0 6px;font:500 9px/1 ' + t.mono + ';letter-spacing:.13em;' +
      'text-transform:uppercase;color:' + t.muted + ';}' +
    '.streak{display:flex;align-items:baseline;gap:7px;}' +
    '.streak b{font-size:36px;line-height:.9;font-weight:700;letter-spacing:-.055em;font-variant-numeric:tabular-nums;}' +
    '.streak span{font-size:14px;font-weight:600;color:' + t.muted + ';}' +
    '.rate{padding:7px 10px;border-radius:999px;background:' + t.surface + ';font:500 9px/1.2 ' + t.mono + ';' +
      'color:' + t.text + ';white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:inset 0 0 0 1px ' + t.border + ';}' +
    '.matrix-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 9px;' +
      'font-size:10px;color:' + t.muted + ';}' +
    '.matrix-meta strong{font-size:11px;color:' + t.text + ';}' +
    '.calendar{display:grid;grid-template-columns:16px max-content;grid-template-rows:12px auto;gap:6px 7px;justify-content:center;}' +
    '.months{grid-column:2;display:grid;grid-template-columns:repeat(10,18px);column-gap:5px;min-width:0;}' +
    '.month{font:500 8px/1 ' + t.mono + ';color:' + t.muted + ';text-transform:uppercase;overflow:visible;white-space:nowrap;}' +
    '.weekdays{display:grid;grid-template-rows:repeat(7,18px);gap:5px;}' +
    '.weekday{font:500 8px/18px ' + t.mono + ';color:' + t.muted + ';text-align:center;}' +
    '.heatmap{display:grid;grid-template-columns:repeat(10,18px);column-gap:5px;min-width:0;}' +
    '.week{display:grid;grid-template-rows:repeat(7,18px);gap:5px;}' +
    '.cell{width:18px;height:18px;border-radius:5px;background:' + t.surface + ';box-shadow:inset 0 0 0 1px ' + t.border + ';}' +
    '.cell[data-done="1"]{background:' + t.accent + ';box-shadow:inset 0 -2px 0 rgba(0,0,0,.08);}' +
    /* Keep the whole contribution matrix visible. Fully transparent pre-start
       cells made a new habit look like a broken two-column chart. */
    '.cell[data-before="1"]{background:' + t.surface + ';box-shadow:inset 0 0 0 1px ' + t.border + ';opacity:.58;}' +
    '.cell[data-future="1"]{background:' + t.surface + ';box-shadow:inset 0 0 0 1px ' + t.border + ';opacity:.4;}' +
    '.cell[data-today="1"]{outline:2px solid ' + t.accent + ';outline-offset:2px;}' +
    '.activity-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:11px 2px 0;' +
      'font-size:9px;color:' + t.muted + ';}' +
    '.legend{display:flex;align-items:center;gap:5px;white-space:nowrap;}' +
    '.key{width:10px;height:10px;border-radius:3px;background:' + t.surface + ';box-shadow:inset 0 0 0 1px ' + t.border + ';}' +
    '.key.done{background:' + t.accent + ';box-shadow:none;}' +

    /* per-habit controls */
    '.rows{margin:12px 0 0;border-top:1px solid ' + t.border + ';padding-top:10px;display:none;}' +
    '.card[data-open="1"] .rows{display:block;}' +
    '.row{display:flex;align-items:center;gap:10px;margin:0 0 10px;}' +
    '.row span{flex:1;font-size:13px;color:' + t.muted + ';}' +
    '.row input[type="time"],.row input[type="number"]{width:110px;flex:none;}' +
    '.more{background:none;border:0;color:' + t.muted + ';font-size:12px;font-weight:600;cursor:pointer;' +
      'padding:8px 0 0;text-transform:uppercase;letter-spacing:.04em;}' +
    '.danger{background:none;border:0;color:' + t.danger + ';font-size:13px;font-weight:600;cursor:pointer;padding:4px 0;}' +

    /* forms */
    'label{display:block;font-size:12px;font-weight:600;color:' + t.muted + ';margin:14px 0 6px;' +
      'text-transform:uppercase;letter-spacing:.04em;}' +
    'input,select,textarea{width:100%;padding:11px 12px;border:1px solid ' + t.border + ';' +
      'border-radius:' + t.radius + ';background:' + t.bg + ';color:' + t.text + ';font-size:16px;}' +
    '.pair{display:flex;gap:10px;}' +
    '.pair>div{flex:1;}' +
    '.go{width:100%;margin-top:20px;padding:14px;border:0;border-radius:' + t.radius + ';' +
      'background:' + t.accent + ';color:' + t.onAccent + ';font-size:16px;font-weight:600;cursor:pointer;}' +
    '.go[disabled]{opacity:.5;}' +
    '.empty{color:' + t.muted + ';font-size:14px;text-align:center;padding:40px 20px;line-height:1.5;}' +
    '.err{color:' + t.danger + ';font-size:13px;margin-top:12px;}' +
    '@media(max-width:360px){.card{padding:16px}.activity{padding-left:10px;padding-right:10px}' +
      '.months,.heatmap{grid-template-columns:repeat(10,16px);column-gap:4px}.week{grid-template-rows:repeat(7,16px);gap:4px}' +
      '.weekdays{grid-template-rows:repeat(7,16px);gap:4px}.weekday{line-height:16px}.cell{width:16px;height:16px}' +
      '.streak b{font-size:33px}.rate{padding-left:8px;padding-right:8px}.stat{padding-left:8px;padding-right:8px}.stat b{font-size:15px}}' +
    '@media(prefers-reduced-motion:reduce){.check,.tab{transition:none;}}';
  }

  /* ---------------------------------------------------------------- state */

  var host = null;
  var root = null;
  var habits = [];
  var today = '';
  var telegramReady = null;   /* null = unknown, true/false once /api/settings answers */
  var tab = 'today';
  var openCards = {};
  var journey = null;
  var homeHost = null;
  var refreshing = null;
  var noticeTimer = null;
  var trophiesOpen = false;
  var seenXP = null;
  try { var storedXP = localStorage.getItem('jamtytrack-rewards-seen-xp'); if (storedXP !== null && Number.isFinite(Number(storedXP)) && Number(storedXP) >= 0) seenXP = Number(storedXP); } catch (error) {}

  // REWARD CELEBRATION START
function rewardCelebration(before, after) {
  if(!before||!after||after.xp<=before.xp)return null;
  const gain=after.xp-before.xp;
  if(after.level>before.level)return {title:'Level '+after.level+' unlocked',detail:after.levelName+' · +'+gain+' XP'};
  if(after.perfectDay&&!before.perfectDay)return {title:'Perfect day!',detail:'Every habit completed · +'+gain+' XP'};
  const previous=new Set(before.badges.map(badge=>badge.key));
  const badge=after.badges.find(badge=>!previous.has(badge.key));
  if(badge)return {title:badge.title+' unlocked',detail:badge.habitName+' · +'+gain+' XP'};
  return {title:'Another day in the bank',detail:'Habit completed · +'+gain+' XP'};
}
  // REWARD CELEBRATION END

  function rewardsStyle(t) {
    return `.momentum{border:1px solid ${t.border};border-radius:20px;padding:20px;margin:0 0 16px;background:${t.surface};color:${t.text}}
    .journey-top{display:flex;align-items:center;justify-content:space-between;gap:18px}.journey-copy{flex:1;min-width:0}
    .eyebrow{display:block;color:${t.muted};font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;margin-bottom:7px}
    .journey-copy h3{font-size:23px;letter-spacing:-.6px;margin:0 0 6px}.journey-copy p,.reward-copy{font-size:13px;line-height:1.5;margin:6px 0;color:${t.muted}}
    .daily-ring{--fill:0%;width:88px;height:88px;flex:none;border-radius:50%;background:conic-gradient(${t.accent} var(--fill),${t.border} 0);padding:7px;display:grid;place-items:center}
    .daily-ring>div{border-radius:50%;background:${t.surface};width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center}.daily-ring b{font-size:21px;letter-spacing:-.7px}.daily-ring small{font-size:10px;color:${t.muted};margin-top:3px}
    .xp-meta{display:flex;justify-content:space-between;gap:12px;font-size:12px;margin:16px 0 7px;color:${t.muted}}.xp-meta strong{color:${t.text}}
    .reward-meter{height:7px;background:${t.border};border-radius:12px;overflow:hidden}.reward-meter i{height:100%;display:block;background:${t.accent};border-radius:12px;transition:width .35s ease}
    .quest{border-top:1px solid ${t.border};margin-top:18px;padding-top:17px}.quest-head{display:flex;justify-content:space-between;gap:12px;font-size:13px}.quest-head strong{font-size:15px}.quest-head span{color:${t.muted}}
    .quest-week{display:grid;grid-template-columns:repeat(7,1fr);gap:7px;margin:14px 0 8px}.quest-day{text-align:center;border:1px solid ${t.border};border-radius:12px;padding:9px 0;font-size:11px;color:${t.muted}}.quest-day b{display:block;font-size:15px;margin-top:6px}.quest-day[data-done="1"]{background:${t.accent};color:${t.onAccent};border-color:${t.accent}}.quest-day[data-today="1"]{outline:2px solid ${t.accent};outline-offset:2px}
    .trophies{margin-top:16px}.trophies summary{font-size:13px;font-weight:650;cursor:pointer;padding:8px 0}.badge-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}.reward-badge{border:1px solid ${t.border};border-radius:12px;padding:12px;min-width:0}.reward-badge strong{display:block;font-size:12px;margin:6px 0}.reward-badge small{font-size:11px;color:${t.muted};line-height:1.4;display:block}
    .streak-track{margin:16px 0 0;padding:14px;border:1px solid ${t.border};border-radius:14px}.streak-track[data-hot="1"]{border-color:${t.accent};background:${t.accentFaint}}.streak-track-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:9px}.streak-track-head strong{font-size:13px}.streak-track-head span{color:${t.muted};text-align:right}.streak-track p{margin-bottom:0}
    .reward-cta{border:0;border-radius:12px;background:${t.accent};color:${t.onAccent};font-size:13px;font-weight:700;padding:11px 15px;margin-top:14px;cursor:pointer}.reward-cta:focus-visible,.trophies summary:focus-visible{outline:2px solid ${t.text};outline-offset:3px}
    .home-momentum .daily-ring{width:70px;height:70px}.home-momentum h3{font-size:18px}.home-momentum .xp-meta{margin-top:10px}.home-momentum .reward-cta{width:100%}
    .reward-toast{position:fixed;z-index:70;left:50%;transform:translateX(-50%);bottom:110px;max-width:calc(100vw - 32px);width:370px;padding:16px 42px 16px 18px;background:${t.text};color:${t.bg};border-radius:17px;box-shadow:0 10px 35px ${t.shadow};animation:reward-pop .3s ease-out;pointer-events:auto}.reward-toast strong{display:block;font-size:16px}.reward-toast p{font-size:13px;margin:5px 0 0;line-height:1.4}.reward-toast button{position:absolute;right:10px;top:9px;border:0;background:none;color:inherit;font-size:23px;cursor:pointer}.reward-toast[data-error="1"]{animation:none}
    @keyframes reward-pop{from{opacity:0;transform:translateX(-50%) translateY(12px) scale(.97)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
    @media(min-width:761px){.reward-toast{left:calc(50% + 120px);bottom:26px}.momentum{max-width:700px}}
    @media(max-width:380px){.momentum{padding:15px}.journey-copy h3{font-size:20px}.daily-ring{width:73px;height:73px}.quest-week{gap:4px}.quest-head{flex-wrap:wrap}}
    @media(prefers-reduced-motion:reduce){.reward-meter i{transition:none}.reward-toast{animation:none}}`;
  }

  function rewardMeter(value, total, label) {
    var meter = el('div', {class:'reward-meter',role:'progressbar','aria-label':label,'aria-valuemin':'0','aria-valuemax':String(total),'aria-valuenow':String(Math.min(value,total))});
    var fill = el('i'); fill.style.width = (total ? Math.min(100,value/total*100) : 0) + '%'; meter.appendChild(fill); return meter;
  }
  function dailyRing() {
    var ring = el('div', {class:'daily-ring',role:'img','aria-label':journey.todayDone+' of '+journey.todayTotal+' habits completed today'});
    ring.style.setProperty('--fill',(journey.todayTotal?journey.todayDone/journey.todayTotal*100:0)+'%');
    var inside=el('div');inside.appendChild(el('b',null,journey.todayDone+'/'+journey.todayTotal));inside.appendChild(el('small',null,'TODAY'));ring.appendChild(inside);return ring;
  }
  function renderJourney(compact) {
    var box=el('section',{class:'momentum'+(compact?' home-momentum':''),'aria-label':'Your habit momentum'});
    var top=el('div',{class:'journey-top'}),copy=el('div',{class:'journey-copy'});
    copy.appendChild(el('span',{class:'eyebrow'},'Your momentum'));
    copy.appendChild(el('h3',null,'Level '+journey.level+' · '+journey.levelName));
    copy.appendChild(el('p',null,!journey.todayTotal?'Add a habit to start your next chapter.':journey.perfectDay?'Perfect day. Every habit is done.':journey.todayDone?'Keep it going — '+(journey.todayTotal-journey.todayDone)+' left today.':'One completed habit starts today’s momentum.'));
    top.appendChild(copy);top.appendChild(dailyRing());box.appendChild(top);
    var meta=el('div',{class:'xp-meta'});meta.appendChild(el('strong',null,journey.xp+' XP earned'));meta.appendChild(el('span',null,journey.toNextLevel+' XP to level '+(journey.level+1)));box.appendChild(meta);
    box.appendChild(rewardMeter(journey.levelProgress,100,'Progress to the next level'));
    if(compact){
      var button=el('button',{class:'reward-cta'},!journey.todayTotal?'Set up your habits':journey.perfectDay?'See your streaks & badges':'Open today’s habits');
      button.addEventListener('click',function(){if(!isOpen())open();});box.appendChild(button);return box;
    }
    box.appendChild(el('p',{class:'reward-copy'},'10 XP per completed habit day. Your history counts, and earned XP stays when a streak ends.'));
    if(journey.todayTotal){
    var quest=el('section',{class:'quest','aria-label':'Weekly consistency goal'}),head=el('div',{class:'quest-head'});
    head.appendChild(el('strong',null,journey.weekComplete?'★ Weekly goal complete':'This week’s quest'));
    head.appendChild(el('span',null,journey.weekDone+' active days · goal '+journey.weekTarget));quest.appendChild(head);
    var week=el('div',{class:'quest-week'});journey.week.forEach(function(day,index){
      var node=el('div',{class:'quest-day','data-done':day.done?'1':'0','data-today':day.day===today?'1':'0',title:fmtDate(day.day)+(day.done?' · at least one habit completed':'')});
      node.appendChild(el('span',null,['M','T','W','T','F','S','S'][index]));node.appendChild(el('b',null,day.done?'✓':day.day.slice(-2)));week.appendChild(node);
    });quest.appendChild(week);quest.appendChild(el('p',{class:'reward-copy'},'Complete at least one habit on '+journey.weekTarget+' days. '+fmtDate(journey.weekStart)+' – '+fmtDate(journey.weekEnd)+'.'));box.appendChild(quest);
    }
    var shelf=el('details',{class:'trophies'});shelf.open=trophiesOpen;shelf.addEventListener('toggle',function(){if(shelf.isConnected)trophiesOpen=shelf.open;});shelf.appendChild(el('summary',null,'Your trophy shelf · '+journey.badges.length+' earned'));
    if(!journey.badges.length)shelf.appendChild(el('p',{class:'reward-copy'},'Your first completed habit day earns the First step badge.'));
    var grid=el('div',{class:'badge-grid'});journey.badges.forEach(function(badge){var item=el('div',{class:'reward-badge'});item.appendChild(el('span',{'aria-hidden':'true'},badge.icon));item.appendChild(el('strong',null,badge.title));item.appendChild(el('small',null,badge.habitName+' · '+badge.detail));grid.appendChild(item);});shelf.appendChild(grid);box.appendChild(shelf);return box;
  }
  function renderStreakReward(habit) {
    var rewards=habit.rewards,box=el('section',{class:'streak-track','data-hot':rewards.current>=7?'1':'0','aria-label':habit.name+' streak milestones'});
    var head=el('div',{class:'streak-track-head'});head.appendChild(el('strong',null,(rewards.current>=7?'🔥 ':'')+rewards.tier));
    head.appendChild(el('span',null,rewards.remaining+' '+(rewards.remaining===1?'day':'days')+' to '+rewards.next));box.appendChild(head);
    box.appendChild(rewardMeter(rewards.current,rewards.next,'Progress to a '+rewards.next+' day streak'));
    var text=rewards.comeback?'Your '+habit.totalDone+' completed days still count. Start a fresh run when you’re ready.':rewards.current>=30?'A legendary run. Every completed day keeps it growing.':rewards.current>=7?'Super streak active — seven or more consecutive days.':'Three days builds a streak. Seven unlocks Super streak.';
    box.appendChild(el('p',{class:'reward-copy'},text));return box;
  }
  function toast(title,detail,error) {
    var previous=root.querySelector('.reward-toast');if(previous)previous.remove();clearTimeout(noticeTimer);
    var node=el('div',{class:'reward-toast',role:'status','aria-live':'polite','data-error':error?'1':'0'});node.appendChild(el('strong',null,title));node.appendChild(el('p',null,detail));
    var dismiss=el('button',{'aria-label':'Dismiss celebration'},'×');dismiss.addEventListener('click',function(){node.remove();});node.appendChild(dismiss);root.appendChild(node);
    noticeTimer=setTimeout(function(){node.remove();},5000);
  }
  function noticeProgress(before) {
    if(!journey)return;
    if(seenXP!==null&&journey.xp>seenXP){var reward=rewardCelebration(before,journey);if(reward)toast(reward.title,reward.detail);else toast('Your progress grew',journey.xp+' XP earned from your completed habits.');}
    seenXP=Math.max(seenXP||0,journey.xp);try{localStorage.setItem('jamtytrack-rewards-seen-xp',String(seenXP));}catch(error){}
  }
  function renderHome() {
    if(!homeHost||!homeHost.isConnected||!journey)return;
    var shadow=homeHost.shadowRoot;shadow.replaceChildren(el('style',null,buildStyle(readTheme())+rewardsStyle(readTheme())),renderJourney(true));
  }
  function settleHome() {
    var page=document.querySelector('.today-page');
    if(!page){homeHost=null;return;}
    if(homeHost&&homeHost.isConnected)return;
    homeHost=el('div',{'data-jamtytrack-momentum':'1'});homeHost.style.display='block';homeHost.attachShadow({mode:'open'});
    var diary=page.querySelector('.diary-section');page.insertBefore(homeHost,diary||null);
    if(journey)renderHome();else refresh().then(function(){renderHome();noticeProgress(null);}).catch(function(){});
  }

  async function api(path, options) {
    var response = await fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}));
    var payload = null;
    try { payload = await response.json(); } catch (error) { /* empty body */ }
    if (!response.ok) throw new Error((payload && payload.error) || 'Request failed');
    return payload;
  }

  function refresh() {
    if(refreshing)return refreshing;
    refreshing=fetchHabits().finally(function(){refreshing=null;});return refreshing;
  }
  async function fetchHabits() {
    var data = await api('/api/habits');
    habits = data.habits || [];
    today = data.today;
    journey = data.rewards || null;
    renderHome();

    /*
     * Reminders go out over Telegram only. If the bot is not connected the times
     * below are inert, and saying so here is the whole point — jamtytrack-kb.md
     * §4 records exactly this failure once already: reminders configured, no
     * delivery channel, sent_reminders empty for weeks and nobody noticed.
     */
    if (telegramReady === null) {
      try {
        var settings = await api('/api/settings');
        telegramReady = Boolean(settings.telegramTokenConfigured && settings.telegramChatId);
      } catch (error) { telegramReady = null; }
    }
  }

  /* --------------------------------------------------------------- render */

  function render() {
    var view = root.querySelector('.body');
    view.textContent = '';
    root.querySelectorAll('.tab').forEach(function (node) {
      node.setAttribute('aria-selected', String(node.dataset.tab === tab));
    });
    if (tab === 'add') renderAdd(view);
    else renderToday(view);
  }

  function renderToday(view) {
    if(journey&&habits.length)view.appendChild(renderJourney(false));
    if (telegramReady === false && habits.some(function (h) { return h.reminderTime && h.reminderEnabled; })) {
      var warn = el('div', { class: 'warn' });
      warn.appendChild(el('b', null, 'Telegram is not connected. '));
      warn.appendChild(document.createTextNode(
        'Reminder times are saved but nothing will be sent. Add your bot token in Settings, then send /start to the bot.'));
      view.appendChild(warn);
    }

    if (!habits.length) {
      view.appendChild(el('p', { class: 'empty' },
        'No habits yet. A habit is the behaviour, not the result \u2014 "walk 10 km", not "lose 2 kg".'));
      return;
    }

    habits.forEach(function (habit) { view.appendChild(renderCard(habit)); });
  }

  function renderCard(habit) {
    var card = el('div', { class: 'card', 'data-habit-id':habit.id });
    if (openCards[habit.id]) card.setAttribute('data-open', '1');

    var top = el('div', { class: 'top' });
    top.appendChild(el('div', { class: 'emoji' }, habit.emoji));

    var who = el('div', { class: 'who' });
    who.appendChild(el('h3', null, habit.name));

    /* The day counter is the "today is my second day" number, and it is a
       different thing from the streak: day 12 with a 3-day streak says something
       the streak alone does not. */
    var bits = ['Day ' + habit.dayNumber];
    if (habit.doneToday) {
      bits.push(habit.todayValue !== null
        ? 'done \u00b7 ' + trim(habit.todayValue) + (habit.unit ? ' ' + habit.unit : '')
        : 'done');
    } else if (habit.reminderTime && habit.reminderEnabled) {
      bits.push('reminder ' + habit.reminderTime);
    }
    who.appendChild(el('p', { class: 'sub' }, bits.join(' \u00b7 ')));
    top.appendChild(who);

    var check = el('button', {
      class: 'check',
      'aria-pressed': String(habit.doneToday),
      'aria-label': (habit.doneToday ? 'Undo today for ' : 'Check off ') + habit.name
    }, habit.doneToday ? '\u2713' : '');
    check.addEventListener('click', function () { toggle(habit, check); });
    top.appendChild(check);
    card.appendChild(top);

    if(habit.rewards)card.appendChild(renderStreakReward(habit));
    card.appendChild(buildActivity(habit));

    var stats = el('div', { class: 'stats' });
    stats.appendChild(stat(plural(habit.longestStreak, 'day'), 'best streak'));
    stats.appendChild(stat(String(habit.totalDone), 'days done'));
    if (habit.totalValue > 0 && habit.unit) {
      stats.appendChild(stat(trim(habit.totalValue) + ' ' + habit.unit, 'total'));
    }
    stats.setAttribute('data-count', String(stats.children.length));
    card.appendChild(stats);

    var more = el('button', { class: 'more' }, openCards[habit.id] ? 'Hide settings' : 'Settings');
    more.addEventListener('click', function () {
      openCards[habit.id] = !openCards[habit.id];
      render();
    });
    card.appendChild(more);
    card.appendChild(buildRows(habit));

    return card;
  }

  function stat(value, label) {
    var node = el('div', { class: 'stat' });
    node.appendChild(el('b', null, value));
    node.appendChild(document.createTextNode(label));
    return node;
  }

  /*
   * Ten calendar weeks, oldest first, with weekdays running downward. Days
   * before the habit existed are drawn as quiet/empty rather than missed. A
   * wall of failure for days that were never on the
   * board is both wrong and discouraging.
   */
  function buildActivity(habit) {
    var activity = el('section', { class: 'activity' });
    var done = {};
    habit.history.forEach(function (date) { done[date] = true; });

    var currentWeek = addDays(today, -weekdayIndex(today));
    var firstWeek = addDays(currentWeek, -(GRID_WEEKS - 1) * 7);
    var eligible = 0;
    var completed = 0;

    var months = el('div', { class: 'months', 'aria-hidden': 'true' });
    var heatmap = el('div', {
      class: 'heatmap', role: 'img',
      'aria-label': 'Habit activity over the last ten weeks'
    });
    var previousMonth = '';

    for (var weekIndex = 0; weekIndex < GRID_WEEKS; weekIndex++) {
      var weekStart = addDays(firstWeek, weekIndex * 7);
      var month = fmtMonth(weekStart);
      months.appendChild(el('span', { class: 'month' }, month !== previousMonth ? month : ''));
      previousMonth = month;

      var week = el('div', { class: 'week' });
      for (var dayIndex = 0; dayIndex < 7; dayIndex++) {
        var date = addDays(weekStart, dayIndex);
        var cell = el('div', { class: 'cell', title: fmtDate(date) + (done[date] ? ' · done' : '') });
        if (date < habit.startedOn) cell.setAttribute('data-before', '1');
        else if (date > today) cell.setAttribute('data-future', '1');
        else {
          eligible++;
          if (done[date]) {
            completed++;
            cell.setAttribute('data-done', '1');
          }
        }
        if (date === today) cell.setAttribute('data-today', '1');
        week.appendChild(cell);
      }
      heatmap.appendChild(week);
    }

    var percent = eligible ? Math.round(completed / eligible * 100) : 0;
    heatmap.setAttribute('aria-label', completed + ' of ' + eligible + ' eligible days completed in the last ten weeks');

    var head = el('div', { class: 'activity-head' });
    var heading = el('div');
    heading.appendChild(el('span', { class: 'activity-kicker' }, 'Current streak'));
    var streak = el('div', { class: 'streak' });
    streak.appendChild(el('b', null, String(habit.streak)));
    streak.appendChild(el('span', null, habit.streak === 1 ? 'day strong' : 'days strong'));
    heading.appendChild(streak);
    head.appendChild(heading);
    head.appendChild(el('span', { class: 'rate' }, percent + '% consistent'));
    activity.appendChild(head);

    var matrixMeta = el('div', { class: 'matrix-meta' });
    matrixMeta.appendChild(el('strong', null, 'Last 10 weeks'));
    matrixMeta.appendChild(el('span', null, completed + ' of ' + eligible + ' days'));
    activity.appendChild(matrixMeta);

    var calendar = el('div', { class: 'calendar' });
    calendar.appendChild(months);
    var weekdays = el('div', { class: 'weekdays', 'aria-hidden': 'true' });
    ['M', '', 'W', '', 'F', '', 'S'].forEach(function (label) {
      weekdays.appendChild(el('span', { class: 'weekday' }, label));
    });
    calendar.appendChild(weekdays);
    calendar.appendChild(heatmap);
    activity.appendChild(calendar);

    var foot = el('div', { class: 'activity-foot' });
    foot.appendChild(el('span', null, 'Since ' + fmtDate(habit.startedOn)));
    var legend = el('span', { class: 'legend', 'aria-hidden': 'true' });
    legend.appendChild(document.createTextNode('Missed'));
    legend.appendChild(el('i', { class: 'key' }));
    legend.appendChild(el('i', { class: 'key done' }));
    legend.appendChild(document.createTextNode('Done'));
    foot.appendChild(legend);
    activity.appendChild(foot);

    return activity;
  }

  function buildRows(habit) {
    var rows = el('div', { class: 'rows' });

    var timeRow = el('div', { class: 'row' });
    timeRow.appendChild(el('span', null, 'Telegram reminder'));
    var time = el('input', { type: 'time', value: habit.reminderTime || '' });
    time.addEventListener('change', function () {
      save(habit.id, { reminderTime: time.value || null });
    });
    timeRow.appendChild(time);
    rows.appendChild(timeRow);

    if (habit.targetValue !== null) {
      var targetRow = el('div', { class: 'row' });
      targetRow.appendChild(el('span', null, 'Target' + (habit.unit ? ' (' + habit.unit + ')' : '')));
      var target = el('input', { type: 'number', step: '0.1', min: '0.1', value: String(habit.targetValue) });
      target.addEventListener('change', function () {
        save(habit.id, { targetValue: Number(target.value) });
      });
      targetRow.appendChild(target);
      rows.appendChild(targetRow);
    }

    if (habit.doneToday) {
      var actualRow = el('div', { class: 'row' });
      actualRow.appendChild(el('span', null, 'Logged today'));
      var actual = el('input', {
        type: 'number', step: '0.1', min: '0',
        value: habit.todayValue === null ? '' : String(habit.todayValue)
      });
      actual.addEventListener('change', function () {
        checkInWith(habit.id, actual.value === '' ? null : Number(actual.value));
      });
      actualRow.appendChild(actual);
      rows.appendChild(actualRow);
    }

    /* Archive, not delete. Deleting cascades the entries away, and a streak you
       spent two months on should not be one tap from gone. */
    var archive = el('button', { class: 'danger' }, 'Archive this habit');
    archive.addEventListener('click', function () {
      if (!confirm('Archive "' + habit.name + '"? Its history is kept.')) return;
      save(habit.id, { archived: true });
    });
    rows.appendChild(archive);

    return rows;
  }

  function renderAdd(view) {
    view.appendChild(el('p', { class: 'hint' },
      'Track the behaviour, not the outcome. One tap a day, and a reminder over Telegram if you want one.'));

    var name = field(view, 'Habit', el('input', { type: 'text', placeholder: 'Walk 10 km', maxlength: '60' }));
    var emoji = null;
    var target = null;
    var unit = null;

    var pair = el('div', { class: 'pair' });
    var left = el('div');
    left.appendChild(el('label', null, 'Emoji'));
    emoji = el('input', { type: 'text', value: '\u2705', maxlength: '4' });
    left.appendChild(emoji);
    var mid = el('div');
    mid.appendChild(el('label', null, 'Target'));
    target = el('input', { type: 'number', step: '0.1', min: '0.1', placeholder: '10' });
    mid.appendChild(target);
    var right = el('div');
    right.appendChild(el('label', null, 'Unit'));
    unit = el('input', { type: 'text', placeholder: 'km', maxlength: '12' });
    right.appendChild(unit);
    pair.appendChild(left); pair.appendChild(mid); pair.appendChild(right);
    view.appendChild(pair);

    var started = field(view, 'Started on', el('input', { type: 'date', value: today, max: today }));
    var reminder = field(view, 'Telegram reminder (optional)', el('input', { type: 'time' }));

    var error = el('p', { class: 'err' });
    var go = el('button', { class: 'go' }, 'Add habit');
    go.addEventListener('click', async function () {
      error.textContent = '';
      if (!name.value.trim()) { error.textContent = 'Give the habit a name'; return; }
      go.disabled = true;
      try {
        await api('/api/habits', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name.value,
            emoji: emoji.value,
            targetValue: target.value === '' ? null : Number(target.value),
            unit: unit.value,
            startedOn: started.value || today,
            reminderTime: reminder.value || null
          })
        });
        await refresh();
        tab = 'today';
        render();
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        go.disabled = false;
      }
    });
    view.appendChild(go);
    view.appendChild(error);
  }

  function field(view, label, input) {
    view.appendChild(el('label', null, label));
    view.appendChild(input);
    return input;
  }

  /* --------------------------------------------------------------- actions */

  /*
   * Optimistic: the circle fills on tap and the request follows. A check-in is
   * the single most repeated action in this feature and it happens on a phone,
   * often on bad signal — waiting on a round trip to show it registered is what
   * makes people tap twice. The server is idempotent (UNIQUE habit_id+done_date)
   * so a double tap cannot double-count, and a failure re-renders from the truth.
   */
  async function toggle(habit, button) {
    var next = !habit.doneToday;
    var beforeJourney=journey;
    button.setAttribute('aria-pressed', String(next));
    button.textContent = next ? '\u2713' : '';
    button.disabled = true;

    try {
      if (next) {
        await api('/api/habits/' + habit.id + '/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          /* Default the value to the target: checking off "Walk 10 km" means
             10 km unless the actual number is edited afterwards. */
          body: JSON.stringify({ value: habit.targetValue })
        });
      } else {
        await api('/api/habits/' + habit.id + '/check', { method: 'DELETE' });
      }
      await refresh();
      if(next)noticeProgress(beforeJourney);
    } catch (error) {
      toast('Check-in needs a refresh',error.message,true);
    } finally {
      button.disabled = false;
      render();
      var replacement=Array.from(root.querySelectorAll('[data-habit-id]')).find(function(card){return card.dataset.habitId===habit.id;});
      if(replacement)replacement.querySelector('.check').focus({preventScroll:true});
    }
  }

  async function checkInWith(id, value) {
    try {
      await api('/api/habits/' + id + '/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: value })
      });
      await refresh();
    } catch (error) { /* re-render from truth */ }
    render();
  }

  async function save(id, patch) {
    try {
      await api('/api/habits/' + id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      });
      await refresh();
    } catch (error) { /* re-render from truth */ }
    render();
  }

  /* ----------------------------------------------------------------- sheet */

  /*
   * How much of the bottom the app's own nav bar occupies.
   *
   * The sheet stops above it rather than covering it, for a reason that is not
   * cosmetic: 'position:fixed' on the shadow host CREATES A STACKING CONTEXT, so
   * the sheet's z-index only competes inside that context. Against the app's bar
   * (z-index 50) the host counts as 0, and the bar therefore paints ON TOP of
   * the sheet no matter how large the sheet's z-index is. Fighting that is not
   * winnable from inside a shadow root; leaving the bar its own space is both
   * honest and better — the tabs stay visible and usable with the sheet open.
   *
   * Measured from the outermost fixed ancestor of the launcher, so the detached
   * capture button beside the tabs is included.
   */
  function navReserve() {
    var item = document.querySelector('[' + NAV_FLAG + ']');
    if (!item) return 0;

    var bar = item;
    var node = item;
    while (node && node !== document.body) {
      if (getComputedStyle(node).position === 'fixed') { bar = node; break; }
      node = node.parentElement;
    }

    var rect = bar.getBoundingClientRect();
    /* Only a bar along the bottom needs reserving; a top or side nav does not
       overlap the sheet's content. */
    if (!rect.height || rect.top < window.innerHeight * 0.5) return 0;
    return Math.max(0, Math.round(window.innerHeight - rect.top) + 10);
  }

  /* Clearance for the floating nav goes in padding, not in the bottom offset. Shortening
     the element left a visible gap and a card edge above the bar; padding keeps
     the panel full-bleed while its content still stops above the nav. */
  function applyReserve() {
    var sheet = root.querySelector('.sheet');
    if (sheet) sheet.style.paddingBottom = navReserve() + 'px';
  }

  function isOpen() {
    return Boolean(root.querySelector('.sheet'));
  }

  /*
   * Make the bar treat Habits as a real tab.
   *
   * Without this the panel reads as an overlay sitting on top of whichever tab
   * you came from: the sheet covers the screen, but the sliding pill stays under
   * Today (or Settings, or wherever you were) and that tab keeps its .active
   * styling. Two tabs then appear to be open at once, which is exactly the
   * "overlay on Settings" complaint.
   *
   * The app drives the highlight with two things, both discoverable from
   * src/styles.css and src/components/Layout.tsx:
   *
   *   .nav-pill { transform: translateX(calc(var(--nav-index,0) * 100%)) }
   *   .bottom-nav button.active { color: var(--ink) }   // + bold label
   *
   * and React writes --nav-index as an inline style on .bottom-nav. So moving
   * the pill is a matter of setting that variable to this item's cell index and
   * moving the .active class. fitNav() has already rewritten the pill's width to
   * match the new track count, so index * 100% lands on the right cell.
   *
   * The previous values are saved rather than recomputed, because the app owns
   * them: on close they go back exactly as they were, and any later React render
   * overwrites them anyway with whatever the app believes is active.
   */
  var savedNav = null;

  function claimNavHighlight() {
    var item = document.querySelector('[' + NAV_FLAG + ']');
    if (!item) return;
    var nav = item.parentElement;
    if (!nav) return;

    var cells = navCells(nav);
    var index = cells.indexOf(item);
    if (index < 0) return;

    var previous = null;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] !== item && cells[i].classList.contains('active')) {
        previous = cells[i];
        cells[i].classList.remove('active');
      }
    }

    if (!savedNav) {
      savedNav = { nav: nav, index: nav.style.getPropertyValue('--nav-index'), active: previous };
    }
    nav.style.setProperty('--nav-index', String(index));
    item.classList.add('active');
    item.setAttribute('aria-expanded', 'true');
  }

  function releaseNavHighlight() {
    var item = document.querySelector('[' + NAV_FLAG + ']');
    if (item) item.classList.remove('active');
    if (!savedNav) return;
    if (savedNav.index) savedNav.nav.style.setProperty('--nav-index', savedNav.index);
    else savedNav.nav.style.removeProperty('--nav-index');
    if (savedNav.active) savedNav.active.classList.add('active');
    savedNav = null;
  }

  function close() {
    var sheet = root.querySelector('.sheet');
    if (sheet) sheet.remove();
    releaseNavHighlight();
    var item = document.querySelector('[' + NAV_FLAG + ']');
    if (item) item.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', applyReserve);
  }

  /*
   * Anything tapped outside the sheet closes it — most importantly one of the
   * app's own tabs, which previously navigated BEHIND the open sheet and made it
   * look stuck. The launcher itself is excluded: its own handler toggles, and
   * closing here first would let that toggle immediately re-open it.
   *
   * Nothing is cancelled, so the app still navigates on the same tap.
   */
  function onOutsideClick(event) {
    if (!isOpen()) return;
    var item = document.querySelector('[' + NAV_FLAG + ']');
    if (item && (event.target === item || item.contains(event.target))) return;
    if (host && (event.target === host || host.contains(event.target))) return;
    close();
  }

  function onKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') close();
  }

  function open() {
    if (isOpen()) { close(); return; }

    claimNavHighlight();

    /*
     * 'region', not 'dialog'. It behaves as one of the app's screens now — the
     * bar highlights it, and tapping another tab leaves it — so announcing it as
     * a modal dialog would misdescribe it to a screen reader. Escape and
     * outside-tap still close it, which is a convenience here rather than the
     * modal contract.
     */
    var sheet = el('div', { class: 'sheet', role: 'region', 'aria-label': 'Habits' });

    var bar = el('div', { class: 'bar' });
    bar.appendChild(el('h2', null, 'Habits'));
    var closeButton = el('button', { class: 'x', 'aria-label': 'Close habits' }, '\u00d7');
    closeButton.addEventListener('click', close);
    bar.appendChild(closeButton);
    sheet.appendChild(bar);

    var tabs = el('div', { class: 'tabs' });
    [['today', 'Today'], ['add', 'New habit']].forEach(function (entry) {
      var button = el('button', { class: 'tab', 'data-tab': entry[0] }, entry[1]);
      button.dataset.tab = entry[0];
      button.addEventListener('click', function () { tab = entry[0]; render(); });
      tabs.appendChild(button);
    });
    sheet.appendChild(tabs);
    sheet.appendChild(el('div', { class: 'body' }));
    root.appendChild(sheet);

    applyReserve();
    var item = document.querySelector('[' + NAV_FLAG + ']');
    if (item) item.setAttribute('aria-expanded', 'true');

    /* Capture phase, so a tap still closes this even if the app stops
       propagation on its own controls. */
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', applyReserve);

    tab = 'today';
    var view = sheet.querySelector('.body');
    view.appendChild(el('p', { class: 'empty' }, 'Loading\u2026'));
    var beforeJourney=journey;
    refresh().then(function(){render();noticeProgress(beforeJourney);}).catch(function (error) {
      view.textContent = '';
      view.appendChild(el('p', { class: 'err' }, error.message));
    });
  }

  /* ------------------------------------------------------------------- nav */

  var CHECK_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

  /* Use the app's navigation elements. A meal row also has several buttons
     near the bottom of the screen, so geometry cannot identify navigation.
     Desktop's vertical sidebar is narrower and taller than the mobile bar. */
  function findNav() {
    var candidates = document.querySelectorAll('nav.side-nav, nav.bottom-nav');
    for (var i = 0; i < candidates.length; i++) {
      if (isShown(candidates[i]) && navCells(candidates[i]).length >= 2) return candidates[i];
    }
    return null;
  }

  /* Children that actually occupy a cell. An absolutely-positioned child is a
     decoration — the app's sliding highlight pill is one — and must never be
     counted as a tab, cloned as a template, or laid out as a grid item. */
  function navCells(nav) {
    return [].slice.call(nav.children).filter(function (node) {
      return node.nodeType === 1 && node.matches('button, a, [role="tab"]') &&
        getComputedStyle(node).position !== 'absolute' && isShown(node);
    });
  }

  function navOverlays(nav) {
    return [].slice.call(nav.children).filter(function (node) {
      return node.nodeType === 1 && getComputedStyle(node).position === 'absolute';
    });
  }

  /* Clone an existing item rather than build one: the clone carries the app's
     class names, icon sizing and active-state markup for free, none of which are
     knowable from here. Only the icon, the label and the active state change. */
  function buildNavItem(nav) {
    var siblings = navCells(nav).filter(function (node) {
      return !node.hasAttribute(NAV_FLAG);
    });
    if (siblings.length < 2) return null;

    var item = siblings[siblings.length - 1].cloneNode(true);
    item.setAttribute(NAV_FLAG, '1');
    if (item.tagName === 'BUTTON') item.setAttribute('type', 'button');
    item.setAttribute('aria-expanded', 'false');

    item.removeAttribute('aria-current');
    item.removeAttribute('aria-selected');
    item.removeAttribute('data-active');
    if (item.className && typeof item.className === 'string') {
      item.className = item.className
        .split(/\s+/)
        .filter(function (name) { return !/(active|selected|current)/i.test(name); })
        .join(' ');
    }

    if (item.tagName === 'A') item.setAttribute('href', 'javascript:void(0)');
    var innerLinks = item.querySelectorAll('a');
    for (var i = 0; i < innerLinks.length; i++) innerLinks[i].setAttribute('href', 'javascript:void(0)');

    /*
     * Find the icon. The selector covers SVG/img/icon-font markup; the fallback
     * covers a nav that draws its icons as emoji in a plain element, which the
     * selector misses entirely. Without it the clone keeps the icon of whatever
     * item it was copied from — a Settings gear labelled "Habits" — and that is
     * the one failure mode that looks like a bug rather than a rough edge.
     */
    var icon = item.querySelector('svg,img,i,[class*="icon" i]');
    if (!icon) {
      var leaves = item.querySelectorAll('*');
      for (var g = 0; g < leaves.length; g++) {
        var leaf = leaves[g];
        if (leaf.children.length) continue;
        var glyph = (leaf.textContent || '').trim();
        /* A glyph, not a word: one or two code units and no letters or digits.
           Array.from counts astral emoji as one, which /./ would not. */
        if (glyph && Array.from(glyph).length <= 2 && !/[\p{L}\p{N}]/u.test(glyph)) { icon = leaf; break; }
      }
    }
    if (icon) {
      var holder = document.createElement('span');
      holder.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
        'font-size:' + (getComputedStyle(icon).fontSize || '22px') + ';';
      holder.innerHTML = CHECK_ICON;
      icon.parentNode.replaceChild(holder, icon);
    }

    var labelled = null;
    var walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, null);
    var textNode;
    while ((textNode = walker.nextNode())) {
      if (textNode.nodeValue && textNode.nodeValue.trim()) labelled = textNode;
    }
    if (labelled) labelled.nodeValue = 'Habits';
    else if (!icon) item.textContent = 'Habits';

    item.setAttribute('aria-label', 'Habits');
    item.setAttribute('title', 'Habits');
    item.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      open();
    });
    return item;
  }

  /*
   * Make room for the extra cell.
   *
   * The previous version only handled flex, and only when the bar overflowed
   * horizontally. The real bar is a CSS GRID with a hardcoded track count:
   *
   *   .bottom-nav { display:grid; grid-template-columns:repeat(4,1fr); height:66px }
   *   .nav-pill   { width:calc((100% - 10px)/4); transform:translateX(...) }
   *
   * A grid does not overflow sideways — it wraps to a second row, which a fixed
   * 66px height then hides. So the old check never fired and the fifth tab
   * dropped out of the bar entirely. Grids need the track count rewritten, and
   * any absolutely-positioned highlight resized to match the new track.
   */
  function fitNav(nav) {
    // Only the horizontal mobile bar needs another grid column.
    if (!nav.matches('nav.bottom-nav')) return;
    var style = getComputedStyle(nav);
    var count = navCells(nav).length;
    if (!count) return;

    if (style.display.indexOf('grid') !== -1) {
      var tracks = (style.gridTemplateColumns || '').split(/\s+/).filter(function (value) {
        return value && value !== 'none';
      }).length;
      if (tracks >= count) return;

      /* Derived from the bar's own padding rather than hardcoded, so the
         highlight keeps lining up whatever the app's inset happens to be. */
      var pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      navOverlays(nav).forEach(function (overlay) {
        overlay.setAttribute('data-jamtytrack-navpill', '');
      });

      nav.setAttribute('data-jamtytrack-grid', String(count));
      var id = 'jamtytrack-nav-grid-' + count;
      if (document.getElementById(id)) return;
      var gridStyle = document.createElement('style');
      gridStyle.id = id;
      gridStyle.textContent =
        '[data-jamtytrack-grid="' + count + '"]{grid-template-columns:repeat(' + count + ',1fr) !important;}' +
        '[data-jamtytrack-grid="' + count + '"] > [data-jamtytrack-navpill]{' +
          'width:calc((100% - ' + pad + 'px) / ' + count + ') !important;}' +
        '[data-jamtytrack-grid="' + count + '"] > * > span{max-width:100%;white-space:nowrap;' +
          'overflow:hidden;text-overflow:ellipsis;}';
      document.head.appendChild(gridStyle);
      return;
    }

    if (nav.scrollWidth <= nav.clientWidth + 2) return;
    nav.setAttribute('data-jamtytrack-fit', '1');
    if (document.getElementById('jamtytrack-nav-fit')) return;

    var flexStyle = document.createElement('style');
    flexStyle.id = 'jamtytrack-nav-fit';
    flexStyle.textContent =
      '[data-jamtytrack-fit]{gap:2px !important;column-gap:2px !important;}' +
      '[data-jamtytrack-fit] > *{min-width:0 !important;flex:1 1 0 !important;' +
        'padding-left:3px !important;padding-right:3px !important;}' +
      '[data-jamtytrack-fit] > * *{max-width:100%;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis;}';
    document.head.appendChild(flexStyle);
  }

  /* Hidden responsive bars have no layout box, including their fixed children. */
  function isShown(node) {
    var rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
  }

  function ensureNavItem() {
    var nav = findNav();
    var existing = document.querySelector('[' + NAV_FLAG + ']');
    if (existing) {
      if (existing.parentElement === nav && isShown(existing)) return true;
      /* The bar it lives in is hidden — the app swaps its bottom bar for a
         sidebar above 760px. Drop the stale item so a fresh placement (or the
         floating fallback) can take over. */
      releaseNavHighlight();
      var previousNav = existing.parentElement;
      existing.remove();
      if (previousNav) {
        previousNav.removeAttribute('data-jamtytrack-grid');
        previousNav.removeAttribute('data-jamtytrack-fit');
        navOverlays(previousNav).forEach(function (overlay) {
          overlay.removeAttribute('data-jamtytrack-navpill');
        });
      }
    }

    if (!nav) return false;
    var item = buildNavItem(nav);
    if (!item) return false;

    /*
     * Appended LAST, not second-to-last as the photos launcher does.
     *
     * The app highlights the active tab with a single pill positioned by an
     * index into the app's OWN tab array ('--nav-index'). Inserting ahead of a
     * native tab shifts that tab one cell right while its index stays put, so
     * the highlight lands on the wrong tab. Appending after every native tab
     * leaves every native index pointing at the cell it already pointed at.
     *
     * The cost is that this sits after Settings rather than before it. That is
     * the right trade: a launcher in an unconventional position is a small
     * oddity, a highlight under the wrong tab reads as a broken app.
     */
    nav.appendChild(item);

    /* Judge by the result, not the placement: if it landed somewhere invisible,
       report failure so the floating fallback takes the job. */
    if (!isShown(item)) {
      item.remove();
      return false;
    }

    fitNav(nav);
    return true;
  }

  /* ----------------------------------------------------------------- mount */

  function addFallbackButton() {
    if (root.querySelector('.fab')) return;
    /* Sits above the photos fallback (88px) so the two cannot overlap when
       neither finds a nav. */
    var fab = el('button', { class: 'fab', 'aria-label': 'Habits', title: 'Habits' }, '\u2713');
    fab.addEventListener('click', open);
    root.appendChild(fab);
  }

  function mount() {
    host = el('div');
    /*
     * ABSOLUTE, NOT FIXED. This one word decides whether the sheet is visible.
     *
     * 'position:fixed' ALWAYS creates a stacking context. With the host fixed,
     * the sheet's z-index of 2147483001 only ranked against its own siblings
     * inside that context, while the host itself entered the page at z-index
     * auto — so every app element with a positive z-index painted OVER the
     * sheet. In this app that is .calorie-copy and .calorie-ring at z-index 1,
     * which is why the calorie figures showed through the panel, plus
     * .modal-backdrop (100), .photo-viewer (80), .saved-toast (60) and
     * .mobile-bar (50). Scrolling then slid those layers across a stationary
     * sheet, which is what read as tearing.
     *
     * 'position:absolute' with z-index auto creates NO stacking context, so the
     * sheet competes at the root and outranks all of them. The host is still
     * out of flow at 0x0, so it contributes no line box — which is the reason
     * it was taken out of flow in the first place. Fixed descendants stay
     * viewport-anchored either way: only transform/filter/perspective on an
     * ancestor would change that, and there is none here.
     */
    host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;';
    root = host.attachShadow({ mode: 'open' });
    root.appendChild(el('style', null, buildStyle(readTheme())+rewardsStyle(readTheme())));
    document.body.appendChild(host);

    if (!ensureNavItem()) addFallbackButton();
    settleHome();

    var queued = false;
    function settle() {
      settleHome();
      if (!document.body.contains(host)) document.body.appendChild(host);
      if (ensureNavItem()) {
        var fab = root.querySelector('.fab');
        if (fab) fab.remove();
      } else {
        addFallbackButton();
      }
      /*
       * React owns --nav-index and the .active class, and rewrites both on any
       * render — a dashboard refresh mid-session would otherwise snap the pill
       * back to the app's tab while the habits panel is still open. Re-asserting
       * here is idempotent: claimNavHighlight() keeps the first saved values, so
       * close() still restores the state the app actually had.
       */
      if (isOpen()) {
        claimNavHighlight();
        applyReserve();
      }
    }

    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        settle();
      });
    }).observe(document.body, { childList: true, subtree: true });

    /* Crossing the app's 760px breakpoint swaps the bottom bar for a sidebar
       without necessarily mutating the body, so the observer alone would miss
       it — the launcher would stay in a bar the media query has hidden. */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(settle, 180);
    });
    function refreshVisible() {
      if(document.hidden||(!isOpen()&&!(homeHost&&homeHost.isConnected)))return;
      var before=journey;
      refresh().then(function(){
        if(isOpen()&&tab==='today'&&!(root.activeElement&&root.activeElement.matches('input,select,textarea')))render();
        noticeProgress(before);
      }).catch(function(){});
    }
    document.addEventListener('visibilitychange',refreshVisible);
    setInterval(refreshVisible,60000);
  }

  /* Wait for the app to paint: on DOMContentLoaded an SPA body is still empty,
     so readTheme() would sample an unpainted page and find no nav. */
  function start() {
    var attempts = 0;
    (function poll() {
      if (findNav() || attempts++ > 40) { mount(); return; }
      setTimeout(poll, 150);
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
