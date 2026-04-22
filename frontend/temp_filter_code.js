      // Event listeners para botones de filtro
      const comprasGeneralesFilterBtn = document.getElementById('comprasGeneralesFilterBtn');
      const requisicionesFilterBtn = document.getElementById('requisicionesFilterBtn');
      const comprasIrregularesFilterBtn = document.getElementById('comprasIrregularesFilterBtn');

      function showFilterAlert(sectionName) {
        alert('Funcionalidad de filtros para ' + sectionName + ' proximamente disponible.\n\nActualmente puedes usar la barra de busqueda para filtrar los resultados.');
      }

      if (comprasGeneralesFilterBtn) {
        comprasGeneralesFilterBtn.addEventListener('click', function() {
          showFilterAlert('Compras Generales');
        });
      }

      if (requisicionesFilterBtn) {
        requisicionesFilterBtn.addEventListener('click', function() {
          showFilterAlert('Requisiciones');
        });
      }

      if (comprasIrregularesFilterBtn) {
        comprasIrregularesFilterBtn.addEventListener('click', function() {
          showFilterAlert('Compras Irregulares');
        });
      }
