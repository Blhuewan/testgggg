import { CATALOG } from './catalog.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (message, status = 400) => json({ error: message }, status);

async function setup(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trade_applications (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)`)
  ]);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM products').first();
  if (!count?.n) {
    const now = new Date().toISOString();
    for (const p of CATALOG) await db.prepare('INSERT OR IGNORE INTO products (id,data,updated_at) VALUES (?,?,?)').bind(p.id, JSON.stringify(p), now).run();
  }
}

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = value => atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return body + '.' + b64url(sig);
}
async function validToken(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [body, signature] = token.split('.');
  if (!body || !signature) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(env.ADMIN_PASSCODE || '9113'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  try {
    const sig = Uint8Array.from(fromB64url(signature), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sig, enc.encode(body));
    if (!ok) return false;
    return JSON.parse(fromB64url(body)).exp > Date.now();
  } catch { return false; }
}
async function paystackVerify(reference, env) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
  });
  const result = await response.json();
  return response.ok && result.status && result.data?.status === 'success' ? result.data : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return fail('Database is not configured. Create the Nexa D1 database and bind it as DB.', 503);
    try {
      await setup(env.DB);
      if (request.method === 'GET' && url.pathname === '/api/store') {
        const rows = await env.DB.prepare('SELECT data FROM products ORDER BY rowid DESC').all();
        return json({ products: (rows.results || []).map(r => JSON.parse(r.data)) });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/login') {
        const body = await request.json();
        if (!body.pin || body.pin !== (env.ADMIN_PASSCODE || '9113')) return fail('Incorrect admin PIN.', 401);
        const token = await sign({ exp: Date.now() + 8 * 60 * 60 * 1000 }, env.ADMIN_PASSCODE || '9113');
        return json({ token });
      }
      if (url.pathname.startsWith('/api/admin/')) {
        if (!(await validToken(request, env))) return fail('Admin login required.', 401);
        if (request.method === 'GET' && url.pathname === '/api/admin/orders') {
          const rows = await env.DB.prepare('SELECT data FROM orders ORDER BY created_at DESC').all();
          return json({ orders: (rows.results || []).map(r => JSON.parse(r.data)) });
        }
        if (request.method === 'POST' && url.pathname === '/api/admin/products') {
          const p = await request.json();
          if (!p.id || !p.name || !Number.isFinite(Number(p.price)) || !Number.isInteger(Number(p.stock)) || Number(p.price) < 0 || Number(p.stock) < 0) return fail('Product details are invalid.');
          await env.DB.prepare('INSERT INTO products (id,data,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
            .bind(String(p.id), JSON.stringify(p), new Date().toISOString()).run();
          return json({ ok: true, product: p });
        }
        const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
        if (request.method === 'DELETE' && productMatch) {
          await env.DB.prepare('DELETE FROM products WHERE id=?').bind(decodeURIComponent(productMatch[1])).run();
          return json({ ok: true });
        }
        const orderMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
        if (request.method === 'PATCH' && orderMatch) {
          const { status } = await request.json();
          const allowed = ['New', 'Confirmed', 'Out for delivery', 'Delivered', 'Cancelled'];
          if (!allowed.includes(status)) return fail('Invalid order status.');
          const row = await env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(decodeURIComponent(orderMatch[1])).first();
          if (!row) return fail('Order not found.', 404);
          const order = JSON.parse(row.data);
          if (order.status !== 'Cancelled' && status === 'Cancelled') {
            for (const item of order.items || []) {
              const productRow = await env.DB.prepare('SELECT data FROM products WHERE id=?').bind(item.id).first();
              if (productRow) { const product = JSON.parse(productRow.data); product.stock = Number(product.stock || 0) + Number(item.qty || 0); await env.DB.prepare('UPDATE products SET data=?,updated_at=? WHERE id=?').bind(JSON.stringify(product), new Date().toISOString(), product.id).run(); }
            }
          } else if (order.status === 'Cancelled' && status !== 'Cancelled') {
            for (const item of order.items || []) {
              const productRow = await env.DB.prepare('SELECT data FROM products WHERE id=?').bind(item.id).first();
              if (productRow) { const product = JSON.parse(productRow.data); product.stock = Math.max(0, Number(product.stock || 0) - Number(item.qty || 0)); await env.DB.prepare('UPDATE products SET data=?,updated_at=? WHERE id=?').bind(JSON.stringify(product), new Date().toISOString(), product.id).run(); }
            }
          }
          order.status = status;
          await env.DB.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify(order), order.id).run();
          return json({ ok: true, order });
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/orders/confirm') {
        if (!env.PAYSTACK_SECRET_KEY) return fail('Paystack secret key is not configured.', 503);
        const order = await request.json();
        if (!order?.ref || !Array.isArray(order.items) || !order.items.length) return fail('Order details are incomplete.');
        const payment = await paystackVerify(order.ref, env);
        if (!payment || payment.currency !== 'GHS' || payment.amount !== Math.round(Number(order.total) * 100)) return fail('Payment could not be verified. No order was saved.', 402);
        const already = await env.DB.prepare('SELECT id FROM orders WHERE id=?').bind(order.no).first();
        if (already) return json({ ok: true, duplicate: true });
        const freshItems = [];
        let total = 0;
        for (const item of order.items) {
          const row = await env.DB.prepare('SELECT data FROM products WHERE id=?').bind(item.id).first();
          if (!row) return fail('A product in this order is no longer available.', 409);
          const p = JSON.parse(row.data), qty = Number(item.qty);
          if (!Number.isInteger(qty) || qty < 1 || p.stock < qty) return fail(`${p.name} does not have enough stock.`, 409);
          freshItems.push({ id: p.id, name: p.name, price: Number(p.price), qty }); total += Number(p.price) * qty;
        }
        if (Math.round(total * 100) !== payment.amount) return fail('The order total does not match the verified payment.', 402);
        for (const item of freshItems) {
          const row = await env.DB.prepare('SELECT data FROM products WHERE id=?').bind(item.id).first();
          const p = JSON.parse(row.data); p.stock -= item.qty;
          await env.DB.prepare('UPDATE products SET data=?,updated_at=? WHERE id=?').bind(JSON.stringify(p), new Date().toISOString(), p.id).run();
        }
        order.items = freshItems; order.total = total; order.status = 'New'; order.paymentVerified = true;
        await env.DB.prepare('INSERT INTO orders (id,data,created_at) VALUES (?,?,?)').bind(order.no, JSON.stringify(order), order.date || new Date().toISOString()).run();
        return json({ ok: true, order });
      }
      return fail('API route not found.', 404);
    } catch (error) {
      return fail(error?.message || 'Server error.', 500);
    }
  }
};
