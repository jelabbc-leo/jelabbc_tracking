-- ============================================================
-- JELABBC Tracking - Script 02: ALTER tablas existentes
-- Modifica tablas existentes para soportar las nuevas funcionalidades:
--   - unidades_viajes: campos de provider, aduana, modulacion, tracking, IA, links
--   - eventos_unidad: tipos de evento adicionales
--   - contactos_viaje: roles de contacto adicionales
-- Ejecutar UNA SOLA VEZ contra la base de datos jela_logistica.
-- ============================================================

-- -----------------------------------------------------------
-- 1. unidades_viajes - agregar campos nuevos
-- -----------------------------------------------------------
ALTER TABLE unidades_viajes
  ADD COLUMN provider_id INT UNSIGNED DEFAULT NULL,
  ADD COLUMN aduana VARCHAR(200) DEFAULT NULL,
  ADD COLUMN modulacion_activa BOOLEAN DEFAULT FALSE,
  ADD COLUMN modulacion_resultado ENUM('pendiente','verde','rojo') DEFAULT 'pendiente',
  ADD COLUMN frecuencia_monitoreo_min INT DEFAULT 10,
  ADD COLUMN fecha_inicio_tracking DATETIME DEFAULT NULL,
  ADD COLUMN fecha_fin_tracking DATETIME DEFAULT NULL,
  ADD COLUMN ia_llamadas_activas BOOLEAN DEFAULT FALSE,
  ADD COLUMN umbral_paro_minutos INT DEFAULT 30,
  ADD COLUMN link_recoleccion VARCHAR(500) DEFAULT NULL,
  ADD COLUMN link_dropoff_vacio VARCHAR(500) DEFAULT NULL,
  ADD COLUMN link_carga_vacio VARCHAR(500) DEFAULT NULL,
  ADD COLUMN link_entrega_cargado VARCHAR(500) DEFAULT NULL;

-- -----------------------------------------------------------
-- 2. eventos_unidad - ampliar ENUM tipo_evento
-- -----------------------------------------------------------
ALTER TABLE eventos_unidad
  MODIFY COLUMN tipo_evento ENUM(
    'creacion',
    'inicio_ruta',
    'ubicacion_actualizada',
    'detencion_detectada',
    'reinicio_movimiento',
    'llamada_operador',
    'llamada_cliente',
    'llamada_propietario',
    'llamada_ia_operador',
    'llamada_ia_coordinador',
    'scrape_exitoso',
    'scrape_error',
    'notif_push_proximidad',
    'modulacion_consultada',
    'alerta_paro_ia',
    'llegada_destino',
    'llegada_punto_logistico'
  ) NOT NULL;

-- -----------------------------------------------------------
-- 3. contactos_viaje - ampliar ENUM tipo_contacto
-- -----------------------------------------------------------
ALTER TABLE contactos_viaje
  MODIFY COLUMN tipo_contacto ENUM(
    'operador',
    'cliente',
    'propietario',
    'coordinador1',
    'coordinador2',
    'coordinador3',
    'otro'
  ) NOT NULL;
