-- Crea tabla para almacenar items usados en el formulario de Compras
-- Ejecutar en la base de datos (Postgres/MySQL ajustar tipos si es necesario)

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(255),
  descripcion TEXT,
  uom VARCHAR(100),
  commodity VARCHAR(255),
  grado VARCHAR(100),
  cfdi VARCHAR(255),
  categoria VARCHAR(255),
  created_by INTEGER,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

-- Ejemplo de INSERT (reemplazar valores según corresponda):
-- INSERT INTO items (codigo, descripcion, uom, commodity, grado, cfdi, categoria, created_by)
-- VALUES ('ABC123', 'Descripción ejemplo', 'PZA', 'Commod', 'A', '01010101', 'Materias primas', 1);
