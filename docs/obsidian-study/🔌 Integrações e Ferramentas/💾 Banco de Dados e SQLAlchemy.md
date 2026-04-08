# 💾 Banco de Dados e SQLAlchemy

O JumpShip utiliza **PostgreSQL** (ou SQLite para desenvolvimento local) gerenciado pelo **SQLAlchemy**, o ORM (Object Relational Mapper) padrão do ecossistema Python.

## Principais Tabelas e Relacionamentos

### 1. `SavedJob` (Vagas Coletadas)
- Armazena o resultado bruto do `jobspy`.
- Contém metadados como `title`, `company_name`, `job_url` e `description`.

### 2. `Analysis` (A Inteligência do Matcher)
- Relaciona um `Job` a um `Resume`.
- **Campos Importantes:**
    - `score`: Nota de 0 a 100 gerada pela IA.
    - `strengths` / `gaps`: Listas JSON com pontos fortes e fracos do candidato para aquela vaga.
    - `tailored_resume`: Uma versão otimizada do currículo para esta vaga específica.

### 3. `UserProfile` (O "Dossiê" do Usuário)
- Armazena informações pessoais (nome, telefone, LinkedIn) e credenciais.
- **Segurança:** O código menciona que campos sensíveis são armazenados apenas localmente para evitar envio desnecessário para LLMs na nuvem.

### 4. `AgentThread` (Memória do LangGraph)
- É aqui que o sistema sabe se um agente está `running`, `success`, `failed` ou `waiting_hitl`.
- **Importante:** O estado real do agente (os checkpoints) fica em um banco SQLite separado (`jumpship_agents.db`) gerenciado pelo LangGraph.

## Padrões de Código (Clean Code)
- **UUIDs como Chaves Primárias:** O projeto usa strings UUID (geradas por `uuid4()`) em vez de IDs incrementais simples, o que é uma boa prática para sistemas distribuídos e segurança.
- **Timestamping:** Todas as tabelas têm `created_at` e `updated_at` automáticos via `func.now()`.

---
**Referência no Código:** `backend/models/db_models.py`
**Ver também:** [[🔌 Biblioteca SQLAlchemy]] (em breve)