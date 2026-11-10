const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// These tests choose the storage themselves, whatever the shell has set.
for (const name of ['LOCAL_MEMORY_STORE', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']) delete process.env[name];
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.SESSION_SECRET = 'test-secret-at-least-thirty-two-characters';

// Node 22.5+ ships SQLite. Older versions skip the tests that run real SQL.
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { DatabaseSync = null; }
const needsSqlite = { skip: DatabaseSync ? false : 'requires node:sqlite (Node 22.5 or newer)' };

// Every test loads its own copy of the app, so nothing remembered about one database reaches the next.
function loadApp() {
  for (const file of ['../api/profile', '../api/session', '../lib/server']) delete require.cache[require.resolve(file)];
  return { profile: require('../api/profile'), session: require('../api/session'), storage: require('../lib/server') };
}

function useEnv(t, values) {
  const apply = source => { for (const [name, value] of Object.entries(source)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  apply(values);
  t.after(() => apply(previous));
}

function useFetch(t, replacement) {
  const original = global.fetch;
  global.fetch = replacement;
  t.after(() => { global.fetch = original; });
}

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

// Stands in for a Turso database: takes the same POST /v2/pipeline requests and runs the SQL on SQLite.
async function startDatabase(t, token) {
  const db = new DatabaseSync(':memory:');
  const statements = [];
  const encode = value => value === null ? { type: 'null' } : typeof value === 'string' ? { type: 'text', value } : Number.isInteger(value) ? { type: 'integer', value: String(value) } : { type: 'float', value };
  const decode = arg => arg.type === 'null' ? null : arg.type === 'integer' ? Number(arg.value) : arg.value;
  const url = await listen(t, async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.method !== 'POST' || req.url !== '/v2/pipeline') { res.statusCode = 404; return res.end(); }
    if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; return res.end(); }
    const results = JSON.parse(raw).requests.map(request => {
      if (request.type === 'close') return { type: 'ok', response: { type: 'close' } };
      statements.push(request.stmt.sql);
      try {
        const rows = db.prepare(request.stmt.sql).all(...(request.stmt.args || []).map(decode));
        return { type: 'ok', response: { type: 'execute', result: { cols: Object.keys(rows[0] || {}).map(name => ({ name, decltype: null })), rows: rows.map(row => Object.values(row).map(encode)), affected_row_count: 0, last_insert_rowid: null } } };
      } catch (error) { return { type: 'error', error: { message: error.message, code: 'SQLITE_ERROR' } }; }
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ baton: null, base_url: null, results }));
  });
  return { db, statements, url };
}

// A Turso reply in which every statement succeeded and returned no rows.
function emptyReply(options) {
  const results = JSON.parse(options.body).requests.map(request => request.type === 'close' ? { type: 'ok', response: { type: 'close' } } : { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 0, last_insert_rowid: null } } });
  return { ok: true, status: 200, json: async () => ({ baton: null, base_url: null, results }) };
}

