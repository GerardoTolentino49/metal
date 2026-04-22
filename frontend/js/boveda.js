document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const uploadForm = document.getElementById('uploadForm');
  const fileList = document.getElementById('fileList');

  // Simulación de archivos guardados en localStorage
  let archivos = JSON.parse(localStorage.getItem('vaultFiles') || '[]');

  function renderFiles() {
    fileList.innerHTML = '';
    if (archivos.length === 0) {
      fileList.innerHTML = '<li>No hay archivos guardados.</li>';
      return;
    }
    archivos.forEach((archivo, idx) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${archivo.name}</span>
        <button onclick="descargarArchivo(${idx})">Descargar</button>
        <button onclick="eliminarArchivo(${idx})">Eliminar</button>
      `;
      fileList.appendChild(li);
    });
  }

  // Simulación de subida
  uploadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const files = Array.from(fileInput.files);
    files.forEach(file => {
      archivos.push({ name: file.name, content: null }); // No guardamos el contenido real
    });
    localStorage.setItem('vaultFiles', JSON.stringify(archivos));
    renderFiles();
    uploadForm.reset();
  });

  // Simulación de descarga
  window.descargarArchivo = function(idx) {
    alert('Simulación: descargar ' + archivos[idx].name);
    // Aquí iría la lógica real de descarga
  };

  // Eliminar archivo
  window.eliminarArchivo = function(idx) {
    if (confirm('¿Eliminar este archivo?')) {
      archivos.splice(idx, 1);
      localStorage.setItem('vaultFiles', JSON.stringify(archivos));
      renderFiles();
    }
  };

  renderFiles();
}); 