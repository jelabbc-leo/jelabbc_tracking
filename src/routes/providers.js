/**
 * Rutas de Proveedores de Transporte - Panel de Operacion
 *
 * Usa las columnas REALES de la BD:
 *   unidades_viajes: link_cuenta_espejo, nombre_operador, telefono_operador,
 *                    telefono_cliente, telefono_monitor, placas_unidad, etc.
 *   contactos_viaje: nombre_contacto, telefono_contacto, tipo_contacto
 *   eventos_unidad:  ocurrido_en (no fecha_evento), datos_extra
 */

'use strict';

const express = require('express');
const router = express.Router();
const { createClient } = require('../api/client');

// ============================================================================
// GET /providers - Vista panel de operacion
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    // Cargar viaje activo (en_ruta con link_cuenta_espejo)
    let viaje = null;
    let contactos = [];
    try {
      const viajes = await api.query(
        "SELECT * FROM unidades_viajes WHERE estado_actual = 'en_ruta' ORDER BY id DESC LIMIT 1"
      );
      if (viajes && viajes.length > 0) {
        viaje = viajes[0];
        const cts = await api.query(
          `SELECT * FROM contactos_viaje WHERE id_unidad_viaje = ${viaje.id} ORDER BY tipo_contacto`
        );
        contactos = cts || [];
      }
    } catch {}

    // Verificar provider activo
    let provider = null;
    try {
      const provs = await api.query(
        "SELECT * FROM conf_providers WHERE activo = 1 ORDER BY id DESC LIMIT 1"
      );
      provider = provs && provs.length > 0 ? provs[0] : null;
    } catch {}

    res.render('providers/index', {
      title: 'Proveedores de Transporte',
      viaje,
      contactos,
      provider,
    });
  } catch (err) {
    console.error('[Providers] Error:', err.message);
    res.render('providers/index', {
      title: 'Proveedores de Transporte',
      viaje: null,
      contactos: [],
      provider: null,
    });
  }
});

// ============================================================================
// POST /providers/api/config - Guardar configuracion completa
// ============================================================================

