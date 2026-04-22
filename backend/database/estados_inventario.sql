-- Crear tabla de estados de inventario
CREATE TABLE IF NOT EXISTS estados_inventario (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion TEXT,
    color VARCHAR(7) DEFAULT '#000000',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar estados por defecto
INSERT INTO estados_inventario (nombre, descripcion, color) VALUES
    ('En Stock', 'El producto está disponible en inventario', '#4CAF50'),
    ('Agotado', 'No hay unidades disponibles', '#f44336'),
    ('Pedido Realizado', 'Se ha realizado un pedido de reposición', '#2196F3'),
    ('En Tránsito', 'El producto está en camino', '#FF9800'),
    ('Reservado', 'El producto está reservado para un cliente', '#9C27B0')
ON CONFLICT (nombre) DO NOTHING;

-- Agregar columna de estado a la tabla de inventario
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS estado_id INTEGER REFERENCES estados_inventario(id);

-- Crear trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_estados_inventario_updated_at
    BEFORE UPDATE ON estados_inventario
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 