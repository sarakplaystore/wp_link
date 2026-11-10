const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
process.env.LOCAL_MEMORY_STORE = '1';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.SESSION_SECRET = 'test-secret-at-least-thirty-two-characters';
const profileHandler = require('../api/profile');
const sessionHandler = require('../api/session');

test('admin login, authorization, validation, and shared publication', async t => {
  const server = http.createServer((req,res) => (req.url === '/api/profile' ? profileHandler : sessionHandler)(req,res));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options={}) => fetch(base + path, options);
  const headers = { origin: base, 'content-type': 'application/json' };
  let response = await request('/api/profile');
  assert.equal(response.status, 200); assert.equal((await response.json()).profile, null);
  const profile = {name:'A creator',handle:'@creator',bio:'Hello',avatar:'',socials:[{label:'Email',icon:'mail',url:'mailto:hello@example.com'}],links:[{title:'My site',subtitle:'Visit',url:'https://example.com',icon:'✳'}]};
  response = await request('/api/profile',{method:'PUT',headers,body:JSON.stringify(profile)}); assert.equal(response.status,401);
  response = await request('/api/session',{method:'POST',headers,body:JSON.stringify({password:'wrong'})}); assert.equal(response.status,401);
  response = await request('/api/session',{method:'POST',headers,body:JSON.stringify({password:process.env.ADMIN_PASSWORD})}); assert.equal(response.status,200);
  const cookie = response.headers.get('set-cookie').split(';')[0]; assert.match(response.headers.get('set-cookie'),/HttpOnly/); assert.match(response.headers.get('set-cookie'),/SameSite=Strict/);
  response = await request('/api/profile',{method:'PUT',headers:{...headers,origin:'https://attacker.example',cookie},body:JSON.stringify(profile)}); assert.equal(response.status,403);
  response = await request('/api/profile',{method:'PUT',headers:{...headers,cookie},body:JSON.stringify({...profile,links:[{...profile.links[0],url:'javascript:alert(1)'}]})}); assert.equal(response.status,400);
  response = await request('/api/profile',{method:'PUT',headers:{...headers,cookie},body:JSON.stringify(profile)}); assert.equal(response.status,200);
  response = await request('/api/profile'); assert.deepEqual((await response.json()).profile,profile); assert.match(response.headers.get('cache-control'),/no-store/);
  response = await request('/api/session',{headers:{cookie:cookie+'tampered'}}); assert.equal((await response.json()).authenticated,false);
  response = await request('/api/session',{method:'DELETE',headers:{...headers,cookie}}); assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
});

test('missing configuration fails closed', async () => {
  const old = process.env.SESSION_SECRET; delete process.env.SESSION_SECRET;
  const server = require('../lib/server'); assert.equal(server.configured(),false);
  process.env.SESSION_SECRET = old;
});

test('login attempts are limited', async t => {
  const server = http.createServer(sessionHandler);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let status;
  for (let i=0;i<12;i++) {
    const response = await fetch(base + '/api/session', {method:'POST', headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({password:'wrong'})});
    status=response.status;
  }
  assert.equal(status,429);
});

test('configuration error returns a setup code without exposing secrets', async t => {
  const previous = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  t.after(() => { process.env.SESSION_SECRET = previous; });
  const server = http.createServer(sessionHandler);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/session`);
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(), {error:'Admin setup is incomplete.',code:'NOT_CONFIGURED',missing:['SESSION_SECRET']});
});

test('uses complete Upstash integration credentials and prefers a complete KV pair', async t => {
  const server = require('../lib/server');
  const names = ['LOCAL_MEMORY_STORE','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } global.fetch = originalFetch; });
  delete process.env.LOCAL_MEMORY_STORE; delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL='https://upstash.example'; process.env.UPSTASH_REDIS_REST_TOKEN='upstash-token';
  let request;
  global.fetch=async (url, options) => { request={url:String(url),...options}; return {ok:true,json:async()=>({result:null})}; };
  assert.equal(server.configured(),true); await server.getProfile();
  assert.equal(request.url,'https://upstash.example/'); assert.equal(request.headers.Authorization,'Bearer upstash-token');
  process.env.KV_REST_API_URL='https://kv.example';
  await server.getProfile(); assert.equal(request.url,'https://upstash.example/');
  process.env.KV_REST_API_TOKEN='kv-token';
  await server.getProfile(); assert.equal(request.url,'https://kv.example/'); assert.equal(request.headers.Authorization,'Bearer kv-token');
  delete process.env.UPSTASH_REDIS_REST_TOKEN; delete process.env.KV_REST_API_TOKEN;
  assert.equal(server.configured(),false);
});
