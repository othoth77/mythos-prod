'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — interface localisation
// projects/command-center/reference/web/i18n.js
//
// Owner requirement §2: "The interface should support French and English
// initially, with Arabic-ready architecture."
//
// So English and French are complete and selectable. Arabic is ARCHITECTURE-
// READY, not shipped: every mechanism it needs is here and exercised —
// a per-locale `dir`, a fallback chain so a partial translation degrades to
// English instead of showing raw keys, and `name_ar` columns already carried
// through the database and the API. Adding Arabic is adding one object to
// LOCALES below and flipping `enabled` to true. Nothing else changes.
//
// Shipping a half-translated Arabic UI would have been the wrong kind of
// "done": worse to read than English, and it would hide the fact that the
// translation was never actually reviewed by someone who reads Arabic.
// =====================================================

(function (global) {

  var STRINGS = {
    en: {
      'app.title': 'MYTHOS AI COMMAND CENTER',
      'app.subtitle': 'Command Library for Mythos OS, Claude, Codex and AI Agents',
      'search.placeholder': 'Search commands, categories, tags…',
      'search.hint': 'Press / to search',
      'search.results': 'Search results',
      'search.none': 'No command matches that search.',
      'search.clear': 'Clear search',

      'nav.dashboard': 'Dashboard',
      'nav.library': 'Library',
      'nav.favorites': 'Favorites',
      'nav.notes': 'Notes',
      'nav.statistics': 'Statistics',
      'nav.workflows': 'Workflows',

      'section.most_used': 'Most Used',
      'section.favorites': 'Favorites',
      'section.recently_used': 'Recently Used',
      'section.recently_added': 'Recently Added',
      'section.recommended': 'Recommended',
      'section.categories': 'Categories',
      'section.quick_actions': 'Quick Actions',
      'section.empty': 'Nothing here yet.',

      'action.copy': 'Copy',
      'action.copied': 'Copied',
      'action.open': 'Open',
      'action.edit': 'Edit',
      'action.favorite': 'Favorite',
      'action.unfavorite': 'Remove favorite',
      'action.use': 'Use command',
      'action.add_note': 'Add note',
      'action.customize': 'Customize',
      'action.save': 'Save',
      'action.save_as_new': 'Save as new',
      'action.duplicate': 'Duplicate',
      'action.archive': 'Archive',
      'action.restore': 'Restore',
      'action.cancel': 'Cancel',
      'action.close': 'Close',
      'action.new_command': 'New command',
      'action.export': 'Export JSON',
      'action.back': 'Back',

      'detail.when_to_use': 'When to use',
      'detail.command': 'Full command',
      'detail.explanation': 'Explanation',
      'detail.best_practices': 'Best practices',
      'detail.warnings': 'Warnings',
      'detail.related': 'Related commands',
      'detail.next': 'Next command',
      'detail.previous': 'Previous command',
      'detail.usage_history': 'Usage history',
      'detail.notes': 'Personal notes',
      'detail.versions': 'Version history',
      'detail.variables': 'Command variables',
      'detail.no_notes': 'No notes on this command yet.',
      'detail.no_usage': 'Never used yet.',
      'detail.in_workflows': 'Part of workflows',

      'field.title': 'Title',
      'field.category': 'Category',
      'field.project': 'Project',
      'field.description': 'Short description',
      'field.body': 'Command',
      'field.when_to_use': 'When to use',
      'field.explanation': 'Explanation',
      'field.best_practices': 'Best practices',
      'field.warnings': 'Warnings',
      'field.tags': 'Tags (comma separated)',
      'field.difficulty': 'Difficulty',
      'field.safety': 'Safety level',
      'field.status': 'Status',
      'field.version': 'Version',
      'field.related': 'Related commands (comma-separated slugs)',
      'field.notes': 'Notes',
      'field.content': 'Content',
      'field.change_note': 'What changed (optional)',

      'meta.uses': 'uses',
      'meta.use': 'use',
      'meta.version': 'Version',
      'meta.updated': 'Updated',
      'meta.created': 'Created',
      'meta.never_used': 'Never used',
      'meta.source': 'Source',
      'meta.commands': 'commands',

      'difficulty.BEGINNER': 'Beginner',
      'difficulty.INTERMEDIATE': 'Intermediate',
      'difficulty.ADVANCED': 'Advanced',

      'safety.SAFE': 'Safe',
      'safety.READ_ONLY': 'Read-only',
      'safety.WRITE': 'Write',
      'safety.PRODUCTION': 'Production',
      'safety.DESTRUCTIVE': 'Destructive',

      'status.ACTIVE': 'Active',
      'status.ARCHIVED': 'Archived',
      'status.DRAFT': 'Draft',
      'status.ALL': 'All statuses',

      'filter.all_categories': 'All categories',
      'filter.all_projects': 'All projects',
      'filter.all_difficulties': 'All difficulties',
      'filter.all_safety': 'All safety levels',
      'filter.favorites_only': 'Favorites only',
      'filter.sort': 'Sort',
      'sort.relevance': 'Relevance',
      'sort.most_used': 'Most used',
      'sort.recent_used': 'Recently used',
      'sort.recent_added': 'Recently added',
      'sort.updated': 'Recently updated',
      'sort.title': 'Title',

      'stats.total_commands': 'Total commands',
      'stats.active_commands': 'Active',
      'stats.archived_commands': 'Archived',
      'stats.draft_commands': 'Drafts',
      'stats.total_uses': 'Total uses',
      'stats.total_notes': 'Notes',
      'stats.total_favorites': 'Favorites',
      'stats.total_categories': 'Categories',
      'stats.total_tags': 'Tags',
      'stats.total_projects': 'Projects',
      'stats.added_this_month': 'Added this month',
      'stats.used_this_week': 'Used this week',
      'stats.most_used_command': 'Most used command',
      'stats.most_used_category': 'Most used category',
      'stats.today': 'Today',
      'stats.week': 'This week',
      'stats.month': 'This month',
      'stats.all_time': 'All time',
      'stats.by_category': 'By category',

      'notes.title': 'Notes',
      'notes.new': 'New note',
      'notes.general': 'General notes',
      'notes.command_notes': 'Command notes',
      'notes.empty': 'No notes yet.',
      'notes.scope': 'Attach to',
      'notes.scope.GENERAL': 'Nothing (general note)',
      'notes.scope.COMMAND': 'A command',
      'notes.scope.CATEGORY': 'A category',
      'notes.scope.PROJECT': 'A project',

      'variables.intro': 'Fill the placeholders, then copy the finished command.',
      'variables.result': 'Generated command',
      'variables.unresolved': 'Still unfilled:',
      'variables.none': 'This command has no placeholders.',

      'auth.title': 'Editing access',
      'auth.explain': 'Reading and copying need no token. Editing the library does.',
      'auth.token': 'Access token',
      'auth.save': 'Save token',
      'auth.forget': 'Forget token',
      'auth.signed_in': 'Editing enabled as',
      'auth.signed_out': 'Read-only',
      'auth.required': 'An access token is required to edit the library.',
      'auth.invalid': 'That token was not accepted.',

      'warn.destructive.title': 'Destructive command',
      'warn.destructive.body': 'This command is classified DESTRUCTIVE. It can permanently remove or overwrite data. Read it in full before running it anywhere.',
      'warn.production.title': 'Production command',
      'warn.production.body': 'This command touches production. Confirm scope, backups and rollback before running it.',
      'warn.copy_anyway': 'I understand — copy it',
      'warn.never_executes': 'This application never runs a stored command. Copying only puts text on your clipboard.',

      'secret.blocked': 'Save refused: the content matches a known credential format.',
      'secret.warning': 'Possible credential detected — check before saving:',

      'shortcuts.title': 'Keyboard shortcuts',
      'shortcuts.search': 'Focus search',
      'shortcuts.copy': 'Copy the selected command',
      'shortcuts.favorite': 'Toggle favorite',
      'shortcuts.note': 'New note',
      'shortcuts.close': 'Close dialog',

      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'error.load': 'Could not load data from the server.',
      'error.save': 'Save failed.',
      'confirm.archive': 'Archive this command? It stays searchable under the Archived filter and can be restored.'
    },

    fr: {
      'app.title': 'MYTHOS AI COMMAND CENTER',
      'app.subtitle': 'Bibliothèque de commandes pour Mythos OS, Claude, Codex et agents IA',
      'search.placeholder': 'Rechercher commandes, catégories, tags…',
      'search.hint': 'Appuyez sur / pour rechercher',
      'search.results': 'Résultats de recherche',
      'search.none': 'Aucune commande ne correspond à cette recherche.',
      'search.clear': 'Effacer la recherche',

      'nav.dashboard': 'Tableau de bord',
      'nav.library': 'Bibliothèque',
      'nav.favorites': 'Favoris',
      'nav.notes': 'Notes',
      'nav.statistics': 'Statistiques',
      'nav.workflows': 'Workflows',

      'section.most_used': 'Les plus utilisées',
      'section.favorites': 'Favoris',
      'section.recently_used': 'Utilisées récemment',
      'section.recently_added': 'Ajoutées récemment',
      'section.recommended': 'Recommandées',
      'section.categories': 'Catégories',
      'section.quick_actions': 'Actions rapides',
      'section.empty': 'Rien ici pour l’instant.',

      'action.copy': 'Copier',
      'action.copied': 'Copié',
      'action.open': 'Ouvrir',
      'action.edit': 'Modifier',
      'action.favorite': 'Favori',
      'action.unfavorite': 'Retirer des favoris',
      'action.use': 'Utiliser la commande',
      'action.add_note': 'Ajouter une note',
      'action.customize': 'Personnaliser',
      'action.save': 'Enregistrer',
      'action.save_as_new': 'Enregistrer comme nouvelle',
      'action.duplicate': 'Dupliquer',
      'action.archive': 'Archiver',
      'action.restore': 'Restaurer',
      'action.cancel': 'Annuler',
      'action.close': 'Fermer',
      'action.new_command': 'Nouvelle commande',
      'action.export': 'Exporter JSON',
      'action.back': 'Retour',

      'detail.when_to_use': 'Quand l’utiliser',
      'detail.command': 'Commande complète',
      'detail.explanation': 'Explication',
      'detail.best_practices': 'Bonnes pratiques',
      'detail.warnings': 'Avertissements',
      'detail.related': 'Commandes liées',
      'detail.next': 'Commande suivante',
      'detail.previous': 'Commande précédente',
      'detail.usage_history': 'Historique d’utilisation',
      'detail.notes': 'Notes personnelles',
      'detail.versions': 'Historique des versions',
      'detail.variables': 'Variables de la commande',
      'detail.no_notes': 'Aucune note sur cette commande.',
      'detail.no_usage': 'Jamais utilisée.',
      'detail.in_workflows': 'Fait partie des workflows',

      'field.title': 'Titre',
      'field.category': 'Catégorie',
      'field.project': 'Projet',
      'field.description': 'Description courte',
      'field.body': 'Commande',
      'field.when_to_use': 'Quand l’utiliser',
      'field.explanation': 'Explication',
      'field.best_practices': 'Bonnes pratiques',
      'field.warnings': 'Avertissements',
      'field.tags': 'Tags (séparés par des virgules)',
      'field.difficulty': 'Difficulté',
      'field.safety': 'Niveau de sécurité',
      'field.status': 'Statut',
      'field.version': 'Version',
      'field.related': 'Commandes liées (slugs séparés par des virgules)',
      'field.notes': 'Notes',
      'field.content': 'Contenu',
      'field.change_note': 'Ce qui a changé (optionnel)',

      'meta.uses': 'utilisations',
      'meta.use': 'utilisation',
      'meta.version': 'Version',
      'meta.updated': 'Modifiée',
      'meta.created': 'Créée',
      'meta.never_used': 'Jamais utilisée',
      'meta.source': 'Source',
      'meta.commands': 'commandes',

      'difficulty.BEGINNER': 'Débutant',
      'difficulty.INTERMEDIATE': 'Intermédiaire',
      'difficulty.ADVANCED': 'Avancé',

      'safety.SAFE': 'Sûre',
      'safety.READ_ONLY': 'Lecture seule',
      'safety.WRITE': 'Écriture',
      'safety.PRODUCTION': 'Production',
      'safety.DESTRUCTIVE': 'Destructive',

      'status.ACTIVE': 'Active',
      'status.ARCHIVED': 'Archivée',
      'status.DRAFT': 'Brouillon',
      'status.ALL': 'Tous les statuts',

      'filter.all_categories': 'Toutes les catégories',
      'filter.all_projects': 'Tous les projets',
      'filter.all_difficulties': 'Toutes les difficultés',
      'filter.all_safety': 'Tous les niveaux',
      'filter.favorites_only': 'Favoris uniquement',
      'filter.sort': 'Trier',
      'sort.relevance': 'Pertinence',
      'sort.most_used': 'Les plus utilisées',
      'sort.recent_used': 'Utilisées récemment',
      'sort.recent_added': 'Ajoutées récemment',
      'sort.updated': 'Modifiées récemment',
      'sort.title': 'Titre',

      'stats.total_commands': 'Commandes totales',
      'stats.active_commands': 'Actives',
      'stats.archived_commands': 'Archivées',
      'stats.draft_commands': 'Brouillons',
      'stats.total_uses': 'Utilisations totales',
      'stats.total_notes': 'Notes',
      'stats.total_favorites': 'Favoris',
      'stats.total_categories': 'Catégories',
      'stats.total_tags': 'Tags',
      'stats.total_projects': 'Projets',
      'stats.added_this_month': 'Ajoutées ce mois-ci',
      'stats.used_this_week': 'Utilisées cette semaine',
      'stats.most_used_command': 'Commande la plus utilisée',
      'stats.most_used_category': 'Catégorie la plus utilisée',
      'stats.today': 'Aujourd’hui',
      'stats.week': 'Cette semaine',
      'stats.month': 'Ce mois-ci',
      'stats.all_time': 'Depuis le début',
      'stats.by_category': 'Par catégorie',

      'notes.title': 'Notes',
      'notes.new': 'Nouvelle note',
      'notes.general': 'Notes générales',
      'notes.command_notes': 'Notes de commandes',
      'notes.empty': 'Aucune note.',
      'notes.scope': 'Rattacher à',
      'notes.scope.GENERAL': 'Rien (note générale)',
      'notes.scope.COMMAND': 'Une commande',
      'notes.scope.CATEGORY': 'Une catégorie',
      'notes.scope.PROJECT': 'Un projet',

      'variables.intro': 'Remplissez les variables, puis copiez la commande finale.',
      'variables.result': 'Commande générée',
      'variables.unresolved': 'Encore vides :',
      'variables.none': 'Cette commande n’a pas de variables.',

      'auth.title': 'Accès en modification',
      'auth.explain': 'Lire et copier ne demandent aucun jeton. Modifier la bibliothèque, si.',
      'auth.token': 'Jeton d’accès',
      'auth.save': 'Enregistrer le jeton',
      'auth.forget': 'Oublier le jeton',
      'auth.signed_in': 'Modification activée en tant que',
      'auth.signed_out': 'Lecture seule',
      'auth.required': 'Un jeton d’accès est requis pour modifier la bibliothèque.',
      'auth.invalid': 'Ce jeton a été refusé.',

      'warn.destructive.title': 'Commande destructive',
      'warn.destructive.body': 'Cette commande est classée DESTRUCTIVE. Elle peut supprimer ou écraser des données définitivement. Lisez-la en entier avant de l’exécuter où que ce soit.',
      'warn.production.title': 'Commande de production',
      'warn.production.body': 'Cette commande touche la production. Vérifiez le périmètre, les sauvegardes et le rollback avant de l’exécuter.',
      'warn.copy_anyway': 'J’ai compris — copier',
      'warn.never_executes': 'Cette application n’exécute jamais une commande stockée. Copier ne fait que mettre du texte dans le presse-papiers.',

      'secret.blocked': 'Enregistrement refusé : le contenu correspond à un format d’identifiant connu.',
      'secret.warning': 'Identifiant possible détecté — vérifiez avant d’enregistrer :',

      'shortcuts.title': 'Raccourcis clavier',
      'shortcuts.search': 'Aller à la recherche',
      'shortcuts.copy': 'Copier la commande sélectionnée',
      'shortcuts.favorite': 'Basculer favori',
      'shortcuts.note': 'Nouvelle note',
      'shortcuts.close': 'Fermer la fenêtre',

      'theme.light': 'Clair',
      'theme.dark': 'Sombre',
      'error.load': 'Impossible de charger les données du serveur.',
      'error.save': 'Échec de l’enregistrement.',
      'confirm.archive': 'Archiver cette commande ? Elle reste consultable via le filtre Archivées et peut être restaurée.'
    }
  };

  // The registry the UI reads. `enabled: false` keeps a locale out of the
  // picker while its mechanism stays wired and testable.
  var LOCALES = [
    { code: 'en', label: 'English',  dir: 'ltr', enabled: true },
    { code: 'fr', label: 'Français', dir: 'ltr', enabled: true },
    { code: 'ar', label: 'العربية',  dir: 'rtl', enabled: false }
  ];

  var FALLBACK = 'en';
  var current = FALLBACK;

  function localeMeta(code) {
    for (var i = 0; i < LOCALES.length; i++) {
      if (LOCALES[i].code === code) return LOCALES[i];
    }
    return LOCALES[0];
  }

  function setLocale(code) {
    var meta = localeMeta(code);
    if (!meta.enabled) meta = localeMeta(FALLBACK);
    current = meta.code;
    // The whole RTL story is these two attributes plus the logical CSS
    // properties in app.css. Nothing else in the UI is direction-aware.
    document.documentElement.setAttribute('lang', meta.code);
    document.documentElement.setAttribute('dir', meta.dir);
    return current;
  }

  // Missing key falls back to English, then to the key itself. Showing the
  // raw key is deliberate — a visible `field.tags` in the UI is a bug
  // report; a silently blank label is not.
  function t(key, replacements) {
    var table = STRINGS[current] || STRINGS[FALLBACK];
    var value = table[key];
    if (value === undefined) value = STRINGS[FALLBACK][key];
    if (value === undefined) return key;
    if (replacements) {
      Object.keys(replacements).forEach(function (name) {
        value = value.split('{' + name + '}').join(replacements[name]);
      });
    }
    return value;
  }

  // Category names come from the database in three columns rather than
  // from this file, because categories are dynamic (§5) — a category added
  // next year must be translatable without a code change.
  function categoryName(category) {
    if (!category) return '';
    if (current === 'fr' && category.name_fr) return category.name_fr;
    if (current === 'ar' && category.name_ar) return category.name_ar;
    return category.name_en || category.name_fr || '';
  }

  // Merge additional strings into a locale's table (creating the table for
  // a locale that only existed as registry metadata, e.g. Arabic). Used by
  // othmode-i18n.js — the OTHMODE strings and the reviewed Arabic layer
  // ship as their own file instead of growing this one indefinitely.
  function extend(code, table) {
    if (!STRINGS[code]) STRINGS[code] = {};
    Object.keys(table || {}).forEach(function (key) { STRINGS[code][key] = table[key]; });
  }

  // Flip a registered locale to enabled once its table is actually loaded.
  // Arabic stays disabled until othmode-i18n.js has extended it — the
  // original rule stands: never offer a locale whose strings are absent.
  function enableLocale(code) {
    for (var i = 0; i < LOCALES.length; i++) {
      if (LOCALES[i].code === code) LOCALES[i].enabled = true;
    }
  }

  global.MccI18n = {
    t: t,
    setLocale: setLocale,
    getLocale: function () { return current; },
    locales: LOCALES,
    availableLocales: function () { return LOCALES.filter(function (l) { return l.enabled; }); },
    categoryName: categoryName,
    dir: function () { return localeMeta(current).dir; },
    extend: extend,
    enableLocale: enableLocale
  };

}(window));
