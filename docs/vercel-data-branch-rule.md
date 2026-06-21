# Regra: dados automaticos nunca devem disparar deploy na Vercel

Este repo separa codigo do webapp e snapshots de dados. Essa separacao e intencional e nao deve ser revertida.

## Regra principal

- Commits automaticos de dados devem ir para a branch `usage-data`.
- Commits de codigo do dashboard devem ir para a branch de deploy, hoje `main`.
- Arquivos JSON gerados automaticamente nao devem ser publicados por commits na branch monitorada pela Vercel.
- A Vercel deve continuar recebendo deploy apenas quando houver alteracao real de codigo/config do webapp.

## Dados automaticos

Os arquivos abaixo pertencem ao fluxo automatico de dados e devem ser atualizados na branch `usage-data`:

- `codex_usage.json`
- `codex_usage_history.json`
- `usage_summary.json`
- `antigravity_usage.json`

Para auditoria de dados vivos, leia esses arquivos no worktree `.local/usage-data-worktree` ou na URL raw da branch `usage-data`. Os JSONs com os mesmos nomes na raiz da `main` sao snapshots locais/legados e nao devem ser usados para decidir se o dashboard esta correto, exceto quando o servidor tiver sido iniciado propositalmente com `CODEX_USAGE_USE_LOCAL_FILES=1`.

Widgets, dashboard e APIs que precisam desses dados devem ler a branch `usage-data`, por exemplo:

```js
https://raw.githubusercontent.com/leosaquetto/codex-usage/usage-data/codex_usage.json
https://raw.githubusercontent.com/leosaquetto/codex-usage/usage-data/usage_summary.json
```

Nao trocar essas URLs de volta para `main` sem uma migracao explicita e validada.

## Especificidades do Antigravity CLI

- O CLI `antigravity-usage` retorna o campo `remainingPercentage` como uma fração decimal entre `0.0` e `1.0` (por exemplo, `0.9992` representando `99.92%`).
- O atualizador automático (`scripts/update-antigravity-usage-auto.mjs`) multiplica esse valor por `100` (`model.remainingPercentage * 100`) antes de aplicar o `clampPercent` para normalizar o percentual entre `0` e `100` antes de salvar.
- Mock e testes devem espelhar esse comportamento do CLI real usando valores decimais (ex: `0.8` para 80%).

## Como atualizar dados

Use o wrapper que prepara um worktree dedicado na branch `usage-data`:

```bash
npm run update:codex-usage:auto
npm run update:codex-usage:switcher:auto
npm run update:antigravity-usage:auto
```

Ou diretamente:

```bash
node scripts/run-usage-data-update.mjs switcher
node scripts/run-usage-data-update.mjs playwright --ensure-cdp --close-cdp
node scripts/run-usage-data-update.mjs antigravity
```

Nao rode scripts com `--commit --push` a partir de `main` para publicar JSONs automaticos.

O mesmo wrapper dispara o endpoint de Web Push depois da publicacao. A configuracao fica em `.local/push-dispatch.env`; esse arquivo contem segredo operacional, e ignorado pelo Git e nao altera a regra de branch dos JSONs.

## O que nao fazer

- Nao resolver isso com `ignoreCommand`.
- Nao depender de `vercel.json` ou build script para cancelar build depois que a Vercel ja criou um deployment.
- Nao mover `codex_usage.json`, `codex_usage_history.json` ou `usage_summary.json` para dentro de `webapp/`.
- Nao alterar `rootDirectory`, `buildCommand` ou a estrutura do webapp para acomodar dados automaticos.
- Nao voltar widgets ou APIs para `raw.githubusercontent.com/.../main/...` quando o dado vem do fluxo automatico.

`ignoreCommand` pode impedir o build, mas a tentativa de deployment ja foi criada. Para este projeto, isso ainda conta como churn de deploy e nao atende ao objetivo.

## Checklist antes de mexer nesse fluxo

1. Confirme se a mudanca altera dados automaticos ou codigo do webapp.
2. Se alterar apenas dados, publique em `usage-data`.
3. Se alterar codigo do dashboard, publique pelo fluxo normal de deploy.
4. Confirme que widgets Scriptable usam URLs da branch `usage-data`.
5. Confirme que `webapp/api/usage.js` continua lendo `CODEX_USAGE_GITHUB_BRANCH` com default `usage-data`.
6. Confirme que `webapp/vercel.json` mantem deployments Git desativados para `usage-data`.

## Teste esperado

- Push contendo apenas JSONs automaticos na branch `usage-data`: nao cria deployment na Vercel.
- Push contendo alteracoes de codigo do webapp na branch de deploy: cria deployment normal.
- Widget Scriptable continua lendo dados atualizados pela URL raw da branch `usage-data`.
