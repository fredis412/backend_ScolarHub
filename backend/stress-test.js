/**
 * ═══════════════════════════════════════════════════════════════
 * Test de charge ScolarHub — Script Node.js (sans dépendance)
 *
 * Usage :
 *   node stress-test.js
 *
 * Ce script envoie des rafales de requêtes HTTP vers votre backend
 * et mesure les temps de réponse, le taux d'erreur, et le nombre
 * max d'utilisateurs simultanés que le serveur peut gérer.
 * ═══════════════════════════════════════════════════════════════
 */

const http = require('http');
const https = require('https');

// ── Configuration ──────────────────────────────────────────────
const BACKEND_URL = 'https://backend-scolarhub.onrender.com';
const ENDPOINTS = [
  { method: 'GET',  path: '/api/annonces',    name: 'Annonces (GET)' },
  { method: 'GET',  path: '/api/auth/me',     name: 'Auth/Me (GET)' },
  { method: 'POST', path: '/api/auth/lookup',  name: 'Lookup (POST)', body: JSON.stringify({ matricule: 'TEST-0001' }) },
];

// Phases du test
const PHASES = [
  { name: '🔄 Réveil du serveur',     concurrent: 1,   requests: 3,    pauseMs: 2000 },
  { name: '🟢 Charge légère',         concurrent: 10,  requests: 50,   pauseMs: 500  },
  { name: '🟡 Charge normale',        concurrent: 25,  requests: 100,  pauseMs: 200  },
  { name: '🟠 Charge élevée',         concurrent: 50,  requests: 200,  pauseMs: 100  },
  { name: '🔴 Pic de charge (stress)', concurrent: 100, requests: 300,  pauseMs: 50   },
];

// ── Mesures ─────────────────────────────────────────────────────
const results = {
  total: 0,
  success: 0,
  errors: 0,
  times: [],
  errorDetails: {},
};

function makeRequest(endpoint) {
  return new Promise((resolve) => {
    const start = Date.now();
    const url = new URL(endpoint.path, BACKEND_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: endpoint.method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const elapsed = Date.now() - start;
        results.total++;
        if (res.statusCode >= 200 && res.statusCode < 500) {
          results.success++;
        } else {
          results.errors++;
          const key = `${res.statusCode}`;
          results.errorDetails[key] = (results.errorDetails[key] || 0) + 1;
        }
        results.times.push(elapsed);
        resolve({ status: res.statusCode, time: elapsed });
      });
    });

    req.on('error', (err) => {
      const elapsed = Date.now() - start;
      results.total++;
      results.errors++;
      const key = err.code || err.message;
      results.errorDetails[key] = (results.errorDetails[key] || 0) + 1;
      results.times.push(elapsed);
      resolve({ status: 0, time: elapsed, error: key });
    });

    req.on('timeout', () => {
      req.destroy();
      const elapsed = Date.now() - start;
      results.total++;
      results.errors++;
      results.errorDetails['TIMEOUT'] = (results.errorDetails['TIMEOUT'] || 0) + 1;
      results.times.push(elapsed);
      resolve({ status: 0, time: elapsed, error: 'TIMEOUT' });
    });

    if (endpoint.body) req.write(endpoint.body);
    req.end();
  });
}

