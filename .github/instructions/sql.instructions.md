---
applyTo: "**/sql/**"
description: "Reglas para scripts SQL"
---
# Reglas de SQL
- BD: MySQL 8 en Azure Flexible Server (jela.mysql.database.azure.com), base: jela_logistica.
- Prefijos de tablas: conf_ (config), op_ (operación), log_ (auditoría), monitoreo_ (IA), unidades_ (viajes), eventos_ (eventos).
- Migrations numeradas con prefijo: 00_, 01_, 02_, 03_, 04_, 05_.
- NUNCA cambiar passwords del servidor MySQL (usuario jlsg).
- Nuevas tablas deben incluir: id INT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP.
- Usar CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci.
