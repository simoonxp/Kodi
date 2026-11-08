# Publicar e rodar o Kodi

## Cloudflare Pages

1. Em **Workers & Pages → Create → Pages → Connect to Git**, escolha este repositório.
2. Framework: *None* · Build command: *(vazio)* · Build output directory: `public`.
3. Opcional, em *Settings → Variables*: `ACCESS_CODE` (palavra para limitar o uso do repasse) e `DEFAULT_MODEL`.

## Rodar no computador

```bash
cp config.example.json config.json   # ajuste se quiser
./instalar.sh                        # Ubuntu, Node 18+
```

Abre em `http://127.0.0.1:3434`.

