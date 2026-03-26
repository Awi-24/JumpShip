# Jumpship

> Fork of [python-jobspy](https://github.com/Bunsly/JobSpy) — plataforma completa de busca de vagas com UI moderna, análise de currículo por IA e automação de candidaturas.

---

## O que é isso?

**Jumpship** adiciona uma aplicação web completa ao motor de scraping do python-jobspy. Em vez de uma biblioteca Python pura, você tem:

- UI moderna para buscar e navegar vagas (Next.js 14 + cores da identidade visual do Claude)
- Análise de currículo por IA — score de compatibilidade, pontos fortes, lacunas, sugestões, keywords
- Geração de currículo personalizado para cada vaga
- Tracker de candidaturas com pipeline de status
- Automação de formulários via Playwright (Easy Apply)
- Suporte a **10 providers de IA** — incluindo opções 100% gratuitas e modelo local (Ollama)

---

## Funcionalidades

### Busca de vagas
- Scraping de **LinkedIn, Indeed, Glassdoor, Google Jobs, ZipRecruiter, Bayt, Naukri** (internacional)
- Plataformas brasileiras: **Gupy** (API oficial), **Catho**, **Vagas.com.br**
- Filtros: localização, distância, tipo de contrato, remoto, Easy Apply, publicadas há N horas
- Seletor de país para Indeed/Glassdoor
- Salva vagas no banco local para análise posterior
- Estado da busca preservado ao navegar entre páginas

### Concursos públicos
- Aba dedicada com busca em **PCI Concursos** e portais do **Gov.br**
- Filtros: Estado/Região, Nível (fundamental/médio/superior/pós-graduação), Área, Salário mínimo, Status (abertos/todos), Banca e Órgão
- Exibição de prazo de inscrição, número de vagas e faixa salarial em R$

### Análise de currículo por IA
- Faça upload do seu currículo uma vez (PDF ou DOCX) — ele é parseado e armazenado
- Clique em **Analisar** em qualquer vaga para obter:
  - **Score** (0–100) — compatibilidade geral
  - **Pontos fortes** — o que no seu currículo corresponde à vaga
  - **Lacunas** — requisitos que você não cobre
  - **Sugestões** — como melhorar sua candidatura
  - **Keywords** — encontradas vs ausentes no currículo
- Saída JSON estruturada garantida por provider nativo (tool_use / json_object / json mime)
- Retry automático se o modelo não retornar JSON válido

### Personalização de currículo
- Após a análise, gere uma versão do currículo otimizada para a vaga
- A IA reescreve seu currículo destacando experiências relevantes e inserindo keywords ausentes — sem inventar nada

### Tracker de candidaturas
- Adicione qualquer vaga ao seu tracker
- Pipeline: `Salva → Aprovada → Candidatando → Candidatada → Entrevista → Oferta / Rejeitada`
- Dashboard com contagem por status

### Automação (Playwright)
- Para vagas Easy Apply, dispare o agente de browser direto do dashboard
- O agente navega até a vaga, preenche o formulário com seus dados e envia o currículo

---

## Providers de IA suportados

### Pagos

| Provider | Modelo | JSON garantido | Link |
|---|---|---|---|
| Anthropic | claude-sonnet-4-6 | tool_use | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | gpt-4o-mini | json_object | [platform.openai.com](https://platform.openai.com/api-keys) |
| Google Gemini | gemini-1.5-flash | response_mime_type | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| DeepSeek | deepseek-chat | json_object | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |

### Gratuitos (API online)

| Provider | Modelo | Diferencial | Link |
|---|---|---|---|
| **Groq** | llama-3.3-70b-versatile | Inferência ultra-rápida, limites diários generosos | [console.groq.com](https://console.groq.com/keys) |
| **Hugging Face** | Qwen/Qwen2.5-72B-Instruct | Serverless Inference API, milhares de modelos | [huggingface.co](https://huggingface.co/settings/tokens) |
| **Mistral AI** | mistral-small-latest | Tier "Experiment" gratuito para testes | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| **OpenRouter** | llama-3.2-3b-instruct:free | Agregador — sempre há modelos 100% gratuitos | [openrouter.ai](https://openrouter.ai/settings/keys) |
| **Cohere** | command-r | Trial key gratuita para desenvolvimento | [dashboard.cohere.com](https://dashboard.cohere.com/api-keys) |

### Local (sem internet)

| Provider | Modelo padrão | Requisito |
|---|---|---|
| **Ollama** | llama3.2 (configurável) | [Ollama](https://ollama.com/download) rodando na máquina |

Para usar o Ollama, instale-o e baixe um modelo. O Jumpship **detecta automaticamente** o Ollama rodando na máquina — sem nenhuma configuração manual. Se nenhuma API key estiver configurada, ele usa Ollama como provedor padrão. O campo "chave" nas configurações aceita qualquer nome de modelo instalado (`llama3.2`, `mistral`, `qwen2.5`, `deepseek-r1`, etc.).

---

## Stack

| Camada | Tecnologia |
|---|---|
| Scraping | python-jobspy |
| Backend | FastAPI + Python 3.11 |
| Banco de dados | SQLite (local) |
| Frontend | Next.js 14 + Tailwind CSS |
| Parsing de currículo | PyMuPDF + python-docx |
| Análise por IA | 10 providers (ver tabela acima) |
| Automação de browser | Playwright (Chromium) |
| Containerização | Docker Compose |

---

## Quick Start (sem Docker)

**Requisitos:** Python 3.10+, Node 18+, npm

```bash
git clone https://github.com/seu-usuario/jumpship.git
cd jumpship

chmod +x start.sh && ./start.sh
```

O script irá:
1. Criar um ambiente virtual Python e instalar as dependências
2. Iniciar o backend FastAPI em `http://localhost:8000`
3. Instalar os pacotes npm e iniciar o frontend Next.js em `http://localhost:3000`

### Setup manual

```bash
# Backend
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000

# Frontend (em outro terminal)
cd frontend
npm install
npm run dev
```

---

## Docker

```bash
docker-compose up --build
```

| Serviço | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |

### Ollama com Docker

O Ollama roda na máquina host, não dentro do container. O `docker-compose.yml` já está configurado para isso:

```yaml
environment:
  - OLLAMA_HOST=http://host.docker.internal:11434
extra_hosts:
  - "host.docker.internal:host-gateway"
```

No `start.sh` (sem Docker), o backend usa `localhost:11434` automaticamente.

---

## Configuração

### 1. Chave de IA

Vá em **Configurações → AI Keys** na UI, cole sua chave e selecione o provider ativo.

Fallback por variável de ambiente (compatibilidade retroativa):

```bash
# backend/.env
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Credenciais de plataforma (opcional — para automação)

Vá em **Configurações → Platform Login** para adicionar credenciais de LinkedIn, Indeed, Glassdoor ou ZipRecruiter.

> ⚠️ **Use uma "burn account" dedicada.** Crie uma conta separada em cada plataforma exclusivamente para automação. O login automatizado pode violar os Termos de Serviço e resultar em banimento. Nunca use sua conta pessoal principal.

### 3. Perfil de candidatura

Vá em **Configurações → Perfil** para salvar seu nome, e-mail, telefone e URL do LinkedIn. Esses dados são usados para preencher formulários automaticamente.

---

## Estrutura do projeto

```
jumpship/
├── backend/
│   ├── main.py               # Entrypoint FastAPI + migration leve
│   ├── database.py           # SQLAlchemy + SQLite
│   ├── models/
│   │   └── db_models.py      # ORM: SavedJob, Resume, Analysis, Application, Settings
│   ├── routers/
│   │   ├── jobs.py           # Busca + vagas salvas (internacional)
│   │   ├── brazilian_jobs.py # Gupy, Catho, Vagas.com.br
│   │   ├── concursos.py      # Concursos públicos + filtros
│   │   ├── resume.py         # Upload + parse
│   │   ├── analysis.py       # Score por IA + currículo personalizado
│   │   ├── applications.py   # Tracker + trigger de automação
│   │   └── settings.py       # Chaves de IA + credenciais + perfil + Ollama
│   ├── services/
│   │   ├── scraper.py            # Wrapper do jobspy
│   │   ├── brazilian_scrapers.py # Gupy (API) + Catho + Vagas (HTML)
│   │   ├── concursos_scraper.py  # PCI Concursos + Gov.br
│   │   ├── resume_parser.py      # PyMuPDF + python-docx
│   │   ├── ai_evaluator.py       # Cliente multi-provider com saída JSON garantida
│   │   └── browser_agent.py      # Automação Playwright
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── public/
│   │   ├── logo.png          # Logo Jumpship
│   │   ├── favicon.ico
│   │   └── favicon-32.png
│   └── src/
│       ├── app/
│       │   ├── page.tsx          # Busca de vagas
│       │   ├── resume/           # Gerenciamento de currículo
│       │   ├── dashboard/        # Tracker de candidaturas
│       │   ├── settings/         # Configurações
│       │   └── jobs/[id]/        # Detalhe de vaga (deep link)
│       ├── components/
│       │   ├── Navbar.tsx
│       │   ├── JobCard.tsx
│       │   ├── JobDetailPanel.tsx
│       │   └── AnalysisPanel.tsx
│       └── lib/
│           ├── api.ts            # Cliente de API com tipos
│           └── usePersistedState.ts  # Hook para persistência de estado via sessionStorage
├── docker-compose.yml
├── start.sh
└── README.md
```

---

## API Reference

Documentação interativa em `http://localhost:8000/docs` com o backend rodando.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/jobs/search` | Scraping de vagas nos sites selecionados |
| POST | `/api/jobs/save` | Salva vaga no banco local |
| GET | `/api/jobs/saved` | Lista vagas salvas |
| POST | `/api/resume/upload` | Upload e parse de currículo |
| GET | `/api/resume/latest` | Currículo mais recente |
| POST | `/api/analysis` | Análise IA: currículo × vaga |
| GET | `/api/analysis/job/{job_id}` | Última análise de uma vaga |
| POST | `/api/analysis/tailored-resume` | Gera currículo personalizado |
| GET | `/api/applications` | Lista candidaturas |
| PUT | `/api/applications/{id}/status` | Atualiza status da candidatura |
| POST | `/api/applications/{id}/apply` | Dispara automação de browser |
| GET/PUT | `/api/settings/ai-keys` | Gerencia chaves de IA (todos os providers) |
| GET/PUT | `/api/settings/platforms/{id}` | Gerencia credenciais de plataforma |
| GET/PUT | `/api/settings/profile` | Gerencia perfil de candidatura |
| GET | `/api/health` | Health check |

---

## Limitações conhecidas

Herdadas do python-jobspy:
- **LinkedIn** tem rate limit agressivo (~10 páginas por IP) — use proxies para volume maior
- **Indeed** é o scraper mais confiável (sem rate limit relevante)
- Máximo ~1.000 resultados por busca

Automação de browser:
- Conformidade com os ToS das plataformas é responsabilidade do usuário
- Fluxos de Easy Apply variam bastante entre sites e podem requerer ajustes manuais

---

## Créditos

Jumpship é um fork de **[python-jobspy](https://github.com/Bunsly/JobSpy)**, criado por [Bunsly](https://github.com/Bunsly) e colaboradores. A biblioteca original fornece toda a infraestrutura de scraping sobre a qual esta aplicação é construída.

---

## Licença

MIT — igual ao python-jobspy original. Veja [LICENSE](LICENSE).
