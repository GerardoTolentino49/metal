#!/usr/bin/env node
/**
 * Script para probar inserciones en la tabla tiempo_diseno
 */

require('dotenv').config();
const { Pool } = require('pg');

// Crear pool de conexión a la BD apoyos
const apoyosPool = new Pool({
  user: process.env.APOYOS_DB_USER || 'postgres',
  password: process.env.APOYOS_DB_PASSWORD || 'phoenix123',
  host: process.env.APOYOS_DB_HOST || 'localhost',
  port: parseInt(process.env.APOYOS_DB_PORT || '5432'),
  database: process.env.APOYOS_DB_NAME || 'apoyos_db'
});

async function testInsert() {
  try {
    console.log('\n🔍 === TEST DE INSERCIÓN EN tiempo_diseno ===\n');

    // 1. Verificar que la tabla existe
    console.log('📋 Paso 1: Verificando estructura de la tabla tiempo_diseno...');
    const tableInfo = await apoyosPool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'tiempo_diseno'
      ORDER BY ordinal_position
    `);

    if (tableInfo.rows.length === 0) {
      console.error('❌ La tabla tiempo_diseno NO EXISTE');
      process.exit(1);
    }

    console.log('✅ Tabla encontrada. Estructura:\n');
    console.table(tableInfo.rows);

    // 2. Intentar un insert
    console.log('\n📝 Paso 2: Intentando insertar un registro de prueba...');
    const testUsername = 'test_user_' + Date.now();
    const testPartNumber = 'PN-TEST-' + Date.now();

    const insertResult = await apoyosPool.query(
      `INSERT INTO tiempo_diseno (username, numero_parte, orden, cliente, tipo, estado, estado_orden, hora_inicio)
       VALUES ($1, $2, $3, $4, 'meeting', 'pendiente', 'En Proceso', NOW())
       RETURNING id, username, numero_parte, hora_inicio, creado_en`,
      [testUsername, testPartNumber, null, null]
    );

    console.log('✅ Insert exitoso!');
    console.log('\n📊 Registro insertado:\n');
    console.table(insertResult.rows[0]);

    // 3. Verificar que se guardó correctamente
    console.log('\n🔎 Paso 3: Verificando que el registro se guardó correctamente...');
    const verifyResult = await apoyosPool.query(
      `SELECT * FROM tiempo_diseno WHERE username = $1 ORDER BY creado_en DESC LIMIT 1`,
      [testUsername]
    );

    if (verifyResult.rows.length > 0) {
      console.log('✅ Registro verificado correctamente!\n');
      console.table(verifyResult.rows[0]);
    } else {
      console.error('❌ El registro NO se encontró después de insertarlo');
    }

    // 4. Contar registros totales
    console.log('\n📈 Paso 4: Estadísticas de la tabla...');
    const statsResult = await apoyosPool.query(
      `SELECT COUNT(*) as total_registros FROM tiempo_diseno`
    );
    console.log(`Total de registros en tiempo_diseno: ${statsResult.rows[0].total_registros}`);

    // 5. Mostrar últimos 5 registros
    console.log('\n📜 Últimos 5 registros insertados:');
    const recentResult = await apoyosPool.query(
      `SELECT id, username, numero_parte, tipo, estado, hora_inicio 
       FROM tiempo_diseno 
       ORDER BY creado_en DESC 
       LIMIT 5`
    );
    console.table(recentResult.rows);

    console.log('\n✅ === TEST COMPLETADO EXITOSAMENTE ===\n');
  } catch (error) {
    console.error('\n❌ Error durante el test:');
    console.error('Mensaje:', error.message);
    console.error('Código:', error.code);
    console.error('Detalles:', error.detail);
    process.exit(1);
  } finally {
    await apoyosPool.end();
  }
}

testInsert();
