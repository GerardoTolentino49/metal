-- Crear la tabla de usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(100) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultimo_acceso TIMESTAMP,
    activo BOOLEAN DEFAULT true
);

-- Crear la tabla de sitios
CREATE TABLE IF NOT EXISTS sitios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    url VARCHAR(255),
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear la tabla de credenciales de usuarios
CREATE TABLE IF NOT EXISTS credenciales_usuarios (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    sitio_id INTEGER REFERENCES sitios(id) ON DELETE CASCADE,
    username VARCHAR(100),
    password VARCHAR(255) NOT NULL,
    notas TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultimo_cambio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT true,
    UNIQUE(usuario_id, sitio_id)
);

-- Crear índices para optimizar búsquedas
CREATE INDEX idx_credenciales_usuario ON credenciales_usuarios(usuario_id);
CREATE INDEX idx_credenciales_sitio ON credenciales_usuarios(sitio_id);

-- Insertar algunos sitios comunes
INSERT INTO sitios (nombre, descripcion, url) VALUES
    ('Office 365', 'Microsoft Office 365', 'https://office.com'),
    ('Windows', 'Sistema Operativo Windows', NULL),
    ('Dropbox', 'Servicio de almacenamiento en la nube', 'https://dropbox.com'),
    ('Gmail', 'Correo electrónico de Google', 'https://gmail.com'),
    ('Slack', 'Plataforma de comunicación', 'https://slack.com')
ON CONFLICT (nombre) DO NOTHING;

-- Insertar el usuario administrador
INSERT INTO usuarios (nombre_completo, username, password, rol)
VALUES (
    'Gerardo Julian Sanchez Tolentino',
    'gerardo.sanchez',
    'admin123', -- Nota: En producción, esto debería ser un hash seguro
    'superadmin'
) ON CONFLICT (username) DO NOTHING; 