const express = require('express');
const pool = require('../config');
const router = express.Router();

// Middleware para verificar autenticación
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
};

// GET: Cargar todos los eventos del usuario actual
router.get('/eventos', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    const result = await pool.query(`
      SELECT ce.id, ce.titulo, ce.descripcion, ce.fecha, ce.mes, ce.completado,
             ce.creado_en, ce.actualizado_en,
             json_agg(json_build_object('id', u.id, 'nombre_completo', u.nombre_completo)) 
             FILTER (WHERE u.id IS NOT NULL) as compartidos
      FROM calendario_eventos ce
      LEFT JOIN calendario_eventos_compartidos cec ON ce.id = cec.evento_id
      LEFT JOIN usuarios u ON cec.usuario_id = u.id
      WHERE ce.usuario_creador_id = $1
      GROUP BY ce.id, ce.titulo, ce.descripcion, ce.fecha, ce.mes, ce.completado, ce.creado_en, ce.actualizado_en
      ORDER BY ce.fecha DESC
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error cargando eventos:', error);
    res.status(500).json({ error: 'Error cargando eventos' });
  }
});

// POST: Crear nuevo evento
router.post('/eventos', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id, titulo, descripcion, fecha, mes, completado } = req.body;

    if (!id || !titulo || !fecha) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const result = await pool.query(`
      INSERT INTO calendario_eventos 
      (id, titulo, descripcion, fecha, mes, completado, usuario_creador_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, titulo, descripcion || null, fecha, mes, completado || false, userId]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error guardando evento:', error);
    res.status(500).json({ error: 'Error guardando evento' });
  }
});

// PATCH: Actualizar evento (estado completado)
router.patch('/eventos/:eventId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { eventId } = req.params;
    const { completado } = req.body;

    const result = await pool.query(`
      UPDATE calendario_eventos
      SET completado = $1, actualizado_en = CURRENT_TIMESTAMP
      WHERE id = $2 AND usuario_creador_id = $3
      RETURNING *
    `, [completado, eventId, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando evento:', error);
    res.status(500).json({ error: 'Error actualizando evento' });
  }
});

// DELETE: Eliminar evento
router.delete('/eventos/:eventId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { eventId } = req.params;

    const result = await pool.query(`
      DELETE FROM calendario_eventos
      WHERE id = $1 AND usuario_creador_id = $2
      RETURNING id
    `, [eventId, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    res.json({ id: eventId, deleted: true });
  } catch (error) {
    console.error('Error eliminando evento:', error);
    res.status(500).json({ error: 'Error eliminando evento' });
  }
});

// POST: Compartir evento con usuarios
router.post('/eventos/:eventId/share', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { eventId } = req.params;
    const { usuario_ids } = req.body;

    if (!Array.isArray(usuario_ids)) {
      return res.status(400).json({ error: 'usuario_ids debe ser un array' });
    }

    // Verificar que el evento pertenece al usuario
    const eventCheck = await pool.query(
      'SELECT id FROM calendario_eventos WHERE id = $1 AND usuario_creador_id = $2',
      [eventId, userId]
    );

    if (eventCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    // Eliminar comparticiones anteriores
    await pool.query('DELETE FROM calendario_eventos_compartidos WHERE evento_id = $1', [eventId]);

    // Agregar nuevas comparticiones
    for (const userId of usuario_ids) {
      await pool.query(`
        INSERT INTO calendario_eventos_compartidos (evento_id, usuario_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [eventId, userId]);
    }

    res.json({ success: true, evento_id: eventId, usuarios_compartidos: usuario_ids });
  } catch (error) {
    console.error('Error compartiendo evento:', error);
    res.status(500).json({ error: 'Error compartiendo evento' });
  }
});

// GET: Obtener usuarios con los que se compartió un evento
router.get('/eventos/:eventId/compartidos', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { eventId } = req.params;

    const result = await pool.query(`
      SELECT u.id, u.nombre_completo, u.departamento
      FROM calendario_eventos_compartidos cec
      JOIN usuarios u ON cec.usuario_id = u.id
      WHERE cec.evento_id = $1
    `, [eventId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error cargando usuarios compartidos:', error);
    res.status(500).json({ error: 'Error cargando usuarios compartidos' });
  }
});

module.exports = router;
