# 📐 Princípios de Clean Code no JumpShip

O projeto segue padrões para garantir que o sistema de agentes não se torne um "caos espaguete".

## 1. Separation of Concerns (SoC)
- **Routers:** (`backend/routers/`) Cuidam apenas da entrada e saída HTTP/WebSocket.
- **Services:** (`backend/services/`) Contêm a lógica de negócio pura (cálculo de scores, parsing de PDF).
- **Agents:** (`backend/agents/`) Gerenciam o fluxo de decisão da IA.

## 2. Schemas vs Models
O JumpShip faz uma distinção clara entre:
- **Models (`db_models.py`):** Como os dados aparecem no banco de dados (SQLAlchemy).
- **Schemas (`schemas.py`):** Como os dados aparecem para o usuário/frontend (Pydantic).
- *Nunca exponha seu modelo de banco de dados diretamente na API!*

## 3. Injeção de Dependência
O FastAPI permite injetar o banco de dados (`get_db`) ou configurações (`get_settings`) em qualquer função. Isso facilita muito a criação de **Testes Unitários**.

## 4. Tratamento de Erros Assíncronos
Uso de `try...except` dentro de loops de eventos para garantir que a falha em uma candidatura não derrube todo o servidor.

---
**Status:** 🎓 Lição Prática: Tente encontrar uma função em `backend/services/` que tenha mais de 50 linhas. Se encontrar, ela é candidata a refatoração!