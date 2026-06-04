# Contrato de `/api/usage`

O endpoint responde com `application/json` e `Cache-Control: no-store`.

## Exemplo

```json
{
  "activeAccountId": "account-id",
  "fiveHourPercent": 82,
  "fiveHourReset": "2026-06-04T05:47:26.000Z",
  "weeklyPercent": 71,
  "weeklyReset": "2026-06-11T00:47:26.000Z",
  "lastUpdated": "2026-06-04T01:03:44.679Z",
  "dataAgeMinutes": 12,
  "staleAfterMinutes": 60,
  "isStale": false,
  "accountCount": 6,
  "okCount": 5,
  "accounts": [
    {
      "id": "account-id",
      "name": "Conta",
      "email": null,
      "planType": "plus",
      "subscriptionExpiresAt": null,
      "isActive": true,
      "lastUsedAt": "2026-06-04T00:58:00.000Z",
      "fiveHourPercent": 82,
      "fiveHourReset": "2026-06-04T05:47:26.000Z",
      "weeklyPercent": 71,
      "weeklyReset": "2026-06-11T00:47:26.000Z",
      "lastUpdated": "2026-06-04T01:03:44.679Z",
      "status": "ok",
      "error": null
    }
  ],
  "historySamples": []
}
```

## Regras

- Percentuais são limitados a `0..100`.
- Datas válidas são normalizadas para ISO-8601; datas inválidas viram `null`.
- `activeAccountId` e `lastUsedAt` são preservados do Switcher.
- Agregados de 5h/semanal usam somente contas pagas; FREE/GO continuam em `accounts`.
- `isStale` fica verdadeiro quando `lastUpdated` está ausente ou tem mais de 60 minutos.
- `status: "error"` mantém a conta visível e publica uma mensagem segura em `error`.
- `historySamples` contém no máximo 500 amostras normalizadas.

## Fontes

- Produção: `codex_usage.json` e `codex_usage_history.json` da branch `usage-data`.
- Desenvolvimento com `CODEX_USAGE_USE_LOCAL_FILES=1`: JSONs da raiz do repo.
- Fallback opcional: `CODEX_USAGE_PAYLOAD`.

Falha total de fonte retorna:

```json
{ "error": "Usage payload indisponível" }
```

com status `503`.
