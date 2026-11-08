# Publicar e rodar o Kodi

## Cloudflare (Workers com arquivos estáticos)
1. Workers & Pages → Create → conectar ao GitHub → repositório `Kodi`.
2. Build command: vazio · Deploy command: `npx wrangler deploy` (usa o `wrangler.jsonc` do repositório).
3. Opcional, em Settings → Variables: `ACCESS_CODE` (limita o uso do repasse) e `DEFAULT_MODEL`.

## Rodar no computador (inclui a aba Claude Code)
```bash
cp config.example.json config.json
./instalar.sh        # Ubuntu, Node 18+
```
Abre em `http://127.0.0.1:3434`.
