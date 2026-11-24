import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type UserRole = 'resident' | 'admin' | 'guard';
export type ReportStatus = 'pending' | 'in_progress' | 'resolved';
export type ResponsibleParty = 'unassigned' | 'hoa' | 'developer' | 'lgu';
export type VisitorStatus = 'expected' | 'arrived' | 'left' | 'denied';
export type VisitorEntryKind = 'reg' | 'walk';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  blockLot: string;
  initials: string;
  passwordHash: string;
  createdAt: string;
}

export interface TimelineEntry {
  cls: ReportStatus;
  title: string;
  when: string;
  note: string;
  by: string;
}

export interface ReportRecord {
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

export interface VisitorRecord {
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
  confirmedByPhone?: boolean;
  checkedInAt?: string;
  leftAt?: string;
  whenLabel: string;
  createdAt: string;
}

export interface AnnouncementRecord {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  author: string;
  whenLabel: string;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  role: UserRole;
  targetEmail?: string;
  icon: string;
  text: string;
  whenLabel: string;
  unread: boolean;
  createdAt: string;
}

export interface DatabaseState {
  users: UserRecord[];
  reports: ReportRecord[];
  visitors: VisitorRecord[];
  announcements: AnnouncementRecord[];
  notifications: NotificationRecord[];
  counters: {
    reportSeq: number;
    visitorSeq: number;
    walkinSeq: number;
  };
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.resolve(DATA_DIR, 'db.json');

if (!DB_PATH.startsWith(DATA_DIR + path.sep)) {
  throw new Error('Invalid database path configuration.');
}

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
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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

function createInitialState(): DatabaseState {
  const today = formatDateISO();
  const yesterdayDate = new Date(Date.now() - 86400000);
  const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;

  return {
    users: [],
    reports: [
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
        reporterEmail: 'carlos.mendoza@carmela.ph',
        reported: 'Oct 21, 10:15 AM',
        reportedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        affected: 3,
        affectedBy: ['carlos.mendoza@carmela.ph'],
        urgent: true,
        waitDays: 0,
        desc: 'Rainwater pools up to ankle-deep near the corner drain whenever it rains heavily.',
        timeline: [
          { cls: 'pending', title: 'Pending', when: 'Oct 21, 10:15 AM', note: 'Report submitted', by: 'Carlos' },
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
        reporterEmail: 'maria.santos@carmela.ph',
        reported: 'Oct 20, 8:10 AM',
        reportedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        affected: 3,
        affectedBy: ['maria.santos@carmela.ph'],
        urgent: true,
        waitDays: 0,
        desc: 'Water has been brown since Monday morning. The tank may need cleaning.',
        timeline: [
          {
            cls: 'in_progress',
            title: 'In progress',
            when: 'Oct 20, 2:15 PM',
            note: 'Acknowledged by the HOA. Tank inspection scheduled.',
            by: 'HOA',
          },
          { cls: 'pending', title: 'Pending', when: 'Oct 20, 8:10 AM', note: 'Report submitted', by: 'Maria' },
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
        reporterEmail: 'juan.delacruz@carmela.ph',
        reported: 'Oct 7, 9:30 AM',
        reportedAt: new Date(Date.now() - 16 * 86400000).toISOString(),
        affected: 1,
        affectedBy: ['juan.delacruz@carmela.ph'],
        urgent: false,
        waitDays: 16,
        desc: 'Leak started a month after turnover. This should be covered by the developer’s warranty.',
        timeline: [
          {
            cls: 'in_progress',
            title: 'In progress',
            when: 'Oct 7, 3:30 PM',
            note: 'Forwarded to the developer. Waiting for a reply.',
            by: 'HOA',
          },
          { cls: 'pending', title: 'Pending', when: 'Oct 7, 9:30 AM', note: 'Report submitted', by: 'Juan' },
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
        reporterEmail: 'elena.cruz@carmela.ph',
        reported: 'Oct 12, 11:00 AM',
        reportedAt: new Date(Date.now() - 11 * 86400000).toISOString(),
        affected: 2,
        affectedBy: ['elena.cruz@carmela.ph'],
        urgent: false,
        waitDays: 11,
        desc: 'Damp spots and peeling paint appeared on the bedroom wall behind the shower.',
        timeline: [
          {
            cls: 'pending',
            title: 'Pending',
            when: 'Oct 12, 11:00 AM',
            note: 'Report submitted and queued for developer warranty check.',
            by: 'Elena',
          },
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
        reporterEmail: 'maria.santos@carmela.ph',
        reported: 'Oct 22, 7:20 AM',
        reportedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        affected: 2,
        affectedBy: ['maria.santos@carmela.ph'],
        urgent: false,
        waitDays: 0,
        desc: 'Three stray dogs enter through the side fence before garbage pickup.',
        timeline: [
          {
            cls: 'pending',
            title: 'Pending',
            when: 'Oct 22, 7:20 AM',
            note: 'Endorsed to barangay animal control.',
            by: 'HOA',
          },
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
        reporterEmail: 'ramon.villanueva@carmela.ph',
        reported: 'Oct 14, 7:45 PM',
        reportedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
        affected: 3,
        affectedBy: ['ramon.villanueva@carmela.ph'],
        urgent: false,
        waitDays: 0,
        desc: 'Corner lamp post flickered and went completely dark at night.',
        timeline: [
          {
            cls: 'resolved',
            title: 'Resolved',
            when: 'Oct 16, 4:00 PM',
            note: 'Bulb and ballast replaced by maintenance.',
            by: 'HOA',
          },
          { cls: 'pending', title: 'Pending', when: 'Oct 14, 7:45 PM', note: 'Report submitted', by: 'Ramon' },
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
        reporterEmail: 'ana.reyes@carmela.ph',
        reported: 'Oct 11, 12:35 AM',
        reportedAt: new Date(Date.now() - 12 * 86400000).toISOString(),
        affected: 1,
        affectedBy: ['ana.reyes@carmela.ph'],
        urgent: false,
        waitDays: 0,
        desc: 'Music volume remained high past subdivision quiet hours (10:00 PM).',
        timeline: [
          {
            cls: 'resolved',
            title: 'Resolved',
            when: 'Oct 11, 12:50 AM',
            note: 'Roving guard reminded household of quiet hours.',
            by: 'Guard',
          },
          { cls: 'pending', title: 'Pending', when: 'Oct 11, 12:35 AM', note: 'Report submitted', by: 'Ana' },
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
        reporterEmail: 'guard.tony@carmela.ph',
        reported: 'Oct 18, 2:10 PM',
        reportedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        affected: 3,
        affectedBy: ['guard.tony@carmela.ph'],
        urgent: false,
        waitDays: 0,
        desc: 'Deep pothole near the inbound lane slows tricycles and cars entering the gate.',
        timeline: [
          {
            cls: 'in_progress',
            title: 'In progress',
            when: 'Oct 19, 9:00 AM',
            note: 'Cold-mix asphalt patching scheduled this week.',
            by: 'HOA',
          },
          { cls: 'pending', title: 'Pending', when: 'Oct 18, 2:10 PM', note: 'Report submitted', by: 'Tony' },
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
        reporterEmail: 'maria.santos@carmela.ph',
        reported: 'Oct 3, 1:05 PM',
        reportedAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        affected: 3,
        affectedBy: ['maria.santos@carmela.ph'],
        urgent: false,
        waitDays: 20,
        desc: 'Phase 2 lines are still locked to a single ISP while residents wait on pole clearance.',
        timeline: [
          {
            cls: 'pending',
            title: 'Pending',
            when: 'Oct 3, 1:05 PM',
            note: 'Waiting for developer utility clearance.',
            by: 'HOA',
          },
        ],
      },
    ],
    visitors: [
      {
        id: 'g1',
        code: 'V-2041',
        name: 'Jose Ramirez',
        type: 'Guest',
        date: today,
        time: '15:00',
        plate: '',
        note: '',
        dest: 'Block 3, Lot 12',
        residentName: 'Maria Santos',
        residentEmail: 'maria.santos@carmela.ph',
        residentBlockLot: 'B3 L12',
        kind: 'reg',
        status: 'expected',
        idLeft: '',
        whenLabel: 'Today · 3:00 PM',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'g2',
        code: 'V-2043',
        name: 'Mang Ben',
        type: 'Tricycle / ride',
        date: today,
        time: '17:30',
        plate: 'TC 4821',
        note: '',
        dest: 'Block 1, Lot 20',
        residentName: 'Ana Reyes',
        residentEmail: 'ana.reyes@carmela.ph',
        residentBlockLot: 'B1 L20',
        kind: 'reg',
        status: 'expected',
        idLeft: '',
        whenLabel: 'Today · 5:30 PM',
        createdAt: new Date(Date.now() - 5400000).toISOString(),
      },
      {
        id: 'g3',
        code: 'V-2042',
        name: 'Mang Lando (plumber)',
        type: 'Contractor / service',
        date: today,
        time: '09:00',
        plate: '',
        note: 'Plumbing check',
        dest: 'Block 5, Lot 4',
        residentName: 'Juan Dela Cruz',
        residentEmail: 'juan.delacruz@carmela.ph',
        residentBlockLot: 'B5 L4',
        kind: 'reg',
        status: 'arrived',
        idLeft: 'National ID',
        checkedInAt: '9:12 AM',
        whenLabel: 'Oct 23, 9:12 AM',
        createdAt: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: 'g4',
        code: 'W-014',
        name: 'Walk-in: Mr. Aquino',
        type: 'Guest',
        date: today,
        time: '08:40',
        plate: '',
        note: '',
        dest: 'Block 1, Lot 20',
        residentName: 'Ana Reyes',
        residentEmail: 'ana.reyes@carmela.ph',
        residentBlockLot: 'B1 L20',
        kind: 'walk',
        status: 'left',
        idLeft: 'School / company ID',
        confirmedByPhone: true,
        checkedInAt: '8:40 AM',
        whenLabel: 'Oct 23, 8:40 AM',
        createdAt: new Date(Date.now() - 10800000).toISOString(),
      },
      {
        id: 'g5',
        code: 'V-2038',
        name: 'Tricycle · TC 7710',
        type: 'Tricycle / ride',
        date: today,
        time: '07:55',
        plate: 'TC 7710',
        note: '',
        dest: 'Block 3, Lot 12',
        residentName: 'Maria Santos',
        residentEmail: 'maria.santos@carmela.ph',
        residentBlockLot: 'B3 L12',
        kind: 'reg',
        status: 'left',
        idLeft: 'No ID left',
        checkedInAt: '7:55 AM',
        whenLabel: 'Oct 23, 7:55 AM',
        createdAt: new Date(Date.now() - 14400000).toISOString(),
      },
      {
        id: 'g6',
        code: 'V-2040',
        name: 'Lazada rider',
        type: 'Delivery',
        date: yesterday,
        time: '13:00',
        plate: '',
        note: '',
        dest: 'Block 3, Lot 12',
        residentName: 'Maria Santos',
        residentEmail: 'maria.santos@carmela.ph',
        residentBlockLot: 'B3 L12',
        kind: 'reg',
        status: 'left',
        idLeft: 'Driver’s license',
        checkedInAt: '1:00 PM',
        whenLabel: 'Oct 22, 1:00 PM',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'g7',
        code: 'W-013',
        name: 'Walk-in: delivery man',
        type: 'Delivery',
        date: yesterday,
        time: '10:20',
        plate: '',
        note: '',
        dest: 'Block 5, Lot 4',
        residentName: 'Juan Dela Cruz',
        residentEmail: 'juan.delacruz@carmela.ph',
        residentBlockLot: 'B5 L4',
        kind: 'walk',
        status: 'left',
        idLeft: 'No ID left',
        confirmedByPhone: true,
        checkedInAt: '10:20 AM',
        whenLabel: 'Oct 22, 10:20 AM',
        createdAt: new Date(Date.now() - 96400000).toISOString(),
      },
      {
        id: 'g8',
        code: 'V-2036',
        name: 'Relatives (2 people)',
        type: 'Guest',
        date: yesterday,
        time: '16:10',
        plate: '',
        note: '',
        dest: 'Block 1, Lot 20',
        residentName: 'Ana Reyes',
        residentEmail: 'ana.reyes@carmela.ph',
        residentBlockLot: 'B1 L20',
        kind: 'reg',
        status: 'left',
        idLeft: 'National ID',
        checkedInAt: '4:10 PM',
        whenLabel: 'Oct 21, 4:10 PM',
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ],
    announcements: [
      {
        id: 'ann-1',
        title: 'Water tank cleaning scheduled this Sunday',
        body: 'Water pressure may be low from 8:00 AM to 12:00 PM while the main elevated tank is flushed.',
        pinned: true,
        author: 'HOA',
        whenLabel: 'Oct 22 · Posted by HOA',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'ann-2',
        title: 'Pre-register holiday guests & deliveries',
        body: 'Please generate a gate code under Visitors before guests arrive to avoid queues at the main gate.',
        pinned: false,
        author: 'HOA',
        whenLabel: 'Oct 19 · Posted by HOA',
        createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      },
    ],
    notifications: [
      {
        id: 'n-admin-1',
        role: 'admin',
        icon: 'clipboard',
        text: 'New community report needs attention.',
        whenLabel: 'Today',
        unread: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'n-guard-1',
        role: 'guard',
        icon: 'bell',
        text: 'Visitor Jose Ramirez is expected at 3:00 PM (V-2041).',
        whenLabel: 'Today',
        unread: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'n-guard-2',
        role: 'guard',
        icon: 'bell',
        text: 'Reminder: log every tricycle and leave an ID.',
        whenLabel: 'This week',
        unread: false,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'n-res-1',
        role: 'resident',
        targetEmail: 'maria.santos@carmela.ph',
        icon: 'users',
        text: 'Visitor Jose Ramirez is expected at 3:00 PM (V-2041).',
        whenLabel: 'Today',
        unread: true,
        createdAt: new Date().toISOString(),
      },
    ],
    counters: {
      reportSeq: 1011,
      visitorSeq: 2044,
      walkinSeq: 15,
    },
  };
}

let cachedState: DatabaseState | null = null;

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadDb(): DatabaseState {
  if (cachedState) return cachedState;
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    const initial = createInitialState();
    saveDb(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as DatabaseState;
    cachedState = parsed;
    return parsed;
  } catch {
    const fallback = createInitialState();
    saveDb(fallback);
    return fallback;
  }
}

export function saveDb(state: DatabaseState): void {
  ensureDir();
  cachedState = state;
  const tmpPath = path.resolve(DATA_DIR, `db.${process.pid}.${Date.now()}.tmp`);
  if (!tmpPath.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Invalid temp file path.');
  }
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

export function addNotification(
  db: DatabaseState,
  notif: Omit<NotificationRecord, 'id' | 'unread' | 'createdAt'>,
): void {
  db.notifications.unshift({
    id: 'n-' + crypto.randomUUID(),
    ...notif,
    unread: true,
    createdAt: new Date().toISOString(),
  });
  if (db.notifications.length > 100) {
    db.notifications = db.notifications.slice(0, 100);
  }
}
