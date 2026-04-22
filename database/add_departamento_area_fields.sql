-- Agregar campos departamento y area a la tabla empleados
-- Ejecutar este script en la base de datos apoyos_db

-- Agregar campo departamento
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS departamento VARCHAR(255);

-- Agregar campo area
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS area VARCHAR(255);

-- Verificar que los campos se agregaron correctamente
SELECT column_name, data_type, character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'empleados' 
AND column_name IN ('departamento', 'area');
