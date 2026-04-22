// ==================== ENDPOINTS PARA TAREAS PERSONALES ====================

// Obtener todas las tareas del usuario logueado
app.get('/api/tareas-personales', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const result = await apoyosPool.query(
      `SELECT tp.*,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', u.id, 'nombre_completo', u.nombre_completo))
                  FILTER (WHERE u.id IS NOT NULL), '[]'::json
              ) AS shared_with
       FROM tareas_personales tp
       LEFT JOIN tareas_compartidas tc ON tp.id = tc.tarea_id
       LEFT JOIN usuarios u ON tc.usuario_compartido_id = u.id
       WHERE tp.usuario_id = $1
          OR EXISTS (
              SELECT 1 FROM tareas_compartidas tc2 
              WHERE tc2.tarea_id = tp.id AND tc2.usuario_compartido_id = $1
          )
       GROUP BY tp.id
       ORDER BY tp.creada_en DESC`,
      [req.session.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener tareas:', error);
    res.status(500).json({ error: 'Error al obtener tareas' });
  }
});

// Crear una nueva tarea
app.post('/api/tareas-personales', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { id, titulo, descripcion, prioridad, estado, posicion } = req.body;

    if (!titulo) {
      return res.status(400).json({ error: 'El título es requerido' });
    }

    const result = await apoyosPool.query(
      `INSERT INTO tareas_personales (id, usuario_id, titulo, descripcion, prioridad, estado, posicion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, req.session.userId, titulo, descripcion, prioridad || 'medium', estado || 'todo', posicion || 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear tarea:', error);
    res.status(500).json({ error: 'Error al crear tarea' });
  }
});

// Actualizar una tarea
app.put('/api/tareas-personales/:id', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { id } = req.params;
    const { titulo, descripcion, prioridad, estado, posicion } = req.body;

    // Verificar que el usuario es el propietario de la tarea
    const checkResult = await apoyosPool.query(
      'SELECT usuario_id FROM tareas_personales WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0 || checkResult.rows[0].usuario_id !== req.session.userId) {
      return res.status(403).json({ error: 'No tienes permiso para actualizar esta tarea' });
    }

    const result = await apoyosPool.query(
      `UPDATE tareas_personales 
       SET titulo = COALESCE($2, titulo),
           descripcion = COALESCE($3, descripcion),
           prioridad = COALESCE($4, prioridad),
           estado = COALESCE($5, estado),
           posicion = COALESCE($6, posicion)
       WHERE id = $1
       RETURNING *`,
      [id, titulo, descripcion, prioridad, estado, posicion]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al actualizar tarea:', error);
    res.status(500).json({ error: 'Error al actualizar tarea' });
  }
});

// Eliminar una tarea
app.delete('/api/tareas-personales/:id', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { id } = req.params;

    // Verificar que el usuario es el propietario
    const checkResult = await apoyosPool.query(
      'SELECT usuario_id FROM tareas_personales WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0 || checkResult.rows[0].usuario_id !== req.session.userId) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta tarea' });
    }

    await apoyosPool.query('DELETE FROM tareas_personales WHERE id = $1', [id]);

    res.json({ message: 'Tarea eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar tarea:', error);
    res.status(500).json({ error: 'Error al eliminar tarea' });
  }
});

// ==================== ENDPOINTS PARA COMENTARIOS ====================

// Obtener comentarios de una tarea
app.get('/api/tareas-personales/:taskId/comentarios', async (req, res) => {
  try {
    const { taskId } = req.params;

    const result = await apoyosPool.query(
      `SELECT c.id, c.contenido, u.nombre_completo as author, c.creado_en as timestamp
       FROM comentarios_tareas c
       JOIN usuarios u ON c.usuario_id = u.id
       WHERE c.tarea_id = $1
       ORDER BY c.creado_en ASC`,
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener comentarios:', error);
    res.status(500).json({ error: 'Error al obtener comentarios' });
  }
});

// Agregar comentario a una tarea
app.post('/api/tareas-personales/:taskId/comentarios', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { taskId } = req.params;
    const { id, contenido } = req.body;

    if (!contenido || contenido.trim().length === 0) {
      return res.status(400).json({ error: 'El contenido del comentario es requerido' });
    }

    // Verificar que la tarea existe
    const taskCheck = await apoyosPool.query(
      'SELECT id FROM tareas_personales WHERE id = $1',
      [taskId]
    );

    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    const result = await apoyosPool.query(
      `WITH inserted AS (
         INSERT INTO comentarios_tareas (id, tarea_id, usuario_id, contenido)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tarea_id, usuario_id, contenido, creado_en
       )
       SELECT i.id, i.contenido, u.nombre_completo as author, i.creado_en as timestamp
       FROM inserted i
       JOIN usuarios u ON i.usuario_id = u.id`,
      [id, taskId, req.session.userId, contenido]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al agregar comentario:', error);
    res.status(500).json({ error: 'Error al agregar comentario' });
  }
});

// Eliminar comentario
app.delete('/api/comentarios/:commentId', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { commentId } = req.params;

    // Verificar que el usuario es el autor del comentario
    const checkResult = await apoyosPool.query(
      'SELECT usuario_id FROM comentarios_tareas WHERE id = $1',
      [commentId]
    );

    if (checkResult.rows.length === 0 || checkResult.rows[0].usuario_id !== req.session.userId) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario' });
    }

    await apoyosPool.query('DELETE FROM comentarios_tareas WHERE id = $1', [commentId]);

    res.json({ message: 'Comentario eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar comentario:', error);
    res.status(500).json({ error: 'Error al eliminar comentario' });
  }
});

// ==================== ENDPOINTS PARA COMPARTIR TAREAS ====================

// Compartir tarea con usuarios
app.post('/api/tareas-personales/:taskId/compartir', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { taskId } = req.params;
    const { userIds } = req.body; // Array de IDs de usuarios

    if (!Array.isArray(userIds)) {
      return res.status(400).json({ error: 'userIds debe ser un array' });
    }

    // Verificar que el usuario es el propietario
    const taskCheck = await apoyosPool.query(
      'SELECT usuario_id FROM tareas_personales WHERE id = $1',
      [taskId]
    );

    if (taskCheck.rows.length === 0 || taskCheck.rows[0].usuario_id !== req.session.userId) {
      return res.status(403).json({ error: 'No tienes permiso para compartir esta tarea' });
    }

    // Eliminar comparticiones previas
    await apoyosPool.query('DELETE FROM tareas_compartidas WHERE tarea_id = $1', [taskId]);

    // Agregar nuevas comparticiones
    for (const userId of userIds) {
      await apoyosPool.query(
        `INSERT INTO tareas_compartidas (tarea_id, usuario_propietario_id, usuario_compartido_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tarea_id, usuario_compartido_id) DO NOTHING`,
        [taskId, req.session.userId, userId]
      );
    }

    res.json({ message: 'Tarea compartida exitosamente' });
  } catch (error) {
    console.error('Error al compartir tarea:', error);
    res.status(500).json({ error: 'Error al compartir tarea' });
  }
});

// Obtener usuarios con los que se comparte la tarea
app.get('/api/tareas-personales/:taskId/compartidas-con', async (req, res) => {
  try {
    const { taskId } = req.params;

    const result = await apoyosPool.query(
      `SELECT u.id, u.nombre_completo, u.departamento
       FROM tareas_compartidas tc
       JOIN usuarios u ON tc.usuario_compartido_id = u.id
       WHERE tc.tarea_id = $1`,
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios compartidos:', error);
    res.status(500).json({ error: 'Error al obtener usuarios compartidos' });
  }
});
