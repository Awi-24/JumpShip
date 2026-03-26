# Jumpship — Prompt de Design de Interface

> Use este prompt com v0.dev, Cursor, Figma AI, ou qualquer LLM de código para gerar a UI do Jumpship.

---

## Contexto do produto

Jumpship é uma plataforma desktop-first de gestão de candidaturas a empregos. O usuário busca vagas em múltiplos sites simultaneamente, analisa cada vaga com IA (comparando com seu currículo), e acompanha todo o pipeline de candidaturas — tudo localmente, sem nuvem. É uma ferramenta pessoal de produtividade, não um SaaS.

**Stack exato:** Next.js 14 (App Router) + Tailwind CSS + TypeScript + lucide-react

---

## Design System obrigatório

### Paleta de cores

```js
// tailwind.config.js
colors: {
  sand:    { DEFAULT: '#F4F3EE' },          // background da aplicação inteira
  coral:   { DEFAULT: '#C15F3C',            // acento primário — botões, links ativos, badges
             50: '#FAF0EB',                  // hover/active sutil
             600: '#A04D31' },              // hover em botões
  taupe:   { DEFAULT: '#B1ADA1' },          // texto secundário, bordas, placeholders
  white:   '#FFFFFF',                       // cards, painéis, modais
}
```

### Tipografia
- **Fonte principal:** Inter (Google Fonts) — weights 400, 500, 600
- **Hierarquia:** `text-2xl font-semibold` para títulos de página, `text-sm text-taupe` para metadados
- **Nunca use negrito excessivo** — a hierarquia é criada por tamanho e cor, não peso

### Princípios visuais
- Inspiração direta no design do Claude.ai: clean, respirado, sem decoração excessiva
- Background geral sempre `#F4F3EE` (sand) — nunca branco puro nem cinza escuro
- Cards e painéis em `white` com `border border-taupe/30 rounded-xl shadow-sm`
- Botão primário: `bg-coral text-white rounded-lg px-4 py-2 hover:bg-coral-600` — **sem sombras pesadas**
- Botão secundário: `border border-taupe text-taupe rounded-lg px-4 py-2 hover:bg-coral-50`
- Ícones exclusivamente do `lucide-react` — tamanho padrão `16px`, cor `text-taupe`
- Sem gradientes coloridos — apenas fundos sólidos da paleta
- Border radius padrão: `rounded-xl` para cards grandes, `rounded-lg` para botões e inputs, `rounded-full` para badges e avatares

---

## Layout global

### Navbar (fixa no topo, altura 56px)
```
┌─────────────────────────────────────────────────────────────┐
│  🚀 Jumpship    Buscar   Currículo   Dashboard   Ajustes    │
└─────────────────────────────────────────────────────────────┘
```
- Background `white`, `border-b border-taupe/20`, `shadow-sm`
- Logo: ícone rocket + texto "Jumpship" em `font-semibold`
- Links de navegação: `text-sm text-taupe` em repouso, `text-coral font-medium` quando ativo
- Indicador de rota ativa: underline coral de 2px (`border-b-2 border-coral`) sob o link
- Sem dropdown, sem hamburger em desktop — navegação sempre visível

---

## Páginas — Layout e Componentes

---

### 1. Página inicial `/` — Busca de Vagas

**Layout:** Sidebar esquerda (formulário de busca, 300px fixo) + área principal (lista de resultados) + painel lateral deslizante (detalhes da vaga selecionada)

```
┌──────────┬─────────────────────────┬──────────────────────┐
│  BUSCA   │     RESULTADOS (grid)   │   DETALHE DA VAGA    │
│  300px   │     flex-1              │   380px (slide-in)   │
└──────────┴─────────────────────────┴──────────────────────┘
```

**Formulário de busca (sidebar esquerda):**
- Título: "Buscar Vagas" `text-lg font-semibold`
- Campo "Cargo ou habilidades" com ícone `Search` dentro
- Campo "Localização" com ícone `MapPin` dentro
- Select "Tipo de vaga" (Qualquer / Full-time / Part-time / Contrato / Estágio)
- Toggle "Apenas remoto" — switch estilo iOS com cor coral quando ativo
- Toggle "Easy Apply apenas"
- Slider ou input "Publicadas nas últimas X horas" (24 / 48 / 72 / 168)
- Checkboxes "Plataformas": LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google Jobs — cada um com logo colorido pequeno
- Botão "Buscar Vagas" coral, largura total, com ícone Zap

