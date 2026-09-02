# MYTHOS Vault — Central Credential and Integration Layer (Architecture Decision Record)

**Status:** DESIGNED — architecture only. No secret manager deployed, no credential created, moved, read, or rotated by this stage.
**Stage:** `MYTHOS-VAULT-0` (architecture decision phase)
**Date:** 2026-09-01 · **Repository:** `othoth77/mythos-prod` · **Baseline:** `b7ea66a9ebb1b4064985e7d6242469cc8789fac9`

**This document is a decision, not an implementation.** Nothing in it authorises deploying HashiCorp Vault, Infisical, OpenBao, or any other secret manager; nothing in it authorises touching a live credential. It defines the contract that any future implementation must satisfy, and it records the *current, verified* credential topology it is meant to replace.

**Governing policy — not superseded:** [`AUTOMATION_SECURITY_AND_SECRETS.md`](AUTOMATION_SECURITY_AND_SECRETS.md) remains the binding secret-handling policy. This document does not relax any rule in it. MYTHOS Vault is an instance of that policy's §2 item *"an approved secret manager"* — it is the layer that makes the existing policy enforceable rather than merely stated.

**Companion contracts:** [`MYTHOS_IDENTITY_ARCHITECTURE.md`](MYTHOS_IDENTITY_ARCHITECTURE.md) (who a subject is), [`MYTHOS_BUDGET_LEDGER.md`](MYTHOS_BUDGET_LEDGER.md) (an existing per-account resource boundary with the same homedir-scoping failure mode described in §2.4), [`MYTHOS_SYSTEM_INDEX.md`](MYTHOS_SYSTEM_INDEX.md) §20/§20A.

---

## 1. Purpose

MYTHOS Vault is the centralized secure secrets and integrations layer of MYTHOS. Its purpose:

- **Centralize** credentials, API keys, tokens, OAuth credentials and other secret material in one governed place.
- **Stop the scatter** — secrets spread across projects, containers, `.env` files, home directories and source code.
- **Connect once, reuse safely** — a provider is authorised one time and then consumed by many services without re-issuing or copying the credential.
- **Control access per subject** — which user, application, AI agent or service may use each credential, and for what.
- **Keep values hidden** from users and AI agents wherever the protocol allows.
- **Govern the lifecycle** — status, expiration, rotation, revocation, and audit.
- **Integrate** with MYTHOS Identity, Permissions, Policies and Audit.
- **Become the credential layer** beneath the MYTHOS Unified Portal and the MYTHOS Gateway.

### Position in the stack

```text
                      MYTHOS Portal
                            │        (a human or an agent asks for something)
                            ▼
                MYTHOS Identity & Trust
                            │        (who is asking; is the subject real and active)
                            ▼
                     MYTHOS Vault
                            │        (may THIS subject use THAT credential, right now)
                            ▼
   GitHub · Google · Meta · WhatsApp · AI providers · OVH · Cloudflare · …
```

Read the arrows as **authority**, not as network topology. Identity answers *who*; Vault answers *may they, with which credential, for how long*; only then does traffic reach a provider. A request that skips a layer above it is not a shortcut — it is an unauthenticated request, and Vault must refuse it.

---

## 2. Problem Restated — the verified current state

This section records what is true on the host **today**, from direct inspection at the baseline commit. It is the evidence the design answers to, not a projection.

### 2.1 The repository is clean — and that is the part that must not regress

A full search of the working tree for `.env`, `*.env`, `*credentials*` and `*.key` files (excluding `node_modules`) returns **nothing**. No secret value is committed. `AUTOMATION_SECURITY_AND_SECRETS.md` §3 has held. Vault must make this *structurally* true rather than continuously re-verified.

### 2.2 Credential material is real, correct in isolation, and scattered

Verified locations, by mode and owner (**no value was read, printed, or copied to produce this table**):

