const db = require('./config');

// Obtener empleado por ID
const getEmpleadoById = async (id) => {
    try {
        const result = await db.query(
            'SELECT * FROM empleados WHERE id = $1',
            [id]
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error al obtener empleado:', error);
        throw error;
    }
};

// Obtener último apoyo de un empleado
const getUltimoApoyo = async (empleadoId) => {
    try {
        const result = await db.query(
            'SELECT * FROM apoyos WHERE empleado_id = $1 ORDER BY ultima_modificacion DESC LIMIT 1',
            [empleadoId]
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error al obtener último apoyo:', error);
        throw error;
    }
};

// Actualizar apoyo
const actualizarApoyo = async (apoyoId, datos, username) => {
    try {
        const result = await db.query(
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
        console.error('Error al actualizar apoyo:', error);
        throw error;
    }
};

module.exports = {
    getEmpleadoById,
    getUltimoApoyo,
    actualizarApoyo
}; 