-- Crear tabla de mapeo código-categoría para llenado automático
-- PostgreSQL

CREATE TABLE IF NOT EXISTS codigo_categoria_mapping (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(100) NOT NULL UNIQUE,
    categoria VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar mapeos existentes basados en los datos actuales
INSERT INTO codigo_categoria_mapping (codigo, categoria, descripcion) VALUES
('pox', 'ABRASIVE', 'Producto abrasivo POX'),
('test', 'PRUEBA', 'Producto de prueba')
ON CONFLICT (codigo) DO NOTHING;

-- Crear índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_codigo_categoria_codigo ON codigo_categoria_mapping (codigo);
