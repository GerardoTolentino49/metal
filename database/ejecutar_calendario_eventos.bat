@echo off
echo Ejecutando script de creacion de tablas calendario_eventos...
psql -U postgres -d apoyos_db -f "create_calendario_eventos_table.sql"
echo.
echo Proceso completado.
pause
