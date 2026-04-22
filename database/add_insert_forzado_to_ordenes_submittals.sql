-- Marca ordenes/submittals creados por insercion forzada.
-- Compatible con PostgreSQL.

ALTER TABLE IF EXISTS ordenes
  ADD COLUMN IF NOT EXISTS insert_forzado BOOLEAN DEFAULT FALSE;

ALTER TABLE IF EXISTS submittals
  ADD COLUMN IF NOT EXISTS insert_forzado BOOLEAN DEFAULT FALSE;
