-- Tabla para el sistema de gestión de tareas - PostgreSQL
CREATE TABLE IF NOT EXISTS tareas (
    id VARCHAR(100) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(20) CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
    status VARCHAR(20) CHECK (status IN ('pending', 'progress', 'completed')) DEFAULT 'pending',
    dueDate DATE,
    images TEXT, -- JSON array de URLs de imágenes
    owner VARCHAR(100) NOT NULL,
    sharedWith TEXT, -- JSON array de usuarios con quienes se comparte
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_tareas_owner ON tareas(owner);
CREATE INDEX IF NOT EXISTS idx_tareas_status ON tareas(status);
CREATE INDEX IF NOT EXISTS idx_tareas_priority ON tareas(priority);
CREATE INDEX IF NOT EXISTS idx_tareas_created ON tareas(createdAt);
CREATE INDEX IF NOT EXISTS idx_tareas_due_date ON tareas(dueDate);

-- Función para actualizar updatedAt automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updatedAt = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar updatedAt
DROP TRIGGER IF EXISTS update_tareas_updated_at ON tareas;
CREATE TRIGGER update_tareas_updated_at
    BEFORE UPDATE ON tareas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Tabla para comentarios de tareas
CREATE TABLE IF NOT EXISTS tareas_comentarios (
    id SERIAL PRIMARY KEY,
    tarea_id VARCHAR(100) NOT NULL,
    usuario VARCHAR(100) NOT NULL,
    comentario TEXT NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tarea_id) REFERENCES tareas(id) ON DELETE CASCADE
);

-- Índices para comentarios
CREATE INDEX IF NOT EXISTS idx_tareas_comentarios_tarea ON tareas_comentarios(tarea_id);
CREATE INDEX IF NOT EXISTS idx_tareas_comentarios_usuario ON tareas_comentarios(usuario);
CREATE INDEX IF NOT EXISTS idx_tareas_comentarios_created ON tareas_comentarios(createdAt);

-- Tabla para compartir tareas (normalizada)
CREATE TABLE IF NOT EXISTS tareas_compartidas (
    id SERIAL PRIMARY KEY,
    tarea_id VARCHAR(100) NOT NULL,
    usuario VARCHAR(100) NOT NULL,
    compartido_por VARCHAR(100) NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tarea_id) REFERENCES tareas(id) ON DELETE CASCADE,
    UNIQUE (tarea_id, usuario)
);

-- Índices para tareas compartidas
CREATE INDEX IF NOT EXISTS idx_tareas_compartidas_tarea ON tareas_compartidas(tarea_id);
CREATE INDEX IF NOT EXISTS idx_tareas_compartidas_usuario ON tareas_compartidas(usuario);
CREATE INDEX IF NOT EXISTS idx_tareas_compartidas_compartido_por ON tareas_compartidas(compartido_por);
