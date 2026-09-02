# SPY — Source legal register (2026-09-02)

Scope: the 10 competitor/news domains SPY monitors (30 sources). Evidence = `robots.txt` fetched read-only on
2026-09-02 with an identified audit user-agent, one homepage fetch per domain to locate terms pages, and for
autopart.tn the CGV page text. **No page beyond robots.txt, the homepage and one terms page was fetched.** ToS
*content* was not reviewed except where stated; "ToS status" therefore records existence, not a legal reading.
Statuses: **CONFIRMED** (seen), **UNKNOWN** (not verifiable from this host), **REQUIRES LEGAL REVIEW**.

SPY behaviour that applies to every row (CONFIRMED in code): respects `robots.txt` Disallow (`SPY_RESPECT_ROBOTS=1`,
1 h cache, unreachable robots ⇒ allow); UA `Mozilla/5.0 (compatible; SPY/1.0; +https://spy.mythosprod.xyz/about)`;
3–5 s jitter per host + 5 min pause per 100 pages; **does not read `Crawl-delay`**; public pages only, no login
automation; snapshots retained without a sweeper; only event titles leave the host (Exa). Engines per source:
`watch` (one page hash), `catalogue` (homepage/JSON-LD product harvest, ≤60 pages), `sitemap` (URL lists only).

| Domain | SPY sources (engine / interval) | Purpose | robots.txt | Crawl-delay | ToS page | Legal status | Allowed today | Prohibited | Last checked | Review |
|---|---|---|---|---|---|---|---|---|---|---|
| autopart.tn | 5 watch 24h · 6 watch 24h · 22 catalogue 12h · 34 sitemap 12h | Tunisian parts retailer; catalog frontier + price observation | CONFIRMED: `User-agent: *` disallows `/_seek.*`, `/panier*`, `/validation*`, `/compte*`, `/backoffice*`, `/admin*`; **header text: "Automated collection of catalogue, pricing and vehicle-compatibility data is prohibited without prior written authorisation from AutoPart Tunisie"**; sitemap advertised | 5 s (SPY jitter 3–5 s → non-compliant part of the time) | CGV + politique de confidentialité exist; CGV text (9.5k chars) contains **no clause** on automated collection/database rights | **REQUIRES LEGAL REVIEW — HIGH (L1)** | robots-permitted paths: sitemap discovery (URL + lastmod), homepage watch. Historical fiche data (346 products) stays internal | fiche-page extraction, price/compat harvesting, republication of their text/images, any depth crawl, ignoring Crawl-delay | 2026-09-02 | 2026-12-01 or on authorisation |
| topparts.tn | 3 watch 6h · 4 watch 12h · 24 catalogue 12h | parts retailer; page + product watch | CONFIRMED absent (`/robots.txt` 307 → homepage) | none | none found on homepage | UNKNOWN → REQUIRES LEGAL REVIEW (no published rules) | public page watch; catalogue harvest of public product pages | logins, carts | 2026-09-02 | 2026-12-01 |
| essidpiecesauto.com | 12 watch 24h · 27 catalogue 12h | parts retailer | CONFIRMED: disallows sign-in/up, password, account, checkout, orders; sitemap advertised | none | `/terms-of-use` exists (not read) | REQUIRES LEGAL REVIEW (read ToS) | public pages, sitemap | account/checkout paths | 2026-09-02 | 2026-12-01 |
| spab.tn | 8, 9, 10 (6h), 11 watch · 25 catalogue 12h | parts retailer | CONFIRMED absent (`/robots.txt` returns HTML 200) | none | none found on homepage | UNKNOWN → REQUIRES LEGAL REVIEW | public page watch | — | 2026-09-02 | 2026-12-01 |
| cassemarket.com | 15 watch 24h · 16 watch 12h (`?condition=used`) · 26 catalogue 12h | used-parts marketplace — direct casse.autos competitor | CONFIRMED: `Allow: /`; disallows cart, checkout, profile, user-dashboard, login, register, `/api/`, `/_next/`; sitemap advertised | none | none found on homepage | REQUIRES LEGAL REVIEW (marketplace listings may include third-party seller data) | public listing pages | `/api/`, account paths, seller personal data | 2026-09-02 | 2026-12-01 |
| skapra.tn | 19 watch 24h · 29 catalogue 12h | parts retailer (PrestaShop) | CONFIRMED: `Allow: /` for `*`; blocks AI crawlers (GPTBot, ClaudeBot, CCBot, Bytespider, Amazonbot, meta-externalagent…) by UA — SPY's UA is not listed | none | `/content/2-mentions-legales`, `/content/3-conditions-utilisation` exist (not read) | REQUIRES LEGAL REVIEW (read CGU) | public pages | AI-crawler UAs (not applicable) | 2026-09-02 | 2026-12-01 |
| ad-tunisie.com | 13 watch 24h · 14 watch 24h · 23 catalogue 12h | parts distributor | CONFIRMED: disallows only `/customer/account/login` | none | `/cgv`, `/privacy-policy`, `/terms-conditions` exist (not read) | REQUIRES LEGAL REVIEW (read terms) | public pages | login | 2026-09-02 | 2026-12-01 |
| allopiece.tn | 17 watch 24h · 18 watch 12h · 28 catalogue 12h | parts retailer | CONFIRMED: `Allow: /` for `*`; blocks AI-training UAs; sitemap advertised | none | `/conditions-utilisation.html`, `/privacy.html` exist (not read) | REQUIRES LEGAL REVIEW (read CGU) | public pages, sitemap | AI-training UAs (not applicable) | 2026-09-02 | 2026-12-01 |
| mosaiquefm.net | 30 catalogue 12h · 31 watch 24h · 35 sitemap 30 min (Google News feed) | news signal (validation source) | CONFIRMED: `Allow: /`; 12 sitemaps advertised incl. the news feed SPY uses | none | none found | CONFIRMED low risk (headlines + URLs only; no article bodies stored) | sitemap/news feed, homepage | — | 2026-09-02 | 2026-12-01 |
| tunisianet.com.tn | 32 catalogue 12h · 33 watch 24h | electronics retailer (non-automotive baseline) | CONFIRMED: PrestaShop rules; disallows cart/auth/account controllers and filter URLs | none | CGV at `/content/3-conditions-generales-de-ventes` (not read) | REQUIRES LEGAL REVIEW (read CGV) | public pages | cart/auth controllers | 2026-09-02 | 2026-12-01 |

