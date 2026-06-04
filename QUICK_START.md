# Início Rápido

## Dashboard local

```bash
npm install
npm run dev
```

Abra:

```text
http://127.0.0.1:8080/
```

## Validação completa

```bash
npm run validate
```

Validações específicas:

```bash
npm run test:codex-usage-parser
npm run test:antigravity-usage-parser
npm run test:notifications
npm run test:usage-api
npm run validate:static
node scripts/build-usage-summary.mjs --verify-only
```

## Saúde das automações

```bash
npm run audit:automation
```

O relatório informa:

- snapshot usado no worktree `usage-data`;
- idade dos dados do Codex e Antigravity;
- estado e último exit code dos LaunchAgents.

## Atualizar dados

Publicação segura pelo worktree `usage-data`:

```bash
npm run update:codex-usage:switcher:auto
npm run update:antigravity-usage:auto
```

Atualização local sem publicação:

```bash
npm run update:codex-usage:switcher
node scripts/update-antigravity-usage-auto.mjs --dry-run
```

Não use commit/push de snapshots automáticos a partir da `main`.

## Testar notificações localmente

```text
http://127.0.0.1:8080/?notificationPermission=default
http://127.0.0.1:8080/?notificationPermission=denied
http://127.0.0.1:8080/?notificationPermission=granted&notificationDryRun=1
http://127.0.0.1:8080/?notificationPermission=unsupported
```

Os parâmetros só têm efeito em `localhost` e `127.0.0.1`.
