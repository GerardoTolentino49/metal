document.addEventListener('DOMContentLoaded', function() 
{
  setTimeout(() => {
    initializeTopbar();
  }, 1500);
});

function initLogoutButton() {
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

    // Redirigir al login
    window.location.href = 'login.html';
  });
}

function initializeTopbar() 
{
  document.querySelectorAll('.menu-item.has-submenu').forEach(menuItem => {
    const submenu = menuItem.querySelector('.submenu');
    const arrow = menuItem.querySelector('.submenu-arrow');
    
    menuItem.addEventListener('click', function(e) {
      if (e.target.closest('.submenu')) return;
      e.preventDefault();
      e.stopPropagation();

      document.querySelectorAll('.menu-item.has-submenu .submenu.active').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.menu-item.has-submenu .submenu-arrow').forEach(a => a.style.transform = 'rotate(0deg)');
      if (submenu) 
        {
        submenu.classList.toggle('active');
        if (submenu.classList.contains('active')) {
          arrow.style.transform = 'rotate(180deg)';
        } else 
        {
          arrow.style.transform = 'rotate(0deg)';
        }
      }
    });
  });
  
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.menu-item.has-submenu')) {
      document.querySelectorAll('.menu-item.has-submenu .submenu.active').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.menu-item.has-submenu .submenu-arrow').forEach(a => a.style.transform = 'rotate(0deg)');
    }
  });

  function moverHighlight() 
  {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const highlight = topbar.querySelector('.glass-highlight');
    const btnSel = topbar.querySelector('.menu-item.selected');
    if (!highlight || !btnSel) return;
    try {
      const rectTopbar = topbar.getBoundingClientRect();
      const rectBtn = btnSel.getBoundingClientRect();
      const left = rectBtn.left - rectTopbar.left;
      if (Number.isFinite(left)) {
        highlight.style.left = left + 'px';
        highlight.style.width = rectBtn.width + 'px';
      }
    } catch (e) {
      console.debug('moverHighlight skipped due to measurement error', e);
    }
  }

  function addChromaticEffect(element) 
  {
    // efecto desactivado
  }

  document.querySelectorAll('.menu-item').forEach(button => {
    button.addEventListener('click', function() 
    {
      document.querySelectorAll('.menu-item.selected').forEach(b => b.classList.remove('selected'));
      this.classList.add('selected');
      moverHighlight();
    });
  });

  const userIcon = document.getElementById('userIcon');
  if (userIcon) 
    {
    userIcon.addEventListener('click', function(e) 
    {
      e.preventDefault();
      e.stopPropagation();

      const userSubmenu = document.getElementById('userSubmenu');
      if (userSubmenu) {
        userSubmenu.classList.toggle('active');
      }
    });
  }

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.user-menu-item')) {
      const userSubmenu = document.getElementById('userSubmenu');
      if (userSubmenu) 
{
        userSubmenu.classList.remove('active');
      }
    }
  });

  setTimeout(() => {
    moverHighlight();
  }, 100);
  
  window.addEventListener('resize', moverHighlight);
  document.querySelectorAll('.lisa-btn-cromatica').forEach(btn => {
    btn.addEventListener('click', function() {
      window.location.href = 'inicio.html';
    });
  });
  updateTopbarContrast();
  initLogoutButton();
}

function getContrastYIQ(hexcolor) 
{
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

function updateTopbarContrast() 
{
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  
  let bg = window.getComputedStyle(topbar).backgroundColor;
  
  function rgb2hex(rgb) 
  {
    if (!rgb) return '#fff';
    let result = rgb.match(/rgba?\((\d+), (\d+), (\d+)/);
    if (!result) return '#fff';
    return '#' +
      (parseInt(result[1]).toString(16).padStart(2, '0')) +
      (parseInt(result[2]).toString(16).padStart(2, '0')) +
      (parseInt(result[3]).toString(16).padStart(2, '0'));
  }
  
  let hex = rgb2hex(bg);
  let contrast = getContrastYIQ(hex);
  
  document.querySelectorAll('.menu-item, .submenu-item, .topbar-header h1, .lisa-btn-cromatica').forEach(el => {
    el.setAttribute('data-contrast', contrast);
  });
}

document.addEventListener('DOMContentLoaded', updateTopbarContrast);
window.addEventListener('resize', updateTopbarContrast); 