router.post('/api/config', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    const {
      linkCuentaEspejo,
      operadorNombre, operadorTelefono,
      coordinador1Nombre, coordinador1Telefono,
      coordinador2Nombre, coordinador2Telefono,
    } = req.body;

    if (!linkCuentaEspejo) {
      return res.status(400).json({ success: false, error: 'El link de cuenta espejo es requerido' });
    }

    // 1. Crear o actualizar proveedor en conf_providers
    let providerId = null;
    try {
      const existing = await api.query(
        "SELECT id FROM conf_providers WHERE activo = 1 ORDER BY id DESC LIMIT 1"
      );
      if (existing && existing.length > 0) {
        providerId = existing[0].id;
        await api.update('conf_providers', providerId, {
          nombre: 'Cuenta Espejo',
          url: linkCuentaEspejo,
          activo: 1,
          intervalo_minutos: 5,
        });
      } else {
        await api.insert('conf_providers', {
          nombre: 'Cuenta Espejo',
          url: linkCuentaEspejo,
          activo: 1,
          intervalo_minutos: 5,
        });
        const rows = await api.query(
          "SELECT id FROM conf_providers WHERE activo = 1 ORDER BY id DESC LIMIT 1"
        );
        providerId = rows && rows.length > 0 ? rows[0].id : null;
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Error guardando proveedor: ' + err.message });
    }

    // 2. Crear o actualizar viaje en unidades_viajes (con columnas REALES)
    let viajeId = null;
    try {
      const existingViaje = await api.query(
        "SELECT id FROM unidades_viajes WHERE estado_actual = 'en_ruta' ORDER BY id DESC LIMIT 1"
      );

      const viajeData = {
        link_cuenta_espejo: linkCuentaEspejo,
        nombre_operador: operadorNombre || '',
        telefono_operador: operadorTelefono || '',
        telefono_cliente: coordinador1Telefono || '',
        telefono_monitor: coordinador2Telefono || '',
        provider_id: providerId,
        ia_llamadas_activas: 1,
        umbral_paro_minutos: 30,
        frecuencia_monitoreo_min: 5,
        estado_actual: 'en_ruta',
      };

      if (existingViaje && existingViaje.length > 0) {
        viajeId = existingViaje[0].id;
        await api.update('unidades_viajes', viajeId, viajeData);
      } else {
        await api.insert('unidades_viajes', viajeData);
        const rows = await api.query(
          "SELECT id FROM unidades_viajes WHERE estado_actual = 'en_ruta' ORDER BY id DESC LIMIT 1"
        );
        viajeId = rows && rows.length > 0 ? rows[0].id : null;
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Error guardando viaje: ' + err.message });
    }

    if (!viajeId) {
      return res.status(500).json({ success: false, error: 'No se pudo crear/obtener el viaje' });
    }

    // 3. Guardar contactos en contactos_viaje (columnas reales: nombre_contacto, telefono_contacto)
    try {
      const existingContacts = await api.query(
        `SELECT id FROM contactos_viaje WHERE id_unidad_viaje = ${viajeId}`
      );
      if (existingContacts) {
        for (const c of existingContacts) {
          await api.remove('contactos_viaje', c.id).catch(() => {});
        }
      }
    } catch {}

    const contactsToCreate = [];
    if (operadorTelefono) {
      contactsToCreate.push({
        id_unidad_viaje: viajeId,
        tipo_contacto: 'operador',
        nombre_contacto: operadorNombre || 'Operador',
        telefono_contacto: operadorTelefono,
      });
    }
    if (coordinador1Telefono) {
      contactsToCreate.push({
        id_unidad_viaje: viajeId,
        tipo_contacto: 'coordinador1',
        nombre_contacto: coordinador1Nombre || 'Coordinador 1',
        telefono_contacto: coordinador1Telefono,
      });
    }
    if (coordinador2Telefono) {
      contactsToCreate.push({
        id_unidad_viaje: viajeId,
        tipo_contacto: 'coordinador2',
        nombre_contacto: coordinador2Nombre || 'Coordinador 2',
        telefono_contacto: coordinador2Telefono,
      });
    }

    for (const contact of contactsToCreate) {
      try { await api.insert('contactos_viaje', contact); } catch (err) {
        console.error('[Providers] Error contacto:', err.message);
      }
    }

    res.json({
      success: true,
      message: 'Configuracion guardada correctamente',
      providerId,
      viajeId,
      contactos: contactsToCreate.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// POST /providers/api/toggle-tracking - Iniciar/detener tracking
// ============================================================================

router.post('/api/toggle-tracking', async (req, res) => {
  try {
    const api = createClient(req.session.token);
    const { action } = req.body;

    const providers = await api.query(
      "SELECT id FROM conf_providers WHERE activo = 1 ORDER BY id DESC LIMIT 1"
    );
    if (!providers || providers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No hay configuracion guardada. Primero guarda el link de cuenta espejo y los contactos.',
      });
    }
    const providerId = providers[0].id;

    const viajes = await api.query(
      "SELECT id FROM unidades_viajes ORDER BY id DESC LIMIT 1"
    );
    if (!viajes || viajes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No hay viaje. Guarda la configuracion primero.',
      });
    }
    const viajeId = viajes[0].id;

    if (action === 'start') {
      await api.update('unidades_viajes', viajeId, {
        estado_actual: 'en_ruta',
        ia_llamadas_activas: 1,
        fecha_inicio_tracking: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
      await api.update('conf_providers', providerId, { activo: 1 });

      try {
        await api.insert('eventos_unidad', {
          id_unidad_viaje: viajeId,
          tipo_evento: 'inicio_ruta',
          descripcion: 'Tracking iniciado desde panel de operacion',
          ocurrido_en: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      } catch {}

      try {
        const coordinator = require('../scraper/coordinator');
        coordinator.runForProvider(providerId).catch(() => {});
      } catch {}

      res.json({
        success: true,
        tracking: true,
        message: 'Tracking iniciado. El sistema extraera coordenadas cada 5 minutos y monitoreara paros.',
      });
    } else {
      await api.update('unidades_viajes', viajeId, {
        estado_actual: 'completado',
        ia_llamadas_activas: 0,
        fecha_fin_tracking: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });

      try {
        await api.insert('eventos_unidad', {
          id_unidad_viaje: viajeId,
          tipo_evento: 'llegada_destino',
          descripcion: 'Tracking detenido desde panel de operacion',
          ocurrido_en: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      } catch {}

      res.json({
        success: true,
        tracking: false,
        message: 'Tracking detenido.',
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// GET /providers/api/status - Estado actual
// ============================================================================

router.get('/api/status', async (req, res) => {
  try {
    const api = createClient(req.session.token);

    let provider = null;
    let viaje = null;
    let tracking = false;
    let lastCoord = null;
    let coordCount = 0;

    try {
      const rows = await api.query(
        'SELECT * FROM conf_providers WHERE activo = 1 ORDER BY id DESC LIMIT 1'
      );
      provider = rows && rows.length > 0 ? rows[0] : null;
    } catch {}

    try {
      const viajes = await api.query(
        "SELECT * FROM unidades_viajes WHERE estado_actual = 'en_ruta' ORDER BY id DESC LIMIT 1"
      );
      viaje = viajes && viajes.length > 0 ? viajes[0] : null;
      tracking = !!viaje;

      if (viaje) {
        try {
          const coords = await api.query(
            `SELECT * FROM op_coordinates WHERE id_unidad_viaje = ${viaje.id} ORDER BY fecha_extraccion DESC LIMIT 1`
          );
          lastCoord = coords && coords.length > 0 ? coords[0] : null;
          const cnt = await api.query(
            `SELECT COUNT(*) AS total FROM op_coordinates WHERE id_unidad_viaje = ${viaje.id}`
          );
          coordCount = cnt && cnt.length > 0 ? parseInt(cnt[0].total) || 0 : 0;
        } catch {}
      }
    } catch {}

    let schedulerStatus = null;
    try {
      const resp = await fetch(`http://localhost:${process.env.PORT || 8080}/api/scheduler/status`, {
        headers: { 'Cookie': req.headers.cookie || '' },
      });
      schedulerStatus = await resp.json();
    } catch {}

    res.json({ success: true, provider, viaje, tracking, lastCoord, coordCount, scheduler: schedulerStatus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
