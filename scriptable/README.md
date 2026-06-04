# Widgets Scriptable

Os widgets iOS leem snapshots públicos da branch `usage-data` e mantêm cache local para falhas temporárias de rede.

## Widgets

- `large-widget.js`: resumo combinado de Codex e Antigravity via `usage_summary.json`.
- `codex-accounts-large-widget.js`: visão compacta das contas via `codex_usage.json`.
- `Codex_Usage_leosaquetto.js`: widget legado com produção em `usage-data` e staging explícito.

Campos adicionais como `activeAccountId` e `lastUsedAt` são compatíveis com os widgets atuais; campos desconhecidos são ignorados.

## Atualização

O fluxo principal do Codex usa o Switcher:

```bash
npm run update:codex-usage:switcher:auto
```

O Antigravity só captura quando o app está aberto:

```bash
npm run update:antigravity-usage:auto
```

Audite snapshots e LaunchAgents com:

```bash
npm run audit:automation
```

## Regra de publicação

- Dados automáticos: branch `usage-data`.
- Código do dashboard: `main`.
- Widgets não devem ler snapshots automáticos da `main`.
- Nenhum token deve ser salvo nos scripts ou no repositório.
