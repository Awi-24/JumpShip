# 📚 Biblioteca: LangGraph

Se o LangChain é uma "corrente", o **LangGraph** é um "mapa rodoviário" com rotas circulares.

## O que ela faz no JumpShip?
Ela orquestra o ciclo de vida de uma candidatura. Diferente de um script linear, ela permite que o agente:
1. **Decida:** "Preciso ajustar este currículo?" (Nó de Decisão).
2. **Execute:** Chama o Playwright (Nó de Ação).
3. **Pouse:** "Não sei responder esta pergunta, vou perguntar ao humano" (Breakpoint/HITL).

## Principais Métodos Utilizados:
- `StateGraph(AgentState)`: Define a estrutura do grafo.
- `add_node(name, func)`: Adiciona uma função que o agente pode executar.
- `add_edge(from, to)`: Conecta os passos.
- `compile(checkpointer=...)`: Transforma o desenho do grafo em um programa executável com memória persistente.

## Arquitetura de Estado
O `State` é um objeto único que viaja pelo grafo. No JumpShip, ele contém o histórico de mensagens e o progresso da aplicação atual.

---
**Referência no Código:** `backend/agents/apply_graph.py`