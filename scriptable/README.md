# Scriptable Large Widget

Use `large-widget.js` em um widget **Large** do Scriptable no iOS.

1. Copie o conteudo de `scriptable/large-widget.js` para um script novo no Scriptable.
2. Se o dominio mudar, ajuste `SUMMARY_URL` para o deploy que serve `/usage_summary.json`.
3. Adicione um widget Scriptable Large na Home Screen e selecione esse script.

O widget le `usage_summary.json`, guarda um cache local e tenta atualizar a cada 20 minutos.

## Atualizar Antigravity no Mac

1. Abra Antigravity em **Settings > Models**.
2. Extraia o texto da tela com OCR ou copie o texto resultante.
3. Rode:

```bash
pbpaste | node scripts/update-antigravity-usage.mjs --stdin --commit
git push
```

Sem `--commit`, o script apenas atualiza `antigravity_usage.json` e `usage_summary.json`.
