// ... otros requires ...
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg'); // Asegúrate de tener pg instalado

const app = express();
app.use(bodyParser.json());

// Configura tu pool de PostgreSQL
const pool = new Pool({
  // ... tu configuración ...
});

// ... otras rutas ...

// Ruta para actualizar el color favorito del usuario
app.post('/api/usuario/favorite-color', async (req, res) => {
  const { userId, color } = req.body;
  if (!userId || !color) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    await pool.query(
      'UPDATE usuarios SET favorite_color = $1 WHERE id = $2',
      [color, userId]
    );
    res.json({ success: true, color });
  } catch (err) {
    console.error('Error actualizando color favorito:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Endpoint para obtener el inventario de IT de un empleado
app.get('/api/inventario/:id_empleado', async (req, res) => {
  const id = req.params.id_empleado;
  try {
    // Consulta hardware
    const hardwareResult = await pool.query(
      'SELECT * FROM hardware WHERE id_empleado = $1',
      [id]
    );
    // Consulta software
    const softwareResult = await pool.query(
      'SELECT * FROM software WHERE id_empleado = $1',
      [id]
    );
    res.json({
      hardware: hardwareResult.rows,
      software: softwareResult.rows
    });
  } catch (err) {
    console.error('Error consultando inventario:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Actualizar software por id_software
app.put('/api/software/:id_software', async (req, res) => {
  const { id_software } = req.params;
  const { nombre, version, licencia, estado, caducidad } = req.body;
  if (!id_software) {
    return res.status(400).json({ error: 'Falta el id_software' });
  }
  try {
    const result = await pool.query(
      'UPDATE software SET nombre = $1, version = $2, licencia = $3, estado = $4, caducidad = $5 WHERE id_software = $6 RETURNING *',
      [nombre, version, licencia, estado, caducidad, id_software]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Software no encontrado' });
    }
    res.json({ success: true, software: result.rows[0] });
  } catch (err) {
    console.error('Error actualizando software:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});