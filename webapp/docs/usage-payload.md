# Payload esperado em `/api/usage`

O endpoint `/api/usage` deve responder com `application/json` no formato abaixo:

```json
{
  "fiveHourPercent": 56,
  "fiveHourReset": "2026-04-24T20:00:00.000Z",
  "weeklyPercent": 62,
  "weeklyReset": "2026-04-28T19:35:00.000Z",
  "lastUpdated": "2026-04-24T14:36:00.000Z",
  "statusLabel": "acima do seguro",
  "fiveHourSafeRate": "8.2%/h",
  "weeklyRemaining": "4.2d",
  "realDailyRate": "15.6%/d",
  "safeDailyRate": "13.4%/d",
  "dailyDiff": "+2.3%/d",
  "weeklyProjection": "-9.5%",
  "zeroIn": "3d 13h",
  "history": {
    "cycleStart": "2026-04-21T19:35:00.000Z"
  }
}
```

## Campos obrigatórios

- `fiveHourPercent`: número de 0 a 100.
- `fiveHourReset`: data ISO-8601 do próximo reset de 5h.
- `weeklyPercent`: número de 0 a 100.
- `weeklyReset`: data ISO-8601 do próximo reset semanal.
- `lastUpdated`: data ISO-8601 da última atualização do payload.
- `history`: objeto contendo histórico mínimo usado pelo frontend.

## Campos opcionais (UI complementar)

- `statusLabel`, `fiveHourSafeRate`, `weeklyRemaining`, `realDailyRate`, `safeDailyRate`, `dailyDiff`, `weeklyProjection`, `zeroIn`, `history.cycleStart`.

Quando os opcionais não são enviados, o frontend mostra fallback seguro (`--`).
