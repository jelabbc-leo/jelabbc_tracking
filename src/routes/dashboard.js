/**
 * Rutas del Dashboard - Google Maps + tarjetas resumen Syncfusion
 *
 * Obtiene viajes activos, estadisticas, proveedores activos,
 * ultimos eventos y logs de scraping para mostrar en el dashboard.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { createClient } = require('../api/client');

// GET /dashboard
router.get('/', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Ejecutar todas las consultas en paralelo
    const [viajes, providers, recentEvents, scrapeStats, todayCompleted] = await Promise.allSettled([
      // 1. Viajes activos (con coordenadas)
      api.query(
        `SELECT uv.*, 
                TIMESTAMPDIFF(MINUTE, uv.ultima_actualizacion_gps, NOW()) AS minutos_sin_update
         FROM unidades_viajes uv
         WHERE uv.estado_actual IN ('en_ruta','en_espera','cargando')
         ORDER BY uv.fecha_salida DESC
         LIMIT 100`
      ),

      // 2. Proveedores GPS activos
      api.query(
        `SELECT id, nombre, url, activo, ultimo_scrape, ultimo_error
         FROM conf_providers
         WHERE activo = 1
         ORDER BY ultimo_scrape DESC`
      ),

      // 3. Ultimos eventos relevantes
      api.query(
        `SELECT eu.*, uv.numero_economico
         FROM eventos_unidad eu
         LEFT JOIN unidades_viajes uv ON eu.id_unidad_viaje = uv.id
         ORDER BY eu.fecha_hora DESC
         LIMIT 15`
      ),

      // 4. Resumen de scraping (ultimas 24h)
      api.query(
        `SELECT 
           COUNT(*) AS total_scrapes,
           SUM(CASE WHEN estado = 'success' THEN 1 ELSE 0 END) AS exitosos,
           SUM(CASE WHEN estado = 'error' THEN 1 ELSE 0 END) AS errores,
           SUM(coordenadas_nuevas) AS total_coords,
           MAX(fin) AS ultimo_scrape
         FROM log_scrape
         WHERE inicio >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      ),

      // 5. Viajes completados hoy
      api.query(
        `SELECT COUNT(*) AS total
         FROM unidades_viajes
         WHERE estado_actual = 'completado'
           AND DATE(fecha_llegada) = CURDATE()`
      ),
    ]);

    // Extraer resultados (con fallback seguro si alguna consulta falla)
    const viajesData = viajes.status === 'fulfilled' && Array.isArray(viajes.value)
      ? viajes.value : [];

    const providersData = providers.status === 'fulfilled' && Array.isArray(providers.value)
      ? providers.value : [];

    const eventsData = recentEvents.status === 'fulfilled' && Array.isArray(recentEvents.value)
      ? recentEvents.value : [];

    const scrapeData = scrapeStats.status === 'fulfilled' && Array.isArray(scrapeStats.value) && scrapeStats.value[0]
      ? scrapeStats.value[0] : { total_scrapes: 0, exitosos: 0, errores: 0, total_coords: 0, ultimo_scrape: null };

    const completadosHoy = todayCompleted.status === 'fulfilled' && Array.isArray(todayCompleted.value) && todayCompleted.value[0]
      ? parseInt(todayCompleted.value[0].total) || 0 : 0;

    // Calcular estadisticas
    const enRuta = viajesData.filter(v => v.estado_actual === 'en_ruta').length;
    const enEspera = viajesData.filter(v => v.estado_actual === 'en_espera').length;
    const cargando = viajesData.filter(v => v.estado_actual === 'cargando').length;
    const total = viajesData.length;

    // Detectar alertas (viajes sin actualización GPS > umbral)
    const alertas = viajesData.filter(v => {
      const minSinUpdate = parseInt(v.minutos_sin_update) || 0;
      const umbral = parseInt(v.umbral_paro_minutos) || 30;
      return v.ultima_lat && v.ultima_lng && minSinUpdate > umbral;
    });

    res.render('dashboard', {
      title: 'Dashboard',
      viajes: viajesData,
      stats: {
        total,
        enRuta,
        enEspera,
        cargando,
        completadosHoy,
        alertas: alertas.length,
        providersActivos: providersData.length,
      },
      providers: providersData,
      events: eventsData,
      scrapeStats: scrapeData,
      alertaViajes: alertas,
    });
  } catch (err) {
    console.error('[Dashboard] Error:', err.message);
    res.render('dashboard', {
      title: 'Dashboard',
      viajes: [],
      stats: {
        total: 0, enRuta: 0, enEspera: 0, cargando: 0,
        completadosHoy: 0, alertas: 0, providersActivos: 0,
      },
      providers: [],
      events: [],
      scrapeStats: { total_scrapes: 0, exitosos: 0, errores: 0, total_coords: 0, ultimo_scrape: null },
      alertaViajes: [],
    });
  }
});

// GET /dashboard/api/refresh - Endpoint AJAX para refrescar datos
router.get('/api/refresh', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    const viajes = await api.query(
      `SELECT *,
              TIMESTAMPDIFF(MINUTE, ultima_actualizacion_gps, NOW()) AS minutos_sin_update
       FROM unidades_viajes
       WHERE estado_actual IN ('en_ruta','en_espera','cargando')
       ORDER BY fecha_salida DESC
       LIMIT 100`
    );

    const viajesData = Array.isArray(viajes) ? viajes : [];

    const enRuta = viajesData.filter(v => v.estado_actual === 'en_ruta').length;
    const enEspera = viajesData.filter(v => v.estado_actual === 'en_espera').length;
    const cargando = viajesData.filter(v => v.estado_actual === 'cargando').length;

    const alertas = viajesData.filter(v => {
      const minSinUpdate = parseInt(v.minutos_sin_update) || 0;
      const umbral = parseInt(v.umbral_paro_minutos) || 30;
      return v.ultima_lat && v.ultima_lng && minSinUpdate > umbral;
    });

    res.json({
      success: true,
      viajes: viajesData,
      stats: {
        total: viajesData.length,
        enRuta,
        enEspera,
        cargando,
        alertas: alertas.length,
      },
    });
  } catch (err) {
    console.error('[Dashboard API] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
