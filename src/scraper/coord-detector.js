/**
 * Coord Detector - Heuristicas universales para detectar coordenadas GPS
 *
 * Responsabilidades:
 *  - Parsear coordenadas en multiples formatos (decimal, DMS, con/sin prefijo)
 *  - Validar rangos de latitud (-90..90) y longitud (-180..180)
 *  - Extraer velocidad, rumbo y timestamp si estan disponibles
 *  - Detectar pares lat/lng de texto libre, objetos JSON y strings HTML
 */

'use strict';

const LOG_PREFIX = '[CoordDetector]';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

// Precision minima para considerar una coordenada valida (al menos 3 decimales)
const MIN_DECIMAL_PLACES = 2;

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Patron para coordenadas decimales (ej: 19.4326, -99.1332)
 * Captura numeros con al menos MIN_DECIMAL_PLACES decimales
 */
const DECIMAL_COORD_RE = /-?\d{1,3}\.\d{2,8}/g;

/**
 * Patron para pares lat/lng separados por coma, espacio o pipe
 * Captura: "19.4326, -99.1332" o "19.4326 -99.1332" o "19.4326|-99.1332"
 */
const PAIR_RE = /(-?\d{1,3}\.\d{2,8})\s*[,|\s]\s*(-?\d{1,3}\.\d{2,8})/g;

/**
 * Patron DMS (Degrees Minutes Seconds)
 * Captura: 19°25'57.4"N  o  19° 25' 57.4" N
 */
