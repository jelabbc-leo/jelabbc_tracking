/**
 * HTTP Fetcher — Extraccion de coordenadas GPS via llamadas HTTP directas
 *
 * Reemplaza a Puppeteer para produccion. En lugar de abrir un navegador y
 * renderizar la pagina, hace las llamadas HTTP directas a las APIs internas
 * de cada plataforma GPS.
 *
 * Plataformas soportadas:
 *   - Micodus:  POST a GetTrackingForShareStatic con access_token
 *   - GPSWox:   GET de pagina + parse de links Google Maps (futuro)
 *   - Traccar:  REST API /api/positions (futuro)
 *   - Generico: GET HTML + parse con coord-detector (fallback)
 *
 * Cada fetcher devuelve un array estandarizado de coordenadas:
 *   [{ lat, lng, speed, heading, timestamp, source, raw }]
 */

'use strict';

const axios = require('axios');
const coordDetector = require('./coord-detector');

const LOG_PREFIX = '[HttpFetcher]';

// ---------------------------------------------------------------------------
// Deteccion de plataforma por URL
// ---------------------------------------------------------------------------

/**
 * Detecta la plataforma GPS a partir de la URL del share link.
 * @param {string} url
 * @returns {'micodus'|'gpswox'|'traccar'|'generic'}
 */
function detectPlatform(url) {
  if (!url) return 'generic';
  const lower = url.toLowerCase();

  if (lower.includes('micodus.net') || lower.includes('mtrackone')) return 'micodus';
  if (lower.includes('gpswox.com') || lower.includes('gpswox')) return 'gpswox';
  if (lower.includes('traccar.org') || lower.includes('traccar')) return 'traccar';

  return 'generic';
}

// ---------------------------------------------------------------------------
// Fetcher principal
// ---------------------------------------------------------------------------

/**
 * Extrae coordenadas de una URL de share link GPS usando HTTP directo.
 *
 * @param {string} shareUrl - URL del share link (cuenta espejo)
 * @param {object} [options]
 * @param {number} [options.timeoutMs=15000] - Timeout para cada request
 * @returns {Promise<{coords: Array, platform: string, source: string, raw?: any}>}
 */
