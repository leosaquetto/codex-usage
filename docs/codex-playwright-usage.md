# Codex usage via Playwright persistente

Este fluxo adiciona uma alternativa ao `scripts/update-codex-usage-from-chrome.mjs` sem substituir o fluxo atual com Chrome + AppleScript.

## Diferença entre os fluxos

- `update-codex-usage-from-chrome.mjs`: usa a aba ativa do Chrome e AppleScript para ler o texto renderizado da página.
- `update-codex-usage-playwright.mjs`: abre um navegador persistente com Playwright, ou conecta no seu Chrome já aberto via CDP, e tenta capturar primeiro um payload JSON de rede antes de cair para parse por texto.

Nenhum dos dois fluxos usa API key da OpenAI.

## Primeiro login

1. Instale as dependências do repo:

```bash
npm install
```

2. Rode o fluxo novo em modo visível:

```bash
node scripts/update-codex-usage-playwright.mjs --headed
```

Ou via wrapper local:

```bash
npm run update:codex-usage:playwright -- --headed
```

3. Se o ChatGPT/Codex não estiver logado, faça o login na janela aberta.
4. Aguarde a página `https://chatgpt.com/codex/cloud/settings/analytics` carregar autenticada.
5. Nas próximas execuções, o script tentará reutilizar a sessão persistida em modo headless por padrão.

## Alternativa quando aparecer CAPTCHA

Se o profile automatizado novo cair em CAPTCHA, prefira conectar no seu Chrome normal já logado.

1. Feche instâncias antigas de Chrome abertas em modo debug, se houver.
2. Abra o Google Chrome com porta de debug remoto:

```bash
npm run chrome:cdp
```

3. No Chrome aberto, confirme que sua sessão do ChatGPT/Codex está autenticada.
4. Rode:

```bash
node scripts/update-codex-usage-playwright.mjs --cdp
```

Se precisar de outra porta ou host:

```bash
node scripts/update-codex-usage-playwright.mjs --cdp-url http://127.0.0.1:9222
```

Por padrão, o script também tenta esse fallback automático para `http://127.0.0.1:9222` quando o fluxo com profile persistente falha por login/CAPTCHA, a menos que você passe `--no-cdp-fallback`.

Se preferir abrir manualmente sem o wrapper do `package.json`, use o binário direto com profile dedicado:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/Users/leosaquetto/Developer/BrowserProfiles/codex-cdp-profile
```

## Execucao automatica sem janela

Depois que o profile CDP ja estiver logado, use:

```bash
npm run update:codex-usage:auto
```

Esse comando tenta conectar em `http://127.0.0.1:9222`. Se a porta nao estiver ativa, ele sobe o Google Chrome dedicado de forma oculta, com o profile `/Users/leosaquetto/Developer/BrowserProfiles/codex-cdp-profile`, captura a pagina, atualiza os JSONs, faz commit e envia para o GitHub sem trazer janela para frente.

Para preparar ou renovar login nesse profile, rode uma vez:

```bash
npm run chrome:cdp
```

Depois faca login no Chrome visivel que abriu e confirme que a pagina de analytics carrega. As execucoes automaticas seguintes usam esse mesmo profile em um Chrome oculto via CDP.

O LaunchAgent local roda `scripts/run-usage-data-update.mjs switcher`. Esse wrapper publica os JSONs na branch `usage-data`, separada da branch `main` monitorada pela Vercel para produção. Os logs ficam em:

- `.local/logs/codex-usage-launchd.out.log`
- `.local/logs/codex-usage-launchd.err.log`

## Comandos de teste

Primeira validação visível:

```bash
node scripts/update-codex-usage-playwright.mjs --headed
```

Execução padrão depois que a sessão já existir:

```bash
node scripts/update-codex-usage-playwright.mjs
```

Forçar headless:

```bash
node scripts/update-codex-usage-playwright.mjs --headless
```

Usar o Chrome já aberto via CDP:

```bash
node scripts/update-codex-usage-playwright.mjs --cdp
```

Rodar o fluxo automatico silencioso:

```bash
npm run update:codex-usage:auto
```

Atualizar, commitar e fazer push na branch de dados:

```bash
node scripts/run-usage-data-update.mjs playwright --ensure-cdp --close-cdp
```

## Arquivos atualizados

O script grava:

- `codex_usage.json`
- `usage_summary.json`
- `codex_usage_history.json`

O summary é regenerado via `scripts/build-usage-summary.mjs`. Os JSONs ficam no root da branch `usage-data`; o `webapp/` lê dados via API/raw GitHub dessa branch e não recebe espelho local a cada refresh.

## Sessão persistente

- O profile fica fora do git em `/Users/leosaquetto/Developer/BrowserProfiles/codex-chrome-profile`.
- Se existir o binário real do Google Chrome em `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, ele será usado.
- Caso contrário, o script cai para o Chromium do Playwright.
- Em `--cdp`, o script não cria um browser novo; ele conecta no Chrome já aberto em debug remoto.

## Observações

- O LaunchAgent local foi atualizado para usar o fluxo Playwright/CDP.
- O script antigo em `_scripts` nao foi alterado.
- Este trabalho não altera Antigravity nem o visual do dashboard.
