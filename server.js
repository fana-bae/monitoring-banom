'use strict';
const express = require('express');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.SESSION_SECRET || 'banom-monitoring-secret-2026-dev';

// ── Cloudinary config (v1) ──
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ── Multer + Cloudinary storage ──
const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'monitoring-banom', allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Database client (Turso / libSQL) ──
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:monitoring.db',
  authToken: process.env.TURSO_AUTH_TOKEN
});

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

// ── DB Helpers ──
async function queryAll(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return result.rows;
}
async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}
async function run(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return { lastId: Number(result.lastInsertRowid) };
}

// ── DB Init ──
let dbReady = false;
let dbInitPromise = null;

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      banom TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'belum',
      photo TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  const admin = await queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    await run('INSERT INTO users (username, password, name, role, banom) VALUES (?,?,?,?,?)',
      ['admin', hash, 'Administrator', 'admin', 'Pusat']);
    console.log('✅ Admin account created: admin / admin123');
  }
}

function ensureDb(req, res, next) {
  if (dbReady) return next();
  if (!dbInitPromise) dbInitPromise = initDb().then(() => { dbReady = true; });
  dbInitPromise.then(next).catch(err => res.status(500).json({ error: 'DB init failed: ' + err.message }));
}
app.use(ensureDb);

// ── Auth Middleware ──
function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    return res.status(401).json({ error: 'Sesi expired, silakan login kembali' });
  }
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
    next();
  });
}

