# 🧪 Estratégia de Testes Automatizados

Em sistemas de agentes de IA, testar é um desafio único porque as respostas da IA não são determinísticas (podem mudar um pouco a cada vez).

## 1. Testes Unitários (Backend - Pytest)
Localizados em `tests/unit/`, esses testes garantem que as "peças individuais" funcionam:
- **`test_resume_parser.py`:** Garante que o PDF é convertido corretamente em texto.
- **`test_schemas.py`:** Verifica se a validação do Pydantic está funcionando.
- **`test_config.py`:** Garante que o sistema não inicia se faltarem chaves de API cruciais.

## 2. Testes de Integração (Frontend - Vitest)
No frontend, o `Vitest` (um substituto moderno para o Jest) é usado para:
- Simular cliques em botões.
- Verificar se o quadro Kanban renderiza as vagas corretamente.
- Testar se o WebSocket reconecta se a internet cair.

## 3. Mocking e Fixtures
Como não queremos gastar dinheiro com créditos de LLM toda vez que rodamos um teste, o JumpShip usa **Mocks**.
- **Mocking:** O código finge que chamou o ChatGPT/Ollama e retorna uma resposta fixa pré-escrita. Isso garante que o teste seja rápido e gratuito.

## 4. Testes de Agentes (O maior desafio)
O sistema usa "Golden Datasets" (conjuntos de dados padrão). Rodamos o agente contra um currículo conhecido e uma vaga conhecida e verificamos se o Score final está dentro de uma margem esperada (ex: entre 80 e 90).

---
**Comando Útil:** `pytest --cov=backend` (Roda os testes e mostra quanto do código está protegido por testes).
