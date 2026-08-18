# oth-knowledge — Shared Engineering Memory

A single, simple, Git-based memory for **all** othoth77 projects. Plain Markdown, no tooling, no framework. Any developer or AI agent — regardless of provider — reads and updates it the same way.

## Purpose

Prevent solving the same difficult problem twice, and let a new developer or AI understand the whole environment quickly, without re-scanning every repository and every past conversation.

## Structure

```text
oth-knowledge/
├── README.md      ← this file: what this is, and the mandatory workflow
├── PROJECTS.md    ← map of ALL projects: repo, path, purpose, stack, key files, relationships
├── PROBLEMS.md    ← significant technical problems: investigation, failed attempts, root cause, fix
└── LESSONS.md     ← reusable, durable technical knowledge
```

That is the whole system. Do not add architecture to it.

## Current location

This knowledge base currently lives inside `othoth77/mythos-prod` under `oth-knowledge/`, because the AI session that created it could not create new GitHub repositories. It is deliberately self-contained: to promote it to a standalone `othoth77/oth-knowledge` repository, create the empty repo on GitHub and copy (or `git subtree split`) this directory into it — nothing in these files assumes it lives inside mythos-prod.

> **Note:** `othoth77/mythos-prod` is a **public** repository. Everything recorded here is therefore public. The no-secrets rule below is absolute.

## Mandatory workflow — BEFORE every development task

Before starting ANY development task, in any project:

1. Identify the project and repository.
2. Read the relevant project information in `PROJECTS.md`.
3. Search `PROBLEMS.md` for similar previous problems.
4. Search `LESSONS.md` for relevant previous knowledge.
5. Inspect the referenced files/folders in the real project.
6. Reuse an existing solution when applicable.
7. Only then begin implementation.

This review is mandatory before coding.

For work inside `mythos-prod` itself, this comes **in addition to** — not instead of — that repository's own rules (`AGENTS.md`, `docs/AI_HANDOVER.md`).

## Mandatory workflow — AFTER every completed task

After completing a meaningful development task, record the important information here. At minimum:

- What was changed, and why
- Exact files/folders affected
- Important commands used
- Problems encountered, root causes, solutions
- Verification performed
- Important discoveries — anything that could save time for the next developer or AI

Routing:

| If the task produced… | Update |
|---|---|
| Reusable, durable knowledge | `LESSONS.md` |
| A significant problem that took real investigation | `PROBLEMS.md` (use the template at the top of the file) |
| A change to a project's structure, purpose, stack, or key files | `PROJECTS.md` |

Do not document meaningless details, and never replace useful historical detail with a vague summary. If a problem required several attempts, preserve the initial assumption, the investigation, the failed approaches, the discovery, the final solution, and the verification.

## Rules

1. **Link everything to real projects.** Every record names the project, the repository (`owner/name`), and the exact paths involved, so a reader can jump straight from the record to the code.
2. **Do not invent information.** Record only what was verified. Mark unverified statements explicitly as `UNVERIFIED`.
3. **No secrets. Ever.** No passwords, API keys, tokens, or private credentials — only *where* a required secret is expected to exist and *how* the project expects it to be provided (e.g. environment variable name).
4. **Provider-independent.** Plain Markdown and Git only. Nothing here may depend on a specific AI vendor or tool.
5. **Keep it simple.** Three content files. If a file grows unwieldy, split by year (e.g. `PROBLEMS-2026.md`) — nothing more elaborate.
