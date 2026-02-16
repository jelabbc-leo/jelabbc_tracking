/**
 * Stop Detector - Detecta paros analizando coordenadas
 *
 * Responsabilidades:
 *  - Consultar coordenadas recientes de viajes activos (en_ruta)
 *  - Calcular distancia entre coordenadas consecutivas
 *  - Detectar si un vehiculo ha permanecido detenido mas tiempo
 *    del umbral configurado (umbral_paro_minutos en unidades_viajes)
 *  - Retornar lista de viajes con paros detectados para que
 *    vapi-trigger.js pueda iniciar el protocolo de llamadas IA
 *
 * Algoritmo:
 *  1. Para cada viaje activo con ia_llamadas_activas = true,
 *     obtener las ultimas N coordenadas
 *  2. Si todas las coords recientes estan dentro de un radio de ~50m
 *     y el tiempo transcurrido supera el umbral, marcar como PARO
 *  3. Excluir viajes que ya tienen una alerta activa reciente
 *     (para no duplicar llamadas)
 */

'use strict';

const { internalClient: api } = require('../api/client');

const LOG_PREFIX = '[StopDetector]';

// Radio maximo (en metros) para considerar que no se ha movido
const STOP_RADIUS_METERS = 100;

// Minimo de coordenadas necesarias para hacer analisis
const MIN_COORDS_FOR_ANALYSIS = 2;

// ---------------------------------------------------------------------------
// Funciones de utilidad: distancia Haversine
// ---------------------------------------------------------------------------

/**
 * Calcula la distancia en metros entre dos puntos GPS (Haversine).
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distancia en metros
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Radio de la Tierra en metros
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calcula la distancia maxima entre cualquier par de coordenadas
 * en un conjunto (para determinar si todas estan "cerca").
 * @param {Array<{latitud: number, longitud: number}>} coords
 * @returns {number} Distancia maxima en metros
 */
function maxSpread(coords) {
  let maxDist = 0;
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const d = haversineDistance(
        coords[i].latitud, coords[i].longitud,
        coords[j].latitud, coords[j].longitud
      );
      if (d > maxDist) maxDist = d;
    }
  }
  return maxDist;
}

// ---------------------------------------------------------------------------
// Funcion principal: detectStops()
// ---------------------------------------------------------------------------

/**
 * Analiza todos los viajes activos con IA habilitada y detecta paros.
 *
 * @returns {Promise<Array<{
 *   tripId: number,
 *   tripInfo: object,
 *   stoppedMinutes: number,
 *   umbral: number,
 *   lastLat: number,
 *   lastLng: number,
 *   lastCoordTime: string,
 *   coordCount: number
 * }>>} Lista de paros detectados
 */
async function detectStops() {
  const stops = [];

  try {
    await api.ensureToken();

    // 1. Obtener viajes activos con IA habilitada
    const trips = await _loadAIEnabledTrips();

    if (!trips || trips.length === 0) {
      log('info', 'No hay viajes con IA activa');
      return stops;
    }

    log('info', `Analizando ${trips.length} viajes con IA activa...`);

    // 2. Para cada viaje, analizar coordenadas recientes
    for (const trip of trips) {
      try {
        const stopInfo = await _analyzeTrip(trip);
        if (stopInfo) {
          stops.push(stopInfo);
        }
      } catch (err) {
        log('error', `Error analizando viaje ${trip.id}: ${err.message}`);
      }
    }

    if (stops.length > 0) {
      log('info', `${stops.length} paros detectados`);
    }
  } catch (err) {
    log('error', 'Error critico en deteccion de paros:', err.message);
  }

  return stops;
}

/**
 * Analiza un viaje individual para detectar si hay paro.
 * @param {object} trip - Datos del viaje
 * @returns {Promise<object|null>} Info del paro si se detecta, null si no
 * @private
 */
