-- ==================== QUERIES ÚTILES PARA GESTIÓN DE TAREAS ====================

-- 1. OBTENER TODAS LAS TAREAS DE UN USUARIO CON SUS COMENTARIOS
SELECT 
    tp.id,
    tp.titulo,
    tp.descripcion,
    tp.prioridad,
    tp.estado,
    tp.creada_en,
    COUNT(ct.id) as total_comentarios,
    json_agg(
        json_build_object(
            'id', u.id,
            'nombre_completo', u.nombre_completo
        )
    ) FILTER (WHERE u.id IS NOT NULL) as compartida_con
FROM tareas_personales tp
LEFT JOIN comentarios_tareas ct ON tp.id = ct.tarea_id
LEFT JOIN tareas_compartidas tc ON tp.id = tc.tarea_id
LEFT JOIN usuarios u ON tc.usuario_compartido_id = u.id
WHERE tp.usuario_id = $1
GROUP BY tp.id, tp.titulo, tp.descripcion, tp.prioridad, tp.estado, tp.creada_en
ORDER BY tp.creada_en DESC;

-- 2. OBTENER TAREAS POR ESTADO
SELECT 
    tp.id,
    tp.titulo,
    tp.prioridad,
    tp.estado,
    COUNT(ct.id) as comentarios
FROM tareas_personales tp
LEFT JOIN comentarios_tareas ct ON tp.id = ct.tarea_id
WHERE tp.usuario_id = $1 AND tp.estado = $2
GROUP BY tp.id
ORDER BY tp.creada_en DESC;

-- 3. OBTENER TAREAS COMPARTIDAS CONTIGO
SELECT 
    tp.id,
    tp.titulo,
    tp.descripcion,
    u.nombre_completo as propietario,
    tp.prioridad,
    tp.estado,
    tc.compartida_en
FROM tareas_personales tp
JOIN tareas_compartidas tc ON tp.id = tc.tarea_id
JOIN usuarios u ON tp.usuario_id = u.id
WHERE tc.usuario_compartido_id = $1
ORDER BY tc.compartida_en DESC;

-- 4. OBTENER COMENTARIOS DE UNA TAREA CON DETALLES DEL USUARIO
SELECT 
    ct.id,
    ct.contenido,
    u.nombre_completo as autor,
    u.id as usuario_id,
    ct.creado_en
FROM comentarios_tareas ct
JOIN usuarios u ON ct.usuario_id = u.id
WHERE ct.tarea_id = $1
ORDER BY ct.creado_en ASC;

-- 5. OBTENER ESTADÍSTICAS DEL USUARIO
SELECT 
    (SELECT COUNT(*) FROM tareas_personales WHERE usuario_id = $1 AND estado = 'todo') as pendientes,
    (SELECT COUNT(*) FROM tareas_personales WHERE usuario_id = $1 AND estado = 'in-progress') as en_progreso,
    (SELECT COUNT(*) FROM tareas_personales WHERE usuario_id = $1 AND estado = 'done') as completadas,
    (SELECT COUNT(*) FROM tareas_personales WHERE usuario_id = $1) as total,
    (SELECT COUNT(*) FROM tareas_compartidas WHERE usuario_propietario_id = $1) as compartidas,
    (SELECT COUNT(*) FROM tareas_compartidas WHERE usuario_compartido_id = $1) as recibidas;

-- 6. OBTENER TAREAS VENCIDAS (CREADAS HACE MÁS DE 30 DÍAS Y SIN COMPLETAR)
SELECT 
    tp.id,
    tp.titulo,
    tp.prioridad,
    EXTRACT(DAY FROM (NOW() - tp.creada_en)) as dias_sin_completar
FROM tareas_personales tp
WHERE tp.usuario_id = $1 
  AND tp.estado != 'done'
  AND tp.creada_en < NOW() - INTERVAL '30 days'
ORDER BY tp.creada_en ASC;

-- 7. OBTENER USUARIOS CON ACCESO A UNA TAREA
SELECT 
    u.id,
    u.nombre_completo,
    u.departamento,
    tc.compartida_en
