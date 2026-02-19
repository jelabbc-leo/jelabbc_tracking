# JELABBC Tracking — Plan de desarrollo por fases

Documento para ir marcando el avance de cada fase. Marca con `[x]` al completar.

---

## Fase 1 — Setup + Web básica funcional

- [x] Estructura proyecto (package.json, .env, web.config, server.js, carpetas, logo, favicon)
- [x] API client — `src/api/client.js` (login JWT, CRUD, auto-refresh token)
- [x] Scripts SQL (cleanup + migrations) — ejecutados contra MySQL
- [x] Layout (Tailwind + Syncfusion + navbar + logo) + login contra API .NET
- [x] Dashboard con Google Maps y viajes activos + tarjetas resumen Syncfusion
- [x] CRUD proveedores GPS (Syncfusion Grid + Dialog, conf_providers)
- [x] Vista viajes (Syncfusion Grid unidades_viajes) + detalle con mapa
- [x] Primer deploy a Azure vía GitHub

**Estado:** Completada

---

## Fase 2 — Scraper GPS

- [x] coord-detector.js (heurísticas universales)
- [x] extractor.js (3 estrategias: red, JS globals, DOM)
- [x] browser.js (Puppeteer, login genérico, iframes)
- [x] coordinator.js (orquesta scraping, guarda vía API)
- [x] Scheduler node-cron
- [x] Vista logs del scraper (Syncfusion Grid log_scrape)

**Estado:** Completada

---

## Fase 3 — IA y llamadas

- [x] stop-detector.js (detección de paros)
- [x] vapi-trigger.js (disparo de llamadas vía VAPI)
- [x] Panel config IA + historial llamadas

**Estado:** Completada

---

## Fase 4 — Pulido demo

- [x] Dashboard profesional completo
- [x] Vista detalle viaje con ruta en Google Maps
- [x] Export coordenadas (CSV)
- [x] Manejo de errores (página de error mejorada)
- [x] Preparar para presentación (demo)

**Estado:** Completada

---

## Fase 5 — Produccion: HTTP Fetcher + Twilio + VAPI

- [x] Reemplazar Puppeteer con HTTP Fetcher (llamadas directas a APIs GPS)
- [x] http-fetcher.js con soporte Micodus (parametro Key, timeout 90s)
- [x] coordinator.js usa http-fetcher en vez de browser+extractor
- [x] Puppeteer movido a devDependencies (no se instala en produccion)
- [x] Fix columnas BD: 7 columnas faltantes en unidades_viajes + nullable op_coordinates
- [x] Fix nombres columnas: placas_unidad, numero_contenedor, ultima_actualizacion
- [x] Cuenta Twilio creada + numero +1(320)313-6415 conectado a VAPI
- [x] Variables VAPI configuradas en Azure (PHONE_NUMBER_ID, ASSISTANT_ID, PRIVATE_KEY)
- [x] Prueba en vivo exitosa: 49 scrapes, 44 llamadas, 28 atendidas, Riley habla espanol
- [ ] Upgrade Twilio paid + comprar numero mexicano +52

**Estado:** En progreso (falta numero MX)

---

## Fase 6 — Sistema de Monitoreo de Llamadas IA

### 6A. Base de datos (SQL)

- [x] C1: Crear 6 tablas monitoreo_* en jela_logistica (sql/04_monitoreo_tables.sql)
- [x] C2: Insertar 3 prompts entrantes (operador, coordinador, desconocido)
- [x] C3: Insertar 6 prompts salientes (paro, escalamiento, geocercas, velocidad, seguimiento, custom)
- [x] C12: Crear tabla op_monitoreo_intenciones (incluida en sql/04)

### 6B. Integracion backend (codigo)

- [x] C4: Integrar monitoreo_out con vapi-trigger.js (lee prompts de BD con fallback a hardcoded)
- [x] C5: Integrar monitoreo_in con webhook VAPI (monitoreo-incoming.js: identifica caller, selecciona prompt, crea sesion)
- [x] C6: Sincronizar monitoreo_numeros_autorizados con contactos_viaje (monitoreo-sync.js)
- [x] C9: Webhook VAPI en server.js (POST /api/webhooks/vapi-monitoreo)
- [x] C10: Detector de intencion (monitoreo-intenciones.js: clasifica con OpenAI, crea en op_monitoreo_intenciones)
- [x] C11: Consulta inteligente tracking (monitoreo-consulta.js: carga datos BD, genera respuesta con OpenAI)
- [x] C13: Geocodificacion inversa (monitoreo-consulta.js: Google Maps Geocoding API con cache)

### 6C. UI + operacion

- [x] C7: Panel UI: /ai/monitoreo (dashboard), /ai/monitoreo/prompts (CRUD), /ai/monitoreo/sesiones (historial con detalle)
- [x] C8: Watchdog de sesiones zombie integrado en cron (monitoreo-sesiones.js marcarZombies)

**Estado:** Completada

---

## Fase 7 — Scraping universal (Puppeteer microservicio)

- [ ] D1: Crear Dockerfile con Puppeteer + Chromium y endpoint HTTP /scrape
- [ ] D2: Desplegar container en Azure Container Instance
- [ ] D3: Integrar http-fetcher.js con microservicio (flujo hibrido HTTP/browser)
- [ ] D4: Probar scraping de EPCOM/Wialon via microservicio

**Estado:** Pendiente

---

## Fase 8 — Amazon Alexa

- [ ] E1: Crear cuenta Amazon Developer y Alexa Skill "Monitoreo JELA"
- [ ] E2: Configurar 5 intents (ubicacion, estado, ETA, alertas, reportar problema)
- [ ] E3: Crear endpoint /api/alexa en jelabbc-tracking Node.js
- [ ] E4: Conectar Skill con endpoint HTTPS de Azure y probar consultas de voz
- [ ] E5: Integrar Proactive Events API para notificaciones push a Alexa

**Estado:** Pendiente

---

## Resumen

| Fase | Descripcion                          | Tareas | Estado      |
|------|--------------------------------------|--------|-------------|
| 1    | Setup + Web basica                   | 8/8    | Completada  |
| 2    | Scraper GPS                          | 6/6    | Completada  |
| 3    | IA y llamadas                        | 3/3    | Completada  |
| 4    | Pulido demo                          | 5/5    | Completada  |
| 5    | Produccion: HTTP Fetcher + Twilio    | 9/10   | En progreso |
| 6    | Sistema Monitoreo Llamadas IA        | 13/13  | Completada  |
| 7    | Scraping universal (Puppeteer)       | 0/4    | Pendiente   |
| 8    | Amazon Alexa                         | 0/5    | Pendiente   |

Marca con `[x]` al completar cada tarea.

Nota (2026-02-19): Se actualizó la configuración de Copilot con `copilot-instructions.md`, 4 archivos en `.github/instructions/` y 4 archivos en `.github/prompts/`.
