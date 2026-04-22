const express = require('express');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');
const router = express.Router();

// Configuración de la base de datos
const pool = new Pool({
    user: 'tu_usuario',
    host: 'localhost',
    database: 'tu_base_de_datos',
    password: 'tu_password',
    port: 5432,
});

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/denuncias/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB máximo
    }
});

// Ruta para crear una nueva denuncia anónima
router.post('/', upload.single('image'), async (req, res) => {
    try {
        const { issue } = req.body;
        const imageFile = req.file;
        
        // Validar campos obligatorios
        if (!issue || issue.trim() === '') {
            return res.status(400).json({
                error: 'La descripción de la denuncia es obligatoria'
            });
        }
        
        // Generar ID único
        const id = 'DEN_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Preparar datos para la base de datos
        const denunciaData = {
            id: id,
            issue: issue.trim(),
            image_name: imageFile ? imageFile.filename : null,
            image_type: imageFile ? imageFile.mimetype : null,
            timestamp: new Date(),
            image_path: imageFile ? `uploads/denuncias/${imageFile.filename}` : null,
            time_end: null,
            assigned_user_id: [],
            estatus: false // Por defecto pendiente
        };
        
        // Insertar en la base de datos
        const query = `
            INSERT INTO denuncias_anonimas 
            (id, issue, image_name, image_type, timestamp, image_path, time_end, assigned_user_id, estatus)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `;
        
        const values = [
            denunciaData.id,
            denunciaData.issue,
            denunciaData.image_name,
            denunciaData.image_type,
            denunciaData.timestamp,
            denunciaData.image_path,
            denunciaData.time_end,
            denunciaData.assigned_user_id,
            denunciaData.estatus
        ];
        
        const result = await pool.query(query, values);
        
        console.log('Denuncia anónima creada:', result.rows[0]);
        
        res.status(201).json({
            success: true,
            message: 'Denuncia anónima enviada exitosamente',
            denuncia: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error al crear denuncia anónima:', error);
        res.status(500).json({
            error: 'Error interno del servidor al procesar la denuncia'
        });
    }
});

// Ruta para obtener todas las denuncias anónimas
router.get('/', async (req, res) => {
    try {
        const query = 'SELECT * FROM denuncias_anonimas ORDER BY timestamp DESC';
        const result = await pool.query(query);
        
        res.json({
            success: true,
            denuncias: result.rows
        });
        
    } catch (error) {
        console.error('Error al obtener denuncias anónimas:', error);
        res.status(500).json({
            error: 'Error interno del servidor al obtener las denuncias'
        });
    }
});

// Nueva ruta para marcar denuncia como resuelta
router.put('/:id/resolver', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Actualizar el estatus a true (resuelto) y establecer time_end
        const query = `
            UPDATE denuncias_anonimas 
            SET estatus = true, time_end = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Denuncia no encontrada' });
        }
        
        console.log('Denuncia marcada como resuelta:', result.rows[0]);
        
        res.json({
            success: true,
            message: 'Denuncia marcada como resuelta exitosamente',
            denuncia: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error al marcar denuncia como resuelta:', error);
        res.status(500).json({
            error: 'Error interno del servidor al procesar la solicitud'
        });
    }
});

// Nueva ruta para marcar denuncia como pendiente
router.put('/:id/pendiente', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Actualizar el estatus a false (pendiente) y limpiar time_end
        const query = `
            UPDATE denuncias_anonimas 
            SET estatus = false, time_end = NULL
            WHERE id = $1
            RETURNING *
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Denuncia no encontrada' });
        }
        
        console.log('Denuncia marcada como pendiente:', result.rows[0]);
        
        res.json({
            success: true,
            message: 'Denuncia marcada como pendiente exitosamente',
            denuncia: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error al marcar denuncia como pendiente:', error);
        res.status(500).json({
            error: 'Error interno del servidor al procesar la solicitud'
        });
    }
});

module.exports = router;
