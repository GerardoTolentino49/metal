-- Agregar columnas de tiempo para los nuevos estados PDM RWK y Revisión de orden
-- Añade columnas de intervalo a la tabla tiempo_diseno si no existen

BEGIN;

DO $$
BEGIN
    -- PDM RWK
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_pdm_rwk'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_pdm_rwk INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_pdm_rwk agregada';
    END IF;

    -- Revisión de orden
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'tiempo_revision_orden'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_revision_orden INTERVAL DEFAULT '00:00:00'::INTERVAL;
        RAISE NOTICE 'Columna tiempo_revision_orden agregada';
    END IF;

END$$;

COMMIT;

-- Comentario: estas columnas corresponden a los botones con data-timer "pdm_rwk" y "revision_orden"
-- Asegúrate también de que el front-end/servidor escriba en estas columnas al finalizar la sesión.