async function fetch(shareUrl, options = {}) {
  const platform = detectPlatform(shareUrl);
  const timeoutMs = options.timeoutMs || 15000;

  log('info', `Plataforma detectada: ${platform} para URL: ${_truncate(shareUrl, 80)}`);

  try {
    switch (platform) {
      case 'micodus':
        return await _fetchMicodus(shareUrl, timeoutMs);
      case 'gpswox':
        return await _fetchGpswox(shareUrl, timeoutMs);
      case 'traccar':
        return await _fetchTraccar(shareUrl, timeoutMs);
      default:
        return await _fetchGeneric(shareUrl, timeoutMs);
    }
  } catch (err) {
    log('error', `Error en fetcher ${platform}: ${err.message}`);
    return { coords: [], platform, source: 'http', error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Micodus — Fetcher principal (probado y validado)
// ---------------------------------------------------------------------------

/**
 * Extrae coordenadas de Micodus via su API AJAX interna.
 *
 * Flujo:
 *  1. Extraer access_token de la URL del share link
 *  2. GET la pagina para establecer cookies de sesion
 *  3. POST a GetTrackingForShareStatic con las cookies
 *  4. Parsear la respuesta JSON → coordenadas
 *
 * Formato de respuesta Micodus:
 *   { "d": "{\"lat\":\"20.60814\",\"lng\":\"-103.49088\",\"speed\":\"0.00\",...}" }
 *   o directamente:
 *   { "lat":"20.60814", "lng":"-103.49088", "speed":"0.00", ... }
 *
 * @private
 */
async function _fetchMicodus(shareUrl, timeoutMs) {
  // 1. Extraer access_token de la URL
  const urlObj = new URL(shareUrl);
  const accessToken = urlObj.searchParams.get('access_token');

  if (!accessToken) {
    throw new Error('No se encontro access_token en la URL de Micodus');
  }

  log('info', `Micodus: access_token=${accessToken.substring(0, 8)}...`);

  // Base URL de Micodus
  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
  const ajaxUrl = `${baseUrl}/ajax/DevicesAjax.asmx/GetTrackingForShareStatic`;

  // 2. Primero GET la pagina para obtener cookies de sesion
  let cookies = '';
  try {
    const pageRes = await axios.get(shareUrl, {
      timeout: timeoutMs,
      headers: _browserHeaders(),
      maxRedirects: 5,
      validateStatus: () => true,
    });

    // Capturar Set-Cookie headers
    const setCookies = pageRes.headers['set-cookie'];
    if (setCookies) {
      cookies = (Array.isArray(setCookies) ? setCookies : [setCookies])
        .map(c => c.split(';')[0])
        .join('; ');
    }

    log('info', `Micodus: pagina cargada (status ${pageRes.status}), cookies: ${cookies ? 'si' : 'no'}`);
  } catch (err) {
    log('warn', `Micodus: no se pudo cargar pagina (${err.message}), intentando AJAX directo`);
  }

  // 3. POST al endpoint AJAX con varias estrategias de body
  const bodies = [
    { access_token: accessToken, s: '1' },
    { access_token: accessToken },
    {},
  ];

  let responseData = null;

  for (const body of bodies) {
    try {
      const res = await axios.post(ajaxUrl, JSON.stringify(body), {
        timeout: timeoutMs,
        headers: {
          ..._browserHeaders(),
          'Content-Type': 'application/json; charset=utf-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': shareUrl,
          ...(cookies ? { 'Cookie': cookies } : {}),
        },
        validateStatus: (s) => s < 500,
      });

      if (res.status === 200 && res.data) {
        responseData = res.data;
        log('info', `Micodus: AJAX respondio OK con body #${bodies.indexOf(body) + 1}`);
        break;
      }
    } catch (err) {
      log('warn', `Micodus: AJAX fallo con body #${bodies.indexOf(body) + 1}: ${err.message}`);
    }
  }

  if (!responseData) {
    throw new Error('Micodus: ninguna variante de request funciono');
  }

  // 4. Parsear la respuesta
  const coords = _parseMicodusResponse(responseData);

  log('info', `Micodus: ${coords.length} coordenadas extraidas`);

  return {
    coords,
    platform: 'micodus',
    source: 'http_micodus',
    raw: responseData,
  };
}

/**
 * Parsea la respuesta de Micodus que puede venir en varios formatos:
 *   - { d: '{"lat":"20.60814",...}' }   (ASMX wrapper con string JSON)
 *   - { d: { lat: "20.60814", ... } }   (ASMX wrapper con objeto)
 *   - { lat: "20.60814", ... }            (objeto directo)
 *   - [{ lat: "20.60814", ... }, ...]     (array de dispositivos)
 * @private
 */
function _parseMicodusResponse(data) {
  const coords = [];

  // Desenwrapper ASMX "d" si existe
  let payload = data;
  if (data && data.d !== undefined) {
    payload = data.d;
  }

  // Si es string, intentar parsear como JSON
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      // Intentar extraer de texto con coord-detector
      const found = coordDetector.detectFromText(payload);
      for (const c of found) {
        c.source = 'http_micodus';
        coords.push(c);
      }
      return coords;
    }
  }

  // Si es array, procesar cada elemento
  const items = Array.isArray(payload) ? payload : [payload];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    const lat = parseFloat(item.lat || item.latitude || item.Lat || item.LAT);
    const lng = parseFloat(item.lng || item.lon || item.longitude || item.Lng || item.LON);

    if (isNaN(lat) || isNaN(lng)) continue;
    if (!coordDetector.isValidPair(lat, lng)) continue;

    const coord = {
      lat,
      lng,
      source: 'http_micodus',
    };

    // Metadatos opcionales
    if (item.speed !== undefined) coord.speed = parseFloat(item.speed);
    if (item.course !== undefined) coord.heading = parseFloat(item.course);
    if (item.positionTime) coord.timestamp = item.positionTime;
    if (item.isStop !== undefined) coord.isStop = String(item.isStop) === '1' || item.isStop === true;
    if (item.battery !== undefined) coord.battery = parseFloat(item.battery);
    if (item.signal !== undefined) coord.signal = parseInt(item.signal);
    if (item.satellite !== undefined) coord.satellites = parseInt(item.satellite);

    coords.push(coord);
  }

  return coords;
}

// ---------------------------------------------------------------------------
// GPSWox — Fetcher (fase futura, estructura lista)
// ---------------------------------------------------------------------------

