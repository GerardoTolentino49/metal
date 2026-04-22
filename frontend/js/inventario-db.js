// Configuración de la base de datos
const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'inventario',
  user: 'postgres',
  password: 'tu_password_aqui'
};

// Clase para manejar la conexión a la base de datos
class InventarioDB {
  constructor() {
    this.baseUrl = '/api'; // URL relativa a tu servidor existente
    this.inventario = [];
    this.totalInventario = 0;
    
    // Variables de paginación
    this.productosPorPagina = 15;
    this.paginaActual = 1;
    this.totalPaginas = 0;
    this.inventarioFiltrado = [];
  }

  // Cargar todos los productos del inventario
  async cargarInventario() {
    try {
      console.log('Cargando inventario...');
      const response = await fetch(`${this.baseUrl}/inventario`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Datos recibidos del servidor:', data);
      
      this.inventario = data;
      this.calcularTotalInventario();
      this.renderizarTabla();
      
      console.log('Inventario cargado exitosamente');
      return data;
    } catch (error) {
      console.error('Error cargando inventario:', error);
      this.mostrarError('Error al cargar el inventario. Verifica la conexión a la base de datos.');
      throw error;
    }
  }

  // Calcular el total del inventario
  calcularTotalInventario() {
    console.log('Calculando total del inventario...');
    console.log('Productos en memoria:', this.inventario);
    
    // Calcular totales por departamento primero
    let totalP1Pesos = 0;
    let totalP1Dolares = 0;
    let totalBAPesos = 0;
    let totalBADolares = 0;
    
    this.inventario.forEach(producto => {
      const precioMXN = parseFloat(producto.precio_mxn) || 0;
      const precioUSD = parseFloat(producto.precio_dlls) || 0;
      const stock = parseInt(producto.stock) || 0;

      // Determinar si es P1 o BA según el campo nave_industrial_p1
      const flag = producto.nave_industrial_p1;
      const esBA = flag === false; // BA: nave_industrial_p1 = false
      const esP1 = flag === true || flag === null || flag === undefined; // P1: nave_industrial_p1 = true, null o undefined

      // Subtotales en ambas monedas
      let subtotalMXN = precioMXN * stock;
      let subtotalUSD = precioUSD * stock;

      // Si no hay precio en MXN pero sí en USD, convertir USD a MXN
      if (subtotalMXN === 0 && subtotalUSD > 0) {
        const exchangeRate = this.getExchangeRate();
        subtotalMXN = subtotalUSD * exchangeRate;
      }

      if (esP1) {
        // P1: sumar solo productos de P1
        totalP1Pesos += subtotalMXN;
        totalP1Dolares += subtotalUSD;
      } else if (esBA) {
        // BA: sumar solo productos de BA
        totalBAPesos += subtotalMXN;
        totalBADolares += subtotalUSD;
      }
    });
    
    // Gran total USD: convertir total en pesos a dólares + total en dólares
    const exchangeRate = this.getExchangeRate();
    const totalPesosDirecto = totalP1Pesos + totalBAPesos;
    const totalPesosConvertidoAUSD = totalPesosDirecto / exchangeRate;
    const granTotalUSD = totalPesosConvertidoAUSD + (totalP1Dolares + totalBADolares);
    
    // Gran total MXN: convertir gran total USD a pesos mexicanos
    const granTotalMXN = granTotalUSD * exchangeRate;
    
    // Guardar totales para uso posterior
    this.totalInventario = granTotalMXN;
    
    console.log('Total P1 MXN:', totalP1Pesos);
    console.log('Total BA MXN:', totalBAPesos);
    console.log('Total Directo MXN (P1 + BA):', totalPesosDirecto);
    console.log('Total P1 USD:', totalP1Dolares);
    console.log('Total BA USD:', totalBADolares);
    console.log('Total Directo USD (P1 + BA):', totalP1Dolares + totalBADolares);
    console.log('Total Pesos Convertido a USD:', totalPesosConvertidoAUSD);
    console.log('Gran Total USD (pesos convertidos + dólares):', granTotalUSD);
    console.log('Gran Total MXN (gran total USD * tipo de cambio):', granTotalMXN);
    
    // Actualizar los totales en la interfaz
    const totalDirectoUSD = totalP1Dolares + totalBADolares;
    this.actualizarTotalesEnInterfaz(totalPesosDirecto, totalDirectoUSD, granTotalUSD, granTotalMXN);
  }

  // Actualizar los totales en la interfaz
  actualizarTotalesEnInterfaz(totalMXN, totalUSD, granTotalUSD, granTotalMXN) {
    // Actualizar total en pesos mexicanos (suma de P1 + BA)
    const totalMXNElement = document.getElementById('totalInventarioMXN');
    if (totalMXNElement) {
      totalMXNElement.textContent = this.formatearPrecio(totalMXN);
    }
    
    // Actualizar total en dólares (suma de P1 + BA)
    const totalUSDElement = document.getElementById('totalInventarioUSD');
    if (totalUSDElement) {
      totalUSDElement.textContent = this.formatearPrecioUSD(totalUSD);
    }
    
    // Actualizar gran total en dólares (pesos convertidos + dólares)
    const granTotalUSDElement = document.getElementById('totalInventarioGrandUSD');
    if (granTotalUSDElement) {
      granTotalUSDElement.textContent = this.formatearPrecioUSD(granTotalUSD);
    }
    
    // Actualizar gran total en pesos mexicanos (gran total USD * tipo de cambio)
    const granTotalMNXElement = document.getElementById('totalInventarioGrandMXN');
    if (granTotalMNXElement) {
      granTotalMNXElement.textContent = this.formatearPrecio(granTotalMXN);
    }
    
    // Mantener compatibilidad con el elemento anterior
    const totalElement = document.getElementById('totalInventario');
    if (totalElement) {
      totalElement.textContent = `Total del inventario: ${this.formatearPrecio(totalMXN)}`;
    }
  }

  // Calcular gran total en USD
  calcularGranTotalUSD() {
    const exchangeRate = this.getExchangeRate();
    
    // 1. Suma directa de la columna de dólares (Total en dólares)
    const totalDolares = this.calcularTotalUSD();
    
    // 2. Conversión de pesos a dólares para TODOS los productos que tienen precio en MXN
    const totalPesosConvertido = this.inventario.reduce((total, producto) => {
      const precioMXN = producto.precio_mxn || 0;
      const stock = producto.stock || 0;
      
      // Convertir si el producto tiene precio en MXN, independientemente de si tiene precio en USD
      if (precioMXN > 0) {
        return total + ((precioMXN * stock) / exchangeRate);
      }
      return total;
    }, 0);
    
    // 3. Gran total = Total en dólares + Conversión de pesos
    return totalDolares + totalPesosConvertido;
  }

  // Calcular total en dólares (suma directa de la columna de dólares)
  calcularTotalUSD() {
    return this.inventario.reduce((total, producto) => {
      const precioUSD = producto.precio_dlls || 0;
      const stock = producto.stock || 0;
      const subtotalUSD = precioUSD * stock;
      return total + subtotalUSD;
    }, 0);
  }

  // Renderizar la tabla con los datos
  renderizarTabla() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    // Usar inventario filtrado si hay filtros activos o hay término de búsqueda, sino usar inventario completo
    const hayFiltrosActivos = typeof currentFilters !== 'undefined' && (
      currentFilters.familia || 
      (currentFilters.stock && currentFilters.stock.length > 0) ||
      currentFilters.precioMin || 
      currentFilters.precioMax ||
      currentFilters.dmP1 ||
      currentFilters.dmBA
    );
    const hayBusqueda = (() => {
      const input = document.getElementById('searchInput');
      return Array.isArray(this.inventarioFiltrado) && input && input.value.trim() !== '';
    })();
    
    const inventarioParaMostrar = (hayFiltrosActivos || hayBusqueda) ? this.inventarioFiltrado : this.inventario;
    
    if (inventarioParaMostrar.length === 0) {
      const mensaje = (hayFiltrosActivos || hayBusqueda) ? 
        `<i class="fas fa-search"></i>
         <h3>No se encontraron productos</h3>
         <p>No hay productos que coincidan con tu búsqueda o filtros</p>` :
        `<i class="fas fa-box-open"></i>
         <h3>No hay productos en el inventario</h3>
         <p>Agrega tu primer producto para comenzar</p>`;
      
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            ${mensaje}
          </td>
        </tr>
      `;
      this.actualizarControlesPaginacion(0);
      return;
    }

    // Calcular paginación
    this.totalPaginas = Math.ceil(inventarioParaMostrar.length / this.productosPorPagina);
    
    // Asegurar que la página actual sea válida
    if (this.paginaActual > this.totalPaginas) {
      this.paginaActual = this.totalPaginas;
    }
    if (this.paginaActual < 1) {
      this.paginaActual = 1;
    }

    // Calcular índices para la página actual
    const inicio = (this.paginaActual - 1) * this.productosPorPagina;
    const fin = inicio + this.productosPorPagina;
    const productosPaginaActual = inventarioParaMostrar.slice(inicio, fin);

    tbody.innerHTML = productosPaginaActual.map(producto => {
      // Mostrar valor total por producto (precio unitario × stock)
      const precio = producto.precio_mxn || 0;
      const precioDlls = producto.precio_dlls || 0;
      const stockValor = producto.stock || 0;
      const subtotal = precio * stockValor;
      const subtotalDlls = precioDlls * stockValor;
      const precioFormateado = this.formatearPrecio(subtotal);
      const precioDllsFormateado = this.formatearPrecioUSD(subtotalDlls);
      
      const estadoMostrar = stockValor === 0 ? 'Agotado' : 
                           stockValor >= 1 && stockValor <= 15 ? 'Por agotarse' : 
                           stockValor > 15 ? 'En stock' : 
                           (producto.estado || 'Sin estado');
      return `
        <tr data-id="${producto.id}" onclick="inventarioDB.mostrarDetallesProducto('${producto.id}')">
          <td>${producto.codigo || ''}</td>
          <td>${producto.nombre_completo || 'Sin nombre'}</td>
          <td>${producto.stock || 0}</td>
          <td>
            <span class="estado-badge estado-${this.getEstadoClass(estadoMostrar)}">
              ${estadoMostrar}
            </span>
          </td>
          <td>${precioFormateado}</td>
          <td>${precioDllsFormateado}</td>
          <td onclick="event.stopPropagation()">
            <button class="action-button edit-button" onclick="inventarioDB.editarProducto('${producto.id}')">
              Modificar
            </button>
          </td>
        </tr>
      `;
    }).join('');
    
    // Actualizar controles de paginación
    this.actualizarControlesPaginacion(inventarioParaMostrar.length);
    
    // Actualizar el total del inventario después de renderizar
    this.calcularTotalInventario();
    
    // Debug: verificar que los precios se cargaron correctamente
    console.log('Inventario cargado:', this.inventario);
    console.log('Precios cargados:', this.inventario.map(p => ({ id: p.id, precio: p.precio_mxn })));
  }

  // Actualizar controles de paginación
  actualizarControlesPaginacion(totalProductos) {
    const paginationContainer = document.getElementById('paginationContainer');
    if (!paginationContainer) return;

    if (totalProductos === 0 || this.totalPaginas <= 1) {
      paginationContainer.innerHTML = '';
      return;
    }

    const inicio = (this.paginaActual - 1) * this.productosPorPagina + 1;
    const fin = Math.min(this.paginaActual * this.productosPorPagina, totalProductos);

    paginationContainer.innerHTML = `
      <div class="pagination-info">
        <span>Mostrando ${inicio}-${fin} de ${totalProductos} productos</span>
      </div>
      <div class="pagination-controls">
        <button class="pagination-btn" onclick="inventarioDB.irAPagina(1)" ${this.paginaActual === 1 ? 'disabled' : ''}>
          <i class="fas fa-angle-double-left"></i>
        </button>
        <button class="pagination-btn" onclick="inventarioDB.irAPagina(${this.paginaActual - 1})" ${this.paginaActual === 1 ? 'disabled' : ''}>
          <i class="fas fa-angle-left"></i>
        </button>
        
        <div class="pagination-pages">
          ${this.generarBotonesPagina()}
        </div>
        
        <button class="pagination-btn" onclick="inventarioDB.irAPagina(${this.paginaActual + 1})" ${this.paginaActual === this.totalPaginas ? 'disabled' : ''}>
          <i class="fas fa-angle-right"></i>
        </button>
        <button class="pagination-btn" onclick="inventarioDB.irAPagina(${this.totalPaginas})" ${this.paginaActual === this.totalPaginas ? 'disabled' : ''}>
          <i class="fas fa-angle-double-right"></i>
        </button>
      </div>
    `;
  }

  // Generar botones de página
  generarBotonesPagina() {
    const botones = [];
    const paginasVisibles = 5; // Mostrar máximo 5 páginas
    let inicio = Math.max(1, this.paginaActual - Math.floor(paginasVisibles / 2));
    let fin = Math.min(this.totalPaginas, inicio + paginasVisibles - 1);

    // Ajustar inicio si estamos cerca del final
    if (fin - inicio < paginasVisibles - 1) {
      inicio = Math.max(1, fin - paginasVisibles + 1);
    }

    for (let i = inicio; i <= fin; i++) {
      botones.push(`
        <button class="pagination-page ${i === this.paginaActual ? 'active' : ''}" 
                onclick="inventarioDB.irAPagina(${i})">
          ${i}
        </button>
      `);
    }

    return botones.join('');
  }

  // Ir a una página específica
  irAPagina(pagina) {
    if (pagina < 1 || pagina > this.totalPaginas) return;
    
    this.paginaActual = pagina;
    this.renderizarTabla();
    
    // Scroll hacia arriba de la tabla
    const tableWrapper = document.querySelector('.table-wrapper');
    if (tableWrapper) {
      tableWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Ir a la página anterior
  paginaAnterior() {
    if (this.paginaActual > 1) {
      this.irAPagina(this.paginaActual - 1);
    }
  }

  // Ir a la página siguiente
  paginaSiguiente() {
    if (this.paginaActual < this.totalPaginas) {
      this.irAPagina(this.paginaActual + 1);
    }
  }

  // Resetear paginación (útil después de filtros)
  resetearPaginacion() {
    this.paginaActual = 1;
  }

  // Obtener clase CSS para el estado
  getEstadoClass(estado) {
    if (!estado) return 'default';
    
    const estadoLower = estado.toLowerCase();
    if (estadoLower.includes('por agotarse') || estadoLower.includes('bajo stock')) return 'por-agotarse';
    if (estadoLower.includes('almacén') || estadoLower.includes('stock')) return 'en-stock';
    if (estadoLower.includes('tránsito') || estadoLower.includes('transito')) return 'en-transito';
    if (estadoLower.includes('agotado') || estadoLower.includes('sin stock')) return 'agotado';
    if (estadoLower.includes('pedido')) return 'pedido';
    return 'default';
  }

  // Formatear precio correctamente
  formatearPrecio(precio) {
    if (!precio || precio === 0) return '$0.00';
    
    // Convertir a número si es string
    const precioNum = parseFloat(precio);
    
    // Verificar si es un número válido
    if (isNaN(precioNum)) return '$0.00';
    
    // Formatear con separadores de miles y decimales apropiados
    const precioFormateado = precioNum.toLocaleString('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    
    return `$${precioFormateado}`;
  }

  // Formatear precio en USD correctamente
  formatearPrecioUSD(precio) {
    if (!precio || precio === 0) return '$0.00 USD';
    
    // Convertir a número si es string
    const precioNum = parseFloat(precio);
    
    // Verificar si es un número válido
    if (isNaN(precioNum)) return '$0.00 USD';
    
    // Formatear con separadores de miles y decimales apropiados
    const precioFormateado = precioNum.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    
    return `$${precioFormateado} USD`;
  }

  // Obtener el tipo de cambio actual desde la página o almacenamiento
  getExchangeRate() {
    const rateFromWindow = typeof window !== 'undefined' ? window.exchangeRate : undefined;
    const rateFromStorage = parseFloat(localStorage.getItem('exchangeRate'));
    const candidate = !isNaN(rateFromWindow) ? rateFromWindow : rateFromStorage;
    // Fallback seguro si aún no se ha cargado el tipo dinámico
    if (typeof candidate === 'number' && !isNaN(candidate) && candidate > 0) {
      return candidate;
    }
    return 18.4076; // valor de respaldo actualizado
  }

  // Mostrar error en la tabla
  mostrarError(mensaje) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="error-row">
          <i class="fas fa-exclamation-triangle"></i>
          <div>${mensaje}</div>
          <button class="retry-button" onclick="inventarioDB.cargarInventario()">
            Reintentar
          </button>
        </td>
      </tr>
    `;
  }

  // Editar producto
  editarProducto(id) {
    const producto = this.inventario.find(p => String(p.id) === String(id));
    if (!producto) return;

    const modal = document.getElementById('editModal');
    if (!modal) return;

    // Rellenar campos
    const idField = document.getElementById('editId');
    const nombreField = document.getElementById('editNombre');
    const stockField = document.getElementById('editStock');
    const precioField = document.getElementById('editPrecio');
    const precioDllsField = document.getElementById('editPrecioDlls');
    const estadoField = document.getElementById('editEstado');
    const activoField = document.getElementById('editActivo');

    if (idField) idField.textContent = producto.id;
    if (nombreField) nombreField.value = producto.nombre_completo || '';
    if (stockField) stockField.value = producto.stock || 0;
    if (precioField) precioField.value = producto.precio_mxn || 0;
    if (precioDllsField) precioDllsField.value = producto.precio_dlls || 0;
    if (estadoField) estadoField.value = producto.estado || 'Sin estado';
    if (activoField) activoField.checked = Boolean(producto.activo);

    // Guardar id en dataset para usar en save
    modal.dataset.id = String(producto.id);

    // Mostrar modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  cerrarModalEdicion() {
    const modal = document.getElementById('editModal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
  }

  async guardarEdicion() {
    const modal = document.getElementById('editModal');
    if (!modal || !modal.dataset.id) return;

    const id = modal.dataset.id;
    const nombreField = document.getElementById('editNombre');
    const stockField = document.getElementById('editStock');
    const precioField = document.getElementById('editPrecio');
    const precioDllsField = document.getElementById('editPrecioDlls');
    const estadoField = document.getElementById('editEstado');
    const activoField = document.getElementById('editActivo');

    const payload = {
      nombre: nombreField ? nombreField.value : undefined,
      stock: stockField ? Number(stockField.value) : undefined,
      precio_mxn: precioField ? parseFloat(precioField.value) : undefined,
      precio_dlls: precioDllsField ? parseFloat(precioDllsField.value) : undefined,
      estado: estadoField ? estadoField.value : undefined,
      activo: activoField ? Boolean(activoField.checked) : undefined,
    };

    try {
      const response = await fetch(`${this.baseUrl}/inventario/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Error al actualizar el producto');
      }

      const { item } = await response.json();

      // Actualizar en memoria y re-renderizar
      const index = this.inventario.findIndex(p => String(p.id) === String(id));
      if (index !== -1) {
        this.inventario[index] = { ...this.inventario[index], ...item };
      }
      this.calcularTotalInventario();
      this.renderizarTabla();

      this.mostrarNotificacion('Producto actualizado correctamente', 'success');
      this.cerrarModalEdicion();
    } catch (error) {
      console.error('Error actualizando producto:', error);
      this.mostrarNotificacion('Error al actualizar el producto', 'error');
    }
  }

  // Eliminar producto
  async eliminarProducto(id) {
    const producto = this.inventario.find(p => p.id === id);
    if (!producto) return;

    const confirmacion = confirm(`¿Estás seguro de que quieres eliminar "${producto.nombre_completo}"?`);
    if (!confirmacion) return;

    try {
      const response = await fetch(`${this.baseUrl}/inventario/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Remover de la lista local
        this.inventario = this.inventario.filter(p => p.id !== id);
        this.calcularTotalInventario();
        this.renderizarTabla();
        
        // Mostrar notificación
        this.mostrarNotificacion('Producto eliminado correctamente', 'success');
      } else {
        throw new Error('Error al eliminar el producto');
      }
    } catch (error) {
      console.error('Error eliminando producto:', error);
      this.mostrarNotificacion('Error al eliminar el producto', 'error');
    }
  }

  // Mostrar notificaciones
  mostrarNotificacion(mensaje, tipo = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${tipo}`;
    notification.textContent = mensaje;
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${tipo === 'success' ? '#4CAF50' : tipo === 'error' ? '#F44336' : '#2196F3'};
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 3000;
      transform: translateX(400px);
      transition: transform 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);
    
    setTimeout(() => {
      notification.style.transform = 'translateX(400px)';
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }

  // Nueva función para actualizar precios
  actualizarPrecios() {
    // Verificar si hay un switch de moneda y actualizar precios según corresponda
    const switchCurrency = document.getElementById('switchCurrency');
    if (switchCurrency) {
      // Si el switch está activado, mostrar en dólares
      if (switchCurrency.checked) {
        this.mostrarPreciosEnDolares();
      } else {
        this.mostrarPreciosEnMXN();
      }
    }
  }

  // Función para mostrar precios en MXN
  mostrarPreciosEnMXN() {
    const filas = document.querySelectorAll('#usersTableBody tr');
    filas.forEach((fila) => {
      const precioCell = fila.querySelectorAll('td')[4];
      const precioDllsCell = fila.querySelectorAll('td')[5];
      if (precioCell && precioDllsCell) {
        const productoId = fila.dataset.id;
        const producto = this.inventario.find(p => String(p.id) === String(productoId));
        if (producto) {
          const subtotal = (producto.precio_mxn || 0) * (producto.stock || 0);
          const subtotalDlls = (producto.precio_dlls || 0) * (producto.stock || 0);
          precioCell.textContent = this.formatearPrecio(subtotal);
          precioDllsCell.textContent = this.formatearPrecioUSD(subtotalDlls);
        }
      }
    });
    
    // Recalcular totales usando la nueva lógica
    this.calcularTotalInventario();
  }

  // Función para mostrar precios en USD
  mostrarPreciosEnUSD() {
    const filas = document.querySelectorAll('#usersTableBody tr');
    filas.forEach((fila) => {
      const precioCell = fila.querySelectorAll('td')[4];
      const precioDllsCell = fila.querySelectorAll('td')[5];
      if (precioCell && precioDllsCell) {
        const productoId = fila.dataset.id;
        const producto = this.inventario.find(p => String(p.id) === String(productoId));
        if (producto) {
          const exchangeRate = this.getExchangeRate();
          const subtotalMXN = (producto.precio_mxn || 0) * (producto.stock || 0);
          const subtotalUSD = subtotalMXN / exchangeRate;
          const subtotalDlls = (producto.precio_dlls || 0) * (producto.stock || 0);
          precioCell.textContent = this.formatearPrecioUSD(subtotalUSD);
          precioDllsCell.textContent = this.formatearPrecioUSD(subtotalDlls);
        }
      }
    });
    
    // Recalcular totales usando la nueva lógica
    this.calcularTotalInventario();
  }

  // Mostrar detalles del producto
  mostrarDetallesProducto(id) {
    const producto = this.inventario.find(p => String(p.id) === String(id));
    if (!producto) return;

    const modal = document.getElementById('detailsModal');
    if (!modal) return;

    // Rellenar campos con los detalles del producto
    document.getElementById('detailsId').textContent = producto.id;
    document.getElementById('detailsIdValue').textContent = producto.id;
    document.getElementById('detailsNombre').textContent = producto.nombre_completo || 'Sin nombre';
    document.getElementById('detailsStock').textContent = producto.stock || 0;
    const stockValor = producto.stock || 0;
    const estadoMostrar = stockValor === 0 ? 'Agotado' : 
                         stockValor >= 1 && stockValor <= 15 ? 'Por agotarse' : 
                         stockValor > 15 ? 'En stock' : 
                         (producto.estado || 'Sin estado');
    document.getElementById('detailsEstado').textContent = estadoMostrar;
    
    // Información financiera
    const precioMXN = producto.precio_mxn || 0;
    const precioDLLS = producto.precio_dlls || 0;
    const stock = producto.stock || 0;
    const valorTotalMXN = precioMXN * stock;
    const valorTotalDLLS = precioDLLS * stock;
    
    document.getElementById('detailsPrecioMXN').textContent = this.formatearPrecio(precioMXN);
    document.getElementById('detailsPrecioUSD').textContent = this.formatearPrecioUSD(precioDLLS);
    document.getElementById('detailsValorTotalMXN').textContent = this.formatearPrecio(valorTotalMXN);
    document.getElementById('detailsValorTotalUSD').textContent = this.formatearPrecioUSD(valorTotalDLLS);
    
    // Información de pedidos
    document.getElementById('detailsActivo').textContent = producto.activo ? 'Sí' : 'No';
    
    // Estadísticas
    const porcentajeInventario = this.inventario.length > 0 ? ((stock / this.inventario.reduce((total, p) => total + (p.stock || 0), 0)) * 100).toFixed(2) : '0.00';
    document.getElementById('detailsPorcentajeInventario').textContent = `${porcentajeInventario}%`;
    
    // Categoría de stock
    let categoriaStock = 'Normal';
    if (stock === 0) categoriaStock = 'Agotado';
    else if (stock <= 5) categoriaStock = 'Bajo';
    else if (stock <= 20) categoriaStock = 'Medio';
    else if (stock > 50) categoriaStock = 'Alto';
    
    document.getElementById('detailsCategoriaStock').textContent = categoriaStock;

    // Manejar la imagen del producto
    this.mostrarImagenProducto(producto);

    // Mostrar modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // Mostrar imagen del producto
  mostrarImagenProducto(producto) {
    const photoPlaceholder = document.getElementById('photoPlaceholder');
    const productImage = document.getElementById('productImage');
    const removeImageBtn = document.getElementById('removeImageBtn');

    // Verificar si el producto tiene una imagen
    if (producto.imagen_url && producto.imagen_url.trim() !== '') {
      // Mostrar la imagen
      productImage.src = producto.imagen_url;
      productImage.style.display = 'block';
      photoPlaceholder.style.display = 'none';
      removeImageBtn.style.display = 'inline-flex';
    } else {
      // Mostrar placeholder
      productImage.style.display = 'none';
      photoPlaceholder.style.display = 'flex';
      removeImageBtn.style.display = 'none';
    }
  }

  // Cambiar imagen del producto
  cambiarImagen() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        this.subirImagen(file);
      }
    };
    input.click();
  }

  // Subir imagen
  async subirImagen(file) {
    const formData = new FormData();
    formData.append('imagen', file);
    
    // Obtener el ID del producto actual
    const productId = document.getElementById('detailsId').textContent;
    
    try {
      const response = await fetch(`${this.baseUrl}/inventario/${productId}/imagen`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        // Actualizar la imagen en el modal
        const productImage = document.getElementById('productImage');
        const photoPlaceholder = document.getElementById('photoPlaceholder');
        const removeImageBtn = document.getElementById('removeImageBtn');
        
        productImage.src = data.imagen_url;
        productImage.style.display = 'block';
        photoPlaceholder.style.display = 'none';
        removeImageBtn.style.display = 'inline-flex';
        
        this.mostrarNotificacion('Imagen actualizada correctamente', 'success');
      } else {
        throw new Error('Error al subir la imagen');
      }
    } catch (error) {
      console.error('Error subiendo imagen:', error);
      this.mostrarNotificacion('Error al subir la imagen', 'error');
    }
  }

  // Eliminar imagen del producto
  async eliminarImagen() {
    const productId = document.getElementById('detailsId').textContent;
    const confirmacion = confirm('¿Estás seguro de que quieres eliminar la imagen del producto?');
    
    if (!confirmacion) return;

    try {
      const response = await fetch(`${this.baseUrl}/inventario/${productId}/imagen`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Ocultar la imagen y mostrar placeholder
        const productImage = document.getElementById('productImage');
        const photoPlaceholder = document.getElementById('photoPlaceholder');
        const removeImageBtn = document.getElementById('removeImageBtn');
        
        productImage.style.display = 'none';
        photoPlaceholder.style.display = 'flex';
        removeImageBtn.style.display = 'none';
        
        this.mostrarNotificacion('Imagen eliminada correctamente', 'success');
      } else {
        throw new Error('Error al eliminar la imagen');
      }
    } catch (error) {
      console.error('Error eliminando imagen:', error);
      this.mostrarNotificacion('Error al eliminar la imagen', 'error');
    }
  }

  // Cerrar modal de detalles
  cerrarModalDetalles() {
    const modal = document.getElementById('detailsModal');
    if (!modal) return;
    
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
  }

  // Editar producto desde el modal de detalles
  editarProductoDesdeDetalles() {
    const id = document.getElementById('detailsId').textContent;
    this.cerrarModalDetalles();
    this.editarProducto(id);
  }
}

// Función para calcular totales por departamento (P1 y BA)
function calcularTotalesPorDepartamento() {
  console.log('Ejecutando calcularTotalesPorDepartamento...');
  const inventario = inventarioDB.inventario;
  
  let totalP1Pesos = 0;
  let totalP1Dolares = 0;
  let totalBAPesos = 0;
  let totalBADolares = 0;
  const exchangeRate = inventarioDB.getExchangeRate();
  let conteoBA = 0;
  let conteoP1 = 0;
  
  inventario.forEach(producto => {
    const precioMXN = parseFloat(producto.precio_mxn) || 0;
    const precioUSD = parseFloat(producto.precio_dlls) || 0;
    const stock = parseInt(producto.stock) || 0;

    // Determinar si es P1 o BA según el campo nave_industrial_p1
    const flag = producto.nave_industrial_p1;
    const esBA = flag === false; // BA: nave_industrial_p1 = false
    const esP1 = flag === true || flag === null || flag === undefined; // P1: nave_industrial_p1 = true, null o undefined

    // Subtotales en ambas monedas
    let subtotalMXN = precioMXN * stock;
    let subtotalUSD = precioUSD * stock;

    // Si no hay precio en MXN pero sí en USD, convertir USD a MXN
    if (subtotalMXN === 0 && subtotalUSD > 0) {
      subtotalMXN = subtotalUSD * exchangeRate;
    }

    if (esP1) {
      // P1: sumar solo productos de P1
      totalP1Pesos += subtotalMXN;
      totalP1Dolares += subtotalUSD;
      conteoP1++;
    } else if (esBA) {
      // BA: sumar solo productos de BA
      totalBAPesos += subtotalMXN;
      totalBADolares += subtotalUSD;
      conteoBA++;
    }
  });
  
  // Calcular gran totales para cada planta
  // Gran Total P1 USD: convertir pesos P1 a dólares + dólares P1
  const totalP1PesosConvertidoAUSD = totalP1Pesos / exchangeRate;
  const granTotalP1USD = totalP1PesosConvertidoAUSD + totalP1Dolares;
  
  // Gran Total P1 MXN: convertir gran total P1 USD a pesos
  const granTotalP1MXN = granTotalP1USD * exchangeRate;
  
  // Gran Total BA USD: convertir pesos BA a dólares + dólares BA
  const totalBAPesosConvertidoAUSD = totalBAPesos / exchangeRate;
  const granTotalBAUSD = totalBAPesosConvertidoAUSD + totalBADolares;
  
  // Gran Total BA MXN: convertir gran total BA USD a pesos
  const granTotalBAMXN = granTotalBAUSD * exchangeRate;
  
  // Calcular gran totales convertidos a dólares (conversión directa de gran total MXN a USD)
  const granTotalP1USDConvertido = granTotalP1MXN / exchangeRate;
  const granTotalBAUSDConvertido = granTotalBAMXN / exchangeRate;
  
  // Actualizar los elementos en el DOM
  console.log('Actualizando elementos P1...');
  const p1Pesos = document.getElementById('p1-pesos');
  const p1Dolares = document.getElementById('p1-dolares');
  const p1GranTotalMXN = document.getElementById('p1-gran-total-mxn');
  const p1GranTotalUSDConvertido = document.getElementById('p1-gran-total-usd-convertido');
  
  console.log('Elementos P1 encontrados:', {
    p1Pesos: !!p1Pesos,
    p1Dolares: !!p1Dolares,
    p1GranTotalMXN: !!p1GranTotalMXN,
    p1GranTotalUSDConvertido: !!p1GranTotalUSDConvertido
  });
  
  if (p1Pesos) p1Pesos.textContent = formatearPrecio(totalP1Pesos);
  if (p1Dolares) p1Dolares.textContent = formatearPrecioUSD(totalP1Dolares);
  if (p1GranTotalMXN) p1GranTotalMXN.textContent = formatearPrecio(granTotalP1MXN);
  if (p1GranTotalUSDConvertido) {
    p1GranTotalUSDConvertido.textContent = formatearPrecioUSD(granTotalP1USDConvertido);
    console.log('P1 USD Convertido actualizado:', formatearPrecioUSD(granTotalP1USDConvertido));
  } else {
    console.error('Elemento p1-gran-total-usd-convertido NO encontrado!');
  }
  
  console.log('Actualizando elementos BA...');
  const baPesos = document.getElementById('ba-pesos');
  const baDolares = document.getElementById('ba-dolares');
  const baGranTotalMXN = document.getElementById('ba-gran-total-mxn');
  const baGranTotalUSDConvertido = document.getElementById('ba-gran-total-usd-convertido');
  
  console.log('Elementos BA encontrados:', {
    baPesos: !!baPesos,
    baDolares: !!baDolares,
    baGranTotalMXN: !!baGranTotalMXN,
    baGranTotalUSDConvertido: !!baGranTotalUSDConvertido
  });
  
  if (baPesos) baPesos.textContent = formatearPrecio(totalBAPesos);
  if (baDolares) baDolares.textContent = formatearPrecioUSD(totalBADolares);
  if (baGranTotalMXN) baGranTotalMXN.textContent = formatearPrecio(granTotalBAMXN);
  if (baGranTotalUSDConvertido) {
    baGranTotalUSDConvertido.textContent = formatearPrecioUSD(granTotalBAUSDConvertido);
    console.log('BA USD Convertido actualizado:', formatearPrecioUSD(granTotalBAUSDConvertido));
  } else {
    console.error('Elemento ba-gran-total-usd-convertido NO encontrado!');
  }
  
  // Debug: verificar que los elementos existen
  console.log('Elemento p1-gran-total-usd-convertido:', document.getElementById('p1-gran-total-usd-convertido'));
  console.log('Elemento ba-gran-total-usd-convertido:', document.getElementById('ba-gran-total-usd-convertido'));
  console.log('Valor P1 USD Convertido:', granTotalP1USDConvertido);
  console.log('Valor BA USD Convertido:', granTotalBAUSDConvertido);
  
  // Verificar si hay errores al formatear
  try {
    console.log('P1 USD Convertido formateado:', formatearPrecioUSD(granTotalP1USDConvertido));
    console.log('BA USD Convertido formateado:', formatearPrecioUSD(granTotalBAUSDConvertido));
  } catch (error) {
    console.error('Error al formatear:', error);
  }
  
  // Debug visible en consola para validar conteo y totales
  try {
    console.group('Totales por departamento (debug)');
    console.log('P1 items:', conteoP1, 'Total P1 MXN:', totalP1Pesos.toFixed(2), 'Total P1 USD:', totalP1Dolares.toFixed(2), 'Gran Total P1 MXN:', granTotalP1MXN.toFixed(2), 'Gran Total P1 USD Convertido:', granTotalP1USDConvertido.toFixed(2));
    console.log('BA items:', conteoBA, 'Total BA MXN:', totalBAPesos.toFixed(2), 'Total BA USD:', totalBADolares.toFixed(2), 'Gran Total BA MXN:', granTotalBAMXN.toFixed(2), 'Gran Total BA USD Convertido:', granTotalBAUSDConvertido.toFixed(2));
    
    // Mostrar ejemplos de productos P1 y BA
    const ejemplosP1 = inventario.filter(p => p.nave_industrial_p1 === true || p.nave_industrial_p1 === null || p.nave_industrial_p1 === undefined).slice(0, 3);
    const ejemplosBA = inventario.filter(p => p.nave_industrial_p1 === false).slice(0, 3);
    
    console.log('Ejemplos P1:', ejemplosP1.map(p => ({id: p.id, nombre: p.nombre_completo, flag: p.nave_industrial_p1, precio_mxn: p.precio_mxn, precio_dlls: p.precio_dlls, stock: p.stock})));
    console.log('Ejemplos BA:', ejemplosBA.map(p => ({id: p.id, nombre: p.nombre_completo, flag: p.nave_industrial_p1, precio_mxn: p.precio_mxn, precio_dlls: p.precio_dlls, stock: p.stock})));
    console.groupEnd();
  } catch (e) {}
}

// Función para formatear precios en pesos
function formatearPrecio(precio) {
  return '$' + precio.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Función para formatear precios en dólares
function formatearPrecioUSD(precio) {
  return '$' + precio.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Instancia global
const inventarioDB = new InventarioDB();

// Cargar inventario cuando se carga la página
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM cargado, iniciando carga de inventario...');
  await inventarioDB.cargarInventario();
  console.log('Inventario cargado, calculando totales...');
  
  // Esperar un poco para asegurar que todos los elementos estén disponibles
  setTimeout(() => {
    // Calcular totales por departamento después de cargar el inventario
    if (typeof calcularTotalesPorDepartamento === 'function') {
      console.log('Función calcularTotalesPorDepartamento encontrada, ejecutando...');
      calcularTotalesPorDepartamento();
    } else {
      console.error('Función calcularTotalesPorDepartamento NO encontrada!');
    }
  }, 100);
});

document.getElementById('switchCurrency').addEventListener('change', function() {
  if (this.checked) {
    inventarioDB.mostrarPreciosEnUSD();
  } else {
    inventarioDB.mostrarPreciosEnMXN();
  }
  // Actualizar totales por departamento cuando cambie la moneda
  if (typeof calcularTotalesPorDepartamento === 'function') {
    calcularTotalesPorDepartamento();
  }
});

// Event listeners para el modal de detalles
document.addEventListener('DOMContentLoaded', function() {
  // Cerrar modal de detalles al hacer clic fuera
  document.getElementById('detailsModal').addEventListener('click', function(e) {
    if (e.target === this) {
      inventarioDB.cerrarModalDetalles();
    }
  });
  
  // Cerrar modal de detalles con ESC
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const detailsModal = document.getElementById('detailsModal');
      if (detailsModal && detailsModal.classList.contains('active')) {
        inventarioDB.cerrarModalDetalles();
      }
    }
  });
  
  // Botón para cerrar modal de detalles
  document.getElementById('closeDetailsModal').addEventListener('click', function() {
    inventarioDB.cerrarModalDetalles();
  });
});
