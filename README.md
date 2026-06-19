# Codex Usage

Dashboard local/PWA para acompanhar limites de 5 horas e semanal de várias contas do Codex, com atualização automática pelo Codex Switcher.

## Arquitetura

- `scripts/update-codex-usage-from-switcher.mjs`: lê as contas locais do Switcher, consulta uso e gera os snapshots públicos.
- `scripts/run-usage-data-update.mjs`: executa atualizações em um worktree dedicado à branch `usage-data`.
- `webapp/api/usage.js`: lê a branch `usage-data` em produção e arquivos locais no servidor de desenvolvimento.
- `webapp/`: dashboard PWA, faixa de conta em uso, visão geral, redefinições por e-mail, filtros, gráficos e Web Push.
- `scriptable/`: widgets iOS que leem diretamente a branch `usage-data`.

Os snapshots automáticos ficam na branch `usage-data`. A branch `main` contém código e pode manter cópias antigas dos JSONs por design. Para dados vivos, considere corretos apenas `codex_usage.json`, `codex_usage_history.json` e `usage_summary.json` da branch `usage-data`.

## Executar localmente

```bash
npm install
npm run dev
```

Abra `http://127.0.0.1:8080/`.

Por padrão, o servidor local lê a mesma branch `usage-data` usada em produção. Para forçar os JSONs da raiz em uma investigação local, execute com `CODEX_USAGE_USE_LOCAL_FILES=1`; esse modo é apenas investigativo e não representa a fonte correta do dashboard/celular. Para conferir a saúde da fonte publicada e dos LaunchAgents:

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
- FREE/GO com janela de 30 dias aparecem como `30d` e não entram em redefinições semanais.
- O histórico de redefinições usa o e-mail normalizado como identidade, mesmo quando a conta é removida e reinserida.
- A visão **Todas** junta eventos de todas as contas em ordem decrescente; os filtros por conta isolam o histórico selecionado.
- Eventos antecipados exibem o saldo semanal anterior e posterior. Mudanças de reset em que o semanal permanece em `99%` ou `100%` são descartadas como continuidade de saldo cheio.
- Dados com mais de uma hora são marcados como atrasados.
- Notificações podem ser ativadas globalmente, por tipo e por conta.
- Alertas disponíveis: reset semanal para `99%` ou `100%` após saldo abaixo de `90%`, reset de 5h para `99%` ou `100%` após saldo de 5h abaixo de `90%` e com semanal disponível, semanal baixo, semanal acima de `30%` a até 24h do reset, dados atrasados/falha e 5h baixo opcional.

## Web Push em background

O app instalado registra uma subscription Web Push em `/api/push-subscription`. As subscriptions e o estado de deduplicação ficam em um Vercel Blob privado. Depois de cada atualização do Switcher, `scripts/run-usage-data-update.mjs` chama `/api/push-dispatch`, que avalia as mesmas regras do navegador e envia alertas mesmo com o PWA fechado.

Variáveis obrigatórias na Vercel:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_DISPATCH_SECRET`
- `BLOB_READ_WRITE_TOKEN`

O segredo de dispatch local fica somente em `.local/push-dispatch.env`, que é ignorado pelo Git. No iOS, abra o app instalado ao menos uma vez após o deploy e toque em **Permitir** nas notificações para criar a subscription do aparelho.

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
