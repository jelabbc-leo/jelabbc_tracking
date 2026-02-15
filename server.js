/**
 * JELABBC Tracking - Entry Point
 * Express server + Scheduler (node-cron)
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 8080;

// ---------------------------------------------------------------------------
// Scraper & Scheduler — requires y estado
// ---------------------------------------------------------------------------
const coordinator = require('./src/scraper/coordinator');
const stopDetector = require('./src/ai/stop-detector');
const vapiTrigger = require('./src/ai/vapi-trigger');

const CRON_EXPRESSION = process.env.CRON_SCHEDULE || '*/1 * * * *';
let schedulerEnabled = (process.env.SCHEDULER_ENABLED || 'true') !== 'false';
let schedulerRunning = false;

// AI Detection state
let aiDetectionEnabled = (process.env.AI_DETECTION_ENABLED || 'true') !== 'false';
let lastDetectionTime = null;
let lastDetectionResult = null;
const AI_DETECTION_INTERVAL_MS = (parseInt(process.env.AI_DETECTION_INTERVAL_MIN) || 5) * 60 * 1000;

// ---------------------------------------------------------------------------
// Trust proxy (Azure App Service corre detras de un reverse proxy)
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// View engine (EJS)
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  secret: process.env.SESSION_SECRET || 'jelabbc-default-secret',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 horas
  }
}));

// Static files
app.use('/public', express.static(path.join(__dirname, 'src', 'public')));

// ---------------------------------------------------------------------------
// Locals para todas las vistas (Syncfusion, Google Maps keys)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.locals.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  res.locals.syncfusionLicense = process.env.SYNCFUSION_LICENSE || '';
  res.locals.user = req.session.user || null;
  next();
});

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.token) {
    return next();
  }
  return res.redirect('/login');
}

// ---------------------------------------------------------------------------
// Routes — vistas
// ---------------------------------------------------------------------------
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const providersRoutes = require('./src/routes/providers');
const viajesRoutes = require('./src/routes/viajes');
const coordinatesRoutes = require('./src/routes/coordinates');
const aiRoutes = require('./src/routes/ai');
const logsRoutes = require('./src/routes/logs');

app.use('/', authRoutes);
app.use('/dashboard', requireAuth, dashboardRoutes);
app.use('/providers', requireAuth, providersRoutes);
app.use('/viajes', requireAuth, viajesRoutes);
app.use('/coordinates', requireAuth, coordinatesRoutes);
app.use('/ai', requireAuth, aiRoutes);
app.use('/logs', requireAuth, logsRoutes);

// Health check (Azure App Service usa esto para verificar que la app esta viva)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Redirect root to dashboard (if logged in) or login
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

// ---------------------------------------------------------------------------
// Scraper API — antes del error/404 handler
// ---------------------------------------------------------------------------

// Status del scraper (para la vista de logs)
app.get('/api/scraper/status', requireAuth, (req, res) => {
  res.json(coordinator.status());
});

