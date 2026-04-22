-- Crear tabla de empleados
CREATE TABLE empleados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_completo TEXT NOT NULL,
    supervisor TEXT NOT NULL,
    puesto TEXT NOT NULL,
    foto_url TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de apoyos
CREATE TABLE apoyos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empleado_id INTEGER NOT NULL,
    folio TEXT NOT NULL,
    tipo_apoyo TEXT NOT NULL,
    descripcion TEXT,
    estatus_material TEXT,
    fecha_salida_herramienta DATE,
    fecha_regreso_herramienta DATE,
    notas TEXT,
    ultima_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modificado_por TEXT,
    FOREIGN KEY (empleado_id) REFERENCES empleados(id)
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