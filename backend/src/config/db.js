const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let supabase = null;

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('[DB] SUPABASE_URL et SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY) sont requis dans .env');
    }
    supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabase;
}

async function query(text, params) {
  const client = getSupabase();

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

  const { data, error } = await client.rpc('execute_sql', {
    sql_query: sql,
    sql_params: [],
  });

  if (!error) {
    let parsedData = data;
    if (typeof parsedData === 'string') {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (_) {}
    }

    // ✅ CORRIGÉ — bug critique trouvé : la fonction PostgreSQL execute_sql
    // avale ses propres erreurs SQL dans son bloc EXCEPTION et renvoie
    // { error, sqlstate } au lieu de lever une vraie exception. Ce code
    // traitait auparavant CET OBJET D'ERREUR comme s'il s'agissait d'une
    // ligne de résultat valide (branche `else if (parsedData)` plus bas),
    // renvoyant silencieusement une "ligne" contenant error/sqlstate au
    // lieu des vraies colonnes attendues (matricule, nom, module_id...).
    // Ni Node ni Flutter ne voyaient jamais l'erreur SQL réelle — juste
    // une liste vide ou incohérente en bout de chaîne. On détecte
    // maintenant explicitement ce cas et on fait remonter l'erreur.
    if (
      parsedData &&
      typeof parsedData === 'object' &&
      !Array.isArray(parsedData) &&
      'error' in parsedData &&
      'sqlstate' in parsedData
    ) {
      console.error('[DB] execute_sql a renvoyé une erreur SQL:', parsedData.error, '(sqlstate ' + parsedData.sqlstate + ')');
      console.error('[DB] Requete fautive:', sql);
      throw new Error('[SQL] ' + parsedData.error + ' (sqlstate ' + parsedData.sqlstate + ')');
    }

    // SELECT → tableau JSON ; DML → { success, rowCount }
    if (Array.isArray(parsedData)) {
      return { rows: parsedData, rowCount: parsedData.length };
    } else if (parsedData && typeof parsedData === 'object' && 'rowCount' in parsedData) {
      return { rows: [], rowCount: parsedData.rowCount || 0 };
    } else if (parsedData) {
      return { rows: [parsedData], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // Si la fonction RPC n'existe pas, on log l'erreur pour le debug
  if (error.code === '42883' || error.message.includes('execute_sql')) {
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
    return {
      query,
      release: () => {},
    };
  },
};

console.log('[DB] Connecte via Supabase JS client (service key)');

module.exports = pool;
