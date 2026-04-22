// Guard de acceso por permisos de tarjetas (tabla: tarjetas_disponibles)
// Objetivo: evitar que un usuario abra páginas "directo" si no tiene permiso.
(function () {
  const pageToPermission = {
    'index.html': 'show_tickets_it',
    'index_mantenimiento.html': 'show_tickets_mantenimiento',
    'vacaciones.html': 'show_vacaciones',
    'amonestacion_supervisor.html': 'show_amonestaciones',
    'pm.html': 'show_proyectos',
    'diseno.html': 'show_diseno',
    'production.html': 'show_produccion',
    'almacen.html': 'show_almacen'
    // Agrega aquí más páginas si luego habilitas más tarjetas con URLs existentes.
  };

  function getCurrentPage() {
    const p = (window.location.pathname || '').split('/').pop();
    return p || '';
  }

  function getUsernameFromStorage() {
    let username = localStorage.getItem('username');
    if (username) return username;

    const raw = localStorage.getItem('loggedInUser');
    if (!raw) return '';
    try {
      const user = JSON.parse(raw);
      return (user && (user.employeeNumber || user.username || user.name)) ? String(user.employeeNumber || user.username || user.name) : '';
    } catch (_) {
      return '';
    }
  }

  async function runGuard() {
    const currentPage = getCurrentPage();
    const permissionKey = pageToPermission[currentPage];
    if (!permissionKey) return; // página no protegida por tarjetas_disponibles

    const username = getUsernameFromStorage();
    if (!username) {
      // Sin sesión → mandar a login
      window.location.replace('login.html');
      return;
    }

    try {
      const res = await fetch(`/api/tarjetas-disponibles?username=${encodeURIComponent(username)}`, {
        credentials: 'same-origin'
      });

      if (!res.ok) {
        // Si falla la verificación, por seguridad mandamos al selector.
        window.location.replace('selector.html');
        return;
      }

      const data = await res.json();
      const permisos = (data && data.tarjetas) ? data.tarjetas : null;
      const allowed = permisos && permisos[permissionKey] === true;

      if (!allowed) {
        alert('No tienes permiso para acceder a esta página.');
        window.location.replace('selector.html');
      }
    } catch (e) {
      // En error de red/JS, mandamos al selector (fail-closed)
      window.location.replace('selector.html');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runGuard, { once: true });
  } else {
    runGuard();
  }
})();


