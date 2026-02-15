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

module.exports = router;
