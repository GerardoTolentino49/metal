// Función para inicializar las funcionalidades del topbar
function initializeTopbar() {
  // Agregar event listeners para los submenús
  const menuItems = document.querySelectorAll('.menu-item.has-submenu');
  
  menuItems.forEach(item => {
    const submenu = item.querySelector('.submenu');
    const arrow = item.querySelector('.submenu-arrow');
    
    item.addEventListener('click', function(e) {
      // Solo si el clic es en el propio botón, no en el submenú
      if (e.target.closest('.submenu')) return;
      e.preventDefault();
      e.stopPropagation();

      // Cerrar otros submenús primero
      menuItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.querySelector('.submenu').classList.remove('active');
          const otherArrow = otherItem.querySelector('.submenu-arrow');
          if (otherArrow) otherArrow.style.transform = 'rotate(0deg)';
        }
      });
      
      // Toggle del submenu actual
      if (submenu) {
        submenu.classList.toggle('active');
        if (arrow) {
          arrow.style.transform = submenu.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
        }
      }
    });
  });

  // Cerrar submenús al hacer clic fuera
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-item.has-submenu') && !e.target.closest('.submenu')) {
      menuItems.forEach(item => {
        item.querySelector('.submenu').classList.remove('active');
        const arrow = item.querySelector('.submenu-arrow');
        if (arrow) arrow.style.transform = 'rotate(0deg)';
      });
    }
  });

  // Highlight
  function moverHighlight() {
    const topbar = document.querySelector('.topbar');
    const highlight = topbar.querySelector('.glass-highlight');
    const btnSel = topbar.querySelector('.menu-item.selected');
    if (!btnSel) return;
    const rectTopbar = topbar.getBoundingClientRect();
    const rectBtn = btnSel.getBoundingClientRect();
    const left = rectBtn.left - rectTopbar.left;
    highlight.style.left = left + 'px';
    highlight.style.width = rectBtn.width + 'px';
  }

  function addChromaticEffect(element) {
    // efecto desactivado
  }

  document.querySelectorAll('.menu-item').forEach(button => {
    button.addEventListener('click', function() {
      document.querySelectorAll('.menu-item.selected').forEach(b => b.classList.remove('selected'));
      this.classList.add('selected');
      moverHighlight();
    });
  });

  const userIcon = document.getElementById('userIcon');
  if (userIcon) {
    userIcon.addEventListener('click', function() {
      // efecto desactivado
    });
  }

  // Botones cromáticos (animación desactivada)
  document.querySelectorAll('.lisa-btn-cromatica').forEach(btn => {
    btn.addEventListener('click', function() {
      // animación desactivada
    });
  });

  // Navegación del botón TILIN
  document.querySelectorAll('.lisa-btn-cromatica').forEach(btn => {
    btn.addEventListener('click', function() {
      window.location.href = 'inicio.html';
    });
  });

  // Funciones de contraste
  function getContrastYIQ(hexcolor) {
    hexcolor = hexcolor.replace('#', '');
    if (hexcolor.length === 3) {
      hexcolor = hexcolor[0]+hexcolor[0]+hexcolor[1]+hexcolor[1]+hexcolor[2]+hexcolor[2];
    }
    var r = parseInt(hexcolor.substr(0,2),16);
    var g = parseInt(hexcolor.substr(2,2),16);
    var b = parseInt(hexcolor.substr(4,2),16);
    var yiq = ((r*299)+(g*587)+(b*114))/1000;
    return (yiq >= 128) ? 'dark' : 'light';
  }

  function updateTopbarContrast() {
    // Detecta el color de fondo real de la topbar
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    let bg = window.getComputedStyle(topbar).backgroundColor;
    // Convierte a hex
    function rgb2hex(rgb) {
      if (!rgb) return '#fff';
      let result = rgb.match(/rgba?\((\d+), (\d+), (\d+), (\d+)\)/);
      if (!result) return '#fff';
      return '#' +
        (parseInt(result[1]).toString(16).padStart(2, '0')) + (parseInt(result[2]).toString(16).padStart(2, '0')) + (parseInt(result[3]).toString(16).padStart(2, '0'));
    }
    let hex = rgb2hex(bg);
    let contrast = getContrastYIQ(hex);
    // Aplica el data-contrast a los elementos del menú
    document.querySelectorAll('.menu-item, .submenu-item, .topbar-header h1, .lisa-btn-cromatica').forEach(el => {
      el.setAttribute('data-contrast', contrast);
    });
  }

  // Ejecuta al cargar y al cambiar el tema
  updateTopbarContrast();
  window.addEventListener('resize', updateTopbarContrast);

  // Inicializar highlight después de un breve delay
  setTimeout(() => {
    moverHighlight();
  }, 100);

  // Logout (botón visible junto a la foto)
  (function initLogoutButton() {
    const logoutButton = document.getElementById('logoutButton');
    if (!logoutButton) return;
    if (logoutButton.dataset.logoutBound === '1') return;
    logoutButton.dataset.logoutBound = '1';

    logoutButton.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

      // Limpiar datos de sesión
      localStorage.removeItem('isLoggedIn');
      localStorage.removeItem('username');
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('loggedInUser');
      localStorage.removeItem('rol');
      localStorage.removeItem('permissions');
      localStorage.removeItem('userId');

      window.location.href = 'login.html';
    });
  })();
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTopbar);
} else {
  initializeTopbar();
}
