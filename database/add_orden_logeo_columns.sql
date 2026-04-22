-- Agregar columnas para el sistema de logeo de diseño en la tabla usuarios

-- Columna para guardar el número de orden en el que está logeado
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS orden_en_logeo VARCHAR(255);

-- Columna para guardar el estado de ausencia (pausa, comida, 5s, meeting, pendiente, aprobado, Activo)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estado_en_orden VARCHAR(50);

-- Columna para guardar la fecha y hora del inicio de sesión
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS inicio_sesion TIMESTAMPTZ;

-- Comentarios para documentar las columnas
COMMENT ON COLUMN usuarios.orden_en_logeo IS 'Número de orden en el que el usuario está actualmente logeado';
COMMENT ON COLUMN usuarios.estado_en_orden IS 'Estado de ausencia del usuario: Activo, pausa, comida, 5s, meeting, pendiente, aprobado';
COMMENT ON COLUMN usuarios.inicio_sesion IS 'Fecha y hora en la que el usuario inició sesión en la orden actual';
