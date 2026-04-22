const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'phoenix123',
  database: process.env.DB_NAME || 'phoenix_tickets',
  port: process.env.DB_PORT || 5432,
  ssl: false
});

async function createComidasTable() {
  try {
    console.log('Iniciando creación de tabla comidas...');
    
    const sqlPath = path.join(__dirname, './database/create_comidas_table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✓ Tabla comidas creada exitosamente');
    
    // Verificar que la tabla existe
    const result = await pool.query(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_name = 'comidas'`
    );
    
    console.log('Estructura de la tabla comidas:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error al crear tabla comidas:', error);
    await pool.end();
    process.exit(1);
  }
}

createComidasTable();
