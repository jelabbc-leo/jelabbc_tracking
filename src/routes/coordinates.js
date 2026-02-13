/**
 * Rutas de Coordenadas (op_coordinates)
 */

const express = require('express');
const router = express.Router();
const { createClient } = require('../api/client');

// GET /coordinates - Historial de coordenadas
router.get('/', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const coords = await api.query(
      'SELECT c.*, uv.numero_economico FROM op_coordinates c LEFT JOIN unidades_viajes uv ON c.id_unidad_viaje = uv.id ORDER BY c.fecha_extraccion DESC LIMIT 200'
    );

    res.render('coordinates', {
      title: 'Coordenadas',
      coordenadas: coords || []
    });
  } catch (err) {
    console.error('[Coordinates] Error:', err.message);
    res.render('coordinates', {
      title: 'Coordenadas',
      coordenadas: []
    });
  }
});

// GET /coordinates/api/list - API JSON
router.get('/api/list', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const viajeId = req.query.viaje_id;

    let sql = 'SELECT * FROM op_coordinates';
    if (viajeId) {
      sql += ` WHERE id_unidad_viaje = ${parseInt(viajeId)}`;
    }
    sql += ' ORDER BY fecha_extraccion DESC LIMIT 500';

    const coords = await api.query(sql);
    res.json({ result: coords || [], count: (coords || []).length });
  } catch (err) {
    console.error('[Coordinates API] Error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

module.exports = router;
