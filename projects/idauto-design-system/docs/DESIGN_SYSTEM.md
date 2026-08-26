# IDauto Design System — Documentation

**Version 1.0.0 · 2026-08-26 · statut : fondation livrée, cible d'intégration `othoth77/idauto`**

---

## 1. Positionnement

IDauto doit communiquer : identité, confiance, vérification, traçabilité, précision,
technologie — sans jamais ressembler à de la crypto, à une banque, à de la cyber-sécurité
ni à un dashboard technique. Le ressenti visé :

> « Cette voiture possède une identité numérique fiable. »

### Anti-patterns bannis (analyse concurrentielle)

Le pattern consommé `fond sombre + dégradé bleu + voiture luisante + méga-titre + quatre
cartes SaaS + statistiques + icônes génériques` (CarVertical, landing pages AI, clones de
Stripe/Linear/Vercel/Tesla) est explicitement interdit. Concrètement, dans ce système :

- **aucun bleu dominant** — la palette est encre/papier/vert cachet ;
- **aucun néon, glow, particule, gradient décoratif** (testé : `no glow/neon`) ;
- **aucune statistique fabriquée** — testé (`no fabricated percentages/volume stats`) ;
  seuls les concepts réels du protocole s'affichent (source, evidence, verification,
  trust T0–T3, anchored) ;
- **le dark mode est « asphalte »** (charbon chaud), jamais un décor cyberpunk ;
- **chaque élément visuel a une fonction conceptuelle** (voir §3).

## 2. Principes

1. **Le document, pas le dashboard.** Le passeport se lit comme une pièce officielle :
   étiquettes marginales, séparateurs perforés, typographie d'identifiants.
2. **Un seul accent, et il signifie quelque chose.** Le vert cachet appartient à la
   vérification. Les actions sont encre. Rien d'autre ne porte de couleur d'accent.
3. **La confiance se prouve, elle ne se décore pas.** Jamais de « 99% fiable » ; les
   niveaux affichés sont ceux du protocole (T0–T3), les faits citent leur source.
4. **La plaque est un objet, pas un champ décoré.** Représentation tunisienne exacte,
   noire à caractères blancs, `SSS تونس NNNN` — sans bande TN, sans drapeau, sans
   élément européen.
5. **L'accessibilité n'est pas négociable.** WCAG AA testé par calcul, clavier partout,
   `prefers-reduced-motion` global, cibles tactiles ≥ 44 px.

## 3. Signature visuelle

| Objet | Rôle | Implémentation |
|---|---|---|
| **La Plaque** | point d'entrée de l'identité | `.ida-plate`, `.ida-plate-input` |
| **Le Sceau** | état de vérification (plein = vérifié, pointillé = en attente) | `.ida-seal--*` |
| **Les Repères** | historique en points de contrôle datés | `.ida-timeline`, `.ida-event--*` |
| **La Trame** | fines lignes de sécurité inspirées des documents officiels, intensité unique tokenisée (`--ida-trame-opacity`) | `.ida-trame` |
| **La Perforation** | séparation des sections du passeport | `.ida-perf`, sections du passeport |

Évolution conceptuelle portée par la homepage : *Plaque → Identité → Passeport →
Historique → Preuves → Confiance*.

## 4. Fondations

### Couleur

Palette complète dans `tokens/idauto.tokens.json` (`color.light` / `color.dark`).
Rôles : `bg`, `surface`, `surface-raised`, `surface-sunken`, `text`, `text-muted`,
`text-faint`, `border`, `border-strong`, `primary` (+contrast), `verify` (+strong/tint),
`pending` (+tint), `danger` (+tint), `info` (+tint), `focus`, `plate-field`,
`plate-glyph`, `scrim`.

- **Clair (défaut)** : papier `#F6F4EE`, encre `#1C1B18`, vert cachet `#1D6B4F`.
- **Sombre** : asphalte `#171614` (charbon chaud — jamais bleu-noir), accents éclaircis.
- Trois états de thème : choix explicite (`data-theme` sur `<html>`) sinon
  `prefers-color-scheme` ; la palette sombre est définie deux fois (media query gardée
  `:not([data-theme="light"])` + `[data-theme="dark"]`), vérifié par test.
- **Tous les couples sémantiques passent AA par calcul** (267 assertions incluent
  17 paires × 2 thèmes).

### Typographie

Deux rôles, trois fontes (superfamille IBM Plex, SIL OFL) :

- **Éditoriale** — IBM Plex Sans + IBM Plex Sans Arabic : français, anglais, arabe/RTL.
- **Identifiants** — IBM Plex Mono, chiffres tabulaires : IVID, plaques, VIN, dates
  d'enregistrement. La plaque et les identifiants ne partagent jamais la fonte du texte.
- Échelle : 12/14/16/18/22/28/36/46 (rem), graisses 400/500/600.
- Les étiquettes majuscules (`.ida-label`, `.ida-status`) neutralisent `letter-spacing`
  et `text-transform` en arabe (`[lang="ar"]`).
- **Production : auto-héberger les fontes** (règle Mythos « pas de CDN fonts ») ; les
  pages de démonstration référencent Google Fonts avec piles de repli complètes.

### Espace, rayons, élévation, motion

