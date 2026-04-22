-- Asegurar que inventario(codigo) exista y sea UNIQUE para usarlo como FK
-- PostgreSQL

-- 1) Agregar columna codigo si no existe
ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(100);

-- 2) Opcional: forzar NOT NULL si tu app siempre requiere código
-- ALTER TABLE inventario ALTER COLUMN codigo SET NOT NULL;

-- 3) Crear índice único (requisito para FK de otras tablas)
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventario_codigo
  ON inventario (codigo);