const DMS_RE = /(\d{1,3})\s*[°]\s*(\d{1,2})\s*[′']\s*([\d.]+)\s*[″"]\s*([NSEWnsew])/g;

/**
 * Patron para detectar coordenadas en objetos JSON comunes de plataformas GPS
 * Busca patrones como: "lat":19.4326, "lng":-99.1332
 * o: "latitude":19.4326, "longitude":-99.1332
 * o: "Lat":19.4326, "Lon":-99.1332
 */
const JSON_COORD_KEYS = [
  // lat (con y sin comillas)
  /["']?(?:lat|latitude|latitud|y|flat|LastLatitude|Lat|LAT)["']?\s*[:=]\s*(-?\d{1,3}\.\d{2,8})/gi,
  // lng (con y sin comillas)
  /["']?(?:lng|lon|long|longitude|longitud|x|flng|flon|LastLongitude|Lon|LON|Lng|LNG)["']?\s*[:=]\s*(-?\d{1,3}\.\d{2,8})/gi,
];

/**
 * Patron para velocidad (km/h o mph)
 */
const SPEED_RE = /["']?(?:speed|velocidad|vel|Speed|Velocidad|Vel)["']?\s*[:=]\s*([\d.]+)/gi;

/**
 * Patron para rumbo/heading
 */
const HEADING_RE = /["']?(?:heading|rumbo|course|bearing|Heading|Course|Bearing|Rumbo)["']?\s*[:=]\s*([\d.]+)/gi;

/**
 * Patron para timestamp GPS
 */
const TIMESTAMP_RE = /["']?(?:timestamp|time|fecha|date|dateTime|DeviceTime|GPSTime|gps_time|fecha_gps)["']?\s*[:=]\s*["']?(\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}[^"',}]*)["']?/gi;

// ---------------------------------------------------------------------------
// Funciones de validacion
// ---------------------------------------------------------------------------

/**
 * Valida si un numero es una latitud valida.
 * @param {number} lat
 * @returns {boolean}
 */
function isValidLat(lat) {
  return typeof lat === 'number' && !isNaN(lat) && lat >= LAT_MIN && lat <= LAT_MAX && lat !== 0;
}

/**
 * Valida si un numero es una longitud valida.
 * @param {number} lng
 * @returns {boolean}
 */
function isValidLng(lng) {
  return typeof lng === 'number' && !isNaN(lng) && lng >= LNG_MIN && lng <= LNG_MAX && lng !== 0;
}

/**
 * Valida un par de coordenadas.
 * Descarta pares donde ambas son 0 (punto nulo comun en GPS).
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
function isValidPair(lat, lng) {
  if (!isValidLat(lat) || !isValidLng(lng)) return false;
  // Descartar punto nulo (0,0) que es un error comun
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Funciones de conversion
// ---------------------------------------------------------------------------

/**
 * Convierte coordenadas DMS a decimal.
 * @param {number} degrees
 * @param {number} minutes
 * @param {number} seconds
 * @param {string} direction - N, S, E, W
 * @returns {number}
 */
function dmsToDecimal(degrees, minutes, seconds, direction) {
  let decimal = degrees + (minutes / 60) + (seconds / 3600);
  if (direction === 'S' || direction === 's' || direction === 'W' || direction === 'w') {
    decimal = -decimal;
  }
  return decimal;
}

// ---------------------------------------------------------------------------
// Funciones de deteccion principales
// ---------------------------------------------------------------------------

/**
 * Detecta coordenadas en un string de texto libre.
 * Usa multiples heuristicas en orden de confiabilidad.
 *
 * @param {string} text - Texto a analizar
 * @returns {Array<{lat: number, lng: number, speed?: number, heading?: number, timestamp?: string, source: string}>}
 */
function detectFromText(text) {
  if (!text || typeof text !== 'string') return [];

  const results = [];
  const seen = new Set(); // Evitar duplicados

  // Estrategia 1: Buscar pares explicitos lat/lng
  _detectPairsFromText(text, results, seen);

  // Estrategia 2: Buscar coordenadas DMS
  _detectDMS(text, results, seen);

  // Enriquecer con velocidad, rumbo, timestamp si hay
  _enrichResults(text, results);

  return results;
}

/**
 * Detecta coordenadas en un objeto/array JavaScript (parsed JSON).
 * Recorre recursivamente buscando patrones conocidos de plataformas GPS.
 *
 * @param {any} data - Objeto, array, o valor primitivo
 * @param {number} [maxDepth=10] - Profundidad maxima de recursion
 * @returns {Array<{lat: number, lng: number, speed?: number, heading?: number, timestamp?: string, source: string}>}
 */
function detectFromObject(data, maxDepth = 10) {
  if (!data || maxDepth <= 0) return [];

  const results = [];
  const seen = new Set();

  _walkObject(data, results, seen, maxDepth, '');

  return results;
}

/**
 * Detecta coordenadas combinando multiples fuentes de texto.
 * Util para combinar resultados de network + DOM + globals.
 *
 * @param {string[]} texts - Array de textos a analizar
 * @returns {Array<{lat: number, lng: number, speed?: number, heading?: number, timestamp?: string, source: string}>}
 */
function detectFromMultipleSources(texts) {
  if (!Array.isArray(texts)) return [];

  const allResults = [];
  const seen = new Set();

  for (const text of texts) {
    const found = detectFromText(text);
    for (const coord of found) {
      const key = `${coord.lat.toFixed(6)},${coord.lng.toFixed(6)}`;
      if (!seen.has(key)) {
        seen.add(key);
        allResults.push(coord);
      }
    }
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// Metodos internos
// ---------------------------------------------------------------------------

/**
 * Busca pares de coordenadas decimales en texto.
 * @private
 */
function _detectPairsFromText(text, results, seen) {
  // Primero intentar con JSON keys
  const latMatches = [];
  const lngMatches = [];

  for (const re of JSON_COORD_KEYS) {
    re.lastIndex = 0;
    let match;
    // El primer patron es para lat, el segundo para lng
    if (re.source.includes('lat') || re.source.includes('Lat') || re.source.includes('\\by\\b')) {
      while ((match = re.exec(text)) !== null) {
        latMatches.push({ value: parseFloat(match[1]), index: match.index });
      }
    } else {
      while ((match = re.exec(text)) !== null) {
        lngMatches.push({ value: parseFloat(match[1]), index: match.index });
      }
    }
  }

  // Separar patrones de lat y lng
  const latRe = JSON_COORD_KEYS[0];
  const lngRe = JSON_COORD_KEYS[1];

  latRe.lastIndex = 0;
  lngRe.lastIndex = 0;

  const lats = [];
  const lngs = [];
  let m;

  while ((m = latRe.exec(text)) !== null) {
    lats.push({ value: parseFloat(m[1]), index: m.index });
  }
  while ((m = lngRe.exec(text)) !== null) {
    lngs.push({ value: parseFloat(m[1]), index: m.index });
  }

  // Emparejar lat con lng mas cercano en posicion
  for (const lat of lats) {
    let bestLng = null;
    let bestDist = Infinity;

    for (const lng of lngs) {
      const dist = Math.abs(lat.index - lng.index);
      if (dist < bestDist) {
        bestDist = dist;
        bestLng = lng;
      }
    }

    if (bestLng && bestDist < 500 && isValidPair(lat.value, bestLng.value)) {
      const key = `${lat.value.toFixed(6)},${bestLng.value.toFixed(6)}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          lat: lat.value,
          lng: bestLng.value,
          source: 'json_keys',
        });
      }
    }
  }

  // Fallback: buscar pares simples
  PAIR_RE.lastIndex = 0;
  let pairMatch;
  while ((pairMatch = PAIR_RE.exec(text)) !== null) {
    const a = parseFloat(pairMatch[1]);
    const b = parseFloat(pairMatch[2]);

    // Determinar cual es lat y cual es lng
    let lat, lng;
    if (isValidLat(a) && isValidLng(b)) {
      lat = a;
      lng = b;
    } else if (isValidLat(b) && isValidLng(a)) {
      lat = b;
      lng = a;
    } else {
      continue;
    }

    if (!isValidPair(lat, lng)) continue;

    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ lat, lng, source: 'pair_text' });
    }
  }
}

/**
 * Busca coordenadas DMS en texto.
 * @private
 */
function _detectDMS(text, results, seen) {
  DMS_RE.lastIndex = 0;
  const dmsValues = [];
  let match;

  while ((match = DMS_RE.exec(text)) !== null) {
    const decimal = dmsToDecimal(
      parseInt(match[1]),
      parseInt(match[2]),
      parseFloat(match[3]),
      match[4]
    );
    const dir = match[4].toUpperCase();
    dmsValues.push({
      value: decimal,
      isLat: dir === 'N' || dir === 'S',
      index: match.index,
    });
  }

  // Emparejar lat con lng
  for (let i = 0; i < dmsValues.length; i++) {
    if (!dmsValues[i].isLat) continue;

    for (let j = 0; j < dmsValues.length; j++) {
      if (j === i || dmsValues[j].isLat) continue;

      const lat = dmsValues[i].value;
      const lng = dmsValues[j].value;

      if (isValidPair(lat, lng)) {
        const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ lat, lng, source: 'dms' });
        }
        break;
      }
    }
  }
}

/**
 * Enriquece los resultados con velocidad, rumbo y timestamp si se encuentran.
 * @private
 */
function _enrichResults(text, results) {
  if (results.length === 0) return;

  // Extraer velocidad
  SPEED_RE.lastIndex = 0;
  const speedMatch = SPEED_RE.exec(text);
  const speed = speedMatch ? parseFloat(speedMatch[1]) : undefined;

  // Extraer rumbo
  HEADING_RE.lastIndex = 0;
  const headingMatch = HEADING_RE.exec(text);
  const heading = headingMatch ? parseFloat(headingMatch[1]) : undefined;

  // Extraer timestamp
  TIMESTAMP_RE.lastIndex = 0;
  const timeMatch = TIMESTAMP_RE.exec(text);
  const timestamp = timeMatch ? timeMatch[1].trim() : undefined;

  // Si solo hay un resultado, asignarle todo
  if (results.length === 1) {
    if (speed !== undefined) results[0].speed = speed;
    if (heading !== undefined) results[0].heading = heading;
    if (timestamp !== undefined) results[0].timestamp = timestamp;
    return;
  }

  // Si hay multiples, solo asignar al primero (mas cercano al contexto)
  if (speed !== undefined) results[0].speed = speed;
  if (heading !== undefined) results[0].heading = heading;
  if (timestamp !== undefined) results[0].timestamp = timestamp;
}

/**
 * Recorre recursivamente un objeto buscando coordenadas.
 * Detecta patrones comunes de APIs GPS:
 *  - { lat: 19.43, lng: -99.13 }
 *  - { latitude: 19.43, longitude: -99.13 }
 *  - { Lat: 19.43, Lon: -99.13 }
 *  - { position: { lat: 19.43, lng: -99.13 } }
 *  - [ { lat: 19.43, lng: -99.13 }, ... ]
 * @private
 */
function _walkObject(obj, results, seen, depth, path) {
  if (depth <= 0 || !obj) return;

  if (Array.isArray(obj)) {
    // Posible array de coordenadas [lat, lng]
    if (obj.length === 2 && typeof obj[0] === 'number' && typeof obj[1] === 'number') {
      const [a, b] = obj;
      if (isValidPair(a, b)) {
        _addResult(results, seen, a, b, 'array_pair');
      } else if (isValidPair(b, a)) {
        _addResult(results, seen, b, a, 'array_pair');
      }
    }

    // Recorrer elementos
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'object' && obj[i] !== null) {
        _walkObject(obj[i], results, seen, depth - 1, `${path}[${i}]`);
      }
    }
    return;
  }

  if (typeof obj !== 'object') return;

  // Buscar propiedades conocidas de lat/lng
  const latKeys = ['lat', 'latitude', 'latitud', 'Lat', 'LAT', 'LastLatitude', 'flat', 'y'];
  const lngKeys = ['lng', 'lon', 'long', 'longitude', 'longitud', 'Lng', 'Lon', 'LON', 'LNG', 'LastLongitude', 'flon', 'flng', 'x'];

  let latVal = null;
  let lngVal = null;

  for (const key of latKeys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      latVal = parseFloat(obj[key]);
      break;
    }
  }

  for (const key of lngKeys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      lngVal = parseFloat(obj[key]);
      break;
    }
  }

  if (latVal !== null && lngVal !== null && isValidPair(latVal, lngVal)) {
    const coord = { lat: latVal, lng: lngVal, source: 'object_keys' };

    // Extraer metadatos si existen
    const speedKeys = ['speed', 'velocidad', 'vel', 'Speed', 'Velocidad'];
    const headingKeys = ['heading', 'rumbo', 'course', 'bearing', 'Heading', 'Course'];
    const timeKeys = ['timestamp', 'time', 'fecha', 'date', 'dateTime', 'DeviceTime', 'GPSTime', 'gps_time', 'fecha_gps'];

    for (const k of speedKeys) {
      if (obj[k] !== undefined) { coord.speed = parseFloat(obj[k]); break; }
    }
    for (const k of headingKeys) {
      if (obj[k] !== undefined) { coord.heading = parseFloat(obj[k]); break; }
    }
    for (const k of timeKeys) {
      if (obj[k] !== undefined) { coord.timestamp = String(obj[k]); break; }
    }

    _addResult(results, seen, coord.lat, coord.lng, coord.source, coord);
    return; // No recursear mas dentro de este objeto
  }

  // Recursion en propiedades
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'object' && val !== null) {
      _walkObject(val, results, seen, depth - 1, `${path}.${key}`);
    }
  }
}

/**
 * Agrega un resultado evitando duplicados.
 * @private
 */
function _addResult(results, seen, lat, lng, source, extra = {}) {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  if (seen.has(key)) return;
  seen.add(key);

  results.push({
    lat,
    lng,
    source,
    ...extra,
    lat, // override por si extra tenia lat/lng como string
    lng,
  });
}

// ---------------------------------------------------------------------------
// Exportaciones
// ---------------------------------------------------------------------------

module.exports = {
  detectFromText,
  detectFromObject,
  detectFromMultipleSources,
  isValidLat,
  isValidLng,
  isValidPair,
  dmsToDecimal,
};
