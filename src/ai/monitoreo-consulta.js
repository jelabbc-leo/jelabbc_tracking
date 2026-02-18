/**
 * Monitoreo Consulta Inteligente - Responde preguntas sobre viajes
 *
 * Cuando un operador o coordinador llama y pregunta algo sobre un viaje
 * (ubicacion, ETA, estado, eventos recientes), este modulo:
 *  1. Consulta datos reales de la BD
 *  2. Usa geocodificacion inversa para convertir coords a direccion
 *  3. Construye un contexto con datos reales
 *  4. Usa OpenAI para generar una respuesta natural
 *
 * REGLA CLAVE: Solo responde con datos que existen en la BD.
 * Nunca inventa ubicaciones, tiempos ni estados.
 */

'use strict';

const { internalClient: api } = require('../api/client');
const axios = require('axios');

const LOG_PREFIX = '[MonitoreoConsulta]';
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// Cache de geocodificacion para no repetir llamadas
const _geocodeCache = new Map();
const GEOCODE_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

// ---------------------------------------------------------------------------
// Consulta inteligente de tracking
// ---------------------------------------------------------------------------

/**
 * Genera una respuesta inteligente sobre un viaje usando datos reales.
 *
 * @param {number} tripId - ID del viaje
 * @param {string} pregunta - Lo que pregunto el usuario
 * @returns {Promise<{respuesta: string, datos: object}>}
 */
async function consultarViaje(tripId, pregunta) {
  try {
    await api.ensureToken();

    // 1. Cargar datos completos del viaje
    const datos = await _cargarDatosCompletos(tripId);
    if (!datos.viaje) {
      return {
        respuesta: 'No se encontro informacion del viaje solicitado.',
        datos: {},
      };
    }

    // 2. Geocodificar ultima posicion si hay coords
    if (datos.viaje.ultima_lat && datos.viaje.ultima_lng) {
      datos.ubicacionTexto = await geocodificarInverso(
        parseFloat(datos.viaje.ultima_lat),
        parseFloat(datos.viaje.ultima_lng)
      );
    }

    // 3. Construir contexto para OpenAI
    const contexto = _construirContexto(datos);

    // 4. Generar respuesta con OpenAI
    const respuesta = await _generarRespuesta(contexto, pregunta);

    return { respuesta, datos };
  } catch (err) {
    log('error', `Error consultando viaje ${tripId}:`, err.message);
    return {
      respuesta: 'Hubo un error al consultar la informacion del viaje.',
      datos: {},
    };
  }
}

/**
 * Carga todos los datos relevantes de un viaje.
 * @private
 */
async function _cargarDatosCompletos(tripId) {
  const id = parseInt(tripId);
  const datos = {};

  // Viaje principal
  const viajes = await api.query(
    `SELECT * FROM unidades_viajes WHERE id = ${id} LIMIT 1`
  );
  datos.viaje = viajes?.[0] || null;
  if (!datos.viaje) return datos;

  // Ultimas coordenadas (ultimas 5)
  datos.ultimasCoords = await api.query(
    `SELECT latitud, longitud, velocidad, fecha_extraccion, fecha_gps
     FROM op_coordinates
     WHERE id_unidad_viaje = ${id}
     ORDER BY fecha_extraccion DESC
     LIMIT 5`
  ) || [];

  // Eventos recientes (ultimos 10)
  datos.eventosRecientes = await api.query(
    `SELECT tipo_evento, descripcion, ocurrido_en
     FROM eventos_unidad
     WHERE id_unidad_viaje = ${id}
     ORDER BY ocurrido_en DESC
     LIMIT 10`
  ) || [];

  // Contactos
  datos.contactos = await api.query(
    `SELECT tipo_contacto, nombre_contacto, telefono_contacto
     FROM contactos_viaje
     WHERE id_unidad_viaje = ${id}`
  ) || [];

  // Llamadas IA recientes
  datos.llamadasRecientes = await api.query(
    `SELECT tipo, resultado, resumen_conversacion, creado_en
     FROM log_ai_calls
     WHERE id_unidad_viaje = ${id}
     ORDER BY creado_en DESC
     LIMIT 5`
  ) || [];

  return datos;
}

/**
 * Construye un contexto textual con datos reales para OpenAI.
 * @private
 */
