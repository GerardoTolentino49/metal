# Requisiciones — SQL para pgAdmin

El siguiente contenido incluye la sentencia `CREATE TABLE` y ejemplos de `INSERT` preparados para PostgreSQL. Puedes copiarlos y pegarlos directamente en el *Query Tool* de pgAdmin.

---

## Crear tabla

```sql
CREATE TABLE requisitions (
  id BIGSERIAL PRIMARY KEY,
  external_id VARCHAR(64), -- opcional: id externo generado por frontend (ej. req_<timestamp>)
  description TEXT NOT NULL,
  product_link TEXT,
  quantity INTEGER NOT NULL,
  target_type VARCHAR(20) CHECK (target_type IN ('usuario','departamento')),
  for_requester BOOLEAN NOT NULL DEFAULT FALSE,
  department TEXT,
  area TEXT,
  alternatives TEXT,
  -- Si prefieres guardar la imagen como BLOB:
  image_bytea BYTEA,
  image_mime TEXT,
  image_filename TEXT,
  -- O, alternativa recomendada: guardar la URL y no el BLOB
  image_url TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índices recomendados
CREATE INDEX ON requisitions (created_by);
CREATE INDEX ON requisitions (created_at);
```

---

## INSERT preparado (usando parámetros en pgAdmin / drivers)

```sql
INSERT INTO requisitions
  (external_id, description, product_link, quantity, target_type, for_requester, department, area, alternatives, image_bytea, image_mime, image_filename, image_url, created_by)
VALUES
  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
```

- Si ejecutas desde pgAdmin Query Tool, reemplaza `$1..$14` por valores literales apropiados (y escapa comillas). Ejemplo:

```sql
INSERT INTO requisitions
  (external_id, description, product_link, quantity, target_type, for_requester, department, area, alternatives, image_bytea, image_mime, image_filename, image_url, created_by)
VALUES
  ('req_1679876543210', 'Descripción de prueba', 'https://ejemplo.com/producto', 2, 'usuario', false, NULL, NULL, 'Alternativa A', NULL, NULL, NULL, NULL, 'usuario1');
```

---

## Recomendaciones

- Para imágenes grandes o muchas imágenes, almacena el archivo en disco o en un servicio de objetos (S3, Azure Blob) y guarda la `image_url` en la tabla.
- Utiliza consultas parametrizadas desde tu backend (`pg` para Node.js u otro cliente) y no concatenes valores directamente para evitar inyección SQL.
- Si necesitas buscar por departamento o área, considera añadir índices adicionales.

---

Si quieres, genero también el script Node.js que ejecuta este INSERT y opcionalmente guarda la imagen en disco y devuelve la URL.
