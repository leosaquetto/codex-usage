## 🔗 Links de Deploy (Final e Preview)

- **Preview (manual):** abra e execute o workflow [`Vercel Preview Deploy`](../../actions/workflows/vercel-preview.yml).
- **Final/Produção (manual):** abra e execute o workflow [`Vercel Production Deploy`](../../actions/workflows/vercel-production.yml).
- Ao final de cada execução, o link correto é publicado no **Job Summary** do GitHub Actions.

---

# 🎨 Refatoração da Analítica do Codex

## Visão Geral

O projeto foi completamente refatorado mantendo **100% da lógica original** e introduzindo um novo design moderno, limpo e responsivo que funciona perfeitamente em mobile e desktop.

---

## 📋 O que foi refatorado

### 1. **HTML (index.html)**
- ✅ Estrutura semântica melhorada com tags HTML5 apropriadas
- ✅ Organização lógica com `<header>`, `<main>`, `<section>`, `<article>`
- ✅ Nomes de classes mais descritivos e reutilizáveis
- ✅ Melhor acessibilidade com atributos ARIA
- ✅ Código mais limpo e legível

**Mudanças principais:**
```html
<!-- Antes (misturado) -->
<div class="topbar">
  <div class="brand">...</div>
  <div class="toolbar">...</div>
</div>

<!-- Depois (semântico) -->
<header class="header">
  <div class="header-content">
    <div class="brand">...</div>
    <div class="header-actions">...</div>
  </div>
  <div class="status-bar">...</div>
</header>
```

---

### 2. **CSS (style.css)**

#### **Novo Sistema de Cores**
- Paleta moderna com variáveis CSS bem definidas
- Suporte automático para light/dark mode
- Cores semânticas (sucesso, aviso, perigo, erro)
- Melhor contraste e acessibilidade

```css
:root {
  --primary: #3b82f6;
  --accent: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  /* ... */
}
```

#### **Responsividade Robusta**
- **Mobile First**: designs otimizados para telas pequenas
- **Breakpoints**: 480px, 640px, 768px, 1024px
- **Safe Areas**: suporte para notches e home indicators
- **Clamp()**: tamanhos de fonte fluidos

```css
/* Tamanhos que se adaptam automaticamente */
h1 {
  font-size: clamp(24px, 5vw, 32px);
}
```

#### **Layout System**
- Grid CSS moderno
- Espaçamento consistente
- Componentes reutilizáveis
- Menos duplicação de código

#### **Animações**
- Animações sutis e suaves
- Respeita `prefers-reduced-motion`
- Performance otimizada
- Feedback visual claro

```css
@keyframes fadeInDown {
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
}
```

#### **Destaques do Design**
- Gradientes modernos
- Efeitos glass-morphism
- Sombras em camadas
- Espaçamento visual inteligente

---

### 3. **JavaScript (app.js)**

**Lógica 100% Mantida**
- ✅ Nenhuma mudança na lógica de cálculo
- ✅ Mesmo tratamento de dados
- ✅ Mesmas validações
- ✅ Mesmos eventos

**Pequenas Adaptações:**
- Seletores de ID foram atualizados para corresponder ao novo HTML
- Nenhuma alteração em algoritmos ou fluxo de dados

```javascript
// Os cálculos continuam exatamente iguais
const realDailyRate = Number.isFinite(elapsedDays) 
  ? weeklyUsed / elapsedDays 
  : NaN;

const safeDailyRate = Number.isFinite(weeklyDaysRemaining) && weeklyDaysRemaining > 0
  ? weeklyRemaining / weeklyDaysRemaining 
  : 0;
```

---

## 🎯 Melhorias Visuais

### **Mobile**
- Design compacto e touch-friendly
- Botões e inputs de tamanho apropriado (mín. 44px)
- Padding e gaps reduzidos inteligentemente
- Responsividade fluida

### **Desktop**
- Layout em 2 colunas para cards
- Grid 3 colunas para análise semanal
- Espaçamento generoso
- Hover effects interativos