async function _analyzeTrip(trip) {
  const umbralMinutos = trip.umbral_paro_minutos || 30;

  // Ventana amplia: al menos 24h para detectar paros de vehiculos detenidos por horas
  const lookbackMinutes = Math.max(umbralMinutos * 3, 1440);
  const since = new Date(Date.now() - lookbackMinutes * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  log('info', `Viaje ${trip.id}: umbral=${umbralMinutos}min, lookback=${lookbackMinutes}min, since=${since}`);

  const coords = await api.query(
    `SELECT latitud, longitud, fecha_extraccion, fecha_gps, velocidad
     FROM op_coordinates
     WHERE id_unidad_viaje = ${trip.id}
       AND fecha_extraccion >= '${since}'
     ORDER BY fecha_extraccion DESC
     LIMIT 50`
  );

  if (!coords || coords.length < MIN_COORDS_FOR_ANALYSIS) {
    log('info', `Viaje ${trip.id}: solo ${coords ? coords.length : 0} coords (necesita ${MIN_COORDS_FOR_ANALYSIS}), saltando`);
    return null;
  }

  // Verificar si todas las coords recientes estan dentro del radio de paro
  const spread = maxSpread(coords);
  log('info', `Viaje ${trip.id}: ${coords.length} coords, spread=${spread.toFixed(1)}m (limite=${STOP_RADIUS_METERS}m)`);

  if (spread > STOP_RADIUS_METERS) {
    log('info', `Viaje ${trip.id}: spread ${spread.toFixed(1)}m > ${STOP_RADIUS_METERS}m, vehiculo en movimiento`);
    return null;
  }

  // Verificar tambien la velocidad - si hay coordenadas con velocidad > 5 km/h, no es paro
  const hasMovement = coords.some(c =>
    c.velocidad !== null && c.velocidad !== undefined && parseFloat(c.velocidad) > 5
  );
  if (hasMovement) {
    log('info', `Viaje ${trip.id}: velocidad > 5 km/h detectada, no es paro`);
    return null;
  }

  // Calcular cuanto tiempo ha estado detenido
  const oldest = coords[coords.length - 1];
  const newest = coords[0];

  const oldestTime = new Date(oldest.fecha_extraccion || oldest.fecha_gps).getTime();
  const newestTime = new Date(newest.fecha_extraccion || newest.fecha_gps).getTime();
  const stoppedMs = newestTime - oldestTime;
  const stoppedMinutes = Math.round(stoppedMs / 60000);

  log('info', `Viaje ${trip.id}: detenido ${stoppedMinutes}min (umbral=${umbralMinutos}min), oldest=${oldest.fecha_extraccion}, newest=${newest.fecha_extraccion}`);

  if (stoppedMinutes < umbralMinutos) {
    log('info', `Viaje ${trip.id}: ${stoppedMinutes}min < umbral ${umbralMinutos}min, aun no`);
    return null;
  }

  // Verificar que no haya una alerta reciente para este viaje
  const hasRecentAlert = await _hasRecentAlert(trip.id);
  if (hasRecentAlert) {
    log('info', `Viaje ${trip.id}: PARO DETECTADO (${stoppedMinutes}min) pero ya hay alerta reciente, saltando`);
    return null;
  }

  log('info', `Viaje ${trip.id}: *** PARO CONFIRMADO *** ${stoppedMinutes}min detenido, disparando llamada IA`);

  return {
    tripId: trip.id,
    tripInfo: trip,
    stoppedMinutes,
    umbral: umbralMinutos,
    lastLat: parseFloat(newest.latitud),
    lastLng: parseFloat(newest.longitud),
    lastCoordTime: newest.fecha_extraccion || newest.fecha_gps,
    coordCount: coords.length,
  };
}

// ---------------------------------------------------------------------------
// Consultas auxiliares
// ---------------------------------------------------------------------------

/**
 * Carga viajes activos con IA de llamadas habilitada.
 * @private
 */
async function _loadAIEnabledTrips() {
  try {
    const trips = await api.query(
      `SELECT uv.id, uv.placas_unidad, uv.provider_id,
              uv.nombre_operador, uv.telefono_operador,
              uv.ultima_lat, uv.ultima_lng, uv.estado_actual,
              uv.umbral_paro_minutos, uv.ia_llamadas_activas,
              uv.frecuencia_monitoreo_min, uv.link_cuenta_espejo
       FROM unidades_viajes uv
       WHERE uv.estado_actual = 'en_ruta'
         AND uv.ia_llamadas_activas = 1
       ORDER BY uv.id DESC`
    );
    return trips || [];
  } catch (err) {
    log('error', 'Error cargando viajes con IA activa:', err.message);
    return [];
  }
}

/**
 * Verifica si ya existe una alerta de paro reciente para el viaje
 * (dentro de la ultima hora) para evitar alertas duplicadas.
 * @param {number} tripId
 * @returns {Promise<boolean>}
 * @private
 */
async function _hasRecentAlert(tripId) {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');

    // Revisar en log_ai_calls si ya hubo una llamada por paro recientemente
    let recentCalls = 0;
    try {
      const recent = await api.query(
        `SELECT id FROM log_ai_calls
         WHERE id_unidad_viaje = ${tripId}
           AND tipo = 'paro'
           AND creado_en >= '${oneHourAgo}'
         LIMIT 1`
      );
      recentCalls = recent ? recent.length : 0;
    } catch (err) {
      log('warn', `Viaje ${tripId}: error consultando log_ai_calls: ${err.message}`);
    }

    // Tambien revisar en eventos_unidad
    let recentEvents = 0;
    try {
      const recentEvent = await api.query(
        `SELECT id FROM eventos_unidad
         WHERE id_unidad_viaje = ${tripId}
           AND tipo_evento = 'alerta_paro_ia'
           AND ocurrido_en >= '${oneHourAgo}'
         LIMIT 1`
      );
      recentEvents = recentEvent ? recentEvent.length : 0;
    } catch (err) {
      log('warn', `Viaje ${tripId}: error consultando eventos_unidad: ${err.message}`);
    }

    const blocked = recentCalls > 0 || recentEvents > 0;
    log('info', `Viaje ${tripId}: hasRecentAlert=${blocked} (calls=${recentCalls}, events=${recentEvents})`);
    return blocked;
  } catch (err) {
    log('warn', `Viaje ${tripId}: error en _hasRecentAlert: ${err.message}, permitiendo alerta`);
    return false;
  }
}

/**
 * Registra un evento de alerta de paro en eventos_unidad.
 * @param {number} tripId
 * @param {string} descripcion
 */
async function logStopAlert(tripId, descripcion) {
  try {
    await api.insert('eventos_unidad', {
      id_unidad_viaje: tripId,
      tipo_evento: 'alerta_paro_ia',
      descripcion,
      ocurrido_en: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  } catch (err) {
    log('error', `Error registrando alerta de paro para viaje ${tripId}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(level, ...args) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(LOG_PREFIX, ...args);
}

// ---------------------------------------------------------------------------
// Exportaciones
// ---------------------------------------------------------------------------

module.exports = {
  detectStops,
  logStopAlert,
  haversineDistance,
};
