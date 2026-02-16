# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-02-16

### Added
- Provider-aware auth helper for TUI (`packages/tui/src/auth/provider-auth.ts`).
- Cross-platform browser opener utility for auth links (`packages/tui/src/platform/open-url.ts`).
- New TUI shortcut command: `/login [provider]` (`/link` alias).
- Store tests for scroll offset behavior (`packages/tui/src/store.test.ts`).

### Changed
- `/new` now checks provider auth status and guides the user with login + key setup steps.
- `/auth use <provider>` now synchronizes provider/model preset more reliably in runtime.
- CLI auth flow now supports provider onboarding command:
  - `matrix auth login [provider] --open`
- Onboarding docs and README were updated to reflect the new auth-first flow.

### Fixed
- Resolved React hook-order error in `DiffViewer` causing TUI startup fallback/crash.
- Improved panel rendering and scrolling behavior to reduce flicker/jitter in terminal usage.

### Validation
- `pnpm --filter @matrix/tui test`
- `pnpm --filter @matrix/tui build`
- `pnpm --filter @matrix/cli test`
- `pnpm --filter @matrix/cli build`
