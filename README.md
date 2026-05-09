# 🏢 Monitoring Banom — Panduan Deploy ke Vercel

## Stack
- **Hosting**: [Vercel](https://vercel.com) (gratis)
- **Database**: [Turso](https://turso.tech) (SQLite cloud, gratis)
- **Storage Foto**: [Cloudinary](https://cloudinary.com) (gratis 25GB/bulan)

---

## Langkah 1 — Daftar & Setup Turso (Database)

1. Buka [turso.tech](https://turso.tech) → **Sign Up with GitHub**
2. Install Turso CLI (skip jika pakai dashboard web):
   ```
   winget install ChiselStrike.turso
   ```
3. Buat database baru di dashboard **atau** via CLI:
   ```
   turso db create monitoring-banom
   ```
4. Ambil credentials:
   - **Database URL**: `turso db show monitoring-banom --url`
   - **Auth Token**: `turso db tokens create monitoring-banom`
5. Simpan kedua nilai ini, akan dipakai di Vercel nanti.

---

## Langkah 2 — Daftar & Setup Cloudinary (Foto)

1. Buka [cloudinary.com](https://cloudinary.com) → **Sign Up** (gratis)
2. Setelah login, buka **Dashboard**
3. Catat 3 nilai ini:
   - `Cloud Name`
   - `API Key`
   - `API Secret`

---

## Langkah 3 — Push ke GitHub

```bash
git add .
git commit -m "feat: ready for Vercel deployment"
git push
```

> Pastikan `.env` **tidak ikut** ke GitHub (sudah ada di `.gitignore`).

---

## Langkah 4 — Deploy ke Vercel

1. Buka [vercel.com](https://vercel.com) → **Sign Up with GitHub**
2. Klik **New Project** → Import repo GitHub kamu
3. Pilih folder **`monitoring`** sebagai root directory (jika repo berisi folder lain)
4. Sebelum klik Deploy, buka tab **Environment Variables** dan isi:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | string random panjang (contoh: `k8j2mN9xP3qR7sT1uV5wY6zA4bC0dE`) |
| `TURSO_DATABASE_URL` | `libsql://nama-db-username.turso.io` |
| `TURSO_AUTH_TOKEN` | token dari langkah 1 |
| `CLOUDINARY_CLOUD_NAME` | dari langkah 2 |
| `CLOUDINARY_API_KEY` | dari langkah 2 |
| `CLOUDINARY_API_SECRET` | dari langkah 2 |

5. Klik **Deploy** 🚀

---

## Login Default

Setelah deploy, buka URL Vercel dan login dengan:
- **Username**: `admin`
- **Password**: `admin123`

> ⚠️ **Segera ganti password admin** setelah pertama kali login!

---

## Development Lokal

Untuk jalankan di lokal, buat file `.env` dari template:

```bash
copy .env.example .env
```

Isi `.env` dengan credentials Turso & Cloudinary kamu, lalu:

```bash
npm run dev
```

Buka `http://localhost:3000`

---

## Troubleshooting

| Error | Solusi |
|---|---|
| `TURSO_DATABASE_URL not set` | Pastikan env var sudah diisi di Vercel |
| `Cloudinary upload failed` | Cek CLOUDINARY_CLOUD_NAME, API_KEY, API_SECRET |
| Login berhasil tapi langsung logout | Pastikan SESSION_SECRET sudah diisi |
| Cold start lambat (~2-3 detik) | Normal untuk Vercel free tier |
