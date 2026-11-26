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
  getDb,
  getReportById,
  hashPassword,
  listAnnouncements,
  listReports,
  listVisitors,
  nextReportId,
  nextVisitorCode,
  timingSafeStringEqual,
  verifyPassword,
} from './server/db.ts';
import type {
  ReportDTO,
  ReportStatus,
  ResponsibleParty,
  UserRole,
  UserRow,
  VisitorStatus,
} from './server/db.ts';

const PORT = 3000;
const SESSION_COOKIE = 'cc_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
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

function getEnvPasscodeForRole(role: UserRole): string {
  if (role === 'admin') return (process.env.ADMIN_PASSCODE || '').trim();
  if (role === 'resident') return (process.env.RESIDENT_PASSCODE || '').trim();
  if (role === 'guard') return (process.env.GUARD_PASSCODE || '').trim();
  return '';
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
  if (trimmed.length > 2_800_000) return undefined;
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

function toPublicReport(r: ReportDTO, user: SessionPayload) {
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

function createSessionFromUser(user: UserRow): SessionPayload {
  return {
    uid: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    blockLot: user.block_lot,
    initials: user.initials,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
}

async function startServer(): Promise<void> {
  const db = getDb();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', csrfProtection);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'subdivision-connect-sqlite' });
  });

  // Auth status
  app.get('/api/auth/status', (req, res) => {
    const roleRaw = typeof req.query.role === 'string' ? req.query.role : 'resident';
    const role: UserRole = VALID_ROLES.has(roleRaw as UserRole) ? (roleRaw as UserRole) : 'resident';
    const envPasscodeConfigured = getEnvPasscodeForRole(role).length > 0;
    const roleCount = (
      db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE role = ?').get(role) as { cnt: number }
    ).cnt;
    const hasClaimedUser = roleCount > 0 || envPasscodeConfigured;

    const cookies = parseCookies(req.headers.cookie);
    const current = verifySession(cookies[SESSION_COOKIE]);

    res.json({
      role,
      hasClaimedUser,
      envPasscodeConfigured,
      suggestedProfile: ROLE_DEFAULTS[role],
      currentUser: current,
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  // First-run setup per role
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
    if (getEnvPasscodeForRole(role).length > 0) {
      res.status(409).json({ error: 'Account passcode for this role is managed by environment configuration.' });
      return;
    }

    const existingForRole = (
      db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE role = ?').get(role) as { cnt: number }
    ).cnt;
    if (existingForRole > 0) {
      res.status(409).json({ error: 'Initial account setup for this role is already complete. Please sign in.' });
      return;
    }

    const defaults = ROLE_DEFAULTS[role];
    const email = emailInput || defaults.email;
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    const dupEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (dupEmail) {
      res.status(409).json({ error: 'An account with that email already exists.' });
      return;
    }

    const name = (nameInput || defaults.name).slice(0, 80);
    const blockLot = (blockLotInput || defaults.blockLot).slice(0, 60);
    const user: UserRow = {
      id: 'u-' + crypto.randomUUID(),
      email,
      name,
      role,
      block_lot: blockLot,
      initials: computeInitials(name),
      password_hash: hashPassword(password),
      created_at: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO users (id, email, name, role, block_lot, initials, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.email,
      user.name,
      user.role,
      user.block_lot,
      user.initials,
      user.password_hash,
      user.created_at,
    );

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

    const dupEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (dupEmail) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const user: UserRow = {
      id: 'u-' + crypto.randomUUID(),
      email,
      name,
      role: 'resident',
      block_lot: (blockLot || 'Block 1, Lot 1').slice(0, 60),
      initials: computeInitials(name),
      password_hash: hashPassword(password),
      created_at: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO users (id, email, name, role, block_lot, initials, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.email,
      user.name,
      user.role,
      user.block_lot,
      user.initials,
      user.password_hash,
      user.created_at,
    );

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

    const envPasscode = getEnvPasscodeForRole(role);
    const defaults = ROLE_DEFAULTS[role];
    if (envPasscode.length > 0 && (role === 'admin' || email === defaults.email.toLowerCase())) {
      if (timingSafeStringEqual(password, envPasscode)) {
        const session: SessionPayload = {
          uid: `env-${role}`,
          email,
          name: defaults.name,
          role,
          blockLot: defaults.blockLot,
          initials: computeInitials(defaults.name),
          exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        };
        setSessionCookie(req, res, session);
        res.json({ user: session });
        return;
      }
      res.status(401).json({ error: 'Invalid credentials for this role.' });
      return;
    }

    const user = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ? AND role = ?')
      .get(email, role) as UserRow | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
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

  // Admin dashboard metrics
  app.get('/api/dashboard/admin', requireRole('admin'), (req: AuthedRequest, res) => {
    const reports = listReports(db);
    const visitors = listVisitors(db);

    const openReports = reports.filter(r => r.status !== 'resolved');
    const pendingCount = openReports.filter(r => r.status === 'pending').length;
    const devWaiting = openReports.filter(r => r.party === 'developer');
    const oldestDevWaitDays = devWaiting.reduce((max, r) => Math.max(max, r.waitDays || 0), 0);

    const today = formatDateISO();
    const visitorsToday = visitors.filter(
      v => v.date === today && (v.status === 'arrived' || v.status === 'left'),
    ).length;
    const onSiteNow = visitors.filter(v => v.status === 'arrived').length;

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
    for (const r of reports) {
      catCounts.set(r.category, (catCounts.get(r.category) || 0) + 1);
    }
    const topCategories = [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    const needsAttention = [...openReports]
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.waitDays - a.waitDays)
      .slice(0, 6)
      .map(r => toPublicReport(r, req.user!));

    res.json({
      openCount: openReports.length,
      pendingCount,
      devWaitingCount: devWaiting.length,
      oldestDevWaitDays,
      visitorsToday,
      onSiteNow,
      blockCounts,
      topCategories,
      needsAttention,
    });
  });

  // Resident dashboard metrics
  app.get('/api/dashboard/resident', requireRole('resident', 'admin'), (req: AuthedRequest, res) => {
    const user = req.user!;
    const today = formatDateISO();
    const reports = listReports(db);
    const visitors = listVisitors(db);
    const announcements = listAnnouncements(db);

    const expectedVisitors = visitors.filter(
      v =>
        v.residentEmail.toLowerCase() === user.email.toLowerCase() &&
        v.status === 'expected' &&
        (v.date === today || v.whenLabel.toLowerCase().includes('today')),
    );

    const openReports = reports
      .filter(
        r =>
          r.status !== 'resolved' &&
          (r.reporterEmail.toLowerCase() === user.email.toLowerCase() ||
            r.reporter.toLowerCase() === user.name.toLowerCase()),
      )
      .map(r => toPublicReport(r, user));

    const totalReports = reports.length;
    const resolvedCount = reports.filter(r => r.status === 'resolved').length;
    const devWaitingCount = reports.filter(r => r.status !== 'resolved' && r.party === 'developer').length;

    res.json({
      expectedVisitors,
      openReports,
      announcements: announcements.slice(0, 3),
      hoaStats: {
        totalReports,
        resolvedCount,
        avgDaysLabel: '3 days',
        devWaitingCount,
      },
    });
  });

  // Reports
  app.get('/api/requests', requireAuth, (req: AuthedRequest, res) => {
    const reports = listReports(db).map(r => toPublicReport(r, req.user!));
    res.json({ reports });
  });

  app.get('/api/requests/:id', requireAuth, (req: AuthedRequest, res) => {
    const id = String(req.params.id || '').trim();
    const report = getReportById(db, id);
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
    const urgency = req.body?.urgency === 'urgent' ? 1 : 0;
    const photoDataUrl = sanitizeImageDataUrl(req.body?.photoDataUrl) || null;

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
    const cleanBlock = block === 'Main road / common area' ? 'Main road' : block;
    const whereParts = [cleanBlock];
    if (lot) whereParts.push(`Lot ${lot}`);
    if (location) whereParts.push(location);

    const id = nextReportId(db);
    const whenStr = formatShortNow();
    const nowIso = new Date().toISOString();
    const party: ResponsibleParty = category === 'Water leak (warranty)' ? 'developer' : 'hoa';

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO reports (
          id, title, kind, type, category, status, party, block, lot, location,
          where_label, reporter, reporter_email, reported, reported_at, urgent, wait_days,
          base_affected, description, photo_data_url
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
      `).run(
        id,
        title,
        isService ? 'Service request' : 'Issue',
        isService ? 'service' : 'issue',
        category,
        party,
        cleanBlock,
        lot,
        location,
        whereParts.join(', '),
        user.name,
        user.email,
        whenStr,
        nowIso,
        urgency,
        desc || title,
        photoDataUrl,
      );

      db.prepare(`
        INSERT INTO report_updates (report_id, cls, title, when_label, note, by_name, created_at)
        VALUES (?, 'pending', 'Pending', ?, 'Report submitted', ?, ?)
      `).run(id, whenStr, user.name.split(' ')[0] || user.name, nowIso);

      db.prepare('INSERT OR IGNORE INTO report_affected (report_id, user_email) VALUES (?, ?)').run(
        id,
        user.email.toLowerCase(),
      );

      addNotification(db, {
        role: 'admin',
        icon: 'clipboard',
        text: `New ${urgency ? 'urgent ' : ''}report ${id}: ${title}`,
        whenLabel: 'Just now',
      });

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const created = getReportById(db, id)!;
    res.status(201).json({ report: toPublicReport(created, user) });
  });

  app.patch('/api/requests/:id', requireRole('admin'), (req: AuthedRequest, res) => {
    const id = String(req.params.id || '').trim();
    const existing = getReportById(db, id);
    if (!existing) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const status = req.body?.status;
    const party = req.body?.party;
    const whenStr = formatShortNow();
    const nowIso = new Date().toISOString();

    if (status !== undefined && !VALID_STATUSES.has(status)) {
      res.status(400).json({ error: 'Invalid status value.' });
      return;
    }
    if (party !== undefined && !VALID_PARTIES.has(party)) {
      res.status(400).json({ error: 'Invalid responsible party.' });
      return;
    }

    db.exec('BEGIN');
    try {
      if (status !== undefined && existing.status !== status) {
        db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, id);
        db.prepare(`
          INSERT INTO report_updates (report_id, cls, title, when_label, note, by_name, created_at)
          VALUES (?, ?, ?, ?, 'Status changed by HOA.', 'HOA', ?)
        `).run(id, status, STATUS_LABELS[status as ReportStatus], whenStr, nowIso);

        addNotification(db, {
          role: 'resident',
          targetEmail: existing.reporterEmail,
          icon: 'clipboard',
          text: `${id} marked "${STATUS_LABELS[status as ReportStatus]}".`,
          whenLabel: 'Just now',
        });
      }

      if (party !== undefined && existing.party !== party) {
        const nextWaitDays = party === 'developer' && existing.waitDays === 0 ? 1 : existing.waitDays;
        db.prepare('UPDATE reports SET party = ?, wait_days = ? WHERE id = ?').run(party, nextWaitDays, id);
        db.prepare(`
          INSERT INTO report_updates (report_id, cls, title, when_label, note, by_name, created_at)
          VALUES (?, ?, 'Assigned', ?, ?, 'HOA', ?)
        `).run(
          id,
          status || existing.status,
          whenStr,
          `Responsible party set to ${PARTY_LABELS[party as ResponsibleParty]}.`,
          nowIso,
        );
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const updated = getReportById(db, id)!;
    res.json({ report: toPublicReport(updated, req.user!) });
  });

  app.post('/api/requests/:id/notes', requireRole('admin'), (req: AuthedRequest, res) => {
    const id = String(req.params.id || '').trim();
    const existing = getReportById(db, id);
    if (!existing) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note || note.length > 600) {
      res.status(400).json({ error: 'Update message must be between 1 and 600 characters.' });
      return;
    }

    const whenStr = formatShortNow();
    db.prepare(`
      INSERT INTO report_updates (report_id, cls, title, when_label, note, by_name, created_at)
      VALUES (?, ?, 'Update', ?, ?, 'HOA', ?)
    `).run(id, existing.status, whenStr, note, new Date().toISOString());

    addNotification(db, {
      role: 'resident',
      targetEmail: existing.reporterEmail,
      icon: 'clipboard',
      text: `HOA update on ${id}: ${note.slice(0, 70)}`,
      whenLabel: 'Just now',
    });

    const updated = getReportById(db, id)!;
    res.status(201).json({ report: toPublicReport(updated, req.user!) });
  });

  app.post('/api/requests/:id/affect', requireAuth, (req: AuthedRequest, res) => {
    const id = String(req.params.id || '').trim();
    const existing = getReportById(db, id);
    if (!existing) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const emailKey = req.user!.email.toLowerCase();
    const already = db
      .prepare('SELECT 1 FROM report_affected WHERE report_id = ? AND user_email = ?')
      .get(id, emailKey);

    if (already) {
      db.prepare('DELETE FROM report_affected WHERE report_id = ? AND user_email = ?').run(id, emailKey);
    } else {
      db.prepare('INSERT INTO report_affected (report_id, user_email) VALUES (?, ?)').run(id, emailKey);
    }

    const updated = getReportById(db, id)!;
    res.json({ report: toPublicReport(updated, req.user!) });
  });

  // Visitors & Gate Log
  app.get('/api/visitors', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const all = listVisitors(db);
    const visitors =
      user.role === 'resident'
        ? all.filter(v => v.residentEmail.toLowerCase() === user.email.toLowerCase())
        : all;
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

    const id = 'v-' + crypto.randomUUID();
    const code = nextVisitorCode(db, 'V-');
    const timeFormatted = time ? format12HourTime(time) : 'Anytime';
    const isToday = date === formatDateISO();
    const whenLabel = `${isToday ? 'Today' : date} · ${timeFormatted}`;
    const shortBlockLot = formatBlockLotShort(user.blockLot);
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO visitors (
        id, code, name, type, visit_date, visit_time, plate, note, dest,
        resident_name, resident_email, resident_block_lot, kind, status,
        id_left, confirmed_by_phone, when_label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reg', 'expected', '', 0, ?, ?)
    `).run(
      id,
      code,
      name,
      type,
      date,
      time,
      plate,
      note,
      user.blockLot,
      user.name,
      user.email,
      shortBlockLot,
      whenLabel,
      nowIso,
    );

    addNotification(db, {
      role: 'guard',
      icon: 'bell',
      text: `Expected visitor ${name} (${code}) for ${user.name}, ${shortBlockLot}.`,
      whenLabel: 'Just now',
    });

    const visitor = listVisitors(db).find(v => v.id === id)!;
    res.status(201).json({ visitor });
  });

  app.post('/api/visitors/walkin', requireRole('guard', 'admin'), (req: AuthedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : 'Guest';
    const dest = typeof req.body?.dest === 'string' ? req.body.dest.trim() : '';
    const idLeft = typeof req.body?.idLeft === 'string' ? req.body.idLeft.trim() : 'National ID';
    const confirmed = Boolean(req.body?.confirmed);

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

    const id = 'w-' + crypto.randomUUID();
    const code = nextVisitorCode(db, 'W-');
    const timeStr = formatTimeNow();
    const today = formatDateISO();
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO visitors (
        id, code, name, type, visit_date, visit_time, plate, note, dest,
        resident_name, resident_email, resident_block_lot, kind, status,
        id_left, confirmed_by_phone, checked_in_at, when_label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, '', ?, 'walk', 'arrived', ?, ?, ?, ?, ?)
    `).run(
      id,
      code,
      `Walk-in: ${name}`,
      type,
      today,
      timeStr,
      confirmed ? 'confirmed by phone' : 'not confirmed by phone',
      dest,
      dest,
      dest,
      idLeft,
      confirmed ? 1 : 0,
      timeStr,
      `Today, ${timeStr}`,
      nowIso,
    );

    addNotification(db, {
      role: 'admin',
      icon: 'users',
      text: `Walk-in logged at gate: ${name} -> ${dest} (${idLeft}).`,
      whenLabel: 'Just now',
    });

    const visitor = listVisitors(db).find(v => v.id === id)!;
    res.status(201).json({ visitor });
  });

  app.patch('/api/visitors/:id/gate', requireRole('guard', 'admin'), (req: AuthedRequest, res) => {
    const id = String(req.params.id || '').trim();
    const existing = listVisitors(db).find(v => v.id === id);
    if (!existing) {
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
      const checkedInAt = formatTimeNow();
      db.prepare(`
        UPDATE visitors
        SET status = 'arrived', id_left = ?, plate = COALESCE(NULLIF(?, ''), plate),
            checked_in_at = ?, when_label = ?
        WHERE id = ?
      `).run(idLeft, plate, checkedInAt, `Today, ${checkedInAt}`, id);

      if (existing.residentEmail) {
        addNotification(db, {
          role: 'resident',
          targetEmail: existing.residentEmail,
          icon: 'users',
          text: `${existing.name} (${existing.code}) checked in at the gate.`,
          whenLabel: 'Just now',
        });
      }
    } else if (status === 'left') {
      db.prepare("UPDATE visitors SET status = 'left', left_at = ? WHERE id = ?").run(formatTimeNow(), id);
    } else if (status === 'denied') {
      db.prepare("UPDATE visitors SET status = 'denied' WHERE id = ?").run(id);
      if (existing.residentEmail) {
        addNotification(db, {
          role: 'resident',
          targetEmail: existing.residentEmail,
          icon: 'alert',
          text: `Entry denied at the gate for ${existing.name} (${existing.code}).`,
          whenLabel: 'Just now',
        });
      }
    }

    const visitor = listVisitors(db).find(v => v.id === id)!;
    res.json({ visitor });
  });

  // Announcements
  app.get('/api/announcements', requireAuth, (_req, res) => {
    res.json({ announcements: listAnnouncements(db) });
  });

  app.post('/api/announcements', requireRole('admin'), (req: AuthedRequest, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const pinned = req.body?.pinned ? 1 : 0;

    if (!title || title.length > 80) {
      res.status(400).json({ error: 'Title must be between 1 and 80 characters.' });
      return;
    }
    if (!body || body.length > 2000) {
      res.status(400).json({ error: 'Message must be between 1 and 2000 characters.' });
      return;
    }

    const id = 'ann-' + crypto.randomUUID();
    const whenLabel = `${formatShortNow()} · Posted by HOA`;
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO announcements (id, title, body, pinned, author, when_label, created_at)
      VALUES (?, ?, ?, ?, 'HOA', ?, ?)
    `).run(id, title, body, pinned, whenLabel, createdAt);

    addNotification(db, {
      role: 'resident',
      icon: 'megaphone',
      text: `HOA Announcement: ${title}`,
      whenLabel: 'Just now',
    });

    const announcement = listAnnouncements(db).find(a => a.id === id)!;
    res.status(201).json({ announcement });
  });

  app.delete('/api/announcements/:id', requireRole('admin'), (req, res) => {
    const id = String(req.params.id || '').trim();
    const result = db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Announcement not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // Notifications
  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare(`
        SELECT * FROM notifications
        WHERE role = ? AND (target_email IS NULL OR LOWER(target_email) = ?)
        ORDER BY created_at DESC
        LIMIT 50
      `)
      .all(user.role, user.email.toLowerCase()) as Array<Record<string, unknown>>;

    const notifications = rows.map(n => ({
      id: String(n.id),
      role: n.role as UserRole,
      targetEmail: n.target_email ? String(n.target_email) : undefined,
      icon: String(n.icon),
      text: String(n.text),
      whenLabel: String(n.when_label),
      unread: Boolean(n.unread),
      createdAt: String(n.created_at),
    }));
    res.json({ notifications });
  });

  app.post('/api/notifications/read', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    db.prepare(`
      UPDATE notifications
      SET unread = 0
      WHERE role = ? AND (target_email IS NULL OR LOWER(target_email) = ?)
    `).run(user.role, user.email.toLowerCase());
    res.json({ ok: true });
  });

  // Unknown API routes return JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Protect backend source, SQLite files, and dotfiles in dev mode
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
    console.log(`Subdivision Connect server (SQLite) listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start Subdivision Connect server:', err);
  process.exit(1);
});