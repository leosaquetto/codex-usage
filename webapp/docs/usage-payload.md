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
      "fiveHourWindowMinutes": 300,
      "weeklyPercent": 71,
      "weeklyReset": "2026-06-11T00:47:26.000Z",
      "weeklyWindowMinutes": 10080,
      "lastUpdated": "2026-06-04T01:03:44.679Z",
      "status": "ok",
      "error": null
    }
  ],
  "historySamples": [],
  "accountSamples": [],
  "weeklyResetEvents": [
    {
      "email": "conta@example.com",
      "capturedAt": "2026-06-07T10:00:00.000Z",
      "weeklyReset": "2026-06-14T10:00:00.000Z",
      "previousWeeklyReset": "2026-06-08T10:00:00.000Z",
      "isEarlyReset": true,
      "isNotifiableEarlyReset": true,
      "deltaMs": -86400000,
      "cycleDurationMs": 518400000,
      "previousWeeklyPercent": 21,
      "weeklyPercent": 100,
      "weeklyPercentDelta": 79
    }
  ]
}
```

## Regras

- Percentuais são limitados a `0..100`.
- Datas válidas são normalizadas para ISO-8601; datas inválidas viram `null`.
- `activeAccountId` e `lastUsedAt` são preservados do Switcher.
- Agregados de 5h/semanal usam somente contas pagas; FREE/GO continuam em `accounts`.
- Uma janela única próxima de 30 dias não é publicada como 5h; ela aparece como `weeklyWindowMinutes` e é rotulada como `30d` na interface.
- `isStale` fica verdadeiro quando `lastUpdated` está ausente ou tem mais de 60 minutos.
- `status: "error"` mantém a conta visível e publica uma mensagem segura em `error`.
- `historySamples` contém no máximo 500 amostras normalizadas.
- `accountSamples` e `weeklyResetEvents` usam e-mail normalizado como identidade e preservam a primeira observação de cada `email + weeklyReset`.
- `weeklyResetEvents` publica saldo semanal anterior/posterior, diferença para o prazo anterior e duração entre os resets.
- Mudanças em que o semanal permanece cheio (`99%`/`100%` antes e depois) são descartadas do histórico e não notificam.
- `isNotifiableEarlyReset` só fica verdadeiro quando a mudança é antecipada e recupera o semanal para `99%` ou `100%` partindo de menos de `99%`.
- Contas FREE/GO ou com janela de aproximadamente 30 dias não entram no histórico semanal.

## Fontes

- Produção: `codex_usage.json` e `codex_usage_history.json` da branch `usage-data`.
- Desenvolvimento local padrão: mesma fonte remota da produção (`usage-data`).
- Desenvolvimento com `CODEX_USAGE_USE_LOCAL_FILES=1`: JSONs da raiz do repo para investigações pontuais.
- Fallback opcional: `CODEX_USAGE_PAYLOAD`.

Regra operacional: para comparar com o celular, produção ou dashboard local padrão, use sempre a branch `usage-data`. Os JSONs da raiz da `main` podem estar antigos e só são fonte intencional quando `CODEX_USAGE_USE_LOCAL_FILES=1` estiver definido.

Falha total de fonte retorna:

```json
{ "error": "Usage payload indisponível" }
```

com status `503`.
