# When Reset — Compatible API do Antigravity

O endpoint `GET /api/antigravity-compatible` converte o snapshot sanitizado do
Antigravity para o formato que o provedor **Compatible API** do When Reset
entende.

O endpoint agregado combina todas as contas. Para o uso normal, cada conta deve
ser adicionada separadamente pelo seu slug estável, preservando a identificação
por e-mail e as quatro janelas fornecidas pelo Antigravity Manager.

## Configuração

Na Vercel, crie a variável de ambiente `WHEN_RESET_ANTIGRAVITY_KEY` com uma
chave aleatória longa. Não coloque essa chave no Git nem no chat.

No When Reset, em **Add account → Compatible API**, use o e-mail da conta como
**Provider name**, um endpoint individual listado em
`docs/when-reset-antigravity-manager-runbook.md` e a mesma chave bearer privada.
Para um teste agregado, use:

- Provider name: `Antigravity (Codex Usage)`
- Endpoint: `https://codex-usage-nine.vercel.app/api/antigravity-compatible`
- Bearer API key: o mesmo valor de `WHEN_RESET_ANTIGRAVITY_KEY`

O endpoint lê `antigravity_usage.json` da branch `usage-data`, exige o bearer
correto e nunca retorna tokens, cookies ou o export de contas. Rotas individuais
usam slugs como `/leosaquetto0`; a forma legada `/account-1` continua aceita. O
JSON devolve somente janelas futuras; se a fonte estiver sem uma janela futura,
responde `503` para não exibir quota antiga como se fosse atual.

O coletor local lê `~/.antigravity-agent/cloud_accounts.db`, mantido pelo
Antigravity Manager. A consulta SQL exclui `token_json`; apenas `quota_json` é
descriptografado em memória. A seleção fica em
`~/.antigravity-agent/when-reset-accounts.json`. O export em Downloads foi usado
somente para conferir identidades e não participa das atualizações.

O endereço `http://127.0.0.1` só serve para testes no próprio dispositivo. Para
consultar pelo iPhone, use o domínio HTTPS da Vercel; o When Reset rejeita HTTP
em endereços de rede comuns.

## Sobre o Self-hosted Worker

O Worker do When Reset não é um proxy para esta API. Ele usa um protocolo
próprio de registro por QR, D1, Queue e credenciais criptografadas. A documentação
oficial classifica Antigravity e origens customizadas como integrações somente no
dispositivo; portanto estas contas devem usar Compatible API. Não coloque tokens
Google no Worker.
