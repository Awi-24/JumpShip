# Jumpship — Especificação Técnica do Projeto

> Versão 1.0 · Março 2026

---

## 1. Visão geral

Jumpship é uma aplicação web full-stack construída como fork do [python-jobspy](https://github.com/Bunsly/JobSpy). O objetivo é transformar a biblioteca de scraping em uma plataforma completa de gestão de candidaturas — desde a descoberta de vagas até o acompanhamento pós-candidatura — com análise por IA no centro da experiência.

### Problema que resolve

O processo de candidatura a vagas é fragmentado: o usuário busca em múltiplos sites, analisa manualmente cada vaga, adapta o currículo individualmente, e acompanha o status em planilhas. Jumpship centraliza tudo isso em um único lugar com IA como acelerador.

### Princípios de design

- **Local-first**: todos os dados ficam no SQLite local — nenhuma informação sai da máquina do usuário sem consentimento explícito (as chamadas de IA)
- **Provider-agnostic**: nenhum lock-in de IA; o usuário troca de provider sem reescrever nada
- **Zero config para começar**: `./start.sh` sobe tudo sem variáveis de ambiente obrigatórias
- **UI minimalista**: inspirada no design do Claude — cores neutras com coral como acento, tipografia limpa, sem excesso de informação

---

## 2. Arquitetura

### Visão em camadas

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (usuário)                        │
├─────────────────────────────────────────────────────────────┤
│             Next.js 14 (App Router)  :3000                  │
│   page.tsx · resume/ · dashboard/ · settings/ · jobs/[id]  │
├─────────────────────────────────────────────────────────────┤
│              FastAPI (Python 3.11)   :8000                  │
│   /api/jobs · /api/resume · /api/analysis                   │
│   /api/applications · /api/settings · /api/health          │
├────────────────────────┬────────────────────────────────────┤
│   SQLite (local)       │   Serviços externos (opcional)     │
│   jobspy_ui.db         │   · AI providers (10 opções)       │
│                        │   · Job sites (scraping)           │
│                        │   · Ollama (local, sem rede)       │
└────────────────────────┴────────────────────────────────────┘
```

### Decisões arquiteturais

| Decisão | Escolha | Justificativa |
|---|---|---|
| Banco de dados | SQLite | Local-first, zero infraestrutura, suficiente para uso individual |
| ORM | SQLAlchemy 2.x | Migrações simples com `create_all`, fácil de evoluir |
| API | FastAPI | Async-ready, tipagem automática, Swagger embutido |
| Frontend | Next.js 14 App Router | SSR opcional, roteamento de arquivo, Tailwind nativo |
| Estilo | Tailwind CSS | Produtividade, design system via `tailwind.config.js` |
| Estado do cliente | sessionStorage via hook | Persiste durante a sessão sem backend, sem Redux |
| Containerização | Docker Compose | Dois containers (backend + frontend), volumes nomeados |

---

## 3. Stack tecnológica

### Backend

| Pacote | Versão | Uso |
|---|---|---|
| fastapi | 0.115.5 | Framework HTTP |
| uvicorn[standard] | 0.32.1 | Servidor ASGI |
| sqlalchemy | 2.0.36 | ORM + migrations lite |
| pydantic | 2.10.3 | Validação de request/response |
| anthropic | 0.40.0 | SDK Claude (tool_use) |
| openai | 1.58.1 | SDK OpenAI + compatível com Groq, Mistral, HuggingFace, OpenRouter, Ollama |
| google-generativeai | 0.8.3 | SDK Gemini |
| httpx | 0.28.1 | HTTP async (Cohere v2 API) |
| pymupdf | 1.25.1 | Parse de PDF |
| python-docx | 1.1.2 | Parse de DOCX |
| playwright | 1.49.0 | Automação de browser (Chromium) |
| beautifulsoup4 | 4.12.3 | Dependência transitiva do jobspy |
| tls-client | 1.0.1 | Dependência transitiva do jobspy |
| pandas | 2.2.3 | Processamento de resultados do jobspy |

### Frontend

| Pacote | Versão | Uso |
|---|---|---|
| next | 14.x | Framework React SSR/SSG |
| react | 18.x | UI |
| tailwindcss | 3.x | Estilo utilitário |
| typescript | 5.x | Tipagem estática |
| axios (via lib/api.ts) | — | Cliente HTTP tipado |
| lucide-react | 0.383.0 | Ícones |
| clsx | — | Composição de classes condicionais |

---

## 4. Modelo de dados

### Tabela: `saved_jobs`

| Coluna | Tipo | Descrição |
|---|---|---|
| id | STRING PK | UUID |
| title | STRING | Título da vaga |
| company_name | STRING | Nome da empresa |
| job_url | STRING | URL da listagem |
| job_url_direct | STRING | URL direta da vaga |
| location_city | STRING | Cidade |
| location_state | STRING | Estado/província |
| location_country | STRING | País |
| description | TEXT | Descrição completa |
| job_type | STRING | fulltime / parttime / contract / internship |
| is_remote | BOOLEAN | Remoto |
| min_salary / max_salary | FLOAT | Faixa salarial |
| salary_interval | STRING | yearly / monthly / hourly |
| currency | STRING | Moeda (USD, BRL, etc.) |
| site | STRING | linkedin / indeed / glassdoor / etc. |
| company_industry | STRING | Setor |
| job_level | STRING | Nível (junior / mid / senior) |
| date_posted | STRING | Data de publicação |
| easy_apply | BOOLEAN | Formulário simplificado disponível |
| saved_at | DATETIME | Timestamp de salvamento |
| raw_data | JSON | Payload bruto do jobspy |

### Tabela: `resumes`

| Coluna | Tipo | Descrição |
|---|---|---|
| id | STRING PK | UUID |
| filename | STRING | Nome do arquivo original |
| content | TEXT | Texto extraído (markdown-like) |
| file_path | STRING | Caminho no volume de uploads |
| uploaded_at | DATETIME | Timestamp |

### Tabela: `analyses`

| Coluna | Tipo | Descrição |
|---|---|---|
| id | STRING PK | UUID |
| job_id | STRING | FK → saved_jobs.id |
| resume_id | STRING | FK → resumes.id |
| job_title | STRING | Snapshot do título |
| company_name | STRING | Snapshot da empresa |
| score | FLOAT | Score 0–100 |
| summary | TEXT | Resumo textual (2–3 frases) |
| strengths | JSON | Array de pontos fortes |
| gaps | JSON | Array de lacunas |
| suggestions | JSON | Array de sugestões |
| keywords_matched | JSON | Keywords encontradas no currículo |
| keywords_missing | JSON | Keywords ausentes no currículo |
| tailored_resume | TEXT | Currículo personalizado gerado (texto plano) |
| provider | STRING | Provider de IA usado |
| analyzed_at | DATETIME | Timestamp |

### Tabela: `applications`

| Coluna | Tipo | Descrição |
|---|---|---|
| id | STRING PK | UUID |
| job_id | STRING | FK → saved_jobs.id |
| job_title | STRING | Snapshot |
| company_name | STRING | Snapshot |
| job_url | STRING | URL da vaga |
| site | STRING | Plataforma de origem |
| status | STRING | Pipeline (ver abaixo) |
| applied_at | DATETIME | Data de candidatura |
| created_at / updated_at | DATETIME | Auditoria |
| notes | TEXT | Notas livres do usuário |
| analysis_id | STRING | FK → analyses.id (opcional) |
| is_easy_apply | BOOLEAN | Se usou automação |

**Pipeline de status:** `saved → approved → applying → applied → interviewing → offered → rejected`

### Tabela: `settings`

Key-value store simples.

| Chave | Descrição |
|---|---|
| `active_provider` | Provider de IA ativo |
| `api_key_anthropic` | Chave Anthropic |
| `api_key_openai` | Chave OpenAI |
| `api_key_gemini` | Chave Google Gemini |
| `api_key_deepseek` | Chave DeepSeek |
| `api_key_groq` | Chave Groq |
| `api_key_huggingface` | Chave Hugging Face |
| `api_key_mistral` | Chave Mistral AI |
| `api_key_openrouter` | Chave OpenRouter |
| `api_key_cohere` | Chave Cohere |
| `ollama_model` | Nome do modelo Ollama local |
| `platform_*_email` | E-mail da burn account |
| `platform_*_password` | Senha da burn account |
| `profile_name` | Nome completo |
| `profile_email` | E-mail pessoal |
| `profile_phone` | Telefone |
| `profile_linkedin_url` | URL do LinkedIn |

> ⚠️ As chaves de API e senhas são armazenadas em texto plano no SQLite local. Para uso em rede ou compartilhado, considere criptografia com senha mestre.

---

## 5. API REST

Base URL: `http://localhost:8000`

Documentação interativa: `http://localhost:8000/docs`

### Jobs

| Método | Rota | Body | Descrição |
|---|---|---|---|
| POST | `/api/jobs/search` | `SearchRequest` | Scraping de vagas |
| POST | `/api/jobs/save` | `SaveJobRequest` | Salva vaga no banco |
| GET | `/api/jobs/saved` | — | Lista vagas salvas |
| GET | `/api/jobs/saved/{id}` | — | Detalhe de vaga salva |
| DELETE | `/api/jobs/saved/{id}` | — | Remove vaga salva |

**`SearchRequest`**
```json
{
  "search_term": "software engineer",
  "location": "São Paulo, Brasil",
  "results_wanted": 20,
  "hours_old": 72,
  "distance": 50,
  "job_type": "fulltime",
  "is_remote": false,
  "easy_apply_only": false,
  "site_name": ["linkedin", "indeed"],
  "country_indeed": "Brazil"
}
```

### Resume

| Método | Rota | Body | Descrição |
|---|---|---|---|
| POST | `/api/resume/upload` | `multipart/form-data` | Upload e parse |
| GET | `/api/resume/latest` | — | Currículo mais recente |
| GET | `/api/resume` | — | Lista todos os currículos |
| DELETE | `/api/resume/{id}` | — | Remove currículo |

### Analysis

| Método | Rota | Body | Descrição |
|---|---|---|---|
| POST | `/api/analysis` | `AnalyseRequest` | Análise IA: currículo × vaga |
| GET | `/api/analysis/{id}` | — | Análise por ID |
| GET | `/api/analysis/job/{job_id}` | — | Última análise de uma vaga |
| POST | `/api/analysis/tailored-resume` | `{ analysis_id }` | Gera currículo personalizado |

**Response de análise**
```json
{
  "id": "uuid",
  "job_id": "uuid",
  "resume_id": "uuid",
  "score": 78,
  "summary": "Candidato tem forte alinhamento técnico...",
  "strengths": ["5 anos de experiência com Python", "..."],
  "gaps": ["Falta experiência com Kubernetes", "..."],
  "suggestions": ["Destacar projetos com FastAPI", "..."],
  "keywords_matched": ["Python", "FastAPI", "REST"],
  "keywords_missing": ["Kubernetes", "Terraform"],
  "has_tailored_resume": false,
  "analyzed_at": "2026-03-25T14:32:00"
}
```

### Applications

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/applications` | Lista candidaturas |
| POST | `/api/applications` | Cria candidatura |
| PUT | `/api/applications/{id}` | Atualiza candidatura |
| PUT | `/api/applications/{id}/status` | Atualiza status |
| DELETE | `/api/applications/{id}` | Remove candidatura |
| POST | `/api/applications/{id}/apply` | Dispara automação |
| GET | `/api/applications/stats/summary` | Contagem por status |

### Settings

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/settings/ai-keys` | Chaves mascaradas + provider ativo |
| PUT | `/api/settings/ai-keys` | Atualiza chaves e provider |
| GET | `/api/settings/platforms` | Status de todas as plataformas |
| PUT | `/api/settings/platforms/{id}` | Salva credenciais de plataforma |
| DELETE | `/api/settings/platforms/{id}` | Remove credenciais |
| GET | `/api/settings/profile` | Perfil de candidatura |
| PUT | `/api/settings/profile` | Atualiza perfil |

---

## 6. Sistema de análise por IA

### Schema JSON de saída

Todos os providers retornam exatamente este esquema:

```json
{
  "score": 0,
  "summary": "",
  "strengths": [],
  "gaps": [],
  "suggestions": [],
  "keywords_matched": [],
  "keywords_missing": []
}
```

### Estratégia de saída estruturada por provider

| Provider | Mecanismo | Garantia |
|---|---|---|
| Anthropic | `tool_use` com JSON schema | ✅ Garantida pela API |
| OpenAI | `response_format: json_object` | ✅ Garantida pela API |
| DeepSeek | `response_format: json_object` | ✅ Garantida pela API |
| Groq | `response_format: json_object` | ✅ Garantida pela API |
| Mistral AI | `response_format: json_object` | ✅ Garantida pela API |
| OpenRouter | `response_format: json_object` (pass-through) | ⚠️ Depende do modelo |
| Cohere | `response_format: json_object` (v2 API) | ✅ Garantida pela API |
| Gemini | `response_mime_type: application/json` | ✅ Garantida pela API |
| Hugging Face | Apenas prompt | ⚠️ Depende do modelo |
| Ollama | `response_format: json_object` | ✅ Se o modelo suportar |

### Fallback de parsing

Quando a resposta não é JSON válido na primeira tentativa:

1. Strip de markdown fences (` ```json ... ``` `)
2. Extração do primeiro bloco `{...}` da resposta
3. Se ainda falhar: retry automático — a IA recebe sua própria resposta quebrada e é pedida para corrigir
4. Se o retry também falhar: HTTP 500 com preview da resposta inválida

### Limites de contexto

| Campo | Limite |
|---|---|
| Texto do currículo | 8.000 caracteres |
| Descrição da vaga | 6.000 caracteres |
| Max tokens de resposta (análise) | 2.048 tokens |
| Max tokens (currículo personalizado) | 4.096 tokens |

---

## 7. Providers de IA

### Tabela completa

| Provider | Modelo | Base URL | JSON nativo | Chave necessária |
|---|---|---|---|---|
| Anthropic | claude-sonnet-4-6 | api.anthropic.com | tool_use | Sim |
| OpenAI | gpt-4o-mini | api.openai.com | json_object | Sim |
| Google Gemini | gemini-1.5-flash | generativelanguage.googleapis.com | mime_type | Sim |
| DeepSeek | deepseek-chat | api.deepseek.com | json_object | Sim |
| Groq | llama-3.3-70b-versatile | api.groq.com/openai/v1 | json_object | Sim |
| Hugging Face | Qwen/Qwen2.5-72B-Instruct | api-inference.huggingface.co/v1 | Não | Sim |
| Mistral AI | mistral-small-latest | api.mistral.ai/v1 | json_object | Sim |
| OpenRouter | meta-llama/llama-3.2-3b-instruct:free | openrouter.ai/api/v1 | json_object | Sim |
| Cohere | command-r | api.cohere.com/v2/chat | json_object | Sim |
| Ollama | configurável (padrão: llama3.2) | localhost:11434/v1 | json_object | Não (usa nome do modelo) |

### Ollama no Docker

O Ollama roda na máquina host, fora do container. O backend resolve isso via variável de ambiente:

```
OLLAMA_HOST=http://host.docker.internal:11434  # set no docker-compose.yml
```

No `start.sh` (sem Docker), o valor padrão é `http://localhost:11434`.

O mapping `host.docker.internal:host-gateway` no `extra_hosts` do docker-compose garante a resolução no Linux (no Docker Desktop já funciona nativamente).

---

## 8. Frontend

### Paleta de cores (design system)

| Nome | Hex | Uso |
|---|---|---|
| `sand` | `#F4F3EE` | Background principal |
| `coral` | `#C15F3C` | Cor de acento — botões, links ativos, badges |
| `coral-50` | `#FAF0EB` | Background sutil em estados hover/active |
| `coral-600` | `#A04D31` | Hover em botões coral |
| `taupe` | `#B1ADA1` | Texto secundário, bordas suaves |
| `white` | `#FFFFFF` | Cards, painéis |

### Rotas da aplicação

| Rota | Componente | Descrição |
|---|---|---|
| `/` | `page.tsx` | Busca de vagas + painel de detalhes |
| `/resume` | `resume/page.tsx` | Upload e visualização de currículo |
| `/dashboard` | `dashboard/page.tsx` | Tracker de candidaturas |
| `/settings` | `settings/page.tsx` | Configurações de IA, plataformas e perfil |
| `/jobs/[id]` | `jobs/[id]/page.tsx` | Deep link para vaga salva |

### Persistência de estado

Estado da busca (termo, localização, filtros, resultados) é preservado via `sessionStorage` através do hook `usePersistedState<T>`. O estado persiste durante a sessão do browser, mas é limpo ao fechar a aba.

```typescript
// Uso
const [searchTerm, setSearchTerm] = usePersistedState("searchTerm", "");
const [jobs, setJobs] = usePersistedState<Job[]>("searchResults", []);
```

### Componentes principais

| Componente | Responsabilidade |
|---|---|
| `Navbar` | Logo, navegação, indicador de rota ativa |
| `JobCard` | Card de vaga com avatar de empresa, badge de tipo, score |
| `JobDetailPanel` | Painel lateral com tabs Descrição / Análise IA |
| `AnalysisPanel` | Score ring, strengths/gaps/sugestões/keywords, geração de currículo |

---

## 9. Containerização

### docker-compose.yml

```yaml
services:
  backend:
    build: { context: ., dockerfile: backend/Dockerfile }
    ports: ["8000:8000"]
    volumes:
      - ./backend:/app/backend          # hot-reload em dev
      - jumpship-db:/app/data           # SQLite persistente
      - jumpship-uploads:/app/uploads   # currículos
    environment:
      - DATABASE_URL=sqlite:////app/data/jobspy_ui.db
      - CORS_ORIGINS=http://localhost:3000
      - OLLAMA_HOST=http://host.docker.internal:11434
    extra_hosts:
      - "host.docker.internal:host-gateway"

  frontend:
    build: { context: ./frontend }
    ports: ["3000:3000"]
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
    depends_on: [backend]
```

### Dockerfile do backend (pontos importantes)

- Base: `python:3.11-slim` (Debian trixie)
- Dependências do Chromium instaladas manualmente (sem `--with-deps`) para evitar conflitos de nomes de pacotes no trixie
- `libasound2t64` em vez de `libasound2` (renomeado no trixie)
- `playwright install chromium` sem flags adicionais

### .dockerignore do frontend

```
node_modules
.next
.env*.local
```

Impede que `node_modules` da máquina Windows sobrescreva a instalação limpa feita pelo `npm ci` dentro do container.

---

## 10. Migração de banco de dados

O projeto não usa Alembic. Migrações são feitas via helper leve no `main.py`:

```python
def _migrate_db():
    migrations = [
        "ALTER TABLE analyses ADD COLUMN keywords_matched JSON",
        "ALTER TABLE analyses ADD COLUMN keywords_missing JSON",
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # coluna já existe — OK
```

Isso garante compatibilidade com bancos criados em versões anteriores sem precisar recriar o banco.

---

## 11. Segurança e limitações conhecidas

### Armazenamento de credenciais

Chaves de API e senhas de plataformas são armazenadas em texto plano no SQLite local. Isso é aceitável para uso pessoal numa máquina local. Para deployments compartilhados ou em rede:
- Adicionar criptografia simétrica com senha mestre (ex: `cryptography.fernet`)
- Usar variáveis de ambiente em vez de banco para chaves de serviço

### Automação de browser

- O uso de automação para submissão de candidaturas pode violar os Termos de Serviço das plataformas
- O projeto não incentiva o uso em escala — é uma ferramenta pessoal de produtividade
- Recomenda-se usar "burn accounts" (contas dedicadas) para evitar banimento da conta principal

### Limitações do scraping

Herdadas do python-jobspy:

| Plataforma | Limitação |
|---|---|
| LinkedIn | ~10 páginas por IP por sessão, sem autenticação |
| Indeed | Mais estável, sem rate limit relevante |
| Glassdoor | Pode requerer autenticação para descrições completas |
| Google Jobs | Baseado em HTML público, suscetível a mudanças de layout |
| ZipRecruiter | Estável |

---

## 12. Estrutura de arquivos detalhada

```
jumpship/
│
├── backend/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app + startup + migrations
│   ├── database.py              # Engine SQLAlchemy, SessionLocal, Base
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env                     # (não versionado) variáveis locais
│   │
│   ├── models/
│   │   └── db_models.py         # SavedJob, Resume, Analysis, Application, Settings
│   │
│   ├── routers/
│   │   ├── jobs.py              # /api/jobs/*
│   │   ├── resume.py            # /api/resume/*
│   │   ├── analysis.py          # /api/analysis/*
│   │   ├── applications.py      # /api/applications/*
│   │   └── settings.py          # /api/settings/* + get_active_provider_key()
│   │
│   └── services/
│       ├── scraper.py           # Wrapper jobspy.scrape_jobs()
│       ├── resume_parser.py     # PyMuPDF (PDF) + python-docx (DOCX) → texto
│       ├── ai_evaluator.py      # Multi-provider: analyse_resume(), generate_tailored_resume()
│       └── browser_agent.py     # Playwright: navega, preenche, submete
│
├── frontend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── next.config.js           # rewrites /api/* → backend, remotePatterns
│   ├── tailwind.config.js       # cores custom: sand, coral, taupe
│   ├── tsconfig.json
│   ├── package.json
│   │
│   ├── public/
│   │   ├── logo.png             # Logo Jumpship (32×32 exibido na Navbar)
│   │   ├── favicon.ico          # Multi-size: 16, 32, 48px
│   │   └── favicon-32.png       # Para <link rel="icon">
│   │
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           # RootLayout: Navbar + Footer + metadata
│       │   ├── globals.css          # Variáveis CSS, body background (#F4F3EE)
│       │   ├── page.tsx             # Busca de vagas (estado persistido)
│       │   ├── resume/
│       │   │   └── page.tsx         # Upload, parse, visualização
│       │   ├── dashboard/
│       │   │   └── page.tsx         # Tracker de candidaturas
│       │   ├── settings/
│       │   │   └── page.tsx         # AI keys, plataformas, perfil
│       │   └── jobs/
│       │       └── [id]/
│       │           └── page.tsx     # Deep link de vaga salva
│       │
│       ├── components/
│       │   ├── Navbar.tsx           # Logo (next/image), links, rota ativa
│       │   ├── Footer.tsx
│       │   ├── JobCard.tsx          # Card com avatar, badge tipo/remoto, score
│       │   ├── JobDetailPanel.tsx   # Tabs: Descrição / Análise IA
│       │   └── AnalysisPanel.tsx    # Score ring, pontos, keywords, currículo personalizado
│       │
│       └── lib/
│           ├── api.ts               # Axios wrapper com tipos TS (Job, Analysis, Resume…)
│           └── usePersistedState.ts # Hook: useState + sessionStorage
│
├── jobspy/                      # Biblioteca python-jobspy (fork local)
│
├── docker-compose.yml
├── start.sh                     # Quick-start: venv + backend + frontend
├── README.md                    # Documentação para usuário final
└── SPEC.md                      # Este arquivo — especificação técnica
```

---

## 13. Variáveis de ambiente

### Backend

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./jobspy_ui.db` | URL do banco SQLAlchemy |
| `UPLOAD_DIR` | `./uploads` | Diretório para arquivos de currículo |
| `CORS_ORIGINS` | `http://localhost:3000` | Origens permitidas (separadas por vírgula) |
| `ANTHROPIC_API_KEY` | — | Fallback legado para chave Anthropic |
| `OLLAMA_HOST` | `http://localhost:11434` | Host do Ollama (Docker usa `host.docker.internal`) |

### Frontend

| Variável | Padrão | Descrição |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | URL do backend para rewrites |

---

## 14. Roadmap

### Melhorias planejadas

**Análise**
- Comparação de múltiplas vagas lado a lado (radar chart de score)
- Histórico de análises por vaga com diff entre versões
- Sugestão automática de provider com melhor custo-benefício

**Busca**
- Alertas automáticos: notificação quando novas vagas corresponderem a uma busca salva
- Filtro por faixa salarial
- Exportação de resultados para CSV/XLSX

**Banco de dados**
- Migração para Alembic para gestão robusta de schema
- Opção de criptografia de credenciais com senha mestre

**Segurança**
- Autenticação local (PIN/senha) para proteger acesso à UI
- Criptografia das chaves de API em repouso

**Infraestrutura**
- Suporte a PostgreSQL como alternativa ao SQLite
- Modo multi-usuário para equipes pequenas

---

*Documento gerado em 25 de março de 2026.*
