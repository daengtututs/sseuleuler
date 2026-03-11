# Shopee Seller Manager

Aplikasi manajemen toko Shopee berbasis web. Frontend di Cloudflare Pages, backend proxy + webhook receiver di Cloudflare Workers.

---

## Arsitektur

```
Browser (Cloudflare Pages)
        |
        | Pull (fetch produk, pesanan)
        v
Cloudflare Workers  <── Shopee Push Webhook (real-time)
  /proxy/*  → forward ke Shopee API
  /webhook  → terima push dari Shopee, simpan di KV
  /events   → frontend poll tiap 8 detik
        |
        v
  Shopee Open API
```

---

## Deploy: Cloudflare Workers (Backend)

### 1. Install Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 2. Buat KV Namespace
```bash
cd worker
wrangler kv:namespace create SHOPEE_KV
```
Salin ID yang muncul dan ganti `YOUR_KV_NAMESPACE_ID` di `wrangler.toml`.

### 3. Set Secrets (jangan di-commit ke Git)
```bash
wrangler secret put PARTNER_KEY
wrangler secret put PUSH_PARTNER_KEY
```

### 4. Set PARTNER_ID di wrangler.toml
```toml
[vars]
PARTNER_ID = "isi_partner_id_kamu"
```

### 5. Deploy Worker
```bash
wrangler deploy
```
Catat URL Worker: `https://shopee-seller-worker.nama.workers.dev`

### 6. Set Callback URL di Shopee Open Platform
- Masuk ke Shopee Open Platform
- Pilih App kamu
- Set Live Push Callback URL: `https://shopee-seller-worker.nama.workers.dev/webhook`

---

## Deploy: Cloudflare Pages (Frontend)

### 1. Push ke GitHub
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/username/shopee-seller.git
git push -u origin main
```

### 2. Buat Pages Project
- Buka dash.cloudflare.com
- Pilih Workers & Pages > Create application > Pages
- Connect to Git > pilih repo ini
- Build settings:
  - Framework preset: **Vite**
  - Build command: `npm run build`
  - Build output directory: `dist`
- Klik Save and Deploy

### 3. Akses App
App bisa diakses di: `https://shopee-seller.pages.dev`

---

## Login di App

Saat buka app, isi form:
- **Worker URL**: `https://shopee-seller-worker.nama.workers.dev`
- **Shop ID**: Shop ID toko Shopee kamu
- **Access Token**: Access Token dari OAuth Shopee

Partner Key dan Push Partner Key **tidak perlu diisi di frontend** — sudah aman tersimpan di Worker sebagai secret.

---

## Struktur Project

```
shopee-seller/
├── src/
│   ├── main.jsx          # React entry point
│   └── App.jsx           # Aplikasi utama
├── worker/
│   ├── shopee-worker.js  # Cloudflare Worker
│   └── wrangler.toml     # Konfigurasi Worker
├── public/
│   └── favicon.svg
├── index.html
├── vite.config.js
└── package.json
```

---

## Fitur

- Dashboard: statistik, grafik penjualan, peringatan stok
- Produk: kelola stok, edit detail produk, pencarian
- Pesanan: filter status, update status pesanan
- Laporan: grafik tren pendapatan, distribusi kategori
- Pengaturan: Live Push Settings, notifikasi, sinkronisasi
- Real-time: update otomatis via Shopee webhook (poll tiap 8 detik)
