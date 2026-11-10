const server = require('../lib/server');
module.exports = async (req, res) => {
  server.noStore(res);
  if (!server.configured()) return server.failConfig(res);
  try {
    if (req.method === 'GET') return server.json(res, 200, { profile: await server.getProfile() });
    if (req.method === 'PUT') {
      if (!server.sameOrigin(req)) return server.json(res, 403, { error: 'Invalid origin.' });
      if (!server.authenticated(req)) return server.json(res, 401, { error: 'Please sign in again.' });
      let profile; try { profile = await server.body(req); } catch { return server.json(res, 400, { error: 'Invalid request.' }); }
      if (!server.validateProfile(profile)) return server.json(res, 400, { error: 'Invalid profile data. Check field lengths and URLs.' });
      await server.setProfile(profile);
      return server.json(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, PUT'); return server.json(res, 405, { error: 'Method not allowed.' });
  } catch (error) { console.error('Profile storage error:', error.message); return server.json(res, 503, { error: 'Storage unavailable. Please try again.' }); }
};
