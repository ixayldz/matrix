# Known Limitations (v0.1)

## Scope Limits
- CI/headless autonomous mode is not GA-complete.
- Firecracker/microVM sandbox is not included in v0.1.
- Full debugger integration is out of scope.
- Real-time multi-user editing is out of scope.

## Operational Limits
- `matrix status --service` depends on remote endpoints and may degrade gracefully when unreachable.
- Update/rollback relies on npm registry availability.
- Incident/onboarding readiness metrics are local by default (`~/.matrix/metrics/*`).

## Compatibility Notes
- Command UX targets Claude-style parity on a best-effort basis.
- Some advanced workflows still require explicit user approval for safety.

## Recommended Mitigations
- Run `pnpm matrix doctor --json` before first project run.
- Run `pnpm matrix readiness --json` before release or rollout promotions.
- Keep telemetry mode at `off` unless explicit opt-in is needed.

