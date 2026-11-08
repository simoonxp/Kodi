#!/usr/bin/env bash
# Desliga e remove o serviço. NÃO apaga as contas e conversas (ficam em ~/.local/share/ia-gui).
systemctl --user disable --now ia-gui.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/ia-gui.service" "$HOME/.local/share/applications/ia-gui.desktop"
systemctl --user daemon-reload 2>/dev/null || true
echo "Serviço removido. Seus dados continuam em ~/.local/share/ia-gui (apague essa pasta se quiser começar do zero)."
