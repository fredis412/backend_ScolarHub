# Documentation API - Nouvelles Fonctionnalités

## 📋 Résumé des modifications

Ce document détaille les fonctionnalités ajoutées au backend ScolarHub pour gérer :
1. **Annonces** - Gestion complète des annonces avec publication
2. **Emplois du Temps (EDT)** - Upload et distribution des calendriers
3. **Upload de fichiers** - Copies d'examen et autres documents via Cloudinary

---

## 🔧 Configuration Cloudinary

### Installation des dépendances
```bash
npm install cloudinary
```

### Configuration .env
Ajouter les variables suivantes à votre fichier `.env` :

```env
# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=votre_cloud_name
CLOUDINARY_API_KEY=votre_api_key
CLOUDINARY_API_SECRET=votre_api_secret
```

**Comment obtenir les credentials ?**
1. Créer un compte sur https://cloudinary.com
2. Aller dans le Dashboard
3. Copier le "Cloud Name"
4. Générer une API Key et Secret dans Settings > API Keys

---

## 📁 Structure des fichiers créés

```
backend/
├── src/
│   ├── services/
│   │   └── cloudinary.service.js          (Service pour uploads)
│   ├── middleware/
│   │   └── upload.middleware.js           (Middleware Multer + Cloudinary)
│   ├── models/
│   │   ├── annonceModel.js               (Modèle Annonces)
│   │   └── edtModel.js                   (Modèle EDT)
│   ├── controllers/
│   │   ├── annonces.controller.js        (Contrôleur Annonces)
│   │   ├── edt.controller.js             (Contrôleur EDT)
│   │   └── upload.controller.js          (Contrôleur Upload)
│   └── routes/
│       ├── annonces.routes.js            (Routes Annonces - MISE À JOUR)
│       ├── edt.routes.js                 (Routes EDT - MISE À JOUR)
│       └── upload.routes.js              (Routes Upload)
├── server.js                              (MISE À JOUR - nouvelle route d'upload)
└── package.json                           (MISE À JOUR - cloudinary ajouté)
```

---

## 🔌 API Endpoints

### 1. ANNONCES

#### GET /api/annonces
Récupérer les annonces filtrées selon le rôle et la filière de l'utilisateur.

**Paramètres de requête :**
```
?filiere=IST&niveau=L2&statut=publie&limit=20&offset=0
```

**Réponse :**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "uuid",
      "titre": "Réunion importante",
      "contenu": "Réunion le 15/06",
      "filiere": "IST",
      "niveau": "L2",
      "cibleRole": "etudiant",
      "statut": "publie",
      "fichiers": ["https://..."],
      "auteur": "uuid",
      "createdAt": "2024-06-05T...",
      "updatedAt": "2024-06-05T..."
    }
  ]
}
```

**Règles de visibilité :**
- **Étudiants** : voient uniquement les annonces publiées de leur filière
- **Professeurs/Admins** : voient toutes les annonces
- **Non authentifiés** : voient uniquement les annonces publiées

---

#### GET /api/annonces/:id
Récupérer une annonce spécifique.

**Réponse :**
```json
{
  "success": true,
  "data": { /* annonce complète */ }
}
```

---

#### POST /api/annonces
Créer une nouvelle annonce (statut par défaut : "brouillon").

**En-têtes :**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Corps :**
```json
{
  "titre": "Annonce importante",
  "contenu": "Contenu de l'annonce...",
  "filiere": "IST",
  "niveau": "L2",
  "cibleRole": "etudiant|professeur|admin"
}
```

**Permissions :** Admin ou Professeur

**Réponse :**
```json
{
  "success": true,
  "message": "Annonce créée avec succès.",
  "data": { /* annonce */ }
}
```

---

#### PUT /api/annonces/:id
Modifier une annonce (auteur ou admin).

**Corps :**
```json
{
  "titre": "Nouveau titre",
  "contenu": "Nouveau contenu",
  "filiere": "IST",
  "niveau": "L3",
  "cibleRole": "etudiant"
}
```

---

#### DELETE /api/annonces/:id
Supprimer une annonce (auteur ou admin).

**Réponse :**
```json
{
  "success": true,
  "message": "Annonce supprimée avec succès."
}
```

---

#### PATCH /api/annonces/:id/publier
Publier une annonce brouillon.

**Réponse :**
```json
{
  "success": true,
  "message": "Annonce publiée avec succès.",
  "data": { /* annonce avec statut="publie" */ }
}
```

---

#### POST /api/annonces/:id/fichier
Upload un fichier (PDF, JPG, JPEG, PNG) à une annonce.

**En-têtes :**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Paramètres :**
- `file` (FormData) : Le fichier à uploader

**Réponse :**
```json
{
  "success": true,
  "message": "Fichier uploadé avec succès.",
  "url": "https://res.cloudinary.com/...",
  "data": { /* annonce mise à jour */ }
}
```

**Contraintes :**
- Taille max : 10 MB
- Formats acceptés : PDF, JPG, JPEG, PNG

---

### 2. EMPLOI DU TEMPS (EDT)

#### GET /api/edt
Récupérer l'EDT de l'étudiant connecté (selon sa filière et niveau).

**En-têtes :**
```
Authorization: Bearer <token>
```

**Réponse :**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "filiere": "IST",
    "niveau": "L2",
    "anneeAcademique": "2024-2025",
    "pdfUrl": "https://res.cloudinary.com/...",
    "archive": false,
    "createdAt": "2024-06-05T...",
    "updatedAt": "2024-06-05T..."
  }
}
```

