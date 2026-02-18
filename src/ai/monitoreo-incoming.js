/**
 * Monitoreo Incoming - Manejo de llamadas entrantes via VAPI webhook
 *
 * Cuando alguien llama al numero de JELABBC:
 *  1. VAPI recibe la llamada y envia un webhook "assistant-request"
 *  2. Este modulo identifica quien llama (via conf_monitoreo_numeros)
 *  3. Selecciona el prompt adecuado (operador, coordinador, desconocido)
 *  4. Crea una sesion en log_monitoreo_sesiones
 *  5. Retorna la configuracion del asistente a VAPI
 *
 * Tambien procesa el "end-of-call-report" cuando la llamada termina
 * para guardar transcripcion, resumen y actualizar la sesion.
 */

'use strict';

const monitoreoPrompts = require('./monitoreo-prompts');
const monitoreoSesiones = require('./monitoreo-sesiones');
const monitoreoSync = require('./monitoreo-sync');
const monitoreoIntenciones = require('./monitoreo-intenciones');

const LOG_PREFIX = '[MonitoreoIncoming]';

const VAPI_VOICE_ID = 'YKUjKbMlejgvkOZlnnvt';
const VAPI_VOICE_MODEL = 'eleven_turbo_v2_5';

// ---------------------------------------------------------------------------
// Handler principal del webhook VAPI
// ---------------------------------------------------------------------------

/**
 * Procesa un evento del webhook VAPI.
 * VAPI envia diferentes tipos de mensajes:
 *  - assistant-request: al inicio de una llamada entrante, pide config del asistente
 *  - end-of-call-report: al finalizar cualquier llamada, con transcripcion y resumen
 *  - status-update: cambios de estado de la llamada
 *  - transcript: transcripcion en tiempo real
 *
 * @param {object} payload - Body del webhook
 * @returns {Promise<object|null>} Respuesta para VAPI (solo en assistant-request)
 */
