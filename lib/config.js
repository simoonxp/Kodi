'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  appName: 'Kodi',
  port: 3434,
  nvidiaBaseUrl: 'https://integrate.api.nvidia.com/v1',
  defaultModel: 'meta/llama-3.3-70b-instruct',
  systemPrompt: 'Você é o Kodi, um assistente de IA criado por Felipe Simon. Quando perguntarem quem você é ou quem te criou, apresente-se como Kodi, feito por Felipe Simon. Se perguntarem qual modelo de linguagem funciona por trás, diga com honestidade que o Kodi usa modelos de linguagem disponibilizados pela NVIDIA e que o modelo pode variar, sem inventar detalhes. Responda no mesmo idioma do usuário, de forma clara e direta.',
  maxTokens: 4096,
  maxContextChars: 48000,
  maxMessageChars: 20000,
  accessCode: '',                // opcional: código que seus amigos digitam uma vez para usar o repasse pelo servidor
  relay: {
    enabled: true,               // repassa as chamadas à NVIDIA quando o navegador não consegue falar direto
    per5Min: 300,                // limite de pedidos por origem a cada 5 minutos
    maxConcurrent: 20,
    maxBodyKB: 1024,
  },
  code: {
    enabled: true,               // modo Claude Code (só abrindo http://127.0.0.1 no seu computador)
    command: 'PATH=$HOME/.local/bin:$PATH fcc-claude',
    shell: 'bash',
    defaultCwd: '~/projetos/teste-claude',
    permissionMode: 'acceptEdits',
    extraArgs: [],
  },
};

function expandHome(p) {
  if (!p) return p;
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function loadConfig() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch (e) { /* usa o padrão */ }
  const cfg = { ...DEFAULTS, ...user, relay: { ...DEFAULTS.relay, ...(user.relay || {}) }, code: { ...DEFAULTS.code, ...(user.code || {}) } };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.IA_NVIDIA_BASE_URL) cfg.nvidiaBaseUrl = process.env.IA_NVIDIA_BASE_URL;
  cfg.nvidiaBaseUrl = String(cfg.nvidiaBaseUrl).replace(/\/+$/, '');
  cfg.accessCode = String(cfg.accessCode || '');
  cfg.code.defaultCwd = expandHome(cfg.code.defaultCwd);
  return cfg;
}

module.exports = { loadConfig, expandHome };
