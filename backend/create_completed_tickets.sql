-- Conectar a la base de datos apoyos_db
\c apoyos_db;

-- Crear tabla para tickets completados y cancelados
CREATE TABLE IF NOT EXISTS completed_tickets (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    department VARCHAR(50) NOT NULL,
    issue TEXT NOT NULL,
    anydesk VARCHAR(50),
    urgency VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('completed', 'cancelled')),
    completion_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_by VARCHAR(100) NOT NULL,
    completion_notes TEXT,
    original_ticket_id VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para optimizar búsquedas
CREATE INDEX idx_completed_tickets_status ON completed_tickets(status);
CREATE INDEX idx_completed_tickets_completion_date ON completed_tickets(completion_date);
CREATE INDEX idx_completed_tickets_department ON completed_tickets(department);
CREATE INDEX idx_completed_tickets_original_ticket_id ON completed_tickets(original_ticket_id);

-- Crear tabla para imágenes de tickets completados
CREATE TABLE IF NOT EXISTS completed_ticket_images (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) NOT NULL,
    image_path VARCHAR(255) NOT NULL,
    image_name VARCHAR(255) NOT NULL,
    image_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES completed_tickets(id) ON DELETE CASCADE
);

-- Crear tabla para mensajes de tickets completados
CREATE TABLE IF NOT EXISTS completed_ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    sender VARCHAR(255) NOT NULL,
    is_staff BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES completed_tickets(id) ON DELETE CASCADE
);

-- Crear índices para las tablas relacionadas
CREATE INDEX idx_completed_ticket_images_ticket_id ON completed_ticket_images(ticket_id);
CREATE INDEX idx_completed_ticket_messages_ticket_id ON completed_ticket_messages(ticket_id); 