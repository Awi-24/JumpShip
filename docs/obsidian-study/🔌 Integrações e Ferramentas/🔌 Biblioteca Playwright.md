# 🔌 Biblioteca: Playwright (Automação de Browser)

Diferente do Selenium, o **Playwright** é moderno, rápido e feito para a web de hoje.

## Uso no JumpShip
O agente usa o Playwright para simular um humano aplicando para vagas.
- **Headless Mode:** O navegador roda sem interface gráfica no servidor (mais rápido).
- **Interação Dinâmica:** Ele espera os elementos aparecerem (Auto-waiting), o que reduz falhas em sites lentos.

## Principais Métodos:
- `page.goto(url)`: Navega até a vaga.
- `page.fill(selector, value)`: Preenche campos de texto.
- `page.click(selector)`: Clica em botões de "Submit".
- `page.screenshot()`: Tira fotos do erro para o usuário ver o que aconteceu.

## Desafio de Estudo
Como o Playwright lida com **Shadow DOM** em sites como o LinkedIn? (O JumpShip v2 resolve isso injetando scripts JS customizados).

---
**Relacionado:** [[🚀 Apply (Execução e HITL)]]