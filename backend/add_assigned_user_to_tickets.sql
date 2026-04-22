-- Agregar columna para usuario asignado a la tabla tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER, ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

-- Crear índice para optimizar búsquedas por usuario asignado
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_user ON tickets(assigned_user_id);
