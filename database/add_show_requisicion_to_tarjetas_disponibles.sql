-- Agrega permiso dedicado para controlar el boton de Requisicion de compra
ALTER TABLE tarjetas_disponibles
ADD COLUMN IF NOT EXISTS show_requisicion BOOLEAN DEFAULT FALSE;

UPDATE tarjetas_disponibles
SET show_requisicion = FALSE
WHERE show_requisicion IS NULL;
