// Lightweight local server; production requests are handled by Vercel functions.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const handlers = { '/api/profile': require('./api/profile'), '/api/session': require('./api/session') };
const files = { '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'], '/styles.css': ['styles.css','text/css'], '/app.js': ['app.js','text/javascript'] };
http.createServer(async (req,res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (handlers[pathname]) return handlers[pathname](req,res);
  if (files[pathname] && req.method === 'GET') { try { const [file,type] = files[pathname]; res.setHeader('Content-Type', `${type}; charset=utf-8`); return res.end(await fs.readFile(path.join(__dirname,file))); } catch {} }
  res.statusCode = 404; res.end('Not found');
}).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Little Links listening on port ${process.env.PORT || 3000}`));
