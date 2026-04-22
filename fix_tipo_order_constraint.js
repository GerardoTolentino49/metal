const { Pool } = require('pg');

const apoyosPool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432,
  ssl: false
});

async function fixConstraint() {
  try {
    console.log('🔧 Iniciando corrección de constraint tipo en faltas_retardos...');
    
    // Eliminar constraint antiguo
    console.log('\n📋 Eliminando constraint antiguo...');
    try {
      await apoyosPool.query(`ALTER TABLE faltas_retardos DROP CONSTRAINT IF EXISTS faltas_retardos_tipo_check CASCADE;`);
      console.log('✅ Constraint anterior eliminado');
    } catch (err) {
      console.log('ℹ️  No había constraint anterior o ya estaba eliminado');
    }
    
    // Agregar nueva restricción con ambas combinaciones permitidas
    console.log('\n🔐 Agregando constraint actualizado...');
    await apoyosPool.query(`
      ALTER TABLE faltas_retardos 
      ADD CONSTRAINT faltas_retardos_tipo_check 
      CHECK (tipo IN ('falta', 'retardo', 'tiempo_extra', 'retardo, tiempo_extra', 'tiempo_extra, retardo'));
    `);
    console.log('✅ Constraint actualizado con ambas combinaciones:');
    console.log('   - falta');
    console.log('   - retardo');
    console.log('   - tiempo_extra');
    console.log('   - retardo, tiempo_extra');
    console.log('   - tiempo_extra, retardo');
    
    // Verificar la estructura final
    console.log('\n🔍 Verificando constraint...');
    const verify = await apoyosPool.query(`
      SELECT constraint_name, check_clause
      FROM information_schema.check_constraints
      WHERE constraint_name = 'faltas_retardos_tipo_check'
    `);
    
    if (verify.rows.length > 0) {
      console.log('✅ Constraint verificado:');
      console.log('   Check:', verify.rows[0].check_clause);
    }
    
    // Mostrar valores actuales
    console.log('\n📊 Valores actuales en tipo:');
    const valores = await apoyosPool.query(`
      SELECT DISTINCT tipo, COUNT(*) as cantidad
      FROM faltas_retardos
      GROUP BY tipo
      ORDER BY tipo
    `);
    
    if (valores.rows.length > 0) {
      console.table(valores.rows);
    }
    
    console.log('\n✅ ¡Migración completada exitosamente!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await apoyosPool.end();
  }
}

fixConstraint();
