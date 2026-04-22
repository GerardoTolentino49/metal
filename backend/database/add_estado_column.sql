-- Script para agregar campo estado a la tabla inventario
-- Ejecutar en la base de datos apoyos_db

-- Agregar columna estado si no existe
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS estado VARCHAR(50) DEFAULT 'Sin estado';

-- Actualizar registros existentes con un estado por defecto
UPDATE inventario SET estado = 'Sin estado' WHERE estado IS NULL;

-- Crear un índice para mejorar el rendimiento de consultas por estado
CREATE INDEX IF NOT EXISTS idx_inventario_estado ON inventario(estado);

-- Agregar constraint para validar valores válidos del estado
ALTER TABLE inventario ADD CONSTRAINT IF NOT EXISTS chk_estado_valido 
CHECK (estado IN ('En Stock', 'Agotado', 'Pedido Realizado', 'En Tránsito', 'Reservado', 'Sin estado'));

-- Comentario en la columna
COMMENT ON COLUMN inventario.estado IS 'Estado actual del producto en inventario';
