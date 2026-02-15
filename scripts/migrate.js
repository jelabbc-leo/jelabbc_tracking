#!/usr/bin/env node
/**
 * Migracion directa a MySQL — Crea tablas y columnas necesarias
 *
 * Uso: MYSQL_PASSWORD=tu_password node scripts/migrate.js
 *   o: node scripts/migrate.js tu_password
 */

const mysql = require('mysql2/promise');

const MYSQL_HOST = 'jela.mysql.database.azure.com';
const MYSQL_USER = 'jlsg';
const MYSQL_DB = 'jela_logistica';
const MYSQL_PORT = 3306;

// Password desde argumento, env, o prompt
const MYSQL_PASSWORD = process.argv[2] || process.env.MYSQL_PASSWORD || '';

if (!MYSQL_PASSWORD) {
  console.error('ERROR: Falta la contrasena de MySQL.');
  console.error('Uso: node scripts/migrate.js TU_PASSWORD_MYSQL');
  console.error('  o: MYSQL_PASSWORD=xxx node scripts/migrate.js');
  process.exit(1);
}

const LOG = (msg) => console.log(`[Migrate] ${msg}`);
const OK = (msg) => console.log(`[Migrate] ✓ ${msg}`);
const ERR = (msg) => console.error(`[Migrate] ✗ ${msg}`);

// ============================================================================
// SQL Statements
// ============================================================================

