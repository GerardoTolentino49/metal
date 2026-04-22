-- Tabla para almacenar descansos configurables por usuario y fecha
-- Permite que el sistema mueva automáticamente los descansos cuando hay conflictos con órdenes

CREATE TABLE IF NOT EXISTS user_daily_breaks (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    break_date DATE NOT NULL,
    break_start_hour DECIMAL(4,2) DEFAULT 12.0,      -- Hora de inicio del descanso (12.0 = 12:00 PM)
    break_duration_hours DECIMAL(3,1) DEFAULT 1.0,   -- Duración del descanso en horas
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY(usuario_id, break_date),
    CONSTRAINT valid_break_hour CHECK (break_start_hour >= 6.0 AND break_start_hour < 16.0),
    CONSTRAINT valid_break_duration CHECK (break_duration_hours > 0 AND break_duration_hours <= 4.0)
);

-- Índice para búsquedas rápidas por usuario
CREATE INDEX IF NOT EXISTS idx_user_daily_breaks_usuario ON user_daily_breaks(usuario_id);
CREATE INDEX IF NOT EXISTS idx_user_daily_breaks_date ON user_daily_breaks(break_date);

-- Comentario descriptivo
COMMENT ON TABLE user_daily_breaks IS 'Almacena la configuración de descansos diarios por usuario. El sistema mueve automáticamente los descansos si una orden entra en conflicto.';
COMMENT ON COLUMN user_daily_breaks.break_start_hour IS 'Hora de inicio del descanso en formato decimal (12.0 = 12:00 PM, 12.5 = 12:30 PM)';
COMMENT ON COLUMN user_daily_breaks.break_duration_hours IS 'Duración del descanso en horas (debe ser mínimo 1.0)';