test('publishes, reads and limits sign-ins with a Turso database', needsSqlite, async t => {
  const database = await startDatabase(t, 'turso-token');
  useEnv(t, { TURSO_DATABASE_URL: database.url, TURSO_AUTH_TOKEN: 'turso-token' });
  const app = loadApp();
  const base = await listen(t, (req, res) => (req.url === '/api/profile' ? app.profile : app.session)(req, res));
  const headers = { origin: base, 'content-type': 'application/json' };
  const signIn = password => fetch(base + '/api/session', { method: 'POST', headers, body: JSON.stringify({ password }) });

  // A new, empty database works straight away: the tables are created on first use.
  let response = await fetch(base + '/api/profile');
  assert.equal(response.status, 200); assert.equal((await response.json()).profile, null);

  const profile = { name: 'A creator', handle: '@creator', bio: 'It\'s "quoted" ✳ ភាសាខ្មែរ', avatar: '', socials: [{ label: 'Email', icon: 'mail', url: 'mailto:hello@example.com' }], links: [{ title: 'My site', subtitle: 'Visit', url: 'https://example.com', icon: '✳' }] };
  response = await fetch(base + '/api/profile', { method: 'PUT', headers, body: JSON.stringify(profile) }); assert.equal(response.status, 401);
  response = await signIn('wrong'); assert.equal(response.status, 401);
  response = await signIn(process.env.ADMIN_PASSWORD); assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  response = await fetch(base + '/api/profile', { method: 'PUT', headers: { ...headers, cookie }, body: JSON.stringify(profile) }); assert.equal(response.status, 200);
  response = await fetch(base + '/api/profile'); assert.deepEqual((await response.json()).profile, profile);

  // Publishing again replaces the saved profile instead of adding a second one.
  const renamed = { ...profile, name: 'Renamed', links: [] };
  response = await fetch(base + '/api/profile', { method: 'PUT', headers: { ...headers, cookie }, body: JSON.stringify(renamed) }); assert.equal(response.status, 200);
  response = await fetch(base + '/api/profile'); assert.deepEqual((await response.json()).profile, renamed);
  const saved = database.db.prepare('SELECT value FROM littlelinks_kv').all();
  assert.equal(saved.length, 1); assert.deepEqual(JSON.parse(saved[0].value), renamed);

  // Two attempts are used above, so the eighth one here is the tenth and last allowed.
  const statuses = [];
  for (let i = 0; i < 10; i++) statuses.push((await signIn('wrong')).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 429, 429]);
  response = await signIn(process.env.ADMIN_PASSWORD); assert.equal(response.status, 429);
  let attempts = database.db.prepare('SELECT client, hits, expires_at FROM littlelinks_attempts').all();
  assert.equal(attempts.length, 1); assert.equal(attempts[0].hits, 13);
  assert.match(attempts[0].client, /^[0-9a-f]{64}$/); // a hash, never the address itself
  const secondsLeft = attempts[0].expires_at - Math.floor(Date.now() / 1000);
  assert.ok(secondsLeft > 890 && secondsLeft <= 900, `window was ${secondsLeft}s`);

  // When the 15 minutes are over the count starts again, and stale rows are removed.
  database.db.exec("UPDATE littlelinks_attempts SET expires_at = 1; INSERT INTO littlelinks_attempts VALUES ('someone-else', 99, 1)");
  response = await signIn(process.env.ADMIN_PASSWORD); assert.equal(response.status, 200);
  attempts = database.db.prepare('SELECT hits FROM littlelinks_attempts').all();
  assert.deepEqual(attempts.map(row => row.hits), [1]);

  // The tables are created by the first request only, not on every page view.
  assert.equal(database.statements.filter(sql => sql.startsWith('CREATE TABLE')).length, 2);
});

test('recreates the tables if they disappear while the server is running', needsSqlite, async t => {
  const database = await startDatabase(t, 'turso-token');
  useEnv(t, { TURSO_DATABASE_URL: database.url, TURSO_AUTH_TOKEN: 'turso-token' });
  const { storage } = loadApp();
  assert.equal(await storage.getProfile(), null);
  database.db.exec('DROP TABLE littlelinks_kv');
  await assert.rejects(storage.getProfile(), /Storage command failed: no such table/);
  assert.equal(await storage.getProfile(), null);
});

test('storage failures return a plain error and keep the token private', async t => {
  const rejecting = await listen(t, (req, res) => { res.statusCode = 401; res.end(`bad token ${req.headers.authorization}`); });
  useEnv(t, { TURSO_DATABASE_URL: rejecting, TURSO_AUTH_TOKEN: 'an-expired-token' });
  const logged = t.mock.method(console, 'error', () => {});
  const base = await listen(t, loadApp().profile);
  const response = await fetch(base + '/api/profile');
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(body), { error: 'Storage unavailable. Please try again.' });
  const log = logged.mock.calls.map(call => call.arguments.join(' ')).join('\n');
  assert.match(log, /Storage unavailable \(HTTP 401\)/);
  assert.doesNotMatch(log + body, /an-expired-token/);
});

