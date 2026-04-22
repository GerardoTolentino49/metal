-- Tabla principal de inventario
CREATE TABLE IF NOT EXISTS inventario (
    id SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(100) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    pedido_abierto BOOLEAN NOT NULL DEFAULT FALSE,
    piezas_pedidas INTEGER DEFAULT 0,
    estado_id INTEGER REFERENCES estados_inventario(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger para actualizar updated_at
CREATE TRIGGER update_inventario_updated_at
    BEFORE UPDATE ON inventario
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insertar datos de ejemplo
INSERT INTO inventario (nombre_completo, stock, pedido_abierto, piezas_pedidas, estado_id, activo)
VALUES
('palo', 10, FALSE, 0, 1, TRUE),
('palo', 0, TRUE, 20, 2, TRUE),
('palo', 5, FALSE, 0, 3, TRUE),
('palo', 0, TRUE, 15, 4, TRUE),
('palo', 2, FALSE, 0, 5, FALSE)
ON CONFLICT DO NOTHING; 