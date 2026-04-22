const { Pool } = require('pg');

// Configuración de la base de datos
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432,
});

async function testUpdate() {
  try {
    console.log('🔍 Diagnóstico de actualización de usuarios\n');
    
    // Listar usuarios existentes
    console.log('1️⃣ Usuarios en la tabla:');
    const users = await pool.query('SELECT id, username, nombre_completo FROM usuarios ORDER BY id LIMIT 10');
    users.rows.forEach(u => {
      console.log(`   ID: ${u.id} | Username: "${u.username}" | Nombre: ${u.nombre_completo}`);
    });
    
    if (users.rows.length === 0) {
      console.log('   ⚠️  No hay usuarios en la tabla');
      pool.end();
      return;
    }
    
    // Verificar columnas
    console.log('\n2️⃣ Verificando columnas necesarias:');
    const columns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'usuarios' 
      AND column_name IN ('orden_en_logeo', 'estado_en_orden', 'inicio_sesion')
    `);
    
    const requiredCols = ['orden_en_logeo', 'estado_en_orden', 'inicio_sesion'];
    const existingCols = columns.rows.map(r => r.column_name);
    
    requiredCols.forEach(col => {
      if (existingCols.includes(col)) {
        console.log(`   ✅ ${col}`);
      } else {
        console.log(`   ❌ ${col} - FALTA`);
      }
    });
    
    // Intentar actualización de prueba con el primer usuario
    const testUser = users.rows[0];
    console.log(`\n3️⃣ Probando actualización con usuario: "${testUser.username}"`);
    
    const updateResult = await pool.query(
      `UPDATE usuarios 
       SET orden_en_logeo = $1, 
           estado_en_orden = $2,
           inicio_sesion = NOW()
       WHERE username = $3
       RETURNING username, orden_en_logeo, estado_en_orden, inicio_sesion`,
      ['TEST-ORDER-123', 'Activo', testUser.username]
    );
    
    if (updateResult.rowCount > 0) {
      console.log('   ✅ Actualización exitosa:');
      console.log('      ', updateResult.rows[0]);
    } else {
      console.log('   ❌ No se actualizó ninguna fila');
    }
    
    // Verificar los datos guardados
    console.log('\n4️⃣ Verificando datos guardados:');
    const verify = await pool.query(
      `SELECT username, orden_en_logeo, estado_en_orden, inicio_sesion 
       FROM usuarios 
       WHERE username = $1`,
      [testUser.username]
    );
    
    if (verify.rows.length > 0) {
      console.log('   📋 Datos en BD:');
      console.log('      Username:', verify.rows[0].username);
      console.log('      Orden Logeo:', verify.rows[0].orden_en_logeo);
      console.log('      Estado:', verify.rows[0].estado_en_orden);
      console.log('      Inicio Sesión:', verify.rows[0].inicio_sesion);
    }
    
    // Limpiar datos de prueba
    console.log('\n5️⃣ Limpiando datos de prueba...');
    await pool.query(
      `UPDATE usuarios 
       SET orden_en_logeo = NULL, 
           estado_en_orden = NULL,
           inicio_sesion = NULL
       WHERE username = $1`,
      [testUser.username]
    );
    console.log('   ✅ Limpieza completada');
    
    pool.end();
    console.log('\n✨ Diagnóstico completado');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    pool.end();
    process.exit(1);
  }
}

testUpdate();
