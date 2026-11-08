# IA — seu app de conversas, cada pessoa no seu canal

## Como funciona (privacidade)
- **Não existe conta, login, convite nem painel de administrador.** Você não vê nada do que seus amigos fazem e não controla nada deles.
- A **chave da NVIDIA** e as **conversas** de cada pessoa ficam **só no navegador dela** (IndexedDB). O servidor não tem banco de dados nem grava arquivos de conversa.
- Cada pessoa usa a própria chave (o uso conta na conta dela na NVIDIA).
- Como o navegador fala com a NVIDIA:
  - **Direto** (melhor): o navegador conversa com a NVIDIA sem passar pelo seu servidor. Só funciona se a NVIDIA permitir chamadas de sites (CORS) — **não pude testar isso com a NVIDIA real**.
  - **Repasse** (plano B, automático): se o navegador for bloqueado, a mensagem passa pelo seu servidor só para ser encaminhada. O programa não grava nem registra conteúdo ou chave. Mas, honestamente: quem hospeda o servidor (você) *poderia* alterar o programa para espiar. A garantia total só existe no modo direto. Em Configurações cada pessoa vê qual modo está em uso.
- **Sem sincronização entre aparelhos**: trocar de aparelho ou limpar os dados do navegador apaga as conversas. Em Configurações há **Fazer backup / Restaurar** (o backup não inclui a chave). Instalar como app ajuda o navegador a não apagar os dados.

## Instalar (Ubuntu)
```
cd ~/Downloads && unzip ia-gui.zip -d ~/ia-gui && cd ~/ia-gui && chmod +x *.sh && ./instalar.sh
```
Abre em `http://127.0.0.1:3434`. Liga sozinho com o computador. Desinstalar: `./desinstalar.sh`.

## Aba "Claude Code" (só para você)
Aparece **apenas** quando você abre `http://127.0.0.1:3434` no seu próprio computador. Pelo link público ela não existe nem responde. Configure o comando e a pasta em `config.json` (bloco `code`).

## Passar para os amigos
Precisa de um link público para o seu computador (que fica ligado):
- Tailscale Funnel: `sudo tailscale funnel 3434` (veja `tailscale funnel --help` para rodar em segundo plano), ou
- Cloudflare Tunnel.
Os amigos abrem o link, colam a própria chave e usam. Para limitar quem usa o repasse, coloque um `"accessCode": "palavra"` no `config.json` e passe a palavra só a eles (é pedida uma vez).

## config.json
`appName`, `port`, `defaultModel`, `accessCode` (opcional), `code{...}`. Reinicie: `systemctl --user restart ia-gui`.
