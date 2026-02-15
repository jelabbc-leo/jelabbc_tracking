/**
 * Rutas de Logs del scraper (log_scrape)
 * Muestra historial de ejecuciones, permite ejecucion manual,
 * y consulta de estado del coordinator.
 *
 * Endpoints:
 *   GET  /logs            - Vista principal (Syncfusion Grid)
 *   GET  /logs/api/list   - JSON con paginacion, filtros, sorting (DataManager)
 *   GET  /logs/api/detail/:id - Detalle de un log
 *   GET  /logs/api/stats  - Estadisticas resumen
 *   POST /logs/api/clear  - Limpiar logs antiguos (>30 dias)
 */

'use strict';

const express = require('express');
const router = express.Router();
const { createClient } = require('../api/client');

// ============================================================================
// GET /logs - Vista principal
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Cargar proveedores para el filtro dropdown
    const providers = await api.query(
      'SELECT id, nombre, activo FROM conf_providers ORDER BY nombre ASC'
    );

    res.render('logs', {
      title: 'Logs del Scraper',
      providers: providers || [],
    });
  } catch (err) {
    console.error('[Logs] Error:', err.message);
    res.render('logs', {
      title: 'Logs del Scraper',
      providers: [],
    });
  }
});

// ============================================================================
// GET /logs/api/list - API JSON para Syncfusion DataManager
// Soporta paginacion, filtros y sorting server-side
// ============================================================================

