-- ============================================================
-- JELABBC Tracking - Script 01: Cleanup
-- Elimina tablas obsoletas que ya no se usan en el sistema.
-- Ejecutar UNA SOLA VEZ contra la base de datos jela_logistica.
-- ============================================================

-- Tablas obsoletas a eliminar
DROP TABLE IF EXISTS conversaciones_bot;
DROP TABLE IF EXISTS tracking_requests;