async function handleWebhook(payload) {
  const messageType = payload?.message?.type || payload?.type;

  switch (messageType) {
    case 'assistant-request':
      return _handleAssistantRequest(payload);

    case 'end-of-call-report':
      await _handleEndOfCallReport(payload);
      return null;

    case 'status-update':
      await _handleStatusUpdate(payload);
      return null;

    case 'transcript':
      await _handleTranscript(payload);
      return null;

    default:
      log('info', `Webhook recibido: tipo=${messageType}`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// assistant-request: VAPI pide config del asistente para llamada entrante
// ---------------------------------------------------------------------------

async function _handleAssistantRequest(payload) {
  const msg = payload.message || payload;
  const call = msg.call || {};
  const customerNumber = call.customer?.number || '';

  log('info', `Llamada entrante de: ${customerNumber}`);

  // 1. Identificar quien llama
  const caller = await monitoreoSync.lookupNumber(customerNumber);
  const rol = caller?.rol || 'desconocido';
  const subtipo = ['operador'].includes(rol) ? 'operador'
    : ['coordinador1', 'coordinador2', 'coordinador3'].includes(rol) ? 'coordinador'
    : 'desconocido';

  log('info', `Caller identificado: ${caller?.nombre || 'desconocido'} (${rol}), subtipo=${subtipo}`);

  // 2. Obtener prompt
  const resolved = await monitoreoPrompts.getResolvedPrompt('entrante', subtipo, {
    trip: caller ? {
      id: caller.id_unidad_viaje,
      placas_unidad: caller.placas_unidad,
      numero_contenedor: caller.numero_contenedor,
      nombre_operador: caller.nombre_operador,
      estado_actual: caller.estado_actual,
      ultima_lat: caller.ultima_lat,
      ultima_lng: caller.ultima_lng,
    } : null,
    contact: {
      nombre: caller?.nombre || '',
      telefono: customerNumber,
      tipo_contacto: rol,
    },
    extra: { telefono: customerNumber },
  });

  // 3. Crear sesion
  const sesionId = await monitoreoSesiones.crearSesion({
    direccion: 'entrante',
    vapiCallId: call.id || null,
    telefono: customerNumber,
    telefonoE164: monitoreoSync.normalizeE164(customerNumber),
    nombreContacto: caller?.nombre || null,
    rolContacto: rol,
    idUnidadViaje: caller?.id_unidad_viaje || null,
    promptId: resolved?.raw?.id || null,
    motivo: `Llamada entrante de ${rol}`,
  });

  await monitoreoSesiones.registrarEvento('sesion_creada',
    `Llamada entrante de ${customerNumber} (${rol})`, {
      sesionId,
      idUnidadViaje: caller?.id_unidad_viaje || null,
      datosExtra: { callerName: caller?.nombre, subtipo },
    });

  // 4. Construir respuesta para VAPI
  const systemPrompt = resolved?.systemPrompt
    || `Eres un asistente de JELABBC Logistica. Una persona esta llamando desde ${customerNumber}. Pregunta en que puedes ayudar.`;
  const firstMessage = resolved?.firstMessage
    || 'Bienvenido al sistema de monitoreo de JELABBC. ¿En que puedo ayudarle?';

  return {
    assistant: {
      name: `JELABBC Entrante - ${subtipo}`,
      firstMessage,
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
        ],
        temperature: 0.5,
        maxTokens: 250,
      },
      voice: {
        provider: '11labs',
        voiceId: VAPI_VOICE_ID,
        model: VAPI_VOICE_MODEL,
        stability: 0.5,
        similarityBoost: 0.75,
      },
      transcriber: {
        provider: 'deepgram',
        model: 'nova-3',
        language: 'es',
        endpointing: 150,
      },
      endCallFunctionEnabled: true,
      endCallMessage: 'Gracias por llamar a JELABBC. Que tenga buen dia.',
      maxDurationSeconds: 180,
      silenceTimeoutSeconds: 30,
      metadata: {
        sesionId: sesionId ? String(sesionId) : null,
        callerRole: rol,
        tripId: caller?.id_unidad_viaje ? String(caller.id_unidad_viaje) : null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// end-of-call-report: llamada terminada (entrante o saliente)
// ---------------------------------------------------------------------------

async function _handleEndOfCallReport(payload) {
  const msg = payload.message || payload;
  const call = msg.call || {};
  const callId = call.id;

  if (!callId) {
    log('warn', 'end-of-call-report sin call.id');
    return;
  }

  log('info', `End-of-call report para call ${callId}`);

  // Buscar sesion por vapi_call_id
  let sesion = await monitoreoSesiones.buscarPorVapiCallId(callId);

  // Si no existe sesion (llamada saliente vieja sin sesion), buscar por metadata
  if (!sesion && call.metadata?.sesionId) {
    // ya no aplica, pero lo dejamos por compatibilidad
  }

  const transcript = msg.transcript || '';
  const summary = msg.summary || msg.analysis?.summary || '';
  const duration = call.duration || msg.durationSeconds || 0;
  const endedReason = call.endedReason || msg.endedReason || '';
  const cost = msg.cost || call.cost || null;

  if (sesion) {
    await monitoreoSesiones.completarSesion(sesion.id, {
      resumen: summary || null,
      transcripcionCompleta: transcript || null,
      duracionSegundos: Math.round(duration),
      metadata: { endedReason, cost },
    });

    // Registrar transcripcion por turnos si hay messages
    const messages = msg.messages || [];
    for (const m of messages) {
      if (m.role && m.content) {
        const rol = m.role === 'assistant' ? 'asistente'
          : m.role === 'user' ? 'usuario'
          : 'sistema';
        await monitoreoSesiones.registrarTranscripcion(sesion.id, rol, m.content);
      }
    }

    await monitoreoSesiones.registrarEvento('sesion_completada',
      `Llamada ${sesion.direccion} completada (${Math.round(duration)}s, ${endedReason})`, {
        sesionId: sesion.id,
        idUnidadViaje: sesion.id_unidad_viaje,
        datosExtra: { endedReason, cost, hasSummary: !!summary },
      });

    // Analizar intenciones si es llamada entrante con transcripcion
    if (sesion.direccion === 'entrante' && (transcript || summary)) {
      try {
        const intenciones = await monitoreoIntenciones.analizarSesion(sesion.id);
        if (intenciones.length > 0) {
          log('info', `Sesion ${sesion.id}: ${intenciones.length} intenciones detectadas`);
        }
      } catch (intErr) {
        log('error', `Error analizando intenciones de sesion ${sesion.id}:`, intErr.message);
      }
    }
  } else {
    log('warn', `No se encontro sesion para call ${callId}, registrando evento suelto`);
    await monitoreoSesiones.registrarEvento('sesion_completada',
      `Llamada sin sesion completada (call=${callId}, ${Math.round(duration)}s)`, {
        datosExtra: { callId, endedReason, transcript: transcript?.substring(0, 500) },
      });
  }
}

// ---------------------------------------------------------------------------
// status-update: cambio de estado de la llamada
// ---------------------------------------------------------------------------

async function _handleStatusUpdate(payload) {
  const msg = payload.message || payload;
  const status = msg.status || '';
  const callId = msg.call?.id || '';

  if (!callId) return;

  const sesion = await monitoreoSesiones.buscarPorVapiCallId(callId);
  if (!sesion) return;

  if (status === 'in-progress') {
    await monitoreoSesiones.actualizarSesion(sesion.id, { estado: 'en_curso' });
  } else if (status === 'ended') {
    // end-of-call-report se encargara de completar la sesion
  }
}

// ---------------------------------------------------------------------------
// transcript: transcripcion en tiempo real
// ---------------------------------------------------------------------------

async function _handleTranscript(payload) {
  const msg = payload.message || payload;
  const callId = msg.call?.id || '';
  const role = msg.role || '';
  const text = msg.transcript || '';

  if (!callId || !text || msg.transcriptType !== 'final') return;

  const sesion = await monitoreoSesiones.buscarPorVapiCallId(callId);
  if (!sesion) return;

  const rol = role === 'assistant' ? 'asistente' : 'usuario';
  await monitoreoSesiones.registrarTranscripcion(sesion.id, rol, text);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(level, ...args) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(LOG_PREFIX, ...args);
}

module.exports = {
  handleWebhook,
};
