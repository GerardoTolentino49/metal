// Agregar funcionalidad de clic a la gráfica de nacionalidad
document.addEventListener('DOMContentLoaded', function() {
  // Esperar a que la gráfica se cargue
  setTimeout(() => {
    const canvas = document.getElementById('nationalityChart');
    if (canvas && window.nationalityChart) {
      // Agregar el evento onClick a la gráfica existente
      window.nationalityChart.options.onClick = function(event, elements) {
        if (elements.length > 0) {
          const elementIndex = elements[0].index;
          const clickedLabel = window.nationalityChart.data.labels[elementIndex];
          
          // Obtener los datos almacenados globalmente
          if (window.nationalityDataGrouped && window.nationalityDataGrouped[clickedLabel]) {
            showSuppliersModal(clickedLabel, window.nationalityDataGrouped[clickedLabel]);
          }
        }
      };
      
      // Actualizar la gráfica para aplicar los cambios
      window.nationalityChart.update();
    }
  }, 2000);
});

