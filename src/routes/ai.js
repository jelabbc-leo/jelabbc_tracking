/**
 * Rutas de IA (conf_ai_protocols, log_ai_calls)
 * Se completara en Fase 3
 */

const express = require('express');
const router = express.Router();

// GET /ai - Config IA
router.get('/', (req, res) => {
  res.render('ai/config', {
    title: 'Configuracion IA'
  });
});

// GET /ai/calls - Historial de llamadas IA
router.get('/calls', (req, res) => {
  res.render('ai/calls', {
    title: 'Llamadas IA'
  });
});

module.exports = router;
