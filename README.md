# Codex Usage

Nota: edite sempre o `.js` legível em `scriptable/analytics-updater.js`; o export `.scriptable` é derivado e deve ser usado apenas para importação no iOS.

## Fluxo de branches e ambientes

- Produção = `main`.
- Teste/preview = `staging` (quando existir/for usada).
- O merge final para release é `staging -> main`.
- A branch `work` deve ser ignorada (não é branch remota do repositório no GitHub).

## Produção e deploy

- O deploy de produção na Vercel (branch `main`) é manual.
- O dashboard web estático fica na raiz do projeto (`index.html`, `style.css`, `app.js`, `vercel.json`).
- Os scripts iOS ficam em `scriptable/`.

## Publicação de dados via Scriptable

- O script `scriptable/webview-hidden-auto-update-v3.js` captura os dados de analytics e publica `codex_usage.json` no GitHub (branch `main`) via GitHub Contents API.
- O script `scriptable/analytics-updater.js` (widget) é somente leitura e consome a API de produção.
- Deploy oficial de produção: `https://codex-usage-nine.vercel.app`.
- Alterações em `index.html`, `style.css`, `app.js` ou `vercel.json` exigem novo deploy manual.

## Token de acesso

- A chave de token usada no ambiente local deve estar no Keychain com o nome: `codex_usage_github_token`.
