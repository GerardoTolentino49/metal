-- Convierte usuarios.inicio_sesion de TIMESTAMP (sin zona) a TIMESTAMPTZ.
--
-- Motivo:
-- - Evitar desfases por zona horaria al registrar inicio_sesion.
-- - Mantener consistencia con NOW() y con el timezone aplicado en la conexión.
--
-- Estrategia:
-- - Si la columna es timestamp without time zone, interpretar su valor como hora local
--   de la zona configurada y convertirla a timestamptz.
-- - Si ya es timestamptz, no hace cambios.

DO $$
DECLARE
  tz_name text := COALESCE(NULLIF(current_setting('TIMEZONE', true), ''), 'America/Tijuana');
  inicio_sesion_type text;
BEGIN
  SELECT data_type
    INTO inicio_sesion_type
    FROM information_schema.columns
   WHERE table_name = 'usuarios'
     AND column_name = 'inicio_sesion'
   LIMIT 1;

  IF inicio_sesion_type = 'timestamp without time zone' THEN
    EXECUTE format(
      'ALTER TABLE usuarios
         ALTER COLUMN inicio_sesion TYPE TIMESTAMPTZ
         USING (CASE
                  WHEN inicio_sesion IS NULL THEN NULL
                  ELSE inicio_sesion AT TIME ZONE %L
                END)',
      tz_name
    );
    RAISE NOTICE 'usuarios.inicio_sesion convertido a TIMESTAMPTZ usando zona %', tz_name;
  ELSE
    RAISE NOTICE 'usuarios.inicio_sesion no requiere conversion (tipo actual: %)', COALESCE(inicio_sesion_type, 'no existe');
  END IF;
END $$;
