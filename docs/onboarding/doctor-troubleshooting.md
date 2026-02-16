# `matrix doctor` Troubleshooting

## Run
```bash
pnpm matrix doctor --json
```

## Common Checks and Fixes

### `permissions` = fail
- Cause: current directory is not writable.
- Fix: run in a writable workspace or update directory permissions.

### `keychain` = warn
- Cause: OS keychain integration not available.
- Fix: install keychain dependency or use vault fallback:
  - `MATRIX_VAULT_PASSWORD=<password>`

### `network` = warn
- Cause: API endpoints are unreachable.
- Fix: verify internet, VPN/proxy, and TLS inspection settings.

### `telemetry_privacy` = fail
- Cause: telemetry contract self-test failed.
- Fix:
  - `pnpm matrix telemetry off`
  - `pnpm matrix telemetry self-test --mode off --json`

### `sandbox` = warn
- Cause: sandbox policy is not configured.
- Fix: enable and configure sandbox policies in `.matrix/config.json`.

## Escalation Bundle
For bug reports include:
- `pnpm matrix doctor --json`
- `pnpm matrix readiness --json`
- relevant redacted logs (`matrix export-run <runId>`)

