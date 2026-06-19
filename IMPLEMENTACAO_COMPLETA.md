# Estado da Implementação

## Dashboard

- [x] Faixa compacta **Conta em uso** antes da visão geral.
- [x] Priorização por `activeAccountId`, com fallback para `lastUsedAt` dentro de uma hora.
- [x] Barras separadas de 5h e semanal.
- [x] Visão geral compacta por conta, filtros, ordenação e badges de plano.
- [x] Leitura resumida preservada em desktop e no viewport `390x844`.
- [x] Estado visível para dados atrasados.

## Notificações

- [x] Menu com visão **Todas** e **Por conta**.
- [x] Toggle global, por tipo e por conta.
- [x] Reset semanal para `99%` ou `100%` após saldo abaixo de `90%`, mostrando `De X para Y` no corpo do alerta.
- [x] Reset de 5h para `99%` ou `100%` após saldo de 5h abaixo de `90%`, apenas com semanal disponível e mostrando `De X para Y`.
- [x] Semanal acima de `30%` a até 24h do reset.
- [x] Semanal baixo.
- [x] Dados atrasados ou falha de carga.
- [x] 5h baixo opcional, desligado por padrão.
- [x] Motor isolado e coberto por testes determinísticos.
- [x] Cenários locais para permissão `default`, `denied`, `granted` e `unsupported`.

As notificações usam Web Push em background quando há subscription; notificações locais do navegador/PWA permanecem como fallback com o app ativo.

## Dados e Automação

- [x] `activeAccountId` e `lastUsedAt` preservados do Switcher até a API e o frontend.
- [x] Publicação automática isolada na branch `usage-data`.
- [x] Resumo gerado de forma consistente.
- [x] Modo `--verify-only` sem escrita.
- [x] Auditor de saúde dos snapshots e LaunchAgents.

Estado externo observado na auditoria atual:

- Switcher carregado, execução saudável e publicação recente em `usage-data`.
- Antigravity sem LaunchAgent carregado; o snapshot continuará antigo até o agente ser instalado/carregado e o app estar aberto com permissões.

## PWA e Validação

- [x] Service Worker com assets críticos e fallback offline.
- [x] Manifest, splash, HTML e cache usando caminhos consistentes.
- [x] Cache atual: `codex-usage-v36`.
- [x] Validação integrada com `npm run validate`.
- [x] Proteção da Vercel e widgets verificada pelo auditor estático.

## Critério de Finalização

Uma alteração só está pronta após:

1. `npm run validate` passar.
2. `/api/usage` responder com o contrato esperado.
3. Dashboard e menus serem comparados no Browser in-app em desktop e `390x844`.
4. Não existirem erros de console, cortes ou sobreposições.
5. Nenhum deploy, commit ou push ocorrer sem solicitação explícita.
