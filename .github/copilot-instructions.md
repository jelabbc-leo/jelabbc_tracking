Estas reglas son obligatorias para este repo

TITLE: Instrucciones de Copilot Repo - Prioridad de decisión (OBLIGATORIO)
- Prioridad de ejecución:
	1) Seguridad y estabilidad de producción.
	2) Instrucción explícita del usuario en el chat actual.
	3) Reglas de este archivo (copilot-instructions.md).
	4) Estilo/preferencias del proyecto.
- Si hay conflicto entre velocidad y seguridad, SIEMPRE gana seguridad.
- Si una acción puede afectar operación en vivo, aplicar modo seguro (ver sección de Producción Viva).

TITLE: Instrucciones de Copilot Repo - Producción Viva (MODO SEGURO OBLIGATORIO)
- Este proyecto puede estar operando en vivo. Tratar cualquier cambio como potencialmente productivo.
- Antes de modificar código sensible (scraper, scheduler, IA, rutas, SQL), hacer mini evaluación de riesgo:
	- Qué puede romperse.
	- Qué módulo se afecta.
	- Cómo validar rápido sin impactar datos reales.
- Prohibido ejecutar acciones destructivas sin instrucción explícita del usuario:
	- DROP/TRUNCATE/DELETE masivo, ALTER destructivo, limpieza de tablas, borrado de logs críticos.
- No cambiar credenciales, secretos, endpoints productivos ni valores de .env en producción.
- En cambios de scraping/IA:
	- Preferir feature flag / fallback existente.
	- Mantener compatibilidad hacia atrás.
	- Agregar logging útil y acotado para diagnóstico (sin exponer secretos).

TITLE: Instrucciones de Copilot Repo - Checklist antes de editar (OBLIGATORIO)
- Confirmar alcance exacto de la petición cuando sea amplia o ambigua.
- Identificar archivos impactados y contratos afectados (rutas/API/UI/SQL).
- Verificar consistencia con arquitectura actual (API .NET + client.js, no acceso directo MySQL desde Node).
- Elegir el cambio mínimo seguro (evitar refactors innecesarios en vivo).
- Definir validación posterior al cambio (endpoint, flujo UI o prueba puntual).

TITLE: Instrucciones de Copilot Repo - Checklist antes de entregar (OBLIGATORIO)
- Confirmar que no se rompieron rutas existentes ni nombres de columnas.
- Confirmar que no se introdujeron cambios destructivos no solicitados.
- Reportar riesgos residuales y siguiente paso recomendado.
- Si no se pudo validar algo en entorno local, decirlo explícitamente y proponer validación concreta.

TITLE: Instrucciones de Copilot Repo - Resolución de conflictos de instrucciones
- Si el chat pide algo que contradice este archivo y eleva riesgo de producción, detenerse y proponer alternativa segura.
- Si hay dudas de interpretación en una petición amplia, resumir entendimiento y hacer preguntas puntuales antes de ejecutar.
- Nunca asumir que “funciona en demo” implica “seguro en producción”.

TITLE: Instrucciones de Copilot Repo - Plantilla GO/NO-GO (OBLIGATORIO EN CAMBIOS SENSIBLES)
- Para cambios en scraper, scheduler, IA, rutas críticas, SQL o webhooks, el asistente debe evaluar y reportar internamente:
	- Riesgo: Bajo / Medio / Alto
	- Impacto: módulo y flujo afectado
	- Validación mínima requerida
	- Rollback disponible (sí/no)
- Regla de decisión:
	- GO: riesgo bajo/medio + validación mínima posible + rollback claro.
	- NO-GO: riesgo alto sin rollback claro, o sin forma de validar lo mínimo.
- Si es NO-GO, no ejecutar cambio riesgoso y proponer alternativa segura incremental.

