-- ==================== TABLA PARA CONFIGURACIÓN DE TV DISEÑO ====================
-- Esta tabla almacena el ajuste de fecha y hora para el reloj de TV Diseño

-- Crear tabla si no existe
CREATE TABLE IF NOT EXISTS tv_diseno_config (
  id SERIAL PRIMARY KEY,
  time_offset_ms BIGINT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(100)
);

-- Crear registro inicial si no existe
INSERT INTO tv_diseno_config (time_offset_ms) 
VALUES (0)
ON CONFLICT DO NOTHING;

-- ==================== QUERIES ÚTILES ====================

-- Ver el ajuste actual guardado
SELECT 
  id,
  time_offset_ms,
  time_offset_ms / 1000 as offset_segundos,
  time_offset_ms / (1000 * 60) as offset_minutos,
  time_offset_ms / (1000 * 60 * 60) as offset_horas,
  updated_at,
  updated_by
FROM tv_diseno_config 
ORDER BY id DESC 
LIMIT 1;

-- Guardar un ajuste de hora (ejemplo: adelantar 2 horas = 7200000 ms)
-- 1 hora = 3600000 ms
-- 1 minuto = 60000 ms
-- 1 segundo = 1000 ms
UPDATE tv_diseno_config 
SET 
  time_offset_ms = 7200000,  -- 2 horas adelante
  updated_by = 'Usuario',
  updated_at = CURRENT_TIMESTAMP
WHERE id = (SELECT id FROM tv_diseno_config ORDER BY id DESC LIMIT 1);

-- Guardar un ajuste de hora (ejemplo: atrasar 30 minutos = -1800000 ms)
UPDATE tv_diseno_config 
SET 
  time_offset_ms = -1800000,  -- 30 minutos atrás
  updated_by = 'Usuario',
  updated_at = CURRENT_TIMESTAMP
WHERE id = (SELECT id FROM tv_diseno_config ORDER BY id DESC LIMIT 1);

-- Resetear el ajuste (volver a hora del servidor)
UPDATE tv_diseno_config 
SET 
  time_offset_ms = 0,
  updated_by = 'Usuario',
  updated_at = CURRENT_TIMESTAMP
WHERE id = (SELECT id FROM tv_diseno_config ORDER BY id DESC LIMIT 1);

-- Insertar nuevo ajuste (si no existe registro)
INSERT INTO tv_diseno_config (time_offset_ms, updated_by)
VALUES (0, 'Usuario')
RETURNING *;
