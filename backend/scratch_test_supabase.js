const fs = require('fs');
const path = require('path');
const https = require('https');

// Parser manuellement le fichier .env pour éviter les dépendances
const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('Fichier .env introuvable dans :', envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    env[key] = value.trim();
  }
});

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL ou la clé Supabase manquante dans le fichier .env');
  process.exit(1);
}

console.log('Connexion à Supabase REST API:', supabaseUrl);

function request(table, select = '*') {
  return new Promise((resolve, reject) => {
    const url = `${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    const parsedUrl = new URL(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(body);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.end();
  });
}

(async () => {
  try {
    // 1. Compter les users
    const users = await request('users', 'id,role,matricule,nom,prenoms');
    console.log('\n--- TABLE USERS ---');
    console.log(`Nombre total d'utilisateurs : ${users.length}`);
    const roles = {};
    users.forEach(u => {
      roles[u.role] = (roles[u.role] || 0) + 1;
    });
    console.log('Utilisateurs par rôle :', roles);
    if (users.length > 0) {
      console.log('Exemples d\'utilisateurs (jusqu\'à 3) :');
      console.log(users.slice(0, 3));
    }

    // 2. Compter les etudiants
    const etudiants = await request('etudiants', 'id,user_id,matricule,nom,prenoms');
    console.log('\n--- TABLE ETUDIANTS ---');
    console.log(`Nombre total d'étudiants : ${etudiants.length}`);
    if (etudiants.length > 0) {
      console.log('Exemples d\'étudiants (jusqu\'à 3) :');
      console.log(etudiants.slice(0, 3));
    }

  } catch (err) {
    console.error('Erreur lors de la requête :', err.message);
  }
})();
