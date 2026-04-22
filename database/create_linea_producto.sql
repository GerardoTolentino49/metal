-- Create table for product lines
-- File: database/create_linea_producto.sql

CREATE TABLE IF NOT EXISTS linea_producto (
    id SERIAL PRIMARY KEY,
    descripcion VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index to speed lookups and enforce case-insensitive uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_linea_producto_descripcion ON linea_producto (lower(descripcion));

-- Optional: trigger to update "updated_at" can be added later if desired
