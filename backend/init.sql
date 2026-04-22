-- Crear la base de datos si no existe
CREATE DATABASE phoenix_tickets;

-- Conectar a la base de datos
\c phoenix_tickets;

-- Crear la tabla tickets si no existe
CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL,
    issue TEXT NOT NULL,
    anydesk VARCHAR(255),
    urgency VARCHAR(50) DEFAULT 'pending',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    image_data BYTEA,
    image_name VARCHAR(255),
    image_type VARCHAR(50)
); 