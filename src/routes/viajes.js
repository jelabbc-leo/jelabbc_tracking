/**
 * Rutas de Viajes (unidades_viajes)
 * CRUD completo + filtros + estadisticas + detalle con coordenadas/eventos/contactos
 */

const express = require('express');
const router = express.Router();
const { createClient } = require('../api/client');

// ---------------------------------------------------------------------------
// GET /viajes - Listar viajes (pagina principal con stats)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Obtener estadisticas para los cards
    const [viajes, statsRows] = await Promise.all([
      api.query(
        `SELECT uv.*, cp.nombre AS provider_nombre
         FROM unidades_viajes uv
         LEFT JOIN conf_providers cp ON uv.provider_id = cp.id
         ORDER BY uv.fecha_salida DESC
         LIMIT 200`
      ),
      api.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN estado_actual = 'en_ruta' THEN 1 ELSE 0 END) AS en_ruta,
           SUM(CASE WHEN estado_actual = 'en_espera' THEN 1 ELSE 0 END) AS en_espera,
           SUM(CASE WHEN estado_actual = 'cargando' THEN 1 ELSE 0 END) AS cargando,
           SUM(CASE WHEN estado_actual = 'completado' THEN 1 ELSE 0 END) AS completado,
           SUM(CASE WHEN estado_actual = 'cancelado' THEN 1 ELSE 0 END) AS cancelado
         FROM unidades_viajes`
      )
    ]);

    const stats = (statsRows && statsRows.length > 0) ? statsRows[0] : {
      total: 0, en_ruta: 0, en_espera: 0, cargando: 0, completado: 0, cancelado: 0
    };

    res.render('viajes/index', {
      title: 'Viajes',
      viajes: viajes || [],
      stats
    });
  } catch (err) {
    console.error('[Viajes] Error:', err.message);
    res.render('viajes/index', {
      title: 'Viajes',
      viajes: [],
      stats: { total: 0, en_ruta: 0, en_espera: 0, cargando: 0, completado: 0, cancelado: 0 }
    });
  }
});

// ---------------------------------------------------------------------------
// GET /viajes/api/list - API JSON para Syncfusion Grid (con filtro opcional)
// ---------------------------------------------------------------------------
router.get('/api/list', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const { estado, q } = req.query;

    let sql = `SELECT uv.*, cp.nombre AS provider_nombre
               FROM unidades_viajes uv
               LEFT JOIN conf_providers cp ON uv.provider_id = cp.id`;

    const conditions = [];

    // Filtro por estado
    if (estado && estado !== 'all') {
      conditions.push(`uv.estado_actual = '${estado.replace(/'/g, "''")}'`);
    }

    // Busqueda por texto
    if (q && q.trim()) {
      const search = q.trim().replace(/'/g, "''");
      conditions.push(
        `(uv.numero_economico LIKE '%${search}%'
          OR uv.origen LIKE '%${search}%'
          OR uv.destino LIKE '%${search}%'
          OR uv.placas_unidad LIKE '%${search}%'
          OR uv.numero_contenedor LIKE '%${search}%'
          OR CAST(uv.id AS CHAR) LIKE '%${search}%')`
      );
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY uv.fecha_salida DESC LIMIT 200';

    const viajes = await api.query(sql);
    res.json({ result: viajes || [], count: (viajes || []).length });
  } catch (err) {
    console.error('[Viajes API] Error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// ---------------------------------------------------------------------------
// GET /viajes/api/stats - Estadisticas para cards
// ---------------------------------------------------------------------------
router.get('/api/stats', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const rows = await api.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN estado_actual = 'en_ruta' THEN 1 ELSE 0 END) AS en_ruta,
         SUM(CASE WHEN estado_actual = 'en_espera' THEN 1 ELSE 0 END) AS en_espera,
         SUM(CASE WHEN estado_actual = 'cargando' THEN 1 ELSE 0 END) AS cargando,
         SUM(CASE WHEN estado_actual = 'completado' THEN 1 ELSE 0 END) AS completado,
         SUM(CASE WHEN estado_actual = 'cancelado' THEN 1 ELSE 0 END) AS cancelado
       FROM unidades_viajes`
    );
    res.json({ success: true, data: rows[0] || {} });
  } catch (err) {
    console.error('[Viajes API] Stats error:', err.message);
    res.json({ success: true, data: { total: 0, en_ruta: 0, en_espera: 0, cargando: 0, completado: 0, cancelado: 0 } });
  }
});

// ---------------------------------------------------------------------------
// GET /viajes/api/detail/:id - Detalle JSON de un viaje
// ---------------------------------------------------------------------------
router.get('/api/detail/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const id = parseInt(req.params.id);
    const rows = await api.query(
      `SELECT uv.*, cp.nombre AS provider_nombre
       FROM unidades_viajes uv
       LEFT JOIN conf_providers cp ON uv.provider_id = cp.id
       WHERE uv.id = ${id} LIMIT 1`
    );
    if (rows && rows.length > 0) {
      res.json({ success: true, data: rows[0] });
    } else {
      res.status(404).json({ success: false, error: 'Viaje no encontrado' });
    }
  } catch (err) {
    console.error('[Viajes API] Detail error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /viajes/api/coordinates/:id - Coordenadas de un viaje (para grid)
// ---------------------------------------------------------------------------
router.get('/api/coordinates/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const id = parseInt(req.params.id);
    const coords = await api.query(
      `SELECT oc.*, cp.nombre AS provider_nombre
       FROM op_coordinates oc
       LEFT JOIN conf_providers cp ON oc.provider_id = cp.id
       WHERE oc.id_unidad_viaje = ${id}
       ORDER BY oc.fecha_extraccion DESC
       LIMIT 500`
    );
    res.json({ result: coords || [], count: (coords || []).length });
  } catch (err) {
    console.error('[Viajes API] Coords error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// ---------------------------------------------------------------------------
// GET /viajes/api/events/:id - Eventos de un viaje (para grid)
// ---------------------------------------------------------------------------
router.get('/api/events/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const id = parseInt(req.params.id);
    const events = await api.query(
      `SELECT * FROM eventos_unidad
       WHERE id_unidad_viaje = ${id}
       ORDER BY fecha_evento DESC
       LIMIT 100`
    );
    res.json({ result: events || [], count: (events || []).length });
  } catch (err) {
    console.error('[Viajes API] Events error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// ---------------------------------------------------------------------------
// GET /viajes/api/contacts/:id - Contactos de un viaje
// ---------------------------------------------------------------------------
router.get('/api/contacts/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const id = parseInt(req.params.id);
    const contacts = await api.query(
      `SELECT * FROM contactos_viaje
       WHERE id_unidad_viaje = ${id}
       ORDER BY tipo_contacto ASC`
    );
    res.json({ result: contacts || [], count: (contacts || []).length });
  } catch (err) {
    console.error('[Viajes API] Contacts error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// ---------------------------------------------------------------------------
// GET /viajes/:id - Detalle de viaje (pagina completa)
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const id = parseInt(req.params.id);

    const [viajes, coords, eventos, contactos] = await Promise.all([
      api.query(
        `SELECT uv.*, cp.nombre AS provider_nombre
         FROM unidades_viajes uv
         LEFT JOIN conf_providers cp ON uv.provider_id = cp.id
         WHERE uv.id = ${id}`
      ),
      api.query(
        `SELECT oc.*, cp.nombre AS provider_nombre
         FROM op_coordinates oc
         LEFT JOIN conf_providers cp ON oc.provider_id = cp.id
         WHERE oc.id_unidad_viaje = ${id}
         ORDER BY oc.fecha_extraccion DESC
         LIMIT 500`
      ),
      api.query(
        `SELECT * FROM eventos_unidad
         WHERE id_unidad_viaje = ${id}
         ORDER BY fecha_evento DESC
         LIMIT 50`
      ),
      api.query(
        `SELECT * FROM contactos_viaje
         WHERE id_unidad_viaje = ${id}
         ORDER BY tipo_contacto ASC`
      )
    ]);

    if (!viajes || viajes.length === 0) {
      return res.status(404).render('error', {
        title: 'Viaje no encontrado',
        message: 'El viaje solicitado no existe.'
      });
    }

    res.render('viajes/detail', {
      title: `Viaje #${id}`,
      viaje: viajes[0],
      coordenadas: coords || [],
      eventos: eventos || [],
      contactos: contactos || []
    });
  } catch (err) {
    console.error('[Viajes] Detail error:', err.message);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Error al cargar el detalle del viaje.'
    });
  }
});

module.exports = router;
