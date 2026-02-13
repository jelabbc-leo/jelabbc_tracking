-- ============================================================
-- JELABBC Tracking - Script maestro
-- Ejecuta todos los scripts de migracion en orden.
-- 
-- USO:
--   mysql -h jela.mysql.database.azure.com -u jlsg -p jela_logistica < sql/00_run_all.sql
--
-- O ejecutar cada script individualmente en orden:
--   1. sql/01_cleanup.sql         (DROP tablas obsoletas)
--   2. sql/02_alter_existing.sql  (ALTER tablas existentes)
--   3. sql/03_create_new_tables.sql (CREATE tablas nuevas)
-- ============================================================

SOURCE sql/01_cleanup.sql;
SOURCE sql/02_alter_existing.sql;
SOURCE sql/03_create_new_tables.sql;
