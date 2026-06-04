# Codex Usage

Dashboard local/PWA para acompanhar limites de 5 horas e semanal de várias contas do Codex, com atualização automática pelo Codex Switcher.

## Arquitetura

- `scripts/update-codex-usage-from-switcher.mjs`: lê as contas locais do Switcher, consulta uso e gera os snapshots públicos.
- `scripts/run-usage-data-update.mjs`: executa atualizações em um worktree dedicado à branch `usage-data`.
- `webapp/api/usage.js`: lê a branch `usage-data` em produção e arquivos locais no servidor de desenvolvimento.
- `webapp/`: dashboard PWA, faixa de conta em uso, visão geral, filtros, gráficos e notificações granulares.
- `scriptable/`: widgets iOS que leem diretamente a branch `usage-data`.

Os snapshots automáticos ficam na branch `usage-data`. A branch `main` contém código e pode manter cópias antigas dos JSONs por design.

## Executar localmente

```bash
npm install
npm run dev
```

Abra `http://127.0.0.1:8080/`.

O servidor local usa os JSONs da raiz. Para conferir a saúde da fonte publicada e dos LaunchAgents:

```bash
npm run audit:automation
```

## Validar

```bash
npm run validate
```

Esse comando verifica sintaxe, parsers, contrato da API, notificações, consistência de `usage_summary.json`, assets PWA, widgets e proteção da branch `usage-data`.

`node scripts/build-usage-summary.mjs --verify-only` valida o resumo sem escrever arquivos.

## Atualizações automáticas

```bash
npm run update:codex-usage:switcher:auto
npm run update:antigravity-usage:auto
```

O Switcher deve publicar apenas na branch `usage-data`. Não rode atualizadores automáticos com commit/push diretamente na `main`.

O Antigravity só atualiza quando o aplicativo está aberto, o LaunchAgent está carregado e o processo possui permissões de Acessibilidade e Gravação de Tela.

## Dashboard

- A faixa **Conta em uso** prioriza a conta ativa do Switcher e, como fallback, a última usada na última hora.
- Agregados e ritmo semanal consideram somente contas pagas; FREE/GO continuam visíveis e filtráveis.
- Dados com mais de uma hora são marcados como atrasados.
- Notificações podem ser ativadas globalmente, por tipo e por conta.
- Alertas disponíveis: mudança do padrão de reset semanal, refill semanal, semanal baixo, dados atrasados/falha e 5h baixo opcional.

Em localhost, os cenários de permissão podem ser validados sem alterar a permissão real:

```text
?notificationPermission=default
?notificationPermission=denied
?notificationPermission=granted&notificationDryRun=1
?notificationPermission=unsupported
```

## Deploy

`webapp/vercel.json` desativa deployments Git para `usage-data`. Mudanças de dados não devem consumir deployments; mudanças de código seguem o fluxo normal da `main`.

Nenhum script de validação publica, commita ou envia dados.
