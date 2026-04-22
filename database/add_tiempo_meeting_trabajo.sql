-- Agregar columna tiempo_meeting_trabajo a la tabla tiempo_diseno
-- Esta columna rastreará el tiempo de reunión durante el estado de trabajo

BEGIN;

DO $$
BEGIN
    -- Agregar columna tiempo_meeting_trabajo si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_meeting_trabajo'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_meeting_trabajo INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_meeting_trabajo agregada exitosamente';
    ELSE
        RAISE NOTICE 'Columna tiempo_meeting_trabajo ya existe';
    END IF;
END $$;

COMMIT;