---

#### GET /api/edt/admin/all
Récupérer tous les EDT (admin seulement).

**Paramètres de requête :**
```
?filiere=IST&niveau=L2&anneeAcademique=2024-2025&includeArchives=false&limit=50&offset=0
```

**Permissions :** Admin uniquement

---

#### GET /api/edt/:id
Récupérer un EDT spécifique par son ID.

---

#### POST /api/edt
Créer/Uploader un nouvel EDT.

**En-têtes :**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Paramètres :**
- `file` (FormData) : PDF de l'EDT
- `filiere` (string) : Nom de la filière
- `niveau` (string) : Niveau (ex: L1, L2, L3)
- `anneeAcademique` (string, optionnel) : Année académique (par défaut : année actuelle)

**Permissions :** Admin uniquement

**Réponse :**
```json
{
  "success": true,
  "message": "Emploi du temps créé avec succès.",
  "data": { /* EDT */ }
}
```

---

#### PUT /api/edt/:id
Mettre à jour un EDT (avec possibilité de changer le PDF).

**Paramètres :**
- `filiere` (string, optionnel)
- `niveau` (string, optionnel)
- `anneeAcademique` (string, optionnel)
- `file` (FormData, optionnel) : Nouveau PDF

**Permissions :** Admin uniquement

---

#### PATCH /api/edt/:id/archiver
Archiver un EDT (suppression logique).

**Permissions :** Admin uniquement

**Réponse :**
```json
{
  "success": true,
  "message": "EDT archivé avec succès.",
  "data": { /* EDT avec archive=true */ }
}
```

---

#### DELETE /api/edt/:id
Supprimer définitivement un EDT.

**Permissions :** Admin uniquement

---

### 3. UPLOAD DE FICHIERS

#### POST /api/upload/copie
Upload une copie d'examen (pour les réclamations).

**En-têtes :**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Paramètres :**
- `file` (FormData) : Image ou PDF de la copie

**Réponse :**
```json
{
  "success": true,
  "message": "Fichier uploadé avec succès.",
  "url": "https://res.cloudinary.com/..."
}
```

**Contraintes :**
- Taille max : 10 MB
- Formats acceptés : PDF, JPG, JPEG, PNG

---

## 🗄️ Schéma Supabase requis