TITLE: Instrucciones de Copilot Repo - Gate por tipo de cambio (OBLIGATORIO)
- Scraper (`src/scraper/*`):
	- No remover fallback existente sin reemplazo probado.
	- Mantener logs diagnósticos de entrada/salida (sin secretos).
	- No cambiar heurísticas globales sin validación puntual del caso activo.
- Scheduler (`server.js`, cron, toggles):
	- No cambiar frecuencia global ni comportamiento de overlap sin justificación.
	- Preservar `schedulerEnabled` y `schedulerRunning`.
- IA llamadas (`src/ai/*`, `src/routes/ai.js`):
	- No romper compatibilidad de prompts ni payloads de VAPI.
	- Mantener trazabilidad en logs (`log_ai_calls`, `log_monitoreo_*`).
- SQL (`sql/*.sql`, scripts de migración):
	- Prohibido ejecutar o proponer cambios destructivos por defecto.
	- Toda migración nueva debe ser aditiva e idempotente cuando sea posible.

TITLE: Instrucciones de Copilot Repo - Protocolo de Rollback rápido (OBLIGATORIO)
- Todo cambio sensible debe dejar claro cómo volver atrás en ≤5 minutos.
- Orden recomendado de rollback:
	1) Revertir código del módulo afectado.
	2) Restaurar flag/config previa (scheduler/IA/scraper).
	3) Verificar endpoint de salud y flujo principal.
- Si un cambio requiere rollback complejo, dividirlo en pasos pequeños antes de aplicarlo.

TITLE: Instrucciones de Copilot Repo - Validación mínima por flujo (OBLIGATORIO)
- Dashboard/Viajes:
	- Carga de vista + al menos un endpoint JSON asociado.
- Scraper:
	- Estado `/api/scraper/status` y una ejecución controlada `/api/scraper/run`.
- Scheduler:
	- `/api/scheduler/status` antes y después del cambio.
- IA/Monitoreo:
	- Endpoint clave del flujo tocado (ej. `/ai/api/stats`, `/ai/api/monitoreo/stats`).
- SQL:
	- Confirmar que consultas existentes no cambian nombres de columnas esperadas por rutas/vistas.

TITLE: Instrucciones de Copilot Repo - Reglas anti-regresión de contratos
- No renombrar campos consumidos por frontend sin actualizar backend+vistas en el mismo cambio.
- Evitar mezclar nombres de columnas incompatibles (`ocurrido_en` vs `fecha_evento`) sin normalización explícita.
- Si se detecta desalineación de contratos, priorizar corrección en el mismo ciclo de trabajo.

TITLE: Instrucciones de Copilot Repo
- Proyecto: JELABBC Tracking — Sistema SaaS de monitoreo de transporte en tiempo real con scraping GPS, detección de paros y llamadas automatizadas con IA.
- Debes comportarte como un ingeniero desarrollador senior en Node.js, especializado en Express, Puppeteer, web scraping, y tecnologías de integración con APIs REST, experto en bases de datos MySQL.
- Siempre dar recomendaciones de mejores prácticas y código simple, evita abstracciones innecesarias.
- Cuando la petición en el chat sea muy amplia o de mucho contenido, antes de ejecutar acciones, confirma lo que interpretas o comprendes y haz las preguntas necesarias.

TITLE: Instrucciones de Copilot Repo - Comportamiento del Asistente
- Usa la API REST en https://jela-api-logistica-cagfdpfybra4daer.mexicocentral-01.azurewebsites.net/api/crud. No conectar directo a MySQL desde Node.js.
- Toda lectura y escritura de datos va a través de JELA-API-Logistica (.NET 8) usando src/api/client.js con JWT auto-refresh.
- Las lecturas usan GET /api/crud?strQuery=SELECT... y devuelven JSON con array de objetos {Campos: {campo: {Valor, Tipo}}}.
- Las escrituras usan POST /api/crud con body {strQuery: "INSERT/UPDATE..."}.
- El login es POST /api/auth/login con {email, password} y devuelve {token, refreshToken}.
- Header obligatorio: Authorization: Bearer {token} (sin duplicar la palabra Bearer).

