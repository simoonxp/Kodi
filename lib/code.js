'use strict';
// Modo "Claude Code" (só admin, só no localhost): lê as sessões antigas do
// ~/.claude/projects e conversa pelo seu comando (fcc-claude).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { expandHome } = require('./config');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SAFE_NAME = /^[\w.\-]+$/;
const metaCache = new Map();

const blockText = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';

function isNoise(text) {
  const t = (text || '').trim();
  return !t || t.startsWith('<command-') || t.startsWith('<local-command') || t.startsWith('<system-reminder') ||
    t.startsWith('Caveat:') || t.startsWith('[Request interrupted');
}

function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    return buf.slice(0, fs.readSync(fd, buf, 0, bytes, 0)).toString('utf8');
  } finally { fs.closeSync(fd); }
}

function readMeta(file, mtime) {
  const c = metaCache.get(file);
  if (c && c.mtime === mtime) return c.meta;
  const meta = { title: null, cwd: null };
  let aiTitle = null;
  try {
    for (const line of readHead(file, 256 * 1024).split('\n')) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (!meta.cwd && e.cwd) meta.cwd = e.cwd;
      if (e.type === 'ai-title' && e.aiTitle) aiTitle = e.aiTitle;
      if (!meta.title && e.type === 'user' && !e.isMeta && !e.isSidechain && e.message) {
        const t = blockText(e.message.content);
        if (!isNoise(t)) meta.title = t.trim().replace(/\s+/g, ' ').slice(0, 90);
      }
    }
  } catch { /* ignora */ }
  if (aiTitle) meta.title = aiTitle;
  metaCache.set(file, { mtime, meta });
  return meta;
}

function listSessions() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return out; }
  for (const d of dirs) {
    let files;
    try { files = fs.readdirSync(path.join(PROJECTS_DIR, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(PROJECTS_DIR, d, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      const meta = readMeta(full, st.mtimeMs);
      if (meta.title) out.push({ id: f.slice(0, -6), project: d, cwd: meta.cwd, title: meta.title, mtime: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function getSession(project, id) {
  if (!SAFE_NAME.test(project) || !SAFE_NAME.test(id)) return null;
  let raw;
  try { raw = fs.readFileSync(path.join(PROJECTS_DIR, project, id + '.jsonl'), 'utf8'); } catch { return null; }
  const messages = [];
  let cwd = null, last = null;
  const asst = () => {
    if (!last || last.role !== 'assistant') { last = { role: 'assistant', blocks: [] }; messages.push(last); }
    return last.blocks;
  };
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.isSidechain || e.isMeta || !e.message) continue;
    if (e.type === 'user') {
      const c = e.message.content;
      if (typeof c === 'string') {
        if (isNoise(c)) continue;
        last = { role: 'user', blocks: [{ type: 'text', text: c }] }; messages.push(last);
      } else if (Array.isArray(c)) {
        for (const r of c.filter(b => b.type === 'tool_result')) {
          asst().push({ type: 'tool_result', tool_use_id: r.tool_use_id, is_error: !!r.is_error, text: blockText(r.content).slice(0, 4000) });
        }
        const t = blockText(c.filter(b => b.type === 'text'));
        if (!isNoise(t)) { last = { role: 'user', blocks: [{ type: 'text', text: t }] }; messages.push(last); }
      }
    } else if (e.type === 'assistant' && Array.isArray(e.message.content)) {
      for (const b of e.message.content) {
        if (b.type === 'text' && b.text && b.text.trim()) asst().push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use') asst().push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
      }
    }
  }
  return { id, project, cwd, messages };
}

function handleChat(req, res, body, cfg) {
  const c = cfg.code;
  const message = String(body.message || '');
  if (!message.trim()) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"Mensagem vazia."}'); }

  let cwd = expandHome(body.cwd) || c.defaultCwd;
  try { if (!fs.statSync(cwd).isDirectory()) cwd = c.defaultCwd; } catch { cwd = c.defaultCwd; }

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (c.permissionMode) args.push('--permission-mode', c.permissionMode);
  if (body.sessionId && SAFE_NAME.test(body.sessionId)) args.push('--resume', body.sessionId);
  args.push(...(c.extraArgs || []));

  const child = spawn(c.shell, ['-ic', `${c.command} "$@"`, 'ia-gui', ...args], {
    cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
  });
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });

  let finished = false, stderrTail = '', buf = '', gotJson = false;
  child.on('error', err => {
    finished = true;
    res.write(JSON.stringify({ type: 'gui_error', message: 'Não consegui iniciar o comando: ' + err.message }) + '\n');
    res.end();
  });
  child.stdin.on('error', () => {});
  child.stdin.end(message);
  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('{')) { gotJson = true; res.write(line + '\n'); }
    }
  });
  child.stderr.on('data', d => { stderrTail = (stderrTail + d.toString('utf8')).slice(-4000); });
  child.on('close', code => {
    if (finished) return;
    finished = true;
    const tail = buf.trim();
    if (tail.startsWith('{')) { gotJson = true; res.write(tail + '\n'); }
    if (code !== 0 || !gotJson) {
      const clean = stderrTail.split('\n').filter(l => !/definir grupo do processo|cannot set terminal process group|no job control|controle de trabalho/.test(l)).join('\n').trim();
      res.write(JSON.stringify({ type: 'gui_error', code, message: clean || `O comando terminou sem resposta (código ${code}).` }) + '\n');
    }
    res.end();
  });
  res.on('close', () => {
    if (!finished) { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* já saiu */ } } }
  });
}

module.exports = { listSessions, getSession, handleChat };