/**
 * Extrae coordenadas de GPSWox.
 * GPSWox expone coords en el HTML via links de Google Maps.
 * @private
 */
async function _fetchGpswox(shareUrl, timeoutMs) {
  log('info', 'GPSWox: descargando pagina HTML...');

  const res = await axios.get(shareUrl, {
    timeout: timeoutMs,
    headers: _browserHeaders(),
    maxRedirects: 5,
  });

  const html = typeof res.data === 'string' ? res.data : '';
  const coords = [];

  // Estrategia 1: Buscar links Google Maps con q=LAT,LNG
  const mapLinkRe = /maps\.google\.com\/maps\?q=(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/gi;
  let match;
  while ((match = mapLinkRe.exec(html)) !== null) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (coordDetector.isValidPair(lat, lng)) {
      coords.push({ lat, lng, source: 'http_gpswox' });
    }
  }

  // Estrategia 2: Buscar con coord-detector en el HTML completo
  if (coords.length === 0) {
    const found = coordDetector.detectFromText(html);
    for (const c of found) {
      c.source = 'http_gpswox';
      coords.push(c);
    }
  }

  log('info', `GPSWox: ${coords.length} coordenadas extraidas`);

  return {
    coords,
    platform: 'gpswox',
    source: 'http_gpswox',
  };
}

// ---------------------------------------------------------------------------
// Traccar — Fetcher (fase futura, estructura lista)
// ---------------------------------------------------------------------------

/**
 * Extrae coordenadas de Traccar via REST API.
 * @private
 */
async function _fetchTraccar(shareUrl, timeoutMs) {
  log('info', 'Traccar: aun no implementado, usando fallback generico');
  return _fetchGeneric(shareUrl, timeoutMs);
}

// ---------------------------------------------------------------------------
// Generico — Fallback para plataformas no reconocidas
// ---------------------------------------------------------------------------

/**
 * Descarga el HTML de la pagina y extrae coordenadas con coord-detector.
 * Funciona como fallback cuando la plataforma no tiene un fetcher dedicado.
 * @private
 */
async function _fetchGeneric(shareUrl, timeoutMs) {
  log('info', 'Generico: descargando pagina...');

  const res = await axios.get(shareUrl, {
    timeout: timeoutMs,
    headers: _browserHeaders(),
    maxRedirects: 5,
    validateStatus: () => true,
  });

  const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  const coords = [];

  // Buscar links Google Maps
  const mapLinkRe = /maps\.google\.com\/maps\?q=(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/gi;
  let match;
  while ((match = mapLinkRe.exec(html)) !== null) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (coordDetector.isValidPair(lat, lng)) {
      coords.push({ lat, lng, source: 'http_generic' });
    }
  }

  // Buscar JSON embebido en scripts
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptRe.exec(html)) !== null) {
    const scriptContent = scriptMatch[1];
    if (scriptContent.length > 20 && scriptContent.length < 100000) {
      const found = coordDetector.detectFromText(scriptContent);
      for (const c of found) {
        c.source = 'http_generic_script';
        coords.push(c);
      }
    }
  }

  // Fallback: coord-detector en el HTML completo (limitado)
  if (coords.length === 0) {
    const found = coordDetector.detectFromText(html.substring(0, 200000));
    for (const c of found) {
      c.source = 'http_generic';
      coords.push(c);
    }
  }

  // Deduplicar
  const deduped = _dedup(coords);

  log('info', `Generico: ${deduped.length} coordenadas extraidas`);

  return {
    coords: deduped,
    platform: 'generic',
    source: 'http_generic',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Headers HTTP que simulan un navegador real.
 * @private
 */
function _browserHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
  };
}

/**
 * Deduplicar coordenadas por lat/lng.
 * @private
 */
function _dedup(coords) {
  const seen = new Set();
  return coords.filter(c => {
    const key = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Truncar string para logs.
 * @private
 */
function _truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.substring(0, max - 3) + '...';
}

/**
 * Log con prefijo.
 * @private
 */
function log(level, ...args) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(LOG_PREFIX, ...args);
}

// ---------------------------------------------------------------------------
// Exportaciones
// ---------------------------------------------------------------------------

module.exports = {
  fetch,
  detectPlatform,
};
