-- ============================================================
-- JELABBC Tracking - Script 03: CREATE tablas nuevas
-- Crea las tablas nuevas necesarias para el sistema de tracking,
-- scraping GPS, y llamadas IA.
-- Prefijos usados (permitidos por la API .NET):
--   conf_  = configuracion
--   op_    = operacional
--   log_   = logs/auditoria
-- Ejecutar UNA SOLA VEZ contra la base de datos jela_logistica.
-- ============================================================

-- -----------------------------------------------------------
-- 1. conf_providers - Proveedores GPS (plataformas de rastreo)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS conf_providers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  url VARCHAR(500) NOT NULL,
  username VARCHAR(200) DEFAULT NULL,
  password VARCHAR(200) DEFAULT NULL,
  selector_user VARCHAR(200) DEFAULT NULL,
  selector_pass VARCHAR(200) DEFAULT NULL,
  selector_login_btn VARCHAR(200) DEFAULT NULL,
  login_in_iframe BOOLEAN DEFAULT FALSE,
  iframe_selector VARCHAR(200) DEFAULT NULL,
  intervalo_minutos INT DEFAULT 5,
  activo BOOLEAN DEFAULT TRUE,
  ultimo_scrape DATETIME DEFAULT NULL,
  ultimo_error TEXT DEFAULT NULL,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 2. op_coordinates - Coordenadas GPS extraidas
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS op_coordinates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_unidad_viaje BIGINT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED DEFAULT NULL,
  latitud DECIMAL(10,8) NOT NULL,
  longitud DECIMAL(11,8) NOT NULL,
  velocidad DECIMAL(8,2) DEFAULT NULL,
  rumbo DECIMAL(5,1) DEFAULT NULL,
  fecha_gps DATETIME DEFAULT NULL,
  fecha_extraccion DATETIME DEFAULT CURRENT_TIMESTAMP,
  fuente VARCHAR(50) DEFAULT NULL,
  INDEX idx_viaje_fecha (id_unidad_viaje, fecha_extraccion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 3. log_scrape - Registro de ejecuciones del scraper
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_scrape (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_id INT UNSIGNED NOT NULL,
  id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
  inicio DATETIME NOT NULL,
  fin DATETIME DEFAULT NULL,
  estado ENUM('running','success','error') DEFAULT 'running',
  dispositivos_encontrados INT DEFAULT 0,
  coordenadas_nuevas INT DEFAULT 0,
  fuentes_usadas VARCHAR(200) DEFAULT NULL,
  error_mensaje TEXT DEFAULT NULL,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 4. conf_ai_protocols - Configuracion de protocolos IA por viaje
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS conf_ai_protocols (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
  umbral_paro_minutos INT DEFAULT 30,
  llamadas_activas BOOLEAN DEFAULT FALSE,
  protocolo_texto TEXT DEFAULT NULL,
  idioma VARCHAR(5) DEFAULT 'es',
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 5. log_ai_calls - Historial de llamadas IA (VAPI)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_ai_calls (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_unidad_viaje BIGINT UNSIGNED NOT NULL,
  tipo ENUM('paro','accidente','verificacion') NOT NULL,
  telefono_llamado VARCHAR(50) DEFAULT NULL,
  destinatario_rol ENUM('operador','coordinador1','coordinador2','cliente') DEFAULT NULL,
  inicio_llamada DATETIME DEFAULT NULL,
  fin_llamada DATETIME DEFAULT NULL,
  duracion_segundos INT DEFAULT NULL,
  resultado ENUM('atendida','no_atendida','buzon','error') DEFAULT NULL,
  resumen_conversacion TEXT DEFAULT NULL,
  motivo TEXT DEFAULT NULL,
  lat_al_llamar DECIMAL(10,8) DEFAULT NULL,
  lng_al_llamar DECIMAL(11,8) DEFAULT NULL,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
