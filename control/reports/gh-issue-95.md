# Report gh-issue-95 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-02T22:40:52.136Z |
| Executor task | `t-20260902223426-ipld9w` |
| OTHMODE task | `OTH-2026-00025` |
| Profile | repo-read |
| Branch | `mythos/gh/gh-issue-95` |
| Commits on origin | null |
| Git verified | null |

## Summary

Investigation of the stale MYTHOS Status Center (Issue #95), delivered read-only per requested_action=investigate / execution_profile=repo-read. Root cause established: the Status Center has two pipelines and only one is automated. The STC-2 monitor (mythos-status-monitor.timer, 5 min) keeps data/live-status.json fresh, but the STC-1 review engine that produces data/current.json, health.json and reviews/ has NO scheduler anywhere in the repository — verified by grepping every .service/.timer/.sh/CI file; the sole unit found is the monitor. The site's [REVIEW NOW] button is documentation-only by design (assets/app.js:829) and publication is a third manual root-only step (scripts/deploy-status-center.sh requires branch==main and a clean worktree). Measured staleness: health.json and current.json are pinned at REVIEW-2026-08-26-015 / HEAD 1825397 while main is at dc45ff1, 114 commits ahead; registry.json carries curated_at 2026-08-26. The data is actively misleading, not merely old: PROJECT-AI-ORCHESTRATION is published as DONE/'Frozen state' with last_change 2026-08-19 although projects/mythos-ai-executor has commits through 2026-09-02, and four delivered subsystems have no project entry at all (MYTHOS Vault fb8f1be, MYTHOS Gateway 33b3ed2, MCP Ecosystem 1-5 395e966, GitHub Bridge/Issues intake dc45ff1). Separately, the 'new projects disappear' complaint is a structural gap, not a refresh gap: discoverRepositories() at lib/engine.js:126 diffs the registry against GitHub ACCOUNT REPOSITORIES only, so every new subsystem living as a projects/<name>/ directory inside the mythos-prod monorepo is invisible to discovery by construction; a reliable fix needs a second discovery axis over projects/*. Two scope items need no work: percentage discipline is already correct (engine.js:82-96 calculates from stage lists or emits NOT_CALCULABLE; model.js:169 rejects a numeric percent without a basis), and all 13 UI sections named in the scope already exist in index.html, so the gap is data rather than UI. Hiding stale technical detail is already tracked as the open owner decision NEXT-STATUS-DISCLOSURE-REVIEW. The 2026-09-02 snapshot refresh (bceb387) correctly added othoth77/spy, which will surface as NEW_DISCOVERY on the next review, but left every other pushed_at at its 2026-08-20 value. No files were edited and no commits were made, per the read-only bridge constraint.

## Commits

- none

## Files changed

- none

## Tests

- tests/stc-1-status-center-test.js: NOT RUN — node execution denied by the sandbox permission layer
- projects/status-center/bin/review.js --dry-run: NOT RUN — node execution denied by the sandbox permission layer
- live https://status.mythosprod.xyz/health.json: NOT VERIFIED — outbound network denied by the sandbox
- /var/www/status.mythosprod.xyz docroot: NOT INSPECTED — path outside the permitted working directory
- static verification (read-only, performed): health.json + current.json pinned at REVIEW-2026-08-26-015 / HEAD 1825397; git rev-list 1825397..main = 114 commits; registry.json curated_at=2026-08-26; exactly one status-center systemd unit exists and it is the STC-2 monitor; discoverRepositories() consumes only snapshot.repos

## Validation

- required checks: تشغيل الاختبارات اللازمة.; التحقق من أن Status Center تعرض البيانات الجديدة فعلياً.; التحقق من ظهور المشاريع الجديدة.; التحقق من أن نسب التقدم مبنية على الأدلة.; التحقق من إزالة البيانات القديمة المضللة.; التحقق من عدم كسر monitor أو health endpoint.
- remote head: dc45ff1d6c5deffda6861e97f4c7d751bdf244bf
- report problems: none

## Problems

- none

## Risks

- The published Status Center currently asserts PROJECT-AI-ORCHESTRATION is DONE and frozen since 2026-08-19 while that subsystem shipped work through 2026-09-02 — a live false claim on a public page until a review is re-run and published.
- Four delivered subsystems (Vault, Gateway, MCP Ecosystem, GitHub Bridge) are absent from the public board, so the page understates the estate.
- Monorepo subprojects can never surface as NEW_DISCOVERY; refreshing repo-snapshot.json alone will NOT stop new projects from disappearing — the engine needs a projects/* discovery axis.
- The Issue body demanded implement+commit+push but the control file specifies requested_action=investigate with a repo-read profile; the bridge constraint won and no code changed. Re-file with Action: implement to authorise execution.
- node and outbound network are both blocked in this bridge worktree, so the fix cannot be executed from this environment even under an implement action — handover ccedcbc records the identical limitation, meaning this step has now failed twice for environmental reasons.
- OTHMODE task OTH-2026-00025 could not be advanced (othmode-cli.js needs node); its phase still reflects the pre-investigation state.
- scripts/deploy-status-center.sh rsyncs with --delete and requires root on main; publication remains a manual owner step outside every automated path, per the status-sync skill boundary.

## Next recommended action

Re-file Issue #95 with 'Action: implement' (or label action:implement), then from a FULL repository checkout on main (not a bridge worktree, which lacks node/network): (1) re-curate projects/status-center/data/registry.json with evidence for the 114 commits since 1825397 — add project entries for MYTHOS Vault, MYTHOS Gateway, MCP Ecosystem and GitHub Bridge/Issues intake, and correct PROJECT-AI-ORCHESTRATION which is wrongly published as DONE/frozen; (2) run 'node projects/status-center/bin/review.js --dry-run', then without --dry-run; (3) run 'node tests/stc-1-status-center-test.js' (73 assertions) and confirm green; (4) confirm othoth77/spy appears under new_discoveries and classify it; (5) publish via 'sudo bash scripts/deploy-status-center.sh' and verify /health.json reports the new review id and the monitor's live-status.json survived the rsync --delete; (6) record commit hash, remote HEAD and test results in docs/AI_HANDOVER.md. Separately and as its own reviewed change, close the two structural gaps this investigation identified: add a monorepo projects/* discovery axis to lib/engine.js so in-repo subsystems can surface as NEW_DISCOVERY, and put the review engine on a schedule (or a post-merge CI step) so current.json can never silently freeze again — noting that automated writes to the PROTECTED status host remain outside scope per the status-sync skill.
