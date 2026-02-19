---
mode: agent
description: "Agregar soporte para un nuevo proveedor GPS en http-fetcher.js"
---
Necesito agregar soporte para un nuevo proveedor GPS en src/scraper/http-fetcher.js.
Pregúntame el nombre del proveedor y una URL de ejemplo antes de empezar.
Luego:
1. Agrega la detección en detectPlatform() con las URLs características del proveedor
2. Crea una función _fetchNuevoProveedor() siguiendo el patrón exacto de _fetchMicodus
3. El fetcher debe hacer los requests necesarios y devolver: {coords: [{lat, lng, speed, heading, timestamp, source}], platform: string, source: string}
4. Agregar el case en el switch de la función fetch()
5. Usar coord-detector.isValidPair() para validar cada coordenada
6. Timeout de 90 segundos
7. Logging con prefijo [HttpFetcher]
8. Manejo de errores que no rompa el flujo general
