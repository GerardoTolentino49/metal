-- Tabla para tareas personales
CREATE TABLE IF NOT EXISTS tareas_personales (
  id VARCHAR(50) PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  descripcion TEXT,
  prioridad VARCHAR(20) DEFAULT 'medium' CHECK (prioridad IN ('low', 'medium', 'high')),
  estado VARCHAR(20) DEFAULT 'todo' CHECK (estado IN ('todo', 'in-progress', 'done')),
  creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  posicion INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usuario_id ON tareas_personales(usuario_id);
CREATE INDEX IF NOT EXISTS idx_estado ON tareas_personales(estado);
CREATE INDEX IF NOT EXISTS idx_creada_en ON tareas_personales(creada_en);

-- Tabla para comentarios en tareas personales
CREATE TABLE IF NOT EXISTS comentarios_tareas (
  id VARCHAR(50) PRIMARY KEY,
  tarea_id VARCHAR(50) NOT NULL,
  usuario_id INTEGER NOT NULL,
  contenido TEXT NOT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tarea_id_comentarios ON comentarios_tareas(tarea_id);
CREATE INDEX IF NOT EXISTS idx_usuario_id_comentarios ON comentarios_tareas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_creado_en ON comentarios_tareas(creado_en);

-- Tabla para usuarios con los que se comparten tareas
DROP TABLE IF EXISTS tareas_compartidas CASCADE;

CREATE TABLE tareas_compartidas (
  id SERIAL PRIMARY KEY,
  tarea_id VARCHAR(50) NOT NULL,
  usuario_propietario_id INTEGER NOT NULL,
  usuario_compartido_id INTEGER NOT NULL,
  compartida_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tarea_id, usuario_compartido_id)
);

CREATE INDEX idx_tarea_id ON tareas_compartidas(tarea_id);
CREATE INDEX idx_usuario_propietario ON tareas_compartidas(usuario_propietario_id);
CREATE INDEX idx_usuario_compartido ON tareas_compartidas(usuario_compartido_id);

-- Crear trigger para actualizar actualizada_en
CREATE OR REPLACE FUNCTION actualizar_tarea_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizada_en = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER actualizar_tarea_timestamp
BEFORE UPDATE ON tareas_personales
FOR EACH ROW
EXECUTE FUNCTION actualizar_tarea_timestamp();
