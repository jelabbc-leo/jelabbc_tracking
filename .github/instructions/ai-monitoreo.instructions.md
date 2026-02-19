---
applyTo: "**/ai/**"
description: "Reglas para el sistema de monitoreo IA"
---
# Reglas del Monitoreo IA
- Llamadas salientes: stop-detector detecta paro → vapi-trigger.js lee prompt de BD (monitoreo_out) → llama vía VAPI.
- Llamadas entrantes: webhook en /api/webhooks/vapi-monitoreo → monitoreo-incoming.js identifica caller por número → selecciona prompt de monitoreo_in → crea sesión.
- monitoreo-intenciones.js clasifica intención del caller con Azure OpenAI. Intenciones posibles: ubicación, estado, ETA, alertas, reportar problema.
- monitoreo-consulta.js carga datos de BD + genera respuesta con OpenAI + geocodificación inversa (Google Maps API con cache).
- monitoreo-sesiones.js tiene watchdog integrado en cron para marcar sesiones zombie.
- monitoreo-sync.js sincroniza monitoreo_numeros_autorizados con contactos_viaje.
- Todos los prompts se leen de la tabla monitoreo_prompts con fallback a hardcoded si no hay en BD.
- Variables: VAPI_PRIVATE_KEY, VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID, OPENAI_API_KEY.
