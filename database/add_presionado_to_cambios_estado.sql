-- Agrega bandera de presionado para registrar press/release por estado
ALTER TABLE cambios_estado
ADD COLUMN IF NOT EXISTS presionado BOOLEAN NOT NULL DEFAULT FALSE;