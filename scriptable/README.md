# Scriptable Large Widget

Use `large-widget.js` em um widget **Large** do Scriptable no iOS.

1. Copie o conteudo de `scriptable/large-widget.js` para um script novo no Scriptable.
2. Se o dominio mudar, ajuste `SUMMARY_URL` para o deploy que serve `/usage_summary.json`.
3. Adicione um widget Scriptable Large na Home Screen e selecione esse script.

O widget le `usage_summary.json`, guarda um cache local e tenta atualizar a cada 20 minutos.

## Atualizar Codex no Mac

O fluxo principal de Codex agora usa o Chrome desktop já logado no ChatGPT/Codex. Ele não usa chave de API da OpenAI e não salva cookie, senha ou token de sessão.

1. Abra o Chrome e confirme que `https://chatgpt.com/codex/cloud/settings/analytics` carrega autenticado.
2. No Chrome, habilite **View > Developer > Allow JavaScript from Apple Events**.
3. Rode:

```bash
node scripts/update-codex-usage-from-chrome.mjs
```

Para publicar `codex_usage.json` e `usage_summary.json` no GitHub usando token local:

```bash
CODEX_USAGE_GITHUB_TOKEN=ghp_xxx node scripts/update-codex-usage-from-chrome.mjs --publish
```

Alternativamente, salve o token no Keychain com o service `codex_usage_github_token`.

## Atualizar Antigravity no Mac

1. Abra Antigravity em **Settings > Models**.
2. Extraia o texto da tela com OCR ou copie o texto resultante.
3. Rode:

```bash
pbpaste | node scripts/update-antigravity-usage.mjs --stdin --commit
git push
```

Sem `--commit`, o script apenas atualiza `antigravity_usage.json` e `usage_summary.json`.
