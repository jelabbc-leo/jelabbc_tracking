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

const app = express();
const PORT = process.env.PORT || 8080;

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
// Routes
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
// Scheduler (node-cron) - Se activara en Fase 2
// ---------------------------------------------------------------------------
// const cron = require('node-cron');
// const coordinator = require('./src/scraper/coordinator');
// cron.schedule('*/5 * * * *', () => coordinator.run());

module.exports = app;
