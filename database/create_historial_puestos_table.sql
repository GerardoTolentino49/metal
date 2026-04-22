-- Tabla para historial de puestos del empleado
CREATE TABLE IF NOT EXISTS historial_puestos (
    id SERIAL PRIMARY KEY,
    empleado_id INTEGER NOT NULL,
    puesto_anterior VARCHAR(255) NOT NULL,
    puesto_nuevo VARCHAR(255) NOT NULL,
    fecha_cambio DATE NOT NULL,
    motivo_cambio TEXT,
    notas TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
);

-- Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_historial_puestos_empleado_id ON historial_puestos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_historial_puestos_fecha ON historial_puestos(fecha_cambio);