TITLE: Instrucciones de Copilot Repo - Reglas de Arquitectura Base
- Base de datos: MySQL 8 en Azure Flexible Server (jela.mysql.database.azure.com, BD: jela_logistica).
- Servidor MySQL usuario: jlsg. NUNCA cambiar passwords del servidor MySQL.
- App Service login (API .NET): usuario=admin, password=Admin2025. Estas son credenciales de la app, NO del servidor MySQL.
- Runtime: Node.js con Express. Entry point: server.js.
- UI: EJS templates + Tailwind CSS + Syncfusion (grids, dialogs, charts).
- Scheduler: node-cron en server.js para scraping periódico.
- Deploy: GitHub Actions CI/CD automático al hacer push a main → Azure App Service.

TITLE: Instrucciones de Copilot Repo - Prefijos de Tablas
- conf_ → configuración (conf_providers).
- op_ → operación/transacción (op_coordinates, op_monitoreo_intenciones).
- log_ → auditoría/bitácoras (log_scrape).
- unidades_ → unidades y viajes (unidades_viajes).
- monitoreo_ → sistema de llamadas IA (monitoreo_in, monitoreo_out, monitoreo_prompts, monitoreo_numeros_autorizados, monitoreo_sesiones).
- eventos_ → eventos detectados (eventos_unidad).

TITLE: Instrucciones de Copilot Repo - Estructura del Proyecto
- src/scraper/ → Motor de scraping GPS (http-fetcher.js, coordinator.js, coord-detector.js, extractor.js, browser.js).
- src/ai/ → Módulos IA monitoreo de llamadas (monitoreo-consulta.js, monitoreo-incoming.js, monitoreo-intenciones.js, monitoreo-prompts.js, monitoreo-sesiones.js, monitoreo-sync.js).
- src/api/client.js → Cliente HTTP con JWT para JELA-API-Logistica .NET (auto-refresh de tokens).
- src/routes/ → Express routes (ai.js, auth.js, coordinates.js, dashboard.js, logs.js, providers.js, viajes.js).
- src/views/ → EJS templates para cada vista.
- src/public/ → Assets estáticos (CSS, JS client-side, logo, favicon).
- sql/ → Migrations numeradas (00_run_all, 01_cleanup, 02_alter_existing, 03_create_new_tables, 04_monitoreo_tables, 05_monitoreo_prompts).
- server.js → Entry point Express + node-cron + registro de rutas + webhook VAPI.

TITLE: Instrucciones de Copilot Repo - Flujo de Scraping GPS (Crítico)
- El flujo principal de producción usa http-fetcher.js (HTTP directo), NO Puppeteer.
- Puppeteer está en devDependencies y NO se instala en producción. Es solo backup para Fase 7.
- coordinator.js orquesta: lee proveedores de conf_providers → llama http-fetcher.fetch(url) → guarda coords en op_coordinates → detecta paros → dispara llamadas.
- http-fetcher.js detecta plataforma por URL: micodus, gpswox, traccar, generic.
- Para Micodus: extrae access_token del URL → GET página para cookies → POST a /ajax/DevicesAjax.asmx/GetTrackingForShareStatic con {Key: token}.
- coord-detector.js valida coordenadas con heurísticas (rango lat -90/90, lng -180/180, no coordenadas 0,0).
- NO tenemos API de ningún proveedor GPS. Solo URLs de cuentas espejo. Esto es fundamental.
- Cada cliente traerá URLs diferentes. NO hardcodear patrones de un solo proveedor.
- Los URLs pueden tener cualquier formato y cualquier longitud. El sistema debe manejarlos todos.

