const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const dbConfig = require('./config');

// Configuración de multer para archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// Conexión a PostgreSQL con manejo de errores
const pool = new Pool(dbConfig);

// Verificar la conexión a la base de datos
pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

// Obtener todos los tickets
router.get('/', async (req, res) => {
  let client;
  try {
    console.log('Intentando conectar a la base de datos...');
    client = await pool.connect();
    console.log('Conexión exitosa a la base de datos');

    // Consulta con campos específicos que coinciden con el formulario
    const result = await client.query(`
      SELECT 
        id,
        name,
        email,
        department,
        issue,
        anydesk,
        urgency,
        timestamp,
        image_name,
        image_type
      FROM tickets 
      ORDER BY timestamp DESC
    `);
    
    console.log('Consulta ejecutada, número de resultados:', result.rows.length);
    
    // Convertir los resultados a JSON y agregar la URL de la imagen si existe
    const tickets = result.rows.map(ticket => ({
      ...ticket,
      image_url: ticket.image_name ? `/api/tickets/${ticket.id}/image` : null
    }));
    
    res.json(tickets);
  } catch (err) {
    console.error('Error completo:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({ 
      error: 'Error al obtener tickets',
      message: err.message,
      code: err.code,
      detail: err.detail
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Obtener tickets por urgencia
router.get('/urgency/:urgency', async (req, res) => {
  try {
    const { urgency } = req.params;
    const result = await pool.query(
      'SELECT * FROM tickets WHERE urgency = $1 ORDER BY timestamp DESC',
      [urgency]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener tickets por urgencia:', err);
    res.status(500).json({ error: 'Error al obtener tickets' });
  }
});

// Crear nuevo ticket
router.post('/', async (req, res) => {
  let client;
  try {
    console.log('Datos recibidos:', {
      ...req.body,
      image_data: req.body.image_data ? `Base64 data presente (${req.body.image_data.length} caracteres)` : 'No hay imagen',
      image_name: req.body.image_name || 'No hay nombre de imagen',
      image_type: req.body.image_type || 'No hay tipo de imagen'
    });
    
    const { name, email, department, issue, anydesk, image_data, image_name, image_type } = req.body;
    
    if (!name || !email || !department || !issue) {
      console.error('Datos incompletos:', { name, email, department, issue });
      return res.status(400).json({ 
        error: 'Datos incompletos',
        message: 'Faltan campos requeridos',
        details: {
          name: !name ? 'Falta el nombre' : 'OK',
          email: !email ? 'Falta el email' : 'OK',
          department: !department ? 'Falta el departamento' : 'OK',
          issue: !issue ? 'Falta la descripción del problema' : 'OK'
        }
      });
    }

    client = await pool.connect();
    const id = Date.now().toString();

    // Convertir la imagen base64 a buffer binario
    let imageBuffer = null;
    if (image_data) {
      try {
        console.log('Procesando imagen:', {
          name: image_name,
          type: image_type,
          dataLength: image_data.length
        });
        
        // Asegurarse de que los datos base64 estén limpios
        const cleanBase64 = image_data.replace(/^data:image\/\w+;base64,/, '');
        
        // Validar que los datos base64 sean válidos
        if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
          console.error('Datos base64 inválidos');
          return res.status(400).json({
            error: 'Datos de imagen inválidos',
            message: 'El formato de la imagen no es válido'
          });
        }
        
        imageBuffer = Buffer.from(cleanBase64, 'base64');
        
        // Validar que el buffer no esté vacío
        if (imageBuffer.length === 0) {
          console.error('Buffer de imagen vacío');
          return res.status(400).json({
            error: 'Imagen vacía',
            message: 'La imagen no contiene datos válidos'
          });
        }
        
        console.log('Imagen procesada correctamente:', {
          bufferSize: imageBuffer.length,
          imageType: image_type
        });
      } catch (err) {
        console.error('Error al procesar la imagen:', err);
        return res.status(400).json({
          error: 'Error al procesar la imagen',
          message: err.message
        });
      }
    }

    // Determinar el tipo de imagen válido
    const validImageType = image_type && image_type.startsWith('image/') ? image_type : 'image/jpeg';

    try {
      const result = await client.query(
        'INSERT INTO tickets (id, name, email, department, issue, anydesk, image_data, image_name, image_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
        [id, name, email, department, issue, anydesk, imageBuffer, image_name, validImageType]
      );

      console.log('Ticket creado exitosamente:', {
        id: result.rows[0].id,
        hasImage: !!imageBuffer
      });

      // Registrar en la tabla de eventos
      try {
        const descripcionEvento = `Nuevo ticket creado - ${issue.substring(0, 100)}`;
        
        // Obtener usuario_id por email o usar un valor por defecto
        const usuarioResult = await client.query(
          'SELECT id FROM usuarios WHERE email = $1 LIMIT 1',
          [email]
        );
        
        const usuario_id = usuarioResult.rows.length > 0 ? usuarioResult.rows[0].id : 1;
        
        await client.query(
          'INSERT INTO eventos (usuario_id, descripcion, fecha) VALUES ($1, $2, NOW())',
          [usuario_id, descripcionEvento]
        );
        
        console.log('Evento registrado exitosamente');
      } catch (eventError) {
        console.error('Error al registrar evento:', eventError);
        // No fallar la creación del ticket si falla el evento
      }

      return res.status(201).json({ 
        id: result.rows[0].id, 
        message: 'Ticket creado exitosamente',
        hasImage: !!imageBuffer
      });
    } catch (dbError) {
      console.error('Error al insertar en la base de datos:', {
        error: dbError.message,
        code: dbError.code,
        detail: dbError.detail,
        stack: dbError.stack
      });
      return res.status(500).json({
        error: 'Error al crear ticket',
        message: dbError.message,
        code: dbError.code,
        detail: dbError.detail
      });
    }
  } catch (err) {
    console.error('Error detallado al crear ticket:', {
      error: err.message,
      code: err.code,
      detail: err.detail,
      stack: err.stack
    });
    return res.status(500).json({ 
      error: 'Error al crear ticket',
      message: err.message,
      code: err.code,
      detail: err.detail
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Actualizar urgencia de un ticket
router.patch('/:id/urgency', async (req, res) => {
  try {
    const { id } = req.params;
    const { urgency } = req.body;

    const result = await pool.query(
      'UPDATE tickets SET urgency = $1 WHERE id = $2',
      [urgency, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    res.json({ message: 'Urgencia actualizada exitosamente' });
  } catch (err) {
    console.error('Error al actualizar urgencia:', err);
    res.status(500).json({ error: 'Error al actualizar urgencia' });
  }
});

// Eliminar ticket
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Eliminar el ticket de la base de datos
    const deleteResult = await pool.query('DELETE FROM tickets WHERE id = $1', [id]);
    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    res.json({ message: 'Ticket eliminado exitosamente' });
  } catch (err) {
    console.error('Error al eliminar ticket:', err);
    res.status(500).json({ error: 'Error al eliminar ticket' });
  }
});

// Obtener la imagen de un ticket
router.get('/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT image_data, image_type, image_name FROM tickets WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      console.error(`[IMG] Ticket no encontrado para id: ${id}`);
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }
    if (!result.rows[0].image_data) {
      console.error(`[IMG] No hay datos de imagen para id: ${id}`);
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    const { image_data, image_type, image_name } = result.rows[0];
    console.log(`[IMG] Sirviendo imagen para ticket ${id}:`, {
      image_type,
      image_name,
      bufferLength: image_data.length
    });

    // Validar tipo de imagen
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic'];
    const type = validTypes.includes(image_type) ? image_type : 'application/octet-stream';
    res.set('Content-Type', type);
    res.send(image_data);
  } catch (err) {
    console.error('Error al obtener imagen:', err);
    res.status(500).json({ error: 'Error al obtener imagen', message: err.message });
  }
});

// Obtener mensajes de un ticket
router.get('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, content, is_staff, timestamp FROM ticket_messages WHERE ticket_id = $1 ORDER BY timestamp ASC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener mensajes:', err);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// Enviar mensaje a un ticket
router.post('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, is_staff } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    const isStaffBool = (is_staff === true || is_staff === 'true');
    const result = await pool.query(
      'INSERT INTO ticket_messages (ticket_id, content, is_staff) VALUES ($1, $2, $3) RETURNING id, content, is_staff, timestamp',
      [id, content, isStaffBool]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al enviar mensaje:', err);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

module.exports = router;