**Lista de resultados (área central):**
- Estado vazio: ilustração minimalista + "Busque vagas acima para começar" em `text-taupe`
- Estado carregando: skeleton cards (3 cards com pulse animation)
- Cards em grid 1 coluna, `gap-3`
- Contador "X vagas encontradas" em `text-sm text-taupe` no topo

**JobCard (card de vaga):**
```
┌─────────────────────────────────────────────┐
│  [Avatar]  Título da Vaga              [♥]  │
│            Empresa · Cidade            [78] │  ← score badge coral
│            🏢 Full-time  🌐 Remoto          │
│            💰 R$ 8.000 – 12.000/mês         │
│            📅 Publicado há 2 dias           │
└─────────────────────────────────────────────┘
```
- Avatar da empresa: quadrado `40×40` `rounded-lg`, inicial da empresa com bg coral-50 e texto coral (quando sem logo)
- Score badge: círculo coral `24px` com número em branco — aparece apenas se análise foi feita
- Borda esquerda: `border-l-4 border-coral` quando o card está selecionado
- Badges de tipo: `text-xs bg-taupe/10 text-taupe rounded-full px-2 py-0.5`
- Hover: `bg-coral-50 cursor-pointer transition-colors`
- Clicar no card abre o painel de detalhe (slide-in pela direita)

**JobDetailPanel (painel lateral, 380px):**
- Slide-in pela direita com `transition-transform`
- Header: logo empresa maior + título + empresa + badges + botão "Ver vaga original" (link externo)
- Botão "Salvar vaga" + botão "Candidatar-se" (coral, full-width)
- Tabs: **"Descrição"** / **"Análise IA"**
- Tab Descrição: texto da vaga em `prose prose-sm`, scroll vertical
- Tab Análise IA: `AnalysisPanel` (ver abaixo)

---

### 2. Componente AnalysisPanel (dentro de JobDetailPanel)

**Estado inicial (sem análise):**
- Card com borda tracejada coral
- Ícone sparkles + "Analisar com IA"
- Dropdown "Currículo ativo" (mostra o último currículo enviado)
- Botão "Analisar vaga" coral — ao clicar, spinner + texto "Analisando..."

**Estado com análise:**
```
┌─────────────────────────────────────────────┐
│              SCORE: 78/100                  │
│         [  ○ ○ ○  anel circular  ○ ○ ○ ]   │
│       "Forte alinhamento técnico..."        │
├─────────────────────────────────────────────┤
│  ✅ Pontos Fortes        ❌ Lacunas          │
│  • Python 5 anos         • Kubernetes       │
│  • FastAPI               • Terraform        │
├─────────────────────────────────────────────┤
│  💡 Sugestões                               │
│  • Destacar projetos com FastAPI...         │
├─────────────────────────────────────────────┤
│  🏷️ Keywords Encontradas    🔴 Ausentes      │
│  [Python] [FastAPI] [REST]  [K8s] [AWS]     │
├─────────────────────────────────────────────┤
│  [ Gerar Currículo Personalizado ]          │
└─────────────────────────────────────────────┘
```
- Score ring: SVG circular, stroke coral, fundo taupe/20, animação fill ao aparecer
- Score `0–49`: coral mais escuro (risco) / `50–74`: âmbar / `75–100`: coral vivo (bom fit)
- Keywords: chips `rounded-full text-xs px-2 py-0.5` — verde para matched, vermelho/taupe para missing
- Botão "Gerar Currículo Personalizado": botão outline coral, ao clicar mostra textarea com currículo gerado + botão copiar

---

### 3. Página `/resume` — Currículo

**Layout:** Página centralizada, max-width 720px

**Upload:**
- Drop zone grande com borda tracejada coral, ícone upload, texto "Arraste seu PDF ou DOCX aqui"
- Ao fazer upload: preview do nome do arquivo + spinner de parsing + "Extraindo texto..."
- Botão "Trocar currículo" discreto após upload

**Visualização do currículo ativo:**
- Card branco com texto parseado em markdown simples
- Metadados: "Enviado em DD/MM/YYYY · X palavras"
- Botão "Ver currículo personalizado" (aparece se existe `tailored_resume` de alguma análise)

**Histórico de currículos:**
- Lista compacta abaixo: nome do arquivo + data + botão lixeira

---

