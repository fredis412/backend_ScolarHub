// ============================================================
// seed_canaux.js — Crée les 3 canaux publics utilisés par l'app
// (ids 1, 2, 3 attendus par canal_screen.dart)
// Usage : node seed_canaux.js
// ============================================================

const supabase = require('./src/config/supabase');

const CANAUX = [
  { id: 1, nom: 'Administration',        description: 'Annonces officielles de l\'administration', type: 'administration' },
  { id: 2, nom: 'Admin & Filière',       description: 'Échanges entre l\'administration et les délégués de filière', type: 'admin_filiere' },
  { id: 3, nom: 'Bureau des Étudiants',  description: 'Annonces et activités du BDE', type: 'bde' },
  { id: 4, nom: 'Groupe Professeurs',    description: 'Échanges entre tous les professeurs de l’établissement', type: 'professeurs' },
];

(async () => {
  try {
    const { error } = await supabase
      .from('canaux')
      .upsert(CANAUX, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    console.log('Canaux initialisés.');
    process.exit(0);
  } catch (err) {
    console.error('Erreur seed canaux :', err.message);
    process.exit(1);
  }
})();
