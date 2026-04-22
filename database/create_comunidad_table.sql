-- Crea la tabla comunidad para almacenar comentarios del menú contextual
CREATE TABLE IF NOT EXISTS comunidad (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(50),
  mensaje TEXT,
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
