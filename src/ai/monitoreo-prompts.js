/**
 * Monitoreo Prompts - Carga y resolucion de prompts desde BD
 *
 * Lee prompts de conf_monitoreo_prompts y reemplaza placeholders
 * con datos reales del viaje, contacto y contexto.
 *
 * Usado por:
 *  - vapi-trigger.js (llamadas salientes)
 *  - monitoreo-incoming.js (llamadas entrantes)
 *
 * Cache con TTL para no consultar la BD en cada llamada.
 */

'use strict';

const { internalClient: api } = require('../api/client');

const LOG_PREFIX = '[MonitoreoPrompts]';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let _cache = { prompts: null, timestamp: 0 };

// ---------------------------------------------------------------------------
// Carga de prompts
// ---------------------------------------------------------------------------

/**
 * Obtiene todos los prompts activos de la BD (con cache).
 * @returns {Promise<Array<object>>}
 */
async function getAllPrompts() {
  const now = Date.now();
  if (_cache.prompts && (now - _cache.timestamp) < CACHE_TTL_MS) {
    return _cache.prompts;
  }

  try {
    await api.ensureToken();
    const rows = await api.query(
      `SELECT * FROM conf_monitoreo_prompts WHERE activo = 1 ORDER BY tipo, subtipo, orden ASC`
    );
    _cache = { prompts: rows || [], timestamp: now };
    return _cache.prompts;
  } catch (err) {
    console.error(LOG_PREFIX, 'Error cargando prompts:', err.message);
    return _cache.prompts || [];
  }
}

/**
 * Busca el mejor prompt para un tipo y subtipo dados.
 * @param {'entrante'|'saliente'} tipo
 * @param {string} subtipo - operador, coordinador, desconocido, paro, escalamiento, etc.
 * @returns {Promise<object|null>}
 */
async function getPrompt(tipo, subtipo) {
  const all = await getAllPrompts();
  return all.find(p => p.tipo === tipo && p.subtipo === subtipo) || null;
}

/**
 * Invalida el cache para forzar recarga.
 */
function invalidateCache() {
  _cache = { prompts: null, timestamp: 0 };
}

// ---------------------------------------------------------------------------
// Resolucion de placeholders
// ---------------------------------------------------------------------------

/**
 * Reemplaza todos los placeholders {{variable}} en un texto
 * con los valores del contexto proporcionado.
 *
 * @param {string} template - Texto con placeholders {{xxx}}
 * @param {object} context - Datos para sustituir
 * @returns {string}
 */
function resolveTemplate(template, context) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = context[key];
    if (val === undefined || val === null) return '';
    return String(val);
  });
}

/**
 * Construye el contexto completo para resolver placeholders de un prompt,
 * a partir de datos del viaje, contacto y alerta.
 *
 * @param {object} opts
 * @param {object} [opts.trip] - Datos del viaje (unidades_viajes)
 * @param {object} [opts.contact] - Datos del contacto
 * @param {object} [opts.alert] - Datos de la alerta (stop-detector)
 * @param {object} [opts.extra] - Datos adicionales (geocerca, velocidad, etc.)
 * @returns {object} Contexto con todas las variables disponibles
 */
function buildContext(opts = {}) {
  const { trip, contact, alert, extra } = opts;

  const ctx = {};

  if (trip) {
    ctx.id_viaje = trip.id || '';
    ctx.placas_unidad = trip.placas_unidad || '';
    ctx.numero_contenedor = trip.numero_contenedor || '';
    ctx.nombre_operador = trip.nombre_operador || '';
    ctx.telefono_operador = trip.telefono_operador || '';
    ctx.estado_viaje = trip.estado_actual || '';
    ctx.origen = trip.terminal || trip.link_recoleccion || '';
    ctx.destino = trip.link_destino_final || trip.link_entrega_cargado || '';
    ctx.ultima_ubicacion = (trip.ultima_lat && trip.ultima_lng)
      ? `${parseFloat(trip.ultima_lat).toFixed(4)}, ${parseFloat(trip.ultima_lng).toFixed(4)}`
      : 'desconocida';
    ctx.umbral = trip.umbral_paro_minutos || 30;
  }

  if (contact) {
    ctx.nombre_contacto = contact.nombre || contact.nombre_contacto || '';
    ctx.telefono = contact.telefono || contact.telefono_contacto || '';
    ctx.rol_contacto = contact.tipo_contacto || contact.rol || '';
  }

  if (alert) {
    ctx.minutos_detenido = alert.stoppedMinutes || 0;
    ctx.umbral = alert.umbral || ctx.umbral || 30;
    if (alert.lastLat && alert.lastLng) {
      ctx.ultima_ubicacion = `${parseFloat(alert.lastLat).toFixed(4)}, ${parseFloat(alert.lastLng).toFixed(4)}`;
    }
  }

  if (extra) {
    Object.assign(ctx, extra);
  }

  return ctx;
}

/**
 * Obtiene un prompt resuelto listo para enviar a VAPI.
 *
 * @param {'entrante'|'saliente'} tipo
 * @param {string} subtipo
 * @param {object} contextOpts - Opciones para buildContext
 * @returns {Promise<{systemPrompt: string, firstMessage: string, raw: object}|null>}
 */
async function getResolvedPrompt(tipo, subtipo, contextOpts) {
  const prompt = await getPrompt(tipo, subtipo);
  if (!prompt) {
    console.warn(LOG_PREFIX, `No se encontro prompt activo para ${tipo}/${subtipo}`);
    return null;
  }

  const ctx = buildContext(contextOpts);

  return {
    systemPrompt: resolveTemplate(prompt.prompt_sistema, ctx),
    firstMessage: resolveTemplate(prompt.primer_mensaje, ctx),
    raw: prompt,
  };
}

// ---------------------------------------------------------------------------
// Exportaciones
// ---------------------------------------------------------------------------

module.exports = {
  getAllPrompts,
  getPrompt,
  getResolvedPrompt,
  buildContext,
  resolveTemplate,
  invalidateCache,
};