FROM tareas_compartidas tc
JOIN usuarios u ON tc.usuario_compartido_id = u.id
WHERE tc.tarea_id = $1
ORDER BY tc.compartida_en DESC;

-- 8. ACTUALIZAR POSICIÓN DE TAREAS (PARA DRAG AND DROP)
UPDATE tareas_personales 
SET posicion = $2
WHERE id = $1;

-- 9. CONTAR COMENTARIOS POR USUARIO
SELECT 
    u.nombre_completo,
    COUNT(ct.id) as total_comentarios
FROM comentarios_tareas ct
JOIN usuarios u ON ct.usuario_id = u.id
WHERE ct.tarea_id IN (
    SELECT id FROM tareas_personales WHERE usuario_id = $1
)
GROUP BY u.id, u.nombre_completo
ORDER BY total_comentarios DESC;

-- 10. OBTENER TAREAS CON MÁS COMENTARIOS
SELECT 
    tp.id,
    tp.titulo,
    COUNT(ct.id) as total_comentarios,
    MAX(ct.creado_en) as ultimo_comentario
FROM tareas_personales tp
LEFT JOIN comentarios_tareas ct ON tp.id = ct.tarea_id
WHERE tp.usuario_id = $1
GROUP BY tp.id, tp.titulo
HAVING COUNT(ct.id) > 0
ORDER BY total_comentarios DESC;

-- 11. LIMPIAR TAREAS ELIMINADAS (MANTENIENCIA)
DELETE FROM tareas_personales 
WHERE usuario_id = $1 AND estado = 'done' AND actualizada_en < NOW() - INTERVAL '90 days';

-- 12. OBTENER REPORTE SEMANAL
SELECT 
    DATE_TRUNC('week', tp.creada_en) as semana,
    COUNT(*) as total_tareas,
    COUNT(CASE WHEN tp.estado = 'done' THEN 1 END) as completadas,
    COUNT(CASE WHEN tp.prioridad = 'high' THEN 1 END) as alta_prioridad
FROM tareas_personales tp
WHERE tp.usuario_id = $1 AND tp.creada_en >= NOW() - INTERVAL '8 weeks'
GROUP BY DATE_TRUNC('week', tp.creada_en)
ORDER BY semana DESC;

-- 13. BUSCAR TAREAS POR PALABRA CLAVE
SELECT 
    tp.id,
    tp.titulo,
    tp.descripcion,
    tp.prioridad,
    tp.estado,
    tp.creada_en
FROM tareas_personales tp
WHERE tp.usuario_id = $1 
  AND (
    tp.titulo ILIKE '%' || $2 || '%' 
    OR tp.descripcion ILIKE '%' || $2 || '%'
  )
ORDER BY tp.creada_en DESC;

-- 14. OBTENER TAREAS COMPARTIDAS CONTIGO AGRUPADAS POR PROPIETARIO
SELECT 
    u.nombre_completo as propietario,
    COUNT(tp.id) as total_tareas,
    COUNT(CASE WHEN tp.estado = 'done' THEN 1 END) as completadas
FROM tareas_personales tp
JOIN tareas_compartidas tc ON tp.id = tc.tarea_id
JOIN usuarios u ON tp.usuario_id = u.id
WHERE tc.usuario_compartido_id = $1
GROUP BY u.id, u.nombre_completo
ORDER BY total_tareas DESC;

-- 15. SINCRONIZAR ESTADO (VERIFICAR CONSISTENCIA)
SELECT 
    tp.id,
    tp.estado,
    COUNT(ct.id) as comentarios,
    COUNT(tc.usuario_compartido_id) as compartida_con
FROM tareas_personales tp
LEFT JOIN comentarios_tareas ct ON tp.id = ct.tarea_id
LEFT JOIN tareas_compartidas tc ON tp.id = tc.tarea_id
WHERE tp.usuario_id = $1
GROUP BY tp.id, tp.estado
HAVING COUNT(ct.id) > 0 OR COUNT(tc.usuario_compartido_id) > 0;
