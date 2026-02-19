---
applyTo: "**/scraper/**"
description: "Reglas para el motor de scraping GPS"
---
# Reglas del Scraper GPS
- http-fetcher.js es el método PRINCIPAL de producción. No usar Puppeteer en producción.
- Puppeteer está en devDependencies, solo se usará en Fase 7 como microservicio Docker.
- Toda extracción sigue: detectar plataforma → HTTP request → parsear respuesta → coord-detector valida.
- Para Micodus: extraer access_token del URL, GET página para cookies, POST a /ajax/DevicesAjax.asmx/GetTrackingForShareStatic.
- Siempre probar con 3 variantes de body: {Key: token}, {key: token}, {access_token: token}.
- Timeout de 90 segundos para requests GPS (MiCODUS responde en 30-70s).
- Los URLs de clientes pueden ser de CUALQUIER proveedor y formato. No hardcodear patrones.
- coord-detector.js valida rango lat -90/90, lng -180/180, descarta 0,0.
- Usar prefijo [NombreModulo] en todos los logs (ej. [HttpFetcher], [Coordinator]).
- Funciones privadas con prefijo _ (ej. _fetchMicodus, _parseMicodusResponse).
- Si detectPlatform devuelve 'generic', usar fallback con coord-detector sobre HTML completo.
- Manejo robusto de errores: un proveedor fallido no afecta a los demás.
