// Na versão hospedada nunca existe o modo Claude Code (ele só roda no computador de quem instala).
export function onRequestGet() {
  return Response.json({ code: false }, { headers: { 'Cache-Control': 'no-store' } });
}
