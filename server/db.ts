import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type UserRole = 'resident' | 'admin' | 'guard';
export type ReportStatus = 'pending' | 'in_progress' | 'resolved';
export type ResponsibleParty = 'unassigned' | 'hoa' | 'developer' | 'lgu';
export type VisitorStatus = 'expected' | 'arrived' | 'left' | 'denied';
export type VisitorEntryKind = 'reg' | 'walk';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  block_lot: string;
  initials: string;
  password_hash: string;
  created_at: string;
}

export interface TimelineEntry {
  cls: ReportStatus;
  title: string;
  when: string;
  note: string;
  by: string;
}

export interface ReportDTO {
  id: string;
  title: string;
  kind: 'Issue' | 'Service request';
  type: 'issue' | 'service';
  category: string;
  status: ReportStatus;
  party: ResponsibleParty;
  block: string;
  lot: string;
  location: string;
  where: string;
  reporter: string;
  reporterEmail: string;
  reported: string;
  reportedAt: string;
  affected: number;
  affectedBy: string[];
  urgent: boolean;
  waitDays: number;
  desc: string;
  photoDataUrl?: string;
  timeline: TimelineEntry[];
}

export interface VisitorDTO {
  id: string;
  code: string;
  name: string;
  type: string;
  date: string;
  time: string;
  plate: string;
  note: string;
  dest: string;
  residentName: string;
  residentEmail: string;
  residentBlockLot: string;
  kind: VisitorEntryKind;
  status: VisitorStatus;
  idLeft: string;
  confirmedByPhone: boolean;
  checkedInAt?: string;
  leftAt?: string;
  whenLabel: string;
  createdAt: string;
}

export interface AnnouncementDTO {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  author: string;
  whenLabel: string;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  role: UserRole;
  targetEmail?: string;
  icon: string;
  text: string;
  whenLabel: string;
  unread: boolean;
  createdAt: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.resolve(DATA_DIR, 'subdivision.db');

if (!DB_PATH.startsWith(DATA_DIR + path.sep)) {
  throw new Error('Invalid SQLite database path configuration.');
}

let dbInstance: DatabaseSync | null = null;

export function formatShortNow(): string {
  return new Date().toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTimeNow(): string {
  return new Date().toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateISO(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'SC';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Create clean, easy-to-read relational SQL tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('resident', 'admin', 'guard')),
      block_lot TEXT NOT NULL,
      initials TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('Issue', 'Service request')),
      type TEXT NOT NULL CHECK(type IN ('issue', 'service')),
      category TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'resolved')),
      party TEXT NOT NULL CHECK(party IN ('unassigned', 'hoa', 'developer', 'lgu')),
      block TEXT NOT NULL,
      lot TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      where_label TEXT NOT NULL,
      reporter TEXT NOT NULL,
      reporter_email TEXT NOT NULL,
      reported TEXT NOT NULL,
      reported_at TEXT NOT NULL,
      urgent INTEGER NOT NULL DEFAULT 0,
      wait_days INTEGER NOT NULL DEFAULT 0,
      base_affected INTEGER NOT NULL DEFAULT 1,
      description TEXT NOT NULL,
      photo_data_url TEXT
    );

    CREATE TABLE IF NOT EXISTS report_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      cls TEXT NOT NULL CHECK(cls IN ('pending', 'in_progress', 'resolved')),
      title TEXT NOT NULL,
      when_label TEXT NOT NULL,
      note TEXT NOT NULL,
      by_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_affected (
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      PRIMARY KEY (report_id, user_email)
    );

    CREATE TABLE IF NOT EXISTS visitors (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      visit_time TEXT NOT NULL DEFAULT '',
      plate TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      dest TEXT NOT NULL,
      resident_name TEXT NOT NULL,
      resident_email TEXT NOT NULL DEFAULT '',
      resident_block_lot TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK(kind IN ('reg', 'walk')),
      status TEXT NOT NULL CHECK(status IN ('expected', 'arrived', 'left', 'denied')),
      id_left TEXT NOT NULL DEFAULT '',
      confirmed_by_phone INTEGER NOT NULL DEFAULT 0,
      checked_in_at TEXT,
      left_at TEXT,
      when_label TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      author TEXT NOT NULL,
      when_label TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('resident', 'admin', 'guard')),
      target_email TEXT,
      icon TEXT NOT NULL,
      text TEXT NOT NULL,
      when_label TEXT NOT NULL,
      unread INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  seedInitialData(db);
  dbInstance = db;
  return db;
}

