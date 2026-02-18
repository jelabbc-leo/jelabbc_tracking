/**
 * Monitoreo Sesiones - Gestiona sesiones de llamada (entrantes y salientes)
 *
 * Cada llamada (entrante o saliente) genera una sesion en log_monitoreo_sesiones.
 * Este modulo maneja el ciclo de vida: crear, actualizar, completar, fallar.
 *
 * Tambien registra transcripciones turno a turno y eventos del sistema.
 */

'use strict';

const { internalClient: api } = require('../api/client');

const LOG_PREFIX = '[MonitoreoSesiones]';

// ---------------------------------------------------------------------------
// Crear sesion
// ---------------------------------------------------------------------------

/**
 * Crea una nueva sesion de llamada.
 *
 * @param {object} opts
 * @param {'entrante'|'saliente'} opts.direccion
 * @param {string} [opts.vapiCallId]
 * @param {string} [opts.telefono]
 * @param {string} [opts.telefonoE164]
 * @param {string} [opts.nombreContacto]
 * @param {string} [opts.rolContacto]
 * @param {number} [opts.idUnidadViaje]
 * @param {number} [opts.promptId]
 * @param {string} [opts.motivo]
 * @returns {Promise<number|null>} ID de la sesion creada, o null si fallo
 */
async function crearSesion(opts) {
  try {
    await api.ensureToken();

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const result = await api.insert('log_monitoreo_sesiones', {
      vapi_call_id: opts.vapiCallId || null,
      direccion: opts.direccion,
      estado: 'iniciada',
      telefono: opts.telefono || null,
      telefono_e164: opts.telefonoE164 || null,
      nombre_contacto: opts.nombreContacto || null,
      rol_contacto: opts.rolContacto || null,
      id_unidad_viaje: opts.idUnidadViaje || null,
      prompt_id: opts.promptId || null,
      motivo: opts.motivo || null,
      inicio_llamada: now,
    });

    // La API .NET retorna {id: X} en el insert
    const id = result?.id || result?.Id || null;
    if (id) {
      log('info', `Sesion ${id} creada (${opts.direccion}, ${opts.rolContacto || 'unknown'})`);
    }
    return id;
  } catch (err) {
    log('error', 'Error creando sesion:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Actualizar sesion
// ---------------------------------------------------------------------------

/**
 * Actualiza campos de una sesion existente.
 * @param {number} sesionId
 * @param {object} data - Campos a actualizar
 */
async function actualizarSesion(sesionId, data) {
  if (!sesionId) return;
  try {
    await api.ensureToken();
    await api.update('log_monitoreo_sesiones', sesionId, data);
  } catch (err) {
    log('error', `Error actualizando sesion ${sesionId}:`, err.message);
  }
}

/**
 * Marca una sesion como completada con resumen y transcripcion.
 * @param {number} sesionId
 * @param {object} opts
 * @param {string} [opts.resumen]
 * @param {string} [opts.transcripcionCompleta]
 * @param {number} [opts.duracionSegundos]
 * @param {object} [opts.metadata] - Datos extra de VAPI
 */
async function completarSesion(sesionId, opts = {}) {
  if (!sesionId) return;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await actualizarSesion(sesionId, {
    estado: 'completada',
    fin_llamada: now,
    resumen: opts.resumen || null,
    transcripcion_completa: opts.transcripcionCompleta || null,
    duracion_segundos: opts.duracionSegundos || null,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
  });
  log('info', `Sesion ${sesionId} completada (${opts.duracionSegundos || 0}s)`);
}

/**
 * Marca una sesion como fallida.
 * @param {number} sesionId
 * @param {string} [motivo]
 */
async function fallarSesion(sesionId, motivo) {
  if (!sesionId) return;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await actualizarSesion(sesionId, {
    estado: 'fallida',
    fin_llamada: now,
    resumen: motivo ? `ERROR: ${motivo}` : null,
  });
  log('warn', `Sesion ${sesionId} marcada como fallida: ${motivo}`);
}

// ---------------------------------------------------------------------------
// Buscar sesion por vapi_call_id
// ---------------------------------------------------------------------------

/**
 * Busca una sesion por su vapi_call_id (para correlacionar webhooks).
 * @param {string} vapiCallId
 * @returns {Promise<object|null>}
 */
async function buscarPorVapiCallId(vapiCallId) {
  if (!vapiCallId) return null;
  try {
    await api.ensureToken();
    const rows = await api.query(
      `SELECT * FROM log_monitoreo_sesiones
       WHERE vapi_call_id = '${vapiCallId}'
       LIMIT 1`
    );
    return rows && rows.length > 0 ? rows[0] : null;
  } catch (err) {
    log('error', `Error buscando sesion por vapiCallId ${vapiCallId}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transcripciones
// ---------------------------------------------------------------------------

/**
 * Registra un turno de transcripcion.
 * @param {number} sesionId
 * @param {'usuario'|'asistente'|'sistema'} rol
 * @param {string} contenido
 * @param {object} [opts]
 * @param {number} [opts.duracionAudioMs]
 * @param {number} [opts.confianza]
 */
async function registrarTranscripcion(sesionId, rol, contenido, opts = {}) {
  if (!sesionId || !contenido) return;
  try {
    await api.insert('log_monitoreo_transcripciones', {
      sesion_id: sesionId,
      rol,
      contenido,
      duracion_audio_ms: opts.duracionAudioMs || null,
      confianza: opts.confianza || null,
    });
  } catch (err) {
    log('error', `Error registrando transcripcion para sesion ${sesionId}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Eventos del sistema de monitoreo
// ---------------------------------------------------------------------------

/**
 * Registra un evento del sistema de monitoreo.
 * @param {string} tipo - Uno de los ENUM de log_monitoreo_eventos
 * @param {string} [descripcion]
 * @param {object} [opts]
 * @param {number} [opts.idUnidadViaje]
 * @param {number} [opts.sesionId]
 * @param {object} [opts.datosExtra]
 */
async function registrarEvento(tipo, descripcion, opts = {}) {
  try {
    await api.ensureToken();
    await api.insert('log_monitoreo_eventos', {
      tipo,
      descripcion: descripcion || null,
      datos_extra: opts.datosExtra ? JSON.stringify(opts.datosExtra) : null,
      id_unidad_viaje: opts.idUnidadViaje || null,
      sesion_id: opts.sesionId || null,
    });
  } catch (err) {
    log('error', `Error registrando evento ${tipo}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Sesiones zombie (watchdog)
// ---------------------------------------------------------------------------

/**
 * Encuentra sesiones que llevan mas de X minutos en estado 'iniciada'
 * o 'en_curso' y las marca como zombie.
 * @param {number} [timeoutMinutes=15]
 * @returns {Promise<number>} Cantidad de sesiones marcadas como zombie
 */
async function marcarZombies(timeoutMinutes = 15) {
  try {
    await api.ensureToken();
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');

    const zombies = await api.query(
      `SELECT id, vapi_call_id, direccion, telefono
       FROM log_monitoreo_sesiones
       WHERE estado IN ('iniciada', 'en_curso')
         AND creado_en < '${cutoff}'`
    );

    if (!zombies || zombies.length === 0) return 0;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const z of zombies) {
      await api.update('log_monitoreo_sesiones', z.id, {
        estado: 'zombie',
        fin_llamada: now,
        resumen: `Sesion marcada como zombie (timeout ${timeoutMinutes} min)`,
      });

      await registrarEvento('sesion_zombie', `Sesion ${z.id} marcada como zombie`, {
        sesionId: z.id,
        datosExtra: { vapiCallId: z.vapi_call_id, telefono: z.telefono },
      });
    }

    log('warn', `${zombies.length} sesiones zombie detectadas y marcadas`);
    return zombies.length;
  } catch (err) {
    log('error', 'Error en marcarZombies:', err.message);
    return 0;
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
  crearSesion,
  actualizarSesion,
  completarSesion,
  fallarSesion,
  buscarPorVapiCallId,
  registrarTranscripcion,
  registrarEvento,
  marcarZombies,
};
