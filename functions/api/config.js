// Configuração pública do app (nada de pessoal). Variáveis opcionais no painel da Cloudflare: ACCESS_CODE, NVIDIA_BASE_URL, DEFAULT_MODEL.
export function onRequestGet({ env }) {
  return Response.json({
    appName: 'Kodi',
    defaultModel: env.DEFAULT_MODEL || 'meta/llama-3.3-70b-instruct',
    systemPrompt: 'Você é um assistente prestativo. Responda no mesmo idioma do usuário, de forma clara e direta.',
    maxTokens: 4096, maxContextChars: 48000, maxMessageChars: 20000,
    nvidiaBaseUrl: 'https://integrate.api.nvidia.com/v1',
    relayEnabled: env.RELAY_DISABLED !== '1',
    accessRequired: !!env.ACCESS_CODE,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