// ══════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
    const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'Username tidak ditemukan' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Password salah' });

    const token = jwt.sign(
      { id: Number(user.id), role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });
    res.json({ id: Number(user.id), username: user.username, name: user.name, role: user.role, banom: user.banom });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const user = await queryOne('SELECT id, username, name, role, banom FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ ...user, id: Number(user.id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════
//  USER MANAGEMENT (Admin only)
// ══════════════════════════════════
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await queryAll('SELECT id, username, name, role, banom, created_at FROM users ORDER BY created_at DESC');
    res.json(users.map(u => ({ ...u, id: Number(u.id) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, name, role, banom } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: 'Data tidak lengkap' });
    const exists = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) return res.status(409).json({ error: 'Username sudah digunakan' });
    const hash = bcrypt.hashSync(password, 10);
    const result = await run('INSERT INTO users (username, password, name, role, banom) VALUES (?,?,?,?,?)',
      [username, hash, name, role || 'member', banom || '']);
    res.json({ id: result.lastId, username, name, role: role || 'member', banom: banom || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const { name, role, banom, password } = req.body;
    const userId = parseInt(req.params.id);
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await run('UPDATE users SET name=?, role=?, banom=?, password=? WHERE id=?', [name, role, banom || '', hash, userId]);
    } else {
      await run('UPDATE users SET name=?, role=?, banom=? WHERE id=?', [name, role, banom || '', userId]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.user.id) return res.status(400).json({ error: 'Tidak bisa hapus akun sendiri' });
    await run('DELETE FROM reports WHERE user_id = ?', [userId]);
    await run('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════
//  REPORTS
// ══════════════════════════════════
app.get('/api/reports', requireAuth, async (req, res) => {
  try {
    let reports;
    if (req.user.role === 'admin') {
      reports = await queryAll(`SELECT r.*, u.name as user_name, u.banom as user_banom 
        FROM reports r JOIN users u ON r.user_id = u.id ORDER BY r.updated_at DESC`);
    } else {
      reports = await queryAll(`SELECT r.*, u.name as user_name, u.banom as user_banom 
        FROM reports r JOIN users u ON r.user_id = u.id WHERE r.user_id = ? ORDER BY r.updated_at DESC`,
        [req.user.id]);
    }
    res.json(reports.map(r => ({ ...r, id: Number(r.id), user_id: Number(r.user_id) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reports', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { title, description, status } = req.body;
    if (!title) return res.status(400).json({ error: 'Judul laporan wajib diisi' });
    const photo = req.file ? req.file.path : '';
    const now = new Date().toISOString();
    const result = await run('INSERT INTO reports (user_id, title, description, status, photo, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [req.user.id, title, description || '', status || 'belum', photo, now, now]);
    const report = await queryOne(`SELECT r.*, u.name as user_name, u.banom as user_banom 
      FROM reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?`, [result.lastId]);
    res.json({ ...report, id: Number(report.id), user_id: Number(report.user_id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/reports/:id', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { title, description, status } = req.body;
    const reportId = parseInt(req.params.id);
    const existing = await queryOne('SELECT * FROM reports WHERE id = ?', [reportId]);
    if (!existing) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    if (req.user.role !== 'admin' && Number(existing.user_id) !== req.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }
    const photo = req.file ? req.file.path : existing.photo;
    const now = new Date().toISOString();
    await run("UPDATE reports SET title=?, description=?, status=?, photo=?, updated_at=? WHERE id=?",
      [title || existing.title, description !== undefined ? description : existing.description, status || existing.status, photo, now, reportId]);
    const report = await queryOne(`SELECT r.*, u.name as user_name, u.banom as user_banom 
      FROM reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?`, [reportId]);
    res.json({ ...report, id: Number(report.id), user_id: Number(report.user_id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/reports/:id', requireAuth, async (req, res) => {
  try {
    const report = await queryOne('SELECT * FROM reports WHERE id = ?', [parseInt(req.params.id)]);
    if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    if (req.user.role !== 'admin' && Number(report.user_id) !== req.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }
    if (report.photo) {
      try {
        const parts = report.photo.split('/');
        const file = parts[parts.length - 1].split('.')[0];
        const folder = parts[parts.length - 2];
        await cloudinary.uploader.destroy(`${folder}/${file}`);
      } catch { /* abaikan error cloudinary */ }
    }
    await run('DELETE FROM reports WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════
//  EXPORT EXCEL
// ══════════════════════════════════
app.get('/api/export/excel', requireAdmin, async (req, res) => {
  try {
    const reports = await queryAll(`
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
    
    // Helper to format date string to WIB for Excel
    const formatWIB = (dStr) => {
      if (!dStr) return '-';
      try {
        // If string is YYYY-MM-DD HH:MM:SS (SQLite format), convert to ISO
        const iso = (dStr.includes(' ') && !dStr.includes('T')) ? dStr.replace(' ', 'T') + 'Z' : dStr;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return dStr;
        return d.toLocaleString('id-ID', { 
          timeZone: 'Asia/Jakarta',
          day: '2-digit', 
          month: '2-digit', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }).replace(/\//g, '-');
      } catch { return dStr; }
    };

    reports.forEach((r, i) => {
      sheet.addRow({ 
        ...r, 
        no: i + 1, 
        status: statusMap[r.status] || r.status,
        created_at: formatWIB(r.created_at),
        updated_at: formatWIB(r.updated_at)
      });
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Stats ──
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const total = Number((await queryOne('SELECT COUNT(*) as c FROM reports')).c);
      const belum = Number((await queryOne("SELECT COUNT(*) as c FROM reports WHERE status='belum'")).c);
      const proses = Number((await queryOne("SELECT COUNT(*) as c FROM reports WHERE status='proses'")).c);
      const selesai = Number((await queryOne("SELECT COUNT(*) as c FROM reports WHERE status='selesai'")).c);
      const members = Number((await queryOne("SELECT COUNT(*) as c FROM users WHERE role='member'")).c);
      res.json({ total, belum, proses, selesai, members });
    } else {
      const uid = req.user.id;
      const total = Number((await queryOne('SELECT COUNT(*) as c FROM reports WHERE user_id=?', [uid])).c);
      const belum = Number((await queryOne("SELECT COUNT(*) as c FROM reports WHERE user_id=? AND status='belum'", [uid])).c);
      const proses = Number((await queryOne("SELECT COUNT(*) as c FROM reports WHERE user_id=? AND status='proses'", [uid])).c);
      const selesai = Number((await queryOne("SELECT COUNT(*) as c FROM reports WHERE user_id=? AND status='selesai'", [uid])).c);
      res.json({ total, belum, proses, selesai, members: 0 });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Start (local) / Export (Vercel) ──
if (process.env.NODE_ENV !== 'production') {
  initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Monitoring Banom berjalan di http://localhost:${PORT}`);
      console.log(`📋 Login Admin: admin / admin123\n`);
    });
  }).catch(console.error);
}

module.exports = app;
