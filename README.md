<div align="center">

<img src="public/icon-192.png" alt="Kodi" width="96" height="96">

# Kodi

**Um chat com IA que é só seu.**
Sem conta, sem login, sem ninguém olhando as suas conversas.

Projeto pessoal de **Felipe Simon**

</div>

---

## O que é

O Kodi é um aplicativo web de conversas com IA, feito para ser usado por mim e pelos meus amigos. Cada pessoa usa a **própria chave gratuita da NVIDIA** (modelos Llama, DeepSeek, Qwen e outros) e tem o seu espaço, totalmente separado dos demais.

## Ideia central: privacidade por construção

- **Não existem contas, senhas nem painel de administrador.** Quem hospeda não tem como ver nem controlar o que os outros fazem.
- **As conversas e a chave ficam só no navegador de cada pessoa** (IndexedDB). O servidor não tem banco de dados.
- **Conexão direta com a NVIDIA** sempre que o navegador permitir. Quando não permite, uma função mínima só repassa a mensagem, sem gravar nada.
- **Backup e restauração** em arquivo, para levar as conversas para outro aparelho.

> Limite honesto: no modo de repasse a mensagem passa pelo servidor de hospedagem. O código não grava nem registra nada, mas quem hospeda poderia, em tese, alterá-lo. A garantia total só existe no modo direto.

## Recursos

- Interface escura inspirada nos apps de chat modernos, com histórico agrupado por data, busca, renomear e apagar
- Respostas em tempo real, markdown com tabelas e blocos de código com botão de copiar
- Mostra o raciocínio dos modelos que o expõem
- Funciona no celular e pode ser instalado como app (PWA)
- Aba **Claude Code** opcional, que só existe quando aberto no próprio computador de quem instala

## Tecnologias

JavaScript puro (sem frameworks nem dependências), Node.js para a versão local, Cloudflare Pages e Pages Functions para a versão hospedada, IndexedDB para os dados e API compatível com OpenAI da NVIDIA.

## Estrutura

```
public/      o site (HTML, CSS, JS, ícones, manifesto)
functions/   repasse e configuração na Cloudflare Pages
server.js    versão local em Node (inclui a aba Claude Code)
lib/         módulos da versão local
```

---

Feito por **Felipe Simon** · [@simoonxp](https://github.com/simoonxp)
