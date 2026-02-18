/**
 * Rutas de IA (conf_ai_protocols, log_ai_calls, control de llamadas)
 *
 * Endpoints:
 *   GET  /ai               - Vista config IA (protocolos + viajes con IA)
 *   GET  /ai/calls         - Vista historial de llamadas IA
 *   GET  /ai/api/trips     - JSON: viajes con config IA (para Syncfusion Grid)
 *   GET  /ai/api/protocols - JSON: protocolos IA
 *   POST /ai/api/protocol  - Crear/actualizar protocolo IA
 *   DEL  /ai/api/protocol/:id - Eliminar protocolo
 *   POST /ai/api/toggle/:tripId - Toggle IA activa para un viaje
 *   POST /ai/api/update-trip/:tripId - Actualizar config IA de un viaje
 *   GET  /ai/api/calls     - JSON: historial llamadas (para Syncfusion Grid)
 *   GET  /ai/api/stats     - JSON: estadisticas de llamadas IA
 *   POST /ai/api/manual-call - Disparar llamada manual de prueba
 *   POST /ai/api/run-detection - Ejecutar deteccion de paros manualmente
 */

'use strict';

const express = require('express');
const router = express.Router();
const { createClient } = require('../api/client');
const { triggerManualCall } = require('../ai/vapi-trigger');
const { detectStops } = require('../ai/stop-detector');
const vapiTrigger = require('../ai/vapi-trigger');
const monitoreoPrompts = require('../ai/monitoreo-prompts');
const monitoreoIntenciones = require('../ai/monitoreo-intenciones');
const monitoreoConsulta = require('../ai/monitoreo-consulta');
const monitoreoSync = require('../ai/monitoreo-sync');

// ============================================================================
// GET /ai - Vista principal: Configuracion IA
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Cargar viajes activos para el dropdown de seleccion
    const viajes = await api.query(
      `SELECT id, id_unidad, origen, destino, estado_actual,
              ia_llamadas_activas, umbral_paro_minutos
       FROM unidades_viajes
       WHERE estado_actual IN ('en_ruta', 'programado', 'en_carga')
       ORDER BY id DESC`
    ).catch(() => []);

    // Stats rapidas
    const todayStr = new Date().toISOString().slice(0, 10);
    const stats = await api.query(
      `SELECT
         COUNT(*) AS total_calls,
         SUM(CASE WHEN resultado = 'atendida' THEN 1 ELSE 0 END) AS atendidas,
         SUM(CASE WHEN resultado = 'no_atendida' THEN 1 ELSE 0 END) AS no_atendidas,
         SUM(CASE WHEN resultado = 'error' THEN 1 ELSE 0 END) AS errores
       FROM log_ai_calls
       WHERE DATE(creado_en) = '${todayStr}'`
    ).catch(() => []);

    const viajesConIA = await api.query(
      `SELECT COUNT(*) AS total
       FROM unidades_viajes
       WHERE ia_llamadas_activas = 1
         AND estado_actual = 'en_ruta'`
    ).catch(() => []);

    res.render('ai/config', {
      title: 'Configuracion IA',
      viajes: viajes || [],
      stats: stats && stats.length > 0 ? stats[0] : {},
      viajesConIA: viajesConIA && viajesConIA.length > 0 ? viajesConIA[0].total : 0,
    });
  } catch (err) {
    console.error('[AI] Error:', err.message);
    res.render('ai/config', {
      title: 'Configuracion IA',
      viajes: [],
      stats: {},
      viajesConIA: 0,
    });
  }
});

// ============================================================================
// GET /ai/calls - Vista historial de llamadas
// ============================================================================

