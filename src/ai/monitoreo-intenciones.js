/**
 * Monitoreo Intenciones - Clasifica transcripciones y detecta intenciones
 *
 * Al finalizar una llamada entrante, analiza la transcripcion completa
 * usando OpenAI para:
 *  1. Clasificar la intencion del llamante (reporte_falla, solicitud_eta, etc.)
 *  2. Extraer datos estructurados (tipo de falla, ETA estimado, etc.)
 *  3. Asignar prioridad
 *  4. Crear registro en op_monitoreo_intenciones para que el equipo actue
 *
 * Tambien se usa para analizar llamadas salientes y extraer el resumen
 * de lo que dijo el operador/coordinador.
 */

'use strict';

const { internalClient: api } = require('../api/client');
const monitoreoSesiones = require('./monitoreo-sesiones');

const LOG_PREFIX = '[MonitoreoIntenciones]';

// Tipos de intencion reconocidos
const TIPOS_INTENCION = [
  'reporte_falla',
  'solicitud_eta',
  'emergencia',
  'consulta_ubicacion',
  'reporte_incidente',
  'paro_justificado',
  'solicitud_asistencia',
  'cambio_ruta',
  'confirmacion_estado',
  'otro',
];

// ---------------------------------------------------------------------------
// Clasificacion de intenciones via OpenAI
// ---------------------------------------------------------------------------

/**
 * Analiza la transcripcion de una sesion y detecta intenciones.
 *
 * @param {number} sesionId - ID de la sesion en log_monitoreo_sesiones
 * @returns {Promise<Array<object>>} Intenciones detectadas y registradas
 */
async function analizarSesion(sesionId) {
  const intenciones = [];

  try {
    await api.ensureToken();

    // 1. Cargar la sesion
    const sesiones = await api.query(
      `SELECT * FROM log_monitoreo_sesiones WHERE id = ${parseInt(sesionId)} LIMIT 1`
    );
    if (!sesiones || sesiones.length === 0) {
      log('warn', `Sesion ${sesionId} no encontrada`);
      return intenciones;
    }
    const sesion = sesiones[0];

    const transcripcion = sesion.transcripcion_completa || sesion.resumen || '';
    if (!transcripcion || transcripcion.length < 10) {
      log('info', `Sesion ${sesionId}: transcripcion muy corta, saltando analisis`);
      return intenciones;
    }

    // 2. Clasificar con OpenAI
    const clasificacion = await _clasificarConOpenAI(transcripcion, sesion);

    if (!clasificacion || clasificacion.length === 0) {
      log('info', `Sesion ${sesionId}: no se detectaron intenciones accionables`);
      return intenciones;
    }

    // 3. Registrar intenciones en BD
    for (const item of clasificacion) {
      try {
        const result = await api.insert('op_monitoreo_intenciones', {
          sesion_id: sesionId,
          id_unidad_viaje: sesion.id_unidad_viaje || null,
          tipo_intencion: item.tipo,
          descripcion: item.descripcion,
          datos_extraidos: JSON.stringify(item.datos || {}),
          estado: 'pendiente',
          prioridad: item.prioridad || 'media',
        });

        const intencion = {
          id: result?.id || null,
          tipo: item.tipo,
          descripcion: item.descripcion,
          prioridad: item.prioridad,
          datos: item.datos,
        };
        intenciones.push(intencion);

        await monitoreoSesiones.registrarEvento('intencion_detectada',
          `Intencion "${item.tipo}" (${item.prioridad}) detectada en sesion ${sesionId}`, {
            sesionId,
            idUnidadViaje: sesion.id_unidad_viaje,
            datosExtra: intencion,
          });

        log('info', `Sesion ${sesionId}: intencion "${item.tipo}" (${item.prioridad}) registrada`);
      } catch (err) {
        log('error', `Error registrando intencion para sesion ${sesionId}:`, err.message);
      }
    }
  } catch (err) {
    log('error', `Error analizando sesion ${sesionId}:`, err.message);
  }

  return intenciones;
}

/**
 * Usa OpenAI (via la API .NET) para clasificar la transcripcion.
 * @private
 */
