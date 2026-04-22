const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'apoyos_db',
    password: 'postgres',
    port: 5432,
});

// Función para actualizar un apoyo
async function actualizarApoyo(empleadoId, datos, username) {
    try {
        // Obtener el ID del último apoyo del empleado
        const apoyoResult = await pool.query(
            'SELECT id FROM apoyos WHERE empleado_id = $1 ORDER BY ultima_modificacion DESC LIMIT 1',
            [empleadoId]
        );

        if (apoyoResult.rows.length === 0) {
            throw new Error('No se encontró ningún apoyo para este empleado');
        }

        const apoyoId = apoyoResult.rows[0].id;

        // Actualizar el apoyo
        const result = await pool.query(
            `UPDATE apoyos 
             SET descripcion = $1,
                 estatus_material = $2,
                 fecha_salida_herramienta = $3,
                 fecha_regreso_herramienta = $4,
                 notas = $5,
                 ultima_modificacion = CURRENT_TIMESTAMP,
                 modificado_por = $6
             WHERE id = $7
             RETURNING *`,
            [
                datos.descripcion,
                datos.estatus_material,
                datos.fecha_salida_herramienta,
                datos.fecha_regreso_herramienta,
                datos.notas,
                username,
                apoyoId
            ]
        );

        return result.rows[0];
    } catch (error) {
        console.error('Error al actualizar el apoyo:', error);
        throw error;
    }
}

// Exportar la función para uso directo
module.exports = actualizarApoyo; 