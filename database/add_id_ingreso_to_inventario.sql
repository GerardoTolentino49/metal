-- Agregar campo id_ingreso para hacer cada entrada única
-- PostgreSQL

-- 1) Agregar columna id_ingreso si no existe
ALTER TABLE inventario 
ADD COLUMN IF NOT EXISTS id_ingreso VARCHAR(50);

-- 2) Crear índice único en id_ingreso para garantizar unicidad
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventario_id_ingreso 
ON inventario (id_ingreso);

-- 3) Poblar id_ingreso existente con formato: ING-{id}-{timestamp}
UPDATE inventario 
SET id_ingreso = 'ING-' || id || '-' || EXTRACT(EPOCH FROM created_at)::bigint
WHERE id_ingreso IS NULL;

-- 4) Hacer id_ingreso NOT NULL después de poblar
ALTER TABLE inventario 
ALTER COLUMN id_ingreso SET NOT NULL;
