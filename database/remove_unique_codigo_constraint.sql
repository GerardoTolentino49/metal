-- Eliminar restricción de unicidad en codigo para permitir múltiples registros con el mismo código
-- PostgreSQL

-- 1) Eliminar la restricción de clave foránea que depende del índice único
ALTER TABLE inventario_salida DROP CONSTRAINT IF EXISTS fk_salida_inventario_codigo;

-- 2) Eliminar el índice único existente
DROP INDEX IF EXISTS ux_inventario_codigo;

-- 3) Crear un índice normal (no único) para mejorar el rendimiento de búsquedas
CREATE INDEX IF NOT EXISTS ix_inventario_codigo
  ON inventario (codigo);

-- 4) Verificar que se eliminó la restricción
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'inventario' AND indexname LIKE '%codigo%';
