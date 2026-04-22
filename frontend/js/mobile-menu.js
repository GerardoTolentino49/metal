
document.addEventListener('DOMContentLoaded', function() 
{
  const hamburgerMenu = document.getElementById('hamburgerMenu');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileMenuClose = document.getElementById('mobileMenuClose');
  
  function openMobileMenu() 
  {
    console.log('Opening mobile menu');
    if (mobileMenu) 
      {
      mobileMenu.style.display = 'flex';
      mobileMenu.classList.add('active');
      mobileMenu.style.visibility = 'visible';
      mobileMenu.style.opacity = '1';
      mobileMenu.style.pointerEvents = 'auto';
    }
    if (hamburgerMenu) {
      hamburgerMenu.classList.add('active');
    }
    document.body.classList.add('menu-open');
  }
  

  function closeMobileMenu() 
  {
    if (mobileMenu) {
      mobileMenu.classList.remove('active');
      mobileMenu.style.display = 'none';
      mobileMenu.style.visibility = 'hidden';
      mobileMenu.style.opacity = '0';
      mobileMenu.style.pointerEvents = 'none';
    }
    if (hamburgerMenu) {
      hamburgerMenu.classList.remove('active');
    }
    document.body.classList.remove('menu-open');

    const mobileMenuItems = document.querySelectorAll('.mobile-menu-item.has-submenu');
    mobileMenuItems.forEach(item => {
      item.classList.remove('active');
      const submenu = item.querySelector('.mobile-submenu');
      if (submenu) {
        submenu.classList.remove('active');
      }
    });
  }

  if (hamburgerMenu) {
    hamburgerMenu.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (mobileMenu && mobileMenu.classList.contains('active')) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });
  }
  
  // Event listener para cerrar el menú con el botón X
  if (mobileMenuClose) {
    mobileMenuClose.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      closeMobileMenu();
    });
  }
  
  // Event listener para cerrar el menú al hacer clic fuera
  if (mobileMenu) {
    mobileMenu.addEventListener('click', function(e) {
      if (e.target === mobileMenu) {
        closeMobileMenu();
      }
    });
  }
  
  // Manejar submenús móviles
  const mobileMenuItems = document.querySelectorAll('.mobile-menu-item.has-submenu');
  
  mobileMenuItems.forEach(item => {
    const header = item.querySelector('.mobile-menu-item-header');
    if (header) {
      header.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // Cerrar otros submenús
        mobileMenuItems.forEach(otherItem => {
          if (otherItem !== item) {
            otherItem.classList.remove('active');
            const otherSubmenu = otherItem.querySelector('.mobile-submenu');
            if (otherSubmenu) {
              otherSubmenu.classList.remove('active');
            }
          }
        });
        
        // Toggle submenú actual
        item.classList.toggle('active');
        const submenu = item.querySelector('.mobile-submenu');
        if (submenu) {
          submenu.classList.toggle('active');
        }
      });
    }
  });
  
  // Cerrar menú con la tecla Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && mobileMenu && mobileMenu.classList.contains('active')) {
      closeMobileMenu();
    }
  });
  
  // Detectar cambios de tamaño de pantalla
  window.addEventListener('resize', function() {
    if (window.innerWidth > 768) {
      closeMobileMenu();
    }
  });
  
  // Cargar información del usuario en móvil
  const mobileUserInfo = document.getElementById('mobileUserInfo');
  const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
  
  if (mobileUserInfo) {
    const userInfo = localStorage.getItem('userInfo') || 'Usuario';
    mobileUserInfo.textContent = userInfo;
  }
  
  if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      // Aquí puedes agregar la lógica de logout
    });
  }
  
  // Prevenir que los enlaces del submenú cierren el menú
  const mobileSubmenuItems = document.querySelectorAll('.mobile-submenu-item');
  mobileSubmenuItems.forEach(item => {
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      // El enlace funcionará normalmente
    });
  });
}); 