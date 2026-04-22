-- Crear tabla de órdenes para el sistema de producción
CREATE TABLE IF NOT EXISTS ordenes (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    order_number VARCHAR(100) NOT NULL UNIQUE,
    client VARCHAR(255),
    customer_job VARCHAR(100),
    project_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'activo',
    time_worked BIGINT DEFAULT 0,
    price_usd DECIMAL(10, 2) DEFAULT 0.00,
    price_mxn DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES proyectos(id) ON DELETE CASCADE
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_ordenes_project_id ON ordenes(project_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_order_number ON ordenes(order_number);
CREATE INDEX IF NOT EXISTS idx_ordenes_status ON ordenes(status);
CREATE INDEX IF NOT EXISTS idx_ordenes_created_at ON ordenes(created_at DESC);

-- Comentarios
COMMENT ON TABLE ordenes IS 'Tabla para gestionar órdenes de producción vinculadas a proyectos';
COMMENT ON COLUMN ordenes.project_id IS 'ID del proyecto asociado (FK a proyectos)';
COMMENT ON COLUMN ordenes.order_number IS 'Número único de la orden de producción';
COMMENT ON COLUMN ordenes.client IS 'Cliente de la orden (copiado del proyecto)';
COMMENT ON COLUMN ordenes.customer_job IS 'Trabajo del cliente (copiado del proyecto)';
COMMENT ON COLUMN ordenes.project_name IS 'Nombre del proyecto (copiado del proyecto)';
COMMENT ON COLUMN ordenes.status IS 'Estado de la orden (activo, completado, pendiente, cancelado)';
COMMENT ON COLUMN ordenes.time_worked IS 'Tiempo trabajado en milisegundos';
COMMENT ON COLUMN ordenes.price_usd IS 'Precio en dólares estadounidenses';
COMMENT ON COLUMN ordenes.price_mxn IS 'Precio en pesos mexicanos';
COMMENT ON COLUMN ordenes.created_at IS 'Fecha y hora de creación de la orden';
COMMENT ON COLUMN ordenes.updated_at IS 'Fecha y hora de última actualización';
