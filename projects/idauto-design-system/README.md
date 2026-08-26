# IDauto Design System

Le système de design propriétaire d'**IDauto** — le protocole ouvert d'identité et
d'historique des véhicules (dépôt canonique du produit :
[`othoth77/idauto`](https://github.com/othoth77/idauto)).

> **Pourquoi ce répertoire est ici.** IDauto a été extrait de ce dépôt le 2026-08-18
> (`docs/IDAUTO_STANDALONE_MIGRATION.md` — « Develop ID Auto there, not here »). La session
> qui a produit ce Design System n'avait **aucun accès** au dépôt `othoth77/idauto`
> (refusé par la couche de permissions, lecture comme écriture). Le système est donc livré
> ici, **autonome et transplantable tel quel** : copier ce répertoire dans
> `othoth77/idauto` (par ex. sous `web/design-system/`) ne demande aucune modification —
> zéro dépendance, zéro build, aucun couplage avec Mythos. Ce répertoire ne réintroduit
> aucun code produit IDauto dans mythos-prod.

## Contenu

```
tokens/idauto.tokens.json   Tokens au format W3C DTCG 2025.10 (source de vérité)
tokens/tokens.css           Custom properties CSS (clair + sombre), sync testée
css/base.css                Reset, rôles typographiques, focus, a11y, trame
css/components.css          Bibliothèque de composants (préfixe .ida-)
js/plate.js                 Registre de formats de plaque + PlateInput (Node + navigateur)
js/ui.js                    Thème, tabs, modal/drawer, copie IVID (sans dépendance)
pages/index.html            Homepage — la plaque comme premier objet fonctionnel
pages/search.html           Recherche par plaque ou IVID
pages/passport.html         Passeport Véhicule — document numérique de confiance
pages/components.html       Galerie du système (fondations + composants + états)
docs/DESIGN_SYSTEM.md       Documentation complète (principes, fondations, composants)
docs/SEARCH_FIRST.md        Verdicts Search First (OSS adopté / rejeté / construit)
tests/design-system-test.js Suite de vérification (zéro dépendance)
```

## Vérifier

```bash
node projects/idauto-design-system/tests/design-system-test.js
```

267 assertions : intégrité DTCG, synchronisation JSON↔CSS, politique « aucune valeur
arbitraire », contrastes WCAG AA calculés (clair et sombre), logique de plaque
tunisienne, invariants d'accessibilité des pages, discipline motion/touch.

## Voir

Ouvrir `pages/index.html` dans un navigateur (aucun serveur requis), ou :

```bash
npx http-server projects/idauto-design-system
```

## Direction artistique — « Encre & Papier, scellé de vert »

Le langage d'un **document officiel numérique**, pas d'un dashboard SaaS : papier chaud,
encre, un seul accent — le vert cachet, réservé à la vérification. La signature visuelle
tient en cinq objets : la **plaque tunisienne** (noire, caractères blancs, `SSS تونس NNNN`,
sans bande ni drapeau), le **sceau** de vérification, les **repères de traçabilité**
(timeline en points de contrôle), la **trame de sécurité** (fines lignes, intensité
tokenisée) et la **perforation** (séparateur de sections du passeport).
Détails et règles : `docs/DESIGN_SYSTEM.md`.
