-- Eliminar tablas existentes si existen
DROP TABLE IF EXISTS calendario_eventos_compartidos CASCADE;
DROP TABLE IF EXISTS calendario_eventos CASCADE;

-- Tabla para eventos del calendario organizador
CREATE TABLE calendario_eventos (
    id VARCHAR(50) PRIMARY KEY,
    titulo VARCHAR(255),
    descripcion TEXT,
    fecha DATE,
    mes VARCHAR(7),
    completado BOOLEAN DEFAULT FALSE,
    usuario_creador_id INT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE INDEX idx_fecha ON calendario_eventos(fecha);
CREATE INDEX idx_mes ON calendario_eventos(mes);
CREATE INDEX idx_usuario ON calendario_eventos(usuario_creador_id);

-- Trigger para actualizar automáticamente actualizado_en
CREATE OR REPLACE FUNCTION actualizar_fecha_modificacion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_actualizar_calendario_eventos
BEFORE UPDATE ON calendario_eventos
FOR EACH ROW
EXECUTE FUNCTION actualizar_fecha_modificacion();

-- Tabla para compartir eventos con usuarios (relación muchos a muchos)
CREATE TABLE calendario_eventos_compartidos (
    id SERIAL PRIMARY KEY,
    evento_id VARCHAR(50) NOT NULL,
    usuario_id INT NOT NULL,
    compartido_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evento_id) REFERENCES calendario_eventos(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    UNIQUE (evento_id, usuario_id)
);

CREATE INDEX idx_evento ON calendario_eventos_compartidos(evento_id);
CREATE INDEX idx_usuario_compartido ON calendario_eventos_compartidos(usuario_id);
