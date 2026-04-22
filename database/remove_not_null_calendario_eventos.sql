-- Eliminar restricciones NOT NULL de la tabla calendario_eventos
-- Esto permite que los campos puedan ser nulos temporalmente durante la creación

-- Quitar NOT NULL de columnas existentes
ALTER TABLE calendario_eventos 
ALTER COLUMN fecha DROP NOT NULL;

ALTER TABLE calendario_eventos 
ALTER COLUMN mes DROP NOT NULL;

ALTER TABLE calendario_eventos 
ALTER COLUMN titulo DROP NOT NULL;

-- También asegurarse de que fecha_evento no tenga restricción NOT NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'calendario_eventos' 
        AND column_name = 'fecha_evento'
    ) THEN
        ALTER TABLE calendario_eventos ALTER COLUMN fecha_evento DROP NOT NULL;
    END IF;
END $$;

-- Verificar cambios
SELECT 
    column_name, 
    data_type, 
    is_nullable 
FROM information_schema.columns 
WHERE table_name = 'calendario_eventos' 
ORDER BY ordinal_position;
