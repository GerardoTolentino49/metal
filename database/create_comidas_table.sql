-- Crear tabla comidas
CREATE TABLE IF NOT EXISTS comidas (
    id SERIAL PRIMARY KEY,
    empleado_id INTEGER NOT NULL,
    cantidad INTEGER NOT NULL,
    fecha DATE NOT NULL,
    observaciones TEXT,
    usuario_registro VARCHAR(100),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_comidas_empleado_id ON comidas(empleado_id);
CREATE INDEX IF NOT EXISTS idx_comidas_fecha ON comidas(fecha);
CREATE INDEX IF NOT EXISTS idx_comidas_empleado_fecha ON comidas(empleado_id, fecha);
CREATE INDEX IF NOT EXISTS idx_comidas_usuario_registro ON comidas(usuario_registro);
