-- Verificar la estructura de la tabla tickets
\d tickets;

-- Verificar si hay datos en la tabla
SELECT COUNT(*) FROM tickets;
 
-- Verificar los últimos 5 tickets
SELECT id, name, email, department, issue, anydesk, urgency, timestamp 
FROM tickets 
ORDER BY timestamp DESC 
LIMIT 5; 