-- Permitir valores nulos en la columna id_herramienta de tickets_mantenimiento
ALTER TABLE tickets_mantenimiento ALTER COLUMN id_herramienta DROP NOT NULL; 