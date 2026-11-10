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
