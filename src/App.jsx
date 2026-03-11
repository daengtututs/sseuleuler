import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

function createWorkerClient(workerUrl, accessToken, shopId) {
  const headers = {
    "Content-Type": "application/json",
    "X-Access-Token": accessToken,
    "X-Shop-Id": String(shopId),
  };
  const get = async (path, params = {}) => {
    const url = new URL(`${workerUrl}/proxy${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { headers });
    return res.json();
  };
  const post = async (path, body = {}) => {
    const res = await fetch(`${workerUrl}/proxy${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    return res.json();
  };
  const pollEvents = async (since) => {
    const url = new URL(`${workerUrl}/events`);
    if (since) url.searchParams.set("since", since);
    const res = await fetch(url.toString());
    return res.json();
  };
  return { get, post, pollEvents };
}

function useShopeeData(client) {
  const [products, setProducts] = useState(PRODUCTS_INIT);
  const [orders, setOrders] = useState(ORDERS_INIT);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const sinceRef = useRef(null);
  const pollRef = useRef(null);

  const fetchProducts = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const data = await client.get("/api/v2/product/get_item_list", { offset: 0, page_size: 50, item_status: "NORMAL" });
      if (data?.response?.item) {
        const details = await Promise.all(
          data.response.item.slice(0, 20).map((item) =>
            client.get("/api/v2/product/get_item_base_info", { item_id_list: item.item_id })
          )
        );
        const mapped = details.filter((d) => d?.response?.item_list?.[0]).map((d) => {
          const i = d.response.item_list[0];
          return { id: i.item_id, name: i.item_name, sku: i.item_sku || "-", price: i.price_info?.[0]?.current_price || 0, stock: i.stock_info_v2?.summary_info?.total_reserved_stock || 0, sold: i.sold || 0, category: String(i.category_id), image: "📦", status: i.item_status === "NORMAL" ? "active" : "inactive" };
        });
        if (mapped.length > 0) setProducts(mapped);
      }
    } catch {}
    setLoading(false);
    setLastSync(new Date());
  }, [client]);

  const fetchOrders = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const data = await client.get("/api/v2/order/get_order_list", { time_range_field: "create_time", time_from: now - 30 * 86400, time_to: now, page_size: 20, order_status: "ALL" });
      if (data?.response?.order_list) {
        const sns = data.response.order_list.map((o) => o.order_sn).join(",");
        const detail = await client.get("/api/v2/order/get_order_detail", { order_sn_list: sns, response_optional_fields: "buyer_username,item_list,recipient_address" });
        if (detail?.response?.order_list) {
          const mapped = detail.response.order_list.map((o) => ({
            id: o.order_sn, buyer: o.buyer_username || "-",
            items: o.item_list?.map((i) => `${i.item_name} x${i.model_quantity_purchased}`).join(", ") || "-",
            total: o.total_amount || 0,
            status: o.order_status?.toLowerCase() === "ready_to_ship" ? "processing" : o.order_status?.toLowerCase() === "shipped" ? "shipped" : o.order_status?.toLowerCase() === "completed" ? "delivered" : o.order_status?.toLowerCase() === "cancelled" ? "cancelled" : "pending",
            date: new Date(o.create_time * 1000).toISOString().split("T")[0],
            address: o.recipient_address ? `${o.recipient_address.full_address}, ${o.recipient_address.city}` : "-",
          }));
          if (mapped.length > 0) setOrders(mapped);
        }
      }
    } catch {}
    setLoading(false);
    setLastSync(new Date());
  }, [client]);

  const applyPushEvent = useCallback((event) => {
    setLiveEvents((prev) => [event, ...prev].slice(0, 50));
    if (event.code === 3) setOrders((prev) => prev.map((o) => o.id === event.data?.ordersn ? { ...o, status: event.data?.status?.toLowerCase() || o.status } : o));
    if (event.code === 8) setProducts((prev) => prev.map((p) => p.id === event.data?.item_id ? { ...p, stock: event.data?.current_reserved_stock ?? p.stock } : p));
    if (event.code === 22) setProducts((prev) => prev.map((p) => p.id === event.data?.item_id ? { ...p, price: event.data?.price ?? p.price } : p));
  }, []);

  useEffect(() => {
    if (!client) return;
    fetchProducts();
    fetchOrders();
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const poll = async () => {
      try {
        const data = await client.pollEvents(sinceRef.current);
        if (data?.events?.length > 0) { data.events.forEach(applyPushEvent); sinceRef.current = Date.now(); }
      } catch {}
    };
    pollRef.current = setInterval(poll, 8000);
    return () => clearInterval(pollRef.current);
  }, [client, applyPushEvent]);

  return { products, setProducts, orders, setOrders, loading, lastSync, liveEvents, fetchProducts, fetchOrders };
}

const S = {
  primary: "#EE4D2D",
  primaryDark: "#C73E22",
  primaryLight: "#FFF3F0",
  primaryBorder: "#F8C4BA",
  bg: "#F5F5F5",
  white: "#FFFFFF",
  text: "#333333",
  textMuted: "#999999",
  textLight: "#666666",
  border: "#E8E8E8",
  green: "#00A650",
  greenBg: "#E6F7EE",
  yellow: "#F6A609",
  yellowBg: "#FEF6E6",
  red: "#D0011B",
  redBg: "#FDECEA",
  blue: "#1472CC",
  blueBg: "#E8F1FB",
  shadow: "0 1px 4px rgba(0,0,0,0.10)",
};

