// Insère un jeu de questions/réponses de test dans ia_conversations
// pour simuler un historique de chat avec l'IA (utile pour démo/tests UI).
const pool = require('./src/config/db');
require('dotenv').config();

const qaPairs = [
  // Scolarité & Inscription
  ['Comment puis-je consulter mes notes ?',
   "Vous pouvez consulter vos notes dans l'onglet Notes de votre profil. Chaque module y est affiché avec le détail CC/Examen et la moyenne pondérée par coefficient."],
  ['Comment télécharger mon bulletin ?',
   "Rendez-vous dans la section Notes, puis cliquez sur Télécharger le bulletin PDF. Le document sera généré automatiquement avec votre moyenne générale et votre mention."],
  ["J'ai oublié mon mot de passe, que faire ?",
   "Sur l'écran de connexion, contactez l'administration avec votre matricule pour réinitialiser votre accès. La configuration du mot de passe se fait lors de votre première connexion."],
  ['Comment changer mon adresse email ou mon numéro de téléphone ?',
   "Allez dans votre profil, section Modifier mes informations, puis mettez à jour les champs souhaités."],

  // Emploi du temps & Cours
  ['Où puis-je voir mon emploi du temps ?',
   "L'emploi du temps de votre filière et niveau est disponible dans l'onglet Planning sous forme de PDF, mis à jour par l'administration."],
  ['Comment accéder aux supports de cours de mes professeurs ?',
   "Les supports de cours partagés par vos enseignants sont disponibles dans la section Cours de votre filière."],
  ["Que faire si l'emploi du temps n'est pas à jour ?",
   "Signalez-le à l'administration via une réclamation dans l'app, section Réclamations."],

  // Réclamations & Paiements
  ['Comment faire une réclamation sur une note ?',
   "Allez dans Réclamations, sélectionnez le module concerné, choisissez le type Contestation de note et expliquez votre justification."],
  ['Comment payer ma scolarité ?',
   "Rendez-vous dans la section Paiement, créez un ticket avec le montant, puis suivez les instructions de paiement Mobile Money affichées."],
  ['Comment suivre le statut de mon paiement ?',
   "Vos tickets de paiement sont listés avec leur statut (en attente, validé, rejeté) dans la section Paiement."],

  // Communication
  ['Comment contacter mes camarades de classe ?',
   "Utilisez les Canaux de discussion accessibles depuis le menu principal — chaque filière dispose d'un canal de groupe."],
  ['Comment évaluer un professeur ?',
   "Dans la section Évaluations, notez votre professeur de 1 à 5 et laissez un commentaire optionnel. Une seule évaluation par professeur est autorisée."],
  ["Comment consulter les annonces de l'administration ?",
   "Les annonces publiées apparaissent sur la page d'accueil, filtrées selon votre filière et niveau."],

  // Notes & Moyennes
  ['Comment est calculée ma moyenne générale ?',
   "Votre moyenne générale est calculée en pondérant chaque note de module par son coefficient : Moyenne = Somme(note × coefficient) / Somme(coefficient)."],
  ['Quelle est la différence entre la note de CC et la note d\'examen ?',
   "La note de CC évalue votre travail tout au long du semestre (devoirs, exposés, participation), tandis que la note d'examen sanctionne l'évaluation finale du module."],
  ['Quelle moyenne dois-je avoir pour valider mon semestre ?',
   "La moyenne minimale de validation est généralement de 10/20. En dessous, vous pouvez être autorisé à un rattrapage selon le règlement de votre filière."],
  ['Comment savoir si j\'ai validé un module ?',
   "Un module est validé si la moyenne pondérée (CC + Examen selon le coefficient défini) atteint au moins 10/20, sauf indication contraire de votre filière."],
  ['Quelle est la signification des mentions (Très Bien, Bien, etc.) ?',
   "Très Bien à partir de 16/20, Bien entre 14 et 16, Assez Bien entre 12 et 14, Passable entre 10 et 12, et en dessous de 10 c'est jugé Insuffisant."],
  ['Pourquoi je ne vois pas encore mes notes pour un module ?',
   "Les notes sont publiées par votre professeur une fois la session de notation clôturée. Si elles tardent, vérifiez auprès de votre enseignant ou via une réclamation."],
  ['Comment comparer ma moyenne à celle de ma promotion ?',
   "Les statistiques globales (moyenne de promo, taux de réussite) sont consultables par l'administration ; vous pouvez en demander un aperçu via les annonces ou votre délégué de classe."],
  ['Que faire si je trouve une erreur dans une note saisie ?',
   "Déposez une réclamation dans la section dédiée, en précisant le module, la note actuelle et la justification de votre contestation."],

  // Objectifs de l'étudiant
  ['Comment puis-je suivre ma progression académique au fil du semestre ?',
   "Consultez régulièrement l'onglet Notes pour visualiser l'évolution de vos moyennes par module, et identifiez les matières à renforcer."],
  ['Quels objectifs dois-je me fixer en début de semestre ?',
   "Définissez une moyenne cible par module (au moins 12/20), priorisez les matières à fort coefficient, et planifiez des révisions régulières plutôt que de tout réviser la veille des examens."],
  ["Comment l'IA peut-elle m'aider à atteindre mes objectifs académiques ?",
   "Je peux vous aider à comprendre vos points faibles à partir de vos notes, vous proposer un planning de révision, clarifier des notions de cours, ou vous orienter vers les bonnes ressources de votre filière."],
  ['Quelle note dois-je obtenir à l\'examen pour valider un module si j\'ai une note de CC connue ?',
   "Donnez-moi votre note de CC, son coefficient et celui de l'examen, je peux calculer la note minimale nécessaire à l'examen pour atteindre 10/20 de moyenne."],
  ['Comment me fixer un objectif de mention pour la fin d\'année ?',
   "Calculez la moyenne nécessaire par module pour atteindre votre mention visée (ex. 14/20 pour Bien), puis suivez vos progrès régulièrement pour ajuster vos efforts."],
  ['Quels conseils pour améliorer ma moyenne dans une matière difficile ?',
   "Identifiez les notions mal maîtrisées, sollicitez votre professeur ou vos camarades via les canaux de discussion, et consultez les supports de cours disponibles dans l'app pour cette matière."],
];

async function run() {
  const client = await pool.connect();
  try {
    const userRes = await client.query(
      "SELECT id FROM users WHERE role = 'etudiant' ORDER BY id LIMIT 1"
    );
    if (userRes.rows.length === 0) {
      console.error("Aucun etudiant trouve en base. Inscrivez d'abord un etudiant via l'app.");
      process.exit(1);
    }
    const userId = userRes.rows[0].id;

    let inserted = 0;
    for (const [question, reponse] of qaPairs) {
      await client.query(
        `INSERT INTO ia_conversations (user_id, role, contenu) VALUES ($1, 'user', $2)`,
        [userId, question]
      );
      await client.query(
        `INSERT INTO ia_conversations (user_id, role, contenu) VALUES ($1, 'assistant', $2)`,
        [userId, reponse]
      );
      inserted += 2;
    }

    console.log(`${inserted} messages inseres dans ia_conversations pour l'utilisateur ${userId}.`);
  } catch (err) {
    console.error('Erreur seed ia_conversations:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

run();
