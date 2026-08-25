/**
 * Serveur minimal pour l'inscription / liste des étudiants.
 * Utilisez ce serveur si `node server.js` échoue (node_modules incomplets).
 * Démarre : npm run start:etudiants
 */
const http = require('http');
require('dotenv').config();
const { listEtudiants, inscrireEtudiant } = require('./src/controllers/etudiants.controller');

const PORT = process.env.PORT || 3000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function mockRes(res) {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    },
  };
}

const server = http.createServer(async (req, res) => {
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = (req.url || '').split('?')[0];

  try {
    if (path === '/api/etudiants' && req.method === 'GET') {
      await listEtudiants(req, mockRes(res));
      return;
    }

    if (path === '/api/etudiants' && req.method === 'POST') {
      req.body = await readBody(req);
      await inscrireEtudiant(req, mockRes(res));
      return;
    }

    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'ScolarHub API — étudiants', status: 'OK' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Route introuvable' }));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Erreur serveur' }));
  }
});

server.listen(PORT, () => {
  console.log(`API étudiants démarrée sur http://localhost:${PORT}`);
});
