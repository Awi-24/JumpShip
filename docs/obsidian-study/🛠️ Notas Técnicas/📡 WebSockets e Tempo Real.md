# 📡 WebSockets e Tempo Real

Diferente de uma API REST comum (onde você pede e o servidor responde), o JumpShip usa **WebSockets** para que o Agente possa "falar" com o usuário a qualquer momento.

## O `ConnectionManager`
Localizado em `backend/routers/agents_ws.py`, esta classe gerencia quem está conectado.
- **Broadcast:** Envia uma mensagem para todos os navegadores abertos (ex: "O agente começou a buscar vagas").
- **Send to:** Envia uma mensagem específica (ex: "Preciso que VOCÊ responda este captcha").

## Protocolo de Mensagens (JSON)

### Servidor → Cliente (Push de Status)
```json
{
  "type": "trace_event",
  "thread_id": "...",
  "event": { "step": "pensando", "content": "Analisando requisitos do LinkedIn..." }
}
```

### Cliente → Servidor (HITL Response)
```json
{
  "type": "hitl_response",
  "thread_id": "...",
  "response": "Minha pretensão salarial é R$ 10.000"
}
```

## Registro de Tarefas Ativas
O servidor mantém um dicionário `_active_tasks` que mapeia `thread_id` para uma `asyncio.Task`. 
- **Lição de Clean Code:** O projeto usa `task.add_done_callback` para garantir que a tarefa seja removida do dicionário assim que terminar, evitando vazamento de memória.

---
**Ponto de Estudo:** Por que usar WebSocket em vez de chamadas repetidas (Polling)?
- Resposta: Menor latência e economia de recursos, essencial para o recurso de **Human-in-the-Loop**.