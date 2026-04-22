-- Crear tabla it_boveda para almacenar archivos
CREATE TABLE IF NOT EXISTS it_boveda (
    id SERIAL PRIMARY KEY,
    fecha_subida TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    etiqueta TEXT,
    comentarios TEXT,
    en_uso BOOLEAN DEFAULT true,
    ruta CHARACTER VARYING(255)
);

-- Crear índice para mejorar el rendimiento de búsquedas
CREATE INDEX IF NOT EXISTS idx_it_boveda_fecha_subida ON it_boveda(fecha_subida);
CREATE INDEX IF NOT EXISTS idx_it_boveda_etiqueta ON it_boveda(etiqueta);
CREATE INDEX IF NOT EXISTS idx_it_boveda_en_uso ON it_boveda(en_uso); 