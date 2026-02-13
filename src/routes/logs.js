/**
 * Rutas de Logs del scraper (log_scrape)
 * Se completara en Fase 2
 */

const express = require('express');
const router = express.Router();

// GET /logs - Logs del scraper
router.get('/', (req, res) => {
  res.render('logs', {
    title: 'Logs del Scraper',
    logs: []
  });
});

module.exports = router;
