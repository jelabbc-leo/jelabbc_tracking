/**
 * Coordinator - Orquesta la extraccion de coordenadas GPS y guarda via API
 *
 * Responsabilidades:
 *  - Cargar proveedores activos de la BD (conf_providers)
 *  - Cargar viajes activos (unidades_viajes en_ruta)
 *  - Para cada proveedor: extraer coordenadas via HTTP directo (http-fetcher)
 *  - Matchear coordenadas extraidas con viajes activos
 *  - Guardar nuevas coordenadas en op_coordinates via API
 *  - Actualizar ultima posicion en unidades_viajes
 *  - Registrar logs en log_scrape
 *  - Registrar eventos en eventos_unidad
 *  - Manejo robusto de errores (un proveedor fallido no afecta a los demas)
 *
 * NOTA: Se usa http-fetcher (llamadas HTTP directas) en lugar de Puppeteer.
 * Puppeteer/extractor.js se mantiene para desarrollo local si se necesita.
 *
 * Se ejecuta periodicamente via node-cron desde server.js
 */

'use strict';

const httpFetcher = require('./http-fetcher');
const { internalClient: api } = require('../api/client');

const LOG_PREFIX = '[Coordinator]';

// ---------------------------------------------------------------------------
// Estado global del coordinator
// ---------------------------------------------------------------------------

let isRunning = false;
let lastRunTime = null;
let lastRunResult = null;

// ---------------------------------------------------------------------------
// Funcion principal: run()
// ---------------------------------------------------------------------------

/**
 * Ejecuta un ciclo completo de scraping para todos los proveedores activos.
 * Es idempotente: si ya hay una ejecucion en curso, la ignora.
 *
 * @returns {Promise<object>} Resumen de la ejecucion
 */
async function run() {
  if (isRunning) {
    log('warn', 'Ya hay una ejecucion en curso, saltando...');
    return { skipped: true, reason: 'already_running' };
  }

  isRunning = true;
  const startTime = new Date();
  log('info', '========== INICIO CICLO DE SCRAPING ==========');

  const summary = {
    startTime: startTime.toISOString(),
    providers: 0,
    providersSuccess: 0,
    providersFailed: 0,
    totalCoords: 0,
    totalNewCoords: 0,
    errors: [],
    details: [],
  };

  try {
    // 1. Autenticar contra la API
    await api.ensureToken();

    // 2. Cargar proveedores activos
    const providers = await _loadActiveProviders();
    summary.providers = providers.length;

    if (providers.length === 0) {
      log('info', 'No hay proveedores activos, terminando ciclo');
      return _finishRun(summary, startTime);
    }

    // 3. Cargar viajes activos (en_ruta)
    const activeTrips = await _loadActiveTrips();
    log('info', `${providers.length} proveedores activos, ${activeTrips.length} viajes en ruta`);

    // 4. Procesar cada proveedor
    for (const provider of providers) {
      const providerResult = await _fetchProvider(provider, activeTrips);
      summary.details.push(providerResult);

      if (providerResult.success) {
        summary.providersSuccess++;
        summary.totalCoords += providerResult.coordsFound;
        summary.totalNewCoords += providerResult.coordsSaved;
      } else {
        summary.providersFailed++;
        summary.errors.push({
          provider: provider.nombre,
          error: providerResult.error,
        });
      }
    }
  } catch (err) {
    log('error', 'Error critico en ciclo de scraping:', err.message);
    summary.errors.push({ provider: 'general', error: err.message });
  }

  return _finishRun(summary, startTime);
}

// ---------------------------------------------------------------------------
// Extraccion por proveedor (HTTP directo, sin Puppeteer)
// ---------------------------------------------------------------------------

/**
 * Procesa un proveedor GPS usando llamadas HTTP directas.
 * @private
 */
