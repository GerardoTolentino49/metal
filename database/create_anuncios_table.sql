-- Tabla para almacenar anuncios/banners del sistema
-- Se mostrará un anuncio al abrir el selector.html

CREATE TABLE IF NOT EXISTS anuncios (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255),
    imagen_url VARCHAR(500) NOT NULL,
    activo BOOLEAN DEFAULT true,
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_fin TIMESTAMP,
    creado_por VARCHAR(100),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    orden INTEGER DEFAULT 0
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_anuncios_activo ON anuncios(activo);
CREATE INDEX IF NOT EXISTS idx_anuncios_fecha_inicio ON anuncios(fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_anuncios_orden ON anuncios(orden);

-- Comentarios
COMMENT ON TABLE anuncios IS 'Almacena los anuncios que se muestran en el selector principal';
COMMENT ON COLUMN anuncios.titulo IS 'Título descriptivo del anuncio (opcional)';
COMMENT ON COLUMN anuncios.imagen_url IS 'URL o ruta de la imagen del anuncio (1080p, 16:9)';
COMMENT ON COLUMN anuncios.activo IS 'Indica si el anuncio está activo';
COMMENT ON COLUMN anuncios.fecha_inicio IS 'Fecha desde la cual el anuncio es válido';
COMMENT ON COLUMN anuncios.fecha_fin IS 'Fecha hasta la cual el anuncio es válido (null = sin límite)';
COMMENT ON COLUMN anuncios.orden IS 'Orden de prioridad (menor número = mayor prioridad)';
