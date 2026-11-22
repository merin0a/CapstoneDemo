/* app.js: behaviour for the Carmela Subdivision prototype (demo, nothing saved). Load after layout.js. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const on = (ev, fn) => document.addEventListener(ev, fn);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  const iso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const dates = () => $$('form[data-demo="visitor"] input[type=date]').forEach(d => d.defaultValue = d.value = d.min = iso());
  const openDlg = id => { const d = document.getElementById(id); d?.showModal?.(); return d; };

  /* theme */
  const root = document.documentElement;
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  try { const t = localStorage.getItem('cc_theme'); if (t) root.dataset.theme = t; } catch (e) { }

  /* toast */
  const toast = (msg, tone = '') => {
    const host = $('#toast-root'); if (!host) return;
    const t = Object.assign(document.createElement('div'), { className: 'toast ' + tone, textContent: msg });
    t.setAttribute('role', 'status'); host.append(t);
    setTimeout(() => t.classList.add('out'), 2800); setTimeout(() => t.remove(), 3300);
  };
  window.CC = { toast };

  /* click actions: one entry per data-* attribute */
  const A = {
    'data-theme-toggle': () => { const n = isDark() ? 'light' : 'dark'; root.dataset.theme = n; try { localStorage.setItem('cc_theme', n); } catch (e) { } },
    'data-open': t => {
      const d = openDlg(t.dataset.open); if (!d) return;
      if (t.dataset.title) $('[data-dlg-title]', d)?.replaceChildren(t.dataset.title);
      if (t.dataset.block) { d.dataset.block = t.dataset.block; $('[data-dlg-block]', d)?.replaceChildren(t.dataset.block); }
    },
    'data-close': t => t.closest('dialog')?.close(),
    'data-print': () => print(),
    'data-csv': t => exportCsv(t.dataset.csv, t.dataset.file || 'export.csv'),
    'data-copy': t => { const s = $(t.dataset.copy); (navigator.clipboard ? navigator.clipboard.writeText((s?.value || s?.textContent || '').trim()) : Promise.reject()).then(() => toast('Copied.'), () => toast('Select the text and copy it manually.', 'err')); },
    'data-set-status': setStatus,
    'data-affect': t => { const n = $('[data-affect-n]'), p = t.classList.toggle('primary'); t.classList.toggle('ghost', !p); n.textContent = +n.textContent + (p ? 1 : -1); $('[data-affect-t]', t).textContent = p ? 'You said this affects you too' : 'This affects me too'; },
    'data-gate': t => { const row = t.closest('.gate-row'), a = t.dataset.gate; if (a === 'left') { setGate(row, 'left'); toast('Checked out.'); } if (a === 'denied') { setGate(row, 'denied'); toast('Entry denied. Resident notified (demo).'); } },
    'data-open-checkin': t => { const row = t.closest('.gate-row'), d = openDlg('checkin'); d.dataset.row = row.id; $('[data-who]', d).textContent = row.dataset.name; },
    'data-del': t => { const el = t.closest(t.dataset.del); if (el) { el.remove(); toast('Removed.'); } },
    'data-use-cat': t => { const s = $('#category'); if (s) s.value = t.dataset.useCat; $('#suggest-box').hidden = true; },
    'data-approve': t => { const r = t.closest('[data-res]'), s = $('[data-res-status]', r), ok = t.dataset.approve === 'yes'; s.className = 'chip ' + (ok ? 'green' : 'red'); s.textContent = ok ? 'Approved' : 'Declined'; $$('[data-approve]', r).forEach(b => b.remove()); toast(`Reservation ${ok ? 'approved' : 'declined'}. Resident notified (demo).`); }
  };
  const actionSel = Object.keys(A).map(k => `[${k}]`).join();
  on('click', e => {
    const t = e.target.closest(actionSel);
    if (!t) return e.target.tagName === 'DIALOG' && e.target.close();   // click on dialog backdrop
    A[Object.keys(A).find(k => t.hasAttribute(k))](t);
  });

  /* list filtering: chips, selects and search drive one list */
  function filter(id) {
    const list = document.getElementById(id); if (!list) return;
    const ctl = $$(`[data-filter-for="${id}"]`), empty = $$(`[data-empty-for="${id}"]`), q = ($(`[data-search-for="${id}"]`)?.value || '').toLowerCase();
    let n = 0;
    $$('[data-item]', list).forEach(it => {
      const ok = ctl.every(c => { const v = c.matches('select,input') ? c.value : $('.on', c)?.dataset.value, k = c.dataset.filterKey; return !v || v === 'all' || (v === 'open' ? it.dataset[k] !== 'resolved' : it.dataset[k] === v); })
        && (!q || it.textContent.toLowerCase().includes(q));
      it.hidden = !ok; n += ok;
    });
    $$(`[data-count-for="${id}"]`).forEach(x => x.textContent = n);
    empty.forEach(x => x.hidden = n > 0);
    list.hidden = n === 0 && empty.length > 0;
  }
  on('click', e => {
    const b = e.target.closest('[data-filter-for] button'); if (!b) return;
    const g = b.closest('[data-filter-for]');
    $$('button', g).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    filter(g.dataset.filterFor);
  });
  on('input', e => { const s = e.target.closest('[data-search-for],select[data-filter-for]'); if (s) filter(s.dataset.searchFor || s.dataset.filterFor); });
  on('change', e => {
    const s = e.target.closest('select[data-filter-for]'); if (s) filter(s.dataset.filterFor);
    const f = e.target.closest('input[type=file][data-preview]');
    if (f?.files[0]) { const r = new FileReader(); r.onload = () => $('#' + f.dataset.preview).innerHTML = `<img alt="Selected photo" src="${r.result}">`; r.readAsDataURL(f.files[0]); }
    const p = e.target.closest('[data-party]');
    if (p) { toast('Responsible party set to ' + p.options[p.selectedIndex].text + '.'); const w = $('#dev-wait'); if (w) w.hidden = p.value !== 'developer'; }
  });

  /* category suggestion (keyword preview; an AI model can replace it later) */
  const RULES = [['Drainage / flooding', /drain|flood|baha|canal|clog/i], ['Water supply', /brown|dirty water|no water|walang tubig|murky/i], ['Streetlight', /street ?light|lamp|dark|ilaw/i], ['Road damage', /pothole|road|crack|butas/i], ['Stray animals', /dog|aso|stray|pusa/i], ['Noise / disturbance', /noise|karaoke|loud|ingay|drunk|lasing/i], ['Security concern', /security|suspicious|theft|nakaw|trespass/i], ['Internet / utilities', /internet|wifi|wi-fi|cable|provider/i], ['Water leak (warranty)', /leak|tulo|tagas/i]];
  on('input', e => {
    if (!e.target.matches('[data-suggest]')) return;
    const box = $('#suggest-box'), s = $('#category'), hit = RULES.find(r => r[1].test(e.target.value))?.[0];
    box.hidden = !(hit && s.value !== hit && $$('option', s).some(o => o.value === hit));
    if (!box.hidden) box.innerHTML = `Looks like <b>${esc(hit)}</b>. <button type="button" class="link" data-use-cat="${esc(hit)}">Use this</button> <span class="small">· keyword preview, an AI model can replace this later</span>`;
  });

  /* demo forms */
  const FORMS = {
    visitor: f => { $('#code-out').textContent = 'V-' + (2044 + Math.floor(Math.random() * 40)); $('#code-name').textContent = f.elements.name.value; openDlg('code-dlg'); f.reset(); dates(); },
    announce: f => {
      const list = $('#ann-list') || $('.ann')?.parentElement; if (!list) return toast('Could not find the announcement list.', 'err');
      const pin = f.elements.pin.checked, a = document.createElement('article');
      a.className = 'ann' + (pin ? ' pin' : '');
      a.innerHTML = `<div class="ann-h"><b>${esc(f.elements.title.value)}</b>${pin ? '<span class="chip brand">Pinned</span>' : ''}</div><p>${esc(f.elements.body.value)}</p><small class="muted">just now · Posted by HOA</small>`;
      pin ? list.prepend(a) : list.insertBefore(a, $('.ann:not(.pin)', list));   // pinned first, others after them
      f.reset(); toast('Announcement posted. Residents are notified (demo).');
    },
    walkin: addWalkIn,
    note: f => {
      const li = document.createElement('li'); li.className = $('[data-status-chip]') ? currentStatus() : 'pending';
      li.innerHTML = `<span class="tl-dot"></span><div><b>Update</b> · just now<p>${esc(f.elements.note.value)} <small class="muted">— HOA</small></p></div>`;
      $('#timeline').prepend(li); f.reset(); toast('Update posted. Resident notified (demo).');
    }
  };
  on('submit', e => {
    const f = e.target.closest('form[data-demo]'); if (!f) return;
    e.preventDefault(); if (!f.reportValidity()) return;
    if (FORMS[f.dataset.demo]) return FORMS[f.dataset.demo](f);
    toast(f.dataset.toast || 'Saved.');
    if (f.dataset.redirect) setTimeout(() => location.href = f.dataset.redirect, 900);
  });

  /* admin: request status */
  const STATUS = { pending: ['Pending', 'amber'], in_progress: ['In progress', 'blue'], resolved: ['Resolved', 'green'] };
  const currentStatus = () => $('#status-group .on')?.dataset.setStatus || 'pending';
  function setStatus(b) {
    const s = b.dataset.setStatus, [label, tone] = STATUS[s], c = $('[data-status-chip]'), li = document.createElement('li');
    $$('#status-group button').forEach(x => x.classList.toggle('on', x === b));
    c.className = 'chip ' + tone; c.textContent = label; li.className = s;
    li.innerHTML = `<span class="tl-dot"></span><div><b>${label}</b> · just now<p>Status changed by HOA.</p></div>`;
    $('#timeline').prepend(li); toast(`Status set to “${label}”. Resident notified (demo).`);
  }

  /* guard: gate log */
  const GATE = { expected: ['Expected', 'amber'], arrived: ['On site', 'green'], left: ['Left', ''], denied: ['Denied', 'red'] };
  function setGate(row, st, note) {
    const c = $('[data-gate-chip]', row); c.className = 'chip ' + GATE[st][1]; c.textContent = GATE[st][0]; row.dataset.status = st;
    $('.gate-act', row).innerHTML = st === 'arrived' ? '<button class="btn sm" data-gate="left">Mark left</button>' : '';
    if (note) $('[data-gate-note]', row)?.replaceChildren(note);
  }
  on('submit', e => {
    const f = e.target.closest('form[data-checkin]'), l = e.target.closest('form[data-code-lookup]');
    if (f) {
      e.preventDefault();
      const d = $('#checkin'), plate = f.elements.plate.value ? ' · Plate ' + f.elements.plate.value.toUpperCase() : '';
      setGate(document.getElementById(d.dataset.row), 'arrived', `ID left: ${f.elements.idleft.value}${plate} · in at ${now()}`);
      d.close(); f.reset(); toast('Checked in. Resident notified (demo).');
    } else if (l) {
      e.preventDefault();
      const code = l.elements.code.value.trim().toLowerCase(), rows = $$('.gate-row'), row = rows.find(r => (r.dataset.code || '').toLowerCase() === code);
      rows.forEach(r => r.style.background = '');
      if (!row) return toast('No visitor with that code. Use “Log a walk-in”.', 'err');
      row.style.background = 'var(--brand-soft)'; row.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Found: ' + row.dataset.name);
    }
  });
  function addWalkIn(f) {
    const id = 'w' + Date.now(), n = f.elements.name.value, row = document.createElement('div');
    Object.assign(row, { className: 'gate-row', id });
    Object.assign(row.dataset, { name: 'Walk-in: ' + n, status: 'arrived', code: 'W-' + id.slice(-3) });
    row.innerHTML = `<div class="grow"><b>Walk-in: ${esc(n)}</b><div class="small muted">${esc(f.elements.type.value)} → ${esc(f.elements.dest.value)}${f.elements.confirmed.checked ? ' · confirmed by phone' : ' · <b style="color:var(--red)">not confirmed</b>'}</div><div class="small muted" data-gate-note>ID left: ${esc(f.elements.idleft.value)} · in at ${now()}</div></div><span class="chip green" data-gate-chip>On site</span><div class="gate-act"><button class="btn sm" data-gate="left">Mark left</button></div>`;
    $('#gate-list').prepend(row); $('#walkin').close(); f.reset(); toast('Walk-in logged.');
  }

  /* CSV export of a table */
  function exportCsv(id, name) {
    const t = document.getElementById(id); if (!t) return;
    const rows = $$('tr', t).filter(r => !r.hidden).map(r => $$('th,td', r).map(c => '"' + c.textContent.replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"').join(','));
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv' })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  /* start-up */
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) $$('.view > *').forEach((el, i) => { el.classList.add('rv'); el.style.animationDelay = Math.min(i * 45, 320) + 'ms'; });
  dates(); $$('[data-filter-for]').forEach(c => filter(c.dataset.filterFor));
})();