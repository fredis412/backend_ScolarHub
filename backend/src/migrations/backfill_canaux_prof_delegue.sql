-- 1) Crée les canaux prof↔délégués manquants (un par prof + filière + niveau)
INSERT INTO canaux (nom, description, type, professeur_id, filiere_id, niveau, etablissement_id)
SELECT DISTINCT u.prenoms || ' ' || u.nom || ' · ' || f.nom || ' ' || x.niveau,
       'Coordination pédagogique — ' || f.nom || ' ' || x.niveau,
       'prof_delegue_niveau', x.professeur_id, x.filiere_id, x.niveau, f.etablissement_id
FROM (SELECT professeur_id, filiere_id, niveau FROM professeur_filieres
      UNION SELECT professeur_id, filiere_id, niveau FROM professeur_modules) x
JOIN users u ON u.id = x.professeur_id
JOIN filieres f ON f.id = x.filiere_id
WHERE x.niveau IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM canaux c WHERE c.type='prof_delegue_niveau'
      AND c.professeur_id=x.professeur_id AND c.filiere_id=x.filiere_id AND c.niveau=x.niveau);

-- 2) Ajoute les professeurs comme membres
INSERT INTO canal_membres (canal_id, user_id, role)
SELECT c.id, c.professeur_id, 'professeur' FROM canaux c
WHERE c.type='prof_delegue_niveau'
ON CONFLICT (canal_id, user_id) DO NOTHING;

-- 3) Ajoute les délégués / adjoints
INSERT INTO canal_membres (canal_id, user_id, role)
SELECT c.id, u.id, 'delegue' FROM canaux c
JOIN etudiants e ON e.filiere_id=c.filiere_id AND e.niveau=c.niveau
JOIN users u ON u.id=e.user_id AND LOWER(u.etudiant_role) IN ('delegue','delegue_adjoint')
WHERE c.type='prof_delegue_niveau'
ON CONFLICT (canal_id, user_id) DO NOTHING;
