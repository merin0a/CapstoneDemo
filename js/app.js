/* app.js: authenticated SQLite-backed frontend client for Carmela Subdivision. Load after layout.js. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const on = (ev, fn) => document.addEventListener(ev, fn);

  const iso = () => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };

  const dates = () => $$('form[data-demo="visitor"] input[type=date]').forEach(d => {
    d.defaultValue = d.value = d.min = iso();
  });

  const openDlg = id => {
    const d = document.getElementById(id);
    d?.showModal?.();
    return d;
  };

  /* theme */
  const root = document.documentElement;
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  try {
    const t = localStorage.getItem('cc_theme');
    if (t) root.dataset.theme = t;
  } catch (e) { }

  /* toast */
  const toast = (msg, tone = '') => {
    let host = $('#toast-root');
    if (!host) {
      host = Object.assign(document.createElement('div'), { id: 'toast-root' });
      host.setAttribute('aria-live', 'polite');
      document.body.append(host);
    }
    const t = Object.assign(document.createElement('div'), { className: 'toast ' + tone, textContent: msg });
    t.setAttribute('role', 'status');
    host.append(t);
    setTimeout(() => t.classList.add('out'), 2800);
    setTimeout(() => t.remove(), 3300);
  };
  window.CC = { toast };

  /* safe SVG icon builder (static paths only, no untrusted HTML) */
  const ICON_DEFS = {
    alert: [
      ['path', { d: 'M12 4l9 16H3z' }],
      ['path', { d: 'M12 10v4M12 17v.5' }],
    ],
    wrench: [
      ['path', { d: 'M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.7-.7-.7-2.7z' }],
    ],
    users: [
      ['circle', { cx: '9', cy: '8', r: '3.5' }],
      ['path', { d: 'M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5' }],
      ['circle', { cx: '17', cy: '9', r: '2.5' }],
      ['path', { d: 'M17 14.5c2.5 0 4 1.5 4.5 4.5' }],
    ],
    chevR: [['path', { d: 'M9 5l7 7-7 7' }]],
    clipboard: [
      ['rect', { x: '6', y: '4', width: '12', height: '17', rx: '2' }],
      ['path', { d: 'M9 4h6v3H9z' }],
      ['path', { d: 'M9 12h6M9 16h4' }],
    ],
    bell: [
      ['path', { d: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z' }],
      ['path', { d: 'M10 21h4' }],
    ],
    megaphone: [
      ['path', { d: 'M3 11v3l12 5V6z' }],
      ['path', { d: 'M15 9.5c2 .5 3 1.5 3 2.5s-1 2-3 2.5M6 14v5h3v-3' }],
    ],
    trash: [
      ['path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6' }],
    ],
    camera: [
      ['path', { d: 'M4 8h3l2-3h6l2 3h3v11H4z' }],
      ['circle', { cx: '12', cy: '13', r: '3.5' }],
    ],
  };

  function svgIcon(name, extraClass = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', extraClass ? `ic ${extraClass}` : 'ic');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const shapes = ICON_DEFS[name] || ICON_DEFS.bell;
    for (const [tag, attrs] of shapes) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, v);
      }
      svg.append(node);
    }
    return svg;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k === 'dataset' && typeof v === 'object') {
        Object.assign(node.dataset, v);
      } else if (k === 'hidden') {
        node.hidden = Boolean(v);
      } else {
        node.setAttribute(k, String(v));
      }
    }
    for (const child of children) {
      if (child === undefined || child === null || child === false) continue;
      node.append(child);
    }
    return node;
  }

  /* constants */
  const PARTY_LABEL = {
    unassigned: 'Not assigned',
    hoa: 'HOA',
    developer: 'Developer',
    lgu: 'LGU / barangay',
  };

  const STATUS = {
    pending: ['Pending', 'amber'],
    in_progress: ['In progress', 'blue'],
    resolved: ['Resolved', 'green'],
  };

  const GATE = {
    expected: ['Expected', 'amber'],
    arrived: ['On site', 'green'],
    left: ['Left', ''],
    denied: ['Denied', 'red'],
  };

  const VALID_IMAGE_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
  const MAX_IMAGE_DATA_LEN = 2_800_000;

  let currentUser = null;
  let activeReportId = null;
  let pendingPhotoDataUrl = '';
  let cachedReports = [];
  let cachedVisitors = [];

  const expectedRole = document.body.dataset.role || '';
  const currentPage = document.body.dataset.page || '';

  async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers['X-Requested-With'] = 'fetch';
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options = { ...options, body: JSON.stringify(options.body) };
    }
    const res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      method,
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && expectedRole) {
      window.location.replace(`../login.html?role=${encodeURIComponent(expectedRole)}&reason=session`);
      throw new Error('UNAUTHENTICATED');
    }
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function formatShortBlockLot(blockLot) {
    const m = String(blockLot || '').match(/Block\s*(\d+)\s*,?\s*Lot\s*(\d+)/i);
    return m ? `B${m[1]} L${m[2]}` : (blockLot || 'Resident');
  }

  function formatWaitDays(days) {
    const n = Number(days) || 0;
    return n > 0 ? `${n} days` : '—';
  }

  function hydrateUserShell(user) {
    const firstName = (user.name || '').trim().split(/\s+/)[0] || user.name;
    const shortBlockLot = formatShortBlockLot(user.blockLot);

    const avatarEl = $('.side-user .avatar');
    if (avatarEl) avatarEl.textContent = user.initials || 'SC';

    const sideNameEl = $('.side-user b');
    if (sideNameEl) sideNameEl.textContent = user.name;

    const sideSubEl = $('.side-user small');
    if (sideSubEl) {
      sideSubEl.textContent =
        user.role === 'resident'
          ? `Resident · ${shortBlockLot}`
          : user.role === 'admin'
            ? 'HOA Administrator'
            : 'Gate guard';
    }

    const welcomeH2 = $('.gate-welcome h2');
    if (welcomeH2) {
      welcomeH2.textContent = user.role === 'guard' ? `Good day, Guard ${firstName}` : `Good day, ${firstName}`;
    }

    const gateLive = $('.gate-live');
    if (gateLive && user.role === 'resident') {
      const dot = gateLive.querySelector('.gate-live-dot');
      if (dot) {
        gateLive.replaceChildren(dot, document.createTextNode(` Resident · ${shortBlockLot}`));
      }
    }

    const helloH1 = $('.hello h1');
    if (helloH1) helloH1.textContent = `Hi, ${firstName}`;

    const helloPs = $$('.hello p.muted');
    if (helloPs.length >= 2 && user.role === 'resident') {
      helloPs[1].textContent = user.blockLot;
    }

    if (currentPage === 'request-new.html' && user.role === 'resident') {
      const m = String(user.blockLot || '').match(/Block\s*(\d+)\s*,?\s*Lot\s*(\d+)/i);
      const blockSel = $('form[data-demo="request"] select[name="block"]');
      const lotInp = $('form[data-demo="request"] input[name="lot"]');
      if (m) {
        const blockVal = `Block ${m[1]}`;
        if (blockSel && [...blockSel.options].some(o => o.value === blockVal)) blockSel.value = blockVal;
        if (lotInp) lotInp.value = m[2];
      }
    }
  }

  /* Notifications */
  async function loadNotifications() {
    const dlg = $('#notif');
    if (!dlg) return;
    try {
      const { notifications } = await api('/api/notifications');
      const list = $('.list', dlg);
      if (list) {
        if (!notifications.length) {
          list.replaceChildren(
            el('div', { className: 'item' },
              el('span', { className: 'item-ic' }, svgIcon('bell')),
              el('span', { className: 'item-main' },
                el('span', { className: 'item-t', textContent: 'No notifications yet.' }),
                el('span', { className: 'item-s', textContent: 'Up to date' }),
              ),
            ),
          );
        } else {
          list.replaceChildren(
            ...notifications.map(n =>
              el('div', { className: 'item' + (n.unread ? ' unread' : '') },
                el('span', { className: 'item-ic brand' }, svgIcon(n.icon || 'bell')),
                el('span', { className: 'item-main' },
                  el('span', { className: 'item-t', textContent: n.text }),
                  el('span', { className: 'item-s', textContent: n.whenLabel }),
                ),
              ),
            ),
          );
        }
      }
      const hasUnread = notifications.some(n => n.unread);
      $$('.bell-dot').forEach(dot => {
        dot.hidden = !hasUnread;
      });
    } catch {
      // Ignore notification fetch errors if session redirect already triggered
    }
  }

  async function markNotificationsRead() {
    try {
      await api('/api/notifications/read', { method: 'POST' });
      $$('.bell-dot').forEach(dot => { dot.hidden = true; });
      $$('#notif .item.unread').forEach(item => item.classList.remove('unread'));
    } catch { }
  }

  /* Shared report item card builder (used on Admin Dashboard, Resident Home, Resident Requests) */
  function buildReportListItem(r) {
    const [stLabel, stTone] = STATUS[r.status] || ['Pending', 'amber'];
    const isService = r.type === 'service';
    const chips = [
      el('span', { className: `chip ${stTone}`, textContent: stLabel }),
    ];
    if (r.urgent) chips.push(el('span', { className: 'chip red', textContent: 'Urgent' }));
    if (r.party === 'developer') {
      chips.push(el('span', {
        className: 'chip red',
        textContent: `Developer${r.waitDays ? ` · waiting ${r.waitDays} days` : ''}`,
      }));
    } else if (r.party && r.party !== 'unassigned') {
      chips.push(el('span', { className: 'chip', textContent: PARTY_LABEL[r.party] || r.party }));
    }
    chips.push(el('span', { className: 'chip', textContent: `${r.affected} affected` }));

    return el('a', {
      className: 'item',
      href: `request-detail.html?id=${encodeURIComponent(r.id)}`,
      dataset: {
        item: '',
        status: r.status,
        owner: r.owner || 'community',
      },
    },
    el('span', { className: `item-ic ${isService ? 'blue' : 'amber'}` }, svgIcon(isService ? 'wrench' : 'alert')),
    el('span', { className: 'item-main' },
      el('span', { className: 'item-t', textContent: r.title }),
      el('span', { className: 'item-s', textContent: `${r.where} · ${r.category} · ${r.reportedRelative || r.reported}` }),
      el('span', { className: 'chips' }, ...chips),
    ),
    svgIcon('chevR', 'item-chev'),
    );
  }

  /* Admin Dashboard */
  async function loadAdminDashboard() {
    const data = await api('/api/dashboard/admin');

    const tiles = $$('.g3 .tile');
    if (tiles[0]) {
      $('.tile-v', tiles[0]).textContent = String(data.openCount);
      $('.tile-s', tiles[0]).textContent = `${data.pendingCount} still pending`;
    }
    if (tiles[1]) {
      $('.tile-v', tiles[1]).textContent = String(data.devWaitingCount);
      $('.tile-s', tiles[1]).textContent =
        data.devWaitingCount > 0 ? `Oldest: ${data.oldestDevWaitDays} days` : 'None waiting';
    }
    if (tiles[2]) {
      $('.tile-v', tiles[2]).textContent = String(data.visitorsToday);
      $('.tile-s', tiles[2]).textContent = `${data.onSiteNow} on site now`;
    }

    // Schematic block map counts & heat styling
    const blockCounts = data.blockCounts || {};
    $$('.bmap a').forEach(link => {
      const href = link.getAttribute('href') || '';
      const q = new URLSearchParams(href.split('?')[1] || '');
      const block = q.get('block');
      if (!block) return;
      const cnt = Number(blockCounts[block] || 0);
      if (block === 'Main road') {
        const rdText = $('.bm-rd', link);
        if (rdText) rdText.textContent = `Main road (${cnt})`;
      } else {
        const g = $('.bm-b', link);
        if (g) {
          g.classList.remove('cool', 'warm', 'hot');
          g.classList.add(cnt === 0 ? 'cool' : cnt <= 2 ? 'warm' : 'hot');
          const titleNode = $('title', g);
          if (titleNode) titleNode.textContent = `${block}: ${cnt} open`;
          const numNode = $('.bm-n', g);
          if (numNode) numNode.textContent = String(cnt);
        }
      }
    });

    // Top reported categories
    const hbars = $('.hbars');
    if (hbars && Array.isArray(data.topCategories)) {
      const maxCount = data.topCategories[0]?.count || 1;
      hbars.replaceChildren(
        ...data.topCategories.map(item =>
          el('div', { className: 'hb' },
            el('span', { textContent: item.category }),
            el('span', { className: 'hb-t' },
              el('span', { className: 'hb-f', style: `width:${Math.round((item.count / maxCount) * 100)}%` }),
            ),
            el('span', { className: 'hb-v', textContent: String(item.count) }),
          ),
        ),
      );
    }

    // Needs attention list
    const needsList = $('section.card.flush .list');
    if (needsList) {
      if (!data.needsAttention.length) {
        needsList.replaceChildren(
          el('div', { className: 'item' },
            el('span', { className: 'item-main' },
              el('span', { className: 'item-t', textContent: 'No open requests needing attention.' }),
            ),
          ),
        );
      } else {
        needsList.replaceChildren(...data.needsAttention.map(buildReportListItem));
      }
    }
  }

  /* Admin Requests Table */
  async function loadAdminRequests() {
    const { reports } = await api('/api/requests');
    cachedReports = reports;
    const tbody = $('#req-table tbody');
    if (!tbody) return;

    tbody.replaceChildren(
      ...reports.map(r => {
        const [stLabel, stTone] = STATUS[r.status] || ['Pending', 'amber'];
        const titleCellChildren = [
          el('a', { href: `./request-detail.html?id=${encodeURIComponent(r.id)}` },
            el('b', { textContent: r.title }),
          ),
        ];
        if (r.urgent) {
          titleCellChildren.push(document.createTextNode(' '));
          titleCellChildren.push(el('span', { className: 'chip red', textContent: 'Urgent' }));
        }
        titleCellChildren.push(el('div', { className: 'muted small', textContent: r.category }));

        return el('tr', {
          dataset: {
            item: '',
            status: r.status,
            type: r.type,
            block: r.block,
            party: r.party,
          },
        },
        el('td', { 'data-l': 'ID' }, el('b', { textContent: r.id })),
        el('td', {}, ...titleCellChildren),
        el('td', { 'data-l': 'Block', textContent: r.where }),
        el('td', { 'data-l': 'Type', textContent: r.kind }),
        el('td', { 'data-l': 'Status' }, el('span', { className: `chip ${stTone}`, textContent: stLabel })),
        el('td', { 'data-l': 'Responsible', textContent: PARTY_LABEL[r.party] || r.party }),
        el('td', { 'data-l': 'Waiting', textContent: r.party === 'developer' ? formatWaitDays(r.waitDays) : '—' }),
        el('td', { 'data-l': 'Affected', textContent: String(r.affected) }),
        el('td', { 'data-l': 'Reported', textContent: r.reportedRelative || r.reported }),
        );
      }),
    );

    filter('req-table');
  }

  /* Resident Requests List */
  async function loadResidentRequests() {
    const { reports } = await api('/api/requests');
    cachedReports = reports;
    const list = $('#req-list');
    if (!list) return;
    list.replaceChildren(...reports.map(buildReportListItem));
    filter('req-list');
  }

  /* Resident Home Dashboard */
  async function loadResidentHome() {
    const data = await api('/api/dashboard/resident');

    // Today's expected visitors
    const cards = $$('main.view > section.card');
    const todayCard = cards[0];
    const todayList = todayCard ? $('.list', todayCard) : null;
    if (todayList) {
      const exp = data.expectedVisitors || [];
      if (!exp.length) {
        todayList.replaceChildren(
          el('a', { className: 'item', href: 'visitors.html' },
            el('span', { className: 'item-ic brand' }, svgIcon('users')),
            el('span', { className: 'item-main' },
              el('span', { className: 'item-t', textContent: 'No visitors expected today' }),
              el('span', { className: 'item-s', textContent: 'Tap to pre-register a guest or delivery' }),
            ),
            svgIcon('chevR', 'item-chev'),
          ),
        );
      } else {
        const first = exp[0];
        const summary =
          exp.length === 1
            ? `${first.name} · code ${first.code} · ${first.whenLabel}`
            : `${first.name} (${first.code}) + ${exp.length - 1} more`;
        todayList.replaceChildren(
          el('a', { className: 'item', href: 'visitors.html' },
            el('span', { className: 'item-ic brand' }, svgIcon('users')),
            el('span', { className: 'item-main' },
              el('span', { className: 'item-t', textContent: `${exp.length} visitor${exp.length === 1 ? '' : 's'} expected` }),
              el('span', { className: 'item-s', textContent: summary }),
            ),
            svgIcon('chevR', 'item-chev'),
          ),
        );
      }
    }

    // Your open reports
    const reportsList = $('section.card.flush .list');
    if (reportsList) {
      const open = data.openReports || [];
      if (!open.length) {
        reportsList.replaceChildren(
          el('div', { className: 'item' },
            el('span', { className: 'item-main' },
              el('span', { className: 'item-t', textContent: 'No open reports right now.' }),
              el('span', { className: 'item-s', textContent: 'Submit a new report whenever you spot an issue.' }),
            ),
          ),
        );
      } else {
        reportsList.replaceChildren(...open.map(buildReportListItem));
      }
    }

    // HOA Announcements
    const annCard = cards.find(c => $('h2', c)?.textContent?.includes('Announcements'));
    const annStack = annCard ? $('.stack', annCard) : null;
    if (annStack) {
      const anns = data.announcements || [];
      if (!anns.length) {
        annStack.replaceChildren(el('p', { className: 'muted small', textContent: 'No HOA announcements posted yet.' }));
      } else {
        annStack.replaceChildren(
          ...anns.map(a =>
            el('article', { className: 'ann' + (a.pinned ? ' pin' : '') },
              el('div', { className: 'ann-h' },
                el('b', { textContent: a.title }),
                a.pinned ? el('span', { className: 'chip brand', textContent: 'Pinned' }) : null,
              ),
              el('p', { textContent: a.body }),
              el('small', { className: 'muted', textContent: a.whenLabel }),
            ),
          ),
        );
      }
    }

    // HOA transparency stats
    const statsEls = $$('.stats-row b');
    if (statsEls.length >= 4 && data.hoaStats) {
      statsEls[0].textContent = String(data.hoaStats.totalReports);
      statsEls[1].textContent = String(data.hoaStats.resolvedCount);
      statsEls[2].textContent = data.hoaStats.avgDaysLabel || '3 days';
      statsEls[3].textContent = String(data.hoaStats.devWaitingCount);
    }
  }

  /* Report Detail Rendering (Admin & Resident) */
  function renderReportDetail(rep) {
    activeReportId = rep.id;
    document.title = `Report ${rep.id} · Carmela Subdivision`;

    const titleEl = $('[data-report-title]');
    if (titleEl) titleEl.textContent = rep.title;
    const metaEl = $('[data-report-meta]');
    if (metaEl) metaEl.textContent = `${rep.id} · ${rep.kind} · ${rep.category}`;
    const descEl = $('[data-report-desc]');
    if (descEl) descEl.textContent = rep.desc;
    const whereEl = $('[data-report-where]');
    if (whereEl) whereEl.textContent = rep.where;
    const byEl = $('[data-report-by]');
    if (byEl) byEl.textContent = rep.reporter;
    const whenEl = $('[data-report-when]');
    if (whenEl) whenEl.textContent = rep.reported;

    const affEl = $('[data-affect-n]');
    if (affEl) affEl.textContent = String(rep.affected);

    const affectBtn = $('[data-affect]');
    if (affectBtn) {
      const affectedByMe = Boolean(rep.affectedByMe);
      affectBtn.classList.toggle('primary', affectedByMe);
      affectBtn.classList.toggle('ghost', !affectedByMe);
      const affText = $('[data-affect-t]', affectBtn);
      if (affText) affText.textContent = affectedByMe ? 'You said this affects you too' : 'This affects me too';
    }

    const [stLabel, stTone] = STATUS[rep.status] || ['Pending', 'amber'];
    const sc = $('[data-status-chip]');
    if (sc) {
      sc.className = 'chip ' + stTone;
      sc.textContent = stLabel;
    }

    const pc = $('[data-party-chip]');
    if (pc) {
      pc.className = 'chip ' + (rep.party === 'developer' ? 'red' : '');
      pc.textContent = 'Responsible: ' + (PARTY_LABEL[rep.party] || rep.party);
    }

    const uc = $('[data-urgent-chip]');
    if (uc) uc.hidden = !rep.urgent;

    // Photo slot: render validated photo data URL or clear placeholder note
    const photoSlot = $('.photo-slot');
    if (photoSlot) {
      if (rep.photoDataUrl && VALID_IMAGE_URL_RE.test(rep.photoDataUrl) && rep.photoDataUrl.length <= MAX_IMAGE_DATA_LEN) {
        photoSlot.hidden = false;
        const img = el('img', {
          alt: `Photo for ${rep.title}`,
          style: 'max-height:260px;width:100%;object-fit:cover;border-radius:10px',
        });
        img.src = rep.photoDataUrl;
        photoSlot.replaceChildren(img);
      } else {
        photoSlot.hidden = true;
      }
    }

    $$('#status-group button').forEach(b => b.classList.toggle('on', b.dataset.setStatus === rep.status));
    const partySel = $('[data-party]');
    if (partySel) partySel.value = rep.party;

    const waitBanner = $('#dev-wait');
    if (waitBanner) {
      waitBanner.hidden = rep.party !== 'developer';
      const dEl = $('[data-wait-days]', waitBanner);
      if (dEl) dEl.textContent = `${rep.waitDays || 1} days`;
    }

    const followup = $('#followup');
    if (followup) {
      followup.value =
        `Follow-up on ${rep.id}: ${rep.title}\n` +
        `Location: ${rep.where}\n` +
        `Category: ${rep.category}\n` +
        `First reported: ${rep.reported}\n` +
        `People affected: ${rep.affected}\n` +
        `Details: ${rep.desc}\n\n` +
        `Please advise when this will be addressed. - Carmela Subdivision HOA`;
    }

    const tl = $('#timeline');
    if (tl) {
      tl.replaceChildren(
        ...(rep.timeline || []).map(item =>
          el('li', { className: item.cls || 'pending' },
            el('span', { className: 'tl-dot' }),
            el('div', {},
              el('b', { textContent: item.title }),
              document.createTextNode(` · ${item.when}`),
              el('p', {},
                document.createTextNode(item.note + ' '),
                el('small', { className: 'muted', textContent: `— ${item.by}` }),
              ),
            ),
          ),
        ),
      );
    }
  }

  async function loadReportDetail() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id') || (expectedRole === 'admin' ? 'R-1003' : 'R-1002');
    const { report } = await api(`/api/requests/${encodeURIComponent(id)}`);
    renderReportDetail(report);
  }

  /* Admin Announcements */
  async function loadAnnouncements() {
    const list = $('#ann-list');
    if (!list) return;
    const { announcements } = await api('/api/announcements');
    if (!announcements.length) {
      list.replaceChildren(el('p', { className: 'muted small', textContent: 'No announcements posted yet.' }));
      return;
    }
    list.replaceChildren(
      ...announcements.map(a =>
        el('article', { className: 'ann' + (a.pinned ? ' pin' : ''), dataset: { annId: a.id } },
          el('div', { className: 'ann-h' },
            el('b', { textContent: a.title }),
            el('div', { className: 'row', style: 'gap:8px' },
              a.pinned ? el('span', { className: 'chip brand', textContent: 'Pinned' }) : null,
              el('button', {
                type: 'button',
                className: 'icon-btn sm',
                title: 'Delete announcement',
                'aria-label': 'Delete announcement',
                dataset: { delAnn: a.id },
              }, svgIcon('trash')),
            ),
          ),
          el('p', { textContent: a.body }),
          el('small', { className: 'muted', textContent: a.whenLabel }),
        ),
      ),
    );
  }

  /* Admin Visitors Log */
  async function loadAdminVisitors() {
    const { visitors } = await api('/api/visitors');
    cachedVisitors = visitors;

    const today = iso();
    const todayEntries = visitors.filter(v => v.date === today && (v.status === 'arrived' || v.status === 'left'));
    const onSite = visitors.filter(v => v.status === 'arrived');
    const walkIns = visitors.filter(v => v.kind === 'walk');
    const logged = visitors.filter(v => v.status === 'arrived' || v.status === 'left');
    const noIdCount = logged.filter(v => !v.idLeft || v.idLeft === 'No ID left').length;

    const tiles = $$('.g4 .tile');
    if (tiles[0]) {
      $('.tile-v', tiles[0]).textContent = String(todayEntries.length);
      $('.tile-s', tiles[0]).textContent = 'entries logged';
    }
    if (tiles[1]) {
      $('.tile-v', tiles[1]).textContent = String(onSite.length);
      $('.tile-s', tiles[1]).textContent = onSite.length ? onSite.slice(0, 2).map(v => v.name).join(', ') : 'nobody inside';
    }
    if (tiles[2]) {
      $('.tile-v', tiles[2]).textContent = String(walkIns.length);
      $('.tile-s', tiles[2]).textContent = 'not pre-registered';
    }
    if (tiles[3]) {
      $('.tile-v', tiles[3]).textContent = `${noIdCount} of ${logged.length}`;
      $('.tile-s', tiles[3]).textContent = 'recorded entries';
    }

    const tbody = $('#v-table tbody');
    if (!tbody) return;
    tbody.replaceChildren(
      ...visitors.map(v => {
        const filterStatus = v.status === 'arrived' ? 'onsite' : v.status;
        const [stLabel, stTone] = GATE[v.status] || ['Expected', 'amber'];
        const visitingText = v.kind === 'walk'
          ? v.dest
          : `${v.residentName}${v.residentBlockLot ? ` · ${v.residentBlockLot}` : ''}`;

        return el('tr', {
          dataset: {
            item: '',
            status: filterStatus,
            kind: v.kind,
          },
        },
        el('td', { 'data-l': 'When', textContent: v.whenLabel }),
        el('td', { 'data-l': 'Code' }, el('b', { textContent: v.code })),
        el('td', {},
          el('b', { textContent: v.name }),
          el('div', { className: 'muted small', textContent: v.type }),
        ),
        el('td', { 'data-l': 'Visiting', textContent: visitingText }),
        el('td', { 'data-l': 'ID left', textContent: v.idLeft || 'Pending' }),
        el('td', { 'data-l': 'Status' }, el('span', { className: `chip ${stTone}`.trim(), textContent: stLabel })),
        );
      }),
    );

    filter('v-table');
  }

  /* Guard Gate & Gate Log */
  function renderGuardGateRows(visitors) {
    const list = $('#gate-list');
    if (!list) return;

    const today = iso();
    const relevant = visitors.filter(v => v.date === today || v.status === 'expected' || v.status === 'arrived');

    list.replaceChildren(
      ...relevant.map(v => {
        const [stLabel, stTone] = GATE[v.status] || ['Expected', 'amber'];
        const subParts = [v.type];
        if (v.plate) subParts.push(v.plate);
        if (v.kind === 'walk') {
          subParts.push(`→ ${v.dest}`);
        } else {
          subParts.push(`for ${v.residentName}${v.residentBlockLot ? `, ${v.residentBlockLot}` : ''}`);
        }
        if (v.whenLabel) subParts.push(v.whenLabel);

        let noteNode = null;
        if (v.kind === 'walk') {
          noteNode = el('div', { className: 'small muted', dataset: { gateNote: '' } },
            document.createTextNode(`ID left: ${v.idLeft || 'None'} · `),
            v.confirmedByPhone
              ? document.createTextNode(`confirmed by phone${v.checkedInAt ? ` · in at ${v.checkedInAt}` : ''}`)
              : el('b', { style: 'color:var(--red)', textContent: 'not confirmed' }),
          );
        } else {
          const noteParts = [];
          if (v.idLeft) noteParts.push(`ID left: ${v.idLeft}`);
          if (v.plate && v.status !== 'expected') noteParts.push(`Plate ${v.plate}`);
          if (v.checkedInAt && v.status === 'arrived') noteParts.push(`in at ${v.checkedInAt}`);
          if (v.leftAt && v.status === 'left') noteParts.push(`left at ${v.leftAt}`);
          noteNode = el('div', { className: 'small muted', dataset: { gateNote: '' }, textContent: noteParts.join(' · ') });
        }

        const actions = [];
        if (v.status === 'expected') {
          actions.push(el('button', { type: 'button', className: 'btn sm primary', dataset: { openCheckin: '' }, textContent: 'Check in' }));
          actions.push(el('button', { type: 'button', className: 'btn sm danger', dataset: { gate: 'denied' }, textContent: 'Deny' }));
        } else if (v.status === 'arrived') {
          actions.push(el('button', { type: 'button', className: 'btn sm', dataset: { gate: 'left' }, textContent: 'Mark left' }));
        }

        return el('div', {
          className: 'gate-row',
          id: v.id,
          dataset: {
            code: v.code,
            name: v.name,
            status: v.status,
          },
        },
        el('div', { className: 'grow' },
          el('b', { textContent: v.name }),
          document.createTextNode(' '),
          el('span', { className: 'muted small', textContent: `· ${v.code}` }),
          el('div', { className: 'small muted', textContent: subParts.join(' · ') }),
          noteNode,
        ),
        el('span', { className: `chip ${stTone}`.trim(), dataset: { gateChip: '' }, textContent: stLabel }),
        el('div', { className: 'gate-act' }, ...actions),
        );
      }),
    );

    updateGateStats();
  }

  async function loadGuardGate() {
    const { visitors } = await api('/api/visitors');
    cachedVisitors = visitors;
    renderGuardGateRows(visitors);
  }

  async function loadGuardLog() {
    const { visitors } = await api('/api/visitors');
    cachedVisitors = visitors;
    const tbody = $('#g-table tbody');
    if (!tbody) return;

    tbody.replaceChildren(
      ...visitors.map(v => {
        const [stLabel, stTone] = GATE[v.status] || ['Expected', 'amber'];
        return el('tr', { dataset: { item: '' } },
          el('td', { 'data-l': 'When', textContent: v.whenLabel }),
          el('td', {},
            el('b', { textContent: `${v.name} (${v.code})` }),
            el('div', { className: 'muted small', textContent: `${v.type} · ${v.kind === 'walk' ? v.dest : `${v.residentName} ${v.residentBlockLot}`}` }),
          ),
          el('td', { 'data-l': 'ID left', textContent: v.idLeft || 'Pending' }),
          el('td', { 'data-l': 'Status' }, el('span', { className: `chip ${stTone}`.trim(), textContent: stLabel })),
        );
      }),
    );

    filter('g-table');
  }

  /* Resident Visitors */
  async function loadResidentVisitors() {
    const { visitors } = await api('/api/visitors');
    cachedVisitors = visitors;
    const list = $('#resident-visitors-list');
    if (!list) return;

    if (!visitors.length) {
      list.replaceChildren(
        el('div', { className: 'item' },
          el('span', { className: 'item-main' },
            el('span', { className: 'item-t', textContent: 'No visitors pre-registered yet.' }),
            el('span', { className: 'item-s', textContent: 'Use the form to generate a gate code.' }),
          ),
        ),
      );
      return;
    }

    list.replaceChildren(
      ...visitors.map(v => {
        const [stLabel, stTone] = GATE[v.status] || ['Expected', 'amber'];
        const title = v.plate ? `${v.name} · ${v.plate}` : v.name;
        return el('div', { className: 'item' },
          el('span', { className: 'item-ic brand' }, svgIcon('users')),
          el('span', { className: 'item-main' },
            el('span', { className: 'item-t', textContent: title }),
            el('span', { className: 'item-s' },
              document.createTextNode(`${v.type} · ${v.whenLabel} · code `),
              el('b', { textContent: v.code }),
            ),
          ),
          el('span', { className: `chip ${stTone}`.trim(), textContent: stLabel }),
        );
      }),
    );
  }

  /* click actions */
  const A = {
    'data-theme-toggle': () => {
      const n = isDark() ? 'light' : 'dark';
      root.dataset.theme = n;
      try { localStorage.setItem('cc_theme', n); } catch (e) { }
    },
    'data-open': t => {
      const targetId = t.dataset.open;
      const d = openDlg(targetId);
      if (!d) return;
      if (t.dataset.title) $('[data-dlg-title]', d)?.replaceChildren(t.dataset.title);
      if (t.dataset.block) {
        d.dataset.block = t.dataset.block;
        $('[data-dlg-block]', d)?.replaceChildren(t.dataset.block);
      }
      if (targetId === 'notif') {
        markNotificationsRead();
      }
    },
    'data-close': t => t.closest('dialog')?.close(),
    'data-print': () => print(),
    'data-csv': t => exportCsv(t.dataset.csv, t.dataset.file || 'export.csv'),
    'data-copy': t => {
      const s = $(t.dataset.copy);
      (navigator.clipboard
        ? navigator.clipboard.writeText((s?.value || s?.textContent || '').trim())
        : Promise.reject()
      ).then(() => toast('Copied.'), () => toast('Select the text and copy it manually.', 'err'));
    },
    'data-set-status': setStatus,
    'data-affect': async () => {
      if (!activeReportId) return;
      try {
        const { report } = await api(`/api/requests/${encodeURIComponent(activeReportId)}/affect`, { method: 'POST' });
        renderReportDetail(report);
        toast(report.affectedByMe ? 'Marked as affecting you too.' : 'Removed from affected count.');
      } catch (err) {
        toast(err.message, 'err');
      }
    },
    'data-gate': async t => {
      const row = t.closest('.gate-row');
      const action = t.dataset.gate;
      if (!row || !action) return;
      try {
        await api(`/api/visitors/${encodeURIComponent(row.id)}/gate`, {
          method: 'PATCH',
          body: { status: action },
        });
        await loadGuardGate();
        toast(action === 'left' ? 'Checked out.' : 'Entry denied. Resident notified.');
      } catch (err) {
        toast(err.message, 'err');
      }
    },
    'data-open-checkin': t => {
      const row = t.closest('.gate-row');
      const d = openDlg('checkin');
      if (!row || !d) return;
      d.dataset.row = row.id;
      $('[data-who]', d).textContent = row.dataset.name;
    },
    'data-del-ann': async t => {
      const annId = t.dataset.delAnn;
      if (!annId) return;
      try {
        await api(`/api/announcements/${encodeURIComponent(annId)}`, { method: 'DELETE' });
        await loadAnnouncements();
        toast('Announcement removed.');
      } catch (err) {
        toast(err.message, 'err');
      }
    },
    'data-use-cat': t => {
      const s = $('#category');
      if (s) s.value = t.dataset.useCat;
      const box = $('#suggest-box');
      if (box) box.hidden = true;
    },
  };

  const actionSel = Object.keys(A).map(k => `[${k}]`).join();
  on('click', e => {
    // Intercept logout / back-to-role links so cookie is cleared
    const logoutLink = e.target.closest('.side-foot a[href="../index.html"], .top-r a[href="../index.html"]');
    if (logoutLink) {
      e.preventDefault();
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'fetch' },
      }).finally(() => {
        window.location.href = '../index.html';
      });
      return;
    }

    const t = e.target.closest(actionSel);
    if (!t) return e.target.tagName === 'DIALOG' && e.target.close();
    const key = Object.keys(A).find(k => t.hasAttribute(k));
    if (key) A[key](t);
  });

  /* list filtering: chips, selects and search drive one list */
  function filter(id) {
    const list = document.getElementById(id);
    if (!list) return;
    const ctl = $$(`[data-filter-for="${id}"]`);
    const empty = $$(`[data-empty-for="${id}"]`);
    const q = ($(`[data-search-for="${id}"]`)?.value || '').toLowerCase();
    let n = 0;
    $$('[data-item]', list).forEach(it => {
      const ok = ctl.every(c => {
        const v = c.matches('select,input') ? c.value : $('.on', c)?.dataset.value;
        const k = c.dataset.filterKey;
        return !v || v === 'all' || (v === 'open' ? it.dataset[k] !== 'resolved' : it.dataset[k] === v);
      }) && (!q || it.textContent.toLowerCase().includes(q));
      it.hidden = !ok;
      n += ok ? 1 : 0;
    });
    $$(`[data-count-for="${id}"]`).forEach(x => x.textContent = String(n));
    empty.forEach(x => x.hidden = n > 0);
    list.hidden = n === 0 && empty.length > 0;
  }

  on('click', e => {
    const b = e.target.closest('[data-filter-for] button');
    if (!b) return;
    const g = b.closest('[data-filter-for]');
    $$('button', g).forEach(x => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    filter(g.dataset.filterFor);
  });

  on('input', e => {
    const s = e.target.closest('[data-search-for],select[data-filter-for]');
    if (s) filter(s.dataset.searchFor || s.dataset.filterFor);
  });

  on('change', async e => {
    const s = e.target.closest('select[data-filter-for]');
    if (s) filter(s.dataset.filterFor);

    const f = e.target.closest('input[type=file][data-preview]');
    if (f?.files?.[0]) {
      const file = f.files[0];
      if (file.size > 2_000_000) {
        toast('Photo must be under 2 MB.', 'err');
        f.value = '';
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        const result = typeof r.result === 'string' ? r.result : '';
        if (!VALID_IMAGE_URL_RE.test(result)) {
          toast('Unsupported image format.', 'err');
          return;
        }
        pendingPhotoDataUrl = result;
        const img = document.createElement('img');
        img.alt = 'Selected photo';
        img.src = result;
        $('#' + f.dataset.preview)?.replaceChildren(img);
      };
      r.readAsDataURL(file);
    }

    const p = e.target.closest('[data-party]');
    if (p && activeReportId) {
      const label = p.options[p.selectedIndex].text;
      try {
        const { report } = await api(`/api/requests/${encodeURIComponent(activeReportId)}`, {
          method: 'PATCH',
          body: { party: p.value },
        });
        renderReportDetail(report);
        toast('Responsible party set to ' + label + '.');
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  });

  /* category suggestion (keyword preview) */
  const RULES = [
    ['Drainage / flooding', /drain|flood|baha|canal|clog/i],
    ['Water supply', /brown|dirty water|no water|walang tubig|murky/i],
    ['Streetlight', /street ?light|lamp|dark|ilaw/i],
    ['Road damage', /pothole|road|crack|butas/i],
    ['Stray animals', /dog|aso|stray|pusa/i],
    ['Noise / disturbance', /noise|karaoke|loud|ingay|drunk|lasing/i],
    ['Security concern', /security|suspicious|theft|nakaw|trespass/i],
    ['Internet / utilities', /internet|wifi|wi-fi|cable|provider/i],
    ['Water leak (warranty)', /leak|tulo|tagas/i],
  ];

  on('input', e => {
    if (!e.target.matches('[data-suggest]')) return;
    const box = $('#suggest-box');
    const s = $('#category');
    if (!box || !s) return;
    const hit = RULES.find(r => r[1].test(e.target.value))?.[0];
    box.hidden = !(hit && s.value !== hit && $$('option', s).some(o => o.value === hit));
    if (!box.hidden) {
      box.replaceChildren(
        document.createTextNode('Looks like '),
        el('b', { textContent: hit }),
        document.createTextNode('. '),
        el('button', { type: 'button', className: 'link', dataset: { useCat: hit }, textContent: 'Use this' }),
        document.createTextNode(' '),
        el('span', { className: 'small', textContent: '· keyword preview' }),
      );
    }
  });

  /* form submissions */
  on('submit', async e => {
    const demoForm = e.target.closest('form[data-demo]');
    const checkinForm = e.target.closest('form[data-checkin]');
    const lookupForm = e.target.closest('form[data-code-lookup]');

    if (demoForm) {
      e.preventDefault();
      if (!demoForm.reportValidity()) return;
      const kind = demoForm.dataset.demo;
      const btn = $('button[type="submit"]', demoForm);
      if (btn) btn.disabled = true;

      try {
        if (kind === 'request') {
          const { report } = await api('/api/requests', {
            method: 'POST',
            body: {
              category: demoForm.elements.category.value,
              title: demoForm.elements.title.value.trim(),
              desc: demoForm.elements.desc.value.trim(),
              block: demoForm.elements.block.value,
              lot: demoForm.elements.lot.value.trim(),
              location: demoForm.elements.location.value.trim(),
              urgency: demoForm.elements.urgency.value,
              photoDataUrl: pendingPhotoDataUrl || undefined,
            },
          });
          toast('Report sent. You will be notified of updates.');
          setTimeout(() => {
            window.location.href = `request-detail.html?id=${encodeURIComponent(report.id)}`;
          }, 500);
          return;
        }

        if (kind === 'visitor') {
          const { visitor } = await api('/api/visitors', {
            method: 'POST',
            body: {
              name: demoForm.elements.name.value.trim(),
              type: demoForm.elements.type.value,
              date: demoForm.elements.date.value,
              time: demoForm.elements.time.value,
              plate: demoForm.elements.plate.value.trim(),
              note: demoForm.elements.note.value.trim(),
            },
          });
          $('#code-out').textContent = visitor.code;
          $('#code-name').textContent = visitor.name;
          openDlg('code-dlg');
          demoForm.reset();
          dates();
          await loadResidentVisitors();
          return;
        }

        if (kind === 'announce') {
          await api('/api/announcements', {
            method: 'POST',
            body: {
              title: demoForm.elements.title.value.trim(),
              body: demoForm.elements.body.value.trim(),
              pinned: demoForm.elements.pin.checked,
            },
          });
          demoForm.reset();
          await loadAnnouncements();
          toast('Announcement posted. Residents are notified.');
          return;
        }

        if (kind === 'walkin') {
          await api('/api/visitors/walkin', {
            method: 'POST',
            body: {
              name: demoForm.elements.name.value.trim(),
              type: demoForm.elements.type.value,
              dest: demoForm.elements.dest.value.trim(),
              idLeft: demoForm.elements.idleft.value,
              confirmed: demoForm.elements.confirmed.checked,
            },
          });
          $('#walkin')?.close();
          demoForm.reset();
          await loadGuardGate();
          toast('Walk-in logged.');
          return;
        }

        if (kind === 'note' && activeReportId) {
          const { report } = await api(`/api/requests/${encodeURIComponent(activeReportId)}/notes`, {
            method: 'POST',
            body: { note: demoForm.elements.note.value.trim() },
          });
          renderReportDetail(report);
          demoForm.reset();
          toast('Update posted. Resident notified.');
          return;
        }
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        if (btn) btn.disabled = false;
      }
    } else if (checkinForm) {
      e.preventDefault();
      const d = $('#checkin');
      const visitorId = d?.dataset.row;
      if (!visitorId) return;
      try {
        await api(`/api/visitors/${encodeURIComponent(visitorId)}/gate`, {
          method: 'PATCH',
          body: {
            status: 'arrived',
            idLeft: checkinForm.elements.idleft.value,
            plate: checkinForm.elements.plate.value.trim(),
          },
        });
        d.close();
        checkinForm.reset();
        await loadGuardGate();
        toast('Checked in. Resident notified.');
      } catch (err) {
        toast(err.message, 'err');
      }
    } else if (lookupForm) {
      e.preventDefault();
      const code = lookupForm.elements.code.value.trim().toLowerCase();
      const rows = $$('.gate-row');
      const row = rows.find(r => (r.dataset.code || '').toLowerCase() === code);
      rows.forEach(r => { r.style.background = ''; });
      if (!row) return toast('No visitor with that code. Use “Log a walk-in”.', 'err');
      row.style.background = 'var(--brand-soft)';
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Found: ' + row.dataset.name);
    }
  });

  /* admin: request status */
  async function setStatus(b) {
    const s = b.dataset.setStatus;
    if (!s || !activeReportId) return;
    try {
      const { report } = await api(`/api/requests/${encodeURIComponent(activeReportId)}`, {
        method: 'PATCH',
        body: { status: s },
      });
      renderReportDetail(report);
      const label = STATUS[s]?.[0] || s;
      toast(`Status set to “${label}”. Resident notified.`);
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  /* guard: live stats */
  function updateGateStats() {
    const list = $('#gate-list');
    if (!list) return;
    const rows = $$('.gate-row', list);
    const counts = {
      expected: rows.filter(r => r.dataset.status === 'expected').length,
      arrived: rows.filter(r => r.dataset.status === 'arrived').length,
      left: rows.filter(r => r.dataset.status === 'left').length,
    };
    const eEl = $('[data-gate-stat="expected"]');
    const aEl = $('[data-gate-stat="arrived"]');
    const lEl = $('[data-gate-stat="left"]');
    const totEl = $('[data-gate-total]');
    if (eEl) eEl.textContent = String(counts.expected);
    if (aEl) aEl.textContent = String(counts.arrived);
    if (lEl) lEl.textContent = String(counts.left);
    if (totEl) totEl.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
  }

  /* CSV export of a table */
  function exportCsv(id, name) {
    const t = document.getElementById(id);
    if (!t) return;
    const rows = $$('tr', t)
      .filter(r => !r.hidden)
      .map(r => $$('th,td', r).map(c => '"' + c.textContent.replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"').join(','));
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv' })),
      download: name,
    });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  /* initial query defaults before data loads */
  function applyInitialQueryControls() {
    const params = new URLSearchParams(location.search);
    const block = params.get('block');
    if (block) {
      const sel = $('select[data-filter-for="req-table"][data-filter-key="block"]');
      if (sel && [...sel.options].some(o => o.value === block)) sel.value = block;
    }
    const reqType = params.get('type');
    if (reqType === 'service') {
      const cat = $('#category');
      if (cat) cat.value = 'Water leak (warranty)';
    }
  }

  /* start-up */
  async function init() {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      $$('.view > *').forEach((elNode, i) => {
        elNode.classList.add('rv');
        elNode.style.animationDelay = Math.min(i * 45, 320) + 'ms';
      });
    }

    applyInitialQueryControls();
    dates();

    if (!expectedRole) {
      $$('[data-filter-for]').forEach(c => filter(c.dataset.filterFor));
      return;
    }

    try {
      const { user } = await api('/api/auth/me');
      if (!user || user.role !== expectedRole) {
        window.location.replace(`../login.html?role=${encodeURIComponent(expectedRole)}&reason=session`);
        return;
      }
      currentUser = user;
      hydrateUserShell(user);

      await Promise.all([
        loadNotifications(),
        (async () => {
          if (expectedRole === 'admin' && currentPage === 'dashboard.html') return loadAdminDashboard();
          if (expectedRole === 'admin' && currentPage === 'requests.html') return loadAdminRequests();
          if (expectedRole === 'admin' && currentPage === 'visitors.html') return loadAdminVisitors();
          if (expectedRole === 'admin' && currentPage === 'announcements.html') return loadAnnouncements();
          if (expectedRole === 'guard' && currentPage === 'gate.html') return loadGuardGate();
          if (expectedRole === 'guard' && currentPage === 'log.html') return loadGuardLog();
          if (expectedRole === 'resident' && currentPage === 'home.html') return loadResidentHome();
          if (expectedRole === 'resident' && currentPage === 'requests.html') return loadResidentRequests();
          if (expectedRole === 'resident' && currentPage === 'visitors.html') return loadResidentVisitors();
          if (currentPage === 'request-detail.html') return loadReportDetail();
          return undefined;
        })(),
      ]);
    } catch (err) {
      if (err?.message !== 'UNAUTHENTICATED') {
        toast(err?.message || 'Unable to load data from server.', 'err');
      }
    }
  }

  init();
})();