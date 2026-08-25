# Résumé des modifications - Backend ScolarHub

## 📝 Overview

Ajout de 3 fonctionnalités majeures au backend Express/Supabase :
1. **Gestion des Annonces** - CRUD complet avec publication et uploads
2. **Gestion des EDT** - Upload de PDFs avec distribution par filière/niveau
3. **Upload de fichiers** - Service Cloudinary pour images et PDFs

---

## 📦 Fichiers créés

### 1. Services
```
✅ src/services/cloudinary.service.js (2.4 KB)
   - uploadFile() : Upload sur Cloudinary
   - deleteFile() : Suppression de fichier
   - extractPublicId() : Extraction d'ID public
```

### 2. Middlewares
```
✅ src/middleware/upload.middleware.js (2.0 KB)
   - upload : Configuration Multer (mémoire, 10MB, formats)
   - uploadToCloudinary() : Middleware de chaînage
   - Formats acceptés : PDF, JPG, JPEG, PNG
```

### 3. Modèles (Supabase)
```
✅ src/models/annonceModel.js (5.0 KB)
   - findAll() : Avec filtres (filière, niveau, rôle, statut)
   - findById()
   - create() : Statut par défaut "brouillon"
   - update()
   - delete()
   - addFile() : Ajouter fichier au tableau
   - removeFile() : Supprimer fichier
   - publish() : Changer statut en "publie"

✅ src/models/edtModel.js (4.5 KB)
   - findAll() : Avec filtres et pagination
   - findById()
   - findByFilierAndNiveau() : EDT étudiant spécifique
   - create()
   - update()
   - archive() : Suppression logique
   - delete() : Suppression physique
```

### 4. Contrôleurs
```
✅ src/controllers/annonces.controller.js (9.0 KB)
   - getAllAnnonces() : Filtrage par rôle/filière
   - getAnnonceById()
   - createAnnonce()
   - updateAnnonce()
   - deleteAnnonce()
   - publishAnnonce()
   - uploadAnnonceFile() : Upload Cloudinary

✅ src/controllers/edt.controller.js (6.7 KB)
   - getStudentEdt() : EDT filière/niveau de l'étudiant
   - getAllEdt() : Admin seulement
   - getEdtById()
   - createEdt() : Upload PDF
   - updateEdt()
   - archiveEdt()
   - deleteEdt()

✅ src/controllers/upload.controller.js (0.7 KB)
   - uploadExamCopy() : Upload copie examen
```

### 5. Routes
```
✅ src/routes/upload.routes.js (0.6 KB)
   - POST /api/upload/copie : Upload copie examen

🔄 MODIFIÉ : src/routes/annonces.routes.js (1.5 KB)
   - Remplacé prototype stub par routes complètes
   - 7 endpoints : GET, GET/:id, POST, PUT, DELETE, PATCH, POST/:id/fichier
   - Authentification et permissions

🔄 MODIFIÉ : src/routes/edt.routes.js (1.6 KB)
   - Remplacé prototype stub par routes complètes
   - 7 endpoints : GET, GET/admin/all, GET/:id, POST, PUT, PATCH, DELETE
   - Authentification et permissions (admin)
```

### 6. Configuration
```
🔄 MODIFIÉ : server.js (ligne 38)
   - Ajout : app.use('/api/upload', require('./src/routes/upload.routes'));

🔄 MODIFIÉ : package.json
   - Ajout : "cloudinary": "^1.40.0"

🔄 MODIFIÉ : .env.example
   - Ajout variables Cloudinary
   - Ajout variables Supabase
```

### 7. Documentation
```
✅ DOCUMENTATION_API.md (11.8 KB)
   - Guide complet des endpoints
   - Exemples d'utilisation
   - Schémas de données
   - Codes d'erreur

✅ SETUP_GUIDE.md (7.5 KB)
   - Instructions d'installation
   - Configuration Supabase
   - Dépannage
   - Questions fréquentes
```

---

## 🔌 Routes ajoutées

### Annonces (7 routes)
```
GET    /api/annonces              - Liste filtrée
GET    /api/annonces/:id          - Détail
POST   /api/annonces              - Créer (brouillon)
PUT    /api/annonces/:id          - Modifier
DELETE /api/annonces/:id          - Supprimer
PATCH  /api/annonces/:id/publier  - Publier
POST   /api/annonces/:id/fichier  - Upload fichier
```

### EDT (7 routes)
```
GET    /api/edt                   - EDT de l'étudiant
GET    /api/edt/admin/all         - Tous (admin)
GET    /api/edt/:id               - Détail
POST   /api/edt                   - Créer (upload PDF)
PUT    /api/edt/:id               - Modifier
PATCH  /api/edt/:id/archiver      - Archiver
DELETE /api/edt/:id               - Supprimer
```

### Upload (1 route)
```
POST   /api/upload/copie          - Upload copie examen
```

---

## 🔐 Authentification et permissions

### Annonces
- **GET** : Public (filtrées selon rôle)
- **GET/:id** : Public (avec filtres)
- **POST** : Admin, Professeur
- **PUT** : Auteur ou Admin
- **DELETE** : Auteur ou Admin
- **PATCH /publier** : Auteur ou Admin
- **POST /:id/fichier** : Auteur ou Admin

