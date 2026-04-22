-- Convierte hora_inicio/hora_fin de tiempo_diseno a TIMESTAMPTZ sin perder la hora local.
--
-- Contexto:
-- - La tabla fue creada originalmente con TIMESTAMP (sin zona horaria).
-- - Esto puede producir desfases al serializar fechas en backend/frontend.
--
-- Estrategia:
-- - Interpretar los valores actuales como hora local de la zona configurada.
-- - Convertirlos a TIMESTAMPTZ usando AT TIME ZONE.
--
-- Zona usada para la conversión:
-- - current_setting('TIMEZONE') de la conexión.
-- - Si no existe, fallback a 'America/Tijuana'.

DO $$
DECLARE
  tz_name text := COALESCE(NULLIF(current_setting('TIMEZONE', true), ''), 'America/Tijuana');
  hora_inicio_type text;
  hora_fin_type text;
BEGIN
  SELECT data_type
    INTO hora_inicio_type
    FROM information_schema.columns
   WHERE table_name = 'tiempo_diseno'
     AND column_name = 'hora_inicio'
   LIMIT 1;

  IF hora_inicio_type = 'timestamp without time zone' THEN
    EXECUTE format(
      'ALTER TABLE tiempo_diseno
         ALTER COLUMN hora_inicio TYPE TIMESTAMPTZ
         USING (CASE
                  WHEN hora_inicio IS NULL THEN NULL
                  ELSE hora_inicio AT TIME ZONE %L
                END)',
      tz_name
    );
    RAISE NOTICE 'hora_inicio convertido a TIMESTAMPTZ usando zona %', tz_name;
  ELSE
    RAISE NOTICE 'hora_inicio no requiere conversion (tipo actual: %)', COALESCE(hora_inicio_type, 'no existe');
  END IF;

  SELECT data_type
    INTO hora_fin_type
    FROM information_schema.columns
   WHERE table_name = 'tiempo_diseno'
     AND column_name = 'hora_fin'
   LIMIT 1;

  IF hora_fin_type = 'timestamp without time zone' THEN
    EXECUTE format(
      'ALTER TABLE tiempo_diseno
         ALTER COLUMN hora_fin TYPE TIMESTAMPTZ
         USING (CASE
                  WHEN hora_fin IS NULL THEN NULL
                  ELSE hora_fin AT TIME ZONE %L
                END)',
      tz_name
    );
    RAISE NOTICE 'hora_fin convertido a TIMESTAMPTZ usando zona %', tz_name;
  ELSE
    RAISE NOTICE 'hora_fin no requiere conversion (tipo actual: %)', COALESCE(hora_fin_type, 'no existe');
  END IF;
END $$;
