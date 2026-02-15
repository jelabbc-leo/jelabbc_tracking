/**
 * Rutas de Coordenadas (op_coordinates)
 *
 * Endpoints:
 *   GET  /coordinates           - Vista principal (Syncfusion Grid)
 *   GET  /coordinates/api/list  - JSON con paginacion, filtros, sorting (DataManager)
 *   GET  /coordinates/api/stats - Estadisticas resumidas
 *   GET  /coordinates/api/export - Export CSV
 */

'use strict';

const express = require('express');
const router = express.Router();
const { createClient } = require('../api/client');

// ============================================================================
// GET /coordinates - Vista principal
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Cargar viajes para filtro dropdown
    const viajes = await api.query(
      `SELECT DISTINCT uv.id, uv.id_unidad, uv.origen, uv.destino
       FROM unidades_viajes uv
       INNER JOIN op_coordinates oc ON oc.id_unidad_viaje = uv.id
       ORDER BY uv.id DESC
       LIMIT 100`
    ).catch(() => []);

    // Cargar proveedores para filtro dropdown
    const providers = await api.query(
      'SELECT id, nombre FROM conf_providers ORDER BY nombre ASC'
    ).catch(() => []);

    res.render('coordinates', {
      title: 'Coordenadas',
      viajes: viajes || [],
      providers: providers || [],
    });
  } catch (err) {
    console.error('[Coordinates] Error:', err.message);
    res.render('coordinates', {
      title: 'Coordenadas',
      viajes: [],
      providers: [],
    });
  }
});

// ============================================================================
// GET /coordinates/api/list - API JSON para Syncfusion DataManager
// ============================================================================

