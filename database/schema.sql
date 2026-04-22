-- Crear la base de datos
CREATE DATABASE lisa_db;

-- Conectar a la base de datos
\c lisa_db;

-- Crear tabla de empleados
CREATE TABLE empleados (
    id SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(100) NOT NULL,
    supervisor VARCHAR(100) NOT NULL,
    puesto VARCHAR(50) NOT NULL,
    foto_url VARCHAR(255),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de apoyos
CREATE TABLE apoyos (
    id SERIAL PRIMARY KEY,
    empleado_id INTEGER REFERENCES empleados(id),
    folio VARCHAR(20) NOT NULL,
    tipo_apoyo VARCHAR(50) NOT NULL,
    descripcion TEXT,
    estatus_material VARCHAR(50),
    fecha_salida_herramienta DATE,
    fecha_regreso_herramienta DATE,
    notas TEXT,
    ultima_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modificado_por VARCHAR(50),
    CONSTRAINT fk_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id)
);

-- Insertar empleados de prueba
INSERT INTO empleados (nombre_completo, supervisor, puesto) VALUES
    ('Juan Pérez González', 'María García', 'Operador de Producción'),
    ('Ana Martínez López', 'Carlos Rodríguez', 'Técnico de Mantenimiento'),
    ('Roberto Sánchez Díaz', 'Laura Torres', 'Supervisor de Línea');

-- Insertar apoyos de prueba
INSERT INTO apoyos (empleado_id, folio, tipo_apoyo, descripcion, estatus_material, fecha_salida_herramienta, fecha_regreso_herramienta, notas, modificado_por) VALUES
    (1, 'FOL-2024-001', 'Herramienta', 'Entrega de taladro industrial', 'En proceso', '2024-03-15', '2024-03-20', 'Herramienta en buen estado', 'L'),
    (2, 'FOL-2024-002', 'Material', 'Entrega de material de seguridad', 'Entregado', '2024-03-10', '2024-03-10', 'Material completo', 'I'),
    (3, 'FOL-2024-003', 'Herramienta', 'Entrega de multímetro', 'Pendiente', '2024-03-18', NULL, 'Pendiente de devolución', 'S'); 