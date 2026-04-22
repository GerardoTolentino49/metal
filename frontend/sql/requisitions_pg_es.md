# Requisiciones — SQL para pgAdmin (nombres en español)

El siguiente contenido incluye la sentencia `CREATE TABLE` y ejemplos de `INSERT` listos para copiar en el *Query Tool* de pgAdmin, usando nombres de columnas en español.

---

## Crear tabla

```sql
CREATE TABLE requisiciones (
  id BIGSERIAL PRIMARY KEY,
  id_externo VARCHAR(64), -- opcional: id generado por el frontend (ej. req_<timestamp>)
  descripcion TEXT NOT NULL,
  enlace_producto TEXT,
  cantidad INTEGER NOT NULL,
  tipo_destino VARCHAR(20) CHECK (tipo_destino IN ('usuario','departamento')),
  es_para_solicitante BOOLEAN NOT NULL DEFAULT FALSE,
  departamento TEXT,
  area TEXT,
  alternativas TEXT,
  -- Si decides guardar la imagen en la base de datos:
  imagen_bytea BYTEA,
  imagen_mime TEXT,
  nombre_archivo_imagen TEXT,
  -- Alternativa recomendada: guardar solo la URL en lugar del BLOB
  url_imagen TEXT,
  creado_por TEXT,
  creado_en TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índices recomendados para consultas frecuentes
CREATE INDEX ON requisiciones (creado_por);
CREATE INDEX ON requisiciones (creado_en);
```

---

## INSERT preparado (parámetros para drivers / pg)

```sql
INSERT INTO requisiciones
  (id_externo, descripcion, enlace_producto, cantidad, tipo_destino, es_para_solicitante, departamento, area, alternativas, imagen_bytea, imagen_mime, nombre_archivo_imagen, url_imagen, creado_por)
VALUES
  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
```

Si pegas directamente en pgAdmin, reemplaza `$1..$14` por valores literales (y escapa comillas). Ejemplo:

```sql
INSERT INTO requisiciones
  (id_externo, descripcion, enlace_producto, cantidad, tipo_destino, es_para_solicitante, departamento, area, alternativas, imagen_bytea, imagen_mime, nombre_archivo_imagen, url_imagen, creado_por)
VALUES
  ('req_1679876543210', 'Descripción de prueba en español', 'https://ejemplo.com/producto', 2, 'usuario', false, NULL, NULL, 'Alternativa A', NULL, NULL, NULL, NULL, 'usuario1');
```

---

## Recomendaciones (resumen)

- Para imágenes grandes o muchas imágenes, almacena el archivo en disco o en un servicio de objetos (p. ej. S3) y guarda solo `url_imagen`.
- Usa consultas parametrizadas desde tu backend (`pg` en Node.js u otro cliente) para evitar inyecciones SQL.
- Añade índices sobre `departamento` o `area` si planeas filtrar frecuentemente por esos campos.

---

¿Quieres que genere también un script en Node.js en español que reciba los campos del formulario, guarde la imagen en disco y ejecute este `INSERT` con `pg`?