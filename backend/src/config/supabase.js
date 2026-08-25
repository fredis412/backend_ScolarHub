const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey && supabaseKey !== 'placeholder') {
  supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: { transport: ws },
  });
  console.log('[Supabase] Client configure avec succes');
} else {
  console.warn(
    '[Supabase] Variables SUPABASE_URL ou SUPABASE_SERVICE_KEY manquantes. ' +
    'Les fonctionnalites Supabase (annonces, EDT, notifications) seront indisponibles.'
  );

  // Proxy qui renvoie des erreurs claires au lieu de crasher
  const handler = {
    get(_, prop) {
      if (prop === 'from') {
        return () => {
          const chainError = {
            select: () => chainError,
            insert: () => chainError,
            update: () => chainError,
            delete: () => chainError,
            eq: () => chainError,
            ilike: () => chainError,
            order: () => chainError,
            limit: () => chainError,
            offset: () => chainError,
            single: () => Promise.resolve({ data: null, error: { message: 'Supabase non configure' } }),
            then: (resolve) => resolve({ data: null, error: { message: 'Supabase non configure' } }),
          };
          return chainError;
        };
      }
      return undefined;
    },
  };
  supabase = new Proxy({}, handler);
}

module.exports = supabase;