const fmtPrice = (n) => "Rp " + Number(n).toLocaleString("id-ID");
const fmtDate = (d) => new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

const badge = (color) => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  background: color === "green" ? "#E6F7EE" : color === "yellow" ? "#FEF6E6" : color === "red" ? "#FDECEA" : color === "blue" ? "#E8F1FB" : "#F5F5F5",
  color: color === "green" ? "#00A650" : color === "yellow" ? "#F6A609" : color === "red" ? "#D0011B" : color === "blue" ? "#1472CC" : "#999",
});

const btn = (v = "primary") => ({
  background: v === "primary" ? "#EE4D2D" : v === "outline" ? "#FFF" : "transparent",
  color: v === "primary" ? "#FFF" : v === "outline" ? "#EE4D2D" : "#333",
  border: v === "outline" ? "1px solid #EE4D2D" : "1px solid transparent",
  borderRadius: 4,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
});

const btnSm = (v = "primary") => ({
  background: v === "primary" ? "#EE4D2D" : v === "outline" ? "#FFF" : "transparent",
  color: v === "primary" ? "#FFF" : v === "outline" ? "#EE4D2D" : "#666",
  border: v === "outline" ? "1px solid #EE4D2D" : "1px solid transparent",
  borderRadius: 4,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
});

const input = {
  width: "100%",
  border: "1px solid #E8E8E8",
  borderRadius: 4,
  padding: "9px 12px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  color: "#333",
  background: "#FFF",
};

const card = {
  background: "#FFF",
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
  boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
  border: "1px solid #E8E8E8",
};

const modal = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.48)",
  zIndex: 200,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
};

const modalBox = {
  background: "#FFF",
  borderRadius: "12px 12px 0 0",
  padding: 20,
  width: "100%",
  maxWidth: 480,
  maxHeight: "85vh",
  overflowY: "auto",
};

const row = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const PRODUCTS_INIT = [
  { id: 1, name: "Sepatu Sneakers Pria Casual", sku: "SNK-001", price: 185000, stock: 34, sold: 210, category: "Sepatu", image: "👟", status: "active" },
  { id: 2, name: "Tas Ransel Wanita Kulit", sku: "TAS-002", price: 320000, stock: 5, sold: 87, category: "Tas", image: "👜", status: "active" },
  { id: 3, name: "Kaos Polos Premium Cotton", sku: "KAO-003", price: 75000, stock: 0, sold: 560, category: "Pakaian", image: "👕", status: "inactive" },
  { id: 4, name: "Jam Tangan Digital Sport", sku: "JAM-004", price: 499000, stock: 18, sold: 42, category: "Aksesoris", image: "⌚", status: "active" },
  { id: 5, name: "Celana Jeans Slim Fit", sku: "CLN-005", price: 245000, stock: 22, sold: 133, category: "Pakaian", image: "👖", status: "active" },
];

const ORDERS_INIT = [
  { id: "SHP2024001", buyer: "Andi Pratama", items: "Sepatu Sneakers x1", total: 185000, status: "pending", date: "2024-01-15", address: "Jl. Sudirman No. 12, Jakarta" },
  { id: "SHP2024002", buyer: "Siti Rahayu", items: "Tas Ransel Wanita x2", total: 640000, status: "processing", date: "2024-01-14", address: "Jl. Gatot Subroto No. 45, Bandung" },
  { id: "SHP2024003", buyer: "Budi Santoso", items: "Kaos Polos x3", total: 225000, status: "shipped", date: "2024-01-13", address: "Jl. Ahmad Yani No. 78, Surabaya" },
  { id: "SHP2024004", buyer: "Dewi Lestari", items: "Jam Tangan Digital x1", total: 499000, status: "delivered", date: "2024-01-12", address: "Jl. Diponegoro No. 33, Yogyakarta" },
  { id: "SHP2024005", buyer: "Reza Firmansyah", items: "Celana Jeans x1", total: 245000, status: "cancelled", date: "2024-01-11", address: "Jl. Pemuda No. 56, Semarang" },
  { id: "SHP2024006", buyer: "Nina Kusuma", items: "Sepatu Sneakers x2", total: 370000, status: "pending", date: "2024-01-10", address: "Jl. Pahlawan No. 89, Medan" },
];

const SALES = [
  { bulan: "Agu", penjualan: 12400000, pesanan: 48 },
  { bulan: "Sep", penjualan: 18700000, pesanan: 72 },
  { bulan: "Okt", penjualan: 15200000, pesanan: 61 },
  { bulan: "Nov", penjualan: 24800000, pesanan: 98 },
  { bulan: "Des", penjualan: 31500000, pesanan: 127 },
  { bulan: "Jan", penjualan: 22100000, pesanan: 89 },
];

const CATEGORIES = [
  { name: "Pakaian", value: 45 },
  { name: "Sepatu", value: 25 },
  { name: "Tas", value: 18 },
  { name: "Aksesoris", value: 12 },
];

const PIE_COLORS = ["#EE4D2D", "#F6A609", "#1472CC", "#00A650"];

const ORDER_STATUS = {
  pending: { label: "Menunggu", color: "yellow" },
  processing: { label: "Diproses", color: "blue" },
  shipped: { label: "Dikirim", color: "green" },
  delivered: { label: "Diterima", color: "green" },
  cancelled: { label: "Dibatalkan", color: "red" },
};

