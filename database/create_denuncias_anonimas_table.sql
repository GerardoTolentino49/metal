-- Crear tabla para denuncias anónimas
-- Esta tabla almacena las denuncias enviadas de forma anónima por los usuarios

CREATE TABLE IF NOT EXISTS denuncias_anonimas (
    id character varying(255) NOT NULL,
    issue text,
    image_name character varying(255),
    image_type character varying(50),
    "timestamp" timestamp without time zone,
    image_path character varying(255),
    time_end timestamp without time zone,
    assigned_user_id integer[]
);

-- Agregar comentarios a la tabla y columnas
COMMENT ON TABLE denuncias_anonimas IS 'Tabla para almacenar denuncias anónimas de usuarios';
COMMENT ON COLUMN denuncias_anonimas.id IS 'Identificador único de la denuncia';
COMMENT ON COLUMN denuncias_anonimas.issue IS 'Descripción o contenido de la denuncia';
COMMENT ON COLUMN denuncias_anonimas.image_name IS 'Nombre del archivo de imagen adjunto';
COMMENT ON COLUMN denuncias_anonimas.image_type IS 'Tipo MIME de la imagen';
COMMENT ON COLUMN denuncias_anonimas.timestamp IS 'Fecha y hora de creación de la denuncia';
COMMENT ON COLUMN denuncias_anonimas.image_path IS 'Ruta del archivo de imagen en el servidor';
COMMENT ON COLUMN denuncias_anonimas.time_end IS 'Fecha y hora de resolución de la denuncia';
COMMENT ON COLUMN denuncias_anonimas.assigned_user_id IS 'Array de IDs de usuarios asignados para resolver la denuncia';

-- Crear índice en el timestamp para consultas ordenadas
CREATE INDEX IF NOT EXISTS idx_denuncias_anonimas_timestamp ON denuncias_anonimas(timestamp DESC);

-- Crear índice en el ID para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_denuncias_anonimas_id ON denuncias_anonimas(id);

-- Agregar restricciones
ALTER TABLE denuncias_anonimas ADD CONSTRAINT pk_denuncias_anonimas PRIMARY KEY (id);
ALTER TABLE denuncias_anonimas ALTER COLUMN timestamp SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE denuncias_anonimas ALTER COLUMN assigned_user_id SET DEFAULT '{}';

-- Insertar datos de ejemplo (opcional)
-- INSERT INTO denuncias_anonimas (id, issue, timestamp) VALUES 
-- ('DEN_1747727451822_abc123', 'Ejemplo de denuncia anónima', CURRENT_TIMESTAMP);