| Location | Mode / owner | Holds |
|---|---|---|
| `/home/deploy/.ssh/id_ed25519_github` | `0600 deploy` | the machine GitHub identity used by the delivery relay |
| `/home/deploy/.ssh/id_ed25519_notrejour` | `0600 deploy` | a second, project-scoped deploy key |
| `/home/deploy/.config/mythos/backup-schedule.env` | `0600 deploy` | backup pipeline configuration + Cloudflare R2 access |
| `/home/deploy/.config/mythos/backup-schedule-db.env` | `0600 deploy` | database-only backup configuration |
| `/home/deploy/.config/mythos/idauto-offhost.env` | `0600 deploy` | off-host backup destination |
| `/home/deploy/deployments/mythos-gateway/contextforge.env` | `0600 deploy` | Gateway runtime configuration |
| `/home/deploy/deployments/mythos-gateway/mcp-http.env` | `0600 deploy` | MCP bridge configuration |
| `/etc/mythos/governance.key` | `0640 root:mythos-gov` | the governance approval signing key |
| `/data/coolify/source/.env` | `0644 root:root` | Coolify's own configuration |

Every one of these is defensible on its own. Together they are the problem: **nine independent, hand-maintained trust boundaries, each with its own owner, mode, backup story, and rotation story — which is to say, mostly no rotation story at all.** There is no inventory, no expiry, no revocation path, and no way to answer "what does this credential grant, and who is using it" without a host inspection like the one that produced this table.

### 2.3 The permission boundary is the file mode, and file modes do not compose

`/etc/mythos/governance.key` is the one credential on the host with a *designed* access boundary: `0640 root:mythos-gov`, deliberately outside the repository so that a session able to edit the repo cannot edit its own cage away. That is the correct instinct, implemented with the only tool currently available — Unix groups.

It does not generalise. `/data/coolify/source/.env` is `0644` and must stay world-readable, because Coolify's container runs as UID 9999 with no ownership or group relationship to `root:root`; the world bit is the *only* thing granting that process access to its own configuration. Tightening it to `0600` would break the service it protects. This is a documented, confirmed mechanism, not a supposition.

The lesson is structural: **file modes express "which host account", not "which subject, for which purpose, until when."** A credential layer that needs the latter cannot be built out of the former.

### 2.4 Account-scoped credentials break when the consumer runs as someone else

Two independent instances of the same failure are already recorded on this platform:

- The advisory-provider credential is placed under the `ubuntu` account while the daemon that needs it runs as `deploy`.
- The budget ledger is `os.homedir()`-scoped, so the deployed executor reports `configured:false` for grants it genuinely cannot see.

In both cases nothing is misconfigured *within* an account — the credential is simply invisible from where it is consumed. Home-directory placement makes the consuming identity implicit; Vault makes it explicit and is the direct fix for this class of bug.

### 2.5 The Gateway is where this becomes urgent

MYTHOS Gateway (ContextForge) is deployed on the VPS and deliberately not publicly reachable. Three of the steps gating it are credential decisions, and **all three are blocked precisely because there is nowhere correct to put a credential**:

