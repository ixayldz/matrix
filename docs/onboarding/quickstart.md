# Matrix CLI 10-Minute Quickstart

## Prerequisites
- Node.js `>=18`
- `pnpm` `>=9`
- A provider API key (OpenAI/GLM/MiniMax/Kimi)

## 1) Install Dependencies
```bash
pnpm install
pnpm build
```

## 2) Initialize a Project
```bash
pnpm matrix init --force
```
This creates `.matrix/config.json`, `.matrix/mcp.json`, `MATRIX.md`, and `AGENTS.md`.

## 3) Add Provider Key
```bash
pnpm matrix auth login openai --open
pnpm matrix auth add openai --key <YOUR_API_KEY>
```

## 4) Verify Environment
```bash
pnpm matrix doctor --json
```
Expected: `status` should be `pass` or `warn`.

## 5) Start Runtime
```bash
pnpm matrix run
```
Then run flow commands: `/new`, `/login openai` (if needed), `/plan`, `/build`, `/qa`, `/review`.

## 6) Optional Readiness Snapshot
```bash
pnpm matrix readiness --json
```
