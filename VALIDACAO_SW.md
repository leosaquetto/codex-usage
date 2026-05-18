# Validação do Service Worker - Etapa 1

## Checklist de Validação Manual

### 1. Registro do Service Worker
- [ ] Abrir o app em `http://localhost:8080`
- [ ] Abrir DevTools (F12) → Application → Service Workers
- [ ] Verificar se o SW está registrado e ativo
- [ ] Confirmar scope: `http://localhost:8080/`

### 2. Cache de Assets
- [ ] No DevTools → Application → Cache Storage
- [ ] Verificar se existe cache `codex-usage-v1`
- [ ] Confirmar que os seguintes assets estão cacheados:
  - `/` ou `/index.html`
  - `/offline.html`
  - `/style.css`
  - `/app.js`
  - `/assets/codex-color.webp`
  - `/assets/claude__.png`
  - `/assets/gpt_.png`
  - `/assets/gemini__2.png`
  - `/assets/splash.svg`

### 3. Funcionamento Online
- [ ] App carrega normalmente
- [ ] Dados são buscados da API
- [ ] Todas as funcionalidades estão operacionais
- [ ] Sem erros no console

### 4. Funcionamento Offline
- [ ] No DevTools → Network, ativar "Offline"
- [ ] Recarregar a página (Cmd+R / Ctrl+R)
- [ ] Verificar se a interface principal carrega
- [ ] Verificar se assets estáticos (CSS, JS, imagens) são servidos do cache
- [ ] Verificar se a página offline aparece quando necessário

### 5. Atualização de Cache
- [ ] Alterar `CACHE_VERSION` no `sw.js` (ex: `v1` → `v2`)
- [ ] Recarregar a página
- [ ] No DevTools → Application → Cache Storage
- [ ] Verificar se o cache antigo foi removido
- [ ] Verificar se o novo cache foi criado

### 6. Estratégia de API
- [ ] Com rede online, verificar que `/api/usage` busca dados atualizados
- [ ] Com rede offline, verificar que `/api/usage` retorna erro 503
- [ ] Verificar mensagem de erro no console: "Offline - API indisponível"

## Como Executar os Testes

### Iniciar servidor de desenvolvimento
```bash
npm run dev
```

### Abrir no navegador
```
http://localhost:8080
```

### Simular offline
1. DevTools → Network tab
2. Selecionar "Offline" no dropdown de throttling
3. Recarregar página

### Limpar cache (se necessário)
1. DevTools → Application → Storage
2. Clicar em "Clear site data"
3. Recarregar página

## Critérios de Aceite

✅ **Sucesso** se:
- App abre normalmente online
- Com rede indisponível, a tela principal ainda carrega com assets cacheados
- Nova versão do app substitui cache antigo após ativação
- Sem regressões visuais ou de comportamento existente

❌ **Falha** se:
- App não carrega offline
- Cache não é atualizado corretamente
- Erros no console que quebram funcionalidade
- Assets não são servidos do cache

## Notas

- O Service Worker só funciona em `https://` ou `localhost`
- Mudanças no SW requerem hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)
- Use "Update on reload" no DevTools durante desenvolvimento
