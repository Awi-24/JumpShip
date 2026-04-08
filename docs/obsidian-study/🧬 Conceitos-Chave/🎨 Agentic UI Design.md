# 🎨 Princípios de UI/UX para Agentes de IA

Designar interfaces para agentes é diferente de interfaces comuns. O JumpShip segue alguns princípios de **Agentic UI**:

## 1. Visibilidade do "Pensamento" (Streaming)
O usuário nunca deve ficar olhando para uma tela estática enquanto a IA trabalha.
- **Solução:** O WebSocket envia "trace events" que mostram o que o agente está fazendo em tempo real (ex: *"Lendo formulário do LinkedIn..."*).

## 2. Padrão Human-in-the-Loop (HITL)
A interface deve ser capaz de ser "sequestrada" pelo agente.
- **Mecanismo:** Se a IA trava, o frontend bloqueia a ação do agente e destaca visualmente o campo que precisa de intervenção humana.

## 3. Feedback de Confiança (Confidence Scores)
O Matcher Agent não diz apenas "Este job é bom". Ele mostra um **Score (0-100)**.
- **UX:** Cores são usadas para indicar o risco: Verde (Match Alto), Amarelo (Match Médio), Vermelho (Poucas chances).

---
**Status:** 🖌️ Design System em evolução.
**Bibliotecas Usadas:** Lucide-React (ícones), Tailwind CSS (estilização), Framer Motion (animações).
