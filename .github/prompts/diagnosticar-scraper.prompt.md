---
mode: agent
description: "Diagnosticar por qué el scraper devuelve 0 dispositivos"
---
Revisa los archivos src/scraper/http-fetcher.js y src/scraper/coordinator.js.
Haz lo siguiente:
1. Analiza la función _fetchMicodus y verifica que el flujo sea correcto: extraer access_token → GET página para cookies → POST a GetTrackingForShareStatic
2. Revisa _parseMicodusResponse para todos los formatos: {d: "string JSON"}, {d: {objeto}}, {objeto directo}, [array]
3. Sugiere logging adicional para capturar la respuesta exacta del POST AJAX de MiCODUS
4. Verifica que los headers de _browserHeaders() simulen un browser real correctamente
5. Propón un comando curl para probar manualmente el endpoint GetTrackingForShareStatic
Contexto: el scraper reporta estado=success pero dispositivos_encontrados=0. La fuente usada es http_micodus. Sin error_mensaje. La URL de prueba es https://www.micodus.net/mtrack.html?v=2&access_token=3F180FF2CAF381C7D6A8FD1EC5D560E1