router.get('/api/list', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    const skip = parseInt(req.query.$skip) || 0;
    const take = parseInt(req.query.$take) || 20;

    // Filtros
    const viajeId = req.query.viajeId;
    const providerId = req.query.providerId;
    const fechaDesde = req.query.fechaDesde;
    const fechaHasta = req.query.fechaHasta;

    const conditions = [];
    if (viajeId) {
      conditions.push(`oc.id_unidad_viaje = ${parseInt(viajeId)}`);
    }
    if (providerId) {
      conditions.push(`oc.provider_id = ${parseInt(providerId)}`);
    }
    if (fechaDesde) {
      conditions.push(`oc.fecha_extraccion >= '${fechaDesde}'`);
    }
    if (fechaHasta) {
      conditions.push(`oc.fecha_extraccion <= '${fechaHasta} 23:59:59'`);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // Sorting
    let orderBy = 'oc.id DESC';
    if (req.query.$orderby) {
      const parts = req.query.$orderby.split(' ');
      const allowed = ['id', 'latitud', 'longitud', 'velocidad', 'rumbo',
        'fecha_gps', 'fecha_extraccion', 'fuente'];
      if (allowed.includes(parts[0])) {
        orderBy = `oc.${parts[0]} ${parts[1] === 'asc' ? 'ASC' : 'DESC'}`;
      }
    }

    const coords = await api.query(
      `SELECT oc.*, cp.nombre AS provider_nombre,
              uv.id_unidad AS viaje_unidad, uv.origen AS viaje_origen, uv.destino AS viaje_destino
       FROM op_coordinates oc
       LEFT JOIN conf_providers cp ON cp.id = oc.provider_id
       LEFT JOIN unidades_viajes uv ON uv.id = oc.id_unidad_viaje
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${take} OFFSET ${skip}`
    );

    const countResult = await api.query(
      `SELECT COUNT(*) AS total
       FROM op_coordinates oc
       ${whereClause}`
    );
    const total = countResult && countResult.length > 0 ? countResult[0].total : 0;

    res.json({ result: coords || [], count: total });
  } catch (err) {
    console.error('[Coordinates API] Error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// ============================================================================
// GET /coordinates/api/stats - Estadisticas
// ============================================================================

router.get('/api/stats', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    const todayStr = new Date().toISOString().slice(0, 10);

    const stats = await api.query(
      `SELECT
         COUNT(*) AS total,
         (SELECT COUNT(*) FROM op_coordinates WHERE DATE(fecha_extraccion) = '${todayStr}') AS hoy,
         (SELECT COUNT(DISTINCT id_unidad_viaje) FROM op_coordinates WHERE DATE(fecha_extraccion) = '${todayStr}') AS viajes_hoy,
         (SELECT COUNT(DISTINCT provider_id) FROM op_coordinates WHERE DATE(fecha_extraccion) = '${todayStr}') AS providers_hoy,
         (SELECT AVG(velocidad) FROM op_coordinates WHERE velocidad IS NOT NULL AND velocidad > 0 AND DATE(fecha_extraccion) = '${todayStr}') AS vel_promedio
       FROM op_coordinates`
    );

    const s = stats && stats.length > 0 ? stats[0] : {};

    res.json({
      total: parseInt(s.total) || 0,
      hoy: parseInt(s.hoy) || 0,
      viajesHoy: parseInt(s.viajes_hoy) || 0,
      providersHoy: parseInt(s.providers_hoy) || 0,
      velPromedio: s.vel_promedio ? Math.round(parseFloat(s.vel_promedio)) : 0,
    });
  } catch (err) {
    console.error('[Coordinates Stats] Error:', err.message);
    res.json({ total: 0, hoy: 0, viajesHoy: 0, providersHoy: 0, velPromedio: 0 });
  }
});

// ============================================================================
// GET /coordinates/api/export - Export CSV
// ============================================================================

router.get('/api/export', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Filtros (mismos que la lista)
    const viajeId = req.query.viajeId;
    const providerId = req.query.providerId;
    const fechaDesde = req.query.fechaDesde;
    const fechaHasta = req.query.fechaHasta;

    const conditions = [];
    if (viajeId) conditions.push(`oc.id_unidad_viaje = ${parseInt(viajeId)}`);
    if (providerId) conditions.push(`oc.provider_id = ${parseInt(providerId)}`);
    if (fechaDesde) conditions.push(`oc.fecha_extraccion >= '${fechaDesde}'`);
    if (fechaHasta) conditions.push(`oc.fecha_extraccion <= '${fechaHasta} 23:59:59'`);

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const coords = await api.query(
      `SELECT oc.id, oc.id_unidad_viaje, oc.latitud, oc.longitud,
              oc.velocidad, oc.rumbo, oc.fecha_gps, oc.fecha_extraccion, oc.fuente,
              cp.nombre AS proveedor,
              uv.id_unidad AS unidad, uv.origen, uv.destino
       FROM op_coordinates oc
       LEFT JOIN conf_providers cp ON cp.id = oc.provider_id
       LEFT JOIN unidades_viajes uv ON uv.id = oc.id_unidad_viaje
       ${whereClause}
       ORDER BY oc.fecha_extraccion DESC
       LIMIT 5000`
    );

    // Generar CSV
    const headers = [
      'ID', 'Viaje ID', 'Unidad', 'Origen', 'Destino',
      'Latitud', 'Longitud', 'Velocidad (km/h)', 'Rumbo',
      'Fecha GPS', 'Fecha Extraccion', 'Fuente', 'Proveedor'
    ];

    let csv = '\uFEFF'; // BOM for Excel UTF-8
    csv += headers.join(',') + '\n';

    (coords || []).forEach(c => {
      const row = [
        c.id,
        c.id_unidad_viaje,
        `"${(c.unidad || '').replace(/"/g, '""')}"`,
        `"${(c.origen || '').replace(/"/g, '""')}"`,
        `"${(c.destino || '').replace(/"/g, '""')}"`,
        c.latitud,
        c.longitud,
        c.velocidad || '',
        c.rumbo || '',
        c.fecha_gps || '',
        c.fecha_extraccion || '',
        c.fuente || '',
        `"${(c.proveedor || '').replace(/"/g, '""')}"`,
      ];
      csv += row.join(',') + '\n';
    });

    const filename = `coordenadas_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[Coordinates Export] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
