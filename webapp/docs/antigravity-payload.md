# Antigravity Usage Payload

`antigravity_usage.json` e gerado pela automacao desktop e servido como arquivo estatico.
O fluxo automatico roda via `scripts/update-antigravity-usage-auto.mjs`, que usa
`scripts/read-antigravity-manager-usage.mjs` para ler o cache criptografado do
Antigravity Manager. Ele nao controla janelas nem usa OCR. A consulta exclui a
coluna de tokens e publica apenas as contas permitidas localmente, seus planos,
percentuais e horarios de reset.

```json
{
  "source": "antigravity-manager-db",
  "lastUpdated": "2026-05-16T04:30:00.000Z",
  "accounts": [
    {
      "id": "account-slug",
      "email": "account@example.com",
      "plan": "Google AI Pro",
      "windows": [
        {
          "id": "gemini-5h",
          "group": "Gemini Models",
          "kind": "5h",
          "windowMinutes": 300,
          "remainingPercent": 99.1,
          "refreshAt": "2026-08-18T01:49:15.000Z"
        }
      ]
    }
  ],
  "models": []
}
```

`usage_summary.json` junta `codex_usage.json` e `antigravity_usage.json` para o widget iOS consumir uma unica URL.
