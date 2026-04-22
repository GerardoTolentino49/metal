-- Crear la base de datos
CREATE DATABASE phoenix_tickets;

-- Conectar a la base de datos
\c phoenix_tickets;

-- Crear tabla de tickets
CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    department VARCHAR(50) NOT NULL,
    issue TEXT NOT NULL,
    anydesk VARCHAR(50),
    urgency VARCHAR(20) DEFAULT 'pending',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    media TEXT
);

-- Crear índices para optimizar búsquedas
CREATE INDEX idx_tickets_urgency ON tickets(urgency);
CREATE INDEX idx_tickets_timestamp ON tickets(timestamp);

-- Crear tabla para imágenes
CREATE TABLE IF NOT EXISTS imagenes_ticket (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) NOT NULL,
    ruta_imagen VARCHAR(255) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
); 