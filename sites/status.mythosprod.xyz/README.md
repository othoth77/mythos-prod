# sites/status.mythosprod.xyz — Status Center hostname reclamation

**Status: BUILT (provisioning page only), NOT DEPLOYED.** No vhost or
certificate exists for `status.mythosprod.xyz` on the VPS; the hostname
currently falls into the origin's default-vhost fallback and 301-redirects
to `https://darhijama.tn/`. Full diagnosis:
`docs/audits/STATUS_CENTER_ROUTING_DIAGNOSIS_2026-08-20.md`. Operator
runbook: `DEPLOYMENT.md` here.

**What this is.** A single self-contained provisioning page that claims
the hostname honestly: it names the Mythos Status Center, states that the
service is being provisioned, and publishes **no invented status data**
(O-A2 discipline — no business/operational claims without evidence). No
scripts, no external requests, `noindex`.

**What this is not.** It is not the Status Center product. A real status
page (live service health/uptime) is undesigned and unbuilt; it requires
an owner-scoped stage and, when built, replaces this page in the same
docroot with no routing change.
