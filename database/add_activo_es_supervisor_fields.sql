-- Agregar campos activo y es_supervisor a la tabla empleados
-- Ejecutar este script en la base de datos apoyos_db

-- Agregar campo activo
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;

-- Agregar campo es_supervisor
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS es_supervisor BOOLEAN DEFAULT false;

-- Verificar que los campos se agregaron correctamente
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'empleados' 
AND column_name IN ('activo', 'es_supervisor');
