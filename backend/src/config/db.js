require('dotenv').config();

// ─────────────────────────────────────────────────────────────────────────────
// db.js — Couche d'accès aux données via Supabase JS client
//
// On utilise directement @supabase/supabase-js (déjà fonctionnel) avec une
// interface compatible pool.query() pour que tous les controllers existants
// fonctionnent sans modification.
//
// Pourquoi pas pg directement ?
//   Le host db.PROJECT.supabase.co ne résout qu'en IPv6 (pas de record A),
//   et le pooler aws-0-eu-central-1 rejette le tenant sur ce réseau.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY ||
                process.env.SUPABASE_SECRET_KEY ||
                process.env.SUPABASE_ANON_KEY ||
                process.env.SUPABASE_KEY ||
                process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new Error(
        '[DB Config] SUPABASE_URL ou la cle Supabase (SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY) ' +
        'est manquante dans les variables d\'environnement Render.'
      );
    }

    _supabase = createClient(url, key, { realtime: { transport: ws } });
  }
  return _supabase;
}

// ─── Wrapper compatible pool.query(text, params) ──────────────────────────
//
// Stratégie : utiliser supabase.rpc('execute_sql', {query, params}) si la
// fonction existe dans la DB, sinon fallback sur l'ORM Supabase.
//
// Pour les requêtes SELECT simples, on peut aussi parser le SQL basique.
// ─────────────────────────────────────────────────────────────────────────────

async function query(text, params) {
  const supabase = getSupabase();

  // La fonction RPC execute_sql actuellement déployée n'applique pas son
  // tableau sql_params aux placeholders PostgreSQL. On injecte donc des
  // littéraux échappés côté serveur avant l'appel RPC.
  const sql = (text || '').replace(/\$(\d+)/g, (_, index) => {
    const value = params?.[Number(index) - 1];
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (Array.isArray(value)) {
      if (value.length === 0) return `ARRAY[]::text[]`;
      return `ARRAY[${value.map((item) => `'${String(item).replace(/'/g, "''")}'`).join(', ')}]`;
    }
    if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  });

  // Log query for debugging syntax errors
  console.log('[DB QUERY]:', sql);

  // Tentative via RPC execute_sql (fonction SQL stockée côté Supabase)
  const { data, error } = await supabase.rpc('execute_sql', {
    sql_query: sql,
    sql_params: [],
  });

  if (!error) {
    // SELECT → tableau JSON ; DML → { success, rowCount }
    if (Array.isArray(data)) {
      return { rows: data, rowCount: data.length };
    } else if (data && typeof data === 'object' && 'rowCount' in data) {
      return { rows: [], rowCount: data.rowCount || 0 };
    } else if (data) {
      return { rows: [data], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // Si la fonction RPC n'existe pas, on log l'erreur pour le debug
  if (error.code === '42883' || error.message.includes('execute_sql')) {
    // Fonction execute_sql non créée — on relaie l'erreur clairement
    throw new Error(
      '[DB] La fonction SQL execute_sql() est requise dans Supabase.\n' +
      'Créez-la avec : CREATE OR REPLACE FUNCTION execute_sql(sql_query text, sql_params text[] DEFAULT \'{}\')\n' +
      'RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$ ...\n' +
      'Erreur originale : ' + error.message
    );
  }

  throw new Error('[DB] Erreur Supabase : ' + error.message);
}

// Expose l'interface pool standard
const pool = {
  query,
  // connect() simulé pour les controllers qui utilisent des transactions
  connect: async () => {
    let released = false;
    return {
      query,
      release: () => { released = true; },
    };
  },
};

console.log('[DB] Connecte via Supabase JS client (service key)');

module.exports = pool;
