-- Crear tabla de empleados de diseño
CREATE TABLE IF NOT EXISTS empleados_design (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT true
);

-- Crear tabla de órdenes de diseño
CREATE TABLE IF NOT EXISTS ordenes_design (
    id SERIAL PRIMARY KEY,
    empleado_id INTEGER REFERENCES empleados_design(id),
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_fin TIMESTAMP,
    tiempo_total INTERVAL,
    estado VARCHAR(20) DEFAULT 'activo',
    descripcion TEXT,
    CONSTRAINT fk_empleado_design FOREIGN KEY (empleado_id) REFERENCES empleados_design(id)
);

-- Crear índice para optimizar búsquedas por empleado
CREATE INDEX idx_ordenes_empleado ON ordenes_design(empleado_id);

-- Crear índice para optimizar búsquedas por estado
CREATE INDEX idx_ordenes_estado ON ordenes_design(estado);

-- Crear función para actualizar el tiempo total automáticamente
CREATE OR REPLACE FUNCTION actualizar_tiempo_total()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.fecha_fin IS NOT NULL THEN
        NEW.tiempo_total = NEW.fecha_fin - NEW.fecha_inicio;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger para actualizar el tiempo total
CREATE TRIGGER trigger_actualizar_tiempo
    BEFORE UPDATE ON ordenes_design
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_tiempo_total(); 