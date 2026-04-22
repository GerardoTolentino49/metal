-- Agregar columna menu_semana a la tabla anuncios
-- Esta columna permite marcar un anuncio como menú de la semana

ALTER TABLE anuncios 
ADD COLUMN menu_semana BOOLEAN DEFAULT FALSE;

-- Opcional: Crear índice para mejorar consultas de menús de la semana
CREATE INDEX idx_anuncios_menu_semana ON anuncios(menu_semana) WHERE menu_semana = TRUE;

-- Ejemplo de consulta para obtener anuncios marcados como menú de la semana:
-- SELECT * FROM anuncios WHERE menu_semana = TRUE AND activo = TRUE;
