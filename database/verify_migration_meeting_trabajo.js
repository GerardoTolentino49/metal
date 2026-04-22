#!/usr/bin/env node

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'phoenix123',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'apoyos_db'
});

async function verifyMigration() {
  const client = await pool.connect();
  try {
    console.log('🔍 Verificando columnas de tiempo_diseno...\n');
    
    const result = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'tiempo_diseno' 
      AND column_name LIKE 'tiempo_%'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Columnas de tiempo en tiempo_diseno:');
    console.table(result.rows);
    
    // Verificar específicamente por tiempo_meeting_trabajo
    const meetingTrabajo = result.rows.find(col => col.column_name === 'tiempo_meeting_trabajo');
    if (meetingTrabajo) {
      console.log('\n✅ Columna tiempo_meeting_trabajo existe correctamente');
      console.log(`   Tipo: ${meetingTrabajo.data_type}`);
      console.log(`   Default: ${meetingTrabajo.column_default}`);
    } else {
      console.log('\n❌ Columna tiempo_meeting_trabajo NO se encontró');
    }
    
  } catch (error) {
    console.error('❌ Error durante la verificación:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

verifyMigration();
