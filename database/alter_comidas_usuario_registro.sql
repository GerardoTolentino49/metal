-- Alternar tabla comidas para agregar columna usuario_registro
ALTER TABLE comidas ADD COLUMN usuario_registro VARCHAR(100);

-- Crear índice para optimizar búsquedas por usuario
CREATE INDEX IF NOT EXISTS idx_comidas_usuario_registro ON comidas(usuario_registro);
