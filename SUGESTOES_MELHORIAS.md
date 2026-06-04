# Backlog Revisado

O dashboard atual já possui PWA, gráficos, filtros, conta em uso e notificações locais granulares. Os itens abaixo são opcionais e não fazem parte da implementação vigente.

## Prioridade útil

1. Adicionar teste visual automatizado com snapshots para desktop e `390x844`.
2. Criar um painel somente leitura para a saúde das automações, consumindo um endpoint sem segredos.
3. Adicionar histórico por conta quando a fonte publicar amostras individualizadas.
4. Permitir exportar preferências de filtros e notificações entre dispositivos.

## Fora de escopo atual

- Web Push remoto: exigiria backend, inscrição push e gestão de chaves.
- Background sync remoto: não é confiável em todas as plataformas iOS/PWA e não substitui os LaunchAgents locais.
- Framework ou biblioteca de gráficos: o app atual é leve e não precisa dessa dependência.
- Dark mode: só deve entrar com uma revisão visual completa, sem comprometer a leitura resumida atual.

Qualquer item futuro deve preservar a branch `usage-data`, os widgets Scriptable e a densidade mobile.
