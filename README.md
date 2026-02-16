# Matrix CLI

Matrix CLI is a terminal-first **Agentic Development Runtime**.
It is designed to run a full engineering loop in one place:

`PRD -> Plan -> Approval -> Implement -> QA -> Review -> Refactor`

This repository is a TypeScript monorepo powered by `pnpm` workspaces and Turborepo.

## What Matrix Is

- A plan-first CLI/TUI development runtime
- A state-machine driven workflow engine
- A safety-focused system with diff gating, policy checks, and secret redaction
- A modular architecture with model adapters, context engine, MCP runtime, and prompt library
- A productized workflow with onboarding, incident, and readiness metrics

## What Matrix Is Not

- Not a generic "terminal chatbot"
- Not an uncontrolled auto-edit tool
- Not a fully complete GA platform yet (this repo targets v0.1 public beta scope)
- Not a replacement for full visual IDE stacks

## Monorepo Structure

Main packages under `packages/`:

- `cli`: `matrix` command entrypoints
- `tui`: terminal UI (Ink)
- `core`: orchestrator, state machine, eventing, checkpoints
- `tools`: fs/git/exec/patch/search/test/lint helpers
- `models`: provider adapters and routing
- `auth`: login, quota, local key vault
- `context-engine`: context discovery, pruning, cache
- `mcp`: MCP registry/client runtime
- `prompts`: agent prompt library
- `security`: guardian gate and policy engine
- `acceptance`: PRD acceptance gate tests

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Build workspace:

```bash
pnpm build
```

3. Initialize Matrix files:

```bash
node packages/cli/dist/index.js init --force
```

4. Add a provider key:

```bash
node packages/cli/dist/index.js auth login openai --open
node packages/cli/dist/index.js auth add openai --key <API_KEY>
```

5. Verify environment:

```bash
node packages/cli/dist/index.js doctor --json
```

6. Start runtime:

```bash
node packages/cli/dist/index.js run
```

## Core CLI Commands

- `init`: create `.matrix/` project files
- `run`: start TUI or headless runtime
- `auth`: provider login-link, key vault, account status, plans
- `doctor`: environment health checks
- `telemetry`: mode, retention, and self-test controls
- `export-run <runId>`: export redacted run data
- `update`: channel update and rollback (`alpha|beta|stable`)
- `status`: local status or service status (`--service`)
- `onboarding`: onboarding success metrics
- `incident`: SEV drill and SLA tracking
- `readiness`: PRD-aligned release readiness report

Help:

```bash
node packages/cli/dist/index.js --help
```

## Typical Usage Flow

1. Start with `run` and use `/new`
2. If needed run `/login openai` (or `/auth login openai`) from TUI
3. Draft and approve plan
4. Implement with diff approvals
5. Run QA/review/refactor loops
6. Export run if needed
7. Validate release gates with readiness checks

## Security and Privacy

- Default telemetry mode is `off`
- Secret redaction is enforced in telemetry/export paths
- Provider keys are stored locally (keychain or encrypted fallback vault)
- Run security scan:

```bash
pnpm security:scan
```

## Product Readiness Gates

Before release:

```bash
pnpm --filter @matrix/acceptance run test:report
node packages/cli/dist/index.js readiness --json
```

Readiness consolidates acceptance results, telemetry privacy, onboarding gate, SEV-2 SLA, CI matrix, update/rollback smoke, and security scan signals.

## Development Commands

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm security:scan
```

## Documentation

- PRD: `prd.md`
- Contributor/agent rules: `AGENTS.md`
- Onboarding docs: `docs/onboarding/`

## License

MIT