### Table `annonces`
```sql
CREATE TABLE annonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titre VARCHAR(255) NOT NULL,
  contenu TEXT NOT NULL,
  filiere VARCHAR(100),
  niveau VARCHAR(50),
  cibleRole VARCHAR(50) NOT NULL,
  statut VARCHAR(20) DEFAULT 'brouillon', -- 'brouillon' ou 'publie'
  fichiers TEXT[] DEFAULT ARRAY[]::TEXT[],
  auteur UUID NOT NULL REFERENCES auth.users(id),
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_statut CHECK (statut IN ('brouillon', 'publie'))
);

CREATE INDEX idx_annonces_filiere ON annonces(filiere);
CREATE INDEX idx_annonces_statut ON annonces(statut);
CREATE INDEX idx_annonces_auteur ON annonces(auteur);
```

### Table `edt`
```sql
CREATE TABLE edt (
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
```

---

## 🔐 Authentification

Toutes les opérations nécessitant l'authentification doivent inclure un token JWT :

```
Authorization: Bearer <token>
```

Le token est généralement obtenu à la connexion via `/api/auth/login`.

---

## 🚨 Codes d'erreur

| Code | Message | Cause |
|------|---------|-------|
| 400 | Données manquantes | Paramètres requis non fournis |
| 401 | Token manquant ou invalide | Pas d'authentification |
| 403 | Accès refusé | Permissions insuffisantes |
| 404 | Ressource non trouvée | ID invalide ou inexistant |
| 500 | Erreur serveur | Problème serveur interne |

---

## 📝 Exemples d'utilisation

### Créer une annonce
```bash
curl -X POST http://localhost:3000/api/annonces \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "titre": "Réunion de rentrée",
    "contenu": "Réunion le 10 septembre à 14h",
    "filiere": "IST",
    "niveau": "L1",
    "cibleRole": "etudiant"
  }'
```

### Publier une annonce
```bash
curl -X PATCH http://localhost:3000/api/annonces/<id>/publier \
  -H "Authorization: Bearer <token>"
```

### Upload un fichier à une annonce
```bash
curl -X POST http://localhost:3000/api/annonces/<id>/fichier \
  -H "Authorization: Bearer <token>" \
  -F "file=@./document.pdf"
```

### Upload un EDT
```bash
curl -X POST http://localhost:3000/api/edt \
  -H "Authorization: Bearer <token>" \
  -F "file=@./edt_ist_l1.pdf" \
  -F "filiere=IST" \
  -F "niveau=L1" \
  -F "anneeAcademique=2024-2025"
```

### Upload une copie d'examen
```bash
curl -X POST http://localhost:3000/api/upload/copie \
  -H "Authorization: Bearer <token>" \
  -F "file=@./copie_examen.jpg"
```

---

## ✅ Tests recommandés

1. **Tester les permissions** : Vérifier qu'un étudiant ne peut pas créer d'annonce
2. **Tester les filtres** : Vérifier que les filtres par filière/niveau fonctionnent
3. **Tester les uploads** : Vérifier que seuls les formats autorisés sont acceptés
4. **Tester la limite de taille** : Vérifier que les fichiers > 10MB sont rejetés
5. **Tester la publication** : Vérifier que les annonces en brouillon ne sont pas visibles aux étudiants

---

## 🔄 Flux type

### Créer et publier une annonce
1. Admin crée une annonce → `POST /api/annonces` (statut: "brouillon")
2. Admin peut ajouter des fichiers → `POST /api/annonces/:id/fichier`
3. Admin publie l'annonce → `PATCH /api/annonces/:id/publier` (statut: "publie")
4. Les étudiants voient l'annonce → `GET /api/annonces`

### Gérer les EDT
1. Admin upload un EDT → `POST /api/edt`
2. Les étudiants récupèrent leur EDT → `GET /api/edt`
3. Admin peut archiver l'ancien → `PATCH /api/edt/:id/archiver`
4. Admin peut voir tous les EDT → `GET /api/edt/admin/all`

---

## 📞 Support

Pour toute question ou problème :
- Vérifier les logs serveur
- S'assurer que Cloudinary est correctement configuré
- Vérifier les permissions utilisateur
- Consulter la documentation Supabase pour les problèmes de base de données