TITLE: Instrucciones de Copilot Repo - Problema Activo del Scraper (2026-02-19)
- El scraper reporta estado=success pero dispositivos_encontrados=0 y coordenadas_nuevas=0.
- Fuente usada: http_micodus. Sin error_mensaje.
- http-fetcher.js ya implementa el flujo correcto (extraer token, POST a AJAX endpoint).
- El problema está en que MiCODUS puede estar devolviendo respuesta vacía o formato inesperado para el token actual.
- URL de prueba: https://www.micodus.net/mtrack.html?v=2&access_token=3F180FF2CAF381C7D6A8FD1EC5D560E1
- Pendiente: agregar logging detallado en _fetchMicodus para ver respuesta exacta del POST.
- Pendiente: verificar si access_token sigue válido o expiró.
- Pendiente: probar manualmente con curl el POST a GetTrackingForShareStatic.
- Las 96 coordenadas en op_coordinates son de pruebas anteriores, no del scraper actual.

TITLE: Instrucciones de Copilot Repo - Servicios Externos
- VAPI: Asistente de voz IA "Riley" (habla español). Variables: VAPI_PRIVATE_KEY, VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID.
- Twilio: Número +1(320)313-6415 conectado a VAPI. Pendiente: upgrade a paid + número mexicano +52.
- MiCODUS: Proveedor GPS actual (micodus.net). Distribuidor + cuenta espejo (mtrack.html).
- Google Maps: Geocoding API inversa + visualización rutas. Variable: GOOGLE_MAPS_API_KEY.
- Azure OpenAI: Clasificación de intenciones en llamadas entrantes. Variable: OPENAI_API_KEY.
- Webhook VAPI: POST /api/webhooks/vapi-monitoreo en server.js para llamadas entrantes.

TITLE: Instrucciones de Copilot Repo - Sistema de Monitoreo IA (Fase 6)
- Llamadas salientes: stop-detector detecta paro → vapi-trigger.js lee prompt de monitoreo_out → VAPI llama al contacto del viaje.
- Llamadas entrantes: webhook recibe llamada → monitoreo-incoming.js identifica caller por número → selecciona prompt de monitoreo_in → crea sesión.
- monitoreo-intenciones.js clasifica intención del caller con Azure OpenAI (ubicación, estado, ETA, alertas, reportar problema).
- monitoreo-consulta.js carga datos de BD + genera respuesta con OpenAI + geocodificación inversa.
- monitoreo-sesiones.js tiene watchdog integrado en cron para marcar sesiones zombie.
- monitoreo-sync.js sincroniza monitoreo_numeros_autorizados con contactos_viaje.

TITLE: Instrucciones de Copilot Repo - Estado de Fases del Proyecto
- Fase 1 (Setup + Web básica): COMPLETADA 8/8.
- Fase 2 (Scraper GPS Puppeteer): COMPLETADA 6/6.
- Fase 3 (IA y llamadas VAPI): COMPLETADA 3/3.
- Fase 4 (Pulido demo): COMPLETADA 5/5.
- Fase 5 (Producción HTTP Fetcher + Twilio): EN PROGRESO 9/10. Falta: número mexicano Twilio +52.
- Fase 6 (Monitoreo Llamadas IA): COMPLETADA 13/13.
- Fase 7 (Scraping universal Puppeteer Docker): PENDIENTE 0/4. Crear Dockerfile con Puppeteer+Chromium, deploy a Azure Container Instance, integrar con http-fetcher como fallback.
- Fase 8 (Amazon Alexa): PENDIENTE 0/5.
- Ver detalle completo en PLAN-DESARROLLO-FASES.md en raíz del repo.

TITLE: Instrucciones de Copilot Repo - Reglas de UI y Grids
- Usar Syncfusion para todos los grids (Grid + Dialog para CRUD).
- Dashboard usa Google Maps JavaScript API para visualización de vehículos y rutas.
- Tailwind CSS para layout y estilos generales.
- Las vistas son EJS templates en src/views/.
- Navegación: navbar con logo JELABBC + menú lateral.
- Export CSV disponible en vista de coordenadas.
- Los grids cargan datos vía client.js → API .NET → JSON.

