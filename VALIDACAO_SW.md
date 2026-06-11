# Validação do Service Worker

## Estado esperado

- Cache: `codex-usage-v35`.
- Navegação HTML: network-first, com fallback para cache/offline.
- `/api/*`: rede, retornando `503` offline.
- Assets estáticos: cache-first.
- Web Push remoto é recebido pelo Service Worker; não há background sync.

## Validação automática

```bash
npm run validate:static
```

O auditor confirma que:

- todos os assets críticos existem;
- HTML, manifest e splash apontam para caminhos válidos;
- `notification-engine.mjs` está no cache;
- widgets e API leem `usage-data`;
- a Vercel ignora deployments da branch de dados.

## Validação no Browser in-app

1. Abrir `http://127.0.0.1:8080/`.
2. Confirmar carga sem erro de console.
3. Recarregar e confirmar que o dashboard permanece funcional.
4. Conferir o cache `codex-usage-v35`.
5. Simular rede indisponível e confirmar que a interface estática abre.
6. Confirmar que `/api/usage` indisponível usa o último payload válido do navegador.
7. Restaurar a rede e confirmar atualização normal.

## Critérios de aceite

- Nenhum asset crítico retorna `404`.
- Cache antigo é removido após ativação.
- Dados de API não ficam presos no cache do Service Worker.
- Dashboard online e fallback offline não apresentam erro de console.
