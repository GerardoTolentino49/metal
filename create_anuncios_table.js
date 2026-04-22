const { Pool } = require('pg');

async function createAnunciosTable() {
  const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'apoyos_db',
    password: 'phoenix123',
    port: 5432
  });
  
  try {
    const client = await pool.connect();
    console.log('Conectado a la base de datos apoyos_db');
    
    // Crear la tabla anuncios
    await client.query(`
      CREATE TABLE IF NOT EXISTS anuncios (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255),
        imagen_url VARCHAR(500) NOT NULL,
        activo BOOLEAN DEFAULT true,
        fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fecha_fin TIMESTAMP,
        creado_por VARCHAR(100),
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        orden INTEGER DEFAULT 0
      );
    `);
    
    console.log('Tabla anuncios creada exitosamente');
    
    // Crear índices
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anuncios_activo ON anuncios(activo);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anuncios_fecha_inicio ON anuncios(fecha_inicio);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anuncios_orden ON anuncios(orden);`);
    
    console.log('Índices creados exitosamente');
    
    client.release();
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

createAnunciosTable();
