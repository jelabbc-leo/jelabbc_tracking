---
mode: ask
description: "Analizar logs del scraper para encontrar problemas"
---
Ayúdame a analizar los logs del scraper GPS.
Los logs se guardan en la tabla log_scrape de JELA-API-Logistica con estos campos:
id, provider_id, inicio, fin, estado, dispositivos_encontrados, coordenadas_nuevas, fuentes_usadas, error_mensaje
Se consultan vía: GET /api/crud?strQuery=SELECT id, provider_id, inicio, fin, estado, dispositivos_encontrados, coordenadas_nuevas, fuentes_usadas, error_mensaje FROM log_scrape ORDER BY id DESC LIMIT 20
Analiza los datos que te proporcione y dime:
1. Si hay errores recurrentes
2. Si algún proveedor falla consistentemente (por provider_id)
3. Si hay patrones de horario en los fallos
4. Cuántos scrapes fueron exitosos vs fallidos
5. Recomendaciones concretas para mejorar la tasa de éxito
