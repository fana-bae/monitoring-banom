'use strict';
const App = (() => {
  let currentUser = null;
  let reports = [];
  let currentPage = 'dashboard';

  // ── Helpers ──
  const $ = id => document.getElementById(id);
  const api = async (url, opts = {}) => {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
    return data;
  };

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    $('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function statusBadge(s) {
    const m = { belum: ['🔴', 'Belum Berjalan'], proses: ['🟡', 'Sedang Berjalan'], selesai: ['🟢', 'Sudah Selesai'] };
    const [icon, label] = m[s] || ['⚪', s];
    return `<span class="badge badge-${s}">${icon} ${label}</span>`;
  }

  function formatDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ── Auth ──
  async function checkSession() {
    try {
      currentUser = await api('/api/me');
      showApp();
    } catch { showLogin(); }
  }

  async function login(e) {
    e.preventDefault();
    const btn = $('login-btn');
    btn.disabled = true; btn.textContent = 'Memuat...';
    try {
      currentUser = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: $('login-user').value.trim(), password: $('login-pass').value })
      });
      toast(`Selamat datang, ${currentUser.name}!`, 'success');
      showApp();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Masuk';
    }
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    showLogin();
    toast('Berhasil keluar', 'info');
  }

  function showLogin() {
    $('view-login').classList.remove('hidden');
    $('view-app').classList.add('hidden');
    $('login-user').value = ''; $('login-pass').value = '';
  }

  function showApp() {
    $('view-login').classList.add('hidden');
    $('view-app').classList.remove('hidden');
    $('user-avatar').textContent = currentUser.name.charAt(0).toUpperCase();
    $('user-name').textContent = currentUser.name;
    $('user-role').textContent = currentUser.role === 'admin' ? 'Administrator' : `Member — ${currentUser.banom || ''}`;

    if (currentUser.role === 'admin') {
      $('nav-users').classList.remove('hidden');
      $('admin-export-btn').classList.remove('hidden');
    } else {
      $('nav-users').classList.add('hidden');
      $('admin-export-btn').classList.add('hidden');
    }
    navigate('dashboard');
  }

  // ── Navigation ──
  function navigate(page) {
    currentPage = page;
    document.querySelectorAll('[id^="page-"]').forEach(p => p.classList.add('hidden'));
    $(`page-${page}`).classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.page === page);
    });
    if (page === 'dashboard') loadDashboard();
    else if (page === 'reports') loadReports();
    else if (page === 'users') loadUsers();
    // Close mobile sidebar
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('open');
  }

  function toggleSidebar() {
    $('sidebar').classList.toggle('open');
    $('sidebar-overlay').classList.toggle('open');
  }

  // ── Dashboard ──
  async function loadDashboard() {
    try {
      const stats = await api('/api/stats');
      let cards = `
        <div class="stat-card blue"><div class="stat-icon">📊</div><div class="stat-value">${stats.total}</div><div class="stat-label">Total Laporan</div></div>
        <div class="stat-card red"><div class="stat-icon">🔴</div><div class="stat-value">${stats.belum}</div><div class="stat-label">Belum Berjalan</div></div>
        <div class="stat-card yellow"><div class="stat-icon">🟡</div><div class="stat-value">${stats.proses}</div><div class="stat-label">Sedang Berjalan</div></div>
        <div class="stat-card green"><div class="stat-icon">🟢</div><div class="stat-value">${stats.selesai}</div><div class="stat-label">Sudah Selesai</div></div>
      `;
      if (currentUser.role === 'admin') {
        cards += `<div class="stat-card purple"><div class="stat-icon">👥</div><div class="stat-value">${stats.members}</div><div class="stat-label">Total Member</div></div>`;
      }
      $('stats-grid').innerHTML = cards;

      reports = await api('/api/reports');
      const recent = reports.slice(0, 5);
      if (recent.length === 0) {
        $('recent-reports').innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><h3>Belum ada laporan</h3><p>Mulai buat laporan program kerja pertama Anda</p></div>`;
      } else {
        $('recent-reports').innerHTML = `<div class="reports-list">${recent.map(renderReportCard).join('')}</div>`;
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── Reports ──
  async function loadReports() {
    try {
      reports = await api('/api/reports');
      renderReportsList(reports);
    } catch (err) { toast(err.message, 'error'); }
  }

  function renderReportCard(r) {
    return `
      <div class="report-card" onclick="App.viewReport(${r.id})">
        <div class="report-header">
          <div class="report-title">${esc(r.title)}</div>
          ${statusBadge(r.status)}
        </div>
        <div class="report-meta">
          <span>👤 ${esc(r.user_name)}${r.user_banom ? ' — ' + esc(r.user_banom) : ''}</span>
          <span>🕐 ${formatDate(r.created_at)}</span>
        </div>
        ${r.description ? `<div class="report-desc">${esc(r.description).substring(0, 120)}${r.description.length > 120 ? '...' : ''}</div>` : ''}
        ${r.photo ? '<div class="report-photo-indicator">📷 Ada foto bukti</div>' : ''}
      </div>`;
  }

  function renderReportsList(list) {
    if (list.length === 0) {
      $('reports-list').innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><h3>Tidak ada laporan</h3><p>Belum ada laporan yang sesuai filter</p></div>`;
      return;
    }
    $('reports-list').innerHTML = list.map(renderReportCard).join('');
  }

  function filterReports() {
    const q = $('filter-search').value.toLowerCase();
    const s = $('filter-status').value;
    const filtered = reports.filter(r => {
      const matchQ = !q || r.title.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q) || r.user_name.toLowerCase().includes(q);
      const matchS = !s || r.status === s;
      return matchQ && matchS;
    });
    renderReportsList(filtered);
  }

  // ── Report CRUD ──
  function openReportModal(report) {
    $('report-edit-id').value = report ? report.id : '';
    $('report-title').value = report ? report.title : '';
    $('report-desc').value = report ? report.description || '' : '';
    $('report-status').value = report ? report.status : 'belum';
    $('report-photo').value = '';
    $('photo-preview').classList.add('hidden');
    $('modal-report-title').textContent = report ? 'Edit Laporan' : 'Buat Laporan Baru';
    if (report && report.photo) {
      $('photo-preview').src = report.photo;
      $('photo-preview').classList.remove('hidden');
    }
    openModal('modal-report');
  }

  function previewPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('photo-preview').src = ev.target.result;
      $('photo-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }

  async function saveReport() {
    const title = $('report-title').value.trim();
    if (!title) return toast('Judul wajib diisi!', 'error');

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', $('report-desc').value.trim());
    formData.append('status', $('report-status').value);
    const photoFile = $('report-photo').files[0];
    if (photoFile) formData.append('photo', photoFile);

    const editId = $('report-edit-id').value;
    try {
      if (editId) {
        await fetch(`/api/reports/${editId}`, { method: 'PUT', body: formData });
        toast('Laporan berhasil diperbarui!', 'success');
      } else {
        await fetch('/api/reports', { method: 'POST', body: formData });
        toast('Laporan berhasil dibuat!', 'success');
      }
      closeModal('modal-report');
      if (currentPage === 'dashboard') loadDashboard();
      else loadReports();
    } catch (err) { toast(err.message, 'error'); }
  }

  function viewReport(id) {
    const r = reports.find(x => x.id === id);
    if (!r) return;

    let html = '';
    if (r.photo) {
      html += `<img src="${r.photo}" class="detail-photo mb-16" onclick="App.openLightbox('${r.photo}')" alt="Foto Bukti">`;
    }
    html += `
      <dl class="detail-info">
        <dt>Judul</dt><dd><strong>${esc(r.title)}</strong></dd>
        <dt>Status</dt><dd>${statusBadge(r.status)}</dd>
        <dt>Pelapor</dt><dd>👤 ${esc(r.user_name)}${r.user_banom ? ' — ' + esc(r.user_banom) : ''}</dd>
        <dt>Dibuat</dt><dd>${formatDate(r.created_at)}</dd>
        <dt>Diperbarui</dt><dd>${formatDate(r.updated_at)}</dd>
        ${r.description ? `<dt>Deskripsi</dt><dd>${esc(r.description)}</dd>` : ''}
      </dl>`;
    $('detail-body').innerHTML = html;

    let footer = '';
    const canEdit = currentUser.role === 'admin' || r.user_id === currentUser.id;
    if (canEdit) {
      footer = `
        <button class="btn btn-ghost btn-sm" onclick="App.closeModal('modal-detail'); App.editReport(${r.id})">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="App.deleteReport(${r.id})">🗑 Hapus</button>`;
    }
    $('detail-footer').innerHTML = footer;
    openModal('modal-detail');
  }

  function editReport(id) {
    const r = reports.find(x => x.id === id);
    if (r) openReportModal(r);
  }

  async function deleteReport(id) {
    if (!confirm('Yakin hapus laporan ini?')) return;
    try {
      await api(`/api/reports/${id}`, { method: 'DELETE' });
      toast('Laporan dihapus!', 'success');
      closeModal('modal-detail');
      if (currentPage === 'dashboard') loadDashboard();
      else loadReports();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── Users (Admin) ──
  async function loadUsers() {
    try {
      const users = await api('/api/users');
      $('users-tbody').innerHTML = users.map(u => `
        <tr>
          <td><strong>${esc(u.name)}</strong></td>
          <td>${esc(u.username)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-proses' : 'badge-selesai'}">${u.role === 'admin' ? '🛡️ Admin' : '👤 Member'}</span></td>
          <td>${esc(u.banom || '-')}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-ghost btn-sm" onclick='App.editUser(${JSON.stringify(u)})'>✏️</button>
              <button class="btn btn-danger btn-sm" onclick="App.deleteUser(${u.id})">🗑</button>
            </div>
          </td>
        </tr>`).join('');
    } catch (err) { toast(err.message, 'error'); }
  }

  function openUserModal(user) {
    $('user-edit-id').value = user ? user.id : '';
    $('user-name-input').value = user ? user.name : '';
    $('user-username-input').value = user ? user.username : '';
    $('user-pass-input').value = '';
    $('user-role-input').value = user ? user.role : 'member';
    $('user-banom-input').value = user ? user.banom || '' : '';
    $('modal-user-title').textContent = user ? 'Edit User' : 'Tambah User Baru';
    $('user-pass-label').textContent = user ? 'Password (kosongkan jika tidak diubah)' : 'Password *';
    $('user-username-input').disabled = !!user;
    openModal('modal-user');
  }

  function editUser(u) { openUserModal(u); }

  async function saveUser() {
    const name = $('user-name-input').value.trim();
    const username = $('user-username-input').value.trim();
    const password = $('user-pass-input').value;
    const role = $('user-role-input').value;
    const banom = $('user-banom-input').value.trim();
    const editId = $('user-edit-id').value;

    if (!name || !username) return toast('Nama dan username wajib diisi!', 'error');
    if (!editId && !password) return toast('Password wajib diisi!', 'error');

    try {
      if (editId) {
        await api(`/api/users/${editId}`, { method: 'PUT', body: JSON.stringify({ name, role, banom, password: password || undefined }) });
        toast('User berhasil diperbarui!', 'success');
      } else {
        await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password, name, role, banom }) });
        toast('User berhasil ditambahkan!', 'success');
      }
      closeModal('modal-user');
      loadUsers();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deleteUser(id) {
    if (!confirm('Yakin hapus user ini? Semua laporan user juga akan dihapus!')) return;
    try {
      await api(`/api/users/${id}`, { method: 'DELETE' });
      toast('User dihapus!', 'success');
      loadUsers();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── Export ──
  function exportExcel() {
    window.location.href = '/api/export/excel';
  }

  // ── Modal ──
  function openModal(id) { $(id).classList.add('active'); }
  function closeModal(id) { $(id).classList.remove('active'); }

  // ── Lightbox ──
  function openLightbox(src) { $('lightbox-img').src = src; $('lightbox').classList.add('active'); }

  // ── Escape HTML ──
  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Init ──
  checkSession();

  return {
    login, logout, navigate, toggleSidebar,
    openReportModal, previewPhoto, saveReport, viewReport, editReport, deleteReport,
    filterReports, openUserModal, editUser, saveUser, deleteUser,
    exportExcel, openLightbox, closeModal
  };
})();
