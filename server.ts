import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  addNotification,
  computeInitials,
  formatDateISO,
  formatShortNow,
  formatTimeNow,
  hashPassword,
  loadDb,
  saveDb,
  timingSafeStringEqual,
  verifyPassword,
} from './server/store.ts';
import type {
  DatabaseState,
  ReportRecord,
  ReportStatus,
  ResponsibleParty,
  UserRecord,
  UserRole,
  VisitorRecord,
  VisitorStatus,
} from './server/store.ts';

const PORT = 3000;
const SESSION_COOKIE = 'cc_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_SECRET = process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  blockLot: string;
  initials: string;
  exp: number;
}

interface AuthedRequest extends Request {
  user?: SessionPayload;
}

const VALID_ROLES = new Set<UserRole>(['resident', 'admin', 'guard']);
const VALID_STATUSES = new Set<ReportStatus>(['pending', 'in_progress', 'resolved']);
const VALID_PARTIES = new Set<ResponsibleParty>(['unassigned', 'hoa', 'developer', 'lgu']);
const VALID_VISITOR_TYPES = new Set([
  'Guest',
  'Delivery',
  'Contractor / service',
  'Tricycle / ride',
]);
const VALID_ID_TYPES = new Set([
  'National ID',
  'Driver’s license',
  "Driver's license",
  'School / company ID',
  'Other ID',
  'No ID left',
]);
const VALID_BLOCKS = new Set([
  'Block 1',
  'Block 2',
  'Block 3',
  'Block 4',
  'Block 5',
  'Block 6',
  'Block 7',
  'Block 8',
  'Main road',
  'Main road / common area',
]);

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

const PARTY_LABELS: Record<ResponsibleParty, string> = {
  unassigned: 'Not assigned',
  hoa: 'HOA',
  developer: 'Developer',
  lgu: 'LGU / barangay',
};

const ROLE_DEFAULTS: Record<UserRole, { name: string; email: string; blockLot: string }> = {
  resident: {
    name: 'Maria Santos',
    email: 'maria.santos@carmela.ph',
    blockLot: 'Block 3, Lot 12',
  },
  admin: {
    name: 'HOA Admin',
    email: 'admin@carmela.ph',
    blockLot: 'HOA Administrator',
  },
  guard: {
    name: 'Tony Valdez',
    email: 'guard.tony@carmela.ph',
    blockLot: 'Main Gate',
  },
};

function getEnvAdminPasscode(): string {
  return (process.env.ADMIN_PASSCODE || '').trim();
}

function signSession(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySession(token: string | undefined): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!data || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (!timingSafeStringEqual(sig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!VALID_ROLES.has(parsed.role) || typeof parsed.email !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function buildCookieAttrs(req: Request, maxAge: number): string {
  const base = `Path=/; Max-Age=${maxAge}; HttpOnly`;
  if (req.secure) {
    return `${base}; Secure; SameSite=None; Partitioned`;
  }
  return `${base}; SameSite=Lax`;
}

function setSessionCookie(req: Request, res: Response, payload: SessionPayload): void {
  const token = signSession(payload);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${buildCookieAttrs(req, SESSION_TTL_SECONDS)}`,
  );
}

function clearSessionCookie(req: Request, res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; ${buildCookieAttrs(req, 0)}`,
  );
}

function isOriginTrusted(req: Request): boolean {
  const origin = req.get('origin');
  const requestedWith = req.get('x-requested-with');
  if (!origin) {
    return requestedWith === 'fetch';
  }
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const hostHeader = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
    if (!hostHeader) return false;
    return originHost === hostHeader && requestedWith === 'fetch';
  } catch {
    return false;
  }
}

function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!isOriginTrusted(req)) {
      res.status(403).json({ error: 'Cross-origin or unverified request blocked.' });
      return;
    }
  }
  next();
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Please sign in to continue.' });
    return;
  }
  req.user = session;
  next();
}

function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    requireAuth(req, res, () => {
      if (!req.user || !roles.includes(req.user.role)) {
        res.status(403).json({ error: 'You do not have permission for this action.' });
        return;
      }
      next();
    });
  };
}