### EDT
- **GET** : Étudiant (filtre filière/niveau)
- **GET /admin/all** : Admin uniquement
- **GET/:id** : Authentifié
- **POST** : Admin uniquement
- **PUT** : Admin uniquement
- **PATCH /archiver** : Admin uniquement
- **DELETE** : Admin uniquement

### Upload
- **POST /copie** : Étudiant authentifié

---

## 📊 Structure de données

### Annonce (Supabase)
```javascript
{
  id: UUID,
  titre: String (255),
  contenu: Text,
  filiere: String (100) | null,
  niveau: String (50) | null,
  cibleRole: String (50), // 'etudiant', 'professeur', 'admin'
  statut: String, // 'brouillon' | 'publie'
  fichiers: Array<String>, // URLs Cloudinary
  auteur: UUID,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### EDT (Supabase)
```javascript
{
  id: UUID,
  filiere: String (100),
  niveau: String (50),
  anneeAcademique: String (20),
  pdfUrl: String (500), // URL Cloudinary
  archive: Boolean,
  archivedAt: Timestamp | null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## 🔧 Configuration Cloudinary

### Variables d'environnement requises
```env
CLOUDINARY_CLOUD_NAME=votre_cloud_name
CLOUDINARY_API_KEY=votre_api_key
CLOUDINARY_API_SECRET=votre_api_secret
```

### Constraints
- Taille max fichier : 10 MB
- Formats acceptés : PDF, JPG, JPEG, PNG
- Dossiers Cloudinary : scolarhub/annonces, scolarhub/edt, scolarhub/copies-examen

---

## ✨ Fonctionnalités clés

### Annonces
- ✅ Filtrage multi-critères (filière, niveau, rôle, statut)
- ✅ Contrôle de visibilité par rôle (étudiants ne voient que publiées)
- ✅ Brouillon → Publication workflow
- ✅ Upload multiple de fichiers (PDF, images)
- ✅ Gestion des permissions (auteur, admin)

### EDT
- ✅ Distribution automatique par filière/niveau
- ✅ Upload de PDFs via Cloudinary
- ✅ Archivage (soft delete)
- ✅ Gestion par année académique
- ✅ Authentification requise pour étudiants

### Upload
- ✅ Validation de type de fichier
- ✅ Limitation de taille (10 MB)
- ✅ Stockage sur Cloudinary
- ✅ Retour d'URL sécurisée

---

## 🧪 Tests recommandés

### Test 1 : Authentification
```bash
# Sans token - devrait refuser
curl -X POST http://localhost:3000/api/annonces/123/fichier

# Avec token expiré - devrait refuser
curl -X POST http://localhost:3000/api/annonces/123/fichier \
  -H "Authorization: Bearer invalid_token"
```

### Test 2 : Permissions
```bash
# Étudiant crée annonce - devrait refuser
curl -X POST http://localhost:3000/api/annonces \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{"titre":"Test","contenu":"Test","cibleRole":"etudiant"}'
```

### Test 3 : Filtrage
```bash
# Récupérer annonces d'une filière
curl http://localhost:3000/api/annonces?filiere=IST&statut=publie

# Étudiant ne voit que les publiées
curl http://localhost:3000/api/annonces \
  -H "Authorization: Bearer <student_token>"
```

### Test 4 : Upload de fichier
```bash
# Upload avec bon format
curl -X POST http://localhost:3000/api/annonces/123/fichier \
  -H "Authorization: Bearer <token>" \
  -F "file=@./document.pdf"

# Upload avec mauvais format - devrait refuser
curl -X POST http://localhost:3000/api/annonces/123/fichier \
  -H "Authorization: Bearer <token>" \
  -F "file=@./video.mp4"
```

---

## 📋 Checklist d'intégration

- [ ] Installer cloudinary : `npm install cloudinary`
- [ ] Configurer Cloudinary dans `.env`
- [ ] Créer tables dans Supabase (SQL dans SETUP_GUIDE.md)
- [ ] Tester les routes avec Postman/Insomnia
- [ ] Vérifier les permissions par rôle
- [ ] Tester les uploads de fichiers
- [ ] Vérifier les filtres de visibilité
- [ ] Mettre à jour la documentation du frontend
- [ ] Ajouter les routes dans l'UI du frontend
- [ ] Tester end-to-end

---

## 🚀 Prochaines étapes possibles

1. **Webhooks Cloudinary** - Notifications de suppression
2. **Quotas d'upload** - Limiter par utilisateur
3. **Compression d'images** - Optimiser les PDFs
4. **Notifications** - Alerter étudiants des nouvelles annonces
5. **Partage d'EDT** - Export calendrier (iCal)
6. **Commentaires** - Discussion sur annonces
7. **Versions** - Historique des EDT

---

## ⚠️ Notes importantes

- Les fichiers sont stockés **sur Cloudinary** (cloud), pas localement
- Les URLs Cloudinary sont **publiques** mais l'accès à la ressource est **contrôlé par permissions**
- Les annonces en **brouillon ne sont visibles que par admin/auteur**
- Les étudiants ne voient l'EDT que s'il correspond à **leur filière ET niveau**
- L'archivage EDT est **soft delete** (conservation des données)
- Tous les uploads sont **validés** (type, taille)

---

## 📞 Support

- Consulter `DOCUMENTATION_API.md` pour details des endpoints
- Consulter `SETUP_GUIDE.md` pour troubleshooting
- Vérifier les logs serveur pour erreurs
- Vérifier la configuration Cloudinary dans dashboard
