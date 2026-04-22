-- Crear tabla de proyectos para PM
CREATE TABLE IF NOT EXISTS proyectos (
    id SERIAL PRIMARY KEY,
    client VARCHAR(255) NOT NULL,
    order_number VARCHAR(100) UNIQUE,
    customer_job VARCHAR(100),
    project_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'activo',
    time_worked BIGINT DEFAULT 0,
    price_usd DECIMAL(10, 2) DEFAULT 0.00,
    price_mxn DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_proyectos_client ON proyectos(client);
CREATE INDEX IF NOT EXISTS idx_proyectos_status ON proyectos(status);
CREATE INDEX IF NOT EXISTS idx_proyectos_created_at ON proyectos(created_at DESC);

-- Comentarios
COMMENT ON TABLE proyectos IS 'Tabla para gestionar proyectos del sistema PM';
COMMENT ON COLUMN proyectos.client IS 'Cliente del proyecto';
COMMENT ON COLUMN proyectos.order_number IS 'Número de orden (único)';
COMMENT ON COLUMN proyectos.customer_job IS 'Trabajo del cliente';
COMMENT ON COLUMN proyectos.project_name IS 'Nombre del proyecto';
COMMENT ON COLUMN proyectos.status IS 'Estado del proyecto (activo, completado, pendiente, etc.)';
COMMENT ON COLUMN proyectos.time_worked IS 'Tiempo trabajado en milisegundos';
COMMENT ON COLUMN proyectos.price_usd IS 'Precio en dólares estadounidenses';
COMMENT ON COLUMN proyectos.price_mxn IS 'Precio en pesos mexicanos';
