const server = require('../lib/server');
module.exports = async (req, res) => {
  server.noStore(res);
  if (!server.configured()) return server.failConfig(res);
  try {
    if (req.method === 'GET') return server.json(res, 200, { authenticated: server.authenticated(req) });
    if (req.method === 'POST') {
      if (!server.sameOrigin(req)) return server.json(res, 403, { error: 'Invalid origin.' });
      // Vercel supplies x-real-ip at the edge. Local development uses the socket address.
      const ip = process.env.VERCEL ? (req.headers['x-real-ip'] || 'unknown') : (req.socket?.remoteAddress || 'unknown');
      if (!await server.allowAttempt(ip)) return server.json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      let data; try { data = await server.body(req); } catch { return server.json(res, 400, { error: 'Invalid request.' }); }
      if (!data || typeof data.password !== 'string' || data.password.length > 1024 || !server.equal(data.password, process.env.ADMIN_PASSWORD)) return server.json(res, 401, { error: 'Incorrect password.' });
      res.setHeader('Set-Cookie', server.sessionCookie(server.createSession(), 8 * 60 * 60));
      return server.json(res, 200, { authenticated: true });
    }
    if (req.method === 'DELETE') {
      if (!server.sameOrigin(req)) return server.json(res, 403, { error: 'Invalid origin.' });
      res.setHeader('Set-Cookie', server.sessionCookie('', 0)); return server.json(res, 200, { authenticated: false });
    }
    res.setHeader('Allow', 'GET, POST, DELETE'); return server.json(res, 405, { error: 'Method not allowed.' });
  } catch (error) { console.error('Session error:', error.message); return server.json(res, 503, { error: 'Admin service unavailable. Please try again.' }); }
};
