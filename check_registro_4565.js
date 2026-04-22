const { Pool } = require('pg');

const apoyosPool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432,
  ssl: false
});

async function verificarDatos() {
  try {
    console.log('📋 Consultando registros del empleado 4565 en 2026-02-08...\n');
    
    const result = await apoyosPool.query(`
      SELECT 
        id, 
        empleado_id, 
        tipo, 
        fecha, 
        hora, 
        hora_salida, 
        tiempo_retardo, 
        tiempo_extra
      FROM faltas_retardos 
      WHERE empleado_id = 4565 
      AND fecha = '2026-02-08'
      ORDER BY id DESC 
      LIMIT 10
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No se encontraron registros');
      return;
    }
    
    console.log(`✅ Se encontraron ${result.rows.length} registro(s):\n`);
    console.table(result.rows);
    
    console.log('\n📊 Análisis de tipos encontrados:');
    result.rows.forEach((row, idx) => {
      console.log(`  Registro ${idx + 1}: tipo = "${row.tipo}"`);
      console.log(`    - Retardo: ${row.tiempo_retardo}`);
      console.log(`    - Extra: ${row.tiempo_extra}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await apoyosPool.end();
  }
}

verificarDatos();