function _construirContexto(datos) {
  const v = datos.viaje;
  const lines = [];

  lines.push(`DATOS DEL VIAJE #${v.id}:`);
  lines.push(`- Placas: ${v.placas_unidad || 'N/A'}`);
  lines.push(`- Contenedor: ${v.numero_contenedor || 'N/A'}`);
  lines.push(`- Operador: ${v.nombre_operador || 'N/A'}`);
  lines.push(`- Estado: ${v.estado_actual}`);
  lines.push(`- Pedimento: ${v.pedimento || 'N/A'}`);
  lines.push(`- Terminal: ${v.terminal || 'N/A'}`);

  if (v.ultima_lat && v.ultima_lng) {
    lines.push(`- Ultima posicion GPS: ${parseFloat(v.ultima_lat).toFixed(6)}, ${parseFloat(v.ultima_lng).toFixed(6)}`);
    if (datos.ubicacionTexto) {
      lines.push(`- Ubicacion aproximada: ${datos.ubicacionTexto}`);
    }
  }

  if (v.ultima_actualizacion) {
    lines.push(`- Ultima actualizacion GPS: ${v.ultima_actualizacion}`);
  }

  if (datos.ultimasCoords.length > 0) {
    const ultima = datos.ultimasCoords[0];
    const vel = ultima.velocidad ? `${parseFloat(ultima.velocidad).toFixed(1)} km/h` : 'desconocida';
    lines.push(`- Velocidad actual: ${vel}`);
  }

  if (datos.eventosRecientes.length > 0) {
    lines.push('\nEVENTOS RECIENTES:');
    for (const e of datos.eventosRecientes.slice(0, 5)) {
      lines.push(`- [${e.ocurrido_en}] ${e.tipo_evento}: ${e.descripcion || ''}`);
    }
  }

  if (datos.llamadasRecientes.length > 0) {
    lines.push('\nLLAMADAS IA RECIENTES:');
    for (const l of datos.llamadasRecientes.slice(0, 3)) {
      lines.push(`- [${l.creado_en}] ${l.tipo} → ${l.resultado}: ${l.resumen_conversacion?.substring(0, 100) || 'sin resumen'}`);
    }
  }

  if (datos.contactos.length > 0) {
    lines.push('\nCONTACTOS DEL VIAJE:');
    for (const c of datos.contactos) {
      lines.push(`- ${c.tipo_contacto}: ${c.nombre_contacto || 'N/A'} (${c.telefono_contacto || 'N/A'})`);
    }
  }

  return lines.join('\n');
}

/**
 * Genera una respuesta natural usando OpenAI.
 * @private
 */
async function _generarRespuesta(contexto, pregunta) {
  try {
    const response = await api.openai({
      messages: [
        {
          role: 'system',
          content: `Eres un asistente de JELABBC Logistica. Respondes preguntas sobre viajes de transporte usando UNICAMENTE los datos que se te proporcionan.

REGLAS ESTRICTAS:
- Solo usa la informacion del CONTEXTO proporcionado. No inventes datos.
- Si no tienes un dato, dilo claramente: "No tengo esa informacion disponible."
- Responde en espanol de Mexico, de forma clara y concisa.
- No incluyas coordenadas GPS exactas en la respuesta, usa la ubicacion textual.
- Responde en maximo 3-4 oraciones.
- Si te preguntan por ETA y no tienes datos suficientes, indica que no puedes calcularlo con precision.`,
        },
        {
          role: 'user',
          content: `CONTEXTO DEL VIAJE:\n${contexto}\n\nPREGUNTA: ${pregunta}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const text = typeof response === 'string' ? response
      : response?.choices?.[0]?.message?.content
      || response?.content
      || response?.result
      || 'No pude generar una respuesta.';

    return text;
  } catch (err) {
    log('error', 'Error generando respuesta OpenAI:', err.message);
    return 'No pude procesar tu consulta en este momento.';
  }
}

// ---------------------------------------------------------------------------
// Geocodificacion inversa (C13)
// ---------------------------------------------------------------------------

/**
 * Convierte coordenadas GPS a una direccion legible usando Google Maps API.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string|null>} Direccion legible o null
 */
async function geocodificarInverso(lat, lng) {
  if (!lat || !lng || !GOOGLE_MAPS_KEY) return null;

  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  const cached = _geocodeCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < GEOCODE_CACHE_TTL) {
    return cached.address;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_KEY}&language=es`;

    const response = await axios.get(url, { timeout: 5000 });
    const results = response.data?.results;

    if (results && results.length > 0) {
      const address = results[0].formatted_address;
      _geocodeCache.set(cacheKey, { address, timestamp: Date.now() });

      await _registrarGeocodificacion(lat, lng, address);

      return address;
    }

    return null;
  } catch (err) {
    log('error', `Error en geocodificacion inversa (${lat}, ${lng}):`, err.message);
    return null;
  }
}

/**
 * Registra una geocodificacion en el log de eventos.
 * @private
 */
async function _registrarGeocodificacion(lat, lng, address) {
  try {
    const monitoreoSesiones = require('./monitoreo-sesiones');
    await monitoreoSesiones.registrarEvento('geocodificacion',
      `Geocodificacion: (${lat.toFixed(4)}, ${lng.toFixed(4)}) → ${address}`, {
        datosExtra: { lat, lng, address },
      });
  } catch {
    // No critico
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
  consultarViaje,
  geocodificarInverso,
};
