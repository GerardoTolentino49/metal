\c apoyos_db;

-- Crear la tabla de apoyos
CREATE TABLE IF NOT EXISTS apoyos (
    id SERIAL PRIMARY KEY,
    empleado_id VARCHAR(50) NOT NULL,
    nombre_completo VARCHAR(255) NOT NULL,
    supervisor VARCHAR(255),
    puesto VARCHAR(255),
    folio VARCHAR(50),
    vale_status VARCHAR(50) DEFAULT 'pendiente',
    descripcion TEXT,
    material_status VARCHAR(50),
    material_out_date DATE,
    material_return_date DATE,
    tool_loan TEXT,
    notas TEXT,
    ultima_modificacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    modificado_por VARCHAR(255),
    tipo VARCHAR(50) NOT NULL,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    evidencia1 VARCHAR(255),
    evidencia2 VARCHAR(255),
    evidencia3 VARCHAR(255)
);

-- Agregar columnas faltantes a la tabla de apoyos
ALTER TABLE apoyos 
ADD COLUMN IF NOT EXISTS nombre_completo VARCHAR(255),
ADD COLUMN IF NOT EXISTS supervisor VARCHAR(255),
ADD COLUMN IF NOT EXISTS puesto VARCHAR(255),
ADD COLUMN IF NOT EXISTS vale_status VARCHAR(50) DEFAULT 'pendiente',
ADD COLUMN IF NOT EXISTS tool_loan TEXT,
ADD COLUMN IF NOT EXISTS tipo VARCHAR(50),
ADD COLUMN IF NOT EXISTS fecha TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS estado VARCHAR(50) DEFAULT 'pendiente',
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS evidencia1 VARCHAR(255),
ADD COLUMN IF NOT EXISTS evidencia2 VARCHAR(255),
ADD COLUMN IF NOT EXISTS evidencia3 VARCHAR(255);

-- Crear índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_apoyos_empleado_id ON apoyos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_apoyos_estado ON apoyos(estado);
CREATE INDEX IF NOT EXISTS idx_apoyos_fecha ON apoyos(fecha);
CREATE INDEX IF NOT EXISTS idx_apoyos_tipo ON apoyos(tipo);

-- Crear tabla para las imágenes de los apoyos
CREATE TABLE IF NOT EXISTS apoyo_images (
    id SERIAL PRIMARY KEY,
    apoyo_id INTEGER REFERENCES apoyos(id) ON DELETE CASCADE,
    image_path VARCHAR(255) NOT NULL,
    image_name VARCHAR(255) NOT NULL,
    image_type VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla para los mensajes de los apoyos
CREATE TABLE IF NOT EXISTS apoyo_messages (
    id SERIAL PRIMARY KEY,
    apoyo_id INTEGER REFERENCES apoyos(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    sender VARCHAR(255) NOT NULL,
    is_staff BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
); 