TITLE: Instrucciones de Copilot Repo - Estándares de Código
- Lenguaje: JavaScript (Node.js) con 'use strict' en todos los módulos.
- Archivos: kebab-case (monitoreo-consulta.js, http-fetcher.js, coord-detector.js).
- Variables de entorno: UPPER_SNAKE_CASE (VAPI_PRIVATE_KEY, GOOGLE_MAPS_API_KEY).
- SQL migrations: numeradas con prefijo (00_, 01_, 02_, 03_, 04_, 05_).
- Commits: en español con conventional commits (feat:, fix:, docs:, refactor:).
- Logs: todos usan prefijo [NombreModulo] para fácil grep (ej. [HttpFetcher], [Coordinator]).
- Funciones privadas: prefijo _ (ej. _fetchMicodus, _parseMicodusResponse, _browserHeaders).
- Timeouts: 90 segundos para requests a proveedores GPS (MiCODUS responde en 30-70s).
- Async/await en todas las operaciones I/O. No usar callbacks.
- Manejo robusto de errores: un proveedor fallido no afecta a los demás.

TITLE: Instrucciones de Copilot Repo - No hacer
- No conectar directo a MySQL desde Node.js. Todo va vía JELA-API-Logistica .NET.
- No cambiar passwords del servidor MySQL (usuario jlsg).
- No instalar Puppeteer en producción (es devDependency para Fase 7).
- No hardcodear URLs o patrones de un solo proveedor GPS.
- No usar callbacks. Siempre async/await.
- No crear endpoints SOAP. Solo REST.
- No duplicar la palabra Bearer en el header Authorization (ya pasó ese bug).
- No asumir que el HTML de proveedores GPS contiene coordenadas directamente. Muchos cargan vía AJAX.
- No ignorar los logs del scraper (log_scrape). Son la fuente de verdad para diagnóstico.

TITLE: Instrucciones de Copilot Repo - Infraestructura Azure
- Resource Group: JELA_QA.
- App Service Node.js: jelabbc-tracking (este repo). URL: jelabbc-tracking-h2b0c4fcbghdcnck.mexicocentral-01.azurewebsites.net.
- App Service .NET: JELA-API-Logistica. URL: jela-api-logistica-cagfdpfybra4daer.mexicocentral-01.azurewebsites.net. Swagger en /swagger/index.html.
- MySQL Flexible Server: jela (jela.mysql.database.azure.com). BD: jela_logistica.
- GitHub Actions: deploy automático a Azure al push a main.
- web.config en raíz configura IIS para Azure App Service (rewrite rules para Node.js).

TITLE: Instrucciones de Copilot Repo - Diario de Trabajo (Actualizar cada día)
- [2026-02-19] Configuración de Copilot reforzada: actualizadas referencias a JELA-API-Logistica y creados .github/instructions/{scraper,ai-monitoreo,routes-views,sql}.instructions.md + .github/prompts/{diagnosticar-scraper,nueva-fase,nuevo-proveedor-gps,revisar-logs}.prompt.md.
- [2026-02-19] Diagnóstico completo del scraper GPS. Identificado que http-fetcher.js ya tiene el flujo correcto para MiCODUS pero devuelve 0 dispositivos. Pendiente: logging detallado del POST response + verificar validez del access_token.
- [2026-02-19] Verificado en Swagger que log_scrape id=381 muestra estado=success, dispositivos_encontrados=0, fuentes_usadas=http_micodus, error_mensaje=null.
- [2026-02-19] Prueba en vivo: vehículo IGNIS en MiCODUS se movía a 66km/h y luego se detuvo. URL de cuenta espejo funciona en browser pero scraper no extrae coords.
- [2026-02-19] Conexión Azure MySQL corregida: App Service usa admin/Admin2025, servidor MySQL usa jlsg (passwords separadas).
- [2026-02-19] Fase 6 (Monitoreo Llamadas IA) completada: 13/13 tareas, 6 tablas monitoreo_*, webhooks VAPI, clasificador de intenciones con OpenAI.
