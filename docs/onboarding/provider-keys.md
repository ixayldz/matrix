# Provider Key Setup Guide

## Supported Providers
- `openai`
- `anthropic`
- `glm`
- `minimax`
- `kimi`

## Add a Key
```bash
pnpm matrix auth add openai --key <YOUR_API_KEY>
```
If keychain is unavailable, use fallback vault password:
```bash
pnpm matrix auth add openai --key <YOUR_API_KEY> --vault-password <PASSWORD>
```

## Check Key Status
```bash
pnpm matrix auth status
```

## Remove a Key
```bash
pnpm matrix auth remove openai
```

## Security Rules
- Keys are never sent to Matrix backend.
- Prefer OS keychain when available.
- Fallback storage is encrypted local vault (`~/.matrix/keys.enc`).
- Never commit keys in `.env`, source files, or test fixtures.

