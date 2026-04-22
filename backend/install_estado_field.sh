#!/bin/bash

# Script para instalar el campo estado en la tabla inventario
# Ejecutar desde la carpeta backend/

echo "🔧 Instalando campo estado en tabla inventario..."

# Configuración de la base de datos
DB_NAME="apoyos_db"
DB_USER="postgres"
DB_HOST="localhost"
DB_PORT="5432"

# Archivo SQL a ejecutar
SQL_FILE="database/add_estado_column.sql"

# Verificar que existe el archivo SQL
if [ ! -f "$SQL_FILE" ]; then
    echo "❌ Error: No se encontró el archivo $SQL_FILE"
    exit 1
fi

# Ejecutar el SQL
echo "📝 Ejecutando script SQL..."
PGPASSWORD="phoenix123" psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $SQL_FILE

if [ $? -eq 0 ]; then
    echo "✅ Campo estado agregado exitosamente!"
    echo "📊 Verificando la estructura de la tabla..."
    
    # Verificar que la columna se agregó
    PGPASSWORD="phoenix123" psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "\d inventario" | grep estado
    
    echo "🎉 Instalación completada!"
else
    echo "❌ Error al ejecutar el script SQL"
    exit 1
fi
