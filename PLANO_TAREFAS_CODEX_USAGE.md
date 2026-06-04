# Plano Operacional do Codex Usage

## Fluxo obrigatório para mudanças

1. Identificar se a mudança é de código ou apenas de dados.
2. Preservar snapshots automáticos na branch `usage-data`.
3. Implementar sem expor tokens ou credenciais.
4. Rodar `npm run validate`.
5. Comparar no Browser in-app em desktop e `390x844`.
6. Conferir console, Service Worker e `/api/usage`.
7. Publicar somente após pedido explícito.

## Funcionalidades concluídas

- Conta ativa/última usada na última hora.
- Visão geral compacta por conta.
- Filtros e ordenação.
- Notificações locais globais, por tipo e por conta.
- Sinal de reset semanal alterado.
- Estado de dados atrasados.
- PWA com cache versionado.
- Auditor de automações e contratos.

## Manutenção recorrente

- Rodar `npm run audit:automation` quando dados parecerem antigos.
- Rodar `npm run validate` antes de qualquer publicação.
- Revisar permissões do Antigravity quando seu snapshot permanecer antigo.
- Incrementar a versão do cache ao alterar assets críticos.
