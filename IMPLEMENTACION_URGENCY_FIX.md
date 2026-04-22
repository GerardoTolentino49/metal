# Corrección de Lógica de Urgencia - Tickets de Mantenimiento

## Problema Identificado
Cuando un ticket se marca como "completed", su estado de urgencia cambia a "completed", lo que hace que todas las estadísticas se agrupen bajo el mismo estado, perdiendo la información de la urgencia original.

## Solución Implementada

### 1. Nueva Columna en Base de Datos
Se agregó la columna `last_urgency` a la tabla `tickets_mantenimiento` para guardar el último estado de urgencia antes de completarse.

### 2. Modificaciones en el Servidor
- **Endpoint**: `/api/mantenimiento/tickets/:id/urgency`
- **Lógica**: Antes de cambiar un ticket a "completed", se guarda su urgencia actual en `last_urgency`
- **Campos actualizados**: `urgency`, `last_urgency`, `time_end`

### 3. Modificaciones en el Frontend
- **Estadísticas**: Ahora usa `last_urgency` para agrupar tickets por nivel de urgencia
- **Visualización**: Muestra tiempos de resolución por nivel de urgencia (Crítico, Alto, Medio, Bajo)

## Archivos Modificados

### Base de Datos
- `add_last_urgency_column.sql` - Agregar columna last_urgency
- `update_existing_completed_tickets.sql` - Actualizar tickets existentes
- `test_urgency_logic.sql` - Script de verificación

### Servidor
- `server.js` - Endpoint de actualización de urgencia modificado

### Frontend
- `frontend/detalles_mantenimiento.html` - Lógica de estadísticas actualizada

## Pasos para Implementar

### Paso 1: Ejecutar Scripts SQL
```bash
# Conectar a la base de datos
psql -U postgres -d phoenix_tickets_mantenimiento

# Ejecutar scripts en orden:
\i add_last_urgency_column.sql
\i update_existing_completed_tickets.sql
\i test_urgency_logic.sql
```

### Paso 2: Reiniciar el Servidor
```bash
# Detener el servidor actual (Ctrl+C)
# Reiniciar el servidor
node server.js
```

### Paso 3: Verificar Funcionamiento
1. Crear un ticket con urgencia "critical"
2. Cambiar su urgencia a "high"
3. Marcar como "completed"
4. Verificar en las estadísticas que aparezca bajo "Alto" (no "Completado")

## Estructura de Datos

### Campos Relevantes
- `urgency`: Estado actual del ticket (completed, critical, high, medium, low)
- `last_urgency`: Último estado de urgencia antes de completarse
- `time_end`: Timestamp cuando se completó el ticket
- `timestamp`: Timestamp de creación del ticket

### Lógica de Estadísticas
```javascript
// Para tickets completados, usar last_urgency para agrupar
const lastUrgency = ticket.last_urgency || ticket.urgency || 'medium';
```

## Verificación

### Comandos de Verificación
```sql
-- Verificar estructura de la tabla
\d tickets_mantenimiento;

-- Verificar tickets completados
SELECT urgency, last_urgency, COUNT(*) 
FROM tickets_mantenimiento 
WHERE urgency = 'completed' 
GROUP BY urgency, last_urgency;

-- Verificar que no hay tickets completados sin last_urgency
SELECT COUNT(*) 
FROM tickets_mantenimiento 
WHERE urgency = 'completed' AND last_urgency IS NULL;
```

## Resultado Esperado
- Los tickets completados mantendrán su información de urgencia original
- Las estadísticas mostrarán tiempos de resolución por nivel de urgencia real
- Se podrá analizar la eficiencia de resolución por prioridad 