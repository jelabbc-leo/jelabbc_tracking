-- ============================================================================
-- JELABBC Tracking - Migracion de base de datos
-- Ejecutar una sola vez contra MySQL: jela.mysql.database.azure.com / jela_logistica
-- ============================================================================

-- Tablas nuevas
CREATE TABLE IF NOT EXISTS conf_providers (
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
  );

CREATE TABLE IF NOT EXISTS op_coordinates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_unidad_viaje BIGINT UNSIGNED NOT NULL,
    provider_id INT UNSIGNED DEFAULT NULL,
    latitud DECIMAL(10,8) NOT NULL, longitud DECIMAL(11,8) NOT NULL,
    velocidad DECIMAL(8,2), rumbo DECIMAL(5,1),
    fecha_gps DATETIME, fecha_extraccion DATETIME DEFAULT CURRENT_TIMESTAMP,
    fuente VARCHAR(50),
    INDEX idx_viaje_fecha (id_unidad_viaje, fecha_extraccion)
  );

CREATE TABLE IF NOT EXISTS log_scrape (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_id INT UNSIGNED NOT NULL,
    id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
    inicio DATETIME NOT NULL, fin DATETIME,
    estado ENUM('running','success','error') DEFAULT 'running',
    dispositivos_encontrados INT DEFAULT 0, coordenadas_nuevas INT DEFAULT 0,
    fuentes_usadas VARCHAR(200), error_mensaje TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE IF NOT EXISTS conf_ai_protocols (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
    umbral_paro_minutos INT DEFAULT 30,
    llamadas_activas BOOLEAN DEFAULT FALSE,
    protocolo_texto TEXT, idioma VARCHAR(5) DEFAULT 'es',
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE IF NOT EXISTS log_ai_calls (
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
  );

-- Columnas nuevas en unidades_viajes
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS provider_id INT UNSIGNED DEFAULT NULL;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS aduana VARCHAR(200) DEFAULT NULL;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS modulacion_activa BOOLEAN DEFAULT FALSE;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS modulacion_resultado ENUM('pendiente','verde','rojo') DEFAULT 'pendiente';
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS frecuencia_monitoreo_min INT DEFAULT 10;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS fecha_inicio_tracking DATETIME DEFAULT NULL;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS fecha_fin_tracking DATETIME DEFAULT NULL;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS ia_llamadas_activas BOOLEAN DEFAULT FALSE;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS umbral_paro_minutos INT DEFAULT 30;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS link_recoleccion VARCHAR(500) DEFAULT NULL;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS link_dropoff_vacio VARCHAR(500) DEFAULT NULL;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS link_carga_vacio VARCHAR(500) DEFAULT NULL;
ALTER TABLE unidades_viajes ADD COLUMN IF NOT EXISTS link_entrega_cargado VARCHAR(500) DEFAULT NULL;

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
