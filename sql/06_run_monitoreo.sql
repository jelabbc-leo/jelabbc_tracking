-- ============================================================
-- JELABBC Tracking - Script 06: Ejecutar todo el sistema de monitoreo
-- Ejecuta scripts 04 y 05 en orden.
-- ============================================================

SOURCE sql/04_monitoreo_tables.sql;
SOURCE sql/05_monitoreo_prompts.sql;

-- Verificar que todo se creo correctamente:
SELECT 'conf_monitoreo_prompts' AS tabla, COUNT(*) AS registros FROM conf_monitoreo_prompts
UNION ALL
SELECT 'conf_monitoreo_numeros', COUNT(*) FROM conf_monitoreo_numeros
UNION ALL
SELECT 'log_monitoreo_sesiones', COUNT(*) FROM log_monitoreo_sesiones
UNION ALL
SELECT 'log_monitoreo_transcripciones', COUNT(*) FROM log_monitoreo_transcripciones
UNION ALL
SELECT 'log_monitoreo_eventos', COUNT(*) FROM log_monitoreo_eventos
UNION ALL
SELECT 'op_monitoreo_intenciones', COUNT(*) FROM op_monitoreo_intenciones;
