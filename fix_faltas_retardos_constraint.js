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
    console.log('🔧 Iniciando corrección de constraint en faltas_retardos...');
    
    // 1. Buscar y eliminar constraint CHECK antiguo relacionado con "tipo"
    console.log('\n📋 Buscando constraints antiguos...');
    const checkConstraints = await apoyosPool.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'faltas_retardos' 
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%tipo%'
    `);
    
    if (checkConstraints.rows.length > 0) {
      console.log(`✅ Se encontraron ${checkConstraints.rows.length} constraint(s) a eliminar:`);
      for (const constraint of checkConstraints.rows) {
        console.log(`   - ${constraint.constraint_name}`);
        try {
          await apoyosPool.query(`ALTER TABLE faltas_retardos DROP CONSTRAINT IF EXISTS ${constraint.constraint_name} CASCADE;`);
          console.log(`   ✅ Constraint "${constraint.constraint_name}" eliminado`);
        } catch (err) {
          console.error(`   ❌ Error al eliminar constraint "${constraint.constraint_name}":`, err.message);
        }
      }
    } else {
      console.log('ℹ️  No se encontraron constraints antiguos');
    }
    
    // 2. Cambiar el tamaño de la columna tipo
    console.log('\n📏 Actualizando tamaño de columna tipo...');
    await apoyosPool.query(`ALTER TABLE faltas_retardos ALTER COLUMN tipo TYPE VARCHAR(50);`);
    console.log('✅ Columna tipo actualizada a VARCHAR(50)');
    
    // 3. Agregar nueva restricción con todos los valores permitidos
    console.log('\n🔐 Agregando nuevo constraint con valores permitidos...');
    await apoyosPool.query(`
      ALTER TABLE faltas_retardos 
      ADD CONSTRAINT faltas_retardos_tipo_check 
      CHECK (tipo IN ('falta', 'retardo', 'tiempo_extra', 'retardo, tiempo_extra', 'tiempo_extra, retardo'));
    `);
    console.log('✅ Constraint faltas_retardos_tipo_check agregado');
    
    // 4. Verificar la estructura final
    console.log('\n🔍 Verificando estructura final...');
    const verifyConstraints = await apoyosPool.query(`
      SELECT constraint_name, check_clause
      FROM information_schema.check_constraints
      WHERE constraint_name = 'faltas_retardos_tipo_check'
    `);
    
    if (verifyConstraints.rows.length > 0) {
      console.log('✅ Verificación exitosa:');
      console.log('   Constraint:', verifyConstraints.rows[0].constraint_name);
      console.log('   Check clause:', verifyConstraints.rows[0].check_clause);
    }
    
    // 5. Mostrar valores distintos en la tabla
    console.log('\n📊 Valores actuales de tipo en la tabla:');
    const valores = await apoyosPool.query(`
      SELECT DISTINCT tipo, COUNT(*) as cantidad
      FROM faltas_retardos
      GROUP BY tipo
      ORDER BY tipo
    `);
    
    if (valores.rows.length > 0) {
      console.table(valores.rows);
    } else {
      console.log('   (No hay registros en la tabla)');
    }
    
    console.log('\n✅ ¡Migración completada exitosamente!');
    console.log('   Ahora puedes insertar registros con tipo: falta, retardo, tiempo_extra, retardo, tiempo_extra');
    
  } catch (error) {
    console.error('\n❌ Error durante la migración:', error.message);
    console.error(error.stack);
  } finally {
    await apoyosPool.end();
  }
}

fixConstraint();