router.get('/api/list', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Parametros de paginacion
    const skip = parseInt(req.query.$skip) || 0;
    const take = parseInt(req.query.$take) || 20;

    // Filtros opcionales (via query string directo)
    const providerId = req.query.providerId;
    const estado = req.query.estado;
    const fechaDesde = req.query.fechaDesde;
    const fechaHasta = req.query.fechaHasta;

    // Construir clausulas WHERE
    const conditions = [];
    if (providerId) {
      conditions.push(`ls.provider_id = ${parseInt(providerId)}`);
    }
    if (estado && ['running', 'success', 'error'].includes(estado)) {
      conditions.push(`ls.estado = '${estado}'`);
    }
    if (fechaDesde) {
      conditions.push(`ls.inicio >= '${fechaDesde}'`);
    }
    if (fechaHasta) {
      conditions.push(`ls.inicio <= '${fechaHasta} 23:59:59'`);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // Sorting (default: id DESC)
    let orderBy = 'ls.id DESC';
    if (req.query.$orderby) {
      // Syncfusion envia algo como "inicio desc" o "estado asc"
      const parts = req.query.$orderby.split(' ');
      const allowedFields = ['id', 'provider_nombre', 'estado', 'inicio', 'fin',
        'dispositivos_encontrados', 'coordenadas_nuevas', 'fuentes_usadas'];
      const field = parts[0];
      const dir = parts[1] === 'asc' ? 'ASC' : 'DESC';
      if (allowedFields.includes(field)) {
        // provider_nombre necesita alias
        const dbField = field === 'provider_nombre' ? 'cp.nombre' : `ls.${field}`;
        orderBy = `${dbField} ${dir}`;
      }
    }

    // Query principal con paginacion
    const logs = await api.query(
      `SELECT ls.*, cp.nombre AS provider_nombre
       FROM log_scrape ls
       LEFT JOIN conf_providers cp ON cp.id = ls.provider_id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${take} OFFSET ${skip}`
    );

    // Count total (con mismos filtros)
    const countResult = await api.query(
      `SELECT COUNT(*) AS total
       FROM log_scrape ls
       LEFT JOIN conf_providers cp ON cp.id = ls.provider_id
       ${whereClause}`
    );
    const total = countResult && countResult.length > 0 ? countResult[0].total : 0;

    res.json({
      result: logs || [],
      count: total,
    });
  } catch (err) {
    console.error('[Logs API] Error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// ============================================================================
// GET /logs/api/stats - Estadisticas resumidas
// ============================================================================

router.get('/api/stats', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Estadisticas generales
    const totalResult = await api.query(
      'SELECT COUNT(*) AS total FROM log_scrape'
    );

    // Hoy
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayResult = await api.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN estado = 'success' THEN 1 ELSE 0 END) AS exitosos,
         SUM(CASE WHEN estado = 'error' THEN 1 ELSE 0 END) AS errores,
         SUM(CASE WHEN estado = 'running' THEN 1 ELSE 0 END) AS ejecutando,
         SUM(COALESCE(coordenadas_nuevas, 0)) AS coords_nuevas,
         SUM(COALESCE(dispositivos_encontrados, 0)) AS dispositivos
       FROM log_scrape
       WHERE DATE(inicio) = '${todayStr}'`
    );

    // Promedio duracion (ultimos 50 exitosos)
    const avgResult = await api.query(
      `SELECT AVG(TIMESTAMPDIFF(SECOND, inicio, fin)) AS avg_duracion
       FROM log_scrape
       WHERE estado = 'success' AND fin IS NOT NULL
       ORDER BY id DESC
       LIMIT 50`
    );

    // Ultima ejecucion
    const lastResult = await api.query(
      `SELECT ls.*, cp.nombre AS provider_nombre
       FROM log_scrape ls
       LEFT JOIN conf_providers cp ON cp.id = ls.provider_id
       ORDER BY ls.id DESC LIMIT 1`
    );

    const today = todayResult && todayResult.length > 0 ? todayResult[0] : {};
    const total = totalResult && totalResult.length > 0 ? totalResult[0].total : 0;
    const avgDuration = avgResult && avgResult.length > 0 ? avgResult[0].avg_duracion : null;
    const lastRun = lastResult && lastResult.length > 0 ? lastResult[0] : null;

    const todayTotal = parseInt(today.total) || 0;
    const todayExitosos = parseInt(today.exitosos) || 0;
    const successRate = todayTotal > 0 ? Math.round((todayExitosos / todayTotal) * 100) : 0;

    res.json({
      total: parseInt(total) || 0,
      today: {
        total: todayTotal,
        exitosos: todayExitosos,
        errores: parseInt(today.errores) || 0,
        ejecutando: parseInt(today.ejecutando) || 0,
        coordsNuevas: parseInt(today.coords_nuevas) || 0,
        dispositivos: parseInt(today.dispositivos) || 0,
        successRate,
      },
      avgDurationSecs: avgDuration ? Math.round(parseFloat(avgDuration)) : null,
      lastRun,
    });
  } catch (err) {
    console.error('[Logs Stats] Error:', err.message);
    res.json({
      total: 0,
      today: { total: 0, exitosos: 0, errores: 0, ejecutando: 0, coordsNuevas: 0, dispositivos: 0, successRate: 0 },
      avgDurationSecs: null,
      lastRun: null,
    });
  }
});

// ============================================================================
// GET /logs/api/detail/:id - Detalle de un log
// ============================================================================

router.get('/api/detail/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const rows = await api.query(
      `SELECT ls.*, cp.nombre AS provider_nombre
       FROM log_scrape ls
       LEFT JOIN conf_providers cp ON cp.id = ls.provider_id
       WHERE ls.id = ${parseInt(req.params.id)}
       LIMIT 1`
    );

    if (rows && rows.length > 0) {
      res.json({ success: true, data: rows[0] });
    } else {
      res.status(404).json({ success: false, error: 'Log no encontrado' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// POST /logs/api/clear - Limpiar logs antiguos (mas de 30 dias)
// Usa el CRUD delete individual para cada log antiguo
// ============================================================================

router.post('/api/clear', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');

    // Primero obtener los IDs de los logs a eliminar
    const oldLogs = await api.query(
      `SELECT id FROM log_scrape WHERE creado_en < '${thirtyDaysAgo}' ORDER BY id ASC LIMIT 500`
    );

    if (!oldLogs || oldLogs.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No hay logs antiguos para eliminar' });
    }

    // Eliminar uno por uno via el CRUD generico
    let deleted = 0;
    let errors = 0;

    for (const log of oldLogs) {
      try {
        await api.remove('log_scrape', log.id);
        deleted++;
      } catch {
        errors++;
      }
    }

    const remaining = oldLogs.length === 500 ? ' (puede haber mas)' : '';
    res.json({
      success: true,
      deleted,
      errors,
      message: `${deleted} logs eliminados${remaining}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
