#!/usr/bin/env bash
# Instala o app como serviço do seu usuário: liga sozinho com o computador e reinicia se cair.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale com:  sudo apt install nodejs"
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Seu Node.js é antigo ($(node -v)). O app precisa da versão 18 ou mais nova."
  exit 1
fi
NODE_BIN="$(command -v node)"
PORT="$(node -p "try{require('$DIR/config.json').port||3434}catch(e){3434}")"
URL="http://127.0.0.1:$PORT"

# ---- serviço (systemd do usuário) ----
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/ia-gui.service" <<EOF
[Unit]
Description=Kodi
After=network-online.target

[Service]
ExecStart=$NODE_BIN $DIR/server.js
WorkingDirectory=$DIR
Restart=always
RestartSec=3
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

if systemctl --user daemon-reload 2>/dev/null && systemctl --user enable ia-gui.service >/dev/null 2>&1; then
  systemctl --user restart ia-gui.service
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true   # liga mesmo sem você abrir a sessão
else
  echo "Não consegui usar o systemd do usuário. Para rodar na mão:  cd '$DIR' && node server.js"
  exit 1
fi

# ---- atalho no menu de aplicativos ----
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/ia-gui.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Kodi
Comment=Conversas com IA
Exec=xdg-open $URL
Icon=$DIR/public/icon-512.png
Terminal=false
Categories=Utility;
EOF

# ---- espera subir e abre ----
for _ in 1 2 3 4 5 6 7 8 9 10; do
  node -e "require('http').get('$URL/api/config',r=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null && break
  sleep 0.5
done

echo
echo "Pronto! O app está rodando em $URL"
echo "Este servidor não guarda contas, conversas nem chaves de ninguém."
xdg-open "$URL" >/dev/null 2>&1 || true
echo
echo "Ver o que o servidor está fazendo:  journalctl --user -u ia-gui -f"
