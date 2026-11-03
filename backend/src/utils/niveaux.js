// Niveaux d'études : « Licence 1 », « L2 », « Master 1 », « M2 »…
const NIVEAUX_FINAUX = new Set(['L3', 'LICENCE3', 'M2', 'MASTER2']);

const compact = (n) => String(n || '').trim().toUpperCase().replace(/\s+/g, '');

// Dernier niveau d'un cycle : l'étudiant admis est diplômé.
const estNiveauFinal = (niveau) => NIVEAUX_FINAUX.has(compact(niveau));

// « Licence 1 » -> « Licence 2 », « L1 » -> « L2 ». null si le niveau n'a pas de numéro.
const niveauSuivant = (niveau) => {
    const m = String(niveau || '').trim().match(/^(.*?)(\d+)$/);
    return m ? `${m[1]}${Number(m[2]) + 1}` : null;
};

// « 2025-2026 » -> « 2026-2027 »
const anneeSuivante = (libelle) => {
    const m = String(libelle || '').match(/^(\d{4})-(\d{4})$/);
    return m ? `${Number(m[1]) + 1}-${Number(m[2]) + 1}` : null;
};

module.exports = { estNiveauFinal, niveauSuivant, anneeSuivante };
