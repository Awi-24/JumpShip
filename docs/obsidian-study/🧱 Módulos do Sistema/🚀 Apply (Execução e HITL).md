# 🚀 Módulo: Apply Graph (O Coração da Execução)

O `Apply Graph` é onde a "mágica" da IA encontra a automação real de navegadores.

## Arquitetura Interna
Este grafo é composto por sub-agentes:
1. **Tailoring Agent:** Lê a descrição da vaga e o currículo original. Ele usa o LLM para reescrever pontos de experiência para dar "match" com as palavras-chave da vaga.
2. **Browser Agent (Playwright):** Abre um navegador real (Chromium) e tenta preencher os campos do formulário (Nome, LinkedIn, Upload de PDF).

## Human-in-the-Loop (HITL)
Este é o conceito mais avançado do projeto. 
- Quando o `Browser Agent` encontra um campo que não sabe preencher (ex: "Qual sua pretensão salarial?"), ele envia um sinal de `interrupt`.
- O estado do agente é salvo no banco de dados.
- O usuário responde via interface.
- O agente "acorda", lê a resposta e continua exatamente de onde parou.

## Clean Code no Apply Graph
- **Separação de Preocupações:** A lógica de "o que escrever" (LLM) é separada da lógica de "onde clicar" (Playwright).
- **Idempotência:** O agente deve ser capaz de rodar novamente sem duplicar a candidatura se falhar no meio.

---
**Arquivo Principal:** `backend/agents/apply_graph.py`
**Ver também:** [[Human-in-the-Loop (HITL)]]