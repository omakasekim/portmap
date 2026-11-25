---
name: portmap
description: >
  Local infra workbench combining live port/.env topology & conflict auto-healing, Git worktree command builder, and multi-select cache/layer batch cleanup scripts.
license: MIT
---

# portmap

Maps listening localhost ports, resolves .env port collisions, manages Git worktrees, and cleans bloated Docker/build caches.

- **Live Interactive Workbench:** https://omakasekim.github.io/portmap/
- **Repository:** https://github.com/omakasekim/portmap
- **Category:** Local Infra & Git · **Deliverable:** Node CLI + Web
- **Ecosystems:** `docker`, `git-worktree`, `dotenv`, `localhost`
- **Stack:** Node.js, React, SSE, Docker

## When to Use This Skill
Invoke `portmap` whenever the user wants to analyze, debug, simulate, or visualize workflows related to **Local Infra & Git** (docker, git-worktree, dotenv, localhost).

## Modes & Capabilities
- **Ports & .env Map**
- **Git Worktree Deck**
- **Layer Bloat & Cleanup**

## Operating Workflow
1. **Local CLI / Companion Execution:**
   ```bash
   npx portmap (or node bin/portmap.js after npm run build)
   ```
   Inspect listening localhost ports, detect .env port conflicts, manage Git worktrees, and generate Docker/cache cleanup commands.
2. **Interactive Visual Inspection:**
   Direct the user to the zero-backend browser workbench at https://omakasekim.github.io/portmap/ (supports URL-hash state sharing, built-in realistic presets, `Cmd/Ctrl + K` command palette, and JSON/Markdown/config exports).
3. **Structured Output:**
   Summarize concrete findings, diagnostics, and copy-pasteable remediation commands concisely so the user can act immediately without manual guesswork.