async function _clasificarConOpenAI(transcripcion, sesion) {
  const tiposStr = TIPOS_INTENCION.join(', ');

  const prompt = `Eres un sistema de clasificacion de intenciones para una empresa de logistica (JELABBC).

Analiza la siguiente transcripcion de una llamada telefonica y extrae las intenciones del llamante.

CONTEXTO:
- Direccion de la llamada: ${sesion.direccion}
- Rol del contacto: ${sesion.rol_contacto || 'desconocido'}
- Viaje asociado: ${sesion.id_unidad_viaje || 'ninguno'}

TRANSCRIPCION:
"""
${transcripcion.substring(0, 3000)}
"""

TIPOS DE INTENCION VALIDOS: ${tiposStr}

PRIORIDADES VALIDAS: baja, media, alta, critica

Responde UNICAMENTE con un JSON array. Cada elemento debe tener:
- tipo: uno de los tipos validos
- descripcion: descripcion breve de la intencion (max 200 chars)
- prioridad: baja, media, alta o critica
- datos: objeto con datos extraidos relevantes (tipo_falla, eta_estimado, ubicacion_reportada, etc.)

Si no hay intenciones accionables (la llamada fue solo informativa o de confirmacion), responde con un array vacio [].

Responde SOLO el JSON, sin markdown ni explicaciones.`;

  try {
    const response = await api.openai({
      messages: [
        { role: 'system', content: 'Eres un clasificador de intenciones. Responde solo JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    // Extraer JSON de la respuesta
    const text = typeof response === 'string' ? response
      : response?.choices?.[0]?.message?.content
      || response?.content
      || response?.result
      || JSON.stringify(response);

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log('info', 'OpenAI no retorno JSON array valido');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // Validar y sanitizar
    return parsed
      .filter(item => item.tipo && TIPOS_INTENCION.includes(item.tipo))
      .map(item => ({
        tipo: item.tipo,
        descripcion: String(item.descripcion || '').substring(0, 500),
        prioridad: ['baja', 'media', 'alta', 'critica'].includes(item.prioridad)
          ? item.prioridad : 'media',
        datos: item.datos || {},
      }));
  } catch (err) {
    log('error', 'Error en clasificacion OpenAI:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/**
 * Obtiene intenciones pendientes de procesar.
 * @param {object} [filtros]
 * @param {number} [filtros.idUnidadViaje]
 * @param {string} [filtros.prioridad]
 * @param {number} [filtros.limit]
 * @returns {Promise<Array>}
 */
async function obtenerPendientes(filtros = {}) {
  try {
    await api.ensureToken();

    const conditions = ["estado = 'pendiente'"];
    if (filtros.idUnidadViaje) {
      conditions.push(`id_unidad_viaje = ${parseInt(filtros.idUnidadViaje)}`);
    }
    if (filtros.prioridad) {
      conditions.push(`prioridad = '${filtros.prioridad}'`);
    }

    const limit = filtros.limit || 50;
    const where = conditions.join(' AND ');

    return await api.query(
      `SELECT oi.*, ms.telefono, ms.nombre_contacto, ms.direccion
       FROM op_monitoreo_intenciones oi
       LEFT JOIN log_monitoreo_sesiones ms ON ms.id = oi.sesion_id
       WHERE ${where}
       ORDER BY FIELD(oi.prioridad, 'critica','alta','media','baja'), oi.creado_en DESC
       LIMIT ${limit}`
    ) || [];
  } catch (err) {
    log('error', 'Error obteniendo intenciones pendientes:', err.message);
    return [];
  }
}

/**
 * Marca una intencion como procesada.
 * @param {number} intencionId
 * @param {string} procesadaPor
 * @param {string} [notas]
 */
async function procesarIntencion(intencionId, procesadaPor, notas) {
  try {
    await api.ensureToken();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await api.update('op_monitoreo_intenciones', intencionId, {
      estado: 'procesada',
      procesada_en: now,
      procesada_por: procesadaPor,
      notas_procesamiento: notas || null,
    });

    await monitoreoSesiones.registrarEvento('intencion_procesada',
      `Intencion ${intencionId} procesada por ${procesadaPor}`, {
        datosExtra: { notas },
      });
  } catch (err) {
    log('error', `Error procesando intencion ${intencionId}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(level, ...args) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(LOG_PREFIX, ...args);
}

module.exports = {
  analizarSesion,
  obtenerPendientes,
  procesarIntencion,
  TIPOS_INTENCION,
};
