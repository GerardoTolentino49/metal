-- Agregar columna tiempo_aprobado como TIMESTAMP en ordenes y submittals
ALTER TABLE ordenes
ADD COLUMN IF NOT EXISTS tiempo_aprobado TIMESTAMP;

ALTER TABLE submittals
ADD COLUMN IF NOT EXISTS tiempo_aprobado TIMESTAMP;

-- Normalizar tipo si existía con otro tipo de dato (ej. INTERVAL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ordenes'
      AND column_name = 'tiempo_aprobado'
      AND data_type <> 'timestamp without time zone'
  ) THEN
    ALTER TABLE ordenes
      ALTER COLUMN tiempo_aprobado DROP DEFAULT,
      ALTER COLUMN tiempo_aprobado TYPE TIMESTAMP
      USING CASE
        WHEN tiempo_aprobado IS NULL THEN NULL
        ELSE CURRENT_TIMESTAMP
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'submittals'
      AND column_name = 'tiempo_aprobado'
      AND data_type <> 'timestamp without time zone'
  ) THEN
    ALTER TABLE submittals
      ALTER COLUMN tiempo_aprobado DROP DEFAULT,
      ALTER COLUMN tiempo_aprobado TYPE TIMESTAMP
      USING CASE
        WHEN tiempo_aprobado IS NULL THEN NULL
        ELSE CURRENT_TIMESTAMP
      END;
  END IF;
END $$;
