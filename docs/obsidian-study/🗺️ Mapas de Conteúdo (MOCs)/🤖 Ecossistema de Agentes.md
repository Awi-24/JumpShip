# 🤖 Ecossistema de Agentes

O JumpShip v2 utiliza uma arquitetura baseada em grafos onde cada "agente" é um nó ou um sub-grafo especializado.

## 1. 🛰️ [[🛰️ Scout (Busca Dinâmica)|Scout Agent]]
- **Objetivo:** Encontrar vagas que o usuário não encontraria com buscas simples.
- **Técnica:** Usa LLM para ler o currículo e expandir sinônimos de cargos e tecnologias para consultas no `jobspy`.
- **Localização:** `backend/agents/scout_graph.py`

## 2. ⚖️ [[⚖️ Matcher (Avaliação de Perfil)|Matcher Agent]]
- **Objetivo:** Filtrar o ruído e ranquear vagas.
- **Lógica:** Realiza uma "entrevista reversa", comparando os requisitos da vaga com as experiências reais do candidato.
- **Localização:** `backend/agents/matcher_graph.py`

## 3. 🚀 [[🚀 Apply (Execução e HITL)|Apply Agent]]
- **Objetivo:** Executar a candidatura.
- **Diferencial:** Possui capacidade de **Human-in-the-Loop (HITL)**. Se encontrar um captcha ou pergunta complexa, ele "pausa" seu estado e notifica o usuário via WebSocket.
- **Localização:** `backend/agents/apply_graph.py`

## 4. 📥 [[📥 Inbox (Monitoramento de E-mail)|Inbox Agent]]
- **Objetivo:** Monitorar respostas de recrutadores.
- **Fluxo:** Classifica e-mails (Rejeição, Entrevista, Teste Técnico) e atualiza o quadro Kanban automaticamente.
- **Localização:** `backend/agents/inbox_graph.py`

---
## Conceitos de Estudo
- [[Orquestração vs Reação]]
- [[🛠️ Segurança em Sistemas Agênticos]]