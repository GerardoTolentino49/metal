// Función para mostrar notificaciones
function showNotification(message, type = 'success') {
  // Crear el elemento de notificación
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  // Agregar la notificación al body
  document.body.appendChild(notification);

  // Remover la notificación después de la animación
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Exportar la función
window.showNotification = showNotification; 