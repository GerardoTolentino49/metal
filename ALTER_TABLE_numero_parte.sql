-- Query para agregar la columna orden_id a la tabla numero_parte
-- Esta columna almacenará el ID de la orden en la que está logeado el usuario

ALTER TABLE numero_parte 
ADD COLUMN orden_id INTEGER;

-- Opcional: Agregar comentario a la columna
COMMENT ON COLUMN numero_parte.orden_id IS 'ID de la orden en la que está logeado el usuario cuando se crea el número de parte';

-- Opcional: Agregar foreign key si existe la tabla ordenes
-- ALTER TABLE numero_parte 
-- ADD CONSTRAINT fk_numero_parte_orden 
-- FOREIGN KEY (orden_id) REFERENCES ordenes(id);