router.get('/calls', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Cargar viajes para filtro
    const viajes = await api.query(
      `SELECT DISTINCT uv.id, uv.id_unidad, uv.origen, uv.destino
       FROM unidades_viajes uv
       INNER JOIN log_ai_calls lac ON lac.id_unidad_viaje = uv.id
       ORDER BY uv.id DESC`
    ).catch(() => []);

    res.render('ai/calls', {
      title: 'Llamadas IA',
      viajes: viajes || [],
    });
  } catch (err) {
    console.error('[AI Calls] Error:', err.message);
    res.render('ai/calls', {
      title: 'Llamadas IA',
      viajes: [],
    });
  }
});

// ============================================================================
// GET /ai/api/trips - Lista viajes con config IA (Syncfusion DataManager)
// ============================================================================

router.get('/api/trips', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    const skip = parseInt(req.query.$skip) || 0;
    const take = parseInt(req.query.$take) || 20;

    // Filtros
    const conditions = ["uv.estado_actual IN ('en_ruta', 'programado', 'en_carga')"];
    if (req.query.soloIA === 'true') {
      conditions.push('uv.ia_llamadas_activas = 1');
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // Sorting
    let orderBy = 'uv.id DESC';
    if (req.query.$orderby) {
      const parts = req.query.$orderby.split(' ');
      const allowed = ['id', 'id_unidad', 'origen', 'destino', 'estado_actual',
        'ia_llamadas_activas', 'umbral_paro_minutos'];
      if (allowed.includes(parts[0])) {
        orderBy = `uv.${parts[0]} ${parts[1] === 'asc' ? 'ASC' : 'DESC'}`;
      }
    }

    const trips = await api.query(
      `SELECT uv.id, uv.id_unidad, uv.origen, uv.destino, uv.estado_actual,
              uv.ia_llamadas_activas, uv.umbral_paro_minutos,
              uv.ultima_lat, uv.ultima_lng, uv.ultima_actualizacion,
              uv.frecuencia_monitoreo_min,
              (SELECT COUNT(*) FROM log_ai_calls lac WHERE lac.id_unidad_viaje = uv.id) AS total_llamadas,
              (SELECT MAX(lac.creado_en) FROM log_ai_calls lac WHERE lac.id_unidad_viaje = uv.id) AS ultima_llamada
       FROM unidades_viajes uv
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${take} OFFSET ${skip}`
    );

    const countResult = await api.query(
      `SELECT COUNT(*) AS total FROM unidades_viajes uv ${whereClause}`
    );
    const total = countResult && countResult.length > 0 ? countResult[0].total : 0;

    res.json({ result: trips || [], count: total });
  } catch (err) {
    console.error('[AI API trips] Error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// ============================================================================
// GET /ai/api/protocols - Lista protocolos IA
// ============================================================================

router.get('/api/protocols', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    const protocols = await api.query(
      `SELECT ap.*,
              uv.id_unidad AS viaje_unidad,
              uv.origen AS viaje_origen,
              uv.destino AS viaje_destino
       FROM conf_ai_protocols ap
       LEFT JOIN unidades_viajes uv ON uv.id = ap.id_unidad_viaje
       ORDER BY ap.id DESC`
    );

    res.json({ success: true, data: protocols || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// POST /ai/api/protocol - Crear o actualizar protocolo IA
// ============================================================================

router.post('/api/protocol', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const { id, id_unidad_viaje, umbral_paro_minutos, llamadas_activas,
            protocolo_texto, idioma } = req.body;

    const data = {
      id_unidad_viaje: id_unidad_viaje || null,
      umbral_paro_minutos: parseInt(umbral_paro_minutos) || 30,
      llamadas_activas: llamadas_activas ? 1 : 0,
      protocolo_texto: protocolo_texto || null,
      idioma: idioma || 'es',
    };

    if (id) {
      // Actualizar existente
      await api.update('conf_ai_protocols', id, data);
      res.json({ success: true, message: 'Protocolo actualizado' });
    } else {
      // Crear nuevo
      await api.insert('conf_ai_protocols', data);
      res.json({ success: true, message: 'Protocolo creado' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// DELETE /ai/api/protocol/:id - Eliminar protocolo
// ============================================================================

router.delete('/api/protocol/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    await api.remove('conf_ai_protocols', parseInt(req.params.id));
    res.json({ success: true, message: 'Protocolo eliminado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// POST /ai/api/toggle/:tripId - Toggle IA activa para un viaje
// ============================================================================

router.post('/api/toggle/:tripId', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const tripId = parseInt(req.params.tripId);

    // Leer estado actual
    const rows = await api.query(
      `SELECT ia_llamadas_activas FROM unidades_viajes WHERE id = ${tripId} LIMIT 1`
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Viaje no encontrado' });
    }

    const newState = rows[0].ia_llamadas_activas ? 0 : 1;
    await api.update('unidades_viajes', tripId, { ia_llamadas_activas: newState });

    res.json({
      success: true,
      ia_llamadas_activas: newState === 1,
      message: newState ? 'IA activada para este viaje' : 'IA desactivada para este viaje',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// POST /ai/api/update-trip/:tripId - Actualizar config IA de un viaje
// ============================================================================

router.post('/api/update-trip/:tripId', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const tripId = parseInt(req.params.tripId);

    const { umbral_paro_minutos, ia_llamadas_activas } = req.body;

    const data = {};
    if (umbral_paro_minutos !== undefined) {
      data.umbral_paro_minutos = parseInt(umbral_paro_minutos) || 30;
    }
    if (ia_llamadas_activas !== undefined) {
      data.ia_llamadas_activas = ia_llamadas_activas ? 1 : 0;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });
    }

    await api.update('unidades_viajes', tripId, data);
    res.json({ success: true, message: 'Configuracion actualizada' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// GET /ai/api/calls - Historial llamadas (Syncfusion DataManager)
// ============================================================================

router.get('/api/calls', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    const skip = parseInt(req.query.$skip) || 0;
    const take = parseInt(req.query.$take) || 20;

    // Filtros
    const conditions = [];
    if (req.query.tripId) {
      conditions.push(`lac.id_unidad_viaje = ${parseInt(req.query.tripId)}`);
    }
    if (req.query.tipo && ['paro', 'accidente', 'verificacion'].includes(req.query.tipo)) {
      conditions.push(`lac.tipo = '${req.query.tipo}'`);
    }
    if (req.query.resultado &&
        ['atendida', 'no_atendida', 'buzon', 'error'].includes(req.query.resultado)) {
      conditions.push(`lac.resultado = '${req.query.resultado}'`);
    }
    if (req.query.fechaDesde) {
      conditions.push(`lac.creado_en >= '${req.query.fechaDesde}'`);
    }
    if (req.query.fechaHasta) {
      conditions.push(`lac.creado_en <= '${req.query.fechaHasta} 23:59:59'`);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // Sorting
    let orderBy = 'lac.id DESC';
    if (req.query.$orderby) {
      const parts = req.query.$orderby.split(' ');
      const allowed = ['id', 'tipo', 'resultado', 'duracion_segundos', 'creado_en',
        'destinatario_rol', 'telefono_llamado'];
      if (allowed.includes(parts[0])) {
        orderBy = `lac.${parts[0]} ${parts[1] === 'asc' ? 'ASC' : 'DESC'}`;
      }
    }

    const calls = await api.query(
      `SELECT lac.*,
              uv.id_unidad AS viaje_unidad,
              uv.origen AS viaje_origen,
              uv.destino AS viaje_destino
       FROM log_ai_calls lac
       LEFT JOIN unidades_viajes uv ON uv.id = lac.id_unidad_viaje
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${take} OFFSET ${skip}`
    );

    const countResult = await api.query(
      `SELECT COUNT(*) AS total
       FROM log_ai_calls lac
       LEFT JOIN unidades_viajes uv ON uv.id = lac.id_unidad_viaje
       ${whereClause}`
    );
    const total = countResult && countResult.length > 0 ? countResult[0].total : 0;

    res.json({ result: calls || [], count: total });
  } catch (err) {
    console.error('[AI Calls API] Error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// ============================================================================
// GET /ai/api/stats - Estadisticas de llamadas IA
// ============================================================================

router.get('/api/stats', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    const todayStr = new Date().toISOString().slice(0, 10);

    // Stats de hoy
    const todayStats = await api.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN resultado = 'atendida' THEN 1 ELSE 0 END) AS atendidas,
         SUM(CASE WHEN resultado = 'no_atendida' THEN 1 ELSE 0 END) AS no_atendidas,
         SUM(CASE WHEN resultado = 'buzon' THEN 1 ELSE 0 END) AS buzon,
         SUM(CASE WHEN resultado = 'error' THEN 1 ELSE 0 END) AS errores,
         AVG(duracion_segundos) AS avg_duracion
       FROM log_ai_calls
       WHERE DATE(creado_en) = '${todayStr}'`
    );

    // Stats totales
    const totalStats = await api.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN resultado = 'atendida' THEN 1 ELSE 0 END) AS atendidas
       FROM log_ai_calls`
    );

    // Viajes con IA activa
    const iaActive = await api.query(
      `SELECT COUNT(*) AS total
       FROM unidades_viajes
       WHERE ia_llamadas_activas = 1
         AND estado_actual = 'en_ruta'`
    );

    // Ultimo paro detectado
    const lastStop = await api.query(
      `SELECT lac.*, uv.id_unidad AS viaje_unidad
       FROM log_ai_calls lac
       LEFT JOIN unidades_viajes uv ON uv.id = lac.id_unidad_viaje
       WHERE lac.tipo = 'paro'
       ORDER BY lac.id DESC LIMIT 1`
    );

    const today = todayStats && todayStats.length > 0 ? todayStats[0] : {};
    const total = totalStats && totalStats.length > 0 ? totalStats[0] : {};

    const todayTotal = parseInt(today.total) || 0;
    const todayAtendidas = parseInt(today.atendidas) || 0;
    const answerRate = todayTotal > 0 ? Math.round((todayAtendidas / todayTotal) * 100) : 0;

    res.json({
      today: {
        total: todayTotal,
        atendidas: todayAtendidas,
        noAtendidas: parseInt(today.no_atendidas) || 0,
        buzon: parseInt(today.buzon) || 0,
        errores: parseInt(today.errores) || 0,
        avgDuracion: today.avg_duracion ? Math.round(parseFloat(today.avg_duracion)) : 0,
        answerRate,
      },
      total: {
        total: parseInt(total.total) || 0,
        atendidas: parseInt(total.atendidas) || 0,
      },
      iaActiveTrips: iaActive && iaActive.length > 0 ? parseInt(iaActive[0].total) : 0,
      lastStop: lastStop && lastStop.length > 0 ? lastStop[0] : null,
    });
  } catch (err) {
    console.error('[AI Stats] Error:', err.message);
    res.json({
      today: { total: 0, atendidas: 0, noAtendidas: 0, buzon: 0, errores: 0, avgDuracion: 0, answerRate: 0 },
      total: { total: 0, atendidas: 0 },
      iaActiveTrips: 0,
      lastStop: null,
    });
  }
});

// ============================================================================
// POST /ai/api/manual-call - Disparar llamada manual
// ============================================================================

router.post('/api/manual-call', async (req, res) => {
  try {
    const { tripId, contactRole, message } = req.body;

    if (!tripId || !contactRole) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere tripId y contactRole',
      });
    }

    const result = await triggerManualCall(
      parseInt(tripId),
      contactRole,
      message || undefined
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// GET /ai/api/vapi-status - Estado de la conexion VAPI
// ============================================================================

router.get('/api/vapi-status', (req, res) => {
  const status = vapiTrigger.getStatus();
  res.json(status);
});

// ============================================================================
// POST /ai/api/run-detection - Ejecutar deteccion de paros manualmente
// ============================================================================

router.post('/api/run-detection', async (req, res) => {
  try {
    // 1. Detectar paros
    const stops = await detectStops();

    if (stops.length === 0) {
      return res.json({
        success: true,
        message: 'No se detectaron paros',
        stops: 0,
        calls: 0,
      });
    }

    // 2. Procesar alertas (hacer llamadas)
    const callResult = await vapiTrigger.processStopAlerts(stops);

    res.json({
      success: true,
      message: `${stops.length} paros detectados, ${callResult.calls} llamadas realizadas`,
      stops: stops.length,
      calls: callResult.calls,
      callsAnswered: callResult.callsAnswered,
      callsFailed: callResult.callsFailed,
      details: stops.map(s => ({
        tripId: s.tripId,
        stoppedMinutes: s.stoppedMinutes,
        umbral: s.umbral,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// ===== FASE 6: SISTEMA DE MONITOREO DE LLAMADAS IA ========================
// ============================================================================

// GET /ai/monitoreo - Vista principal del sistema de monitoreo
router.get('/monitoreo', async (req, res) => {
  try {
    res.render('ai/monitoreo', { title: 'Sistema de Monitoreo IA' });
  } catch (err) {
    console.error('[AI Monitoreo] Error:', err.message);
    res.render('error', { title: 'Error', message: err.message });
  }
});

// GET /ai/monitoreo/prompts - Vista gestion de prompts
router.get('/monitoreo/prompts', async (req, res) => {
  try {
    res.render('ai/monitoreo-prompts', { title: 'Prompts de Monitoreo' });
  } catch (err) {
    res.render('error', { title: 'Error', message: err.message });
  }
});

// GET /ai/monitoreo/sesiones - Vista historial de sesiones
router.get('/monitoreo/sesiones', async (req, res) => {
  try {
    res.render('ai/monitoreo-sesiones', { title: 'Sesiones de Monitoreo' });
  } catch (err) {
    res.render('error', { title: 'Error', message: err.message });
  }
});

// ============================================================================
// API endpoints para el panel de monitoreo
// ============================================================================

// GET /ai/api/monitoreo/prompts - Lista prompts para Syncfusion Grid
router.get('/api/monitoreo/prompts', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const skip = parseInt(req.query.$skip) || 0;
    const take = parseInt(req.query.$take) || 50;

    const prompts = await api.query(
      `SELECT * FROM conf_monitoreo_prompts ORDER BY tipo, subtipo, orden LIMIT ${take} OFFSET ${skip}`
    );
    const countResult = await api.query(
      `SELECT COUNT(*) AS total FROM conf_monitoreo_prompts`
    );

    res.json({
      result: prompts || [],
      count: countResult?.[0]?.total || 0,
    });
  } catch (err) {
    res.json({ result: [], count: 0 });
  }
});

// POST /ai/api/monitoreo/prompt - Crear/actualizar prompt
router.post('/api/monitoreo/prompt', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const { id, nombre, tipo, subtipo, prompt_sistema, primer_mensaje, idioma, activo, orden, notas } = req.body;

    const data = {
      nombre: nombre || '',
      tipo: tipo || 'saliente',
      subtipo: subtipo || 'custom',
      prompt_sistema: prompt_sistema || '',
      primer_mensaje: primer_mensaje || null,
      idioma: idioma || 'es',
      activo: activo !== undefined ? (activo ? 1 : 0) : 1,
      orden: parseInt(orden) || 0,
      notas: notas || null,
    };

    if (id) {
      await api.update('conf_monitoreo_prompts', parseInt(id), data);
      monitoreoPrompts.invalidateCache();
      res.json({ success: true, message: 'Prompt actualizado' });
    } else {
      await api.insert('conf_monitoreo_prompts', data);
      monitoreoPrompts.invalidateCache();
      res.json({ success: true, message: 'Prompt creado' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /ai/api/monitoreo/prompt/:id
router.delete('/api/monitoreo/prompt/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    await api.remove('conf_monitoreo_prompts', parseInt(req.params.id));
    monitoreoPrompts.invalidateCache();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ai/api/monitoreo/sesiones - Lista sesiones para Syncfusion Grid
router.get('/api/monitoreo/sesiones', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const skip = parseInt(req.query.$skip) || 0;
    const take = parseInt(req.query.$take) || 20;

    const conditions = [];
    if (req.query.direccion) conditions.push(`ms.direccion = '${req.query.direccion}'`);
    if (req.query.estado) conditions.push(`ms.estado = '${req.query.estado}'`);
    if (req.query.tripId) conditions.push(`ms.id_unidad_viaje = ${parseInt(req.query.tripId)}`);
    if (req.query.fechaDesde) conditions.push(`ms.creado_en >= '${req.query.fechaDesde}'`);
    if (req.query.fechaHasta) conditions.push(`ms.creado_en <= '${req.query.fechaHasta} 23:59:59'`);

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const sesiones = await api.query(
      `SELECT ms.*,
              uv.placas_unidad, uv.numero_contenedor
       FROM log_monitoreo_sesiones ms
       LEFT JOIN unidades_viajes uv ON uv.id = ms.id_unidad_viaje
       ${where}
       ORDER BY ms.id DESC
       LIMIT ${take} OFFSET ${skip}`
    );

    const countResult = await api.query(
      `SELECT COUNT(*) AS total FROM log_monitoreo_sesiones ms ${where}`
    );

    res.json({
      result: sesiones || [],
      count: countResult?.[0]?.total || 0,
    });
  } catch (err) {
    res.json({ result: [], count: 0 });
  }
});

// GET /ai/api/monitoreo/sesion/:id - Detalle de una sesion
router.get('/api/monitoreo/sesion/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const id = parseInt(req.params.id);

    const sesiones = await api.query(
      `SELECT ms.*, p.nombre AS prompt_nombre, p.subtipo AS prompt_subtipo,
              uv.placas_unidad, uv.numero_contenedor, uv.nombre_operador
       FROM log_monitoreo_sesiones ms
       LEFT JOIN conf_monitoreo_prompts p ON p.id = ms.prompt_id
       LEFT JOIN unidades_viajes uv ON uv.id = ms.id_unidad_viaje
       WHERE ms.id = ${id} LIMIT 1`
    );

    if (!sesiones || sesiones.length === 0) {
      return res.status(404).json({ success: false, error: 'Sesion no encontrada' });
    }

    const transcripciones = await api.query(
      `SELECT * FROM log_monitoreo_transcripciones WHERE sesion_id = ${id} ORDER BY id ASC`
    );

    const intenciones = await api.query(
      `SELECT * FROM op_monitoreo_intenciones WHERE sesion_id = ${id} ORDER BY id ASC`
    );

    res.json({
      success: true,
      sesion: sesiones[0],
      transcripciones: transcripciones || [],
      intenciones: intenciones || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ai/api/monitoreo/intenciones - Intenciones pendientes
router.get('/api/monitoreo/intenciones', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const skip = parseInt(req.query.$skip) || 0;
    const take = parseInt(req.query.$take) || 20;
    const estado = req.query.estado || 'pendiente';

    const intenciones = await api.query(
      `SELECT oi.*, ms.telefono, ms.nombre_contacto, ms.direccion AS sesion_direccion,
              uv.placas_unidad
       FROM op_monitoreo_intenciones oi
       LEFT JOIN log_monitoreo_sesiones ms ON ms.id = oi.sesion_id
       LEFT JOIN unidades_viajes uv ON uv.id = oi.id_unidad_viaje
       WHERE oi.estado = '${estado}'
       ORDER BY FIELD(oi.prioridad, 'critica','alta','media','baja'), oi.creado_en DESC
       LIMIT ${take} OFFSET ${skip}`
    );

    const countResult = await api.query(
      `SELECT COUNT(*) AS total FROM op_monitoreo_intenciones WHERE estado = '${estado}'`
    );

    res.json({
      result: intenciones || [],
      count: countResult?.[0]?.total || 0,
    });
  } catch (err) {
    res.json({ result: [], count: 0 });
  }
});

// POST /ai/api/monitoreo/intencion/:id/procesar - Marcar intencion como procesada
router.post('/api/monitoreo/intencion/:id/procesar', async (req, res) => {
  try {
    const { notas } = req.body;
    const user = req.session.user?.username || 'admin';
    await monitoreoIntenciones.procesarIntencion(parseInt(req.params.id), user, notas);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ai/api/monitoreo/numeros - Numeros autorizados
router.get('/api/monitoreo/numeros', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const numeros = await api.query(
      `SELECT mn.*, uv.placas_unidad, uv.estado_actual AS viaje_estado
       FROM conf_monitoreo_numeros mn
       LEFT JOIN unidades_viajes uv ON uv.id = mn.id_unidad_viaje
       ORDER BY mn.activo DESC, mn.id DESC
       LIMIT 200`
    );
    res.json({ success: true, data: numeros || [] });
  } catch (err) {
    res.json({ success: false, data: [] });
  }
});

// POST /ai/api/monitoreo/sync-numbers - Forzar sync de numeros
router.post('/api/monitoreo/sync-numbers', async (req, res) => {
  try {
    const result = await monitoreoSync.syncNumbers();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ai/api/monitoreo/eventos - Log de eventos del sistema
router.get('/api/monitoreo/eventos', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const skip = parseInt(req.query.$skip) || 0;
    const take = parseInt(req.query.$take) || 50;

    const eventos = await api.query(
      `SELECT * FROM log_monitoreo_eventos ORDER BY id DESC LIMIT ${take} OFFSET ${skip}`
    );
    const countResult = await api.query(
      `SELECT COUNT(*) AS total FROM log_monitoreo_eventos`
    );

    res.json({
      result: eventos || [],
      count: countResult?.[0]?.total || 0,
    });
  } catch (err) {
    res.json({ result: [], count: 0 });
  }
});

// GET /ai/api/monitoreo/stats - Estadisticas del sistema de monitoreo
router.get('/api/monitoreo/stats', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const todayStr = new Date().toISOString().slice(0, 10);

    const sesionesHoy = await api.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN direccion = 'entrante' THEN 1 ELSE 0 END) AS entrantes,
         SUM(CASE WHEN direccion = 'saliente' THEN 1 ELSE 0 END) AS salientes,
         SUM(CASE WHEN estado = 'completada' THEN 1 ELSE 0 END) AS completadas,
         SUM(CASE WHEN estado = 'fallida' THEN 1 ELSE 0 END) AS fallidas,
         SUM(CASE WHEN estado = 'zombie' THEN 1 ELSE 0 END) AS zombies
       FROM log_monitoreo_sesiones
       WHERE DATE(creado_en) = '${todayStr}'`
    );

    const intencionesHoy = await api.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes,
         SUM(CASE WHEN prioridad IN ('alta','critica') THEN 1 ELSE 0 END) AS urgentes
       FROM op_monitoreo_intenciones
       WHERE DATE(creado_en) = '${todayStr}'`
    );

    const numerosActivos = await api.query(
      `SELECT COUNT(*) AS total FROM conf_monitoreo_numeros WHERE activo = 1`
    );

    const promptsActivos = await api.query(
      `SELECT COUNT(*) AS total FROM conf_monitoreo_prompts WHERE activo = 1`
    );

    res.json({
      sesionesHoy: sesionesHoy?.[0] || {},
      intencionesHoy: intencionesHoy?.[0] || {},
      numerosActivos: numerosActivos?.[0]?.total || 0,
      promptsActivos: promptsActivos?.[0]?.total || 0,
    });
  } catch (err) {
    res.json({ sesionesHoy: {}, intencionesHoy: {}, numerosActivos: 0, promptsActivos: 0 });
  }
});

module.exports = router;