## Decisions and rules derived (no legal conclusion beyond the evidence)
1. **L1 autopart.tn — HIGH.** The only source with an explicit written prohibition. Options for the owner:
   **A** request written authorisation from AutoPart Tunisie (recommended if fiche-depth extraction is wanted);
   **B** keep depth extraction disabled indefinitely. Until A exists: `SSANGYONG_AUTOPART_SCRAPER` /
   `SSANGYONG_PROCESS_MODEL` stay inactive; SPY stays at sitemap + homepage watch + existing catalogue engine
   on public pages; no fiche fetches; the 346-product dataset and its images/text remain internal and are never
   republished automatically. Registering `sitemap-products-2.xml` is deferred (it is robots-permitted but the
   decision belongs with L1).
2. **Crawl-delay.** autopart.tn asks 5 s; SPY's jitter floor is 3 s. Proposed SPY change (not made): honour
   `RobotFileParser.crawl_delay()` when present, or set `SPY_JITTER_MIN_SEC=5` in the SPY env (an env change,
   still a production change — owner call).
3. **Terms not read** for 7 domains. Phase 6 task: read each terms page once, record clauses on automated access
   and database rights here, set `legal_status` per source in SPY's source registry (`config_json` can carry it
   without a schema change).
4. **Personal data.** cassemarket.com listings may carry seller names/phones in page text; SPY's `catalogue`
   engine stores `name, url, sku, brand, price, currency, availability, image` only (CONFIRMED) — no seller
   fields. Keep it that way.
5. **Stop capability.** Pausing a source or deleting a competitor cascades in SPY; AUTOS must hold its own
   provenance copies (foundation §J I4).
