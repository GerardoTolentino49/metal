-- Crear tabla de submittals para el sistema de producción
CREATE TABLE IF NOT EXISTS submittals (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    submittal_number VARCHAR(100) NOT NULL UNIQUE,
    submittal_name VARCHAR(255) NOT NULL,
    client VARCHAR(255),
    customer_job VARCHAR(100),
    project_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'activo',
    estatus VARCHAR(50) DEFAULT 'pendiente',
    time_worked BIGINT DEFAULT 0,
    price_usd DECIMAL(10, 2) DEFAULT 0.00,
    price_mxn DECIMAL(10, 2) DEFAULT 0.00,
    usuario_asignado INTEGER[] DEFAULT '{}',
    fecha_inicio DATE,
    fecha_limite DATE,
    fecha_fin TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES proyectos(id) ON DELETE CASCADE
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_submittals_project_id ON submittals(project_id);
CREATE INDEX IF NOT EXISTS idx_submittals_submittal_number ON submittals(submittal_number);
CREATE INDEX IF NOT EXISTS idx_submittals_status ON submittals(status);
CREATE INDEX IF NOT EXISTS idx_submittals_estatus ON submittals(estatus);
CREATE INDEX IF NOT EXISTS idx_submittals_created_at ON submittals(created_at DESC);

-- Comentarios
COMMENT ON TABLE submittals IS 'Tabla para gestionar submittals vinculados a proyectos';
COMMENT ON COLUMN submittals.project_id IS 'ID del proyecto asociado (FK a proyectos)';
COMMENT ON COLUMN submittals.submittal_number IS 'Número único del submittal';
COMMENT ON COLUMN submittals.submittal_name IS 'Nombre del submittal';
COMMENT ON COLUMN submittals.client IS 'Cliente del submittal (copiado del proyecto)';
COMMENT ON COLUMN submittals.customer_job IS 'Trabajo del cliente (copiado del proyecto)';
COMMENT ON COLUMN submittals.project_name IS 'Nombre del proyecto (copiado del proyecto)';
COMMENT ON COLUMN submittals.status IS 'Estado del submittal (activo, completado, pendiente, cancelado)';
COMMENT ON COLUMN submittals.estatus IS 'Estatus del submittal (pendiente, aprobado)';
COMMENT ON COLUMN submittals.time_worked IS 'Tiempo trabajado en milisegundos';
COMMENT ON COLUMN submittals.price_usd IS 'Precio en dólares estadounidenses';
COMMENT ON COLUMN submittals.price_mxn IS 'Precio en pesos mexicanos';
COMMENT ON COLUMN submittals.usuario_asignado IS 'Array de IDs de usuarios asignados al submittal';
COMMENT ON COLUMN submittals.fecha_inicio IS 'Fecha de inicio del submittal';
COMMENT ON COLUMN submittals.fecha_limite IS 'Fecha límite del submittal';
COMMENT ON COLUMN submittals.fecha_fin IS 'Fecha de finalización del submittal';
COMMENT ON COLUMN submittals.created_at IS 'Fecha y hora de creación del submittal';
COMMENT ON COLUMN submittals.updated_at IS 'Fecha y hora de última actualización';
