# Plano de Tarefas — Codex Usage

## Objetivo
Implementar melhorias incrementais no Codex Usage com foco em confiabilidade offline, personalização visual, análise gráfica e alertas proativos.

## Ordem de execução
1. Service Worker (offline)
2. Dark/Light Toggle manual
3. Tema customizável (cores)
4. Gráficos (Chart.js ou Recharts)
5. Notificações Web Push (limite baixo)

---

## Tarefa 1 — Service Worker (iniciar por esta)

### Escopo
- Garantir funcionamento básico offline para assets críticos e tela principal.
- Não alterar APIs, integrações externas ou fluxos de deploy.

### Entregáveis
- Registro do Service Worker no frontend principal.
- Estratégia de cache para:
  - `index.html`
  - CSS/JS locais
  - ícones/imagens essenciais
  - fallback offline para navegação
- Versionamento de cache para invalidar assets antigos.
- Fluxo de atualização segura do SW (activate + cleanup de caches antigos).

### Checklist técnico
- [ ] Mapear entrypoint real da aplicação (raiz e/ou `webapp/`).
- [ ] Confirmar arquivos estáticos mínimos para cache inicial.
- [ ] Implementar `install` com pré-cache essencial.
- [ ] Implementar `activate` com limpeza de cache legado.
- [ ] Implementar `fetch` com estratégia híbrida:
  - navegação: network-first com fallback offline
  - assets estáticos: cache-first com revalidação simples
- [ ] Registrar SW somente em contexto suportado (`https`/localhost).
- [ ] Garantir que falhas de SW não quebrem experiência online.

### Critérios de aceite
- App abre normalmente online.
- Com rede indisponível, a tela principal ainda carrega com assets cacheados.
- Nova versão do app substitui cache antigo após ativação.
- Sem regressões visuais ou de comportamento existente.

### Riscos e mitigação
- **Risco:** cache servir versão antiga.
  - **Mitigação:** versionamento explícito + cleanup no `activate`.
- **Risco:** cachear resposta de erro.
  - **Mitigação:** só persistir respostas `ok`.
- **Risco:** divergência entre raiz e `webapp/`.
  - **Mitigação:** validar base path antes da implementação final.

### Validação manual sugerida
1. Abrir app online e verificar registro do SW no DevTools.
2. Recarregar e confirmar assets no Cache Storage.
3. Ativar modo offline no navegador.
4. Reabrir app e validar carregamento da interface principal.
5. Atualizar versão de cache e confirmar remoção de cache antigo.

---

## Tarefa 2 — Dark/Light Toggle manual
- Adicionar botão de alternância manual.
- Persistir preferência localmente.
- Aplicar tema já no boot para evitar flicker.

## Tarefa 3 — Tema customizável (cores)
- Permitir escolha de cor primária (e opcionalmente secundária).
- Validar contraste mínimo para legibilidade.
- Persistir preferências por usuário/dispositivo.

## Tarefa 4 — Gráficos (Chart.js ou Recharts)
- Definir biblioteca com menor impacto no bundle atual.
- Exibir consumo por período e projeção de limite.
- Garantir fallback textual se gráfico não carregar.

## Tarefa 5 — Notificações Web Push (limite baixo)
- Definir gatilho de alerta (ex.: 20%, 10%, 5%).
- Solicitar permissão de forma contextual e não intrusiva.
- Implementar envio/agenda sem expor secrets no frontend.

## Observações
- Executar por etapas pequenas para reduzir risco de regressão.
- Priorizar compatibilidade PWA e comportamento atual do app.
