# Repository Guidelines

## Project Structure & Module Organization
This repo is a TypeScript monorepo managed with `pnpm` workspaces and Turborepo.
- Root: shared config (`tsconfig.json`, `turbo.json`, `pnpm-workspace.yaml`) and orchestration scripts.
- Packages: `packages/*` (e.g., `core`, `cli`, `tools`, `security`, `models`, `tui`, `mcp`, `auth`, `prompts`, `context-engine`).
- Source code lives in each package's `src/`; build output is `dist/`.
- Product and behavior notes are in `prd.md`.

Example paths: `packages/core/src/orchestrator.ts`, `packages/tui/src/components/ChatPanel.tsx`.

## Build, Test, and Development Commands
Use Node 18+ and `pnpm` 9.
- `pnpm install`: install workspace dependencies.
- `pnpm build`: build all packages via Turbo (`dist/**` outputs).
- `pnpm dev`: run package `dev` tasks in watch mode.
- `pnpm test`: run package test scripts (`vitest run`).
- `pnpm typecheck`: run `tsc --noEmit` across packages.
- `pnpm matrix`: run the CLI entrypoint (`@matrix/cli`), typically after build.
- `pnpm clean`: clear build artifacts.

## Coding Style & Naming Conventions
- Language: strict TypeScript (`strict`, `noUnusedLocals`, `noImplicitReturns`, etc.).
- Formatting style in current codebase: 2-space indentation, semicolons, single quotes.
- File naming: use `kebab-case` for utility/modules (e.g., `state-machine.ts`); use `PascalCase` for React components (e.g., `SessionPanel.tsx`).
- Package imports use workspace aliases like `@matrix/core` and `@matrix/tools/*`.

## Testing Guidelines
- Framework: Vitest (configured in package scripts).
- Test file names: `*.test.ts`, `*.spec.ts` (and `*.test.tsx`/`*.spec.tsx` for TUI).
- Run all tests with `pnpm test`; run package-local tests with `pnpm --filter @matrix/core test`.
- No coverage threshold is currently enforced; include tests for new logic and regression-prone flows.

## Commit & Pull Request Guidelines
No `.git` history is available in this workspace snapshot, so no proven local commit convention can be inferred.
Use Conventional Commits going forward (e.g., `feat(core): add retry guard`, `fix(cli): handle missing config`).

For PRs:
- Keep scope focused to one change set.
- Include a short problem/solution summary and affected packages.
- Link related issues/tasks.
- Add terminal output or screenshots for CLI/TUI behavior changes.
- Confirm `pnpm build`, `pnpm typecheck`, and `pnpm test` pass.
