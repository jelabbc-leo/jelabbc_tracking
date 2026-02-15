/**
 * Extractor - 3 estrategias de extraccion universal de coordenadas GPS
 *
 * Estrategia 1: Intercepcion de red (XHR / Fetch / WebSocket)
 *   - Intercepta responses HTTP que contienen coordenadas
 *   - Mayor confiabilidad ya que captura datos limpios del API
 *
 * Estrategia 2: JS Globals (variables globales del navegador)
 *   - Busca en window.* instancias de mapa, arrays de posiciones, etc.
 *   - Util para plataformas que cargan datos en memoria
 *
 * Estrategia 3: DOM Scraping (texto visible en la pagina)
 *   - Parsea el contenido visible buscando patrones de coordenadas
 *   - Fallback cuando las otras estrategias no funcionan
 *
 * Cada estrategia devuelve un array de coordenadas detectadas.
 * El coordinator decide cual usar y combina los resultados.
 */

'use strict';

const coordDetector = require('./coord-detector');

const LOG_PREFIX = '[Extractor]';

// ---------------------------------------------------------------------------
// Tiempos de espera
// ---------------------------------------------------------------------------
const NETWORK_WAIT_MS = 12000;     // Tiempo para capturar trafico de red
const JS_EVAL_TIMEOUT_MS = 5000;   // Timeout para evaluacion de JS globals
const DOM_WAIT_MS = 3000;          // Espera adicional para carga de DOM

// ---------------------------------------------------------------------------
// Estrategia 1: Intercepcion de red
// ---------------------------------------------------------------------------

/**
 * Intercepta el trafico de red de una pagina buscando coordenadas.
 * Captura XHR, Fetch y WebSocket que contengan datos GPS.
 *
 * @param {import('puppeteer').Page} page - Pagina de Puppeteer
 * @param {object} [options]
 * @param {number} [options.waitMs=12000] - Tiempo de espera para capturar trafico
 * @param {string[]} [options.urlFilters] - Patrones de URL a filtrar (solo capturar estos)
 * @returns {Promise<{coords: Array, rawResponses: number, source: string}>}
 */
async function extractFromNetwork(page, options = {}) {
  const waitMs = options.waitMs || NETWORK_WAIT_MS;
  const urlFilters = options.urlFilters || [];
  const coords = [];
  const capturedResponses = [];

  log('info', 'Iniciando intercepcion de red...');

  // Configurar intercepcion de responses
  const responseHandler = async (response) => {
    try {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Filtrar solo respuestas JSON o texto
      if (!contentType.includes('json') && !contentType.includes('text') && !contentType.includes('javascript')) {
        return;
      }

      // Si hay filtros de URL, solo capturar los que coincidan
      if (urlFilters.length > 0) {
        const matches = urlFilters.some(filter => url.toLowerCase().includes(filter.toLowerCase()));
        if (!matches) return;
      }

      // Ignorar recursos estaticos comunes
      if (/\.(css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico)(\?|$)/i.test(url)) return;

      const status = response.status();
      if (status < 200 || status >= 300) return;

      const text = await response.text().catch(() => null);
      if (!text || text.length < 10) return;

      capturedResponses.push({ url, text });

      // Intentar parsear como JSON
      let jsonData = null;
      try {
        jsonData = JSON.parse(text);
      } catch {
        // No es JSON puro, intentar extraer de texto
      }

      // Detectar coordenadas
      let found = [];
      if (jsonData) {
        found = coordDetector.detectFromObject(jsonData);
      }
      if (found.length === 0) {
        found = coordDetector.detectFromText(text);
      }

      if (found.length > 0) {
        const urlPatterns = ['GetTrackingForShareStatic', 'positions', 'devices', 'locations'];
        const matchedPattern = urlPatterns.find(p => url.indexOf(p) !== -1);
        const patternLog = matchedPattern ? ` (URL pattern: ${matchedPattern})` : '';
        log('info', `Red: ${found.length} coords en ${_truncateUrl(url)}${patternLog}`);
        for (const c of found) {
          c.source = 'network';
          c.sourceUrl = url;
          coords.push(c);
        }
      }
    } catch {
      // Ignorar errores de respuestas individuales
    }
  };

  page.on('response', responseHandler);

  try {
    // Esperar a que llegue trafico
    await _sleep(waitMs);

    // Intentar forzar una recarga de datos (scroll, click en mapa, etc.)
    await _triggerDataRefresh(page);
    await _sleep(3000);
  } finally {
    page.off('response', responseHandler);
  }

  log('info', `Red: ${capturedResponses.length} responses capturadas, ${coords.length} coords encontradas`);

  return {
    coords: _deduplicateCoords(coords),
    rawResponses: capturedResponses.length,
    source: 'network',
  };
}

