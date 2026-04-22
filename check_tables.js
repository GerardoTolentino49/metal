const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432
});

async function checkTables() {
  try {
    // Verificar if proyectos exists
    const proyectosCheck = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'proyectos'
      ) as table_exists
    `);
    
    console.log('Tabla proyectos existe:', proyectosCheck.rows[0].table_exists);
    
    // Verificar if ordenes exists
    const ordenesCheck = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'ordenes'
      ) as table_exists
    `);
    
    console.log('Tabla ordenes existe:', ordenesCheck.rows[0].table_exists);
    
    // Try a simple query
    if (proyectosCheck.rows[0].table_exists) {
      const proyectosCount = await pool.query('SELECT COUNT(*) FROM proyectos');
      console.log('Número de proyectos:', proyectosCount.rows[0].count);
    }
    
    if (ordenesCheck.rows[0].table_exists) {
      const ordenesCount = await pool.query('SELECT COUNT(*) FROM ordenes');
      console.log('Número de órdenes:', ordenesCount.rows[0].count);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkTables();
