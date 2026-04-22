// Verificar autenticación
async function checkAuth() {
  const username = localStorage.getItem('username');
  const userInfo = document.getElementById('userInfo');
  
  if (!username) {
        window.location.href = 'login.html';
        return;
    }

    try {
        // Usar la función centralizada para verificar permisos
        const data = await verificarPermisosCentral();
        if (!data) {
            console.error('No se pudo obtener los datos de permisos');
            return;
        }

  // Mostrar información del usuario
        if (userInfo) {
            userInfo.textContent = data.user.nombre_completo || data.user.username;
        }

        // Mostrar la foto del usuario en el icono (si existe)
        const userIcon = document.getElementById('userIcon');
        if (userIcon && data.user.foto_url) {
            // Limpiar el contenido anterior (ícono de Font Awesome)
            userIcon.innerHTML = '';
            // Crear elemento img para la foto
            const img = document.createElement('img');
            img.src = data.user.foto_url;
            img.alt = data.user.nombre_completo;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            userIcon.appendChild(img);
        }

        // Actualizar la interfaz según permisos
        await actualizarInterfazPermisos();

    } catch (error) {
        console.error('Error al verificar permisos:', error);
        // No redirigir inmediatamente, solo mostrar el error
        if (userInfo) {
            userInfo.textContent = 'Error al cargar permisos';
        }
    }
}

// Ejecutar checkAuth cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', checkAuth);

// Función para establecer el tema oscuro por defecto
function setDarkTheme() {
  document.documentElement.setAttribute('data-theme', 'dark');
  localStorage.setItem('theme', 'dark');
}

// Función para manejar el cierre de sesión
function initLogout() {
  const logoutButton = document.getElementById('logoutButton');
  logoutButton.addEventListener('click', function() {
    // Limpiar datos de sesión
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('username');
    // Redirigir al login
    window.location.href = 'login.html';
  });
}

// Inicializar todo cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', async function() {
  setDarkTheme();
  initLogout();
}); 