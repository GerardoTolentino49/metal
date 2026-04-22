const { Pool } = require('pg');

// Configuración de la base de datos
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432,
});

async function checkColumns() {
  try {
    console.log('📊 Verificando columnas en la tabla usuarios...\n');
    
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'usuarios'
      ORDER BY ordinal_position;
    `);
    
    console.log('Columnas existentes en la tabla usuarios:');
    console.log('==========================================');
    
    const targetColumns = ['orden_en_logeo', 'estado_en_orden', 'inicio_sesion'];
    let allExist = true;
    
    result.rows.forEach(row => {
      const isTarget = targetColumns.includes(row.column_name);
      const mark = isTarget ? '🎯' : '  ';
      console.log(`${mark} ${row.column_name.padEnd(25)} | ${row.data_type.padEnd(30)} | ${row.is_nullable}`);
      
      if (isTarget) {
        targetColumns.splice(targetColumns.indexOf(row.column_name), 1);
      }
    });
    
    console.log('\n');
    
    if (targetColumns.length > 0) {
      console.log('❌ FALTAN LAS SIGUIENTES COLUMNAS:');
      targetColumns.forEach(col => {
        console.log(`   - ${col}`);
      });
      console.log('\n⚠️  Ejecuta: node add_usuario_columns.js');
      allExist = false;
    } else {
      console.log('✅ Todas las columnas necesarias existen');
    }
    
    // Verificar si hay usuarios en la tabla
    const usersResult = await pool.query('SELECT username FROM usuarios LIMIT 5');
    console.log('\n📋 Usuarios en la tabla (primeros 5):');
    if (usersResult.rows.length > 0) {
      usersResult.rows.forEach(row => {
        console.log(`   - ${row.username}`);
      });
    } else {
      console.log('   ⚠️  No hay usuarios en la tabla');
    }
    
    pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    pool.end();
    process.exit(1);
  }
}

checkColumns();
