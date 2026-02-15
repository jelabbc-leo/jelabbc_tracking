#!/usr/bin/env node
/**
 * Setup Demo - Ejecuta migraciones SQL y crea datos de prueba
 *
 * Uso: node scripts/setup-demo.js
 *
 * Paso 1: Intenta crear las tablas necesarias via la API CRUD
 * Paso 2: Inserta un viaje de prueba con contactos y coordenadas
 * Paso 3: Habilita IA en el viaje para probar llamadas
 */

require('dotenv').config();
const { internalClient: api } = require('../src/api/client');

const LOG = (msg) => console.log(`[Setup] ${msg}`);
const ERR = (msg) => console.error(`[Setup ERROR] ${msg}`);

// ============================================================================
// SQL de migracion - Crear tablas nuevas
// ============================================================================

const CREATE_TABLES_SQL = [
  // conf_providers
  `CREATE TABLE IF NOT EXISTS conf_providers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    username VARCHAR(200), password VARCHAR(200),
    selector_user VARCHAR(200), selector_pass VARCHAR(200), selector_login_btn VARCHAR(200),
    login_in_iframe BOOLEAN DEFAULT FALSE,
    iframe_selector VARCHAR(200),
    intervalo_minutos INT DEFAULT 5,
    activo BOOLEAN DEFAULT TRUE,
    ultimo_scrape DATETIME, ultimo_error TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // op_coordinates
  `CREATE TABLE IF NOT EXISTS op_coordinates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_unidad_viaje BIGINT UNSIGNED NOT NULL,
    provider_id INT UNSIGNED DEFAULT NULL,
    latitud DECIMAL(10,8) NOT NULL, longitud DECIMAL(11,8) NOT NULL,
    velocidad DECIMAL(8,2), rumbo DECIMAL(5,1),
    fecha_gps DATETIME, fecha_extraccion DATETIME DEFAULT CURRENT_TIMESTAMP,
    fuente VARCHAR(50),
    INDEX idx_viaje_fecha (id_unidad_viaje, fecha_extraccion)
  )`,

  // log_scrape
  `CREATE TABLE IF NOT EXISTS log_scrape (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_id INT UNSIGNED NOT NULL,
    id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
    inicio DATETIME NOT NULL, fin DATETIME,
    estado ENUM('running','success','error') DEFAULT 'running',
    dispositivos_encontrados INT DEFAULT 0, coordenadas_nuevas INT DEFAULT 0,
    fuentes_usadas VARCHAR(200), error_mensaje TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  // conf_ai_protocols
  `CREATE TABLE IF NOT EXISTS conf_ai_protocols (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
    umbral_paro_minutos INT DEFAULT 30,
    llamadas_activas BOOLEAN DEFAULT FALSE,
    protocolo_texto TEXT, idioma VARCHAR(5) DEFAULT 'es',
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  // log_ai_calls
  `CREATE TABLE IF NOT EXISTS log_ai_calls (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_unidad_viaje BIGINT UNSIGNED NOT NULL,
    tipo ENUM('paro','accidente','verificacion') NOT NULL,
    telefono_llamado VARCHAR(50),
    destinatario_rol ENUM('operador','coordinador1','coordinador2','cliente'),
    inicio_llamada DATETIME, fin_llamada DATETIME,
    duracion_segundos INT, resultado ENUM('atendida','no_atendida','buzon','error'),
    resumen_conversacion TEXT, motivo TEXT,
    lat_al_llamar DECIMAL(10,8), lng_al_llamar DECIMAL(11,8),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
];

// ALTERs para tablas existentes (pueden fallar si ya se aplicaron)
const ALTER_SQL = [
  // unidades_viajes - agregar campos nuevos
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS provider_id INT UNSIGNED DEFAULT NULL`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS aduana VARCHAR(200) DEFAULT NULL`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS modulacion_activa BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS modulacion_resultado ENUM('pendiente','verde','rojo') DEFAULT 'pendiente'`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS frecuencia_monitoreo_min INT DEFAULT 10`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS fecha_inicio_tracking DATETIME DEFAULT NULL`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS fecha_fin_tracking DATETIME DEFAULT NULL`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS ia_llamadas_activas BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS umbral_paro_minutos INT DEFAULT 30`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS link_recoleccion VARCHAR(500) DEFAULT NULL`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS link_dropoff_vacio VARCHAR(500) DEFAULT NULL`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS link_carga_vacio VARCHAR(500) DEFAULT NULL`,
  `ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS link_entrega_cargado VARCHAR(500) DEFAULT NULL`,
];

// ============================================================================
// Main
// ============================================================================

async function main() {
  LOG('=== JELABBC Tracking - Setup Demo ===\n');

  // 1. Login
  LOG('Autenticando con la API...');
  await api.ensureToken();
  LOG('Autenticado OK\n');

  // 2. Crear tablas
  LOG('--- Paso 1: Crear tablas nuevas ---');
  for (const sql of CREATE_TABLES_SQL) {
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] || '?';
    try {
      await api.query(sql);
      LOG(`  ✓ Tabla ${tableName} creada/verificada`);
    } catch (err) {
      // Puede fallar si la API no permite DDL - lo registramos
      ERR(`  ✗ ${tableName}: ${err.message.substring(0, 100)}`);
    }
  }

  // 3. Alterar tablas existentes
  LOG('\n--- Paso 2: Alterar tablas existentes ---');
  for (const sql of ALTER_SQL) {
    const colName = sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)?.[1] || '?';
    try {
      await api.query(sql);
      LOG(`  ✓ Columna ${colName} agregada/verificada`);
    } catch (err) {
      // Puede fallar si ya existe o API no permite ALTER
      const msg = err.message || '';
      if (msg.includes('Duplicate column') || msg.includes('already exists')) {
        LOG(`  ~ Columna ${colName} ya existe (OK)`);
      } else {
        ERR(`  ✗ ${colName}: ${msg.substring(0, 100)}`);
      }
    }
  }

  // 4. Verificar si las tablas existen
  LOG('\n--- Paso 3: Verificar tablas ---');
  const tablesToCheck = ['conf_providers', 'op_coordinates', 'log_scrape', 'conf_ai_protocols', 'log_ai_calls', 'unidades_viajes', 'eventos_unidad', 'contactos_viaje'];
  const existingTables = [];

  for (const table of tablesToCheck) {
    try {
      await api.query(`SELECT 1 FROM ${table} LIMIT 1`);
      LOG(`  ✓ ${table} existe`);
      existingTables.push(table);
    } catch {
      ERR(`  ✗ ${table} NO existe`);
    }
  }

  // Si las tablas criticas no existen, mostrar el SQL para ejecucion manual
  if (!existingTables.includes('conf_providers') || !existingTables.includes('log_ai_calls')) {
    LOG('\n⚠ Algunas tablas no se pudieron crear via la API.');
    LOG('La API CRUD probablemente no permite DDL (CREATE TABLE/ALTER TABLE).');
    LOG('Ejecuta el SQL manualmente contra MySQL. El archivo esta en:');
    LOG('  scripts/migration.sql\n');
    await writeMigrationSQL();
    return;
  }

  // 5. Insertar datos de prueba
  LOG('\n--- Paso 4: Crear viaje de prueba ---');
  await createDemoData();

  LOG('\n=== Setup completado ===');
  LOG('Ahora puedes:');
  LOG('  1. Ir a http://localhost:8080/viajes para ver el viaje');
  LOG('  2. Ir a http://localhost:8080/ai para configurar IA');
  LOG('  3. Activar IA en el viaje y probar la deteccion de paros');
}

