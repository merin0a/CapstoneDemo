/* app.js: Carmela Subdivision frontend connected to Express backend APIs. Load after layout.js. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const on = (ev, fn) => document.addEventListener(ev, fn);

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_PATHS = {
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
    trash: [['path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6' }]],
  };

  function makeIcon(name, extraClass = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', ('ic ' + extraClass).trim());
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const defs = ICON_PATHS[name] || ICON_PATHS.bell;
    for (const [tag, attrs] of defs) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      svg.append(node);
    }
    return svg;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null) continue;
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('data-') || k === 'href' || k === 'type' || k === 'hidden') {
        if (k === 'hidden') node.hidden = Boolean(v);
        else node.setAttribute(k, String(v));
      } else {
        node[k] = v;
      }
    }
    for (const child of children) {
      if (child !== null && child !== undefined) node.append(child);
    }
    return node;
  }

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

  /* API helper */
  async function api(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = {
      ...(opts.headers || {}),
    };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['X-Requested-With'] = 'fetch';
    }
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      method,
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

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

  const VALID_PHOTO_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

  let currentUser = null;
  let currentReportId = null;
  let uploadedPhotoDataUrl = '';
  let cachedGateVisitors = [];

  function buildReportItem(rep, detailPrefix = 'request-detail.html') {
    const [stLabel, stTone] = STATUS[rep.status] || STATUS.pending;
    const isService = rep.type === 'service';
    const icWrap = el('span', { className: 'item-ic ' + (isService ? 'blue' : 'amber') },
      makeIcon(isService ? 'wrench' : 'alert'));

    const chips = el('span', { className: 'chips' },
      el('span', { className: 'chip ' + stTone, textContent: stLabel }),
    );
    if (rep.urgent) {
      chips.append(el('span', { className: 'chip red', textContent: 'Urgent' }));
    }
    if (rep.party === 'developer' && rep.status !== 'resolved') {
      chips.append(el('span', {
        className: 'chip red',
        textContent: `Developer · waiting ${rep.waitDays || 1} days`,
      }));
    } else if (rep.party && rep.party !== 'unassigned' && rep.status !== 'resolved') {
      chips.append(el('span', { className: 'chip', textContent: PARTY_LABEL[rep.party] || rep.party }));
    }
    chips.append(el('span', { className: 'chip', textContent: `${rep.affected} affected` }));

    const main = el('span', { className: 'item-main' },
      el('span', { className: 'item-t', textContent: rep.title }),
      el('span', { className: 'item-s', textContent: `${rep.where} · ${rep.category} · ${rep.reportedRelative || rep.reported}` }),
      chips,
    );

    const a = el('a', {
      className: 'item',
      href: `${detailPrefix}?id=${encodeURIComponent(rep.id)}`,
      dataset: {
        item: '',
        status: rep.status,
        owner: rep.owner || 'community',
      },
    }, icWrap, main, makeIcon('chevR', 'item-chev'));
    return a;
  }

  function renderNotifications(notifications) {
    const list = $('#notif .list');
    const dot = $('.bell-dot');
    const unreadCount = notifications.filter(n => n.unread).length;
    if (dot) dot.hidden = unreadCount === 0;
    if (!list) return;

    list.replaceChildren();
    if (notifications.length === 0) {
      list.append(
        el('div', { className: 'item' },
          el('span', { className: 'item-ic' }, makeIcon('bell')),
          el('span', { className: 'item-main' },
            el('span', { className: 'item-t', textContent: 'No notifications right now.' }),
            el('span', { className: 'item-s', textContent: 'You are all caught up' }),
          ),
        ),
      );
      return;
    }

    for (const n of notifications) {
      list.append(
        el('div', { className: 'item' + (n.unread ? ' unread' : '') },
          el('span', { className: 'item-ic brand' }, makeIcon(n.icon || 'bell')),
          el('span', { className: 'item-main' },
            el('span', { className: 'item-t', textContent: n.text }),
            el('span', { className: 'item-s', textContent: n.whenLabel || 'Today' }),
          ),
        ),
      );
    }
  }

  async function refreshNotifications() {
    try {
      const data = await api('/api/notifications');
      renderNotifications(data.notifications || []);
    } catch (e) { }
  }

  function hydrateUserUI(user) {
    const sideUser = $('.side-user');
    if (sideUser) {
      const av = $('.avatar', sideUser);
      const b = $('b', sideUser);
      const sm = $('small', sideUser);
      if (av) av.textContent = user.initials || 'SC';
      if (b) b.textContent = user.name;
      if (sm) {
        if (user.role === 'resident') sm.textContent = 'Resident · ' + (user.blockLot || 'Carmela');
        else if (user.role === 'guard') sm.textContent = 'Gate guard';
        else sm.textContent = 'HOA Administrator';
      }
    }

    const firstName = (user.name || '').trim().split(/\s+/)[0] || user.name;
    const welcomeH2 = $('.gate-welcome h2');
    if (welcomeH2) {
      welcomeH2.textContent = user.role === 'guard' ? `Good day, Guard ${firstName}` : `Good day, ${firstName}`;
    }

    if (user.role === 'resident') {
      const helloH1 = $('.hello h1');
      if (helloH1) helloH1.textContent = `Hi, ${firstName}`;
      const helloBlock = $('.hello p:last-child');
      if (helloBlock) helloBlock.textContent = user.blockLot || 'Carmela Subdivision';
      const gateLive = $('.gate-live');
      if (gateLive) {
        const dot = gateLive.querySelector('.gate-live-dot');
        gateLive.replaceChildren();
        if (dot) gateLive.append(dot);
        gateLive.append(document.createTextNode(' ' + (user.blockLot || 'Resident')));
      }
      const lotInput = $('form[data-demo="request"] input[name="lot"]');
      const blockSelect = $('form[data-demo="request"] select[name="block"]');
      if (user.blockLot) {
        const m = user.blockLot.match(/Block\s*(\d+)\s*,?\s*Lot\s*(\d+)/i);
        if (m) {
          if (blockSelect) blockSelect.value = `Block ${m[1]}`;
          if (lotInput) lotInput.value = m[2];
        }
      }
    }
  }

  /* Page loaders */
  async function loadAdminDashboard() {
    const data = await api('/api/dashboard/admin');
    const kpiTiles = $$('.g3 .tile');
    if (kpiTiles.length >= 3) {
      $('.tile-v', kpiTiles[0]).textContent = String(data.openCount);
      $('.tile-s', kpiTiles[0]).textContent = `${data.pendingCount} still pending`;
      $('.tile-v', kpiTiles[1]).textContent = String(data.devWaitingCount);
      $('.tile-s', kpiTiles[1]).textContent = data.devWaitingCount ? `Oldest: ${data.oldestDevWaitDays || 1} days` : 'None waiting';
      $('.tile-v', kpiTiles[2]).textContent = String(data.visitorsToday);
      $('.tile-s', kpiTiles[2]).textContent = `${data.onSiteNow} on site now`;
    }

    const blockLinks = $$('svg.bmap a[href*="block="]');
    for (const a of blockLinks) {
      const href = a.getAttribute('href') || '';
      const q = new URLSearchParams(href.split('?')[1] || '');
      const blockName = q.get('block');
      if (!blockName || !(blockName in (data.blockCounts || {}))) continue;
      const count = data.blockCounts[blockName];
      if (blockName === 'Main road') {
        const rdText = $('text.bm-rd', a);
        if (rdText) rdText.textContent = `Main road (${count})`;
      } else {
        const g = $('g.bm-b', a);
        const title = $('title', a);
        const nText = $('text.bm-n', a);
        if (title) title.textContent = `${blockName}: ${count} open`;
        if (nText) nText.textContent = String(count);
        if (g) {
          g.classList.remove('cool', 'warm', 'hot');
          g.classList.add(count >= 3 ? 'hot' : count >= 1 ? 'warm' : 'cool');
        }
      }
    }

    const hbars = $('.hbars');
    if (hbars && Array.isArray(data.topCategories)) {
      const max = Math.max(1, ...data.topCategories.map(c => c.count));
      hbars.replaceChildren();
      for (const item of data.topCategories) {
        const fill = el('span', { className: 'hb-f' });
        fill.style.width = `${Math.round((item.count / max) * 100)}%`;
        hbars.append(
          el('div', { className: 'hb' },
            el('span', { textContent: item.category }),
            el('span', { className: 'hb-t' }, fill),
            el('span', { className: 'hb-v', textContent: String(item.count) }),
          ),
        );
      }
    }

    const attentionList = $('main .card.flush .list');
    if (attentionList && Array.isArray(data.needsAttention)) {
      attentionList.replaceChildren();
      for (const rep of data.needsAttention) {
        attentionList.append(buildReportItem(rep, 'request-detail.html'));
      }
    }
  }

  async function loadAdminRequests() {
    const data = await api('/api/requests');
    const tbody = $('#req-table tbody');
    if (!tbody) return;
    tbody.replaceChildren();

    for (const rep of data.reports || []) {
      const [stLabel, stTone] = STATUS[rep.status] || STATUS.pending;
      const reportCell = el('td', {},
        el('a', { href: `./request-detail.html?id=${encodeURIComponent(rep.id)}` },
          el('b', { textContent: rep.title }),
        ),
      );
      if (rep.urgent) {
        reportCell.append(document.createTextNode(' '), el('span', { className: 'chip red', textContent: 'Urgent' }));
      }
      reportCell.append(el('div', { className: 'muted small', textContent: rep.category }));

      const tr = el('tr', {
        dataset: {
          item: '',
          status: rep.status,
          type: rep.type,
          block: rep.block,
          party: rep.party,
        },
      },
      el('td', { 'data-l': 'ID' }, el('b', { textContent: rep.id })),
      reportCell,
      el('td', { 'data-l': 'Block', textContent: rep.where }),
      el('td', { 'data-l': 'Type', textContent: rep.kind }),
      el('td', { 'data-l': 'Status' }, el('span', { className: 'chip ' + stTone, textContent: stLabel })),
      el('td', { 'data-l': 'Responsible', textContent: PARTY_LABEL[rep.party] || rep.party }),
      el('td', { 'data-l': 'Waiting', textContent: rep.party === 'developer' && rep.waitDays ? `${rep.waitDays} days` : '—' }),
      el('td', { 'data-l': 'Affected', textContent: String(rep.affected) }),
      el('td', { 'data-l': 'Reported', textContent: rep.reportedRelative || rep.reported }),
      );
      tbody.append(tr);
    }

    filter('req-table');
  }

  function renderReportDetail(rep) {
    currentReportId = rep.id;
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
      affectBtn.classList.toggle('primary', Boolean(rep.affectedByMe));
      affectBtn.classList.toggle('ghost', !rep.affectedByMe);
      const txt = $('[data-affect-t]', affectBtn);
      if (txt) txt.textContent = rep.affectedByMe ? 'You said this affects you too' : 'This affects me too';
    }

    const photoSlot = $('.photo-slot');
    if (photoSlot) {
      if (rep.photoDataUrl && VALID_PHOTO_RE.test(rep.photoDataUrl)) {
        const img = el('img', { alt: 'Report attachment' });
        img.src = rep.photoDataUrl;
        img.style.maxHeight = '260px';
        img.style.borderRadius = '8px';
        photoSlot.replaceChildren(img);
      }
    }

    const [stLabel, stTone] = STATUS[rep.status] || STATUS.pending;
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
      followup.value = `Follow-up on ${rep.id}: ${rep.title}\nLocation: ${rep.where}\nCategory: ${rep.category}\nFirst reported: ${rep.reported}\nPeople affected: ${rep.affected}\nDetails: ${rep.desc}\n\nPlease advise when this will be addressed. - Carmela Subdivision HOA`;
    }

    const tl = $('#timeline');
    if (tl) {
      tl.replaceChildren();
      for (const item of rep.timeline || []) {
        const li = el('li', { className: item.cls || 'pending' },
          el('span', { className: 'tl-dot' }),
          el('div', {},
            el('b', { textContent: item.title }),
            document.createTextNode(` · ${item.when}`),
            el('p', {},
              document.createTextNode(item.note + ' '),
              el('small', { className: 'muted', textContent: `— ${item.by}` }),
            ),
          ),
        );
        tl.append(li);
      }
    }
  }

  async function loadRequestDetail(defaultId) {
    const params = new URLSearchParams(location.search);
    const id = params.get('id') || defaultId;
    try {
      const data = await api(`/api/requests/${encodeURIComponent(id)}`);
      if (data.report) renderReportDetail(data.report);
    } catch (err) {
      toast(err.message || 'Could not load report.', 'err');
    }
  }

  async function loadAdminVisitors() {
    const data = await api('/api/visitors');
    const visitors = data.visitors || [];
    const today = iso();
    const todayEntries = visitors.filter(v => v.date === today && (v.status === 'arrived' || v.status === 'left'));
    const onSite = visitors.filter(v => v.status === 'arrived');
    const walkIns = visitors.filter(v => v.kind === 'walk');
    const entered = visitors.filter(v => v.status === 'arrived' || v.status === 'left');
    const noId = entered.filter(v => v.idLeft === 'No ID left');

    const tiles = $$('.g4 .tile');
    if (tiles.length >= 4) {
      $('.tile-v', tiles[0]).textContent = String(todayEntries.length);
      $('.tile-v', tiles[1]).textContent = String(onSite.length);
      $('.tile-s', tiles[1]).textContent = onSite.length ? onSite[0].name : 'No visitors on site';
      $('.tile-v', tiles[2]).textContent = String(walkIns.length);
      $('.tile-v', tiles[3]).textContent = `${noId.length} of ${entered.length}`;
    }

    const tbody = $('#v-table tbody');
    if (!tbody) return;
    tbody.replaceChildren();

    for (const v of visitors) {
      const statusMap = {
        expected: ['Expected', 'amber', 'expected'],
        arrived: ['On site', 'green', 'onsite'],
        left: ['Left', '', 'left'],
        denied: ['Denied', 'red', 'denied'],
      };
      const [label, tone, filterKey] = statusMap[v.status] || ['Left', '', 'left'];
      const visiting = v.residentBlockLot
        ? `${v.residentName} · ${v.residentBlockLot}`
        : v.dest;

      tbody.append(
        el('tr', {
          dataset: {
            item: '',
            status: filterKey,
            kind: v.kind,
          },
        },
        el('td', { 'data-l': 'When', textContent: v.whenLabel }),
        el('td', { 'data-l': 'Code' }, el('b', { textContent: v.code })),
        el('td', {},
          el('b', { textContent: v.name }),
          el('div', { className: 'muted small', textContent: v.type }),
        ),
        el('td', { 'data-l': 'Visiting', textContent: visiting }),
        el('td', { 'data-l': 'ID left', textContent: v.idLeft || '—' }),
        el('td', { 'data-l': 'Status' }, el('span', { className: 'chip ' + tone, textContent: label })),
        ),
      );
    }

    filter('v-table');
  }

  function renderAnnouncementList(listEl, announcements, allowDelete = false) {
    if (!listEl) return;
    listEl.replaceChildren();
    if (!announcements.length) {
      listEl.append(el('p', { className: 'muted small', textContent: 'No announcements posted yet.' }));
      return;
    }

    for (const ann of announcements) {
      const head = el('div', { className: 'ann-h' },
        el('b', { textContent: ann.title }),
      );
      if (ann.pinned) head.append(el('span', { className: 'chip brand', textContent: 'Pinned' }));
      if (allowDelete) {
        const delBtn = el('button', {
          type: 'button',
          className: 'icon-btn',
          'aria-label': 'Delete announcement',
          dataset: { delAnn: ann.id },
        }, makeIcon('trash'));
        head.append(delBtn);
      }
      listEl.append(
        el('article', { className: 'ann' + (ann.pinned ? ' pin' : '') },
          head,
          el('p', { textContent: ann.body }),
          el('small', { className: 'muted', textContent: ann.whenLabel }),
        ),
      );
    }
  }

  async function loadAdminAnnouncements() {
    const data = await api('/api/announcements');
    renderAnnouncementList($('#ann-list'), data.announcements || [], true);
  }

  function renderGateVisitors(visitors) {
    cachedGateVisitors = visitors;
    const list = $('#gate-list');
    if (!list) return;
    list.replaceChildren();

    for (const v of visitors) {
      const [label, tone] = GATE[v.status] || GATE.expected;
      const metaParts = [v.type];
      if (v.plate) metaParts.push(v.plate);
      const destLabel = v.residentName && v.residentBlockLot && v.kind === 'reg'
        ? `for ${v.residentName}, ${v.residentBlockLot}`
        : `→ ${v.dest}`;
      metaParts.push(destLabel);
      metaParts.push(v.whenLabel);

      const noteParts = [];
      if (v.idLeft) noteParts.push(`ID left: ${v.idLeft}`);
      if (v.plate && v.status !== 'expected') noteParts.push(`Plate ${v.plate}`);
      if (v.checkedInAt) noteParts.push(`in at ${v.checkedInAt}`);
      if (v.kind === 'walk' && v.note) noteParts.push(v.note);

      const act = el('div', { className: 'gate-act' });
      if (v.status === 'expected') {
        act.append(
          el('button', { type: 'button', className: 'btn sm primary', dataset: { openCheckin: '' }, textContent: 'Check in' }),
          el('button', { type: 'button', className: 'btn sm danger', dataset: { gate: 'denied' }, textContent: 'Deny' }),
        );
      } else if (v.status === 'arrived') {
        act.append(
          el('button', { type: 'button', className: 'btn sm', dataset: { gate: 'left' }, textContent: 'Mark left' }),
        );
      }

      const row = el('div', {
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
        el('span', { className: 'muted small', textContent: ` · ${v.code}` }),
        el('div', { className: 'small muted', textContent: metaParts.join(' · ') }),
        el('div', { className: 'small muted', dataset: { gateNote: '' }, textContent: noteParts.join(' · ') }),
      ),
      el('span', { className: 'chip ' + tone, dataset: { gateChip: '' }, textContent: label }),
      act,
      );
      list.append(row);
    }

    updateGateStats();
  }

  async function loadGuardGate() {
    const data = await api('/api/visitors');
    renderGateVisitors(data.visitors || []);
  }

  async function loadGuardLog() {
    const data = await api('/api/visitors');
    const tbody = $('#g-table tbody');
    if (!tbody) return;
    tbody.replaceChildren();

    const entries = (data.visitors || []).filter(v => v.status !== 'expected');
    for (const v of entries) {
      const [label, tone] = GATE[v.status] || GATE.left;
      tbody.append(
        el('tr', { dataset: { item: '' } },
          el('td', { 'data-l': 'When', textContent: v.whenLabel }),
          el('td', {},
            el('b', { textContent: v.name }),
            el('div', { className: 'muted small', textContent: `${v.type} · ${v.code}` }),
          ),
          el('td', { 'data-l': 'ID left', textContent: v.idLeft || '—' }),
          el('td', { 'data-l': 'Status' }, el('span', { className: 'chip ' + tone, textContent: label })),
        ),
      );
    }
    filter('g-table');
  }

  async function loadResidentHome() {
    const data = await api('/api/dashboard/resident');
    const todayCard = $('main .card .list');
    if (todayCard && Array.isArray(data.expectedVisitors)) {
      todayCard.replaceChildren();
      if (data.expectedVisitors.length === 0) {
        todayCard.append(
          el('a', { className: 'item', href: 'visitors.html' },
            el('span', { className: 'item-ic brand' }, makeIcon('users')),
            el('span', { className: 'item-main' },
              el('span', { className: 'item-t', textContent: 'No visitors expected today' }),
              el('span', { className: 'item-s', textContent: 'Tap to pre-register a guest or delivery' }),
            ),
            makeIcon('chevR', 'item-chev'),
          ),
        );
      } else {
        const count = data.expectedVisitors.length;
        const first = data.expectedVisitors[0];
        todayCard.append(
          el('a', { className: 'item', href: 'visitors.html' },
            el('span', { className: 'item-ic brand' }, makeIcon('users')),
            el('span', { className: 'item-main' },
              el('span', { className: 'item-t', textContent: `${count} visitor${count === 1 ? '' : 's'} expected` }),
              el('span', { className: 'item-s', textContent: `${first.name} · code ${first.code} · ${first.whenLabel}` }),
            ),
            makeIcon('chevR', 'item-chev'),
          ),
        );
      }
    }

    const openList = $('main .card.flush .list');
    if (openList && Array.isArray(data.openReports)) {
      openList.replaceChildren();
      if (data.openReports.length === 0) {
        openList.append(
          el('div', { className: 'item' },
            el('span', { className: 'item-main' },
              el('span', { className: 'item-t', textContent: 'You have no open reports.' }),
              el('span', { className: 'item-s', textContent: 'Use "Report an issue" or "Request a repair" above anytime.' }),
            ),
          ),
        );
      } else {
        for (const rep of data.openReports) {
          openList.append(buildReportItem(rep, 'request-detail.html'));
        }
      }
    }

    const annWrap = $('main .card .stack');
    if (annWrap && Array.isArray(data.announcements)) {
      renderAnnouncementList(annWrap, data.announcements, false);
    }

    const statsRow = $('.stats-row');
    if (statsRow && data.hoaStats) {
      const cells = $$('div > b', statsRow);
      if (cells.length >= 4) {
        cells[0].textContent = String(data.hoaStats.totalReports);
        cells[1].textContent = String(data.hoaStats.resolvedCount);
        cells[2].textContent = data.hoaStats.avgDaysLabel;
        cells[3].textContent = String(data.hoaStats.devWaitingCount);
      }
    }
  }

  async function loadResidentRequests() {
    const data = await api('/api/requests');
    const list = $('#req-list');
    if (!list) return;
    list.replaceChildren();
    for (const rep of data.reports || []) {
      list.append(buildReportItem(rep, 'request-detail.html'));
    }
    filter('req-list');
  }

  function renderResidentVisitors(visitors) {
    const list = $('#resident-visitors-list');
    if (!list) return;
    list.replaceChildren();
    if (!visitors.length) {
      list.append(
        el('div', { className: 'item' },
          el('span', { className: 'item-main' },
            el('span', { className: 'item-t', textContent: 'No visitors yet' }),
            el('span', { className: 'item-s', textContent: 'Use the form to generate a gate code.' }),
          ),
        ),
      );
      return;
    }
    for (const v of visitors) {
      const [label, tone] = GATE[v.status] || GATE.expected;
      const titleText = v.plate ? `${v.name} · ${v.plate}` : v.name;
      list.append(
        el('div', { className: 'item' },
          el('span', { className: 'item-ic brand' }, makeIcon('users')),
          el('span', { className: 'item-main' },
            el('span', { className: 'item-t', textContent: titleText }),
            el('span', { className: 'item-s' },
              document.createTextNode(`${v.type} · ${v.whenLabel} · code `),
              el('b', { textContent: v.code }),
            ),
          ),
          el('span', { className: 'chip ' + tone, textContent: label }),
        ),
      );
    }
  }

  async function loadResidentVisitors() {
    const data = await api('/api/visitors');
    renderResidentVisitors(data.visitors || []);
  }

  /* click actions */
  const A = {
    'data-theme-toggle': () => {
      const n = isDark() ? 'light' : 'dark';
      root.dataset.theme = n;
      try { localStorage.setItem('cc_theme', n); } catch (e) { }
    },
    'data-open': t => {
      const id = t.dataset.open;
      const d = openDlg(id);
      if (!d) return;
      if (id === 'notif') {
        api('/api/notifications/read', { method: 'POST' })
          .then(() => { const dot = $('.bell-dot'); if (dot) dot.hidden = true; })
          .catch(() => { });
      }
      if (t.dataset.title) $('[data-dlg-title]', d)?.replaceChildren(t.dataset.title);
      if (t.dataset.block) {
        d.dataset.block = t.dataset.block;
        $('[data-dlg-block]', d)?.replaceChildren(t.dataset.block);
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
    'data-set-status': async b => {
      if (!currentReportId) return;
      const status = b.dataset.setStatus;
      try {
        const data = await api(`/api/requests/${encodeURIComponent(currentReportId)}`, {
          method: 'PATCH',
          body: { status },
        });
        renderReportDetail(data.report);
        toast(`Status set to “${STATUS[status][0]}”. Resident notified.`);
      } catch (err) {
        toast(err.message || 'Could not update status.', 'err');
      }
    },
    'data-affect': async () => {
      if (!currentReportId) return;
      try {
        const data = await api(`/api/requests/${encodeURIComponent(currentReportId)}/affect`, {
          method: 'POST',
        });
        renderReportDetail(data.report);
      } catch (err) {
        toast(err.message || 'Could not update count.', 'err');
      }
    },
    'data-gate': async t => {
      const row = t.closest('.gate-row');
      const status = t.dataset.gate;
      if (!row || !status) return;
      try {
        await api(`/api/visitors/${encodeURIComponent(row.id)}/gate`, {
          method: 'PATCH',
          body: { status },
        });
        await loadGuardGate();
        toast(status === 'left' ? 'Checked out.' : 'Entry denied. Resident notified.');
      } catch (err) {
        toast(err.message || 'Could not update gate record.', 'err');
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
      const id = t.dataset.delAnn;
      if (!id) return;
      try {
        await api(`/api/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadAdminAnnouncements();
        toast('Announcement removed.');
      } catch (err) {
        toast(err.message || 'Could not remove announcement.', 'err');
      }
    },
    'data-del': t => {
      const elNode = t.closest(t.dataset.del);
      if (elNode) {
        elNode.remove();
        toast('Removed.');
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
    const logoutLink = e.target.closest('.side-foot a[href="../index.html"], .top-r a[href="../index.html"]');
    if (logoutLink) {
      e.preventDefault();
      api('/api/auth/logout', { method: 'POST' })
        .catch(() => { })
        .finally(() => { location.href = '../index.html'; });
      return;
    }

    const t = e.target.closest(actionSel);
    if (!t) return e.target.tagName === 'DIALOG' && e.target.close();
    const key = Object.keys(A).find(k => t.hasAttribute(k));
    if (key) A[key](t);
  });

  /* list filtering */
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
      n += ok;
    });
    $$(`[data-count-for="${id}"]`).forEach(x => x.textContent = n);
    empty.forEach(x => x.hidden = n > 0);
    list.hidden = n === 0 && empty.length > 0;
  }

  on('click', e => {
    const b = e.target.closest('[data-filter-for] button');
    if (!b) return;
    const g = b.closest('[data-filter-for]');
    $$('button', g).forEach(x => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b);
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
    if (f?.files[0]) {
      const file = f.files[0];
      if (file.size > 2_000_000) {
        toast('Please choose a photo under 2 MB.', 'err');
        f.value = '';
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        const result = typeof r.result === 'string' ? r.result : '';
        if (!VALID_PHOTO_RE.test(result)) {
          toast('Unsupported image format.', 'err');
          return;
        }
        uploadedPhotoDataUrl = result;
        const prev = $('#' + f.dataset.preview);
        if (prev) {
          const img = el('img', { alt: 'Selected photo' });
          img.src = result;
          prev.replaceChildren(img);
        }
      };
      r.readAsDataURL(file);
    }

    const p = e.target.closest('[data-party]');
    if (p && currentReportId) {
      try {
        const data = await api(`/api/requests/${encodeURIComponent(currentReportId)}`, {
          method: 'PATCH',
          body: { party: p.value },
        });
        renderReportDetail(data.report);
        toast('Responsible party set to ' + (PARTY_LABEL[p.value] || p.value) + '.');
      } catch (err) {
        toast(err.message || 'Could not update responsible party.', 'err');
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

  /* forms */
  on('submit', async e => {
    const f = e.target.closest('form[data-demo], form[data-checkin], form[data-code-lookup]');
    if (!f) return;
    e.preventDefault();
    if (!f.reportValidity()) return;

    if (f.hasAttribute('data-checkin')) {
      const d = $('#checkin');
      const rowId = d?.dataset.row;
      if (!rowId) return;
      try {
        await api(`/api/visitors/${encodeURIComponent(rowId)}/gate`, {
          method: 'PATCH',
          body: {
            status: 'arrived',
            idLeft: f.elements.idleft.value,
            plate: f.elements.plate.value.trim(),
          },
        });
        d.close();
        f.reset();
        await loadGuardGate();
        toast('Checked in. Resident notified.');
      } catch (err) {
        toast(err.message || 'Could not check in visitor.', 'err');
      }
      return;
    }

    if (f.hasAttribute('data-code-lookup')) {
      const code = f.elements.code.value.trim().toLowerCase();
      const rows = $$('.gate-row');
      const row = rows.find(r => (r.dataset.code || '').toLowerCase() === code);
      rows.forEach(r => r.style.background = '');
      if (!row) return toast('No visitor with that code. Use “Log a walk-in”.', 'err');
      row.style.background = 'var(--brand-soft)';
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Found: ' + row.dataset.name);
      return;
    }

    const kind = f.dataset.demo;
    if (kind === 'visitor') {
      try {
        const data = await api('/api/visitors', {
          method: 'POST',
          body: {
            name: f.elements.name.value.trim(),
            type: f.elements.type.value,
            date: f.elements.date.value,
            time: f.elements.time.value,
            plate: f.elements.plate.value.trim(),
            note: f.elements.note.value.trim(),
          },
        });
        $('#code-out').textContent = data.visitor.code;
        $('#code-name').textContent = data.visitor.name;
        openDlg('code-dlg');
        f.reset();
        dates();
        await loadResidentVisitors();
      } catch (err) {
        toast(err.message || 'Could not pre-register visitor.', 'err');
      }
      return;
    }

    if (kind === 'request') {
      try {
        const data = await api('/api/requests', {
          method: 'POST',
          body: {
            category: f.elements.category.value,
            title: f.elements.title.value.trim(),
            desc: f.elements.desc.value.trim(),
            block: f.elements.block.value,
            lot: f.elements.lot.value.trim(),
            location: f.elements.location.value.trim(),
            urgency: f.elements.urgency.value,
            photoDataUrl: uploadedPhotoDataUrl || undefined,
          },
        });
        toast('Report sent. You will be notified of updates.');
        setTimeout(() => {
          location.href = `request-detail.html?id=${encodeURIComponent(data.report.id)}`;
        }, 700);
      } catch (err) {
        toast(err.message || 'Could not submit report.', 'err');
      }
      return;
    }

    if (kind === 'announce') {
      try {
        await api('/api/announcements', {
          method: 'POST',
          body: {
            title: f.elements.title.value.trim(),
            body: f.elements.body.value.trim(),
            pinned: f.elements.pin.checked,
          },
        });
        f.reset();
        await loadAdminAnnouncements();
        toast('Announcement posted. Residents notified.');
      } catch (err) {
        toast(err.message || 'Could not post announcement.', 'err');
      }
      return;
    }

    if (kind === 'walkin') {
      try {
        await api('/api/visitors/walkin', {
          method: 'POST',
          body: {
            name: f.elements.name.value.trim(),
            type: f.elements.type.value,
            dest: f.elements.dest.value.trim(),
            idLeft: f.elements.idleft.value,
            confirmed: f.elements.confirmed.checked,
          },
        });
        $('#walkin')?.close();
        f.reset();
        await loadGuardGate();
        toast('Walk-in logged.');
      } catch (err) {
        toast(err.message || 'Could not log walk-in.', 'err');
      }
      return;
    }

    if (kind === 'note' && currentReportId) {
      try {
        const data = await api(`/api/requests/${encodeURIComponent(currentReportId)}/notes`, {
          method: 'POST',
          body: { note: f.elements.note.value.trim() },
        });
        f.reset();
        renderReportDetail(data.report);
        toast('Update posted. Resident notified.');
      } catch (err) {
        toast(err.message || 'Could not post update.', 'err');
      }
    }
  });

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

  function applyQueryDefaults() {
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

  async function initApp() {
    const role = document.body.dataset.role;
    const page = document.body.dataset.page;
    if (!role) return;

    try {
      const me = await api('/api/auth/me');
      currentUser = me.user;
      if (!currentUser || currentUser.role !== role) {
        location.replace(`../login.html?role=${encodeURIComponent(role)}&reason=session`);
        return;
      }
      hydrateUserUI(currentUser);
    } catch (err) {
      location.replace(`../login.html?role=${encodeURIComponent(role)}&reason=session`);
      return;
    }

    applyQueryDefaults();
    dates();
    refreshNotifications();

    if (role === 'admin') {
      if (page === 'dashboard.html') await loadAdminDashboard();
      else if (page === 'requests.html') await loadAdminRequests();
      else if (page === 'request-detail.html') await loadRequestDetail('R-1003');
      else if (page === 'visitors.html') await loadAdminVisitors();
      else if (page === 'announcements.html') await loadAdminAnnouncements();
    } else if (role === 'guard') {
      if (page === 'gate.html') await loadGuardGate();
      else if (page === 'log.html') await loadGuardLog();
    } else if (role === 'resident') {
      if (page === 'home.html') await loadResidentHome();
      else if (page === 'requests.html' && $('#req-list')) await loadResidentRequests();
      else if (page === 'requests.html' && $('[data-report-title]')) await loadRequestDetail('R-1002');
      else if (page === 'visitors.html') await loadResidentVisitors();
    }
  }

  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $$('.view > *').forEach((elNode, i) => {
      elNode.classList.add('rv');
      elNode.style.animationDelay = Math.min(i * 45, 320) + 'ms';
    });
  }

  initApp().catch(err => {
    console.error(err);
  });
})();
