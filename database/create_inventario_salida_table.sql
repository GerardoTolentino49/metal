-- PostgreSQL: Tabla de salidas + trigger para descontar stock automáticamente

-- 1) Tabla de salidas (FK a inventario(codigo))
CREATE TABLE IF NOT EXISTS inventario_salida (
  id               SERIAL PRIMARY KEY,
  departamento     VARCHAR(100) NOT NULL,
  empleado         VARCHAR(150) NOT NULL,
  fecha            DATE NOT NULL,
  codigo_producto  VARCHAR(100) NOT NULL,
  descripcion      TEXT NOT NULL,
  clasificacion    VARCHAR(100) NOT NULL,
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  motivo           TEXT NOT NULL,
  created_at       TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_salida_inventario_codigo
    FOREIGN KEY (codigo_producto)
    REFERENCES inventario (codigo)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inventario_salida_codigo_producto
  ON inventario_salida (codigo_producto);

CREATE INDEX IF NOT EXISTS idx_inventario_salida_fecha
  ON inventario_salida (fecha);

-- 2) Función: valida stock y descuenta
CREATE OR REPLACE FUNCTION fn_descontar_stock_salida()
RETURNS TRIGGER AS $$
DECLARE
  v_stock_actual INTEGER;
BEGIN
  -- Leer stock actual del producto
  SELECT stock INTO v_stock_actual
  FROM inventario
  WHERE codigo = NEW.codigo_producto
  FOR UPDATE; -- bloquear fila para concurrencia

  IF v_stock_actual IS NULL THEN
    RAISE EXCEPTION 'Código % no existe en inventario', NEW.codigo_producto;
  END IF;

  IF v_stock_actual < NEW.cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (stock: %, solicitado: %)', NEW.codigo_producto, v_stock_actual, NEW.cantidad;
  END IF;

  -- Descontar
  UPDATE inventario
  SET stock = stock - NEW.cantidad,
      updated_at = NOW()
  WHERE codigo = NEW.codigo_producto;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3) Trigger: ejecuta la función al insertar una salida
DROP TRIGGER IF EXISTS trg_descontar_stock_salida ON inventario_salida;
CREATE TRIGGER trg_descontar_stock_salida
AFTER INSERT ON inventario_salida
FOR EACH ROW
EXECUTE FUNCTION fn_descontar_stock_salida();


