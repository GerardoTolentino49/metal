// Función para cargar el topbar dinámicamente
async function loadTopbar() {
  try {
    const response = await fetch('topbar-completo.html');
    const topbarHTML = await response.text();
    
    // Insertar el HTML del topbar
    document.body.insertAdjacentHTML('afterbegin', topbarHTML);
    
    // Cargar scripts adicionales necesarios
    const permisosScript = document.createElement('script');
    permisosScript.src = 'js/permisos.js';
    document.head.appendChild(permisosScript);

    const mobileScript = document.createElement('script');
    mobileScript.src = 'js/mobile-menu.js';
    document.head.appendChild(mobileScript);
    
  } catch (error) {
    console.error('Error al cargar el topbar:', error);
  }
}

document.addEventListener('DOMContentLoaded', loadTopbar);