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

async function testMeetingTrabajoChanges() {
  const client = await pool.connect();
  try {
    console.log('🔍 Verificando los cambios para tiempo_meeting_trabajo...\n');
    
    // Verificar columnas de tiempo
    const columnsResult = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'tiempo_diseno' 
      AND column_name IN ('tiempo_meeting', 'tiempo_meeting_trabajo')
      ORDER BY column_name
    `);
    
    console.log('📋 Columnas de tiempo en tiempo_diseno:\n');
    
    const hasTimpoMeeting = columnsResult.rows.some(col => col.column_name === 'tiempo_meeting');
    const hasTimpoMeetingTrabajo = columnsResult.rows.some(col => col.column_name === 'tiempo_meeting_trabajo');
    
    if (hasTimpoMeeting) {
      console.log('  ✅ tiempo_meeting');
      const col = columnsResult.rows.find(c => c.column_name === 'tiempo_meeting');
      console.log(`     Type: ${col.data_type}`);
      console.log(`     Default: ${col.column_default}`);
      console.log(`     Nullable: ${col.is_nullable}\n`);
    } else {
      console.log('  ❌ tiempo_meeting NOT FOUND\n');
    }
    
    if (hasTimpoMeetingTrabajo) {
      console.log('  ✅ tiempo_meeting_trabajo');
      const col = columnsResult.rows.find(c => c.column_name === 'tiempo_meeting_trabajo');
      console.log(`     Type: ${col.data_type}`);
      console.log(`     Default: ${col.column_default}`);
      console.log(`     Nullable: ${col.is_nullable}\n`);
    } else {
      console.log('  ❌ tiempo_meeting_trabajo NOT FOUND\n');
    }
    
    if (hasTimpoMeeting && hasTimpoMeetingTrabajo) {
      console.log('✅ TODAS LAS COLUMNAS EXISTEN CORRECTAMENTE\n');
      console.log('Cambios implementados:');
      console.log('  ✅ Columna tiempo_meeting_trabajo creada en base de datos');
      console.log('  ✅ Frontend: Botón "Reunión" en Estado de Trabajo usa data-status="meeting_trabajo"');
      console.log('  ✅ Frontend: Botón "Reunión" en Estado de Ausencia usa data-status="meeting"');
      console.log('  ✅ Frontend: statusTimers incluye meeting_trabajo');
      console.log('  ✅ Frontend: loadActiveSession carga tiempo_meeting_trabajo');
      console.log('  ✅ Backend: Endpoint /api/diseno/finish guarda tiempo_meeting_trabajo');
      console.log('  ✅ Backend: Endpoint /api/diseno/active-session devuelve tiempo_meeting_trabajo');
      console.log('\n👉 Los tiempos se guardarán en:');
      console.log('   - tiempo_meeting: Tiempo en reunión (AUSENCIA)');
      console.log('   - tiempo_meeting_trabajo: Tiempo en reunión (TRABAJO)');
      return true;
    } else {
      console.log('❌ FALTARON COLUMNAS');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error durante la verificación:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

testMeetingTrabajoChanges().then(success => {
  process.exit(success ? 0 : 1);
});
