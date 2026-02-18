-- ============================================================
-- JELABBC Tracking - Script 04: Tablas del Sistema de Monitoreo IA
-- Fase 6: Sistema de Monitoreo de Llamadas IA
--
-- Crea 6 tablas:
--   1. conf_monitoreo_prompts      - Prompts (instrucciones) para el asistente de voz
--   2. conf_monitoreo_numeros      - Numeros autorizados para llamadas entrantes
--   3. log_monitoreo_sesiones      - Sesiones de llamada (entrantes y salientes)
--   4. log_monitoreo_transcripciones - Transcripciones de cada turno de conversacion
--   5. log_monitoreo_eventos       - Eventos del sistema de monitoreo
--   6. op_monitoreo_intenciones    - Intenciones detectadas pendientes de procesar
--
-- Prefijos:
--   conf_  = configuracion (CRUD permitido por API .NET)
--   log_   = logs/auditoria (CRUD permitido)
--   op_    = operacional (CRUD permitido)
--
-- Ejecutar UNA SOLA VEZ contra jela_logistica.
-- ============================================================

USE jela_logistica;

-- -----------------------------------------------------------
-- 1. conf_monitoreo_prompts
--    Almacena los prompts (system instructions) que usa el
--    asistente de voz IA para llamadas entrantes y salientes.
--    Tipos:
--      entrante  = cuando alguien llama al sistema
--      saliente  = cuando el sistema llama (paro, escalamiento, etc.)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS conf_monitoreo_prompts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  tipo ENUM('entrante','saliente') NOT NULL,
  subtipo VARCHAR(50) NOT NULL COMMENT 'operador, coordinador, desconocido, paro, escalamiento, geocercas, velocidad, seguimiento, custom',
  prompt_sistema TEXT NOT NULL COMMENT 'System prompt completo para el asistente de voz',
  primer_mensaje TEXT DEFAULT NULL COMMENT 'Primer mensaje que dice el asistente al contestar/conectar',
  idioma VARCHAR(5) DEFAULT 'es',
  activo BOOLEAN DEFAULT TRUE,
  orden INT DEFAULT 0 COMMENT 'Prioridad si hay multiples prompts del mismo subtipo',
  notas TEXT DEFAULT NULL COMMENT 'Notas internas sobre este prompt',
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tipo_subtipo (tipo, subtipo),
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 2. conf_monitoreo_numeros
--    Numeros de telefono autorizados para interactuar con el
--    sistema via llamadas entrantes. Se sincroniza con
--    contactos_viaje para saber quien llama y a que viaje
--    pertenece.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS conf_monitoreo_numeros (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  telefono VARCHAR(20) NOT NULL,
  telefono_e164 VARCHAR(20) NOT NULL COMMENT 'Formato E.164 normalizado (+521234567890)',
  nombre VARCHAR(100) DEFAULT NULL,
  rol ENUM('operador','coordinador1','coordinador2','coordinador3','cliente','propietario','admin','otro') NOT NULL DEFAULT 'otro',
  id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL COMMENT 'Viaje asociado (NULL = acceso global)',
  activo BOOLEAN DEFAULT TRUE,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uk_telefono_e164 (telefono_e164),
  INDEX idx_viaje (id_unidad_viaje),
  INDEX idx_rol (rol),
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 3. log_monitoreo_sesiones
--    Cada llamada (entrante o saliente) genera una sesion.
--    Contiene metadata de la llamada, estado, y resumen final.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_monitoreo_sesiones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vapi_call_id VARCHAR(100) DEFAULT NULL COMMENT 'ID unico de la llamada en VAPI',
  direccion ENUM('entrante','saliente') NOT NULL,
  estado ENUM('iniciada','en_curso','completada','fallida','timeout','zombie') NOT NULL DEFAULT 'iniciada',
  telefono VARCHAR(20) DEFAULT NULL,
  telefono_e164 VARCHAR(20) DEFAULT NULL,
  nombre_contacto VARCHAR(100) DEFAULT NULL,
  rol_contacto VARCHAR(50) DEFAULT NULL,
  id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
  prompt_id INT UNSIGNED DEFAULT NULL COMMENT 'Prompt usado en esta sesion',
  motivo VARCHAR(200) DEFAULT NULL COMMENT 'Razon de la llamada (paro, escalamiento, consulta, etc.)',
  resumen TEXT DEFAULT NULL COMMENT 'Resumen generado por IA al finalizar',
  transcripcion_completa TEXT DEFAULT NULL COMMENT 'Transcripcion completa de la llamada',
  duracion_segundos INT DEFAULT NULL,
  inicio_llamada DATETIME DEFAULT NULL,
  fin_llamada DATETIME DEFAULT NULL,
  metadata JSON DEFAULT NULL COMMENT 'Datos extra de VAPI (endedReason, cost, etc.)',
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uk_vapi_call (vapi_call_id),
  INDEX idx_direccion (direccion),
  INDEX idx_estado (estado),
  INDEX idx_viaje (id_unidad_viaje),
  INDEX idx_telefono (telefono_e164),
  INDEX idx_fecha (creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 4. log_monitoreo_transcripciones
--    Cada turno de la conversacion (usuario habla, IA responde)
--    se guarda como un registro individual para analisis.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_monitoreo_transcripciones (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sesion_id INT UNSIGNED NOT NULL,
  rol ENUM('usuario','asistente','sistema') NOT NULL,
  contenido TEXT NOT NULL,
  timestamp_turno DATETIME DEFAULT CURRENT_TIMESTAMP,
  duracion_audio_ms INT DEFAULT NULL COMMENT 'Duracion del audio de este turno en ms',
  confianza DECIMAL(5,4) DEFAULT NULL COMMENT 'Confidence score del transcriber (0-1)',
  INDEX idx_sesion (sesion_id),
  INDEX idx_rol (rol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 5. log_monitoreo_eventos
--    Eventos del sistema de monitoreo: sincronizaciones,
--    errores, cambios de estado, watchdog, etc.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_monitoreo_eventos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('sync_numeros','prompt_update','sesion_creada','sesion_completada','sesion_fallida','sesion_zombie','intencion_detectada','intencion_procesada','error','watchdog','geocodificacion') NOT NULL,
  descripcion TEXT DEFAULT NULL,
  datos_extra JSON DEFAULT NULL,
  id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
  sesion_id INT UNSIGNED DEFAULT NULL,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tipo (tipo),
  INDEX idx_viaje (id_unidad_viaje),
  INDEX idx_fecha (creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- 6. op_monitoreo_intenciones
--    Intenciones detectadas en llamadas entrantes que requieren
--    accion. Por ejemplo: operador llama para reportar falla
--    mecanica → se crea una intencion "reporte_falla" pendiente
--    de procesar.
--    El sistema clasifica la transcripcion contra los prompts
--    configurados y genera intenciones accionables.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS op_monitoreo_intenciones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sesion_id INT UNSIGNED NOT NULL COMMENT 'Sesion de llamada donde se detecto',
  id_unidad_viaje BIGINT UNSIGNED DEFAULT NULL,
  tipo_intencion VARCHAR(50) NOT NULL COMMENT 'reporte_falla, solicitud_eta, emergencia, consulta_ubicacion, reporte_incidente, otro',
  descripcion TEXT DEFAULT NULL COMMENT 'Descripcion generada por IA de la intencion',
  datos_extraidos JSON DEFAULT NULL COMMENT 'Datos estructurados extraidos (tipo_falla, eta_estimado, etc.)',
  estado ENUM('pendiente','procesada','descartada','escalada') NOT NULL DEFAULT 'pendiente',
  prioridad ENUM('baja','media','alta','critica') NOT NULL DEFAULT 'media',
  procesada_en DATETIME DEFAULT NULL,
  procesada_por VARCHAR(100) DEFAULT NULL COMMENT 'Usuario o sistema que proceso la intencion',
  notas_procesamiento TEXT DEFAULT NULL,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sesion (sesion_id),
  INDEX idx_viaje (id_unidad_viaje),
  INDEX idx_estado (estado),
  INDEX idx_prioridad (prioridad),
  INDEX idx_tipo (tipo_intencion),
  INDEX idx_fecha (creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