function seedInitialData(db: DatabaseSync): void {
  const reportCount = (db.prepare('SELECT COUNT(*) AS cnt FROM reports').get() as { cnt: number }).cnt;
  if (reportCount > 0) return;

  const today = formatDateISO();
  const yesterdayDate = new Date(Date.now() - 86400000);
  const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;

  const insertReport = db.prepare(`
    INSERT INTO reports (
      id, title, kind, type, category, status, party, block, lot, location,
      where_label, reporter, reporter_email, reported, reported_at, urgent, wait_days,
      base_affected, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertUpdate = db.prepare(`
    INSERT INTO report_updates (report_id, cls, title, when_label, note, by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAffected = db.prepare(`
    INSERT OR IGNORE INTO report_affected (report_id, user_email) VALUES (?, ?)
  `);

  const seedReports = [
    {
      id: 'R-1001',
      title: 'Clogged drain at the corner of Block 4',
      kind: 'Issue',
      type: 'issue',
      category: 'Drainage / flooding',
      status: 'pending',
      party: 'hoa',
      block: 'Block 4',
      lot: '',
      location: 'Corner drain',
      where: 'Block 4',
      reporter: 'Carlos Mendoza',
      email: 'carlos.mendoza@carmela.ph',
      reported: 'Oct 21, 10:15 AM',
      daysAgo: 2,
      urgent: 1,
      waitDays: 0,
      affected: 3,
      desc: 'Rainwater pools up to ankle-deep near the corner drain whenever it rains heavily.',
      updates: [
        ['pending', 'Pending', 'Oct 21, 10:15 AM', 'Report submitted', 'Carlos'],
      ],
    },
    {
      id: 'R-1002',
      title: 'Brown water from the taps',
      kind: 'Issue',
      type: 'issue',
      category: 'Water supply',
      status: 'in_progress',
      party: 'hoa',
      block: 'Block 3',
      lot: '12',
      location: '',
      where: 'Block 3, Lot 12',
      reporter: 'Maria Santos',
      email: 'maria.santos@carmela.ph',
      reported: 'Oct 20, 8:10 AM',
      daysAgo: 3,
      urgent: 1,
      waitDays: 0,
      affected: 3,
      desc: 'Water has been brown since Monday morning. The tank may need cleaning.',
      updates: [
        ['pending', 'Pending', 'Oct 20, 8:10 AM', 'Report submitted', 'Maria'],
        ['in_progress', 'In progress', 'Oct 20, 2:15 PM', 'Acknowledged by the HOA. Tank inspection scheduled.', 'HOA'],
      ],
    },
    {
      id: 'R-1003',
      title: 'Leak under the kitchen sink wall',
      kind: 'Service request',
      type: 'service',
      category: 'Water leak (warranty)',
      status: 'in_progress',
      party: 'developer',
      block: 'Block 5',
      lot: '4',
      location: '',
      where: 'Block 5, Lot 4',
      reporter: 'Juan Dela Cruz',
      email: 'juan.delacruz@carmela.ph',
      reported: 'Oct 7, 9:30 AM',
      daysAgo: 16,
      urgent: 0,
      waitDays: 16,
      affected: 1,
      desc: 'Leak started a month after turnover. This should be covered by the developer’s warranty.',
      updates: [
        ['pending', 'Pending', 'Oct 7, 9:30 AM', 'Report submitted', 'Juan'],
        ['in_progress', 'In progress', 'Oct 7, 3:30 PM', 'Forwarded to the developer. Waiting for a reply.', 'HOA'],
      ],
    },
    {
      id: 'R-1004',
      title: 'Bathroom wall leaking into the next room',
      kind: 'Service request',
      type: 'service',
      category: 'Water leak (warranty)',
      status: 'pending',
      party: 'developer',
      block: 'Block 7',
      lot: '9',
      location: '',
      where: 'Block 7, Lot 9',
      reporter: 'Elena Cruz',
      email: 'elena.cruz@carmela.ph',
      reported: 'Oct 12, 11:00 AM',
      daysAgo: 11,
      urgent: 0,
      waitDays: 11,
      affected: 2,
      desc: 'Damp spots and peeling paint appeared on the bedroom wall behind the shower.',
      updates: [
        ['pending', 'Pending', 'Oct 12, 11:00 AM', 'Report submitted and queued for developer warranty check.', 'Elena'],
      ],
    },
    {
      id: 'R-1005',
      title: 'Stray dogs tearing trash bags',
      kind: 'Issue',
      type: 'issue',
      category: 'Stray animals',
      status: 'pending',
      party: 'lgu',
      block: 'Block 6',
      lot: '',
      location: 'Side fence',
      where: 'Block 6',
      reporter: 'Maria Santos',
      email: 'maria.santos@carmela.ph',
      reported: 'Oct 22, 7:20 AM',
      daysAgo: 1,
      urgent: 0,
      waitDays: 0,
      affected: 2,
      desc: 'Three stray dogs enter through the side fence before garbage pickup.',
      updates: [
        ['pending', 'Pending', 'Oct 22, 7:20 AM', 'Endorsed to barangay animal control.', 'HOA'],
      ],
    },
    {
      id: 'R-1006',
      title: 'Streetlight out near Block 2 corner',
      kind: 'Issue',
      type: 'issue',
      category: 'Streetlight',
      status: 'resolved',
      party: 'hoa',
      block: 'Block 2',
      lot: '',
      location: 'Corner lamp post',
      where: 'Block 2',
      reporter: 'Ramon Villanueva',
      email: 'ramon.villanueva@carmela.ph',
      reported: 'Oct 14, 7:45 PM',
      daysAgo: 9,
      urgent: 0,
      waitDays: 0,
      affected: 3,
      desc: 'Corner lamp post flickered and went completely dark at night.',
      updates: [
        ['pending', 'Pending', 'Oct 14, 7:45 PM', 'Report submitted', 'Ramon'],
        ['resolved', 'Resolved', 'Oct 16, 4:00 PM', 'Bulb and ballast replaced by maintenance.', 'HOA'],
      ],
    },
    {
      id: 'R-1008',
      title: 'Loud karaoke past midnight',
      kind: 'Issue',
      type: 'issue',
      category: 'Noise / disturbance',
      status: 'resolved',
      party: 'hoa',
      block: 'Block 1',
      lot: '',
      location: '',
      where: 'Block 1',
      reporter: 'Ana Reyes',
      email: 'ana.reyes@carmela.ph',
      reported: 'Oct 11, 12:35 AM',
      daysAgo: 12,
      urgent: 0,
      waitDays: 0,
      affected: 1,
      desc: 'Music volume remained high past subdivision quiet hours (10:00 PM).',
      updates: [
        ['pending', 'Pending', 'Oct 11, 12:35 AM', 'Report submitted', 'Ana'],
        ['resolved', 'Resolved', 'Oct 11, 12:50 AM', 'Roving guard reminded household of quiet hours.', 'Guard'],
      ],
    },
    {
      id: 'R-1009',
      title: 'Pothole on the main road near the gate',
      kind: 'Issue',
      type: 'issue',
      category: 'Road damage',
      status: 'in_progress',
      party: 'hoa',
      block: 'Main road',
      lot: '',
      location: 'Near main gate',
      where: 'Main road',
      reporter: 'Tony Valdez',
      email: 'guard.tony@carmela.ph',
      reported: 'Oct 18, 2:10 PM',
      daysAgo: 5,
      urgent: 0,
      waitDays: 0,
      affected: 3,
      desc: 'Deep pothole near the inbound lane slows tricycles and cars entering the gate.',
      updates: [
        ['pending', 'Pending', 'Oct 18, 2:10 PM', 'Report submitted', 'Tony'],
        ['in_progress', 'In progress', 'Oct 19, 9:00 AM', 'Cold-mix asphalt patching scheduled this week.', 'HOA'],
      ],
    },
    {
      id: 'R-1010',
      title: 'Only one internet provider available',
      kind: 'Issue',
      type: 'issue',
      category: 'Internet / utilities',
      status: 'pending',
      party: 'developer',
      block: 'Block 8',
      lot: '',
      location: 'Phase 2',
      where: 'Block 8',
      reporter: 'Maria Santos',
      email: 'maria.santos@carmela.ph',
      reported: 'Oct 3, 1:05 PM',
      daysAgo: 20,
      urgent: 0,
      waitDays: 20,
      affected: 3,
      desc: 'Phase 2 lines are still locked to a single ISP while residents wait on pole clearance.',
      updates: [
        ['pending', 'Pending', 'Oct 3, 1:05 PM', 'Waiting for developer utility clearance.', 'HOA'],
      ],
    },
  ];

  db.exec('BEGIN');
  try {
    for (const r of seedReports) {
      const isoReported = new Date(Date.now() - r.daysAgo * 86400000).toISOString();
      insertReport.run(
        r.id,
        r.title,
        r.kind,
        r.type,
        r.category,
        r.status,
        r.party,
        r.block,
        r.lot,
        r.location,
        r.where,
        r.reporter,
        r.email,
        r.reported,
        isoReported,
        r.urgent,
        r.waitDays,
        r.affected,
        r.desc,
      );
      r.updates.forEach(([cls, title, when, note, by], idx) => {
        insertUpdate.run(r.id, cls, title, when, note, by, new Date(Date.now() - r.daysAgo * 86400000 + idx * 1000).toISOString());
      });
      insertAffected.run(r.id, r.email);
    }

    const insertVisitor = db.prepare(`
      INSERT INTO visitors (
        id, code, name, type, visit_date, visit_time, plate, note, dest,
        resident_name, resident_email, resident_block_lot, kind, status,
        id_left, confirmed_by_phone, checked_in_at, when_label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedVisitors = [
      ['g1', 'V-2041', 'Jose Ramirez', 'Guest', today, '15:00', '', '', 'Block 3, Lot 12', 'Maria Santos', 'maria.santos@carmela.ph', 'B3 L12', 'reg', 'expected', '', 0, null, 'Today · 3:00 PM', 1],
      ['g2', 'V-2043', 'Mang Ben', 'Tricycle / ride', today, '17:30', 'TC 4821', '', 'Block 1, Lot 20', 'Ana Reyes', 'ana.reyes@carmela.ph', 'B1 L20', 'reg', 'expected', '', 0, null, 'Today · 5:30 PM', 2],
      ['g3', 'V-2042', 'Mang Lando (plumber)', 'Contractor / service', today, '09:00', '', 'Plumbing check', 'Block 5, Lot 4', 'Juan Dela Cruz', 'juan.delacruz@carmela.ph', 'B5 L4', 'reg', 'arrived', 'National ID', 0, '9:12 AM', 'Oct 23, 9:12 AM', 3],
      ['g4', 'W-014', 'Walk-in: Mr. Aquino', 'Guest', today, '08:40', '', '', 'Block 1, Lot 20', 'Ana Reyes', 'ana.reyes@carmela.ph', 'B1 L20', 'walk', 'left', 'School / company ID', 1, '8:40 AM', 'Oct 23, 8:40 AM', 4],
      ['g5', 'V-2038', 'Tricycle · TC 7710', 'Tricycle / ride', today, '07:55', 'TC 7710', '', 'Block 3, Lot 12', 'Maria Santos', 'maria.santos@carmela.ph', 'B3 L12', 'reg', 'left', 'No ID left', 0, '7:55 AM', 'Oct 23, 7:55 AM', 5],
      ['g6', 'V-2040', 'Lazada rider', 'Delivery', yesterday, '13:00', '', '', 'Block 3, Lot 12', 'Maria Santos', 'maria.santos@carmela.ph', 'B3 L12', 'reg', 'left', 'Driver’s license', 0, '1:00 PM', 'Oct 22, 1:00 PM', 6],
      ['g7', 'W-013', 'Walk-in: delivery man', 'Delivery', yesterday, '10:20', '', '', 'Block 5, Lot 4', 'Juan Dela Cruz', 'juan.delacruz@carmela.ph', 'B5 L4', 'walk', 'left', 'No ID left', 1, '10:20 AM', 'Oct 22, 10:20 AM', 7],
      ['g8', 'V-2036', 'Relatives (2 people)', 'Guest', yesterday, '16:10', '', '', 'Block 1, Lot 20', 'Ana Reyes', 'ana.reyes@carmela.ph', 'B1 L20', 'reg', 'left', 'National ID', 0, '4:10 PM', 'Oct 21, 4:10 PM', 8],
    ] as const;

    for (const v of seedVisitors) {
      insertVisitor.run(
        v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8],
        v[9], v[10], v[11], v[12], v[13], v[14], v[15], v[16], v[17],
        new Date(Date.now() - v[18] * 3600000).toISOString(),
      );
    }

    const insertAnn = db.prepare(`
      INSERT INTO announcements (id, title, body, pinned, author, when_label, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertAnn.run(
      'ann-1',
      'Water tank cleaning scheduled this Sunday',
      'Water pressure may be low from 8:00 AM to 12:00 PM while the main elevated tank is flushed.',
      1,
      'HOA',
      'Oct 22 · Posted by HOA',
      new Date(Date.now() - 86400000).toISOString(),
    );
    insertAnn.run(
      'ann-2',
      'Pre-register holiday guests & deliveries',
      'Please generate a gate code under Visitors before guests arrive to avoid queues at the main gate.',
      0,
      'HOA',
      'Oct 19 · Posted by HOA',
      new Date(Date.now() - 4 * 86400000).toISOString(),
    );

    const insertNotif = db.prepare(`
      INSERT INTO notifications (id, role, target_email, icon, text, when_label, unread, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertNotif.run('n-admin-1', 'admin', null, 'clipboard', 'New community report needs attention.', 'Today', 1, new Date().toISOString());
    insertNotif.run('n-guard-1', 'guard', null, 'bell', 'Visitor Jose Ramirez is expected at 3:00 PM (V-2041).', 'Today', 1, new Date().toISOString());
    insertNotif.run('n-guard-2', 'guard', null, 'bell', 'Reminder: log every tricycle and leave an ID.', 'This week', 0, new Date(Date.now() - 86400000).toISOString());
    insertNotif.run('n-res-1', 'resident', 'maria.santos@carmela.ph', 'users', 'Visitor Jose Ramirez is expected at 3:00 PM (V-2041).', 'Today', 1, new Date().toISOString());

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listReports(db: DatabaseSync): ReportDTO[] {
  const rows = db.prepare('SELECT * FROM reports ORDER BY reported_at DESC').all() as Array<Record<string, unknown>>;
  const updates = db.prepare('SELECT * FROM report_updates ORDER BY id DESC').all() as Array<Record<string, unknown>>;
  const affectedRows = db.prepare('SELECT report_id, user_email FROM report_affected').all() as Array<{ report_id: string; user_email: string }>;

  const updatesByReport = new Map<string, TimelineEntry[]>();
  for (const u of updates) {
    const rid = String(u.report_id);
    const list = updatesByReport.get(rid) || [];
    list.push({
      cls: u.cls as ReportStatus,
      title: String(u.title),
      when: String(u.when_label),
      note: String(u.note),
      by: String(u.by_name),
    });
    updatesByReport.set(rid, list);
  }

  const affectedByReport = new Map<string, string[]>();
  for (const a of affectedRows) {
    const list = affectedByReport.get(a.report_id) || [];
    list.push(a.user_email);
    affectedByReport.set(a.report_id, list);
  }

  return rows.map(r => {
    const id = String(r.id);
    const affectedList = affectedByReport.get(id) || [];
    const baseAffected = Number(r.base_affected) || 1;
    // Count extra voters beyond initial reporter
    const extraVotes = Math.max(0, affectedList.length - 1);
    return {
      id,
      title: String(r.title),
      kind: r.kind as 'Issue' | 'Service request',
      type: r.type as 'issue' | 'service',
      category: String(r.category),
      status: r.status as ReportStatus,
      party: r.party as ResponsibleParty,
      block: String(r.block),
      lot: String(r.lot || ''),
      location: String(r.location || ''),
      where: String(r.where_label),
      reporter: String(r.reporter),
      reporterEmail: String(r.reporter_email),
      reported: String(r.reported),
      reportedAt: String(r.reported_at),
      affected: baseAffected + extraVotes,
      affectedBy: affectedList,
      urgent: Boolean(r.urgent),
      waitDays: Number(r.wait_days) || 0,
      desc: String(r.description),
      photoDataUrl: r.photo_data_url ? String(r.photo_data_url) : undefined,
      timeline: updatesByReport.get(id) || [],
    };
  });
}

export function getReportById(db: DatabaseSync, id: string): ReportDTO | null {
  return listReports(db).find(r => r.id === id) || null;
}

export function nextReportId(db: DatabaseSync): string {
  const rows = db.prepare("SELECT id FROM reports WHERE id LIKE 'R-%'").all() as Array<{ id: string }>;
  let max = 1010;
  for (const row of rows) {
    const num = Number(row.id.slice(2));
    if (Number.isFinite(num) && num > max) max = num;
  }
  return `R-${max + 1}`;
}

export function nextVisitorCode(db: DatabaseSync, prefix: 'V-' | 'W-'): string {
  const rows = db.prepare('SELECT code FROM visitors WHERE code LIKE ?').all(`${prefix}%`) as Array<{ code: string }>;
  let max = prefix === 'V-' ? 2043 : 14;
  for (const row of rows) {
    const num = Number(row.code.slice(2));
    if (Number.isFinite(num) && num > max) max = num;
  }
  const next = max + 1;
  return prefix === 'V-' ? `V-${next}` : `W-${String(next).padStart(3, '0')}`;
}

export function listVisitors(db: DatabaseSync): VisitorDTO[] {
  const rows = db.prepare('SELECT * FROM visitors ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  return rows.map(v => ({
    id: String(v.id),
    code: String(v.code),
    name: String(v.name),
    type: String(v.type),
    date: String(v.visit_date),
    time: String(v.visit_time || ''),
    plate: String(v.plate || ''),
    note: String(v.note || ''),
    dest: String(v.dest),
    residentName: String(v.resident_name),
    residentEmail: String(v.resident_email || ''),
    residentBlockLot: String(v.resident_block_lot || ''),
    kind: v.kind as VisitorEntryKind,
    status: v.status as VisitorStatus,
    idLeft: String(v.id_left || ''),
    confirmedByPhone: Boolean(v.confirmed_by_phone),
    checkedInAt: v.checked_in_at ? String(v.checked_in_at) : undefined,
    leftAt: v.left_at ? String(v.left_at) : undefined,
    whenLabel: String(v.when_label),
    createdAt: String(v.created_at),
  }));
}

export function listAnnouncements(db: DatabaseSync): AnnouncementDTO[] {
  const rows = db
    .prepare('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map(a => ({
    id: String(a.id),
    title: String(a.title),
    body: String(a.body),
    pinned: Boolean(a.pinned),
    author: String(a.author),
    whenLabel: String(a.when_label),
    createdAt: String(a.created_at),
  }));
}

export function addNotification(
  db: DatabaseSync,
  notif: { role: UserRole; targetEmail?: string | null; icon: string; text: string; whenLabel: string },
): void {
  db.prepare(`
    INSERT INTO notifications (id, role, target_email, icon, text, when_label, unread, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    'n-' + crypto.randomUUID(),
    notif.role,
    notif.targetEmail || null,
    notif.icon,
    notif.text,
    notif.whenLabel,
    new Date().toISOString(),
  );
}