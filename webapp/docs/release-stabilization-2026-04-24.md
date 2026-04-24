# Estabilização pós-entrega — 2026-04-24

## 1) Smoke test final (produção)

Data/hora (UTC): **2026-04-24 21:41**

### Webapp
- URL testada: `https://codex-usage.vercel.app/`
- Resultado: **200 OK**
- Conteúdo: `text/html; charset=utf-8`

### API `/api/usage`
- URL testada: `https://codex-usage.vercel.app/api/usage`
- Resultado: **404 Not Found** (resposta Vercel `NOT_FOUND`)
- Impacto: não foi possível validar payload em produção nesta execução.

### Widget/Scriptable
- O script `Analítica do Codex.scriptable` está configurado para staging via:
  - `REMOTE_USAGE_URL_STAGING = "https://codex-usage-staging.vercel.app/api/usage"`
  - `const REMOTE_USAGE_URL = REMOTE_USAGE_URL_STAGING`
- Observação do teste: o endpoint de staging retornou `DEPLOYMENT_NOT_FOUND` no momento da verificação.
- Risco atual: sem endpoint ativo, o widget depende de fallback local e pode divergir da web.

## 2) Plano de monitoramento por 24h

Janela recomendada: **2026-04-24 22:00 UTC → 2026-04-25 22:00 UTC**

### O que monitorar
1. **Erros de API (500/503)**
   - Verificar disponibilidade e status de `/api/usage` periodicamente.
2. **Inconsistência web vs widget**
   - Conferir `fiveHourPercent`, `weeklyPercent` e `lastUpdated` entre webapp e widget.
3. **Regressão visual mobile**
   - Abrir a webapp em viewport mobile e validar cards, barra e textos sem quebra.

### Cadência sugerida
- T0, +1h, +3h, +6h, +12h, +24h.
- Em cada checkpoint registrar:
  - status HTTP,
  - amostra do payload,
  - evidência visual mobile,
  - decisão (segue / bloqueia).

## 3) Congelamento de escopo

Durante a janela de estabilização:
- **Sem novas mudanças** de UI/API/workflow.
- Apenas correções críticas de disponibilidade/consistência.

## 4) Fechamento da entrega (texto para PR/release notes)

### Entregue
- Webapp servindo em produção (`/` com 200).
- Processo de validação e monitoramento definido para 24h.
- Critérios de bloqueio definidos para API e consistência widget/web.

### Como validar
1. `GET /` deve responder 200.
2. `GET /api/usage` deve responder 200 com JSON válido no contrato documentado.
3. Widget deve refletir os mesmos percentuais/chaves exibidos na web.
4. Web mobile sem regressões visuais nos componentes principais.

### Rollback simples
- Executar **re-run do último deploy estável** (manual deploy anterior conhecido como saudável).
- Após rollback, repetir smoke test (`/` e `/api/usage`) e comparação widget/web.
