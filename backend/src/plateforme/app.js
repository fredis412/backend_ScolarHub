(function () {
  'use strict';
  var API = '/api/plateforme';
  var cle = '';
  try { cle = sessionStorage.getItem('plateforme_cle') || ''; } catch (e) {}

  var $ = function (id) { return document.getElementById(id); };
  var PAR_PAGE = 5;
  var TYPES = { superieur: 'Enseignement supérieur', lycee: 'Lycée', college: 'Collège', primaire: 'Primaire', autre: 'Autre' };
  var PAGES = {
    vue: { titre: "Vue d'ensemble", icone: 'home', lien: '#/' },
    etabs: { titre: 'Établissements', icone: 'building', lien: '#/etablissements' },
    admins: { titre: 'Administrateurs', icone: 'users', lien: '#/administrateurs' },
    activite: { titre: 'Activité & sécurité', icone: 'shield', lien: '#/activite' },
    params: { titre: 'Paramètres', icone: 'gear', lien: '#/parametres' }
  };
  var etat = { etabs: [], stats: null, activite: [], activiteTotal: 0, journalAbsent: false, admins: [], adminsQ: '',
               q: '', ville: '', statut: '', onglet: 'tous', n: 1, page: 'vue', menuOuvert: null };

  // ── Icônes (traits) ───────────────────────────────────────────────────────
  var P = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    building: '<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-5h6v5"/><path d="M9 11h.01M12 11h.01M15 11h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14c2.6 0 4.5 1.8 4.5 4.5"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 003.4 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    dots: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    student: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>',
    teacher: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>'
  };
  function ico(n) { return '<svg class="i" viewBox="0 0 24 24">' + (P[n] || '') + '</svg>'; }

  // ── Utilitaires ───────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function d2(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d2(d.getDate()) + '/' + d2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + d2(d.getHours()) + ':' + d2(d.getMinutes());
  }
  function toast(texte, ok) {
    var t = $('toast');
    t.textContent = texte;
    t.className = ok ? 'ok' : 'err';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'hidden'; }, 4500);
  }
  function appel(methode, chemin, corps) {
    return fetch(API + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'x-platform-key': cle },
      body: corps ? JSON.stringify(corps) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    }).catch(function () { return { success: false, message: 'Serveur injoignable.', _status: 0 }; });
  }
  var COULEURS = [['var(--br-soft)', 'var(--br)'], ['var(--vi-soft)', 'var(--vi)'], ['var(--ok-soft)', 'var(--ok)'], ['var(--wa-soft)', 'var(--wa)']];
  function tuile(e) {
    var c = COULEURS[e.id % COULEURS.length];
    var img = e.photo_accueil_url || e.logo_url;
    var repli = '<div class="tile" style="background:' + c[0] + ';color:' + c[1] + '">' + ico('building') + '</div>';
    if (img) {
      img = String(img).replace(/^http:\/\//i, 'https://');
      // Si l'image ne se charge pas (lien mort, ancien fichier), on revient à l'icône au lieu d'un cadre cassé.
      return '<div class="tile" style="background:#fff;border:1px solid var(--bd,#e5e9f2)"><img src="' + esc(img) + '" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:11px" onerror="var t=this.parentNode;t.outerHTML=this.getAttribute(\'data-repli\')" data-repli="' + esc(repli) + '"></div>';
    }
    return repli;
  }
  // Envoi du logo (multipart) : seulement si l'école n'en a pas encore.
  function envoyerLogo(id, fichier) { // photo d'accueil
    var fd = new FormData();
    fd.append('file', fichier);
    return fetch(API + '/etablissements/' + id + '/photo-accueil', { method: 'POST', headers: { 'x-platform-key': cle }, body: fd })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); })
      .catch(function () { return { success: false, message: 'Serveur injoignable.' }; });
  }
  function logoInvalide(f) {
    if (!f) return '';
    if (!/\.(png|jpe?g)$/i.test(f.name)) return 'La photo doit être une image PNG ou JPG.';
    if (f.size > 2 * 1024 * 1024) return 'La photo ne doit pas dépasser 2 Mo.';
    return '';
  }
  function etabParId(id) { return etat.etabs.filter(function (e) { return String(e.id) === String(id); })[0]; }

  // ── Connexion ─────────────────────────────────────────────────────────────
  function montrerLogin(texte) {
    $('app').className = 'app hidden';
    $('login').className = 'login';
    var er = $('loginErr');
    if (texte) { er.textContent = texte; er.className = 'err'; } else { er.className = 'err hidden'; }
  }
  function montrerApp() {
    $('login').className = 'login hidden';
    $('app').className = 'app';
  }
  function seConnecter(journalise) {
    var chemin = journalise ? { m: 'POST', c: '/connexion' } : { m: 'GET', c: '/stats' };
    return appel(chemin.m, chemin.c).then(function (j) {
      if (j._status === 401 || j._status === 503 || j._status === 429 || j._status === 0) {
        montrerLogin(j.message || 'Accès refusé.');
        return false;
      }
      try { sessionStorage.setItem('plateforme_cle', cle); } catch (e) {}
      montrerApp();
      return charger();
    });
  }
  $('btnConnexion').addEventListener('click', function () {
    cle = $('cle').value.trim();
    if (!cle) return;
    seConnecter(true);
  });
  $('cle').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') $('btnConnexion').click(); });
  function deconnexion() {
    cle = '';
    try { sessionStorage.removeItem('plateforme_cle'); } catch (e) {}
    $('cle').value = '';
    montrerLogin('');
  }

  // ── Chargement des données ────────────────────────────────────────────────
  function charger() {
    return Promise.all([
      appel('GET', '/etablissements'), appel('GET', '/stats'), appel('GET', '/activite?limit=' + (etat.page === 'activite' ? 50 : 5))
    ]).then(function (r) {
      if (!r[0].success) { toast(r[0].message || 'Erreur de chargement.', false); return false; }
      etat.etabs = r[0].data || [];
      etat.stats = r[1].success ? r[1].data : null;
      if (r[2].success) { etat.activite = r[2].data; etat.activiteTotal = r[2].total || 0; etat.journalAbsent = !!r[2].journal_absent; }
      rendre();
      return true;
    });
  }

  // ── Routage ───────────────────────────────────────────────────────────────
  function pageCourante() {
    var h = (location.hash || '#/').replace('#/', '');
    if (h === 'etablissements') return 'etabs';
    if (h === 'administrateurs') return 'admins';
    if (h === 'activite') return 'activite';
    if (h === 'parametres') return 'params';
    return 'vue';
  }
  window.addEventListener('hashchange', function () {
    var prec = etat.page;
    etat.page = pageCourante();
    $('side').className = 'side';
    if (etat.page === 'activite' && prec !== 'activite') charger(); else rendre();
  });

  function rendreMenu() {
    $('nav').innerHTML = Object.keys(PAGES).map(function (k) {
      return '<a href="' + PAGES[k].lien + '" class="' + (etat.page === k ? 'on' : '') + '">' + ico(PAGES[k].icone) + PAGES[k].titre + '</a>';
    }).join('');
    $('crumb').innerHTML = 'Plateforme &nbsp;/&nbsp; <b>' + esc(PAGES[etat.page].titre) + '</b>';
  }

  function rendre() {
    rendreMenu();
    $('btnLogout').innerHTML = ico('logout') + ' Déconnexion';
    $('icoSearch').innerHTML = ico('search');
    $('bell').innerHTML = ico('bell');
    var p = $('page');
    if (etat.page === 'vue') { p.innerHTML = htmlVue(); majTableau(); }
    else if (etat.page === 'etabs') { p.innerHTML = htmlEtabs(); majTableau(); }
    else if (etat.page === 'admins') { p.innerHTML = htmlAdmins(); chargerAdmins(); }
    else if (etat.page === 'activite') { p.innerHTML = htmlActivite(); }
    else { p.innerHTML = htmlParams(); }
  }

  function entete(titre, sous, avecBouton) {
    return '<div class="head"><div><h1>' + esc(titre) + '</h1><div class="mu">' + esc(sous) + '</div></div>' +
      (avecBouton ? '<button class="btn" data-a="nouvel">' + ico('plus') + ' Nouvel établissement</button>' : '') + '</div>';
  }

  // ── Page : Vue d'ensemble ─────────────────────────────────────────────────
  function htmlVue() {
    var s = etat.stats || { total: etat.etabs.length, actifs: 0, suspendus: 0, utilisateurs: 0 };
    function kpi(ic, bg, fg, l, n, d, lien) {
      return '<div class="kpi" data-go="' + lien + '"><div class="ic" style="background:' + bg + ';color:' + fg + '">' + ico(ic) + '</div>' +
        '<div><div class="l">' + l + '</div><div class="n">' + n + '</div><div class="d">' + d + '</div></div><span class="go">' + ico('arrow') + '</span></div>';
    }
    return entete('Gestion de la plateforme', 'Pilotez vos établissements et leurs accès depuis un espace unique.', true) +
      '<div class="kpis">' +
      kpi('building', 'var(--br-soft)', 'var(--br)', 'Établissements', s.total, 'Établissements enregistrés', '#/etablissements') +
      kpi('shield', 'var(--ok-soft)', 'var(--ok)', 'Actifs', s.actifs, 'Établissements opérationnels', '#/etablissements') +
      kpi('pause', 'var(--wa-soft)', 'var(--wa)', 'Suspendus', s.suspendus, 'Établissements suspendus', '#/etablissements') +
      kpi('users', 'var(--vi-soft)', 'var(--vi)', 'Utilisateurs inscrits', s.utilisateurs, 'Tous profils confondus', '#/administrateurs') +
      '</div>' + htmlCarteEtabs() +
      '<div class="duo">' + htmlSecurite() + htmlRecent() + '</div>';
  }
  function htmlSecurite() {
    return '<div class="card"><div class="secu" style="display:flex;gap:14px;align-items:flex-start">' +
      '<div style="width:46px;height:46px;border-radius:12px;background:var(--br);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">' + ico('shield') + '</div>' +
      '<div style="flex:1"><h2 style="font-size:18px">Accès &amp; sécurité</h2>' +
      '<div class="mu" style="margin-top:6px">La clé plateforme est vérifiée par le serveur et conservée seulement dans cet onglet. Au-delà de 10 essais ratés en 15 minutes, l\'accès est bloqué.</div>' +
      '<div class="badge-ok">' + ico('check') + ' Protection par clé active</div></div>' +
      '<button class="btn sec sm" data-go="#/activite">' + ico('eye') + ' Voir les détails</button></div></div>';
  }
  var LIBELLES = {
    creation: ['Établissement créé', 'g'], modification: ['Établissement modifié', 'b'], suspension: ['Établissement suspendu', 'r'],
    reactivation: ['Établissement réactivé', 'g'], super_admin: ['Super Admin ajouté', 'b'],
    connexion: ['Connexion à la plateforme', 'b'], echec_cle: ['Tentative de connexion refusée', 'r']
  };
  function ligneActivite(a) {
    var l = LIBELLES[a.type] || [a.type, 'b'];
    var titre = l[0] + (a.etablissement_sigle ? ' — ' + a.etablissement_sigle : '');
    var sous = a.etablissement_nom || a.detail || '';
    if (a.etablissement_nom && a.detail) sous = a.etablissement_nom + ' · ' + a.detail;
    return '<li><span class="dot ' + l[1] + '"></span><div><div class="tt">' + esc(titre) + '</div><div class="mu" style="font-size:12px">' + esc(sous) + '</div></div>' +
      '<span class="dt">' + esc(fmt(a.created_at)) + '</span></li>';
  }
  function htmlRecent() {
    var corps = etat.journalAbsent
      ? '<div class="vide">Le journal n\'est pas encore activé : exécutez <code>migration_plateforme_activite.sql</code> dans Supabase.</div>'
      : etat.activite.length ? '<ul class="tl">' + etat.activite.slice(0, 5).map(ligneActivite).join('') + '</ul>'
      : '<div class="vide">Aucune activité enregistrée pour le moment.</div>';
    return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:18px">' + ico('clock') + ' Activité récente</h2>' +
      '<button class="lien" data-go="#/activite">Voir tout ' + ico('arrow') + '</button></div>' + corps + '</div>';
  }

  // ── Tableau des établissements ────────────────────────────────────────────
  function htmlEtabs() {
    return entete('Établissements', 'Créez, modifiez et suspendez les établissements de la plateforme.', true) + htmlCarteEtabs();
  }
  function villes() {
    var vu = {};
    etat.etabs.forEach(function (e) { if (e.ville) vu[e.ville] = 1; });
    return Object.keys(vu).sort();
  }
  function htmlCarteEtabs() {
    return '<section class="card"><h2>Établissements enregistrés</h2>' +
      '<div class="tabs" id="tabsEtab"></div>' +
      '<div class="filtres"><div class="search" style="max-width:none;margin:0"><span>' + ico('search') + '</span>' +
      '<input id="fQ" type="search" placeholder="Rechercher un établissement…" value="' + esc(etat.q) + '"></div>' +
      '<div class="f"><small>Ville</small><select id="fVille"><option value="">Toutes</option>' +
      villes().map(function (v) { return '<option' + (v === etat.ville ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select></div>' +
      '<div class="f"><small>Statut</small><select id="fStatut"><option value="">Tous</option>' +
      '<option value="actif"' + (etat.statut === 'actif' ? ' selected' : '') + '>Actif</option>' +
      '<option value="suspendu"' + (etat.statut === 'suspendu' ? ' selected' : '') + '>Suspendu</option></select></div></div>' +
      '<div class="scroll"><table><thead><tr><th>Établissement</th><th>Code</th><th>Ville / Campus</th><th>Effectifs</th><th>Statut</th><th>Actions</th></tr></thead>' +
      '<tbody id="tbEtab"></tbody></table></div><div class="pied" id="piedEtab"></div></section>';
  }
  function filtres() {
    var q = etat.q.trim().toLowerCase();
    return etat.etabs.filter(function (e) {
      if (etat.onglet === 'actifs' && !e.actif) return false;
      if (etat.onglet === 'suspendus' && e.actif) return false;
      if (etat.statut === 'actif' && !e.actif) return false;
      if (etat.statut === 'suspendu' && e.actif) return false;
      if (etat.ville && e.ville !== etat.ville) return false;
      if (!q) return true;
      return [e.nom, e.sigle, e.code, e.ville, e.campus].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function majTableau() {
    var tb = $('tbEtab');
    if (!tb) return;
    var nbA = etat.etabs.filter(function (e) { return e.actif; }).length;
    var tabs = [['tous', 'Tous (' + etat.etabs.length + ')'], ['actifs', 'Actifs (' + nbA + ')'], ['suspendus', 'Suspendus (' + (etat.etabs.length - nbA) + ')']];
    $('tabsEtab').innerHTML = tabs.map(function (t) {
      return '<button class="tab' + (etat.onglet === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
    var liste = filtres();
    var nbPages = Math.max(1, Math.ceil(liste.length / PAR_PAGE));
    if (etat.n > nbPages) etat.n = nbPages;
    var debut = (etat.n - 1) * PAR_PAGE;
    var vue = liste.slice(debut, debut + PAR_PAGE);
    tb.innerHTML = vue.length ? vue.map(ligneEtab).join('') : '<tr><td colspan="6" class="vide">Aucun établissement ne correspond.</td></tr>';
    var pg = '';
    if (nbPages > 1) {
      pg = '<div class="pg"><button data-pg="-1">‹</button>';
      for (var i = 1; i <= nbPages; i++) pg += '<button data-pg="' + i + '" class="' + (i === etat.n ? 'on' : '') + '">' + i + '</button>';
      pg += '<button data-pg="+1">›</button></div>';
    }
    $('piedEtab').innerHTML = '<div>' + (liste.length ? 'Affichage de ' + (debut + 1) + ' à ' + (debut + vue.length) + ' sur ' + liste.length + ' établissement(s)' : '') + '</div>' + pg;
  }
  function ligneEtab(e) {
    var ouvert = String(etat.menuOuvert) === String(e.id);
    return '<tr><td><div class="etab">' + tuile(e) + '<div><b>' + esc(e.nom) + '</b><div class="mu" style="font-size:12px">' + esc(TYPES[e.type] || e.type || '') + '</div></div></div></td>' +
      '<td><span class="code">' + esc(e.code) + '</span></td>' +
      '<td><div>' + esc(e.ville || '—') + '</div><div class="mu" style="font-size:12px">' + esc(e.campus || '') + '</div></td>' +
      '<td><div class="eff">' + ico('student') + e.nb_etudiants + ' étudiant(s)<br>' + ico('teacher') + e.nb_professeurs + ' professeur(s)<br>' + ico('key') + e.nb_admins + ' administrateur(s)</div></td>' +
      '<td><span class="pill ' + (e.actif ? 'on' : 'off') + '">' + (e.actif ? 'Actif' : 'Suspendu') + '</span></td>' +
      '<td><div class="acts">' +
      '<button class="ib" title="Voir" data-a="voir" data-id="' + e.id + '">' + ico('eye') + '</button>' +
      '<button class="ib" title="Modifier" data-a="editer" data-id="' + e.id + '">' + ico('pencil') + '</button>' +
      '<button class="ib ' + (e.actif ? 'ko' : 'ok') + '" title="' + (e.actif ? 'Suspendre' : 'Réactiver') + '" data-a="basculer" data-id="' + e.id + '">' + ico(e.actif ? 'pause' : 'play') + '</button>' +
      '<button class="ib" title="Plus" data-a="menu" data-id="' + e.id + '">' + ico('dots') + '</button>' +
      (ouvert ? '<div class="menu">' +
        '<button data-a="copier" data-id="' + e.id + '">' + ico('copy') + ' Copier le code d\'accès</button>' +
        '<button data-a="inscription" data-id="' + e.id + '">' + ico('users') + ' Inscription en ligne : ' + (e.inscription_ouverte ? 'fermer' : 'ouvrir') + '</button>' +
        '</div>' : '') +
      '</div></td></tr>';
  }

  // ── Page : Administrateurs ────────────────────────────────────────────────
  function htmlAdmins() {
    return '<div class="head"><div><h1>Administrateurs</h1><div class="mu">Le Super Admin de chaque établissement (contact principal). Les autres membres de l\'administration sont gérés par l\'établissement lui-même.</div></div></div>' +
      '<div id="sansAdmin"></div><section class="card"><div class="search" style="max-width:420px;margin:0 0 14px"><span>' + ico('search') + '</span><input id="fAdm" type="search" placeholder="Rechercher un administrateur…" value="' + esc(etat.adminsQ) + '"></div>' +
      '<div class="scroll"><table><thead><tr><th>Administrateur</th><th>Contact</th><th>Établissement</th><th>Rôle</th><th>Statut</th></tr></thead><tbody id="tbAdm"><tr><td colspan="5" class="vide">Chargement…</td></tr></tbody></table></div></section>';
  }
  function chargerAdmins() {
    return appel('GET', '/administrateurs').then(function (j) {
      etat.admins = j.success ? j.data : [];
      majAdmins();
    });
  }
  function majAdmins() {
    var tb = $('tbAdm');
    if (!tb) return;
    var q = etat.adminsQ.trim().toLowerCase();
    var l = etat.admins.filter(function (a) { return !q || [a.nom, a.prenoms, a.email, a.matricule, a.etablissement_nom].join(' ').toLowerCase().indexOf(q) >= 0; });
    tb.innerHTML = l.length ? l.map(function (a) {
      var role = a.admin_sub_role === 'super_admin' ? 'Super Admin' : (a.admin_sub_role || 'Administrateur');
      return '<tr><td><b>' + esc(a.nom + ' ' + (a.prenoms || '')) + '</b><div class="mu" style="font-size:12px">' + esc(a.matricule || '') + '</div></td>' +
        '<td>' + esc(a.email || '—') + '<div class="mu" style="font-size:12px">' + esc(a.tel || '') + '</div></td>' +
        '<td>' + esc(a.etablissement_nom || '—') + '</td><td><span class="pill nb">' + esc(role) + '</span></td>' +
        '<td><span class="pill ' + (a.statut === 'actif' ? 'on' : 'off') + '">' + esc(a.statut || '') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="5" class="vide">Aucun administrateur.</td></tr>';
    var avec = {};
    etat.admins.forEach(function (a) { if (a.statut === 'actif') avec[a.etablissement_id] = 1; });
    var sans = etat.etabs.filter(function (e) { return !avec[e.id]; });
    var z = $('sansAdmin');
    if (z) z.innerHTML = sans.length ? '<div class="card" style="border-color:var(--wa)"><h3>Établissement(s) sans Super Admin actif</h3>' +
      sans.map(function (e) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0"><span>' + esc(e.nom) + '</span>' +
          '<button class="btn sec sm" data-a="ajoutadmin" data-id="' + e.id + '">Récupérer l\'accès</button></div>';
      }).join('') + '</div>' : '';
  }

  // ── Page : Activité & sécurité ────────────────────────────────────────────
  function htmlActivite() {
    var corps = etat.journalAbsent
      ? '<div class="vide">Le journal n\'est pas encore activé : exécutez <code>migration_plateforme_activite.sql</code> dans Supabase.</div>'
      : etat.activite.length ? '<ul class="tl">' + etat.activite.map(ligneActivite).join('') + '</ul>' : '<div class="vide">Aucune activité enregistrée.</div>';
    return entete('Activité & sécurité', 'Journal des actions effectuées depuis l\'espace plateforme.', false) + htmlSecurite() +
      '<section class="card"><h2>Journal d\'activité</h2>' + corps +
      (etat.activite.length < etat.activiteTotal ? '<div class="pied"><span>' + etat.activite.length + ' sur ' + etat.activiteTotal + ' affichés (les 50 plus récents)</span></div>' : '') + '</section>';
  }

  // ── Page : Paramètres ─────────────────────────────────────────────────────
  function htmlParams() {
    return entete('Paramètres', 'Réglages de l\'espace plateforme.', false) +
      '<section class="card"><h2>Session</h2><p class="mu">Votre clé plateforme est conservée uniquement dans cet onglet. Se déconnecter l\'efface immédiatement.</p>' +
      '<button class="btn sec" data-a="logout">' + ico('logout') + ' Se déconnecter</button></section>' +
      '<section class="card"><h2>Autres réglages</h2><p class="mu">D\'autres réglages (notifications, sauvegardes, modèles par défaut) seront ajoutés ici prochainement.</p></section>';
  }

  // ── Fenêtres ──────────────────────────────────────────────────────────────
  function ouvrir(html, petit) {
    $('modalBox').className = 'box' + (petit ? ' sm' : '');
    $('modalBox').innerHTML = html;
    $('modal').className = 'modal';
  }
  function fermer() { $('modal').className = 'modal hidden'; $('modalBox').innerHTML = ''; }
  function champ(nom, label, extra, val) {
    return '<div><label>' + label + '</label><input name="' + nom + '" ' + (extra || '') + ' value="' + esc(val || '') + '"></div>';
  }
  function optionsType(sel) {
    return Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + TYPES[k] + '</option>'; }).join('');
  }

  function modalNouvel() {
    ouvrir('<h2>Nouvel établissement</h2><div class="mu">Création de l\'école, de ses canaux standard et de son premier Super Admin.</div>' +
      '<form id="fNouvel"><div class="grid2">' + champ('nom', 'Nom complet *', 'required') + champ('sigle', 'Sigle *', 'required') +
      champ('ville', 'Ville') + champ('campus', 'Campus') +
      '<div><label>Type</label><select name="type">' + optionsType('superieur') + '</select></div>' +
      champ('code', 'Code d\'accès (vide = automatique)', 'placeholder="ex. UNIV2026"') + '</div>' +
      '<label>Modèle de matricule * <span class="mu">— jetons {AA}, {AAAA}, {NNNN} ; le reste est le texte fixe propre à l\'école</span></label>' +
      '<input name="modele_matricule" placeholder="{AA}IST-O2/{NNNN}" required>' +
      '<h3 style="margin-top:20px">Premier Super Admin</h3><div class="grid2">' + champ('a_nom', 'Nom *', 'required') + champ('a_prenoms', 'Prénoms') +
      champ('a_email', 'Email *', 'type="email" required') + champ('a_tel', 'Téléphone') +
      '<div><label>Mot de passe provisoire * (8 caractères min.)</label><input name="a_mdp" type="password" minlength="8" required autocomplete="new-password"></div></div>' +
      '<div class="mu" style="font-size:12px;margin-top:4px">Le Super Admin devra le remplacer par le sien dès sa première connexion.</div>' +
      '<h3 style="margin-top:20px">Photo d\'accueil <span class="mu" style="font-weight:400">(facultatif)</span></h3>' +
      '<input name="logo" type="file" accept="image/png,image/jpeg">' +
      '<div class="mu" style="font-size:12px;margin-top:4px">Image de bienvenue (photo d\'étudiants, affiche…) montrée quand les utilisateurs saisissent le code de l\'école. PNG ou JPG, 2 Mo max. Elle ne pourra plus être modifiée depuis cette page : l\'administration de l\'école la gère ensuite, ainsi que son logo officiel (bulletins, emplois du temps).</div>' +
      '<div id="resNouvel"></div><div class="btns"><button type="button" class="btn sec" data-a="fermer">Annuler</button>' +
      '<button class="btn" type="submit" id="btnCreer">Créer l\'établissement</button></div></form>');
  }
  function modalDetail(id) {
    var e = etabParId(id);
    if (!e) return;
    ouvrir('<div style="display:flex;gap:14px;align-items:center">' + tuile(e) + '<div><h2>' + esc(e.nom) + '</h2><div class="mu">' + esc(TYPES[e.type] || '') + ' · ' + esc(e.ville || '') + '</div></div></div>' +
      '<div class="kv">' +
      '<div><small>Code d\'accès</small><b>' + esc(e.code) + '</b></div><div><small>Sigle</small><b>' + esc(e.sigle) + '</b></div>' +
      '<div><small>Ville / Campus</small><b>' + esc((e.ville || '—') + (e.campus ? ' · ' + e.campus : '')) + '</b></div>' +
      '<div><small>Modèle de matricule</small><b>' + esc(e.modele_matricule || '—') + '</b></div>' +
      '<div><small>Inscription en ligne</small><b>' + (e.inscription_ouverte ? 'Ouverte' : 'Fermée') + '</b></div>' +
      '<div><small>Validation des inscriptions</small><b>' + (e.inscription_validation ? 'Par l\'administration' : 'Automatique') + '</b></div>' +
      '<div><small>Étudiants</small><b>' + e.nb_etudiants + '</b></div><div><small>Professeurs</small><b>' + e.nb_professeurs + '</b></div>' +
      '<div><small>Statut</small><b>' + (e.actif ? 'Actif' : 'Suspendu') + '</b></div></div>' +
      '<h3>Photo d\'accueil</h3>' + (e.photo_accueil_url
        ? '<div class="mu" style="font-size:12px">Photo définie. Elle est gérée par l\'administration de l\'école.</div>'
        : '<div class="mu" style="font-size:12px">Aucune photo d\'accueil. Vous pouvez en poser une maintenant ; ensuite seule l\'école pourra la modifier.</div>' +
          '<input id="logoTardif" data-id="' + e.id + '" type="file" accept="image/png,image/jpeg" style="margin-top:8px"><div id="resLogo"></div>') +
      '<h3>Super Admin</h3><div id="admDetail" class="mu">Chargement…</div>' +
      '<div class="btns">' +
      '<button class="btn sec" data-a="editer" data-id="' + e.id + '">' + ico('pencil') + ' Modifier</button>' +
      '<button class="btn" data-a="fermer">Fermer</button></div>');
    appel('GET', '/administrateurs?etablissement_id=' + e.id).then(function (j) {
      var z = $('admDetail');
      if (!z) return;
      var l = j.success ? j.data : [];
      var actif = l.filter(function (a) { return a.statut === 'actif'; }).length > 0;
      z.innerHTML = (l.length ? '<table><tbody>' + l.map(function (a) {
        return '<tr><td><b>' + esc(a.nom + ' ' + (a.prenoms || '')) + '</b></td><td>' + esc(a.email || '') + '</td><td><span class="pill ' +
          (a.statut === 'actif' ? 'on' : 'off') + '">' + esc(a.statut || '') + '</span></td></tr>';
      }).join('') + '</tbody></table>' : 'Aucun Super Admin.') +
        (actif ? '<div class="mu" style="font-size:12px;margin-top:8px">Les autres membres de l\'administration sont gérés par ce Super Admin depuis l\'application.</div>'
          : '<div class="err" style="margin-top:10px">Aucun Super Admin actif : l\'établissement ne peut plus gérer son administration. ' +
            '<button class="btn sm" style="margin-left:8px" data-a="ajoutadmin" data-id="' + e.id + '">Récupérer l\'accès</button></div>');
    });
  }
  function modalEditer(id) {
    var e = etabParId(id);
    if (!e) return;
    ouvrir('<h2>Modifier l\'établissement</h2><div class="mu">' + esc(e.nom) + '</div><form id="fEdit" data-id="' + e.id + '"><div class="grid2">' +
      champ('nom', 'Nom complet *', 'required', e.nom) + champ('sigle', 'Sigle *', 'required', e.sigle) +
      champ('ville', 'Ville', '', e.ville) + champ('campus', 'Campus', '', e.campus) +
      '<div><label>Type</label><select name="type">' + optionsType(e.type) + '</select></div>' +
      champ('code', 'Code d\'accès *', 'required', e.code) + '</div>' +
      '<label>Modèle de matricule *</label><input name="modele_matricule" required value="' + esc(e.modele_matricule || '') + '">' +
      '<div class="mu" style="font-size:12px;margin-top:4px">Attention : changer le code ou le modèle de matricule affecte la connexion et l\'inscription des étudiants.</div>' +
      '<label class="chk"><input type="checkbox" name="inscription_ouverte"' + (e.inscription_ouverte ? ' checked' : '') + '> Inscription en ligne ouverte</label>' +
      '<label class="chk"><input type="checkbox" name="inscription_validation"' + (e.inscription_validation ? ' checked' : '') + '> Les inscriptions doivent être validées par l\'administration</label>' +
      '<div class="btns"><button type="button" class="btn sec" data-a="fermer">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>');
  }
  function modalAjoutAdmin(id) {
    var choix = id ? '' : '<div><label>Établissement *</label><select name="etab" required><option value="">Choisir…</option>' +
      etat.etabs.map(function (e) { return '<option value="' + e.id + '">' + esc(e.nom) + '</option>'; }).join('') + '</select></div>';
    var e = id ? etabParId(id) : null;
    ouvrir('<h2>Récupérer l\'accès à l\'établissement</h2><div class="mu">' + (e ? esc(e.nom) + ' — ' : '') + 'Création d\'un nouveau Super Admin, uniquement parce qu\'aucun n\'est actif. L\'action est enregistrée dans le journal.</div>' +
      '<form id="fAdmin" data-id="' + (id || '') + '"><div class="grid2">' + choix + champ('nom', 'Nom *', 'required') + champ('prenoms', 'Prénoms') +
      champ('email', 'Email *', 'type="email" required') + champ('tel', 'Téléphone') +
      '<div><label>Mot de passe * (8 caractères min.)</label><input name="mdp" type="password" minlength="8" required autocomplete="new-password"></div></div>' +
      '<div id="resAdmin"></div><div class="btns"><button type="button" class="btn sec" data-a="fermer">Annuler</button><button class="btn" type="submit">Créer le Super Admin</button></div></form>');
  }
  function confirmerBascule(id) {
    var e = etabParId(id);
    if (!e) return;
    ouvrir('<h2>' + (e.actif ? 'Suspendre' : 'Réactiver') + ' « ' + esc(e.nom) + ' » ?</h2>' +
      '<p class="mu">' + (e.actif ? 'Plus personne de cet établissement ne pourra se connecter ni saisir son code d\'accès.' : 'Les utilisateurs de cet établissement pourront de nouveau se connecter.') + '</p>' +
      '<div class="btns"><button class="btn sec" data-a="fermer">Annuler</button><button class="btn ' + (e.actif ? 'ko' : '') + '" data-a="confirmer" data-id="' + e.id + '">' +
      (e.actif ? 'Suspendre' : 'Réactiver') + '</button></div>', true);
  }
  function modifier(id, corps, message) {
    return appel('PATCH', '/etablissements/' + id, corps).then(function (j) {
      toast(j.success ? message : (j.message || 'Erreur.'), !!j.success);
      if (j.success) { fermer(); charger(); }
      return j;
    });
  }

  // ── Événements (délégation) ───────────────────────────────────────────────
  document.addEventListener('click', function (ev) {
    var go = ev.target.closest('[data-go]');
    if (go) { location.hash = go.getAttribute('data-go'); return; }
    var tab = ev.target.closest('[data-tab]');
    if (tab) { etat.onglet = tab.getAttribute('data-tab'); etat.n = 1; majTableau(); return; }
    var pg = ev.target.closest('[data-pg]');
    if (pg) {
      var v = pg.getAttribute('data-pg');
      etat.n = v === '-1' ? Math.max(1, etat.n - 1) : v === '+1' ? etat.n + 1 : parseInt(v, 10);
      majTableau(); return;
    }
    var b = ev.target.closest('[data-a]');
    if (!b) {
      if (etat.menuOuvert !== null) { etat.menuOuvert = null; majTableau(); }
      if (ev.target === $('modal')) fermer();
      return;
    }
    var a = b.getAttribute('data-a');
    var id = b.getAttribute('data-id');
    if (a !== 'menu' && etat.menuOuvert !== null) { etat.menuOuvert = null; majTableau(); }
    if (a === 'nouvel') modalNouvel();
    else if (a === 'voir') modalDetail(id);
    else if (a === 'editer') modalEditer(id);
    else if (a === 'basculer') confirmerBascule(id);
    else if (a === 'confirmer') { var e = etabParId(id); if (e) modifier(id, { actif: !e.actif }, e.actif ? 'Établissement suspendu.' : 'Établissement réactivé.'); }
    else if (a === 'menu') { etat.menuOuvert = String(etat.menuOuvert) === String(id) ? null : id; majTableau(); ev.stopPropagation(); }
    else if (a === 'copier') {
      var ee = etabParId(id);
      if (ee && navigator.clipboard) navigator.clipboard.writeText(ee.code).then(function () { toast('Code copié : ' + ee.code, true); }, function () { toast(ee.code, true); });
      else if (ee) toast('Code : ' + ee.code, true);
    }
    else if (a === 'ajoutadmin') modalAjoutAdmin(id || '');
    else if (a === 'inscription') { var e2 = etabParId(id); if (e2) modifier(id, { inscription_ouverte: !e2.inscription_ouverte }, e2.inscription_ouverte ? 'Inscription en ligne fermée.' : 'Inscription en ligne ouverte.'); }
    else if (a === 'fermer') fermer();
    else if (a === 'logout') deconnexion();
  });
  $('btnLogout').addEventListener('click', deconnexion);
  $('burger').addEventListener('click', function () { $('side').classList.toggle('open'); });
  $('bell').addEventListener('click', function () { location.hash = '#/activite'; });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') fermer(); });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'fQ') { etat.q = t.value; etat.n = 1; majTableau(); }
    else if (t.id === 'recherche') {
      etat.q = t.value; etat.n = 1;
      if (etat.page !== 'vue' && etat.page !== 'etabs') location.hash = '#/etablissements'; else { var q = $('fQ'); if (q) q.value = etat.q; majTableau(); }
    }
    else if (t.id === 'fAdm') { etat.adminsQ = t.value; majAdmins(); }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'fVille') { etat.ville = t.value; etat.n = 1; majTableau(); }
    else if (t.id === 'fStatut') { etat.statut = t.value; etat.n = 1; majTableau(); }
    else if (t.id === 'logoTardif') {
      var fic = t.files && t.files[0], z = $('resLogo'), eid = t.getAttribute('data-id');
      var er = logoInvalide(fic);
      if (er) { z.innerHTML = '<div class="err">' + esc(er) + '</div>'; return; }
      z.innerHTML = '<div class="mu">Envoi…</div>';
      envoyerLogo(eid, fic).then(function (r) {
        if (r.success) { toast('Photo d\'accueil enregistrée.', true); fermer(); charger(); }
        else z.innerHTML = '<div class="err">' + esc(r.message || 'Erreur.') + '</div>';
      });
    }
  });

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    var v = function (n) { return f.elements[n] ? f.elements[n].value.trim() : ''; };
    var btn = f.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    var fin = function () { if (btn) btn.disabled = false; };

    if (f.id === 'fNouvel') {
      var fichierLogo = f.elements.logo && f.elements.logo.files ? f.elements.logo.files[0] : null;
      var errLogo = logoInvalide(fichierLogo);
      if (errLogo) { fin(); $('resNouvel').innerHTML = '<div class="err">' + esc(errLogo) + '</div>'; return; }
      appel('POST', '/etablissements', {
        nom: v('nom'), sigle: v('sigle'), ville: v('ville'), campus: v('campus'), type: v('type'), code: v('code'),
        modele_matricule: v('modele_matricule'),
        admin: { nom: v('a_nom'), prenoms: v('a_prenoms'), email: v('a_email'), tel: v('a_tel'), motDePasse: f.elements.a_mdp.value }
      }).then(function (j) {
        fin();
        var z = $('resNouvel');
        if (!j.success) { z.innerHTML = '<div class="err">' + esc(j.message || 'Erreur.') + '</div>'; return; }
        var d = j.data;
        f.querySelectorAll('input,select').forEach(function (x) { x.disabled = true; });
        var corps = function (avisLogo) {
          z.innerHTML = '<div class="ok-box"><b>Établissement créé.</b><br>Code d\'accès : <b>' + esc(d.etablissement.code) + '</b><br>Super Admin : ' +
            esc(d.super_admin.email) + ' · matricule <b>' + esc(d.super_admin.matricule) + '</b><br>Communiquez-lui le code et son mot de passe provisoire : il devra le changer à sa première connexion.' + (avisLogo || '') + '</div>';
          btn.className = 'hidden';
          charger();
        };
        if (!fichierLogo) { corps(''); return; }
        z.innerHTML = '<div class="mu">Envoi de la photo…</div>';
        envoyerLogo(d.etablissement.id, fichierLogo).then(function (r) {
          // L'école est déjà créée : un échec du logo ne l'annule pas.
          corps(r.success ? '<br>Photo d\'accueil enregistrée.' : '<br><b>Photo non enregistrée</b> (' + esc(r.message || 'erreur') + '). L\'école pourra l\'ajouter depuis son application, ou vous pouvez la poser ici tant qu\'elle est vide.');
        });
      });
    } else if (f.id === 'fEdit') {
      var id = f.getAttribute('data-id');
      modifier(id, {
        nom: v('nom'), sigle: v('sigle').toUpperCase(), ville: v('ville'), campus: v('campus'), type: v('type'), code: v('code'),
        modele_matricule: v('modele_matricule'),
        inscription_ouverte: f.elements.inscription_ouverte.checked, inscription_validation: f.elements.inscription_validation.checked
      }, 'Établissement mis à jour.').then(fin);
    } else if (f.id === 'fAdmin') {
      var cible = f.getAttribute('data-id') || v('etab');
      if (!cible) { fin(); toast('Choisissez un établissement.', false); return; }
      appel('POST', '/etablissements/' + cible + '/super-admin', {
        nom: v('nom'), prenoms: v('prenoms'), email: v('email'), tel: v('tel'), motDePasse: f.elements.mdp.value
      }).then(function (j) {
        fin();
        var z = $('resAdmin');
        if (!j.success) { z.innerHTML = '<div class="err">' + esc(j.message || 'Erreur.') + '</div>'; return; }
        z.innerHTML = '<div class="ok-box"><b>Compte créé.</b><br>' + esc(j.data.email) + ' · matricule <b>' + esc(j.data.matricule) + '</b></div>';
        btn.className = 'hidden';
        charger();
        if (etat.page === 'admins') chargerAdmins();
      });
    }
  });

  // ── Démarrage ─────────────────────────────────────────────────────────────
  etat.page = pageCourante();
  if (cle) { seConnecter(false); } else { montrerLogin(''); }
})();