// Ejecutar scraping manual
app.post('/api/scraper/run', requireAuth, async (req, res) => {
  try {
    const { providerId } = req.body;
    let result;
    if (providerId) {
      result = await coordinator.runForProvider(providerId);
    } else {
      result = await coordinator.run();
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Scheduler API — status y control en runtime
// ---------------------------------------------------------------------------

app.get('/api/scheduler/status', requireAuth, (req, res) => {
  res.json({
    enabled: schedulerEnabled,
    running: schedulerRunning,
    cron: CRON_EXPRESSION,
  });
});

app.post('/api/scheduler/toggle', requireAuth, (req, res) => {
  schedulerEnabled = !schedulerEnabled;
  console.log(`[Scheduler] ${schedulerEnabled ? 'Habilitado' : 'Deshabilitado'} por usuario`);
  res.json({ enabled: schedulerEnabled });
});

// ---------------------------------------------------------------------------
// AI Stop Detection API — status y ejecucion manual
// ---------------------------------------------------------------------------

app.get('/api/ai/status', requireAuth, (req, res) => {
  res.json({
    detectionEnabled: aiDetectionEnabled,
    lastDetectionTime: lastDetectionTime ? lastDetectionTime.toISOString() : null,
    lastDetectionResult: lastDetectionResult,
  });
});

app.post('/api/ai/toggle-detection', requireAuth, (req, res) => {
  aiDetectionEnabled = !aiDetectionEnabled;
  console.log(`[AI] Deteccion de paros ${aiDetectionEnabled ? 'habilitada' : 'deshabilitada'} por usuario`);
  res.json({ enabled: aiDetectionEnabled });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  console.error('Error no manejado:', err);
  res.status(500).render('error', {
    title: 'Error',
    message: process.env.NODE_ENV === 'production'
      ? 'Ocurrio un error interno'
      : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 - No encontrado',
    message: `La ruta ${req.originalUrl} no existe.`
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[JELABBC Tracking] Servidor iniciado en puerto ${PORT}`);
  console.log(`[JELABBC Tracking] Entorno: ${process.env.NODE_ENV || 'development'}`);
});

// ---------------------------------------------------------------------------
// Scheduler (node-cron) - Fase 2
// Ejecuta cada minuto; el coordinator decide que proveedores estan "due"
// segun su intervalo_minutos individual (conf_providers.intervalo_minutos).
//
// Ejemplo: proveedor A con intervalo_minutos=5 solo se scrapeara si
// su ultimo_scrape fue hace 5+ minutos.
// ---------------------------------------------------------------------------

let _lastQuietLog = 0;

const schedulerTask = cron.schedule(CRON_EXPRESSION, async () => {
  if (!schedulerEnabled) return;
  if (schedulerRunning) return; // Evitar overlap

  schedulerRunning = true;
  try {
    const result = await coordinator.runDueProviders();

    if (result.skipped) {
      // Skip por already_running — silencioso
    } else if (
      result.providersSkipped === result.providers &&
      result.providersSuccess === 0 &&
      result.providersFailed === 0
    ) {
      // Todos saltados (ninguno due): loguear solo cada 10 minutos
      const now = Date.now();
      if (now - _lastQuietLog > 600000) {
        console.log(`[Scheduler] Tick: ${result.providers} proveedores activos, ninguno necesita scraping aun`);
        _lastQuietLog = now;
      }
    } else {
      const processed = result.providers - result.providersSkipped;
      console.log(
        `[Scheduler] Ciclo completado: ${result.providersSuccess}/${processed} OK, ` +
        `${result.totalNewCoords} coords nuevas en ${(result.durationMs / 1000).toFixed(1)}s`
      );
    }

    // --- Fase 3: Deteccion de paros IA ---
    // Se ejecuta despues del scraping, respetando su propio intervalo
    if (aiDetectionEnabled) {
      const shouldRunDetection = !lastDetectionTime ||
        (Date.now() - lastDetectionTime.getTime()) >= AI_DETECTION_INTERVAL_MS;

      if (shouldRunDetection) {
        try {
          const stops = await stopDetector.detectStops();
          lastDetectionTime = new Date();

          if (stops.length > 0) {
            console.log(`[AI] ${stops.length} paros detectados, iniciando protocolo de llamadas...`);
            const callResult = await vapiTrigger.processStopAlerts(stops);
            lastDetectionResult = {
              time: lastDetectionTime.toISOString(),
              stops: stops.length,
              calls: callResult.calls,
              answered: callResult.callsAnswered,
            };
            console.log(`[AI] Resultado: ${callResult.calls} llamadas (${callResult.callsAnswered} atendidas)`);
          } else {
            lastDetectionResult = {
              time: lastDetectionTime.toISOString(),
              stops: 0,
              calls: 0,
              answered: 0,
            };
          }
        } catch (aiErr) {
          console.error('[AI] Error en deteccion de paros:', aiErr.message);
          lastDetectionResult = { time: new Date().toISOString(), error: aiErr.message };
        }
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error en ciclo:', err.message);
  } finally {
    schedulerRunning = false;
  }
});

console.log(`[Scheduler] Cron programado: ${CRON_EXPRESSION} (habilitado: ${schedulerEnabled})`);
console.log(`[AI] Deteccion de paros: ${aiDetectionEnabled ? 'habilitada' : 'deshabilitada'} (intervalo: ${AI_DETECTION_INTERVAL_MS / 60000} min)`);

// ---------------------------------------------------------------------------
// Limpieza al cerrar (cerrar pool de browsers y detener cron)
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal) {
  console.log(`[Cleanup] ${signal} recibido, cerrando...`);
  schedulerTask.stop();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
