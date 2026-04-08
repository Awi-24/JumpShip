# 🧬 LangGraph e Grafos de Estado

O coração da arquitetura v2 do JumpShip. Diferente de cadeias lineares, o LangGraph permite ciclos e persistência.

## Por que LangGraph no JumpShip?
1. **Recuperação de Erros:** Se uma aplicação de vaga falha no meio, o estado é salvo. O agente pode tentar novamente do ponto de falha.
2. **Human-in-the-Loop (HITL):** O grafo pode ter um nó de "breakpoint". O agente para, espera uma entrada do usuário no frontend, e continua.
3. **Memória Compartilhada:** O `State` (definido em `backend/agents/state.py`) circula entre todos os nós, garantindo que o Matcher saiba o que o Scout encontrou.

## Definição de Estado (Exemplo do Projeto)
O estado no JumpShip é um `TypedDict` que acumula mensagens e dados do job.

```python
# Referência: backend/agents/state.py
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    job_data: Dict[str, Any]
    user_profile: Dict[str, Any]
    needs_human_input: bool
```

---
**Referências de Código:**
- `backend/agents/scout_graph.py`
- `backend/agents/state.py`