-- Agregar columna numero_parte a la tabla tiempo_diseno
-- Este script soluciona el error: "no existe la columna «numero_parte» en la relación «tiempo_diseno»"

-- Primero, verificar si la tabla existe
DO $$
BEGIN
    -- Crear la tabla si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'tiempo_diseno'
    ) THEN
        CREATE TABLE tiempo_diseno (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            numero_parte VARCHAR(200),
            orden VARCHAR(100),
            cliente VARCHAR(200),
            estado VARCHAR(50) DEFAULT 'Activo',
            estado_orden VARCHAR(50) DEFAULT 'En Proceso',
            hora_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            hora_fin TIMESTAMP,
            tiempo_total INTERVAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        RAISE NOTICE 'Tabla tiempo_diseno creada exitosamente';
    ELSE
        RAISE NOTICE 'Tabla tiempo_diseno ya existe';
    END IF;
END$$;

-- Agregar la columna numero_parte si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        AND column_name = 'numero_parte'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN numero_parte VARCHAR(200);
        RAISE NOTICE 'Columna numero_parte agregada a tiempo_diseno';
    ELSE
        RAISE NOTICE 'Columna numero_parte ya existe en tiempo_diseno';
    END IF;
END$$;

-- Agregar la columna orden si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        AND column_name = 'orden'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN orden VARCHAR(100);
        RAISE NOTICE 'Columna orden agregada a tiempo_diseno';
    ELSE
        RAISE NOTICE 'Columna orden ya existe en tiempo_diseno';
    END IF;
END$$;

-- Agregar la columna cliente si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        AND column_name = 'cliente'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN cliente VARCHAR(200);
        RAISE NOTICE 'Columna cliente agregada a tiempo_diseno';
    ELSE
        RAISE NOTICE 'Columna cliente ya existe en tiempo_diseno';
    END IF;
END$$;

-- Agregar la columna estado si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        AND column_name = 'estado'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN estado VARCHAR(50) DEFAULT 'Activo';
        RAISE NOTICE 'Columna estado agregada a tiempo_diseno';
    ELSE
        RAISE NOTICE 'Columna estado ya existe en tiempo_diseno';
    END IF;
END$$;

-- Agregar la columna estado_orden si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        AND column_name = 'estado_orden'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN estado_orden VARCHAR(50) DEFAULT 'En Proceso';
        RAISE NOTICE 'Columna estado_orden agregada a tiempo_diseno';
    ELSE
        RAISE NOTICE 'Columna estado_orden ya existe en tiempo_diseno';
    END IF;
END$$;

-- Agregar la columna hora_inicio si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        AND column_name = 'hora_inicio'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN hora_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        RAISE NOTICE 'Columna hora_inicio agregada a tiempo_diseno';
    ELSE
        RAISE NOTICE 'Columna hora_inicio ya existe en tiempo_diseno';
    END IF;
END$$;

-- Agregar la columna hora_fin si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        AND column_name = 'hora_fin'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN hora_fin TIMESTAMP;
        RAISE NOTICE 'Columna hora_fin agregada a tiempo_diseno';
    ELSE
        RAISE NOTICE 'Columna hora_fin ya existe en tiempo_diseno';
    END IF;
END$$;

-- Agregar la columna tiempo_total si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' 
        AND column_name = 'tiempo_total'
    ) THEN
        ALTER TABLE tiempo_diseno ADD COLUMN tiempo_total INTERVAL;
        RAISE NOTICE 'Columna tiempo_total agregada a tiempo_diseno';
    ELSE
        RAISE NOTICE 'Columna tiempo_total ya existe en tiempo_diseno';
    END IF;
END$$;

-- Verificar estructura final
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'tiempo_diseno'
ORDER BY ordinal_position;

-- Mensaje final
DO $$
BEGIN
    RAISE NOTICE '✅ Migración completada. Tabla tiempo_diseno verificada y actualizada.';
END$$;
