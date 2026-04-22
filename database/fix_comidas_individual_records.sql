-- Remover constraint UNIQUE si existe (permite múltiples registros el mismo día)
ALTER TABLE comidas DROP CONSTRAINT IF EXISTS comidas_empleado_fecha_unique;

-- Verificar estructura actual
-- SELECT * FROM information_schema.table_constraints WHERE table_name = 'comidas';
