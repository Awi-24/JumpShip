# ⚖️ Matcher (Avaliação de Perfil)

O **Matcher Agent** é o filtro de qualidade do sistema. Ele decide se uma vaga vale o seu tempo ou não.

## Fluxo do Grafo (LangGraph)
O grafo do Matcher é simples e direto (Linear):
`[START] → score_job → [END]`

## Lógica de Pontuação
O agente não apenas "lê" a vaga. Ele executa uma função chamada `analyse_resume` em uma thread separada (`asyncio.to_thread`) para não travar o servidor.
1. **Inputs:** Currículo (Texto) + Descrição da Vaga + Perfil do Usuário.
2. **Output:** Um objeto `MatchResult` com:
    - **Score:** 0.0 a 100.0.
    - **Strengths:** O que você tem que a vaga pede.
    - **Gaps:** O que falta no seu perfil.
    - **Suggestions:** O que você deveria aprender ou mudar no currículo.

## Processamento em Lote (Batch Match)
Para ser eficiente, o JumpShip consegue processar várias vagas ao mesmo tempo.
- **Concurrency Control:** Usa um `asyncio.Semaphore(3)` para garantir que apenas 3 análises de IA rodem simultaneamente, evitando estourar o limite de tokens ou travar o computador do usuário (se usar Ollama local).

---
**Desafio de Clean Code:** O Matcher é um "wrapper" em volta de um serviço antigo (`ai_evaluator`). Isso permite que o código antigo seja usado no novo sistema de grafos sem precisar ser reescrito do zero.

**Referência:** `backend/agents/matcher_graph.py`