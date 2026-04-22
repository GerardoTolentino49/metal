const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432
});

async function checkTipoValues() {
  try {
    // Check existing values for tipo
    const result = await pool.query(`
      SELECT DISTINCT tipo 
      FROM tiempo_diseno 
      WHERE tipo IS NOT NULL
      LIMIT 10
    `);
    
    console.log('Valores existentes de "tipo" en tiempo_diseno:');
    console.log(JSON.stringify(result.rows, null, 2));
    
    // Check if there's a constraint on tipo
    const constraintResult = await pool.query(`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'tiempo_diseno'
      AND con.conname LIKE '%tipo%'
    `);
    
    console.log('\nConstraints relacionados con "tipo":');
    console.log(JSON.stringify(constraintResult.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkTipoValues();
