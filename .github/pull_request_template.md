## Resumo
-

## Base da PR
- [ ] Branch de origem segue o padrão `codex/{feature}`.
- [ ] Confirmei que a branch base está correta para a integração desta tarefa.
- [ ] Se a tarefa partiu de `staging`, a PR está apontando para `staging` (não `main`).
- [ ] Merge final planejado como `staging -> main`.
- [ ] Se a base estava incorreta, ajustei a base branch antes de mergear.
- [ ] Não usei `nodeploy` como branch base.

## Checklist de validação manual
### Webapp
- [ ] Fluxo principal validado manualmente no ambiente da PR.
- [ ] Sem regressão visual/funcional nas telas impactadas.

### API
- [ ] Endpoint(s) alterado(s) validado(s) com resposta esperada.
- [ ] Tratamento de erro/casos limite conferido manualmente.

### Scriptable
- [ ] Script executado manualmente com retorno esperado.
- [ ] Sem quebra de compatibilidade no uso atual.

### Workflows manuais
- [ ] Workflows necessários mantidos em `workflow_dispatch`.
- [ ] Execução manual dos workflows relevantes validada.
