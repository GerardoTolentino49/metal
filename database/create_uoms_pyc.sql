-- Create table for UOMs used by PYC
-- File: database/create_uoms_pyc.sql

CREATE TABLE IF NOT EXISTS UOMS_pyc (
    id SERIAL PRIMARY KEY,
    descripcion VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uoms_pyc_descripcion ON UOMS_pyc (lower(descripcion));
