'use strict';
const express    = require('express');
const initSqlJs  = require('sql.js');
const bcrypt     = require('bcryptjs');
const session    = require('express-session');
const multer     = require('multer');
const ExcelJS    = require('exceljs');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure uploads dir ──
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const DB_PATH = path.join(__dirname, 'monitoring.db');

// ── Multer config ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'banom-monitoring-secret-2026-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Database (sql.js) ──
let db;

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return { lastId: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0 };
}

async function initDb() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      banom TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'belum',
      photo TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Seed admin
  const admin = queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    run('INSERT INTO users (username, password, name, role, banom) VALUES (?,?,?,?,?)',
      ['admin', hash, 'Administrator', 'admin', 'Pusat']);
    console.log('✅ Admin account created: admin / admin123');
  }
  saveDb();
}

// ── Auth middleware ──
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
  next();
}

// ══════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
  
  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: 'Username tidak ditemukan' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Password salah' });
  
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, banom: user.banom });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = queryOne('SELECT id, username, name, role, banom FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

// ══════════════════════════════════
//  USER MANAGEMENT (Admin only)
// ══════════════════════════════════
app.get('/api/users', requireAdmin, (req, res) => {
  const users = queryAll('SELECT id, username, name, role, banom, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, name, role, banom } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Data tidak lengkap' });
  
  const exists = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(409).json({ error: 'Username sudah digunakan' });
  
  const hash = bcrypt.hashSync(password, 10);
  const result = run('INSERT INTO users (username, password, name, role, banom) VALUES (?,?,?,?,?)',
    [username, hash, name, role || 'member', banom || '']);
  
  res.json({ id: result.lastId, username, name, role: role || 'member', banom: banom || '' });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const { name, role, banom, password } = req.body;
  const userId = parseInt(req.params.id);
  
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    run('UPDATE users SET name=?, role=?, banom=?, password=? WHERE id=?', [name, role, banom || '', hash, userId]);
  } else {
    run('UPDATE users SET name=?, role=?, banom=? WHERE id=?', [name, role, banom || '', userId]);
  }
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.session.userId) return res.status(400).json({ error: 'Tidak bisa hapus akun sendiri' });
  run('DELETE FROM reports WHERE user_id = ?', [userId]);
  run('DELETE FROM users WHERE id = ?', [userId]);
  res.json({ ok: true });
});

// ══════════════════════════════════
//  REPORTS
// ══════════════════════════════════
app.get('/api/reports', requireAuth, (req, res) => {
  let reports;
  if (req.session.role === 'admin') {
    reports = queryAll(`SELECT r.*, u.name as user_name, u.banom as user_banom 
      FROM reports r JOIN users u ON r.user_id = u.id ORDER BY r.updated_at DESC`);
  } else {
    reports = queryAll(`SELECT r.*, u.name as user_name, u.banom as user_banom 
      FROM reports r JOIN users u ON r.user_id = u.id WHERE r.user_id = ? ORDER BY r.updated_at DESC`,
      [req.session.userId]);
  }
  res.json(reports);
});

app.post('/api/reports', requireAuth, upload.single('photo'), (req, res) => {
  const { title, description, status } = req.body;
  if (!title) return res.status(400).json({ error: 'Judul laporan wajib diisi' });
  
  const photo = req.file ? '/uploads/' + req.file.filename : '';
  const result = run('INSERT INTO reports (user_id, title, description, status, photo) VALUES (?,?,?,?,?)',
    [req.session.userId, title, description || '', status || 'belum', photo]);
  
  const report = queryOne(`SELECT r.*, u.name as user_name, u.banom as user_banom 
    FROM reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?`, [result.lastId]);
  res.json(report);
});

app.put('/api/reports/:id', requireAuth, upload.single('photo'), (req, res) => {
  const { title, description, status } = req.body;
  const reportId = parseInt(req.params.id);
  
  const existing = queryOne('SELECT * FROM reports WHERE id = ?', [reportId]);
  if (!existing) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  if (req.session.role !== 'admin' && existing.user_id !== req.session.userId) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }
  
  const photo = req.file ? '/uploads/' + req.file.filename : existing.photo;
  run("UPDATE reports SET title=?, description=?, status=?, photo=?, updated_at=datetime('now','localtime') WHERE id=?",
    [title || existing.title, description !== undefined ? description : existing.description, status || existing.status, photo, reportId]);
  
  const report = queryOne(`SELECT r.*, u.name as user_name, u.banom as user_banom 
    FROM reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?`, [reportId]);
  res.json(report);
});

app.delete('/api/reports/:id', requireAuth, (req, res) => {
  const report = queryOne('SELECT * FROM reports WHERE id = ?', [parseInt(req.params.id)]);
  if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  if (req.session.role !== 'admin' && report.user_id !== req.session.userId) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }
  if (report.photo) {
    const filePath = path.join(__dirname, report.photo);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  run('DELETE FROM reports WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

// ══════════════════════════════════
//  EXPORT EXCEL
// ══════════════════════════════════
app.get('/api/export/excel', requireAdmin, async (req, res) => {
  const reports = queryAll(`
    SELECT r.title, r.description, r.status, r.created_at, r.updated_at, u.name as user_name, u.banom
    FROM reports r JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC
  `);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Laporan Program Kerja');
  
  sheet.columns = [
    { header: 'No', key: 'no', width: 5 },
    { header: 'Nama Pelapor', key: 'user_name', width: 22 },
    { header: 'Banom', key: 'banom', width: 18 },
    { header: 'Judul Program', key: 'title', width: 30 },
    { header: 'Deskripsi', key: 'description', width: 40 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Tanggal Dibuat', key: 'created_at', width: 20 },
    { header: 'Terakhir Update', key: 'updated_at', width: 20 },
  ];

  const statusMap = { belum: 'Belum Berjalan', proses: 'Sedang Berjalan', selesai: 'Sudah Selesai' };
  reports.forEach((r, i) => {
    sheet.addRow({ ...r, no: i + 1, status: statusMap[r.status] || r.status });
  });

  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  sheet.getRow(1).height = 28;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=laporan-proker-banom.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

// ── Stats ──
app.get('/api/stats', requireAuth, (req, res) => {
  if (req.session.role === 'admin') {
    const total = queryOne('SELECT COUNT(*) as c FROM reports').c;
    const belum = queryOne("SELECT COUNT(*) as c FROM reports WHERE status='belum'").c;
    const proses = queryOne("SELECT COUNT(*) as c FROM reports WHERE status='proses'").c;
    const selesai = queryOne("SELECT COUNT(*) as c FROM reports WHERE status='selesai'").c;
    const members = queryOne("SELECT COUNT(*) as c FROM users WHERE role='member'").c;
    res.json({ total, belum, proses, selesai, members });
  } else {
    const uid = req.session.userId;
    const total = queryOne('SELECT COUNT(*) as c FROM reports WHERE user_id=?', [uid]).c;
    const belum = queryOne("SELECT COUNT(*) as c FROM reports WHERE user_id=? AND status='belum'", [uid]).c;
    const proses = queryOne("SELECT COUNT(*) as c FROM reports WHERE user_id=? AND status='proses'", [uid]).c;
    const selesai = queryOne("SELECT COUNT(*) as c FROM reports WHERE user_id=? AND status='selesai'", [uid]).c;
    res.json({ total, belum, proses, selesai, members: 0 });
  }
});

// ── Start ──
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Monitoring Banom berjalan di http://localhost:${PORT}`);
    console.log(`📋 Login Admin: admin / admin123\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