function formatBlockLotShort(blockLot: string): string {
  const match = blockLot.match(/Block\s*(\d+)\s*,?\s*Lot\s*(\d+)/i);
  if (match) return `B${match[1]} L${match[2]}`;
  return blockLot || 'Resident';
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function isValidEmail(email: string): boolean {
  return email.length >= 5 && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeImageDataUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > 2_800_000) {
    return undefined;
  }
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function format12HourTime(time24: string): string {
  if (!time24 || !/^\d{2}:\d{2}$/.test(time24)) return time24;
  const [hStr, mStr] = time24.split(':');
  const h = Number(hStr);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

function formatRelativeDays(isoDate: string): string {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return 'recently';
  const days = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  if (days === 0) return 'today';
  return `${days} d ago`;
}

function toPublicReport(r: ReportRecord, user: SessionPayload) {
  const owner =
    r.reporterEmail.toLowerCase() === user.email.toLowerCase() ||
    r.reporter.toLowerCase() === user.name.toLowerCase()
      ? 'mine'
      : 'community';
  return {
    ...r,
    owner,
    affectedByMe: r.affectedBy.includes(user.email.toLowerCase()),
    reportedRelative: formatRelativeDays(r.reportedAt),
  };
}

function buildAdminDashboard(db: DatabaseState) {
  const openReports = db.reports.filter(r => r.status !== 'resolved');
  const pendingCount = openReports.filter(r => r.status === 'pending').length;
  const devWaiting = openReports.filter(r => r.party === 'developer');
  const oldestWait = devWaiting.reduce((max, r) => Math.max(max, r.waitDays || 0), 0);

  const today = formatDateISO();
  const visitorsToday = db.visitors.filter(
    v => v.date === today && (v.status === 'arrived' || v.status === 'left'),
  ).length;
  const onSiteNow = db.visitors.filter(v => v.status === 'arrived').length;

  const blockKeys = [
    'Main road',
    'Block 1',
    'Block 2',
    'Block 3',
    'Block 4',
    'Block 5',
    'Block 6',
    'Block 7',
    'Block 8',
  ];
  const blockCounts: Record<string, number> = {};
  for (const k of blockKeys) blockCounts[k] = 0;
  for (const r of openReports) {
    const key = r.block === 'Main road / common area' ? 'Main road' : r.block;
    if (key in blockCounts) blockCounts[key] += 1;
  }

  const catCounts = new Map<string, number>();
  for (const r of db.reports) {
    catCounts.set(r.category, (catCounts.get(r.category) || 0) + 1);
  }
  const topCategories = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  const needsAttention = [...openReports]
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.waitDays - a.waitDays)
    .slice(0, 6);

  return {
    openCount: openReports.length,
    pendingCount,
    devWaitingCount: devWaiting.length,
    oldestDevWaitDays: oldestWait,
    visitorsToday,
    onSiteNow,
    blockCounts,
    topCategories,
    needsAttention,
  };
}

function createSessionFromUser(user: UserRecord): SessionPayload {
  return {
    uid: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    blockLot: user.blockLot,
    initials: user.initials,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
}

async function startServer(): Promise<void> {
  loadDb();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', csrfProtection);

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'subdivision-connect' });
  });

  // Auth status (supports first-run setup without hardcoded credentials)
  app.get('/api/auth/status', (req, res) => {
    const roleRaw = typeof req.query.role === 'string' ? req.query.role : 'resident';
    const role: UserRole = VALID_ROLES.has(roleRaw as UserRole) ? (roleRaw as UserRole) : 'resident';
    const db = loadDb();
    const envAdminConfigured = role === 'admin' && getEnvAdminPasscode().length > 0;
    const roleUsers = db.users.filter(u => u.role === role);
    const hasClaimedUser = roleUsers.length > 0 || envAdminConfigured;

    const cookies = parseCookies(req.headers.cookie);
    const current = verifySession(cookies[SESSION_COOKIE]);

    res.json({
      role,
      hasClaimedUser,
      envAdminConfigured,
      suggestedProfile: ROLE_DEFAULTS[role],
      currentUser: current,
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  // First-run setup for a role when not yet claimed
  app.post('/api/auth/setup', (req, res) => {
    const roleRaw = req.body?.role;
    if (!VALID_ROLES.has(roleRaw)) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }
    const role = roleRaw as UserRole;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const emailInput = normalizeEmail(req.body?.email);
    const nameInput = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const blockLotInput = typeof req.body?.blockLot === 'string' ? req.body.blockLot.trim() : '';

    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const db = loadDb();
    if (role === 'admin' && getEnvAdminPasscode().length > 0) {
      res.status(409).json({ error: 'Admin passcode is managed by environment configuration.' });
      return;
    }
    if (db.users.some(u => u.role === role)) {
      res.status(409).json({ error: 'Initial account setup for this role is already complete. Please sign in.' });
      return;
    }

    const defaults = ROLE_DEFAULTS[role];
    const email = emailInput || defaults.email;
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    if (db.users.some(u => u.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'An account with that email already exists.' });
      return;
    }

    const name = (nameInput || defaults.name).slice(0, 80);
    const blockLot = (blockLotInput || defaults.blockLot).slice(0, 60);
    const user: UserRecord = {
      id: 'u-' + crypto.randomUUID(),
      email,
      name,
      role,
      blockLot,
      initials: computeInitials(name),
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    saveDb(db);

    const session = createSessionFromUser(user);
    setSessionCookie(req, res, session);
    res.status(201).json({ user: session });
  });

  // Register additional resident account
  app.post('/api/auth/register', (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const blockLot = typeof req.body?.blockLot === 'string' ? req.body.blockLot.trim() : '';

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (!name || name.length > 80) {
      res.status(400).json({ error: 'Please enter your full name.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const db = loadDb();
    if (db.users.some(u => u.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const user: UserRecord = {
      id: 'u-' + crypto.randomUUID(),
      email,
      name,
      role: 'resident',
      blockLot: (blockLot || 'Block 1, Lot 1').slice(0, 60),
      initials: computeInitials(name),
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    saveDb(db);

    const session = createSessionFromUser(user);
    setSessionCookie(req, res, session);
    res.status(201).json({ user: session });
  });

  // Login
  app.post('/api/auth/login', (req, res) => {
    const roleRaw = req.body?.role;
    if (!VALID_ROLES.has(roleRaw)) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }
    const role = roleRaw as UserRole;
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const envAdminPasscode = getEnvAdminPasscode();
    if (role === 'admin' && envAdminPasscode.length > 0) {
      if (timingSafeStringEqual(password, envAdminPasscode)) {
        const session: SessionPayload = {
          uid: 'env-admin',
          email,
          name: 'Admin',
          role: 'admin',
          blockLot: 'HOA Administrator',
          initials: 'AD',
          exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        };
        setSessionCookie(req, res, session);
        res.json({ user: session });
        return;
      }
      res.status(401).json({ error: 'Invalid admin credentials.' });
      return;
    }

    const db = loadDb();
    const user = db.users.find(u => u.email.toLowerCase() === email && u.role === role);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password for this role.' });
      return;
    }

    const session = createSessionFromUser(user);
    setSessionCookie(req, res, session);
    res.json({ user: session });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Dashboard endpoints
  app.get('/api/dashboard/admin', requireRole('admin'), (req: AuthedRequest, res) => {
    const db = loadDb();
    const stats = buildAdminDashboard(db);
    res.json({
      ...stats,
      needsAttention: stats.needsAttention.map(r => toPublicReport(r, req.user!)),
    });
  });

  app.get('/api/dashboard/resident', requireRole('resident', 'admin'), (req: AuthedRequest, res) => {
    const db = loadDb();
    const user = req.user!;
    const today = formatDateISO();

    const myVisitorsToday = db.visitors.filter(
      v =>
        v.residentEmail.toLowerCase() === user.email.toLowerCase() &&
        v.status === 'expected' &&
        (v.date === today || v.whenLabel.toLowerCase().includes('today')),
    );

    const myOpenReports = db.reports
      .filter(
        r =>
          r.status !== 'resolved' &&
          (r.reporterEmail.toLowerCase() === user.email.toLowerCase() ||
            r.reporter.toLowerCase() === user.name.toLowerCase()),
      )
      .map(r => toPublicReport(r, user));

    const pinnedAnnouncements = [...db.announcements]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 3);

    const totalReports = db.reports.length;
    const resolvedCount = db.reports.filter(r => r.status === 'resolved').length;
    const devWaitingCount = db.reports.filter(
      r => r.status !== 'resolved' && r.party === 'developer',
    ).length;

    res.json({
      expectedVisitors: myVisitorsToday,
      openReports: myOpenReports,
      announcements: pinnedAnnouncements,
      hoaStats: {
        totalReports,
        resolvedCount,
        avgDaysLabel: '3 days',
        devWaitingCount,
      },
    });
  });

  // Reports / Requests endpoints
  app.get('/api/requests', requireAuth, (req: AuthedRequest, res) => {
    const db = loadDb();
    const user = req.user!;
    const reports = db.reports.map(r => toPublicReport(r, user));
    res.json({ reports });
  });

  app.get('/api/requests/:id', requireAuth, (req: AuthedRequest, res) => {
    const db = loadDb();
    const id = String(req.params.id || '').trim();
    const report = db.reports.find(r => r.id === id);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    res.json({ report: toPublicReport(report, req.user!) });
  });

  app.post('/api/requests', requireRole('resident', 'admin'), (req: AuthedRequest, res) => {
    const user = req.user!;
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const desc = typeof req.body?.desc === 'string' ? req.body.desc.trim() : '';
    const blockRaw = typeof req.body?.block === 'string' ? req.body.block.trim() : 'Block 3';
    const lot = typeof req.body?.lot === 'string' ? req.body.lot.trim().slice(0, 20) : '';
    const location = typeof req.body?.location === 'string' ? req.body.location.trim().slice(0, 80) : '';
    const urgency = req.body?.urgency === 'urgent' ? 'urgent' : 'normal';
    const photoDataUrl = sanitizeImageDataUrl(req.body?.photoDataUrl);

    if (!category || category.length > 60) {
      res.status(400).json({ error: 'Please select a valid category.' });
      return;
    }
    if (!title || title.length > 80) {
      res.status(400).json({ error: 'Please enter a short title (max 80 characters).' });
      return;
    }
    if (desc.length > 1200) {
      res.status(400).json({ error: 'Details must be 1200 characters or fewer.' });
      return;
    }

    const block = VALID_BLOCKS.has(blockRaw) ? blockRaw : 'Block 3';
    const serviceCategories = new Set([
      'Water leak (warranty)',
      'Plumbing',
      'Electrical',
      'Tree trimming / yard',
      'Cleaning',
    ]);
    const isService = serviceCategories.has(category);
    const whereParts = [block === 'Main road / common area' ? 'Main road' : block];
    if (lot) whereParts.push(`Lot ${lot}`);
    if (location) whereParts.push(location);

    const db = loadDb();
    const id = `R-${db.counters.reportSeq++}`;
    const whenStr = formatShortNow();
    const isWarranty = category === 'Water leak (warranty)';

    const report: ReportRecord = {
      id,
      title,
      kind: isService ? 'Service request' : 'Issue',
      type: isService ? 'service' : 'issue',
      category,
      status: 'pending',
      party: isWarranty ? 'developer' : 'hoa',
      block: block === 'Main road / common area' ? 'Main road' : block,
      lot,
      location,
      where: whereParts.join(', '),
      reporter: user.name,
      reporterEmail: user.email,
      reported: whenStr,
      reportedAt: new Date().toISOString(),
      affected: 1,
      affectedBy: [user.email.toLowerCase()],
      urgent: urgency === 'urgent',
      waitDays: 0,
      desc: desc || title,
      photoDataUrl,
      timeline: [
        {
          cls: 'pending',
          title: 'Pending',
          when: whenStr,
          note: 'Report submitted',
          by: user.name.split(' ')[0] || user.name,
        },
      ],
    };

    db.reports.unshift(report);
    addNotification(db, {
      role: 'admin',
      icon: 'clipboard',
      text: `New ${report.urgent ? 'urgent ' : ''}report ${id}: ${title}`,
      whenLabel: 'Just now',
    });
    saveDb(db);

    res.status(201).json({ report: toPublicReport(report, user) });
  });

  app.patch('/api/requests/:id', requireRole('admin'), (req: AuthedRequest, res) => {
    const db = loadDb();
    const id = String(req.params.id || '').trim();
    const report = db.reports.find(r => r.id === id);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const status = req.body?.status;
    const party = req.body?.party;
    const whenStr = formatShortNow();
    let changed = false;

    if (status !== undefined) {
      if (!VALID_STATUSES.has(status)) {
        res.status(400).json({ error: 'Invalid status value.' });
        return;
      }
      if (report.status !== status) {
        report.status = status;
        report.timeline.unshift({
          cls: status,
          title: STATUS_LABELS[status as ReportStatus],
          when: whenStr,
          note: 'Status changed by HOA.',
          by: 'HOA',
        });
        addNotification(db, {
          role: 'resident',
          targetEmail: report.reporterEmail,
          icon: 'clipboard',
          text: `${report.id} marked "${STATUS_LABELS[status as ReportStatus]}".`,
          whenLabel: 'Just now',
        });
        changed = true;
      }
    }

    if (party !== undefined) {
      if (!VALID_PARTIES.has(party)) {
        res.status(400).json({ error: 'Invalid responsible party.' });
        return;
      }
      if (report.party !== party) {
        report.party = party;
        if (party === 'developer' && report.waitDays === 0) {
          report.waitDays = 1;
        }
        report.timeline.unshift({
          cls: report.status,
          title: 'Assigned',
          when: whenStr,
          note: `Responsible party set to ${PARTY_LABELS[party as ResponsibleParty]}.`,
          by: 'HOA',
        });
        changed = true;
      }
    }

    if (changed) saveDb(db);
    res.json({ report: toPublicReport(report, req.user!) });
  });

  app.post('/api/requests/:id/notes', requireRole('admin'), (req: AuthedRequest, res) => {
    const db = loadDb();
    const id = String(req.params.id || '').trim();
    const report = db.reports.find(r => r.id === id);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note || note.length > 600) {
      res.status(400).json({ error: 'Update message must be between 1 and 600 characters.' });
      return;
    }

    const whenStr = formatShortNow();
    report.timeline.unshift({
      cls: report.status,
      title: 'Update',
      when: whenStr,
      note,
      by: 'HOA',
    });
    addNotification(db, {
      role: 'resident',
      targetEmail: report.reporterEmail,
      icon: 'clipboard',
      text: `HOA update on ${report.id}: ${note.slice(0, 70)}`,
      whenLabel: 'Just now',
    });
    saveDb(db);

    res.status(201).json({ report: toPublicReport(report, req.user!) });
  });

  app.post('/api/requests/:id/affect', requireAuth, (req: AuthedRequest, res) => {
    const db = loadDb();
    const user = req.user!;
    const id = String(req.params.id || '').trim();
    const report = db.reports.find(r => r.id === id);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const emailKey = user.email.toLowerCase();
    const idx = report.affectedBy.indexOf(emailKey);
    if (idx >= 0) {
      report.affectedBy.splice(idx, 1);
      report.affected = Math.max(1, report.affected - 1);
    } else {
      report.affectedBy.push(emailKey);
      report.affected += 1;
    }
    saveDb(db);
    res.json({ report: toPublicReport(report, user) });
  });

  // Visitors & Gate endpoints
  app.get('/api/visitors', requireAuth, (req: AuthedRequest, res) => {
    const db = loadDb();
    const user = req.user!;
    const visitors =
      user.role === 'resident'
        ? db.visitors.filter(v => v.residentEmail.toLowerCase() === user.email.toLowerCase())
        : db.visitors;
    res.json({ visitors });
  });

  app.post('/api/visitors', requireRole('resident', 'admin'), (req: AuthedRequest, res) => {
    const user = req.user!;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : 'Guest';
    const date = typeof req.body?.date === 'string' ? req.body.date.trim() : formatDateISO();
    const time = typeof req.body?.time === 'string' ? req.body.time.trim() : '';
    const plate = typeof req.body?.plate === 'string' ? req.body.plate.trim().toUpperCase().slice(0, 24) : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 160) : '';

    if (!name || name.length > 80) {
      res.status(400).json({ error: 'Please enter the visitor name.' });
      return;
    }
    if (!VALID_VISITOR_TYPES.has(type)) {
      res.status(400).json({ error: 'Invalid visitor type.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Please select a valid visit date.' });
      return;
    }

    const db = loadDb();
    const code = `V-${db.counters.visitorSeq++}`;
    const timeFormatted = time ? format12HourTime(time) : 'Anytime';
    const isToday = date === formatDateISO();

    const visitor: VisitorRecord = {
      id: 'v-' + crypto.randomUUID(),
      code,
      name,
      type,
      date,
      time,
      plate,
      note,
      dest: user.blockLot,
      residentName: user.name,
      residentEmail: user.email,
      residentBlockLot: formatBlockLotShort(user.blockLot),
      kind: 'reg',
      status: 'expected',
      idLeft: '',
      whenLabel: `${isToday ? 'Today' : date} · ${timeFormatted}`,
      createdAt: new Date().toISOString(),
    };

    db.visitors.unshift(visitor);
    addNotification(db, {
      role: 'guard',
      icon: 'bell',
      text: `Expected visitor ${name} (${code}) for ${visitor.residentName}, ${visitor.residentBlockLot}.`,
      whenLabel: 'Just now',
    });
    saveDb(db);

    res.status(201).json({ visitor });
  });

  app.post('/api/visitors/walkin', requireRole('guard', 'admin'), (req: AuthedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : 'Guest';
    const dest = typeof req.body?.dest === 'string' ? req.body.dest.trim() : '';
    const idLeft = typeof req.body?.idLeft === 'string' ? req.body.idLeft.trim() : 'National ID';
    const confirmedByPhone = Boolean(req.body?.confirmed);

    if (!name || name.length > 80) {
      res.status(400).json({ error: 'Please enter the visitor name.' });
      return;
    }
    if (!VALID_VISITOR_TYPES.has(type)) {
      res.status(400).json({ error: 'Invalid visitor type.' });
      return;
    }
    if (!dest || dest.length > 80) {
      res.status(400).json({ error: 'Please enter the destination block and lot.' });
      return;
    }
    if (!VALID_ID_TYPES.has(idLeft)) {
      res.status(400).json({ error: 'Invalid ID selection.' });
      return;
    }

    const db = loadDb();
    const seq = db.counters.walkinSeq++;
    const code = `W-${String(seq).padStart(3, '0')}`;
    const timeStr = formatTimeNow();

    const visitor: VisitorRecord = {
      id: 'w-' + crypto.randomUUID(),
      code,
      name: `Walk-in: ${name}`,
      type,
      date: formatDateISO(),
      time: timeStr,
      plate: '',
      note: confirmedByPhone ? 'confirmed by phone' : 'not confirmed by phone',
      dest,
      residentName: dest,
      residentEmail: '',
      residentBlockLot: dest,
      kind: 'walk',
      status: 'arrived',
      idLeft,
      confirmedByPhone,
      checkedInAt: timeStr,
      whenLabel: `Today, ${timeStr}`,
      createdAt: new Date().toISOString(),
    };

    db.visitors.unshift(visitor);
    addNotification(db, {
      role: 'admin',
      icon: 'users',
      text: `Walk-in logged at gate: ${name} -> ${dest} (${idLeft}).`,
      whenLabel: 'Just now',
    });
    saveDb(db);

    res.status(201).json({ visitor });
  });

  app.patch('/api/visitors/:id/gate', requireRole('guard', 'admin'), (req: AuthedRequest, res) => {
    const db = loadDb();
    const id = String(req.params.id || '').trim();
    const visitor = db.visitors.find(v => v.id === id);
    if (!visitor) {
      res.status(404).json({ error: 'Visitor record not found.' });
      return;
    }

    const status = req.body?.status as VisitorStatus;
    if (!['arrived', 'left', 'denied'].includes(status)) {
      res.status(400).json({ error: 'Invalid gate status.' });
      return;
    }

    if (status === 'arrived') {
      const idLeft = typeof req.body?.idLeft === 'string' ? req.body.idLeft.trim() : 'National ID';
      const plate = typeof req.body?.plate === 'string' ? req.body.plate.trim().toUpperCase().slice(0, 24) : '';
      if (!VALID_ID_TYPES.has(idLeft)) {
        res.status(400).json({ error: 'Invalid ID selection.' });
        return;
      }
      visitor.status = 'arrived';
      visitor.idLeft = idLeft;
      if (plate) visitor.plate = plate;
      visitor.checkedInAt = formatTimeNow();
      visitor.whenLabel = `Today, ${visitor.checkedInAt}`;
      if (visitor.residentEmail) {
        addNotification(db, {
          role: 'resident',
          targetEmail: visitor.residentEmail,
          icon: 'users',
          text: `${visitor.name} (${visitor.code}) checked in at the gate.`,
          whenLabel: 'Just now',
        });
      }
    } else if (status === 'left') {
      visitor.status = 'left';
      visitor.leftAt = formatTimeNow();
    } else if (status === 'denied') {
      visitor.status = 'denied';
      if (visitor.residentEmail) {
        addNotification(db, {
          role: 'resident',
          targetEmail: visitor.residentEmail,
          icon: 'alert',
          text: `Entry denied at the gate for ${visitor.name} (${visitor.code}).`,
          whenLabel: 'Just now',
        });
      }
    }

    saveDb(db);
    res.json({ visitor });
  });

  // Announcements
  app.get('/api/announcements', requireAuth, (_req, res) => {
    const db = loadDb();
    const announcements = [...db.announcements].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt),
    );
    res.json({ announcements });
  });

  app.post('/api/announcements', requireRole('admin'), (req: AuthedRequest, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const pinned = Boolean(req.body?.pinned);

    if (!title || title.length > 80) {
      res.status(400).json({ error: 'Title must be between 1 and 80 characters.' });
      return;
    }
    if (!body || body.length > 2000) {
      res.status(400).json({ error: 'Message must be between 1 and 2000 characters.' });
      return;
    }

    const db = loadDb();
    const ann = {
      id: 'ann-' + crypto.randomUUID(),
      title,
      body,
      pinned,
      author: 'HOA',
      whenLabel: `${formatShortNow()} · Posted by HOA`,
      createdAt: new Date().toISOString(),
    };
    db.announcements.unshift(ann);
    addNotification(db, {
      role: 'resident',
      icon: 'megaphone',
      text: `HOA Announcement: ${title}`,
      whenLabel: 'Just now',
    });
    saveDb(db);

    res.status(201).json({ announcement: ann });
  });

  app.delete('/api/announcements/:id', requireRole('admin'), (req, res) => {
    const db = loadDb();
    const id = String(req.params.id || '').trim();
    const idx = db.announcements.findIndex(a => a.id === id);
    if (idx < 0) {
      res.status(404).json({ error: 'Announcement not found.' });
      return;
    }
    db.announcements.splice(idx, 1);
    saveDb(db);
    res.json({ ok: true });
  });

  // Notifications
  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
    const db = loadDb();
    const user = req.user!;
    const notifications = db.notifications.filter(n => {
      if (n.role !== user.role) return false;
      if (n.targetEmail && n.targetEmail.toLowerCase() !== user.email.toLowerCase()) return false;
      return true;
    });
    res.json({ notifications });
  });

  app.post('/api/notifications/read', requireAuth, (req: AuthedRequest, res) => {
    const db = loadDb();
    const user = req.user!;
    for (const n of db.notifications) {
      if (n.role === user.role && (!n.targetEmail || n.targetEmail.toLowerCase() === user.email.toLowerCase())) {
        n.unread = false;
      }
    }
    saveDb(db);
    res.json({ ok: true });
  });

  // Unknown API routes return JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Block direct static access to backend files, database, and dotfiles in dev mode
  app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (
      p === '/server.ts' ||
      p.startsWith('/server/') ||
      p.startsWith('/data/') ||
      p === '/data' ||
      p.startsWith('/.') ||
      p === '/package.json' ||
      p === '/package-lock.json' ||
      p === '/tsconfig.json' ||
      p === '/vite.config.ts'
    ) {
      res.status(404).end();
      return;
    }
    next();
  });

  // Frontend serving: Vite dev middleware in dev, dist/ static files in production
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { extensions: ['html'] }));
    app.get('/', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa',
    });
    app.use(vite.middlewares);

    // Ensure root / serves index.html cleanly if Vite MPA didn't catch bare /
    app.get('/', async (req, res, next) => {
      try {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const raw = fs.readFileSync(htmlPath, 'utf8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, raw);
        res.status(200).setHeader('Content-Type', 'text/html').end(transformed);
      } catch (err) {
        next(err);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Subdivision Connect server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start Subdivision Connect server:', err);
  process.exit(1);
});
