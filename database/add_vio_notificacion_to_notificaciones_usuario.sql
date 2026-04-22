-- Asegura tabla de relación notificación-usuario para tracking individual de visto.
CREATE TABLE IF NOT EXISTS notificaciones_usuario (
  id BIGSERIAL PRIMARY KEY,
  notificacion_id BIGINT NOT NULL REFERENCES inicio_notificaciones(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  vio_notificacion BOOLEAN NOT NULL DEFAULT FALSE,
  visto_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Requerimiento: agregar columna booleana para indicar si se vio la notificación.
ALTER TABLE notificaciones_usuario
ADD COLUMN IF NOT EXISTS vio_notificacion BOOLEAN NOT NULL DEFAULT FALSE;

-- Evita duplicados del mismo usuario para la misma notificación.
CREATE UNIQUE INDEX IF NOT EXISTS notificaciones_usuario_unique_idx
ON notificaciones_usuario (notificacion_id, username);

-- Acelera búsqueda de pendientes por usuario.
CREATE INDEX IF NOT EXISTS notificaciones_usuario_user_pending_idx
ON notificaciones_usuario (username, vio_notificacion, created_at DESC);
