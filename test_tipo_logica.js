const { Pool } = require('pg');

const apoyosPool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432,
  ssl: false
});

async function testRegistroCompleto() {
  try {
    console.log('🧪 Prueba de simulación de registro con retardo Y tiempo extra\n');
    
    // Simular lo que vendría del Excel
    const registroExcel = {
      numero_empleado: 4565,
      nombre: 'Test',
      fecha: '2026-02-08',
      clock_in: '06:57',    // 57 minutos de retardo respecto a 08:00
      clock_out: '16:03',   // 3 minutos de tiempo extra respecto a 16:00
      late: '00:57',
      ot: '00:03'
    };
    
    console.log('📋 Datos del Excel simulado:');
    console.table(registroExcel);
    
    // Simular la lógica del backend
    const HORA_ENTRADA_ESTANDAR = 8;
    const HORA_SALIDA_ESTANDAR = 16;
    
    // 1. Formatear horas
    let clockInFormateado = registroExcel.clock_in;
    if (clockInFormateado && !clockInFormateado.includes(':')) {
      // Parsed from Excel time
    } else if (clockInFormateado) {
      clockInFormateado = `${clockInFormateado}:00`;
    }
    
    let clockOutFormateado = registroExcel.clock_out;
    if (clockOutFormateado && !clockOutFormateado.includes(':')) {
      // Parsed from Excel time
    } else if (clockOutFormateado) {
      clockOutFormateado = `${clockOutFormateado}:00`;
    }
    
    let lateFormateado = registroExcel.late;
    let tiempoRetardoCalculado = null;
    
    console.log('\n📐 Horas formateadas:');
    console.log(`  clock_in: ${clockInFormateado}`);
    console.log(`  clock_out: ${clockOutFormateado}`);
    console.log(`  late: ${lateFormateado}`);
    
    // 2. Calcular retardo
    if (lateFormateado && clockInFormateado) {
      const [horaEntrada, minutoEntrada] = clockInFormateado.split(':').map(Number);
      const horaEntradaTotal = horaEntrada * 60 + minutoEntrada;
      const horaBaseTotal = HORA_ENTRADA_ESTANDAR * 60; // 08:00 en minutos
      
      if (horaEntradaTotal > horaBaseTotal) {
        const minutosRetardo = horaEntradaTotal - horaBaseTotal;
        const horasRetardo = Math.floor(minutosRetardo / 60);
        const minsRetardo = minutosRetardo % 60;
        tiempoRetardoCalculado = `${String(horasRetardo).padStart(2, '0')}:${String(minsRetardo).padStart(2, '0')}:00`;
      }
    }
    
    // 3. Calcular tiempo extra
    let tiempoExtraCalculado = null;
    if (clockOutFormateado) {
      const [horasSalida, minutosSalida] = clockOutFormateado.split(':').map(Number);
      const horaSalidaTotal = horasSalida * 60 + minutosSalida;
      const horaBaseTotal = HORA_SALIDA_ESTANDAR * 60; // 16:00 en minutos
      
      if (horaSalidaTotal > horaBaseTotal) {
        const minutosExtra = horaSalidaTotal - horaBaseTotal;
        const horasExtra = Math.floor(minutosExtra / 60);
        const minsExtra = minutosExtra % 60;
        tiempoExtraCalculado = `${String(horasExtra).padStart(2, '0')}:${String(minsExtra).padStart(2, '0')}:00`;
      }
    }
    
    console.log('\n⏱️  Tiempos calculados:');
    console.log(`  tiempoRetardoCalculado: ${tiempoRetardoCalculado}`);
    console.log(`  tiempoExtraCalculado: ${tiempoExtraCalculado}`);
    
    // 4. Determinar tipo
    const tieneRetardo = tiempoRetardoCalculado || lateFormateado || registroExcel.tiempo_retardo;
    const tieneExtra = tiempoExtraCalculado;
    
    let tipoRegistro = 'retardo';
    if (tieneRetardo && tieneExtra) {
      tipoRegistro = 'retardo, tiempo_extra';
    } else if (tieneExtra) {
      tipoRegistro = 'tiempo_extra';
    } else {
      tipoRegistro = 'retardo';
    }
    
    console.log('\n✅ Lógica de determinación de tipo:');
    console.log(`  tieneRetardo: ${!!tieneRetardo} (${tieneRetardo})`);
    console.log(`  tieneExtra: ${!!tieneExtra} (${tieneExtra})`);
    console.log(`  ➜ TIPO FINAL: "${tipoRegistro}"`);
    
    // 5. Validar contra el constraint
    const valoresPermitidos = ['falta', 'retardo', 'tiempo_extra', 'retardo, tiempo_extra', 'tiempo_extra, retardo'];
    const esValido = valoresPermitidos.includes(tipoRegistro);
    
    console.log(`\n🔒 Validación contra constraint:
  Valores permitidos: ${valoresPermitidos.join(', ')}
  Tipo resultante: "${tipoRegistro}"
  ✅ Es válido: ${esValido}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await apoyosPool.end();
  }
}

testRegistroCompleto();
