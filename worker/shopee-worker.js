const SHOPEE_BASE = "https://partner.shopeemobile.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Access-Token, X-Shop-Id",
};

async function hmacSHA256Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function buildShopeeSign(env, path, accessToken, shopId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const base = `${env.PARTNER_ID}${path}${timestamp}${accessToken}${shopId}`;
  const sign = await hmacSHA256Hex(env.PARTNER_KEY, base);
  return { timestamp, sign };
}

async function verifyWebhookSignature(env, body, authHeader) {
  if (!authHeader) return false;
  const expected = await hmacSHA256Hex(
    env.PUSH_PARTNER_KEY,
    `${env.PARTNER_ID}|${body}`
  );
  return authHeader === expected;
}

async function proxyToShopee(env, path, params, method, body, accessToken, shopId) {
  const { timestamp, sign } = await buildShopeeSign(env, path, accessToken, shopId);

  const url = new URL(`${SHOPEE_BASE}${path}`);
  url.searchParams.set("partner_id", env.PARTNER_ID);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("shop_id", shopId);
  url.searchParams.set("sign", sign);

  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const fetchOptions = {
    method: method || "GET",
    headers: { "Content-Type": "application/json" },
  };

  if (body) fetchOptions.body = JSON.stringify(body);

  const response = await fetch(url.toString(), fetchOptions);
  const data = await response.json();
  return data;
}

async function storeWebhookEvent(env, event) {
  const key = `event:${Date.now()}:${event.code}`;
  await env.SHOPEE_KV.put(key, JSON.stringify(event), { expirationTtl: 86400 });

  const latestKey = `latest:${event.code}`;
  await env.SHOPEE_KV.put(latestKey, JSON.stringify(event), { expirationTtl: 86400 });
}

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const authHeader = request.headers.get("Authorization");

  const isValid = await verifyWebhookSignature(env, rawBody, authHeader);
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401, headers: CORS });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS });
  }

  await storeWebhookEvent(env, event);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function handleEvents(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const since = url.searchParams.get("since");

  const prefix = since ? `event:${since}` : "event:";
  const list = await env.SHOPEE_KV.list({ prefix });

  const events = await Promise.all(
    list.keys.slice(0, 50).map(async (k) => {
      const val = await env.SHOPEE_KV.get(k.name);
      return val ? JSON.parse(val) : null;
    })
  );

  const filtered = events.filter((e) => e !== null && (!code || String(e.code) === code));

  return new Response(JSON.stringify({ events: filtered }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function handleApiProxy(request, env, pathname) {
  const accessToken = request.headers.get("X-Access-Token") || "";
  const shopId = request.headers.get("X-Shop-Id") || "";

  const url = new URL(request.url);
  const params = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });

  let body = null;
  if (request.method === "POST") {
    try { body = await request.json(); } catch {}
  }

  const shopeePath = pathname.replace("/proxy", "");
  const data = await proxyToShopee(env, shopeePath, params, request.method, body, accessToken, shopId);

  return new Response(JSON.stringify(data), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    if (pathname === "/events" && request.method === "GET") {
      return handleEvents(request, env);
    }

    if (pathname.startsWith("/proxy/")) {
      return handleApiProxy(request, env, pathname);
    }

    if (pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", time: Date.now() }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  },
};
