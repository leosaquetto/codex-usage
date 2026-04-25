# Codex Usage

Nota: edite sempre o `.js` legível em `scriptable/analytics-updater.js`; o export `.scriptable` é derivado e deve ser usado apenas para importação no iOS.

## Fluxo de branches e ambientes

- O desenvolvimento e a validação acontecem em `staging`.
- O merge final para release é `staging -> main`.
- A branch `staging` também é usada para testes/preview da publicação do JSON consumido pelo Scriptable.
- A branch `main` deve ser usada para publicação quando a produção estiver lendo `main`.

## Produção e deploy

- Produção é a branch `main`.
- O deploy de produção na Vercel é manual.

## Estrutura do repositório

- O dashboard web estático fica na raiz do projeto.
- Os scripts iOS ficam em `scriptable/`.

## Token de acesso

- A chave de token usada no ambiente local deve estar no Keychain com o nome: `codex_usage_github_token`.

## Atualização do JSON via Scriptable

- A atualização de `codex_usage.json` via Scriptable não exige build nem instalação de dependências.
