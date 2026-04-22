-- Agregar columna fecha_aprobacion a la tabla ordenes
ALTER TABLE ordenes 
ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMP;

-- Agregar columna fecha_aprobacion a la tabla submittals
ALTER TABLE submittals 
ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMP;

-- Crear índices para mejorar las consultas de aprobados vencidos
CREATE INDEX IF NOT EXISTS idx_ordenes_fecha_aprobacion ON ordenes(fecha_aprobacion) WHERE estatus = 'aprobado';
CREATE INDEX IF NOT EXISTS idx_submittals_fecha_aprobacion ON submittals(fecha_aprobacion) WHERE estatus = 'aprobado';