- Espace base 4 px : 4/8/12/16/24/32/48/64.
- Rayons : 2 (chips) / 4 (contrôles) / 6 (plaque) / 8 (cartes) / 999 (sceaux seulement).
- Ombres : 3 niveaux teintés encre — jamais de glow coloré.
- Motion : 120/200/320 ms, `cubic-bezier(0.2,0,0,1)` ; **2 keyframes maximum** (testé) —
  `ida-stamp` (tamponnage d'un sceau confirmé) et `ida-pulse` (chargement) ;
  `prefers-reduced-motion` coupe tout globalement.
- Breakpoints : 480 / 768 / 1024 / 1280.

## 5. Le système de plaque

`js/plate.js` — **registre de formats** : chaque pays est une entrée
(`FORMATS['tn-serie']`), ajouter un format national n'exige aucune modification du
composant.

Format tunisien série : `SSS تونس NNNN` — série 1–3 chiffres, numéro 1–4 chiffres,
champ noir, caractères blancs
([réf. Wikipedia — Vehicle registration plates of Tunisia](https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Tunisia)).
Forme canonique machine : `SSS TU NNNN`. `parse()` accepte la forme arabe, la forme
ASCII et la forme tiretée.

**PlateInput** — états : `empty → typing → valid | invalid` (machine interne) ;
`loading`, `verified`, `disabled` posés par le produit via `setState`. Deux champs
numériques (`inputmode="numeric"`) autour du mot fixe تونس, focus porté par le cadre
de la plaque, auto-avance série→numéro, chiffres seuls.
**PlateDisplay** — `.ida-plate` en trois tailles (`--sm`, base, `--lg` responsive).
En texte courant, تونس est isolé par `<bdi>` pour préserver l'ordre visuel bidi.

## 6. Composants livrés

Button (primary/secondary/ghost/danger/sm), Field/Input (normal/erreur/désactivé, erreurs
liées par `aria-describedby`), PlateInput, PlateDisplay, Search, IVIDDisplay (+copie),
QRCode (cadre : zone de silence, légende IVID — la matrice vient du produit ; le QR
encode l'IVID, jamais la plaque), VehicleCard, VehiclePassport (composition document),
VerificationBadge (sceaux), TrustIndicator (T0–T3, jamais un pourcentage), EvidenceCard,
DocumentCard, Timeline/EventCard (DATE·EVENT·SOURCE·EVIDENCE·STATUS lisible en mobile),
Status, Alert (4 tons), Modal & Drawer (`<dialog>` natif : ESC, backdrop, focus trap
natifs), Tabs (pattern ARIA, flèches clavier), Table (scroll interne), Navigation +
wordmark, Footer, EmptyState, LoadingState (squelettes statiques d'abord), ErrorState.

Aucun composant décoratif ; chacun des états demandés est représenté dans
`pages/components.html`.

## 7. Accessibilité (testée)

- Contrastes AA calculés sur chaque couple sémantique, deux thèmes.
- `lang`, skip-link, landmark `main`, nav étiquetée, sur chaque page.
- Chaque `input` a un `label` (test structurel), chaque `dialog` un `aria-labelledby`.
- Focus visible unique (`:focus-visible`, anneau vert 2 px, offset 2 px).
- Cibles tactiles : contrôles ≥ 44 px (les petits boutons étendent leur zone de clic
  par pseudo-élément, jamais par marge).
- `prefers-reduced-motion` global ; squelettes plutôt que spinners.
- Annonces polies via `role="status"` (`#ida-live`) pour la copie d'IVID.
- RTL : propriétés logiques (`inset-inline-start`, `border-inline-start`…) partout —
  le système est prêt pour une locale arabe complète.

## 8. Responsive (vérifié au navigateur)

Balayage Chromium réel : **320 / 390 / 768 / 1280 px × clair/sombre — zéro débordement
horizontal, zéro erreur console** (hors requêtes de fontes bloquées par la sandbox).
La plaque, le passeport et la timeline sont conçus mobile-first ; le QR a sa section
« Accès public » dans le passeport.

## 9. Tokens et gouvernance

- Source de vérité : `tokens/idauto.tokens.json` (W3C DTCG 2025.10).
- `tokens/tokens.css` est la build CSS maintenue à la main ; la synchronisation est
  **testée** (chaque valeur de couleur JSON doit apparaître dans le CSS).
- Politique « aucune valeur arbitraire » **testée** : zéro hex brut hors tokens.css,
  `rgba` uniquement en repli de `var()`, chaque `var(--ida-*)` utilisé est défini.

## 10. Ce qui reste à faire (honnête)

1. **Transplanter dans `othoth77/idauto`** (répertoire tel quel) — bloqué dans cette
   session par les permissions d'accès au dépôt canonique.
2. **Auto-héberger les fontes IBM Plex** à l'intégration produit.
3. **Brancher le QR réel** (verdict : `nayuki-qr-code-generator`, MIT — voir
   `docs/SEARCH_FIRST.md`) sur l'émission d'IVID.
4. **Brancher PlateInput sur l'API réelle** (états `loading`/`verified` sont prêts).
5. Locale arabe complète des pages (le système est RTL-ready ; les pages de démo sont
   en français).
6. Formats de plaque additionnels (RS, etc.) — le registre les accueille sans casse.
7. Iconographie : jeu propriétaire minimal à dessiner à l'intégration (les pages de démo
   utilisent des glyphes neutres) — famille unique, trait constant, tailles tokenisées.
