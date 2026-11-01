// Traduit une erreur d'unicité PostgreSQL (23505) en message lisible pour l'administration.
// Via Supabase (execute_sql), le code n'est pas toujours dans err.code : il apparaît dans le texte
// ("... violates unique constraint "users_email_key" (sqlstate 23505)"), d'où la lecture des deux.
function estConflitUnique(err) {
  if (!err) return false;
  const txt = String(err.message || '');
  return err.code === '23505' || /23505|duplicate key value/i.test(txt);
}

// Renvoie le message à afficher, ou null si l'erreur n'est pas un doublon.
function messageConflitUnique(err) {
  if (!estConflitUnique(err)) return null;
  const txt = String((err && (err.message || err.detail)) || '').toLowerCase();
  if (txt.includes('email')) return 'Cet email est déjà utilisé par un autre compte.';
  if (txt.includes('matricule')) return 'Ce matricule est déjà utilisé par un autre compte.';
  if (txt.includes('tel')) return 'Ce numéro de téléphone est déjà utilisé par un autre compte.';
  return 'Une de ces informations (email ou matricule) est déjà utilisée par un autre compte.';
}

module.exports = { estConflitUnique, messageConflitUnique };
