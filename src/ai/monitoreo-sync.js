/**
 * Monitoreo Sync - Sincroniza numeros autorizados con contactos_viaje
 *
 * Lee contactos_viaje de viajes activos y los sincroniza con
 * conf_monitoreo_numeros para que el sistema sepa quien llama
 * y a que viaje pertenece.
 *
 * Se ejecuta periodicamente desde el cron o manualmente.
 */

'use strict';

const { internalClient: api } = require('../api/client');

const LOG_PREFIX = '[MonitoreoSync]';

// ---------------------------------------------------------------------------
// Normalizacion de telefonos
// ---------------------------------------------------------------------------

/**
 * Normaliza un telefono a formato E.164.
 * @param {string} phone
 * @returns {string}
 */
function normalizeE164(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('52') && cleaned.length >= 12) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = '+52' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Sincronizacion principal
// ---------------------------------------------------------------------------

/**
 * Sincroniza contactos de viajes activos con conf_monitoreo_numeros.
 *
 * Logica:
 *  1. Lee todos los contactos de viajes con estado 'en_ruta' o 'creado'
 *  2. Lee los numeros ya registrados en conf_monitoreo_numeros
 *  3. Inserta los que no existen, actualiza los que cambiaron
 *  4. Desactiva numeros de viajes que ya no estan activos
 *
 * @returns {Promise<{inserted: number, updated: number, deactivated: number}>}
 */
async function syncNumbers() {
  const result = { inserted: 0, updated: 0, deactivated: 0, errors: 0 };

  try {
    await api.ensureToken();

    // 1. Contactos de viajes activos
    const contacts = await api.query(
      `SELECT cv.id AS contact_id, cv.id_unidad_viaje, cv.tipo_contacto,
              cv.nombre_contacto, cv.telefono_contacto,
              uv.estado_actual
       FROM contactos_viaje cv
       INNER JOIN unidades_viajes uv ON uv.id = cv.id_unidad_viaje
       WHERE uv.estado_actual IN ('en_ruta', 'creado', 'detenido', 'proximo_destino')
         AND cv.telefono_contacto IS NOT NULL
         AND cv.telefono_contacto != ''`
    );

    if (!contacts || contacts.length === 0) {
      log('info', 'No hay contactos activos para sincronizar');
      return result;
    }

    // Tambien incluir telefonos directos de unidades_viajes
    const tripPhones = await api.query(
      `SELECT id AS id_unidad_viaje,
              nombre_operador, telefono_operador,
              telefono_cliente, telefono_monitor
       FROM unidades_viajes
       WHERE estado_actual IN ('en_ruta', 'creado', 'detenido', 'proximo_destino')
         AND (telefono_operador IS NOT NULL OR telefono_cliente IS NOT NULL)`
    );

    // 2. Numeros existentes
    const existing = await api.query(
      `SELECT id, telefono_e164, id_unidad_viaje, rol, activo
       FROM conf_monitoreo_numeros`
    );
    const existingMap = new Map(
      (existing || []).map(n => [`${n.telefono_e164}_${n.id_unidad_viaje}`, n])
    );

    // 3. Procesar contactos de contactos_viaje
    const processedKeys = new Set();

    for (const c of contacts) {
      const e164 = normalizeE164(c.telefono_contacto);
      if (!e164 || e164.length < 10) continue;

      const key = `${e164}_${c.id_unidad_viaje}`;
      processedKeys.add(key);

      const existingNum = existingMap.get(key);

      if (!existingNum) {
        try {
          await api.insert('conf_monitoreo_numeros', {
            telefono: c.telefono_contacto,
            telefono_e164: e164,
            nombre: c.nombre_contacto || null,
            rol: c.tipo_contacto,
            id_unidad_viaje: c.id_unidad_viaje,
            activo: 1,
          });
          result.inserted++;
        } catch (err) {
          if (!err.message?.includes('Duplicate')) {
            log('warn', `Error insertando numero ${e164}: ${err.message}`);
            result.errors++;
          }
        }
      } else if (!existingNum.activo) {
        try {
          await api.update('conf_monitoreo_numeros', existingNum.id, { activo: 1 });
          result.updated++;
        } catch {
          result.errors++;
        }
      }
    }

    // 3b. Procesar telefonos directos de unidades_viajes
    for (const trip of (tripPhones || [])) {
      const phones = [
        { tel: trip.telefono_operador, nombre: trip.nombre_operador, rol: 'operador' },
        { tel: trip.telefono_cliente, nombre: null, rol: 'cliente' },
        { tel: trip.telefono_monitor, nombre: null, rol: 'coordinador1' },
      ];

      for (const p of phones) {
        if (!p.tel) continue;
        const e164 = normalizeE164(p.tel);
        if (!e164 || e164.length < 10) continue;

        const key = `${e164}_${trip.id_unidad_viaje}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        const existingNum = existingMap.get(key);
        if (!existingNum) {
          try {
            await api.insert('conf_monitoreo_numeros', {
              telefono: p.tel,
              telefono_e164: e164,
              nombre: p.nombre || null,
              rol: p.rol,
              id_unidad_viaje: trip.id_unidad_viaje,
              activo: 1,
            });
            result.inserted++;
          } catch (err) {
            if (!err.message?.includes('Duplicate')) {
              result.errors++;
            }
          }
        }
      }
    }

    // 4. Desactivar numeros de viajes finalizados
    const activeViajes = await api.query(
      `SELECT DISTINCT id_unidad_viaje
       FROM conf_monitoreo_numeros
       WHERE activo = 1 AND id_unidad_viaje IS NOT NULL`
    );

    for (const row of (activeViajes || [])) {
      const key = `_${row.id_unidad_viaje}`;
      const isActive = [...processedKeys].some(k => k.endsWith(key));
      if (!isActive) {
        try {
          const toDeactivate = await api.query(
            `SELECT id FROM conf_monitoreo_numeros
             WHERE id_unidad_viaje = ${row.id_unidad_viaje} AND activo = 1`
          );
          for (const n of (toDeactivate || [])) {
            await api.update('conf_monitoreo_numeros', n.id, { activo: 0 });
            result.deactivated++;
          }
        } catch {
          result.errors++;
        }
      }
    }

    log('info', `Sync completado: +${result.inserted} nuevos, ~${result.updated} reactivados, -${result.deactivated} desactivados`);
  } catch (err) {
    log('error', 'Error en syncNumbers:', err.message);
  }

  return result;
}

/**
 * Busca un numero en conf_monitoreo_numeros para identificar
 * quien esta llamando (llamadas entrantes).
 *
 * @param {string} phoneNumber - Numero en cualquier formato
 * @returns {Promise<object|null>} Datos del numero si existe
 */
async function lookupNumber(phoneNumber) {
  const e164 = normalizeE164(phoneNumber);
  if (!e164) return null;

  try {
    await api.ensureToken();
    const rows = await api.query(
      `SELECT mn.*, uv.placas_unidad, uv.numero_contenedor,
              uv.nombre_operador, uv.estado_actual,
              uv.ultima_lat, uv.ultima_lng
       FROM conf_monitoreo_numeros mn
       LEFT JOIN unidades_viajes uv ON uv.id = mn.id_unidad_viaje
       WHERE mn.telefono_e164 = '${e164}'
         AND mn.activo = 1
       ORDER BY mn.id DESC
       LIMIT 1`
    );
    return rows && rows.length > 0 ? rows[0] : null;
  } catch (err) {
    log('error', `Error en lookupNumber(${e164}):`, err.message);
    return null;
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
  syncNumbers,
  lookupNumber,
  normalizeE164,
};
