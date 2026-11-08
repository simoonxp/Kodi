# Kodi

Conversas com IA (modelos da NVIDIA) em um espaço **pessoal**: cada pessoa usa a própria chave da NVIDIA, e as conversas e a chave ficam **só no navegador dela**. Não há contas, banco de dados nem painel de administrador. Feito por Felipe Simon.

## Publicar (GitHub + Cloudflare Pages)
1. Crie um repositório no GitHub e envie esta pasta:
   ```
   git init && git add . && git commit -m "Kodi"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/kodi.git
   git push -u origin main
   ```
2. Na Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** e escolha o repositório.
3. Configuração de build: **Framework: None**, **Build command: (vazio)**, **Build output directory: `public`**. A pasta `functions/` é detectada sozinha.
4. (Opcional) Em *Settings → Variables*: `ACCESS_CODE` (palavra que só seus amigos sabem, para usar o repasse), `DEFAULT_MODEL`.
5. O link fica `https://kodi.pages.dev` (ou o seu domínio em *Custom domains*).

## Como as mensagens viajam
- **Direto:** o navegador fala com a NVIDIA sem passar por ninguém (só funciona se a NVIDIA permitir chamadas de sites).
- **Repasse:** se for bloqueado, a mensagem passa pela função `functions/relay`, que só encaminha, sem gravar nada. Quem hospeda poderia, em tese, alterar o código; a garantia total é o modo direto.

## Rodar no seu computador (inclui a aba Claude Code)
`./instalar.sh` (Ubuntu, precisa de Node 18+). Copie `config.example.json` para `config.json` e ajuste. A aba Claude Code só aparece em `http://127.0.0.1:3434`, nunca na versão hospedada. Não suba o `config.json` para o GitHub (já está no `.gitignore`).
