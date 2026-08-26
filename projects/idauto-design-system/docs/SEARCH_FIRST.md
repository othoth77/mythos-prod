# IDauto Design System — verdicts Search First

Discipline OTHMODE `search-first` (SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST),
appliquée le 2026-08-26. L'Open Source Registry vivant (endpoints OTHMODE) n'était pas
joignable depuis cette session hors-hôte ; les verdicts sont consignés ici pour report.

| Besoin | Candidats examinés | Verdict | Justification |
|---|---|---|---|
| Format de tokens | [W3C DTCG Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/) (première version stable, [annonce](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)) | **ADOPT** (standard, zéro dépendance) | Interopérable (Style Dictionary v4, Figma, Penpot) ; JSON pur, aucune lib requise |
| Build de tokens | Style Dictionary | **REJECT** (pour l'instant) | Une dépendance + un build pour un fichier CSS que la suite de tests garde en sync ; réévaluer si multi-plateformes |
| Typographie FR/EN/AR + identifiants | [IBM Plex](https://github.com/IBM/plex) (Sans, Sans Arabic, Mono — SIL OFL) | **ADOPT** | Superfamille cohérente couvrant l'arabe ; Plex Mono est déjà le rôle « data » approuvé du design track Mythos ; chiffres tabulaires pour plaques/IVID |
| Bibliothèque UI | shadcn/ui, Radix, Open Props, DaisyUI… | **BUILD** | Exigence propriétaire explicite (« aucun assemblage d'UI library sans direction artistique ») ; le produit canonique est zéro-framework/zéro-build ; ~30 composants suffisent |
| Génération QR | [nayuki QR-Code-generator](https://www.nayuki.io/page/qr-code-generator-library) (MIT), qrcode (npm) | **ADOPT à l'intégration** | Vendoring impossible dans cette session (registre npm inaccessible ; source TS non compilable hors-ligne). Le composant `QRCode` livre le cadre normé ; la matrice vient du produit |
| Iconographie | Lucide, Heroicons, Phosphor | **DEFER** | Les pages de démo n'exigent que des glyphes neutres ; choisir à l'intégration une famille unique compatible direction artistique (trait fin constant) ou dessiner ~15 icônes propriétaires |
| Composants overlay | libs de modales/focus-trap | **REUSE plateforme** | `<dialog>` natif fournit ESC/backdrop/focus sans dépendance |
| Standards a11y | WCAG 2.2 AA, WAI-ARIA APG (tabs, dialog) | **ADOPT** | Patterns ARIA implémentés tels quels ; contrastes vérifiés par calcul dans la suite |
| Référence plaque | [Wikipedia — Vehicle registration plates of Tunisia](https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Tunisia) | **ADOPT (référence factuelle)** | `SSS تونس NNNN`, blanc sur noir, 450×100 / 520×110 mm — représentée sans bande ni drapeau |

**Preuve BUILD (bibliothèque UI)** : l'exigence produit interdit un design d'assemblage ;
aucun système OSS n'apporte la signature « document officiel » (plaque tunisienne, sceaux,
trame, perforation) ; le coût du BUILD est borné (CSS + 2 fichiers JS sans dépendance,
267 assertions de garde).
