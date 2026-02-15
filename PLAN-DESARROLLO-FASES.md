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

## Próximos pasos (post-demo)

- [ ] Ajustar extractor para Micodus y GPSWox (red + DOM maps.google.com + JS globals)
- [ ] Pruebas en vivo con URLs reales Micodus y GPSWox
- [ ] Validar flujo completo: scraping → coordenadas en mapa → detección paros → llamadas IA

---

## Resumen

| Fase | Descripción              | Estado      |
|------|--------------------------|-------------|
| 1    | Setup + Web básica       | Completada  |
| 2    | Scraper GPS              | Completada  |
| 3    | IA y llamadas            | Completada  |
| 4    | Pulido demo              | Completada  |
| —    | Próximos (extractor/demo)| Pendiente   |

Los ítems con `[x]` están hechos. Los de "Próximos pasos" se pueden ir marcando conforme se implementen.