async function runPhase(phase) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${phase.name}`);
  console.log(`  → ${phase.concurrent} utilisateurs simultanés, ${phase.requests} requêtes`);
  console.log(`${'═'.repeat(60)}`);

  const phaseStart = Date.now();
  const phaseResults = { sent: 0, success: 0, errors: 0, times: [] };

  let sent = 0;
  while (sent < phase.requests) {
    const batch = [];
    const batchSize = Math.min(phase.concurrent, phase.requests - sent);
    for (let i = 0; i < batchSize; i++) {
      const ep = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
      batch.push(makeRequest(ep));
      sent++;
    }
    const batchResults = await Promise.all(batch);
    for (const r of batchResults) {
      phaseResults.sent++;
      phaseResults.times.push(r.time);
      if (r.status >= 200 && r.status < 500) {
        phaseResults.success++;
      } else {
        phaseResults.errors++;
      }
    }

    // Indicateur de progression
    const pct = Math.round((sent / phase.requests) * 100);
    process.stdout.write(`\r  Progression : ${pct}% (${sent}/${phase.requests})`);

    if (phase.pauseMs > 0) {
      await new Promise(r => setTimeout(r, phase.pauseMs));
    }
  }

  const elapsed = Date.now() - phaseStart;
  const sorted = [...phaseResults.times].sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const rps = (phaseResults.sent / (elapsed / 1000)).toFixed(1);
  const errorRate = ((phaseResults.errors / phaseResults.sent) * 100).toFixed(1);

  console.log(`\n\n  📊 Résultats :`);
  console.log(`     Requêtes envoyées : ${phaseResults.sent}`);
  console.log(`     Réussies : ${phaseResults.success}  |  Erreurs : ${phaseResults.errors} (${errorRate}%)`);
  console.log(`     Durée totale : ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`     Débit : ${rps} requêtes/seconde`);
  console.log(`     Temps de réponse :`);
  console.log(`       Moyen : ${avg.toFixed(0)} ms`);
  console.log(`       Médian (p50) : ${p50} ms`);
  console.log(`       p95 : ${p95} ms`);
  console.log(`       p99 : ${p99} ms`);
  console.log(`       Min : ${sorted[0]} ms  |  Max : ${sorted[sorted.length - 1]} ms`);

  return {
    name: phase.name,
    concurrent: phase.concurrent,
    sent: phaseResults.sent,
    success: phaseResults.success,
    errors: phaseResults.errors,
    errorRate,
    rps,
    avg: avg.toFixed(0),
    p50, p95, p99,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      TEST DE CHARGE — ScolarHub Backend                    ║');
  console.log('║      URL : ' + BACKEND_URL.padEnd(48) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Réveil du serveur Render (cold start)
  console.log('\n⏳ Réveil du serveur Render (peut prendre 30s)...');
  await makeRequest(ENDPOINTS[0]);
  await new Promise(r => setTimeout(r, 3000));
  console.log('✅ Serveur réveillé !\n');

  const phaseResults = [];
  for (const phase of PHASES) {
    const pr = await runPhase(phase);
    phaseResults.push(pr);
    // Pause entre phases
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── Rapport final ──────────────────────────────────────────
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  RAPPORT FINAL                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('┌──────────────────────────┬──────┬────────┬────────┬────────┬────────┐');
  console.log('│ Phase                    │ Sim. │ Req/s  │ Moy ms │ p95 ms │ Erreur │');
  console.log('├──────────────────────────┼──────┼────────┼────────┼────────┼────────┤');
  for (const r of phaseResults) {
    const n = r.name.replace(/[🔄🟢🟡🟠🔴]\s*/g, '').padEnd(24).substring(0, 24);
    console.log(`│ ${n} │ ${String(r.concurrent).padStart(4)} │ ${String(r.rps).padStart(6)} │ ${String(r.avg).padStart(6)} │ ${String(r.p95).padStart(6)} │ ${(r.errorRate + '%').padStart(6)} │`);
  }
  console.log('└──────────────────────────┴──────┴────────┴────────┴────────┴────────┘');

  const sorted = [...results.times].sort((a, b) => a - b);
  const globalAvg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

  console.log(`\n📈 TOTAUX :`);
  console.log(`   Requêtes totales : ${results.total}`);
  console.log(`   Réussies : ${results.success}  |  Erreurs : ${results.errors}`);
  console.log(`   Taux de succès : ${((results.success / results.total) * 100).toFixed(1)}%`);
  console.log(`   Temps de réponse moyen global : ${globalAvg.toFixed(0)} ms`);

  if (Object.keys(results.errorDetails).length > 0) {
    console.log(`\n⚠️  Détail des erreurs :`);
    for (const [code, count] of Object.entries(results.errorDetails)) {
      console.log(`   ${code} : ${count} fois`);
    }
  }

  // Déterminer le seuil de capacité
  let lastGoodPhase = phaseResults[0];
  for (const r of phaseResults) {
    if (parseFloat(r.errorRate) < 10 && parseInt(r.p95) < 5000) {
      lastGoodPhase = r;
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🎯 CONCLUSION :`);
  console.log(`   Le serveur supporte confortablement ${lastGoodPhase.concurrent} utilisateurs simultanés`);
  console.log(`   avec un débit de ${lastGoodPhase.rps} requêtes/seconde`);
  console.log(`   et un temps de réponse moyen de ${lastGoodPhase.avg} ms.`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch(console.error);

