-- Crear tabla calendario_mantenimiento si no existe
CREATE TABLE IF NOT EXISTS calendario_mantenimiento (
    id VARCHAR(50) PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    descripcion TEXT,
    fecha_evento DATE NOT NULL,
    hora_inicio TIME,
    hora_fin TIME,
    prioridad VARCHAR(20) DEFAULT 'normal',
    completado BOOLEAN DEFAULT FALSE,
    fecha_completado TIMESTAMP,
    fecha_aplazamiento DATE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_mantenimiento_fecha ON calendario_mantenimiento(fecha_evento);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_completado ON calendario_mantenimiento(completado);
