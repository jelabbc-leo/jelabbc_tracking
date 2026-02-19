---
applyTo: "**/routes/**,**/views/**"
description: "Reglas para routes Express y vistas EJS"
---
# Reglas de Routes y Views
- Todas las rutas Express usan src/api/client.js para llamadas a JELA-API-Logistica.
- NUNCA conectar directo a MySQL. Todo va vía JELA-API-Logistica: GET /api/crud?strQuery=SELECT...
- Header obligatorio: Authorization: Bearer {token} (sin duplicar la palabra Bearer).
- UI usa Tailwind CSS + Syncfusion (grids, dialogs, charts).
- Vistas son EJS templates en src/views/.
- Grids de Syncfusion para todas las tablas (proveedores, viajes, logs, coordenadas).
- Dashboard usa Google Maps JavaScript API para mapa de vehículos.
- Export CSV disponible en vista de coordenadas.
- Los datos de JELA-API-Logistica vienen como [{Campos: {campo: {Valor, Tipo}}}].
- Login va contra POST /api/auth/login de JELA-API-Logistica.
