# Guide de Setup - Nouvelles Fonctionnalités

## 🚀 Étapes d'installation

### 1. Installer les dépendances

```bash
cd backend
npm install cloudinary
```

### 2. Configurer les variables d'environnement

Copier `.env.example` vers `.env` et ajouter/mettre à jour :

```env
# Cloudinary (OBLIGATOIRE pour les uploads)
CLOUDINARY_CLOUD_NAME=votre_cloud_name
CLOUDINARY_API_KEY=votre_api_key
CLOUDINARY_API_SECRET=votre_api_secret

# Supabase (déjà configuré)
SUPABASE_URL=votre_url
SUPABASE_ANON_KEY=votre_key
```

### 3. Créer les tables Supabase

Exécuter les requêtes SQL suivantes dans l'éditeur SQL de Supabase :

```sql
-- Table Annonces
CREATE TABLE IF NOT EXISTS annonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titre VARCHAR(255) NOT NULL,
  contenu TEXT NOT NULL,
  filiere VARCHAR(100),
  niveau VARCHAR(50),
  cibleRole VARCHAR(50) NOT NULL,
  statut VARCHAR(20) DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publie')),
  fichiers TEXT[] DEFAULT ARRAY[]::TEXT[],
  auteur UUID NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_annonces_filiere ON annonces(filiere);
CREATE INDEX idx_annonces_statut ON annonces(statut);
CREATE INDEX idx_annonces_auteur ON annonces(auteur);
CREATE INDEX idx_annonces_created ON annonces(createdAt DESC);

-- Table EDT
CREATE TABLE IF NOT EXISTS edt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filiere VARCHAR(100) NOT NULL,
  niveau VARCHAR(50) NOT NULL,
  anneeAcademique VARCHAR(20),
  pdfUrl VARCHAR(500) NOT NULL,
  archive BOOLEAN DEFAULT FALSE,
  archivedAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(filiere, niveau, anneeAcademique)
);

CREATE INDEX idx_edt_filiere_niveau ON edt(filiere, niveau);
CREATE INDEX idx_edt_archive ON edt(archive);
CREATE INDEX idx_edt_created ON edt(createdAt DESC);
```

### 4. Démarrer le serveur

```bash
npm run dev
# ou
npm start
```

Le serveur devrait afficher :
```
✅ Client Supabase configuré avec succès
Serveur demarre sur http://localhost:3000
```

---

## 🔍 Vérification de la configuration

### Test 1 : Vérifier les routes
```bash
curl http://localhost:3000/
# Réponse : { "message": "ScolarHub API — IST Ouaga 2000", "status": "OK" }
```

### Test 2 : Test upload (sans auth)
```bash
curl -X POST http://localhost:3000/api/annonces/test-id/fichier \
  -F "file=@./test.pdf"
# Devrait retourner : {"success":false,"message":"Token manquant ou invalide."}
```

### Test 3 : Test annonces
```bash
curl http://localhost:3000/api/annonces
# Devrait retourner la liste des annonces publiées
```

---

## 📊 Structure de données

### Annonce
```javascript
{
  id: "uuid",
  titre: "string",
  contenu: "string",
  filiere: "string | null",
  niveau: "string | null",
  cibleRole: "etudiant|professeur|admin",
  statut: "brouillon|publie",
  fichiers: ["url1", "url2", ...],
  auteur: "uuid",
  createdAt: "timestamp",
  updatedAt: "timestamp"
}
```

### EDT
```javascript
{
  id: "uuid",
  filiere: "string",
  niveau: "string",
  anneeAcademique: "string",
  pdfUrl: "string",
  archive: boolean,
  archivedAt: "timestamp|null",
  createdAt: "timestamp",
  updatedAt: "timestamp"
}
```

---

## 🔐 Sécurité

### Permissions par rôle

| Rôle | Annonces | EDT | Upload |
|------|----------|-----|--------|
| Étudiant | Lecture (publiées + filière) | Lecture (sa filière) | Oui (copies) |
| Professeur | CRUD (propres) | Lecture | Oui |
| Admin | CRUD (toutes) | CRUD (toutes) | Oui |
| Anonymous | Lecture (publiées) | Non | Non |

### Authentification
- Token JWT requis pour : POST, PUT, DELETE, PATCH, certains GET
- Token optionnel pour : GET /api/annonces, GET /api/edt/:id

