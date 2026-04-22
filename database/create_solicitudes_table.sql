-- Crear la tabla de solicitudes
CREATE TABLE IF NOT EXISTS solicitudes (
    id SERIAL PRIMARY KEY,
    empleado_id INTEGER REFERENCES empleados(id),
    fecha_solicitud TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    motivo TEXT NOT NULL,
    aprobado_por INTEGER REFERENCES empleados(id),
    comentarios TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_solicitudes_empleado_id ON solicitudes(empleado_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_fecha ON solicitudes(fecha_solicitud);
CREATE INDEX IF NOT EXISTS idx_solicitudes_aprobado_por ON solicitudes(aprobado_por);

-- Insertar datos de ejemplo basados en la imagen proporcionada
INSERT INTO solicitudes (empleado_id, fecha_solicitud, motivo, aprobado_por, comentarios) VALUES
(1, '2025-08-04 11:29:17.395759', 'Test', NULL, NULL);

-- Crear trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_solicitudes_updated_at 
    BEFORE UPDATE ON solicitudes 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column(); 