### 4. Página `/dashboard` — Tracker de Candidaturas

**Layout:** Página full-width com kanban ou lista, toggle entre os dois modos no topo

**Cards de status (topo):**
```
[Salvas: 12]  [Aprovadas: 5]  [Candidatando: 3]  [Aplicadas: 8]  [Entrevistas: 2]  [Ofertas: 1]  [Recusadas: 4]
```
- Cada card: número grande + label pequena + barra de progresso coral proporcional

**Kanban (modo padrão):**
- 7 colunas: Salvas → Aprovadas → Candidatando → Aplicada → Entrevista → Oferta → Recusada
- Cards arrastáveis (drag-and-drop com `@dnd-kit/core`)
- Cada card: empresa + cargo + data + badge site (LinkedIn azul, Indeed roxo, etc.)

**Lista (modo alternativo):**
- Tabela com colunas: Empresa | Cargo | Status | Data | Plataforma | Ações
- Chips de status coloridos por etapa
- Ações: editar notas (modal), mover status, deletar

**Modal de detalhe/edição:**
- Título da vaga + empresa + link
- Select de status com ícones
- Textarea "Notas" com autosave
- Botão "Ver análise IA" se existir

---

### 5. Página `/settings` — Configurações

**Layout:** Sidebar de seções (esquerda, 200px) + conteúdo (direita)

**Seções:**
- Perfil pessoal
- Providers de IA
- Plataformas (burn accounts)

**Perfil pessoal:**
- Inputs: Nome completo, E-mail, Telefone, URL do LinkedIn
- Botão Salvar

**Providers de IA:**
- Grid de 10 cards de provider (2×5)
- Cada card: logo/emoji do provider + nome + input de API key (masked) + toggle ativo
- Provider ativo tem borda coral `ring-2 ring-coral`
- Card especial para Ollama: input de modelo em vez de API key
- Banner de aviso: "⚠️ Use burn accounts para automação"

**Plataformas:**
- Lista: LinkedIn, Indeed, Glassdoor, ZipRecruiter
- Cada item: logo + toggle "Habilitado" + campos email/senha (com show/hide) + status "Conectado" / "Não configurado"
- Aviso em vermelho claro: "Estas credenciais ficam armazenadas localmente apenas"

---

## Micro-interações e animações

- **Toasts**: canto inferior direito, duração 3s — verde para sucesso, coral para erro, taupe para info
- **Skeleton loading**: fundo `taupe/20` com pulse, nunca spinners no lugar de conteúdo
- **Botões em loading**: texto some, spinner aparece no lugar — botão mantém tamanho (sem layout shift)
- **Score ring**: animação stroke-dashoffset de 0 → valor em 600ms ease-out ao aparecer
- **JobDetailPanel**: `translate-x-full → translate-x-0` em 200ms ease-out ao abrir
- **Hover em cards**: `transition-colors duration-150` — nunca `transform scale` (sutil)
- **Focus rings**: `ring-2 ring-coral ring-offset-2` em todos os inputs e botões focados

---

## Estados especiais que precisam de design

1. **Backend offline**: banner laranja no topo "Backend desconectado — verifique se o servidor está rodando"
2. **Sem currículo enviado**: ao tentar analisar, nudge inline "Envie um currículo primeiro →"
3. **API key não configurada**: ao tentar analisar, modal "Configure sua chave de IA em Ajustes"
4. **Erro de scraping**: mensagem inline no painel de busca com sugestão de tentar outra plataforma
5. **Score 0**: texto explicativo "IA não encontrou dados suficientes para pontuar"

---

## Anti-padrões a evitar

- ❌ Sem dark mode (por ora — não está no roadmap)
- ❌ Sem sidebar de navegação esquerda — navegação é só a Navbar no topo
- ❌ Sem tabelas para o kanban — kanban é visual por padrão
- ❌ Sem gradientes coloridos
- ❌ Sem modais em cascata (máximo 1 modal aberto por vez)
- ❌ Sem loading spinners centralizados em tela cheia — sempre skeleton ou inline
- ❌ Nunca fundo branco puro para a página — sempre `#F4F3EE`

---

## Referências visuais

O tom visual deve lembrar: **Claude.ai** (minimalismo coral/areia) + **Linear** (tipografia afiada, feedback rápido) + **Notion** (espaço para respirar, sem overdesign).

---

*Jumpship UI Design Prompt v1.0 — Março 2026*
