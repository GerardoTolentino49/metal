-- Agregar columnas de tiempo por estado a la tabla tiempo_diseno
-- Campos para guardar: pausa, comida, 5s, meeting, pendiente, aprobado

BEGIN;

-- Agregar columnas si no existen
DO $$
BEGIN
    -- Pausa
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_pausa'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_pausa INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_pausa agregada';
    END IF;

    -- Comida
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_comida'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_comida INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_comida agregada';
    END IF;

    -- 5S
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_5s'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_5s INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_5s agregada';
    END IF;

    -- Meeting
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_meeting'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_meeting INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_meeting agregada';
    END IF;

    -- Pendiente
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_pendiente'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_pendiente INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_pendiente agregada';
    END IF;

    -- Aprobado
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_aprobado'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_aprobado INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_aprobado agregada';
    END IF;

END$$;

COMMIT;