### **Dark Mode** (padrão)
- Cores que não cansam os olhos
- Contraste adequado (WCAG AA+)
- Aceita preferência do sistema

### **Light Mode** (automático)
- Detecção automática via `prefers-color-scheme`
- Cores adaptadas para claridade

---

## 📱 Breakpoints Responsivos

```css
/* Desktop (padrão) */
→ Layout 2 colunas
→ Rhythm grid 3 colunas
→ Botões lado a lado

/* Tablet (768px) */
@media (min-width: 768px) {
  .limits-grid { grid-template-columns: repeat(2, 1fr); }
}

/* Pequeno (640px) */
@media (min-width: 640px) {
  .rhythm-grid { grid-template-columns: repeat(2, 1fr); }
  .action-buttons { grid-template-columns: 1fr 1fr; }
}

/* Muito pequeno (480px) */
@media (max-width: 480px) {
  /* Ajustes para mobile: fonte menor, layout em coluna */
}
```

---

## 🎨 Componentes Reutilizáveis

### **Cards**
```css
.limit-card {
  background: linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%);
  border: 1px solid var(--border-light);
  border-radius: 16px;
  padding: 20px;
  box-shadow: var(--shadow-lg);
  transition: all 0.3s var(--ease-in-out);
}
```

### **Botões**
```css
.button-primary {
  background: linear-gradient(135deg, var(--primary), var(--primary-light));
  color: white;
  transition: all 0.2s var(--ease-in-out);
}

.button-primary:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
```

### **Status Indicators**
```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-warn);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
  animation: pulse 2s ease-in-out infinite;
}
```

---

## 🔧 Tecnologias Utilizadas

- **HTML5**: Semântica moderna
- **CSS3**: Grid, Flexbox, Custom Properties, Animations
- **JavaScript**: Vanilla (sem bibliotecas)
- **Acessibilidade**: ARIA, alt text, keyboard navigation
- **Performance**: Minimizado, otimizado, sem bloats

---

## 📊 Comparação Antes × Depois

| Aspecto | Antes | Depois |
|---------|-------|--------|
| **Design** | Glassmorphism pesado | Moderno e limpo |
| **Responsividade** | Básica | Robusta em todos tamanhos |
| **Cores** | Gradientes complexos | Paleta sistemática |
| **Acessibilidade** | Limitada | WCAG AA+ |
| **Light Mode** | Não | Automático |
| **Mobile** | Problemático | Otimizado |
| **Lógica** | 100% | 100% |

---

## 🚀 Como Usar

1. **Substitua os arquivos:**
   - `index.html` → nova versão
   - `style.css` → nova versão
   - `app.js` → nova versão

2. **Mantenha os assets:**
   - Logo, ícones e splash screen continuam funcionando
   - Nenhuma mudança no JSON de dados

3. **Teste em múltiplos dispositivos:**
   - iPhone (375px)
   - Tablet (768px)
   - Desktop (1920px)

---

## ✨ Destaques do Novo Design

✅ **Moderno**: Design limpo e contemporâneo  
✅ **Acessível**: WCAG AA+, suporta navegação por teclado  
✅ **Responsivo**: Funciona em qualquer tamanho de tela  
✅ **Rápido**: Sem JavaScript desnecessário, CSS otimizado  
✅ **Intuitivo**: UX clara e sem confusão  
✅ **Manutenível**: Código bem organizado e comentado  
✅ **Escalável**: Fácil de estender e modificar  

---

## 🎯 Próximos Passos Opcionais

Se quiser melhorar ainda mais:

1. **Service Worker**: Para funcionar offline
2. **Dark/Light Toggle**: Button para switch manual
3. **Tema Customizável**: Permitir que o usuário escolha cores
4. **Gráficos**: Adicionar charts com Chart.js ou Recharts
5. **Notificações**: Web Push quando limite está baixo

---

**Projeto refatorado com ❤️ mantendo toda a lógica original intacta!**