async function _fetchProvider(provider, activeTrips) {
  const startTime = new Date();
  let logId = null;

  log('info', `--- Procesando proveedor: ${provider.nombre} (ID: ${provider.id}) ---`);

  // Crear registro de log
  try {
    logId = await _createScrapeLog(provider.id, startTime);
  } catch (err) {
    log('error', `No se pudo crear log para ${provider.nombre}:`, err.message);
  }

  try {
    // 1. Extraer coordenadas via HTTP directo
    const fetchResult = await httpFetcher.fetch(provider.url);
    const coords = fetchResult.coords || [];

    log('info', `${provider.nombre}: ${coords.length} coordenadas extraidas (${fetchResult.platform}, ${fetchResult.source})`);

    // 2. Matchear con viajes activos y guardar
    const savedCount = await _processAndSaveCoords(coords, provider, activeTrips);

    // 3. Actualizar proveedor
    await _updateProviderStatus(provider.id, null);

    // 4. Actualizar log de scrape
    if (logId) {
      await _updateScrapeLog(logId, 'success', coords.length, savedCount, fetchResult.source);
    }

    const result = {
      success: true,
      provider: provider.nombre,
      providerId: provider.id,
      platform: fetchResult.platform,
      coordsFound: coords.length,
      coordsSaved: savedCount,
      source: fetchResult.source,
      duration: Date.now() - startTime.getTime(),
    };

    log('info', `${provider.nombre}: OK - ${coords.length} encontradas, ${savedCount} nuevas guardadas`);
    return result;

  } catch (err) {
    log('error', `${provider.nombre}: ERROR - ${err.message}`);

    // Actualizar log y provider con error
    if (logId) {
      await _updateScrapeLog(logId, 'error', 0, 0, null, err.message).catch(() => {});
    }
    await _updateProviderStatus(provider.id, err.message).catch(() => {});

    return {
      success: false,
      provider: provider.nombre,
      providerId: provider.id,
      error: err.message,
      duration: Date.now() - startTime.getTime(),
    };
  }
}

// ---------------------------------------------------------------------------
// Procesamiento y guardado de coordenadas
// ---------------------------------------------------------------------------

/**
 * Procesa coordenadas extraidas: matchea con viajes y guarda en BD.
 * @private
 */
async function _processAndSaveCoords(coords, provider, activeTrips) {
  if (!coords || coords.length === 0 || activeTrips.length === 0) return 0;

  let savedCount = 0;

  // Para cada viaje activo que pertenezca a este proveedor
  const providerTrips = activeTrips.filter(t =>
    t.provider_id === provider.id || !t.provider_id
  );

  if (providerTrips.length === 0) {
    log('info', `No hay viajes activos para proveedor ${provider.nombre}, guardando coords genericas`);

    // Guardar todas las coords asociadas al primer viaje activo como fallback
    if (activeTrips.length > 0) {
      for (const coord of coords.slice(0, 50)) {
        try {
          await api.insert('op_coordinates', {
            id_unidad_viaje: activeTrips[0].id,
            provider_id: provider.id,
            latitud: coord.lat,
            longitud: coord.lng,
            velocidad: coord.speed || null,
            rumbo: coord.heading || null,
            fecha_gps: coord.timestamp || null,
            fuente: coord.source || 'http',
          });
          savedCount++;
        } catch (err) {
          log('error', `Error guardando coord: ${err.message}`);
        }
      }
    }
    return savedCount;
  }

  // Para cada viaje del proveedor
  for (const trip of providerTrips) {
    const tripCoords = coords;

    for (const coord of tripCoords.slice(0, 50)) {
      try {
        // Verificar que no sea duplicada (misma coord en ultimos 5 min)
        const isDuplicate = await _isCoordDuplicate(trip.id, coord);
        if (isDuplicate) continue;

        // Insertar coordenada
        await api.insert('op_coordinates', {
          id_unidad_viaje: trip.id,
          provider_id: provider.id,
          latitud: coord.lat,
          longitud: coord.lng,
          velocidad: coord.speed || null,
          rumbo: coord.heading || null,
          fecha_gps: coord.timestamp || null,
          fuente: coord.source || 'http',
        });
        savedCount++;

        // Actualizar ultima posicion del viaje
        await api.update('unidades_viajes', trip.id, {
          ultima_lat: coord.lat,
          ultima_lng: coord.lng,
          ultima_actualizacion: new Date().toISOString().slice(0, 19).replace('T', ' '),
        }).catch(() => {});

        // Registrar evento
        await _logEvent(trip.id, 'scrape_exitoso',
          `Coordenada extraida: ${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)} (${coord.source})`
        ).catch(() => {});

      } catch (err) {
        log('error', `Error guardando coord para viaje ${trip.id}: ${err.message}`);
      }
    }
  }

  return savedCount;
}

