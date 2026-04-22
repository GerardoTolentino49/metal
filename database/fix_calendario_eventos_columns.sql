-- Agregar columnas faltantes a la tabla calendario_eventos
ALTER TABLE calendario_eventos
ADD COLUMN IF NOT EXISTS fecha_evento DATE,
ADD COLUMN IF NOT EXISTS hora_inicio TIME,
ADD COLUMN IF NOT EXISTS hora_fin TIME,
ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) DEFAULT 'normal',
ADD COLUMN IF NOT EXISTS completado BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS fecha_completado TIMESTAMP,
ADD COLUMN IF NOT EXISTS fecha_aplazamiento DATE,
ADD COLUMN IF NOT EXISTS usuario_creador VARCHAR(255),
ADD COLUMN IF NOT EXISTS departamento VARCHAR(255),
ADD COLUMN IF NOT EXISTS color_evento VARCHAR(7) DEFAULT '#ffc107';

-- Copiar datos de fecha a fecha_evento si es necesario
UPDATE calendario_eventos 
SET fecha_evento = fecha 
WHERE fecha_evento IS NULL AND fecha IS NOT NULL;

-- Crear índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_calendario_eventos_fecha_evento ON calendario_eventos(fecha_evento);
CREATE INDEX IF NOT EXISTS idx_calendario_eventos_completado ON calendario_eventos(completado);
