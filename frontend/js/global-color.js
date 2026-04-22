// Variable global para el color favorito
window.favoriteColor = {
  hex: '#232946', // Color por defecto (azul original)
  name: 'Azul',
  rgb: { r: 35, g: 57, b: 70 }
};

function parseHexToRgb(hexColor) {
  const normalized = String(hexColor || '').trim();
  if (!/^#([a-fA-F0-9]{6})$/.test(normalized)) {
    return { r: 35, g: 57, b: 70 };
  }

  const hex = normalized.replace('#', '');
  return {
    r: parseInt(hex.substr(0, 2), 16),
    g: parseInt(hex.substr(2, 2), 16),
    b: parseInt(hex.substr(4, 2), 16)
  };
}

function setFavoriteColorState(color, name) {
  const resolvedColor = color || window.favoriteColor.hex || '#232946';
  const resolvedName = name || resolvedColor;

  window.favoriteColor.hex = resolvedColor;
  window.favoriteColor.name = resolvedName;
  window.favoriteColor.rgb = parseHexToRgb(resolvedColor);

  document.documentElement.style.setProperty('--bg-color', resolvedColor);
  document.body.style.background = resolvedColor;
}

// Función para detectar si estamos en la página de inicio
function isInitPage() {
  return window.location.pathname.includes('inicio.html') || window.location.href.includes('inicio.html');
}

// Función para aplicar el color al fondo de cualquier página
async function applyFavoriteColor() {
  const userId = localStorage.getItem('userId');
  
  if (userId) {
    try {
      // Obtener el color favorito desde la base de datos
      const response = await fetch(`/api/usuario/favorite-color/${userId}`);
      
      // Si el endpoint no existe o falla, usar color por defecto
      if (!response.ok) {
        console.warn('No se pudo obtener el color favorito, usando color por defecto');
        const savedColor = localStorage.getItem('favoriteColor');
        const savedColorName = localStorage.getItem('favoriteColorName');
        if (savedColor && savedColorName) {
          applyColorFromLocalStorage(savedColor, savedColorName);
        }
        return;
      }
      
      const data = await response.json();
      
      if (data.success && data.color) {
        setFavoriteColorState(data.color, data.color);
        
        // Guardar también en localStorage para compatibilidad
        localStorage.setItem('favoriteColor', data.color);
        localStorage.setItem('favoriteColorName', data.color);
        
      } else {
        // Si no hay color en la base de datos, usar el localStorage como fallback
        const savedColor = localStorage.getItem('favoriteColor');
        const savedColorName = localStorage.getItem('favoriteColorName');
        
        if (savedColor) {
          applyColorFromLocalStorage(savedColor, savedColorName);
        }
      }
    } catch (error) {
      // Fallback a localStorage
      const savedColor = localStorage.getItem('favoriteColor');
      const savedColorName = localStorage.getItem('favoriteColorName');
      
      if (savedColor) {
        applyColorFromLocalStorage(savedColor, savedColorName);
      }
    }
  } else {
    // Si no hay userId, usar localStorage como fallback
    const savedColor = localStorage.getItem('favoriteColor');
    const savedColorName = localStorage.getItem('favoriteColorName');
    
    if (savedColor) {
      applyColorFromLocalStorage(savedColor, savedColorName);
    }
  }
}

// Función auxiliar para aplicar color desde localStorage
function applyColorFromLocalStorage(savedColor, savedColorName) {
  setFavoriteColorState(savedColor, savedColorName || savedColor);
}

// Función para cambiar el color global
async function changeGlobalColor(hex, name) {
  setFavoriteColorState(hex, name);
  
  // Guardar en localStorage
  localStorage.setItem('favoriteColor', hex);
  localStorage.setItem('favoriteColorName', name);
  
  // Guardar en la base de datos si hay userId
  const userId = localStorage.getItem('userId');
  if (userId) {
    try {
      const response = await fetch('/api/usuario/favorite-color', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: userId,
          color: hex
        })
      });
      
      const data = await response.json();
      if (data.success) {
        console.log('Color favorito guardado en la base de datos:', hex);
      } else {
        console.error('Error al guardar color en la base de datos:', data.error);
      }
    } catch (error) {
      console.error('Error al guardar color en la base de datos:', error);
    }
  }
  
  // Mantener sincronizada la variable global de color y el fondo del body
  document.documentElement.style.setProperty('--bg-color', hex);
  document.body.style.background = hex;
  
  // Disparar evento personalizado para notificar a otros componentes
  window.dispatchEvent(new CustomEvent('favoriteColorChanged', {
    detail: { hex: window.favoriteColor.hex, name: window.favoriteColor.name, rgb: window.favoriteColor.rgb }
  }));
}

// Función para obtener el color actual
function getCurrentFavoriteColor() {
  return window.favoriteColor;
}

// Aplicar el color al cargar la página
document.addEventListener('DOMContentLoaded', async function() {
  await applyFavoriteColor();
});

// Escuchar cambios de color desde otras páginas
window.addEventListener('favoriteColorChanged', async function(e) {
  await applyFavoriteColor();
}); 