1. No GitHub credential is bound to the Gateway. The only GitHub credential on the host is the owner's personal `gh` CLI OAuth token; reusing a personal token as a service identity is exactly the anti-pattern Vault exists to prevent. The right answer is a dedicated, scoped, rotatable machine credential — which requires somewhere to hold it.
2. No per-client credential has been issued (`chatgpt` / `claude` via the Gateway's own `/tokens`). Issuing per-client credentials with no revocation or expiry story is how a permanent unmanaged token gets created.
3. nginx has not been reloaded, which is the moment MYTHOS becomes publicly reachable. Publishing a surface whose credential layer is nine scattered files is the wrong order of operations.

**Vault is the prerequisite these three steps are waiting on.** They remain owner decisions and this stage does not touch them.

> **Note on repository state:** the Gateway implementation lives on the unmerged branch `feat/mythos-gateway` (commit `d287b97`) and is *not* on `main`. This document is on `main` and describes the Gateway as an integration boundary, not as merged code. No Gateway file is modified by this stage.

---

## 3. VAULT_SCOPE — what Vault governs

### In scope

Any value whose disclosure grants access: API keys, provider tokens, OAuth client secrets and refresh tokens, SSH private keys, database passwords, webhook signing secrets, service account keys, per-client Gateway tokens.

### Out of scope

- **Configuration that is not a secret** — hostnames, ports, region names, feature flags, retention counts. Storing non-secrets in Vault dilutes the boundary and makes every deployment depend on it. They stay in ordinary configuration.
- **Domain data**, including data that is merely private. Vault is not a general encrypted store.
- **The governance signing key** (`/etc/mythos/governance.key`). It stays exactly where it is. The governance cage exists so that a compromised session cannot approve its own changes; moving that key into a system reachable by sessions would defeat it. **A credential layer must never be able to authorise its own modification.** This carve-out is permanent.
- **Host boot credentials** — anything required to bring the host up before Vault itself could be running. Vault must never be in its own dependency path.

### The boundary rule

> If a value is required to *start* Vault, or to *verify* whether a change to Vault is legitimate, it does not live in Vault.

---

## 4. VAULT_REFERENCE_MODEL — references in the platform, values only in the vault

**Decision: every MYTHOS component references a credential by an opaque identifier and never by value. This extends the existing `aut_secret_references` rule from the Automation track to the whole platform.**

`AUTOMATION_SECURITY_AND_SECRETS.md` §4 already establishes a metadata-only secret record — `secret_reference_id`, `provider`, `purpose`, `environment`, `owner`, `created_at`, `rotated_at`, `expires_at`, `rotation_policy`, `status` — with a permanent schema rule that no value-bearing column may ever be added to it. That table is not replaced, superseded, or migrated by this decision. It is **ratified and generalised**: what the Automation track already does for connectors becomes the platform-wide pattern, and `aut_connectors.secret_reference_id` is the reference form every other component adopts.

### Reference format

Consistent with the identity contract's prefixed-identifier convention (`MYTHOS_IDENTITY_ARCHITECTURE.md` §2), and stored in the same opaque `VARCHAR(64)`:

```text
credential reference   cred_<uuidv7>    e.g. cred_0193f4a2-7c31-7890-b4e2-1a2b3c4d5e6f
grant reference        grn_<uuidv7>
```

Rationale is inherited rather than re-argued: it is legible in a mixed audit column, mintable offline without a central allocator, time-ordered for index locality, and free of enumerable sequence information.

### Consequence

A reference is not sensitive. It may appear in configuration, in the database, in logs, in a code review, in this repository. That is the entire point — **it moves the secret boundary from "every place that needs a credential" to "one place that resolves one".**

---

## 5. VAULT_ACCESS_MODEL — grants, not file modes

**Decision: access is a first-class record binding a subject to a credential and a capability, with an expiry. Not a file mode, not a home directory, not group membership.**

A grant answers four questions that a `0600` cannot:

| Question | Grant field |
|---|---|
| Who? | `subject_ref` — a canonical identifier from the identity contract: `usr_…`, `svc_…`, or an agent identity |
| What? | `credential_ref` |
| For what? | `capability` — `use` / `read` / `manage` (see below) |
| Until when? | `expires_at` — **no grant is perpetual by default** |

### Capabilities

| Capability | Meaning |
|---|---|
| `use` | The subject may cause the credential to be used on its behalf. **The value is never returned.** This is the default and the overwhelmingly common case. |
| `read` | The value is returned to the subject. Reserved for processes that genuinely cannot be brokered (§6). Every `read` grant must carry a recorded justification. |
| `manage` | The subject may create, rotate, or revoke the credential. **Never granted to an AI agent.** |

### Subjects include AI agents, explicitly

An AI agent is a subject with its own identity, its own grants, and its own audit trail — not a borrower of a human's. Today's Gateway blocker #1 is exactly this defect stated in advance: an agent about to inherit a human's personal GitHub token, because there is no way to issue it one of its own.

---

## 6. VAULT_AGENT_RULE — broker, do not dispense

**Decision: the default interaction is brokered. Vault performs the authenticated action and returns the result. It does not hand the credential over.**

```text
   Agent ──"call GitHub as me"──▶ Vault ──(injects credential)──▶ GitHub
   Agent ◀────── result ─────── Vault
              (the value never enters the agent's context)
```

This is the single most important property of the design, and the one most easily lost in implementation. A value returned to an AI agent is a value in a context window, in a transcript, in a log, in an error message, in a summary handed to the next session. Once there, it is unrecallable — it must be treated as exposed and rotated at the source per `AUTOMATION_SECURITY_AND_SECRETS.md` §6, regardless of whether anyone is known to have seen it.

`read` is therefore a **narrow, justified exception**, not a convenience:

- it requires an explicit `read` capability, never granted implicitly by `use`;
- it requires a recorded reason;
- it is audited distinctly from `use`;
- it is preferentially replaced by a brokered path as each integration matures.

**Corollary — the display rule.** A user interface may show that a credential exists, its provider, its status, its expiry, who holds a grant, and when it was last used. It does not show the value. "Reveal" is not a feature that ships by default; where an operational need for it is demonstrated, it is a `read` grant with the full audit consequences above, not a UI toggle.

---

## 7. VAULT_LIFECYCLE — status, expiry, rotation, revocation

Every credential carries a status. The vocabulary is closed:

| Status | Meaning |
|---|---|
| `active` | Usable now |
| `expiring` | Past its rotation-due date, still usable — an operational warning, not an outage |
| `expired` | Refused; the provider credential may or may not still work |
| `revoked` | Refused permanently; a revoked reference is never reused |
| `compromised` | Refused, and flagged for source rotation per the exposure rule |

### Rotation

Rotation replaces the **value** behind a reference. The reference does not change, which is what makes rotation possible at all: every consumer holds `cred_…`, so nothing downstream needs reconfiguring, redeploying, or even notifying. That property is the practical reason §4's reference model is worth the indirection.

`rotated_at`, `expires_at` and `rotation_policy` already exist in `aut_secret_references` and are the fields that carry this. They are currently *recorded* but not *enforced*; Vault is where enforcement becomes possible.

### Revocation

Revocation is not deletion. A revoked credential's record and audit history are retained — deleting the record destroys exactly the evidence needed after an incident. Revocation must be effective **without** requiring cooperation from the consuming service: that is only true if consumers hold references rather than copies, which §4 guarantees.

### Compromise

The existing rule stands unchanged and is restated here because it is the one rule most likely to be softened under time pressure: **a credential that appears in a forbidden location is compromised from that moment, independent of whether anyone is known to have used it.** Deleting the exposed copy is not remediation. Rotation at the source is.

---

## 8. VAULT_AUDIT — every resolution is an event

**Decision: `use`, `read`, `manage`, grant changes, rotations, revocations, and *denials* are all recorded.**

Denials matter as much as successes. A denied resolution is the signal that a subject is reaching for something it should not have, or that a grant expired without anyone noticing — the two events most worth seeing early.

Audit records carry: `credential_ref`, `subject_ref`, capability, outcome, timestamp, and calling context. They carry **no value, no fragment of a value, and no PII** — `AUTOMATION_SECURITY_AND_SECRETS.md` §7 governs identifiers here exactly as it does elsewhere: `subject_ref` is opaque, never a name or an email address.

Audit integrates with the platform audit surface rather than becoming a second one — the same discipline the Status Center follows for state (one measured source of truth, never a second asserter).

---

## 9. Integration contracts

Two interfaces, deliberately minimal, both stated as contracts a future implementation must satisfy — neither is implemented by this stage.

```text
broker(subject_ref, credential_ref, action)
    → { ok: true, result }                  the action was performed; NO value returned
    → { ok: false, reason }                 denied, expired, revoked, or unknown

resolve(subject_ref, credential_ref)
    → { ok: true, value }                   requires an explicit `read` grant; fully audited
    → { ok: false, reason }
```

Callers of `resolve` are, by construction, the ones that will need re-examination during any future security review. Keeping them countable is a design goal, and the reason `broker` is listed first.

### Consuming layers

| Layer | Relationship to Vault |
|---|---|
| **MYTHOS Identity & Trust** | Authenticates the subject. Vault never authenticates; it authorises an already-authenticated subject. |
| **MYTHOS Permissions / Policies** | A grant is necessary but not sufficient — platform policy may still deny. Vault is not a second policy engine. |
| **MYTHOS Audit** | Receives Vault events; does not duplicate them. |
| **MYTHOS Gateway** | The largest consumer. Per-client tokens become issued, expiring, revocable credentials with grants — closing blocker #2 structurally rather than by remembering to be careful. |
| **MYTHOS Unified Portal** | Presents credential *state* to a human — existence, provider, status, expiry, grants, last use. Never the value (§6). |
| **Automation / n8n connectors** | Already reference `secret_reference_id`. This is the pattern being generalised, not a migration. |

---

## 10. Migration path — additive, never a big-bang cutover

Ordered, each step independently valuable and independently abandonable. **No step is authorised by this document.**

1. **Inventory.** Record every credential in §2.2 as a metadata-only reference — provider, purpose, owner, environment, status, expiry. *No value moves.* The platform gains an inventory it does not currently have, at zero risk. This is the natural next stage.
2. **Reference adoption.** New integrations take a `cred_…` reference from birth. Existing ones are untouched.
3. **Backend decision.** Choose and authorise a backend (§11). Owner decision, not taken here.
4. **Broker the highest-value paths first** — Gateway per-client tokens and the AI provider credentials, where agent exposure risk is concentrated.
5. **Migrate values one credential at a time**, verifying the consuming service after each. A credential is only removed from its file location after the brokered path is proven, never before.
6. **Retire `read` grants** as brokered paths replace them.

**The order is deliberately inventory-first.** Step 1 delivers most of the answerability benefit — what exists, who owns it, what expires — with no possibility of breaking a running service, which is why it precedes the backend choice rather than following it.

---

## 11. Explicitly deferred — owner decisions, not architecture gaps

| Deferred | Why it is not decided here |
|---|---|
| **Backend choice** (HashiCorp Vault / OpenBao / Infisical / a MYTHOS-native store) | Deploying a secret manager is an infrastructure commitment with an operational burden, an unseal/recovery story, and a permanent dependency for every service. Naming a product before the inventory exists is choosing a tool before knowing the workload. **This stage explicitly deploys none.** |
| **Encryption-at-rest and key custody** | Follows the backend choice; a key-management design written against no backend is fiction. Note the recursion it must resolve: whatever protects the vault cannot itself live in the vault (§3). |
| **Unseal / disaster recovery** | The blocking question for any implementation: if the host is lost, what brings credentials back, and who holds that? Belongs with the backend decision, and must be answered *before* production dependency, not after. |
| **Break-glass access** | Needs a named human process, not code. |
| **OAuth refresh-token flows** | Provider-specific; designed per integration once the reference model exists. |
| **Multi-tenant credential isolation** | Follows the tenancy model in the OS kernel; deciding it here would freeze a seam in the wrong shape. |

Deferring these costs nothing, because §4–§9 freeze what actually needs freezing — the **reference model, the grant model, and the no-value-to-agents rule**. Any backend can satisfy them; none of them has to be reopened when one is chosen.

---

## 12. Non-goals

- Vault is **not** an identity provider. It never authenticates a human.
- Vault is **not** a policy engine. It authorises credential use, not platform actions.
- Vault is **not** a general encrypted data store.
- Vault is **not** a password manager for the owner's personal accounts.
- Vault does **not** replace `AUTOMATION_SECURITY_AND_SECRETS.md`. It implements it.

---

## 13. What this stage did and did not do

**Did:** wrote this document; recorded the verified credential topology in §2 from direct inspection of file names, ownership and modes; indexed the component in `MYTHOS_SYSTEM_INDEX.md` §20A; recorded the stage in `docs/AI_HANDOVER.md`.

**Did not, and was not authorised to:**

- deploy HashiCorp Vault, Infisical, OpenBao, or any other secret manager;
- create, copy, move, print, or read the value of any credential — §2.2 was built entirely from `ls` metadata;
- modify any existing production credential, file mode, owner, or service;
- change the MYTHOS Gateway implementation, or any file on `feat/mythos-gateway`;
- reload nginx, issue a Gateway client token, or bind a GitHub credential to the Gateway — the three owner-gated steps remain exactly as they were;
- alter `aut_secret_references`, its schema rule, or any automation table;
- touch the two pre-existing production-tracked working-tree files on `main`.

**Status:** DESIGNED. Zero runtime footprint. The next stage that may proceed without a new owner decision is §10 step 1 — the metadata-only inventory.
