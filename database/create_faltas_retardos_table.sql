-- Crear tabla para faltas y retardos
-- Esta tabla almacena los registros de faltas y retardos de los empleados

CREATE TABLE IF NOT EXISTS faltas_retardos (
    id SERIAL PRIMARY KEY,
    empleado_id INTEGER NOT NULL,
    tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('falta', 'retardo', 'tiempo_extra', 'incidente', 'accidente', 'retardo, tiempo_extra')),
    fecha DATE NOT NULL,
    hora TIME,
    motivo TEXT,
    incidentes TEXT,
    accidentes TEXT,
    justificacion VARCHAR(10) NOT NULL CHECK (justificacion IN ('si', 'no')),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    registrado_por VARCHAR(100),
    CONSTRAINT fk_empleado_faltas FOREIGN KEY (empleado_id) REFERENCES empleados(id)
);

-- Crear índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_faltas_retardos_empleado_id ON faltas_retardos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_faltas_retardos_fecha ON faltas_retardos(fecha);
CREATE INDEX IF NOT EXISTS idx_faltas_retardos_tipo ON faltas_retardos(tipo);
CREATE INDEX IF NOT EXISTS idx_faltas_retardos_fecha_registro ON faltas_retardos(fecha_registro);

-- Agregar comentarios a la tabla y columnas
COMMENT ON TABLE faltas_retardos IS 'Tabla para almacenar registros de faltas y retardos de empleados';
COMMENT ON COLUMN faltas_retardos.id IS 'Identificador único del registro';
COMMENT ON COLUMN faltas_retardos.empleado_id IS 'ID del empleado que registra la falta o retardo';
COMMENT ON COLUMN faltas_retardos.tipo IS 'Tipo de incidencia: falta, retardo, tiempo_extra, incidente, accidente, o retardo, tiempo_extra';
COMMENT ON COLUMN faltas_retardos.fecha IS 'Fecha de la falta o retardo';
COMMENT ON COLUMN faltas_retardos.hora IS 'Hora de llegada (solo para retardos)';
COMMENT ON COLUMN faltas_retardos.motivo IS 'Descripción del motivo de la falta o retardo';
COMMENT ON COLUMN faltas_retardos.incidentes IS 'Detalle de incidentes relacionados con el registro';
COMMENT ON COLUMN faltas_retardos.accidentes IS 'Detalle de accidentes relacionados con el registro';
COMMENT ON COLUMN faltas_retardos.justificacion IS 'Indica si la falta o retardo tiene justificación';
COMMENT ON COLUMN faltas_retardos.fecha_registro IS 'Fecha y hora de registro del sistema';
COMMENT ON COLUMN faltas_retardos.registrado_por IS 'Usuario que registró la falta o retardo';
