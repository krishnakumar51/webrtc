import { NextApiRequest, NextApiResponse } from 'next';

interface NgrokEndpoint {
  name?: string;
  url?: string;
  public_url?: string;
  endpoint_url?: string;
}

interface NgrokTunnel {
  name?: string;
  public_url?: string;
  url?: string;
}

interface NgrokResponse {
  endpoints?: NgrokEndpoint[];
  tunnels?: NgrokTunnel[];
  [key: string]: any;
}

async function fetchWithTimeout(url: string, timeoutMs = 3000, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { signal: controller.signal, ...(init || {}) });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function extractHttpsFromObj(obj: any): string | null {
  if (typeof obj === 'string' && obj.startsWith('https://')) {
    return obj;
  }
  if (typeof obj === 'object' && obj !== null) {
    for (const value of Object.values(obj)) {
      const result = extractHttpsFromObj(value);
      if (result) return result;
    }
  }
  return null;
}

function nameMatches(name: string | undefined, patterns: string[]): boolean {
  if (!name) return false;
  return patterns.some(pattern => new RegExp(pattern, 'i').test(name));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Be resilient to build-time env inlining: default to enabling ngrok unless explicitly disabled
  const useNgrokEnv = (process.env.NEXT_PUBLIC_USE_NGROK ?? process.env.USE_NGROK ?? 'true').toString().toLowerCase();
  const allowNgrok = useNgrokEnv !== 'false';
  
  // Always prepare sane fallbacks
  let baseUrl = process.env.NEXT_PUBLIC_NGROK_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  let signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL || 'http://localhost:8000';

  console.log('[ngrok-status] allowNgrok =', allowNgrok, 'env(NEXT_PUBLIC_USE_NGROK)=', process.env.NEXT_PUBLIC_USE_NGROK, 'env(USE_NGROK)=', process.env.USE_NGROK);

  // If explicitly disabled, return immediately with fallbacks
  if (!allowNgrok) {
    console.log('[ngrok-status] Ngrok explicitly disabled via env, returning fallbacks');
    return res.status(200).json({ baseUrl, signalingUrl });
  }

  const ngrokApiBases = [
    'http://ngrok:4040',
    'http://localhost:4040',
    'http://127.0.0.1:4040'
  ];

  for (const base of ngrokApiBases) {
    try {
      const apiUrl = `${base}/api/tunnels`;
      console.log('[ngrok-status] Trying', apiUrl);
      const response = await fetchWithTimeout(apiUrl, 5000, { headers: { 'Accept': 'application/json' } });
      
      if (!response.ok) {
        console.warn('[ngrok-status] Non-OK response', response.status, 'from', apiUrl);
        continue;
      }

      const data: NgrokResponse = await response.json();
      console.log('[ngrok-status] Got keys from API:', Object.keys(data));

      // Try ngrok v3 endpoints first
      if (data.endpoints && Array.isArray(data.endpoints)) {
        const frontendEndpoint = data.endpoints.find(ep => 
          nameMatches(ep.name, ['front', 'web']) && 
          (ep.url?.startsWith('https://') || ep.endpoint_url?.startsWith('https://'))
        );
        const backendEndpoint = data.endpoints.find(ep => 
          nameMatches(ep.name, ['api', 'backend', 'webrtc', 'server']) && 
          (ep.url?.startsWith('https://') || ep.endpoint_url?.startsWith('https://'))
        );

        if (frontendEndpoint) {
          const feUrl = frontendEndpoint.url || frontendEndpoint.endpoint_url;
          if (feUrl?.startsWith('https://')) {
            baseUrl = feUrl;
          }
        }
        if (backendEndpoint) {
          const beUrl = backendEndpoint.url || backendEndpoint.endpoint_url;
          if (beUrl?.startsWith('https://')) {
            signalingUrl = beUrl;
          }
        }
      }
      // Try ngrok v2 tunnels
      else if (data.tunnels && Array.isArray(data.tunnels)) {
        console.log('[ngrok-status] Processing tunnels:', data.tunnels.map(t => ({ name: t.name, url: t.public_url })));
        
        const frontendTunnel = data.tunnels.find(tunnel => 
          nameMatches(tunnel.name, ['front', 'web']) && tunnel.public_url?.startsWith('https://')
        );
        const backendTunnel = data.tunnels.find(tunnel => 
          nameMatches(tunnel.name, ['api', 'backend', 'webrtc', 'server']) && tunnel.public_url?.startsWith('https://')
        );

        console.log('[ngrok-status] Frontend tunnel:', frontendTunnel?.name, frontendTunnel?.public_url);
        console.log('[ngrok-status] Backend tunnel:', backendTunnel?.name, backendTunnel?.public_url);

        if (frontendTunnel?.public_url) {
          baseUrl = frontendTunnel.public_url;
        }
        if (backendTunnel?.public_url) {
          signalingUrl = backendTunnel.public_url;
        }
      }
      // Fallback: find any HTTPS URL
      else {
        const anyHttps = extractHttpsFromObj(data);
        if (anyHttps) {
          baseUrl = anyHttps;
        }
      }

      // If we found HTTPS URLs, break out of the loop
      if (baseUrl.startsWith('https://') || signalingUrl.startsWith('https://')) {
        console.log('[ngrok-status] Using discovered URLs:', { baseUrl, signalingUrl });
        break;
      }
    } catch (error) {
      console.warn('[ngrok-status] Error querying ngrok API base, continuing:', error);
      continue;
    }
  }

  return res.status(200).json({ baseUrl, signalingUrl });
}