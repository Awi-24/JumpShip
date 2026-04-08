# 🏛️ Arquitetura Global - JumpShip

## Visão Geral
O JumpShip é um sistema de busca e candidatura a empregos que está evoluindo de uma automação linear (v1) para um sistema de multi-agentes de estado (v2).

## Componentes Principais
- **Backend:** FastAPI com LangGraph.
- **Frontend:** React + Vite.
- **Orquestração:** LangGraph para gerenciar fluxos cíclicos e interrupções.
- **Persistência:** PostgreSQL (via LangGraph checkpointer) para memória de longo prazo dos agentes.

## Fluxo de Dados (Pipeline)
1. **Ingestão:** Currículo (PDF) -> `ResumeParser` -> Perfil JSON.
2. **Scouting:** Perfil -> LLM (Gera Queries) -> `JobSpy` -> Lista de Jobs.
3. **Matching:** Job Description + Perfil -> LLM -> Score (0-100) + Análise de Gaps.
4. **Candidatura (Apply):** Job Aprovado -> Tailoring (Ajuste de Currículo) -> Automação de Browser (Playwright).

## Notas Relacionadas
- [[🤖 Ecossistema de Agentes]]
- [[🧬 LangGraph e Grafos de Estado]]
- [[FastAPI + WebSockets]]

---
**Status do Estudo:** 🏗️ Em Mapeamento
**Última Atualização:** 2026-04-08