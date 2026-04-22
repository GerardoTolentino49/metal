// Rutas adicionales para el backend (agregar a server.js)

// Obtener herramientas por tipo de mantenimiento
app.get('/api/mantenimiento/herramientas/preventivo', async (req, res) => {
    try {
        const result = await mantenimientoPool.query(
            'SELECT * FROM herramientas_mantenimiento WHERE mantenimiento_preventivo = true ORDER BY nombre ASC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener herramientas de mantenimiento preventivo:', error);
        res.status(500).json({ error: 'Error al obtener las herramientas de mantenimiento preventivo' });
    }
});

app.get('/api/mantenimiento/herramientas/correctivo', async (req, res) => {
    try {
        const result = await mantenimientoPool.query(
            'SELECT * FROM herramientas_mantenimiento WHERE mantenimiento_correctivo = true ORDER BY nombre ASC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener herramientas de mantenimiento correctivo:', error);
        res.status(500).json({ error: 'Error al obtener las herramientas de mantenimiento correctivo' });
    }
});

// Actualizar tipo de mantenimiento de una herramienta
app.patch('/api/mantenimiento/herramientas/:id/tipo-mantenimiento', async (req, res) => {
    try {
        const { id } = req.params;
        const { mantenimiento_preventivo, mantenimiento_correctivo } = req.body;
        
        // Validar que al menos uno de los tipos esté marcado
        if (!mantenimiento_preventivo && !mantenimiento_correctivo) {
            return res.status(400).json({ error: 'Debe seleccionar al menos un tipo de mantenimiento' });
        }
        
        const result = await mantenimientoPool.query(
            `UPDATE herramientas_mantenimiento 
             SET mantenimiento_preventivo = $1, mantenimiento_correctivo = $2, ultima_modificacion = NOW() 
             WHERE id = $3 
             RETURNING *`,
            [mantenimiento_preventivo, mantenimiento_correctivo, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Herramienta no encontrada' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar tipo de mantenimiento:', error);
        res.status(500).json({ error: 'Error al actualizar el tipo de mantenimiento' });
    }
});

// Obtener estadísticas de uso por tipo de mantenimiento
app.get('/api/mantenimiento/herramientas/estadisticas-tipo', async (req, res) => {
    try {
        const result = await mantenimientoPool.query(`
            SELECT 
                h.id,
                h.nombre,
                h.descripcion,
                h.mantenimiento_preventivo,
                h.mantenimiento_correctivo,
                COUNT(t.id) as total_uso,
                COUNT(CASE WHEN t.urgency = 'completed' THEN 1 END) as tickets_completados
            FROM herramientas_mantenimiento h
            LEFT JOIN tickets_mantenimiento t ON h.id = t.id_herramienta
            GROUP BY h.id, h.nombre, h.descripcion, h.mantenimiento_preventivo, h.mantenimiento_correctivo
            ORDER BY total_uso DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener estadísticas de herramientas por tipo:', error);
        res.status(500).json({ error: 'Error al obtener las estadísticas' });
    }
});

// Obtener herramientas disponibles filtradas por tipo
app.get('/api/mantenimiento/herramientas/disponibles/:tipo', async (req, res) => {
    try {
        const { tipo } = req.params;
        let query;
        
        switch (tipo) {
            case 'preventivo':
                query = 'SELECT * FROM herramientas_mantenimiento WHERE estado = \'disponible\' AND mantenimiento_preventivo = true ORDER BY nombre ASC';
                break;
            case 'correctivo':
                query = 'SELECT * FROM herramientas_mantenimiento WHERE estado = \'disponible\' AND mantenimiento_correctivo = true ORDER BY nombre ASC';
                break;
            case 'ambos':
                query = 'SELECT * FROM herramientas_mantenimiento WHERE estado = \'disponible\' AND (mantenimiento_preventivo = true OR mantenimiento_correctivo = true) ORDER BY nombre ASC';
                break;
            default:
                return res.status(400).json({ error: 'Tipo de mantenimiento inválido' });
        }
        
        const result = await mantenimientoPool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener herramientas disponibles por tipo:', error);
        res.status(500).json({ error: 'Error al obtener las herramientas disponibles' });
    }
}); 