### Validation des fichiers
- Types acceptés : PDF, JPG, JPEG, PNG
- Taille max : 10 MB
- Stockage : Cloudinary (sécurisé)

---

## 🐛 Dépannage

### Erreur : "Aucun fichier uploadé"
- Vérifier que le formulaire envoie `multipart/form-data`
- Vérifier que le paramètre s'appelle `file`

### Erreur : "Token manquant ou invalide"
- Vérifier que le token est inclus dans l'en-tête `Authorization: Bearer <token>`
- Vérifier que le token n'a pas expiré

### Erreur Cloudinary : "cloud_name not set"
- Vérifier que `CLOUDINARY_CLOUD_NAME` est défini dans `.env`
- Redémarrer le serveur après modification du `.env`

### Les annonces des étudiants ne sont pas visibles
- Vérifier que le statut est "publie"
- Vérifier que la filière correspond
- Vérifier que le rôle utilisateur est bien "etudiant"

### Les étudiants ne voient pas leur EDT
- Vérifier que l'étudiant a une filière et un niveau dans son profil
- Vérifier qu'un EDT existe pour cette filière/niveau
- Vérifier que l'EDT n'est pas archivé

---

## 📦 Fichiers modifiés/créés

### Créés
- ✅ `src/services/cloudinary.service.js` - Service Cloudinary
- ✅ `src/middleware/upload.middleware.js` - Middleware Multer
- ✅ `src/models/annonceModel.js` - Modèle Annonces
- ✅ `src/models/edtModel.js` - Modèle EDT
- ✅ `src/controllers/annonces.controller.js` - Contrôleur Annonces
- ✅ `src/controllers/edt.controller.js` - Contrôleur EDT
- ✅ `src/controllers/upload.controller.js` - Contrôleur Upload
- ✅ `src/routes/upload.routes.js` - Routes Upload
- ✅ `DOCUMENTATION_API.md` - Documentation

### Modifiés
- ✅ `src/routes/annonces.routes.js` - Routes Annonces complètes
- ✅ `src/routes/edt.routes.js` - Routes EDT complètes
- ✅ `server.js` - Ajout route /api/upload
- ✅ `package.json` - Ajout cloudinary
- ✅ `.env.example` - Variables Cloudinary ajoutées

---

## ✨ Fonctionnalités principales

### ✅ Annonces
- [x] GET /api/annonces - Récupérer avec filtres
- [x] GET /api/annonces/:id - Détail
- [x] POST /api/annonces - Créer (brouillon)
- [x] PUT /api/annonces/:id - Modifier
- [x] DELETE /api/annonces/:id - Supprimer
- [x] PATCH /api/annonces/:id/publier - Publier
- [x] POST /api/annonces/:id/fichier - Upload fichier

### ✅ EDT
- [x] GET /api/edt - EDT de l'étudiant
- [x] GET /api/edt/admin/all - Tous les EDT (admin)
- [x] GET /api/edt/:id - Détail EDT
- [x] POST /api/edt - Créer EDT
- [x] PUT /api/edt/:id - Modifier EDT
- [x] PATCH /api/edt/:id/archiver - Archiver
- [x] DELETE /api/edt/:id - Supprimer

### ✅ Upload
- [x] POST /api/upload/copie - Upload copie examen

---

## 🚀 Prochaines étapes recommandées

1. Configurer Cloudinary avec votre compte
2. Créer les tables dans Supabase
3. Tester les endpoints avec Postman/Insomnia
4. Mettre à jour la documentation du frontend
5. Ajouter des tests unitaires
6. Mettre en place des webhooks Cloudinary si nécessaire

---

## 📞 Questions fréquentes

**Q: Où sont stockés les fichiers ?**
R: Sur Cloudinary (cloud sécurisé), les URL sont stockées en base de données.

**Q: Puis-je tester sans Cloudinary ?**
R: Non, Cloudinary est requis. Cependant, vous pouvez utiliser le compte gratuit.

**Q: Comment les étudiants accèdent à leur EDT ?**
R: Via GET /api/edt avec leur token. Le serveur filtre automatiquement selon leur filière/niveau.

**Q: Les fichiers uploadés sont-ils publics ?**
R: Oui, mais seulement les URL. L'accès à l'annonce/EDT est contrôlé par les permissions.

**Q: Puis-je modifier une annonce publiée ?**
R: Oui, mais c'est l'auteur ou un admin qui peut le faire.