/**
 * Verifica si una coordenada ya fue guardada recientemente (dedup).
 * @private
 */
async function _isCoordDuplicate(tripId, coord) {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');

    const existing = await api.query(
      `SELECT id FROM op_coordinates
       WHERE id_unidad_viaje = ${tripId}
         AND ABS(latitud - ${coord.lat}) < 0.00001
         AND ABS(longitud - ${coord.lng}) < 0.00001
         AND fecha_extraccion > '${fiveMinAgo}'
       LIMIT 1`
    );

    return existing && existing.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------------

/**
 * Carga proveedores activos de la BD.
 * @private
 */
async function _loadActiveProviders() {
  try {
    const providers = await api.query(
      'SELECT * FROM conf_providers WHERE activo = 1 ORDER BY intervalo_minutos ASC'
    );
    return providers || [];
  } catch (err) {
    log('error', 'Error cargando proveedores:', err.message);
    return [];
  }
}

/**
 * Carga viajes activos (en_ruta) de la BD.
 * @private
 */
async function _loadActiveTrips() {
  try {
    const trips = await api.query(
      `SELECT id, placas_unidad, provider_id,
              ultima_lat, ultima_lng, frecuencia_monitoreo_min
       FROM unidades_viajes
       WHERE estado_actual = 'en_ruta'
       ORDER BY id DESC`
    );
    return trips || [];
  } catch (err) {
    log('error', 'Error cargando viajes activos:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Logging y actualizaciones de BD
// ---------------------------------------------------------------------------

/**
 * Crea un registro en log_scrape al iniciar un scraping.
 * @private
 */
async function _createScrapeLog(providerId, startTime) {
  try {
    const result = await api.insert('log_scrape', {
      provider_id: providerId,
      inicio: startTime.toISOString().slice(0, 19).replace('T', ' '),
      estado: 'running',
    });

    if (result && result.id) return result.id;
    if (result && result.insertId) return result.insertId;

    const rows = await api.query(
      `SELECT id FROM log_scrape WHERE provider_id = ${providerId} ORDER BY id DESC LIMIT 1`
    );
    return rows && rows.length > 0 ? rows[0].id : null;
  } catch (err) {
    log('error', 'Error creando log de scrape:', err.message);
    return null;
  }
}

/**
 * Actualiza un registro de log_scrape al terminar.
 * @private
 */
async function _updateScrapeLog(logId, estado, coordsFound, coordsNew, fuentes, errorMsg = null) {
  if (!logId) return;

  try {
    const data = {
      fin: new Date().toISOString().slice(0, 19).replace('T', ' '),
      estado,
      dispositivos_encontrados: coordsFound || 0,
      coordenadas_nuevas: coordsNew || 0,
      fuentes_usadas: fuentes || null,
      error_mensaje: errorMsg || null,
    };

    await api.update('log_scrape', logId, data);
  } catch (err) {
    log('error', `Error actualizando log ${logId}:`, err.message);
  }
}

/**
 * Actualiza el estado del proveedor despues de un scraping.
 * @private
 */
async function _updateProviderStatus(providerId, errorMsg) {
  try {
    const data = {
      ultimo_scrape: new Date().toISOString().slice(0, 19).replace('T', ' '),
      ultimo_error: errorMsg || null,
    };
    await api.update('conf_providers', providerId, data);
  } catch (err) {
    log('error', `Error actualizando proveedor ${providerId}:`, err.message);
  }
}

/**
 * Registra un evento en eventos_unidad.
 * @private
 */
async function _logEvent(tripId, tipo, descripcion) {
  try {
    await api.insert('eventos_unidad', {
      id_unidad_viaje: tripId,
      tipo_evento: tipo,
      descripcion,
      ocurrido_en: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  } catch {
    // No critico
  }
}

// ---------------------------------------------------------------------------
// Finalizacion
// ---------------------------------------------------------------------------

/**
 * Finaliza un ciclo de scraping y retorna el resumen.
 * @private
 */
function _finishRun(summary, startTime) {
  const endTime = new Date();
  summary.endTime = endTime.toISOString();
  summary.durationMs = endTime.getTime() - startTime.getTime();

  isRunning = false;
  lastRunTime = endTime;
  lastRunResult = summary;

  log('info', `========== FIN CICLO DE SCRAPING ==========`);
  log('info', `Duracion: ${(summary.durationMs / 1000).toFixed(1)}s | ` +
    `Proveedores: ${summary.providersSuccess}/${summary.providers} OK | ` +
    `Coords: ${summary.totalNewCoords} nuevas de ${summary.totalCoords} encontradas`);

  return summary;
}

// ---------------------------------------------------------------------------
// Ejecucion inteligente: solo proveedores que necesitan scraping
// ---------------------------------------------------------------------------

/**
 * Ejecuta scraping SOLO para proveedores cuyo intervalo ya se cumplio.
 * Es llamada por el scheduler cada minuto — solo procesa los que estan "due".
 *
 * @returns {Promise<object>} Resumen de la ejecucion
 */
async function runDueProviders() {
  if (isRunning) {
    log('warn', 'Ya hay una ejecucion en curso, saltando...');
    return { skipped: true, reason: 'already_running' };
  }

  isRunning = true;
  const startTime = new Date();

  const summary = {
    startTime: startTime.toISOString(),
    providers: 0,
    providersSuccess: 0,
    providersFailed: 0,
    providersSkipped: 0,
    totalCoords: 0,
    totalNewCoords: 0,
    errors: [],
    details: [],
  };

  try {
    await api.ensureToken();

    const allProviders = await _loadActiveProviders();

    if (allProviders.length === 0) {
      log('info', 'No hay proveedores activos');
      return _finishRun(summary, startTime);
    }

    // Filtrar solo los que estan "due" segun su intervalo
    const now = Date.now();
    const dueProviders = allProviders.filter(p => {
      const intervaloMs = (p.intervalo_minutos || 5) * 60 * 1000;
      if (!p.ultimo_scrape) return true;
      const lastScrape = new Date(p.ultimo_scrape).getTime();
      return (now - lastScrape) >= intervaloMs;
    });

    summary.providers = allProviders.length;
    summary.providersSkipped = allProviders.length - dueProviders.length;

    if (dueProviders.length === 0) {
      log('info', `${allProviders.length} proveedores activos, ninguno necesita scraping aun`);
      return _finishRun(summary, startTime);
    }

    log('info', `${dueProviders.length}/${allProviders.length} proveedores necesitan scraping`);

    const activeTrips = await _loadActiveTrips();
    log('info', `${activeTrips.length} viajes en ruta`);

    for (const provider of dueProviders) {
      const providerResult = await _fetchProvider(provider, activeTrips);
      summary.details.push(providerResult);

      if (providerResult.success) {
        summary.providersSuccess++;
        summary.totalCoords += providerResult.coordsFound;
        summary.totalNewCoords += providerResult.coordsSaved;
      } else {
        summary.providersFailed++;
        summary.errors.push({
          provider: provider.nombre,
          error: providerResult.error,
        });
      }
    }
  } catch (err) {
    log('error', 'Error critico en ciclo de scraping:', err.message);
    summary.errors.push({ provider: 'general', error: err.message });
  }

  return _finishRun(summary, startTime);
}

// ---------------------------------------------------------------------------
// Ejecucion manual (para la ruta /api/scraper/run)
// ---------------------------------------------------------------------------

/**
 * Ejecuta scraping para un proveedor especifico.
 * @param {number} providerId - ID del proveedor
 * @returns {Promise<object>}
 */
async function runForProvider(providerId) {
  log('info', `Ejecucion manual para proveedor ID: ${providerId}`);

  try {
    await api.ensureToken();

    const providers = await api.query(
      `SELECT * FROM conf_providers WHERE id = ${parseInt(providerId)} LIMIT 1`
    );

    if (!providers || providers.length === 0) {
      return { success: false, error: 'Proveedor no encontrado' };
    }

    const activeTrips = await _loadActiveTrips();

    return await _fetchProvider(providers[0], activeTrips);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Status (para monitoreo)
// ---------------------------------------------------------------------------

/**
 * Retorna el estado actual del coordinator.
 * @returns {object}
 */
function status() {
  return {
    isRunning,
    lastRunTime: lastRunTime ? lastRunTime.toISOString() : null,
    lastRunResult,
    mode: 'http',
  };
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
  run,
  runDueProviders,
  runForProvider,
  status,
};
