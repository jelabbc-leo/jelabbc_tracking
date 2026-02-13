/**
 * Rutas de autenticacion - Proxy login/logout contra API .NET
 */

const express = require('express');
const router = express.Router();
const { ApiClient } = require('../api/client');

// GET /login - Mostrar formulario
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('login', {
    title: 'Iniciar Sesion',
    error: null
  });
});

// POST /login - Procesar login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('login', {
      title: 'Iniciar Sesion',
      error: 'Usuario y contraseña son requeridos'
    });
  }

  try {
    const client = new ApiClient();
    const result = await client.login(username, password);

    if (result.success) {
      req.session.user = { username };
      req.session.token = result.token;

      return res.redirect('/dashboard');
    }

    return res.render('login', {
      title: 'Iniciar Sesion',
      error: 'Credenciales invalidas'
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return res.render('login', {
      title: 'Iniciar Sesion',
      error: 'Error de conexion con el servidor'
    });
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('[Auth] Error destruyendo sesion:', err);
    res.redirect('/login');
  });
});

module.exports = router;
