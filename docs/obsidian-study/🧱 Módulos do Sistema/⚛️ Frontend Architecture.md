# ⚛️ Frontend Architecture: React + Vite

O frontend do JumpShip foi desenhado para ser uma **Single Page Application (SPA)** de alta reatividade, capaz de lidar com fluxos de dados constantes vindos dos agentes.

## Stack Tecnológico
- **React 19:** A última versão do React, focada em performance e novos hooks.
- **Vite:** O build tool ultrarrápido que substitui o antigo Create React App.
- **TypeScript:** Garante que as interfaces de dados (Jobs, Resumes) sejam consistentes entre o front e o back.

## Gerenciamento de Estado
O projeto evita o uso de Redux (que é complexo) em favor de:
1. **React Query (TanStack Query):** Gerencia todo o estado que vem do servidor (cache de jobs, listas de candidaturas). Ele cuida automaticamente de refetching e loading states.
2. **Custom Hooks:** Toda a lógica de WebSocket e chamadas de API está encapsulada em hooks (em `frontend/src/hooks/`), mantendo os componentes visuais limpos.

## Interface do Kanban (`dnd-kit`)
O quadro onde você move as vagas entre "Applied" e "Interview" usa a biblioteca `@dnd-kit`.
- **Por que dnd-kit?** Ela é modular, acessível e permite animações suaves via **Framer Motion**.

---
**Ponto de Estudo:** Como o React lida com o "Human-in-the-Loop"?
- Quando o WebSocket recebe um `hitl_needed`, o frontend renderiza condicionalmente um modal ou campo de input para que o usuário responda à IA sem sair da página.

**Ver também:** [[📡 WebSockets e Tempo Real]]
