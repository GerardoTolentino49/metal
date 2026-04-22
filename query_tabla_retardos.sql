-- Query para crear la tabla de permisos en PostgreSQL
-- Esta tabla almacena las solicitudes de permisos de diferentes tipos

CREATE TABLE IF NOT EXISTS permisos (
    id SERIAL PRIMARY KEY,
    empleado_id INTEGER NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    tiempo_llegada TIME,
    tiempo_salida TIME,
    motivo TEXT NOT NULL,
    notas TEXT,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
    aprobado_por VARCHAR(100),
    fecha_aprobacion TIMESTAMP,
    CONSTRAINT fk_empleado_permisos FOREIGN KEY (empleado_id) REFERENCES empleados(id)
);

-- Migración: eliminar constraints CHECK antiguos en la columna "tipo"
-- Buscar y eliminar todos los constraints CHECK relacionados con "tipo"
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'permisos' 
        AND constraint_type = 'CHECK'
        AND constraint_name LIKE '%tipo%'
    ) LOOP
        EXECUTE 'ALTER TABLE permisos DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

-- Migración: actualizar tamaño de columna "tipo" si es muy pequeña
ALTER TABLE permisos ALTER COLUMN tipo TYPE VARCHAR(50);

-- Migración: eliminar columna "fecha" antigua si existe
ALTER TABLE permisos DROP COLUMN IF EXISTS fecha;

-- Agregar columnas si no existen (para migración)
ALTER TABLE permisos 
ADD COLUMN IF NOT EXISTS fecha_inicio DATE,
ADD COLUMN IF NOT EXISTS fecha_fin DATE,
ADD COLUMN IF NOT EXISTS tiempo_salida TIME,
ADD COLUMN IF NOT EXISTS notas TEXT;

-- Establecer NOT NULL en las nuevas columnas de fecha (si no hay datos)
-- Nota: Si la tabla ya tiene datos, primero debes actualizar los registros existentes
-- UPDATE permisos SET fecha_inicio = fecha, fecha_fin = fecha WHERE fecha_inicio IS NULL;
-- Luego ejecuta:
-- ALTER TABLE permisos ALTER COLUMN fecha_inicio SET NOT NULL;
-- ALTER TABLE permisos ALTER COLUMN fecha_fin SET NOT NULL;

-- Crear índices para mejorar el rendimiento de las consultas
CREATE INDEX IF NOT EXISTS idx_permisos_empleado_id ON permisos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_permisos_fecha_inicio ON permisos(fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_permisos_fecha_fin ON permisos(fecha_fin);
CREATE INDEX IF NOT EXISTS idx_permisos_tipo ON permisos(tipo);
CREATE INDEX IF NOT EXISTS idx_permisos_estado ON permisos(estado);
CREATE INDEX IF NOT EXISTS idx_permisos_fecha_registro ON permisos(fecha_registro);

-- Comentarios en las columnas para documentación
COMMENT ON TABLE permisos IS 'Tabla para almacenar solicitudes de permisos de diferentes tipos';
COMMENT ON COLUMN permisos.empleado_id IS 'ID del empleado que solicita el permiso';
COMMENT ON COLUMN permisos.tipo IS 'Tipo de permiso: dia_completo, retardo, paternidad, home_office, defuncion_familiar, falta_injustificada, capacitacion, festivo, usa, llegar_tarde_salida_normal, salir_temprano, salir_regresar';
COMMENT ON COLUMN permisos.fecha_inicio IS 'Fecha de inicio del permiso';
COMMENT ON COLUMN permisos.fecha_fin IS 'Fecha de fin del permiso';
COMMENT ON COLUMN permisos.tiempo_llegada IS 'Hora de llegada (para tipos: retardo, llegar_tarde_salida_normal, salir_regresar)';
COMMENT ON COLUMN permisos.tiempo_salida IS 'Hora de salida (para tipos: salir_temprano, salir_regresar)';
COMMENT ON COLUMN permisos.motivo IS 'Motivo o razón del permiso';
COMMENT ON COLUMN permisos.notas IS 'Notas adicionales sobre el permiso';
COMMENT ON COLUMN permisos.estado IS 'Estado de la solicitud: pendiente, aprobado o rechazado';
COMMENT ON COLUMN permisos.aprobado_por IS 'Usuario que aprobó o rechazó la solicitud';
COMMENT ON COLUMN permisos.fecha_aprobacion IS 'Fecha y hora de aprobación o rechazo';

