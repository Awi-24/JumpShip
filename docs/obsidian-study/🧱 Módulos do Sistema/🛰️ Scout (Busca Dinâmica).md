# 🛰️ Scout (Busca Dinâmica)

Este módulo é responsável por transformar um currículo passivo em buscas ativas.

## Lógica Interna
O Scout não busca apenas o cargo que está no currículo. Ele usa o LLM para:
1. **Extrair Skills:** Identificar tecnologias-chave.
2. **Gerar Sinônimos:** Se o currículo diz "Frontend Engineer", ele busca por "React Developer", "Software Engineer Frontend", etc.
3. **Segmentar Localização:** Ajustar a busca conforme a preferência de Remote/Hybrid.

## Integração Técnica
O Scout utiliza a biblioteca `jobspy` para agregar resultados de:
- LinkedIn
- Indeed
- Glassdoor
- ZipRecruiter

---
**Próximos passos de estudo:**
- Analisar como o LLM formata a query em `backend/agents/scout_graph.py`.