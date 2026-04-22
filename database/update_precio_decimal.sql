-- Cambiar la columna precio_mxn de integer a numeric para soportar decimales
ALTER TABLE inventario 
ALTER COLUMN precio_mxn TYPE NUMERIC(10,2);

-- Comentario explicativo
COMMENT ON COLUMN inventario.precio_mxn IS 'Precio en pesos mexicanos con soporte para decimales (máximo 10 dígitos, 2 decimales)';
