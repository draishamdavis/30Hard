/* 30 HARD  ·  App logic (vanilla JS, local-first, no build step) */
(function () {
  'use strict';

  const TOTAL_DAYS = 30;
  const STORE_KEY = '30hard.v1';
  const RING_C = 2 * Math.PI * 92;

  /* ─────────────── State ─────────────── */

  const todayISO = () => toISO(new Date());
  function toISO(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

  function defaultState() {
    return { start: todayISO(), theme: 'system', reqs: {}, days: {}, why: { why: '', word: '', becoming: '', verse: '' } };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) { /* storage unavailable: fall back to in-memory state */ }
    return defaultState();
  }
  let state = load();
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }

  function dayRecord(n) {
    if (!state.days[n]) state.days[n] = { done: {}, water: 0, devo: false, journal: '' };
    return state.days[n];
  }
  function peekDay(n) { return state.days[n] || { done: {}, water: 0, devo: false, journal: '' }; }

  /* ─────────────── Derived values ─────────────── */

  function daysSinceStart() {
    return Math.round((fromISO(todayISO()) - fromISO(state.start)) / 86400000);
  }
  function currentDay() { return Math.min(TOTAL_DAYS, Math.max(1, daysSinceStart() + 1)); }
  function dateForDay(n) { const d = fromISO(state.start); d.setDate(d.getDate() + n - 1); return d; }

  const commitments = () => window.COMMITMENTS.map(c => Object.assign({}, c, { req: state.reqs[c.id] || c.req }));
  function isDone(rec, c) { return c.count ? (rec.water || 0) >= c.count : !!rec.done[c.id]; }
  function dayPct(n) {
    const rec = peekDay(n), list = commitments();
    return list.filter(c => isDone(rec, c)).length / list.length;
  }
  function dayStatus(n) {
    const cur = currentDay(), pct = dayPct(n);
    if (n > cur) return 'upcoming';
    if (pct === 1) return 'complete';
    if (pct > 0) return 'partial';
    return n === cur ? 'empty' : 'missed';
  }

  /* ─────────────── Helpers ─────────────── */

  const $ = (sel, root = document) => root.querySelector(sel);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function icon(name) {
    return `<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.ICONS[name] || ''}</svg>`;
  }
  function hydrateIcons(root = document) {
    root.querySelectorAll('i[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
  }
  function fmtDate(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
  function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  }

  function applyTheme() {
    const root = document.documentElement;
    if (state.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
  }

  /* ─────────────── Routing ─────────────── */

  const VIEWS = ['today', 'devotional', 'progress', 'why'];
  let viewDay = null;   // Today screen can show a past day
  let devoDay = null;   // Devotional screen can show a past day

  function route(keepScroll) {
    const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
    document.querySelectorAll('.tab').forEach(t => {
      if (t.dataset.nav === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    ({ today: renderToday, devotional: renderDevo, progress: renderProgress, why: renderWhy })[name]();
    if (keepScroll !== true) window.scrollTo(0, 0);
  }
  function go(name) {
    if (location.hash === `#${name}`) route(); else location.hash = name;
  }

  /* ─────────────── Today ─────────────── */

  function renderToday() {
    const cur = currentDay();
    const n = viewDay || cur;
    const rec = peekDay(n);
    const devo = window.DEVOTIONALS[n - 1];
    const list = commitments();
    const pre = daysSinceStart() < 0;
    const post = daysSinceStart() >= TOTAL_DAYS;
    ringShown = 0;

    let banner = '';
    if (n !== cur) {
      banner = `<div class="viewing-banner"><span>Viewing ${esc(fmtDate(dateForDay(n)))}</span><button data-act="back-today">Back to today</button></div>`;
    } else if (pre) {
      banner = `<div class="viewing-banner"><span>Your 30 days begin ${esc(fmtDate(fromISO(state.start)))}</span></div>`;
    } else if (post) {
      banner = `<div class="viewing-banner"><span>You finished all 30 days. Well done.</span><button data-act="open-settings">Start again</button></div>`;
    }

    $('#view-today').innerHTML = `
      <div class="day-head">
        <div class="eyebrow">${n === cur ? 'Today' : 'Looking back'}</div>
        <div class="day-count">DAY ${pad(n)} <small>/ ${TOTAL_DAYS}</small></div>
        <div class="day-date">${esc(fmtDate(dateForDay(n)))}</div>
        ${banner}
      </div>

      <button class="focus ${rec.devo ? 'done' : ''}" data-act="open-devo" data-day="${n}">
        <div class="focus-top"><span class="eyebrow">${n === cur ? 'Today’s Focus' : `Day ${pad(n)} Focus`}</span>${icon(rec.devo ? 'circleCheck' : 'bookHeart')}</div>
        <div class="focus-theme">${esc(devo.theme)}</div>
        <div class="focus-ref">${esc(devo.ref)}</div>
        <span class="focus-link">${rec.devo ? 'Devotional complete' : 'Read today’s devotional'} ${icon('arrowRight')}</span>
      </button>

      <div class="ring-wrap">
        <div class="ring" role="img" aria-label="Daily progress">
          <svg viewBox="0 0 208 208"><circle class="track" cx="104" cy="104" r="92" fill="none" stroke-width="8"/>
            <circle class="fill" cx="104" cy="104" r="92" fill="none" stroke-width="8" stroke-linecap="round"
              stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>
          <div class="ring-label">
            <div class="ring-pct" id="ringPct">0<sup>%</sup></div>
            <div class="eyebrow ring-sub">${n === cur ? 'Today' : `Day ${pad(n)}`}</div>
          </div>
        </div>
      </div>

      <div class="section-head">
        <span class="eyebrow">Daily Commitments</span>
        <span class="count" id="doneCount"></span>
      </div>
      <div class="cards" id="cards">
        ${list.map(c => cardHTML(c, rec)).join('')}
      </div>
      <div class="day-complete" id="dayComplete">
        <strong>Every commitment kept.</strong>
        Faithful in the small things. Rest well tonight.
      </div>
    `;
    requestAnimationFrame(() => requestAnimationFrame(updateTodayMeta));
  }

  function cardHTML(c, rec) {
    const done = isDone(rec, c);
    if (c.count) {
      const w = rec.water || 0;
      return `
        <div class="card ${done ? 'done' : ''}" data-id="${c.id}" role="button" tabindex="0" aria-pressed="${done}" aria-label="${esc(c.name)}, ${w} of ${c.count}">
          <div class="card-icon">${icon(c.icon)}</div>
          <div>
            <div class="card-name">${esc(c.name)}</div>
            <div class="card-req">${esc(c.req)} · <span class="w-num">${w}</span>/${c.count}</div>
            <div class="water-dots">${Array.from({ length: c.count }, (_, i) => `<i class="${i < w ? 'on' : ''}"></i>`).join('')}</div>
          </div>
          <div class="water-ctrl">
            <button class="mini" data-act="water-minus" aria-label="Remove one glass">&minus;</button>
            <span class="check">${icon('check')}</span>
          </div>
        </div>`;
    }
    return `
      <div class="card ${done ? 'done' : ''}" data-id="${c.id}" role="button" tabindex="0" aria-pressed="${done}" aria-label="${esc(c.name)}: ${esc(c.req)}">
        <div class="card-icon">${icon(c.icon)}</div>
        <div>
          <div class="card-name">${esc(c.name)}</div>
          <div class="card-req">${esc(c.req)}</div>
        </div>
        <span class="check">${icon('check')}</span>
      </div>`;
  }

  let ringShown = 0;
  function updateTodayMeta() {
    const n = viewDay || currentDay();
    const pct = dayPct(n);
    const list = commitments(), rec = peekDay(n);
    const done = list.filter(c => isDone(rec, c)).length;
    const fill = $('#view-today .ring .fill');
    if (fill) fill.style.strokeDashoffset = RING_C * (1 - pct);
    $('#doneCount').textContent = `${done} of ${list.length}`;
    $('#dayComplete').classList.toggle('show', pct === 1);
    countTo($('#ringPct'), ringShown, Math.round(pct * 100));
    ringShown = Math.round(pct * 100);
  }

  function countTo(el, from, to) {
    if (!el) return;
    const start = performance.now(), dur = 700;
    const step = t => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3);
      el.innerHTML = `${Math.round(from + (to - from) * e)}<sup>%</sup>`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function editableDay() {
    const n = viewDay || currentDay();
    if (daysSinceStart() < 0) { toast('Your challenge has not started yet'); return null; }
    return n;
  }

  function onCardTap(card, minus) {
    const n = editableDay(); if (!n) return;
    const c = commitments().find(x => x.id === card.dataset.id);
    const rec = dayRecord(n);
    const was = isDone(rec, c);
    if (c.count) {
      rec.water = Math.max(0, Math.min(c.count, (rec.water || 0) + (minus ? -1 : 1)));
      card.querySelector('.w-num').textContent = rec.water;
      card.querySelectorAll('.water-dots i').forEach((d, i) => d.classList.toggle('on', i < rec.water));
      if (!minus && was) toast('Water goal already met');
    } else {
      rec.done[c.id] = !rec.done[c.id];
    }
    const now = isDone(rec, c);
    card.classList.toggle('done', now);
    card.setAttribute('aria-pressed', now);
    if (now && !was) { card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop'); haptic(); }
    save();
    updateTodayMeta();
  }

  /* ─────────────── Devotional ─────────────── */

  function renderDevo() {
    const cur = currentDay();
    const n = devoDay || cur;
    const d = window.DEVOTIONALS[n - 1];
    const rec = peekDay(n);

    $('#view-devotional').innerHTML = `
      <article class="devo">
        <div class="devo-nav">
          <button class="icon-btn" data-act="devo-prev" aria-label="Previous day" ${n <= 1 ? 'disabled' : ''}>${icon('chevronLeft')}</button>
          <span class="devo-day">DAY ${pad(n)}</span>
          <button class="icon-btn" data-act="devo-next" aria-label="Next day" ${n >= cur ? 'disabled' : ''}>${icon('chevronRight')}</button>
        </div>

        <h1 class="devo-title">${esc(d.theme)}</h1>
        <div class="devo-ref">${esc(d.ref)}</div>
        <hr class="devo-rule"/>

        <div class="devo-body">${d.body.map(p => `<p>${esc(p)}</p>`).join('')}</div>

        <section class="devo-block">
          <div class="eyebrow">Reflect</div>
          <p>${esc(d.reflect)}</p>
          <textarea class="devo-journal" id="journal" rows="3" placeholder="Write a few honest words…">${esc(rec.journal || '')}</textarea>
        </section>
        <section class="devo-block pray">
          <div class="eyebrow">Pray</div>
          <p>${esc(d.pray)}</p>
        </section>
        <section class="devo-block">
          <div class="eyebrow">Today</div>
          <p>${esc(d.today)}</p>
        </section>

        <div class="devo-foot">
          <button class="btn ${rec.devo ? 'done' : ''}" data-act="devo-complete" data-day="${n}">
            ${rec.devo ? `${icon('circleCheck')} Devotional Complete` : 'Mark Devotional Complete'}
          </button>
        </div>
      </article>
    `;

    $('#journal').addEventListener('input', e => {
      if (daysSinceStart() < 0) return;
      dayRecord(n).journal = e.target.value;
      save();
    });
  }

  /* ─────────────── Progress ─────────────── */

  function renderProgress() {
    const cur = currentDay();
    const elapsed = daysSinceStart() < 0 ? 0 : cur;
    const list = commitments();

    let perfect = 0, devos = 0, doneSum = 0;
    for (let n = 1; n <= elapsed; n++) {
      const pct = dayPct(n);
      if (pct === 1) perfect++;
      if (peekDay(n).devo) devos++;
      doneSum += pct;
    }
    // Streak counts back from today; an unfinished today does not break it.
    let streak = 0;
    for (let n = elapsed; n >= 1; n--) {
      if (dayPct(n) === 1) streak++;
      else if (n === elapsed) continue;
      else break;
    }
    const rate = elapsed ? Math.round((doneSum / elapsed) * 100) : 0;

    const cells = Array.from({ length: TOTAL_DAYS }, (_, i) => {
      const n = i + 1, s = dayStatus(n), p = Math.round(dayPct(n) * 100);
      const cls = [s, n === cur && daysSinceStart() >= 0 ? 'current' : ''].join(' ');
      return `<button class="cell ${cls}" style="--p:${p}%" data-act="open-day" data-day="${n}" ${s === 'upcoming' ? 'disabled' : ''}
        aria-label="Day ${n}, ${s === 'upcoming' ? 'upcoming' : p + ' percent'}">${pad(n)}</button>`;
    }).join('');

    const bars = list.map(c => {
      let hit = 0;
      for (let n = 1; n <= elapsed; n++) if (isDone(peekDay(n), c)) hit++;
      const pct = elapsed ? Math.round(hit / elapsed * 100) : 0;
      return `<div class="bar-row">${icon(c.icon)}
        <div><div class="bar-label"><span>${esc(c.name)}</span></div><div class="bar"><i data-w="${pct}"></i></div></div>
        <span class="bar-val">${hit}/${elapsed}</span></div>`;
    }).join('');

    $('#view-progress').innerHTML = `
      <div class="page-head">
        <div class="eyebrow">Progress</div>
        <h1 class="page-title">${elapsed ? `${elapsed} of ${TOTAL_DAYS} days` : 'Ready to begin'}</h1>
      </div>

      <div class="grid30">${cells}</div>
      <div class="legend">
        <span><i class="l-complete"></i>Completed</span>
        <span><i class="l-partial"></i>Partial</span>
        <span><i class="l-current"></i>Current</span>
        <span><i class="l-upcoming"></i>Upcoming</span>
      </div>

      <div class="stats">
        <div class="stat">${icon('flame')}<div class="stat-num">${streak}</div><div class="stat-label">Day streak</div></div>
        <div class="stat">${icon('circleCheck')}<div class="stat-num">${perfect}</div><div class="stat-label">Complete days</div></div>
        <div class="stat">${icon('trendingUp')}<div class="stat-num">${rate}<small>%</small></div><div class="stat-label">Consistency</div></div>
        <div class="stat">${icon('bookHeart')}<div class="stat-num">${devos}</div><div class="stat-label">Devotionals read</div></div>
      </div>

      <div class="section-head"><span class="eyebrow">By Commitment</span></div>
      <div class="bars">${bars}</div>
    `;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelectorAll('#view-progress .bar > i').forEach(b => { b.style.width = b.dataset.w + '%'; });
    }));
  }

  /* ─────────────── My Why ─────────────── */

  const WHY_PROMPTS = [
    { key: 'why',      icon: 'compass',   label: 'Why I started',            ph: 'I am doing this because…' },
    { key: 'word',     icon: 'target',    label: 'My word for these 30 days', ph: 'One word', word: true },
    { key: 'becoming', icon: 'sparkle',   label: 'Who I am becoming',         ph: 'By Day 30, I want to be someone who…' },
    { key: 'verse',    icon: 'bookHeart', label: 'My anchor verse',           ph: 'A verse to return to when it gets hard' }
  ];

  function renderWhy() {
    $('#view-why').innerHTML = `
      <div class="page-head">
        <div class="eyebrow">My Why</div>
        <h1 class="page-title">Remember what<br/>you are building.</h1>
      </div>
      ${WHY_PROMPTS.map(p => `
        <div class="why-block">
          <div class="why-q">${icon(p.icon)}<span class="eyebrow">${esc(p.label)}</span></div>
          <textarea class="why-answer ${p.word ? 'why-word' : ''}" data-key="${p.key}" rows="1" placeholder="${esc(p.ph)}">${esc(state.why[p.key] || '')}</textarea>
        </div>`).join('')}
      <div class="why-hint">${icon('pencil')} Tap any line to edit. Changes save automatically.</div>
    `;
    document.querySelectorAll('.why-answer').forEach(t => {
      autoGrow(t);
      t.addEventListener('input', () => { autoGrow(t); state.why[t.dataset.key] = t.value; save(); });
    });
  }
  function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

  /* ─────────────── Settings sheet ─────────────── */

  function renderSettings() {
    const list = window.COMMITMENTS;
    $('#settingsSheet').innerHTML = `
      <div class="grabber"></div>
      <div class="sheet-head">
        <h2 id="settingsTitle">Settings</h2>
        <button class="icon-btn" data-act="close-settings" aria-label="Close settings">${icon('x')}</button>
      </div>

      <div class="field">
        <label for="startDate">Day 01 began on</label>
        <input type="date" id="startDate" value="${state.start}"/>
      </div>

      <div class="field">
        <span class="label">Appearance</span>
        <div class="seg" role="group" aria-label="Appearance">
          ${['system', 'light', 'dark'].map(t => `<button data-act="theme" data-theme="${t}" aria-pressed="${state.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <span class="label">Your commitments</span>
        ${list.map(c => `
          <div class="edit-row">${icon(c.icon)}
            <div><div class="edit-name">${esc(c.name)}</div>
            <input type="text" data-req="${c.id}" value="${esc(state.reqs[c.id] || c.req)}" aria-label="${esc(c.name)} requirement"/></div>
          </div>`).join('')}
      </div>

      <button class="btn danger" data-act="reset">${icon('rotateCcw')} Reset all progress</button>
      <p class="fine">Your progress stays private on this device.<br/>Add 30 HARD to your Home Screen for the full app experience.</p>
    `;

    $('#startDate').addEventListener('change', e => {
      if (!e.target.value) return;
      state.start = e.target.value; viewDay = null; devoDay = null; save(); route(); toast('Start date updated');
    });
    document.querySelectorAll('[data-req]').forEach(inp => inp.addEventListener('input', () => {
      const v = inp.value.trim();
      if (v) state.reqs[inp.dataset.req] = v; else delete state.reqs[inp.dataset.req];
      save();
    }));
  }
  function openSettings() { renderSettings(); $('#app').classList.add('sheet-open'); }
  function closeSettings() { $('#app').classList.remove('sheet-open'); route(true); }

  /* ─────────────── Events ─────────────── */

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { viewDay = null; devoDay = null; go(nav.dataset.nav); return; }

    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act, day = Number(act.dataset.day);
      if (a === 'water-minus') { e.stopPropagation(); onCardTap(act.closest('.card'), true); return; }
      if (a === 'open-devo') { devoDay = day; go('devotional'); return; }
      if (a === 'back-today') { viewDay = null; renderToday(); return; }
      if (a === 'open-day') { viewDay = day === currentDay() ? null : day; go('today'); return; }
      if (a === 'devo-prev') { devoDay = Math.max(1, (devoDay || currentDay()) - 1); renderDevo(); window.scrollTo(0, 0); return; }
      if (a === 'devo-next') { devoDay = Math.min(currentDay(), (devoDay || currentDay()) + 1); renderDevo(); window.scrollTo(0, 0); return; }
      if (a === 'devo-complete') {
        if (daysSinceStart() < 0) { toast('Your challenge has not started yet'); return; }
        const rec = dayRecord(day); rec.devo = !rec.devo; save(); haptic();
        act.classList.toggle('done', rec.devo);
        act.innerHTML = rec.devo ? `${icon('circleCheck')} Devotional Complete` : 'Mark Devotional Complete';
        if (rec.devo) toast(`Day ${pad(day)} devotional complete`);
        return;
      }
      if (a === 'open-settings') { openSettings(); return; }
      if (a === 'close-settings') { closeSettings(); return; }
      if (a === 'theme') {
        state.theme = act.dataset.theme; save(); applyTheme();
        act.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === act));
        return;
      }
      if (a === 'reset') {
        if (confirm('Reset all progress, journal entries, and your start date? Your My Why answers stay.')) {
          state = Object.assign(defaultState(), { why: state.why, theme: state.theme, reqs: state.reqs });
          viewDay = null; devoDay = null; save(); closeSettings(); toast('Progress reset. Day 01 starts today.');
        }
        return;
      }
    }

    const card = e.target.closest('.card[data-id]');
    if (card) onCardTap(card, false);
  });

  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card[data-id]')) { e.preventDefault(); onCardTap(e.target, false); }
    if (e.key === 'Escape' && $('#app').classList.contains('sheet-open')) closeSettings();
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#sheetBackdrop').addEventListener('click', closeSettings);
  window.addEventListener('hashchange', () => route());

  // Roll over to the new day when the app returns from the background.
  let lastSeen = todayISO();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && todayISO() !== lastSeen) { lastSeen = todayISO(); viewDay = null; devoDay = null; route(); }
  });

  /* ─────────────── Boot ─────────────── */

  applyTheme();
  hydrateIcons();
  route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
