# Antigravity Usage Payload

`antigravity_usage.json` e gerado pela automacao desktop e servido como arquivo estatico.
O fluxo automatico roda via `scripts/update-antigravity-usage-auto.mjs`: se Antigravity estiver fechado,
ele pula o ciclo; se estiver aberto, pode focar Settings > Models, capturar a janela e calcular cada
percentual pelas cinco barras de quota.

```json
{
  "source": "desktop-automation",
  "lastUpdated": "2026-05-16T04:30:00.000Z",
  "models": [
    {
      "id": "gemini-3-1-pro-high",
      "name": "Gemini 3.1 Pro",
      "tier": "High",
      "remainingPercent": 50,
      "status": "ok",
      "refreshText": "Refreshes in 6 days, 22 hours",
      "refreshAt": "2026-05-23T02:30:00.000Z"
    }
  ]
}
```

`usage_summary.json` junta `codex_usage.json` e `antigravity_usage.json` para o widget iOS consumir uma unica URL.
