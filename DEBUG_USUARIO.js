// Script para debuggear el usuario actual y la orden 5090
// Ejecuta esto en la consola del navegador mientras estés en logeo-diseno.html

const debugInfo = async () => {
  // 1. Obtener usuario actual de localStorage
  const userInfo = localStorage.getItem('userInfo');
  const username = localStorage.getItem('username');
  
  console.log('=== INFORMACIÓN DEL USUARIO ACTUAL ===');
  console.log('userInfo desde localStorage:', userInfo);
  console.log('username desde localStorage:', username);
  
  if (userInfo) {
    try {
      const parsed = JSON.parse(userInfo);
      console.log('userInfo parseado:', parsed);
      console.log('ID del usuario actual:', parsed.id || parsed.userId || parsed.user_id);
    } catch (e) {
      console.error('Error al parsear userInfo:', e);
    }
  }
  
  // 2. Obtener la orden 5090 de la API
  console.log('\n=== INFORMACIÓN DE LA ORDEN 5090 ===');
  try {
    const response = await fetch('/api/ordenes');
    const ordenes = await response.json();
    
    const orden5090 = ordenes.find(o => o.order_number === '5090' || o.id === 126);
    
    if (orden5090) {
      console.log('Orden 5090 encontrada:', {
        id: orden5090.id,
        order_number: orden5090.order_number,
        estatus: orden5090.estatus,
        usuario_asignado: orden5090.usuario_asignado,
        fecha_aprobacion: orden5090.fecha_aprobacion
      });
      
      // Verificar si el usuario actual está asignado
      const currentUserInfo = userInfo ? JSON.parse(userInfo) : {};
      const currentUserId = currentUserInfo.id || currentUserInfo.userId;
      
      if (currentUserId) {
        const isAssigned = (orden5090.usuario_asignado || []).includes(currentUserId);
        console.log(`\n¿El usuario actual (ID ${currentUserId}) está asignado a 5090?`, isAssigned);
        
        if (!isAssigned) {
          console.warn(`⚠️ PROBLEMA: El usuario ${currentUserId} NO está en la lista de asignados`);
          console.warn(`Los usuarios asignados son: ${orden5090.usuario_asignado.join(', ')}`);
        }
      } else {
        console.warn('⚠️ No se pudo obtener el ID del usuario actual');
      }
    } else {
      console.error('❌ Orden 5090 no encontrada en la API');
    }
  } catch (error) {
    console.error('Error al obtener órdenes:', error);
  }
};

// Ejecutar
debugInfo();
