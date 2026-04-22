// Utilidades para formateo de fechas en español
// Archivo global para ser reutilizado en toda la aplicación

/**
 * Formatea una fecha en formato español: "1 de enero del 2025"
 * @param {string|Date} fecha - La fecha a formatear
 * @returns {string} - Fecha formateada en español
 */
function formatearFechaEspanol(fecha) {
    try {
        if (!fecha) return 'Fecha no disponible';
        
        const fechaObj = new Date(fecha);
        if (isNaN(fechaObj.getTime())) return 'Fecha inválida';
        
        const dia = fechaObj.getDate();
        const mes = fechaObj.toLocaleDateString('es-ES', { month: 'long' });
        const año = fechaObj.getFullYear();
        
        return `${dia} de ${mes} del ${año}`;
    } catch (error) {
        console.error('Error formateando fecha:', error);
        return 'Error en fecha';
    }
}

/**
 * Formatea una fecha con hora en formato español: "1 de enero del 2025, 12:06:01 p.m."
 * @param {string|Date} fecha - La fecha a formatear
 * @returns {string} - Fecha con hora formateada en español
 */
function formatearFechaHoraEspanol(fecha) {
    try {
        if (!fecha) return 'Fecha no disponible';
        
        const fechaObj = new Date(fecha);
        if (isNaN(fechaObj.getTime())) return 'Fecha inválida';
        
        const dia = fechaObj.getDate();
        const mes = fechaObj.toLocaleDateString('es-ES', { month: 'long' });
        const año = fechaObj.getFullYear();
        const hora = fechaObj.toLocaleTimeString('es-ES', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: true 
        });
        
        return `${dia} de ${mes} del ${año}, ${hora}`;
    } catch (error) {
        console.error('Error formateando fecha con hora:', error);
        return 'Error en fecha';
    }
}

/**
 * Formatea una fecha corta en español: "1 ene 2025"
 * @param {string|Date} fecha - La fecha a formatear
 * @returns {string} - Fecha corta formateada en español
 */
function formatearFechaCortaEspanol(fecha) {
    try {
        if (!fecha) return 'Fecha no disponible';
        
        const fechaObj = new Date(fecha);
        if (isNaN(fechaObj.getTime())) return 'Fecha inválida';
        
        const dia = fechaObj.getDate();
        const mes = fechaObj.toLocaleDateString('es-ES', { month: 'short' });
        const año = fechaObj.getFullYear();
        
        return `${dia} ${mes} ${año}`;
    } catch (error) {
        console.error('Error formateando fecha corta:', error);
        return 'Error en fecha';
    }
}
