const crypto = require('node:crypto');

const MAX_BODY = 32 * 1024;
const KEY = 'littlelinks:profile:v1';
let memoryProfile = null;
const attempts = new Map();

// Storage is the first complete set of credentials found, in this order:
//   1. Turso: the Turso integration on Vercel injects TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
//   2. Redis over REST: KV_REST_API_* (older Vercel KV), then UPSTASH_REDIS_REST_*.
// Never mix credentials from different pairs.
function tursoCredentials() {
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) return { url: process.env.TURSO_DATABASE_URL, token: process.env.TURSO_AUTH_TOKEN };
  return null;
}
function redisCredentials() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  return null;
}
// Names of the settings that are still needed. Shown in the setup dialog; never includes a value.
function missing() {
  const names = [];
  if (!useMemory() && !tursoCredentials() && !redisCredentials()) names.push('DATABASE');
  if (!process.env.ADMIN_PASSWORD) names.push('ADMIN_PASSWORD');
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) names.push('SESSION_SECRET');
  return names;
}
function configured() { return missing().length === 0; }
function useMemory() { return process.env.NODE_ENV !== 'production' && process.env.LOCAL_MEMORY_STORE === '1'; }
function noStore(res) { res.setHeader('Cache-Control', 'no-store, max-age=0'); res.setHeader('X-Content-Type-Options', 'nosniff'); }
function json(res, status, value) { noStore(res); res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); }
function failConfig(res) { json(res, 503, { error: 'Admin setup is incomplete.', code: 'NOT_CONFIGURED', missing: missing() }); }
async function redis(command) {
  const credentials = redisCredentials();
  if (!credentials) throw new Error('Storage is not configured');
  const endpoint = new URL(credentials.url);
  if (endpoint.protocol !== 'https:') throw new Error('Storage URL must use HTTPS');
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Storage unavailable');
  const result = await response.json();
  if (result.error) throw new Error('Storage command failed');
  return result.result;
}
// Turso accepts SQL over HTTPS: a list of statements is posted to /v2/pipeline and
// answered with one result per statement. libsql:// and turso:// URLs use the same host.
const TURSO_SCHEMA = [
  ['CREATE TABLE IF NOT EXISTS littlelinks_kv (name TEXT PRIMARY KEY, value TEXT NOT NULL)'],
  ['CREATE TABLE IF NOT EXISTS littlelinks_attempts (client TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL)']
];
let tursoReady = false; // true once this instance has made sure the tables exist
function tursoEndpoint(value) {
  const base = new URL(value.replace(/^(libsql|turso|wss):/i, 'https:'));
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && process.env.NODE_ENV !== 'production')) throw new Error('Storage URL must use HTTPS');
  return new URL('/v2/pipeline', base);
}
// Runs [sql, ...args] statements in order and returns the result of each one.
async function turso(statements) {
  const credentials = tursoCredentials();
  if (!credentials) throw new Error('Storage is not configured');
  const all = tursoReady ? statements : [...TURSO_SCHEMA, ...statements];
  const requests = all.map(([sql, ...args]) => ({ type: 'execute', stmt: { sql, args: args.map(arg => typeof arg === 'number' ? { type: 'integer', value: String(arg) } : { type: 'text', value: arg }) } }));
  const response = await fetch(tursoEndpoint(credentials.url), { method: 'POST', headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [...requests, { type: 'close' }] }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Storage unavailable (HTTP ${response.status})`);
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results.slice(0, all.length) : [];
  const failed = results.find(result => !result || result.type !== 'ok');
  if (failed !== undefined || results.length !== all.length) { tursoReady = false; throw new Error(`Storage command failed: ${failed?.error?.message || 'unexpected response'}`); }
  tursoReady = true;
  return results.slice(all.length - statements.length).map(result => result.response.result);
}
async function tursoGet(name) { const [result] = await turso([['SELECT value FROM littlelinks_kv WHERE name = ?', name]]); return result.rows[0]?.[0]?.value ?? null; }
async function tursoSet(name, value) { await turso([['INSERT INTO littlelinks_kv (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', name, value]]); }
// Expired rows are deleted first, so a client whose window has ended starts again at 1.
async function tursoAttempt(client) {
  const now = Math.floor(Date.now() / 1000);
  const [, result] = await turso([
    ['DELETE FROM littlelinks_attempts WHERE expires_at <= ?', now],
    ['INSERT INTO littlelinks_attempts (client, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(client) DO UPDATE SET hits = hits + 1 RETURNING hits', client, now + 15 * 60]
  ]);
  return Number(result.rows[0][0].value);
}
async function getProfile() {
  if (useMemory()) return memoryProfile;
  const value = tursoCredentials() ? await tursoGet(KEY) : await redis(['GET', KEY]);
  return value ? JSON.parse(value) : null;
}
async function setProfile(profile) {
  if (useMemory()) { memoryProfile = profile; return; }
  if (tursoCredentials()) await tursoSet(KEY, JSON.stringify(profile)); else await redis(['SET', KEY, JSON.stringify(profile)]);
}
async function allowAttempt(ip) {
  const key = crypto.createHash('sha256').update(ip).digest('hex');
  if (useMemory()) { const now = Date.now(); let item = attempts.get(key); if (!item || item.until < now) item = { count: 0, until: now + 15 * 60 * 1000 }; item.count++; attempts.set(key, item); return item.count <= 10; }
  if (tursoCredentials()) return await tursoAttempt(key) <= 10;
  const script = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 900) end; return n";
  return Number(await redis(['EVAL', script, 1, `littlelinks:login:${key}`])) <= 10;
}
function equal(a, b) { const x = crypto.createHash('sha256').update(a).digest(); const y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); }
function signature(value) { return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url'); }
function createSession() { const value = `${Date.now() + 8 * 60 * 60 * 1000}.${crypto.randomBytes(24).toString('base64url')}`; return `${value}.${signature(value)}`; }
function authenticated(req) {
  const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('ll_session='));
  if (!cookie) return false;
  const parts = cookie.slice('ll_session='.length).split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || Number(parts[0]) < Date.now()) return false;
  return equal(parts[2], signature(`${parts[0]}.${parts[1]}`));
}
function sessionCookie(value, maxAge) { return `ll_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { const parsed = new URL(origin); return parsed.host === req.headers.host && (parsed.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:')); } catch { return false; }
}
async function body(req) {
  if (req.body !== undefined) { if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) throw new Error('Body too large'); return req.body; }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('Body too large'); }
  return JSON.parse(raw);
}
function validUrl(value, mail = true) { try { const u = new URL(value); return ['https:', 'http:', ...(mail ? ['mailto:'] : [])].includes(u.protocol); } catch { return false; } }
function text(v, max, required = false) { return typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0); }
function validateProfile(v) {
  if (!v || typeof v !== 'object' || !text(v.name,60,true) || !text(v.handle,40,true) || !text(v.bio,180) || !text(v.avatar,2048) || (v.avatar && !validUrl(v.avatar,false)) || !Array.isArray(v.links) || v.links.length > 30 || !Array.isArray(v.socials) || v.socials.length > 4) return false;
  if (!v.links.every(l => l && text(l.title,80,true) && text(l.subtitle,120) && text(l.icon,8) && text(l.url,2048,true) && validUrl(l.url))) return false;
  const allowed = ['instagram','tiktok','youtube','mail'];
  return v.socials.every(s => s && allowed.includes(s.icon) && text(s.label,30,true) && text(s.url,2048,true) && validUrl(s.url));
}
module.exports = { configured, noStore, json, failConfig, getProfile, setProfile, allowAttempt, equal, createSession, authenticated, sessionCookie, sameOrigin, body, validateProfile };
