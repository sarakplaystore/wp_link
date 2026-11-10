const crypto = require('node:crypto');

const MAX_BODY = 32 * 1024;
const KEY = 'littlelinks:profile:v1';
let memoryProfile = null;
const attempts = new Map();

// Marketplace integrations commonly inject UPSTASH_REDIS_REST_*; older Vercel
// KV integrations use KV_REST_API_*. Never mix credentials from different pairs.
function redisCredentials() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  return null;
}
function configured() {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 && (useMemory() || redisCredentials()));
}
function useMemory() { return process.env.NODE_ENV !== 'production' && process.env.LOCAL_MEMORY_STORE === '1'; }
function noStore(res) { res.setHeader('Cache-Control', 'no-store, max-age=0'); res.setHeader('X-Content-Type-Options', 'nosniff'); }
function json(res, status, value) { noStore(res); res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); }
function failConfig(res) { json(res, 503, { error: 'Admin setup is incomplete.', code: 'NOT_CONFIGURED' }); }
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
async function getProfile() { if (useMemory()) return memoryProfile; const value = await redis(['GET', KEY]); return value ? JSON.parse(value) : null; }
async function setProfile(profile) { if (useMemory()) { memoryProfile = profile; return; } await redis(['SET', KEY, JSON.stringify(profile)]); }
async function allowAttempt(ip) {
  const key = crypto.createHash('sha256').update(ip).digest('hex');
  if (useMemory()) { const now = Date.now(); let item = attempts.get(key); if (!item || item.until < now) item = { count: 0, until: now + 15 * 60 * 1000 }; item.count++; attempts.set(key, item); return item.count <= 10; }
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
