# 🐍 Python Moderno no JumpShip

O projeto utiliza recursos avançados do Python 3.10+ que são essenciais para sistemas de alta performance e agentes.

## 1. Programação Assíncrona (`asyncio`)
O JumpShip é pesadamente baseado em I/O (chamadas de API de LLM, scrapers, banco de dados).
- **Por que usar?** Permite que o servidor processe múltiplas requisições (como 10 scrapers rodando ao mesmo tempo) sem travar a CPU.
- **No código:** Procure por `async def` e `await`. O FastAPI gerencia o loop de eventos automaticamente.

## 2. Tipagem Estrita (`Type Hinting`)
O projeto usa `typing` para garantir que os dados que fluem entre agentes sejam previsíveis.
- **Exemplo:** `def process_job(job_id: str) -> JobResult:`.
- **Benefício:** Reduz bugs de "NoneType" e facilita o autocomplete no VS Code/PyCharm.

## 3. Validação com `Pydantic`
Quase todos os modelos em `backend/models/schemas.py` herdam de `BaseModel`.
- **Funcionalidade:** O Pydantic garante que, se o frontend enviar um e-mail inválido, o Python rejeite a requisição antes mesmo de processá-la.
- **Clean Code:** Mantém a validação de dados separada da lógica de negócio.

---
**Links de Estudo:**
- [[FastAPI + WebSockets]]
- [[Schemas e Modelos de Dados]]