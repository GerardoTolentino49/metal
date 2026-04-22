const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuración de la base de datos
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432,
});

async function addColumns() {
  try {
    console.log('📊 Conectando a la base de datos...');
    
    const sqlFile = path.join(__dirname, 'database', 'add_orden_logeo_columns.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    console.log('💾 Ejecutando script SQL...');
    await pool.query(sql);
    
    console.log('✅ Columnas agregadas exitosamente a la tabla usuarios:');
    console.log('   - orden_logeo (VARCHAR 255)');
    console.log('   - estado_en_orden (VARCHAR 50)');
    console.log('   - inicio_sesion (TIMESTAMP)');
    
    // Verificar que las columnas existen
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'usuarios' 
      AND column_name IN ('orden_logeo', 'estado_en_orden', 'inicio_sesion')
      ORDER BY column_name;
    `);
    
    console.log('\n📋 Verificación de columnas:');
    result.rows.forEach(row => {
      console.log(`   ✓ ${row.column_name} (${row.data_type})`);
    });
    
    pool.end();
    console.log('\n✨ ¡Proceso completado!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    pool.end();
    process.exit(1);
  }
}

addColumns();
