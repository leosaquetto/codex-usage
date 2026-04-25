# Codex Usage

Nota: edite sempre o `.js` legível em `scriptable/analytics-updater.js`; o export `.scriptable` é derivado e deve ser usado apenas para importação no iOS.

## Fluxo de branches e ambientes

- Produção = `main`.
- Teste/preview = `staging`.
- O merge final para release é `staging -> main`.

## Produção e deploy

- O deploy de produção na Vercel (branch `main`) é manual.
- O dashboard web estático fica na raiz do projeto (`index.html`, `style.css`, `app.js`, `vercel.json`).
- Os scripts iOS ficam em `scriptable/`.

## Publicação de dados via Scriptable

- O Scriptable publica `codex_usage.json` na `main` por padrão.
- `staging` pode ser usada apenas para teste/preview quando necessário.
- Alterações em `codex_usage.json` via Scriptable não exigem novo deploy.
- Alterações em `index.html`, `style.css`, `app.js` ou `vercel.json` exigem novo deploy manual.

## Token de acesso

- A chave de token usada no ambiente local deve estar no Keychain com o nome: `codex_usage_github_token`.
