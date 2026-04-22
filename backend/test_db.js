const { Pool } = require('pg');
const dbConfig = require('./config');

async function testConnection() {
  const pool = new Pool(dbConfig);
  
  try {
    const client = await pool.connect();
    console.log('Conexión exitosa a la base de datos');
    
    // Verificar si la tabla tickets existe
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'tickets'
      );
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('La tabla tickets existe');
      
      // Contar registros en la tabla
      const count = await client.query('SELECT COUNT(*) FROM tickets');
      console.log(`Número de tickets en la base de datos: ${count.rows[0].count}`);
    } else {
      console.log('La tabla tickets NO existe');
    }
    
    client.release();
  } catch (err) {
    console.error('Error al conectar con la base de datos:', err);
  } finally {
    await pool.end();
  }
}

testConnection(); 