const SQL_STATEMENTS = [
  // --- Crear tablas nuevas ---
  {
    name: 'Crear conf_providers',
    sql: `CREATE TABLE IF NOT EXISTS conf_providers (
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
  },
  {
    name: 'Crear op_coordinates',
    sql: `CREATE TABLE IF NOT EXISTS op_coordinates (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      id_unidad_viaje BIGINT UNSIGNED NOT NULL,
      provider_id INT UNSIGNED DEFAULT NULL,
      latitud DECIMAL(10,8) NOT NULL,
      longitud DECIMAL(11,8) NOT NULL,
      velocidad DECIMAL(8,2),
      rumbo DECIMAL(5,1),
      fecha_gps DATETIME,
      fecha_extraccion DATETIME DEFAULT CURRENT_TIMESTAMP,
      fuente VARCHAR(50),
      INDEX idx_viaje_fecha (id_unidad_viaje, fecha_extraccion)
    )`,
  },
  {
    name: 'Crear log_scrape',
    sql: `CREATE TABLE IF NOT EXISTS log_scrape (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      provider_id INT UNSIGNED NOT NULL,
      id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
      inicio DATETIME NOT NULL,
      fin DATETIME,
      estado ENUM('running','success','error') DEFAULT 'running',
      dispositivos_encontrados INT DEFAULT 0,
      coordenadas_nuevas INT DEFAULT 0,
      fuentes_usadas VARCHAR(200),
      error_mensaje TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'Crear conf_ai_protocols',
    sql: `CREATE TABLE IF NOT EXISTS conf_ai_protocols (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
      umbral_paro_minutos INT DEFAULT 30,
      llamadas_activas BOOLEAN DEFAULT FALSE,
      protocolo_texto TEXT,
      idioma VARCHAR(5) DEFAULT 'es',
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'Crear log_ai_calls',
    sql: `CREATE TABLE IF NOT EXISTS log_ai_calls (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      id_unidad_viaje BIGINT UNSIGNED NOT NULL,
      tipo ENUM('paro','accidente','verificacion') NOT NULL,
      telefono_llamado VARCHAR(50),
      destinatario_rol ENUM('operador','coordinador1','coordinador2','coordinador3','cliente'),
      inicio_llamada DATETIME,
      fin_llamada DATETIME,
      duracion_segundos INT,
      resultado ENUM('atendida','no_atendida','buzon','error'),
      resumen_conversacion TEXT,
      motivo TEXT,
      lat_al_llamar DECIMAL(10,8),
      lng_al_llamar DECIMAL(11,8),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },

  // --- Agregar columnas a unidades_viajes ---
  { name: 'Col provider_id', sql: `ALTER TABLE unidades_viajes ADD COLUMN provider_id INT UNSIGNED DEFAULT NULL`, ignoreDup: true },
  { name: 'Col aduana', sql: `ALTER TABLE unidades_viajes ADD COLUMN aduana VARCHAR(200) DEFAULT NULL`, ignoreDup: true },
  { name: 'Col modulacion_activa', sql: `ALTER TABLE unidades_viajes ADD COLUMN modulacion_activa BOOLEAN DEFAULT FALSE`, ignoreDup: true },
  { name: 'Col modulacion_resultado', sql: `ALTER TABLE unidades_viajes ADD COLUMN modulacion_resultado ENUM('pendiente','verde','rojo') DEFAULT 'pendiente'`, ignoreDup: true },
  { name: 'Col frecuencia_monitoreo_min', sql: `ALTER TABLE unidades_viajes ADD COLUMN frecuencia_monitoreo_min INT DEFAULT 10`, ignoreDup: true },
  { name: 'Col fecha_inicio_tracking', sql: `ALTER TABLE unidades_viajes ADD COLUMN fecha_inicio_tracking DATETIME DEFAULT NULL`, ignoreDup: true },
  { name: 'Col fecha_fin_tracking', sql: `ALTER TABLE unidades_viajes ADD COLUMN fecha_fin_tracking DATETIME DEFAULT NULL`, ignoreDup: true },
  { name: 'Col ia_llamadas_activas', sql: `ALTER TABLE unidades_viajes ADD COLUMN ia_llamadas_activas BOOLEAN DEFAULT FALSE`, ignoreDup: true },
  { name: 'Col umbral_paro_minutos', sql: `ALTER TABLE unidades_viajes ADD COLUMN umbral_paro_minutos INT DEFAULT 30`, ignoreDup: true },
  { name: 'Col link_recoleccion', sql: `ALTER TABLE unidades_viajes ADD COLUMN link_recoleccion VARCHAR(500) DEFAULT NULL`, ignoreDup: true },
  { name: 'Col link_dropoff_vacio', sql: `ALTER TABLE unidades_viajes ADD COLUMN link_dropoff_vacio VARCHAR(500) DEFAULT NULL`, ignoreDup: true },
  { name: 'Col link_carga_vacio', sql: `ALTER TABLE unidades_viajes ADD COLUMN link_carga_vacio VARCHAR(500) DEFAULT NULL`, ignoreDup: true },
  { name: 'Col link_entrega_cargado', sql: `ALTER TABLE unidades_viajes ADD COLUMN link_entrega_cargado VARCHAR(500) DEFAULT NULL`, ignoreDup: true },

  // --- Permitir coordenadas sin viaje asociado ---
  { name: 'op_coordinates.id_unidad_viaje nullable', sql: `ALTER TABLE op_coordinates MODIFY COLUMN id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL`, ignoreDup: true },

  // --- Columnas adicionales requeridas por la app (viajes, dashboard, IA) ---
  { name: 'Col numero_economico', sql: `ALTER TABLE unidades_viajes ADD COLUMN numero_economico VARCHAR(50) DEFAULT NULL`, ignoreDup: true },
  { name: 'Col origen', sql: `ALTER TABLE unidades_viajes ADD COLUMN origen VARCHAR(200) DEFAULT NULL`, ignoreDup: true },
  { name: 'Col destino', sql: `ALTER TABLE unidades_viajes ADD COLUMN destino VARCHAR(200) DEFAULT NULL`, ignoreDup: true },
  { name: 'Col id_unidad', sql: `ALTER TABLE unidades_viajes ADD COLUMN id_unidad VARCHAR(50) DEFAULT NULL`, ignoreDup: true },
  { name: 'Col fecha_salida', sql: `ALTER TABLE unidades_viajes ADD COLUMN fecha_salida DATETIME DEFAULT NULL`, ignoreDup: true },
  { name: 'Col fecha_llegada', sql: `ALTER TABLE unidades_viajes ADD COLUMN fecha_llegada DATETIME DEFAULT NULL`, ignoreDup: true },
  { name: 'Col fecha_llegada_estimada', sql: `ALTER TABLE unidades_viajes ADD COLUMN fecha_llegada_estimada DATETIME DEFAULT NULL`, ignoreDup: true },

  // --- Ampliar enums ---
  {
    name: 'Ampliar enum eventos_unidad.tipo_evento',
    sql: `ALTER TABLE eventos_unidad MODIFY COLUMN tipo_evento ENUM(
      'creacion','inicio_ruta','ubicacion_actualizada',
      'detencion_detectada','reinicio_movimiento',
      'llamada_operador','llamada_cliente','llamada_propietario',
      'llamada_ia_operador','llamada_ia_coordinador',
      'scrape_exitoso','scrape_error',
      'notif_push_proximidad','modulacion_consultada',
      'alerta_paro_ia','llegada_destino','llegada_punto_logistico'
    ) NOT NULL`,
    ignoreDup: true,
  },
  {
    name: 'Ampliar enum contactos_viaje.tipo_contacto',
    sql: `ALTER TABLE contactos_viaje MODIFY COLUMN tipo_contacto ENUM('operador','cliente','propietario','coordinador1','coordinador2','coordinador3','otro') NOT NULL`,
    ignoreDup: true,
  },
];

// ============================================================================
// Main
// ============================================================================

async function main() {
  LOG('=== JELABBC Tracking — Migracion MySQL ===\n');
  LOG(`Host: ${MYSQL_HOST}`);
  LOG(`User: ${MYSQL_USER}`);
  LOG(`DB:   ${MYSQL_DB}\n`);

  let connection;
  try {
    LOG('Conectando a MySQL...');
    connection = await mysql.createConnection({
      host: MYSQL_HOST,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DB,
      port: MYSQL_PORT,
      ssl: { rejectUnauthorized: true },
      connectTimeout: 15000,
    });
    OK('Conexion exitosa\n');
  } catch (err) {
    ERR('No se pudo conectar a MySQL: ' + err.message);
    if (err.message.includes('Access denied')) {
      console.error('\n  La contrasena es incorrecta. Verifica e intenta de nuevo.');
    }
    process.exit(1);
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const stmt of SQL_STATEMENTS) {
    try {
      await connection.execute(stmt.sql);
      OK(stmt.name);
      ok++;
    } catch (err) {
      const msg = err.message || '';
      if (stmt.ignoreDup && (msg.includes('Duplicate column') || msg.includes('already exists'))) {
        LOG(`  ~ ${stmt.name} (ya existe, OK)`);
        skip++;
      } else {
        ERR(`${stmt.name}: ${msg.substring(0, 120)}`);
        fail++;
      }
    }
  }

  LOG(`\n--- Resultado: ${ok} exitosos, ${skip} ya existian, ${fail} errores ---\n`);

  // Verificar que las tablas existen
  LOG('Verificando tablas...');
  const tables = ['conf_providers', 'op_coordinates', 'log_scrape', 'conf_ai_protocols', 'log_ai_calls', 'unidades_viajes', 'eventos_unidad', 'contactos_viaje'];
  for (const table of tables) {
    try {
      const [rows] = await connection.execute(`SELECT COUNT(*) AS c FROM ${table}`);
      OK(`${table} — ${rows[0].c} registros`);
    } catch {
      ERR(`${table} NO existe`);
    }
  }

  await connection.end();
  LOG('\n=== Migracion completada ===');
  LOG('Ahora ve a http://localhost:8080/providers para configurar la cuenta espejo.');
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
