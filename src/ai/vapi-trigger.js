/**
 * VAPI Trigger - Dispara llamadas IA via VAPI API
 *
 * Conexion directa a la API de VAPI (https://api.vapi.ai/call) para
 * crear llamadas telefonicas salientes con asistente de voz IA.
 *
 * Configuracion real:
 *  - Asistente: Riley (ID: 5ef87773-c914-431c-95c7-ab54d3263f15)
 *  - Modelo: OpenAI GPT-4o (temp 0.5, max 250 tokens)
 *  - Voz: Alejandro Ballesteros (ElevenLabs, masculina mexicana)
 *  - Transcriber: Deepgram nova-3
 *  - Telefono: +1 (208) 370 6590 (VAPI free number)
 *
 * Modos de operacion:
 *  1. VAPI directo (recomendado): Usa VAPI_PRIVATE_KEY + VAPI_PHONE_NUMBER_ID
 *  2. Fallback .NET webhook: Si no hay key, envia al webhook .NET
 *
 * Protocolo de escalamiento:
 *  operador -> coordinador1 -> coordinador2 -> coordinador3 -> cliente
 *
 * Variables de entorno:
 *  - VAPI_PRIVATE_KEY: Server-side API Key de VAPI
 *  - VAPI_PHONE_NUMBER_ID: ID del numero registrado en VAPI
 *  - VAPI_ASSISTANT_ID: ID del asistente Riley en VAPI
 */

'use strict';

const axios = require('axios');
const { internalClient: api } = require('../api/client');
const stopDetector = require('./stop-detector');

const LOG_PREFIX = '[VapiTrigger]';

// ---------------------------------------------------------------------------
// Configuracion VAPI
// ---------------------------------------------------------------------------

const VAPI_PRIVATE_KEY = process.env.VAPI_PRIVATE_KEY || '';
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID || '';
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID || '';
const VAPI_BASE_URL = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';

// Voz configurada: Alejandro Ballesteros (ElevenLabs, masculina mexicana)
const VAPI_VOICE_ID = 'YKUjKbMlejgvkOZlnnvt';
const VAPI_VOICE_MODEL = 'eleven_turbo_v2_5';

// Determinar modo de operacion
const VAPI_DIRECT_MODE = !!(VAPI_PRIVATE_KEY && VAPI_PHONE_NUMBER_ID);

if (VAPI_DIRECT_MODE) {
  console.log(`${LOG_PREFIX} VAPI conectado — Modo directo (Assistant: ${VAPI_ASSISTANT_ID ? 'Riley' : 'transient'}, Phone: ${process.env.VAPI_PHONE_NUMBER || VAPI_PHONE_NUMBER_ID})`);
} else {
  console.log(`${LOG_PREFIX} VAPI NO conectado — Modo fallback webhook .NET (configurar VAPI_PRIVATE_KEY y VAPI_PHONE_NUMBER_ID)`);
}

// Orden de escalamiento de contactos
const ESCALATION_ORDER = ['operador', 'coordinador1', 'coordinador2', 'coordinador3', 'cliente'];

// ---------------------------------------------------------------------------
// Funcion principal: processStopAlerts()
// ---------------------------------------------------------------------------

/**
 * Procesa todas las alertas de paro detectadas, ejecutando el protocolo
 * de llamadas IA para cada una.
 *
 * @param {Array<object>} stopAlerts - Alertas del stop-detector
 * @returns {Promise<object>} Resumen de las llamadas realizadas
 */
async function processStopAlerts(stopAlerts) {
  if (!stopAlerts || stopAlerts.length === 0) {
    return { processed: 0, calls: 0, errors: [] };
  }

  const summary = {
    processed: 0,
    calls: 0,
    callsAnswered: 0,
    callsFailed: 0,
    errors: [],
  };

  try {
    await api.ensureToken();

    for (const alert of stopAlerts) {
      try {
        const result = await _handleStopAlert(alert);
        summary.processed++;
        summary.calls += result.callsMade;
        summary.callsAnswered += result.callsAnswered;
        summary.callsFailed += result.callsFailed;
      } catch (err) {
        log('error', `Error procesando alerta para viaje ${alert.tripId}: ${err.message}`);
        summary.errors.push({
          tripId: alert.tripId,
          error: err.message,
        });
      }
    }
  } catch (err) {
    log('error', 'Error critico en processStopAlerts:', err.message);
    summary.errors.push({ tripId: 'general', error: err.message });
  }

  log('info', `Resumen: ${summary.processed} alertas procesadas, ` +
    `${summary.calls} llamadas (${summary.callsAnswered} atendidas, ${summary.callsFailed} fallidas)`);

  return summary;
}