test('reads the database URL that Vercel provides in any of its forms', async t => {
  useEnv(t, { TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: 'turso-token', NODE_ENV: 'production' });
  const { storage } = loadApp();
  let request;
  useFetch(t, async (url, options) => { request = { url: String(url), ...options }; return emptyReply(options); });
  for (const url of ['libsql://my-db-my-org.turso.io', 'turso://my-db-my-org.turso.io', 'https://my-db-my-org.turso.io', 'LIBSQL://my-db-my-org.turso.io/']) {
    process.env.TURSO_DATABASE_URL = url; request = undefined;
    assert.equal(await storage.getProfile(), null);
    assert.equal(request.url, 'https://my-db-my-org.turso.io/v2/pipeline', url);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, 'Bearer turso-token');
  }
  // One statement per request, values sent separately from the SQL, and the connection closed at the end.
  const sent = JSON.parse(request.body).requests;
  assert.deepEqual(sent, [{ type: 'execute', stmt: { sql: 'SELECT value FROM littlelinks_kv WHERE name = ?', args: [{ type: 'text', value: 'littlelinks:profile:v1' }] } }, { type: 'close' }]);

  // An unencrypted address is only accepted outside production (for a local database).
  process.env.TURSO_DATABASE_URL = 'http://my-db-my-org.turso.io'; request = undefined;
  await assert.rejects(storage.getProfile(), /Storage URL must use HTTPS/);
  assert.equal(request, undefined);
});

test('Turso is used when Redis credentials are also present, and half a pair is ignored', async t => {
  useEnv(t, { TURSO_DATABASE_URL: 'libsql://my-db-my-org.turso.io', TURSO_AUTH_TOKEN: 'turso-token', UPSTASH_REDIS_REST_URL: 'https://upstash.example', UPSTASH_REDIS_REST_TOKEN: 'upstash-token' });
  const { storage } = loadApp();
  const urls = [];
  useFetch(t, async (url, options) => { urls.push(String(url)); return String(url).startsWith('https://upstash.example') ? { ok: true, json: async () => ({ result: null }) } : emptyReply(options); });
  assert.equal(storage.configured(), true);
  await storage.getProfile();
  assert.deepEqual(urls, ['https://my-db-my-org.turso.io/v2/pipeline']);
  delete process.env.TURSO_AUTH_TOKEN;
  await storage.getProfile();
  assert.equal(urls.at(-1), 'https://upstash.example/');
});

test('setup status names what is still missing, never a value', async t => {
  useEnv(t, { TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: undefined, ADMIN_PASSWORD: undefined, SESSION_SECRET: 'too-short' });
  const app = loadApp();
  const base = await listen(t, app.session);
  let response = await fetch(base + '/api/session');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Admin setup is incomplete.', code: 'NOT_CONFIGURED', missing: ['DATABASE', 'ADMIN_PASSWORD', 'SESSION_SECRET'] });

  // Right after Turso is connected on Vercel, only the two admin settings are left.
  process.env.TURSO_DATABASE_URL = 'libsql://my-db-my-org.turso.io'; process.env.TURSO_AUTH_TOKEN = 'turso-token';
  response = await fetch(base + '/api/session');
  const body = await response.text();
  assert.deepEqual(JSON.parse(body).missing, ['ADMIN_PASSWORD', 'SESSION_SECRET']);
  assert.doesNotMatch(body, /turso-token|my-db-my-org|too-short/);

  process.env.ADMIN_PASSWORD = 'test-admin-password'; process.env.SESSION_SECRET = 'test-secret-at-least-thirty-two-characters';
  assert.equal(app.storage.configured(), true);
});