const NEXT_STATUS = { pending: "processing", processing: "shipped", shipped: "delivered" };

function NavIcon({ type, active }) {
  const color = active ? "#EE4D2D" : "#999";
  if (type === "dashboard") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>;
  if (type === "products") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>;
  if (type === "orders") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="12" y2="16" /></svg>;
  if (type === "reports") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
  if (type === "settings") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
  return null;
}

function ApiSetup({ onConnect }) {
  const [form, setForm] = useState({ workerUrl: "", shopId: "", accessToken: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const connect = async () => {
    if (!form.workerUrl || !form.shopId || !form.accessToken) {
      setError("Semua field wajib diisi.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${form.workerUrl.replace(/\/$/, "")}/health`);
      if (!res.ok) throw new Error("Worker tidak dapat dijangkau");
      const client = createWorkerClient(form.workerUrl.replace(/\/$/, ""), form.accessToken, form.shopId);
      onConnect(form, client);
    } catch (e) {
      setError(e.message || "Gagal terhubung ke Worker. Pastikan URL benar.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: "#FFF", fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ width: 64, height: 64, background: "#EE4D2D", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
        <svg viewBox="0 0 24 24" fill="white" width="34" height="34"><path d="M12 2C9.243 2 7 4.243 7 7H5C3.897 7 3 7.897 3 9v11c0 1.103.897 2 2 2h14c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2h-2c0-2.757-2.243-5-5-5zm0 2c1.654 0 3 1.346 3 3H9c0-1.654 1.346-3 3-3zm-1 9h2v2h-2zm0-4h2v3h-2z" /></svg>
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, color: "#EE4D2D", marginBottom: 4 }}>Shopee Seller</div>
      <div style={{ color: "#999", fontSize: 13, marginBottom: 28, textAlign: "center" }}>Hubungkan via Cloudflare Workers</div>

      <div style={{ width: "100%", maxWidth: 360 }}>
        {[
          { label: "Worker URL", key: "workerUrl", placeholder: "https://nama.workers.dev", type: "text" },
          { label: "Shop ID", key: "shopId", placeholder: "Masukkan Shop ID", type: "text" },
          { label: "Access Token", key: "accessToken", placeholder: "Masukkan Access Token", type: "password" },
        ].map((f) => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>{f.label}</label>
            <input style={input} type={f.type} value={form[f.key]} onChange={set(f.key)} placeholder={f.placeholder} />
          </div>
        ))}
        {error && <div style={{ color: "#D0011B", fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <button style={{ ...btn("primary"), width: "100%", justifyContent: "center", padding: "12px 16px", fontSize: 15 }} onClick={connect} disabled={loading}>
          {loading ? "Menghubungkan..." : "Hubungkan Toko"}
        </button>
        <div style={{ marginTop: 16, padding: 12, background: "#FEF6E6", borderRadius: 6, border: "1px solid #F6A60930" }}>
          <div style={{ fontSize: 11, color: "#F6A609", fontWeight: 700, marginBottom: 4 }}>Langkah Setup</div>
          <div style={{ fontSize: 11, color: "#666", lineHeight: 1.7 }}>
            1. Deploy shopee-worker.js ke Cloudflare Workers<br />
            2. Set secret PARTNER_KEY dan PUSH_PARTNER_KEY via wrangler<br />
            3. Buat KV namespace dan bind ke SHOPEE_KV<br />
            4. Salin Worker URL ke field di atas<br />
            5. Set Callback URL di Shopee Open Platform ke Worker URL + /webhook
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: "#FFF", border: "1px solid #E8E8E8", borderRadius: 8, padding: "12px 14px", boxShadow: "0 1px 4px rgba(0,0,0,0.10)", borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#333", lineHeight: 1.2, wordBreak: "break-word" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Dashboard({ products, orders }) {
  const pending = orders.filter((o) => o.status === "pending").length;
  const lowStock = products.filter((p) => p.stock <= 5).length;

  return (
    <div style={{ padding: "12px 16px 80px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Selamat Datang</div>
        <div style={{ fontSize: 13, color: "#999" }}>Ringkasan toko kamu hari ini</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <StatCard label="Total Pendapatan" value="Rp 124,7 Jt" color="#EE4D2D" />
        <StatCard label="Total Pesanan" value={orders.length} color="#1472CC" />
        <StatCard label="Pesanan Pending" value={pending} color="#F6A609" />
        <StatCard label="Stok Menipis" value={lowStock} color="#D0011B" />
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Penjualan 6 Bulan Terakhir</div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={SALES} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
            <XAxis dataKey="bulan" tick={{ fontSize: 11, fill: "#999" }} />
            <YAxis tick={{ fontSize: 10, fill: "#999" }} tickFormatter={(v) => `${v / 1000000}Jt`} />
            <Tooltip formatter={(v) => fmtPrice(v)} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E8E8E8" }} />
            <Bar dataKey="penjualan" fill="#EE4D2D" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pesanan Terbaru</div>
        {orders.slice(0, 3).map((o) => (
          <div key={o.id} style={{ ...row, padding: "8px 0", borderBottom: "1px solid #E8E8E8" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{o.id}</div>
              <div style={{ fontSize: 12, color: "#999" }}>{o.buyer}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#EE4D2D" }}>{fmtPrice(o.total)}</div>
              <span style={badge(ORDER_STATUS[o.status].color)}>{ORDER_STATUS[o.status].label}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Peringatan Stok</div>
        {products.filter((p) => p.stock <= 5).map((p) => (
          <div key={p.id} style={{ ...row, padding: "8px 0", borderBottom: "1px solid #E8E8E8" }}>
            <div style={{ fontSize: 13 }}>{p.name}</div>
            <span style={badge(p.stock === 0 ? "red" : "yellow")}>{p.stock === 0 ? "Habis" : `Sisa ${p.stock}`}</span>
          </div>
        ))}
        {!products.some((p) => p.stock <= 5) && <div style={{ fontSize: 13, color: "#999" }}>Semua stok aman</div>}
      </div>
    </div>
  );
}

function Products({ products, setProducts }) {
  const [search, setSearch] = useState("");
  const [editP, setEditP] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [stockP, setStockP] = useState(null);
  const [newStock, setNewStock] = useState("");

  const filtered = useMemo(() => products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  ), [products, search]);

  const openEdit = (p) => { setEditP(p); setEditForm({ name: p.name, price: p.price, category: p.category, status: p.status, sku: p.sku }); };
  const saveEdit = () => { setProducts((prev) => prev.map((p) => p.id === editP.id ? { ...p, ...editForm, price: Number(editForm.price) } : p)); setEditP(null); };
  const openStock = (p) => { setStockP(p); setNewStock(String(p.stock)); };
  const saveStock = () => { setProducts((prev) => prev.map((p) => p.id === stockP.id ? { ...p, stock: Number(newStock) } : p)); setStockP(null); };

  return (
    <div>
      <div style={{ padding: "12px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", background: "#FFF", border: "1px solid #E8E8E8", borderRadius: 4, padding: "0 12px", marginBottom: 12, gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input style={{ flex: 1, border: "none", outline: "none", padding: "10px 0", fontSize: 14, color: "#333", background: "transparent" }} placeholder="Cari produk atau SKU..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ ...row, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#999" }}>{filtered.length} produk</div>
          <button style={btnSm("primary")}>+ Tambah Produk</button>
        </div>
      </div>

      <div style={{ padding: "0 16px 80px" }}>
        {filtered.map((p) => (
          <div key={p.id} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 10, borderBottom: "1px solid #E8E8E8", marginBottom: 10 }}>
              <div style={{ width: 52, height: 52, borderRadius: 6, background: "#FFF3F0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0, border: "1px solid #F8C4BA" }}>{p.image}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, marginBottom: 3 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>SKU: {p.sku} · {p.category}</div>
                <div style={row}>
                  <span style={{ fontWeight: 700, color: "#EE4D2D", fontSize: 14 }}>{fmtPrice(p.price)}</span>
                  <span style={badge(p.status === "active" ? "green" : "red")}>{p.status === "active" ? "Aktif" : "Nonaktif"}</span>
                </div>
              </div>
            </div>
            <div style={row}>
              <div>
                <span style={{ fontSize: 12, color: "#999" }}>Stok: </span>
                <span style={{ fontWeight: 700, color: p.stock === 0 ? "#D0011B" : p.stock <= 5 ? "#F6A609" : "#00A650", fontSize: 13 }}>{p.stock}</span>
                <span style={{ fontSize: 12, color: "#999", marginLeft: 10 }}>Terjual: <b>{p.sold}</b></span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={btnSm("outline")} onClick={() => openStock(p)}>Stok</button>
                <button style={btnSm("primary")} onClick={() => openEdit(p)}>Edit</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editP && (
        <div style={modal} onClick={() => setEditP(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...row, marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Edit Produk</div>
              <button style={btnSm("ghost")} onClick={() => setEditP(null)}>Tutup</button>
            </div>
            {[{ label: "Nama Produk", key: "name" }, { label: "SKU", key: "sku" }, { label: "Harga (Rp)", key: "price", type: "number" }, { label: "Kategori", key: "category" }].map((f) => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>{f.label}</label>
                <input style={input} type={f.type || "text"} value={editForm[f.key] || ""} onChange={(e) => setEditForm((p) => ({ ...p, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>Status</label>
              <select style={input} value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </div>
            <button style={{ ...btn("primary"), width: "100%", justifyContent: "center" }} onClick={saveEdit}>Simpan Perubahan</button>
          </div>
        </div>
      )}

      {stockP && (
        <div style={modal} onClick={() => setStockP(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...row, marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Update Stok</div>
              <button style={btnSm("ghost")} onClick={() => setStockP(null)}>Tutup</button>
            </div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>{stockP.name}</div>
            <div style={{ ...row, background: "#F5F5F5", padding: 12, borderRadius: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "#999" }}>Stok saat ini</span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{stockP.stock}</span>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>Stok Baru</label>
            <input style={{ ...input, marginBottom: 16 }} type="number" value={newStock} onChange={(e) => setNewStock(e.target.value)} min="0" />
            <button style={{ ...btn("primary"), width: "100%", justifyContent: "center" }} onClick={saveStock}>Perbarui Stok</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Orders({ orders, setOrders }) {
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);

  const TABS = [
    { key: "all", label: "Semua" },
    { key: "pending", label: "Pending" },
    { key: "processing", label: "Diproses" },
    { key: "shipped", label: "Dikirim" },
    { key: "delivered", label: "Selesai" },
    { key: "cancelled", label: "Batal" },
  ];

  const filtered = useMemo(() => orders.filter((o) => {
    const matchTab = tab === "all" || o.status === tab;
    const matchSearch = o.id.toLowerCase().includes(search.toLowerCase()) || o.buyer.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  }), [orders, tab, search]);

  const updateStatus = (id, status) => { setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status } : o)); setDetail(null); };

  return (
    <div>
      <div style={{ padding: "12px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", background: "#FFF", border: "1px solid #E8E8E8", borderRadius: 4, padding: "0 12px", marginBottom: 0, gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input style={{ flex: 1, border: "none", outline: "none", padding: "10px 0", fontSize: 14, color: "#333", background: "transparent" }} placeholder="Cari ID pesanan atau nama pembeli..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", background: "#FFF", borderBottom: "1px solid #E8E8E8", borderTop: "1px solid #E8E8E8", overflowX: "auto", scrollbarWidth: "none", marginTop: 12 }}>
        {TABS.map((t) => (
          <div key={t.key} style={{ padding: "10px 14px", fontSize: 13, fontWeight: tab === t.key ? 700 : 400, color: tab === t.key ? "#EE4D2D" : "#666", borderBottom: tab === t.key ? "2px solid #EE4D2D" : "2px solid transparent", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key !== "all" && <span style={{ marginLeft: 4, fontSize: 11, color: tab === t.key ? "#EE4D2D" : "#BBB" }}>({orders.filter((o) => o.status === t.key).length})</span>}
          </div>
        ))}
      </div>

      <div style={{ padding: "12px 16px 80px" }}>
        {filtered.length === 0 && <div style={{ textAlign: "center", color: "#999", padding: 32, fontSize: 13 }}>Tidak ada pesanan ditemukan</div>}
        {filtered.map((o) => (
          <div key={o.id} style={{ ...card, cursor: "pointer" }} onClick={() => setDetail(o)}>
            <div style={{ ...row, marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#EE4D2D" }}>{o.id}</div>
              <span style={badge(ORDER_STATUS[o.status].color)}>{ORDER_STATUS[o.status].label}</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{o.buyer}</div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>{o.items}</div>
            <div style={row}>
              <span style={{ fontSize: 11, color: "#BBB" }}>{fmtDate(o.date)}</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{fmtPrice(o.total)}</span>
            </div>
          </div>
        ))}
      </div>

      {detail && (
        <div style={modal} onClick={() => setDetail(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...row, marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Detail Pesanan</div>
              <button style={btnSm("ghost")} onClick={() => setDetail(null)}>Tutup</button>
            </div>
            {[
              { label: "ID Pesanan", value: detail.id },
              { label: "Pembeli", value: detail.buyer },
              { label: "Produk", value: detail.items },
              { label: "Total", value: fmtPrice(detail.total) },
              { label: "Tanggal", value: fmtDate(detail.date) },
              { label: "Alamat", value: detail.address },
            ].map((r) => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #E8E8E8", alignItems: "flex-start", gap: 12 }}>
                <span style={{ fontSize: 12, color: "#999", flexShrink: 0 }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 500, textAlign: "right" }}>{r.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: "#999" }}>Status: </span>
              <span style={badge(ORDER_STATUS[detail.status].color)}>{ORDER_STATUS[detail.status].label}</span>
            </div>
            {NEXT_STATUS[detail.status] && (
              <button style={{ ...btn("primary"), width: "100%", justifyContent: "center" }} onClick={() => updateStatus(detail.id, NEXT_STATUS[detail.status])}>
                Proses ke "{ORDER_STATUS[NEXT_STATUS[detail.status]].label}"
              </button>
            )}
            {detail.status === "pending" && (
              <button style={{ ...btn("outline"), width: "100%", justifyContent: "center", marginTop: 8, color: "#D0011B", borderColor: "#D0011B" }} onClick={() => updateStatus(detail.id, "cancelled")}>
                Batalkan Pesanan
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Reports() {
  const totalRev = SALES.reduce((a, b) => a + b.penjualan, 0);
  const totalOrd = SALES.reduce((a, b) => a + b.pesanan, 0);
  const avgOrd = Math.round(totalRev / totalOrd);

  return (
    <div style={{ padding: "12px 16px 80px" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Laporan Penjualan</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <StatCard label="Total Pendapatan" value={`Rp ${(totalRev / 1000000).toFixed(1)} Jt`} color="#EE4D2D" />
        <StatCard label="Total Pesanan" value={totalOrd} color="#1472CC" />
        <StatCard label="Rata-rata/Pesanan" value={`Rp ${(avgOrd / 1000).toFixed(0)}K`} color="#00A650" />
        <StatCard label="Produk Terjual" value="1.032" color="#F6A609" />
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Tren Pendapatan</div>
        <ResponsiveContainer width="100%" height={165}>
          <LineChart data={SALES} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
            <XAxis dataKey="bulan" tick={{ fontSize: 11, fill: "#999" }} />
            <YAxis tick={{ fontSize: 10, fill: "#999" }} tickFormatter={(v) => `${v / 1000000}Jt`} />
            <Tooltip formatter={(v) => fmtPrice(v)} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E8E8E8" }} />
            <Line type="monotone" dataKey="penjualan" stroke="#EE4D2D" strokeWidth={2.5} dot={{ fill: "#EE4D2D", r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Jumlah Pesanan per Bulan</div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={SALES} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
            <XAxis dataKey="bulan" tick={{ fontSize: 11, fill: "#999" }} />
            <YAxis tick={{ fontSize: 10, fill: "#999" }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E8E8E8" }} />
            <Bar dataKey="pesanan" fill="#1472CC" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Distribusi Kategori</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <PieChart width={130} height={130}>
            <Pie data={CATEGORIES} cx={60} cy={60} innerRadius={36} outerRadius={58} dataKey="value" paddingAngle={3}>
              {CATEGORIES.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
          </PieChart>
          <div style={{ flex: 1 }}>
            {CATEGORIES.map((c, i) => (
              <div key={c.name} style={{ ...row, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i] }} />
                  <span style={{ fontSize: 12 }}>{c.name}</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{c.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Produk Terlaris</div>
        {PRODUCTS_INIT.sort((a, b) => b.sold - a.sold).slice(0, 5).map((p, i) => (
          <div key={p.id} style={{ ...row, padding: "8px 0", borderBottom: "1px solid #E8E8E8" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 700, color: i === 0 ? "#EE4D2D" : "#BBB", fontSize: 13, minWidth: 16 }}>#{i + 1}</span>
              <span style={{ fontSize: 13 }}>{p.name}</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 13, color: "#666" }}>{p.sold} terjual</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PUSH_LIST = [
  { category: "Product Push", code: "reserved_stock_change_push", pushCode: 8 },
  { category: "Product Push", code: "video_upload_push", pushCode: 11 },
  { category: "Product Push", code: "brand_register_result", pushCode: 13 },
  { category: "Product Push", code: "violation_item_push", pushCode: 16 },
  { category: "Product Push", code: "item_price_update_push", pushCode: 22 },
  { category: "Product Push", code: "item_scheduled_publish_failed_push", pushCode: 27 },
  { category: "Order Push", code: "order_status_push", pushCode: 3 },
  { category: "Order Push", code: "order_trackingno_push", pushCode: 4 },
  { category: "Order Push", code: "shipping_document_status_push", pushCode: 15 },
  { category: "Order Push", code: "booking_status_push", pushCode: 23 },
  { category: "Order Push", code: "booking_trackingno_push", pushCode: 24 },
  { category: "Order Push", code: "booking_shipping_document_status_push", pushCode: 25 },
  { category: "Order Push", code: "package_fulfillment_status_push", pushCode: 30 },
  { category: "Order Push", code: "courier_delivery_binding_status_push", pushCode: 37 },
  { category: "Order Push", code: "package_info_push", pushCode: 47 },
  { category: "Return Push", code: "return_updates_push", pushCode: 29 },
  { category: "Marketing Push", code: "item_promotion_push", pushCode: 7 },
  { category: "Marketing Push", code: "promotion_update_push", pushCode: 9 },
  { category: "Shopee Push", code: "shopee_updates", pushCode: 5 },
  { category: "Shopee Push", code: "open_api_authorization_expiry", pushCode: 12 },
  { category: "Shopee Push", code: "shop_authorization_push", pushCode: 1 },
  { category: "Shopee Push", code: "shop_authorization_canceled_push", pushCode: 2 },
  { category: "Shopee Push", code: "shop_penalty_update_push", pushCode: 28 },
  { category: "Shopee Push", code: "video_upload_result_push", pushCode: 38 },
  { category: "Webchat Push", code: "webchat_push", pushCode: 10 },
  { category: "Fulfillment by Shopee Push", code: "fbs_sellable_stock", pushCode: 36 },
  { category: "Fulfillment by Shopee Push", code: "fbs_br_invoice_error_push", pushCode: 33 },
  { category: "Fulfillment by Shopee Push", code: "fbs_br_block_shop_push", pushCode: 34 },
  { category: "Fulfillment by Shopee Push", code: "fbs_br_block_sku_push", pushCode: 35 },
  { category: "Fulfillment by Shopee Push", code: "fbs_br_invoice_issued_push", pushCode: 31 },
];

const DEPLOY_REGIONS = ["China Mainland", "Singapore", "Malaysia", "Thailand", "Indonesia", "Vietnam", "Philippines", "Brazil", "Mexico", "Colombia", "Chile", "Poland", "Spain", "France", "India", "Taiwan", "South Korea", "Japan"];

function LivePush({ onBack }) {
  const [callbackUrl, setCallbackUrl] = useState("");
  const [region, setRegion] = useState("");
  const [pushKey, setPushKey] = useState("");
  const [selected, setSelected] = useState(() => {
    const init = {};
    PUSH_LIST.forEach((p) => { init[p.code] = false; });
    return init;
  });
  const [saved, setSaved] = useState(false);
  const [activeFilter, setActiveFilter] = useState("All");

  const categories = ["All", ...Array.from(new Set(PUSH_LIST.map((p) => p.category)))];
  const filtered = activeFilter === "All" ? PUSH_LIST : PUSH_LIST.filter((p) => p.category === activeFilter);
  const selectedCount = Object.values(selected).filter(Boolean).length;

  const togglePush = (code) => setSelected((p) => ({ ...p, [code]: !p[code] }));
  const selectAll = () => {
    const allSelected = filtered.every((p) => selected[p.code]);
    const next = { ...selected };
    filtered.forEach((p) => { next[p.code] = !allSelected; });
    setSelected(next);
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const catColor = {
    "Product Push": "#1472CC",
    "Order Push": "#EE4D2D",
    "Return Push": "#F6A609",
    "Marketing Push": "#9B59B6",
    "Shopee Push": "#EE4D2D",
    "Webchat Push": "#00A650",
    "Fulfillment by Shopee Push": "#1472CC",
  };

  return (
    <div style={{ padding: "0 0 80px" }}>
      <div style={{ background: "#FFF", borderBottom: "1px solid #E8E8E8", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ cursor: "pointer", display: "flex", alignItems: "center", color: "#EE4D2D" }} onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EE4D2D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Live Push Settings</div>
      </div>

      <div style={{ padding: "12px 16px 0" }}>
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Get Live Push</div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>Live Call Back URL</label>
            <input style={input} placeholder="https://your-domain.com/webhook/shopee" value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} />
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Contoh: https://nama.workers.dev/shopee-webhook</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>Deployment Service Area</label>
            <select style={input} value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Select Deployment Service Area</option>
              {DEPLOY_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>Live Push Partner Key</label>
            <input style={input} type="password" placeholder="Masukkan Live Push Partner Key" value={pushKey} onChange={(e) => setPushKey(e.target.value)} />
          </div>
        </div>

        <div style={card}>
          <div style={{ ...row, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Live Push Settings</div>
            <span style={{ fontSize: 12, color: "#999" }}>Push ({selectedCount}/30)</span>
          </div>

          <div style={{ display: "flex", overflowX: "auto", gap: 6, marginBottom: 12, scrollbarWidth: "none", paddingBottom: 4 }}>
            {categories.map((c) => (
              <div key={c} onClick={() => setActiveFilter(c)} style={{ padding: "5px 10px", borderRadius: 12, fontSize: 11, fontWeight: activeFilter === c ? 700 : 400, background: activeFilter === c ? "#EE4D2D" : "#F5F5F5", color: activeFilter === c ? "#FFF" : "#666", whiteSpace: "nowrap", cursor: "pointer", border: activeFilter === c ? "1px solid #EE4D2D" : "1px solid #E8E8E8", flexShrink: 0 }}>
                {c}
              </div>
            ))}
          </div>

          <div style={{ ...row, padding: "8px 0", borderBottom: "1px solid #E8E8E8", marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 16, fontSize: 11, fontWeight: 700, color: "#999" }}>
              <span style={{ minWidth: 100 }}>Push Category</span>
              <span style={{ flex: 1 }}>Push Code</span>
              <span style={{ minWidth: 36, textAlign: "center" }}>Code</span>
            </div>
            <button style={{ ...btnSm("outline"), fontSize: 11 }} onClick={selectAll}>
              {filtered.every((p) => selected[p.code]) ? "Hapus Semua" : "Pilih Semua"}
            </button>
          </div>

          {filtered.map((p) => (
            <div key={p.code} onClick={() => togglePush(p.code)} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F5F5F5", cursor: "pointer", gap: 10 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: selected[p.code] ? "none" : "2px solid #E8E8E8", background: selected[p.code] ? "#EE4D2D" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {selected[p.code] && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polyline points="2 6 5 9 10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: catColor[p.category] || "#999", fontWeight: 600, marginBottom: 1 }}>{p.category}</div>
                <div style={{ fontSize: 12, color: "#333", wordBreak: "break-all" }}>{p.code}</div>
              </div>
              <div style={{ ...badge("blue"), fontSize: 11, minWidth: 28, textAlign: "center", flexShrink: 0 }}>{p.pushCode}</div>
            </div>
          ))}
        </div>

        {saved && (
          <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: "#333", color: "#FFF", borderRadius: 20, padding: "10px 20px", fontSize: 13, fontWeight: 600, zIndex: 300, whiteSpace: "nowrap" }}>
            Pengaturan berhasil disimpan
          </div>
        )}

        <button style={{ ...btn("primary"), width: "100%", justifyContent: "center", marginBottom: 12 }} onClick={handleSave}>
          Simpan Pengaturan
        </button>
      </div>
    </div>
  );
}

function Settings({ apiConfig, onDisconnect }) {
  const [showLivePush, setShowLivePush] = useState(false);
  const [toggles, setToggles] = useState({ pesananBaru: true, stokMenipis: true, pesananBatal: false, laporanMingguan: true });
  const toggle = (k) => setToggles((p) => ({ ...p, [k]: !p[k] }));

  if (showLivePush) return <LivePush onBack={() => setShowLivePush(false)} />;

  const notifItems = [
    { key: "pesananBaru", label: "Pesanan baru masuk" },
    { key: "stokMenipis", label: "Stok produk menipis" },
    { key: "pesananBatal", label: "Pesanan dibatalkan" },
    { key: "laporanMingguan", label: "Laporan mingguan" },
  ];

  return (
    <div style={{ padding: "12px 16px 80px" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Pengaturan</div>

      <div style={card}>
        <div style={{ ...row, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Koneksi Shopee API</div>
          <span style={badge("green")}>Terhubung</span>
        </div>
        {[
          { label: "Partner ID", value: apiConfig.partnerId },
          { label: "Shop ID", value: apiConfig.shopId },
          { label: "Partner Key", value: "••••••••" + (apiConfig.partnerKey || "").slice(-4) },
          { label: "Access Token", value: "••••••••" + (apiConfig.accessToken || "").slice(-4) },
        ].map((r) => (
          <div key={r.label} style={{ ...row, padding: "8px 0", borderBottom: "1px solid #E8E8E8" }}>
            <span style={{ fontSize: 12, color: "#999" }}>{r.label}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{r.value}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button style={{ ...btn("outline"), flex: 1, justifyContent: "center" }}>Refresh Token</button>
          <button style={{ ...btn("outline"), flex: 1, justifyContent: "center", color: "#D0011B", borderColor: "#D0011B" }} onClick={onDisconnect}>Putuskan</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Notifikasi</div>
        {notifItems.map((n) => (
          <div key={n.key} style={{ ...row, padding: "11px 0", borderBottom: "1px solid #E8E8E8" }}>
            <span style={{ fontSize: 13 }}>{n.label}</span>
            <div style={{ width: 38, height: 21, borderRadius: 11, background: toggles[n.key] ? "#EE4D2D" : "#E8E8E8", position: "relative", cursor: "pointer", transition: "background 0.2s" }} onClick={() => toggle(n.key)}>
              <div style={{ position: "absolute", top: 2.5, left: toggles[n.key] ? 19 : 2.5, width: 16, height: 16, borderRadius: "50%", background: "#FFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...card, cursor: "pointer" }} onClick={() => setShowLivePush(true)}>
        <div style={row}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Live Push Settings</div>
            <div style={{ fontSize: 11, color: "#999" }}>Callback URL, push category, push code (0/30)</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCC" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Sinkronisasi Data</div>
        {[
          { label: "Sinkronisasi Produk", desc: "Tarik data produk terbaru dari Shopee" },
          { label: "Sinkronisasi Pesanan", desc: "Perbarui status pesanan real-time" },
          { label: "Sinkronisasi Stok", desc: "Selaraskan stok dengan gudang Shopee" },
        ].map((s) => (
          <div key={s.label} style={{ ...row, padding: "10px 0", borderBottom: "1px solid #E8E8E8" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{s.desc}</div>
            </div>
            <button style={btnSm("outline")}>Sync</button>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Tentang Aplikasi</div>
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.9 }}>
          <div>Versi: 1.0.0</div>
          <div>Platform: Shopee Open API v2</div>
          <div>Region: Indonesia (ID)</div>
          <div>Pembaruan terakhir: 11 Jan 2024</div>
        </div>
      </div>
    </div>
  );
}

const NAV_ITEMS = [
  { key: "dashboard", label: "Beranda" },
  { key: "products", label: "Produk" },
  { key: "orders", label: "Pesanan" },
  { key: "reports", label: "Laporan" },
  { key: "settings", label: "Pengaturan" },
];

export default function App() {
  const [apiConfig, setApiConfig] = useState(null);
  const [client, setClient] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");

  const { products, setProducts, orders, setOrders, loading, lastSync, liveEvents, fetchProducts, fetchOrders } = useShopeeData(client);

  const pendingCount = orders.filter((o) => o.status === "pending").length;

  const handleConnect = (config, workerClient) => {
    setApiConfig(config);
    setClient(workerClient);
  };

  if (!apiConfig) {
    return <ApiSetup onConnect={handleConnect} />;
  }

  return (
    <div style={{ fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif", background: "#F5F5F5", minHeight: "100vh", maxWidth: 480, margin: "0 auto", fontSize: 14, color: "#333" }}>
      <div style={{ background: "#EE4D2D", padding: "0 16px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 8px rgba(238,77,45,0.28)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M12 2C9.243 2 7 4.243 7 7H5C3.897 7 3 7.897 3 9v11c0 1.103.897 2 2 2h14c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2h-2c0-2.757-2.243-5-5-5zm0 2c1.654 0 3 1.346 3 3H9c0-1.654 1.346-3 3-3zm-1 9h2v2h-2zm0-4h2v3h-2z" /></svg>
          <span style={{ color: "#FFF", fontWeight: 700, fontSize: 17, letterSpacing: "-0.3px" }}>Shopee Seller</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {loading && <span style={{ background: "rgba(255,255,255,0.25)", color: "#FFF", borderRadius: 10, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>Memuat...</span>}
          {!loading && pendingCount > 0 && <span style={{ background: "#FFF", color: "#EE4D2D", borderRadius: 10, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{pendingCount} pesanan</span>}
          {liveEvents.length > 0 && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00A650", display: "inline-block" }} />}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        </div>
      </div>

      {activeTab === "dashboard" && <Dashboard products={products} orders={orders} lastSync={lastSync} onRefresh={() => { fetchProducts(); fetchOrders(); }} />}
      {activeTab === "products" && <Products products={products} setProducts={setProducts} onRefresh={fetchProducts} client={client} />}
      {activeTab === "orders" && <Orders orders={orders} setOrders={setOrders} onRefresh={fetchOrders} client={client} />}
      {activeTab === "reports" && <Reports orders={orders} />}
      {activeTab === "settings" && <Settings apiConfig={apiConfig} onDisconnect={() => { setApiConfig(null); setClient(null); }} />}

      <nav style={{ background: "#FFF", borderTop: "1px solid #E8E8E8", display: "flex", position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, zIndex: 100 }}>
        {NAV_ITEMS.map((item) => (
          <div key={item.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 6px", cursor: "pointer", borderTop: activeTab === item.key ? "2px solid #EE4D2D" : "2px solid transparent", color: activeTab === item.key ? "#EE4D2D" : "#999", fontSize: 10, fontWeight: activeTab === item.key ? 700 : 400, userSelect: "none" }} onClick={() => setActiveTab(item.key)}>
            <NavIcon type={item.key} active={activeTab === item.key} />
            <span style={{ marginTop: 2 }}>{item.label}</span>
          </div>
        ))}
      </nav>
    </div>
  );
}
