-- Agrega columna para guardar BOM por número de parte (no por orden)
ALTER TABLE numero_parte
ADD COLUMN IF NOT EXISTS bom_excel VARCHAR(500);
