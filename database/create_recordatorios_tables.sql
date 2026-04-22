-- ==================== TABLAS PARA RECORDATORIOS/PRESENTACIONES ====================

-- Tabla para almacenar presentaciones PowerPoint
CREATE TABLE IF NOT EXISTS recordatorios_presentaciones (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size BIGINT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  uploaded_by VARCHAR(100),
  activar_automatico BOOLEAN DEFAULT false,
  hora_inicio TIME,
  hora_fin TIME
);

-- Tabla para almacenar configuración de control remoto
CREATE TABLE IF NOT EXISTS recordatorios_control (
  id SERIAL PRIMARY KEY,
  presentation_id INTEGER REFERENCES recordatorios_presentaciones(id) ON DELETE CASCADE,
  show_hora BOOLEAN DEFAULT true,
  formato_hora VARCHAR(10) DEFAULT '24',
  posicion_hora VARCHAR(20) DEFAULT 'top-right',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(presentation_id)
);

-- Crear índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_recordatorios_uploaded_at ON recordatorios_presentaciones(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_recordatorios_control_presentation ON recordatorios_control(presentation_id);

-- Comentarios en las tablas
COMMENT ON TABLE recordatorios_presentaciones IS 'Almacena las presentaciones PowerPoint subidas para recordatorios';
COMMENT ON TABLE recordatorios_control IS 'Almacena la configuración de control remoto para cada presentación';

COMMENT ON COLUMN recordatorios_presentaciones.name IS 'Nombre original del archivo PowerPoint';
COMMENT ON COLUMN recordatorios_presentaciones.file_path IS 'Ruta relativa del archivo en el servidor';
COMMENT ON COLUMN recordatorios_presentaciones.file_size IS 'Tamaño del archivo en bytes';
COMMENT ON COLUMN recordatorios_presentaciones.uploaded_at IS 'Fecha y hora de subida';
COMMENT ON COLUMN recordatorios_presentaciones.uploaded_by IS 'Usuario que subió la presentación';
COMMENT ON COLUMN recordatorios_presentaciones.activar_automatico IS 'Indica si la programación automática está activada';
COMMENT ON COLUMN recordatorios_presentaciones.hora_inicio IS 'Hora de inicio para programación automática (formato TIME)';
COMMENT ON COLUMN recordatorios_presentaciones.hora_fin IS 'Hora de fin para programación automática (formato TIME)';

COMMENT ON COLUMN recordatorios_control.presentation_id IS 'ID de la presentación asociada';
COMMENT ON COLUMN recordatorios_control.show_hora IS 'Indica si se debe mostrar la hora en pantalla';
COMMENT ON COLUMN recordatorios_control.formato_hora IS 'Formato de hora: 12 o 24 horas';
COMMENT ON COLUMN recordatorios_control.posicion_hora IS 'Posición de la hora: top-left, top-right, bottom-left, bottom-right';
COMMENT ON COLUMN recordatorios_control.updated_at IS 'Fecha y hora de última actualización de la configuración';

