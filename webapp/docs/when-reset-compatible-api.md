# When Reset — Compatible API do Antigravity

O endpoint `GET /api/antigravity-compatible` converte o snapshot sanitizado do
Antigravity para o formato que o provedor **Compatible API** do When Reset
entende.

Ele aparece no When Reset como uma conta compatível única, com as janelas das
contas Google nomeadas pelo e-mail dentro de cada limite. Isso permite testar o
conjunto imediatamente; a integração OAuth nativa do When Reset continua sendo
a opção para contas separadas.

## Configuração

Na Vercel, crie a variável de ambiente `WHEN_RESET_ANTIGRAVITY_KEY` com uma
chave aleatória longa. Não coloque essa chave no Git nem no chat.

No When Reset, em **Add account → Compatible API**, use:

- Provider name: `Antigravity (Codex Usage)`
- Endpoint: `https://codex-usage-nine.vercel.app/api/antigravity-compatible`
- Bearer API key: o mesmo valor de `WHEN_RESET_ANTIGRAVITY_KEY`

O endpoint agregado lê `antigravity_usage.json` da branch `usage-data`, exige o
bearer correto e nunca retorna tokens, cookies ou o export de contas. Para uma
conta separada no When Reset, acrescente `/account-1`, `/account-2` etc. ao
endpoint; cada rota retorna somente a conta correspondente. O JSON devolve
somente janelas futuras; se a fonte estiver sem uma janela futura, responde
`503` para não exibir quota antiga como se fosse atual.

O coletor local prefere o `cloud-accounts-export-*.json` mais recente em
`~/Downloads` quando ele existe, e cai para
`~/.antigravity-agent/decrypted_accounts.json`. `ANTIGRAVITY_ACCOUNTS_PATH`
permite escolher explicitamente uma fonte local. Apenas quotas e datas são
copiadas para o snapshot; os tokens do export nunca são escritos nele.

O endereço `http://127.0.0.1` só serve para testes no próprio dispositivo. Para
consultar pelo iPhone, use o domínio HTTPS da Vercel; o When Reset rejeita HTTP
em endereços de rede comuns.

## Sobre o Self-hosted Worker

O Worker do When Reset não é um proxy para esta API. Ele usa um protocolo
próprio de registro por QR, D1, Queue e credenciais criptografadas. A documentação
oficial classifica Antigravity e origens customizadas como integrações somente no
dispositivo; portanto estas contas devem usar Compatible API. Não coloque tokens
Google no Worker.