// ---------------------------------------------------------------------------
// Manejo de una alerta individual
// ---------------------------------------------------------------------------

/**
 * Ejecuta el protocolo de llamadas IA para una alerta de paro.
 * Escala por la cadena de contactos hasta que alguien conteste.
 * @private
 */
async function _handleStopAlert(alert) {
  log('info', `Procesando alerta de paro para viaje ${alert.tripId} ` +
    `(${alert.stoppedMinutes} min detenido, umbral: ${alert.umbral} min)`);

  const result = { callsMade: 0, callsAnswered: 0, callsFailed: 0 };

  // 1. Registrar evento de alerta
  await stopDetector.logStopAlert(
    alert.tripId,
    `Paro detectado: ${alert.stoppedMinutes} minutos detenido ` +
    `en (${alert.lastLat.toFixed(6)}, ${alert.lastLng.toFixed(6)}). ` +
    `Umbral: ${alert.umbral} min. Iniciando protocolo de llamadas IA.`
  );

  // 2. Cargar contactos del viaje
  const contacts = await _loadContacts(alert.tripId);
  if (!contacts || contacts.length === 0) {
    log('warn', `Viaje ${alert.tripId}: no hay contactos configurados, no se puede llamar`);
    return result;
  }

  // 3. Cargar protocolo IA (si existe)
  const protocol = await _loadProtocol(alert.tripId);

  // 4. Construir el motivo de la llamada
  const motivo = `Vehiculo detenido por ${alert.stoppedMinutes} minutos ` +
    `en las coordenadas (${alert.lastLat.toFixed(6)}, ${alert.lastLng.toFixed(6)}). ` +
    `El umbral configurado es de ${alert.umbral} minutos.`;

  // 5. Ejecutar protocolo de escalamiento con contexto entre llamadas
  //
  // Flujo:
  //  a) Llamar al operador → preguntar por que esta detenido
  //  b) Si el operador responde con un motivo (descompostura, etc.):
  //     → Llamar al coordinador y decirle lo que dijo el operador
  //  c) Si el operador NO responde:
  //     → Llamar al coordinador y decirle que el operador no contesto
  //
  let operadorResumen = null;
  let operadorContesto = false;

  for (const rol of ESCALATION_ORDER) {
    const contact = contacts.find(c => c.tipo_contacto === rol);
    if (!contact || !contact.telefono) continue;

    // Construir motivo contextual para coordinadores
    let motivoLlamada = motivo;

    if (rol !== 'operador' && rol !== 'cliente') {
      // Es un coordinador — agregar contexto de la llamada al operador
      if (operadorContesto && operadorResumen) {
        motivoLlamada = `${motivo}\n\n` +
          `IMPORTANTE: Ya se llamo al operador y esto fue lo que dijo: "${operadorResumen}". ` +
          `Informale al coordinador exactamente lo que reporto el operador.`;
      } else {
        motivoLlamada = `${motivo}\n\n` +
          `IMPORTANTE: Se intento contactar al operador pero NO respondio la llamada. ` +
          `Informale al coordinador que la unidad no se ha movido y que el operador no contesta.`;
      }
    }

    log('info', `Viaje ${alert.tripId}: llamando a ${rol} (${contact.nombre || contact.telefono})`);

    try {
      const callResult = await _makeCall(alert, contact, motivoLlamada, protocol);
      result.callsMade++;

      // Registrar la llamada en log_ai_calls
      await _logCall(alert, contact, callResult, motivoLlamada);

      // Registrar evento
      await _logCallEvent(alert.tripId, contact, callResult);

      if (callResult.answered) {
        result.callsAnswered++;

        // Si es el operador, guardar su respuesta para pasarla al coordinador
        if (rol === 'operador') {
          operadorContesto = true;
          operadorResumen = callResult.resumen || 'El operador contesto pero no se obtuvo resumen';
          log('info', `Viaje ${alert.tripId}: operador contesto. Resumen: "${operadorResumen}"`);
          // NO detenemos el escalamiento: siempre informamos al coordinador
          // lo que dijo el operador
          continue;
        }

        log('info', `Viaje ${alert.tripId}: ${rol} contesto la llamada, deteniendo escalamiento`);
        break; // Coordinador contesto, detenemos
      } else {
        result.callsFailed++;

        if (rol === 'operador') {
          operadorContesto = false;
          log('info', `Viaje ${alert.tripId}: operador NO contesto, escalando a coordinador...`);
        } else {
          log('info', `Viaje ${alert.tripId}: ${rol} no contesto, escalando...`);
        }
      }
    } catch (err) {
      result.callsFailed++;
      log('error', `Viaje ${alert.tripId}: error llamando a ${rol}: ${err.message}`);

      if (rol === 'operador') {
        operadorContesto = false;
      }

      // Registrar el error en log_ai_calls
      await _logCall(alert, contact, {
        answered: false,
        resultado: 'error',
        duracion: 0,
        resumen: `Error: ${err.message}`,
      }, motivo).catch(() => {});
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Llamada via VAPI - Modo directo (API de VAPI)
// ---------------------------------------------------------------------------

/**
 * Realiza una llamada IA.
 * Usa la API directa de VAPI si hay API Key configurada,
 * o el webhook de la API .NET como fallback.
 * @private
 */
async function _makeCall(alert, contact, motivo, protocol) {
  if (VAPI_DIRECT_MODE) {
    return _makeCallVapiDirect(alert, contact, motivo, protocol);
  }
  return _makeCallWebhookFallback(alert, contact, motivo, protocol);
}

/**
 * Llamada directa a la API de VAPI (POST https://api.vapi.ai/call).
 * Usa el asistente Riley con voz de Alejandro Ballesteros.
 * Sobreescribe el system prompt y firstMessage con el contexto del viaje.
 * @private
 */
async function _makeCallVapiDirect(alert, contact, motivo, protocol) {
  const startTime = new Date();

  try {
    const idioma = protocol?.idioma || 'es';
    const customInstructions = protocol?.protocolo_texto || '';
    const systemPrompt = _buildSystemPrompt(alert, contact, motivo, idioma, customInstructions);
    const firstMessage = _buildFirstMessage(alert, contact, idioma);

    // Construir payload para POST https://api.vapi.ai/call
    const payload = {
      // Numero de telefono desde el cual se llama (VAPI free: +12083706590)
      phoneNumberId: VAPI_PHONE_NUMBER_ID,

      // Destino: numero del contacto en formato E.164
      customer: {
        number: _normalizePhoneNumber(contact.telefono),
        name: contact.nombre || 'Contacto',
      },

      // Metadata para tracking en webhooks
      metadata: {
        tripId: String(alert.tripId),
        contactRole: contact.tipo_contacto,
        reason: 'stop_alert',
        stoppedMinutes: String(alert.stoppedMinutes),
        origin: alert.tripInfo.origen || '',
        destination: alert.tripInfo.destino || '',
      },
    };

    if (VAPI_ASSISTANT_ID) {
      // Usar asistente guardado Riley con overrides de contexto
      payload.assistantId = VAPI_ASSISTANT_ID;
      payload.assistantOverrides = {
        // Sobreescribir el primer mensaje con contexto del viaje
        firstMessage,
        // Sobreescribir el model con system prompt contextual
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          temperature: 0.5,
          maxTokens: 250,
          messages: [
            { role: 'system', content: systemPrompt },
          ],
        },
        // Forzar transcriber en espanol (el assistant tiene 'en' por default)
        transcriber: {
          provider: 'deepgram',
          model: 'nova-3',
          language: idioma === 'es' ? 'es' : 'en',
        },
        // Mensaje de fin de llamada contextual
        endCallMessage: idioma === 'es'
          ? 'Gracias por atender. El equipo de JELABBC seguira monitoreando el viaje. Hasta luego.'
          : 'Thank you for answering. The JELABBC team will continue monitoring the trip. Goodbye.',
      };
    } else {
      // Crear asistente transient con la misma config que Riley
      payload.assistant = {
        name: 'JELABBC Alerta de Paro',
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
          voiceId: VAPI_VOICE_ID,  // Alejandro Ballesteros (masculina mexicana)
          model: VAPI_VOICE_MODEL, // eleven_turbo_v2_5
          stability: 0.5,
          similarityBoost: 0.75,
        },
        transcriber: {
          provider: 'deepgram',
          model: 'nova-3',
          language: idioma === 'es' ? 'es' : 'en',
          endpointing: 150,
        },
        endCallFunctionEnabled: true,
        endCallMessage: idioma === 'es'
          ? 'Gracias por atender. El equipo de JELABBC seguira monitoreando el viaje. Hasta luego.'
          : 'Thank you for answering. The JELABBC team will continue monitoring the trip. Goodbye.',
        maxDurationSeconds: 120,
        silenceTimeoutSeconds: 30,
      };
    }

    log('info', `VAPI call → ${contact.telefono} (${contact.tipo_contacto}) via ${VAPI_ASSISTANT_ID ? 'Riley' : 'transient'}`);

    // POST https://api.vapi.ai/call
    const response = await axios.post(`${VAPI_BASE_URL}/call`, payload, {
      headers: {
        'Authorization': `Bearer ${VAPI_PRIVATE_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const callData = response.data;
    const callId = callData?.id;
    const status = callData?.status || 'queued';

    log('info', `VAPI call creada OK: id=${callId}, status=${status}`);

    const endTime = new Date();
    const durationSecs = Math.round((endTime - startTime) / 1000);

    // VAPI procesa la llamada de forma asincrona.
    // Statuses posibles: queued, ringing, in-progress, forwarding, ended
    // Si VAPI acepto la llamada (201), la consideramos en proceso.
    // El resultado final llega via webhook (end-of-call-report).
    return {
      answered: true, // VAPI acepto y esta procesando la llamada
      resultado: 'atendida',
      duracion: callData?.duration || durationSecs,
      resumen: `Llamada VAPI creada (ID: ${callId}). Status: ${status}`,
      vapiCallId: callId,
      vapiStatus: status,
    };
  } catch (err) {
    const status = err.response?.status;
    const errorData = err.response?.data;
    const errorMsg = errorData?.message || errorData?.error ||
      (typeof errorData === 'string' ? errorData : null) || err.message;

    log('error', `VAPI call FALLO → ${contact.telefono}: HTTP ${status || 'ERR'} — ${errorMsg}`);

    if (status === 400 || status === 422) {
      log('error', 'VAPI detalle:', JSON.stringify(errorData).substring(0, 500));
    }

    return {
      answered: false,
      resultado: 'error',
      duracion: 0,
      resumen: `Error VAPI (HTTP ${status || '?'}): ${errorMsg}`,
    };
  }
}

/**
 * Fallback: envia al webhook de la API .NET cuando no hay VAPI_API_KEY.
 * @private
 */
async function _makeCallWebhookFallback(alert, contact, motivo, protocol) {
  const startTime = new Date();

  try {
    const payload = {
      type: 'outbound-call',
      phoneNumber: contact.telefono,
      contactName: contact.nombre || 'Contacto',
      contactRole: contact.tipo_contacto,
      tripId: alert.tripId,
      reason: 'stop_alert',
      message: motivo,
      language: protocol?.idioma || 'es',
      context: {
        tripOrigin: alert.tripInfo.origen || '',
        tripDestination: alert.tripInfo.destino || '',
        stoppedMinutes: alert.stoppedMinutes,
        lastLat: alert.lastLat,
        lastLng: alert.lastLng,
        threshold: alert.umbral,
      },
    };

    if (protocol?.protocolo_texto) {
      payload.customProtocol = protocol.protocolo_texto;
    }

    const response = await api.vapiWebhook(payload);
    const endTime = new Date();
    const durationSecs = Math.round((endTime - startTime) / 1000);

    const answered = response?.status === 'completed' ||
      response?.callStatus === 'answered' ||
      response?.answered === true ||
      (response?.duration && response.duration > 10);

    const resultado = answered ? 'atendida' :
      (response?.status === 'voicemail' || response?.callStatus === 'voicemail') ? 'buzon' :
      (response?.status === 'no-answer' || response?.callStatus === 'no-answer') ? 'no_atendida' :
      'no_atendida';

    return {
      answered,
      resultado,
      duracion: response?.duration || durationSecs,
      resumen: response?.summary || response?.transcript || null,
    };
  } catch (err) {
    log('error', `Error en llamada webhook a ${contact.telefono}: ${err.message}`);
    return {
      answered: false,
      resultado: 'error',
      duracion: 0,
      resumen: `Error webhook: ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Construccion de prompts para el asistente de voz
// ---------------------------------------------------------------------------

/**
 * Construye el system prompt para el asistente de voz IA.
 * @private
 */
function _buildSystemPrompt(alert, contact, motivo, idioma, customInstructions) {
  if (idioma === 'es') {
    let prompt = `Eres un asistente de voz de JELABBC, una empresa de logistica y transporte. ` +
      `Tu tarea es contactar a ${contact.nombre || contact.tipo_contacto} para informar sobre una alerta de paro en un vehiculo.\n\n` +
      `CONTEXTO:\n` +
      `- Viaje #${alert.tripId}\n` +
      `- Unidad: ${alert.tripInfo.placas_unidad || alert.tripInfo.numero_contenedor || 'N/A'}\n` +
      `- El vehiculo ha estado detenido por ${alert.stoppedMinutes} minutos\n` +
      `- Ubicacion: coordenadas ${alert.lastLat.toFixed(4)}, ${alert.lastLng.toFixed(4)}\n` +
      `- Umbral de alerta: ${alert.umbral} minutos\n\n` +
      `INSTRUCCIONES:\n` +
      `1. Presentate como asistente de JELABBC\n` +
      `2. Informa sobre la alerta de paro del vehiculo\n` +
      `3. Pregunta si hay alguna situacion o problema\n` +
      `4. Pregunta el tiempo estimado para reanudar el viaje\n` +
      `5. Agradece y despidete\n\n` +
      `REGLAS:\n` +
      `- Se breve y profesional\n` +
      `- No compartas coordenadas exactas con el contacto\n` +
      `- Si detectas una emergencia, indica que se comunicaran con soporte inmediatamente\n` +
      `- Habla en espanol de Mexico`;

    if (customInstructions) {
      prompt += `\n\nINSTRUCCIONES ADICIONALES:\n${customInstructions}`;
    }

    return prompt;
  }

  // English version
  let prompt = `You are a voice assistant for JELABBC, a logistics and transportation company. ` +
    `Your task is to contact ${contact.nombre || contact.tipo_contacto} regarding a vehicle stop alert.\n\n` +
    `CONTEXT:\n` +
    `- Trip #${alert.tripId}\n` +
    `- Unit: ${alert.tripInfo.placas_unidad || alert.tripInfo.numero_contenedor || 'N/A'}\n` +
    `- The vehicle has been stopped for ${alert.stoppedMinutes} minutes\n` +
    `- Location: coordinates ${alert.lastLat.toFixed(4)}, ${alert.lastLng.toFixed(4)}\n` +
    `- Alert threshold: ${alert.umbral} minutes\n\n` +
    `INSTRUCTIONS:\n` +
    `1. Introduce yourself as a JELABBC assistant\n` +
    `2. Inform about the vehicle stop alert\n` +
    `3. Ask if there is any situation or problem\n` +
    `4. Ask for estimated time to resume the trip\n` +
    `5. Thank them and say goodbye\n\n` +
    `RULES:\n` +
    `- Be brief and professional\n` +
    `- Do not share exact coordinates with the contact\n` +
    `- If you detect an emergency, indicate that support will reach out immediately`;

  if (customInstructions) {
    prompt += `\n\nADDITIONAL INSTRUCTIONS:\n${customInstructions}`;
  }

  return prompt;
}

/**
 * Construye el primer mensaje del asistente (lo que dice al contestar).
 * @private
 */
function _buildFirstMessage(alert, contact, idioma) {
  const nombre = contact.nombre || '';

  if (idioma === 'es') {
    return `Hola${nombre ? ' ' + nombre : ''}, le llamo del equipo de monitoreo de JELABBC. ` +
      `Estamos detectando que el vehiculo del viaje numero ${alert.tripId} lleva ` +
      `${alert.stoppedMinutes} minutos detenido. ¿Esta todo bien? ¿Hay alguna situacion que debamos conocer?`;
  }

  return `Hello${nombre ? ' ' + nombre : ''}, I'm calling from the JELABBC monitoring team. ` +
    `We're detecting that the vehicle on trip number ${alert.tripId} has been stopped for ` +
    `${alert.stoppedMinutes} minutes. Is everything okay? Is there any situation we should know about?`;
}

/**
 * Normaliza un numero de telefono para formato E.164 (requerido por VAPI).
 * @param {string} phone
 * @returns {string}
 * @private
 */
function _normalizePhoneNumber(phone) {
  if (!phone) return '';

  // Limpiar caracteres no numericos excepto +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Si no tiene prefijo internacional, asumir Mexico (+52)
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('52')) {
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
// Carga de datos
// ---------------------------------------------------------------------------

/**
 * Carga los contactos de un viaje.
 * @private
 */
async function _loadContacts(tripId) {
  try {
    // contactos_viaje usa: nombre_contacto, telefono_contacto (no nombre, telefono)
    const rawContacts = await api.query(
      `SELECT id, id_unidad_viaje, tipo_contacto, nombre_contacto, telefono_contacto
       FROM contactos_viaje
       WHERE id_unidad_viaje = ${tripId}
       ORDER BY FIELD(tipo_contacto, 'operador','coordinador1','coordinador2','coordinador3','cliente','propietario','otro')`
    );

    // Normalizar a nombre/telefono para compatibilidad con el resto del codigo
    return (rawContacts || []).map(c => ({
      ...c,
      nombre: c.nombre_contacto,
      telefono: c.telefono_contacto,
    }));
  } catch (err) {
    log('error', `Error cargando contactos del viaje ${tripId}:`, err.message);
    return [];
  }
}

/**
 * Carga el protocolo IA para un viaje (o el default).
 * @private
 */
async function _loadProtocol(tripId) {
  try {
    const protocols = await api.query(
      `SELECT * FROM conf_ai_protocols
       WHERE id_unidad_viaje = ${tripId}
       ORDER BY id DESC LIMIT 1`
    );

    if (protocols && protocols.length > 0) {
      return protocols[0];
    }

    const defaults = await api.query(
      `SELECT * FROM conf_ai_protocols
       WHERE id_unidad_viaje IS NULL
       ORDER BY id DESC LIMIT 1`
    );

    return defaults && defaults.length > 0 ? defaults[0] : null;
  } catch (err) {
    log('error', `Error cargando protocolo IA para viaje ${tripId}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Registra una llamada en log_ai_calls.
 * @private
 */
async function _logCall(alert, contact, callResult, motivo) {
  try {
    await api.insert('log_ai_calls', {
      id_unidad_viaje: alert.tripId,
      tipo: 'paro',
      telefono_llamado: contact.telefono,
      destinatario_rol: contact.tipo_contacto,
      inicio_llamada: new Date().toISOString().slice(0, 19).replace('T', ' '),
      fin_llamada: new Date().toISOString().slice(0, 19).replace('T', ' '),
      duracion_segundos: callResult.duracion || 0,
      resultado: callResult.resultado,
      resumen_conversacion: callResult.resumen || null,
      motivo,
      lat_al_llamar: alert.lastLat,
      lng_al_llamar: alert.lastLng,
    });
  } catch (err) {
    log('error', `Error registrando llamada en log_ai_calls: ${err.message}`);
  }
}

/**
 * Registra un evento de llamada IA en eventos_unidad.
 * @private
 */
async function _logCallEvent(tripId, contact, callResult) {
  try {
    const tipoEvento = contact.tipo_contacto === 'operador'
      ? 'llamada_ia_operador'
      : 'llamada_ia_coordinador';

    const descripcion = callResult.answered
      ? `Llamada IA a ${contact.tipo_contacto} (${contact.nombre || contact.telefono}) - ATENDIDA`
      : `Llamada IA a ${contact.tipo_contacto} (${contact.nombre || contact.telefono}) - ${callResult.resultado.toUpperCase()}`;

    await api.insert('eventos_unidad', {
      id_unidad_viaje: tripId,
      tipo_evento: tipoEvento,
      descripcion,
      ocurrido_en: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  } catch {
    // No critico
  }
}

// ---------------------------------------------------------------------------
// Ejecucion manual (para testing desde el panel)
// ---------------------------------------------------------------------------

/**
 * Dispara una llamada manual de prueba para un viaje especifico.
 * @param {number} tripId - ID del viaje
 * @param {string} contactRole - Rol del contacto a llamar
 * @param {string} [customMessage] - Mensaje personalizado
 * @returns {Promise<object>} Resultado de la llamada
 */
async function triggerManualCall(tripId, contactRole, customMessage) {
  try {
    await api.ensureToken();

    const trips = await api.query(
      `SELECT * FROM unidades_viajes WHERE id = ${parseInt(tripId)} LIMIT 1`
    );

    if (!trips || trips.length === 0) {
      return { success: false, error: 'Viaje no encontrado' };
    }

    const trip = trips[0];
    const contacts = await _loadContacts(tripId);
    const contact = contacts.find(c => c.tipo_contacto === contactRole);

    if (!contact || !contact.telefono) {
      return { success: false, error: `No se encontro contacto con rol "${contactRole}" para este viaje` };
    }

    const motivo = customMessage || `Llamada de verificacion manual para viaje #${tripId}`;
    const protocol = await _loadProtocol(tripId);

    const alert = {
      tripId: trip.id,
      tripInfo: trip,
      stoppedMinutes: 0,
      umbral: trip.umbral_paro_minutos || 30,
      lastLat: parseFloat(trip.ultima_lat) || 0,
      lastLng: parseFloat(trip.ultima_lng) || 0,
    };

    const callResult = await _makeCall(alert, contact, motivo, protocol);

    // Registrar en log_ai_calls con tipo 'verificacion'
    await api.insert('log_ai_calls', {
      id_unidad_viaje: tripId,
      tipo: 'verificacion',
      telefono_llamado: contact.telefono,
      destinatario_rol: contact.tipo_contacto,
      inicio_llamada: new Date().toISOString().slice(0, 19).replace('T', ' '),
      fin_llamada: new Date().toISOString().slice(0, 19).replace('T', ' '),
      duracion_segundos: callResult.duracion || 0,
      resultado: callResult.resultado,
      resumen_conversacion: callResult.resumen || null,
      motivo,
      lat_al_llamar: alert.lastLat,
      lng_al_llamar: alert.lastLng,
    });

    return {
      success: true,
      mode: VAPI_DIRECT_MODE ? 'vapi_direct' : 'webhook_fallback',
      answered: callResult.answered,
      resultado: callResult.resultado,
      duracion: callResult.duracion,
      resumen: callResult.resumen,
      vapiCallId: callResult.vapiCallId || null,
    };
  } catch (err) {
    log('error', `Error en llamada manual para viaje ${tripId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Verifica si VAPI esta configurado y puede hacer llamadas.
 * @returns {object} Estado de la configuracion
 */
function getStatus() {
  return {
    mode: VAPI_DIRECT_MODE ? 'vapi_direct' : 'webhook_fallback',
    vapiConfigured: VAPI_DIRECT_MODE,
    hasApiKey: !!VAPI_PRIVATE_KEY,
    hasPhoneNumberId: !!VAPI_PHONE_NUMBER_ID,
    hasAssistantId: !!VAPI_ASSISTANT_ID,
    assistantName: VAPI_ASSISTANT_ID ? 'Riley' : null,
    phoneNumber: process.env.VAPI_PHONE_NUMBER || null,
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
  processStopAlerts,
  triggerManualCall,
  getStatus,
};
