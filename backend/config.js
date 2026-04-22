require('dotenv').config();

const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'phoenix123',
    database: process.env.DB_NAME || 'phoenix_tickets',
    port: process.env.DB_PORT || 5432,
    // Agregar opciones adicionales para mejor compatibilidad
    max: 20, // máximo número de clientes en el pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: false
};

// Verificar la conexión
const { Pool } = require('pg');
const pool = new Pool(config);

pool.on('error', (err) => {
    console.error('Error inesperado en el pool de PostgreSQL:', err);
});

// Probar la conexión
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Error al conectar a la base de datos:', err);
    } else {
        console.log('Conexión exitosa a la base de datos. Hora del servidor:', res.rows[0].now);
    }
});

console.log('Configuración de la base de datos:', {
    ...config,
    password: '****' // No mostrar la contraseña en los logs
});

module.exports = config; 