// ============================================================================
// Crear datos de prueba
// ============================================================================

async function createDemoData() {
  try {
    // Verificar si ya hay datos de prueba
    const existing = await api.query(
      "SELECT id FROM unidades_viajes WHERE origen LIKE '%DEMO%' LIMIT 1"
    );
    if (existing && existing.length > 0) {
      LOG('  Ya existen datos de prueba (viaje #' + existing[0].id + ')');
      LOG('  Saltando creacion de datos...');
      return existing[0].id;
    }

    // Crear viaje de prueba
    LOG('  Creando viaje de prueba...');
    const viajeResult = await api.insert('unidades_viajes', {
      id_unidad: 'DEMO-001',
      numero_economico: 'DEMO-001',
      origen: 'DEMO - Nuevo Laredo, Tamaulipas',
      destino: 'DEMO - Monterrey, Nuevo Leon',
      estado_actual: 'en_ruta',
      ultima_lat: 25.6866,
      ultima_lng: -100.3161,
      ultima_actualizacion: new Date().toISOString().slice(0, 19).replace('T', ' '),
      frecuencia_monitoreo_min: 5,
      umbral_paro_minutos: 5, // 5 min para prueba rapida
      ia_llamadas_activas: 1,
      fecha_salida: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    // Obtener el ID del viaje creado
    const viajes = await api.query(
      "SELECT id FROM unidades_viajes WHERE id_unidad = 'DEMO-001' ORDER BY id DESC LIMIT 1"
    );
    const viajeId = viajes && viajes.length > 0 ? viajes[0].id : null;

    if (!viajeId) {
      ERR('  No se pudo obtener el ID del viaje creado');
      return null;
    }

    LOG(`  ✓ Viaje #${viajeId} creado (DEMO-001: Nuevo Laredo → Monterrey)`);
    LOG(`    IA activa: SI | Umbral paro: 5 min (para prueba rapida)`);

    // Crear contactos
    LOG('  Creando contactos...');
    LOG('');
    LOG('  ⚠ IMPORTANTE: Ingresa numeros de telefono reales para la prueba.');
    LOG('  Los contactos se crean con numeros placeholder.');
    LOG('  Actualiza los numeros en la UI web (/viajes/' + viajeId + ') o aqui abajo.');
    LOG('');

    const contacts = [
      { tipo_contacto: 'operador', nombre: 'Operador Demo', telefono: '+525500000001' },
      { tipo_contacto: 'coordinador1', nombre: 'Coordinador 1 Demo', telefono: '+525500000002' },
      { tipo_contacto: 'coordinador2', nombre: 'Coordinador 2 Demo', telefono: '+525500000003' },
      { tipo_contacto: 'cliente', nombre: 'Cliente Demo', telefono: '+525500000004' },
    ];

    for (const contact of contacts) {
      try {
        await api.insert('contactos_viaje', {
          id_unidad_viaje: viajeId,
          ...contact,
        });
        LOG(`  ✓ Contacto: ${contact.nombre} (${contact.tipo_contacto}) - ${contact.telefono}`);
      } catch (err) {
        ERR(`  ✗ Contacto ${contact.tipo_contacto}: ${err.message.substring(0, 80)}`);
      }
    }

    // Crear coordenadas de prueba (simulando vehiculo detenido)
    LOG('  Creando coordenadas de prueba (vehiculo detenido)...');
    const now = Date.now();
    const coords = [];
    // 10 coordenadas en el mismo punto durante 30 minutos (para simular paro)
    for (let i = 0; i < 10; i++) {
      const time = new Date(now - (i * 3 * 60 * 1000)); // cada 3 min
      coords.push({
        id_unidad_viaje: viajeId,
        latitud: 25.6866 + (Math.random() * 0.0001 - 0.00005), // Variacion minima
        longitud: -100.3161 + (Math.random() * 0.0001 - 0.00005),
        velocidad: 0,
        rumbo: 0,
        fecha_gps: time.toISOString().slice(0, 19).replace('T', ' '),
        fecha_extraccion: time.toISOString().slice(0, 19).replace('T', ' '),
        fuente: 'demo',
      });
    }

    const coordResults = await api.insertMany('op_coordinates', coords);
    const coordsOk = coordResults.filter(r => r.success).length;
    LOG(`  ✓ ${coordsOk} coordenadas creadas (vehiculo detenido en Monterrey)`);

    // Crear protocolo IA default
    LOG('  Creando protocolo IA default...');
    try {
      await api.insert('conf_ai_protocols', {
        id_unidad_viaje: null, // Default para todos
        umbral_paro_minutos: 5,
        llamadas_activas: 1,
        protocolo_texto: 'Eres el asistente de monitoreo de JELABBC. Llama al contacto para verificar por que el vehiculo esta detenido. Se breve y profesional. Habla en espanol de Mexico.',
        idioma: 'es',
      });
      LOG('  ✓ Protocolo IA default creado');
    } catch (err) {
      ERR(`  ✗ Protocolo: ${err.message.substring(0, 80)}`);
    }

    // Crear evento
    try {
      await api.insert('eventos_unidad', {
        id_unidad_viaje: viajeId,
        tipo_evento: 'creacion',
        descripcion: 'Viaje de prueba creado para demo de IA',
        fecha_evento: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
    } catch {}

    return viajeId;
  } catch (err) {
    ERR('Error creando datos de prueba: ' + err.message);
    return null;
  }
}

// ============================================================================
// Escribir SQL de migracion para ejecucion manual
// ============================================================================

async function writeMigrationSQL() {
  const fs = require('fs');
  const path = require('path');

  const sql = `-- ============================================================================
-- JELABBC Tracking - Migracion de base de datos
-- Ejecutar una sola vez contra MySQL: jela.mysql.database.azure.com / jela_logistica
-- ============================================================================

-- Tablas nuevas
${CREATE_TABLES_SQL.map(s => s + ';').join('\n\n')}

-- Columnas nuevas en unidades_viajes
${ALTER_SQL.map(s => s + ';').join('\n')}

-- Ampliar enum en eventos_unidad (si la tabla existe)
ALTER TABLE eventos_unidad
  MODIFY COLUMN tipo_evento ENUM(
    'creacion','inicio_ruta','ubicacion_actualizada',
    'detencion_detectada','reinicio_movimiento',
    'llamada_operador','llamada_cliente','llamada_propietario',
    'llamada_ia_operador','llamada_ia_coordinador',
    'scrape_exitoso','scrape_error',
    'notif_push_proximidad','modulacion_consultada',
    'alerta_paro_ia','llegada_destino','llegada_punto_logistico'
  ) NOT NULL;

-- Ampliar enum en contactos_viaje (si la tabla existe)
ALTER TABLE contactos_viaje
  MODIFY COLUMN tipo_contacto ENUM('operador','cliente','propietario','coordinador1','coordinador2','coordinador3','otro') NOT NULL;
`;

  const filePath = path.join(__dirname, 'migration.sql');
  fs.writeFileSync(filePath, sql, 'utf8');
  LOG(`Archivo SQL generado: ${filePath}`);
}

// ============================================================================
// Ejecutar
// ============================================================================

main().catch(err => {
  ERR('Error fatal: ' + err.message);
  process.exit(1);
});
