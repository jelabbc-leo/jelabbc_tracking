/**
 * Rutas de Proveedores GPS (conf_providers)
 */

const express = require('express');
const router = express.Router();
const { createClient } = require('../api/client');

// GET /providers - Listar proveedores
router.get('/', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const providers = await api.query('SELECT * FROM conf_providers ORDER BY nombre ASC');

    res.render('providers/index', {
      title: 'Proveedores GPS',
      providers: providers || []
    });
  } catch (err) {
    console.error('[Providers] Error:', err.message);
    res.render('providers/index', {
      title: 'Proveedores GPS',
      providers: []
    });
  }
});

// GET /providers/api/list - API JSON para Syncfusion Grid
router.get('/api/list', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const providers = await api.query('SELECT * FROM conf_providers ORDER BY nombre ASC');
    res.json({ result: providers || [], count: (providers || []).length });
  } catch (err) {
    console.error('[Providers API] Error:', err.message);
    res.json({ result: [], count: 0 });
  }
});

// GET /providers/api/detail/:id - Detalle de un proveedor (para editar)
router.get('/api/detail/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const rows = await api.query(
      `SELECT * FROM conf_providers WHERE id = ${parseInt(req.params.id)} LIMIT 1`
    );
    if (rows && rows.length > 0) {
      res.json({ success: true, data: rows[0] });
    } else {
      res.status(404).json({ success: false, error: 'Proveedor no encontrado' });
    }
  } catch (err) {
    console.error('[Providers API] Detail error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /providers/api/create
router.post('/api/create', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const result = await api.insert('conf_providers', req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Providers API] Create error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /providers/api/update/:id
router.put('/api/update/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const result = await api.update('conf_providers', req.params.id, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Providers API] Update error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /providers/api/delete/:id
router.delete('/api/delete/:id', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const result = await api.remove('conf_providers', req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Providers API] Delete error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
