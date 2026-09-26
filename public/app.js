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
    return { start: todayISO(), onboarded: false, theme: 'system', reqs: {}, off: {}, days: {}, why: { why: '', word: '', becoming: '', verse: '' } };
  }
  let user = null;
  let state = defaultState();

  /* Account sync: the server holds the source of truth, and localStorage keeps an offline copy. */
  function cacheKey() { return `${STORE_KEY}.${user ? user.id : 'anon'}`; }
  function readCache() {
    try { return JSON.parse(localStorage.getItem(`${STORE_KEY}.session`) || 'null'); } catch (e) { return null; }
  }
  function writeCache() {
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(state));
      localStorage.setItem(`${STORE_KEY}.session`, JSON.stringify({ user, dirty }));
    } catch (e) { /* ignore */ }
  }
  function cachedState(u) {
    try { return JSON.parse(localStorage.getItem(`${STORE_KEY}.${u.id}`) || 'null'); } catch (e) { return null; }
  }
  function clearCache() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith(STORE_KEY)).forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  let dirty = false, syncTimer = null;
  function save() {
    dirty = true;
    writeCache();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 700);
  }
  async function sync(keepalive) {
    if (!user || !dirty) return;
    clearTimeout(syncTimer);
    try {
      const res = await fetch('/api/state', {
        method: 'PUT', credentials: 'same-origin', keepalive: !!keepalive,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state)
      });
      if (res.status === 401) { signedOut('Your session ended. Please sign in again.'); return; }
      if (res.ok) { dirty = false; writeCache(); }
    } catch (e) { /* offline: stays dirty and retries later */ }
  }
  async function api(path, method = 'GET', data) {
    const res = await fetch(`/api/${path}`, {
      method, credentials: 'same-origin',
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined
    });
    let payload = {};
    try { payload = await res.json(); } catch (e) { /* empty body */ }
    return { ok: res.ok, status: res.status, data: payload };
  }

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

  const commitments = () => window.COMMITMENTS
    .filter(c => !(state.off || {})[c.id])
    .map(c => Object.assign({}, c, { req: state.reqs[c.id] || c.req }));
  function isDone(rec, c) { return c.count ? (rec.water || 0) >= c.count : !!rec.done[c.id]; }
  function dayPct(n) {
    const rec = peekDay(n), list = commitments();
    return list.length ? list.filter(c => isDone(rec, c)).length / list.length : 0;
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
  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return user ? `${part}, ${user.name.split(' ')[0]}` : 'Today';
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
    if (!user || document.body.dataset.screen !== 'app') return;
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
        <div class="eyebrow">${n === cur ? esc(greeting()) : 'Looking back'}</div>
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

  function switchHTML(id, on, label) {
    return `<button class="switch" role="switch" data-toggle="${id}" aria-checked="${on}" aria-label="${esc(label)}"><span></span></button>`;
  }
  function commitmentEditor(src) {
    return window.COMMITMENTS.map(c => {
      const on = !src.off[c.id];
      return `
        <div class="edit-row ${on ? '' : 'is-off'}" data-row="${c.id}">${icon(c.icon)}
          <div><div class="edit-name">${esc(c.name)}</div>
          <input type="text" data-req="${c.id}" value="${esc(src.reqs[c.id] || c.req)}" aria-label="${esc(c.name)} target" ${on ? '' : 'disabled'}/></div>
          ${switchHTML(c.id, on, `Include ${c.name}`)}
        </div>`;
    }).join('');
  }
  function bindCommitmentEditor(root, src, onChange) {
    root.querySelectorAll('[data-req]').forEach(inp => inp.addEventListener('input', () => {
      const v = inp.value.trim();
      if (v) src.reqs[inp.dataset.req] = v; else delete src.reqs[inp.dataset.req];
      onChange();
    }));
    root.querySelectorAll('[data-toggle]').forEach(sw => sw.addEventListener('click', () => {
      const id = sw.dataset.toggle, turningOff = !src.off[id];
      const activeCount = window.COMMITMENTS.filter(c => !src.off[c.id]).length;
      if (turningOff && activeCount <= 1) { toast('Keep at least one commitment'); return; }
      if (turningOff) src.off[id] = true; else delete src.off[id];
      sw.setAttribute('aria-checked', !turningOff);
      const row = root.querySelector(`[data-row="${id}"]`);
      row.classList.toggle('is-off', turningOff);
      row.querySelector('input').disabled = turningOff;
      onChange();
    }));
  }

  function renderSettings() {
    $('#settingsSheet').innerHTML = `
      <div class="grabber"></div>
      <div class="sheet-head">
        <h2 id="settingsTitle">Settings</h2>
        <button class="icon-btn" data-act="close-settings" aria-label="Close settings">${icon('x')}</button>
      </div>

      <div class="field">
        <label for="profileName">Your name</label>
        <input type="text" id="profileName" value="${esc(user.name)}" maxlength="60" autocomplete="name"/>
        <div class="field-note">${esc(user.email)}</div>
      </div>

      <div class="field">
        <label for="startDate">Day 01 ${daysSinceStart() < 0 ? 'begins' : 'began'} on</label>
        <input type="date" id="startDate" value="${state.start}"/>
      </div>

      <div class="field">
        <span class="label">Appearance</span>
        <div class="seg" role="group" aria-label="Appearance">
          ${['system', 'light', 'dark'].map(t => `<button data-act="theme" data-theme="${t}" aria-pressed="${state.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
      </div>

      <div class="field" id="settingsCommitments">
        <span class="label">Your commitments</span>
        ${commitmentEditor(state)}
      </div>

      <button class="btn ghost" data-act="sign-out">${icon('logOut')} Sign out</button>
      <button class="btn danger" data-act="reset">${icon('rotateCcw')} Reset all progress</button>
      <p class="fine">Your progress syncs to your account, so you can sign in on any device.<br/>Add 30 HARD to your Home Screen for the full app experience.</p>
    `;

    $('#startDate').addEventListener('change', e => {
      if (!e.target.value) return;
      state.start = e.target.value; viewDay = null; devoDay = null; save(); route(true); toast('Start date updated');
    });
    let nameTimer;
    $('#profileName').addEventListener('input', e => {
      clearTimeout(nameTimer);
      const name = e.target.value.trim();
      if (!name) return;
      nameTimer = setTimeout(async () => {
        const r = await api('me', 'PATCH', { name }).catch(() => null);
        if (r && r.ok) { user = r.data.user; writeCache(); }
      }, 600);
    });
    bindCommitmentEditor($('#settingsCommitments'), state, save);
  }
  function openSettings() { renderSettings(); $('#app').classList.add('sheet-open'); }
  function closeSettings() { $('#app').classList.remove('sheet-open'); route(true); }

  /* ─────────────── Account: sign in and sign up ─────────────── */

  function showScreen(name) { document.body.dataset.screen = name; window.scrollTo(0, 0); }

  function renderAuth(mode = 'signup', message = '') {
    const signup = mode === 'signup';
    $('#gate').innerHTML = `
      <div class="gate-inner auth">
        <div class="auth-mark">30<span>HARD</span></div>
        <p class="auth-lede">Thirty days of discipline, wellness, and time with God.</p>

        <div class="seg auth-seg" role="tablist">
          <button role="tab" data-mode="signup" aria-pressed="${signup}">Create account</button>
          <button role="tab" data-mode="login" aria-pressed="${!signup}">Sign in</button>
        </div>

        <form class="auth-form" id="authForm" novalidate>
          ${signup ? `<label class="in"><span>Your name</span><input name="name" type="text" autocomplete="given-name" maxlength="60" required/></label>` : ''}
          <label class="in"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" required/></label>
          <label class="in"><span>Password</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required/></label>
          ${signup ? '<p class="hint">At least 8 characters.</p>' : ''}
          <p class="form-error" id="authError" role="alert">${esc(message)}</p>
          <button class="btn" type="submit">${signup ? 'Create my account' : 'Sign in'} ${icon('arrowRight')}</button>
        </form>
      </div>`;
    $('#gate').querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => renderAuth(b.dataset.mode)));
    $('#authForm').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target, btn = form.querySelector('button[type="submit"]');
      const data = Object.fromEntries(new FormData(form));
      btn.disabled = true;
      let r;
      try { r = await api(signup ? 'signup' : 'login', 'POST', data); }
      catch (err) { r = { ok: false, data: { error: 'You appear to be offline. Please try again.' } }; }
      btn.disabled = false;
      if (!r.ok) { $('#authError').textContent = r.data.error || 'Something went wrong. Please try again.'; return; }
      enter(r.data.user, r.data.state);
    });
    showScreen('auth');
    const first = $('#gate input');
    if (first && window.matchMedia('(hover: hover)').matches) first.focus();
  }

  function signedOut(message) {
    user = null; state = defaultState(); dirty = false;
    clearCache();
    $('#app').classList.remove('sheet-open');
    renderAuth('login', message || '');
  }

  function enter(u, serverState) {
    user = u;
    const local = cachedState(u);
    const session = readCache();
    // Prefer unsynced local edits made offline; otherwise trust the server.
    const useLocal = local && session && session.user && session.user.id === u.id && session.dirty;
    state = Object.assign(defaultState(), useLocal ? local : (serverState || {}));
    state.why = Object.assign(defaultState().why, state.why);
    dirty = !!useLocal;
    writeCache();
    if (dirty) sync();
    applyTheme();
    if (!state.onboarded) { renderOnboarding(); return; }
    startApp();
  }

  /* ─────────────── Onboarding: start date, commitments, why ─────────────── */

  let ob = null;
  function startOptions() {
    const t = new Date(), add = n => { const d = new Date(t); d.setDate(d.getDate() + n); return d; };
    const toMonday = ((8 - t.getDay()) % 7) || 7;
    return [
      { id: 'today', label: 'Today', date: toISO(t) },
      { id: 'tomorrow', label: 'Tomorrow', date: toISO(add(1)) },
      { id: 'monday', label: 'Next Monday', date: toISO(add(toMonday)) }
    ];
  }
  const shortDate = iso => fromISO(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  function renderOnboarding() {
    if (!ob) ob = { step: 0, start: toISO(new Date()), custom: false, off: Object.assign({}, state.off), reqs: Object.assign({}, state.reqs), why: state.why.why, word: state.why.word };
    const first = esc(user.name.split(' ')[0]);
    const steps = [
      () => {
        const opts = startOptions();
        const picked = ob.custom ? 'custom' : (opts.find(o => o.date === ob.start) || {}).id || 'custom';
        return `
          <div class="eyebrow">Step 1 of 3</div>
          <h1 class="ob-title">Welcome, ${first}.<br/>When does Day 01 begin?</h1>
          <p class="ob-lede">Choose the day your thirty days start. You can change it later in Settings.</p>
          <div class="choice-list">
            ${opts.map(o => `
              <button class="choice" data-start="${o.date}" aria-pressed="${picked === o.id}">
                <span class="choice-label">${o.label}</span><span class="choice-meta">${shortDate(o.date)}</span>
              </button>`).join('')}
            <button class="choice" data-start="custom" aria-pressed="${picked === 'custom'}">
              <span class="choice-label">Choose a date</span><span class="choice-meta">${picked === 'custom' ? shortDate(ob.start) : ''}</span>
            </button>
            <input type="date" class="date-in ${picked === 'custom' ? 'show' : ''}" id="obDate" value="${ob.start}" aria-label="Start date"/>
          </div>
          <div class="ob-summary">${icon('calendar')} Day 30 lands on <strong>${esc(fmtDate((() => { const d = fromISO(ob.start); d.setDate(d.getDate() + 29); return d; })()))}</strong></div>`;
      },
      () => `
          <div class="eyebrow">Step 2 of 3</div>
          <h1 class="ob-title">Choose your daily commitments.</h1>
          <p class="ob-lede">Turn off what does not fit this season and set targets that stretch you without breaking you.</p>
          <div id="obCommitments">${commitmentEditor(ob)}</div>`,
      () => `
          <div class="eyebrow">Step 3 of 3</div>
          <h1 class="ob-title">Why are you doing this?</h1>
          <p class="ob-lede">On the hard days, this is what you will come back to.</p>
          <label class="in"><span>Why I started</span><textarea id="obWhy" rows="3" placeholder="I am doing this because…">${esc(ob.why)}</textarea></label>
          <label class="in"><span>My word for these 30 days</span><input id="obWord" type="text" maxlength="24" placeholder="One word" value="${esc(ob.word)}"/></label>`
    ];

    $('#gate').innerHTML = `
      <div class="gate-inner onboard">
        <div class="ob-top">
          <button class="icon-btn" id="obBack" aria-label="Back" ${ob.step === 0 ? 'style="visibility:hidden"' : ''}>${icon('arrowLeft')}</button>
          <div class="ob-dots">${[0, 1, 2].map(i => `<i class="${i <= ob.step ? 'on' : ''}"></i>`).join('')}</div>
          <span style="width:40px"></span>
        </div>
        <div class="ob-body">${steps[ob.step]()}</div>
        <div class="ob-foot">
          <button class="btn" id="obNext">${ob.step === 2 ? `Begin my 30 days ${icon('arrowRight')}` : `Continue ${icon('arrowRight')}`}</button>
        </div>
      </div>`;

    if (ob.step === 0) {
      $('#gate').querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.start === 'custom') { ob.custom = true; renderOnboarding(); const d = $('#obDate'); d.focus(); if (d.showPicker) try { d.showPicker(); } catch (e) { /* ignore */ } return; }
        ob.custom = false; ob.start = b.dataset.start; renderOnboarding();
      }));
      $('#obDate').addEventListener('change', e => { if (e.target.value) { ob.start = e.target.value; ob.custom = true; renderOnboarding(); } });
    }
    if (ob.step === 1) bindCommitmentEditor($('#obCommitments'), ob, () => {});
    if (ob.step === 2) {
      $('#obWhy').addEventListener('input', e => { ob.why = e.target.value; });
      $('#obWord').addEventListener('input', e => { ob.word = e.target.value; });
    }
    $('#obBack').addEventListener('click', () => { ob.step = Math.max(0, ob.step - 1); renderOnboarding(); });
    $('#obNext').addEventListener('click', () => {
      if (ob.step < 2) { ob.step++; renderOnboarding(); window.scrollTo(0, 0); return; }
      Object.assign(state, { start: ob.start, off: ob.off, reqs: ob.reqs, onboarded: true });
      state.why.why = ob.why.trim();
      state.why.word = ob.word.trim();
      ob = null;
      save(); sync();
      startApp();
      toast(daysSinceStart() < 0 ? `Day 01 begins ${shortDate(state.start)}` : 'Day 01 begins today');
    });
    showScreen('onboard');
  }

  function startApp() {
    viewDay = null; devoDay = null;
    showScreen('app');
    if (!location.hash) history.replaceState(null, '', '#today');
    route();
  }

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
      if (a === 'sign-out') {
        (async () => {
          await sync();
          await api('logout', 'POST', {}).catch(() => null);
          signedOut();
        })();
        return;
      }
      if (a === 'reset') {
        if (confirm('Reset all progress and journal entries? Your commitments and My Why answers stay, and you will choose a new start date.')) {
          state = Object.assign(defaultState(), { why: state.why, theme: state.theme, reqs: state.reqs, off: state.off, onboarded: true });
          viewDay = null; devoDay = null; save();
          $('#app').classList.remove('sheet-open');
          ob = { step: 0, start: toISO(new Date()), custom: false, off: state.off, reqs: state.reqs, why: state.why.why, word: state.why.word };
          renderOnboarding();
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
    if (document.visibilityState === 'hidden') { sync(true); return; }
    if (!user || document.body.dataset.screen !== 'app') return;
    if (todayISO() !== lastSeen) { lastSeen = todayISO(); viewDay = null; devoDay = null; route(); }
  });
  window.addEventListener('online', () => sync());

  /* ─────────────── Boot ─────────────── */

  async function boot() {
    hydrateIcons();
    showScreen('loading');
    try {
      const r = await api('me');
      if (r.ok) { enter(r.data.user, r.data.state); return; }
      if (r.status === 401) { clearCache(); renderAuth('signup'); return; }
      throw new Error('server');
    } catch (e) {
      // Offline: reopen the last signed-in account from this device.
      const session = readCache();
      if (session && session.user) {
        user = session.user;
        state = Object.assign(defaultState(), cachedState(user) || {});
        dirty = !!session.dirty;
        applyTheme();
        if (state.onboarded) startApp(); else renderOnboarding();
        return;
      }
      renderAuth('signup', 'You appear to be offline. Connect to create an account or sign in.');
    }
  }
  boot();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
