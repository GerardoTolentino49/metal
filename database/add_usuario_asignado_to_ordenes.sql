-- Agregar columna usuario_asignado como array de IDs de usuarios a la tabla ordenes
-- Esta columna almacenará un array de IDs de usuarios que pueden trabajar en cada orden

ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS usuario_asignado INTEGER[] DEFAULT '{}';

-- Comentario para documentar la columna
COMMENT ON COLUMN ordenes.usuario_asignado IS 'Array de IDs de usuarios que pueden trabajar en esta orden';