// ---------------------------------------------------------------------------
// Estrategia 2: JS Globals
// ---------------------------------------------------------------------------

/**
 * Busca coordenadas en variables globales del navegador.
 * Examina objetos window.* comunes en plataformas GPS:
 *  - Instancias de Google Maps, Leaflet, OpenLayers
 *  - Arrays/objetos con propiedades lat/lng
 *  - Variables globales con datos de posicion
 *
 * @param {import('puppeteer').Page} page - Pagina de Puppeteer
 * @returns {Promise<{coords: Array, globalsChecked: number, source: string}>}
 */
async function extractFromGlobals(page, options = {}) {
  log('info', 'Buscando coordenadas en JS globals...');

  let result;
  try {
    result = await page.evaluate(() => {
      const coords = [];
      const checked = [];

      // ---------------------------------------------------------------
      // Helper: extraer coords de un objeto recursivamente
      // ---------------------------------------------------------------
      function extract(obj, depth, path) {
        if (depth <= 0 || !obj || typeof obj !== 'object') return;
        if (coords.length > 200) return; // Limite de seguridad

        // Array
        if (Array.isArray(obj)) {
          if (obj.length === 2 && typeof obj[0] === 'number' && typeof obj[1] === 'number') {
            const [a, b] = obj;
            if (a >= -90 && a <= 90 && b >= -180 && b <= 180 && (Math.abs(a) > 0.01 || Math.abs(b) > 0.01)) {
              coords.push({ lat: a, lng: b, source: 'globals', path });
            }
          }
          for (let i = 0; i < Math.min(obj.length, 100); i++) {
            extract(obj[i], depth - 1, path + `[${i}]`);
          }
          return;
        }

        // Objeto con lat/lng
        const latKeys = ['lat', 'latitude', 'latitud', 'Lat', 'LAT', 'LastLatitude'];
        const lngKeys = ['lng', 'lon', 'long', 'longitude', 'longitud', 'Lng', 'Lon', 'LON', 'LNG', 'LastLongitude'];

        let latVal = null, lngVal = null;
        for (const k of latKeys) {
          if (obj[k] !== undefined && obj[k] !== null) {
            latVal = typeof obj[k] === 'function' ? null : parseFloat(obj[k]);
            break;
          }
        }
        for (const k of lngKeys) {
          if (obj[k] !== undefined && obj[k] !== null) {
            lngVal = typeof obj[k] === 'function' ? null : parseFloat(obj[k]);
            break;
          }
        }

        if (latVal && lngVal && latVal >= -90 && latVal <= 90 && lngVal >= -180 && lngVal <= 180) {
          const c = { lat: latVal, lng: lngVal, source: 'globals', path };
          // Extraer metadatos
          const sKeys = ['speed', 'velocidad', 'vel', 'Speed'];
          const hKeys = ['heading', 'rumbo', 'course', 'bearing', 'Heading'];
          for (const k of sKeys) { if (obj[k] !== undefined) { c.speed = parseFloat(obj[k]); break; } }
          for (const k of hKeys) { if (obj[k] !== undefined) { c.heading = parseFloat(obj[k]); break; } }
          coords.push(c);
          return;
        }

        // Recursion en propiedades (limitado)
        const keys = Object.keys(obj);
        for (let i = 0; i < Math.min(keys.length, 50); i++) {
          try {
            const val = obj[keys[i]];
            if (typeof val === 'object' && val !== null) {
              extract(val, depth - 1, path + '.' + keys[i]);
            }
          } catch { /* skip */ }
        }
      }

      // ---------------------------------------------------------------
      // 1. Buscar instancias de Google Maps
      // ---------------------------------------------------------------
      try {
        if (window.google && window.google.maps) {
          checked.push('google.maps');

          // Buscar en variables globales que contengan mapas
          for (const key of Object.keys(window)) {
            try {
              const val = window[key];
              if (val && val.getCenter && typeof val.getCenter === 'function') {
                checked.push(`window.${key} (map)`);
                const center = val.getCenter();
                if (center && center.lat && center.lng) {
                  coords.push({
                    lat: typeof center.lat === 'function' ? center.lat() : center.lat,
                    lng: typeof center.lng === 'function' ? center.lng() : center.lng,
                    source: 'globals_gmap_center',
                    path: `window.${key}.getCenter()`,
                  });
                }
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }

      // ---------------------------------------------------------------
      // 2. Buscar instancias de Leaflet
      // ---------------------------------------------------------------
      try {
        if (window.L && window.L.map) {
          checked.push('Leaflet');
        }
        // Buscar en globales
        for (const key of Object.keys(window)) {
          try {
            const val = window[key];
            if (val && val._leaflet_id !== undefined && val.getCenter) {
              checked.push(`window.${key} (leaflet)`);
              const center = val.getCenter();
              if (center) {
                coords.push({
                  lat: center.lat,
                  lng: center.lng,
                  source: 'globals_leaflet_center',
                  path: `window.${key}.getCenter()`,
                });
              }
              // Buscar markers
              if (val.eachLayer) {
                val.eachLayer(function(layer) {
                  if (layer.getLatLng) {
                    const ll = layer.getLatLng();
                    coords.push({
                      lat: ll.lat,
                      lng: ll.lng,
                      source: 'globals_leaflet_marker',
                    });
                  }
                });
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      // ---------------------------------------------------------------
      // 3a. Variables globales conocidas de plataformas GPS (Micodus, Wialon)
      // ---------------------------------------------------------------
      const knownGpsGlobals = ['uluru', 'd', 'devices', 'markers', 'units'];
      for (const key of knownGpsGlobals) {
        try {
          if (window[key] === undefined || window[key] === null) continue;
          const val = window[key];
          if (typeof val !== 'object') continue;
          checked.push(`window.${key} (known)`);
          extract(val, 4, `window.${key}`);
        } catch { /* skip */ }
      }

      // ---------------------------------------------------------------
      // 3b. Buscar variables globales con datos GPS (por patron de nombre)
      // ---------------------------------------------------------------
      const gpsVarPatterns = [
        /vehicle/i, /unit/i, /device/i, /track/i, /marker/i,
        /position/i, /location/i, /coord/i, /point/i, /fleet/i,
        /asset/i, /data/i, /gps/i, /geofence/i, /route/i,
      ];

      for (const key of Object.keys(window)) {
        try {
          // Solo revisar variables que coincidan con patrones GPS
          const matchesPattern = gpsVarPatterns.some(p => p.test(key));
          if (!matchesPattern) continue;

          const val = window[key];
          if (typeof val !== 'object' || val === null) continue;

          checked.push(`window.${key}`);
          extract(val, 4, `window.${key}`);
        } catch { /* skip */ }
      }

      return { coords, checked };
    });
  } catch (err) {
    log('error', 'Error evaluando JS globals:', err.message);
    return { coords: [], globalsChecked: 0, source: 'globals' };
  }

  const deduped = _deduplicateCoords(result.coords.filter(c =>
    coordDetector.isValidPair(c.lat, c.lng)
  ));

  log('info', `Globals: ${result.checked.length} globals revisados, ${deduped.length} coords encontradas`);

  return {
    coords: deduped,
    globalsChecked: result.checked.length,
    source: 'globals',
  };
}

// ---------------------------------------------------------------------------
// Estrategia 3: DOM Scraping
// ---------------------------------------------------------------------------

/**
 * Escanea el DOM visible de la pagina buscando coordenadas en texto.
 * Busca en:
 *  - Tooltips y popups de mapa
 *  - Tablas y listas con datos de vehiculos
 *  - Atributos data-* de elementos
 *  - Texto visible general
 *
 * @param {import('puppeteer').Page} page - Pagina de Puppeteer
 * @returns {Promise<{coords: Array, elementsScanned: number, source: string}>}
 */
async function extractFromDOM(page, options = {}) {
  log('info', 'Escaneando DOM para coordenadas...');

  let result;
  try {
    result = await page.evaluate(() => {
      const texts = [];
      let scanned = 0;

      // ---------------------------------------------------------------
      // 1. Extraer texto de tablas (fuente comun de datos GPS)
      // ---------------------------------------------------------------
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        scanned++;
        texts.push(table.innerText || '');
      }

      // ---------------------------------------------------------------
      // 2. Tooltips, popups, info windows
      // ---------------------------------------------------------------
      const popupSelectors = [
        '.gm-style-iw', '.leaflet-popup-content', '.ol-popup',
        '.infowindow', '.info-window', '.tooltip', '.popup',
        '[class*="tooltip"]', '[class*="popup"]', '[class*="infowindow"]',
      ];
      for (const sel of popupSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            scanned++;
            texts.push(el.innerText || '');
          }
        } catch { /* skip */ }
      }

      // ---------------------------------------------------------------
      // 3. Data attributes con coordenadas
      // ---------------------------------------------------------------
      const dataEls = document.querySelectorAll('[data-lat], [data-latitude], [data-lng], [data-longitude], [data-position]');
      for (const el of dataEls) {
        scanned++;
        const lat = el.getAttribute('data-lat') || el.getAttribute('data-latitude');
        const lng = el.getAttribute('data-lng') || el.getAttribute('data-longitude');
        const pos = el.getAttribute('data-position');

        if (lat && lng) {
          texts.push(`"lat":${lat},"lng":${lng}`);
        }
        if (pos) {
          texts.push(pos);
        }
      }

      // ---------------------------------------------------------------
      // 4. Elementos con clase/id que sugieren datos GPS
      // ---------------------------------------------------------------
      const gpsSelectors = [
        '[class*="vehicle"]', '[class*="unit"]', '[class*="device"]',
        '[class*="tracker"]', '[class*="position"]', '[class*="location"]',
        '[class*="coordinate"]', '[id*="vehicle"]', '[id*="unit"]',
        '[id*="device"]', '[id*="tracker"]', '[id*="coord"]',
        '.vehicle-info', '.device-info', '.tracker-info',
      ];
      for (const sel of gpsSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            scanned++;
            texts.push(el.innerText || '');
            // Tambien revisar atributos
            for (const attr of el.attributes) {
              if (/lat|lng|lon|coord|pos/i.test(attr.name)) {
                texts.push(attr.value);
              }
            }
          }
        } catch { /* skip */ }
      }

      // ---------------------------------------------------------------
      // 5. Texto general del body (fallback, limitado)
      // ---------------------------------------------------------------
      try {
        const bodyText = document.body ? (document.body.innerText || '').slice(0, 50000) : '';
        texts.push(bodyText);
        scanned++;
      } catch { /* skip */ }

      // ---------------------------------------------------------------
      // 6. Scripts inline que puedan contener coordenadas
      // ---------------------------------------------------------------
      const scripts = document.querySelectorAll('script:not([src])');
      for (const script of scripts) {
        scanned++;
        const content = script.textContent || '';
        if (content.length > 20 && content.length < 100000) {
          texts.push(content);
        }
      }

      // ---------------------------------------------------------------
      // 7. Links de Google Maps (maps.google.com/maps?q=LAT,LNG) - GPSWox, etc.
      // ---------------------------------------------------------------
      const mapLinkCoords = [];
      const qPattern = /[?&]q=(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/;
      const collectFromHref = (href) => {
        if (!href || typeof href !== 'string') return;
        const m = href.match(qPattern);
        if (!m) return;
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01)) {
          mapLinkCoords.push({ lat, lng });
        }
      };

      const mapLinkSelectors = [
        'a[href*="maps.google.com"], a[href*="google.com/maps"]',
        'iframe[src*="maps.google.com"], iframe[src*="google.com/maps"]',
      ];
      for (const sel of mapLinkSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            scanned++;
            const href = el.getAttribute('href') || el.getAttribute('src') || '';
            collectFromHref(href);
          }
        } catch { /* skip */ }
      }

      return { texts, scanned, mapLinkCoords };
    });
  } catch (err) {
    log('error', 'Error escaneando DOM:', err.message);
    return { coords: [], elementsScanned: 0, source: 'dom' };
  }

  // Detectar coordenadas en los textos extraidos
  const coords = coordDetector.detectFromMultipleSources(result.texts);
  for (const c of coords) {
    c.source = 'dom';
  }
  // Agregar coordenadas de links Google Maps (q=LAT,LNG)
  if (result.mapLinkCoords && result.mapLinkCoords.length > 0) {
    for (const c of result.mapLinkCoords) {
      c.source = 'dom';
      coords.push(c);
    }
  }

  log('info', `DOM: ${result.scanned} elementos escaneados, ${coords.length} coords encontradas`);

  return {
    coords,
    elementsScanned: result.scanned,
    source: 'dom',
  };
}

// ---------------------------------------------------------------------------
// Funcion combinada: ejecutar todas las estrategias
// ---------------------------------------------------------------------------

/**
 * Ejecuta las 3 estrategias de extraccion y combina los resultados.
 * Prioridad: network > globals > dom (por confiabilidad)
 *
 * @param {import('puppeteer').Page} page - Pagina de Puppeteer
 * @param {object} [options]
 * @param {boolean} [options.networkOnly] - Solo usar intercepcion de red
 * @param {string[]} [options.urlFilters] - Filtros de URL para network
 * @returns {Promise<{coords: Array, strategies: object}>}
 */
async function extractAll(page, options = {}) {
  log('info', 'Ejecutando todas las estrategias de extraccion...');

  const strategies = {};
  let allCoords = [];

  // Estrategia 1: Network
  try {
    const netResult = await extractFromNetwork(page, options);
    strategies.network = {
      success: true,
      count: netResult.coords.length,
      rawResponses: netResult.rawResponses,
    };
    allCoords = allCoords.concat(netResult.coords);
  } catch (err) {
    log('error', 'Estrategia network fallo:', err.message);
    strategies.network = { success: false, error: err.message };
  }

  if (options.networkOnly) {
    return { coords: _deduplicateCoords(allCoords), strategies };
  }

  // Estrategia 2: JS Globals
  try {
    const globResult = await extractFromGlobals(page, options);
    strategies.globals = {
      success: true,
      count: globResult.coords.length,
      globalsChecked: globResult.globalsChecked,
    };
    allCoords = allCoords.concat(globResult.coords);
  } catch (err) {
    log('error', 'Estrategia globals fallo:', err.message);
    strategies.globals = { success: false, error: err.message };
  }

  // Estrategia 3: DOM
  try {
    const domResult = await extractFromDOM(page, options);
    strategies.dom = {
      success: true,
      count: domResult.coords.length,
      elementsScanned: domResult.elementsScanned,
    };
    allCoords = allCoords.concat(domResult.coords);
  } catch (err) {
    log('error', 'Estrategia DOM fallo:', err.message);
    strategies.dom = { success: false, error: err.message };
  }

  const deduped = _deduplicateCoords(allCoords);

  log('info', `Total: ${deduped.length} coords unicas de ${allCoords.length} encontradas`);

  return { coords: deduped, strategies };
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Intenta provocar una recarga de datos en la pagina (scroll, resize, etc.)
 * @private
 */
async function _triggerDataRefresh(page) {
  try {
    await page.evaluate(() => {
      // Disparar evento resize (muchos mapas recargan datos)
      window.dispatchEvent(new Event('resize'));

      // Intentar hacer zoom/pan si hay un mapa
      try {
        if (window.google && window.google.maps) {
          // Buscar instancia de mapa en globals
          for (const key of Object.keys(window)) {
            const val = window[key];
            if (val && val.getZoom && typeof val.getZoom === 'function') {
              const zoom = val.getZoom();
              val.setZoom(zoom); // Forzar refresh
              break;
            }
          }
        }
      } catch { /* skip */ }
    });
  } catch {
    // No critico
  }
}

/**
 * Elimina coordenadas duplicadas (mismo lat/lng con precision de 6 decimales).
 * @private
 */
function _deduplicateCoords(coords) {
  const seen = new Set();
  return coords.filter(c => {
    const key = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Trunca una URL para logs.
 * @private
 */
function _truncateUrl(url) {
  if (url.length <= 80) return url;
  return url.substring(0, 77) + '...';
}

/**
 * Sleep helper.
 * @private
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  extractFromNetwork,
  extractFromGlobals,
  extractFromDOM,
  extractAll,
};
