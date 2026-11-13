<div align="center">

<img src="public/icon-192.png" alt="Kodi" width="96" height="96">

# Kodi &nbsp;<img src="https://img.shields.io/badge/vers%C3%A3o-v2.18.1-2bd27a?style=flat-square" alt="versão v2.18.1" align="top">

**Um chat com IA que é só seu.**
Cada pessoa com a própria chave, o próprio espaço e a conta só se quiser.

Projeto pessoal de **Felipe Simon**

[**Abrir o Kodi →**](https://kodi.simonhot-com.workers.dev/)

</div>

---

## O que é

O Kodi é um aplicativo web de conversas com IA, feito para ser usado por mim e pelos meus amigos. Cada pessoa usa a **própria chave gratuita da NVIDIA** (modelos Llama, DeepSeek, Qwen e outros) e tem o seu espaço, totalmente separado dos demais.

## Ideia central: privacidade por construção

- **A conta é opcional.** Sem entrar, tudo fica só no navegador (IndexedDB) e o servidor não tem banco de dados. Entrando (e-mail ou Google), as conversas e as preferências passam a ser salvas na nuvem, separadas por usuário, para abrir em qualquer aparelho.
- **A chave da NVIDIA nunca vai para a nuvem:** fica só no aparelho de quem a cadastrou.
- **Conexão direta com a NVIDIA** sempre que o navegador permitir. Quando não permite, uma função mínima só repassa a mensagem, sem gravar nada.
- **Backup e restauração** em arquivo, para levar as conversas para outro aparelho sem precisar de conta.

> Limite honesto: no modo de repasse a mensagem passa pelo servidor de hospedagem. O código não grava nem registra nada, mas quem hospeda poderia, em tese, alterá-lo. A garantia total só existe no modo direto.

## Recursos

- Interface escura inspirada nos apps de chat modernos, com histórico agrupado por data, busca, renomear e apagar
- Respostas em tempo real, markdown com tabelas e blocos de código com botão de copiar
- Mostra o raciocínio dos modelos que o expõem
- Seletor de modelos com logo e nome de cada IA, a um clique no topo da conversa
- **Mascote opcional:** um camaleão em pixel art que passeia, acompanha o que você digita e a resposta chegando, reage ao uso e ganha acessórios (vem desligado, ativa-se nas configurações)
- Funciona no celular e pode ser instalado como app (PWA)
- Aba **Claude Code** opcional, que só existe quando aberto no próprio computador de quem instala

## Tecnologias

<p>
  <img src="https://skillicons.dev/icons?i=html,css,js,nodejs,cloudflare,supabase,postgres,git,github" alt="Tecnologias do projeto">
</p>

## Estrutura

```
public/      o site (HTML, CSS, JS, mascote, ícones, manifesto)
worker.js    repasse e configuração na Cloudflare Workers
server.js    versão local em Node (inclui a aba Claude Code)
lib/         módulos da versão local
supabase/    esquema do banco das contas (com segurança por usuário)
```

---

Feito por **Felipe Simon** · [@simoonxp](https://github.com/simoonxp)
