-- Crear tabla de apoyos si no existe
CREATE TABLE IF NOT EXISTS apoyos (
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
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id)
);

-- Crear índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_apoyos_empleado_id ON apoyos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_apoyos_fecha_creacion ON apoyos(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_apoyos_tipo_apoyo ON apoyos(tipo_apoyo);
CREATE INDEX IF NOT EXISTS idx_apoyos_estatus_material ON apoyos(estatus_material);

-- Insertar algunos datos de prueba
INSERT INTO apoyos (empleado_id, folio, tipo_apoyo, descripcion, estatus_material, fecha_salida_herramienta, fecha_regreso_herramienta, notas, modificado_por)
VALUES 
    (1, 'FOL-2024-001', 'simple', 'Entrega de taladro industrial', 'entregado', '2024-03-15', '2024-03-20', 'Herramienta en buen estado', 'Admin'),
    (2, 'FOL-2024-002', 'unique', 'Entrega de material de seguridad', 'entregado', '2024-03-10', '2024-03-10', 'Material completo', 'Admin'),
    (3, 'FOL-2024-003', 'simple', 'Entrega de multímetro', 'pendiente', '2024-03-18', NULL, 'Pendiente de devolución', 'Admin')
ON CONFLICT DO NOTHING; 