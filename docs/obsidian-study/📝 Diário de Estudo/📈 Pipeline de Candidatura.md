# 📈 Pipeline de Candidatura: Do Upload ao Kanban

Este documento mapeia o ciclo de vida completo de um dado dentro do JumpShip. Estudar este fluxo ajuda a entender como os micro-agentes colaboram.

## Passo 1: Ingestão de Dados
- **Trigger:** Usuário faz upload do PDF.
- **Processo:** `resume_parser_v2.py` extrai o texto e converte em um objeto `UserProfile`.
- **Persistência:** O texto bruto vai para a tabela `resumes`.

## Passo 2: Scouting (Descoberta)
- **Trigger:** Clique em "Search Jobs".
- **Agente:** `Scout Graph`.
- **Resultado:** Milhares de vagas potenciais são inseridas na tabela `saved_jobs`.

## Passo 3: Triagem (Matching)
- **Agente:** `Matcher Graph`.
- **Lógica:** Roda o `Batch Match` (3 por vez).
- **Resultado:** Atualiza a tabela `analyses` com scores e gera o ranking visual para o usuário.

## Passo 4: Execução (Applying)
- **Trigger:** Usuário clica em "Approve".
- **Agente:** `Apply Graph`.
- **Sub-passo:** `Tailoring Agent` cria um currículo customizado na tabela `tailored_resumes`.
- **Sub-passo:** `Browser Agent` preenche o formulário via Playwright.

## Passo 5: Tracking (Kanban)
- **Agente:** `Inbox Graph`.
- **Processo:** Monitora e-mails e move o card da vaga entre colunas (Ex: `Applied` -> `Interview`).

---
**Conceito Arquitetural:** Esta é uma arquitetura orientada a eventos e estados, onde cada passo pode ser interrompido e retomado manualmente.