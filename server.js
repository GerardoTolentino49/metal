
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const pino = require('pino');
const pinoHttp = require('pino-http');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Secret key para JWT (cambiar en producción a variable de entorno)
const JWT_SECRET = process.env.JWT_SECRET || 'phoenix123';

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      levelFirst: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,res,req,responseTime'
    }
  }
});

app.use(pinoHttp({ 
  logger,
  autoLogging: false,
  genReqId: function (req, res) {
    return req.headers['x-request-id'] || randomUUID();
  },
  customProps: function (req, res) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    // Derivar página desde el referer si existe
  // ==================== ENDPOINTS AMONESTACIONES (MOVIDOS ANTES DE STATIC/404) ====================
    let page = '';
    const referer = req.headers['referer'] || '';
    if (referer) {
      try {
        const u = new URL(referer);
        page = u.pathname || '';
      } catch (_) {
        page = referer;
      }
    } else {
      page = req.url || '';
    }
    const username = (req.session && req.session.username) ? req.session.username : 'Anonimo';
    return {
      ip,
      username,
      page
    };
  },
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 300 && res.statusCode < 400) return 'silent';
    return 'info';
  },
  customSuccessMessage: function (req, res) {
    const method = req.method;
    const url = req.url;
    const statusCode = res.statusCode;
    const responseTime = res.getHeader('X-Response-Time');
    const username = (req.session && req.session.username) ? req.session.username : 'Anonimo';
    // Derivar página desde el referer si existe
    let page = '';
    const referer = req.headers['referer'] || '';
    if (referer) {
      try {
        const u = new URL(referer);
        page = u.pathname || '';
      } catch (_) {
        page = referer;
      }
    } else {
      page = req.url || '';
    }
    return `[${method}] ${url} - ${statusCode}${responseTime ? ` (${responseTime}ms)` : ''} | user=${username} | page=${page}`;
  },
  customErrorMessage: function (req, res, err) {
    const method = req.method;
    const url = req.url;
    const statusCode = res.statusCode;
    const username = (req.session && req.session.username) ? req.session.username : 'Anonimo';
    // Derivar página desde el referer si existe
    let page = '';
    const referer = req.headers['referer'] || '';
    if (referer) {
      try {
        const u = new URL(referer);
        page = u.pathname || '';
      } catch (_) {
        page = referer;
      }
    } else {
      page = req.url || '';
    }
    return `[ERROR] ${method} ${url} - ${statusCode} - ${err.message} | user=${username} | page=${page}`;
  }
}));

// Asegurarse de que la carpeta uploads existe
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuración de sesión
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'tu_clave_secreta',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.SESSION_COOKIE_SECURE === 'true' ? true : 'auto',
    sameSite: 'lax',
    httpOnly: true
  }
}));

// Middlewares
// Permitir cookies de sesión en llamadas fetch del frontend
app.use(cors({
  origin: true,              // refleja el origin de la petición
  credentials: true          // habilita envío de cookies/sesión
}));

// Middleware para medir tiempo de respuesta
app.use((req, res, next) => {
  const start = Date.now();
  
  // Usar res.locals para almacenar el tiempo de inicio
  res.locals.startTime = start;
  
  // Agregar listener para cuando la respuesta termine
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Log del tiempo de respuesta (estructurado)
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    // Derivar página desde el referer si existe
    let page = '';
    const referer = req.headers['referer'] || '';
    if (referer) {
      try {
        const u = new URL(referer);
        page = u.pathname || '';
      } catch (_) {
        page = referer;
      }
    } else {
      page = req.url || '';
    }
    const username = (req.session && req.session.username) ? req.session.username : 'Anonimo';
    logger.info({
      tag: 'TIME',
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      ip,
      
      username,
      page
    }, 'HTTP response time');
  });
  
  next();
});

// Configurar límites más altos para body-parser
app.use(express.json({ 
  limit: '50mb',  // Aumentar a 50MB para permitir archivos/requests grandes cuando corresponda
  extended: true 
}));

app.use(express.urlencoded({ 
  limit: '50mb',  // Aumentar a 50MB para permitir formularios grandes
  extended: true 
}));

// Configurar límites para raw-body
app.use((req, res, next) => {
  req.setTimeout(300000); // 5 minutos
  res.setTimeout(300000);
  next();
});

// Registrar actividad de sesiones autenticadas en la BD
app.use(async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return next();
  }

  const sessionId = req.sessionID;
  const userId = req.session.userId;
  const username = req.session.username || 'Anonimo';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    const updateResult = await apoyosPool.query(
      `UPDATE sesiones
       SET ultima_actividad = NOW(),
           fin = NOW(),
           minutos_acumulados = GREATEST(
             COALESCE(minutos_acumulados, 0),
             FLOOR(EXTRACT(EPOCH FROM (NOW() - inicio)) / 60)
           ),
           ip = COALESCE($2, ip),
           user_agent = COALESCE($3, user_agent),
           -- estos campos de tiempo se actualizarán explícitamente desde /api/diseno/finish-session
           updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, ip, userAgent]
    );

    if (updateResult.rowCount === 0) {
      await apoyosPool.query(
        `INSERT INTO sesiones (
           usuario_id, username, session_id, ip, user_agent, inicio, ultima_actividad, minutos_acumulados, activo, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 0, true, NOW(), NOW())`,
        [userId, username, sessionId, ip, userAgent]
      );
    }
  } catch (error) {
    logger.warn({ tag: 'SESIONES', message: 'No se pudo registrar actividad de sesión', error: error?.message });
  }

  next();
});

// Configuración de multer para archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Usar el nombre original del archivo
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // Aumentar a 50MB para archivos grandes
  },
  fileFilter: (req, file, cb) => {
    // Aceptar cualquier tipo de archivo para la bóveda
    cb(null, true);
  }
});

// Multer para PDFs
const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const uploadPdf = multer({
  storage: pdfStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'));
    }
  }
});

// Multer para archivos Excel (BOM)
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads', 'bom');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const uploadExcelBom = multer({
  storage: excelStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const originalName = (file.originalname || '').toLowerCase();
    const isExcelMime = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ].includes(file.mimetype);
    const isExcelOrCsvExt =
      originalName.endsWith('.xlsx') ||
      originalName.endsWith('.xls') ||
      originalName.endsWith('.csv');
    if (isExcelMime || isExcelOrCsvExt) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten archivos Excel o CSV (.xlsx, .xls, .csv)'));
  }
});

// Servir archivos estáticos desde la carpeta uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/MEDIA', express.static(path.join(__dirname, 'MEDIA')));

// Servir archivos estáticos del frontend
app.use('/frontend', express.static(path.join(__dirname, 'frontend')));
app.use('/', express.static(path.join(__dirname, 'frontend'), {
    index: false // Evitar que sirva automáticamente index.html
}));

// Asegurar tabla salidas en BD y endpoints persistentes
async function ensureSalidasTable() {
  try {
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS salidas (
        id SERIAL PRIMARY KEY,
        departamento TEXT NOT NULL,
        empleado TEXT NOT NULL,
        fecha TIMESTAMPTZ DEFAULT NOW(),
        codigo_producto TEXT NOT NULL,
        descripcion TEXT NOT NULL,
        clasificacion TEXT NOT NULL,
        cantidad INTEGER NOT NULL,
        motivo TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (error) {
    logger.error('Error al crear/verificar tabla salidas:', error);
  }
}

// Asegurar tabla de log de entradas individuales (idempotente; llamar antes de SELECT/INSERT)
async function ensureInventarioEntradaTable() {
  await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS inventario_entrada (
        id          SERIAL PRIMARY KEY,
        codigo      VARCHAR(150),
        descripcion TEXT,
        cantidad    NUMERIC(14,4) NOT NULL DEFAULT 0,
        po          VARCHAR(150),
        factura     VARCHAR(150),
        categoria   VARCHAR(150),
        proveedor   VARCHAR(255),
        heat_number VARCHAR(150),
        fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  await inventarioPool.query(`ALTER TABLE inventario_entrada ADD COLUMN IF NOT EXISTS heat_number VARCHAR(150);`);
  await inventarioPool.query(`ALTER TABLE inventario_salida ADD COLUMN IF NOT EXISTS heat_number VARCHAR(150);`);
  await inventarioPool.query(`ALTER TABLE inventario ADD COLUMN IF NOT EXISTS heat_number VARCHAR(150);`);
  await inventarioPool.query(`
      CREATE INDEX IF NOT EXISTS idx_inv_entrada_codigo
      ON inventario_entrada ((LOWER(TRIM(codigo))));
    `);
  await inventarioPool.query(`
      CREATE INDEX IF NOT EXISTS idx_inv_entrada_fecha
      ON inventario_entrada (fecha DESC);
    `);
  await inventarioPool.query(`
      CREATE INDEX IF NOT EXISTS idx_inv_entrada_created
      ON inventario_entrada (created_at DESC);
    `);
}

// Asegurar tabla proveedores
async function ensureProveedoresTable() {
  try {
    logger.info('[ensureProveedoresTable] Verificando/creando estructura de proveedores...');
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS proveedores (
        id SERIAL PRIMARY KEY,
        supplier         TEXT NOT NULL,
        address          TEXT,
        address2         TEXT,
        telephone        TEXT,
        email            TEXT,
        supplier_type    TEXT,
        credit           TEXT, -- 'yes'/'no' o boolean mapeado como texto
        iva              INTEGER, -- 0, 8, 16
        credit_days      INTEGER,
        credit_amount    NUMERIC(14,2),
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Asegurar columnas usadas por endpoints (tel/mail) y restricción única para ON CONFLICT (supplier)
    await inventarioPool.query(`
      ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS tel TEXT;
      ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS mail TEXT;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes 
          WHERE schemaname = ANY (current_schemas(false))
            AND indexname = 'proveedores_supplier_unique_idx'
        ) THEN
          CREATE UNIQUE INDEX proveedores_supplier_unique_idx ON proveedores (supplier);
        END IF;
      END$$;
    `);
    const resCols = await inventarioPool.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'proveedores' ORDER BY column_name
    `);
    logger.info('[ensureProveedoresTable] Columnas actuales proveedores:', resCols.rows.map(r => r.column_name));
  } catch (error) {
    logger.error('Error al crear/verificar tabla proveedores:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Asegurar tabla PO
async function ensurePoTable() {
  try {
    logger.info('[ensurePoTable] Verificando/creando tabla PO...');
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS PO (
        id BIGSERIAL PRIMARY KEY,
        orden_compra VARCHAR(255),
        proveedor INTEGER,
        enviar_a TEXT,
        locacion VARCHAR(255),
        via_despacho VARCHAR(50),
        fecha_po TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fecha_requerida TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        flete VARCHAR(255),
        notas VARCHAR(255),
        certificado BOOL,
        iva BOOL,
        creado_por VARCHAR(500),
        total VARCHAR(255)
      );
    `);
    await inventarioPool.query(`
      ALTER TABLE po
        ADD COLUMN IF NOT EXISTS tf BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    await inventarioPool.query(`
      ALTER TABLE po
        ADD COLUMN IF NOT EXISTS usuario_compra_id INTEGER;
    `);
    await inventarioPool.query(`
      ALTER TABLE po
        ADD COLUMN IF NOT EXISTS total_numerico NUMERIC(14, 2);
    `);
    await inventarioPool.query(`
      ALTER TABLE po
        ADD COLUMN IF NOT EXISTS proveedor_nombre TEXT,
        ADD COLUMN IF NOT EXISTS proveedor_direccion TEXT,
        ADD COLUMN IF NOT EXISTS proveedor_tipo VARCHAR(80),
        ADD COLUMN IF NOT EXISTS iva_pct NUMERIC(8, 4),
        ADD COLUMN IF NOT EXISTS terms_credit_days INTEGER,
        ADD COLUMN IF NOT EXISTS enviar_a_direccion TEXT,
        ADD COLUMN IF NOT EXISTS require_confirm_text_snap TEXT,
        ADD COLUMN IF NOT EXISTS require_confirm_enabled_snap BOOLEAN DEFAULT TRUE;
    `);
    try {
      await inventarioPool.query(`ALTER TABLE po ALTER COLUMN proveedor TYPE BIGINT USING proveedor::bigint;`);
    } catch (eAl) {
      logger.warn('[ensurePoTable] No se pudo convertir proveedor a BIGINT (puede ser normal si ya está aplicado):', eAl?.message || eAl);
    }
    logger.info('[ensurePoTable] Tabla PO verificada');
  } catch (err) {
    logger.error('[ensurePoTable] Error al crear/verificar tabla PO:', err?.message || err);
  }
}

async function ensurePoItemsExtraColumns() {
  try {
    await inventarioPool.query(`
      ALTER TABLE po_items
        ADD COLUMN IF NOT EXISTS uom VARCHAR(80),
        ADD COLUMN IF NOT EXISTS belongs_to TEXT,
        ADD COLUMN IF NOT EXISTS line_extended_numeric NUMERIC(14, 4);
    `);
  } catch (err) {
    logger.error('[ensurePoItemsExtraColumns]', err?.message || err);
  }
}

// Asegurar tabla sesiones para auditoría de accesos
async function ensureSesionesTable() {
  try {
    logger.info('[ensureSesionesTable] Verificando/creando tabla sesiones...');
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS sesiones (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        username TEXT NOT NULL,
        session_id TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fin TIMESTAMPTZ,
        minutos_acumulados INTEGER NOT NULL DEFAULT 0,
        -- tiempos de estados en formato HH:MM:SS
        tiempo_working INTERVAL DEFAULT '00:00:00',
        tiempo_pendiente INTERVAL DEFAULT '00:00:00',
        tiempo_esperando_informacion INTERVAL DEFAULT '00:00:00',
        tiempo_buscando_informacion INTERVAL DEFAULT '00:00:00',
        tiempo_aprobado INTERVAL DEFAULT '00:00:00',
        tiempo_pausa INTERVAL DEFAULT '00:00:00',
        tiempo_comida INTERVAL DEFAULT '00:00:00',
        tiempo_5s INTERVAL DEFAULT '00:00:00',
        tiempo_meeting INTERVAL DEFAULT '00:00:00',
        ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Asegurar columnas de tiempos en tablas ya existentes
    await apoyosPool.query(`
      ALTER TABLE sesiones
        ADD COLUMN IF NOT EXISTS tiempo_working INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS tiempo_pendiente INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS tiempo_esperando_informacion INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS tiempo_buscando_informacion INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS tiempo_aprobado INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS tiempo_pausa INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS tiempo_comida INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS tiempo_5s INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS tiempo_meeting INTERVAL DEFAULT '00:00:00',
        ADD COLUMN IF NOT EXISTS checklist integer[] DEFAULT '{}'::integer[];
    `);
    await apoyosPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sesiones_session_id_idx ON sesiones (session_id);`);
    await apoyosPool.query(`CREATE INDEX IF NOT EXISTS idx_sesiones_checklist_gin ON sesiones USING GIN (checklist);`);
    await apoyosPool.query(`CREATE INDEX IF NOT EXISTS sesiones_usuario_id_idx ON sesiones (usuario_id);`);
  } catch (error) {
    logger.error('Error al crear/verificar tabla sesiones:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

async function ensureCambiosEstadoTable() {
  try {
    logger.info('[ensureCambiosEstadoTable] Verificando/creando tabla cambios_estado...');
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS cambios_estado (
        id BIGSERIAL PRIMARY KEY,
        tiempo_diseno_id INTEGER NOT NULL REFERENCES tiempo_diseno(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        tipo_estado VARCHAR(20) NOT NULL,
        estado VARCHAR(50),
        presionado BOOLEAN NOT NULL DEFAULT FALSE,
        fecha_cambio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await apoyosPool.query(`
      ALTER TABLE cambios_estado
      ADD COLUMN IF NOT EXISTS presionado BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS cambios_estado_tiempo_idx
      ON cambios_estado (tiempo_diseno_id, fecha_cambio ASC, id ASC);
    `);

    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS cambios_estado_user_idx
      ON cambios_estado (LOWER(TRIM(username)), fecha_cambio DESC);
    `);
  } catch (error) {
    logger.error('Error al crear/verificar tabla cambios_estado:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Asegurar tabla requisiciones (según esquema pedido)
async function ensureRequisicionesTable() {
  try {
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS requisiciones (
        id BIGSERIAL PRIMARY KEY,
        descripcion TEXT NOT NULL,
        enlace_producto TEXT,
        cantidad INTEGER NOT NULL,
        url_imagen TEXT,
        tipo_destino VARCHAR(20) CHECK (tipo_destino IN ('usuario','departamento')),
        es_para_solicitante BOOLEAN NOT NULL DEFAULT FALSE,
        departamento TEXT,
        area TEXT,
        alternativas TEXT,
        usuario_destino TEXT,
        estatus TEXT NOT NULL DEFAULT 'Pendiente',
        creado_por TEXT,
        creado_en TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
    `);
    await inventarioPool.query(`CREATE INDEX IF NOT EXISTS requisiciones_creado_por_idx ON requisiciones (creado_por);`);
    await inventarioPool.query(`ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS usuario_destino TEXT;`);
    await inventarioPool.query(`CREATE INDEX IF NOT EXISTS requisiciones_usuario_destino_idx ON requisiciones (usuario_destino);`);
    await inventarioPool.query(`ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS usuarios_asignados TEXT;`);
    await inventarioPool.query(`ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS estatus TEXT NOT NULL DEFAULT 'Pendiente';`);
    await inventarioPool.query(`ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS po_creada BOOLEAN DEFAULT FALSE;`);
    await inventarioPool.query(`ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS po_id BIGINT;`);
  } catch (error) {
    logger.error('Error al crear/verificar tabla requisiciones:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Asegurar tabla incapacidades (ausencias médicas)
async function ensureIncapacidadesTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS incapacidades (
        id SERIAL PRIMARY KEY,
        empleado_id INTEGER NOT NULL,
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL,
        motivo TEXT NOT NULL,
        evidencia VARCHAR(255),
        notas TEXT,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
        aprobado_por VARCHAR(100),
        fecha_aprobacion TIMESTAMP,
        CONSTRAINT fk_empleado_incapacidades FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
      );
    `);
    await apoyosPool.query(`CREATE INDEX IF NOT EXISTS idx_incapacidades_empleado_id ON incapacidades (empleado_id);`);
    logger.info('[ensureIncapacidadesTable] OK');
  } catch (error) {
    logger.error('Error al crear/verificar tabla incapacidades:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Asegurar tabla UOMS_pyc
async function ensureUomsPycTable() {
  try {
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS UOMS_pyc (
        id SERIAL PRIMARY KEY,
        descripcion VARCHAR(255) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await inventarioPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_uoms_pyc_descripcion ON UOMS_pyc (lower(descripcion));`);
    logger.info('[ensureUomsPycTable] OK');
  } catch (error) {
    logger.error('Error al crear/verificar tabla UOMS_pyc:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Asegurar tabla linea_producto
async function ensureLineaProductoTable() {
  try {
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS linea_producto (
        id SERIAL PRIMARY KEY,
        descripcion VARCHAR(255) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await inventarioPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_linea_producto_descripcion ON linea_producto (lower(descripcion));`);
    logger.info('[ensureLineaProductoTable] OK');
  } catch (error) {
    logger.error('Error al crear/verificar tabla linea_producto:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Asegurar tabla grado
async function ensureGradoTable() {
  try {
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS grado (
        id SERIAL PRIMARY KEY,
        descripcion VARCHAR(255) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await inventarioPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_grado_descripcion ON grado (lower(descripcion));`);
    logger.info('[ensureGradoTable] OK');
  } catch (error) {
    logger.error('Error al crear/verificar tabla grado:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Asegurar tabla commodity
async function ensureCommodityTable() {
  try {
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS commodity (
        id SERIAL PRIMARY KEY,
        descripcion VARCHAR(255) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await inventarioPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_commodity_descripcion ON commodity (lower(descripcion));`);
    logger.info('[ensureCommodityTable] OK');
  } catch (error) {
    logger.error('Error al crear/verificar tabla commodity:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Asegurar tabla enviar_a (modal Items — Enviar a)
async function ensureEnviarATable() {
  try {
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS enviar_a (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(512) NOT NULL,
        direccion TEXT DEFAULT '',
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await inventarioPool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_enviar_a_nombre_lower ON enviar_a (lower(trim(nombre)));`,
    );
    logger.info('[ensureEnviarATable] OK');
  } catch (error) {
    logger.error('Error al crear/verificar tabla enviar_a:', {
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
    });
  }
}

// Asegurar tabla items (para modal de Items)
async function ensureItemsTable() {
  try {
    await inventarioPool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(255),
        descripcion TEXT,
        uom VARCHAR(100),
        commodity VARCHAR(255),
        grado VARCHAR(100),
        cfdi VARCHAR(255),
        categoria VARCHAR(255),
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await inventarioPool.query(`CREATE INDEX IF NOT EXISTS idx_items_codigo ON items (lower(coalesce(codigo,'')));`);
    await inventarioPool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`);
    logger.info('[ensureItemsTable] OK');
  } catch (error) {
    logger.error('Error al crear/verificar tabla items:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

// Columna item_id en inventario → FK a catálogo items (un registro de inventario por item del catálogo)
async function ensureInventarioItemIdFk() {
  try {
    await inventarioPool.query(`ALTER TABLE inventario ADD COLUMN IF NOT EXISTS item_id INTEGER;`);
    await inventarioPool.query(`
      DO $do$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'inventario_item_id_fkey'
        ) THEN
          ALTER TABLE inventario
            ADD CONSTRAINT inventario_item_id_fkey
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;
        END IF;
      END
      $do$;
    `);
    await inventarioPool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inventario_item_id_unique
      ON inventario (item_id) WHERE item_id IS NOT NULL;
    `);
    logger.info('[ensureInventarioItemIdFk] OK');
  } catch (error) {
    logger.error('[ensureInventarioItemIdFk]', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

function parseUsuariosAsignadosValue(rawValue) {
  if (!rawValue) {
    return [];
  }

  const convert = (value) => {
    const numeric = parseInt(value, 10);
    return Number.isFinite(numeric) ? numeric : null;
  };

  if (Array.isArray(rawValue)) {
    return rawValue
      .map(convert)
      .filter((value) => value !== null);
  }

  const textValue = String(rawValue || '').trim();
  if (!textValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(textValue);
    if (Array.isArray(parsed)) {
      return parsed
        .map(convert)
        .filter((value) => value !== null);
    }
  } catch (error) {
    // Ignorar error y usar fallback por CSV
  }

  return textValue
    .split(',')
    .map(convert)
    .filter((value) => value !== null);
}

// Asegurar tabla comunidad (comentarios del menú contextual)
async function ensureComunidadTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS comunidad (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50),
        mensaje TEXT,
        fecha_creacion TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    logger.info('[ensureComunidadTable] OK');
  } catch (error) {
    logger.error('[ensureComunidadTable] Error al crear/verificar tabla comunidad:', { message: error?.message, code: error?.code, detail: error?.detail });
  }
}

function normalizeRequisicionStatusKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** No cambiar estatus por asignación si ya hay PO o estatus terminal */
function isRequisicionEstatusPostAssignmentLocked(estatusRaw, poCreada) {
  if (poCreada === true || poCreada === 't' || poCreada === 1) return true;
  const n = normalizeRequisicionStatusKey(estatusRaw);
  if (!n) return false;
  return (
    n.includes('po generada') ||
    n.includes('po recibida') ||
    n === 'realizado' ||
    n === 'autorizado'
  );
}

/** Pendiente sin asignados → Cotizando al asignar; Cotizando → Pendiente al quitar todos (si no está bloqueado) */
function deriveRequisicionEstatusAfterUsuariosUpdate(existingRow, userIds) {
  const locked = isRequisicionEstatusPostAssignmentLocked(existingRow.estatus, existingRow.po_creada);
  const ids = Array.isArray(userIds) ? userIds : [];

  if (ids.length === 0) {
    if (locked) return existingRow.estatus;
    const n = normalizeRequisicionStatusKey(existingRow.estatus);
    if (n === 'cotizando') return 'Pendiente';
    return existingRow.estatus;
  }

  if (locked) return existingRow.estatus;
  return 'Cotizando';
}

function normalizeRequisicionStatus(rawStatus) {
  const normalized = normalizeRequisicionStatusKey(rawStatus);

  if (!normalized) return null;

  const aliases = {
    pendiente: 'Pendiente',
    cotizando: 'Cotizando',
    'en proceso': 'En proceso',
    proceso: 'En proceso',
    'en revision': 'En revisión',
    revision: 'En revisión',
    autorizado: 'Autorizado',
    realizado: 'Realizado',
    'po generada': 'PO generada',
    po_generada: 'PO generada',
    'po-generada': 'PO generada',
    'po recibida': 'PO recibida',
    po_recibida: 'PO recibida',
    'po recibida parcialmente': 'PO recibida parcialmente',
    po_recibida_parcialmente: 'PO recibida parcialmente'
  };

  return aliases[normalized] || null;
}

function normalizeStatusForTimerKey(rawStatus) {
  const value = (rawStatus || '').toString().trim().toLowerCase();
  if (!value) return null;
  if (value === 'aprobado') return 'esperando_informacion';
  if (value === 'documentación') return 'documentacion';
  return value;
}

async function buildStatusTimersFromCambios({ sessionId, horaInicio, fallbackTrabajo, fallbackAusencia }) {
  const timers = {
    working: 0,
    pausa: 0,
    comida: 0,
    '5s': 0,
    meeting: 0,
    meeting_trabajo: 0,
    training: 0,
    pendiente: 0,
    cambios: 0,
    esperando_informacion: 0,
    buscando_informacion: 0,
    documentacion: 0,
    pdm_rwk: 0,
    revision_orden: 0
  };

  const validWorkStatuses = new Set(['working', 'pendiente', 'cambios', 'esperando_informacion', 'buscando_informacion', 'documentacion']);
  const validAusenciaStatuses = new Set(['pausa', 'comida', '5s', 'meeting', 'meeting_trabajo', 'training', 'pdm_rwk', 'revision_orden']);

  const sessionStartMs = new Date(horaInicio).getTime();
  if (!Number.isFinite(sessionStartMs)) {
    return timers;
  }

  const historyResult = await apoyosPool.query(
    `SELECT tipo_estado, estado, presionado, fecha_cambio
     FROM cambios_estado
     WHERE tiempo_diseno_id = $1
     ORDER BY fecha_cambio ASC, id ASC`,
    [sessionId]
  );

  let currentWorkStatus = normalizeStatusForTimerKey(fallbackTrabajo);
  if (!currentWorkStatus || !validWorkStatuses.has(currentWorkStatus)) {
    currentWorkStatus = 'working';
  }

  let currentAusenciaStatus = normalizeStatusForTimerKey(fallbackAusencia);
  if (!currentAusenciaStatus || !validAusenciaStatuses.has(currentAusenciaStatus)) {
    currentAusenciaStatus = null;
  }

  let cursorMs = sessionStartMs;

  const applyElapsed = (endMs) => {
    const deltaMs = endMs - cursorMs;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      cursorMs = endMs;
      return;
    }

    if (currentAusenciaStatus && Object.prototype.hasOwnProperty.call(timers, currentAusenciaStatus)) {
      timers[currentAusenciaStatus] += deltaMs;
    } else if (currentWorkStatus && Object.prototype.hasOwnProperty.call(timers, currentWorkStatus)) {
      timers[currentWorkStatus] += deltaMs;
    }

    cursorMs = endMs;
  };

  for (const change of historyResult.rows) {
    const changeMs = new Date(change.fecha_cambio).getTime();
    if (!Number.isFinite(changeMs)) {
      continue;
    }

    const effectiveMs = Math.max(changeMs, cursorMs);
    applyElapsed(effectiveMs);

    const normalizedStatus = normalizeStatusForTimerKey(change.estado);
    const isPressed = change.presionado === true;
    if (change.tipo_estado === 'trabajo') {
      if (isPressed) {
        currentWorkStatus = normalizedStatus && validWorkStatuses.has(normalizedStatus) ? normalizedStatus : null;
      } else if (!normalizedStatus || currentWorkStatus === normalizedStatus) {
        currentWorkStatus = null;
      }
    } else if (change.tipo_estado === 'ausencia') {
      if (isPressed) {
        currentAusenciaStatus = normalizedStatus && validAusenciaStatuses.has(normalizedStatus) ? normalizedStatus : null;
      } else if (!normalizedStatus || currentAusenciaStatus === normalizedStatus) {
        currentAusenciaStatus = null;
      }
    }
  }

  applyElapsed(Date.now());

  return timers;
}

function normalizeTimelineEstado(rawEstado) {
  const normalized = (rawEstado || '').toString().trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'documentación') return 'documentacion';
  if (normalized === 'meeting trabajo') return 'meeting_trabajo';
  return normalized;
}

function clipTimelineSegment(segment, rangeStartMs, rangeEndMs) {
  if (!segment) return null;
  const effectiveStart = Math.max(segment.startMs, rangeStartMs);
  const effectiveEnd = Math.min(segment.endMs, rangeEndMs);
  if (!Number.isFinite(effectiveStart) || !Number.isFinite(effectiveEnd) || effectiveEnd <= effectiveStart) {
    return null;
  }
  return {
    ...segment,
    start: new Date(effectiveStart).toISOString(),
    end: new Date(effectiveEnd).toISOString(),
    durationMs: effectiveEnd - effectiveStart
  };
}

function buildTimelineSegmentsForSession(sessionMeta, eventos, rangeStartMs, rangeEndMs) {
  const { hora_inicio: horaInicio, hora_fin: horaFin } = sessionMeta || {};
  const sessionStartMs = new Date(horaInicio).getTime();
  if (!Number.isFinite(sessionStartMs)) {
    return [];
  }
  const sessionEndMs = horaFin ? new Date(horaFin).getTime() : Date.now();
  if (!Number.isFinite(sessionEndMs) || sessionEndMs <= sessionStartMs) {
    return [];
  }

  const orderedEvents = Array.isArray(eventos)
    ? eventos.slice().sort((a, b) => new Date(a.fecha_cambio) - new Date(b.fecha_cambio))
    : [];

  const rawSegments = [];
  let cursorMs = sessionStartMs;
  let currentWorkStatus = 'working';
  let currentAusenciaStatus = null;

  const pushSegment = (endMs) => {
    if (!Number.isFinite(endMs) || endMs <= cursorMs) {
      cursorMs = Number.isFinite(endMs) ? endMs : cursorMs;
      return;
    }

    const activeTipo = currentAusenciaStatus ? 'ausencia' : 'trabajo';
    const activeEstado = currentAusenciaStatus || currentWorkStatus || 'working';

    rawSegments.push({
      startMs: cursorMs,
      endMs: endMs,
      tipo: activeTipo,
      estado: activeEstado,
      orden: sessionMeta?.orden || null,
      numero_parte: sessionMeta?.numero_parte || null,
      cliente: sessionMeta?.cliente || null,
      username: sessionMeta?.username || null,
      tiempo_diseno_id: sessionMeta?.id || null
    });

    cursorMs = endMs;
  };

  for (const change of orderedEvents) {
    if (!change || !change.fecha_cambio) continue;
    const changeMs = new Date(change.fecha_cambio).getTime();
    if (!Number.isFinite(changeMs)) continue;

    const effectiveMs = Math.max(changeMs, cursorMs);
    pushSegment(effectiveMs);

    const normalizedEstado = normalizeTimelineEstado(change.estado);
    const isPressed = change.presionado === true;

    if (change.tipo_estado === 'ausencia') {
      if (isPressed && normalizedEstado) {
        currentAusenciaStatus = normalizedEstado;
      } else if (!isPressed && (!normalizedEstado || normalizedEstado === currentAusenciaStatus)) {
        currentAusenciaStatus = null;
      }
    } else if (change.tipo_estado === 'trabajo') {
      if (isPressed && normalizedEstado) {
        currentWorkStatus = normalizedEstado;
      } else if (!isPressed && (!normalizedEstado || normalizedEstado === currentWorkStatus)) {
        currentWorkStatus = 'working';
      }
    }
  }

  pushSegment(sessionEndMs);

  const clippedSegments = rawSegments
    .map((segment) => clipTimelineSegment(segment, rangeStartMs, rangeEndMs))
    .filter(Boolean)
    .map((segment) => ({
      ...segment,
      durationMs: segment.durationMs ?? (segment.endMs - segment.startMs)
    }));

  return clippedSegments;
}

// Endpoint para leer el log de entradas individuales
app.get('/api/entradas', async (req, res) => {
  try {
    await ensureInventarioEntradaTable();
    const result = await inventarioPool.query(`
      SELECT
        id,
        COALESCE(codigo, '')      AS codigo,
        COALESCE(descripcion, '') AS descripcion,
        cantidad,
        COALESCE(po, '')          AS po,
        COALESCE(factura, '')     AS factura,
        COALESCE(categoria, '')   AS categoria,
        COALESCE(proveedor, '')   AS proveedor,
        COALESCE(heat_number, '') AS heat_number,
        fecha,
        created_at
      FROM inventario_entrada
      ORDER BY created_at DESC, id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error al obtener entradas:', error);
    res.status(500).json({ error: 'Error al obtener entradas', message: error.message });
  }
});

// Endpoints para Salidas (persistencia en Postgres)
app.get('/api/salidas', async (req, res) => {
  try {
    const result = await inventarioPool.query(`
      SELECT 
        id,
        departamento,
        empleado,
        fecha,
        codigo_producto AS "codigoProducto",
        descripcion,
        clasificacion,
        cantidad,
        motivo,
        COALESCE(heat_number, '') AS heat_number
      FROM inventario_salida
      ORDER BY fecha DESC, id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error al obtener salidas:', error);
    res.status(500).json({ error: 'Error al obtener salidas' });
  }
});

app.post('/api/salidas', async (req, res) => {
  try {
    const {
      departamento,
      empleado,
      fecha,
      codigoProducto,
      descripcion,
      clasificacion,
      cantidad,
      motivo,
      tipo,
      heatNumber
    } = req.body || {};

    if (!departamento || !empleado || !codigoProducto || !descripcion || !clasificacion || !cantidad) {
      return res.status(400).json({ error: 'Datos incompletos para salida' });
    }

    const heatVal = heatNumber != null && String(heatNumber).trim() !== '' ? String(heatNumber).trim() : null;

    const insert = await inventarioPool.query(
      `INSERT INTO inventario_salida (
        departamento, empleado, fecha, codigo_producto, descripcion, clasificacion, cantidad, motivo, heat_number
      ) VALUES ($1, $2, COALESCE($3, NOW()), $4, $5, $6, $7, $8, $9)
      RETURNING id, departamento, empleado, fecha, codigo_producto AS "codigoProducto", descripcion, clasificacion, cantidad, motivo, COALESCE(heat_number, '') AS heat_number`,
      [departamento, empleado, fecha || null, codigoProducto, descripcion, clasificacion, Number(cantidad) || 0, motivo || null, heatVal]
    );

    // Descontar del inventario: actualizar solo el registro más reciente con ese código
    // para evitar multiplicar salidas en registros duplicados
    try {
      await inventarioPool.query(
        `UPDATE inventario 
         SET salidas = COALESCE(salidas, 0) + $1,
             stock = GREATEST(
                       0,
                       COALESCE(stock_inicial, 0) + COALESCE(entradas, 0) - (COALESCE(salidas, 0) + $1)
                     )
         WHERE id = (
           SELECT id FROM inventario 
           WHERE codigo = $2 
           ORDER BY created_at DESC NULLS LAST, id DESC 
           LIMIT 1
         )`,
        [Number(cantidad) || 0, codigoProducto]
      );
    } catch (e) {
      logger.warn('No se pudo actualizar stock tras salida:', e?.message || e);
    }

    res.status(201).json(insert.rows[0]);
  } catch (error) {
    logger.error('Error al crear salida:', error);
    res.status(500).json({ error: 'Error al crear salida' });
  }
});

// Proveedores API
app.get('/api/proveedores', async (req, res) => {
  try {
    logger.info('[GET /api/proveedores] solicitando lista');
    const result = await inventarioPool.query(`
      SELECT 
        id,
        supplier,
        address,
        address2,
        tel   AS telephone,
        mail  AS email,
        supplier_type,
        credit,
        iva,
        credit_days,
        credit_amount
      FROM proveedores
      ORDER BY id DESC
    `);
    logger.info('[GET /api/proveedores] registros:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error al obtener proveedores:', { message: error?.message, code: error?.code, detail: error?.detail });
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

app.post('/api/proveedores', async (req, res) => {
  try {
    logger.info('[POST /api/proveedores] payload recibido:', req.body);
    const {
      supplierName,
      address,
      address2,
      telephone,
      email,
      supplierType,
      credit,
      iva,
      creditDays,
      creditAmount
    } = req.body || {};

    if (!supplierName) {
      return res.status(400).json({ error: 'Supplier es requerido' });
    }

    const params = [
      supplierName,
      address || null,
      address2 || null,
      telephone || null,
      email || null,
      supplierType || null,
      credit || null,
      (iva==null? null : String(iva)),
      (creditDays==null? null : String(creditDays)),
      (creditAmount==null? null : String(creditAmount))
    ];
    logger.info('[POST /api/proveedores] parámetros preparados:', params);

    const insert = await inventarioPool.query(
      `INSERT INTO proveedores (supplier, address, address2, tel, mail, supplier_type, credit, iva, credit_days, credit_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (supplier)
       DO UPDATE SET
         address = COALESCE(EXCLUDED.address, proveedores.address),
         address2 = COALESCE(EXCLUDED.address2, proveedores.address2),
         tel = COALESCE(EXCLUDED.tel, proveedores.tel),
         mail = COALESCE(EXCLUDED.mail, proveedores.mail),
         supplier_type = COALESCE(EXCLUDED.supplier_type, proveedores.supplier_type),
         credit = COALESCE(EXCLUDED.credit, proveedores.credit),
         iva = COALESCE(EXCLUDED.iva, proveedores.iva),
         credit_days = COALESCE(EXCLUDED.credit_days, proveedores.credit_days),
         credit_amount = COALESCE(EXCLUDED.credit_amount, proveedores.credit_amount)
       RETURNING id, supplier, address, address2, tel AS telephone, mail AS email, supplier_type, credit, iva, credit_days, credit_amount`,
      params
    );
    logger.info('[POST /api/proveedores] insert/merge OK, id:', insert.rows?.[0]?.id);
    res.status(201).json(insert.rows[0]);
  } catch (error) {
    logger.error('Error al crear proveedor:', { message: error?.message, code: error?.code, detail: error?.detail, where: 'POST /api/proveedores' });
    res.status(500).json({ error: 'Error al crear proveedor' });
  }
});

app.put('/api/proveedores/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const { supplierName, address, address2, telephone, email, supplierType, credit, iva, creditDays, creditAmount } = req.body || {};
    const update = await inventarioPool.query(
      `UPDATE proveedores SET
         supplier = COALESCE($1, supplier),
         address = COALESCE($2, address),
         address2 = COALESCE($3, address2),
         tel = COALESCE($4, tel),
         mail = COALESCE($5, mail),
         supplier_type = COALESCE($6, supplier_type),
         credit = COALESCE($7, credit),
         iva = COALESCE($8, iva),
         credit_days = COALESCE($9, credit_days),
         credit_amount = COALESCE($10, credit_amount)
       WHERE id = $11
       RETURNING id, supplier, address, address2, tel AS telephone, mail AS email, supplier_type, credit, iva, credit_days, credit_amount`,
      [supplierName || null, address || null, address2 || null, telephone || null, email || null, supplierType || null, credit || null, (iva==null? null : String(iva)), (creditDays==null? null : String(creditDays)), (creditAmount==null? null : String(creditAmount)), id]
    );
    if (update.rowCount === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(update.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar proveedor:', error);
    res.status(500).json({ error: 'Error al actualizar proveedor' });
  }
});

// Endpoint mínimo para recibir requisiciones desde el frontend
// Acepta multipart/form-data con campo opcional `referencePhoto` y campos del formulario
app.post('/api/requisiciones', upload.single('referencePhoto'), async (req, res) => {
  try {
    const body = req.body || {};
    const descripcion = body.productDescription || body.descripcion || '';
    const enlace_producto = body.productLink || body.enlace_producto || null;
    const cantidad = Number(body.quantity || body.cantidad || 0) || 0;
    const tipo_destino = body.targetType || body.tipo_destino || null;
    const es_para_solicitante = (body.forRequester === 'true' || body.es_para_solicitante === 'true' || body.naCheckbox === 'on' || body.es_para_solicitante === '1') ? true : false;
    const departamento = body.departmentSelect || body.departamento || null;
    const area = body.areaSpecific || body.area || null;
    const alternativas = body.alternatives || body.alternativas || null;
    const usuario_destino = body.selectedUserId || body.usuario_destino || body.usuarioDestino || null;

    // intentar derivar creado_por desde la sesión o desde el body
    const creado_por = (req.session && req.session.username) ? req.session.username : (body.creado_por || body.createdBy || null);

    // URL de la imagen si se subió
    let url_imagen = null;
    if (req.file && req.file.filename) {
      // servir desde la ruta estática /uploads
      url_imagen = `/uploads/${encodeURIComponent(req.file.filename)}`;
    } else if (body.url_imagen) {
      url_imagen = body.url_imagen;
    }

    if (!descripcion || cantidad <= 0) {
      return res.status(400).json({ error: 'Descripción y cantidad son obligatorios' });
    }

    const insert = await inventarioPool.query(
      `INSERT INTO requisiciones (descripcion, enlace_producto, cantidad, url_imagen, tipo_destino, es_para_solicitante, departamento, area, alternativas, usuario_destino, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, creado_en`,
      [descripcion, enlace_producto, cantidad, url_imagen, tipo_destino, es_para_solicitante, departamento, area, alternativas, usuario_destino, creado_por]
    );

    res.status(201).json({ success: true, id: insert.rows[0].id, creado_en: insert.rows[0].creado_en, url_imagen });
  } catch (error) {
    logger.error('Error al insertar requisición:', { message: error?.message, stack: error?.stack });
    res.status(500).json({ error: 'Error al guardar requisición' });
  }
});

// Endpoint para listar requisiciones (lectura)
app.get('/api/requisiciones', async (req, res) => {
  try {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 1000));
    const qry = await inventarioPool.query(
      `SELECT id, descripcion, enlace_producto, cantidad, url_imagen, tipo_destino, es_para_solicitante, departamento, area, alternativas, usuario_destino, usuarios_asignados, estatus, po_creada, po_id, creado_por, creado_en
       FROM requisiciones
       ORDER BY creado_en DESC
       LIMIT $1`,
      [limit]
    );
    const rows = Array.isArray(qry.rows) ? qry.rows : [];
    const normalizedRows = rows.map((row) => ({ ...row }));

    const uniqueUserIds = new Set();
    normalizedRows.forEach((row) => {
      const parsedIds = parseUsuariosAsignadosValue(row.usuarios_asignados);
      row.usuarios_asignados_ids = parsedIds;
      row.usuarios_asignados = [];
      parsedIds.forEach((id) => uniqueUserIds.add(id));
    });

    let usuariosLookup = new Map();
    if (uniqueUserIds.size > 0) {
      try {
        const usuariosResult = await apoyosPool.query(
          `SELECT id, username, nombre_completo, foto_url
           FROM usuarios
           WHERE id = ANY($1::int[])`,
          [Array.from(uniqueUserIds)]
        );
        usuariosLookup = new Map(
          usuariosResult.rows.map((user) => [
            user.id,
            {
              id: user.id,
              username: user.username,
              nombre_completo: user.nombre_completo || user.username || 'Sin nombre',
              foto_url: user.foto_url || null
            }
          ])
        );
      } catch (lookupError) {
        logger.error('Error al obtener usuarios de requisiciones:', lookupError);
      }
    }

    normalizedRows.forEach((row) => {
      row.usuarios_asignados = row.usuarios_asignados_ids
        .map((id) => usuariosLookup.get(id))
        .filter(Boolean);
    });

    res.json(normalizedRows);
  } catch (error) {
    logger.error('Error al obtener requisiciones:', { message: error?.message, stack: error?.stack });
    res.status(500).json({ error: 'Error al obtener requisiciones' });
  }
});

app.put('/api/requisiciones/:id/usuarios', async (req, res) => {
  try {
    await ensureRequisicionesTable();
    const requisicionId = parseInt(req.params.id, 10);
    const { usuarios_asignados } = req.body || {};

    if (!Number.isFinite(requisicionId)) {
      return res.status(400).json({ error: 'ID de requisición inválido' });
    }

    if (!Array.isArray(usuarios_asignados)) {
      return res.status(400).json({ error: 'usuarios_asignados debe ser un arreglo de IDs' });
    }

    const userIds = [...new Set(
      usuarios_asignados
        .map((value) => parseInt(value, 10))
        .filter((value) => Number.isFinite(value))
    )];

    const serializedValue = JSON.stringify(userIds);

    const existingResult = await inventarioPool.query(
      `SELECT id, estatus, po_creada FROM requisiciones WHERE id = $1`,
      [requisicionId]
    );
    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Requisición no encontrada' });
    }
    const existingRow = existingResult.rows[0];
    const nextEstatus = deriveRequisicionEstatusAfterUsuariosUpdate(existingRow, userIds);

    const updateResult = await inventarioPool.query(
      `UPDATE requisiciones
         SET usuarios_asignados = $1,
             estatus = $2
       WHERE id = $3
       RETURNING id, usuarios_asignados, estatus`,
      [serializedValue, nextEstatus, requisicionId]
    );

    let usuariosDetalle = [];
    if (userIds.length > 0) {
      const usuariosResult = await apoyosPool.query(
        `SELECT id, username, nombre_completo, foto_url
         FROM usuarios
         WHERE id = ANY($1::int[])`,
        [userIds]
      );
      usuariosDetalle = usuariosResult.rows.map((user) => ({
        id: user.id,
        username: user.username,
        nombre_completo: user.nombre_completo || user.username || 'Sin nombre',
        foto_url: user.foto_url || null
      }));
    }

    res.json({
      success: true,
      requisicion_id: requisicionId,
      usuarios_asignados_ids: userIds,
      usuarios_asignados: usuariosDetalle,
      estatus: updateResult.rows[0].estatus
    });
  } catch (error) {
    logger.error('Error al actualizar usuarios asignados de requisición:', error);
    res.status(500).json({ error: 'Error al actualizar usuarios asignados de la requisición' });
  }
});

app.put('/api/requisiciones/:id/estatus', async (req, res) => {
  try {
    await ensureRequisicionesTable();
    const requisicionId = parseInt(req.params.id, 10);
    const normalizedStatus = normalizeRequisicionStatus(req.body?.estatus);

    if (!Number.isFinite(requisicionId)) {
      return res.status(400).json({ error: 'ID de requisición inválido' });
    }

    if (!normalizedStatus) {
      return res.status(400).json({ error: 'Estatus inválido' });
    }

    const updateResult = await inventarioPool.query(
      `UPDATE requisiciones
         SET estatus = $1
       WHERE id = $2
       RETURNING id, estatus`,
      [normalizedStatus, requisicionId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Requisición no encontrada' });
    }

    res.json({
      success: true,
      requisicion_id: requisicionId,
      estatus: updateResult.rows[0].estatus
    });
  } catch (error) {
    logger.error('Error al actualizar estatus de requisición:', error);
    res.status(500).json({ error: 'Error al actualizar estatus de la requisición' });
  }
});

// PATCH parcial para actualizar campos específicos de requisiciones (p.ej. po_creada)
app.patch('/api/requisiciones/:id', async (req, res) => {
  try {
    await ensureRequisicionesTable();
    const requisicionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(requisicionId)) return res.status(400).json({ error: 'ID de requisición inválido' });

    const allowed = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'po_creada')) {
      // aceptar booleano o strings 'true'/'false' o 0/1
      const val = req.body.po_creada;
      let boolVal = null;
      if (typeof val === 'boolean') boolVal = val;
      else if (typeof val === 'number') boolVal = !!val;
      else if (typeof val === 'string') {
        const v = val.trim().toLowerCase();
        if (v === 'true' || v === '1' || v === 't' || v === 'y' || v === 'yes' || v === 'si') boolVal = true;
        else if (v === 'false' || v === '0' || v === 'f' || v === 'n' || v === 'no') boolVal = false;
      }
      if (boolVal === null) return res.status(400).json({ error: 'Valor inválido para po_creada' });
      allowed.po_creada = boolVal;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'po_id')) {
      const rawPid = req.body.po_id;
      if (rawPid === null || rawPid === undefined || rawPid === '') {
        allowed.po_id = null;
      } else {
        const n = parseInt(rawPid, 10);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'Valor inválido para po_id' });
        allowed.po_id = n;
      }
    }

    const keys = Object.keys(allowed);
    if (!keys.length) return res.status(400).json({ error: 'No hay campos válidos para actualizar' });

    let forcedEstatus = null;
    if (allowed.po_creada === true) {
      const cur = await inventarioPool.query(`SELECT estatus FROM requisiciones WHERE id = $1`, [requisicionId]);
      if (cur.rowCount > 0) {
        const prev = normalizeRequisicionStatusKey(cur.rows[0].estatus || '');
        const keepPrev =
          prev.includes('po recibida') ||
          prev === 'realizado' ||
          prev === 'autorizado';
        if (!keepPrev) forcedEstatus = 'PO generada';
      }
    }

    // Construir consulta dinámica segura
    const sets = [];
    const params = [];
    let idx = 1;
    for (const k of keys) {
      sets.push(`${k} = $${idx}`);
      params.push(allowed[k]);
      idx++;
    }
    if (forcedEstatus != null) {
      sets.push(`estatus = $${idx}`);
      params.push(forcedEstatus);
      idx++;
    }
    params.push(requisicionId);

    const q = `UPDATE requisiciones SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, po_creada, po_id, estatus`;
    const result = await inventarioPool.query(q, params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Requisición no encontrada' });

    res.json({
      success: true,
      requisicion_id: requisicionId,
      po_creada: result.rows[0].po_creada,
      po_id: result.rows[0].po_id != null ? result.rows[0].po_id : null,
      estatus: result.rows[0].estatus
    });
  } catch (error) {
    logger.error('Error al actualizar requisición (PATCH):', error);
    res.status(500).json({ error: 'Error al actualizar requisición' });
  }
});
// Actualizar salida existente
app.put('/api/salidas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const {
      departamento,
      empleado,
      fecha,
      descripcion,
      clasificacion,
      cantidad,
      motivo,
      heatNumber
    } = req.body || {};

    const heatOut = heatNumber != null && String(heatNumber).trim() !== '' ? String(heatNumber).trim() : null;

    // Nota: por simplicidad no permitimos cambiar codigo_producto aquí
    const update = await inventarioPool.query(
      `UPDATE inventario_salida SET
         departamento = COALESCE($1, departamento),
         empleado = COALESCE($2, empleado),
         fecha = COALESCE($3, fecha),
         descripcion = COALESCE($4, descripcion),
         clasificacion = COALESCE($5, clasificacion),
         cantidad = COALESCE($6, cantidad),
         motivo = COALESCE($7, motivo),
         heat_number = COALESCE($8, heat_number)
       WHERE id = $9
       RETURNING id, departamento, empleado, fecha, codigo_producto AS "codigoProducto", descripcion, clasificacion, cantidad, motivo, COALESCE(heat_number, '') AS heat_number`,
      [departamento || null, empleado || null, fecha || null, descripcion || null, clasificacion || null, (cantidad == null ? null : Number(cantidad)), motivo || null, heatOut, id]
    );

    if (update.rowCount === 0) {
      return res.status(404).json({ error: 'Salida no encontrada' });
    }

    res.json(update.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar salida:', error);
    res.status(500).json({ error: 'Error al actualizar salida' });
  }
});

// Ruta para subir imágenes
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se ha subido ningún archivo' });
  }
  // Devuelve la ruta relativa para guardar en la base de datos
  res.json({ 
    path: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype
  });
});

// Subir imagen de producto del inventario y guardar ruta en foto_url
app.post('/api/inventario/:id/imagen', upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se ha subido ningún archivo' });
    }
    const { id } = req.params;
    const imagenUrl = `/uploads/${req.file.filename}`;
    await inventarioPool.query(
      'UPDATE inventario SET foto_url = $1, updated_at = NOW() WHERE id = $2',
      [imagenUrl, id]
    );
    res.json({ success: true, imagen_url: imagenUrl });
  } catch (error) {
    console.error('Error al subir imagen de inventario:', error);
    res.status(500).json({ success: false, error: 'Error al subir imagen' });
  }
});

// Eliminar imagen de producto del inventario
app.delete('/api/inventario/:id/imagen', async (req, res) => {
  try {
    const { id } = req.params;
    // Obtener ruta previa para poder borrar archivo físico si se desea
    const result = await inventarioPool.query('SELECT foto_url FROM inventario WHERE id = $1', [id]);
    const ruta = result.rows?.[0]?.foto_url;
    await inventarioPool.query('UPDATE inventario SET foto_url = NULL, updated_at = NOW() WHERE id = $1', [id]);
    // Nota: se podría borrar el archivo del sistema si existe, omito por seguridad
    res.json({ success: true, imagen_url: null, previous: ruta || null });
  } catch (error) {
    console.error('Error al eliminar imagen de inventario:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar imagen' });
  }
});

// Ruta para subir foto de empleado
app.post('/api/empleados/upload-photo', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    const employeeId = req.body.employeeId;
    if (!employeeId) {
      return res.status(400).json({ error: 'ID de empleado no proporcionado' });
    }

    // Actualizar la URL de la foto en la base de datos
    const fotoUrl = `/uploads/${req.file.filename}`;
    await apoyosPool.query(
      'UPDATE empleados SET foto_url = $1 WHERE id = $2',
      [fotoUrl, employeeId]
    );

    res.json({ 
      success: true, 
      foto_url: fotoUrl,
      message: 'Foto subida exitosamente' 
    });
  } catch (error) {
    console.error('Error al subir foto:', error);
    res.status(500).json({ 
      error: 'Error al subir la foto',
      message: error.message 
    });
  }
});

// Nueva ruta RESTful para subir la foto del empleado
app.post('/api/empleados/:id/foto', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    const { id } = req.params;
    // Actualizar la URL de la foto en la base de datos
    const fotoUrl = `/uploads/${req.file.filename}`;
    await apoyosPool.query(
      'UPDATE empleados SET foto_url = $1 WHERE id = $2',
      [fotoUrl, id]
    );

    res.json({ 
      success: true, 
      foto_url: fotoUrl,
      message: 'Foto subida exitosamente' 
    });
  } catch (error) {
    console.error('Error al subir foto:', error);
    res.status(500).json({ 
      error: 'Error al subir la foto',
      message: error.message 
    });
  }
});

// Ruta para subir PDF y guardar en la base de datos phoenix_tickets
app.post('/api/upload-pdf', uploadPdf.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo PDF' });
    }

    // Puedes obtener el usuario de la sesión si lo tienes, aquí lo dejamos como 'Desconocido'
    const uploaded_by = req.session?.username || 'Desconocido';

    // Guardar en la base de datos
    const result = await phoenixPool.query(
      `INSERT INTO pdf_files (file_name, file_path, uploaded_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [
        req.file.originalname,
        `/uploads/${req.file.filename}`,
        uploaded_by
      ]
    );

    res.json({
      success: true,
      pdf: result.rows[0]
    });
  } catch (error) {
    console.error('Error al subir PDF:', error);
    res.status(500).json({ error: 'Error al subir el PDF' });
  }
});

// Rutas para la bóveda IT
app.post('/api/boveda/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    const { etiquetas, comentarios } = req.body;
    const ruta = `/uploads/${req.file.filename}`;

    // Guardar en la tabla it_boveda
    const result = await apoyosPool.query(
      `INSERT INTO it_boveda (fecha_subida, etiqueta, comentarios, en_uso, ruta)
       VALUES (CURRENT_TIMESTAMP, $1, $2, true, $3) RETURNING *`,
      [etiquetas || null, comentarios || null, ruta]
    );

    res.json({
      success: true,
      file: {
        id: result.rows[0].id,
        name: req.file.originalname,
        path: ruta,
        etiquetas: result.rows[0].etiqueta,
        comentarios: result.rows[0].comentarios,
        fecha_subida: result.rows[0].fecha_subida
      }
    });
  } catch (error) {
    console.error('Error al subir archivo a bóveda:', error);
    res.status(500).json({ error: 'Error al subir el archivo' });
  }
});

// Obtener archivos de la bóveda
app.get('/api/boveda/files', async (req, res) => {
  try {
    const result = await apoyosPool.query(
      `SELECT id, fecha_subida, etiqueta, comentarios, en_uso, ruta
       FROM it_boveda 
       ORDER BY fecha_subida DESC`
    );

    res.json({
      success: true,
      files: result.rows
    });
  } catch (error) {
    console.error('Error al obtener archivos de bóveda:', error);
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});

// Obtener un archivo específico de la bóveda
app.get('/api/boveda/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await apoyosPool.query(
      `SELECT id, fecha_subida, etiqueta, comentarios, en_uso, ruta
       FROM it_boveda 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    res.json({
      success: true,
      file: result.rows[0]
    });
  } catch (error) {
    console.error('Error al obtener archivo de bóveda:', error);
    res.status(500).json({ error: 'Error al obtener archivo' });
  }
});

// Actualizar archivo de la bóveda
app.put('/api/boveda/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { etiquetas, comentarios, en_uso } = req.body;

    const result = await apoyosPool.query(
      `UPDATE it_boveda 
       SET etiqueta = $1, comentarios = $2, en_uso = $3
       WHERE id = $4 RETURNING *`,
      [etiquetas, comentarios, en_uso, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    res.json({
      success: true,
      file: result.rows[0]
    });
  } catch (error) {
    console.error('Error al actualizar archivo de bóveda:', error);
    res.status(500).json({ error: 'Error al actualizar archivo' });
  }
});

// Agregar etiqueta a un archivo
app.post('/api/boveda/files/:id/etiquetas', async (req, res) => {
  try {
    const { id } = req.params;
    const { etiqueta } = req.body;

    // Obtener etiquetas actuales
    const currentResult = await apoyosPool.query(
      'SELECT etiqueta FROM it_boveda WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    let etiquetasActuales = currentResult.rows[0].etiqueta || '';
    let nuevasEtiquetas = '';

    if (etiquetasActuales) {
      // Si ya hay etiquetas, agregar la nueva separada por coma
      const etiquetasArray = etiquetasActuales.split(',').map(e => e.trim());
      if (!etiquetasArray.includes(etiqueta)) {
        etiquetasArray.push(etiqueta);
        nuevasEtiquetas = etiquetasArray.join(', ');
      } else {
        nuevasEtiquetas = etiquetasActuales;
      }
    } else {
      // Si no hay etiquetas, crear la primera
      nuevasEtiquetas = etiqueta;
    }

    // Actualizar el archivo con las nuevas etiquetas
    const result = await apoyosPool.query(
      'UPDATE it_boveda SET etiqueta = $1 WHERE id = $2 RETURNING *',
      [nuevasEtiquetas, id]
    );

    res.json({
      success: true,
      file: result.rows[0]
    });
  } catch (error) {
    console.error('Error al agregar etiqueta:', error);
    res.status(500).json({ error: 'Error al agregar etiqueta' });
  }
});

// Eliminar etiqueta de un archivo
app.delete('/api/boveda/files/:id/etiquetas', async (req, res) => {
  try {
    const { id } = req.params;
    const { etiqueta } = req.body;

    // Obtener etiquetas actuales
    const currentResult = await apoyosPool.query(
      'SELECT etiqueta FROM it_boveda WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    let etiquetasActuales = currentResult.rows[0].etiqueta || '';
    let nuevasEtiquetas = '';

    if (etiquetasActuales) {
      // Remover la etiqueta específica
      const etiquetasArray = etiquetasActuales.split(',').map(e => e.trim());
      const etiquetasFiltradas = etiquetasArray.filter(e => e !== etiqueta);
      nuevasEtiquetas = etiquetasFiltradas.join(', ');
    }

    // Actualizar el archivo con las etiquetas restantes
    const result = await apoyosPool.query(
      'UPDATE it_boveda SET etiqueta = $1 WHERE id = $2 RETURNING *',
      [nuevasEtiquetas, id]
    );

    res.json({
      success: true,
      file: result.rows[0]
    });
  } catch (error) {
    console.error('Error al eliminar etiqueta:', error);
    res.status(500).json({ error: 'Error al eliminar etiqueta' });
  }
});

// NUEVO ENDPOINT: Eliminar todas las etiquetas de un archivo
app.delete('/api/boveda/files/:id/etiquetas/all', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar que el archivo existe
    const fileResult = await apoyosPool.query(
      'SELECT id, etiqueta FROM it_boveda WHERE id = $1',
      [id]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Actualizar el archivo eliminando todas las etiquetas (establecer a NULL)
    const result = await apoyosPool.query(
      'UPDATE it_boveda SET etiqueta = NULL WHERE id = $1 RETURNING *',
      [id]
    );

    res.json({
      success: true,
      message: 'Todas las etiquetas han sido eliminadas',
      file: result.rows[0]
    });
  } catch (error) {
    console.error('Error al eliminar todas las etiquetas:', error);
    res.status(500).json({ error: 'Error al eliminar todas las etiquetas' });
  }
});

// Eliminar archivo de la bóveda
app.delete('/api/boveda/files/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener la ruta del archivo antes de eliminarlo
    const fileResult = await apoyosPool.query(
      'SELECT ruta FROM it_boveda WHERE id = $1',
      [id]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Eliminar de la base de datos
    await apoyosPool.query('DELETE FROM it_boveda WHERE id = $1', [id]);

    // Eliminar archivo físico si existe
    const filePath = path.join(__dirname, fileResult.rows[0].ruta.replace('/uploads/', ''));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ success: true, message: 'Archivo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar archivo de bóveda:', error);
    res.status(500).json({ error: 'Error al eliminar archivo' });
  }
});

// ==================== ANUNCIOS API ====================

// Obtener anuncio actual (para mostrar en el selector)
app.get('/api/anuncio/actual', async (req, res) => {
  try {
    const result = await apoyosPool.query(
      `SELECT id, titulo, imagen_url, fecha_inicio, fecha_fin, menu_semana
       FROM anuncios
       WHERE activo = true
         AND (fecha_inicio IS NULL OR fecha_inicio <= CURRENT_TIMESTAMP)
         AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_TIMESTAMP)
       ORDER BY orden ASC, fecha_creacion DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No hay anuncios activos' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener anuncio actual:', error);
    res.status(500).json({ error: 'Error al obtener anuncio' });
  }
});

// Obtener todos los anuncios (para administración)
app.get('/api/anuncios', async (req, res) => {
  try {
    const result = await apoyosPool.query(
            `SELECT id, titulo, imagen_url, activo, fecha_inicio, fecha_fin, 
              creado_por, fecha_creacion, orden, menu_semana, canva
       FROM anuncios
       ORDER BY orden ASC, fecha_creacion DESC`
    );

    res.json({
      success: true,
      anuncios: result.rows
    });
  } catch (error) {
    console.error('Error al obtener anuncios:', error);
    res.status(500).json({ error: 'Error al obtener anuncios' });
  }
});

// Crear un nuevo anuncio con imagen
app.post('/api/anuncios', upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
    }

    const { titulo, fecha_inicio, fecha_fin, orden, menu_semana, canva } = req.body;
    const imagen_url = `/uploads/${req.file.filename}`;
    const creado_por = req.session?.username || 'Desconocido';
    const isMenuSemana = menu_semana === '1' || menu_semana === 'true' || menu_semana === true;
    const canvaUrl = canva ? String(canva).trim() : null;

    const result = await apoyosPool.query(
      `INSERT INTO anuncios (titulo, imagen_url, creado_por, fecha_inicio, fecha_fin, orden, menu_semana, canva)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        titulo || null,
        imagen_url,
        creado_por,
        fecha_inicio || null,
        fecha_fin || null,
        parseInt(orden) || 0,
        isMenuSemana,
        canvaUrl || null
      ]
    );

    res.json({
      success: true,
      anuncio: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear anuncio:', error);
    res.status(500).json({ error: 'Error al crear anuncio' });
  }
});

// Crear una nueva publicación (Noticias)
app.post('/api/publicaciones', upload.single('imagen'), async (req, res) => {
  try {
    const texto = (req.body.texto || req.body.text || '').toString().trim() || null;
    const usuarioId = req.session?.userId || req.body.usuario || null; // preferir id de sesión

    let imagen_url = null;
    if (req.file) {
      imagen_url = `/uploads/${req.file.filename}`;
    }

    const result = await apoyosPool.query(
      `INSERT INTO publicaciones (usuario, texto, imagen_url)
       VALUES ($1, $2, $3) RETURNING *`,
      [usuarioId, texto, imagen_url]
    );

    res.json({ success: true, publicacion: result.rows[0] });
  } catch (error) {
    console.error('Error al crear publicación:', error);
    res.status(500).json({ error: 'Error al crear la publicación' });
  }
});

// Obtener publicaciones (últimas primero)
app.get('/api/publicaciones', async (req, res) => {
  try {
    const result = await apoyosPool.query(
      `SELECT id, usuario, texto, imagen_url, created_at, COALESCE(likes,0) AS likes
       FROM publicaciones
       ORDER BY created_at DESC NULLS LAST, id DESC
       LIMIT 200`
    );
    res.json({ success: true, publicaciones: result.rows });
  } catch (error) {
    console.error('Error al obtener publicaciones:', error);
    res.status(500).json({ error: 'Error al obtener publicaciones' });
  }
});

// Incrementar likes de una publicación
app.post('/api/publicaciones/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) return res.status(400).json({ error: 'ID inválido' });

    // Requerir sesión para registrar quién dio like
    const usuario = req.session?.userId ? String(req.session.userId) : (req.session?.username ? String(req.session.username) : null);
    if (!usuario) return res.status(401).json({ error: 'Login requerido para dar like' });

    // Verificar que la publicación exista
    const pubCheck = await apoyosPool.query('SELECT id, COALESCE(likes,0) AS likes FROM publicaciones WHERE id = $1', [numericId]);
    if (pubCheck.rowCount === 0) return res.status(404).json({ error: 'Publicación no encontrada' });

    // Verificar si este usuario ya dio like a esta publicación
    const likeExists = await apoyosPool.query('SELECT id FROM likes WHERE usuario = $1 AND id_publicacion = $2', [usuario, String(numericId)]);
    if (likeExists.rowCount > 0) {
      // Idempotente: si ya dio like, devolver la publicación actual
      return res.json({ success: true, message: 'Ya has dado like', publicacion: pubCheck.rows[0] });
    }

    // Registrar like y actualizar contador en una transacción
    await apoyosPool.query('BEGIN');
    await apoyosPool.query('INSERT INTO likes (usuario, id_publicacion, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING', [usuario, String(numericId)]);
    const upd = await apoyosPool.query('UPDATE publicaciones SET likes = COALESCE(likes,0) + 1 WHERE id = $1 RETURNING *', [numericId]);
    await apoyosPool.query('COMMIT');

    res.json({ success: true, publicacion: upd.rows[0] });
  } catch (error) {
    try { await apoyosPool.query('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('Error al registrar like:', error);
    res.status(500).json({ error: 'Error al registrar like' });
  }
});

// Actualizar un anuncio
app.put('/api/anuncios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, activo, fecha_inicio, fecha_fin, orden, menu_semana, canva } = req.body;

    // Normalizar `menu_semana` si viene en formatos distintos (string/number/boolean)
    let menuSemanaValue = null;
    if (typeof menu_semana !== 'undefined') {
      const val = menu_semana;
      const truthy = val === true || val === 'true' || val === '1' || val === 1;
      const falsy = val === false || val === 'false' || val === '0' || val === 0;
      if (truthy) menuSemanaValue = true;
      else if (falsy) menuSemanaValue = false;
      else menuSemanaValue = null; // si no se puede determinar, no actualizar
    }

    // Log para depuración
    console.log('[PUT /api/anuncios/:id] Body:', req.body, 'menuSemanaNormalizado:', menuSemanaValue);

    const canvaUrl = typeof canva !== 'undefined' && canva !== null ? String(canva).trim() : null;

    const result = await apoyosPool.query(
      `UPDATE anuncios
       SET titulo = COALESCE($1, titulo),
           activo = COALESCE($2, activo),
           fecha_inicio = COALESCE($3, fecha_inicio),
           fecha_fin = COALESCE($4, fecha_fin),
           orden = COALESCE($5, orden),
           menu_semana = COALESCE($6, menu_semana),
           canva = COALESCE($7, canva)
       WHERE id = $8
       RETURNING *`,
      [titulo, activo, fecha_inicio, fecha_fin, orden, menuSemanaValue, canvaUrl, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anuncio no encontrado' });
    }

    res.json({
      success: true,
      anuncio: result.rows[0]
    });
  } catch (error) {
    console.error('Error al actualizar anuncio:', error);
    res.status(500).json({ error: 'Error al actualizar anuncio' });
  }
});

// Eliminar un anuncio
app.delete('/api/anuncios/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener la ruta de la imagen antes de eliminar
    const fileResult = await apoyosPool.query(
      'SELECT imagen_url FROM anuncios WHERE id = $1',
      [id]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Anuncio no encontrado' });
    }

    // Eliminar de la base de datos
    await apoyosPool.query('DELETE FROM anuncios WHERE id = $1', [id]);

    // Eliminar imagen física si existe
    const imagePath = path.join(__dirname, fileResult.rows[0].imagen_url.replace('/uploads/', 'uploads/'));
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    res.json({ success: true, message: 'Anuncio eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar anuncio:', error);
    res.status(500).json({ error: 'Error al eliminar anuncio' });
  }
});

// ==================== FIN ANUNCIOS API ====================

async function ensureInicioNotificacionesTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS inicio_notificaciones (
        id BIGSERIAL PRIMARY KEY,
        titulo TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        destinatarios TEXT[] NOT NULL,
        creado_por TEXT,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS inicio_notificaciones_created_idx
      ON inicio_notificaciones (created_at DESC);
    `);
  } catch (error) {
    console.error('Error al crear/verificar tabla inicio_notificaciones:', error.message);
  }
}

let notificacionesUsuarioTableReady = false;

function sanitizeRichNotificationMessage(rawHtml) {
  let html = String(rawHtml || '');
  if (!html) return '';

  html = html
    .replace(/<\s*(script|style|iframe|object|embed|meta|link)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|meta|link)[^>]*\/?>/gi, '');

  const allowedTags = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'span', 'div', 'p', 'ul', 'ol', 'li', 'font']);
  const allowedStyleProps = new Set(['color', 'font-weight', 'font-style', 'text-decoration', 'font-family', 'font-size', 'text-align']);

  const getAttrValue = (attrs, attrName) => {
    const regex = new RegExp(`${attrName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = String(attrs || '').match(regex);
    if (!match) return '';
    return String(match[2] || match[3] || match[4] || '').trim();
  };

  const sanitizeStyle = (styleValue) => {
    if (!styleValue) return '';
    return String(styleValue)
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [prop, ...rest] = entry.split(':');
        const property = String(prop || '').trim().toLowerCase();
        const value = String(rest.join(':') || '').replace(/[<>]/g, '').trim();
        if (!allowedStyleProps.has(property) || !value) return null;
        if (/expression\s*\(|javascript:|url\s*\(/i.test(value)) return null;
        return `${property}: ${value}`;
      })
      .filter(Boolean)
      .join('; ');
  };

  html = html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (fullMatch, rawTagName, rawAttrs = '') => {
    const isClosing = /^<\s*\//.test(fullMatch);
    const tagName = String(rawTagName || '').toLowerCase();
    if (!allowedTags.has(tagName)) {
      return '';
    }

    if (isClosing) {
      return tagName === 'br' ? '' : `</${tagName}>`;
    }

    if (tagName === 'br') {
      return '<br>';
    }

    const attrs = String(rawAttrs || '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\sxmlns\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    let safeAttrs = '';

    const safeStyle = sanitizeStyle(getAttrValue(attrs, 'style'));
    if (safeStyle) {
      safeAttrs += ` style="${safeStyle}"`;
    }

    if (tagName === 'font') {
      const color = getAttrValue(attrs, 'color').replace(/["'<>]/g, '').trim();
      const face = getAttrValue(attrs, 'face').replace(/["'<>]/g, '').trim();
      const size = getAttrValue(attrs, 'size').replace(/["'<>]/g, '').trim();
      if (color && !/javascript:/i.test(color)) safeAttrs += ` color="${color}"`;
      if (face) safeAttrs += ` face="${face}"`;
      if (/^[1-7]$/.test(size)) safeAttrs += ` size="${size}"`;
    }

    return `<${tagName}${safeAttrs}>`;
  });

  return html.trim();
}

function getRichNotificationPlainText(rawHtml) {
  return sanitizeRichNotificationMessage(rawHtml)
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\s*\/\s*(p|div|li)\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensureNotificacionesUsuarioTable() {
  if (notificacionesUsuarioTableReady) return;

  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS notificaciones_usuario (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        titulo TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        foto_url VARCHAR(500),
        creado_por TEXT,
        vio_notificacion BOOLEAN NOT NULL DEFAULT FALSE,
        visto_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ADD COLUMN IF NOT EXISTS vio_notificacion BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ADD COLUMN IF NOT EXISTS titulo TEXT;
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ADD COLUMN IF NOT EXISTS mensaje TEXT;
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ADD COLUMN IF NOT EXISTS foto_url VARCHAR(500);
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ADD COLUMN IF NOT EXISTS creado_por TEXT;
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ADD COLUMN IF NOT EXISTS visto_at TIMESTAMPTZ;
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ADD COLUMN IF NOT EXISTS diseno BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await apoyosPool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'notificaciones_usuario'
            AND column_name = 'notificacion_id'
        ) THEN
          EXECUTE 'ALTER TABLE notificaciones_usuario ALTER COLUMN notificacion_id DROP NOT NULL';
        END IF;
      END $$;
    `);

    await apoyosPool.query(`
      UPDATE notificaciones_usuario
      SET titulo = COALESCE(NULLIF(titulo, ''), 'Notificacion')
      WHERE titulo IS NULL OR titulo = '';
    `);

    await apoyosPool.query(`
      UPDATE notificaciones_usuario
      SET mensaje = COALESCE(NULLIF(mensaje, ''), 'Sin mensaje')
      WHERE mensaje IS NULL OR mensaje = '';
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ALTER COLUMN titulo SET NOT NULL;
    `);

    await apoyosPool.query(`
      ALTER TABLE notificaciones_usuario
      ALTER COLUMN mensaje SET NOT NULL;
    `);

    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS notificaciones_usuario_user_created_idx
      ON notificaciones_usuario (username, created_at DESC);
    `);

    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS notificaciones_usuario_user_pending_idx
      ON notificaciones_usuario (username, vio_notificacion, created_at DESC);
    `);

    notificacionesUsuarioTableReady = true;
  } catch (error) {
    console.error('Error al crear/verificar tabla notificaciones_usuario:', error.message);
  }
}

let canvaTableReady = false;

async function ensureCanvaTable() {
  if (canvaTableReady) return;
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS canva (
        id SERIAL PRIMARY KEY,
        url_canva TEXT
      );
    `);
    canvaTableReady = true;
  } catch (error) {
    logger.error('Error al crear/verificar tabla canva:', { message: error?.message, detail: error?.detail });
  }
}

let likesTableReady = false;
async function ensureLikesTable() {
  if (likesTableReady) return;
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS likes (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(255),
        id_publicacion VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (usuario, id_publicacion)
      );
    `);
    likesTableReady = true;
  } catch (error) {
    logger.error('Error al crear/verificar tabla likes:', { message: error?.message, detail: error?.detail });
  }
}

async function crearNotificacionesAprobacionDiseno({ usuarioAsignadoIds, tipoElemento, numeroElemento, pmUsername }) {
  await ensureNotificacionesUsuarioTable();

  const idsLimpios = [...new Set(
    (Array.isArray(usuarioAsignadoIds) ? usuarioAsignadoIds : [])
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  )];

  if (idsLimpios.length === 0) {
    return { insertadas: 0, destinatarios: [] };
  }

  const usuariosResult = await apoyosPool.query(
    `SELECT LOWER(TRIM(username)) AS username
     FROM usuarios
     WHERE id = ANY($1::int[])
       AND username IS NOT NULL
       AND TRIM(username) <> ''`,
    [idsLimpios]
  );

  const destinatarios = [...new Set(
    usuariosResult.rows
      .map((row) => String(row.username || '').trim().toLowerCase())
      .filter(Boolean)
  )];

  if (destinatarios.length === 0) {
    return { insertadas: 0, destinatarios: [] };
  }

  const tipoLabel = String(tipoElemento || '').toLowerCase() === 'submittal' ? 'Submittal' : 'Orden';
  const numeroLabel = String(numeroElemento || '').trim();
  const titulo = `${tipoLabel} aprobado`;
  const mensaje = numeroLabel
    ? `${tipoLabel} ${numeroLabel} fue aprobado por ${pmUsername || 'PM'}.`
    : `${tipoLabel} fue aprobado por ${pmUsername || 'PM'}.`;

  const insertResult = await apoyosPool.query(
    `INSERT INTO notificaciones_usuario (username, titulo, mensaje, creado_por, vio_notificacion, diseno)
     SELECT dest, $2, $3, $4, FALSE, TRUE
     FROM unnest($1::text[]) AS t(dest)
     RETURNING id`,
    [destinatarios, titulo, mensaje, pmUsername || 'PM']
  );

  return {
    insertadas: insertResult.rowCount,
    destinatarios
  };
}

app.post('/api/notificaciones-inicio', async (req, res) => {
  try {
    await ensureNotificacionesUsuarioTable();

    const { titulo, mensaje, destinatarios, foto_url } = req.body || {};
    const tituloFinal = String(titulo || '').trim();
    const mensajeFinal = sanitizeRichNotificationMessage(mensaje || '');
    const mensajePlano = getRichNotificationPlainText(mensajeFinal);
    const fotoUrlFinal = String(foto_url || '').trim();
    const destinatariosLimpios = Array.isArray(destinatarios)
      ? [...new Set(destinatarios
          .map((value) => String(value || '').trim())
          .filter(Boolean))]
      : [];

    if (!tituloFinal) {
      return res.status(400).json({ success: false, error: 'El titulo es requerido' });
    }

    if (!mensajeFinal || !mensajePlano) {
      return res.status(400).json({ success: false, error: 'El mensaje es requerido' });
    }

    if (destinatariosLimpios.length === 0) {
      return res.status(400).json({ success: false, error: 'Selecciona al menos un usuario destinatario' });
    }

    if (fotoUrlFinal.length > 500) {
      return res.status(400).json({ success: false, error: 'La URL de la imagen es demasiado larga (maximo 500 caracteres)' });
    }

    const creadoPor = req.session?.username || 'Desconocido';

    const destinatariosLower = [...new Set(
      destinatariosLimpios
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )];

    let insertedRows = [];
    if (destinatariosLower.length > 0) {
      const insertResult = await apoyosPool.query(
        `INSERT INTO notificaciones_usuario (username, titulo, mensaje, foto_url, creado_por, vio_notificacion)
         SELECT dest, $2, $3, $4, $5, FALSE
         FROM unnest($1::text[]) AS t(dest)
         RETURNING id, username, titulo, mensaje, foto_url, creado_por, created_at, vio_notificacion`,
        [destinatariosLower, tituloFinal, mensajeFinal, fotoUrlFinal || null, creadoPor]
      );
      insertedRows = insertResult.rows;
    }

    return res.json({
      success: true,
      totalInsertados: insertedRows.length,
      notificaciones: insertedRows
    });
  } catch (error) {
    console.error('Error al crear notificacion de inicio:', error);
    return res.status(500).json({ success: false, error: 'Error al crear la notificacion' });
  }
});

// Endpoint para guardar contenido de Canva (texto largo)
app.post('/api/canva', async (req, res) => {
  try {
    await ensureCanvaTable();
    const text = String((req.body && req.body.url_canva) || '').trim();
    if (!text) return res.status(400).json({ success: false, error: 'El texto es requerido' });

    const result = await apoyosPool.query('INSERT INTO canva (url_canva) VALUES ($1) RETURNING id', [text]);
    return res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    logger.error('[POST /api/canva] Error al guardar canva:', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ success: false, error: 'Error al guardar canva' });
  }
});

// Endpoint para obtener el último registro de Canva (url_canva)
app.get('/api/canva', async (req, res) => {
  try {
    await ensureCanvaTable();
    const result = await apoyosPool.query('SELECT url_canva FROM canva ORDER BY id DESC LIMIT 1');
    const url = (result && result.rows && result.rows[0]) ? result.rows[0].url_canva : null;
    return res.json({ success: true, url_canva: url || null });
  } catch (error) {
    logger.error('[GET /api/canva] Error al obtener canva:', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ success: false, error: 'Error al obtener canva' });
  }
});

// Crear o guardar un mensaje en una conversación (DM o conversation existente)
app.post('/api/mensajes', async (req, res) => {
  try {
    const body = req.body || {};
    const conversationIdIn = body.conversation_id || null;
    const targetUserIdIn = body.target_user_id || body.destino || null;
    const senderIdIn = body.sender_id || null;
    const senderUsername = body.sender_username || null;
    const content = typeof body.content !== 'undefined' ? String(body.content) : null;
    const contentType = body.content_type || 'text';
    const attachments = body.attachments || null;

    if (!content && !attachments) {
      return res.status(400).json({ success: false, error: 'El contenido o attachments son requeridos' });
    }

    let senderId = null;
    if (senderIdIn) senderId = Number.parseInt(senderIdIn, 10);
    else if (senderUsername) {
      const ures = await apoyosPool.query('SELECT id FROM usuarios WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) LIMIT 1', [String(senderUsername)]);
      if (ures && ures.rows && ures.rows[0]) senderId = ures.rows[0].id;
    }

    let conversationId = conversationIdIn ? Number.parseInt(conversationIdIn, 10) : null;

    // If conversation not provided, try to find or create a DM between sender and target
    if (!conversationId) {
      if (!targetUserIdIn) return res.status(400).json({ success: false, error: 'Falta conversation_id o target_user_id' });
      const targetUserId = Number.parseInt(targetUserIdIn, 10);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) return res.status(400).json({ success: false, error: 'target_user_id inválido' });
      if (!senderId) return res.status(400).json({ success: false, error: 'Falta sender_id o sender_username' });

      // Buscar conversación DM existente entre ambos usuarios
      const convRes = await apoyosPool.query(`
        SELECT c.id FROM conversations c
        JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
        JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
        WHERE c.type = 'dm'
        LIMIT 1
      `, [senderId, targetUserId]);

      if (convRes && convRes.rows && convRes.rows[0]) {
        conversationId = convRes.rows[0].id;
      } else {
        // Crear nueva conversación DM y añadir miembros
        const ins = await apoyosPool.query('INSERT INTO conversations (type, created_by) VALUES ($1, $2) RETURNING id', ['dm', senderId]);
        conversationId = ins.rows[0].id;
        await apoyosPool.query('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,$3),($1,$4,$5)', [conversationId, senderId, 'member', targetUserId, 'member']);
      }
    }

    // Guardar mensaje
    const insertRes = await apoyosPool.query(
      'INSERT INTO messages (conversation_id, sender_id, content, content_type, attachments) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
      [conversationId, senderId || null, content, contentType, attachments ? JSON.stringify(attachments) : null]
    );

    return res.json({ success: true, id: insertRes.rows[0].id, conversation_id: conversationId, created_at: insertRes.rows[0].created_at });
  } catch (error) {
    logger.error('[POST /api/mensajes] Error al guardar mensaje:', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ success: false, error: 'Error al guardar mensaje' });
  }
});

// Buscar conversación DM entre dos usuarios (devuelve conversation_id o null)
app.get('/api/conversations/dm', async (req, res) => {
  try {
    const u1 = Number.parseInt(req.query.user1 || req.query.u1 || req.query.a || '', 10);
    const u2 = Number.parseInt(req.query.user2 || req.query.u2 || req.query.b || '', 10);
    if (!u1 || !u2) return res.status(400).json({ success: false, error: 'Faltan user1 y user2 como query params' });

    const convRes = await apoyosPool.query(`
      SELECT c.id FROM conversations c
      JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
      JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
      WHERE c.type = 'dm'
      LIMIT 1
    `, [u1, u2]);
    const id = (convRes && convRes.rows && convRes.rows[0]) ? convRes.rows[0].id : null;
    return res.json({ success: true, conversation_id: id });
  } catch (error) {
    logger.error('[GET /api/conversations/dm] Error:', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ success: false, error: 'Error al buscar conversación' });
  }
});

// Obtener mensajes de una conversación
app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const convId = Number.parseInt(req.params.id, 10);
    if (!convId) return res.status(400).json({ success: false, error: 'conversation id inválido' });
    const q = await apoyosPool.query('SELECT id, sender_id, content, content_type, attachments, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 1000', [convId]);
    return res.json({ success: true, messages: q.rows || [] });
  } catch (error) {
    logger.error('[GET /api/conversations/:id/messages] Error:', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ success: false, error: 'Error al obtener mensajes' });
  }
});

app.get('/api/notificaciones-inicio/:username', async (req, res) => {
  try {
    await ensureNotificacionesUsuarioTable();

    const rawUsername = String(req.params.username || '').trim();
    if (!rawUsername) {
      return res.status(400).json({ success: false, error: 'Falta username' });
    }

    const candidates = [rawUsername];
    if (rawUsername.includes('\\')) candidates.push(rawUsername.split('\\').pop());
    if (rawUsername.includes('@')) candidates.push(rawUsername.split('@')[0]);

    const usernameCandidates = [...new Set(
      candidates
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )];

    const result = await apoyosPool.query(
      `SELECT id, username, titulo, mensaje, foto_url, creado_por, created_at,
              COALESCE(vio_notificacion, FALSE) AS vio_notificacion,
              visto_at,
              COALESCE(diseno, FALSE) AS diseno
       FROM notificaciones_usuario
       WHERE username = ANY($1::text[])
         AND (
           COALESCE(vio_notificacion, FALSE) = FALSE
           OR (
             COALESCE(vio_notificacion, FALSE) = TRUE
             AND visto_at IS NOT NULL
             AND visto_at >= NOW() - INTERVAL '30 days'
           )
         )
       ORDER BY COALESCE(vio_notificacion, FALSE) ASC,
                COALESCE(visto_at, created_at) DESC
       LIMIT 100`,
      [usernameCandidates]
    );

    const notificaciones = result.rows;
    const notificacionesDiseno = notificaciones.filter((row) => row.diseno === true);
    const notificacionesAnuncios = notificaciones.filter((row) => row.diseno !== true);

    return res.json({
      success: true,
      notificaciones,
      notificaciones_diseno: notificacionesDiseno,
      notificaciones_anuncios: notificacionesAnuncios,
      counts: {
        total: notificaciones.length,
        diseno: notificacionesDiseno.length,
        anuncios: notificacionesAnuncios.length
      },
      ocultarEnInicio: notificaciones.length === 0
    });
  } catch (error) {
    console.error('Error al obtener notificaciones de inicio:', error);
    return res.status(500).json({ success: false, error: 'Error al obtener notificaciones' });
  }
});

app.post('/api/notificaciones-inicio/visto', async (req, res) => {
  try {
    await ensureNotificacionesUsuarioTable();

    const rawUsername = String(req.body?.username || '').trim();
    if (!rawUsername) {
      return res.status(400).json({ success: false, error: 'Falta username' });
    }

    const candidates = [rawUsername];
    if (rawUsername.includes('\\')) candidates.push(rawUsername.split('\\').pop());
    if (rawUsername.includes('@')) candidates.push(rawUsername.split('@')[0]);

    const usernameCandidates = [...new Set(
      candidates
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )];

    const notificacionIds = Array.isArray(req.body?.notificacionIds)
      ? req.body.notificacionIds
      : (req.body?.notificacionId !== undefined ? [req.body.notificacionId] : []);

    const idsLimpios = [...new Set(
      notificacionIds
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )];

    const updateQuery = idsLimpios.length > 0
      ? `UPDATE notificaciones_usuario
         SET vio_notificacion = TRUE,
             visto_at = NOW()
         WHERE username = ANY($1::text[])
           AND id = ANY($2::bigint[])
         RETURNING id, username, titulo, mensaje, foto_url, vio_notificacion, visto_at`
      : `UPDATE notificaciones_usuario
         SET vio_notificacion = TRUE,
             visto_at = NOW()
         WHERE username = ANY($1::text[])
           AND COALESCE(vio_notificacion, FALSE) = FALSE
         RETURNING id, username, titulo, mensaje, foto_url, vio_notificacion, visto_at`;

    const result = await apoyosPool.query(
      updateQuery,
      idsLimpios.length > 0 ? [usernameCandidates, idsLimpios] : [usernameCandidates]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'No se encontraron notificaciones para actualizar' });
    }

    return res.json({
      success: true,
      actualizadas: result.rowCount,
      notificaciones: result.rows
    });
  } catch (error) {
    console.error('Error al marcar notificacion de inicio como vista:', error);
    return res.status(500).json({ success: false, error: 'Error al marcar notificacion como vista' });
  }
});

// Configuración de las bases de datos
function applyPgTimezone(pool, poolName = 'pool') {
  const tz = (process.env.APP_TIMEZONE || process.env.TZ || 'America/Tijuana').trim();
  // Evitar inyección: aceptar únicamente formatos comunes de TZ de Postgres (e.g. America/Mexico_City, UTC, GMT+6)
  const safe = /^[A-Za-z0-9_\/+-]+$/.test(tz) ? tz : 'America/Tijuana';
  pool.on('connect', (client) => {
    client.query(`SET TIME ZONE '${safe}'`).catch((err) => {
      console.error(`No se pudo aplicar TIME ZONE (${safe}) en ${poolName}:`, err);
    });
  });
}

// Helper para crear pools con configuración segura y logs de error
function createPgPool(options = {}, name = 'pool') {
  const base = {
    max: 20,
    idleTimeoutMillis: 30000,
    // Aumentar timeout de conexión para evitar desconexiones cortas
    connectionTimeoutMillis: 10000,
  };

  const config = Object.assign({}, base, options);
  const pool = new Pool(config);
  // attach debug info for troubleshooting (database name, pool name)
  pool._databaseName = config.database;
  pool._poolName = name;
  applyPgTimezone(pool, name);

  pool.on('error', (err) => {
    console.error(`Error inesperado en el pool de PostgreSQL (${name}):`, err);
  });

  return pool;
}

const apoyosPool = createPgPool({
  user: process.env.APOYOS_DB_USER || 'postgres',
  host: process.env.APOYOS_DB_HOST || 'localhost',
  database: process.env.APOYOS_DB_NAME || 'apoyos_db',
  password: process.env.APOYOS_DB_PASSWORD || 'phoenix123',
  port: parseInt(process.env.APOYOS_DB_PORT || '5432'),
  ssl: process.env.APOYOS_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
}, 'apoyosPool');

const phoenixPool = createPgPool({
  user: 'postgres',
  host: 'localhost',
  database: 'phoenix_tickets',
  password: 'phoenix123',
  port: 5432,
  ssl: false,
}, 'phoenixPool');

const inventarioPool = createPgPool({
  user: 'postgres',
  host: 'localhost',
  database: 'apoyos_db',
  password: 'phoenix123',
  port: 5432,
  ssl: false,
}, 'inventarioPool');

// Nuevo pool para mantenimiento
const mantenimientoPool = createPgPool({
  user: 'postgres',
  host: 'localhost',
  database: 'phoenix_tickets_mantenimiento',
  password: 'phoenix123',
  port: 5432,
  ssl: false,
}, 'mantenimientoPool');

// Nuevo pool para denuncias anónimas (asumiendo que está en la misma base que phoenix_tickets)
const denunciasPool = createPgPool({
  user: 'postgres',
  host: 'localhost',
  database: 'phoenix_tickets', // o la base donde esté la tabla denuncias_anonimas
  password: 'phoenix123',
  port: 5432,
  ssl: false,
}, 'denunciasPool');

// Verificar conexión a las bases de datos
async function checkDatabaseConnections() {
    try {
        // Verificar conexión a apoyos_db
        const apoyosClient = await apoyosPool.connect();
        console.log('Conexión exitosa a la base de datos (Tabla apoyos_db)');
        apoyosClient.release();

        // Verificar conexión a phoenix_tickets
        const phoenixClient = await phoenixPool.connect();
        console.log('Conexión exitosa a la base de datos (Tabla phoenix_tickets)');
        phoenixClient.release();
    } catch (error) {
        console.error('Error al conectar a las bases de datos:', error);
    }
}

checkDatabaseConnections();

// Verificar conexión a inventario_db
(async () => {
    try {
        const client = await inventarioPool.connect();
        console.log('Conexión exitosa a la base de datos (Tabla inventario_db)');
        client.release();
    } catch (error) {
        console.error('Error al conectar a inventario_db:', error);
    }
})();

// Verificar conexión a denuncias_db
(async () => {
    try {
        const client = await denunciasPool.connect();
        console.log('Conexión exitosa a denuncias_db');
        client.release();
    } catch (error) {
        console.error('Error al conectar a denuncias_db:', error);
    }
})();

// Rutas para apoyos_db

// Nueva ruta para obtener empleados que tienen es_supervisor = true
// Endpoint para obtener todos los empleados
app.get('/api/employees/all', async (req, res) => {
  try {
    const result = await apoyosPool.query(
      `SELECT id, nombre_completo, supervisor, puesto, foto_url, usuario, departamento, area
       FROM empleados 
       ORDER BY nombre_completo ASC`
    );
    
    res.json({ 
      success: true, 
      employees: result.rows || []
    });
  } catch (error) {
    console.error('Error al obtener empleados:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al obtener empleados',
      employees: []
    });
  }
});

// Endpoint para obtener empleados del departamento de Diseño
app.get('/api/employees/design', async (req, res) => {
  try {
    // Intentar con diferentes nombres de tabla
    let result;
    try {
      result = await apoyosPool.query(
        `SELECT id, nombre_completo, supervisor, puesto, foto_url, usuario, departamento, area
         FROM empleados 
         WHERE LOWER(departamento) LIKE '%diseño%' OR LOWER(area) LIKE '%diseño%'
         ORDER BY nombre_completo ASC`
      );
    } catch (tableError) {
      logger.warn('Table empleados not found, trying alternate query');
      // Si la tabla no existe, retornar un array vacío
      result = { rows: [] };
    }
    
    res.json({ 
      success: true, 
      employees: result.rows || []
    });
  } catch (error) {
    logger.error('Error al obtener empleados de diseño:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al obtener empleados de diseño',
      employees: []
    });
  }
});

// Endpoint para obtener empleados del departamento de IT
app.get('/api/employees/it', async (req, res) => {
  try {
    // Intentar con diferentes nombres de tabla
    let result;
    try {
      result = await apoyosPool.query(
        `SELECT id, nombre_completo, supervisor, puesto, foto_url, usuario, departamento, area
         FROM empleados 
         WHERE LOWER(departamento) LIKE '%it%' OR LOWER(area) LIKE '%it%' OR 
               LOWER(departamento) LIKE '%informática%' OR LOWER(area) LIKE '%informática%' OR
               LOWER(departamento) LIKE '%sistemas%' OR LOWER(area) LIKE '%sistemas%'
         ORDER BY nombre_completo ASC`
      );
    } catch (tableError) {
      logger.warn('Table empleados not found, trying alternate query');
      // Si la tabla no existe, retornar un array vacío
      result = { rows: [] };
    }
    
    res.json({ 
      success: true, 
      employees: result.rows || []
    });
  } catch (error) {
    logger.error('Error al obtener empleados de IT:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al obtener empleados de IT',
      employees: []
    });
  }
});

// Endpoint para obtener equipos disponibles para préstamo (devuelve todas las columnas)
// ── Software / Credenciales ──────────────────────────────────────────────────
// Crear tabla si no existe (se ejecuta una vez al arrancar)
inventarioPool.query(`
  CREATE TABLE IF NOT EXISTS software_credenciales (
    id           SERIAL PRIMARY KEY,
    pagina       TEXT NOT NULL,
    usuario      TEXT,
    contrasena   TEXT,
    consola      TEXT,
    tipo         TEXT,
    facturacion  TEXT,
    fecha_compra DATE,
    vigencia     DATE,
    precio       NUMERIC(12,2),
    notas        TEXT,
    created_at   TIMESTAMP DEFAULT NOW()
  )
`).catch(e => console.error('Error creando tabla software_credenciales:', e));

// Agregar columnas nuevas si la tabla ya existía (idempotente)
['ALTER TABLE software_credenciales ADD COLUMN IF NOT EXISTS tipo TEXT',
 'ALTER TABLE software_credenciales ADD COLUMN IF NOT EXISTS facturacion TEXT',
 'ALTER TABLE software_credenciales ADD COLUMN IF NOT EXISTS fecha_compra DATE',
 'ALTER TABLE software_credenciales ADD COLUMN IF NOT EXISTS vigencia DATE',
 'ALTER TABLE software_credenciales ADD COLUMN IF NOT EXISTS precio NUMERIC(12,2)']
  .forEach(q => inventarioPool.query(q).catch(()=>{}));

// Proxy tipo de cambio MXN→USD (evita CORS en el browser)
app.get('/api/tipo-cambio/mxn-usd', async (req, res) => {
  try {
    const { data } = await axios.get('https://api.frankfurter.app/latest?from=MXN&to=USD', { timeout: 8000 });
    res.json({ success: true, rate: data.rates?.USD || null, date: data.date || '' });
  } catch(e) {
    logger.error('Error al obtener tipo de cambio:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

function calcVigenciaSW(fecha_compra, facturacion) {
  if(!fecha_compra) return null;
  const d = new Date(fecha_compra);
  if(isNaN(d)) return null;
  if(facturacion === 'Mensual') d.setMonth(d.getMonth() + 1);
  else if(facturacion === 'Anual') d.setFullYear(d.getFullYear() + 1);
  else return null; // "Única vez" u otros: sin vigencia automática
  return d.toISOString().split('T')[0];
}

app.get('/api/software-credenciales', async (req, res) => {
  try {
    const r = await inventarioPool.query('SELECT * FROM software_credenciales ORDER BY id ASC');
    res.json({ success: true, items: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/software-credenciales', async (req, res) => {
  const { pagina, usuario, contrasena, consola, tipo, facturacion, fecha_compra, precio, notas } = req.body;
  try {
    const vigencia = calcVigenciaSW(fecha_compra, facturacion);
    const r = await inventarioPool.query(
      `INSERT INTO software_credenciales
         (pagina, usuario, contrasena, consola, tipo, facturacion, fecha_compra, vigencia, precio, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [pagina, usuario||null, contrasena||null, consola||null,
       tipo||null, facturacion||null, fecha_compra||null, vigencia, precio??null, notas||null]
    );
    res.json({ success: true, item: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/software-credenciales/:id', async (req, res) => {
  const { id } = req.params;
  const { pagina, usuario, contrasena, consola, tipo, facturacion, fecha_compra, precio, notas } = req.body;
  try {
    const vigencia = calcVigenciaSW(fecha_compra, facturacion);
    const r = await inventarioPool.query(
      `UPDATE software_credenciales
       SET pagina=$1, usuario=$2, contrasena=$3, consola=$4,
           tipo=$5, facturacion=$6, fecha_compra=$7, vigencia=$8, precio=$9, notas=$10
       WHERE id=$11 RETURNING *`,
      [pagina, usuario||null, contrasena||null, consola||null,
       tipo||null, facturacion||null, fecha_compra||null, vigencia, precio??null, notas||null, id]
    );
    res.json({ success: true, item: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/software-credenciales/:id', async (req, res) => {
  try {
    await inventarioPool.query('DELETE FROM software_credenciales WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
// ── Fin Software ─────────────────────────────────────────────────────────────

app.get('/api/equipos-prestamo', async (req, res) => {
  try {
    // ?all=true → devuelve todos (vista admin); sin parámetro → solo disponibles Y prestables (modal de solicitud)
    const all = req.query.all === 'true';
    const q = all
      ? `SELECT * FROM equipos_prestamo ORDER BY id ASC`
      : `SELECT * FROM equipos_prestamo
         WHERE LOWER(COALESCE(estatus, 'disponible')) NOT IN ('ocupada', 'ocupado', 'en uso', 'prestado')
           AND prestable = true
         ORDER BY id ASC`;
    const result = await inventarioPool.query(q);
    res.json({ success: true, equipos: result.rows || [] });
  } catch (error) {
    logger.error('Error al obtener equipos para préstamo:', error);
    res.status(500).json({ success: false, error: 'Error al obtener equipos para préstamo', equipos: [] });
  }
});

// Endpoint para agregar un nuevo equipo a equipos_prestamo
app.post('/api/equipos-prestamo', async (req, res) => {
  try {
    const { nombre_qr, memoria_ram, memoria_ssd, procesador, touch, bateria_condicion, cargador, prestable, notas, tipo, so, marca } = req.body || {};
    if (!nombre_qr || !nombre_qr.toString().trim()) {
      return res.status(400).json({ success: false, error: 'El campo nombre_qr es obligatorio' });
    }
    const q = `
      INSERT INTO equipos_prestamo
        (nombre_qr, memoria_ram, memoria_ssd, procesador, touch, bateria_condicion, cargador, prestable, notas, tipo, so, marca, estatus)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Disponible')
      RETURNING *`;
    const values = [
      nombre_qr.toString().trim(),
      memoria_ram   || null,
      memoria_ssd   || null,
      procesador    || null,
      touch         || null,
      bateria_condicion != null && bateria_condicion !== '' ? bateria_condicion : null,
      cargador      != null ? cargador : null,
      prestable     != null ? prestable : null,
      notas         || null,
      tipo          || null,
      so            || null,
      marca         || null
    ];
    const result = await inventarioPool.query(q, values);
    return res.json({ success: true, equipo: result.rows[0] });
  } catch (error) {
    logger.error('Error al agregar equipo a equipos_prestamo:', { message: error?.message, code: error?.code, detail: error?.detail, error });
    return res.status(500).json({ success: false, error: 'Error al agregar equipo', detail: error?.message || '', code: error?.code || '' });
  }
});

// Endpoint para editar un equipo existente en equipos_prestamo
app.put('/api/equipos-prestamo/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { nombre_qr, memoria_ram, memoria_ssd, procesador, touch, bateria_condicion, cargador, prestable, notas, tipo, estatus, so, marca } = req.body || {};
    if (!nombre_qr || !nombre_qr.toString().trim()) {
      return res.status(400).json({ success: false, error: 'El campo nombre_qr es obligatorio' });
    }
    const q = `
      UPDATE equipos_prestamo
      SET nombre_qr        = $1,
          memoria_ram      = $2,
          memoria_ssd      = $3,
          procesador       = $4,
          touch            = $5,
          bateria_condicion= $6,
          cargador         = $7,
          prestable        = $8,
          notas            = $9,
          tipo             = $10,
          estatus          = $11,
          so               = $12,
          marca            = $13
      WHERE id = $14
      RETURNING *`;
    const values = [
      nombre_qr.toString().trim(),
      memoria_ram        || null,
      memoria_ssd        || null,
      procesador         || null,
      touch              || null,
      bateria_condicion != null && bateria_condicion !== '' ? bateria_condicion : null,
      cargador  != null ? cargador  : null,
      prestable != null ? prestable : null,
      notas              || null,
      tipo               || null,
      estatus            || 'Disponible',
      so                 || null,
      marca              || null,
      id
    ];
    const result = await inventarioPool.query(q, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Equipo no encontrado' });
    }
    return res.json({ success: true, equipo: result.rows[0] });
  } catch (error) {
    logger.error('Error al editar equipo en equipos_prestamo:', { message: error?.message, code: error?.code, detail: error?.detail, error });
    return res.status(500).json({ success: false, error: 'Error al editar equipo', detail: error?.message || '' });
  }
});

// Multer para fotos de evidencia de préstamos
const evidenciaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads', 'evidencias');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `prestamo-${req.params.id}-${req.body.tipo || 'foto'}-${Date.now()}${ext}`);
  }
});
const uploadEvidencia = multer({
  storage: evidenciaStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if(!file.mimetype.startsWith('image/')) return cb(new Error('Solo se aceptan imágenes'));
    cb(null, true);
  }
});

// Endpoint para subir foto de evidencia (condicion o retorno)
app.post('/api/prestamos/:id/evidencia', uploadEvidencia.single('foto'), async (req, res) => {
  try {
    const id   = req.params.id;
    const tipo = (req.body.tipo || '').toString().toLowerCase(); // 'condicion' o 'retorno'
    if(!req.file) return res.status(400).json({ success: false, error: 'No se recibió ningún archivo' });
    if(tipo !== 'condicion' && tipo !== 'retorno')
      return res.status(400).json({ success: false, error: 'tipo debe ser "condicion" o "retorno"' });

    const col = tipo === 'condicion' ? 'evidencia_condicion' : 'evidencia_retorno';
    const url = `/uploads/evidencias/${req.file.filename}`;

    const result = await inventarioPool.query(
      `UPDATE prestamos SET ${col} = $1 WHERE id = $2 RETURNING id, evidencia_condicion, evidencia_retorno`,
      [url, id]
    );
    if(result.rows.length === 0)
      return res.status(404).json({ success: false, error: 'Préstamo no encontrado' });

    return res.json({ success: true, url, prestamo: result.rows[0] });
  } catch (error) {
    logger.error('Error al subir evidencia de préstamo:', { message: error?.message, error });
    return res.status(500).json({ success: false, error: 'Error al subir evidencia', detail: error?.message || '' });
  }
});

    // Endpoint para crear un préstamo (guarda usuario logueado y equipo seleccionado)
    app.post('/api/prestamos', async (req, res) => {
      try {
        if (!req.session || !req.session.userId) {
          return res.status(401).json({ success: false, error: 'Usuario no autenticado' });
        }

        const userId = req.session.userId;
        const id_computadora = req.body && req.body.id_computadora ? String(req.body.id_computadora) : null;
        const fecha_inicio = req.body && req.body.fecha_inicio ? req.body.fecha_inicio : null;
        const fecha_fin = req.body && req.body.fecha_fin ? req.body.fecha_fin : null;

        if (!id_computadora) {
          return res.status(400).json({ success: false, error: 'id_computadora es requerido' });
        }

        // Usar transacción para insertar el préstamo y marcar el equipo como Ocupada atómicamente
        const client = await inventarioPool.connect();
        try {
          await client.query('BEGIN');

          const insertQ = `INSERT INTO prestamos (id_usuario, id_computadora, fecha_inicio, fecha_fin, fecha_retorno)
                           VALUES ($1, $2, $3, $4, NULL) RETURNING *`;
          const insertRes = await client.query(insertQ, [String(userId), id_computadora, fecha_inicio, fecha_fin]);

          // Marcar el equipo como Ocupada
          await client.query(
            `UPDATE equipos_prestamo SET estatus = 'Ocupada' WHERE CAST(id AS TEXT) = $1`,
            [id_computadora]
          );

          await client.query('COMMIT');
          return res.json({ success: true, prestamo: insertRes.rows[0] });
        } catch (txErr) {
          await client.query('ROLLBACK');
          throw txErr;
        } finally {
          client.release();
        }
      } catch (error) {
        logger.error('Error al crear prestamo:', { message: error?.message, error });
        return res.status(500).json({ success: false, error: 'Error al crear préstamo' });
      }
    });

// Endpoint para obtener empleados del departamento de RH
app.get('/api/employees/rh', async (req, res) => {
  try {
    const result = await apoyosPool.query(
      `SELECT id, nombre_completo, supervisor, puesto, foto_url, usuario, departamento, area
       FROM empleados 
       WHERE LOWER(departamento) LIKE '%rh%' OR LOWER(area) LIKE '%rh%' OR 
             LOWER(departamento) LIKE '%recursos humanos%' OR LOWER(area) LIKE '%recursos humanos%' OR
             LOWER(departamento) LIKE '%talento%' OR LOWER(area) LIKE '%talento%'
       ORDER BY nombre_completo ASC`
    );
    
    res.json({ 
      success: true, 
      employees: result.rows || []
    });
  } catch (error) {
    console.error('Error al obtener empleados de RH:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al obtener empleados de RH',
      employees: []
    });
  }
});

// Endpoint para verificar si el usuario logueado tiene un préstamo activo (sin fecha_retorno)
app.get('/api/prestamos/activo', async (req, res) => {
  try {
    // Si no hay sesión activa, responder con sesion_expirada en lugar de 401
    if (!req.session || !req.session.userId) {
      return res.json({ success: true, activo: false, sesion_expirada: true });
    }
    const userId = String(req.session.userId);
    const q = `SELECT id, id_computadora,
                      fecha_inicio::date AS fecha_inicio,
                      fecha_fin::date    AS fecha_fin
               FROM prestamos
               WHERE CAST(id_usuario AS TEXT) = $1 AND fecha_retorno IS NULL
               ORDER BY id DESC LIMIT 1`;
    const result = await inventarioPool.query(q, [userId]);
    if (result.rows && result.rows.length > 0) {
      return res.json({ success: true, activo: true, prestamo: result.rows[0] });
    }
    return res.json({ success: true, activo: false, prestamo: null });
  } catch (error) {
    logger.error('Error al verificar préstamo activo:', { message: error?.message, error });
    // Nunca exponer 500 al cliente; fallar silenciosamente
    return res.json({ success: false, activo: false });
  }
});

// Endpoint para listar préstamos (incluye nombre del usuario)
app.get('/api/prestamos', async (req, res) => {
  try {
    const q = `SELECT id, id_usuario, id_computadora,
                      fecha_inicio::date  AS fecha_inicio,
                      fecha_fin::date     AS fecha_fin,
                      fecha_retorno::date AS fecha_retorno,
                      aprobado,
                      evidencia_condicion,
                      evidencia_retorno
               FROM prestamos
               ORDER BY id DESC`;
    const result = await inventarioPool.query(q);
    const prestamos = result.rows || [];

    // Enriquecer con nombre del usuario (tabla usuarios en apoyosPool)
    if (prestamos.length > 0) {
      try {
        const ids = [...new Set(prestamos.map(p => p.id_usuario).filter(Boolean))];
        if (ids.length > 0) {
          const uRes = await apoyosPool.query(
            `SELECT id::text AS id, COALESCE(nombre_completo, username, id::text) AS nombre
             FROM usuarios WHERE id::text = ANY($1::text[])`,
            [ids.map(String)]
          );
          const nameMap = new Map(uRes.rows.map(u => [String(u.id), u.nombre]));
          prestamos.forEach(p => {
            p.nombre_usuario = nameMap.get(String(p.id_usuario)) || String(p.id_usuario);
          });
        }
      } catch (uErr) {
        logger.warn('No se pudieron obtener nombres de usuarios para préstamos:', uErr?.message);
        prestamos.forEach(p => { p.nombre_usuario = String(p.id_usuario); });
      }
    }

    return res.json({ success: true, prestamos });
  } catch (error) {
    logger.error('Error al obtener prestamos:', { message: error?.message, error });
    return res.status(500).json({ success: false, error: 'Error al obtener préstamos', prestamos: [] });
  }
});

// Endpoint para actualizar fecha_retorno de un prestamo por id
app.post('/api/prestamos/:id/retorno', async (req, res) => {
  const client = await inventarioPool.connect();
  try {
    const id = req.params.id;
    const fecha_retorno = req.body && (req.body.fecha_retorno === null ? null : req.body.fecha_retorno) ? req.body.fecha_retorno : null;

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE prestamos SET fecha_retorno = $1 WHERE id = $2 RETURNING *`,
      [fecha_retorno, id]
    );
    const prestamo = result.rows[0] || null;

    // Si se registra devolución, volver el equipo a Disponible
    if (fecha_retorno && prestamo && prestamo.id_computadora) {
      await client.query(
        `UPDATE equipos_prestamo SET estatus = 'Disponible' WHERE CAST(id AS TEXT) = $1`,
        [String(prestamo.id_computadora)]
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, prestamo });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al actualizar fecha_retorno:', { message: error?.message, error });
    return res.status(500).json({ success: false, error: 'Error al actualizar fecha de retorno' });
  } finally {
    client.release();
  }
});

// Endpoint para aceptar un préstamo: aprobado = true
app.post('/api/prestamos/:id/accept', async (req, res) => {
  try {
    const id = req.params.id;
    const q = `UPDATE prestamos SET aprobado = TRUE WHERE id = $1 RETURNING *`;
    const result = await inventarioPool.query(q, [id]);
    return res.json({ success: true, prestamo: result.rows[0] || null });
  } catch (error) {
    logger.error('Error al aceptar prestamo:', { message: error?.message, error });
    return res.status(500).json({ success: false, error: 'Error al aceptar préstamo' });
  }
});

// Endpoint para rechazar un préstamo: aprobado = false, equipo vuelve a Disponible, préstamo queda libre
app.post('/api/prestamos/:id/cancel', async (req, res) => {
  const client = await inventarioPool.connect();
  try {
    const id = req.params.id;

    await client.query('BEGIN');

    // Obtener id_computadora antes de actualizar
    const getRes = await client.query(`SELECT id_computadora FROM prestamos WHERE id = $1`, [id]);
    const id_computadora = getRes.rows[0] ? String(getRes.rows[0].id_computadora) : null;

    // Marcar préstamo como rechazado
    const upRes = await client.query(
      `UPDATE prestamos SET aprobado = FALSE WHERE id = $1 RETURNING *`,
      [id]
    );

    // Devolver el equipo a Disponible para que pueda ser solicitado de nuevo
    if (id_computadora) {
      await client.query(
        `UPDATE equipos_prestamo SET estatus = 'Disponible' WHERE CAST(id AS TEXT) = $1`,
        [id_computadora]
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, prestamo: upRes.rows[0] || null });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al rechazar prestamo:', { message: error?.message, error });
    return res.status(500).json({ success: false, error: 'Error al rechazar préstamo' });
  } finally {
    client.release();
  }
});

// Endpoint: consultar solicitudes de vacaciones/permiso por número de empleado
app.get('/api/solicitudes_vacaciones/numero-empleado/:numero', async (req, res) => {
  try {
    const numero = String(req.params.numero || '').trim();
    if (!numero) return res.status(400).json({ error: 'Número de empleado requerido' });

    // Intentar buscar por numero_empleado en la tabla empleados, o por id
    const query = `
      SELECT sv.*, e.numero_empleado AS empleado_numero, e.id AS empleado_id
      FROM solicitudes_vacaciones sv
      LEFT JOIN empleados e ON sv.empleado_id = e.id
      WHERE (e.numero_empleado::text = $1 OR e.id::text = $1)
        AND sv.estado = 'aprobada'
        AND CURRENT_DATE BETWEEN sv.fecha_inicio AND sv.fecha_fin
      ORDER BY sv.fecha_inicio ASC
    `;

    const result = await apoyosPool.query(query, [numero]);
    // Devolver array (vacaciones activas) - vacío si no hay coincidencias
    return res.json(result.rows || []);
  } catch (error) {
    console.error('Error al consultar solicitudes_vacaciones por numero:', error?.message || error);
    return res.status(500).json({ error: 'Error consultando solicitudes de vacaciones', message: error?.message });
  }
});

// Endpoints para incapacidades (licencias médicas)
app.post('/api/incapacidades', upload.single('evidencia'), async (req, res) => {
  try {
    const body = req.body || {};
    const empleado_id = body.empleado_id ? Number(body.empleado_id) : null;
    const fecha_inicio = body.fecha_inicio || null;
    const fecha_fin = body.fecha_fin || null;
    const motivo = body.motivo || '';
    const notas = body.notas || null;

    if (!empleado_id || !fecha_inicio || !fecha_fin || !motivo) {
      return res.status(400).json({ success: false, error: 'empleado_id, fecha_inicio, fecha_fin y motivo son requeridos' });
    }

    const evidenciaFile = req.file ? req.file.filename : (body.evidencia || null);

    const insertQuery = `
      INSERT INTO incapacidades (empleado_id, fecha_inicio, fecha_fin, motivo, evidencia, notas)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await apoyosPool.query(insertQuery, [empleado_id, fecha_inicio, fecha_fin, motivo, evidenciaFile, notas]);
    return res.json({ success: true, incapacidad: result.rows[0] });
  } catch (error) {
    logger.error('POST /api/incapacidades error:', { message: error?.message });
    return res.status(500).json({ success: false, error: 'Error al guardar incapacidad' });
  }
});

app.get('/api/incapacidades', async (req, res) => {
  try {
    const empleadoId = req.query.empleado_id ? Number(req.query.empleado_id) : null;
    let query = 'SELECT * FROM incapacidades';
    const params = [];
    if (Number.isFinite(empleadoId)) {
      query += ' WHERE empleado_id = $1';
      params.push(empleadoId);
    }
    query += ' ORDER BY fecha_registro DESC';

    const result = await apoyosPool.query(query, params);
    return res.json({ success: true, incapacidades: result.rows || [] });
  } catch (error) {
    logger.error('GET /api/incapacidades error:', { message: error?.message });
    return res.status(500).json({ success: false, error: 'Error al obtener incapacidades' });
  }
});

app.get('/api/incapacidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'id inválido' });

    const result = await apoyosPool.query('SELECT * FROM incapacidades WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
    return res.json({ success: true, incapacidad: result.rows[0] });
  } catch (error) {
    logger.error('GET /api/incapacidades/:id error:', { message: error?.message });
    return res.status(500).json({ success: false, error: 'Error al obtener incapacidad' });
  }
});

app.put('/api/incapacidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'id inválido' });

    const { estado, aprobado_por, fecha_aprobacion, notas, motivo, fecha_inicio, fecha_fin } = req.body || {};

    const allowedEstados = new Set(['pendiente', 'aprobado', 'rechazado']);
    const sets = [];
    const params = [];
    let idx = 1;

    if (estado && allowedEstados.has(String(estado))) { sets.push(`estado = $${idx++}`); params.push(estado); }
    if (aprobado_por) { sets.push(`aprobado_por = $${idx++}`); params.push(aprobado_por); }
    if (fecha_aprobacion) { sets.push(`fecha_aprobacion = $${idx++}`); params.push(fecha_aprobacion); }
    if (notas !== undefined) { sets.push(`notas = $${idx++}`); params.push(notas); }
    if (motivo !== undefined) { sets.push(`motivo = $${idx++}`); params.push(motivo); }
    if (fecha_inicio !== undefined) { sets.push(`fecha_inicio = $${idx++}`); params.push(fecha_inicio); }
    if (fecha_fin !== undefined) { sets.push(`fecha_fin = $${idx++}`); params.push(fecha_fin); }

    if (sets.length === 0) return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });

    const sql = `UPDATE incapacidades SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
    params.push(id);

    const result = await apoyosPool.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
    return res.json({ success: true, incapacidad: result.rows[0] });
  } catch (error) {
    logger.error('PUT /api/incapacidades/:id error:', { message: error?.message });
    return res.status(500).json({ success: false, error: 'Error al actualizar incapacidad' });
  }
});

// Eliminar incapacidad
app.delete('/api/incapacidades/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'id inválido' });

    const result = await apoyosPool.query('DELETE FROM incapacidades WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'No encontrado' });
    return res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/incapacidades/:id error:', { message: error?.message });
    return res.status(500).json({ success: false, error: 'Error al eliminar incapacidad' });
  }
});


// Endpoint para obtener la foto del empleado logeado
app.get('/api/get-employee-photo', async (req, res) => {
  try {
    const username = req.session?.username;
    
    if (!username) {
      return res.json({ 
        success: false, 
        photo: null,
        message: 'Usuario no autenticado'
      });
    }

    // Buscar el empleado por nombre de usuario
    const result = await apoyosPool.query(
      `SELECT foto_url, nombre_completo, puesto, departamento, area 
       FROM empleados 
       WHERE usuario = $1 OR LOWER(nombre_completo) = LOWER($1)
       LIMIT 1`,
      [username]
    );

    if (result.rows.length > 0 && result.rows[0].foto_url) {
      res.json({ 
        success: true, 
        photo: result.rows[0].foto_url,
        name: result.rows[0].nombre_completo,
        position: result.rows[0].puesto,
        department: result.rows[0].departamento || result.rows[0].area
      });
    } else {
      res.json({ 
        success: false, 
        photo: null,
        message: 'No se encontró foto para el usuario'
      });
    }
  } catch (error) {
    console.error('Error al obtener foto del empleado:', error);
    res.json({ 
      success: false, 
      photo: null,
      message: 'Error al obtener la foto'
    });
  }
});

app.get('/api/empleados/supervisores-activos', async (req, res) => {
    try {
        console.log('Consultando supervisores activos...');
        
        // Intentar crear la columna si no existe (con manejo de error)
        try {
            await apoyosPool.query('ALTER TABLE empleados ADD COLUMN es_supervisor BOOLEAN DEFAULT false');
            console.log('Columna es_supervisor creada o ya existe');
        } catch (columnError) {
            // Si la columna ya existe, ignorar el error
            if (!columnError.message.includes('already exists') && !columnError.message.includes('duplicate column')) {
                console.log('Error al crear columna (puede que ya exista):', columnError.message);
            }
        }
        
        // Consultar supervisores
        const result = await apoyosPool.query(
            `SELECT id, nombre_completo, puesto, area, departamento, COALESCE(es_supervisor, false) as es_supervisor
             FROM empleados 
             WHERE COALESCE(es_supervisor, false) = true AND (activo = true OR activo IS NULL)
             ORDER BY nombre_completo`
        );
        
        console.log('Supervisores encontrados:', result.rows.length);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener supervisores activos:', error);
        res.status(500).json({ 
            error: 'Error al consultar supervisores activos',
            message: error.message
        });
    }
});

// Endpoint para obtener la jerarquía organizacional completa
app.get('/api/empleados/jerarquia', async (req, res) => {
    try {
        console.log('Consultando jerarquía organizacional...');
        
        // Obtener todos los empleados con sus supervisores
        const result = await apoyosPool.query(`
            SELECT 
                id, 
                nombre_completo, 
                supervisor, 
                puesto, 
                area, 
                departamento, 
                COALESCE(es_supervisor, false) as es_supervisor,
                COALESCE(activo, true) as activo
            FROM empleados 
            WHERE COALESCE(activo, true) = true
            ORDER BY 
                CASE 
                    WHEN supervisor IS NULL OR supervisor = '' THEN 0 
                    ELSE 1 
                END,
                supervisor,
                nombre_completo
        `);
        
        // Construir la jerarquía
        const empleados = result.rows;
        const jerarquia = [];
        
        // Encontrar empleados sin supervisor (nivel más alto)
        const empleadosSinSupervisor = empleados.filter(emp => 
            !emp.supervisor || emp.supervisor.trim() === ''
        );
        
        // Función recursiva para construir la jerarquía
        function construirJerarquia(empleado, nivel = 0) {
            const nodo = {
                id: empleado.id,
                nombre: empleado.nombre_completo,
                supervisor: empleado.supervisor,
                puesto: empleado.puesto,
                area: empleado.area,
                departamento: empleado.departamento,
                es_supervisor: empleado.es_supervisor,
                nivel: nivel,
                subordinados: []
            };
            
            // Buscar subordinados
            const subordinados = empleados.filter(emp => 
                emp.supervisor === empleado.nombre_completo
            );
            
            subordinados.forEach(sub => {
                nodo.subordinados.push(construirJerarquia(sub, nivel + 1));
            });
            
            return nodo;
        }
        
        // Construir la jerarquía desde los empleados sin supervisor
        empleadosSinSupervisor.forEach(emp => {
            jerarquia.push(construirJerarquia(emp));
        });
        
        console.log('Jerarquía construida con', jerarquia.length, 'niveles superiores');
        res.json({
            success: true,
            jerarquia: jerarquia,
            total_empleados: empleados.length
        });
        
    } catch (error) {
        console.error('Error al obtener jerarquía organizacional:', error);
        res.status(500).json({ 
            error: 'Error al consultar jerarquía organizacional',
            message: error.message
        });
    }
});

// Ruta para obtener datos de rotación de personal (DEBE ir antes de /api/empleados/:id)
app.get('/api/empleados/rotacion', async (req, res) => {
    console.log('=== ENDPOINT ROTACIÓN LLAMADO ===');
    try {
        console.log('Iniciando consulta de rotación...');
        const { periodo = 'anual' } = req.query; // anual, mensual, trimestral
        console.log('Período solicitado:', periodo);
        
        let fechaInicio, fechaFin;
        const ahora = new Date();
        
        switch (periodo) {
            case 'mensual':
                fechaInicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
                fechaFin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
                break;
            case 'trimestral':
                const trimestre = Math.floor(ahora.getMonth() / 3);
                fechaInicio = new Date(ahora.getFullYear(), trimestre * 3, 1);
                fechaFin = new Date(ahora.getFullYear(), (trimestre + 1) * 3, 0);
                break;
            case 'anual':
            default:
                fechaInicio = new Date(ahora.getFullYear(), 0, 1);
                fechaFin = new Date(ahora.getFullYear(), 11, 31);
                break;
        }
        
        // Obtener empleados que se dieron de baja en el período
        console.log('Consultando bajas para período:', fechaInicio, 'a', fechaFin);
        const bajasResult = await apoyosPool.query(
            `SELECT 
                COUNT(*) as total_bajas,
                EXTRACT(MONTH FROM fecha_baja) as mes,
                EXTRACT(QUARTER FROM fecha_baja) as trimestre
             FROM empleados 
             WHERE fecha_baja IS NOT NULL 
             AND fecha_baja >= $1 AND fecha_baja <= $2
             GROUP BY EXTRACT(MONTH FROM fecha_baja), EXTRACT(QUARTER FROM fecha_baja)
             ORDER BY EXTRACT(MONTH FROM fecha_baja)`,
            [fechaInicio, fechaFin]
        );
        console.log('Resultado de bajas:', bajasResult.rows);
        
        // Obtener total de empleados activos actualmente
        console.log('Consultando empleados activos...');
        const activosResult = await apoyosPool.query(
            'SELECT COUNT(*) as total_activos FROM empleados WHERE activo = true OR activo IS NULL'
        );
        console.log('Empleados activos:', activosResult.rows[0]);
        
        // Obtener total de empleados inactivos (con fecha de baja)
        console.log('Consultando empleados inactivos...');
        const inactivosResult = await apoyosPool.query(
            'SELECT COUNT(*) as total_inactivos FROM empleados WHERE activo = false AND fecha_baja IS NOT NULL'
        );
        console.log('Empleados inactivos:', inactivosResult.rows[0]);
        
        // Calcular rotación por mes/trimestre
        const rotacionPorPeriodo = bajasResult.rows.map(row => {
            const mes = parseInt(row.mes);
            const trimestre = parseInt(row.trimestre);
            const nombreMes = [
                'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
            ][mes - 1] || `Mes ${mes}`;
            
            return {
                periodo: periodo === 'mensual' ? nombreMes : `Trimestre ${trimestre}`,
                bajas: parseInt(row.total_bajas),
                mes: mes,
                trimestre: trimestre
            };
        });
        
        const totalActivos = parseInt(activosResult.rows[0].total_activos);
        const totalInactivos = parseInt(inactivosResult.rows[0].total_inactivos);
        const totalBajasPeriodo = rotacionPorPeriodo.reduce((sum, item) => sum + item.bajas, 0);
        
        // Calcular tasa de rotación
        const tasaRotacion = totalActivos > 0 ? (totalBajasPeriodo / totalActivos) * 100 : 0;
        
        // Obtener total de empleados para contexto
        const totalEmpleados = totalActivos + totalInactivos;
        
        res.json({
            success: true,
            periodo: periodo,
            fechaInicio: fechaInicio.toISOString().split('T')[0],
            fechaFin: fechaFin.toISOString().split('T')[0],
            datos: {
                totalActivos,
                totalInactivos,
                totalEmpleados,
                totalBajasPeriodo,
                tasaRotacion: Math.round(tasaRotacion * 100) / 100,
                rotacionPorPeriodo,
                tieneDatos: totalBajasPeriodo > 0
            }
        });
        
    } catch (error) {
        console.error('Error al obtener datos de rotación:', error);
        res.status(500).json({ 
            error: 'Error al obtener datos de rotación',
            message: error.message 
        });
    }
});

app.get('/api/empleados/:id', async (req, res) => {
  try {
      const { id } = req.params;
      const result = await apoyosPool.query(
      'SELECT id, nombre_completo, supervisor, puesto, fecha_ingreso, fecha_cumpleanos, telefono_emergencia, foto_url, activo, area, departamento, COALESCE(es_supervisor, false) as es_supervisor, email FROM empleados WHERE id = $1',
          [id]
      );

      if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Empleado no encontrado' });
      }

      res.json(result.rows[0]);
  } catch (error) {
      console.error('Error al consultar empleado:', error);
      res.status(500).json({ error: 'Error al consultar el empleado' });
  }
});

// Nueva ruta para obtener información del supervisor
app.get('/api/empleados/supervisor/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Primero, verificar si el supervisor existe como empleado
        const empleadoResult = await apoyosPool.query(
            'SELECT id, nombre_completo, supervisor, puesto, fecha_ingreso, foto_url, activo FROM empleados WHERE nombre_completo = $1',
            [id]
        );

        if (empleadoResult.rows.length > 0) {
            // El supervisor existe como empleado
            const supervisorData = empleadoResult.rows[0];
            res.json(supervisorData);
            return;
        }

        // Si no existe como empleado, verificar que sea un supervisor válido
        const supervisorResult = await apoyosPool.query(
            'SELECT COUNT(*) as empleados_a_cargo FROM empleados WHERE supervisor = $1',
            [id]
        );

        if (parseInt(supervisorResult.rows[0].empleados_a_cargo) > 0) {
            // Es un supervisor válido, crear una respuesta
            const supervisorData = {
                id: id, // Usar el nombre como ID
                nombre_completo: id,
                supervisor: null,
                puesto: 'Supervisor',
                fecha_ingreso: null,
                foto_url: null,
                activo: true
            };
            res.json(supervisorData);
            return;
        }
        res.status(404).json({ error: 'Supervisor no encontrado' });
        
    } catch (error) {
        console.error('Error detallado al consultar supervisor:', error);
        res.status(500).json({ 
            error: 'Error al consultar el supervisor',
            message: error.message,
            stack: error.stack
        });
    }
});

// Ruta para actualizar el estado activo de un empleado
app.patch('/api/empleados/:id/estado-activo', async (req, res) => {
    try {
        const { id } = req.params;
        const { activo } = req.body;

        // Validar que el campo activo sea un booleano
        if (typeof activo !== 'boolean') {
            return res.status(400).json({ 
                error: 'Campo inválido',
                message: 'El campo activo debe ser un valor booleano (true/false)'
            });
        }

        // Verificar que el empleado existe
        const empleadoExistente = await apoyosPool.query(
            'SELECT id FROM empleados WHERE id = $1',
            [id]
        );

        if (empleadoExistente.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Empleado no encontrado',
                message: 'No existe un empleado con el ID proporcionado'
            });
        }

        // Actualizar el estado activo del empleado
        // Si se está marcando como inactivo, guardar la fecha actual en fecha_baja
        // Si se está marcando como activo, limpiar la fecha_baja
        let query, params;
        if (!activo) {
            // Marcando como inactivo - guardar fecha actual
            query = 'UPDATE empleados SET activo = $1, fecha_baja = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, nombre_completo, activo, fecha_baja';
            params = [activo, id];
        } else {
            // Marcando como activo - limpiar fecha_baja
            query = 'UPDATE empleados SET activo = $1, fecha_baja = NULL WHERE id = $2 RETURNING id, nombre_completo, activo, fecha_baja';
            params = [activo, id];
        }
        
        const result = await apoyosPool.query(query, params);
        const empleado = result.rows[0];
        let message = `Estado activo actualizado a ${activo ? 'activo' : 'inactivo'}`;
        
        if (!activo && empleado.fecha_baja) {
            message += ` - Fecha de baja: ${new Date(empleado.fecha_baja).toLocaleDateString('es-ES')}`;
        }
        
        res.json({
            success: true,
            message: message,
            empleado: empleado
        });

    } catch (error) {
        console.error('Error al actualizar estado activo del empleado:', error);
        res.status(500).json({ 
            error: 'Error al actualizar el estado activo del empleado',
            message: error.message 
        });
    }
});

// Ruta para obtener el historial de apoyos de un empleado
app.get('/api/empleados/:id/historial', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Primero verificar que el empleado existe
        const empleadoResult = await apoyosPool.query(
            'SELECT id FROM empleados WHERE id = $1',
            [id]
        );

        if (empleadoResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Empleado no encontrado',
                message: 'No existe un empleado con el ID proporcionado'
            });
        }

        // Obtener el historial de apoyos solo para el empleado específico
        const result = await apoyosPool.query(
            `SELECT 
                a.id,
                a.ultima_modificacion as fecha,
                a.ultima_modificacion,
                a.modificado_por,
                a.apoyo_sencillo as apoyo_sencillo,
                a.tipo,
                a.folio,
                a.vale_status as estado,
                a.descripcion,
                a.estatus_material,
                a.fecha_salida_herramienta,
                a.fecha_regreso_herramienta,
                a.tool_loan,
                a.notas,
                a.evidencia1,
                a.evidencia2,
                a.evidencia3,
                e.nombre_completo,
                e.supervisor,
                e.puesto
            FROM apoyos a
            INNER JOIN empleados e ON a.empleado_id = e.id
            WHERE a.empleado_id = $1 
            ORDER BY a.ultima_modificacion DESC`,
            [id]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener historial de apoyos:', error);
        res.status(500).json({ 
            error: 'Error al obtener el historial de apoyos',
            message: error.message 
        });
    }
});

// Historial simple por tipo (tabla historial_apoyos)
app.get('/api/empleados/:id/historial_apoyos', async (req, res) => {
    try {
        const { id } = req.params;
        const { tipo } = req.query;

        await apoyosPool.query(`
            CREATE TABLE IF NOT EXISTS historial_apoyos (
              id SERIAL PRIMARY KEY,
              tipo_apoyo TEXT NOT NULL,
              id_empleado INTEGER NOT NULL,
              fecha_entrega DATE NOT NULL,
              notas TEXT,
              CONSTRAINT fk_historial_empleado FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
            )
        `);

        const params = [id];
        let where = 'WHERE id_empleado = $1';
        if (tipo) {
            params.push(tipo);
            where += ` AND tipo_apoyo = $${params.length}`;
        }

        const result = await apoyosPool.query(
            `SELECT id, tipo_apoyo, id_empleado, fecha_entrega, notas
             FROM historial_apoyos
             ${where}
             ORDER BY fecha_entrega DESC`,
            params
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener historial_apoyos:', error);
        res.status(500).json({ message: 'Error al obtener historial_apoyos', error: error.message });
    }
});

// Ruta para obtener historial de puestos de un empleado
app.get('/api/empleados/:id/historial_puestos', async (req, res) => {
    try {
        const { id } = req.params;

        // Crear tabla si no existe
        await apoyosPool.query(`
            CREATE TABLE IF NOT EXISTS historial_puestos (
                id SERIAL PRIMARY KEY,
                empleado_id INTEGER NOT NULL,
                puesto_anterior VARCHAR(255) NOT NULL,
                puesto_nuevo VARCHAR(255) NOT NULL,
                fecha_cambio DATE NOT NULL,
                motivo_cambio TEXT,
                notas TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
            )
        `);

        const result = await apoyosPool.query(
            `SELECT id, empleado_id, puesto_anterior, puesto_nuevo, fecha_cambio, motivo_cambio, notas, created_at
             FROM historial_puestos
             WHERE empleado_id = $1
             ORDER BY fecha_cambio DESC`,
            [id]
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener historial_puestos:', error);
        res.status(500).json({ message: 'Error al obtener historial_puestos', error: error.message });
    }
});

// Ruta para agregar un registro al historial de puestos
app.post('/api/empleados/:id/historial_puestos', async (req, res) => {
    try {
        const { id } = req.params;
        const { puesto_anterior, puesto_nuevo, fecha_cambio, motivo_cambio, notas } = req.body || {};

        if (!puesto_anterior || !puesto_nuevo || !fecha_cambio) {
            return res.status(400).json({ message: 'puesto_anterior, puesto_nuevo y fecha_cambio son requeridos' });
        }

        // Crear tabla si no existe
        await apoyosPool.query(`
            CREATE TABLE IF NOT EXISTS historial_puestos (
                id SERIAL PRIMARY KEY,
                empleado_id INTEGER NOT NULL,
                puesto_anterior VARCHAR(255) NOT NULL,
                puesto_nuevo VARCHAR(255) NOT NULL,
                fecha_cambio DATE NOT NULL,
                motivo_cambio TEXT,
                notas TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
            )
        `);

        const insert = await apoyosPool.query(
            `INSERT INTO historial_puestos (empleado_id, puesto_anterior, puesto_nuevo, fecha_cambio, motivo_cambio, notas)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [id, puesto_anterior, puesto_nuevo, fecha_cambio, motivo_cambio || null, notas || null]
        );

        res.status(201).json(insert.rows[0]);
    } catch (error) {
        console.error('Error al agregar historial de puesto:', error);
        res.status(500).json({ message: 'Error al agregar historial de puesto', error: error.message });
    }
});

  // Ruta para obtener historial salarial de un empleado
  app.get('/api/empleados/:id/historial_salarios', async (req, res) => {
    try {
      const { id } = req.params;

      await apoyosPool.query(`
        CREATE TABLE IF NOT EXISTS historial_salario (
          id SERIAL PRIMARY KEY,
          id_empleado INTEGER NOT NULL,
          sueldo_actual VARCHAR(255),
          sueldo_propuesto VARCHAR(255),
          aumento VARCHAR(255),
          bono_extra VARCHAR(255),
          estatus_evaluacion VARCHAR(255),
          estatus_salario VARCHAR(255),
          fecha_aplicacion_nuevo_sueldo VARCHAR(255),
          tipo_evaluacion VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
        )
      `);

      const result = await apoyosPool.query(
        `SELECT id, id_empleado, sueldo_actual, sueldo_propuesto, aumento, bono_extra,
          estatus_evaluacion, estatus_salario, fecha_aplicacion_nuevo_sueldo, tipo_evaluacion
         FROM historial_salario
         WHERE id_empleado = $1
         ORDER BY id DESC`,
        [id]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error al obtener historial_salarios:', error);
      res.status(500).json({ message: 'Error al obtener historial_salarios', error: error.message });
    }
  });

  // Ruta para agregar un registro al historial salarial
  app.post('/api/empleados/:id/historial_salarios', async (req, res) => {
    try {
      const { id } = req.params;
      const {
        sueldo_actual,
        sueldo_propuesto,
        aumento,
        bono_extra,
        estatus_evaluacion,
        estatus_salario,
        fecha_aplicacion_nuevo_sueldo,
        tipo_evaluacion
      } = req.body || {};

      if (!sueldo_actual || !fecha_aplicacion_nuevo_sueldo) {
        return res.status(400).json({ message: 'sueldo_actual y fecha_aplicacion_nuevo_sueldo son requeridos' });
      }

      await apoyosPool.query(`
        CREATE TABLE IF NOT EXISTS historial_salario (
          id SERIAL PRIMARY KEY,
          id_empleado INTEGER NOT NULL,
          sueldo_actual VARCHAR(255),
          sueldo_propuesto VARCHAR(255),
          aumento VARCHAR(255),
          bono_extra VARCHAR(255),
          estatus_evaluacion VARCHAR(255),
          estatus_salario VARCHAR(255),
          fecha_aplicacion_nuevo_sueldo VARCHAR(255),
          tipo_evaluacion VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
        )
      `);

      const insert = await apoyosPool.query(
        `INSERT INTO historial_salario (
           id_empleado, sueldo_actual, sueldo_propuesto, aumento, bono_extra,
           estatus_evaluacion, estatus_salario, fecha_aplicacion_nuevo_sueldo, tipo_evaluacion
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          id,
          sueldo_actual,
          sueldo_propuesto || null,
          aumento || null,
          bono_extra || null,
          estatus_evaluacion || null,
          estatus_salario || null,
          fecha_aplicacion_nuevo_sueldo,
          tipo_evaluacion || null
        ]
      );

      res.status(201).json(insert.rows[0]);
    } catch (error) {
      console.error('Error al agregar historial salarial:', error);
      res.status(500).json({ message: 'Error al agregar historial salarial', error: error.message });
    }
  });

  // Ruta para editar un registro del historial salarial
  app.put('/api/empleados/:id/historial_salarios/:historialId', async (req, res) => {
    try {
      const { id, historialId } = req.params;
      const {
        sueldo_actual,
        sueldo_propuesto,
        aumento,
        bono_extra,
        estatus_evaluacion,
        estatus_salario,
        fecha_aplicacion_nuevo_sueldo,
        tipo_evaluacion
      } = req.body || {};

      if (!sueldo_actual || !fecha_aplicacion_nuevo_sueldo) {
        return res.status(400).json({ message: 'sueldo_actual y fecha_aplicacion_nuevo_sueldo son requeridos' });
      }

      await apoyosPool.query(`
        CREATE TABLE IF NOT EXISTS historial_salario (
          id SERIAL PRIMARY KEY,
          id_empleado INTEGER NOT NULL,
          sueldo_actual VARCHAR(255),
          sueldo_propuesto VARCHAR(255),
          aumento VARCHAR(255),
          bono_extra VARCHAR(255),
          estatus_evaluacion VARCHAR(255),
          estatus_salario VARCHAR(255),
          fecha_aplicacion_nuevo_sueldo VARCHAR(255),
          tipo_evaluacion VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
        )
      `);

      let update = await apoyosPool.query(
        `UPDATE historial_salario
         SET sueldo_actual = $1,
             sueldo_propuesto = $2,
             aumento = $3,
             bono_extra = $4,
             estatus_evaluacion = $5,
             estatus_salario = $6,
             fecha_aplicacion_nuevo_sueldo = $7,
             tipo_evaluacion = $8
         WHERE id = $9 AND id_empleado = $10
         RETURNING *`,
        [
          sueldo_actual,
          sueldo_propuesto || null,
          aumento || null,
          bono_extra || null,
          estatus_evaluacion || null,
          estatus_salario || null,
          fecha_aplicacion_nuevo_sueldo,
          tipo_evaluacion || null,
          historialId,
          id
        ]
      );

      if (update.rowCount === 0) {
        // Fallback para registros heredados donde el id_empleado pudo quedar inconsistente.
        const existeRegistro = await apoyosPool.query(
          'SELECT id FROM historial_salario WHERE id = $1',
          [historialId]
        );

        if (existeRegistro.rowCount === 0) {
          return res.status(404).json({ message: 'Registro salarial no encontrado' });
        }

        update = await apoyosPool.query(
          `UPDATE historial_salario
           SET sueldo_actual = $1,
               sueldo_propuesto = $2,
               aumento = $3,
               bono_extra = $4,
               estatus_evaluacion = $5,
               estatus_salario = $6,
               fecha_aplicacion_nuevo_sueldo = $7,
               tipo_evaluacion = $8
           WHERE id = $9
           RETURNING *`,
          [
            sueldo_actual,
            sueldo_propuesto || null,
            aumento || null,
            bono_extra || null,
            estatus_evaluacion || null,
            estatus_salario || null,
            fecha_aplicacion_nuevo_sueldo,
            tipo_evaluacion || null,
            historialId
          ]
        );
      }

      res.json(update.rows[0]);
    } catch (error) {
      console.error('Error al actualizar historial salarial:', error);
      res.status(500).json({ message: 'Error al actualizar historial salarial', error: error.message });
    }
  });

  // Ruta para obtener historial de accidentes de un empleado
  app.get('/api/empleados/:id/historial_accidentes', async (req, res) => {
    try {
      const { id } = req.params;

      await apoyosPool.query(`
        CREATE TABLE IF NOT EXISTS historial_accidentes (
          id SERIAL PRIMARY KEY,
          empleado_id INTEGER NOT NULL,
          fecha_accidente DATE NOT NULL,
          descripcion TEXT NOT NULL,
          dias_incapacidad INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
        )
      `);

      const result = await apoyosPool.query(
        `SELECT id, empleado_id, fecha_accidente, descripcion, dias_incapacidad, created_at
         FROM historial_accidentes
         WHERE empleado_id = $1
         ORDER BY fecha_accidente DESC, id DESC`,
        [id]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error al obtener historial_accidentes:', error);
      res.status(500).json({ message: 'Error al obtener historial_accidentes', error: error.message });
    }
  });

  // Ruta para agregar un registro al historial de accidentes
  app.post('/api/empleados/:id/historial_accidentes', async (req, res) => {
    try {
      const { id } = req.params;
      const { fecha_accidente, descripcion, dias_incapacidad } = req.body || {};

      if (!fecha_accidente || !descripcion) {
        return res.status(400).json({ message: 'fecha_accidente y descripcion son requeridos' });
      }

      await apoyosPool.query(`
        CREATE TABLE IF NOT EXISTS historial_accidentes (
          id SERIAL PRIMARY KEY,
          empleado_id INTEGER NOT NULL,
          fecha_accidente DATE NOT NULL,
          descripcion TEXT NOT NULL,
          dias_incapacidad INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
        )
      `);

      const insert = await apoyosPool.query(
        `INSERT INTO historial_accidentes (empleado_id, fecha_accidente, descripcion, dias_incapacidad)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, fecha_accidente, descripcion, dias_incapacidad ?? null]
      );

      res.status(201).json(insert.rows[0]);
    } catch (error) {
      console.error('Error al agregar historial_accidentes:', error);
      res.status(500).json({ message: 'Error al agregar historial_accidentes', error: error.message });
    }
  });

// Ruta para agregar un registro al historial de apoyos
app.post('/api/empleados/:id/historial', async (req, res) => {
    try {
        const { id } = req.params;
        const { tipo_apoyo, fecha_entrega, notas } = req.body || {};

        if (!tipo_apoyo || !fecha_entrega) {
            return res.status(400).json({ message: 'tipo_apoyo y fecha_entrega son requeridos' });
        }

        // Crear tabla si no existe
        await apoyosPool.query(`
            CREATE TABLE IF NOT EXISTS historial_apoyos (
              id SERIAL PRIMARY KEY,
              tipo_apoyo TEXT NOT NULL,
              id_empleado INTEGER NOT NULL,
              fecha_entrega DATE NOT NULL,
              notas TEXT,
              CONSTRAINT fk_historial_empleado FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
            )
        `);

        const insert = await apoyosPool.query(
            `INSERT INTO historial_apoyos (tipo_apoyo, id_empleado, fecha_entrega, notas)
             VALUES ($1, $2, $3, $4)
             RETURNING id, tipo_apoyo, id_empleado, fecha_entrega, notas`,
            [tipo_apoyo, id, fecha_entrega, notas || null]
        );

        res.status(201).json(insert.rows[0]);
    } catch (error) {
        console.error('Error al agregar historial de apoyo:', error);
        res.status(500).json({ message: 'Error al agregar historial de apoyo', error: error.message });
    }
});

// Ruta para obtener los apoyos pendientes de un empleado
app.get('/api/empleados/:id/apoyos-pendientes', async (req, res) => {
    try {
        const { id } = req.params;

        // Primero verificar que el empleado existe
        const empleadoResult = await apoyosPool.query(
            'SELECT id FROM empleados WHERE id = $1',
            [id]
        );

        if (empleadoResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Empleado no encontrado',
                message: 'No existe un empleado con el ID proporcionado'
            });
        }

        const result = await apoyosPool.query(
            `SELECT 
                a.id,
                a.ultima_modificacion as fecha,
                a.apoyo_sencillo as tipo,
                a.folio,
                a.vale_status as estado,
                a.fecha_salida_herramienta as material_out_date,
                a.fecha_regreso_herramienta as material_return_date,
                a.notas,
                e.nombre_completo,
                e.supervisor,
                e.puesto
            FROM apoyos a
            INNER JOIN empleados e ON a.empleado_id = e.id
            WHERE a.empleado_id = $1 
            AND a.vale_status = 'pendiente'
            ORDER BY a.ultima_modificacion DESC`,
            [id]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener apoyos pendientes:', error);
        res.status(500).json({ 
            error: 'Error al obtener los apoyos pendientes',
            message: error.message 
        });
    }
});

// NUEVA RUTA: Actualizar empleado con todos los campos adicionales
app.put('/api/empleados/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nombre_completo,
            puesto,
            area,
            departamento,
            supervisor,
            fecha_ingreso,
            activo,
            es_supervisor,
            // Campos adicionales que coinciden con tu tabla
            fecha_cumpleanos,
            email,
            telefono,
            direccion,
            tipo_sangre,
            alergias_enfermedades,
            hijos,
            telefono_emergencia,
            talla_ropa,
            talla_botas,
            recontratable,
            motivo_no_contratacion,
            salario_mxn,
            fecha_baja,
            escolaridad,
            comportamiento
        } = req.body;

        // Verificar que el empleado existe
        const empleadoExistente = await apoyosPool.query(
            'SELECT id FROM empleados WHERE id = $1',
            [id]
        );

        if (empleadoExistente.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Empleado no encontrado',
                message: 'No existe un empleado con el ID proporcionado'
            });
        }

        // Construir la consulta de actualización dinámicamente
        let updateFields = [];
        let values = [];
        let paramIndex = 1;

        // Campos básicos
        if (nombre_completo !== undefined) {
            updateFields.push(`nombre_completo = $${paramIndex++}`);
            values.push(nombre_completo);
        }
        if (puesto !== undefined) {
            updateFields.push(`puesto = $${paramIndex++}`);
            values.push(puesto);
        }
        if (area !== undefined) {
            updateFields.push(`area = $${paramIndex++}`);
            values.push(area || null);
        }
        if (departamento !== undefined) {
            updateFields.push(`departamento = $${paramIndex++}`);
            values.push(departamento || null);
        }
        if (supervisor !== undefined) {
            updateFields.push(`supervisor = $${paramIndex++}`);
            values.push(supervisor);
        }
        if (fecha_ingreso !== undefined) {
            updateFields.push(`fecha_ingreso = $${paramIndex++}`);
            values.push(fecha_ingreso || null);
        }
        if (activo !== undefined) {
            updateFields.push(`activo = $${paramIndex++}`);
            values.push(activo);
        }
        if (es_supervisor !== undefined) {
            updateFields.push(`es_supervisor = $${paramIndex++}`);
            values.push(es_supervisor);
        }

        // Campos adicionales
        if (fecha_cumpleanos !== undefined) {
            updateFields.push(`fecha_cumpleanos = $${paramIndex++}`);
            values.push(fecha_cumpleanos || null);
        }
        if (email !== undefined) {
            updateFields.push(`email = $${paramIndex++}`);
            values.push(email || null);
        }
        if (telefono !== undefined) {
            updateFields.push(`telefono = $${paramIndex++}`);
            values.push(telefono || null);
        }
        if (direccion !== undefined) {
            updateFields.push(`direccion = $${paramIndex++}`);
            values.push(direccion || null);
        }
        if (tipo_sangre !== undefined) {
            updateFields.push(`tipo_sangre = $${paramIndex++}`);
            values.push(tipo_sangre || null);
        }
        if (alergias_enfermedades !== undefined) {
          updateFields.push(`alergias_enfermedades = $${paramIndex++}`);
          values.push(alergias_enfermedades || null);
        }
        if (hijos !== undefined) {
            updateFields.push(`hijos = $${paramIndex++}`);
            values.push(hijos !== '' && hijos !== null ? parseInt(hijos) : null);
        }
        if (telefono_emergencia !== undefined) {
            updateFields.push(`telefono_emergencia = $${paramIndex++}`);
            values.push(telefono_emergencia || null);
        }
        if (talla_ropa !== undefined) {
            updateFields.push(`talla_ropa = $${paramIndex++}`);
            values.push(talla_ropa || null);
        }
        if (talla_botas !== undefined) {
            updateFields.push(`talla_botas = $${paramIndex++}`);
            values.push(talla_botas || null);
        }
        // Fecha de baja
        if (fecha_baja !== undefined) {
            updateFields.push(`fecha_baja = $${paramIndex++}`);
            values.push(fecha_baja || null);
        }
        if (salario_mxn !== undefined) {
            updateFields.push(`salario_mxn = $${paramIndex++}`);
            values.push(salario_mxn !== '' && salario_mxn !== null ? salario_mxn : null);
        }
        // Escolaridad
        if (escolaridad !== undefined) {
          updateFields.push(`escolaridad = $${paramIndex++}`);
          values.push(escolaridad || null);
        }
        // Comportamiento
        if (comportamiento !== undefined) {
          updateFields.push(`comportamiento = $${paramIndex++}`);
          values.push(comportamiento || null);
        }
        // Nuevos campos: recontratable y motivo
        if (recontratable !== undefined) {
          updateFields.push(`recontratable = $${paramIndex++}`);
          values.push(recontratable);
        }
        if (motivo_no_contratacion !== undefined) {
          updateFields.push(`motivo_no_contratacion = $${paramIndex++}`);
          values.push(motivo_no_contratacion || null);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ 
                error: 'No hay campos para actualizar',
                message: 'Se debe proporcionar al menos un campo para actualizar'
            });
        }

        // Agregar el ID al final de los valores
        values.push(id);

        // Construir y ejecutar la consulta
        const query = `
            UPDATE empleados 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const result = await apoyosPool.query(query, values);

        if (result.rows.length === 0) {
            console.error('Error: No se pudo actualizar el empleado');
            return res.status(500).json({ 
                error: 'Error en la actualización',
                message: 'No se pudo actualizar el empleado'
            });
        }

        const empleadoActualizado = result.rows[0];
        res.json({
            success: true,
            message: 'Empleado actualizado exitosamente',
            empleado: empleadoActualizado
        });

    } catch (error) {
        console.error('=== ERROR AL ACTUALIZAR EMPLEADO ===');
        console.error('Error completo:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error al actualizar el empleado',
            message: error.message,
            details: error.detail || error.hint || 'No hay detalles adicionales'
        });
    }
});

// NUEVA RUTA: Para crear/actualizar apoyos (separada de la actualización de empleados)
app.put('/api/empleados/:id/apoyo', async (req, res) => {
    const { id } = req.params;
    const {
        nombre_completo,
        supervisor,
        puesto,
        foto_url,
        folio,
        vale_status,
        descripcion,
        material_status,
        fecha_salida_herramienta,
        fecha_regreso_herramienta,
        tool_loan,
        notas
    } = req.body;
    try {
        // Iniciar una transacción
        await apoyosPool.query('BEGIN');

        // Actualizar la información del empleado
        const empleadoResult = await apoyosPool.query(
            `UPDATE empleados 
            SET nombre_completo = $1,
                supervisor = $2,
                puesto = $3,
                foto_url = $4
            WHERE id = $5
            RETURNING *`,
            [
                nombre_completo,
                supervisor,
                puesto,
                foto_url,
                id
            ]
        );

        if (empleadoResult.rows.length === 0) {
            await apoyosPool.query('ROLLBACK');
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }

        // Generar un nuevo folio si no se proporciona uno
        const folioGenerado = folio || `FOL-${Date.now()}`;

        // Determinar si el apoyo es sencillo o único
        let apoyoSencillo = true; // Por defecto sencillo
        if (req.body.apoyo_sencillo !== undefined) {
            apoyoSencillo = !!req.body.apoyo_sencillo;
        } else if (req.body.apoyo_sencillo) {
            apoyoSencillo = req.body.apoyo_sencillo === 'simple';
        } else if (folio && folio.toLowerCase().includes('unico')) {
            apoyoSencillo = false;
        }

        // Crear un nuevo apoyo
        const nuevoApoyoResult = await apoyosPool.query(
            `INSERT INTO apoyos (
                empleado_id,
                folio,
                apoyo_sencillo,
                descripcion,
                vale_status,
                fecha_salida_herramienta,
                fecha_regreso_herramienta,
                tool_loan,
                notas,
                ultima_modificacion,
                modificado_por
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10)
            RETURNING *`,
            [
                id,
                folioGenerado,
                apoyoSencillo,
                descripcion || null,
                vale_status || 'pendiente',
                fecha_salida_herramienta || null,
                fecha_regreso_herramienta || null,
                tool_loan || null,
                notas || null,
                nombre_completo
            ]
        );

        // Confirmar la transacción
        await apoyosPool.query('COMMIT');

        // Devolver tanto la información del empleado como la del nuevo apoyo
        const response = {
            empleado: empleadoResult.rows[0],
            apoyo: nuevoApoyoResult.rows[0]
        };
        res.json(response);
    } catch (error) {
        // Revertir la transacción en caso de error
        await apoyosPool.query('ROLLBACK');
        console.error('Error al actualizar empleado y crear nuevo apoyo:', error);
        res.status(500).json({ error: 'Error al actualizar el empleado y crear nuevo apoyo' });
    }
});

// Ruta para actualizar campos individuales de un empleado (sin modificar ultima_modificacion)
app.patch('/api/empleados/:id', async (req, res) => {
    const { id } = req.params;
    const campos = ['nombre_completo', 'supervisor', 'puesto', 'fecha_ingreso'];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const campo of campos) {
        if (req.body[campo] !== undefined) {
            updates.push(`${campo} = $${idx}`);
            values.push(req.body[campo]);
            idx++;
        }
    }
    if (updates.length === 0) {
        return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
    }
    values.push(id);
    const query = `UPDATE empleados SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    try {
        const result = await apoyosPool.query(query, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar empleado (PATCH):', error);
        res.status(500).json({ error: 'Error al actualizar el empleado' });
    }
});

// Rutas para phoenix_tickets
app.get('/api/tickets', async (req, res) => {
    try {
        // Primero obtener los tickets sin el JOIN
        const result = await phoenixPool.query(`
            SELECT * FROM tickets ORDER BY timestamp DESC
        `);
        
        // Si hay tickets con usuarios asignados, obtener la información de usuarios
        const ticketsWithAssignments = result.rows.filter(ticket => ticket.assigned_user_id);
        
        if (ticketsWithAssignments.length > 0) {
            try {
                // Obtener información de usuarios asignados
                const userIds = ticketsWithAssignments.map(ticket => ticket.assigned_user_id);
                const userResult = await apoyosPool.query(
                    'SELECT id, nombre_completo FROM usuarios WHERE id = ANY($1) AND activo = true',
                    [userIds]
                );
                
                // Crear un mapa de usuarios
                const userMap = {};
                userResult.rows.forEach(user => {
                    userMap[user.id] = user.nombre_completo;
                });
                
                // Agregar la información de usuario asignado a los tickets
                result.rows.forEach(ticket => {
                    if (ticket.assigned_user_id && userMap[ticket.assigned_user_id]) {
                        ticket.assigned_user_name = userMap[ticket.assigned_user_id];
                    }
                });
            } catch (userError) {
                console.error('Error al obtener información de usuarios asignados:', userError);
                // Continuar sin la información de usuarios asignados
            }
        }
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener tickets:', error);
        res.status(500).json({ error: 'Error al obtener los tickets' });
    }
});

let lastTicketUpdateCache = 0;
let lastTicketUpdateFetchedAt = 0;

async function getLastTicketUpdate() {
  const now = Date.now();
  if (now - lastTicketUpdateFetchedAt < 5000) return lastTicketUpdateCache;
  const { rows } = await phoenixPool.query(`
    SELECT MAX(EXTRACT(EPOCH FROM timestamp)) AS last_update FROM tickets
  `);
  lastTicketUpdateCache = Number(rows[0]?.last_update || 0);
  lastTicketUpdateFetchedAt = now;
  return lastTicketUpdateCache;
}

app.get('/api/tickets/check-updates', async (req, res) => {
  const since = Number(req.query.since || 0);
  const last = await getLastTicketUpdate();
  res.json({ hasUpdates: last > since, lastUpdate: last });
});

app.patch('/api/tickets/:id/urgency', async (req, res) => {
    try {
        const { id } = req.params;
        const { urgency } = req.body;
        
        let query, params;
        
        // Si el ticket se está marcando como completado, guardar la urgencia anterior y agregar time_end
        if (urgency === 'completed') {
            // Primero obtener la urgencia actual antes de cambiarla
            const currentTicket = await phoenixPool.query(
                'SELECT urgency FROM tickets WHERE id = $1',
                [id]
            );
            
            if (currentTicket.rows.length === 0) {
                return res.status(404).json({ error: 'Ticket no encontrado' });
            }
            
            const currentUrgency = currentTicket.rows[0].urgency;
            
            // Actualizar con la urgencia anterior (last_urgency) y time_end
            query = 'UPDATE tickets SET urgency = $1, last_urgency = $2, time_end = NOW() WHERE id = $3 RETURNING *';
            params = [urgency, currentUrgency, id];
        } else {
            // Para otros estados, solo actualizar urgency
            query = 'UPDATE tickets SET urgency = $1 WHERE id = $2 RETURNING *';
            params = [urgency, id];
        }
        
        const result = await phoenixPool.query(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar urgencia:', error);
        res.status(500).json({ error: 'Error al actualizar la urgencia' });
    }
});

app.delete('/api/tickets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await phoenixPool.query('DELETE FROM tickets WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        res.json({ message: 'Ticket eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar ticket:', error);
        res.status(500).json({ error: 'Error al eliminar el ticket' });
    }
});

// Obtener todos los usuarios de mantenimiento desde apoyos_db
app.get('/api/mantenimiento/usuarios', async (req, res) => {
  try {
    const result = await apoyosPool.query(
      "SELECT id, username, nombre_completo AS nombre FROM usuarios WHERE rol ILIKE 'mantenimiento' ORDER BY nombre_completo ASC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios de mantenimiento:', error);
    res.status(500).json({ error: 'Error al obtener los usuarios de mantenimiento' });
  }
});

// Rutas principales
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/login.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/selector.html'));
});

app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/panel.html'));
});

app.get('/apoyos', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/apoyos.html'));
});

app.get('/design', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/design.html'));
});

app.get('/mantenimiento', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/mantenimiento.html'));
});

app.get('/formulario-mantenimiento', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/index_mantenimiento.html'));
});

app.get('/vacaciones', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/vacaciones.html'));
});

// Ruta para actualizar un apoyo
app.post('/update-apoyo', async (req, res) => {
    try {
        const { empleado_id, datos, username } = req.body;
        
        if (!empleado_id || !datos || !username) {
            console.error('Datos incompletos:', { empleado_id, datos, username });
            return res.status(400).json({ 
                error: 'Datos incompletos',
                message: 'Se requieren empleado_id, datos y username'
            });
        }

        // Obtener el ID y todos los datos del último apoyo del empleado
        const apoyoResult = await apoyosPool.query(
            'SELECT * FROM apoyos WHERE empleado_id = $1 ORDER BY ultima_modificacion DESC LIMIT 1',
            [empleado_id]
        );

        if (apoyoResult.rows.length === 0) {
            console.error('No se encontró apoyo para el empleado:', empleado_id);
            return res.status(404).json({ 
                error: 'No se encontró apoyo',
                message: 'No se encontró ningún apoyo para este empleado'
            });
        }

        const apoyoActual = apoyoResult.rows[0];
        // Eliminar la fila existente
        await apoyosPool.query('DELETE FROM apoyos WHERE id = $1', [apoyoActual.id]);

        // Insertar la nueva fila con los datos actualizados
        const insertQuery = `
            INSERT INTO apoyos (
                id, empleado_id, folio, apoyo_sencillo, descripcion, vale_status,
                fecha_salida_herramienta, fecha_regreso_herramienta, notas, ultima_modificacion, modificado_por
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10)
            RETURNING *
        `;

        const values = [
            apoyoActual.id,
            apoyoActual.empleado_id,
            apoyoActual.folio,
            apoyoActual.apoyo_sencillo,
            datos.descripcion || apoyoActual.descripcion,
            datos.vale_status || apoyoActual.vale_status,
            datos.fecha_salida_herramienta || apoyoActual.fecha_salida_herramienta,
            datos.fecha_regreso_herramienta || apoyoActual.fecha_regreso_herramienta,
            datos.notas || apoyoActual.notas,
            username
        ];

        const result = await apoyosPool.query(insertQuery, values);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar apoyo:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error al actualizar el apoyo',
            message: error.message
        });
    }
});

// Ruta para consulta directa a la base de datos de empleados
app.post('/query-empleado', async (req, res) => {
    const { id } = req.body;
    try {
        const result = await apoyosPool.query(
            `SELECT e.nombre, e.puesto, s.nombre AS supervisor
             FROM empleados e
             LEFT JOIN empleados s ON e.supervisor = s.id
             WHERE e.id = $1`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al consultar empleado:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// Ruta para ver todos los empleados (activos e inactivos)
app.get('/api/empleados', async (req, res) => {
    try {
        const { nombre } = req.query;
        
        // Si se proporciona el parámetro nombre, buscar por nombre_completo
        if (nombre) {
            const result = await apoyosPool.query(
              'SELECT id, nombre_completo, supervisor, puesto, fecha_ingreso, fecha_cumpleanos, telefono_emergencia, foto_url, activo, area, departamento, COALESCE(es_supervisor, false) as es_supervisor, email FROM empleados WHERE nombre_completo = $1',
                [nombre]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Empleado no encontrado' });
            }
            
            return res.json(result.rows[0]);
        }
        
        // Si no se proporciona nombre, devolver todos los empleados
        const result = await apoyosPool.query(
            'SELECT *, COALESCE(es_supervisor, false) as es_supervisor, fecha_cumpleanos FROM empleados ORDER BY nombre_completo'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener empleados:', error);
        res.status(500).json({ 
            error: 'Error al consultar los empleados',
            message: error.message
        });
    }
});

// Nueva ruta para obtener todos los empleados (incluyendo inactivos) - solo para administración
app.get('/api/empleados/todos', async (req, res) => {
    try {
        const result = await apoyosPool.query('SELECT *, fecha_cumpleanos FROM empleados ORDER BY nombre_completo');
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener todos los empleados:', error);
        res.status(500).json({ 
            error: 'Error al consultar todos los empleados',
            message: error.message
        });
    }
});

// Ruta para obtener empleados por supervisor
app.get('/api/empleados/por-supervisor/:supervisorId', async (req, res) => {
    try {
        const { supervisorId } = req.params;
        
        // Decodificar el nombre del supervisor (puede venir con espacios codificados)
        const supervisorNombre = decodeURIComponent(supervisorId).trim();
        
        // Log para debugging
        console.log(`🔍 Buscando empleados con supervisor: "${supervisorNombre}"`);
        
        // Normalizar el nombre buscado: dividir en palabras, convertir a minúsculas
        const palabrasBuscadas = supervisorNombre
            .toLowerCase()
            .split(/\s+/)
            .filter(p => p.length > 0);
        
        // Obtener todos los empleados que tienen al supervisor especificado
        // Comparación flexible: no importa el orden de nombres/apellidos, solo que coincidan todas las palabras
        const result = await apoyosPool.query(
            `SELECT id, nombre_completo, supervisor, puesto, fecha_ingreso, foto_url, activo 
             FROM empleados 
             WHERE (activo = true OR activo IS NULL)
               AND (
                 -- Comparación exacta (case-insensitive, sin espacios)
                 TRIM(supervisor) ILIKE TRIM($1)
                 OR
                 -- Comparación flexible: todas las palabras del nombre buscado deben estar en el supervisor
                 -- Verificar que cada palabra buscada esté presente en el supervisor de la BD
                 (
                   SELECT COUNT(*) = $2::int
                   FROM unnest($3::text[]) AS palabra_buscada
                   WHERE EXISTS (
                     SELECT 1
                     FROM unnest(string_to_array(LOWER(TRIM(supervisor)), ' ')) AS palabra_bd
                     WHERE palabra_bd = palabra_buscada
                   )
                 )
               )
             ORDER BY nombre_completo`,
            [supervisorNombre, palabrasBuscadas.length, palabrasBuscadas]
        );
        
        console.log(`✅ Encontrados ${result.rows.length} empleados para supervisor "${supervisorNombre}"`);
        if (result.rows.length > 0) {
            console.log(`   Empleados encontrados:`, result.rows.map(e => `${e.nombre_completo} (supervisor en BD: "${e.supervisor}")`));
        }
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener empleados por supervisor:', error);
        res.status(500).json({ 
            error: 'Error al consultar empleados por supervisor',
            message: error.message 
        });
    }
});

// Función para asegurar que la tabla empleados permita IDs manuales
async function ensureEmpleadosIdManual() {
  try {
    // Verificar si ya existe la secuencia personalizada
    const checkSeq = await apoyosPool.query(
      "SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'empleados_id_seq_new'"
    );
    
    if (checkSeq.rows.length === 0) {
      // Crear nueva secuencia que comience con un número alto
      await apoyosPool.query('CREATE SEQUENCE empleados_id_seq_new START 10000');
      
      // Modificar la tabla para usar la nueva secuencia
      await apoyosPool.query('ALTER TABLE empleados ALTER COLUMN id SET DEFAULT nextval(\'empleados_id_seq_new\')');
      
      // Actualizar la secuencia para que comience después del ID más alto existente
      const maxIdResult = await apoyosPool.query('SELECT MAX(id) FROM empleados');
      const maxId = maxIdResult.rows[0].max || 0;
      await apoyosPool.query(`SELECT setval('empleados_id_seq_new', ${maxId + 1})`);
      
      console.log('Tabla empleados configurada para permitir IDs manuales');
    }
  } catch (error) {
    console.error('Error configurando tabla empleados:', error);
  }
}

// Ruta para crear un nuevo empleado
app.post('/api/empleados', upload.single('foto'), async (req, res) => {
    try {
        const {
          id,
          nombre_completo,
          supervisor,
          puesto,
          area,
          departamento,
          fecha_ingreso,
          activo,
          es_supervisor,
          fecha_cumpleanos,
          email,
          telefono,
          direccion,
          tipo_sangre,
          alergias_enfermedades,
          hijos,
          telefono_emergencia,
          talla_ropa,
          talla_botas,
          fecha_baja,
          salario_mxn,
          escolaridad,
          comportamiento
        } = req.body;

        // Validar campos requeridos
        if (!id || !nombre_completo || !puesto) {
            return res.status(400).json({ 
                error: 'Faltan campos obligatorios',
                message: 'Se requieren ID, nombre completo y puesto'
            });
        }

        // Verificar si el empleado ya existe
        const empleadoExistente = await apoyosPool.query(
            'SELECT id FROM empleados WHERE id = $1',
            [id]
        );

        if (empleadoExistente.rows.length > 0) {
            return res.status(400).json({ 
                error: 'El empleado ya existe',
                message: 'Ya existe un empleado con ese ID'
            });
        }

        // Procesar la foto si se proporcionó una
        let fotoUrl = null;
        if (req.file) {
            fotoUrl = `/uploads/${req.file.filename}`;
        }

        const result = await apoyosPool.query(
          `INSERT INTO empleados (
            id, nombre_completo, supervisor, puesto, area, departamento, 
            fecha_ingreso, activo, es_supervisor, foto_url, fecha_cumpleanos,
            email, telefono, direccion, alergias_enfermedades, hijos, telefono_emergencia,
            talla_ropa, talla_botas, fecha_baja, salario_mxn, escolaridad, comportamiento
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
          RETURNING *`,
          [
            id, nombre_completo, supervisor || 'Sin supervisor', puesto, area || null, departamento || null,
            fecha_ingreso || null, activo !== undefined ? activo : true, es_supervisor !== undefined ? es_supervisor : false, fotoUrl, fecha_cumpleanos || null,
            email || null, telefono || null, direccion || null, alergias_enfermedades || null, hijos ? parseInt(hijos) : null, telefono_emergencia || null,
            talla_ropa || null, talla_botas || null, fecha_baja || null, salario_mxn !== undefined && salario_mxn !== '' ? salario_mxn : null,
            escolaridad || null, comportamiento || null
          ]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error detallado al crear empleado:', error);
        res.status(500).json({ 
            error: 'Error al crear el empleado',
            message: error.message
        });
    }
});

// Ruta para obtener empleados que son supervisores (tienen empleados a cargo)
app.get('/api/empleados/supervisores', async (req, res) => {
    try {
        const testResult = await apoyosPool.query('SELECT COUNT(*) FROM empleados');  
        // Obtener supervisores únicos usando SQL
        const result = await apoyosPool.query(
            `SELECT supervisor, COUNT(*) as empleados_a_cargo
             FROM empleados 
             WHERE supervisor IS NOT NULL AND supervisor != '-'
             GROUP BY supervisor
             ORDER BY supervisor`
        );
        // Formatear la respuesta
        const supervisores = result.rows.map(row => ({
            id: row.supervisor, // Usar el nombre como ID
            nombre_completo: row.supervisor,
            puesto: 'Supervisor',
            empleados_a_cargo: parseInt(row.empleados_a_cargo)
        }));
        
        res.json(supervisores);
        
    } catch (error) {
        console.error('Error detallado al obtener supervisores:', error);
        res.status(500).json({ 
            error: 'Error al consultar supervisores',
            message: error.message,
            stack: error.stack
        });
    }
});

// ==================== ENDPOINTS PARA PROYECTOS PM ====================

// GET - Obtener todos los proyectos
app.get('/api/proyectos', async (req, res) => {
    try {
        const result = await apoyosPool.query(`
            SELECT 
                id,
                client,
                order_number,
                customer_job,
                project_name,
                status,
                time_worked,
                price_usd,
                price_mxn,
                created_at,
                updated_at
            FROM proyectos
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener proyectos:', error);
        res.status(500).json({ error: 'Error al obtener proyectos', message: error.message });
    }
});

// GET - Obtener un proyecto por ID
app.get('/api/proyectos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await apoyosPool.query(
            'SELECT * FROM proyectos WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener proyecto:', error);
        res.status(500).json({ error: 'Error al obtener proyecto', message: error.message });
    }
});

// POST - Crear nuevo proyecto
app.post('/api/proyectos', async (req, res) => {
    try {
        const {
            client,
            order_number,
            customer_job,
            project_name,
            status,
            time_worked,
            price_usd,
            price_mxn
        } = req.body;

        // Validaciones
        if (!client || !project_name) {
            return res.status(400).json({ error: 'Client y project_name son requeridos' });
        }

        // Generar order_number automático si no se proporciona
        const finalOrderNumber = order_number || `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        const result = await apoyosPool.query(`
            INSERT INTO proyectos (
                client,
                order_number,
                customer_job,
                project_name,
                status,
                time_worked,
                price_usd,
                price_mxn
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            client,
            finalOrderNumber,
            customer_job || null,
            project_name,
            status || 'activo',
            time_worked || 0,
            price_usd || 0,
            price_mxn || 0
        ]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear proyecto:', error);
        if (error.code === '23505') { // Unique constraint violation
            return res.status(400).json({ error: 'El número de orden ya existe' });
        }
        res.status(500).json({ error: 'Error al crear proyecto', message: error.message });
    }
});

// PUT - Actualizar proyecto
app.put('/api/proyectos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            client,
            order_number,
            customer_job,
            project_name,
            status,
            time_worked,
            price_usd,
            price_mxn
        } = req.body;

        const result = await apoyosPool.query(`
            UPDATE proyectos
            SET 
                client = COALESCE($1, client),
                order_number = COALESCE($2, order_number),
                customer_job = COALESCE($3, customer_job),
                project_name = COALESCE($4, project_name),
                status = COALESCE($5, status),
                time_worked = COALESCE($6, time_worked),
                price_usd = COALESCE($7, price_usd),
                price_mxn = COALESCE($8, price_mxn),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
            RETURNING *
        `, [client, order_number, customer_job, project_name, status, time_worked, price_usd, price_mxn, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Proyecto no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar proyecto:', error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'El número de orden ya existe' });
        }
        res.status(500).json({ error: 'Error al actualizar proyecto', message: error.message });
    }
});

// GET - Obtener todos los clientes
app.get('/api/clientes', async (req, res) => {
    try {
        // Asegurar que la tabla existe
        await apoyosPool.query(`
            CREATE TABLE IF NOT EXISTS clientes (
                id SERIAL PRIMARY KEY,
                nomenclatura VARCHAR(50) UNIQUE NOT NULL,
                nombre_completo VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const result = await apoyosPool.query(`
            SELECT nomenclatura, nombre_completo 
            FROM clientes 
            ORDER BY nomenclatura
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes', message: error.message });
    }
});

// POST - Crear nuevo cliente
app.post('/api/clientes', async (req, res) => {
    try {
        const { nomenclatura, nombre_completo } = req.body;

        // Validaciones
        if (!nomenclatura || !nombre_completo) {
            return res.status(400).json({ error: 'Nomenclatura y nombre_completo son requeridos' });
        }

        // Asegurar que la tabla existe
        await apoyosPool.query(`
            CREATE TABLE IF NOT EXISTS clientes (
                id SERIAL PRIMARY KEY,
                nomenclatura VARCHAR(50) UNIQUE NOT NULL,
                nombre_completo VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const result = await apoyosPool.query(`
            INSERT INTO clientes (nomenclatura, nombre_completo)
            VALUES ($1, $2)
            RETURNING nomenclatura, nombre_completo
        `, [nomenclatura.toUpperCase().trim(), nombre_completo.trim()]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear cliente:', error);
        if (error.code === '23505') { // Unique constraint violation
            return res.status(400).json({ error: 'Ya existe un cliente con esa nomenclatura' });
        }
        res.status(500).json({ error: 'Error al crear cliente', message: error.message });
    }
});

// DELETE - Eliminar proyecto
app.delete('/api/proyectos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await apoyosPool.query(
            'DELETE FROM proyectos WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Proyecto no encontrado' });
        }

        res.json({ message: 'Proyecto eliminado exitosamente', proyecto: result.rows[0] });
    } catch (error) {
        console.error('Error al eliminar proyecto:', error);
        res.status(500).json({ error: 'Error al eliminar proyecto', message: error.message });
    }
});

// ==================== FIN ENDPOINTS PARA PROYECTOS PM ====================

// ==================== ENDPOINTS PARA ÓRDENES PM ====================

// GET - Obtener todas las órdenes
app.get('/api/ordenes', async (req, res) => {
  try {
    await ensureOrdenesTable();
    const { project_id, include_hidden } = req.query;
    const includeHidden = ['1', 'true', 'yes', 'si'].includes(String(include_hidden || '').toLowerCase());
    logger.info('Obteniendo órdenes...', { project_id, include_hidden: includeHidden });
    
    let query = `SELECT o.id, o.project_id, o.order_number, o.client, o.customer_job, 
        o.project_name, o.status, o.estatus, o.time_worked, o.price_usd, o.price_mxn,
        o.tiempo_aprobado,
          o.usuario_asignado,
          CASE WHEN o.fecha_inicio IS NULL THEN NULL ELSE to_char(o.fecha_inicio, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_inicio,
          CASE WHEN o.fecha_limite IS NULL THEN NULL ELSE to_char(o.fecha_limite, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_limite,
          o.fecha_fin, o.fecha_aprobacion, o.visible, o.insert_forzado, o.po_creada, o.created_at, o.updated_at, p.project_name as proyecto_nombre
       FROM ordenes o
        LEFT JOIN proyectos p ON o.project_id = p.id
        WHERE 1=1`;

    let params = [];

    if (!includeHidden) {
      query += ` AND COALESCE(o.visible, FALSE) = FALSE`;
    }

    if (project_id) {
      params.push(project_id);
      query += ` AND o.project_id = $${params.length}`;
    }
    
    query += ` ORDER BY o.created_at DESC`;
    
    const result = await apoyosPool.query(query, params);
    
    logger.info('Órdenes obtenidas:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error al obtener órdenes:', error);
    res.status(500).json({ error: 'Error al obtener órdenes' });
  }
});

// GET - Obtener una orden por ID
app.get('/api/ordenes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await apoyosPool.query(
      `SELECT o.id, o.project_id, o.order_number, o.client, o.customer_job, 
              o.project_name, o.status, o.estatus, o.time_worked, o.price_usd, o.price_mxn,
              o.tiempo_aprobado,
              o.usuario_asignado,
              CASE WHEN o.fecha_inicio IS NULL THEN NULL ELSE to_char(o.fecha_inicio, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_inicio,
              CASE WHEN o.fecha_limite IS NULL THEN NULL ELSE to_char(o.fecha_limite, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_limite,
              o.fecha_fin, o.fecha_aprobacion, o.insert_forzado, o.po_creada, o.created_at, o.updated_at, p.project_name as proyecto_nombre
       FROM ordenes o
       LEFT JOIN proyectos p ON o.project_id = p.id
       WHERE o.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al obtener orden:', error);
    res.status(500).json({ error: 'Error al obtener orden' });
  }
});

// POST - Crear una nueva orden
app.post('/api/ordenes', async (req, res) => {
  try {
    const { project_id, order_number, order_name } = req.body;
    
    if (!project_id || !order_number || !order_name) {
      return res.status(400).json({ error: 'Faltan datos requeridos: project_id, order_number y order_name son obligatorios' });
    }

    logger.info('Creando nueva orden:', { project_id, order_number, order_name });
    
    // Verificar que el proyecto existe
    const projectResult = await apoyosPool.query(
      'SELECT * FROM proyectos WHERE id = $1',
      [project_id]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    const project = projectResult.rows[0];

    // Verificar si el número de orden ya existe
    const existingOrder = await apoyosPool.query(
      'SELECT id, order_number FROM ordenes WHERE order_number = $1',
      [order_number]
    );

    if (existingOrder.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Ya existe una orden con este número',
        message: `El número de orden "${order_number}" ya está registrado. Por favor verifique y use un número diferente.`
      });
    }

    // Crear la orden en la tabla ordenes
    // Usamos order_name para el project_name de la orden (nombre específico de la orden)
    const insertResult = await apoyosPool.query(
      `INSERT INTO ordenes (project_id, order_number, client, customer_job, project_name, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, order_number, project_name, client, status`,
      [project_id, order_number, project.client, project.customer_job, order_name.trim(), 'activo']
    );

    logger.info('Orden creada exitosamente');
    res.status(201).json({ 
      success: true, 
      message: 'Orden creada correctamente',
      order: insertResult.rows[0] 
    });
  } catch (error) {
    logger.error('Error al crear orden:', error);
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'El número de orden ya existe' });
    }
    res.status(500).json({ error: 'Error al crear la orden', message: error.message });
  }
});

// PUT - Actualizar una orden
app.put('/api/ordenes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { order_number, order_name, status, time_worked, price_usd, price_mxn, fecha_limite } = req.body;

    // Si se está actualizando el order_number, verificar que no exista otro con el mismo número
    if (order_number) {
      const existingOrder = await apoyosPool.query(
        'SELECT id, order_number FROM ordenes WHERE order_number = $1 AND id != $2',
        [order_number, id]
      );

      if (existingOrder.rows.length > 0) {
        return res.status(400).json({ 
          error: 'Ya existe una orden con este número',
          message: `El número de orden "${order_number}" ya está registrado en otra orden. Por favor verifique y use un número diferente.`
        });
      }
    }

    const result = await apoyosPool.query(
      `UPDATE ordenes
       SET 
           order_number = COALESCE($1, order_number),
           project_name = COALESCE($2, project_name),
           status = COALESCE($3, status),
           time_worked = COALESCE($4, time_worked),
           price_usd = COALESCE($5, price_usd),
           price_mxn = COALESCE($6, price_mxn),
           fecha_limite = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [order_number, order_name, status, time_worked, price_usd, price_mxn, fecha_limite || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    logger.info('Orden actualizada exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar orden:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'El número de orden ya existe' });
    }
    res.status(500).json({ error: 'Error al actualizar la orden' });
  }
});

// PUT - Actualizar fecha de inicio de una orden
app.put('/api/ordenes/:id/fecha-inicio', async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha_inicio } = req.body;
    // Normalizar y conservar la hora local proporcionada (no forzar medianoche)
    const fechaInicioNormalizada = fecha_inicio ? formatDateTimeLocal(fecha_inicio) : null;

    if (fecha_inicio && !fechaInicioNormalizada) {
      return res.status(400).json({ error: 'Fecha de inicio inválida' });
    }

    // Asegurar que la columna fecha_inicio existe y soporta hora (TIMESTAMP)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ordenes' AND column_name = 'fecha_inicio'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN fecha_inicio TIMESTAMP;
        ELSE
          -- Si existe pero es DATE, migrar a TIMESTAMP para conservar hora
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ordenes' AND column_name = 'fecha_inicio' AND data_type = 'date'
          ) THEN
            ALTER TABLE ordenes
              ALTER COLUMN fecha_inicio TYPE TIMESTAMP
              USING fecha_inicio::timestamp;
          END IF;
        END IF;
      END $$;
    `);

    const result = await apoyosPool.query(
      `UPDATE ordenes
       SET 
           fecha_inicio = $1::timestamp,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, order_number, fecha_inicio, updated_at`,
      [fechaInicioNormalizada, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    logger.info('Fecha de inicio actualizada exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar fecha de inicio:', error);
    res.status(500).json({ error: 'Error al actualizar la fecha de inicio' });
  }
});

// PUT - Actualizar fecha límite de una orden
app.put('/api/ordenes/:id/fecha-limite', async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha_limite } = req.body;

    // Asegurar que la columna fecha_limite soporta hora (TIMESTAMP)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ordenes' AND column_name = 'fecha_limite'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN fecha_limite TIMESTAMP;
        ELSE
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ordenes' AND column_name = 'fecha_limite' AND data_type = 'date'
          ) THEN
            ALTER TABLE ordenes
              ALTER COLUMN fecha_limite TYPE TIMESTAMP
              USING fecha_limite::timestamp;
          END IF;
        END IF;
      END $$;
    `);

    const result = await apoyosPool.query(
      `UPDATE ordenes
       SET 
           fecha_limite = $1::timestamp,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, order_number, fecha_limite, updated_at`,
      [fecha_limite || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    logger.info('Fecha límite actualizada exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar fecha límite:', error);
    res.status(500).json({ error: 'Error al actualizar la fecha límite' });
  }
});

// PUT - Actualizar fecha requerida (due) de una orden
app.put('/api/ordenes/:id/due', async (req, res) => {
  try {
    const { id } = req.params;
    const { due } = req.body;

    const result = await apoyosPool.query(
      `UPDATE ordenes
       SET 
           due = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, order_number, due, updated_at`,
      [due || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    logger.info('Fecha requerida (due) de orden actualizada exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar fecha requerida (due) de orden:', error);
    res.status(500).json({ error: 'Error al actualizar la fecha requerida' });
  }
});

// PUT - Marcar visibilidad de una orden (visible=true => ocultar en listados)
app.put('/api/ordenes/:id/visible', async (req, res) => {
  try {
    await ensureOrdenesTable();
    const { id } = req.params;
    const { visible } = req.body || {};

    const result = await apoyosPool.query(
      `UPDATE ordenes
       SET visible = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, order_number, visible, updated_at`,
      [Boolean(visible), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    return res.json({ success: true, ...result.rows[0] });
  } catch (error) {
    logger.error('Error al actualizar visibilidad de orden:', error);
    return res.status(500).json({ error: 'Error al actualizar visibilidad de la orden' });
  }
});

// POST - Validar conflictos de fechas
app.post('/api/ordenes/validar-fechas', async (req, res) => {
  try {
    const { order_id, fecha_inicio, fecha_limite, usuario_asignado, item_type } = req.body;
    const currentItemType = String(item_type || 'orden').trim().toLowerCase() === 'submittal' ? 'submittal' : 'orden';

    if (!fecha_inicio || !fecha_limite || !usuario_asignado || usuario_asignado.length === 0) {
      return res.json({ conflictos: [] });
    }

    // Convertir a array de enteros y eliminar duplicados/invalidos
    const userIds = [...new Set(
      (Array.isArray(usuario_asignado) ? usuario_asignado : [usuario_asignado])
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isInteger(id))
    )];

    if (!userIds.length) {
      return res.json({ conflictos: [] });
    }

    const fechaInicioTs = new Date(fecha_inicio);
    const fechaLimiteTs = new Date(fecha_limite);

    if (Number.isNaN(fechaInicioTs.getTime()) || Number.isNaN(fechaLimiteTs.getTime())) {
      return res.status(400).json({ error: 'Formato de fecha inválido para validar conflictos' });
    }

    if (fechaLimiteTs <= fechaInicioTs) {
      return res.status(400).json({ error: 'La fecha límite debe ser mayor a la fecha de inicio' });
    }

    // Buscar conflictos por traslape real de fecha y hora en órdenes y submittals.
    const query = `
      WITH assigned_items AS (
        SELECT
          'orden'::text AS tipo,
          o.id,
          o.order_number AS item_number,
          o.fecha_inicio,
          o.fecha_limite,
          user_id
        FROM ordenes o
        CROSS JOIN LATERAL unnest(COALESCE(o.usuario_asignado, ARRAY[]::INTEGER[])) AS user_id
        WHERE o.fecha_inicio IS NOT NULL
          AND o.fecha_limite IS NOT NULL
          AND user_id = ANY($2::INTEGER[])
          AND COALESCE(NULLIF(LOWER(TRIM(COALESCE(o.estatus, o.status, 'activo'))), ''), 'activo')
              NOT IN ('aprobado', 'rechazado', 'declinado', 'cancelado', 'completado', 'finalizado', 'closed')

        UNION ALL

        SELECT
          'submittal'::text AS tipo,
          s.id,
          s.submittal_number AS item_number,
          s.fecha_inicio,
          s.fecha_limite,
          user_id
        FROM submittals s
        CROSS JOIN LATERAL unnest(COALESCE(s.usuario_asignado, ARRAY[]::INTEGER[])) AS user_id
        WHERE s.fecha_inicio IS NOT NULL
          AND s.fecha_limite IS NOT NULL
          AND user_id = ANY($2::INTEGER[])
          AND COALESCE(NULLIF(LOWER(TRIM(COALESCE(s.estatus, s.status, 'activo'))), ''), 'activo')
              NOT IN ('aprobado', 'rechazado', 'declinado', 'cancelado', 'completado', 'finalizado', 'closed')
      )
      SELECT DISTINCT
        a.tipo,
        a.id,
        a.item_number,
        a.fecha_inicio,
        a.fecha_limite,
        u.id AS usuario_id,
        u.nombre_completo AS usuario_nombre
      FROM assigned_items a
      LEFT JOIN usuarios u ON u.id = a.user_id
      WHERE NOT (a.tipo = $5::text AND a.id = $1)
        AND ($3::timestamp < a.fecha_limite::timestamp)
        AND ($4::timestamp > a.fecha_inicio::timestamp)
      ORDER BY a.fecha_inicio ASC
    `;

    const result = await apoyosPool.query(query, [
      order_id || 0,
      userIds,
      fecha_inicio,
      fecha_limite,
      currentItemType
    ]);

    const conflictos = result.rows.map(row => ({
      tipo: row.tipo,
      orden_id: row.id,
      orden_numero: row.item_number,
      usuario_id: row.usuario_id,
      usuario_nombre: row.usuario_nombre || 'Usuario desconocido',
      fecha_inicio: row.fecha_inicio,
      fecha_limite: row.fecha_limite
    }));

    res.json({ conflictos });
  } catch (error) {
    logger.error('Error al validar conflictos de fechas:', error);
    res.status(500).json({ error: 'Error al validar conflictos de fechas', message: error.message });
  }
});

// DELETE - Eliminar una orden
app.delete('/api/ordenes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await apoyosPool.query(
      'DELETE FROM ordenes WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    logger.info('Orden eliminada exitosamente');
    res.json({ message: 'Orden eliminada exitosamente', orden: result.rows[0] });
  } catch (error) {
    logger.error('Error al eliminar orden:', error);
    res.status(500).json({ error: 'Error al eliminar la orden' });
  }
});

// PUT - Aprobar una orden (cambiar estatus de "pendiente" a "aprobado")
app.put('/api/ordenes/:id/aprobar', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que la orden existe y tiene estatus/status "pendiente"
    const checkResult = await apoyosPool.query(
      `SELECT id,
              order_number,
              estatus,
              status,
              COALESCE(NULLIF(TRIM(estatus), ''), NULLIF(TRIM(status), '')) AS estado_actual
       FROM ordenes
       WHERE id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const orden = checkResult.rows[0];
    
    // Normalizar estatus/status para comparación (case-insensitive, sin espacios)
    const estatusNormalizado = (orden.estado_actual || '').toString().trim().toLowerCase();
    
    if (estatusNormalizado !== 'pendiente') {
      return res.status(400).json({ 
        error: 'La orden no está pendiente de aprobación',
        current_status: orden.estado_actual || orden.estatus || orden.status || null
      });
    }

    // Obtener username del PM que aprueba
    const pmUsername = req.session?.username || req.query.username || req.headers['x-username'] || 'PM';

    // Obtener usuario_asignado del body si se envía
    let usuarioAsignado = req.body?.usuario_asignado;
    const hasExplicitAssignment = usuarioAsignado !== undefined && usuarioAsignado !== null;
    
    if (hasExplicitAssignment) {
      if (!Array.isArray(usuarioAsignado)) {
        usuarioAsignado = [usuarioAsignado];
      }
      usuarioAsignado = Array.isArray(usuarioAsignado) && usuarioAsignado.length > 0 ? usuarioAsignado : null;
    }

    // Actualizar el estatus a "aprobado" y registrar la fecha y hora de aprobación
    // También marcar anuncio_pm = TRUE para que el diseñador vea la notificación
    try {
      await apoyosPool.query(`
        ALTER TABLE ordenes 
        ADD COLUMN IF NOT EXISTS anuncio_pm BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS anuncio_disenador BOOLEAN DEFAULT FALSE;
      `);
    } catch (alterErr) {
      // Las columnas ya existen o hay otro error, continuar
      logger.debug('Columnas de anuncios ya existen o error al crearlas:', alterErr.message);
    }

    // Solo actualizar usuario_asignado si se envió explícitamente uno nuevo
    const updateQuery = `UPDATE ordenes 
       SET estatus = 'aprobado',
           status = 'aprobado',
           fecha_aprobacion = CURRENT_TIMESTAMP,
           fecha_fin = CURRENT_TIMESTAMP,
           anuncio_pm = TRUE,
           updated_at = NOW()
           ${hasExplicitAssignment && usuarioAsignado ? ', usuario_asignado = $2' : ''}
       WHERE id = $1
       RETURNING *`;
    
    const updateParams = hasExplicitAssignment && usuarioAsignado ? [id, JSON.stringify(usuarioAsignado)] : [id];
    const result = await apoyosPool.query(updateQuery, updateParams);

    let notificacionesDiseno = { insertadas: 0, destinatarios: [] };
    try {
      notificacionesDiseno = await crearNotificacionesAprobacionDiseno({
        usuarioAsignadoIds: result.rows[0]?.usuario_asignado,
        tipoElemento: 'orden',
        numeroElemento: orden.order_number,
        pmUsername
      });
    } catch (notifErr) {
      logger.warn('No se pudo crear notificacion de aprobacion para diseno (orden):', notifErr.message);
    }

    // Actualizar estado_orden en tiempo_diseno para sesiones activas de esta orden
    try {
      await apoyosPool.query(
        `UPDATE tiempo_diseno 
         SET estado_orden = 'Aprobado por PM'
         WHERE orden = $1 AND hora_fin IS NULL`,
        [orden.order_number]
      );
    } catch (err) {
      logger.warn('No se pudo actualizar estado_orden en tiempo_diseno:', err.message);
    }

    logger.info('Orden aprobada exitosamente', { order_id: id, order_number: orden.order_number, pm_username: pmUsername });
    res.json({ 
      success: true,
      message: 'Orden aprobada exitosamente', 
      orden: result.rows[0],
      pm_username: pmUsername,
      notificaciones_diseno: notificacionesDiseno
    });
  } catch (error) {
    logger.error('Error al aprobar orden:', error);
    res.status(500).json({ error: 'Error al aprobar la orden', message: error.message });
  }
});

// PUT - Declinar una orden (cambiar estatus de "pendiente" a "rechazado")
app.put('/api/ordenes/:id/declinar', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que la orden existe y tiene estatus/status "pendiente"
    const checkResult = await apoyosPool.query(
      `SELECT id,
              order_number,
              estatus,
              status,
              COALESCE(NULLIF(TRIM(estatus), ''), NULLIF(TRIM(status), '')) AS estado_actual
       FROM ordenes
       WHERE id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const orden = checkResult.rows[0];
    const estatusNormalizado = (orden.estado_actual || '').toString().trim().toLowerCase();
    
    if (estatusNormalizado !== 'pendiente') {
      return res.status(400).json({ 
        error: 'La orden no está pendiente de aprobación',
        current_status: orden.estado_actual || orden.estatus || orden.status || null
      });
    }

    // Obtener username del PM que declina
    const pmUsername = req.session?.username || req.query.username || req.headers['x-username'] || 'PM';

    // Actualizar el estatus a "rechazado"
    await apoyosPool.query(
      `UPDATE ordenes 
       SET estatus = 'rechazado',
           status = 'rechazado',
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Actualizar estado_orden en tiempo_diseno para sesiones activas de esta orden
    try {
      await apoyosPool.query(
        `UPDATE tiempo_diseno 
         SET estado_orden = 'Rechazado por PM - Corregir números de parte'
         WHERE orden = $1 AND hora_fin IS NULL`,
        [orden.order_number]
      );
    } catch (err) {
      logger.warn('No se pudo actualizar estado_orden en tiempo_diseno:', err.message);
    }

    logger.info(`Orden ${orden.order_number} declinada exitosamente`, { pm_username: pmUsername });
    res.json({ 
      success: true, 
      message: 'Orden declinada exitosamente',
      order_number: orden.order_number,
      pm_username: pmUsername
    });
  } catch (error) {
    logger.error('Error al declinar orden:', error);
    res.status(500).json({ error: 'Error al declinar la orden', message: error.message });
  }
});

// GET - Obtener órdenes/submittals pendientes asignadas al usuario actual
app.get('/api/ordenes-pendientes', async (req, res) => {
  try {
    // Intentar obtener username de la sesión primero
    let username = req.session?.username;
    
    // Si no hay en la sesión, intentar desde el query parameter o header
    if (!username) {
      username = req.query.username || req.headers['x-username'];
    }
    
    if (!username) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    // Obtener el ID del usuario desde la tabla usuarios
    const userResult = await apoyosPool.query(
      'SELECT id FROM usuarios WHERE username = $1',
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.json({ success: true, pendientes: [] });
    }

    const userId = userResult.rows[0].id;

    // Buscar órdenes pendientes donde el usuario esté asignado
    const ordenesResult = await apoyosPool.query(
      `SELECT o.id, o.order_number, o.project_name, o.client, 'orden' as tipo
       FROM ordenes o
       WHERE o.estatus = 'pendiente' 
       AND $1 = ANY(o.usuario_asignado)
       ORDER BY o.updated_at DESC`,
      [userId]
    );

    // Buscar submittals pendientes donde el usuario esté asignado
    const submittalsResult = await apoyosPool.query(
      `SELECT s.id, s.submittal_number as order_number, s.project_name, s.client, 'submittal' as tipo
       FROM submittals s
       WHERE s.estatus = 'pendiente' 
       AND $1 = ANY(s.usuario_asignado)
       ORDER BY s.updated_at DESC`,
      [userId]
    );

    // Obtener números de parte para cada orden
    const pendientes = [];
    
    for (const row of ordenesResult.rows) {
      // Obtener números de parte para esta orden (solo de esta orden específica)
      const partNumbersResult = await apoyosPool.query(
        `SELECT numero_parte, uom, unidades, cantidad, notas
         FROM numero_parte
         WHERE orden_id = $1
         ORDER BY created_at ASC`,
        [row.id]
      );
      
      pendientes.push({
        id: row.id,
        order_number: row.order_number,
        project_name: row.project_name,
        client: row.client,
        tipo: row.tipo,
        part_numbers: partNumbersResult.rows.map(p => ({
          numero_parte: p.numero_parte,
          uom: p.uom || '',
          unidades: p.unidades || 0,
          cantidad: p.cantidad || 0,
          notas: p.notas || ''
        }))
      });
    }

    // Obtener números de parte para cada submittal
    for (const row of submittalsResult.rows) {
      // Para submittals, buscar números de parte asociados por el order_number (submittal_number)
      // Primero buscar si hay una orden con ese número, y luego los números de parte de esa orden
      const ordenCheck = await apoyosPool.query(
        `SELECT id FROM ordenes WHERE order_number = $1 LIMIT 1`,
        [row.order_number]
      );
      
      let partNumbersResult = { rows: [] };
      if (ordenCheck.rows.length > 0) {
        partNumbersResult = await apoyosPool.query(
          `SELECT numero_parte, uom, unidades, cantidad, notas
           FROM numero_parte
           WHERE orden_id = $1
           ORDER BY created_at ASC`,
          [ordenCheck.rows[0].id]
        );
      }
      
      pendientes.push({
        id: row.id,
        order_number: row.order_number,
        project_name: row.project_name,
        client: row.client,
        tipo: row.tipo,
        part_numbers: partNumbersResult.rows.map(p => ({
          numero_parte: p.numero_parte,
          uom: p.uom || '',
          unidades: p.unidades || 0,
          cantidad: p.cantidad || 0,
          notas: p.notas || ''
        }))
      });
    }

    res.json({ success: true, pendientes });
  } catch (error) {
    logger.error('Error al obtener órdenes pendientes:', error);
    res.status(500).json({ error: 'Error al obtener órdenes pendientes', message: error.message });
  }
});

// ==================== ENDPOINTS PARA SUBMITTALS PM ====================

// Función para asegurar que la tabla submittals existe
async function ensureSubmittalsTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS submittals (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        submittal_number VARCHAR(100) NOT NULL UNIQUE,
        submittal_name VARCHAR(255) NOT NULL,
        client VARCHAR(255),
        customer_job VARCHAR(100),
        project_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'activo',
        estatus VARCHAR(50) DEFAULT 'activo',
        time_worked BIGINT DEFAULT 0,
        price_usd DECIMAL(10, 2) DEFAULT 0.00,
        price_mxn DECIMAL(10, 2) DEFAULT 0.00,
        usuario_asignado INTEGER[] DEFAULT '{}',
        fecha_inicio DATE,
        fecha_limite DATE,
        due DATE,
        fecha_aprobacion TIMESTAMP,
        fecha_fin TIMESTAMP,
        visible BOOLEAN DEFAULT FALSE,
        bom_excel VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES proyectos(id) ON DELETE CASCADE
      );
    `);

    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS asignaciones_ordenes (
        id SERIAL PRIMARY KEY,
        orden_id INTEGER,
        submittal_id INTEGER,
        order_number VARCHAR(100) NOT NULL,
        usuario_id INTEGER NOT NULL,
        fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tipo VARCHAR(20) DEFAULT 'orden',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(orden_id, usuario_id, tipo),
        UNIQUE(submittal_id, usuario_id, tipo)
      )
    `);
  
    
    // Crear índices si no existen
    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS idx_submittals_project_id ON submittals(project_id);
      CREATE INDEX IF NOT EXISTS idx_submittals_submittal_number ON submittals(submittal_number);
      CREATE INDEX IF NOT EXISTS idx_submittals_status ON submittals(status);
      CREATE INDEX IF NOT EXISTS idx_submittals_estatus ON submittals(estatus);
      CREATE INDEX IF NOT EXISTS idx_submittals_created_at ON submittals(created_at DESC);
    `);
    
    // Agregar columnas si no existen (para tablas ya creadas)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submittals' AND column_name = 'usuario_asignado'
        ) THEN
          ALTER TABLE submittals ADD COLUMN usuario_asignado INTEGER[] DEFAULT '{}';
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submittals' AND column_name = 'fecha_inicio'
        ) THEN
          ALTER TABLE submittals ADD COLUMN fecha_inicio DATE;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submittals' AND column_name = 'fecha_limite'
        ) THEN
          ALTER TABLE submittals ADD COLUMN fecha_limite DATE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'submittals' AND column_name = 'due'
        ) THEN
          ALTER TABLE submittals ADD COLUMN due DATE;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submittals' AND column_name = 'fecha_fin'
        ) THEN
          ALTER TABLE submittals ADD COLUMN fecha_fin TIMESTAMP;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'submittals' AND column_name = 'fecha_aprobacion'
        ) THEN
          ALTER TABLE submittals ADD COLUMN fecha_aprobacion TIMESTAMP;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submittals' AND column_name = 'estatus'
        ) THEN
          ALTER TABLE submittals ADD COLUMN estatus VARCHAR(50) DEFAULT 'activo';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submittals' AND column_name = 'bom_excel'
        ) THEN
          ALTER TABLE submittals ADD COLUMN bom_excel VARCHAR(500);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'submittals' AND column_name = 'visible'
        ) THEN
          ALTER TABLE submittals ADD COLUMN visible BOOLEAN DEFAULT FALSE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'submittals' AND column_name = 'insert_forzado'
        ) THEN
          ALTER TABLE submittals ADD COLUMN insert_forzado BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);
  } catch (error) {
    console.error('❌ Error al verificar/crear tabla submittals:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Error detail:', error.detail);
    logger.error('Error al verificar/crear tabla submittals:', error);
    throw error;
  }
}

// GET - Obtener todos los submittals
app.get('/api/submittals', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { project_id, include_hidden } = req.query;
    const includeHidden = ['1', 'true', 'yes', 'si'].includes(String(include_hidden || '').toLowerCase());
    logger.info('Obteniendo submittals...', { project_id, include_hidden: includeHidden });
    
    let query = `SELECT s.id, s.project_id, s.submittal_number, s.submittal_name, s.client, s.customer_job, 
      s.project_name, s.status, s.estatus, s.time_worked, s.price_usd, s.price_mxn,
      s.tiempo_aprobado,
          COALESCE(s.usuario_asignado, ARRAY[]::INTEGER[]) as usuario_asignado,
          CASE WHEN s.fecha_inicio IS NULL THEN NULL ELSE to_char(s.fecha_inicio, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_inicio,
          CASE WHEN s.fecha_limite IS NULL THEN NULL ELSE to_char(s.fecha_limite, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_limite,
          s.due,
        s.fecha_fin, s.fecha_aprobacion, s.visible, s.insert_forzado, s.po_creada, s.created_at, s.updated_at, p.project_name as proyecto_nombre
       FROM submittals s
       LEFT JOIN proyectos p ON s.project_id = p.id
        WHERE 1=1`;

    let params = [];

    if (!includeHidden) {
      query += ` AND COALESCE(s.visible, FALSE) = FALSE`;
    }

    if (project_id) {
      params.push(project_id);
      query += ` AND s.project_id = $${params.length}`;
    }
    
    query += ` ORDER BY s.created_at DESC`;
    
    const result = await apoyosPool.query(query, params);
    
    // Obtener usuarios asignados a cada submittal desde la columna usuario_asignado (array de IDs)
    for (let submittal of result.rows) {
      try {
        // Si el submittal tiene usuarios_asignado (array de IDs), obtener los datos de esos usuarios
        if (submittal.usuario_asignado && Array.isArray(submittal.usuario_asignado) && submittal.usuario_asignado.length > 0) {
          const usuariosQuery = await apoyosPool.query(
            `SELECT id, username, nombre_completo, foto_url
             FROM usuarios 
             WHERE id = ANY($1::int[])`,
            [submittal.usuario_asignado]
          );
          submittal.usuarios_asignados = usuariosQuery.rows.map(u => ({
            id: u.id,
            username: u.username,
            nombre_completo: u.nombre_completo || u.username,
            foto_url: u.foto_url || null
          }));
        } else {
          submittal.usuarios_asignados = [];
        }
      } catch (err) {
        logger.error(`Error al obtener usuarios asignados para submittal ${submittal.submittal_number}:`, err);
        submittal.usuarios_asignados = [];
      }
    }
    
    logger.info('Submittals obtenidos:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error al obtener submittals:', error);
    res.status(500).json({ error: 'Error al obtener submittals' });
  }
});

// GET - Obtener un submittal por ID
app.get('/api/submittals/:id', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;
    const result = await apoyosPool.query(
      `SELECT s.id, s.project_id, s.submittal_number, s.submittal_name, s.client, s.customer_job, 
              s.project_name, s.status, s.estatus, s.time_worked, s.price_usd, s.price_mxn,
              s.tiempo_aprobado,
              COALESCE(s.usuario_asignado, ARRAY[]::INTEGER[]) as usuario_asignado,
              CASE WHEN s.fecha_inicio IS NULL THEN NULL ELSE to_char(s.fecha_inicio, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_inicio,
              CASE WHEN s.fecha_limite IS NULL THEN NULL ELSE to_char(s.fecha_limite, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_limite,
              s.due,
              s.fecha_fin, s.fecha_aprobacion, s.insert_forzado, s.po_creada, s.created_at, s.updated_at, p.project_name as proyecto_nombre
       FROM submittals s
       LEFT JOIN proyectos p ON s.project_id = p.id
       WHERE s.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }
    
    const submittal = result.rows[0];
    
    // Obtener usuarios asignados a este submittal desde la columna usuario_asignado (array de IDs)
    try {
      if (submittal.usuario_asignado && Array.isArray(submittal.usuario_asignado) && submittal.usuario_asignado.length > 0) {
        const usuariosQuery = await apoyosPool.query(
          `SELECT id, username, nombre_completo, foto_url
           FROM usuarios 
           WHERE id = ANY($1::int[])`,
          [submittal.usuario_asignado]
        );
        submittal.usuarios_asignados = usuariosQuery.rows.map(u => ({
          id: u.id,
          username: u.username,
          nombre_completo: u.nombre_completo || u.username,
          foto_url: u.foto_url || null
        }));
      } else {
        submittal.usuarios_asignados = [];
      }
    } catch (err) {
      logger.error(`Error al obtener usuarios asignados para submittal ${submittal.submittal_number}:`, err);
      submittal.usuarios_asignados = [];
    }
    
    res.json(submittal);
  } catch (error) {
    logger.error('Error al obtener submittal:', error);
    res.status(500).json({ error: 'Error al obtener submittal' });
  }
});

// POST - Crear un nuevo submittal
app.post('/api/submittals', async (req, res) => {
  try {
    console.log('\n========== CREAR SUBMITTAL ==========');
    console.log('Body recibido:', req.body);
    
    await ensureSubmittalsTable();
    const { project_id, submittal_number, submittal_name } = req.body;
    
    console.log('Datos extraídos:', { project_id, submittal_number, submittal_name });
    
    if (!project_id || !submittal_number || !submittal_name) {
      console.error('❌ Faltan datos requeridos');
      return res.status(400).json({ error: 'Faltan datos requeridos: project_id, submittal_number y submittal_name son obligatorios' });
    }

    logger.info('Creando nuevo submittal:', { project_id, submittal_number, submittal_name });
    
    // Verificar que el proyecto existe
    const projectResult = await apoyosPool.query(
      'SELECT * FROM proyectos WHERE id = $1',
      [project_id]
    );

    if (projectResult.rows.length === 0) {
      console.error('❌ Proyecto no encontrado:', project_id);
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    const project = projectResult.rows[0];
    console.log('✔ Proyecto encontrado:', project.project_name);

    // Verificar si el número de submittal ya existe
    const existingSubmittal = await apoyosPool.query(
      'SELECT id, submittal_number FROM submittals WHERE submittal_number = $1',
      [submittal_number]
    );

    if (existingSubmittal.rows.length > 0) {
      console.error('❌ Submittal duplicado:', submittal_number);
      return res.status(400).json({ 
        error: 'Ya existe un submittal con este número',
        message: `El número de submittal "${submittal_number}" ya está registrado. Por favor verifique y use un número diferente.`
      });
    }

    // Crear el submittal en la tabla submittals
    // Estatus inicial: 'activo' (no 'pendiente') - el diseñador debe cambiarlo a 'pendiente' cuando esté listo para aprobación
    console.log('Insertando submittal en la base de datos...');
    const insertResult = await apoyosPool.query(
      `INSERT INTO submittals (project_id, submittal_number, submittal_name, client, customer_job, project_name, status, estatus)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, project_id, submittal_number, submittal_name, project_name, client, status, estatus`,
      [project_id, submittal_number, submittal_name.trim(), project.client, project.customer_job, project.project_name, 'activo', 'activo']
    );

    console.log('✔ Submittal creado exitosamente:', insertResult.rows[0]);
    logger.info('Submittal creado exitosamente');
    res.status(201).json({ 
      success: true, 
      message: 'Submittal creado correctamente',
      submittal: insertResult.rows[0] 
    });
  } catch (error) {
    console.error('❌ Error al crear submittal:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Error detail:', error.detail);
    logger.error('Error al crear submittal:', error);
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'El número de submittal ya existe' });
    }
    res.status(500).json({ error: 'Error al crear el submittal', message: error.message });
  }
});

// PUT - Actualizar un submittal
app.put('/api/submittals/:id', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;
    const { submittal_number, submittal_name, status, estatus, time_worked, price_usd, price_mxn, fecha_limite } = req.body;

    // Si se está actualizando el submittal_number, verificar que no exista otro con el mismo número
    if (submittal_number) {
      const existingSubmittal = await apoyosPool.query(
        'SELECT id, submittal_number FROM submittals WHERE submittal_number = $1 AND id != $2',
        [submittal_number, id]
      );

      if (existingSubmittal.rows.length > 0) {
        return res.status(400).json({ 
          error: 'Ya existe un submittal con este número',
          message: `El número de submittal "${submittal_number}" ya está registrado en otro submittal. Por favor verifique y use un número diferente.`
        });
      }
    }

    const result = await apoyosPool.query(
      `UPDATE submittals
       SET 
           submittal_number = COALESCE($1, submittal_number),
           submittal_name = COALESCE($2, submittal_name),
           status = COALESCE($3, status),
           estatus = COALESCE($4, estatus),
           time_worked = COALESCE($5, time_worked),
           price_usd = COALESCE($6, price_usd),
           price_mxn = COALESCE($7, price_mxn),
           fecha_limite = $8,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [submittal_number, submittal_name, status, estatus, time_worked, price_usd, price_mxn, fecha_limite || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    logger.info('Submittal actualizado exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar submittal:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'El número de submittal ya existe' });
    }
    res.status(500).json({ error: 'Error al actualizar el submittal' });
  }
});

// DELETE - Eliminar un submittal
app.delete('/api/submittals/:id', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;

    const result = await apoyosPool.query(
      'DELETE FROM submittals WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    logger.info('Submittal eliminado exitosamente');
    res.json({ message: 'Submittal eliminado exitosamente', submittal: result.rows[0] });
  } catch (error) {
    logger.error('Error al eliminar submittal:', error);
    res.status(500).json({ error: 'Error al eliminar el submittal' });
  }
});

// PUT - Actualizar usuarios asignados a un submittal
app.put('/api/submittals/:id/usuarios', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;
    const { usuario_asignado } = req.body; // Array de IDs de usuarios

    // Validar que usuario_asignado sea un array
    if (!Array.isArray(usuario_asignado)) {
      return res.status(400).json({ error: 'usuario_asignado debe ser un array de IDs' });
    }

    // Convertir a array de enteros y eliminar duplicados
    const userIds = [...new Set(usuario_asignado.map(id => parseInt(id)).filter(id => !isNaN(id)))];

    // Obtener usuarios asignados anteriores para detectar nuevos
    const submittalBefore = await apoyosPool.query(
      'SELECT usuario_asignado FROM submittals WHERE id = $1',
      [id]
    );
    const previousUserIds = submittalBefore.rows.length > 0 && submittalBefore.rows[0].usuario_asignado 
      ? submittalBefore.rows[0].usuario_asignado 
      : [];

    const result = await apoyosPool.query(
      `UPDATE submittals
       SET usuario_asignado = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, submittal_number, usuario_asignado`,
      [userIds, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    // Crear tabla de asignaciones si no existe
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS asignaciones_ordenes (
        id SERIAL PRIMARY KEY,
        orden_id INTEGER,
        submittal_id INTEGER,
        order_number VARCHAR(100) NOT NULL,
        usuario_id INTEGER NOT NULL,
        fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tipo VARCHAR(20) DEFAULT 'orden',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(orden_id, usuario_id, tipo),
        UNIQUE(submittal_id, usuario_id, tipo)
      )
    `);

    // Registrar nuevas asignaciones (usuarios que no estaban antes)
    const newUserIds = userIds.filter(uid => !previousUserIds.includes(uid));
    if (newUserIds.length > 0) {
      const submittal = result.rows[0];
      for (const userId of newUserIds) {
        await apoyosPool.query(
          `INSERT INTO asignaciones_ordenes (submittal_id, order_number, usuario_id, tipo, fecha_asignacion)
           VALUES ($1, $2, $3, 'submittal', CURRENT_TIMESTAMP)
           ON CONFLICT (submittal_id, usuario_id, tipo) DO NOTHING`,
          [id, submittal.submittal_number, userId]
        );
      }
    }

    // Obtener información completa de los usuarios asignados
    const submittal = result.rows[0];
    let usuariosAsignados = [];
    
    if (submittal.usuario_asignado && submittal.usuario_asignado.length > 0) {
      const usuariosQuery = await apoyosPool.query(
        `SELECT id, username, nombre_completo 
         FROM usuarios 
         WHERE id = ANY($1::int[])`,
        [submittal.usuario_asignado]
      );
      usuariosAsignados = usuariosQuery.rows.map(u => ({
        id: u.id,
        username: u.username,
        nombre_completo: u.nombre_completo || u.username
      }));
    }

    logger.info(`Usuarios asignados actualizados para submittal ${id}:`, userIds);
    res.json({ 
      success: true,
      message: 'Usuarios asignados actualizados correctamente',
      usuario_asignado: userIds,
      usuarios_asignados: usuariosAsignados
    });
  } catch (error) {
    logger.error('Error al actualizar usuarios asignados:', error);
    res.status(500).json({ error: 'Error al actualizar usuarios asignados' });
  }
});

// PUT - Actualizar fecha de inicio de un submittal
app.put('/api/submittals/:id/fecha-inicio', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;
    const { fecha_inicio } = req.body;
    // Normalizar y conservar la hora local proporcionada (no forzar medianoche)
    const fechaInicioNormalizada = fecha_inicio ? formatDateTimeLocal(fecha_inicio) : null;

    if (fecha_inicio && !fechaInicioNormalizada) {
      return res.status(400).json({ error: 'Fecha de inicio inválida' });
    }

    // Asegurar que la columna soporte hora (TIMESTAMP) y migrar si era DATE
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submittals' AND column_name = 'fecha_inicio'
        ) THEN
          ALTER TABLE submittals ADD COLUMN fecha_inicio TIMESTAMP;
        ELSE
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'submittals' AND column_name = 'fecha_inicio' AND data_type = 'date'
          ) THEN
            ALTER TABLE submittals
              ALTER COLUMN fecha_inicio TYPE TIMESTAMP
              USING fecha_inicio::timestamp;
          END IF;
        END IF;
      END $$;
    `);

    const result = await apoyosPool.query(
      `UPDATE submittals
       SET 
           fecha_inicio = $1::timestamp,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, submittal_number, fecha_inicio, updated_at`,
      [fechaInicioNormalizada, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    logger.info('Fecha de inicio de submittal actualizada exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar fecha de inicio de submittal:', error);
    res.status(500).json({ error: 'Error al actualizar la fecha de inicio' });
  }
});

// PUT - Actualizar fecha límite de un submittal
app.put('/api/submittals/:id/fecha-limite', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;
    const { fecha_limite } = req.body;

    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submittals' AND column_name = 'fecha_limite'
        ) THEN
          ALTER TABLE submittals ADD COLUMN fecha_limite TIMESTAMP;
        ELSE
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'submittals' AND column_name = 'fecha_limite' AND data_type = 'date'
          ) THEN
            ALTER TABLE submittals
              ALTER COLUMN fecha_limite TYPE TIMESTAMP
              USING fecha_limite::timestamp;
          END IF;
        END IF;
      END $$;
    `);

    const result = await apoyosPool.query(
      `UPDATE submittals
       SET 
           fecha_limite = $1::timestamp,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, submittal_number, fecha_limite, updated_at`,
      [fecha_limite || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    logger.info('Fecha límite de submittal actualizada exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar fecha límite de submittal:', error);
    res.status(500).json({ error: 'Error al actualizar la fecha límite' });
  }
});

// PUT - Actualizar fecha requerida (due) de un submittal
app.put('/api/submittals/:id/due', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;
    const { due } = req.body;

    const result = await apoyosPool.query(
      `UPDATE submittals
       SET 
           due = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, submittal_number, due, updated_at`,
      [due || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    logger.info('Fecha requerida (due) de submittal actualizada exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar fecha requerida (due) de submittal:', error);
    res.status(500).json({ error: 'Error al actualizar la fecha requerida del submittal' });
  }
});

// PUT - Marcar visibilidad de un submittal (visible=true => ocultar en listados)
app.put('/api/submittals/:id/visible', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;
    const { visible } = req.body || {};

    const result = await apoyosPool.query(
      `UPDATE submittals
       SET visible = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, submittal_number, visible, updated_at`,
      [Boolean(visible), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    return res.json({ success: true, ...result.rows[0] });
  } catch (error) {
    logger.error('Error al actualizar visibilidad de submittal:', error);
    return res.status(500).json({ error: 'Error al actualizar visibilidad del submittal' });
  }
});

// PUT - Aprobar un submittal (cambiar estatus de "pendiente" a "aprobado")
app.put('/api/submittals/:id/aprobar', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;

    // Verificar que el submittal existe y tiene estatus/status "pendiente"
    const checkResult = await apoyosPool.query(
      `SELECT id,
              submittal_number,
              estatus,
              status,
              COALESCE(NULLIF(TRIM(estatus), ''), NULLIF(TRIM(status), '')) AS estado_actual
       FROM submittals
       WHERE id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    const submittal = checkResult.rows[0];
    
    // Normalizar estatus/status para comparación (case-insensitive, sin espacios)
    const estatusNormalizado = (submittal.estado_actual || '').toString().trim().toLowerCase();
    
    if (estatusNormalizado !== 'pendiente') {
      return res.status(400).json({ 
        error: 'El submittal no está pendiente de aprobación',
        current_status: submittal.estado_actual || submittal.estatus || submittal.status || null
      });
    }

    // Obtener username del PM que aprueba
    const pmUsername = req.session?.username || req.query.username || req.headers['x-username'] || 'PM';

    // Obtener usuario_asignado del body si se envía
    let usuarioAsignado = req.body?.usuario_asignado;
    const hasExplicitAssignment = usuarioAsignado !== undefined && usuarioAsignado !== null;
    
    if (hasExplicitAssignment) {
      if (!Array.isArray(usuarioAsignado)) {
        usuarioAsignado = [usuarioAsignado];
      }
      usuarioAsignado = Array.isArray(usuarioAsignado) && usuarioAsignado.length > 0 ? usuarioAsignado : null;
    }

    // Actualizar el estatus a "aprobado" y registrar la fecha y hora de aprobación
    // También marcar anuncio_pm = TRUE para que el diseñador vea la notificación
    try {
      await apoyosPool.query(`
        ALTER TABLE submittals 
        ADD COLUMN IF NOT EXISTS anuncio_pm BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS anuncio_disenador BOOLEAN DEFAULT FALSE;
      `);
    } catch (alterErr) {
      // Las columnas ya existen o hay otro error, continuar
      logger.debug('Columnas de anuncios ya existen o error al crearlas:', alterErr.message);
    }

    // Solo actualizar usuario_asignado si se envió explícitamente uno nuevo
    const updateQuery = `UPDATE submittals 
       SET estatus = 'aprobado',
           status = 'aprobado',
           fecha_aprobacion = CURRENT_TIMESTAMP,
           fecha_fin = CURRENT_TIMESTAMP,
           anuncio_pm = TRUE,
           updated_at = NOW()
           ${hasExplicitAssignment && usuarioAsignado ? ', usuario_asignado = $2' : ''}
       WHERE id = $1
       RETURNING *`;
    
    const updateParams = hasExplicitAssignment && usuarioAsignado ? [id, JSON.stringify(usuarioAsignado)] : [id];
    const result = await apoyosPool.query(updateQuery, updateParams);

    let notificacionesDiseno = { insertadas: 0, destinatarios: [] };
    try {
      notificacionesDiseno = await crearNotificacionesAprobacionDiseno({
        usuarioAsignadoIds: result.rows[0]?.usuario_asignado,
        tipoElemento: 'submittal',
        numeroElemento: submittal.submittal_number,
        pmUsername
      });
    } catch (notifErr) {
      logger.warn('No se pudo crear notificacion de aprobacion para diseno (submittal):', notifErr.message);
    }

    // Actualizar estado_orden en tiempo_diseno para sesiones activas de este submittal
    try {
      await apoyosPool.query(
        `UPDATE tiempo_diseno 
         SET estado_orden = 'Aprobado por PM'
         WHERE orden = $1 AND hora_fin IS NULL`,
        [submittal.submittal_number]
      );
    } catch (err) {
      logger.warn('No se pudo actualizar estado_orden en tiempo_diseno:', err.message);
    }

    logger.info('Submittal aprobado exitosamente', { submittal_id: id, submittal_number: submittal.submittal_number, pm_username: pmUsername });
    res.json({ 
      success: true,
      message: 'Submittal aprobado exitosamente', 
      submittal: result.rows[0],
      pm_username: pmUsername,
      notificaciones_diseno: notificacionesDiseno
    });
  } catch (error) {
    logger.error('Error al aprobar submittal:', error);
    res.status(500).json({ error: 'Error al aprobar el submittal', message: error.message });
  }
});

// PUT - Declinar un submittal (cambiar estatus de "pendiente" a "rechazado")
app.put('/api/submittals/:id/declinar', async (req, res) => {
  try {
    await ensureSubmittalsTable();
    const { id } = req.params;

    // Verificar que el submittal existe y tiene estatus/status "pendiente"
    const checkResult = await apoyosPool.query(
      `SELECT id,
              submittal_number,
              estatus,
              status,
              COALESCE(NULLIF(TRIM(estatus), ''), NULLIF(TRIM(status), '')) AS estado_actual
       FROM submittals
       WHERE id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Submittal no encontrado' });
    }

    const submittal = checkResult.rows[0];
    const estatusNormalizado = (submittal.estado_actual || '').toString().trim().toLowerCase();
    
    if (estatusNormalizado !== 'pendiente') {
      return res.status(400).json({ 
        error: 'El submittal no está pendiente de aprobación',
        current_status: submittal.estado_actual || submittal.estatus || submittal.status || null
      });
    }

    // Obtener username del PM que declina
    const pmUsername = req.session?.username || req.query.username || req.headers['x-username'] || 'PM';

    // Actualizar el estatus a "rechazado"
    await apoyosPool.query(
      `UPDATE submittals 
       SET estatus = 'rechazado',
           status = 'rechazado',
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Actualizar estado_orden en tiempo_diseno para sesiones activas de este submittal
    try {
      await apoyosPool.query(
        `UPDATE tiempo_diseno 
         SET estado_orden = 'Rechazado por PM - Corregir números de parte'
         WHERE orden = $1 AND hora_fin IS NULL`,
        [submittal.submittal_number]
      );
    } catch (err) {
      logger.warn('No se pudo actualizar estado_orden en tiempo_diseno:', err.message);
    }

    logger.info(`Submittal ${submittal.submittal_number} declinado exitosamente`, { pm_username: pmUsername });
    res.json({ 
      success: true, 
      message: 'Submittal declinado exitosamente',
      submittal_number: submittal.submittal_number,
      pm_username: pmUsername
    });
  } catch (error) {
    logger.error('Error al declinar submittal:', error);
    res.status(500).json({ error: 'Error al declinar el submittal', message: error.message });
  }
});

// ==================== FIN ENDPOINTS PARA SUBMITTALS PM ====================

// ==================== ENDPOINTS PARA CALCULAR GAP DE TIEMPO ====================

// GET - Calcular gap de tiempo entre asignación y primer logueo
app.get('/api/diseno/gap-tiempo-asignacion', async (req, res) => {
  try {
    const { order_number, usuario_id, tipo } = req.query; // tipo: 'orden' o 'submittal'

    // Asegurar que la tabla de asignaciones existe
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS asignaciones_ordenes (
        id SERIAL PRIMARY KEY,
        orden_id INTEGER,
        submittal_id INTEGER,
        order_number VARCHAR(100) NOT NULL,
        usuario_id INTEGER NOT NULL,
        fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tipo VARCHAR(20) DEFAULT 'orden',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(orden_id, usuario_id, tipo),
        UNIQUE(submittal_id, usuario_id, tipo)
      )
    `);

    let query = `
      SELECT 
        ao.id as asignacion_id,
        ao.order_number,
        ao.usuario_id,
        ao.fecha_asignacion,
        ao.tipo,
        u.username,
        u.nombre_completo,
        MIN(td.hora_inicio) as primer_logueo,
        CASE 
          WHEN MIN(td.hora_inicio) IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (MIN(td.hora_inicio) - ao.fecha_asignacion)) / 3600
          ELSE NULL
        END as gap_horas,
        CASE 
          WHEN MIN(td.hora_inicio) IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (MIN(td.hora_inicio) - ao.fecha_asignacion)) / 60
          ELSE NULL
        END as gap_minutos,
        CASE 
          WHEN MIN(td.hora_inicio) IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (MIN(td.hora_inicio) - ao.fecha_asignacion))
          ELSE NULL
        END as gap_segundos
      FROM asignaciones_ordenes ao
      INNER JOIN usuarios u ON u.id = ao.usuario_id
      LEFT JOIN tiempo_diseno td ON td.orden = ao.order_number 
        AND td.username = u.username
        AND td.hora_inicio >= ao.fecha_asignacion
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (order_number) {
      query += ` AND ao.order_number = $${paramIndex}`;
      params.push(order_number);
      paramIndex++;
    }

    if (usuario_id) {
      query += ` AND ao.usuario_id = $${paramIndex}`;
      params.push(parseInt(usuario_id));
      paramIndex++;
    }

    if (tipo) {
      query += ` AND ao.tipo = $${paramIndex}`;
      params.push(tipo);
      paramIndex++;
    }

    query += `
      GROUP BY ao.id, ao.order_number, ao.usuario_id, ao.fecha_asignacion, ao.tipo, u.username, u.nombre_completo
      ORDER BY ao.fecha_asignacion DESC
    `;

    const result = await apoyosPool.query(query, params);

    const gaps = result.rows.map(row => {
      const gapHoras = row.gap_horas !== null && row.gap_horas !== undefined 
        ? parseFloat(parseFloat(row.gap_horas).toFixed(2)) 
        : null;
      const gapMinutos = row.gap_minutos !== null && row.gap_minutos !== undefined 
        ? parseFloat(parseFloat(row.gap_minutos).toFixed(2)) 
        : null;
      const gapSegundos = row.gap_segundos !== null && row.gap_segundos !== undefined 
        ? parseFloat(parseFloat(row.gap_segundos).toFixed(2)) 
        : null;
      
      let gapFormateado = 'Sin logueo aún';
      if (gapHoras !== null && gapHoras !== undefined && !isNaN(gapHoras)) {
        const horas = Math.floor(Math.abs(gapHoras));
        const minutos = Math.floor(Math.abs((gapHoras % 1) * 60));
        gapFormateado = `${horas}h ${minutos}m`;
      }
      
      return {
        asignacion_id: row.asignacion_id,
        order_number: row.order_number,
        usuario_id: row.usuario_id,
        username: row.username,
        nombre_completo: row.nombre_completo,
        fecha_asignacion: row.fecha_asignacion,
        primer_logueo: row.primer_logueo,
        tipo: row.tipo,
        gap_horas: gapHoras,
        gap_minutos: gapMinutos,
        gap_segundos: gapSegundos,
        gap_formateado: gapFormateado,
        tiene_logueo: row.primer_logueo !== null && row.primer_logueo !== undefined
      };
    });

    res.json({
      success: true,
      gaps: gaps,
      total: gaps.length,
      con_logueo: gaps.filter(g => g.tiene_logueo).length,
      sin_logueo: gaps.filter(g => !g.tiene_logueo).length
    });
  } catch (error) {
    logger.error('Error al calcular gap de tiempo:', error);
    console.error('Error completo en gap-tiempo-asignacion:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      success: false,
      error: 'Error al calcular gap de tiempo', 
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ==================== FIN ENDPOINTS PARA CALCULAR GAP DE TIEMPO ====================


//==========PRINCIPIO DE LOS ENDPOINTS PARA LOS NUMEROS DE PARTE==========

// Función para asegurar que la tabla ordenes existe
async function ensureOrdenesTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS ordenes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        order_number VARCHAR(100) NOT NULL UNIQUE,
        client VARCHAR(255),
        customer_job VARCHAR(100),
        project_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'activo',
        time_worked BIGINT DEFAULT 0,
        price_usd DECIMAL(10, 2) DEFAULT 0.00,
        price_mxn DECIMAL(10, 2) DEFAULT 0.00,
        usuario_asignado INTEGER[] DEFAULT '{}',
        fecha_inicio DATE,
        fecha_limite DATE,
        fecha_aprobacion TIMESTAMP,
        fecha_fin TIMESTAMP,
        visible BOOLEAN DEFAULT FALSE,
        bom_excel VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES proyectos(id) ON DELETE CASCADE
      );
    `);
    
    // Agregar columna usuario_asignado si no existe (para tablas ya creadas)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ordenes' AND column_name = 'usuario_asignado'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN usuario_asignado INTEGER[] DEFAULT '{}';
        END IF;
      END $$;
    `);
    
    // Agregar columna fecha_inicio si no existe (para tablas ya creadas)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ordenes' AND column_name = 'fecha_inicio'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN fecha_inicio DATE;
        END IF;
      END $$;
    `);
    
    // Agregar columna fecha_limite si no existe (para tablas ya creadas)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ordenes' AND column_name = 'fecha_limite'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN fecha_limite DATE;
        END IF;
      END $$;
    `);
    
    // Agregar columna estatus si no existe (para tablas ya creadas)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ordenes' AND column_name = 'estatus'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN estatus VARCHAR(100);
        END IF;
      END $$;
    `);
    
    // Agregar columna fecha_fin si no existe (para tablas ya creadas)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ordenes' AND column_name = 'fecha_fin'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN fecha_fin TIMESTAMP;
        END IF;
      END $$;
    `);

    // Agregar columna fecha_aprobacion si no existe (para tablas ya creadas)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ordenes' AND column_name = 'fecha_aprobacion'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN fecha_aprobacion TIMESTAMP;
        END IF;
      END $$;
    `);

    // Agregar columna bom_excel si no existe (para tablas ya creadas)
    await apoyosPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ordenes' AND column_name = 'bom_excel'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN bom_excel VARCHAR(500);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ordenes' AND column_name = 'visible'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN visible BOOLEAN DEFAULT FALSE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ordenes' AND column_name = 'due'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN due DATE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ordenes' AND column_name = 'insert_forzado'
        ) THEN
          ALTER TABLE ordenes ADD COLUMN insert_forzado BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);
    
    // Crear índices si no existen
    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS idx_ordenes_project_id ON ordenes(project_id);
      CREATE INDEX IF NOT EXISTS idx_ordenes_order_number ON ordenes(order_number);
      CREATE INDEX IF NOT EXISTS idx_ordenes_status ON ordenes(status);
      CREATE INDEX IF NOT EXISTS idx_ordenes_created_at ON ordenes(created_at DESC);
    `);
    
    logger.info('Tabla ordenes verificada/creada exitosamente');
  } catch (error) {
    logger.error('Error al crear/verificar tabla ordenes:', error);
    throw error;
  }
}

// GET - Obtener todas las órdenes o números de parte
// Detecta automáticamente: si viene orden_id en query, busca en tabla numero_parte
// Si no, busca en tabla ordenes
app.get('/api/product_line', async (req, res) => {
  try {
    const columnsResult = await apoyosPool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'product_line'
       ORDER BY ordinal_position`
    );

    if (!columnsResult.rows.length) {
      return res.json([]);
    }

    const columnNames = columnsResult.rows.map(row => row.column_name);
    const excludedColumns = ['id', 'created_at', 'updated_at'];
    const valueColumnCandidates = [
      'value',
      'codigo',
      'code',
      'linea',
      'linea_producto',
      'product_line',
      'nombre',
      'name'
    ];

    const valueColumn = valueColumnCandidates.find(name => columnNames.includes(name))
      || columnNames.find(name => !excludedColumns.includes(name))
      || columnNames[0];
    const idColumn = columnNames.includes('id') ? 'id' : valueColumn;
    const descriptionColumnCandidates = ['descripcion', 'description', 'detalle', 'detail'];
    const descriptionColumn = descriptionColumnCandidates.find(
      name => columnNames.includes(name) && name !== valueColumn
    );

    const safeIdColumn = `"${idColumn.replace(/"/g, '""')}"`;
    const safeValueColumn = `"${valueColumn.replace(/"/g, '""')}"`;
    const safeDescriptionColumn = descriptionColumn
      ? `"${descriptionColumn.replace(/"/g, '""')}"`
      : null;

    const descriptionSelect = safeDescriptionColumn
      ? `, ${safeDescriptionColumn}::text AS description`
      : ', NULL::text AS description';

    const uomSelect = columnNames.includes('uom') ? ', "uom"::text AS uom' : ', NULL::text AS uom';

    const valuesQuery = `
      SELECT ${safeIdColumn} AS id, ${safeValueColumn}::text AS value${descriptionSelect}${uomSelect}
      FROM product_line
      WHERE ${safeValueColumn} IS NOT NULL
        AND TRIM(${safeValueColumn}::text) <> ''
      ORDER BY ${safeValueColumn} ASC
    `;

    const valuesResult = await apoyosPool.query(valuesQuery);
    return res.json(valuesResult.rows);
  } catch (error) {
    logger.error('Error al obtener líneas de producto:', error);
    return res.status(500).json({ error: 'Error al obtener líneas de producto' });
  }
});

app.get('/api/numero_parte', async (req, res) => {
  try {
    const { orden_id } = req.query;
    
    // Si viene orden_id, buscar en la tabla numero_parte
    if (orden_id) {
      try {
        await ensureNumeroParteTable();
        
        const ordenIdInt = parseInt(orden_id);
        if (isNaN(ordenIdInt)) {
          return res.status(400).json({ error: 'orden_id debe ser un número válido' });
        }
        
        logger.info('Obteniendo números de parte por orden_id...', { orden_id: ordenIdInt });
        
        const query = `SELECT id, numero_parte, product_line, orden_id, uom, unidades, cantidad, notas, bom_excel, created_at, updated_at
                       FROM numero_parte
                       WHERE orden_id = $1
                       ORDER BY created_at DESC`;
        
        const result = await apoyosPool.query(query, [ordenIdInt]);
        
        logger.info('Números de parte obtenidos:', result.rows.length);
        return res.json(result.rows);
      } catch (err) {
        console.log('ERROR DETALLADO al obtener números de parte por orden_id:');
        console.log('Error message:', err.message);
        console.log('Error code:', err.code);
        console.log('Error detail:', err.detail);
        console.log('Error hint:', err.hint);
        console.log('Error stack:', err.stack);
        console.log('orden_id recibido:', orden_id);
        console.log('orden_id parseado:', ordenIdInt);
        logger.error('Error al obtener números de parte por orden_id:', err);
        return res.status(500).json({ error: 'Error al obtener números de parte: ' + err.message });
      }
    }
    
    // Si no viene orden_id, usar la lógica original para órdenes
    await ensureOrdenesTable();
    
    const { project_id, include_hidden } = req.query;
    const includeHidden = ['1', 'true', 'yes', 'si'].includes(String(include_hidden || '').toLowerCase());
    logger.info('Obteniendo números de parte ...', { project_id, include_hidden: includeHidden });
    
    let query = `SELECT o.id, o.project_id, o.order_number, o.client, o.customer_job, 
         o.project_name, o.status, o.estatus, o.time_worked, o.price_usd, o.price_mxn,
      CASE WHEN o.fecha_inicio IS NULL THEN NULL ELSE to_char(o.fecha_inicio, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_inicio,
      CASE WHEN o.fecha_limite IS NULL THEN NULL ELSE to_char(o.fecha_limite, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_limite,
      o.fecha_fin, o.fecha_aprobacion, o.due, o.visible, o.insert_forzado, o.created_at, o.updated_at, COALESCE(o.usuario_asignado, ARRAY[]::INTEGER[]) as usuario_asignado, p.project_name as proyecto_nombre
       FROM ordenes o
      LEFT JOIN proyectos p ON o.project_id = p.id
      WHERE 1=1`;

    let params = [];

    if (!includeHidden) {
      query += ` AND COALESCE(o.visible, FALSE) = FALSE`;
    }

    if (project_id) {
      params.push(project_id);
      query += ` AND o.project_id = $${params.length}`;
    }
    
    query += ` ORDER BY o.created_at DESC`;
    
    const result = await apoyosPool.query(query, params);
    
    // Obtener usuarios asignados a cada orden desde la columna usuario_asignado (array de IDs)
    for (let order of result.rows) {
      try {
        // Si la orden tiene usuarios_asignado (array de IDs), obtener los datos de esos usuarios
        if (order.usuario_asignado && Array.isArray(order.usuario_asignado) && order.usuario_asignado.length > 0) {
          const usuariosQuery = await apoyosPool.query(
            `SELECT id, username, nombre_completo, foto_url
             FROM usuarios 
             WHERE id = ANY($1::int[])`,
            [order.usuario_asignado]
          );
          order.usuarios_asignados = usuariosQuery.rows.map(u => ({
            id: u.id,
            username: u.username,
            nombre_completo: u.nombre_completo || u.username,
            foto_url: u.foto_url || null
          }));
        } else {
          order.usuarios_asignados = [];
        }
      } catch (err) {
        logger.error(`Error al obtener usuarios asignados para orden ${order.order_number}:`, err);
        order.usuarios_asignados = [];
      }
    }
    
    logger.info('Números de parte obtenidos:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error al obtener números de parte:', error);
    res.status(500).json({ error: 'Error al obtener números de parte' });
  }
});

// GET - Obtener una orden por ID
app.get('/api/numero_parte/:id', async (req, res) => {
  try {
    // Asegurar que la tabla existe
    await ensureOrdenesTable();
    
    const { id } = req.params;
    const result = await apoyosPool.query(
      `SELECT o.id, o.project_id, o.order_number, o.client, o.customer_job, 
           o.project_name, o.status, o.time_worked, o.price_usd, o.price_mxn,
           CASE WHEN o.fecha_inicio IS NULL THEN NULL ELSE to_char(o.fecha_inicio, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_inicio,
           CASE WHEN o.fecha_limite IS NULL THEN NULL ELSE to_char(o.fecha_limite, 'YYYY-MM-DD HH24:MI:SS') END AS fecha_limite,
         o.insert_forzado, o.created_at, o.updated_at, COALESCE(o.usuario_asignado, ARRAY[]::INTEGER[]) as usuario_asignado, p.project_name as proyecto_nombre
        FROM ordenes o
        LEFT JOIN proyectos p ON o.project_id = p.id
        WHERE o.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Número de parte no encontrado' });
    }
    
    const order = result.rows[0];
    
    // Obtener usuarios asignados a esta orden desde la columna usuario_asignado (array de IDs)
    try {
      if (order.usuario_asignado && Array.isArray(order.usuario_asignado) && order.usuario_asignado.length > 0) {
        const usuariosQuery = await apoyosPool.query(
          `SELECT id, username, nombre_completo 
           FROM usuarios 
           WHERE id = ANY($1::int[])`,
          [order.usuario_asignado]
        );
        order.usuarios_asignados = usuariosQuery.rows.map(u => ({
          id: u.id,
          username: u.username,
          nombre_completo: u.nombre_completo || u.username
        }));
      } else {
        order.usuarios_asignados = [];
      }
    } catch (err) {
      logger.error(`Error al obtener usuarios asignados para orden ${order.order_number}:`, err);
      order.usuarios_asignados = [];
    }
    
    res.json(order);
  } catch (error) {
    logger.error('Error al obtener número de parte:', error);
    res.status(500).json({ error: 'Error al obtener número de parte' });
  }
});

// POST - Crear una nueva orden o número de parte
// Detecta automáticamente: si viene numero_parte en body (sin project_id), crea en tabla numero_parte
// Si viene project_id, crea en tabla ordenes
app.post('/api/numero_parte', async (req, res) => {
  try {
    const { numero_parte, product_line, orden_id, uom, unidades, cantidad, notas, bom_excel, project_id, order_number } = req.body;
    
    // Si viene numero_parte (y no project_id), crear en la tabla numero_parte
    if (numero_parte && !project_id) {
      try {
        await ensureNumeroParteTable();
        
        if (!uom) {
          return res.status(400).json({ error: 'Falta el campo requerido: uom' });
        }
        if (!product_line || !String(product_line).trim()) {
          return res.status(400).json({ error: 'Falta el campo requerido: product_line' });
        }

        // Validar y convertir orden_id si viene
        let ordenIdValue = null;
        if (orden_id !== undefined && orden_id !== null && orden_id !== '') {
          ordenIdValue = parseInt(orden_id);
          if (isNaN(ordenIdValue)) {
            return res.status(400).json({ error: 'orden_id debe ser un número válido' });
          }
        }

        // Si la base de datos requiere orden_id NOT NULL, validar su presencia
        if (ordenIdValue === null) {
          return res.status(400).json({ error: 'Falta el campo requerido: orden_id' });
        }

        logger.info('Creando nuevo número de parte:', { numero_parte, product_line, orden_id: ordenIdValue, uom, unidades, cantidad, notas });
        
        const insertResult = await apoyosPool.query(
          `INSERT INTO numero_parte (numero_parte, product_line, orden_id, uom, unidades, cantidad, notas, bom_excel)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, numero_parte, product_line, orden_id, uom, unidades, cantidad, notas, bom_excel, created_at, updated_at`,
          [numero_parte, product_line, ordenIdValue, uom, unidades || null, cantidad || null, notas || null, bom_excel || null]
        );

        logger.info('Número de parte creado exitosamente');
        return res.status(201).json({ 
          success: true, 
          id: insertResult.rows[0].id,
          ...insertResult.rows[0]
        });
      } catch (err) {
        console.log('ERROR DETALLADO al crear número de parte:');
        console.log('Error message:', err.message);
        console.log('Error code:', err.code);
        console.log('Error detail:', err.detail);
        console.log('Error hint:', err.hint);
        console.log('Error stack:', err.stack);
        console.log('Datos recibidos:', { numero_parte, orden_id: ordenIdValue, uom, unidades, cantidad });
        logger.error('Error al crear número de parte:', err);
        if (err.code === '23505') { // Unique constraint violation
          return res.status(400).json({ error: 'El número de parte ya existe' });
        }
        if (err.code === '23503') { // Foreign key violation
          return res.status(400).json({ error: 'La orden especificada no existe' });
        }
        return res.status(500).json({ error: 'Error al crear el número de parte: ' + err.message });
      }
    }
    
    // Si viene project_id, usar la lógica original para órdenes
    await ensureOrdenesTable();
    
    if (!project_id || !order_number) {
      return res.status(400).json({ error: 'Faltan datos requeridos: project_id y order_number' });
    }

    logger.info('Creando nuevo número de parte:', { project_id, order_number });
    
    // Verificar que el proyecto existe
    const projectResult = await apoyosPool.query(
      'SELECT * FROM proyectos WHERE id = $1',
      [project_id]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    const project = projectResult.rows[0];

    // Crear la orden en la tabla ordenes
    const insertResult = await apoyosPool.query(
      `INSERT INTO ordenes (project_id, order_number, client, customer_job, project_name, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, order_number, project_name, client, status`,
      [project_id, order_number, project.client, project.customer_job, project.project_name, 'activo']
    );

    logger.info('Orden creada exitosamente');
    res.status(201).json({ 
      success: true, 
      message: 'Orden creada correctamente',
      order: insertResult.rows[0] 
    });
  } catch (error) {
    logger.error('Error al crear número de parte:', error);
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'El número de parte ya existe' });
    }
    // Devolver detalle del error temporalmente para depuración local
    return res.status(500).json({ error: 'Error al crear el número de parte', detail: error.message || null, code: error.code || null });
  }
});

// PUT - Actualizar una orden o número de parte
// Detecta automáticamente: si viene numero_parte, uom o orden_id en body, actualiza en tabla numero_parte
// Si no, actualiza en tabla ordenes
app.put('/api/numero_parte/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { numero_parte, product_line, orden_id, uom, unidades, cantidad, notas, bom_excel, order_number, status, time_worked, price_usd, price_mxn } = req.body;
    
    // Si viene numero_parte, uom o orden_id en el body, actualizar en la tabla numero_parte
    if (numero_parte !== undefined || product_line !== undefined || uom !== undefined || orden_id !== undefined) {
      await ensureNumeroParteTable();

      if (product_line !== undefined && !String(product_line).trim()) {
        return res.status(400).json({ error: 'product_line no puede estar vacío' });
      }

      const result = await apoyosPool.query(
        `UPDATE numero_parte
         SET 
             numero_parte = COALESCE($1, numero_parte),
             product_line = COALESCE($2, product_line),
             orden_id = COALESCE($3, orden_id),
             uom = COALESCE($4, uom),
             unidades = COALESCE($5, unidades),
             cantidad = COALESCE($6, cantidad),
             notas = COALESCE($7, notas),
             bom_excel = COALESCE($8, bom_excel),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $9
         RETURNING id, numero_parte, product_line, orden_id, uom, unidades, cantidad, notas, bom_excel, created_at, updated_at`,
        [numero_parte, product_line, orden_id, uom, unidades, cantidad, notas, bom_excel, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Número de parte no encontrado' });
      }

      logger.info('Número de parte actualizado exitosamente');
      return res.json({ 
        success: true,
        ...result.rows[0]
      });
    }
    
    // Si no viene numero_parte, usar la lógica original para órdenes
    await ensureOrdenesTable();

    const result = await apoyosPool.query(
      `UPDATE ordenes
       SET 
           order_number = COALESCE($1, order_number),
           status = COALESCE($2, status),
           time_worked = COALESCE($3, time_worked),
           price_usd = COALESCE($4, price_usd),
           price_mxn = COALESCE($5, price_mxn),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [order_number, status, time_worked, price_usd, price_mxn, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Número de parte no encontrado' });
    }

    logger.info('Número de parte actualizado exitosamente');
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al actualizar número de parte:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'El número de parte ya existe' });
    }
    res.status(500).json({ error: 'Error al actualizar el número de parte' });
  }
});

// PUT - Actualizar usuarios asignados a una orden
app.put('/api/numero_parte/:id/usuarios', async (req, res) => {
  try {
    // Asegurar que la tabla existe
    await ensureOrdenesTable();
    
    const { id } = req.params;
    const { usuario_asignado } = req.body; // Array de IDs de usuarios

    // Validar que usuario_asignado sea un array
    if (!Array.isArray(usuario_asignado)) {
      return res.status(400).json({ error: 'usuario_asignado debe ser un array de IDs' });
    }

    // Convertir a array de enteros y eliminar duplicados
    const userIds = [...new Set(usuario_asignado.map(id => parseInt(id)).filter(id => !isNaN(id)))];

    // Obtener usuarios asignados anteriores para detectar nuevos
    const orderBefore = await apoyosPool.query(
      'SELECT usuario_asignado FROM ordenes WHERE id = $1',
      [id]
    );
    const previousUserIds = orderBefore.rows.length > 0 && orderBefore.rows[0].usuario_asignado 
      ? orderBefore.rows[0].usuario_asignado 
      : [];

    const result = await apoyosPool.query(
      `UPDATE ordenes
       SET usuario_asignado = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, order_number, usuario_asignado`,
      [userIds, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    // Crear tabla de asignaciones si no existe
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS asignaciones_ordenes (
        id SERIAL PRIMARY KEY,
        orden_id INTEGER,
        submittal_id INTEGER,
        order_number VARCHAR(100) NOT NULL,
        usuario_id INTEGER NOT NULL,
        fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tipo VARCHAR(20) DEFAULT 'orden',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(orden_id, usuario_id, tipo),
        UNIQUE(submittal_id, usuario_id, tipo)
      )
    `);

    // Registrar nuevas asignaciones (usuarios que no estaban antes)
    const newUserIds = userIds.filter(uid => !previousUserIds.includes(uid));
    if (newUserIds.length > 0) {
      const order = result.rows[0];
      for (const userId of newUserIds) {
        await apoyosPool.query(
          `INSERT INTO asignaciones_ordenes (orden_id, order_number, usuario_id, tipo, fecha_asignacion)
           VALUES ($1, $2, $3, 'orden', CURRENT_TIMESTAMP)
           ON CONFLICT (orden_id, usuario_id, tipo) DO NOTHING`,
          [id, order.order_number, userId]
        );
      }
    }

    // Obtener información completa de los usuarios asignados
    const order = result.rows[0];
    let usuariosAsignados = [];
    
    if (order.usuario_asignado && order.usuario_asignado.length > 0) {
      const usuariosQuery = await apoyosPool.query(
        `SELECT id, username, nombre_completo 
         FROM usuarios 
         WHERE id = ANY($1::int[])`,
        [order.usuario_asignado]
      );
      usuariosAsignados = usuariosQuery.rows.map(u => ({
        id: u.id,
        username: u.username,
        nombre_completo: u.nombre_completo || u.username
      }));
    }

    logger.info(`Usuarios asignados actualizados para orden ${id}:`, userIds);
    res.json({ 
      success: true,
      message: 'Usuarios asignados actualizados correctamente',
      usuario_asignado: userIds,
      usuarios_asignados: usuariosAsignados
    });
  } catch (error) {
    logger.error('Error al actualizar usuarios asignados:', error);
    res.status(500).json({ error: 'Error al actualizar usuarios asignados' });
  }
});

// Función para asegurar que la tabla numero_parte existe
async function ensureNumeroParteTable() {
  try {
    // Crear tabla si no existe
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS numero_parte (
        id SERIAL PRIMARY KEY,
        numero_parte VARCHAR(200) NOT NULL,
        product_line VARCHAR(200),
        orden_id INTEGER,
        uom VARCHAR(100),
        unidades VARCHAR(100),
        cantidad VARCHAR(100),
        notas TEXT,
        bom_excel VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Asegurar columnas requeridas (para tablas ya existentes con otro esquema)
    // Usar DO block para manejar errores de columnas que ya existen
    try {
      await apoyosPool.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'orden_id') THEN
            ALTER TABLE numero_parte ADD COLUMN orden_id INTEGER;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'product_line') THEN
            ALTER TABLE numero_parte ADD COLUMN product_line VARCHAR(200);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'uom') THEN
            ALTER TABLE numero_parte ADD COLUMN uom VARCHAR(100);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'unidades') THEN
            ALTER TABLE numero_parte ADD COLUMN unidades VARCHAR(100);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'cantidad') THEN
            ALTER TABLE numero_parte ADD COLUMN cantidad VARCHAR(100);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'notas') THEN
            ALTER TABLE numero_parte ADD COLUMN notas TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'bom_excel') THEN
            ALTER TABLE numero_parte ADD COLUMN bom_excel VARCHAR(500);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'created_at') THEN
            ALTER TABLE numero_parte ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numero_parte' AND column_name = 'updated_at') THEN
            ALTER TABLE numero_parte ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
          END IF;
        END $$;
      `);
    } catch (alterError) {
      // Si el DO block falla, intentar con ALTER TABLE directo (más compatible)
      logger.warn('Error con DO block, intentando ALTER TABLE directo:', alterError.message);
      try {
        await apoyosPool.query(`
          ALTER TABLE numero_parte 
            ADD COLUMN IF NOT EXISTS orden_id INTEGER,
            ADD COLUMN IF NOT EXISTS product_line VARCHAR(200),
            ADD COLUMN IF NOT EXISTS uom VARCHAR(100),
            ADD COLUMN IF NOT EXISTS unidades VARCHAR(100),
            ADD COLUMN IF NOT EXISTS cantidad VARCHAR(100),
            ADD COLUMN IF NOT EXISTS notas TEXT,
            ADD COLUMN IF NOT EXISTS bom_excel VARCHAR(500),
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);
      } catch (alterError2) {
        logger.warn('Error con ALTER TABLE IF NOT EXISTS (puede ser que las columnas ya existan):', alterError2.message);
        // Continuar, las columnas probablemente ya existen
      }
    }

    // Normalizar tipos de columnas bom_excel la texto, para evitar
    // errores de "tipos de dato inconsistentes" en parámetros de consultas.
    try {
      await apoyosPool.query(`
        ALTER TABLE numero_parte
          ALTER COLUMN bom_excel TYPE VARCHAR(500) USING bom_excel::VARCHAR(500);
      `);
    } catch (typeErr1) {
      logger.warn('No se pudo normalizar tipo de columna bom_excel (puede ser esperado si ya es VARCHAR):', typeErr1.message);
    }
    
    // Crear índices si no existen
    try {
      await apoyosPool.query(`
        CREATE INDEX IF NOT EXISTS idx_numero_parte_orden_id ON numero_parte(orden_id);
        CREATE INDEX IF NOT EXISTS idx_numero_parte_numero ON numero_parte(numero_parte);
        CREATE INDEX IF NOT EXISTS idx_numero_parte_created_at ON numero_parte(created_at DESC);
      `);
    } catch (indexError) {
      console.log('ERROR DETALLADO al crear índices:');
      console.log('Error message:', indexError.message);
      console.log('Error code:', indexError.code);
      console.log('Error detail:', indexError.detail);
      console.log('Error hint:', indexError.hint);
      logger.warn('Error al crear índices (pueden ya existir):', indexError.message);
      // Continuar, los índices probablemente ya existen
    }
    
    logger.info('Tabla numero_parte verificada/creada exitosamente');
  } catch (error) {
    console.log('ERROR DETALLADO al verificar/crear tabla numero_parte:');
    console.log('Error message:', error.message);
    console.log('Error code:', error.code);
    console.log('Error detail:', error.detail);
    console.log('Error hint:', error.hint);
    console.log('Error stack:', error.stack);
    logger.error('Error al verificar/crear tabla numero_parte:', error);
    throw error;
  }
}

// DELETE - Eliminar un número de parte (detecta si es de tabla numero_parte o ordenes)
app.delete('/api/numero_parte/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Intentar primero en numero_parte
    try {
      await ensureNumeroParteTable();
      const result = await apoyosPool.query(
        'DELETE FROM numero_parte WHERE id = $1 RETURNING *',
        [id]
      );
      
      if (result.rows.length > 0) {
        logger.info('Número de parte eliminado exitosamente');
        return res.json({ 
          success: true,
          message: 'Número de parte eliminado exitosamente', 
          ...result.rows[0] 
        });
      }
    } catch (err) {
      // Si falla, continuar con la lógica de ordenes
    }
    
    // Si no se encontró en numero_parte, intentar en ordenes
    await ensureOrdenesTable();
    const result = await apoyosPool.query(
      'DELETE FROM ordenes WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Número de parte no encontrado' });
    }

    logger.info('Número de parte eliminada exitosamente');
    res.json({ message: 'Número de parte eliminada exitosamente', orden: result.rows[0] });
  } catch (error) {
    logger.error('Error al eliminar número de parte:', error);
    res.status(500).json({ error: 'Error al eliminar la orden' });
  }
});




// ==================== FIN ENDPOINTS PARA ÓRDENES PM ====================

// Ruta de prueba simple para diagnosticar problemas
app.get('/api/test', async (req, res) => {
    try {
        const result = await apoyosPool.query('SELECT 1 as test');
        res.json({ success: true, message: 'Conexión a BD exitosa', data: result.rows[0] });
    } catch (error) {
        console.error('Error en prueba de conexión:', error);
        res.status(500).json({ 
            error: 'Error de conexión a BD',
            message: error.message,
            stack: error.stack
        });
    }
});

// Ruta de prueba simple para diagnosticar problemas
app.get('/api/test', async (req, res) => {
    try {
        const result = await apoyosPool.query('SELECT 1 as test');
        res.json({ success: true, message: 'Conexión a BD exitosa', data: result.rows[0] });
    } catch (error) {
        console.error('Error en prueba de conexión:', error);
        res.status(500).json({ 
            error: 'Error de conexión a BD',
            message: error.message,
            stack: error.stack
        });
    }
});

// Ruta de prueba simple para diagnosticar problemas
app.get('/api/test', async (req, res) => {
    try {
        const result = await apoyosPool.query('SELECT 1 as test');
        res.json({ success: true, message: 'Conexión a BD exitosa', data: result.rows[0] });
    } catch (error) {
        console.error('Error en prueba de conexión:', error);
        res.status(500).json({ 
            error: 'Error de conexión a BD',
            message: error.message,
            stack: error.stack
        });
    }
});

// Ruta de autenticación
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const startedAt = Date.now();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const reqId = req.id;
    
    if (!username || !password) {
        const durationMs = Date.now() - startedAt;
        logger.warn({
            tag: 'AUTH_LOGIN',
            outcome: 'bad_request',
            reason: 'missing_fields',
            username,
            statusCode: 400,
            durationMs,
            ip,
            userAgent,
            reqId
        }, 'Login bad request');
        return res.status(400).json({
            success: false,
            error: 'Datos incompletos',
            message: 'Se requieren usuario y contraseña'
        });
    }

    try {
        const client = await apoyosPool.connect();
        const result = await client.query(
            'SELECT id, nombre_completo, username, rol FROM usuarios WHERE username = $1 AND password = $2 AND activo = true',
            [username, password]
        );
        client.release();

        if (result.rows.length > 0) {
            const user = result.rows[0];
            
            // Actualizar último acceso
            await apoyosPool.query(
                'UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = $1',
                [user.id]
            );

          // Regenerar la sesión para que cada login tenga un session_id nuevo
          await new Promise((resolve, reject) => {
            req.session.regenerate(err => {
              if (err) return reject(err);
              // Guardar información mínima en la sesión para las rutas protegidas
              req.session.userId = user.id;
              req.session.username = user.username;
              req.session.rol = user.rol;
              req.session.nombreCompleto = user.nombre_completo;
              resolve();
            });
          });

          // Asegurar que la sesión se persista antes de responder
          await new Promise((resolve, reject) => {
            req.session.save(err => err ? reject(err) : resolve());
          });

          // Registrar inicio de sesión en la tabla de sesiones
          try {
            const sessionId = req.sessionID;

            await apoyosPool.query(
              `UPDATE sesiones
                 SET activo = false, fin = NOW(), updated_at = NOW()
               WHERE usuario_id = $1 AND activo = true AND session_id <> $2`,
              [user.id, sessionId]
            );

            await apoyosPool.query(
              `INSERT INTO sesiones (
                 usuario_id, username, session_id, ip, user_agent, inicio, ultima_actividad, minutos_acumulados, activo, created_at, updated_at
               ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 0, true, NOW(), NOW())
               ON CONFLICT (session_id) DO UPDATE
               SET usuario_id = EXCLUDED.usuario_id,
                   username = EXCLUDED.username,
                   ip = EXCLUDED.ip,
                   user_agent = EXCLUDED.user_agent,
                   inicio = EXCLUDED.inicio,
                   ultima_actividad = EXCLUDED.ultima_actividad,
                   minutos_acumulados = EXCLUDED.minutos_acumulados,
                   activo = EXCLUDED.activo,
                   updated_at = NOW();`,
              [user.id, user.username, sessionId, ip, userAgent]
            );
          } catch (sessionError) {
            logger.warn({
              tag: 'AUTH_LOGIN',
              message: 'No se pudo registrar la sesión en la tabla sesiones',
              error: sessionError?.message
            });
          }

            const durationMs = Date.now() - startedAt;
            logger.info({
                tag: 'AUTH_LOGIN',
                outcome: 'success',
                username: user.username,
                userId: user.id,
                rol: user.rol,
                statusCode: 200,
                durationMs,
                ip,
                userAgent,
                reqId
            }, 'Login successful');

              // JWT para endpoints que permiten autenticacion por token ademas de sesion.
              const token = jwt.sign(
                {
                  userId: user.id,
                  username: user.username,
                  rol: user.rol
                },
                JWT_SECRET,
                { expiresIn: '8h' }
              );

            res.json({
                success: true,
                user: {
                    id: user.id,
                    nombre_completo: user.nombre_completo,
                    username: user.username,
                    rol: user.rol
                },
                token
            });
        } else {
            const durationMs = Date.now() - startedAt;
            logger.warn({
                tag: 'AUTH_LOGIN',
                outcome: 'invalid_credentials',
                username,
                statusCode: 401,
                durationMs,
                ip,
                userAgent,
                reqId
            }, 'Login failed: invalid credentials or inactive user');
            res.status(401).json({
                success: false,
                message: 'Credenciales incorrectas o usuario inactivo'
            });
        }
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        logger.error({
            tag: 'AUTH_LOGIN',
            outcome: 'error',
            username,
            statusCode: 500,
            durationMs,
            ip,
            userAgent,
            reqId,
            errMessage: error?.message,
            errStack: error?.stack
        }, 'Login error');
        res.status(500).json({
            success: false,
            message: 'Error al autenticar usuario'
        });
    }
});

// Endpoint para registrar actividad de sesión (para sincronizar minutos acumulados)
app.post('/api/session-activity', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }

    const sessionId = req.sessionID;
    const userId = req.session.userId;
    const username = req.session.username || 'Anonimo';
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Actualizar o insertar la actividad de sesión
    const result = await apoyosPool.query(
      `UPDATE sesiones
       SET ultima_actividad = NOW(),
           fin = NOW(),
           minutos_acumulados = GREATEST(
             COALESCE(minutos_acumulados, 0),
             FLOOR(EXTRACT(EPOCH FROM (NOW() - inicio)) / 60)
           ),
           ip = COALESCE($2, ip),
           user_agent = COALESCE($3, user_agent),
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING id, usuario_id, minutos_acumulados, activo`,
      [sessionId, ip, userAgent]
    );

    if (result.rowCount === 0) {
      // Si no existe, insertar nuevo registro
      await apoyosPool.query(
        `INSERT INTO sesiones (
           usuario_id, username, session_id, ip, user_agent, inicio, ultima_actividad, minutos_acumulados, activo, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 0, true, NOW(), NOW())`,
        [userId, username, sessionId, ip, userAgent]
      );
    }

    res.json({ 
      success: true, 
      message: 'Actividad de sesión registrada',
      sessionId,
      userId
    });
  } catch (error) {
    logger.error('Error al registrar actividad de sesión:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al registrar actividad de sesión',
      message: error.message 
    });
  }
});

// Ruta para obtener todos los usuarios
app.get('/api/usuarios', async (req, res) => {
    try {
        // Asegurar que la columna es_diseno exista (para filtrar usuarios de diseño)
        try {
            await apoyosPool.query(
                "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS es_diseno BOOLEAN DEFAULT false"
            );
        } catch (alterErr) {
            console.log('Nota: no se pudo asegurar la columna es_diseno en usuarios:', alterErr.message);
        }

        const result = await apoyosPool.query(`
          SELECT 
            id, 
            nombre_completo, 
            username,
            numero_empleado,
            rol, 
            fecha_creacion, 
            ultimo_acceso, 
            activo,
            COALESCE(es_diseno, false) AS es_diseno,
            foto_url,
            orden_en_logeo,
            estado_en_orden,
            estado_trabajo,
            inicio_sesion,
            CASE 
              WHEN inicio_sesion IS NOT NULL 
              THEN GREATEST(EXTRACT(EPOCH FROM (NOW() - inicio_sesion))::INTEGER, 0)
              ELSE 0
            END as tiempo_en_orden_segundos
          FROM usuarios 
          ORDER BY id
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ 
            error: 'Error al consultar los usuarios',
            message: error.message
        });
    }
});

// Ruta para obtener usuarios de IT (DEBE IR ANTES DE /:id)
app.get('/api/usuarios/it', async (req, res) => {
    try {
        const result = await apoyosPool.query(
            "SELECT id, nombre_completo, username FROM usuarios WHERE rol = 'IT' AND activo = true ORDER BY nombre_completo"
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios de IT:', error);
        res.status(500).json({ 
            error: 'Error al consultar los usuarios de IT',
            message: error.message
        });
    }
});

// Ruta para obtener usuarios de Diseño (DEBE IR ANTES DE /:id)
app.get('/api/usuarios/diseno', async (req, res) => {
    try {
        // Asegurar que la columna es_diseno exista
        try {
            await apoyosPool.query(
                "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS es_diseno BOOLEAN DEFAULT false"
            );
        } catch (alterErr) {
            console.log('Nota: no se pudo asegurar la columna es_diseno en usuarios (ruta /diseno):', alterErr.message);
        }

        const result = await apoyosPool.query(
            "SELECT id, nombre_completo as nombre, username, rol, activo, COALESCE(es_diseno, false) AS es_diseno FROM usuarios WHERE COALESCE(es_diseno, false) = true AND (activo = true OR activo IS NULL) ORDER BY nombre_completo"
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios de Diseño:', error);
        res.status(500).json({ 
            error: 'Error al consultar los usuarios de Diseño',
            message: error.message
        });
    }
});

// Middleware para verificar JWT
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Espera "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token no proporcionado' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error('Error al verificar JWT:', err.message);
      return res.status(403).json({ success: false, error: 'Token inválido o expirado' });
    }
    req.user = decoded; // Guardar datos decodificados
    next();
  });
}

// Perfil del empleado logeado: usa usuarios.numero_empleado para buscar en empleados
app.get('/api/employees/me', async (req, res) => {
  try {
    let username = (req.session && req.session.username)
      ? String(req.session.username).trim()
      : '';

    if (!username) {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          username = String(decoded?.username || '').trim();
        } catch (jwtError) {
          // Si el JWT no es válido, seguimos con username vacío para devolver 401
        }
      }
    }

    if (!username) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no autenticado'
      });
    }

    const userResult = await apoyosPool.query(
      `SELECT id, username, nombre_completo, rol, numero_empleado
       FROM usuarios
       WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
       LIMIT 1`,
      [username]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    const user = userResult.rows[0];
    const numeroEmpleado = String(user.numero_empleado || '').trim();

    let employee = null;

    if (numeroEmpleado) {
      const employeeByNumberResult = await apoyosPool.query(
        `SELECT *
         FROM usuarios
         WHERE id::text = $1 OR numero_empleado::text = $1
         LIMIT 1`,
        [numeroEmpleado]
      );
      if (employeeByNumberResult.rowCount > 0) {
        employee = employeeByNumberResult.rows[0];
      }
    }

    if (!employee) {
      const employeeByNameResult = await apoyosPool.query(
        `SELECT *
         FROM usuarios
         WHERE LOWER(TRIM(nombre_completo)) = LOWER(TRIM($1))
            OR LOWER(TRIM(COALESCE(username, ''))) = LOWER(TRIM($2))
         LIMIT 1`,
        [user.nombre_completo || '', user.username || '']
      );

      if (employeeByNameResult.rowCount > 0) {
        employee = employeeByNameResult.rows[0];
      }
    }

    const mergedEmployee = {
      ...(employee || {}),
      usuario: (employee && (employee.usuario || employee.username)) ? (employee.usuario || employee.username) : user.username,
      username: user.username,
      rol: user.rol,
      numero_empleado: numeroEmpleado || (employee ? employee.numero_empleado : null),
      nombre_completo: (employee && employee.nombre_completo)
        ? employee.nombre_completo
        : user.nombre_completo,
      fecha_cumpleanos: employee ? (employee.fecha_cumpleanos || null) : null,
      telefono_emergencia: employee ? (employee.telefono_emergencia || null) : null,
      correo: (employee && (employee.correo || employee.email))
        ? (employee.correo || employee.email)
        : null,
      email: (employee && (employee.email || employee.correo))
        ? (employee.email || employee.correo)
        : null
    };

    return res.json({
      success: true,
      employee: mergedEmployee
    });
  } catch (error) {
    console.error('Error al obtener el perfil del empleado logeado:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener el perfil del empleado',
      message: error.message
    });
  }
});

app.patch('/api/employees/change-password', async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Debes enviar la contraseña actual y la nueva contraseña'
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        error: 'La nueva contraseña debe ser diferente a la actual'
      });
    }

    let username = (req.session && req.session.username)
      ? String(req.session.username).trim()
      : '';

    if (!username) {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          username = String(decoded?.username || '').trim();
        } catch (jwtError) {
          // Se deja vacío para responder 401.
        }
      }
    }

    if (!username) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no autenticado'
      });
    }

    const userResult = await apoyosPool.query(
      `SELECT id, username, password
       FROM usuarios
       WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
       LIMIT 1`,
      [username]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    const user = userResult.rows[0];

    if (String(user.password || '') !== currentPassword) {
      return res.status(401).json({
        success: false,
        error: 'La contraseña actual no es correcta'
      });
    }

    await apoyosPool.query(
      `UPDATE usuarios
       SET password = $1
       WHERE id = $2`,
      [newPassword, user.id]
    );

    return res.json({
      success: true,
      message: 'Contrasena actualizada correctamente'
    });
  } catch (error) {
    console.error('Error al cambiar contraseña del usuario logeado:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al actualizar la contraseña',
      message: error.message
    });
  }
});

// Cambiar contraseña por id (verifica la contraseña actual)
app.patch('/api/usuarios/:id/change-password', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!id || !currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Faltan parámetros (id, currentPassword, newPassword)' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, error: 'La nueva contraseña debe ser diferente a la actual' });
    }

    const userResult = await apoyosPool.query(
      `SELECT id, password FROM usuarios WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    const user = userResult.rows[0];
    if (String(user.password || '') !== currentPassword) {
      return res.status(401).json({ success: false, error: 'La contraseña actual no es correcta' });
    }

    await apoyosPool.query(`UPDATE usuarios SET password = $1 WHERE id = $2`, [newPassword, id]);

    return res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error al cambiar contraseña por id:', error);
    return res.status(500).json({ success: false, error: 'Error al actualizar la contraseña', message: error.message });
  }
});

// Registrar logeo de Diseño en tiempo_diseno
app.post('/api/diseno/login', async (req, res) => {
  try {
    console.log('\n========== NUEVO LOGEO DE DISEÑO ==========');
    console.log(' Datos recibidos en el servidor:', JSON.stringify(req.body, null, 2));
    console.log('Content-Type:', req.headers['content-type']);
    
    const { partNumber, orderNumber, orden = null, cliente = null } = req.body || {};
    const username = req.body?.username;

    console.log(' Extrayendo datos:');
    console.log('  - partNumber:', partNumber);
    console.log('  - orderNumber:', orderNumber);
    console.log('  - orden:', orden);
    console.log('  - cliente:', cliente);
    console.log('  - username:', username);

    if (!partNumber) {
      console.error('ERROR: Falta el número de parte');
      return res.status(400).json({ success: false, error: 'Falta el número de parte' });
    }

    if (!orderNumber) {
      console.error('ERROR: Falta el número de orden');
      return res.status(400).json({ success: false, error: 'Debes ingresar un número de orden' });
    }

    if (!username) {
      console.error(' ERROR: No se pudo determinar el usuario');
      return res.status(400).json({ success: false, error: 'No se pudo determinar el usuario' });
    }

    const usernameRaw = (username || '').toString().trim();
    const usernameCandidateSet = new Set();
    if (usernameRaw) {
      usernameCandidateSet.add(usernameRaw.toLowerCase());
      if (usernameRaw.includes('\\')) {
        usernameCandidateSet.add(usernameRaw.split('\\').pop().toLowerCase());
      }
      if (usernameRaw.includes('@')) {
        usernameCandidateSet.add(usernameRaw.split('@')[0].toLowerCase());
      }
    }
    const usernameCandidates = [...usernameCandidateSet].filter(Boolean);

    let normalizedUsername = usernameRaw;
    if (usernameCandidates.length > 0) {
      try {
        const userMatch = await apoyosPool.query(
          `SELECT username
             FROM usuarios
            WHERE LOWER(TRIM(username)) = ANY($1::text[])
            LIMIT 1`,
          [usernameCandidates]
        );

        if (userMatch.rowCount > 0 && userMatch.rows[0].username) {
          normalizedUsername = userMatch.rows[0].username;
        }
      } catch (normalizeError) {
        console.warn('No se pudo normalizar username en /api/diseno/login:', normalizeError.message);
      }
    }

    // Validar que el número de orden exista en proyectos, ordenes, numero_parte o submittals y obtener orden_id
    console.log('Validando número de orden...');
    console.log('  - orderNumber recibido:', JSON.stringify(orderNumber));
    let ordenId = null;
    
    // Limpiar el orderNumber (trim y normalizar)
    const orderNumberClean = (orderNumber || '').trim();
    console.log('  - orderNumber limpio:', JSON.stringify(orderNumberClean));
    
    const orderCheckProyectos = await apoyosPool.query(
      'SELECT order_number FROM proyectos WHERE TRIM(order_number) = $1 LIMIT 1',
      [orderNumberClean]
    );
    
    const orderCheckOrdenes = await apoyosPool.query(
      'SELECT id, order_number FROM ordenes WHERE TRIM(order_number) = $1 LIMIT 1',
      [orderNumberClean]
    );

    // Buscar también en la tabla numero_parte
    let orderCheckNumeroParte = { rowCount: 0, rows: [] };
    try {
      await ensureNumeroParteTable();
      orderCheckNumeroParte = await apoyosPool.query(
        'SELECT orden_id FROM numero_parte WHERE TRIM(numero_parte) = $1 LIMIT 1',
        [orderNumberClean]
      );
    } catch (err) {
      console.warn('Error al buscar en numero_parte:', err.message);
    }

    // Buscar también en la tabla submittals
    let orderCheckSubmittals = { rowCount: 0, rows: [] };
    try {
      await ensureSubmittalsTable();
      orderCheckSubmittals = await apoyosPool.query(
        'SELECT id, submittal_number FROM submittals WHERE TRIM(submittal_number) = $1 LIMIT 1',
        [orderNumberClean]
      );
    } catch (err) {
      console.warn('Error al buscar en submittals:', err.message);
    }

    console.log('  - Resultado en proyectos:', orderCheckProyectos.rowCount);
    console.log('  - Resultado en ordenes:', orderCheckOrdenes.rowCount);
    console.log('  - Resultado en numero_parte:', orderCheckNumeroParte.rowCount);
    console.log('  - Resultado en submittals:', orderCheckSubmittals.rowCount);

    if (orderCheckProyectos.rowCount === 0 && orderCheckOrdenes.rowCount === 0 && orderCheckNumeroParte.rowCount === 0 && orderCheckSubmittals.rowCount === 0) {
      console.error('ERROR: Número de orden no válido');
      console.error('  - orderNumber buscado:', JSON.stringify(orderNumberClean));
      return res.status(400).json({ 
        success: false, 
        error: 'El número de orden ingresado no existe en proyectos, órdenes, números de parte ni submittals' 
      });
    }

    // Si existe en ordenes, obtener el orden_id
    if (orderCheckOrdenes.rowCount > 0) {
      ordenId = orderCheckOrdenes.rows[0].id;
      console.log(' Orden encontrada en tabla ordenes, orden_id:', ordenId);
    } 
    // Si existe en submittals, obtener el id (aunque no se use como orden_id, es válido)
    else if (orderCheckSubmittals.rowCount > 0) {
      console.log(' Submittal encontrado en tabla submittals, id:', orderCheckSubmittals.rows[0].id);
      // Para submittals, no necesitamos orden_id, pero validamos que existe
    } 
    // Si existe en numero_parte, obtener el orden_id desde ahí
    else if (orderCheckNumeroParte.rowCount > 0 && orderCheckNumeroParte.rows[0].orden_id) {
      ordenId = orderCheckNumeroParte.rows[0].orden_id;
      console.log(' Número de parte encontrado en tabla numero_parte, orden_id:', ordenId);
    } 
    else {
      console.log(' Orden encontrada en proyectos (no tiene orden_id)');
    }

    console.log(' Número de orden válido');

    // Evitar insertar duplicados: si ya existe una sesión activa para este usuario
    // y el mismo numero_parte/orden, devolverla en lugar de crear una nueva.
    try {
      console.log('Verificando si existe sesión activa previa para evitar duplicados...');
      const existing = await apoyosPool.query(
        `SELECT id, hora_inicio, (EXTRACT(EPOCH FROM hora_inicio) * 1000)::bigint AS hora_inicio_ms, numero_parte, orden
         FROM tiempo_diseno
         WHERE hora_fin IS NULL
           AND LOWER(TRIM(username)) = LOWER(TRIM($1))
          AND (COALESCE(TRIM(numero_parte),'') = COALESCE(TRIM($2),'') OR COALESCE(TRIM(orden),'') = COALESCE(TRIM($3), ''))
         LIMIT 1`,
        [normalizedUsername, partNumber || '', orderNumber || '']
      );

      if (existing && existing.rowCount > 0) {
        console.log('Sesión activa encontrada — evitando inserción duplicada. id=', existing.rows[0].id);
        const tokenExisting = jwt.sign(
          { username: normalizedUsername, sessionId: existing.rows[0].id, partNumber: partNumber, orderNumber: orderNumber },
          JWT_SECRET,
          { expiresIn: '8h' }
        );
        return res.json({ success: true, id: existing.rows[0].id, session: existing.rows[0], orden_id: ordenId, token: tokenExisting });
      }
    } catch (dupCheckError) {
      console.warn('No se pudo verificar sesión previa (continuando con inserción):', dupCheckError.message);
    }

    console.log('Insertando en tabla tiempo_diseno...');
    console.log('Query SQL: INSERT INTO tiempo_diseno (username, numero_parte, orden, cliente, tipo, estado, estado_orden, hora_inicio, hora_fin) VALUES ($1, $2, $3, $4, \'meeting\', \'pendiente\', \'En Proceso\', NOW(), NULL)');
    console.log('Parámetros:', [normalizedUsername, partNumber, orderNumber || orden, cliente]);

    const result = await apoyosPool.query(
      `INSERT INTO tiempo_diseno (username, numero_parte, orden, cliente, tipo, estado, estado_orden, hora_inicio, hora_fin)
       VALUES ($1, $2, $3, $4, 'meeting', 'pendiente', 'En Proceso', NOW(), NULL)
       RETURNING 
         id,
         hora_inicio,
         (EXTRACT(EPOCH FROM hora_inicio) * 1000)::bigint AS hora_inicio_ms`,
      [normalizedUsername, partNumber, orderNumber || orden, cliente]
    );

    console.log('Inserción exitosa en tiempo_diseno:');
    console.log('  - ID generado:', result.rows[0]?.id);
    console.log('  - Hora inicio:', result.rows[0]?.hora_inicio);

    // Actualizar tabla usuarios con orden_en_logeo, estado_en_orden, inicio_sesion y sesion_activa = TRUE
    console.log('Actualizando tabla usuarios...');
    console.log('   - Username:', normalizedUsername);
    console.log('   - Order Number:', orderNumber);
    try {
      const updateResult = await apoyosPool.query(
        `UPDATE usuarios 
         SET orden_en_logeo = $1, 
             estado_en_orden = 'Activo',
             inicio_sesion = NOW(),
             sesion_activa = TRUE
         WHERE LOWER(TRIM(username)) = ANY($2::text[])
         RETURNING username, orden_en_logeo, estado_en_orden, inicio_sesion, sesion_activa`,
        [orderNumber, usernameCandidates.length > 0 ? usernameCandidates : [normalizedUsername.toLowerCase()]]
      );
      
      if (updateResult.rowCount === 0) {
        console.error(' No se encontró el usuario en la tabla usuarios:', normalizedUsername);
      } else {
        console.log('Tabla usuarios actualizada exitosamente');
        console.log('   - Datos actualizados:', updateResult.rows[0]);
        console.log('   - sesion_activa establecida en TRUE');
      }
    } catch (updateError) {
      console.error('Error al actualizar tabla usuarios:', updateError.message);
      console.error('   - Stack:', updateError.stack);
      // No detenemos el proceso, solo registramos el error
    }

    // Generar JWT
    const token = jwt.sign(
      { 
        username: normalizedUsername,
        sessionId: result.rows[0]?.id,
        partNumber: partNumber,
        orderNumber: orderNumber
      },
      JWT_SECRET,
      { expiresIn: '8h' } // Token válido por 8 horas
    );

    console.log(' JWT generado exitosamente'); //YA NO SE VA A USAR O POR LO MENOS NO POR AHORA
    console.log('==========================================\n');

    res.json({ 
      success: true, 
      id: result.rows[0]?.id,
      session: result.rows[0],
      orden_id: ordenId, // Devolver orden_id si existe para carga rápida de números de parte
      token: token // Devolver el JWT al cliente
    });
  } catch (error) {
    console.error('Error al registrar logeo de diseño:', error.message);
    console.error('Stack trace:', error.stack);
    console.error('Código de error:', error.code);
    res.status(500).json({ success: false, error: 'Error al guardar el logeo en tiempo_diseno: ' + error.message });
  }
});

// ==== Inserción forzada en cronograma (preview y aplicación) ====
// Calcula cómo ajustar órdenes/submittals de un usuario para insertar
// una nueva orden en un intervalo dado:
// - La orden existente conserva su fecha_inicio.
// - Solo se extiende fecha_limite según horas de interrupción laborables.
// - Solo cuentan horas de 06:00 a 16:00 y se excluyen fines de semana.
const FORCE_INSERT_WORK_START_HOUR = 6;
const FORCE_INSERT_WORK_END_HOUR = 16;
const FORCE_INSERT_INTERRUPTION_BLOCK_MS = 30 * 60 * 1000; // 30 minutos

function parseDateTimeLocal(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  // Parsear sin conversión de zona horaria (ignora sufijos Z/+hh:mm)
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4] || 0);
    const minute = Number(m[5] || 0);
    const second = Number(m[6] || 0);
    const dt = new Date(year, month - 1, day, hour, minute, second, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function normalizeDateToLocalMidnight(value) {
  if (value == null || value === '') {
    return null;
  }

  const dt = parseDateTimeLocal(value);
  if (!dt || Number.isNaN(dt.getTime())) {
    return null;
  }

  dt.setHours(0, 0, 0, 0);
  return formatDateTimeLocal(dt);
}

function formatDateTimeLocal(dateInput) {
  const dt = parseDateTimeLocal(dateInput);
  if (!dt) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

function isWeekendDay(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function moveToNextWorkdayStart(dateInput) {
  const date = new Date(dateInput);
  date.setHours(FORCE_INSERT_WORK_START_HOUR, 0, 0, 0);

  while (isWeekendDay(date)) {
    date.setDate(date.getDate() + 1);
    date.setHours(FORCE_INSERT_WORK_START_HOUR, 0, 0, 0);
  }

  return date;
}

function normalizeToWorkCursor(dateInput) {
  let date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;

  if (isWeekendDay(date)) {
    return moveToNextWorkdayStart(date);
  }

  const dayStart = new Date(date);
  dayStart.setHours(FORCE_INSERT_WORK_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(FORCE_INSERT_WORK_END_HOUR, 0, 0, 0);

  if (date < dayStart) {
    return dayStart;
  }

  if (date >= dayEnd) {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    return moveToNextWorkdayStart(nextDay);
  }

  return date;
}

function normalizeToWorkDate(dateInput, options = {}) {
  const { allowEndBoundary = false } = options;

  let date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;

  if (isWeekendDay(date)) {
    return moveToNextWorkdayStart(date);
  }

  const dayStart = new Date(date);
  dayStart.setHours(FORCE_INSERT_WORK_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(FORCE_INSERT_WORK_END_HOUR, 0, 0, 0);

  if (date < dayStart) {
    return dayStart;
  }

  if (date > dayEnd || (!allowEndBoundary && date.getTime() === dayEnd.getTime())) {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    return moveToNextWorkdayStart(nextDay);
  }

  return date;
}

function normalizeProposalRange(startInput, endInput) {
  const MIN_BLOCK_MS = 30 * 60 * 1000;
  const start = normalizeToWorkDate(startInput, { allowEndBoundary: false });
  if (!start) return null;

  let end = normalizeToWorkDate(endInput, { allowEndBoundary: true });
  if (!end) return null;

  if (end <= start) {
    end = addWorkingMs(start, MIN_BLOCK_MS);
  }

  return {
    start,
    end
  };
}

function calculateWorkingOverlapMs(rangeStartInput, rangeEndInput, blockStartInput, blockEndInput) {
  const rangeStart = parseDateTimeLocal(rangeStartInput);
  const rangeEnd = parseDateTimeLocal(rangeEndInput);
  const blockStart = parseDateTimeLocal(blockStartInput);
  const blockEnd = parseDateTimeLocal(blockEndInput);

  if (
    Number.isNaN(rangeStart.getTime()) ||
    Number.isNaN(rangeEnd.getTime()) ||
    Number.isNaN(blockStart.getTime()) ||
    Number.isNaN(blockEnd.getTime())
  ) {
    return 0;
  }

  const overlapStart = new Date(Math.max(rangeStart.getTime(), blockStart.getTime()));
  const overlapEnd = new Date(Math.min(rangeEnd.getTime(), blockEnd.getTime()));
  if (overlapEnd <= overlapStart) return 0;

  let totalMs = 0;
  const dayCursor = new Date(overlapStart);
  dayCursor.setHours(0, 0, 0, 0);
  const lastDay = new Date(overlapEnd);
  lastDay.setHours(0, 0, 0, 0);

  while (dayCursor.getTime() <= lastDay.getTime()) {
    if (!isWeekendDay(dayCursor)) {
      const dayWorkStart = new Date(dayCursor);
      dayWorkStart.setHours(FORCE_INSERT_WORK_START_HOUR, 0, 0, 0);
      const dayWorkEnd = new Date(dayCursor);
      dayWorkEnd.setHours(FORCE_INSERT_WORK_END_HOUR, 0, 0, 0);

      const segmentStart = new Date(Math.max(overlapStart.getTime(), dayWorkStart.getTime()));
      const segmentEnd = new Date(Math.min(overlapEnd.getTime(), dayWorkEnd.getTime()));

      if (segmentEnd > segmentStart) {
        totalMs += (segmentEnd.getTime() - segmentStart.getTime());
      }
    }

    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  return totalMs;
}

function addWorkingMs(baseDateInput, msToAddInput) {
  const msToAdd = Number(msToAddInput) || 0;
  const normalizedBase = normalizeToWorkCursor(baseDateInput);
  if (!normalizedBase) return null;
  if (msToAdd <= 0) return new Date(normalizedBase);

  let cursor = new Date(normalizedBase);
  let remaining = msToAdd;

  while (remaining > 0) {
    cursor = normalizeToWorkCursor(cursor);
    if (!cursor) return null;

    const dayEnd = new Date(cursor);
    dayEnd.setHours(FORCE_INSERT_WORK_END_HOUR, 0, 0, 0);

    const available = dayEnd.getTime() - cursor.getTime();
    if (available <= 0) {
      const nextDay = new Date(cursor);
      nextDay.setDate(nextDay.getDate() + 1);
      cursor = moveToNextWorkdayStart(nextDay);
      continue;
    }

    const consume = Math.min(available, remaining);
    cursor = new Date(cursor.getTime() + consume);
    remaining -= consume;

    if (remaining > 0) {
      const nextDay = new Date(cursor);
      nextDay.setDate(nextDay.getDate() + 1);
      cursor = moveToNextWorkdayStart(nextDay);
    }
  }

  return cursor;
}

function roundUpInterruptionMs(msInput) {
  const ms = Number(msInput) || 0;
  if (ms <= 0) return 0;
  return Math.ceil(ms / FORCE_INSERT_INTERRUPTION_BLOCK_MS) * FORCE_INSERT_INTERRUPTION_BLOCK_MS;
}

function normalizeForceInsertWorkingRange(startInput, endInput) {
  const MIN_BLOCK_MS = 30 * 60 * 1000;
  const rawStart = parseDateTimeLocal(startInput);
  const rawEnd = parseDateTimeLocal(endInput);

  if (!rawStart || !rawEnd || Number.isNaN(rawStart.getTime()) || Number.isNaN(rawEnd.getTime())) {
    return null;
  }

  const normalizedStart = normalizeToWorkDate(rawStart, { allowEndBoundary: false });
  if (!normalizedStart) return null;

  const rawDurationMs = Math.max(rawEnd.getTime() - rawStart.getTime(), MIN_BLOCK_MS);
  const normalizedEnd = addWorkingMs(normalizedStart, rawDurationMs);
  if (!normalizedEnd || Number.isNaN(normalizedEnd.getTime())) {
    return null;
  }

  return {
    start: normalizedStart,
    end: normalizedEnd,
    durationMs: rawDurationMs
  };
}

function calculateForceInsertMovements(items, mainItem, inicioPropuesta, finPropuesta) {
  const movimientos = [];

  for (const item of (items || [])) {
    if (
      mainItem &&
      String(item.tipo || '') === String(mainItem.tipo || '') &&
      Number(item.id) === Number(mainItem.id)
    ) {
      continue;
    }

    const origStartRaw = item.fecha_inicio ? parseDateTimeLocal(item.fecha_inicio) : null;
    const origEndRaw = item.fecha_limite ? parseDateTimeLocal(item.fecha_limite) : null;
    const origStart = origStartRaw ? normalizeToWorkDate(origStartRaw, { allowEndBoundary: false }) : null;
    const origEnd = origEndRaw ? normalizeToWorkDate(origEndRaw, { allowEndBoundary: true }) : null;

    if (!origStart || !origEnd || Number.isNaN(origStart.getTime()) || Number.isNaN(origEnd.getTime())) {
      continue;
    }

    const overlapMs = calculateWorkingOverlapMs(origStart, origEnd, inicioPropuesta, finPropuesta);
    const interruptionMs = roundUpInterruptionMs(overlapMs);
    if (interruptionMs <= 0) {
      continue;
    }

    const newEnd = addWorkingMs(origEnd, interruptionMs);
    if (!newEnd || Number.isNaN(newEnd.getTime())) {
      continue;
    }

    movimientos.push({
      tipo: item.tipo,
      id: item.id,
      order_number: item.order_number,
      fecha_inicio_original: formatDateTimeLocal(origStart),
      fecha_limite_original: formatDateTimeLocal(origEnd),
      fecha_inicio_nueva: formatDateTimeLocal(origStart),
      fecha_limite_nueva: formatDateTimeLocal(newEnd),
      horas_interrupcion: Number((interruptionMs / (1000 * 60 * 60)).toFixed(2))
    });
  }

  return movimientos;
}

app.post('/api/ordenes/insertar-forzado-usuario/preview', async (req, res) => {
  const client = await apoyosPool.connect();
  try {
    const { usuario_id, item_id, item_type, order_number, fecha_inicio, fecha_limite } = req.body || {};

    if (!usuario_id || !order_number || !fecha_inicio || !fecha_limite) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (usuario_id, order_number, fecha_inicio, fecha_limite)' });
    }

    const inicioPropuestaRaw = parseDateTimeLocal(fecha_inicio);
    const finPropuestaRaw = parseDateTimeLocal(fecha_limite);
    if (!inicioPropuestaRaw || !finPropuestaRaw || Number.isNaN(inicioPropuestaRaw.getTime()) || Number.isNaN(finPropuestaRaw.getTime())) {
      return res.status(400).json({ error: 'Fechas de propuesta inválidas' });
    }

    // Normalizar la propuesta a jornada laboral (6:00 a 16:00) preservando duración laborable.
    const normalizedProposal = normalizeForceInsertWorkingRange(inicioPropuestaRaw, finPropuestaRaw);
    if (!normalizedProposal) {
      return res.status(400).json({ error: 'No se pudo normalizar la propuesta a jornada laboral' });
    }
    const inicioPropuesta = normalizedProposal.start;
    const finPropuesta = normalizedProposal.end;

    // 1) Traer todas las órdenes y submittals asignados al usuario ordenados por fecha_inicio
    const result = await client.query(
      `
        SELECT 
          'orden' AS tipo,
          o.id AS id,
          o.order_number,
          o.fecha_inicio,
          o.fecha_limite
        FROM ordenes o
        WHERE $1 = ANY(COALESCE(o.usuario_asignado, ARRAY[]::INTEGER[]))
        
        UNION ALL
        
        SELECT 
          'submittal' AS tipo,
          s.id AS id,
          s.submittal_number AS order_number,
          s.fecha_inicio,
          s.fecha_limite
        FROM submittals s
        WHERE $1 = ANY(COALESCE(s.usuario_asignado, ARRAY[]::INTEGER[]))
        
        ORDER BY fecha_inicio NULLS LAST, fecha_limite NULLS LAST, order_number
      `,
      [usuario_id]
    );

    const items = result.rows || [];

    // 2) Simular ajuste en memoria conservando fecha_inicio de las órdenes existentes.
    // Solo se extiende fecha_limite por horas de interrupción laborables.
    let main = null;
    const mainId = Number.parseInt(item_id, 10);
    const normalizedType = String(item_type || '').trim().toLowerCase();
    const expectedNumber = String(order_number || '').trim().toLowerCase();

    if (Number.isInteger(mainId) && mainId > 0) {
      if (normalizedType === 'submittal') {
        main = { tipo: 'submittal', id: mainId };
      } else {
        const directOrder = await client.query(
          `SELECT id, order_number
           FROM ordenes
           WHERE id = $1
           LIMIT 1`,
          [mainId]
        );

        if (directOrder.rowCount > 0) {
          const directNumber = String(directOrder.rows[0].order_number || '').trim().toLowerCase();
          if (!expectedNumber || directNumber === expectedNumber) {
            main = { tipo: 'orden', id: directOrder.rows[0].id };
          }
        }

        if (!main) {
          const mappedOrder = await client.query(
            `SELECT o.id
             FROM numero_parte np
             JOIN ordenes o ON o.id = np.orden_id
             WHERE np.id = $1
               AND (
                 $2 = '' OR
                 LOWER(TRIM(COALESCE(np.numero_parte, ''))) = $2 OR
                 LOWER(TRIM(COALESCE(o.order_number, ''))) = $2
               )
             LIMIT 1`,
            [mainId, expectedNumber]
          );

          if (mappedOrder.rowCount > 0) {
            main = { tipo: 'orden', id: mappedOrder.rows[0].id };
          }
        }
      }
    }

    // Fallback por número de orden/submittal para compatibilidad con propuestas viejas
    if (!main && order_number) {
      const mainOrder = await client.query(
        `
          SELECT 'orden' AS tipo, id
          FROM ordenes
          WHERE TRIM(order_number) = TRIM($1)
          LIMIT 1
        `,
        [order_number]
      );

      const mainSubmittal = await client.query(
        `
          SELECT 'submittal' AS tipo, id
          FROM submittals
          WHERE TRIM(submittal_number) = TRIM($1)
          LIMIT 1
        `,
        [order_number]
      );

      if (mainOrder.rowCount > 0) main = { tipo: 'orden', id: mainOrder.rows[0].id };
      else if (mainSubmittal.rowCount > 0) main = { tipo: 'submittal', id: mainSubmittal.rows[0].id };
    }

    const movimientos = calculateForceInsertMovements(items, main, inicioPropuesta, finPropuesta);

    return res.json({
      propuesta_normalizada: {
        fecha_inicio: formatDateTimeLocal(inicioPropuesta),
        fecha_limite: formatDateTimeLocal(finPropuesta)
      },
      movimientos
    });
  } catch (error) {
    console.error('Error en /api/ordenes/insertar-forzado-usuario/preview:', error);
    return res.status(500).json({ error: 'Error al calcular movimientos', detail: error.message });
  } finally {
    client.release();
  }
});

// Aplica realmente la inserción forzada usando la misma lógica que el preview
app.post('/api/ordenes/insertar-forzado-usuario', async (req, res) => {
  const client = await apoyosPool.connect();
  try {
    await ensureOrdenesTable();
    await ensureSubmittalsTable();

    const { usuario_id, item_id, item_type, order_number, fecha_inicio, fecha_limite } = req.body || {};

    if (!usuario_id || !order_number || !fecha_inicio || !fecha_limite) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (usuario_id, order_number, fecha_inicio, fecha_limite)' });
    }

    const inicioPropuestaRaw = parseDateTimeLocal(fecha_inicio);
    const finPropuestaRaw = parseDateTimeLocal(fecha_limite);
    if (!inicioPropuestaRaw || !finPropuestaRaw || Number.isNaN(inicioPropuestaRaw.getTime()) || Number.isNaN(finPropuestaRaw.getTime())) {
      return res.status(400).json({ error: 'Fechas de propuesta inválidas' });
    }

    // Normalizar la propuesta a jornada laboral (6:00 a 16:00) preservando duración laborable.
    const normalizedProposal = normalizeForceInsertWorkingRange(inicioPropuestaRaw, finPropuestaRaw);
    if (!normalizedProposal) {
      return res.status(400).json({ error: 'No se pudo normalizar la propuesta a jornada laboral' });
    }
    const inicioPropuesta = normalizedProposal.start;
    const finPropuesta = normalizedProposal.end;

    await client.query('BEGIN');

    // 1) Localizar la orden/submittal principal por id/tipo (preferido)
    let main = null;
    const mainId = Number.parseInt(item_id, 10);
    const normalizedType = String(item_type || '').trim().toLowerCase();
    const expectedNumber = String(order_number || '').trim().toLowerCase();

    if (Number.isInteger(mainId) && mainId > 0) {
      if (normalizedType === 'submittal') {
        main = { tipo: 'submittal', id: mainId };
      } else {
        const directOrder = await client.query(
          `SELECT id, order_number
           FROM ordenes
           WHERE id = $1
           LIMIT 1`,
          [mainId]
        );

        if (directOrder.rowCount > 0) {
          const directNumber = String(directOrder.rows[0].order_number || '').trim().toLowerCase();
          if (!expectedNumber || directNumber === expectedNumber) {
            main = { tipo: 'orden', id: directOrder.rows[0].id };
          }
        }

        if (!main) {
          const mappedOrder = await client.query(
            `SELECT o.id
             FROM numero_parte np
             JOIN ordenes o ON o.id = np.orden_id
             WHERE np.id = $1
               AND (
                 $2 = '' OR
                 LOWER(TRIM(COALESCE(np.numero_parte, ''))) = $2 OR
                 LOWER(TRIM(COALESCE(o.order_number, ''))) = $2
               )
             LIMIT 1`,
            [mainId, expectedNumber]
          );

          if (mappedOrder.rowCount > 0) {
            main = { tipo: 'orden', id: mappedOrder.rows[0].id };
          }
        }
      }
    }

    // Fallback por número para compatibilidad retroactiva
    if (!main && order_number) {
      const mainOrder = await client.query(
        `
          SELECT 'orden' AS tipo, id
          FROM ordenes
          WHERE TRIM(order_number) = TRIM($1)
          LIMIT 1
        `,
        [order_number]
      );

      const mainSubmittal = await client.query(
        `
          SELECT 'submittal' AS tipo, id
          FROM submittals
          WHERE TRIM(submittal_number) = TRIM($1)
          LIMIT 1
        `,
        [order_number]
      );

      if (mainOrder.rowCount > 0) main = { tipo: 'orden', id: mainOrder.rows[0].id };
      else if (mainSubmittal.rowCount > 0) main = { tipo: 'submittal', id: mainSubmittal.rows[0].id };
    }

    if (!main) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No se encontró la orden/submittal principal (por id/tipo o número)' });
    }

    const parsedUsuarioId = Number.parseInt(usuario_id, 10);
    if (!Number.isInteger(parsedUsuarioId) || parsedUsuarioId <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'usuario_id inválido para inserción forzada' });
    }

    // 2) Actualizar fechas de la orden/submittal principal
    if (main.tipo === 'orden') {
      const updateMainResp = await client.query(
        `UPDATE ordenes
         SET fecha_inicio = $1, fecha_limite = $2, insert_forzado = TRUE
         WHERE id = $3`,
        [formatDateTimeLocal(inicioPropuesta), formatDateTimeLocal(finPropuesta), main.id]
      );
      if (updateMainResp.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No se pudo actualizar la orden principal para inserción forzada' });
      }

      // Asegurar que el usuario quede asignado a la orden principal
      await client.query(
        `UPDATE ordenes
         SET usuario_asignado = CASE
           WHEN usuario_asignado IS NULL THEN ARRAY[$1]::INTEGER[]
           WHEN NOT ($1 = ANY(usuario_asignado)) THEN array_append(usuario_asignado, $1)
           ELSE usuario_asignado
         END
         WHERE id = $2`,
        [parsedUsuarioId, main.id]
      );
    } else {
      const updateMainResp = await client.query(
        `UPDATE submittals
         SET fecha_inicio = $1, fecha_limite = $2, insert_forzado = TRUE
         WHERE id = $3`,
        [formatDateTimeLocal(inicioPropuesta), formatDateTimeLocal(finPropuesta), main.id]
      );
      if (updateMainResp.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No se pudo actualizar el submittal principal para inserción forzada' });
      }

      // Asegurar que el usuario quede asignado al submittal principal
      await client.query(
        `UPDATE submittals
         SET usuario_asignado = CASE
           WHEN usuario_asignado IS NULL THEN ARRAY[$1]::INTEGER[]
           WHEN NOT ($1 = ANY(usuario_asignado)) THEN array_append(usuario_asignado, $1)
           ELSE usuario_asignado
         END
         WHERE id = $2`,
        [parsedUsuarioId, main.id]
      );
    }

    // 3) Calcular movimientos del resto conservando fecha_inicio y extendiendo fecha_limite.
    const previewResp = await client.query(
      `
        SELECT 
          'orden' AS tipo,
          o.id AS id,
          o.order_number,
          o.fecha_inicio,
          o.fecha_limite
        FROM ordenes o
        WHERE $1 = ANY(COALESCE(o.usuario_asignado, ARRAY[]::INTEGER[]))
        
        UNION ALL
        
        SELECT 
          'submittal' AS tipo,
          s.id AS id,
          s.submittal_number AS order_number,
          s.fecha_inicio,
          s.fecha_limite
        FROM submittals s
        WHERE $1 = ANY(COALESCE(s.usuario_asignado, ARRAY[]::INTEGER[]))
        
        ORDER BY fecha_inicio NULLS LAST, fecha_limite NULLS LAST, order_number
      `,
      [usuario_id]
    );

    const items = previewResp.rows || [];
    const movimientosAplicados = calculateForceInsertMovements(items, main, inicioPropuesta, finPropuesta);

    for (const movimiento of movimientosAplicados) {
      if (movimiento.tipo === 'orden') {
        await client.query(
          `UPDATE ordenes
           SET fecha_limite = $1
           WHERE id = $2`,
          [movimiento.fecha_limite_nueva, movimiento.id]
        );
      } else {
        await client.query(
          `UPDATE submittals
           SET fecha_limite = $1
           WHERE id = $2`,
          [movimiento.fecha_limite_nueva, movimiento.id]
        );
      }
    }

    await client.query('COMMIT');
    return res.json({
      ok: true,
      item_principal: {
        tipo: main.tipo,
        id: main.id,
        usuario_asignado: parsedUsuarioId,
        fecha_inicio: formatDateTimeLocal(inicioPropuesta),
        fecha_limite: formatDateTimeLocal(finPropuesta)
      },
      movimientos: movimientosAplicados
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error en /api/ordenes/insertar-forzado-usuario:', error);
    return res.status(500).json({ error: 'Error al aplicar inserción forzada', detail: error.message });
  } finally {
    client.release();
  }
});

// Aplica inserción forzada manual: actualiza item principal + movimientos personalizados.
app.post('/api/ordenes/insertar-forzado-usuario/manual', async (req, res) => {
  const client = await apoyosPool.connect();
  try {
    await ensureOrdenesTable();
    await ensureSubmittalsTable();

    const {
      usuario_id,
      item_id,
      item_type,
      order_number,
      fecha_inicio,
      fecha_limite,
      movimientos
    } = req.body || {};

    if (!usuario_id || !order_number || !fecha_inicio || !fecha_limite) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (usuario_id, order_number, fecha_inicio, fecha_limite)' });
    }

    const inicioPropuestaRaw = parseDateTimeLocal(fecha_inicio);
    const finPropuestaRaw = parseDateTimeLocal(fecha_limite);
    if (!inicioPropuestaRaw || !finPropuestaRaw || Number.isNaN(inicioPropuestaRaw.getTime()) || Number.isNaN(finPropuestaRaw.getTime())) {
      return res.status(400).json({ error: 'Fechas de propuesta inválidas' });
    }

    const normalizedProposal = normalizeForceInsertWorkingRange(inicioPropuestaRaw, finPropuestaRaw);
    if (!normalizedProposal) {
      return res.status(400).json({ error: 'No se pudo normalizar la propuesta a jornada laboral' });
    }
    const inicioPropuesta = normalizedProposal.start;
    const finPropuesta = normalizedProposal.end;

    await client.query('BEGIN');

    let main = null;
    const mainId = Number.parseInt(item_id, 10);
    const normalizedType = String(item_type || '').trim().toLowerCase();
    const expectedNumber = String(order_number || '').trim().toLowerCase();

    if (Number.isInteger(mainId) && mainId > 0) {
      if (normalizedType === 'submittal') {
        main = { tipo: 'submittal', id: mainId };
      } else {
        const directOrder = await client.query(
          `SELECT id, order_number
           FROM ordenes
           WHERE id = $1
           LIMIT 1`,
          [mainId]
        );

        if (directOrder.rowCount > 0) {
          const directNumber = String(directOrder.rows[0].order_number || '').trim().toLowerCase();
          if (!expectedNumber || directNumber === expectedNumber) {
            main = { tipo: 'orden', id: directOrder.rows[0].id };
          }
        }

        if (!main) {
          const mappedOrder = await client.query(
            `SELECT o.id
             FROM numero_parte np
             JOIN ordenes o ON o.id = np.orden_id
             WHERE np.id = $1
               AND (
                 $2 = '' OR
                 LOWER(TRIM(COALESCE(np.numero_parte, ''))) = $2 OR
                 LOWER(TRIM(COALESCE(o.order_number, ''))) = $2
               )
             LIMIT 1`,
            [mainId, expectedNumber]
          );

          if (mappedOrder.rowCount > 0) {
            main = { tipo: 'orden', id: mappedOrder.rows[0].id };
          }
        }
      }
    }

    if (!main && order_number) {
      const mainOrder = await client.query(
        `
          SELECT 'orden' AS tipo, id
          FROM ordenes
          WHERE TRIM(order_number) = TRIM($1)
          LIMIT 1
        `,
        [order_number]
      );

      const mainSubmittal = await client.query(
        `
          SELECT 'submittal' AS tipo, id
          FROM submittals
          WHERE TRIM(submittal_number) = TRIM($1)
          LIMIT 1
        `,
        [order_number]
      );

      if (mainOrder.rowCount > 0) main = { tipo: 'orden', id: mainOrder.rows[0].id };
      else if (mainSubmittal.rowCount > 0) main = { tipo: 'submittal', id: mainSubmittal.rows[0].id };
    }

    if (!main) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No se encontró la orden/submittal principal (por id/tipo o número)' });
    }

    const parsedUsuarioId = Number.parseInt(usuario_id, 10);
    if (!Number.isInteger(parsedUsuarioId) || parsedUsuarioId <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'usuario_id inválido para inserción manual' });
    }

    if (main.tipo === 'orden') {
      const updateMainResp = await client.query(
        `UPDATE ordenes
         SET fecha_inicio = $1, fecha_limite = $2, insert_forzado = TRUE
         WHERE id = $3`,
        [formatDateTimeLocal(inicioPropuesta), formatDateTimeLocal(finPropuesta), main.id]
      );
      if (updateMainResp.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No se pudo actualizar la orden principal para inserción manual' });
      }

      await client.query(
        `UPDATE ordenes
         SET usuario_asignado = CASE
           WHEN usuario_asignado IS NULL THEN ARRAY[$1]::INTEGER[]
           WHEN NOT ($1 = ANY(usuario_asignado)) THEN array_append(usuario_asignado, $1)
           ELSE usuario_asignado
         END
         WHERE id = $2`,
        [parsedUsuarioId, main.id]
      );
    } else {
      const updateMainResp = await client.query(
        `UPDATE submittals
         SET fecha_inicio = $1, fecha_limite = $2, insert_forzado = TRUE
         WHERE id = $3`,
        [formatDateTimeLocal(inicioPropuesta), formatDateTimeLocal(finPropuesta), main.id]
      );
      if (updateMainResp.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No se pudo actualizar el submittal principal para inserción manual' });
      }

      await client.query(
        `UPDATE submittals
         SET usuario_asignado = CASE
           WHEN usuario_asignado IS NULL THEN ARRAY[$1]::INTEGER[]
           WHEN NOT ($1 = ANY(usuario_asignado)) THEN array_append(usuario_asignado, $1)
           ELSE usuario_asignado
         END
         WHERE id = $2`,
        [parsedUsuarioId, main.id]
      );
    }

    const manualMoves = Array.isArray(movimientos) ? movimientos : [];

    for (const move of manualMoves) {
      const moveType = String(move?.tipo || 'orden').trim().toLowerCase() === 'submittal' ? 'submittal' : 'orden';
      const moveId = Number.parseInt(move?.id, 10);
      if (!Number.isInteger(moveId) || moveId <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Movimiento manual con id inválido' });
      }

      const startRaw = parseDateTimeLocal(move?.fecha_inicio_nueva);
      const endRaw = parseDateTimeLocal(move?.fecha_limite_nueva);
      if (!startRaw || !endRaw || Number.isNaN(startRaw.getTime()) || Number.isNaN(endRaw.getTime())) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Movimiento manual con fechas inválidas' });
      }

      if (isWeekendDay(startRaw) || isWeekendDay(endRaw)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No se permiten fechas en fin de semana para movimientos manuales' });
      }

      const startMinutes = (startRaw.getHours() * 60) + startRaw.getMinutes();
      const endMinutes = (endRaw.getHours() * 60) + endRaw.getMinutes();
      const minMinutes = FORCE_INSERT_WORK_START_HOUR * 60;
      const maxMinutes = FORCE_INSERT_WORK_END_HOUR * 60;

      const hasHalfHourStep = (startRaw.getMinutes() === 0 || startRaw.getMinutes() === 30)
        && (endRaw.getMinutes() === 0 || endRaw.getMinutes() === 30);
      if (!hasHalfHourStep) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Los movimientos manuales deben usar intervalos de 30 minutos' });
      }

      if (startMinutes < minMinutes || startMinutes > maxMinutes || endMinutes < minMinutes || endMinutes > maxMinutes) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Las horas manuales deben estar entre 6:00 y 16:00' });
      }

      if (endRaw.getTime() <= startRaw.getTime()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Movimiento manual con fecha límite no válida' });
      }

      if (moveType === 'orden') {
        await client.query(
          `UPDATE ordenes
           SET fecha_inicio = $1,
               fecha_limite = $2
           WHERE id = $3`,
          [formatDateTimeLocal(startRaw), formatDateTimeLocal(endRaw), moveId]
        );
      } else {
        await client.query(
          `UPDATE submittals
           SET fecha_inicio = $1,
               fecha_limite = $2
           WHERE id = $3`,
          [formatDateTimeLocal(startRaw), formatDateTimeLocal(endRaw), moveId]
        );
      }
    }

    await client.query('COMMIT');
    return res.json({
      ok: true,
      mode: 'manual',
      item_principal: {
        tipo: main.tipo,
        id: main.id,
        usuario_asignado: parsedUsuarioId,
        fecha_inicio: formatDateTimeLocal(inicioPropuesta),
        fecha_limite: formatDateTimeLocal(finPropuesta)
      },
      movimientos: manualMoves
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error en /api/ordenes/insertar-forzado-usuario/manual:', error);
    return res.status(500).json({ error: 'Error al guardar inserción manual', detail: error.message });
  } finally {
    client.release();
  }
});

// Obtener listado de números de parte usados en Diseño (desde tiempo_diseno)
app.get('/api/diseno/partes', async (req, res) => {
  try {
    console.log('📄 Obteniendo números de parte desde tiempo_diseno...');

    // Tomamos la última sesión por combinación (numero_parte, orden)
    const result = await apoyosPool.query(`
      SELECT DISTINCT ON (td.numero_parte, td.orden)
        td.id,
        td.numero_parte,
        td.orden,
        td.orden AS order_number,
        td.cliente,
        td.username,
        td.creado_en,
        td.hora_inicio,
        td.hora_fin
      FROM tiempo_diseno td
      ORDER BY td.numero_parte, td.orden, td.creado_en DESC
    `);

    console.log('✔ Números de parte de diseño obtenidos:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener números de parte de diseño:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener números de parte de diseño'
    });
  }
});

// Finalizar tiempo de diseño - actualizar hora_fin y tiempos de estado
app.post('/api/diseno/finish', async (req, res) => {
  try {
    console.log('\n========== FINALIZAR TIEMPO DE DISEÑO ==========');
    console.log(' Datos recibidos:', JSON.stringify(req.body, null, 2));
    
    const { 
      id,
      tiempos = {}, // { pausa, comida, 5s, meeting, pendiente, esperando_informacion, buscando_informacion, documentacion, cambios }
      notas = null
    } = req.body || {};

    if (!id) {
      console.error(' ERROR: Falta el ID del registro');
      return res.status(400).json({ success: false, error: 'Falta el ID del registro' });
    }

    // Convertir milisegundos a formato INTERVAL de PostgreSQL (HH:MM:SS)
    function msToInterval(ms) {
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    console.log('Actualizando tiempo_diseno con hora_fin y tiempos de estado...');
    
    const tiemposConvertidos = {
      working: tiempos.working ? msToInterval(tiempos.working) : '00:00:00',
      pausa: tiempos.pausa ? msToInterval(tiempos.pausa) : '00:00:00',
      comida: tiempos.comida ? msToInterval(tiempos.comida) : '00:00:00',
      '5s': tiempos['5s'] ? msToInterval(tiempos['5s']) : '00:00:00',
      meeting: tiempos.meeting ? msToInterval(tiempos.meeting) : '00:00:00',
      meeting_trabajo: tiempos.meeting_trabajo ? msToInterval(tiempos.meeting_trabajo) : '00:00:00',
      training: tiempos.training ? msToInterval(tiempos.training) : '00:00:00',
      pendiente: tiempos.pendiente ? msToInterval(tiempos.pendiente) : '00:00:00',
      esperando_informacion: tiempos.esperando_informacion ? msToInterval(tiempos.esperando_informacion) : '00:00:00',
      buscando_informacion: tiempos.buscando_informacion ? msToInterval(tiempos.buscando_informacion) : '00:00:00',
      documentacion: tiempos.documentacion ? msToInterval(tiempos.documentacion) : '00:00:00',
      cambios: tiempos.cambios ? msToInterval(tiempos.cambios) : '00:00:00',
      pdm_rwk: tiempos.pdm_rwk ? msToInterval(tiempos.pdm_rwk) : '00:00:00',
      revision_orden: tiempos.revision_orden ? msToInterval(tiempos.revision_orden) : '00:00:00'
    };

    // Mantener compatibilidad con el campo antiguo "aprobado"
    if (tiempos.aprobado && !tiempos.esperando_informacion) {
      tiemposConvertidos.esperando_informacion = msToInterval(tiempos.aprobado);
    }

    // Calcular tiempo total como suma de todos los tiempos de estado
    const tiempoTotalInterval = `${tiemposConvertidos.working} + ${tiemposConvertidos.pausa} + ${tiemposConvertidos.comida} + ${tiemposConvertidos['5s']} + ${tiemposConvertidos.meeting} + ${tiemposConvertidos.meeting_trabajo} + ${tiemposConvertidos.training} + ${tiemposConvertidos.pendiente} + ${tiemposConvertidos.esperando_informacion} + ${tiemposConvertidos.buscando_informacion} + ${tiemposConvertidos.documentacion} + ${tiemposConvertidos.cambios}`;

    console.log('Tiempos convertidos:', tiemposConvertidos);
    console.log('Tiempo total (suma de estados):', tiempoTotalInterval);

    // Asegurar columnas de tiempo en tiempo_diseno
    await apoyosPool.query(`
      ALTER TABLE tiempo_diseno
        ADD COLUMN IF NOT EXISTS tiempo_working INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_meeting_trabajo INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_training INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_esperando_informacion INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_buscando_informacion INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_documentacion INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_pdm_rwk INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_revision_orden INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_cambios INTERVAL;
    `);

    const result = await apoyosPool.query(
      `UPDATE tiempo_diseno 
       SET hora_fin = NOW(),
           tiempo_total   = $2::INTERVAL + $3::INTERVAL + $4::INTERVAL + $5::INTERVAL + $6::INTERVAL + $7::INTERVAL + $8::INTERVAL + $9::INTERVAL + $10::INTERVAL + $11::INTERVAL + $12::INTERVAL + $13::INTERVAL + $14::INTERVAL + $15::INTERVAL,
           tiempo_working = $2::INTERVAL,
           tiempo_pausa   = $3::INTERVAL,
           tiempo_comida  = $4::INTERVAL,
           tiempo_5s      = $5::INTERVAL,
           tiempo_meeting = $6::INTERVAL,
           tiempo_meeting_trabajo = $7::INTERVAL,
           tiempo_training = $8::INTERVAL,
           tiempo_pendiente = $9::INTERVAL,
           tiempo_esperando_informacion = $10::INTERVAL,
           tiempo_buscando_informacion = $11::INTERVAL,
           tiempo_documentacion = $12::INTERVAL,
           tiempo_cambios   = $13::INTERVAL,
           tiempo_pdm_rwk = $14::INTERVAL,
           tiempo_revision_orden = $15::INTERVAL,
           notas = $16
       WHERE id = $1
         RETURNING id, username, numero_parte, orden, hora_inicio, hora_fin, tiempo_total, tiempo_working, tiempo_pausa, tiempo_comida, tiempo_5s, tiempo_meeting, tiempo_meeting_trabajo, tiempo_training, tiempo_pendiente, tiempo_esperando_informacion, tiempo_buscando_informacion, tiempo_documentacion, tiempo_cambios, tiempo_pdm_rwk, tiempo_revision_orden, notas`,
      [
        id,
        tiemposConvertidos.working,
        tiemposConvertidos.pausa,
        tiemposConvertidos.comida,
        tiemposConvertidos['5s'],
        tiemposConvertidos.meeting,
        tiemposConvertidos.meeting_trabajo,
        tiemposConvertidos.training,
        tiemposConvertidos.pendiente,
        tiemposConvertidos.esperando_informacion,
        tiemposConvertidos.buscando_informacion,
        tiemposConvertidos.documentacion,
        tiemposConvertidos.cambios,
        tiemposConvertidos.pdm_rwk,
        tiemposConvertidos.revision_orden,
        notas || null
      ]
    );

    if (result.rowCount === 0) {
      console.error('❌ ERROR: No se encontró el registro con ID', id);
      return res.status(404).json({ success: false, error: 'Registro no encontrado' });
    }

    const record = result.rows[0];
    console.log('✅ Actualización exitosa:');
    console.log('  - ID:', record.id);
    console.log('  - Hora inicio:', record.hora_inicio);
    console.log('  - Hora fin:', record.hora_fin);
    console.log('  - Tiempo Pausa:', record.tiempo_pausa);
    console.log('  - Tiempo Comida:', record.tiempo_comida);
    console.log('  - Tiempo 5S:', record.tiempo_5s);
    console.log('  - Tiempo Meeting:', record.tiempo_meeting);
    console.log('  - Tiempo Pendiente:', record.tiempo_pendiente);
    console.log('  - Tiempo Aprobado:', record.tiempo_aprobado);
    console.log('  - Tiempo Total:', record.tiempo_total);

    // No cambiar automáticamente el estatus de la orden/submittal al finalizar jornada.
    // Esta acción solo debe cerrar la sesión activa y guardar tiempos.

    // Limpiar los campos en la tabla usuarios y establecer sesion_activa = FALSE
    console.log(' Limpiando campos de usuario y estableciendo sesion_activa = FALSE...');
    try {
      // Usar el username del registro ya obtenido
      const username = (record.username || '').toString().trim();
      if (username) {
        await apoyosPool.query(
          `UPDATE usuarios 
           SET orden_en_logeo = NULL,
               estado_en_orden = NULL,
               inicio_sesion = NULL,
               estado_trabajo = NULL,
               sesion_activa = FALSE
           WHERE LOWER(username) = LOWER($1)`,
          [username]
        );
        console.log(' Campos de usuario limpiados exitosamente y sesion_activa establecida en FALSE');
      } else {
        console.warn('⚠️ No se encontró username en el registro finalizado para limpiar campos en usuarios');
      }
    } catch (cleanupError) {
      console.error(' Error al limpiar campos de usuario:', cleanupError.message);
      // No detenemos el proceso, solo registramos el error
    }

    console.log('================================================\n');

    res.json({ 
      success: true, 
      record
    });
  } catch (error) {
    console.error('Error al finalizar tiempo de diseño:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ success: false, error: 'Error al actualizar tiempo_diseno: ' + error.message });
  }
});

// Cerrar todas las sesiones activas de usuarios de diseño (reset de campos en tabla usuarios)
app.post('/api/diseno/cerrar-sesiones-usuarios', async (req, res) => {
  const client = await apoyosPool.connect();
  try {
    console.log('\n========== CERRAR SESIONES DE USUARIOS (RESET USUARIOS) ==========');
    await client.query('BEGIN');

    // Asegurar columnas de tiempo para evitar fallos en instalaciones viejas
    await client.query(`
      ALTER TABLE tiempo_diseno
        ADD COLUMN IF NOT EXISTS tiempo_working INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_meeting_trabajo INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_training INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_esperando_informacion INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_buscando_informacion INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_documentacion INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_cambios INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_pdm_rwk INTERVAL,
        ADD COLUMN IF NOT EXISTS tiempo_revision_orden INTERVAL;
    `);

    // 1) Finalizar sesiones activas en tiempo_diseno y sumar el tiempo transcurrido
    //    al estado actual para no perder información al limpiar usuarios.
    const closedSessions = await client.query(
      `WITH sesiones_objetivo AS (
         SELECT
           td.id,
           LOWER(TRIM(td.username)) AS username_norm,
           GREATEST(NOW() - COALESCE(td.hora_inicio, NOW()), INTERVAL '0 second') AS elapsed,
           LOWER(TRIM(COALESCE(u.estado_trabajo, td.estado_trabajo, td.estado, 'working'))) AS estado_actual
         FROM tiempo_diseno td
         INNER JOIN usuarios u
           ON LOWER(TRIM(u.username)) = LOWER(TRIM(td.username))
         WHERE td.hora_fin IS NULL
           AND u.sesion_activa = TRUE
       )
       UPDATE tiempo_diseno td
       SET
         hora_fin = NOW(),
         tiempo_working = COALESCE(td.tiempo_working, INTERVAL '0 second') +
           CASE
             WHEN so.estado_actual IN ('working', 'trabajando', 'activo', 'trabajo')
               OR so.estado_actual NOT IN (
                 'pausa', 'comida', '5s', '5 s', '5-s',
                 'meeting', 'reunion', 'reunión', 'meeting trabajo', 'meeting_trabajo',
                 'training', 'capacitacion', 'capacitación',
                 'pendiente',
                 'esperando informacion', 'esperando información', 'esperando_informacion', 'aprobado',
                 'buscando informacion', 'buscando información', 'buscando_informacion',
                 'documentacion', 'documentación',
                 'cambios'
               )
             THEN so.elapsed
             ELSE INTERVAL '0 second'
           END,
         tiempo_pausa = COALESCE(td.tiempo_pausa, INTERVAL '0 second') +
           CASE WHEN so.estado_actual = 'pausa' THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_comida = COALESCE(td.tiempo_comida, INTERVAL '0 second') +
           CASE WHEN so.estado_actual = 'comida' THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_5s = COALESCE(td.tiempo_5s, INTERVAL '0 second') +
           CASE WHEN so.estado_actual IN ('5s', '5 s', '5-s') THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_meeting = COALESCE(td.tiempo_meeting, INTERVAL '0 second') +
           CASE WHEN so.estado_actual IN ('meeting', 'reunion', 'reunión') THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_meeting_trabajo = COALESCE(td.tiempo_meeting_trabajo, INTERVAL '0 second') +
           CASE WHEN so.estado_actual IN ('meeting trabajo', 'meeting_trabajo') THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_training = COALESCE(td.tiempo_training, INTERVAL '0 second') +
           CASE WHEN so.estado_actual IN ('training', 'capacitacion', 'capacitación') THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_pendiente = COALESCE(td.tiempo_pendiente, INTERVAL '0 second') +
           CASE WHEN so.estado_actual = 'pendiente' THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_esperando_informacion = COALESCE(td.tiempo_esperando_informacion, INTERVAL '0 second') +
           CASE WHEN so.estado_actual IN ('esperando informacion', 'esperando información', 'esperando_informacion', 'aprobado') THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_buscando_informacion = COALESCE(td.tiempo_buscando_informacion, INTERVAL '0 second') +
           CASE WHEN so.estado_actual IN ('buscando informacion', 'buscando información', 'buscando_informacion') THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_documentacion = COALESCE(td.tiempo_documentacion, INTERVAL '0 second') +
           CASE WHEN so.estado_actual IN ('documentacion', 'documentación') THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_cambios = COALESCE(td.tiempo_cambios, INTERVAL '0 second') +
           CASE WHEN so.estado_actual = 'cambios' THEN so.elapsed ELSE INTERVAL '0 second' END,
         tiempo_total =
           (
             COALESCE(td.tiempo_working, INTERVAL '0 second') +
             CASE
               WHEN so.estado_actual IN ('working', 'trabajando', 'activo', 'trabajo')
                 OR so.estado_actual NOT IN (
                   'pausa', 'comida', '5s', '5 s', '5-s',
                   'meeting', 'reunion', 'reunión', 'meeting trabajo', 'meeting_trabajo',
                   'training', 'capacitacion', 'capacitación',
                   'pendiente',
                   'esperando informacion', 'esperando información', 'esperando_informacion', 'aprobado',
                   'buscando informacion', 'buscando información', 'buscando_informacion',
                   'documentacion', 'documentación',
                   'cambios'
                 )
               THEN so.elapsed
               ELSE INTERVAL '0 second'
             END
           )
           + (COALESCE(td.tiempo_pausa, INTERVAL '0 second') + CASE WHEN so.estado_actual = 'pausa' THEN so.elapsed ELSE INTERVAL '0 second' END)
           + (COALESCE(td.tiempo_comida, INTERVAL '0 second') + CASE WHEN so.estado_actual = 'comida' THEN so.elapsed ELSE INTERVAL '0 second' END)
           + (COALESCE(td.tiempo_5s, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('5s', '5 s', '5-s') THEN so.elapsed ELSE INTERVAL '0 second' END)
           + (COALESCE(td.tiempo_meeting, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('meeting', 'reunion', 'reunión') THEN so.elapsed ELSE INTERVAL '0 second' END)
           + (COALESCE(td.tiempo_meeting_trabajo, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('meeting trabajo', 'meeting_trabajo') THEN so.elapsed ELSE INTERVAL '0 second' END)
           + (COALESCE(td.tiempo_training, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('training', 'capacitacion', 'capacitación') THEN so.elapsed ELSE INTERVAL '0 second' END)
           + (COALESCE(td.tiempo_pendiente, INTERVAL '0 second') + CASE WHEN so.estado_actual = 'pendiente' THEN so.elapsed ELSE INTERVAL '0 second' END)
           + (COALESCE(td.tiempo_esperando_informacion, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('esperando informacion', 'esperando información', 'esperando_informacion', 'aprobado') THEN so.elapsed ELSE INTERVAL '0 second' END)
           + (COALESCE(td.tiempo_buscando_informacion, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('buscando informacion', 'buscando información', 'buscando_informacion') THEN so.elapsed ELSE INTERVAL '0 second' END)
             + (COALESCE(td.tiempo_documentacion, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('documentacion', 'documentación') THEN so.elapsed ELSE INTERVAL '0 second' END)
               + (COALESCE(td.tiempo_cambios, INTERVAL '0 second') + CASE WHEN so.estado_actual = 'cambios' THEN so.elapsed ELSE INTERVAL '0 second' END)
              + (COALESCE(td.tiempo_pdm_rwk, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('pdm_rwk', 'pdm rwk', 'pdmrwk', 'retrabajo') THEN so.elapsed ELSE INTERVAL '0 second' END)
              + (COALESCE(td.tiempo_revision_orden, INTERVAL '0 second') + CASE WHEN so.estado_actual IN ('revision_orden', 'revision orden', 'revision', 'revisionorden') THEN so.elapsed ELSE INTERVAL '0 second' END)
       FROM sesiones_objetivo so
       WHERE td.id = so.id
       RETURNING td.id, td.username, td.orden, td.hora_inicio, td.hora_fin, td.tiempo_total`
    );

    // 2) Limpiar tabla usuarios para cerrar la sesión de forma consistente
    const result = await client.query(
      `UPDATE usuarios 
       SET orden_en_logeo = NULL,
           estado_en_orden = NULL,
           inicio_sesion = NULL,
           estado_trabajo = NULL,
           sesion_activa = FALSE
       WHERE sesion_activa = TRUE
       RETURNING id, username`
    );

    await client.query('COMMIT');

    const count = result.rowCount || 0;
    const closedCount = closedSessions.rowCount || 0;
    console.log(`✔ Sesiones de usuarios reseteadas. Usuarios afectados: ${count}`);
    console.log(`✔ Sesiones activas finalizadas en tiempo_diseno: ${closedCount}`);

    return res.json({
      success: true,
      updated: count,
      sesionesFinalizadas: closedCount,
      users: result.rows
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error en rollback al cerrar sesiones de usuarios:', rollbackError.message);
    }
    console.error('Error al cerrar sesiones de usuarios (reset usuarios):', error.message);
    console.error('Stack trace:', error.stack);
    return res.status(500).json({
      success: false,
      error: 'Error al cerrar sesiones de usuarios: ' + error.message
    });
  } finally {
    client.release();
  }
});

// Actualizar estado de ausencia del usuario
app.post('/api/diseno/update-status', async (req, res) => {
  try {
    console.log('\n========== ACTUALIZAR ESTADO DE USUARIO ==========');
    const { username, status, tipoEstado, presionado } = req.body;
    const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : null;
    const statusValue = normalizedStatus && normalizedStatus.length > 0 ? normalizedStatus : null;
    const isPressed = typeof presionado === 'boolean' ? presionado : statusValue !== null;
    const estadoParaPersistir = isPressed ? statusValue : null;
    
    console.log('Usuario:', username);
    console.log('Nuevo estado:', status);
    console.log('Tipo de estado:', tipoEstado);
    console.log('Presionado:', isPressed);

    if (!username) {
      return res.status(400).json({ success: false, error: 'Falta el nombre de usuario' });
    }

    if (!tipoEstado || !['trabajo', 'ausencia'].includes(tipoEstado)) {
      return res.status(400).json({ success: false, error: 'Tipo de estado inválido. Debe ser "trabajo" o "ausencia"' });
    }

    // Actualizar el campo correspondiente según el tipo de estado.
    // IMPORTANTE: al activar trabajo (presionado), limpiar estado_en_orden; si no, tras una pausa la BD
    // puede seguir marcando ausencia y loadActiveSession restaura pausa aunque estado_trabajo sea correcto.
    let result;
    if (tipoEstado === 'trabajo') {
      result = await apoyosPool.query(
        `UPDATE usuarios 
         SET estado_trabajo = $1,
             estado_en_orden = CASE WHEN $3::boolean = true THEN NULL ELSE estado_en_orden END
         WHERE LOWER(TRIM(username)) = LOWER(TRIM($2))
         RETURNING username, estado_trabajo, estado_en_orden, orden_en_logeo`,
        [estadoParaPersistir, username, isPressed]
      );
    } else {
      result = await apoyosPool.query(
        `UPDATE usuarios 
         SET estado_en_orden = $1
         WHERE LOWER(TRIM(username)) = LOWER(TRIM($2))
         RETURNING username, estado_trabajo, estado_en_orden, orden_en_logeo`,
        [estadoParaPersistir, username]
      );
    }

    if (result.rowCount === 0) {
      console.error('Usuario no encontrado:', username);
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    // Persistir el estado también en tiempo_diseno (sesión activa más reciente)
    // - trabajo  -> tiempo_diseno.estado_trabajo
    // - ausencia -> tiempo_diseno.estado
    try {
      await ensureCambiosEstadoTable();

      await apoyosPool.query(`
        ALTER TABLE tiempo_diseno
          ADD COLUMN IF NOT EXISTS estado_trabajo VARCHAR(50),
          ADD COLUMN IF NOT EXISTS estado VARCHAR(50);
      `);

      const activeSessionResult = await apoyosPool.query(
        `SELECT id
         FROM tiempo_diseno
         WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
           AND hora_fin IS NULL
         ORDER BY hora_inicio DESC
         LIMIT 1`,
        [username]
      );

      const activeSessionId = activeSessionResult.rows[0]?.id || null;

      if (!activeSessionId) {
        console.warn(`[update-status] No hay sesión activa en tiempo_diseno para ${username}; no se registró en cambios_estado.`);
      } else {
        try {
          const updateTiempoDiseno = await apoyosPool.query(
            `UPDATE tiempo_diseno
             SET
               estado_trabajo = CASE WHEN $2::text = 'trabajo' THEN $3 ELSE estado_trabajo END,
               estado = CASE
                 WHEN $2::text = 'trabajo' AND COALESCE($4::boolean, false) = true THEN NULL
                 WHEN $2::text = 'ausencia' THEN $3
                 ELSE estado
               END
             WHERE id = $1
             RETURNING id, estado_trabajo, estado`,
            [activeSessionId, tipoEstado, estadoParaPersistir, isPressed]
          );

          console.log(`Estado persistido en tiempo_diseno (filas afectadas: ${updateTiempoDiseno.rowCount})`);
          if (updateTiempoDiseno.rowCount > 0) {
            console.log('tiempo_diseno actualizado:', updateTiempoDiseno.rows[0]);
          }
        } catch (tdUpdateError) {
          console.error('Error al actualizar estado en tiempo_diseno:', tdUpdateError.message);
        }

        try {
          await apoyosPool.query(
            `INSERT INTO cambios_estado (tiempo_diseno_id, username, tipo_estado, estado, presionado, fecha_cambio)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [activeSessionId, username, tipoEstado, statusValue, isPressed]
          );
          console.log(`[update-status] Cambio registrado en cambios_estado: ${tipoEstado}:${statusValue} (presionado=${isPressed})`);
        } catch (cambioError) {
          console.error('Error al insertar cambio en cambios_estado:', cambioError.message);
        }
      }
    } catch (tdError) {
      console.error('Error al preparar persistencia de estado:', tdError.message);
      // No fallar la operación principal; usuarios ya fue actualizado
    }

    // Si el estado es "pendiente" y es de tipo "trabajo", actualizar el estatus de la orden/submittal y tiempo_diseno
    if (statusValue === 'pendiente' && tipoEstado === 'trabajo' && result.rows[0].orden_en_logeo) {
      try {
        const orderNumber = result.rows[0].orden_en_logeo;
        console.log('Actualizando estatus a "pendiente" para orden/submittal con número:', orderNumber);

        const resolveColumns = async (tableName) => {
          const cols = await apoyosPool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_name = $1
               AND column_name IN ('estatus', 'status', 'updated_at')`,
            [tableName]
          );
          const names = new Set(cols.rows.map(r => r.column_name));
          return {
            hasEstatus: names.has('estatus'),
            hasStatus: names.has('status'),
            hasUpdatedAt: names.has('updated_at')
          };
        };

        const ordenesCols = await resolveColumns('ordenes');
        const submittalsCols = await resolveColumns('submittals');

        const activeSession = await apoyosPool.query(
          `SELECT td.id,
                  TRIM(COALESCE(td.orden, '')) AS session_order,
                  TRIM(COALESCE(td.numero_parte, '')) AS session_part,
                  np.orden_id AS mapped_orden_id
           FROM tiempo_diseno td
           LEFT JOIN numero_parte np
             ON TRIM(COALESCE(np.numero_parte, '')) = TRIM(COALESCE(td.numero_parte, ''))
           WHERE LOWER(TRIM(td.username)) = LOWER(TRIM($1))
             AND td.hora_fin IS NULL
           ORDER BY td.hora_inicio DESC
           LIMIT 1`,
          [username]
        );

        const sessionRow = activeSession.rows[0] || null;
        const candidateNumbers = new Set(
          [
            orderNumber,
            sessionRow?.session_order || null,
            sessionRow?.session_part || null
          ]
            .map(v => (v || '').toString().trim())
            .filter(Boolean)
        );
        const candidateNumbersArray = [...candidateNumbers];
        const mappedOrdenId = sessionRow?.mapped_orden_id || null;

        // Asegurar columnas de tiempo_aprobado en ambas tablas
        await apoyosPool.query(`
          ALTER TABLE ordenes
          ADD COLUMN IF NOT EXISTS tiempo_aprobado TIMESTAMP;
        `);
        await apoyosPool.query(`
          ALTER TABLE submittals
          ADD COLUMN IF NOT EXISTS tiempo_aprobado TIMESTAMP;
        `);

        const ordenesSet = [];
        if (ordenesCols.hasEstatus) ordenesSet.push(`estatus = 'pendiente'`);
        if (ordenesCols.hasStatus) ordenesSet.push(`status = 'pendiente'`);
        if (ordenesCols.hasUpdatedAt) ordenesSet.push(`updated_at = NOW()`);
        ordenesSet.push(`tiempo_aprobado = CURRENT_TIMESTAMP`);

        let ordenesNonTerminalWhere = '';
        if (ordenesCols.hasEstatus && ordenesCols.hasStatus) {
          ordenesNonTerminalWhere = ` AND LOWER(TRIM(COALESCE(estatus, status, ''))) NOT IN ('aprobado', 'rechazado')`;
        } else if (ordenesCols.hasEstatus) {
          ordenesNonTerminalWhere = ` AND LOWER(TRIM(COALESCE(estatus, ''))) NOT IN ('aprobado', 'rechazado')`;
        } else if (ordenesCols.hasStatus) {
          ordenesNonTerminalWhere = ` AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('aprobado', 'rechazado')`;
        }

        const submittalsSet = [];
        if (submittalsCols.hasEstatus) submittalsSet.push(`estatus = 'pendiente'`);
        if (submittalsCols.hasStatus) submittalsSet.push(`status = 'pendiente'`);
        if (submittalsCols.hasUpdatedAt) submittalsSet.push(`updated_at = NOW()`);
        submittalsSet.push(`tiempo_aprobado = CURRENT_TIMESTAMP`);

        let submittalsNonTerminalWhere = '';
        if (submittalsCols.hasEstatus && submittalsCols.hasStatus) {
          submittalsNonTerminalWhere = ` AND LOWER(TRIM(COALESCE(estatus, status, ''))) NOT IN ('aprobado', 'rechazado')`;
        } else if (submittalsCols.hasEstatus) {
          submittalsNonTerminalWhere = ` AND LOWER(TRIM(COALESCE(estatus, ''))) NOT IN ('aprobado', 'rechazado')`;
        } else if (submittalsCols.hasStatus) {
          submittalsNonTerminalWhere = ` AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('aprobado', 'rechazado')`;
        }

        // 1) Actualizar estado pendiente en ordenes (por order_number y/o por orden_id mapeado)
        let updateOrdenes = { rowCount: 0 };
        if (ordenesSet.length > 0 && (candidateNumbersArray.length > 0 || mappedOrdenId)) {
          const whereByNumber = candidateNumbersArray.length > 0
            ? `TRIM(COALESCE(order_number, '')) = ANY($1::text[])`
            : `FALSE`;
          const whereById = mappedOrdenId ? ` OR id = $2` : '';
          const params = mappedOrdenId
            ? [candidateNumbersArray, mappedOrdenId]
            : [candidateNumbersArray];

          updateOrdenes = await apoyosPool.query(
            `UPDATE ordenes
             SET ${ordenesSet.join(', ')}
             WHERE (${whereByNumber}${whereById})${ordenesNonTerminalWhere}`,
            params
          );
        }
        console.log(`Estatus en tabla "ordenes" actualizado a "pendiente" (filas afectadas: ${updateOrdenes.rowCount})`);

        // 2) Actualizar estado pendiente en submittals (por submittal_number)
        let updateSubmittals = { rowCount: 0 };
        if (submittalsSet.length > 0 && candidateNumbersArray.length > 0) {
          updateSubmittals = await apoyosPool.query(
            `UPDATE submittals
             SET ${submittalsSet.join(', ')}
             WHERE TRIM(COALESCE(submittal_number, '')) = ANY($1::text[])${submittalsNonTerminalWhere}`,
            [candidateNumbersArray]
          );
        }
        console.log(`Estatus en tabla "submittals" actualizado a "pendiente" (filas afectadas: ${updateSubmittals.rowCount})`);
      } catch (orderError) {
        console.error('Error al actualizar estatus de orden/submittal a \"pendiente\":', orderError.message);
        // No fallar la operación principal si falla la actualización de la orden/submittal
      }
    }

    console.log('Estado actualizado exitosamente');
    console.log('================================================\n');

    res.json({ 
      success: true, 
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error al actualizar estado del usuario:', error.message);
    res.status(500).json({ success: false, error: 'Error al actualizar estado: ' + error.message });
  }
});

// Obtener sesiones del usuario
app.get('/api/diseno/sessions/:username', async (req, res) => {
  try {
    console.log('\n========== OBTENER SESIONES DE DISEÑO ==========');
    const { username } = req.params;
    
    console.log('Usuario:', username);

    const result = await apoyosPool.query(
      `SELECT 
        id,
        numero_parte,
        orden,
        cliente,
        estado,
        estado_orden,
        hora_inicio,
        hora_fin,
        (EXTRACT(EPOCH FROM hora_inicio) * 1000)::bigint AS hora_inicio_ms,
        (EXTRACT(EPOCH FROM hora_fin) * 1000)::bigint AS hora_fin_ms,
        tiempo_total,
        tiempo_pausa,
        tiempo_comida,
        tiempo_5s,
        tiempo_meeting,
        tiempo_pendiente,
        tiempo_esperando_informacion,
        tiempo_buscando_informacion,
        tiempo_aprobado,
        creado_en
       FROM tiempo_diseno
       WHERE username = $1
       ORDER BY creado_en DESC
       LIMIT 50`,
      [username]
    );

    console.log(`Se encontraron ${result.rows.length} sesiones`);
    console.log('================================================\n');

    res.json({ 
      success: true, 
      sessions: result.rows
    });
  } catch (error) {
    console.error('Error al obtener sesiones:', error.message);
    res.status(500).json({ success: false, error: 'Error al obtener sesiones: ' + error.message });
  }
});

// Obtener todos los tiempos de todos los usuarios de diseño
app.get('/api/diseno/all-user-times', async (req, res) => {
  try {
    // Permitir parámetros opcionales para filtros
    const { fecha_inicio, fecha_fin, incluir_activas } = req.query;
    
    let query = `SELECT 
        td.id,
        td.username,
        u.nombre_completo,
        td.numero_parte,
        td.orden,
        td.cliente,
        td.estado,
        td.estado_orden,
        td.hora_inicio,
        td.hora_fin,
        td.tiempo_total,
        td.tiempo_working,
        td.tiempo_pausa,
        td.tiempo_comida,
        td.tiempo_5s,
        td.tiempo_meeting,
        td.tiempo_meeting_trabajo,
        td.tiempo_training,
        td.tiempo_pdm_rwk,
        td.tiempo_revision_orden,
        td.tiempo_pendiente,
        td.tiempo_esperando_informacion,
        td.tiempo_buscando_informacion,
        td.tiempo_documentacion,
        td.tiempo_aprobado,
        td.tiempo_cambios,
        td.creado_en
       FROM tiempo_diseno td
       LEFT JOIN usuarios u ON u.username = td.username
       WHERE 1=1`;
    
    const params = [];
    let paramIndex = 1;
    
    // Filtrar por sesiones finalizadas o incluir activas si se solicita
    if (incluir_activas !== 'true') {
      query += ` AND td.hora_fin IS NOT NULL`;
    }
    
    // Filtrar por rango de fechas si se proporciona
    if (fecha_inicio) {
      query += ` AND DATE(td.hora_inicio) >= $${paramIndex}`;
      params.push(fecha_inicio);
      paramIndex++;
    }
    
    if (fecha_fin) {
      query += ` AND DATE(td.hora_inicio) <= $${paramIndex}`;
      params.push(fecha_fin);
      paramIndex++;
    }
    
    query += ` ORDER BY td.creado_en DESC`;
    
    // Aumentar el límite a 10000 para incluir más registros
    query += ` LIMIT 10000`;

    const result = await apoyosPool.query(query, params);

    res.json({ 
      success: true, 
      sessions: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error al obtener tiempos de usuarios:', error.message);
    res.status(500).json({ success: false, error: 'Error al obtener tiempos: ' + error.message });
  }
});

app.get('/api/diseno/timeline-cambios', async (req, res) => {
  try {
    const { fecha_inicio: fechaInicio, fecha_fin: fechaFin } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ success: false, error: 'fecha_inicio y fecha_fin son obligatorias' });
    }

    const rangeStart = new Date(`${fechaInicio}T00:00:00`);
    const rangeEnd = new Date(`${fechaFin}T23:59:59.999`);
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();

    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) {
      return res.status(400).json({ success: false, error: 'Fechas de rango inválidas' });
    }

    await ensureCambiosEstadoTable();

    const timelineResult = await apoyosPool.query(
      `SELECT
         td.id AS session_id,
         td.username,
         td.hora_inicio,
         td.hora_fin,
         td.orden,
         td.numero_parte,
         td.cliente,
         u.nombre_completo,
         u.foto_url,
         ce.id AS cambio_id,
         ce.tipo_estado,
         ce.estado AS cambio_estado,
         ce.presionado,
         ce.fecha_cambio
       FROM tiempo_diseno td
       LEFT JOIN cambios_estado ce ON ce.tiempo_diseno_id = td.id
       LEFT JOIN usuarios u ON LOWER(TRIM(u.username)) = LOWER(TRIM(td.username))
       WHERE DATE(td.hora_inicio) BETWEEN $1 AND $2
       ORDER BY LOWER(TRIM(td.username)), td.id, ce.fecha_cambio ASC, ce.id ASC`,
      [fechaInicio, fechaFin]
    );

    const sessionsMap = new Map();
    for (const row of timelineResult.rows) {
      if (!row) continue;
      let sessionEntry = sessionsMap.get(row.session_id);
      if (!sessionEntry) {
        sessionEntry = {
          id: row.session_id,
          username: row.username,
          nombre_completo: row.nombre_completo,
          avatar: row.foto_url,
          hora_inicio: row.hora_inicio,
          hora_fin: row.hora_fin,
          orden: row.orden,
          numero_parte: row.numero_parte,
          cliente: row.cliente,
          eventos: []
        };
        sessionsMap.set(row.session_id, sessionEntry);
      }

      if (row.cambio_id) {
        sessionEntry.eventos.push({
          tipo_estado: row.tipo_estado,
          estado: row.cambio_estado,
          presionado: row.presionado,
          fecha_cambio: row.fecha_cambio
        });
      }
    }

    const timelineByUser = new Map();

    for (const sessionEntry of sessionsMap.values()) {
      const segments = buildTimelineSegmentsForSession(
        sessionEntry,
        sessionEntry.eventos,
        rangeStartMs,
        rangeEndMs
      );

      if (!segments.length) {
        continue;
      }

      const userKey = (sessionEntry.username || 'desconocido').toString().trim().toLowerCase() || 'desconocido';
      let userTimeline = timelineByUser.get(userKey);

      if (!userTimeline) {
        userTimeline = {
          username: sessionEntry.username,
          nombre: sessionEntry.nombre_completo || sessionEntry.username || 'Desconocido',
          avatar: sessionEntry.avatar || null,
          segments: [],
          totalTrabajoMs: 0
        };
        timelineByUser.set(userKey, userTimeline);
      }

      segments.forEach((segment) => {
        userTimeline.segments.push(segment);
        if (segment.tipo === 'trabajo') {
          userTimeline.totalTrabajoMs += segment.durationMs;
        }
      });
    }

    const timelineRows = Array.from(timelineByUser.values()).sort((a, b) => {
      const nameA = (a.nombre || '').toString().toLowerCase();
      const nameB = (b.nombre || '').toString().toLowerCase();
      return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    });

    return res.json({ success: true, timeline: timelineRows });
  } catch (error) {
    console.error('Error al construir timeline desde cambios_estado:', error.message);
    return res.status(500).json({ success: false, error: 'Error al construir timeline' });
  }
});

// Obtener usuarios logeados y tiempo acumulado por orden/submittal
app.get('/api/diseno/order-users-time', async (req, res) => {
  try {
    const orderNumber = String(req.query.order_number || '').trim();

    if (!orderNumber) {
      return res.status(400).json({ success: false, error: 'order_number es requerido' });
    }

    const timeExpression = `
      COALESCE(
        td.tiempo_total,
        COALESCE(td.tiempo_working, INTERVAL '0 second')
          + COALESCE(td.tiempo_pausa, INTERVAL '0 second')
          + COALESCE(td.tiempo_comida, INTERVAL '0 second')
          + COALESCE(td.tiempo_5s, INTERVAL '0 second')
          + COALESCE(td.tiempo_meeting, INTERVAL '0 second')
          + COALESCE(td.tiempo_meeting_trabajo, INTERVAL '0 second')
          + COALESCE(td.tiempo_training, INTERVAL '0 second')
          + COALESCE(td.tiempo_pendiente, INTERVAL '0 second')
          + COALESCE(td.tiempo_esperando_informacion, INTERVAL '0 second')
          + COALESCE(td.tiempo_buscando_informacion, INTERVAL '0 second')
          + COALESCE(td.tiempo_cambios, INTERVAL '0 second'),
        CASE
          WHEN td.hora_inicio IS NOT NULL THEN COALESCE(td.hora_fin, NOW()) - td.hora_inicio
          ELSE INTERVAL '0 second'
        END
      )
    `;

    const result = await apoyosPool.query(
      `SELECT
         td.username,
         COALESCE(NULLIF(TRIM(u.nombre_completo), ''), td.username) AS nombre_completo,
         COUNT(*)::INTEGER AS sesiones,
         COALESCE(SUM(EXTRACT(EPOCH FROM ${timeExpression})), 0)::BIGINT AS total_seconds,
         MAX(td.hora_inicio) AS ultima_actividad
       FROM tiempo_diseno td
       LEFT JOIN usuarios u ON u.username = td.username
       WHERE LOWER(TRIM(td.orden)) = LOWER(TRIM($1))
       GROUP BY td.username, u.nombre_completo
       ORDER BY total_seconds DESC, nombre_completo ASC`,
      [orderNumber]
    );

    const users = result.rows.map((row) => ({
      username: row.username,
      nombre_completo: row.nombre_completo,
      sesiones: Number(row.sesiones || 0),
      total_seconds: Number(row.total_seconds || 0),
      ultima_actividad: row.ultima_actividad
    }));

    const totalSeconds = users.reduce((acc, user) => acc + (Number(user.total_seconds) || 0), 0);

    return res.json({
      success: true,
      order_number: orderNumber,
      total_seconds: totalSeconds,
      users
    });
  } catch (error) {
    console.error('Error al obtener usuarios/tiempo por orden:', error.message);
    return res.status(500).json({ success: false, error: 'Error al obtener el tiempo por orden' });
  }
});

// Endpoint de prueba simple - TEST DIRECT
app.post('/api/diseno/test-insert', async (req, res) => {
  try {
    console.log('\n========== TEST INSERT SIMPLE ==========');
    console.log('Datos recibidos:', req.body);
    
    const { username = 'test', partNumber = 'TEST-' + Date.now() } = req.body || {};
    
    const result = await apoyosPool.query(
      `INSERT INTO tiempo_diseno (username, numero_parte, tipo, estado, estado_orden, hora_inicio)
       VALUES ($1, $2, 'meeting', 'pendiente', 'En Proceso', NOW())
       RETURNING id, username, numero_parte, hora_inicio`,
      [username, partNumber]
    );
    
    console.log(' Inserción de prueba exitosa:', result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error(' Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint temporal para ver estructura de tiempo_diseno
app.get('/api/diseno/check-table', async (req, res) => {
  try {
    const result = await apoyosPool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tiempo_diseno' 
      ORDER BY ordinal_position
    `);
    res.json({ success: true, columns: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Actualizar notas de la sesión activa sin finalizar
app.put('/api/diseno/update-notes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { notas } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Falta el ID del registro' });
    }

    // Asegurar que las columnas notas y updated_at existen
    try {
      await apoyosPool.query(`
        ALTER TABLE tiempo_diseno
          ADD COLUMN IF NOT EXISTS notas TEXT,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      `);
    } catch (alterError) {
      // Si falla, puede ser que las columnas ya existan
      console.log('Nota: No se pudo agregar columnas (pueden que ya existan):', alterError.message);
    }

    // Construir la consulta UPDATE de manera segura
    let updateQuery = `UPDATE tiempo_diseno SET notas = $1`;
    const queryParams = [notas || null];
    
    // Verificar si updated_at existe antes de actualizarlo
    try {
      const columnCheck = await apoyosPool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'updated_at'
      `);
      if (columnCheck.rows.length > 0) {
        updateQuery += `, updated_at = NOW()`;
      }
    } catch (checkError) {
      console.log('No se pudo verificar columna updated_at:', checkError.message);
    }
    
    updateQuery += ` WHERE id = $2 AND hora_fin IS NULL RETURNING id, notas, orden`;
    queryParams.push(id);

    const result = await apoyosPool.query(updateQuery, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Registro no encontrado o sesión ya finalizada' });
    }

    const tiempoDisenoRecord = result.rows[0];
    const orderNumber = tiempoDisenoRecord.orden;

    // Si hay un order_number, también actualizar la tabla ordenes
    if (orderNumber) {
      try {
        // Asegurar que la columna notas existe en ordenes
        await apoyosPool.query(`
          ALTER TABLE ordenes
            ADD COLUMN IF NOT EXISTS notas TEXT;
        `);

        // Actualizar notas en la tabla ordenes
        await apoyosPool.query(
          `UPDATE ordenes 
           SET notas = $1, updated_at = NOW()
           WHERE order_number = $2`,
          [notas || null, orderNumber]
        );
        console.log(`Notas actualizadas en ordenes para order_number: ${orderNumber}`);
      } catch (ordenError) {
        console.error('Error al actualizar notas en ordenes:', ordenError.message);
        // No fallar la operación principal si falla la actualización en ordenes
      }
    }

    res.json({ 
      success: true, 
      message: 'Notas actualizadas exitosamente',
      notas: tiempoDisenoRecord.notas
    });
  } catch (error) {
    console.error('Error al actualizar notas:', error.message);
    res.status(500).json({ success: false, error: 'Error al actualizar notas: ' + error.message });
  }
});

// Obtener sesión activa del usuario (para cargarla al iniciar sesión)
// GET - Verificar notificaciones de aprobación/declinación para el usuario actual
app.get('/api/diseno/notificaciones/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ success: false, error: 'Falta el nombre de usuario' });
    }

    // Buscar sesión activa del usuario
    const sessionResult = await apoyosPool.query(
      `SELECT orden, estado_orden, numero_parte
       FROM tiempo_diseno
       WHERE username = $1 AND hora_fin IS NULL
       ORDER BY hora_inicio DESC
       LIMIT 1`,
      [username]
    );

    if (sessionResult.rows.length === 0) {
      return res.json({ success: true, hasNotification: false });
    }

    // Asegurar que las columnas de anuncios existen
    try {
      await apoyosPool.query(`
        ALTER TABLE ordenes 
        ADD COLUMN IF NOT EXISTS anuncio_pm BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS anuncio_disenador BOOLEAN DEFAULT FALSE;
      `);
      await apoyosPool.query(`
        ALTER TABLE submittals 
        ADD COLUMN IF NOT EXISTS anuncio_pm BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS anuncio_disenador BOOLEAN DEFAULT FALSE;
      `);
    } catch (alterErr) {
      logger.debug('Columnas de anuncios ya existen:', alterErr.message);
    }

    const session = sessionResult.rows[0];
    const orderNumber = session.orden || session.numero_parte;

    if (!orderNumber) {
      return res.json({ success: true, hasNotification: false });
    }

    // Asegurar que las columnas ruta_pdf existen
    try {
      await apoyosPool.query(`
        ALTER TABLE ordenes 
        ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500);
      `);
      await apoyosPool.query(`
        ALTER TABLE submittals 
        ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500);
      `);
    } catch (alterErr) {
      logger.debug('Columnas ruta_pdf ya existen:', alterErr.message);
    }

    // Verificar si hay anuncio_pm = TRUE en ordenes o submittals
    // Y que NO tenga ruta_pdf (no se ha subido el PDF aún)
    const ordenCheck = await apoyosPool.query(
      `SELECT order_number, estatus, ruta_pdf FROM ordenes 
       WHERE order_number = $1 
         AND anuncio_pm = TRUE 
         AND anuncio_disenador = FALSE
         AND (ruta_pdf IS NULL OR ruta_pdf = '')`,
      [orderNumber]
    );

    const submittalCheck = await apoyosPool.query(
      `SELECT submittal_number, estatus, ruta_pdf FROM submittals 
       WHERE submittal_number = $1 
         AND anuncio_pm = TRUE 
         AND anuncio_disenador = FALSE
         AND (ruta_pdf IS NULL OR ruta_pdf = '')`,
      [orderNumber]
    );

    // Si hay un anuncio pendiente SIN PDF, mostrar la notificación
    if (ordenCheck.rows.length > 0 || submittalCheck.rows.length > 0) {
      const tipo = ordenCheck.rows.length > 0 ? 'orden' : 'submittal';
      return res.json({
        success: true,
        hasNotification: true,
        type: 'aprobado',
        message: `El PM aprobó la ${tipo} ${orderNumber}`,
        order_number: orderNumber,
        requires_pdf: true
      });
    }

    // También verificar estado_orden por compatibilidad con el sistema anterior
    const estadoOrden = session.estado_orden;
    if (estadoOrden && estadoOrden.includes('Aprobado por PM')) {
      return res.json({
        success: true,
        hasNotification: true,
        type: 'aprobado',
        message: `El PM aprobó la ${session.orden ? 'orden' : 'submittal'} ${orderNumber}`,
        order_number: orderNumber
      });
    } else if (estadoOrden && estadoOrden.includes('Rechazado por PM')) {
      return res.json({
        success: true,
        hasNotification: true,
        type: 'rechazado',
        message: `El PM rechazó la ${session.orden ? 'orden' : 'submittal'} ${orderNumber}. Por favor corrige los números de parte.`,
        order_number: orderNumber
      });
    }

    res.json({ success: true, hasNotification: false });
  } catch (error) {
    logger.error('Error al verificar notificaciones:', error);
    res.status(500).json({ success: false, error: 'Error al verificar notificaciones' });
  }
});

// POST - Confirmar aprobación PM y subir PDF del plano
app.post('/api/diseno/confirmar-aprobacion', uploadPdf.single('pdf'), async (req, res) => {
  try {
    const { order_number, username } = req.body;
    
    if (!order_number) {
      return res.status(400).json({ error: 'Falta el número de orden/submittal' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Debes subir un archivo PDF del plano' });
    }

    const filePath = `/uploads/${req.file.filename}`;
    const uploadedBy = username || req.session?.username || 'Desconocido';

    // Actualizar estado_orden en tiempo_diseno para indicar que se confirmó la aprobación
    // También marcar anuncio_disenador = TRUE y anuncio_pm = FALSE en ordenes/submittals
    // Y guardar la ruta del PDF en ruta_pdf
    try {
      // Asegurar que la columna ruta_pdf existe
      await apoyosPool.query(`
        ALTER TABLE ordenes 
        ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500);
      `);
      await apoyosPool.query(`
        ALTER TABLE submittals 
        ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500);
      `);
    } catch (alterErr) {
      logger.debug('Columnas ruta_pdf ya existen:', alterErr.message);
    }

    try {
      // Marcar anuncio_disenador = TRUE, anuncio_pm = FALSE y guardar ruta_pdf en ordenes
      const ordenUpdate = await apoyosPool.query(
        `UPDATE ordenes 
         SET anuncio_disenador = TRUE, anuncio_pm = FALSE, ruta_pdf = $1
         WHERE order_number = $2`,
        [filePath, order_number]
      );
      
      // Si no se actualizó en ordenes, intentar en submittals
      if (ordenUpdate.rowCount === 0) {
        await apoyosPool.query(
          `UPDATE submittals 
           SET anuncio_disenador = TRUE, anuncio_pm = FALSE, ruta_pdf = $1
           WHERE submittal_number = $2`,
          [filePath, order_number]
        );
      } else {
        // También actualizar submittals si existe
        await apoyosPool.query(
          `UPDATE submittals 
           SET anuncio_disenador = TRUE, anuncio_pm = FALSE, ruta_pdf = $1
           WHERE submittal_number = $2`,
          [filePath, order_number]
        );
      }

      await apoyosPool.query(
        `UPDATE tiempo_diseno 
         SET estado_orden = 'Aprobado y confirmado por diseñador',
             pdf_plano_path = $1,
             pdf_plano_subido_por = $2,
             pdf_plano_fecha_subida = CURRENT_TIMESTAMP
         WHERE orden = $3 AND hora_fin IS NULL`,
        [filePath, uploadedBy, order_number]
      );
    } catch (err) {
      // Si la columna pdf_plano_path no existe, intentar agregarla
      try {
        await apoyosPool.query(`
          ALTER TABLE tiempo_diseno
          ADD COLUMN IF NOT EXISTS pdf_plano_path TEXT,
          ADD COLUMN IF NOT EXISTS pdf_plano_subido_por VARCHAR(255),
          ADD COLUMN IF NOT EXISTS pdf_plano_fecha_subida TIMESTAMP;
        `);
        
        // Intentar actualizar de nuevo
        await apoyosPool.query(
          `UPDATE tiempo_diseno 
           SET estado_orden = 'Aprobado y confirmado por diseñador',
               pdf_plano_path = $1,
               pdf_plano_subido_por = $2,
               pdf_plano_fecha_subida = CURRENT_TIMESTAMP
           WHERE orden = $3 AND hora_fin IS NULL`,
          [filePath, uploadedBy, order_number]
        );
      } catch (alterErr) {
        logger.warn('No se pudo agregar columnas de PDF o actualizar estado:', alterErr.message);
        // Continuar de todas formas, al menos actualizar el estado
        await apoyosPool.query(
          `UPDATE tiempo_diseno 
           SET estado_orden = 'Aprobado y confirmado por diseñador'
           WHERE orden = $1 AND hora_fin IS NULL`,
          [order_number]
        );
      }
    }

    logger.info('Aprobación confirmada y PDF subido', { 
      order_number, 
      username: uploadedBy,
      file_path: filePath 
    });

    res.json({ 
      success: true,
      message: 'Aprobación confirmada y PDF subido exitosamente',
      file_path: filePath
    });
  } catch (error) {
    logger.error('Error al confirmar aprobación:', error);
    res.status(500).json({ error: 'Error al confirmar la aprobación', message: error.message });
  }
});

  // GET - Obtener todas las órdenes/submittals aprobadas asignadas al usuario
app.get('/api/diseno/ordenes-aprobadas/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ error: 'Falta el nombre de usuario' });
    }

    // Asegurar que las columnas existen
    try {
      await apoyosPool.query(`
        ALTER TABLE ordenes 
        ADD COLUMN IF NOT EXISTS anuncio_pm BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS anuncio_disenador BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500);
      `);
      await apoyosPool.query(`
        ALTER TABLE submittals 
        ADD COLUMN IF NOT EXISTS anuncio_pm BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS anuncio_disenador BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500);
      `);
    } catch (alterErr) {
      logger.debug('Columnas de anuncios y ruta_pdf ya existen:', alterErr.message);
    }

    // Buscar órdenes aprobadas asignadas al usuario (con o sin PDF)
    const ordenesResult = await apoyosPool.query(
      `SELECT DISTINCT o.order_number, o.estatus, o.fecha_aprobacion, o.ruta_pdf, 'orden' as tipo
       FROM ordenes o
       INNER JOIN tiempo_diseno td ON td.orden = o.order_number
       WHERE td.username = $1 
         AND o.estatus = 'aprobado'
       ORDER BY o.fecha_aprobacion DESC`,
      [username]
    );

    // Buscar submittals aprobados asignados al usuario (con o sin PDF)
    const submittalsResult = await apoyosPool.query(
      `SELECT DISTINCT s.submittal_number as order_number, s.estatus, s.fecha_aprobacion, s.ruta_pdf, 'submittal' as tipo
       FROM submittals s
       INNER JOIN tiempo_diseno td ON td.orden = s.submittal_number
       WHERE td.username = $1 
         AND s.estatus = 'aprobado'
       ORDER BY s.fecha_aprobacion DESC`,
      [username]
    );

    const allOrders = [...ordenesResult.rows, ...submittalsResult.rows];

    res.json({ 
      success: true,
      orders: allOrders
    });
  } catch (error) {
    logger.error('Error al obtener órdenes aprobadas:', error);
    res.status(500).json({ error: 'Error al obtener órdenes aprobadas', message: error.message });
  }
});

// GET - Órdenes/Submittals con PDF subido por usuario
app.get('/api/diseno/ordenes-subidas-por/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) {
      return res.status(400).json({ error: 'Falta el nombre de usuario' });
    }

    const key = username.trim().toLowerCase();

    const result = await apoyosPool.query(`
      SELECT DISTINCT
        COALESCE(td.orden, o.order_number, s.submittal_number) AS order_number,
        COALESCE(o.project_name, o.customer_job, o.order_name, o.nombre, s.project_name, s.nombre) AS order_name,
        COALESCE(td.pdf_plano_path, o.ruta_pdf, s.ruta_pdf) AS pdf_path,
        COALESCE(td.pdf_plano_subido_por, o.usuario_pdf, s.usuario_pdf) AS uploaded_by,
        td.pdf_plano_fecha_subida AS fecha_subida,
        CASE WHEN o.order_number IS NOT NULL THEN 'orden' WHEN s.submittal_number IS NOT NULL THEN 'submittal' ELSE 'orden' END as tipo
      FROM tiempo_diseno td
      LEFT JOIN ordenes o ON o.order_number = td.orden
      LEFT JOIN submittals s ON s.submittal_number = td.orden
      WHERE (LOWER(TRIM(td.pdf_plano_subido_por)) = $1 AND td.pdf_plano_path IS NOT NULL)
         OR (LOWER(TRIM(o.usuario_pdf)) = $1 AND o.ruta_pdf IS NOT NULL)
         OR (LOWER(TRIM(s.usuario_pdf)) = $1 AND s.ruta_pdf IS NOT NULL)
      ORDER BY fecha_subida DESC NULLS LAST
    `, [key]);

    return res.json({ success: true, orders: result.rows });
  } catch (error) {
    console.error('Error al obtener órdenes subidas por usuario:', error);
    return res.status(500).json({ success: false, error: 'Error al obtener órdenes', message: error.message });
  }
});

// GET - Búsqueda libre: buscar órdenes/submittals por coincidencia parcial del uploader
app.get('/api/diseno/ordenes-subidas-search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ success: false, error: 'Falta query q' });

    const key = `%${q.toLowerCase()}%`;

    const result = await apoyosPool.query(`
      SELECT DISTINCT
        COALESCE(td.orden, o.order_number, s.submittal_number) AS order_number,
        COALESCE(o.project_name, o.customer_job, o.order_name, o.nombre, s.project_name, s.nombre) AS order_name,
        COALESCE(td.pdf_plano_path, o.ruta_pdf, s.ruta_pdf) AS pdf_path,
        COALESCE(td.pdf_plano_subido_por, o.usuario_pdf, s.usuario_pdf) AS uploaded_by,
        td.pdf_plano_fecha_subida AS fecha_subida,
        CASE WHEN o.order_number IS NOT NULL THEN 'orden' WHEN s.submittal_number IS NOT NULL THEN 'submittal' ELSE 'orden' END as tipo
      FROM tiempo_diseno td
      LEFT JOIN ordenes o ON o.order_number = td.orden
      LEFT JOIN submittals s ON s.submittal_number = td.orden
      WHERE (LOWER(COALESCE(td.pdf_plano_subido_por, '')) LIKE $1 AND td.pdf_plano_path IS NOT NULL)
         OR (LOWER(COALESCE(o.usuario_pdf, '')) LIKE $1 AND o.ruta_pdf IS NOT NULL)
         OR (LOWER(COALESCE(s.usuario_pdf, '')) LIKE $1 AND s.ruta_pdf IS NOT NULL)
      ORDER BY fecha_subida DESC NULLS LAST
    `, [key]);

    return res.json({ success: true, orders: result.rows });
  } catch (error) {
    console.error('Error en búsqueda de órdenes subidas:', error);
    return res.status(500).json({ success: false, error: 'Error en búsqueda', message: error.message });
  }
});

// POST - Subir PDF de orden aprobada
app.post('/api/diseno/subir-pdf-orden-aprobada', uploadPdf.single('pdf'), async (req, res) => {
  try {
    const { order_number, username } = req.body;
    
    if (!order_number) {
      return res.status(400).json({ error: 'Falta el número de orden/submittal' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Debes subir un archivo PDF del plano' });
    }

    const filePath = `/uploads/${req.file.filename}`;
    const uploadedBy = username || req.session?.username || 'Desconocido';

    // Asegurar que las columnas ruta_pdf y usuario_pdf existen
    try {
      await apoyosPool.query(`
        ALTER TABLE ordenes 
        ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500),
        ADD COLUMN IF NOT EXISTS usuario_pdf VARCHAR(100);
      `);
      await apoyosPool.query(`
        ALTER TABLE submittals 
        ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500),
        ADD COLUMN IF NOT EXISTS usuario_pdf VARCHAR(100);
      `);
    } catch (alterErr) {
      logger.debug('Columnas ruta_pdf ya existen:', alterErr.message);
    }

    // Actualizar ordenes o submittals para marcar anuncio_disenador = TRUE y guardar ruta_pdf y usuario_pdf
    try {
      // Intentar actualizar en ordenes
      const ordenUpdate = await apoyosPool.query(
        `UPDATE ordenes 
         SET anuncio_disenador = TRUE, anuncio_pm = FALSE, ruta_pdf = $1, usuario_pdf = $3
         WHERE order_number = $2`,
        [filePath, order_number, uploadedBy]
      );

      // Si no se actualizó en ordenes, intentar en submittals
      if (ordenUpdate.rowCount === 0) {
        await apoyosPool.query(
          `UPDATE submittals 
           SET anuncio_disenador = TRUE, anuncio_pm = FALSE, ruta_pdf = $1, usuario_pdf = $3
           WHERE submittal_number = $2`,
          [filePath, order_number, uploadedBy]
        );
      } else {
        // También actualizar submittals si existe
        await apoyosPool.query(
          `UPDATE submittals 
           SET anuncio_disenador = TRUE, anuncio_pm = FALSE, ruta_pdf = $1, usuario_pdf = $3
           WHERE submittal_number = $2`,
          [filePath, order_number, uploadedBy]
        );
      }
    } catch (updateErr) {
      logger.warn('Error al actualizar anuncio_disenador y ruta_pdf:', updateErr.message);
    }

    // Actualizar tiempo_diseno con el PDF
    try {
      await apoyosPool.query(
        `UPDATE tiempo_diseno 
         SET pdf_plano_path = $1,
             pdf_plano_subido_por = $2,
             pdf_plano_fecha_subida = CURRENT_TIMESTAMP
         WHERE orden = $3`,
        [filePath, uploadedBy, order_number]
      );
    } catch (err) {
      // Si la columna pdf_plano_path no existe, intentar agregarla
      try {
        await apoyosPool.query(`
          ALTER TABLE tiempo_diseno
          ADD COLUMN IF NOT EXISTS pdf_plano_path TEXT,
          ADD COLUMN IF NOT EXISTS pdf_plano_subido_por VARCHAR(255),
          ADD COLUMN IF NOT EXISTS pdf_plano_fecha_subida TIMESTAMP;
        `);
        
        // Intentar actualizar de nuevo
        await apoyosPool.query(
          `UPDATE tiempo_diseno 
           SET pdf_plano_path = $1,
               pdf_plano_subido_por = $2,
               pdf_plano_fecha_subida = CURRENT_TIMESTAMP
           WHERE orden = $3`,
          [filePath, uploadedBy, order_number]
        );
      } catch (alterErr) {
        logger.warn('No se pudo agregar columnas de PDF:', alterErr.message);
      }
    }

    logger.info('PDF de orden aprobada subido', { 
      order_number, 
      username: uploadedBy,
      file_path: filePath 
    });

    res.json({ 
      success: true,
      message: 'PDF subido exitosamente',
      file_path: filePath
    });
  } catch (error) {
    logger.error('Error al subir PDF de orden aprobada:', error);
    res.status(500).json({ error: 'Error al subir el PDF', message: error.message });
  }
});

// GET - Top 5 diseñadores por cantidad de PDFs subidos (usuario_pdf en ordenes y submittals)
app.get('/api/diseno/top-pdf-designers', async (req, res) => {
  try {
    // Asegurar columnas usuario_pdf existen (por si se llama antes de la primera subida)
    try {
      await apoyosPool.query(`
        ALTER TABLE ordenes 
        ADD COLUMN IF NOT EXISTS usuario_pdf VARCHAR(100);
      `);
      await apoyosPool.query(`
        ALTER TABLE submittals 
        ADD COLUMN IF NOT EXISTS usuario_pdf VARCHAR(100);
      `);
    } catch (alterErr) {
      logger.debug('Columnas usuario_pdf ya existen:', alterErr.message);
    }

    const result = await apoyosPool.query(`
      WITH pdf_events AS (
        SELECT LOWER(TRIM(usuario_pdf)) AS username_key
        FROM ordenes
        WHERE usuario_pdf IS NOT NULL AND TRIM(usuario_pdf) <> ''
        UNION ALL
        SELECT LOWER(TRIM(usuario_pdf)) AS username_key
        FROM submittals
        WHERE usuario_pdf IS NOT NULL AND TRIM(usuario_pdf) <> ''
      ),
      counts AS (
        SELECT username_key, COUNT(*) AS total_pdfs
        FROM pdf_events
        GROUP BY username_key
      )
      SELECT 
        c.username_key AS username,
        COALESCE(u.nombre_completo, c.username_key) AS nombre,
        c.total_pdfs
      FROM counts c
      LEFT JOIN usuarios u
        ON LOWER(TRIM(u.username)) = c.username_key
      ORDER BY c.total_pdfs DESC, nombre ASC
      LIMIT 5;
    `);

    return res.json({
      success: true,
      designers: result.rows
    });
  } catch (error) {
    logger.error('Error al obtener top-pdf-designers:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener top de diseñadores por PDFs',
      message: error.message
    });
  }
});

// GET - Top 10 diseñadores por puntaje calculado (tiempo comida vs tiempo total)
app.get('/api/diseno/top-designers-score', async (req, res) => {
  try {
    const result = await apoyosPool.query(`
      SELECT LOWER(TRIM(username)) AS username_key,
             SUM(EXTRACT(EPOCH FROM COALESCE(tiempo_total, '0 seconds'::interval))) AS total_secs,
             SUM(EXTRACT(EPOCH FROM COALESCE(tiempo_comida, '0 seconds'::interval))) AS comida_secs
      FROM tiempo_diseno
      GROUP BY LOWER(TRIM(username))
    `);

    const rows = (result.rows || []).map(r => {
      const total = Number(r.total_secs) || 0;
      const comida = Number(r.comida_secs) || 0;
      const meal_ratio = total > 0 ? (comida / total) : 0;
      let score = 0;
      if (total <= 0) {
        score = 0;
      } else {
        if (meal_ratio <= 0.1) {
          score = 100;
        } else {
          score = (1 - (meal_ratio - 0.1) / 0.9) * 100;
          if (score < 0) score = 0;
        }
      }
      return {
        username_key: r.username_key,
        total_secs: total,
        comida_secs: comida,
        meal_ratio: meal_ratio,
        score: Number(score.toFixed(3))
      };
    });

    const userKeys = rows.map(r => r.username_key).filter(Boolean);
    let usersMap = {};
    if (userKeys.length > 0) {
      const usersRes = await apoyosPool.query(`
        SELECT LOWER(TRIM(username)) AS username_key, nombre_completo
        FROM usuarios
        WHERE LOWER(TRIM(username)) = ANY($1)
      `, [userKeys]);
      usersRes.rows.forEach(u => { usersMap[u.username_key] = u.nombre_completo; });
    }

    const enriched = rows.map(r => ({
      username: r.username_key,
      nombre: usersMap[r.username_key] || r.username_key,
      total_secs: r.total_secs,
      comida_secs: r.comida_secs,
      meal_ratio: r.meal_ratio,
      score: r.score,
      total_hours_decimal: Number((r.total_secs / 3600).toFixed(3))
    }));

    enriched.sort((a, b) => b.score - a.score);
    const top10 = enriched.slice(0, 10);

    return res.json({ success: true, designers: top10 });
  } catch (error) {
    logger.error('Error al obtener top-designers-score:', error);
    return res.status(500).json({ success: false, error: 'Error al obtener top de diseñadores por puntaje', message: error.message });
  }
});

// POST - Subir BOM (Excel) y guardar ruta por número de parte
app.post('/api/diseno/subir-bom-excel', uploadExcelBom.single('bom'), async (req, res) => {
  try {
    const { part_id } = req.body;
    const partId = parseInt(part_id, 10);

    if (isNaN(partId) || partId <= 0) {
      return res.status(400).json({ success: false, error: 'Falta part_id válido del número de parte' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Debes seleccionar un archivo de BOM' });
    }

    await ensureNumeroParteTable();

    const filePath = `/uploads/bom/${req.file.filename}`;
    let updateResult;

    try {
      updateResult = await apoyosPool.query(
        `UPDATE numero_parte
         SET bom_excel = $1::VARCHAR(500),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
        RETURNING id, numero_parte, bom_excel`,
        [filePath, partId]
      );
    } catch (err) {
      // Si falla por columna inexistente (por esquemas viejos), crearla y reintentar
      if (err.code === '42703') {
        logger.warn('Columna no existía en numero_parte. Intentando crearla...', err.message);
        try {
          updateResult = await apoyosPool.query(
            `UPDATE numero_parte
             SET bom_excel = $1::VARCHAR(500),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
            RETURNING id, numero_parte, bom_excel`,
            [filePath, partId]
          );
        } catch (retryErr) {
          logger.error('Error al crear columna o reintentar UPDATE:', retryErr);
          throw retryErr;
        }
      } else {
        throw err;
      }
    }

    if (!updateResult || updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'No se encontró el número de parte para guardar el BOM' });
    }

    return res.json({
      success: true,
      message: 'BOM subido y guardado correctamente',
      part_id: updateResult.rows[0].id,
      numero_parte: updateResult.rows[0].numero_parte,
      bom_excel: updateResult.rows[0].bom_excel,
    });
  } catch (error) {
    // Log detallado para poder ver realmente qué está fallando
    logger.error('Error al subir BOM Excel:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      stack: error.stack
    });

    // Responder con información suficiente para depurar en el frontend
    return res.status(500).json({
      success: false,
      error: 'Error al subir BOM',
      message: error.message || 'Error desconocido al subir BOM',
      code: error.code || null
    });
  }
});

// GET - Consultar ruta de BOM por número de parte
app.get('/api/diseno/bom-excel', async (req, res) => {
  try {
    const { part_id } = req.query;
    const partId = parseInt(part_id, 10);

    if (isNaN(partId) || partId <= 0) {
      return res.status(400).json({ success: false, error: 'Falta part_id válido del número de parte' });
    }

    await ensureNumeroParteTable();

    const result = await apoyosPool.query(
      `SELECT id, numero_parte, bom_excel
       FROM numero_parte
       WHERE id = $1
       LIMIT 1`,
      [partId]
    );

    if (!result || result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Número de parte no encontrado' });
    }

    return res.json({
      success: true,
      part_id: result.rows[0].id,
      numero_parte: result.rows[0].numero_parte,
      bom_excel: result.rows[0].bom_excel || null,
    });
  } catch (error) {
    logger.error('Error al consultar BOM Excel:', error);
    return res.status(500).json({ success: false, error: 'Error al consultar BOM', message: error.message });
  }
});

app.get('/api/diseno/active-session/:username', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ success: false, error: 'Falta el nombre de usuario' });
    }

    console.log(`🔍 Buscando sesión activa para usuario: ${username}`);

    const normalizedRaw = (username || '').toString().trim();
    const candidates = [normalizedRaw];
    if (normalizedRaw.includes('\\')) {
      candidates.push(normalizedRaw.split('\\').pop());
    }
    if (normalizedRaw.includes('@')) {
      candidates.push(normalizedRaw.split('@')[0]);
    }
    const usernameCandidates = [...new Set(candidates.map(value => (value || '').toString().trim().toLowerCase()).filter(Boolean))];
    const usernameSuffixPatterns = usernameCandidates.flatMap(value => [`%\\${value}`, `%/${value}`]);
    const usernamePrefixPatterns = usernameCandidates.map(value => `${value}@%`);

    if (usernameCandidates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nombre de usuario inválido' });
    }

    // Verificar bandera en usuarios solo para diagnóstico (no bloquear búsqueda real)
    const usuarioCheck = await apoyosPool.query(
      `SELECT username, sesion_activa, orden_en_logeo, inicio_sesion, estado_trabajo, estado_en_orden
       FROM usuarios
       WHERE LOWER(TRIM(username)) = ANY($1::text[])
       LIMIT 1`,
      [usernameCandidates]
    );

    const usuarioRow = usuarioCheck.rowCount > 0 ? usuarioCheck.rows[0] : null;
    const sesionActiva = usuarioRow ? !!usuarioRow.sesion_activa : false;
    if (usuarioCheck.rowCount === 0) {
      console.warn(`⚠ Usuario no encontrado en tabla usuarios: ${username}. Se continuará búsqueda en tiempo_diseno.`);
    }
    console.log(`  - sesion_activa en usuarios: ${sesionActiva}`);
    console.log('ℹ Buscando sesión activa real en tiempo_diseno (independiente de sesion_activa)...');

    // Asegurar que la columna notas existe en tiempo_diseno
    try {
      await apoyosPool.query(`
        ALTER TABLE tiempo_diseno
          ADD COLUMN IF NOT EXISTS notas TEXT;
      `);
    } catch (alterError) {
      // Si falla, puede ser que la columna ya exista o haya otro problema, pero continuamos
      console.log('Nota: No se pudo agregar columna notas (puede que ya exista):', alterError.message);
    }

    // Buscar la sesión activa más reciente (sin hora_fin) y obtener, si es posible, el nombre del proyecto.
    // IMPORTANTE: Solo devolver sesiones que tengan numero_parte o orden válidos (no vacíos)
    // Nota: la tabla tiempo_diseno no tiene project_id, así que relacionamos por número de orden.
    // Construir la consulta de manera más segura
    let notasColumn = 'NULL';
    try {
      // Verificar si la columna notas existe
      const columnCheck = await apoyosPool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'tiempo_diseno' AND column_name = 'notas'
      `);
      if (columnCheck.rows.length > 0) {
        notasColumn = 'td.notas';
      }
    } catch (checkError) {
      console.log('No se pudo verificar columna notas, usando NULL:', checkError.message);
    }

    const result = await apoyosPool.query(
      `SELECT 
        td.id,
        td.username,
        td.numero_parte,
        td.orden,
        td.cliente,
        td.tipo,
        td.estado,
        td.estado_orden,
        td.hora_inicio,
        td.hora_fin,
        (EXTRACT(EPOCH FROM td.hora_inicio) * 1000)::bigint AS hora_inicio_ms,
        td.tiempo_working,
        td.tiempo_pausa,
        td.tiempo_comida,
        td.tiempo_5s,
        td.tiempo_meeting,
        td.tiempo_meeting_trabajo,
        td.tiempo_training,
        td.tiempo_pdm_rwk,
        td.tiempo_revision_orden,
        td.tiempo_pendiente,
        td.tiempo_esperando_informacion,
        td.tiempo_buscando_informacion,
        td.tiempo_aprobado,
        td.tiempo_cambios,
        td.tiempo_total,
        COALESCE(${notasColumn === 'NULL' ? 'NULL' : notasColumn}, o.notas) AS notas,
        COALESCE(p.project_name, td.orden) AS proyecto,
        u.estado_trabajo,
        u.estado_en_orden,
        o.id AS orden_id
      FROM tiempo_diseno td
      LEFT JOIN proyectos p ON p.order_number = td.orden
      LEFT JOIN usuarios u ON LOWER(TRIM(u.username)) = LOWER(TRIM(td.username))
      LEFT JOIN ordenes o ON o.order_number = td.orden
      WHERE td.hora_fin IS NULL
        AND (
          LOWER(TRIM(td.username)) = ANY($1::text[])
          OR LOWER(TRIM(td.username)) LIKE ANY($2::text[])
          OR LOWER(TRIM(td.username)) LIKE ANY($3::text[])
        )
        AND (COALESCE(TRIM(td.numero_parte), '') != '' OR COALESCE(TRIM(td.orden), '') != '')
      ORDER BY td.hora_inicio DESC
      LIMIT 1`,
      [usernameCandidates, usernameSuffixPatterns, usernamePrefixPatterns]
    );

    if (result.rows.length === 0) {
      if (sesionActiva && usuarioRow) {
        const ordenEnLogeo = (usuarioRow.orden_en_logeo || '').toString().trim();
        const canonicalUsername = (usuarioRow.username || username || '').toString().trim();
        const estadoTrabajo = (usuarioRow.estado_trabajo || '').toString().trim().toLowerCase();

        if (ordenEnLogeo) {
          try {
            console.warn(`⚠ Inconsistencia detectada: sesion_activa=TRUE pero sin fila abierta en tiempo_diseno para ${canonicalUsername}. Se creará sesión de recuperación.`);

            const repairedInsert = await apoyosPool.query(
              `INSERT INTO tiempo_diseno (username, numero_parte, orden, cliente, tipo, estado, estado_orden, hora_inicio, hora_fin)
               VALUES ($1, $2, $3, NULL, 'meeting', $4, 'En Proceso', COALESCE($5, NOW()), NULL)
               RETURNING id, username, numero_parte, orden, cliente, tipo, estado, estado_orden, hora_inicio, hora_fin, (EXTRACT(EPOCH FROM hora_inicio) * 1000)::bigint AS hora_inicio_ms`,
              [
                canonicalUsername,
                ordenEnLogeo,
                ordenEnLogeo,
                estadoTrabajo || 'working',
                usuarioRow.inicio_sesion || null
              ]
            );

            const repairedBase = repairedInsert.rows[0];
            let ordenId = null;
            try {
              const ordenLookup = await apoyosPool.query(
                `SELECT id FROM ordenes WHERE TRIM(order_number) = $1 LIMIT 1`,
                [ordenEnLogeo]
              );
              if (ordenLookup.rowCount > 0) {
                ordenId = ordenLookup.rows[0].id;
              }
            } catch (ordenLookupError) {
              console.warn('No se pudo resolver orden_id en sesión de recuperación:', ordenLookupError.message);
            }

            const repairedSession = {
              ...repairedBase,
              tiempo_working: null,
              tiempo_pausa: null,
              tiempo_comida: null,
              tiempo_5s: null,
              tiempo_meeting: null,
              tiempo_meeting_trabajo: null,
              tiempo_training: null,
              tiempo_pendiente: null,
              tiempo_esperando_informacion: null,
              tiempo_buscando_informacion: null,
              tiempo_documentacion: null,
              tiempo_aprobado: null,
              tiempo_cambios: null,
              tiempo_total: null,
              notas: null,
              proyecto: ordenEnLogeo,
              estado_trabajo: usuarioRow.estado_trabajo || null,
              estado_en_orden: usuarioRow.estado_en_orden || null,
              orden_id: ordenId
            };

            console.log(`✓ Sesión de recuperación creada para ${canonicalUsername} (id=${repairedSession.id})`);
            return res.json({
              success: true,
              hasActiveSession: true,
              session: repairedSession
            });
          } catch (repairCreateError) {
            console.error(`❌ No se pudo crear sesión de recuperación para ${canonicalUsername}:`, repairCreateError.message);
          }
        } else {
          console.warn(`⚠ sesion_activa=TRUE sin orden_en_logeo para ${canonicalUsername}. Se desactivará la bandera para evitar estado inconsistente.`);
          try {
            await apoyosPool.query(
              `UPDATE usuarios
               SET sesion_activa = FALSE,
                   inicio_sesion = NULL
               WHERE LOWER(TRIM(username)) = ANY($1::text[])`,
              [usernameCandidates]
            );
          } catch (resetFlagError) {
            console.warn('No se pudo limpiar sesion_activa inconsistente:', resetFlagError.message);
          }
        }
      }

      console.log(`ℹNo hay sesión activa para ${username}`);
      return res.json({ success: true, hasActiveSession: false, session: null });
    }

    const session = result.rows[0];
    console.log(` Sesión activa encontrada para ${username}:`, {
      id: session.id,
      numero_parte: session.numero_parte,
      orden: session.orden,
      hora_inicio: session.hora_inicio
    });

    // Auto-reparación: si hay sesión abierta en tiempo_diseno pero bandera en usuarios está FALSE, actualizarla
    if (!sesionActiva) {
      try {
        await apoyosPool.query(
          `UPDATE usuarios
           SET sesion_activa = TRUE,
               inicio_sesion = COALESCE(inicio_sesion, $2),
               orden_en_logeo = COALESCE(NULLIF(TRIM($3), ''), orden_en_logeo)
           WHERE LOWER(TRIM(username)) = ANY($1::text[])`,
          [usernameCandidates, session.hora_inicio, session.orden || session.numero_parte || null]
        );
        console.log(`✓ Auto-reparación aplicada: sesion_activa=TRUE para ${username}`);
      } catch (repairError) {
        console.warn(`⚠ No se pudo auto-reparar sesion_activa para ${username}:`, repairError.message);
      }
    }

    res.json({ 
      success: true, 
      hasActiveSession: true, 
      session: session
    });
  } catch (error) {
    console.error('❌ Error al obtener sesión activa:', error.message);
    console.error('❌ Stack trace:', error.stack);
    console.error('❌ Error completo:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al obtener sesión activa: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/diseno/status-timers/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const parsedSessionId = Number(sessionId);

    if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
      return res.status(400).json({ success: false, error: 'sessionId inválido' });
    }

    await ensureCambiosEstadoTable();

    const sessionResult = await apoyosPool.query(
      `SELECT id, hora_inicio, hora_fin, estado_trabajo, estado
       FROM tiempo_diseno
       WHERE id = $1
       LIMIT 1`,
      [parsedSessionId]
    );

    if (sessionResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    }

    const session = sessionResult.rows[0];
    if (session.hora_fin) {
      return res.json({ success: true, timers: null, message: 'La sesión ya está finalizada' });
    }

    const timers = await buildStatusTimersFromCambios({
      sessionId: parsedSessionId,
      horaInicio: session.hora_inicio,
      fallbackTrabajo: session.estado_trabajo,
      // Evita cargar toda la sesion a una ausencia actual cuando faltan eventos historicos.
      fallbackAusencia: null
    });

    return res.json({
      success: true,
      sessionId: parsedSessionId,
      timers
    });
  } catch (error) {
    console.error('Error al reconstruir mini tiempos de sesión:', error.message);
    return res.status(500).json({ success: false, error: 'Error al reconstruir mini tiempos' });
  }
});

// Obtener detalle de sesion tomando como fuente principal cambios_estado
app.get('/api/diseno/session-from-cambios/:username', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    const { username } = req.params;
    if (!username) {
      return res.status(400).json({ success: false, error: 'Falta el nombre de usuario' });
    }

    await ensureCambiosEstadoTable();

    const normalizedRaw = (username || '').toString().trim();
    const candidates = [normalizedRaw];
    if (normalizedRaw.includes('\\')) {
      candidates.push(normalizedRaw.split('\\').pop());
    }
    if (normalizedRaw.includes('@')) {
      candidates.push(normalizedRaw.split('@')[0]);
    }

    const usernameCandidates = [...new Set(
      candidates
        .map(value => (value || '').toString().trim().toLowerCase())
        .filter(Boolean)
    )];

    if (usernameCandidates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nombre de usuario invalido' });
    }

    // Preferir sesion abierta con actividad reciente en cambios_estado.
    let sessionLookup = await apoyosPool.query(
      `SELECT td.id, td.hora_inicio, td.hora_fin
       FROM cambios_estado ce
       INNER JOIN tiempo_diseno td ON td.id = ce.tiempo_diseno_id
       WHERE LOWER(TRIM(ce.username)) = ANY($1::text[])
         AND td.hora_fin IS NULL
       ORDER BY ce.fecha_cambio DESC, ce.id DESC
       LIMIT 1`,
      [usernameCandidates]
    );

    // Fallback: tomar la sesion mas reciente en cambios_estado aunque ya este cerrada.
    if (sessionLookup.rowCount === 0) {
      sessionLookup = await apoyosPool.query(
        `SELECT td.id, td.hora_inicio, td.hora_fin
         FROM cambios_estado ce
         INNER JOIN tiempo_diseno td ON td.id = ce.tiempo_diseno_id
         WHERE LOWER(TRIM(ce.username)) = ANY($1::text[])
         ORDER BY ce.fecha_cambio DESC, ce.id DESC
         LIMIT 1`,
        [usernameCandidates]
      );
    }

    if (sessionLookup.rowCount === 0) {
      return res.json({ success: true, hasSession: false, session: null, timers: null });
    }

    const sessionId = sessionLookup.rows[0].id;

    const sessionResult = await apoyosPool.query(
      `SELECT 
         td.id,
         td.username,
         td.numero_parte,
         td.orden,
         td.cliente,
         td.tipo,
         td.estado,
         td.estado_orden,
         td.hora_inicio,
        (EXTRACT(EPOCH FROM td.hora_inicio) * 1000)::bigint AS hora_inicio_ms,
         td.hora_fin,
         td.tiempo_working,
         td.tiempo_pausa,
         td.tiempo_comida,
         td.tiempo_5s,
         td.tiempo_meeting,
         td.tiempo_meeting_trabajo,
         td.tiempo_training,
          td.tiempo_pdm_rwk,
          td.tiempo_revision_orden,
         td.tiempo_pendiente,
         td.tiempo_esperando_informacion,
         td.tiempo_buscando_informacion,
         td.tiempo_documentacion,
         td.tiempo_aprobado,
         td.tiempo_cambios,
         td.tiempo_total,
         td.notas,
         COALESCE(p.project_name, td.orden) AS proyecto,
         u.estado_trabajo,
         u.estado_en_orden,
         o.id AS orden_id
       FROM tiempo_diseno td
       LEFT JOIN proyectos p ON p.order_number = td.orden
       LEFT JOIN usuarios u ON LOWER(TRIM(u.username)) = LOWER(TRIM(td.username))
       LEFT JOIN ordenes o ON o.order_number = td.orden
       WHERE td.id = $1
       LIMIT 1`,
      [sessionId]
    );

    if (sessionResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Sesion no encontrada' });
    }

    const session = sessionResult.rows[0];

    const timers = await buildStatusTimersFromCambios({
      sessionId: session.id,
      horaInicio: session.hora_inicio,
      fallbackTrabajo: session.estado_trabajo,
      // Evita sesgos en ausencia cuando cambios_estado esta incompleto para la sesion.
      fallbackAusencia: null
    });

    return res.json({
      success: true,
      hasSession: true,
      isActiveSession: !session.hora_fin,
      source: 'cambios_estado',
      session,
      timers
    });
  } catch (error) {
    console.error('Error al obtener sesion desde cambios_estado:', error.message);
    return res.status(500).json({ success: false, error: 'Error al obtener sesion desde cambios_estado' });
  }
});

// Ruta para obtener un usuario específico
app.get('/api/usuarios/numero-empleado/:username', async (req, res) => {
  try {
    const username = decodeURIComponent(String(req.params.username || '')).trim();

    if (!username) {
      return res.status(400).json({ error: 'Username requerido' });
    }

    const result = await apoyosPool.query(
      `SELECT username, numero_empleado
       FROM usuarios
       WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
       LIMIT 1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const row = result.rows[0];
    return res.json({
      username: row.username,
      numero_empleado: row.numero_empleado
    });
  } catch (error) {
    console.error('Error al obtener numero_empleado por username:', error);
    return res.status(500).json({
      error: 'Error al consultar numero_empleado',
      message: error.message
    });
  }
});

app.get('/api/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await apoyosPool.query(
            'SELECT id, nombre_completo, username, rol, fecha_creacion, ultimo_acceso, activo FROM usuarios WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener usuario:', error);
        res.status(500).json({ 
            error: 'Error al consultar el usuario',
            message: error.message
        });
    }
});

// Ruta para crear un nuevo usuario
app.post('/api/usuarios', async (req, res) => {
    try {
        const { nombre_completo, username, password, rol } = req.body;
        
        // Validar que todos los campos requeridos estén presentes
        if (!nombre_completo || !username || !password || !rol) {
            return res.status(400).json({ 
                error: 'Todos los campos son requeridos' 
            });
        }

        // Verificar si el usuario ya existe
        const userExists = await apoyosPool.query(
            'SELECT id FROM usuarios WHERE username = $1',
            [username]
        );

        if (userExists.rows.length > 0) {
            return res.status(400).json({ 
                error: 'El nombre de usuario ya existe' 
            });
        }

        // Asegurar que la secuencia esté sincronizada con los IDs existentes
        // Esto evita conflictos cuando se han insertado filas manualmente
        await apoyosPool.query(
            `SELECT setval(pg_get_serial_sequence('usuarios', 'id'), 
             COALESCE((SELECT MAX(id) FROM usuarios), 0) + 1, false)`
        );

        // Intentar crear el nuevo usuario
        let result;
        let maxAttempts = 5;
        let attempt = 0;
        
        while (attempt < maxAttempts) {
            try {
                result = await apoyosPool.query(
                    `INSERT INTO usuarios (nombre_completo, username, password, rol, activo, fecha_creacion)
                     VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)
                     RETURNING id, nombre_completo, username, rol, fecha_creacion`,
                    [nombre_completo, username, password, rol]
                );
                
                // Si llegamos aquí, la inserción fue exitosa
                break;
            } catch (insertError) {
                // Si hay un error de clave duplicada (23505) o cualquier error relacionado con ID duplicado
                if (insertError.code === '23505' || 
                    (insertError.message && insertError.message.includes('duplicate key') && insertError.message.includes('id'))) {
                    attempt++;
                    
                    if (attempt >= maxAttempts) {
                        throw new Error('No se pudo encontrar un ID disponible después de varios intentos');
                    }
                    
                    // Obtener el siguiente ID disponible
                    // Primero intentar encontrar un gap en los IDs existentes
                    const gapResult = await apoyosPool.query(
                        `SELECT MIN(id) as next_id 
                         FROM generate_series(1, (SELECT COALESCE(MAX(id), 0) + 1 FROM usuarios)) AS s(id)
                         WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE usuarios.id = s.id)
                         LIMIT 1`
                    );
                    
                    let nextId;
                    if (gapResult.rows[0] && gapResult.rows[0].next_id) {
                        // Se encontró un gap, usar ese ID
                        nextId = gapResult.rows[0].next_id;
                    } else {
                        // No hay gaps, usar MAX(id) + 1
                        const nextIdResult = await apoyosPool.query(
                            `SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM usuarios`
                        );
                        nextId = nextIdResult.rows[0].next_id;
                    }
                    
                    // Actualizar la secuencia al siguiente ID disponible
                    await apoyosPool.query(
                        `SELECT setval(pg_get_serial_sequence('usuarios', 'id'), $1, false)`,
                        [nextId]
                    );
                    
                    // Reintentar la inserción
                    continue;
                } else {
                    // Si es otro tipo de error, lanzarlo
                    throw insertError;
                }
            }
        }
        
        if (!result || result.rows.length === 0) {
            throw new Error('No se pudo crear el usuario después de varios intentos');
        }

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear usuario:', error);
        res.status(500).json({ 
            error: 'Error al crear el usuario',
            message: error.message
        });
    }
});

// Ruta para actualizar un usuario
app.put('/api/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre_completo, username, password, rol, activo } = req.body;
        if (!nombre_completo || !username || !rol || typeof activo === 'undefined') {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }
        // Si se proporciona contraseña, actualizarla; si no, dejar la anterior
        let query, params;
        if (password) {
            query = `UPDATE usuarios SET nombre_completo = $1, username = $2, password = $3, rol = $4, activo = $5 WHERE id = $6 RETURNING id, nombre_completo, username, rol, activo`;
            params = [nombre_completo, username, password, rol, activo, id];
        } else {
            query = `UPDATE usuarios SET nombre_completo = $1, username = $2, rol = $3, activo = $4 WHERE id = $5 RETURNING id, nombre_completo, username, rol, activo`;
            params = [nombre_completo, username, rol, activo, id];
        }
        const result = await apoyosPool.query(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        res.status(500).json({ error: 'Error al actualizar usuario', message: error.message });
    }
});

// Ruta para eliminar un usuario
app.delete('/api/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await apoyosPool.query(
            'DELETE FROM usuarios WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ message: 'Usuario eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).json({ 
            error: 'Error al eliminar el usuario',
            message: error.message
        });
    }
});

// Ruta para obtener usuarios activos
app.get('/api/usuarios/activos', async (req, res) => {
    try {
        const result = await apoyosPool.query(
            'SELECT id, nombre_completo, username, rol, password, email_password, system_password FROM usuarios WHERE activo = true ORDER BY nombre_completo'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios activos:', error);
        res.status(500).json({ 
            error: 'Error al consultar los usuarios',
            message: error.message
        });
    }
});

// Ruta para obtener contraseñas de un usuario
app.get('/api/usuarios/:id/passwords', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await apoyosPool.query(
            'SELECT password, email_password, system_password FROM usuarios WHERE id = $1 AND activo = true',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener contraseñas:', error);
        res.status(500).json({ 
            error: 'Error al consultar las contraseñas',
            message: error.message
        });
    }
});

// Rutas para departamentos
app.get('/api/departamentos', async (req, res) => {
  try {
    const result = await apoyosPool.query('SELECT * FROM departamentos ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener departamentos:', error);
    res.status(500).json({ error: 'Error al obtener departamentos' });
  }
});

app.post('/api/departamentos', async (req, res) => {
  const { nombre, accesos } = req.body;
  
  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del departamento es requerido' });
  }

  try {
    const result = await apoyosPool.query(
      'INSERT INTO departamentos (nombre, accesos) VALUES ($1, $2) RETURNING *',
      [nombre, accesos]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear departamento:', error);
    res.status(500).json({ error: 'Error al crear departamento' });
  }
});

app.delete('/api/departamentos/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await apoyosPool.query('DELETE FROM departamentos WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Departamento no encontrado' });
    }
    
    res.json({ message: 'Departamento eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar departamento:', error);
    res.status(500).json({ error: 'Error al eliminar departamento' });
  }
});

app.put('/api/departamentos/update', async (req, res) => {
  const { departments } = req.body;
  
  if (!Array.isArray(departments)) {
    return res.status(400).json({ error: 'Formato de datos inválido' });
  }

  try {
    // Iniciar una transacción
    await apoyosPool.query('BEGIN');

    // Actualizar cada departamento
    for (const dept of departments) {
      await apoyosPool.query(
        'UPDATE departamentos SET accesos = $1 WHERE id = $2',
        [dept.accesos, dept.id]
      );
    }

    // Confirmar la transacción
    await apoyosPool.query('COMMIT');
    
    res.json({ message: 'Departamentos actualizados correctamente' });
  } catch (error) {
    // Revertir la transacción en caso de error
    await apoyosPool.query('ROLLBACK');
    console.error('Error al actualizar departamentos:', error);
    res.status(500).json({ error: 'Error al actualizar departamentos' });
  }
});

// Ruta para verificar permisos
app.post('/api/auth/check-permissions', async (req, res) => {
    const { username } = req.body;
    
    if (!username) {
        return res.status(400).json({
            success: false,
            error: 'Usuario no proporcionado'
        });
    }

    try {
        // Obtener información del usuario
        const userResult = await apoyosPool.query(
            'SELECT id, nombre_completo, username, rol FROM usuarios WHERE username = $1 AND activo = true',
            [username]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Usuario no encontrado o inactivo'
            });
        }

        const user = userResult.rows[0];

        // Buscar la foto del empleado en la tabla empleados
        let foto_url = null;
        try {
            const empleadoResult = await apoyosPool.query(
                'SELECT foto_url FROM empleados WHERE nombre_completo = $1 LIMIT 1',
                [user.nombre_completo]
            );
            if (empleadoResult.rows.length > 0 && empleadoResult.rows[0].foto_url) {
                foto_url = empleadoResult.rows[0].foto_url;
            }
        } catch (error) {
            console.error('Error al buscar foto del empleado:', error);
            // Continuar sin foto si hay error
        }

        // Si el usuario es IT, tiene todos los permisos
        if (user.rol === 'IT') {
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    nombre_completo: user.nombre_completo,
                    username: user.username,
                    rol: user.rol,
                    foto_url: foto_url
                },
                permissions: ['tickets', 'apoyos', 'estadisticas', 'admin', 'design', 'notificaciones']
            });
        }

        // Si el usuario es de Contabilidad, dar solo permisos básicos
        if (user.rol === 'Contabilidad') {
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    nombre_completo: user.nombre_completo,
                    username: user.username,
                    rol: user.rol,
                    foto_url: foto_url
                },
                permissions: ['tickets', 'apoyos', 'estadisticas']
            });
        }

        // Obtener los permisos del departamento del usuario
        const deptResult = await apoyosPool.query(
            'SELECT accesos FROM departamentos WHERE nombre = $1',
            [user.rol]
        );

        if (deptResult.rows.length === 0) {
            // Si no se encuentra el departamento, crear uno por defecto con permisos básicos
            await apoyosPool.query(
                'INSERT INTO departamentos (nombre, accesos) VALUES ($1, $2)',
                [user.rol, ['tickets', 'apoyos']]
            );
            
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    nombre_completo: user.nombre_completo,
                    username: user.username,
                    rol: user.rol,
                    foto_url: foto_url
                },
                permissions: ['tickets', 'apoyos']
            });
        }

        const permissions = deptResult.rows[0].accesos || [];

        res.json({
            success: true,
            user: {
                id: user.id,
                nombre_completo: user.nombre_completo,
                username: user.username,
                rol: user.rol,
                foto_url: foto_url
            },
            permissions: permissions
        });

    } catch (error) {
        console.error('Error al verificar permisos:', error);
        res.status(500).json({
            success: false,
            error: 'Error al verificar permisos'
        });
    }
});

// Ruta para obtener permisos de tarjetas del selector
app.get('/api/tarjetas-disponibles', async (req, res) => {
    try {
        // Obtener el userId desde el query string o desde el username
        const { userId, username } = req.query;
        
        let usuarioId = userId;
        
        // Si no se proporciona userId pero sí username, obtener el id del usuario
        if (!usuarioId && username) {
            const userResult = await apoyosPool.query(
                'SELECT id FROM usuarios WHERE username = $1 AND activo = true',
                [username]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Usuario no encontrado'
                });
            }
            
            usuarioId = userResult.rows[0].id;
        }
        
        if (!usuarioId) {
            return res.status(400).json({
                success: false,
                error: 'userId o username requerido'
            });
        }
        
        // Obtener los permisos de tarjetas del usuario
        const result = await apoyosPool.query(
            'SELECT * FROM tarjetas_disponibles WHERE usuario_id = $1',
            [usuarioId]
        );
        
        if (result.rows.length === 0) {
            // Si no hay registro, retornar todos los permisos en false
            return res.json({
                success: true,
                tarjetas: {
                    show_tickets_it: false,
                    show_tickets_mantenimiento: false,
                    show_vacaciones: false,
                    show_amonestaciones: false,
                        show_enviosyrecibos: false,
                  show_requisicion: false,
                    show_permisos: false,
                    show_comidas: false,
                    show_it: false,
                    show_rh: false,
                    show_mantenimiento: false,
                    show_proyectos: false,
                    show_diseno: false,
                    show_planeacion_compras: false,
                    show_produccion: false,
                    show_calidad: false,
                    show_importacion_exportacion: false,
                    show_contabilidad: false,
                    show_almacen: false,
                    show_prestamos: false
                }
            });
        }
        
        const tarjetas = result.rows[0];
        
        res.json({
            success: true,
            tarjetas: {
                show_tickets_it: tarjetas.show_tickets_it || false,
                show_tickets_mantenimiento: tarjetas.show_tickets_mantenimiento || false,
                show_vacaciones: tarjetas.show_vacaciones || false,
                show_amonestaciones: tarjetas.show_amonestaciones || false,
                show_enviosyrecibos: tarjetas.show_enviosyrecibos || false,
              show_requisicion: tarjetas.show_requisicion || false,
                show_permisos: tarjetas.show_permisos || false,
                show_comidas: tarjetas.show_comidas || false,
                show_it: tarjetas.show_it || false,
                show_rh: tarjetas.show_rh || false,
                show_mantenimiento: tarjetas.show_mantenimiento || false,
                show_proyectos: tarjetas.show_proyectos || false,
                show_diseno: tarjetas.show_diseno || false,
                show_planeacion_compras: tarjetas.show_planeacion_compras || false,
                show_produccion: tarjetas.show_produccion || false,
                show_calidad: tarjetas.show_calidad || false,
                show_importacion_exportacion: tarjetas.show_importacion_exportacion || false,
                show_contabilidad: tarjetas.show_contabilidad || false,
                show_almacen: tarjetas.show_almacen || false,
                show_prestamos: tarjetas.show_prestamos || false
            }
        });
        
    } catch (error) {
        console.error('Error al obtener permisos de tarjetas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener permisos de tarjetas'
        });
    }
});

// Endpoint para actualizar permisos de tarjetas del usuario
app.put('/api/tarjetas-disponibles/:usuarioId', async (req, res) => {
    try {
        const { usuarioId } = req.params;
    const tarjetasData = req.body;
    const allowedFields = [
      'show_tickets_it',
      'show_tickets_mantenimiento',
      'show_vacaciones',
      'show_amonestaciones',
      'show_requisicion',
      'show_permisos',
      'show_comidas',
      'show_it',
      'show_rh',
      'show_mantenimiento',
      'show_proyectos',
      'show_diseno',
      'show_planeacion_compras',
      'show_produccion',
      'show_calidad',
      'show_importacion_exportacion',
      'show_enviosyrecibos',
      'show_contabilidad',
      'show_almacen',
      'show_prestamos'
    ];
    const filteredTarjetasData = {};

    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(tarjetasData, key)) {
        filteredTarjetasData[key] = Boolean(tarjetasData[key]);
      }
    }
        
        if (!usuarioId) {
            return res.status(400).json({
                success: false,
                error: 'usuarioId requerido'
            });
        }
        
        // Verificar si el usuario existe
        const userCheck = await apoyosPool.query(
            'SELECT id FROM usuarios WHERE id = $1',
            [usuarioId]
        );
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Usuario no encontrado'
            });
        }
        
        // Verificar si existe un registro en tarjetas_disponibles
        const existingRecord = await apoyosPool.query(
            'SELECT id FROM tarjetas_disponibles WHERE usuario_id = $1',
            [usuarioId]
        );
        
        if (existingRecord.rows.length === 0) {
            // Crear nuevo registro con todos los campos
          const fields = Object.keys(filteredTarjetasData);
          if (fields.length === 0) {
            return res.status(400).json({
              success: false,
              error: 'No se enviaron permisos válidos para actualizar'
            });
          }
            const placeholders = fields.map((_, i) => `$${i + 2}`);
          const values = [usuarioId, ...Object.values(filteredTarjetasData)];
            
            const query = `
              INSERT INTO tarjetas_disponibles (usuario_id, ${fields.join(', ')})
              VALUES ($1, ${placeholders.join(', ')})
              RETURNING *;
            `;
            
            console.log('Query INSERT:', query);
            console.log('Valores:', values);
            
            const result = await apoyosPool.query(query, values);
            
            return res.json({
                success: true,
                message: 'Tarjetas actualizadas correctamente',
                data: result.rows[0]
            });
        } else {
            // Actualizar registro existente
          const fields = Object.keys(filteredTarjetasData);
          if (fields.length === 0) {
            return res.status(400).json({
              success: false,
              error: 'No se enviaron permisos válidos para actualizar'
            });
          }
            const setClauses = fields.map((key, i) => `${key} = $${i + 2}`);
          const values = [usuarioId, ...Object.values(filteredTarjetasData)];
            
            const query = `
                UPDATE tarjetas_disponibles 
                SET ${setClauses.join(', ')}
                WHERE usuario_id = $1
                RETURNING *;
            `;
            
            console.log('Query UPDATE:', query);
            console.log('Valores:', values);
            
            const result = await apoyosPool.query(query, values);
            
            return res.json({
                success: true,
                message: 'Tarjetas actualizadas correctamente',
                data: result.rows[0]
            });
        }
    } catch (error) {
        console.error('Error al actualizar permisos de tarjetas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar permisos de tarjetas: ' + error.message
        });
    }
});

// Endpoint para obtener el inventario
app.get('/api/inventario', async (req, res) => {
  try {
    const result = await inventarioPool.query(`
      SELECT 
          id,
          item_id,
          COALESCE(nombre_completo, 'Sin nombre') AS nombre_completo,
          COALESCE(stock, 0) AS stock,
          pedido_abierto,
          COALESCE(piezas_pedidas, 0) AS piezas_pedidas,
          activo,
          COALESCE(costo_unitario_mxn, 0) AS precio_mxn,
          COALESCE(costo_unitario_dlls, 0) AS precio_dlls,
          COALESCE(codigo, '') AS codigo,
          COALESCE(po, '') AS po,
          COALESCE(categoria, '') AS categoria,
          COALESCE(descripcion, '') AS descripcion,
          COALESCE(factura, '') AS factura,
          COALESCE(proveedor, '') AS proveedor,
          COALESCE(foto_url, '') AS imagen_url,
          nave_industrial_p1,
          COALESCE(stock_inicial, 0) AS stock_inicial,
          COALESCE(entradas, 0) AS entradas,
          COALESCE(salidas, 0) AS salidas,
          COALESCE(uom, '') AS uom,
          COALESCE(categoria_pdm, '') AS categoria_pdm,
          COALESCE(locacion, '') AS locacion,
          COALESCE(id_ingreso, '') AS id_ingreso,
          COALESCE(heat_number, '') AS heat_number,
          created_at,
          updated_at
      FROM inventario
      ORDER BY id
    `);
    
    // Enviar la respuesta con los datos
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener inventario:', error);
    res.status(500).json({ error: 'Error al obtener inventario', message: error.message });
  }
});

// Endpoint de snapshot histórico: calcula el stock que existía hasta una fecha determinada
// GET /api/inventario/snapshot?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD
app.get('/api/inventario/snapshot', async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    // Validar formatos de fecha si se proporcionan
    const reDate = /^\d{4}-\d{2}-\d{2}$/;
    if (fecha_inicio && !reDate.test(fecha_inicio)) {
      return res.status(400).json({ success: false, error: 'Formato de fecha_inicio inválido. Use YYYY-MM-DD' });
    }
    if (fecha_fin && !reDate.test(fecha_fin)) {
      return res.status(400).json({ success: false, error: 'Formato de fecha_fin inválido. Use YYYY-MM-DD' });
    }

    // Parámetros para la consulta (null si no se proporcionan)
    const pFechaInicio = fecha_inicio || null;
    const pFechaFin    = fecha_fin    || null;

    const result = await inventarioPool.query(`
      WITH
      -- Salidas que ocurrieron DESPUÉS de fecha_fin (para "revertir" al estado histórico)
      salidas_despues AS (
        SELECT
          LOWER(TRIM(codigo_producto)) AS codigo,
          SUM(cantidad)                AS total
        FROM inventario_salida
        WHERE $1::date IS NOT NULL
          AND fecha > $1::date
        GROUP BY LOWER(TRIM(codigo_producto))
      ),

      -- Salidas ocurridas DENTRO del período (fecha_inicio ≤ fecha ≤ fecha_fin)
      salidas_periodo AS (
        SELECT
          LOWER(TRIM(codigo_producto)) AS codigo,
          SUM(cantidad)                AS total
        FROM inventario_salida
        WHERE ($2::date IS NULL OR fecha >= $2::date)
          AND ($1::date IS NULL OR fecha <= $1::date)
        GROUP BY LOWER(TRIM(codigo_producto))
      ),

      -- Salidas hasta fecha_inicio (para calcular stock al inicio del periodo)
      salidas_hasta_inicio AS (
        SELECT
          LOWER(TRIM(codigo_producto)) AS codigo,
          SUM(cantidad)                AS total
        FROM inventario_salida
        WHERE $2::date IS NOT NULL
          AND fecha > $2::date
        GROUP BY LOWER(TRIM(codigo_producto))
      ),

      -- Inventario base agrupado por código (solo productos creados antes de fecha_fin)
      inv_base AS (
        SELECT
          LOWER(COALESCE(TRIM(codigo), ''))  AS codigo_key,
          MAX(codigo)                         AS codigo,
          MAX(descripcion)                    AS descripcion,
          MAX(COALESCE(proveedor, ''))        AS proveedor,
          MAX(COALESCE(uom, ''))              AS uom,
          MAX(COALESCE(categoria_pdm, ''))    AS categoria_pdm,
          MAX(COALESCE(locacion, ''))         AS locacion,
          MAX(COALESCE(heat_number, ''))       AS heat_number,
          SUM(COALESCE(stock_inicial, 0))     AS stock_inicial_sum,
          SUM(COALESCE(entradas, 0))          AS entradas_sum,
          SUM(COALESCE(stock, 0))             AS stock_actual
        FROM inventario
        WHERE codigo IS NOT NULL AND TRIM(codigo) <> ''
          AND ($1::date IS NULL OR created_at::date <= $1::date)
        GROUP BY LOWER(COALESCE(TRIM(codigo), ''))
      )

      SELECT
        i.codigo,
        i.descripcion,
        i.proveedor,
        i.uom,
        i.categoria_pdm,
        i.locacion,
        COALESCE(NULLIF(TRIM(i.heat_number), ''), '') AS heat_number,
        -- Stock al momento de fecha_fin: stock_actual + salidas_después (que aún no habían ocurrido)
        GREATEST(0, i.stock_actual + COALESCE(sd.total, 0))  AS stock,
        -- Entradas acumuladas hasta fecha_fin
        i.entradas_sum                                         AS entradas,
        -- Salidas en el período solicitado
        COALESCE(sp.total, 0)                                 AS salidas,
        -- Stock al inicio del período (si se dio fecha_inicio)
        CASE WHEN $2::date IS NOT NULL
             THEN GREATEST(0, i.stock_actual + COALESCE(sd.total, 0) + COALESCE(si.total, 0))
             ELSE NULL
        END                                                    AS stock_inicio_periodo
      FROM inv_base i
      LEFT JOIN salidas_despues     sd ON sd.codigo = i.codigo_key
      LEFT JOIN salidas_periodo     sp ON sp.codigo = i.codigo_key
      LEFT JOIN salidas_hasta_inicio si ON si.codigo = i.codigo_key
      ORDER BY i.codigo
    `, [pFechaFin, pFechaInicio]);

    res.json({
      success: true,
      fecha_inicio: pFechaInicio,
      fecha_fin:    pFechaFin,
      items:        result.rows
    });
  } catch (error) {
    console.error('Error en snapshot de inventario:', error);
    res.status(500).json({ success: false, error: 'Error al calcular snapshot', message: error.message });
  }
});

// Endpoint para limpiar filas huérfanas duplicadas (registros de entrada sin datos maestros)
app.post('/api/inventario/cleanup-orphans', async (req, res) => {
  try {
    // Para cada código que tenga más de una fila, eliminar las filas sin datos maestros
    // (sin stock_inicial, uom, categoria_pdm, locacion) conservando solo la fila "base"
    const result = await inventarioPool.query(`
      DELETE FROM inventario
      WHERE id IN (
        SELECT i.id FROM inventario i
        WHERE i.codigo IS NOT NULL AND i.codigo <> ''
          AND i.stock_inicial IS NULL
          AND (i.uom IS NULL OR i.uom = '')
          AND (i.categoria_pdm IS NULL OR i.categoria_pdm = '')
          AND (i.locacion IS NULL OR i.locacion = '')
          AND EXISTS (
            SELECT 1 FROM inventario base
            WHERE LOWER(base.codigo) = LOWER(i.codigo)
              AND base.id <> i.id
              AND (base.stock_inicial IS NOT NULL OR base.uom IS NOT NULL
                   OR base.categoria_pdm IS NOT NULL OR base.locacion IS NOT NULL)
          )
      )
      RETURNING id, codigo
    `);
    res.json({ success: true, deleted: result.rows.length, rows: result.rows });
  } catch (error) {
    console.error('Error en cleanup-orphans:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para obtener un item específico del inventario por ID
app.get('/api/inventario/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await inventarioPool.query(`
      SELECT 
          id,
          item_id,
          COALESCE(nombre_completo, 'Sin nombre') AS nombre_completo,
          COALESCE(area, '') AS area,
          COALESCE(departamento, '') AS departamento,
          COALESCE(usuario_asignado, '') AS usuario_asignado,
          COALESCE(asignado_a, '') AS asignado_a,
          COALESCE(stock, 0) AS stock,
          pedido_abierto,
          COALESCE(piezas_pedidas, 0) AS piezas_pedidas,
          activo,
          COALESCE(costo_unitario_mxn, 0) AS precio_mxn,
          COALESCE(costo_unitario_dlls, 0) AS precio_dlls,
          COALESCE(codigo, '') AS codigo,
          COALESCE(po, '') AS po,
          COALESCE(categoria, '') AS categoria,
          COALESCE(descripcion, '') AS descripcion,
          COALESCE(factura, '') AS factura,
          COALESCE(proveedor, '') AS proveedor,
          COALESCE(foto_url, '') AS imagen_url,
          COALESCE(stock_inicial, 0) AS stock_inicial,
          COALESCE(entradas, 0) AS entradas,
          COALESCE(salidas, 0) AS salidas,
          COALESCE(uom, '') AS uom,
          COALESCE(categoria_pdm, '') AS categoria_pdm,
          COALESCE(locacion, '') AS locacion,
          COALESCE(notas, '') AS notas,
          COALESCE(heat_number, '') AS heat_number,
          created_at,
          updated_at
      FROM inventario
      WHERE id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Item no encontrado' 
      });
    }
    
    res.json({ 
      success: true, 
      item: result.rows[0] 
    });
  } catch (error) {
    console.error('Error al obtener item del inventario:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al obtener item del inventario', 
      message: error.message 
    });
  }
});
  
  // Crear un registro de inventario (desde almacén)
  app.post('/api/inventario', async (req, res) => {
    try {
      const {
        productCode,   // -> codigo
        poNumber,      // -> po
        date,          // -> created_at (opcional)
        category,      // -> categoria
        description,   // -> descripcion y nombre_completo
        quantity,      // -> stock (para flujo Entradas)
        invoice,       // -> factura
        supplier,      // -> proveedor
        // Campos extendidos para Base de datos
        precioMXN,
        precioDLLS,
        stockInicial,
        entradas,
        salidas,
        uom,
        categoriaPDM,
        locacion,
        heatNumber
      } = req.body || {};
      // Normalizar valores numéricos que pueden venir como string vacío
      const normalizedQuantity = (quantity === '' || quantity == null) ? null : Number(quantity);
      const normalizedStockInicial = (stockInicial === '' || stockInicial == null) ? null : Number(stockInicial);
      const normalizedEntradas = (entradas === '' || entradas == null) ? 0 : Number(entradas);
      const normalizedSalidas = (salidas === '' || salidas == null) ? 0 : Number(salidas);

      // Detectar si es payload de Base de Datos (campos exclusivos de la pantalla de inventario)
      // NOTA: "entradas" y "salidas" ya NO forman parte de este criterio porque los payloads
      // de Entrada también incluyen "entradas:qty" para actualizar el stock correctamente.
      const isBaseDatosPayload = (
        precioMXN != null || precioDLLS != null || normalizedStockInicial != null || uom || categoriaPDM || locacion
      );

      const heatSql = (heatNumber != null && String(heatNumber).trim() !== '')
        ? String(heatNumber).trim()
        : null;

      // Validar campos requeridos: siempre requiere descripción y al menos quantity o stockInicial
      if (!description || (normalizedQuantity == null && normalizedStockInicial == null)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Descripción y cantidad son campos obligatorios' 
        });
      }

      // Asegurar tabla de log de entradas (por si no corrió al arrancar o falló antes)
      if (!isBaseDatosPayload) {
        await ensureInventarioEntradaTable();
      }

      // Obtener categoría automática basada en el código del producto
      let categoriaAutomatica = category;
      if (productCode && !isBaseDatosPayload) {
        try {
          const categoriaResult = await inventarioPool.query(
            'SELECT categoria FROM codigo_categoria_mapping WHERE codigo = $1',
            [productCode]
          );
          if (categoriaResult.rows.length > 0) {
            categoriaAutomatica = categoriaResult.rows[0].categoria;
          }
        } catch (e) {
          console.warn('No se pudo obtener categoría automática:', e?.message || e);
        }
      }

      // ── LÓGICA DE ENTRADA: UPDATE si el producto ya existe, INSERT si es nuevo ──
      // Para payloads de Base de Datos siempre se inserta un registro nuevo.
      // Para payloads de Entrada se actualiza el registro base existente (entradas += qty).
      if (!isBaseDatosPayload && productCode) {
        // Buscar el registro más completo con ese código (el que tiene stock_inicial o el más antiguo)
        const existing = await inventarioPool.query(
          `SELECT id, entradas, salidas, stock_inicial, stock FROM inventario
           WHERE LOWER(codigo) = LOWER($1)
           ORDER BY (stock_inicial IS NOT NULL) DESC, id ASC
           LIMIT 1`,
          [productCode]
        );

        if (existing.rows.length > 0) {
          const baseRow = existing.rows[0];
          const addQty = Number(normalizedQuantity || 0);
          const newEntradas = (Number(baseRow.entradas || 0)) + addQty;
          const newStock = Math.max(0,
            (Number(baseRow.stock_inicial || 0)) + newEntradas - (Number(baseRow.salidas || 0))
          );

          // Actualizar la fila base: sumar entradas y recalcular stock
          // También guardar po y factura si se proporcionan
          const updated = await inventarioPool.query(
            `UPDATE inventario
             SET entradas = $1,
                 stock    = $2,
                 po       = COALESCE($3, po),
                 factura  = COALESCE($4, factura),
                 categoria = COALESCE($5, categoria),
                 heat_number = COALESCE($6, heat_number)
             WHERE id = $7
             RETURNING *`,
            [newEntradas, newStock, poNumber || null, invoice || null, categoriaAutomatica || null, heatSql, baseRow.id]
          );

          // Eliminar filas "huérfanas" de entradas previas para ese código
          // (filas sin stock_inicial ni datos maestros, creadas antes de esta corrección)
          await inventarioPool.query(
            `DELETE FROM inventario
             WHERE LOWER(codigo) = LOWER($1)
               AND id <> $2
               AND stock_inicial IS NULL
               AND (uom IS NULL AND categoria_pdm IS NULL AND locacion IS NULL)`,
            [productCode, baseRow.id]
          ).catch(() => { /* no bloquear si falla la limpieza */ });

          // Registrar entrada individual en el log de entradas
          await inventarioPool.query(
            `INSERT INTO inventario_entrada (codigo, descripcion, cantidad, po, factura, categoria, proveedor, fecha, heat_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9)`,
            [productCode, description, addQty, poNumber || null, invoice || null,
             categoriaAutomatica || null, supplier || null, date || null, heatSql]
          ).catch(e => logger.warn('[inventario_entrada] No se pudo registrar entrada individual:', e?.message));

          return res.status(200).json({ success: true, item: updated.rows[0] });
        }
        // Sin registro existente → caer en INSERT normal
      }

      // ── INSERT: producto nuevo o registro de Base de Datos ──────────────────

      // Resetear la secuencia del ID para evitar conflictos de clave duplicada
      await inventarioPool.query('SELECT setval(pg_get_serial_sequence(\'inventario\', \'id\'), COALESCE((SELECT MAX(id) FROM inventario), 0) + 1, false)');

      // Calcular stock a insertar
      // - Base de datos: stock = max(0, stockInicial + entradas - salidas)
      // - Entradas (producto nuevo sin registro previo): stock = quantity
      const stockValue = isBaseDatosPayload
        ? Math.max(0, (normalizedStockInicial || 0) + (normalizedEntradas || 0) - (normalizedSalidas || 0))
        : Number(normalizedQuantity || 0);

      // Generar ID de ingreso único
      const idIngreso = `ING-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const result = await inventarioPool.query(
        `INSERT INTO inventario (
            nombre_completo, stock, pedido_abierto, piezas_pedidas, activo,
            codigo, po, categoria, descripcion, factura, proveedor,
            costo_unitario_mxn, costo_unitario_dlls,
            stock_inicial, entradas, salidas, uom, categoria_pdm, locacion, id_ingreso, heat_number
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        [
          description,
          stockValue,
          false,
          0,
          true,
          productCode || null,
          poNumber || null,
          categoriaAutomatica || null,
          description,
          invoice || null,
          supplier || null,
          (precioMXN==null ? null : Number(precioMXN)),
          (precioDLLS==null ? null : Number(precioDLLS)),
          (normalizedStockInicial==null ? null : normalizedStockInicial),
          (!isBaseDatosPayload ? Number(normalizedQuantity || 0) : (entradas==null ? null : normalizedEntradas)),
          (salidas==null ? null : normalizedSalidas),
          uom || null,
          categoriaPDM || null,
          locacion || null,
          idIngreso,
          heatSql
        ]
      );

      // Registrar en log de entradas individuales (solo para flujo de Entrada, no Base de datos)
      if (!isBaseDatosPayload) {
        await inventarioPool.query(
          `INSERT INTO inventario_entrada (codigo, descripcion, cantidad, po, factura, categoria, proveedor, fecha, heat_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9)`,
          [productCode || null, description, Number(normalizedQuantity || 0),
           poNumber || null, invoice || null, categoriaAutomatica || null, supplier || null, date || null, heatSql]
        ).catch(e => logger.warn('[inventario_entrada] No se pudo registrar entrada individual (insert):', e?.message));
      }

      res.status(201).json({ success: true, item: result.rows[0] });
    } catch (error) {
      console.error('Error al crear inventario:', error);
      res.status(500).json({ success: false, error: 'Error al crear inventario', message: error.message });
    }
  });
  
  // Eliminar un registro de inventario
  app.delete('/api/inventario/:id', async (req, res) => {
  const { nombre, stock, precio_mxn, estado, pedido_abierto, piezas_pedidas, activo } = req.body || {};
  try {
    const result = await inventarioPool.query(
      `UPDATE inventario SET 
          nombre = COALESCE($1, nombre),
          stock = COALESCE($2, stock),
          precio_mxn = COALESCE($3, precio_mxn),
          estado = COALESCE($4, estado),
          pedido_abierto = COALESCE($5, pedido_abierto),
          piezas_pedidas = COALESCE($6, piezas_pedidas),
          timestamp = NOW()
       WHERE id = $7 RETURNING *`,
      [nombre, stock, precio_mxn, estado, pedido_abierto, piezas_pedidas, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No encontrado' });
    }
    res.json({ success: true, item: result.rows[0] });
  } catch (error) {
    console.error('Error al actualizar inventario:', error);
    res.status(500).json({ error: 'Error al actualizar inventario', message: error.message });
  }
});

  // Obtener categoría automática por código de producto
  app.get('/api/inventario/categoria/:codigo', async (req, res) => {
    try {
      const { codigo } = req.params;
      const result = await inventarioPool.query(
        'SELECT categoria, descripcion FROM codigo_categoria_mapping WHERE codigo = $1',
        [codigo]
      );
      
      if (result.rows.length > 0) {
        res.json({ success: true, categoria: result.rows[0].categoria, descripcion: result.rows[0].descripcion });
      } else {
        res.json({ success: false, message: 'Código no encontrado' });
      }
    } catch (error) {
      console.error('Error al obtener categoría:', error);
      res.status(500).json({ success: false, error: 'Error al obtener categoría' });
    }
  });

  // ENDPOINTS PARA SITIOS Y CREDENCIALES DE USUARIOS

// Obtener todos los sitios
app.get('/api/sitios', async (req, res) => {
    try {
        const result = await apoyosPool.query('SELECT * FROM sitios WHERE activo = true ORDER BY nombre');
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener sitios:', error);
        res.status(500).json({ error: 'Error al obtener sitios', message: error.message });
    }
});

// Obtener todas las credenciales de un usuario
app.get('/api/usuarios/:id/credenciales', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await apoyosPool.query(
            `SELECT c.id, c.sitio_id, s.nombre AS nombre_sitio, c.username, c.password, c.notas, c.activo, c.fecha_creacion, c.fecha_actualizacion
             FROM credenciales_usuarios c
             JOIN sitios s ON c.sitio_id = s.id
             WHERE c.usuario_id = $1
             ORDER BY s.nombre`,
            [id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener credenciales:', error);
        res.status(500).json({ error: 'Error al obtener credenciales', message: error.message });
    }
});

// Crear nuevas credenciales para un usuario
app.post('/api/usuarios/:id/credenciales', async (req, res) => {
    try {
        const { id } = req.params;
        const { sitio_nombre, username, password, notas } = req.body;
        // Validar que el usuario existe
        const userResult = await apoyosPool.query(
            'SELECT id FROM usuarios WHERE id = $1 AND activo = true',
            [id]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Usuario no encontrado o inactivo',
                message: 'El usuario especificado no existe o está inactivo'
            });
        }

        // Validación más detallada de los campos requeridos
        if (!sitio_nombre || typeof sitio_nombre !== 'string' || sitio_nombre.trim() === '') {
            return res.status(400).json({ 
                error: 'Datos incompletos',
                message: 'El nombre del sitio es obligatorio'
            });
        }

        if (!password || typeof password !== 'string' || password.trim() === '') {
            return res.status(400).json({ 
                error: 'Datos incompletos',
                message: 'La contraseña es obligatoria'
            });
        }

        // Primero, buscar o crear el sitio
        let sitioResult = await apoyosPool.query(
            'SELECT id FROM sitios WHERE nombre = $1 AND activo = true',
            [sitio_nombre.trim()]
        );

        let sitioId;
        if (sitioResult.rows.length === 0) {
            // Si el sitio no existe, crearlo
            const newSitioResult = await apoyosPool.query(
                'INSERT INTO sitios (nombre, activo) VALUES ($1, true) RETURNING id',
                [sitio_nombre.trim()]
            );
            sitioId = newSitioResult.rows[0].id;
        } else {
            sitioId = sitioResult.rows[0].id;
        }

        // Ahora insertar o actualizar las credenciales
        const result = await apoyosPool.query(
            `INSERT INTO credenciales_usuarios (usuario_id, sitio_id, username, password, notas, activo, fecha_creacion, fecha_actualizacion)
             VALUES ($1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (usuario_id, sitio_id) DO UPDATE SET username = EXCLUDED.username, password = EXCLUDED.password, notas = EXCLUDED.notas, activo = true, fecha_actualizacion = CURRENT_TIMESTAMP
             RETURNING *`,
            [id, sitioId, username?.trim() || null, password.trim(), notas?.trim() || null]
        );

        if (result.rows.length === 0) {
            return res.status(500).json({ 
                error: 'Error al guardar credenciales',
                message: 'No se pudo guardar las credenciales'
            });
        }
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear credenciales:', error);
        res.status(500).json({ 
            error: 'Error al crear credenciales',
            message: error.message || 'Error interno del servidor'
        });
    }
});

// Actualizar credenciales de un usuario
app.put('/api/usuarios/:id/credenciales/:credencialId', async (req, res) => {
    try {
        const { id, credencialId } = req.params;
        const { username, password, notas, activo } = req.body;
        const result = await apoyosPool.query(
            `UPDATE credenciales_usuarios SET username = $1, password = $2, notas = $3, activo = $4, fecha_actualizacion = CURRENT_TIMESTAMP
             WHERE id = $5 AND usuario_id = $6 RETURNING *`,
            [username, password, notas, activo, credencialId, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Credencial no encontrada' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar credencial:', error);
        res.status(500).json({ error: 'Error al actualizar credencial', message: error.message });
    }
});

// Actualizar nombre del sitio
app.put('/api/sitios/:credencialId', async (req, res) => {
    try {
        const { credencialId } = req.params;
        const { nombre } = req.body;

        // Primero obtener el sitio_id de la credencial
        const credencialResult = await apoyosPool.query(
            'SELECT sitio_id FROM credenciales_usuarios WHERE id = $1',
            [credencialId]
        );

        if (credencialResult.rows.length === 0) {
            return res.status(404).json({ error: 'Credencial no encontrada' });
        }

        const sitioId = credencialResult.rows[0].sitio_id;

        // Actualizar el nombre del sitio
        const result = await apoyosPool.query(
            'UPDATE sitios SET nombre = $1 WHERE id = $2 RETURNING *',
            [nombre, sitioId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sitio no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar sitio:', error);
        res.status(500).json({ error: 'Error al actualizar sitio', message: error.message });
    }
});

// Eliminar (desactivar) credenciales de un usuario
app.delete('/api/usuarios/:id/credenciales/:credencialId', async (req, res) => {
    try {
        const { id, credencialId } = req.params;
        const result = await apoyosPool.query(
            `DELETE FROM credenciales_usuarios
             WHERE id = $1 AND usuario_id = $2 RETURNING *`,
            [credencialId, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Credencial no encontrada' });
        }
        res.json({ message: 'Credencial eliminada correctamente' });
    } catch (error) {
        console.error('Error al eliminar credencial:', error);
        res.status(500).json({ error: 'Error al eliminar credencial', message: error.message });
    }
});

// Rutas para mensajes de tickets
app.get('/api/tickets/:ticketId/messages', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const result = await phoenixPool.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY timestamp ASC',
      [ticketId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener mensajes:', error);
    res.status(500).json({ error: 'Error al obtener los mensajes' });
  }
});

app.post('/api/tickets/:ticketId/messages', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { content, is_staff } = req.body;
    const username = req.session.username || 'Sistema';

    if (!content) {
      return res.status(400).json({ error: 'El contenido del mensaje es requerido' });
    }

    // Asegura que is_staff sea booleano
    const isStaffValue = (is_staff === true || is_staff === 'true') ? true : false;

    const result = await phoenixPool.query(
      `INSERT INTO ticket_messages (ticket_id, content, sender, timestamp, is_staff)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING *`,
      [ticketId, content, username, isStaffValue]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({ error: 'Error al enviar el mensaje' });
  }
});

// Ruta para crear un nuevo ticket
app.post('/api/tickets', async (req, res) => {
  try {
    const { name, email, department, issue, anydesk, image_name, image_type, image_path } = req.body;
    if (!name || !department || !issue) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    // Generar un id único usando timestamp y un número aleatorio
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const id = `${timestamp}-${random}`;
    
    const result = await phoenixPool.query(
      `INSERT INTO tickets (id, name, email, department, issue, anydesk, image_name, image_type, image_path, urgency, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, name, email, department, issue, anydesk || '', image_name || null, image_type || null, image_path || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear ticket:', error);
    res.status(500).json({ error: 'Error al crear el ticket' });
  }
});

// Ruta para completar o cancelar un ticket
app.post('/api/tickets/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, completed_by, completion_notes } = req.body;

    if (!status || !completed_by) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (status !== 'completed' && status !== 'cancelled') {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    // Obtener el ticket original
    const originalTicket = await apoyosPool.query(
      'SELECT * FROM tickets WHERE id = $1',
      [id]
    );

    if (originalTicket.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const ticket = originalTicket.rows[0];

    // Insertar en la tabla de tickets completados
    const completedTicketId = `CT-${Date.now()}`;
    await apoyosPool.query(
      `INSERT INTO completed_tickets (
        id, name, email, department, issue, anydesk, urgency,
        status, completed_by, completion_notes, original_ticket_id,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        completedTicketId,
        ticket.name,
        ticket.email,
        ticket.department,
        ticket.issue,
        ticket.anydesk,
        ticket.urgency,
        status,
        completed_by,
        completion_notes,
        id,
        ticket.timestamp
      ]
    );

    // Copiar las imágenes asociadas
    const images = await apoyosPool.query(
      'SELECT * FROM imagenes_ticket WHERE ticket_id = $1',
      [id]
    );

    for (const image of images.rows) {
      await apoyosPool.query(
        `INSERT INTO completed_ticket_images (
          ticket_id, image_path, image_name, image_type
        ) VALUES ($1, $2, $3, $4)`,
        [completedTicketId, image.ruta_imagen, image.nombre_archivo, image.tipo_imagen]
      );
    }

    // Copiar los mensajes asociados
    const messages = await apoyosPool.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = $1',
      [id]
    );

    for (const message of messages.rows) {
      await apoyosPool.query(
        `INSERT INTO completed_ticket_messages (
          ticket_id, content, sender, is_staff
        ) VALUES ($1, $2, $3, $4)`,
        [completedTicketId, message.content, message.sender, message.is_staff]
      );
    }

    // Eliminar el ticket original
    await apoyosPool.query('DELETE FROM tickets WHERE id = $1', [id]);

    res.json({
      message: `Ticket ${status === 'completed' ? 'completado' : 'cancelado'} exitosamente`,
      completed_ticket_id: completedTicketId
    });
  } catch (error) {
    console.error('Error al completar/cancelar ticket:', error);
    res.status(500).json({ error: 'Error al procesar el ticket' });
  }
});

// Ruta para obtener tickets completados
app.get('/api/completed-tickets', async (req, res) => {
  try {
    const { status, department, start_date, end_date } = req.query;
    let query = 'SELECT * FROM completed_tickets WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (department) {
      query += ` AND department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }

    if (start_date) {
      query += ` AND completion_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND completion_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    query += ' ORDER BY completion_date DESC';

    const result = await apoyosPool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener tickets completados:', error);
    res.status(500).json({ error: 'Error al obtener los tickets completados' });
  }
});

// Ruta para obtener detalles de un ticket completado
app.get('/api/completed-tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener el ticket completado
    const ticketResult = await apoyosPool.query(
      'SELECT * FROM completed_tickets WHERE id = $1',
      [id]
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket completado no encontrado' });
    }

    const ticket = ticketResult.rows[0];

    // Obtener las imágenes asociadas
    const imagesResult = await apoyosPool.query(
      'SELECT * FROM completed_ticket_images WHERE ticket_id = $1',
      [id]
    );

    // Obtener los mensajes asociados
    const messagesResult = await apoyosPool.query(
      'SELECT * FROM completed_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json({
      ...ticket,
      images: imagesResult.rows,
      messages: messagesResult.rows
    });
  } catch (error) {
    console.error('Error al obtener detalles del ticket completado:', error);
    res.status(500).json({ error: 'Error al obtener los detalles del ticket' });
  }
});

// Ruta para crear un nuevo apoyo
app.post('/api/empleados/apoyos', async (req, res) => {
  try {
    const {
      id,
      nombre_completo,
      supervisor,
      puesto,
      folio,
      vale_status,
      descripcion,
      estatus_material,
      fecha_salida_herramienta,
      fecha_regreso_herramienta,
      tool_loan,
      notas,
      ultima_modificacion,
      modificado_por,
      tipo,
      fecha,
      estado
    } = req.body;

    // Validar campos requeridos
    if (!id || !nombre_completo || !tipo || !estado) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    // Insertar el apoyo en la tabla de apoyos
    const result = await apoyosPool.query(
      `INSERT INTO apoyos (
        empleado_id, nombre_completo, supervisor, puesto, folio, vale_status, descripcion, estatus_material,
        fecha_salida_herramienta, fecha_regreso_herramienta, tool_loan, notas, ultima_modificacion, modificado_por,
        tipo, fecha, estado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [
        id,
        nombre_completo,
        supervisor,
        puesto,
        folio,
        vale_status,
        descripcion,
        estatus_material,
        (fecha_salida_herramienta && fecha_salida_herramienta.trim() !== '' ? fecha_salida_herramienta : null),
        (fecha_regreso_herramienta && fecha_regreso_herramienta.trim() !== '' ? fecha_regreso_herramienta : null),
        tool_loan,
        notas,
        ultima_modificacion,
        modificado_por,
        tipo,
        fecha,
        estado
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear apoyo:', error);
    res.status(500).json({ error: 'Error al crear el apoyo' });
  }
});

// Endpoint: conteo de apoyos por mes (año)
app.get('/api/apoyos/por-mes', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    // Usar la columna 'fecha' si existe; en su defecto, caer a 'ultima_modificacion'
    const result = await apoyosPool.query(
      `WITH base AS (
         SELECT COALESCE(fecha::timestamp, ultima_modificacion::timestamp) AS fecha_real
         FROM apoyos
         WHERE COALESCE(fecha::timestamp, ultima_modificacion::timestamp) >= make_timestamp($1, 1, 1, 0, 0, 0)
           AND COALESCE(fecha::timestamp, ultima_modificacion::timestamp) < make_timestamp($1 + 1, 1, 1, 0, 0, 0)
       )
       SELECT EXTRACT(MONTH FROM fecha_real)::int AS mes, COUNT(*)::int AS cantidad
       FROM base
       GROUP BY 1
       ORDER BY 1`,
      [year]
    );

    // Normalizar a 12 meses
    const counts = Array(12).fill(0);
    for (const row of result.rows) {
      const idx = (row.mes || 0) - 1;
      if (idx >= 0 && idx < 12) counts[idx] = row.cantidad;
    }
    res.json({ year, counts });
  } catch (error) {
    console.error('Error al obtener apoyos por mes:', error);
    res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
});

// Endpoint: total de apoyos (excluyendo cancelados)
app.get('/api/apoyos/total', async (req, res) => {
  try {
    const result = await apoyosPool.query(
      `SELECT COUNT(*)::int AS total
       FROM apoyos
       WHERE COALESCE(LOWER(estado), '') <> 'cancelado'`
    );
    const total = (result.rows && result.rows[0] && result.rows[0].total) ? result.rows[0].total : 0;
    res.json({ total });
  } catch (error) {
    console.error('Error al obtener total de apoyos:', error);
    res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
});

// Endpoint: Top 5 personas con más apoyos (opcionalmente por año)
app.get('/api/apoyos/top', async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const whereYear = year ? `WHERE COALESCE(a.fecha::timestamp, a.ultima_modificacion::timestamp) >= make_timestamp($1,1,1,0,0,0)
                              AND COALESCE(a.fecha::timestamp, a.ultima_modificacion::timestamp) < make_timestamp($1+1,1,1,0,0,0)`
                            : '';
    const params = year ? [year] : [];

    const result = await apoyosPool.query(
      `WITH base AS (
         SELECT a.empleado_id, a.nombre_completo
         FROM apoyos a
         ${whereYear}
       )
       SELECT nombre_completo, empleado_id, COUNT(*)::int AS total
       FROM base
       GROUP BY nombre_completo, empleado_id
       ORDER BY total DESC, nombre_completo ASC
       LIMIT 5`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener top de apoyos:', error);
    res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
});

// Endpoint: Distribución de tipos de apoyo
app.get('/api/apoyos/tipos', async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const whereYear = year ? `WHERE COALESCE(fecha::timestamp, ultima_modificacion::timestamp) >= make_timestamp($1,1,1,0,0,0)
                              AND COALESCE(fecha::timestamp, ultima_modificacion::timestamp) < make_timestamp($1+1,1,1,0,0,0)
                              AND COALESCE(LOWER(estado), '') <> 'cancelado'`
                            : `WHERE COALESCE(LOWER(estado), '') <> 'cancelado'`;
    const params = year ? [year] : [];

    const result = await apoyosPool.query(
      `SELECT 
         COALESCE(tipo, 'Sin especificar') as tipo_apoyo,
         COUNT(*)::int as cantidad
       FROM apoyos
       ${whereYear}
       GROUP BY tipo
       ORDER BY cantidad DESC`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener distribución de tipos de apoyo:', error);
    res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
});

// Endpoint: Estado de apoyos
app.get('/api/apoyos/estados', async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const whereYear = year ? `WHERE COALESCE(fecha::timestamp, ultima_modificacion::timestamp) >= make_timestamp($1,1,1,0,0,0)
                              AND COALESCE(fecha::timestamp, ultima_modificacion::timestamp) < make_timestamp($1+1,1,1,0,0,0)`
                            : '';
    const params = year ? [year] : [];

    const result = await apoyosPool.query(
      `SELECT 
         COALESCE(estado, 'Sin especificar') as estado_apoyo,
         COUNT(*)::int as cantidad
       FROM apoyos
       ${whereYear}
       GROUP BY estado
       ORDER BY cantidad DESC`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener distribución de estados de apoyo:', error);
    res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
});

// Endpoint: Apoyos por supervisor
app.get('/api/apoyos/supervisores', async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const whereYear = year ? `WHERE COALESCE(fecha::timestamp, ultima_modificacion::timestamp) >= make_timestamp($1,1,1,0,0,0)
                              AND COALESCE(fecha::timestamp, ultima_modificacion::timestamp) < make_timestamp($1+1,1,1,0,0,0)
                              AND COALESCE(LOWER(estado), '') <> 'cancelado'`
                            : `WHERE COALESCE(LOWER(estado), '') <> 'cancelado'`;
    const params = year ? [year] : [];

    const result = await apoyosPool.query(
      `SELECT 
         COALESCE(supervisor, 'Sin supervisor') as supervisor,
         COUNT(*)::int as cantidad
       FROM apoyos
       ${whereYear}
       GROUP BY supervisor
       ORDER BY cantidad DESC
       LIMIT 10`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener distribución de apoyos por supervisor:', error);
    res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
});

// Endpoint: Apoyos por mes y tipo
app.get('/api/apoyos/mes-tipo', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    
    const result = await apoyosPool.query(
      `SELECT 
         EXTRACT(MONTH FROM COALESCE(fecha::timestamp, ultima_modificacion::timestamp))::int as mes,
         COALESCE(tipo, 'Sin especificar') as tipo_apoyo,
         COUNT(*)::int as cantidad
       FROM apoyos
       WHERE COALESCE(fecha::timestamp, ultima_modificacion::timestamp) >= make_timestamp($1,1,1,0,0,0)
         AND COALESCE(fecha::timestamp, ultima_modificacion::timestamp) < make_timestamp($1+1,1,1,0,0,0)
         AND COALESCE(LOWER(estado), '') <> 'cancelado'
       GROUP BY mes, tipo
       ORDER BY mes, cantidad DESC`,
      [year]
    );

    // Organizar datos por mes
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const tipos = ['simple', 'mediano', 'unico', 'Herramienta'];
    const datos = {};
    
    // Inicializar estructura
    meses.forEach((mes, index) => {
      datos[mes] = {};
      tipos.forEach(tipo => {
        datos[mes][tipo] = 0;
      });
    });

    // Llenar con datos reales
    result.rows.forEach(row => {
      const mesIndex = (row.mes || 1) - 1;
      if (mesIndex >= 0 && mesIndex < 12) {
        const mes = meses[mesIndex];
        const tipo = row.tipo_apoyo || 'Sin especificar';
        if (tipos.includes(tipo)) {
          datos[mes][tipo] = row.cantidad;
        }
      }
    });

    res.json({ year, datos });
  } catch (error) {
    console.error('Error al obtener apoyos por mes y tipo:', error);
    res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
});

// Ruta para actualizar un apoyo existente por su ID
app.put('/api/empleados/apoyos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre_completo,
      supervisor,
      puesto,
      folio,
      vale_status,
      descripcion,
      estatus_material,
      fecha_salida_herramienta,
      fecha_regreso_herramienta,
      tool_loan,
      notas,
      ultima_modificacion,
      modificado_por,
      tipo,
      fecha,
      estado
    } = req.body;

    // Validar campos requeridos
    if (!id || !nombre_completo || !tipo || !estado) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    // Convertir fechas vacías a NULL
    const materialOutDate = fecha_salida_herramienta && fecha_salida_herramienta.trim() !== '' ? fecha_salida_herramienta : null;
    const materialReturnDate = fecha_regreso_herramienta && fecha_regreso_herramienta.trim() !== '' ? fecha_regreso_herramienta : null;

    // Actualizar el apoyo en la tabla de apoyos
    const result = await apoyosPool.query(
      `UPDATE apoyos SET
        nombre_completo = $1,
        supervisor = $2,
        puesto = $3,
        folio = $4,
        vale_status = $5,
        descripcion = $6,
        estatus_material = $7,
        fecha_salida_herramienta = $8,
        fecha_regreso_herramienta = $9,
        tool_loan = $10,
        notas = $11,
        ultima_modificacion = $12,
        modificado_por = $13,
        tipo = $14,
        fecha = $15,
        estado = $16
      WHERE id = $17
      RETURNING *`,
      [nombre_completo, supervisor, puesto, folio, vale_status, descripcion, estatus_material, materialOutDate, materialReturnDate,
        tool_loan, notas, ultima_modificacion, modificado_por, tipo, fecha, estado, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Apoyo no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al actualizar el apoyo:', error);
    res.status(500).json({ error: 'Error al actualizar el apoyo' });
  }
});

// Reemplaza la ruta actual por esta versión mejorada
app.post('/api/empleados/apoyos/:id/evidencia', upload.single('foto'), async (req, res) => {
  try {
    const { id } = req.params;
    const { indice } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    if (!indice || indice < 1 || indice > 3) {
      return res.status(400).json({ error: 'Índice de evidencia inválido' });
    }

    // Verificar que el apoyo existe
    const apoyoCheck = await apoyosPool.query(
      'SELECT id FROM apoyos WHERE id = $1',
      [id]
    );

    if (apoyoCheck.rows.length === 0) {
      console.error('Apoyo no encontrado:', id);
      return res.status(404).json({ error: 'Apoyo no encontrado' });
    }

    const campo = `evidencia${indice}`;
    const fotoUrl = `/uploads/${req.file.filename}`;

    console.log('Actualizando evidencia:', {
      campo, fotoUrl, id, query: `UPDATE apoyos SET ${campo} = $1 WHERE id = $2`
    });

    const result = await apoyosPool.query(
      `UPDATE apoyos SET ${campo} = $1 WHERE id = $2 RETURNING id, ${campo}`,
      [fotoUrl, id]
    );

    if (result.rows.length === 0) {
      console.error('Error al actualizar la evidencia - no se actualizó ningún registro');
      return res.status(500).json({ error: 'Error al actualizar la evidencia' });
    }
    res.json({ 
      success: true, 
      url: fotoUrl,
      message: 'Evidencia subida exitosamente',
      updatedField: campo,
      apoyoId: id
    });
  } catch (error) {
    console.error('Error al subir evidencia:', error);
    res.status(500).json({ 
      error: 'Error al subir la evidencia',
      message: error.message,
      stack: error.stack
    });
  }
});

// Ruta para eliminar un apoyo específico
app.delete('/api/empleados/apoyos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Verificar si el apoyo existe
        const apoyoExistente = await apoyosPool.query(
            'SELECT * FROM apoyos WHERE id = $1',
            [id]
        );

        if (apoyoExistente.rows.length === 0) {
            return res.status(404).json({
                error: 'Apoyo no encontrado',
                message: 'No se encontró el apoyo especificado'
            });
        }

        // Eliminar el apoyo
        await apoyosPool.query('DELETE FROM apoyos WHERE id = $1', [id]);

        res.json({
            success: true,
            message: 'Apoyo eliminado correctamente'
        });

    } catch (error) {
        console.error('Error al eliminar apoyo:', error);
        res.status(500).json({
            error: 'Error al eliminar el apoyo',
            message: error.message
        });
    }
});

// Manejador de errores global
app.use((err, req, res, next) => {
    console.error('Error global:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: err.message,
        details: err.detail || err.hint || 'No hay detalles adicionales'
    });
});

// Asegurar columna checklist en tablas objetivo
async function ensureChecklistColumn(tableName) {
  if (!['ordenes', 'submittals', 'sesiones', 'tiempo_diseno'].includes(tableName)) return;
  try {
    await apoyosPool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS checklist integer[] DEFAULT '{}'::integer[];`);
    await apoyosPool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_checklist_gin ON ${tableName} USING GIN (checklist);`);
  } catch (e) {
    logger.warn({ tag: 'CHECKLIST', message: `No se pudo asegurar columna checklist en ${tableName}`, error: e.message });
  }
}

// POST - Guardar checklist (se envía el array de ids marcados)
app.post('/api/checklist/save', async (req, res) => {
  const { table, id, order_number, checked } = req.body || {};
  if (!table || !Array.isArray(checked)) return res.status(400).json({ success: false, error: 'Parámetros inválidos' });
  if (!['ordenes', 'submittals', 'sesiones', 'tiempo_diseno'].includes(table)) return res.status(400).json({ success: false, error: 'Tabla no permitida' });

  try {
    await ensureChecklistColumn(table);

    let q, params;
    // Normalizar el array `checked`: extraer números de items como 'g3','p12' => 3,12
    const cleanedChecked = Array.isArray(checked)
      ? checked.map(v => {
          if (typeof v === 'number') return v;
          const s = String(v || '');
          const m = s.match(/-?\d+/g);
          if (!m) return null;
          return Number(m.join(''));
        }).filter(n => Number.isFinite(n))
      : [];

    if (typeof id !== 'undefined' && id !== null) {
      q = `UPDATE ${table} SET checklist = $1 WHERE id = $2 RETURNING *`;
      params = [cleanedChecked, id];
    } else if (order_number) {
      // Para submittals usar submittal_number
      const col = table === 'submittals' ? 'submittal_number' : 'order_number';
      q = `UPDATE ${table} SET checklist = $1 WHERE TRIM(COALESCE(${col}, '')) = TRIM($2) RETURNING *`;
      params = [cleanedChecked, String(order_number)];
    } else {
      return res.status(400).json({ success: false, error: 'Se requiere id o order_number/submittal_number' });
    }

    const result = await apoyosPool.query(q, params);
    if (result.rowCount === 0) {
      // Si no se encontró registro al intentar UPDATE, intentar INSERT cuando se proporcionó order_number/submittal_number
      if (order_number) {
        try {
          const insertCol = table === 'submittals' ? 'submittal_number' : 'order_number';
          const insertQ = `INSERT INTO ${table} (checklist, ${insertCol}) VALUES ($1, $2) RETURNING *`;
          const insertParams = [cleanedChecked, String(order_number)];
          const insertRes = await apoyosPool.query(insertQ, insertParams);
          if (insertRes.rowCount > 0) {
            logger.info({ tag: 'CHECKLIST', message: `Checklist creado para ${table} ${insertCol}=${order_number}` });
            return res.json({ success: true, row: insertRes.rows[0] });
          }
        } catch (ie) {
          logger.warn({ tag: 'CHECKLIST', message: 'Error al insertar checklist tras no encontrar registro', error: ie.message });
        }
      }
      return res.status(404).json({ success: false, error: 'Registro no encontrado' });
    }
    return res.json({ success: true, row: result.rows[0] });
  } catch (error) {
    logger.error({ tag: 'CHECKLIST', message: 'Error al guardar checklist', error: error.message });
    return res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// GET - Obtener checklist guardado para una orden/submittal
app.get('/api/checklist', async (req, res) => {
  const { table, id, order_number } = req.query || {};
  if (!table) return res.status(400).json({ success: false, error: 'table requerido' });
  if (!['ordenes', 'submittals', 'sesiones', 'tiempo_diseno'].includes(table)) return res.status(400).json({ success: false, error: 'Tabla no permitida' });

  try {
    await ensureChecklistColumn(table);
    let q, params;
    if (id) {
      q = `SELECT checklist FROM ${table} WHERE id = $1 LIMIT 1`;
      params = [id];
    } else if (order_number) {
      const col = table === 'submittals' ? 'submittal_number' : 'order_number';
      q = `SELECT checklist FROM ${table} WHERE TRIM(COALESCE(${col}, '')) = TRIM($1) LIMIT 1`;
      params = [String(order_number)];
    } else {
      return res.status(400).json({ success: false, error: 'Se requiere id o order_number/submittal_number' });
    }

    const result = await apoyosPool.query(q, params);
    if (result.rowCount === 0) {
      return res.json({ success: true, checklist: [], completed: 0, total: 56 });
    }

    const rawChecklist = Array.isArray(result.rows[0].checklist) ? result.rows[0].checklist : [];
    const normalizedChecklist = [...new Set(
      rawChecklist
        .map((value) => {
          if (typeof value === 'number') return Math.floor(value);
          const text = String(value || '').trim();
          if (!text) return null;
          const match = text.match(/-?\d+/g);
          if (!match || match.length === 0) return null;
          const parsed = Number(match.join(''));
          return Number.isFinite(parsed) ? Math.floor(parsed) : null;
        })
        .filter((value) => Number.isFinite(value) && value > 0)
    )].sort((a, b) => a - b);

    return res.json({
      success: true,
      checklist: normalizedChecklist,
      completed: normalizedChecklist.length,
      total: 56
    });
  } catch (error) {
    logger.error({ tag: 'CHECKLIST', message: 'Error al leer checklist', error: error.message });
    return res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// Endpoint para obtener el PDF más reciente
app.get('/api/latest-pdf', async (req, res) => {
  try {
    const result = await phoenixPool.query(
      'SELECT * FROM pdf_files ORDER BY uploaded_at DESC LIMIT 1'
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No hay PDFs disponibles' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener el PDF más reciente:', error);
    res.status(500).json({ error: 'Error al obtener el PDF más reciente' });
  }
});

// Endpoint para actualizar el campo pdf_show del último PDF subido
app.post('/api/pdf_show', async (req, res) => {
  try {
    const { show } = req.body;
    if (typeof show !== 'boolean') {
      return res.status(400).json({ error: 'El valor de show debe ser booleano' });
    }
    // Actualizar el campo pdf_show del último PDF subido
    const updateResult = await phoenixPool.query(
      `UPDATE pdf_files SET pdf_show = $1 WHERE id = (
        SELECT id FROM pdf_files ORDER BY uploaded_at DESC LIMIT 1
      ) RETURNING *`
      , [show]
    );
    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'No hay PDFs para actualizar' });
    }
    res.json({ success: true, pdf: updateResult.rows[0] });
  } catch (error) {
    console.error('Error al actualizar pdf_show:', error);
    res.status(500).json({ error: 'Error al actualizar pdf_show' });
  }
});

// Endpoint para obtener el valor de pdf_show del último PDF subido
app.get('/api/pdf_show', async (req, res) => {
  try {
    const result = await phoenixPool.query(
      'SELECT pdf_show FROM pdf_files ORDER BY uploaded_at DESC LIMIT 1'
    );
    if (result.rows.length === 0) {
      return res.json({ pdf_show: false });
    }
    res.json({ pdf_show: result.rows[0].pdf_show });
  } catch (error) {
    console.error('Error al obtener pdf_show:', error);
    res.status(500).json({ error: 'Error al obtener pdf_show' });
  }
});

// Ruta para subir evidencias de apoyos (mover aquí antes del manejador de rutas no encontradas)
app.post('/api/empleados/apoyos/evidencia', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    const { apoyoId, indice } = req.body;
    
    if (!apoyoId) {
      return res.status(400).json({ error: 'ID de apoyo no proporcionado' });
    }

    if (!indice || indice < 1 || indice > 3) {
      return res.status(400).json({ error: 'Índice de evidencia inválido (debe ser 1, 2 o 3)' });
    }
    // Verificar que el apoyo existe
    const apoyoCheck = await apoyosPool.query(
      'SELECT id FROM apoyos WHERE id = $1',
      [apoyoId]
    );

    if (apoyoCheck.rows.length === 0) {
      console.error('Apoyo no encontrado:', apoyoId);
      return res.status(404).json({ error: 'Apoyo no encontrado' });
    }

    // Actualizar la evidencia en la base de datos
    const campo = `evidencia${indice}`;
    const fotoUrl = `/uploads/${req.file.filename}`;
    const result = await apoyosPool.query(
      `UPDATE apoyos SET ${campo} = $1 WHERE id = $2 RETURNING id, ${campo}`,
      [fotoUrl, apoyoId]
    );
    res.json({ 
      success: true, 
      url: fotoUrl,
      campo: campo,
      message: 'Evidencia subida exitosamente' 
    });
  } catch (error) {
    console.error('Error al subir evidencia:', error);
    res.status(500).json({ 
      error: 'Error al subir la evidencia',
      message: error.message 
    });
  }
});

// Rutas para tickets de mantenimiento
app.get('/api/mantenimiento/tickets', async (req, res) => {
    try {
    // 1. Obtener todos los tickets de mantenimiento
    // Asegurar que las columnas de pausa existan
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT false');
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP');
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS total_paused_time INTERVAL DEFAULT \'0 seconds\'');
    
    const ticketsResult = await mantenimientoPool.query(`
      SELECT *,
             EXTRACT(EPOCH FROM COALESCE(total_paused_time, '0 seconds'::interval))::bigint as total_paused_seconds,
             COALESCE(paused, false) as paused,
             paused_at
      FROM tickets_mantenimiento 
      ORDER BY timestamp DESC
    `);
    const tickets = ticketsResult.rows;

    // 2. Obtener todos los IDs de usuarios asignados (aplanar arrays)
    let userIds = [];
    tickets.forEach(t => {
      let ids = t.assigned_user_id;
      if (!Array.isArray(ids)) {
        // Si viene como string tipo '{21,34}', conviértelo a array
        ids = String(ids).replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
      }
      ids = ids.flat().filter(id => typeof id === 'number' && !isNaN(id));
      t.assigned_user_id = ids; // Asegura que cada ticket tenga un array plano
      userIds.push(...ids);
    });
    userIds = Array.from(new Set(userIds)); // Elimina duplicados

    let usersMap = {};
    if (userIds.length > 0) {
      const usersResult = await apoyosPool.query(
        'SELECT id, nombre_completo FROM usuarios WHERE id = ANY($1)',
        [userIds]
      );
      usersMap = Object.fromEntries(usersResult.rows.map(u => [u.id, u.nombre_completo]));
    }

    // 3. Agregar los nombres de los usuarios asignados a cada ticket (como array)
    tickets.forEach(ticket => {
      ticket.assigned_user_names = ticket.assigned_user_id.map(uid => usersMap[uid] || null);
    });

    res.json(tickets);
    } catch (error) {
        console.error('Error al obtener tickets de mantenimiento:', error);
        res.status(500).json({ error: 'Error al obtener los tickets de mantenimiento' });
    }
});

// Obtener tickets abiertos por employee_id
app.get('/api/mantenimiento/tickets/por-empleado/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    // Asegurar columna employee_id
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS employee_id TEXT');

    const result = await mantenimientoPool.query(
      `SELECT *, EXTRACT(EPOCH FROM COALESCE(total_paused_time, '0 seconds'::interval))::bigint as total_paused_seconds
       FROM tickets_mantenimiento
       WHERE employee_id = $1
         AND COALESCE(urgency,'pending') <> 'completed'
       ORDER BY timestamp DESC`,
      [String(employeeId)]
    );
    const tickets = result.rows;

    // Aplanar assigned_user_id y agregar nombres si existen (reusar lógica mínima)
    let userIds = [];
    tickets.forEach(t => {
      let ids = t.assigned_user_id;
      if (!Array.isArray(ids)) {
        ids = String(ids).replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
      }
      ids = ids.flat().filter(id => typeof id === 'number' && !isNaN(id));
      t.assigned_user_id = ids;
      userIds.push(...ids);
    });
    userIds = Array.from(new Set(userIds));
    let usersMap = {};
    if (userIds.length > 0) {
      const usersResult = await apoyosPool.query('SELECT id, nombre_completo FROM usuarios WHERE id = ANY($1)', [userIds]);
      usersMap = Object.fromEntries(usersResult.rows.map(u => [u.id, u.nombre_completo]));
    }
    tickets.forEach(ticket => {
      ticket.assigned_user_names = ticket.assigned_user_id.map(uid => usersMap[uid] || null);
    });

    res.json(tickets);
  } catch (error) {
    console.error('Error al obtener tickets por empleado:', error);
    res.status(500).json({ error: 'Error al obtener tickets por empleado' });
  }
});

// Obtener tickets abiertos por nombre o employee_id (busca en tabla tickets_mantenimiento)
app.get('/api/mantenimiento/tickets/por-nombre/:query', async (req, res) => {
  try {
    const { query } = req.params;
    // Asegurar columnas necesarias
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS employee_id TEXT');
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS tipo_apoyo TEXT');

    const sql = `SELECT *, EXTRACT(EPOCH FROM COALESCE(total_paused_time, '0 seconds'::interval))::bigint as total_paused_seconds
                 FROM tickets_mantenimiento
                 WHERE (name ILIKE $1 OR employee_id = $2)
                   AND COALESCE(urgency,'pending') <> 'completed'
                 ORDER BY timestamp DESC`;

    const values = [`%${query}%`, String(query)];
    const result = await mantenimientoPool.query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener tickets por nombre:', error);
    res.status(500).json({ error: 'Error al obtener tickets por nombre' });
  }
});

// NUEVA RUTA PARA HERRAMIENTAS
app.get('/api/mantenimiento/herramientas', async (req, res) => {
    try {
        const { department, area } = req.query;
        let query = 'SELECT * FROM herramientas_mantenimiento';
        let params = [];
        let conditions = [];
        
        if (department) {
            conditions.push(`department = $${params.length + 1}`);
            params.push(department);
        }
        
        if (area) {
            conditions.push(`area = $${params.length + 1}`);
            params.push(area);
        }
        
        // Mostrar todas las herramientas, independientemente del valor de herramienta
        // (filtro removido para mostrar todas las herramientas)
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY nombre ASC';
        
        const result = await mantenimientoPool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener herramientas:', err);
        res.status(500).json({ error: 'Error al obtener las herramientas' });
    }
});

// RUTA PARA HERRAMIENTAS FILTRADAS POR DEPARTAMENTO
app.get('/api/herramientas_mantenimiento', async (req, res) => {
    try {
        const { department } = req.query;
        let query = 'SELECT * FROM herramientas_mantenimiento';
        let params = [];
        
        if (department) {
            query += ' WHERE department = $1';
            params.push(department);
        }
        
        query += ' ORDER BY nombre ASC';
        
        const result = await mantenimientoPool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener herramientas por departamento:', err);
        res.status(500).json({ error: 'Error al obtener las herramientas' });
    }
});

// Agregar nuevo endpoint para verificar actualizaciones de mantenimiento
app.get('/api/mantenimiento/tickets/check-updates', async (req, res) => {
    try {
        // Obtener el último timestamp de modificación de la tabla tickets_mantenimiento
        const result = await mantenimientoPool.query(`
            SELECT MAX(EXTRACT(EPOCH FROM timestamp)) as last_update 
            FROM tickets_mantenimiento
        `);
        
        const lastUpdate = result.rows[0].last_update;
        
        // Si no hay timestamp guardado en la sesión, guardarlo y retornar que hay actualizaciones
        if (!req.session.lastMantenimientoUpdate) {
            req.session.lastMantenimientoUpdate = lastUpdate;
            return res.json({ hasUpdates: true });
        }
        
        // Comparar con el último timestamp guardado
        const hasUpdates = lastUpdate > req.session.lastMantenimientoUpdate;
        
        // Actualizar el timestamp guardado
        req.session.lastMantenimientoUpdate = lastUpdate;
        
        res.json({ hasUpdates });
    } catch (error) {
        console.error('Error al verificar actualizaciones de mantenimiento:', error);
        res.status(500).json({ error: 'Error al verificar actualizaciones de mantenimiento' });
    }
});

// Actualizar urgencia de ticket de mantenimiento
app.patch('/api/mantenimiento/tickets/:id/urgency', async (req, res) => {
    try {
        const { id } = req.params;
        const { urgency } = req.body;
        
        let query;
        let params;
        
        // Si el ticket se está marcando como completado, guardar la urgencia anterior y agregar time_end
        if (urgency === 'completed') {
            // Primero obtener la urgencia actual antes de cambiarla
            const currentTicket = await mantenimientoPool.query(
                'SELECT urgency FROM tickets_mantenimiento WHERE id = $1',
                [id]
            );
            
            if (currentTicket.rows.length === 0) {
                return res.status(404).json({ error: 'Ticket de mantenimiento no encontrado' });
            }
            
            const currentUrgency = currentTicket.rows[0].urgency;
            
            // Asegurar columna de notas
            await mantenimientoPool.query(
              "ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS notas TEXT"
            );
            // Actualizar con la urgencia anterior (last_urgency) y time_end
            query = 'UPDATE tickets_mantenimiento SET urgency = $1, last_urgency = $2, time_end = NOW() WHERE id = $3 RETURNING *';
            params = [urgency, currentUrgency, id];
        } else {
            // Para otros estados, solo actualizar urgency
            query = 'UPDATE tickets_mantenimiento SET urgency = $1 WHERE id = $2 RETURNING *';
            params = [urgency, id];
        }
        
        const result = await mantenimientoPool.query(query, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket de mantenimiento no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar urgencia de ticket de mantenimiento:', error);
        res.status(500).json({ error: 'Error al actualizar la urgencia del ticket de mantenimiento' });
    }
});

// Eliminar ticket de mantenimiento
app.delete('/api/mantenimiento/tickets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await mantenimientoPool.query('DELETE FROM tickets_mantenimiento WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket de mantenimiento no encontrado' });
        }
        res.json({ message: 'Ticket de mantenimiento eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar ticket de mantenimiento:', error);
        res.status(500).json({ error: 'Error al eliminar el ticket de mantenimiento' });
    }
});

// Crear nuevo ticket de mantenimiento
app.post('/api/mantenimiento/tickets', async (req, res) => {
    try {
  const { name, department, area, issue, image_name, image_type, image_path, urgency, tipoApoyo, activo, employee_id, id_herramienta } = req.body;
    console.log('Datos recibidos en el servidor:', { name, department, area, issue, tipoApoyo, activo, id_herramienta });
        if (!name || !department || !issue) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }
        // Generar un id único usando timestamp y un número aleatorio
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        const id = `${timestamp}-${random}`;
        
        // Asegurar columna employee_id
        await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS employee_id TEXT');
        // Asegurar columna id_herramienta
        await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS id_herramienta INTEGER');

        const herramientaNumerica = Number(id_herramienta);
        const idHerramientaFinal = Number.isInteger(herramientaNumerica) && herramientaNumerica > 0
          ? herramientaNumerica
          : null;

        const result = await mantenimientoPool.query(
          `INSERT INTO tickets_mantenimiento (id, employee_id, name, department, area, issue, image_name, image_type, image_path, urgency, timestamp, tipo_apoyo, activo, id_herramienta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13)
           RETURNING *`,
          [id, employee_id || null, name, department, area || '', issue, image_name || null, image_type || null, image_path || null, urgency || 'pending', tipoApoyo || null, activo || null, idHerramientaFinal]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear ticket de mantenimiento:', error);
        res.status(500).json({ error: 'Error al crear el ticket de mantenimiento' });
    }
});

// Completar ticket de mantenimiento con herramienta
app.patch('/api/mantenimiento/tickets/:id/completar', async (req, res) => {
  const { id_herramienta, mantenimiento_preventivo, mantenimiento_correctivo, mecanica, implementaciones, notas, resuelto } = req.body;
  
  try {
    // Primero obtener la urgencia actual del ticket para guardarla en last_urgency
    const currentTicket = await mantenimientoPool.query(
      'SELECT urgency FROM tickets_mantenimiento WHERE id = $1',
      [req.params.id]
    );
    
    if (currentTicket.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket de mantenimiento no encontrado' });
    }
    
    const currentUrgency = currentTicket.rows[0].urgency;
    
    // Ahora actualizar incluyendo last_urgency
    // Asegurar columnas necesarias para guardar comentarios y estado de resolución
    await mantenimientoPool.query(
      "ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS notas TEXT"
    );
    await mantenimientoPool.query(
      "ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS resuelto BOOLEAN DEFAULT FALSE"
    );
    await mantenimientoPool.query(
      "ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS enviado_supervisor BOOLEAN DEFAULT FALSE"
    );

    const isFinalSupervisorCompletion = Object.prototype.hasOwnProperty.call(req.body, 'resuelto');

    if (isFinalSupervisorCompletion && currentUrgency !== 'pending') {
      return res.status(400).json({ error: 'Solo se pueden completar tickets que estén en estado pending' });
    }

    const targetUrgency = isFinalSupervisorCompletion ? 'completed' : 'pending';
    const enviadoSupervisor = isFinalSupervisorCompletion ? false : true;

    const sql = `
      UPDATE tickets_mantenimiento
      SET 
        id_herramienta = COALESCE($1, id_herramienta),
        mantenimiento_preventivo = $2,
        mantenimiento_correctivo = $3,
        mecanica = $4,
        implementaciones = $5,
        urgency = $6,
        last_urgency = $7,
        time_end = NOW(),
        notas = COALESCE($8, notas),
        resuelto = $9,
        enviado_supervisor = $10
        WHERE id = $11 
      RETURNING *
    `;
    
    const idHerramientaFinal = id_herramienta || null;
    const params = [
      idHerramientaFinal,
      mantenimiento_preventivo ? 1 : 0,
      mantenimiento_correctivo ? 1 : 0,
      mecanica ? 1 : 0,
      implementaciones ? 1 : 0,
      targetUrgency,
      currentUrgency, // Agregar la urgencia actual como last_urgency
      (typeof notas === 'string' && notas.trim().length > 0) ? notas.trim() : null,
      (!!resuelto) === true, // convertir a boolean
      enviadoSupervisor,
      req.params.id
    ];
    
    const result = await mantenimientoPool.query(sql, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket de mantenimiento no encontrado' });
    }
    res.json({ success: true, ticket: result.rows[0] });
  } catch (error) {
    console.error('Error al completar el ticket de mantenimiento:', error);
    res.status(500).json({ error: 'Error al completar el ticket de mantenimiento', details: error.message });
  }
});

// Pausar ticket de mantenimiento
app.post('/api/mantenimiento/tickets/:id/pausa', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Asegurar que existan las columnas necesarias primero
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT false');
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP');
    await mantenimientoPool.query('ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS total_paused_time INTERVAL DEFAULT \'0 seconds\'');
    
    // Verificar que el ticket existe
    const ticketCheck = await mantenimientoPool.query(
      'SELECT id, time_end, COALESCE(paused, false) as paused, paused_at FROM tickets_mantenimiento WHERE id = $1',
      [id]
    );
    
    if (ticketCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket de mantenimiento no encontrado' });
    }
    
    const ticket = ticketCheck.rows[0];
    
    // No permitir pausar tickets ya completados
    if (ticket.time_end) {
      return res.status(400).json({ error: 'No se puede pausar un ticket ya completado' });
    }
    
    // Si el ticket ya está pausado, despausarlo
    if (ticket.paused) {
      // Calcular el tiempo pausado y actualizar
      const pausedAt = ticket.paused_at ? new Date(ticket.paused_at) : new Date();
      const now = new Date();
      const pausedDuration = now - pausedAt;
      
      // Obtener el tiempo total pausado anterior
      const totalPausedResult = await mantenimientoPool.query(
        'SELECT total_paused_time FROM tickets_mantenimiento WHERE id = $1',
        [id]
      );
      const totalPausedTime = totalPausedResult.rows[0]?.total_paused_time || '0 seconds';
      
      // Sumar el nuevo tiempo pausado
      const result = await mantenimientoPool.query(`
        UPDATE tickets_mantenimiento 
        SET paused = false, 
            paused_at = NULL,
            total_paused_time = COALESCE(total_paused_time, '0 seconds') + ($1::text || ' seconds')::interval
        WHERE id = $2 
        RETURNING *
      `, [Math.floor(pausedDuration / 1000), id]);
      
      return res.json({ 
        success: true, 
        message: 'Ticket despausado correctamente',
        ticket: result.rows[0]
      });
    } else {
      // Pausar el ticket
      const result = await mantenimientoPool.query(`
        UPDATE tickets_mantenimiento 
        SET paused = true, 
            paused_at = NOW()
        WHERE id = $1 
        RETURNING *
      `, [id]);
      
      return res.json({ 
        success: true, 
        message: 'Ticket pausado correctamente',
        ticket: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error al pausar/despausar el ticket:', error);
    res.status(500).json({ 
      error: 'Error al pausar el ticket', 
      details: error.message 
    });
  }
});

// Actualizar únicamente las notas de un ticket de mantenimiento
app.patch('/api/mantenimiento/tickets/:id/notas', async (req, res) => {
  try {
    const { id } = req.params;
    const { notas } = req.body || {};
    // Asegurar columna
    await mantenimientoPool.query(
      "ALTER TABLE tickets_mantenimiento ADD COLUMN IF NOT EXISTS notas TEXT"
    );
    const result = await mantenimientoPool.query(
      'UPDATE tickets_mantenimiento SET notas = $1 WHERE id = $2 RETURNING *',
      [typeof notas === 'string' && notas.trim().length > 0 ? notas.trim() : null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket de mantenimiento no encontrado' });
    }
    res.json({ success: true, ticket: result.rows[0] });
  } catch (error) {
    console.error('Error al actualizar notas del ticket de mantenimiento:', error);
    res.status(500).json({ error: 'Error al actualizar notas del ticket de mantenimiento', details: error.message });
  }
});

// Registro y consulta de IDs de QR de equipos
app.post('/api/mantenimiento_qr', async (req, res) => {
  try {
    const { id, notas, ultimo_preventivo, ultimo_correctivo } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requerido' });
    const sql = `
      INSERT INTO mantenimiento_qr (id, notas, ultimo_preventivo, ultimo_correctivo)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        notas = COALESCE(EXCLUDED.notas, mantenimiento_qr.notas),
        ultimo_preventivo = COALESCE(EXCLUDED.ultimo_preventivo, mantenimiento_qr.ultimo_preventivo),
        ultimo_correctivo = COALESCE(EXCLUDED.ultimo_correctivo, mantenimiento_qr.ultimo_correctivo)
      RETURNING *;
    `;
    const result = await mantenimientoPool.query(sql, [id, notas || null, ultimo_preventivo || null, ultimo_correctivo || null]);
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    console.error('Error guardando mantenimiento_qr:', error);
    res.status(500).json({ error: 'Error guardando mantenimiento_qr' });
  }
});

// Listar todos los IDs registrados
app.get('/api/mantenimiento_qr', async (req, res) => {
  try {
    const result = await mantenimientoPool.query('SELECT * FROM mantenimiento_qr ORDER BY id ASC');
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Error listando mantenimiento_qr:', error);
    res.status(500).json({ error: 'Error listando mantenimiento_qr' });
  }
});

app.post('/api/mantenimiento_qr/batch', async (req, res) => {
  try {
    console.log('Batch QR recibido:', req.body);
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
    console.log('IDs no válidos:', ids);
      return res.status(400).json({ error: 'ids requeridos' });
    }
    
    console.log(`Insertando ${ids.length} IDs:`, ids);
    
    // Verificar que la tabla existe primero
    const tableCheck = await mantenimientoPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'mantenimiento_qr'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('Tabla mantenimiento_qr no existe, creándola...');
      await mantenimientoPool.query(`
        CREATE TABLE IF NOT EXISTS mantenimiento_qr (
          id TEXT PRIMARY KEY,
          notas TEXT,
          ultimo_preventivo TIMESTAMP NULL,
          ultimo_correctivo TIMESTAMP NULL
        );
      `);
      console.log('Tabla mantenimiento_qr creada');
    }
    
    let insertedCount = 0;
    for (const id of ids) {
      try {
        const sql = `
          INSERT INTO mantenimiento_qr (id)
          VALUES ($1)
          ON CONFLICT (id) DO NOTHING;
        `;
        const result = await mantenimientoPool.query(sql, [id]);
        if (result.rowCount > 0) {
          insertedCount++;
          console.log(`Insertado: ${id}`);
        } else {
          console.log(`Ya existía: ${id}`);
        }
      } catch (idError) {
        console.error(`Error insertando ${id}:`, idError);
      }
    }
    
    console.log(`Batch completado: ${insertedCount}/${ids.length} insertados`);
    res.json({ success: true, inserted: insertedCount, total: ids.length });
  } catch (error) {
    console.error('Error en batch de mantenimiento_qr:', error);
    res.status(500).json({ error: 'Error en batch de mantenimiento_qr', details: error.message });
  }
});

app.get('/api/mantenimiento_qr/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await mantenimientoPool.query('SELECT * FROM mantenimiento_qr WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Error consultando mantenimiento_qr:', error);
    res.status(500).json({ error: 'Error consultando mantenimiento_qr' });
  }
});

// ==================== TAREAS API ====================

// Función para asegurar que las tablas de tareas existan
async function ensureTareasTable() {
  try {
    logger.info('[ensureTareasTable] Verificando/creando estructura de tareas...');
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS tareas (
          id VARCHAR(100) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          priority VARCHAR(20) CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
          status VARCHAR(20) CHECK (status IN ('pending', 'progress', 'completed')) DEFAULT 'pending',
          dueDate DATE,
          images TEXT,
          owner VARCHAR(100) NOT NULL,
          sharedWith TEXT,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_tareas_owner ON tareas(owner);
      CREATE INDEX IF NOT EXISTS idx_tareas_status ON tareas(status);
      CREATE INDEX IF NOT EXISTS idx_tareas_priority ON tareas(priority);
      CREATE INDEX IF NOT EXISTS idx_tareas_created ON tareas(createdAt);
      CREATE INDEX IF NOT EXISTS idx_tareas_due_date ON tareas(dueDate);
      
      CREATE TABLE IF NOT EXISTS tareas_comentarios (
          id SERIAL PRIMARY KEY,
          tarea_id VARCHAR(100) NOT NULL,
          usuario VARCHAR(100) NOT NULL,
          comentario TEXT NOT NULL,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_tareas_comentarios_tarea ON tareas_comentarios(tarea_id);
      
      CREATE TABLE IF NOT EXISTS tareas_compartidas (
          tarea_id VARCHAR(100) NOT NULL,
          usuario VARCHAR(100) NOT NULL,
          compartido_por VARCHAR(100) NOT NULL,
          fecha_compartido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (tarea_id, usuario)
      );
    `);
    logger.info('[ensureTareasTable] Tablas de tareas inicializadas correctamente');
  } catch (error) {
    logger.error('[ensureTareasTable] Error al crear/verificar tablas de tareas:', error);
  }
}

// Obtener todas las tareas del usuario (personal y compartidas)
app.get('/api/tasks', async (req, res) => {
  try {
    const username = req.headers['x-username'] || req.query.username || 'Usuario';
    
    // Obtener tareas propias del usuario
    const result = await apoyosPool.query(
      `SELECT * FROM tareas 
       WHERE owner = $1 OR $1 = ANY(string_to_array(sharedWith, ','))
       ORDER BY createdAt DESC`,
      [username]
    );
    
    // Convertir JSON strings a arrays si es necesario
    const tasks = result.rows.map(task => {
      let images = [];
      try {
        if (typeof task.images === 'string') {
          images = JSON.parse(task.images || '[]');
        } else if (Array.isArray(task.images)) {
          images = task.images;
        }
      } catch (e) {
        console.warn('Error parsing images for task:', task.id, e);
        images = [];
      }
      
      return {
        ...task,
        images: Array.isArray(images) ? images : [],
        sharedWith: typeof task.sharedwith === 'string' ? task.sharedwith.split(',').filter(u => u.trim()) : []
      };
    });
    
    res.json({ success: true, tasks });
  } catch (error) {
    logger.error('Error al obtener tareas:', error);
    res.status(500).json({ success: false, error: 'Error al obtener tareas' });
  }
});

// Crear nueva tarea
app.post('/api/tasks', async (req, res) => {
  try {
    const { id, title, description, priority, status, dueDate, images, owner } = req.body;
    const username = owner || req.headers['x-username'] || 'Usuario';
    
    const imagesJson = JSON.stringify(images || []);
    
    const result = await apoyosPool.query(
      `INSERT INTO tareas (id, title, description, priority, status, dueDate, images, owner, sharedWith)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, title, description, priority, status, dueDate, imagesJson, username, '']
    );
    
    const task = result.rows[0];
    // Normalizar respuesta
    task.images = Array.isArray(images) ? images : [];
    
    res.json({ success: true, task });
  } catch (error) {
    logger.error('Error al crear tarea:', error);
    res.status(500).json({ success: false, error: 'Error al crear tarea' });
  }
});

// Actualizar tarea
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, priority, status, dueDate, images } = req.body;
    
    // Construir dinámicamente la query para permitir actualizaciones parciales
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (dueDate !== undefined) {
      updates.push(`dueDate = $${paramIndex++}`);
      values.push(dueDate);
    }
    if (images !== undefined) {
      const imagesJson = JSON.stringify(images || []);
      updates.push(`images = $${paramIndex++}`);
      values.push(imagesJson);
    }
    
    // Si no hay actualizaciones, retornar error
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron campos para actualizar' });
    }
    
    // Agregar el ID al final de los valores
    updates.push(`updatedAt = CURRENT_TIMESTAMP`);
    values.push(id);
    
    const query = `UPDATE tareas 
                   SET ${updates.join(', ')}
                   WHERE id = $${paramIndex}
                   RETURNING *`;
    
    const result = await apoyosPool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tarea no encontrada' });
    }
    
    const task = result.rows[0];
    // Normalizar respuesta
    task.images = Array.isArray(task.images) ? task.images : [];
    
    res.json({ success: true, task });
  } catch (error) {
    logger.error('Error al actualizar tarea:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar tarea' });
  }
});

// Eliminar tarea
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Eliminar comentarios asociados
    await apoyosPool.query('DELETE FROM tareas_comentarios WHERE tarea_id = $1', [id]);
    
    // Eliminar registros de compartición
    await apoyosPool.query('DELETE FROM tareas_compartidas WHERE tarea_id = $1', [id]);
    
    // Eliminar la tarea
    const result = await apoyosPool.query(
      'DELETE FROM tareas WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tarea no encontrada' });
    }
    
    res.json({ success: true, message: 'Tarea eliminada correctamente' });
  } catch (error) {
    logger.error('Error al eliminar tarea:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar tarea' });
  }
});

// Compartir tarea con usuario
app.post('/api/tasks/:id/share', async (req, res) => {
  try {
    const { id } = req.params;
    const { usuario, compartido_por } = req.body;
    const currentUser = compartido_por || req.headers['x-username'] || 'Usuario';
    
    // Agregar a la tabla de compartición
    await apoyosPool.query(
      `INSERT INTO tareas_compartidas (tarea_id, usuario, compartido_por)
       VALUES ($1, $2, $3)
       ON CONFLICT (tarea_id, usuario) DO NOTHING`,
      [id, usuario, currentUser]
    );
    
    // Actualizar el campo sharedWith en tareas
    const result = await apoyosPool.query(
      `UPDATE tareas 
       SET sharedWith = COALESCE(sharedWith, '') || CASE 
           WHEN sharedWith LIKE '%' || $2 || '%' THEN ''
           ELSE CASE WHEN sharedWith = '' THEN $2 ELSE ',' || $2 END
       END,
       updatedAt = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, usuario]
    );
    
    res.json({ success: true, task: result.rows[0] });
  } catch (error) {
    logger.error('Error al compartir tarea:', error);
    res.status(500).json({ success: false, error: 'Error al compartir tarea' });
  }
});

// Obtener comentarios de tarea
app.get('/api/tasks/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await apoyosPool.query(
      `SELECT * FROM tareas_comentarios
       WHERE tarea_id = $1
       ORDER BY createdAt DESC`,
      [id]
    );
    
    res.json({ success: true, comments: result.rows });
  } catch (error) {
    logger.error('Error al obtener comentarios:', error);
    res.status(500).json({ success: false, error: 'Error al obtener comentarios' });
  }
});

// Agregar comentario a tarea
app.post('/api/tasks/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { comentario, usuario } = req.body;
    const currentUser = usuario || req.headers['x-username'] || 'Usuario';
    
    const result = await apoyosPool.query(
      `INSERT INTO tareas_comentarios (tarea_id, usuario, comentario)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, currentUser, comentario]
    );
    
    res.json({ success: true, comment: result.rows[0] });
  } catch (error) {
    logger.error('Error al agregar comentario:', error);
    res.status(500).json({ success: false, error: 'Error al agregar comentario' });
  }
});

// Subir imágenes para tareas
app.post('/api/tasks/upload-images', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se han subido imágenes' });
    }
    
    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    
    res.json({ 
      success: true, 
      images: imageUrls
    });
  } catch (error) {
    logger.error('Error al subir imágenes de tarea:', error);
    res.status(500).json({ success: false, error: 'Error al subir imágenes' });
  }
});

// Eliminar usuario compartido de una tarea
app.delete('/api/tasks/:id/share/:username', async (req, res) => {
  try {
    const { id, username } = req.params;
    
    // Eliminar de la tabla de compartición
    await apoyosPool.query(
      'DELETE FROM tareas_compartidas WHERE tarea_id = $1 AND usuario = $2',
      [id, username]
    );
    
    // Actualizar el campo sharedWith en tareas
    const result = await apoyosPool.query(
      `UPDATE tareas 
       SET sharedWith = TRIM(BOTH ',' FROM REPLACE(',' || sharedWith || ',', ',' || $2 || ',', ',')),
       updatedAt = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, username]
    );
    
    res.json({ success: true, task: result.rows[0] });
  } catch (error) {
    logger.error('Error al eliminar compartición:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar compartición' });
  }
});

// Responder a un comentario (replies)
app.post('/api/tasks/:id/comments/:commentId/replies', async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const { comentario, usuario } = req.body;
    const currentUser = usuario || req.headers['x-username'] || 'Usuario';
    
    // For simplicity, we'll store replies as regular comments with a reference
    // You could extend the schema to have a parent_comment_id field
    const result = await apoyosPool.query(
      `INSERT INTO tareas_comentarios (tarea_id, usuario, comentario)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, currentUser, `@reply-${commentId}: ${comentario}`]
    );
    
    res.json({ success: true, reply: result.rows[0] });
  } catch (error) {
    logger.error('Error al agregar respuesta:', error);
    res.status(500).json({ success: false, error: 'Error al agregar respuesta' });
  }
});

// ==================== FIN TAREAS API ====================

// ==================== ENDPOINTS PARA TAREAS PERSONALES ====================

// Obtener todas las tareas del usuario logueado
app.get('/api/tareas-personales', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const result = await apoyosPool.query(
      `SELECT tp.*,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', u.id, 'nombre_completo', u.nombre_completo))
                  FILTER (WHERE u.id IS NOT NULL), '[]'::json
              ) AS shared_with
       FROM tareas_personales tp
       LEFT JOIN tareas_compartidas tc ON tp.id = tc.tarea_id
       LEFT JOIN usuarios u ON tc.usuario_compartido_id = u.id
       WHERE tp.usuario_id = $1
          OR EXISTS (
              SELECT 1 FROM tareas_compartidas tc2 
              WHERE tc2.tarea_id = tp.id AND tc2.usuario_compartido_id = $1
          )
       GROUP BY tp.id
       ORDER BY tp.creada_en DESC`,
      [req.session.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener tareas:', error);
    res.status(500).json({ error: 'Error al obtener tareas' });
  }
});

// Crear una nueva tarea
app.post('/api/tareas-personales', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { id, titulo, descripcion, prioridad, estado, posicion } = req.body;

    if (!titulo) {
      return res.status(400).json({ error: 'El título es requerido' });
    }

    const result = await apoyosPool.query(
      `INSERT INTO tareas_personales (id, usuario_id, titulo, descripcion, prioridad, estado, posicion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, req.session.userId, titulo, descripcion, prioridad || 'medium', estado || 'todo', posicion || 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear tarea:', error);
    res.status(500).json({ error: 'Error al crear tarea' });
  }
});

// Actualizar una tarea
app.put('/api/tareas-personales/:id', async (req, res) => {
  try {
    if (!req.session.userId) {
      console.log('[Tareas] PUT - No hay sesión de usuario');
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { id } = req.params;
    const { titulo, descripcion, prioridad, estado, posicion } = req.body;

    console.log('[Tareas] PUT - id:', id, 'usuario:', req.session.userId, 'estado:', estado);

    // Verificar que el usuario es el propietario de la tarea
    const checkResult = await apoyosPool.query(
      'SELECT usuario_id FROM tareas_personales WHERE id = $1',
      [id]
    );

    console.log('[Tareas] Tarea encontrada:', checkResult.rows.length > 0 ? 'SÍ' : 'NO');
    if (checkResult.rows.length > 0) {
      console.log('[Tareas] Propietario:', checkResult.rows[0].usuario_id, 'Usuario actual:', req.session.userId);
    }

    if (checkResult.rows.length === 0 || checkResult.rows[0].usuario_id !== req.session.userId) {
      return res.status(403).json({ error: 'No tienes permiso para actualizar esta tarea' });
    }

    const result = await apoyosPool.query(
      `UPDATE tareas_personales 
       SET titulo = COALESCE($2, titulo),
           descripcion = COALESCE($3, descripcion),
           prioridad = COALESCE($4, prioridad),
           estado = COALESCE($5, estado),
           posicion = COALESCE($6, posicion)
       WHERE id = $1
       RETURNING *`,
      [id, titulo, descripcion, prioridad, estado, posicion]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al actualizar tarea:', error);
    res.status(500).json({ error: 'Error al actualizar tarea' });
  }
});

// Eliminar una tarea
app.delete('/api/tareas-personales/:id', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { id } = req.params;

    // Verificar que el usuario es el propietario
    const checkResult = await apoyosPool.query(
      'SELECT usuario_id FROM tareas_personales WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0 || checkResult.rows[0].usuario_id !== req.session.userId) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta tarea' });
    }

    await apoyosPool.query('DELETE FROM tareas_personales WHERE id = $1', [id]);

    res.json({ message: 'Tarea eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar tarea:', error);
    res.status(500).json({ error: 'Error al eliminar tarea' });
  }
});

// ==================== ENDPOINTS PARA COMENTARIOS ====================

// Obtener comentarios de una tarea
app.get('/api/tareas-personales/:taskId/comentarios', async (req, res) => {
  try {
    const { taskId } = req.params;

    const result = await apoyosPool.query(
      `SELECT c.id, c.contenido, u.nombre_completo as author, c.creado_en as timestamp
       FROM comentarios_tareas c
       JOIN usuarios u ON c.usuario_id = u.id
       WHERE c.tarea_id = $1
       ORDER BY c.creado_en ASC`,
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener comentarios:', error);
    res.status(500).json({ error: 'Error al obtener comentarios' });
  }
});

// Agregar comentario a una tarea
app.post('/api/tareas-personales/:taskId/comentarios', async (req, res) => {
  try {
    if (!req.session.userId) {
      console.log('[Comentarios] No hay sesión de usuario');
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { taskId } = req.params;
    const { id, contenido } = req.body;

    console.log('[Comentarios] Guardar comentario - taskId:', taskId, 'usuario:', req.session.userId);

    if (!contenido || contenido.trim().length === 0) {
      return res.status(400).json({ error: 'El contenido del comentario es requerido' });
    }

    // Verificar que la tarea existe
    const taskCheck = await apoyosPool.query(
      'SELECT id FROM tareas_personales WHERE id = $1',
      [taskId]
    );

    console.log('[Comentarios] Tarea encontrada:', taskCheck.rows.length > 0 ? 'SÍ' : 'NO');

    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tarea no encontrada', taskId });
    }

    const result = await apoyosPool.query(
      `WITH inserted AS (
         INSERT INTO comentarios_tareas (id, tarea_id, usuario_id, contenido)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tarea_id, usuario_id, contenido, creado_en
       )
       SELECT i.id, i.contenido, u.nombre_completo as author, i.creado_en as timestamp
       FROM inserted i
       JOIN usuarios u ON i.usuario_id = u.id`,
      [id, taskId, req.session.userId, contenido]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al agregar comentario:', error);
    res.status(500).json({ error: 'Error al agregar comentario' });
  }
});

// Eliminar comentario
app.delete('/api/comentarios/:commentId', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { commentId } = req.params;

    // Verificar que el usuario es el autor del comentario
    const checkResult = await apoyosPool.query(
      'SELECT usuario_id FROM comentarios_tareas WHERE id = $1',
      [commentId]
    );

    if (checkResult.rows.length === 0 || checkResult.rows[0].usuario_id !== req.session.userId) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario' });
    }

    await apoyosPool.query('DELETE FROM comentarios_tareas WHERE id = $1', [commentId]);

    res.json({ message: 'Comentario eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar comentario:', error);
    res.status(500).json({ error: 'Error al eliminar comentario' });
  }
});

// ==================== ENDPOINTS PARA COMPARTIR TAREAS ====================

// Compartir tarea con usuarios
app.post('/api/tareas-personales/:taskId/compartir', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { taskId } = req.params;
    const { userIds } = req.body; // Array de IDs de usuarios

    if (!Array.isArray(userIds)) {
      return res.status(400).json({ error: 'userIds debe ser un array' });
    }

    // Verificar que el usuario es el propietario
    const taskCheck = await apoyosPool.query(
      'SELECT usuario_id FROM tareas_personales WHERE id = $1',
      [taskId]
    );

    if (taskCheck.rows.length === 0 || taskCheck.rows[0].usuario_id !== req.session.userId) {
      return res.status(403).json({ error: 'No tienes permiso para compartir esta tarea' });
    }

    // Eliminar comparticiones previas
    await apoyosPool.query('DELETE FROM tareas_compartidas WHERE tarea_id = $1', [taskId]);

    // Agregar nuevas comparticiones
    for (const userId of userIds) {
      await apoyosPool.query(
        `INSERT INTO tareas_compartidas (tarea_id, usuario_propietario_id, usuario_compartido_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tarea_id, usuario_compartido_id) DO NOTHING`,
        [taskId, req.session.userId, userId]
      );
    }

    res.json({ message: 'Tarea compartida exitosamente' });
  } catch (error) {
    console.error('Error al compartir tarea:', error);
    res.status(500).json({ error: 'Error al compartir tarea' });
  }
});

// Obtener usuarios con los que se comparte la tarea
app.get('/api/tareas-personales/:taskId/compartidas-con', async (req, res) => {
  try {
    const { taskId } = req.params;

    const result = await apoyosPool.query(
      `SELECT u.id, u.nombre_completo, u.departamento
       FROM tareas_compartidas tc
       JOIN usuarios u ON tc.usuario_compartido_id = u.id
       WHERE tc.tarea_id = $1`,
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios compartidos:', error);
    res.status(500).json({ error: 'Error al obtener usuarios compartidos' });
  }
});

// ==================== RUTAS PARA COMIDAS ====================

// Función para asegurar que la tabla comidas existe
async function ensureComidasTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS comidas (
        id SERIAL PRIMARY KEY,
        empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        cantidad INTEGER NOT NULL DEFAULT 1,
        fecha DATE NOT NULL,
        observaciones TEXT,
        usuario_registro VARCHAR(100),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Crear índices para optimizar búsquedas
    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS idx_comidas_empleado ON comidas(empleado_id);
      CREATE INDEX IF NOT EXISTS idx_comidas_fecha ON comidas(fecha);
      CREATE INDEX IF NOT EXISTS idx_comidas_empleado_fecha ON comidas(empleado_id, fecha);
    `);
    
    console.log('Tabla comidas verificada/creada correctamente');
  } catch (error) {
    console.error('Error al crear/verificar tabla comidas:', error);
  }
}

// Ruta para registrar una comida
app.post('/api/comidas', async (req, res) => {
  try {
    const { empleado_id, cantidad, fecha, observaciones, usuario_registro } = req.body;

    // Validar campos requeridos
    if (!empleado_id || !cantidad || !fecha) {
      return res.status(400).json({
        success: false,
        error: 'Faltan campos obligatorios',
        message: 'Se requieren empleado_id, cantidad y fecha'
      });
    }

    // Validar que la cantidad sea positiva
    if (cantidad < 1) {
      return res.status(400).json({
        success: false,
        error: 'Cantidad inválida',
        message: 'La cantidad debe ser al menos 1'
      });
    }

    // Verificar que el empleado existe
    const empleadoCheck = await apoyosPool.query(
      'SELECT id FROM empleados WHERE id = $1',
      [empleado_id]
    );

    if (empleadoCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado',
        message: 'El empleado especificado no existe'
      });
    }

    // Insertar registro individual de comida
    const result = await apoyosPool.query(`
      INSERT INTO comidas (empleado_id, cantidad, fecha, observaciones, usuario_registro)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [empleado_id, cantidad, fecha, observaciones || null, usuario_registro || null]);

    res.json({
      success: true,
      comida: result.rows[0],
      message: 'Comida registrada exitosamente'
    });

  } catch (error) {
    console.error('Error al registrar comida:', error);
    res.status(500).json({
      success: false,
      error: 'Error al registrar la comida',
      message: error.message
    });
  }
});

// Ruta para obtener el usuario actual (desde la sesión)
app.get('/api/usuario-actual', (req, res) => {
  const username = (req.session && req.session.username) ? req.session.username : 'Sistema';
  res.json({
    usuario: username,
    sesionActiva: !!(req.session && req.session.username)
  });
});

// Ruta para obtener comidas semanales del usuario actual usando usuarios.numero_empleado -> comidas.empleado_id
app.get('/api/comidas/semana-usuario', async (req, res) => {
  try {
    const { inicio, fin } = req.query;
    const usernameSesion = (req.session && req.session.username) ? req.session.username : null;
    const username = (usernameSesion || req.query.username || '').toString().trim();

    if (!inicio || !fin) {
      return res.status(400).json({
        success: false,
        error: 'Faltan parámetros',
        message: 'Se requieren los parámetros inicio y fin (formato YYYY-MM-DD)'
      });
    }

    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'Usuario no identificado',
        message: 'No se pudo identificar el usuario para consultar comidas'
      });
    }

    const usuarioResult = await apoyosPool.query(
      `SELECT id, username, numero_empleado
       FROM usuarios
       WHERE username = $1
       LIMIT 1`,
      [username]
    );

    if (usuarioResult.rows.length === 0) {
      return res.json({
        success: true,
        total: 0,
        empleado_id: null,
        rows: []
      });
    }

    const numeroEmpleado = (usuarioResult.rows[0].numero_empleado ?? '').toString().trim();
    if (!numeroEmpleado) {
      return res.json({
        success: true,
        total: 0,
        empleado_id: null,
        rows: []
      });
    }

    const comidasResult = await apoyosPool.query(
      `SELECT id, empleado_id, cantidad, fecha, observaciones, fecha_registro
       FROM comidas
       WHERE empleado_id::text = $1
         AND fecha >= $2
         AND fecha <= $3
       ORDER BY fecha DESC`,
      [numeroEmpleado, inicio, fin]
    );

    const total = comidasResult.rows.reduce((sum, row) => sum + (Number(row.cantidad) || 0), 0);

    res.json({
      success: true,
      total,
      empleado_id: numeroEmpleado,
      rows: comidasResult.rows
    });
  } catch (error) {
    console.error('Error al obtener comidas semanales del usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener comidas semanales del usuario',
      message: error.message
    });
  }
});

// Ruta para obtener comidas de un empleado en un rango de fechas
app.get('/api/comidas/empleado/:empleadoId', async (req, res) => {
  try {
    const { empleadoId } = req.params;
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({
        success: false,
        error: 'Faltan parámetros',
        message: 'Se requieren los parámetros inicio y fin (formato YYYY-MM-DD)'
      });
    }

    const result = await apoyosPool.query(`
      SELECT 
        id,
        empleado_id,
        cantidad,
        fecha,
        observaciones,
        fecha_registro
      FROM comidas
      WHERE empleado_id = $1 
        AND fecha >= $2 
        AND fecha <= $3
      ORDER BY fecha DESC
    `, [empleadoId, inicio, fin]);

    res.json(result.rows);

  } catch (error) {
    console.error('Error al obtener comidas del empleado:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener comidas',
      message: error.message
    });
  }
});

// Ruta para obtener todas las comidas (para reportes)
app.get('/api/comidas', async (req, res) => {
  try {
    const { empleado_id, inicio, fin } = req.query;
    
    let query = `
      SELECT 
        c.id,
        c.empleado_id,
        e.nombre_completo,
        c.cantidad,
        c.fecha,
        c.observaciones,
        c.fecha_registro
      FROM comidas c
      INNER JOIN empleados e ON c.empleado_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (empleado_id) {
      query += ` AND c.empleado_id = $${paramCount}`;
      params.push(empleado_id);
      paramCount++;
    }

    if (inicio) {
      query += ` AND c.fecha >= $${paramCount}`;
      params.push(inicio);
      paramCount++;
    }

    if (fin) {
      query += ` AND c.fecha <= $${paramCount}`;
      params.push(fin);
      paramCount++;
    }

    query += ' ORDER BY c.fecha DESC, e.nombre_completo';

    const result = await apoyosPool.query(query, params);

    res.json(result.rows);

  } catch (error) {
    console.error('Error al obtener comidas:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener comidas',
      message: error.message
    });
  }
});

// ==================== FIN RUTAS PARA COMIDAS ====================

// ==================== FIN ENDPOINTS TAREAS PERSONALES ====================

// Configuración de archivos estáticos (después de todas las rutas)
app.use(express.static(path.join(__dirname, 'frontend'), {
    index: false // Evitar que sirva automáticamente index.html
}));

// NOTA: El middleware 404 se movió al final del archivo para que no interfiera con las rutas registradas después

// Middleware para manejar errores del servidor
app.use((err, req, res, next) => {
    logger.error('Error del servidor:', err);
    
    // Si es una petición de API, devolver JSON
    if (req.path.startsWith('/api/')) {
        return res.status(500).json({ 
            error: 'Error interno del servidor',
            message: process.env.NODE_ENV === 'development' ? err.message : 'Ha ocurrido un error'
        });
    }
    
    // Para rutas HTML, mostrar error genérico
    res.status(500).send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error 500 - PDM</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }
                .container {
                    text-align: center;
                    background: white;
                    padding: 3rem;
                    border-radius: 20px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                h1 { color: #e74c3c; font-size: 4rem; margin: 0; }
                p { color: #666; font-size: 1.2rem; }
                a {
                    display: inline-block;
                    margin-top: 1rem;
                    padding: 0.8rem 2rem;
                    background: #667eea;
                    color: white;
                    text-decoration: none;
                    border-radius: 10px;
                    transition: transform 0.3s;
                }
                a:hover { transform: translateY(-2px); }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>500</h1>
                <h2>Error del Servidor</h2>
                <p>Lo sentimos, algo salió mal. Por favor intenta de nuevo más tarde.</p>
                <a href="/inicio.html">Volver al Inicio</a>
            </div>
        </body>
        </html>
    `);
});


// API endpoints para UOMs y Línea de producto
app.get('/api/uoms_pyc', async (req, res) => {
  try {
    const result = await inventarioPool.query(`SELECT id, descripcion, activo FROM UOMS_pyc ORDER BY lower(descripcion) ASC`);
    res.json(result.rows);
  } catch (error) {
    logger.error('GET /api/uoms_pyc error:', { message: error?.message });
    res.status(500).json({ error: 'Error al leer UOMs' });
  }
});

app.post('/api/uoms_pyc', async (req, res) => {
  try {
    const descripcion = (req.body.descripcion || '').toString().trim();
    const activo = req.body.activo === undefined ? true : (req.body.activo === true || req.body.activo === 'true');
    if (!descripcion) return res.status(400).json({ error: 'descripcion requerida' });
    const insert = await inventarioPool.query(
      `INSERT INTO UOMS_pyc (descripcion, activo, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id, descripcion, activo`,
      [descripcion, activo]
    );
    res.json(insert.rows[0]);
  } catch (error) {
    logger.error('POST /api/uoms_pyc error:', { message: error?.message, code: error?.code });
    if (error && error.code === '23505') return res.status(409).json({ error: 'UOM ya existe' });
    res.status(500).json({ error: 'Error al insertar UOM' });
  }
});

// Update UOM
app.put('/api/uoms_pyc/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    const descripcion = (req.body.descripcion || req.body.description || '').toString().trim();
    const activo = req.body.activo === undefined ? true : (req.body.activo === true || req.body.activo === 'true');
    if (!descripcion) return res.status(400).json({ error: 'descripcion requerida' });
    await inventarioPool.query('UPDATE UOMS_pyc SET descripcion=$1, activo=$2, updated_at=NOW() WHERE id=$3', [descripcion, activo, id]);
    const r = await inventarioPool.query('SELECT id, descripcion, activo FROM UOMS_pyc WHERE id=$1', [id]);
    res.json(r.rows[0] || {});
  } catch (error) {
    logger.error('PUT /api/uoms_pyc/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al actualizar UOM' });
  }
});

app.delete('/api/uoms_pyc/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    await inventarioPool.query('DELETE FROM UOMS_pyc WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/uoms_pyc/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al eliminar UOM' });
  }
});

app.get('/api/linea_producto', async (req, res) => {
  try {
    const result = await inventarioPool.query(`SELECT id, descripcion, activo FROM linea_producto ORDER BY lower(descripcion) ASC`);
    res.json(result.rows);
  } catch (error) {
    logger.error('GET /api/linea_producto error:', { message: error?.message });
    res.status(500).json({ error: 'Error al leer líneas de producto' });
  }
});

app.post('/api/linea_producto', async (req, res) => {
  try {
    const descripcion = (req.body.descripcion || '').toString().trim();
    const activo = req.body.activo === undefined ? true : (req.body.activo === true || req.body.activo === 'true');
    if (!descripcion) return res.status(400).json({ error: 'descripcion requerida' });
    const insert = await inventarioPool.query(
      `INSERT INTO linea_producto (descripcion, activo, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id, descripcion, activo`,
      [descripcion, activo]
    );
    res.json(insert.rows[0]);
  } catch (error) {
    logger.error('POST /api/linea_producto error:', { message: error?.message, code: error?.code });
    if (error && error.code === '23505') return res.status(409).json({ error: 'Línea ya existe' });
    res.status(500).json({ error: 'Error al insertar línea' });
  }
});

// Update linea_producto
app.put('/api/linea_producto/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    const descripcion = (req.body.descripcion || req.body.description || '').toString().trim();
    const activo = req.body.activo === undefined ? true : (req.body.activo === true || req.body.activo === 'true');
    if (!descripcion) return res.status(400).json({ error: 'descripcion requerida' });
    await inventarioPool.query('UPDATE linea_producto SET descripcion=$1, activo=$2, updated_at=NOW() WHERE id=$3', [descripcion, activo, id]);
    const r = await inventarioPool.query('SELECT id, descripcion, activo FROM linea_producto WHERE id=$1', [id]);
    res.json(r.rows[0] || {});
  } catch (error) {
    logger.error('PUT /api/linea_producto/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al actualizar línea' });
  }
});

// Endpoints para Grado
app.get('/api/grado', async (req, res) => {
  try {
    const result = await inventarioPool.query(`SELECT id, descripcion, activo FROM grado ORDER BY lower(descripcion) ASC`);
    res.json(result.rows);
  } catch (error) {
    logger.error('GET /api/grado error:', { message: error?.message });
    res.status(500).json({ error: 'Error al leer grados' });
  }
});

app.post('/api/grado', async (req, res) => {
  try {
    const descripcion = (req.body.descripcion || '').toString().trim();
    const activo = req.body.activo === undefined ? true : (req.body.activo === true || req.body.activo === 'true');
    if (!descripcion) return res.status(400).json({ error: 'descripcion requerida' });
    const insert = await inventarioPool.query(
      `INSERT INTO grado (descripcion, activo, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id, descripcion, activo`,
      [descripcion, activo]
    );
    res.json(insert.rows[0]);
  } catch (error) {
    logger.error('POST /api/grado error:', { message: error?.message, code: error?.code });
    if (error && error.code === '23505') return res.status(409).json({ error: 'Grado ya existe' });
    res.status(500).json({ error: 'Error al insertar grado' });
  }
});

// Update grado
app.put('/api/grado/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    const descripcion = (req.body.descripcion || req.body.description || '').toString().trim();
    const activo = req.body.activo === undefined ? true : (req.body.activo === true || req.body.activo === 'true');
    if (!descripcion) return res.status(400).json({ error: 'descripcion requerida' });
    await inventarioPool.query('UPDATE grado SET descripcion=$1, activo=$2, updated_at=NOW() WHERE id=$3', [descripcion, activo, id]);
    const r = await inventarioPool.query('SELECT id, descripcion, activo FROM grado WHERE id=$1', [id]);
    res.json(r.rows[0] || {});
  } catch (error) {
    logger.error('PUT /api/grado/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al actualizar grado' });
  }
});

app.delete('/api/grado/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    await inventarioPool.query('DELETE FROM grado WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/grado/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al eliminar grado' });
  }
});

// Endpoints para Commodity
app.get('/api/commodity', async (req, res) => {
  try {
    const result = await inventarioPool.query(`SELECT id, descripcion, activo FROM commodity ORDER BY lower(descripcion) ASC`);
    res.json(result.rows);
  } catch (error) {
    logger.error('GET /api/commodity error:', { message: error?.message });
    res.status(500).json({ error: 'Error al leer commodities' });
  }
});

app.post('/api/commodity', async (req, res) => {
  try {
    const descripcion = (req.body.descripcion || '').toString().trim();
    const activo = req.body.activo === undefined ? true : (req.body.activo === true || req.body.activo === 'true');
    if (!descripcion) return res.status(400).json({ error: 'descripcion requerida' });
    const insert = await inventarioPool.query(
      `INSERT INTO commodity (descripcion, activo, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id, descripcion, activo`,
      [descripcion, activo]
    );
    res.json(insert.rows[0]);
  } catch (error) {
    logger.error('POST /api/commodity error:', { message: error?.message, code: error?.code });
    if (error && error.code === '23505') return res.status(409).json({ error: 'Commodity ya existe' });
    res.status(500).json({ error: 'Error al insertar commodity' });
  }
});

// Update commodity
app.put('/api/commodity/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    const descripcion = (req.body.descripcion || req.body.description || '').toString().trim();
    const activo = req.body.activo === undefined ? true : (req.body.activo === true || req.body.activo === 'true');
    if (!descripcion) return res.status(400).json({ error: 'descripcion requerida' });
    await inventarioPool.query('UPDATE commodity SET descripcion=$1, activo=$2, updated_at=NOW() WHERE id=$3', [descripcion, activo, id]);
    const r = await inventarioPool.query('SELECT id, descripcion, activo FROM commodity WHERE id=$1', [id]);
    res.json(r.rows[0] || {});
  } catch (error) {
    logger.error('PUT /api/commodity/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al actualizar commodity' });
  }
});

app.delete('/api/commodity/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    await inventarioPool.query('DELETE FROM commodity WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/commodity/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al eliminar commodity' });
  }
});

// Enviar a (tabla enviar_a)
app.get('/api/enviar', async (req, res) => {
  try {
    const result = await inventarioPool.query(
      `SELECT id, nombre, direccion, activo FROM enviar_a ORDER BY lower(trim(nombre)) ASC`,
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('GET /api/enviar error:', { message: error?.message });
    res.status(500).json({ error: 'Error al leer direcciones enviar_a' });
  }
});

app.post('/api/enviar', async (req, res) => {
  try {
    const nombre = (req.body.nombre ?? req.body.name ?? '').toString().trim();
    const direccion = (req.body.direccion ?? req.body.address ?? '').toString().trim();
    const activo = req.body.activo === undefined ? true : req.body.activo === true || req.body.activo === 'true';
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const insert = await inventarioPool.query(
      `INSERT INTO enviar_a (nombre, direccion, activo, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, nombre, direccion, activo`,
      [nombre, direccion, activo],
    );
    res.json(insert.rows[0]);
  } catch (error) {
    logger.error('POST /api/enviar error:', { message: error?.message, code: error?.code });
    if (error && error.code === '23505')
      return res.status(409).json({ error: 'Ya existe un destino con ese nombre' });
    res.status(500).json({ error: 'Error al insertar en enviar_a' });
  }
});

app.put('/api/enviar/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    const nombre = (req.body.nombre ?? req.body.name ?? '').toString().trim();
    const direccion = (req.body.direccion ?? req.body.address ?? '').toString().trim();
    const activo = req.body.activo === undefined ? true : req.body.activo === true || req.body.activo === 'true';
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    await inventarioPool.query(
      'UPDATE enviar_a SET nombre=$1, direccion=$2, activo=$3, updated_at=NOW() WHERE id=$4',
      [nombre, direccion, activo, id],
    );
    const r = await inventarioPool.query('SELECT id, nombre, direccion, activo FROM enviar_a WHERE id=$1', [id]);
    res.json(r.rows[0] || {});
  } catch (error) {
    logger.error('PUT /api/enviar/:id error:', { message: error?.message, code: error?.code });
    if (error && error.code === '23505')
      return res.status(409).json({ error: 'Ya existe un destino con ese nombre' });
    res.status(500).json({ error: 'Error al actualizar enviar_a' });
  }
});

app.delete('/api/enviar/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    await inventarioPool.query('DELETE FROM enviar_a WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/enviar/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al eliminar enviar_a' });
  }
});

app.delete('/api/linea_producto/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    await inventarioPool.query('DELETE FROM linea_producto WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/linea_producto/:id error:', { message: error?.message });
    res.status(500).json({ error: 'Error al eliminar línea' });
  }
});

// Manejador global de errores: devolver siempre JSON para errores (incluye Multer)
app.use((err, req, res, next) => {
  try {
    logger.error('Unhandled error middleware:', err && (err.stack || err.message || err));
  } catch (logErr) {
    // ignore logging failures
  }

  if (res.headersSent) return next(err);

  // Manejar errores típicos de Multer (límite de tamaño, etc.)
  if (err && err.code && String(err.code).startsWith('LIMIT_')) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ success: false, error: err.message || 'Error de subida', code: err.code });
  }

  // Manejar MulterError si está expuesto
  try {
    if (typeof multer !== 'undefined' && err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, error: err.message, code: err.code });
    }
  } catch (e) {
    // ignore
  }

  const status = (err && err.status) ? err.status : 500;
  return res.status(status).json({ success: false, error: err && err.message ? err.message : 'Error interno del servidor' });
});

// Corrige el trigger de inventario que causaba error "updatedat" al insertar/actualizar
async function fixInventarioTrigger() {
  try {
    // 1. Asegurar que la columna updated_at exista en inventario
    await inventarioPool.query(`
      ALTER TABLE inventario ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    // 2. Recrear la función trigger con la referencia correcta (updated_at con guión bajo)
    await inventarioPool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 3. Eliminar el trigger anterior en inventario si existe (puede tener el bug)
    await inventarioPool.query(`
      DROP TRIGGER IF EXISTS update_inventario_updated_at ON inventario;
    `);

    // 4. Recrear el trigger correctamente (solo en UPDATE, no en INSERT)
    await inventarioPool.query(`
      CREATE TRIGGER update_inventario_updated_at
        BEFORE UPDATE ON inventario
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);

    logger.info('[fixInventarioTrigger] Trigger de inventario verificado/corregido correctamente');
  } catch (error) {
    logger.error('[fixInventarioTrigger] Error al corregir trigger de inventario:', error?.message || error);
  }
}

app.listen(port, '0.0.0.0', async () => {
    logger.info(`Servidor iniciado en puerto ${port}`);
    logger.info(`URL: http://localhost:${port}`);
    logger.info(`API disponible en: http://localhost:${port}/api/solicitudes-rh`);
    logger.info(`Formulario RH: http://localhost:${port}/solicitud_rh.html`);
    logger.info(`Test RH: http://localhost:${port}/solicitud_rh_simple.html`);
    logger.info(`================================================`);
    // Mostrar direcciones IPv4 del host para ayudar al diagnóstico del túnel
    try {
      const nets = require('os').networkInterfaces();
      const addrs = [];
      Object.keys(nets || {}).forEach((name) => {
        const list = Array.isArray(nets[name]) ? nets[name] : [];
        list.forEach((ni) => {
          if (ni && ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
        });
      });
      logger.info({ tag: 'BIND', addresses: addrs }, 'Listening on addresses');
    } catch (e) {
      logger.warn('Could not enumerate network interfaces', { error: e && e.message ? e.message : String(e) });
    }
    // Corregir trigger de inventario (bug "updatedat" sin guión bajo)
    await fixInventarioTrigger();
    // Verificar/crear tabla de salidas al arrancar
    ensureSalidasTable();
    // Verificar/crear tabla de log de entradas individuales
    try {
      await ensureInventarioEntradaTable();
    } catch (e) {
      logger.error('[startup] ensureInventarioEntradaTable:', e);
    }
    // Verificar/crear tabla de sesiones de usuarios
    await ensureSesionesTable();
    // Verificar/crear tabla de cambios de estado para reconstruir mini tiempos
    await ensureCambiosEstadoTable();
    // Verificar/crear tabla requisiciones
    await ensureRequisicionesTable();
    // Configurar tabla empleados para IDs manuales
    await ensureEmpleadosIdManual();
    // Asegurar que las tablas de tareas estén listas
    await ensureTareasTable();
    // Verificar/crear tabla de comidas
    await ensureComidasTable();
    // Verificar/crear tabla PO
    await ensurePoTable();
    await ensurePoItemsExtraColumns();
    // Verificar/crear tablas nuevas para UOMs y Línea de producto
    await ensureUomsPycTable();
    await ensureLineaProductoTable();
    await ensureGradoTable();
    await ensureCommodityTable();
    await ensureEnviarATable();
    // Asegurar tabla para items del modal
    await ensureItemsTable();
    await ensureInventarioItemIdFk();
    // Asegurar tabla para comunidad (feedback del menú contextual)
    await ensureComunidadTable();
    // Asegurar tabla incapacidades
    await ensureIncapacidadesTable();
    // Asegurar tabla para Canva
    await ensureCanvaTable();
    // Asegurar tabla para likes de publicaciones
    await ensureLikesTable();
    // Asegurar que las tablas de recordatorios estén listas
    try {
      await ensureRecordatoriosTables();
      recordatoriosTablesReady = true;
      logger.info('Tablas de recordatorios inicializadas correctamente');
    } catch (error) {
      logger.error('Error al inicializar tablas de recordatorios al iniciar servidor:', error);
    }
});

app.post('/api/mantenimiento/herramientas', async (req, res) => {
  const { nombre, department } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  if (!department) return res.status(400).json({ error: 'Departamento requerido' });
  
  try {
    const result = await mantenimientoPool.query(
      'INSERT INTO herramientas_mantenimiento (nombre, department) VALUES ($1, $2) RETURNING *',
      [nombre, department]
    );
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(400).json({ error: 'Esta herramienta ya existe' });
    }
    console.error('Error al insertar herramienta:', err);
    res.status(500).json({ error: 'Error al insertar en la base de datos', details: err.message });
  }
});

// ── /api/herramientas  (CRUD completo para modal de mantenimiento) ──────────────

// Multer para fotos de herramientas
const herramientaFotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const p = path.join(__dirname, 'uploads', 'herramientas');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    cb(null, p);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `herramienta-${Date.now()}${ext}`);
  }
});
const uploadHerramientaFoto = multer({
  storage: herramientaFotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo imágenes'));
    cb(null, true);
  }
});

// Subir foto
app.post('/api/herramientas/foto', uploadHerramientaFoto.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió archivo' });
  res.json({ success: true, url: `/uploads/herramientas/${req.file.filename}` });
});

// Listar todas
app.get('/api/herramientas', async (req, res) => {
  try {
    const result = await mantenimientoPool.query(
      `SELECT id, nombre, department AS departamento, area_especifica, prestable, foto_url
       FROM herramientas_mantenimiento ORDER BY nombre ASC`
    );
    res.json({ success: true, herramientas: result.rows });
  } catch (err) {
    logger.error('Error GET /api/herramientas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Crear
app.post('/api/herramientas', async (req, res) => {
  const { nombre, departamento, area_especifica, prestable, foto_url } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ success: false, error: 'Nombre requerido' });
  try {
    const result = await mantenimientoPool.query(
      `INSERT INTO herramientas_mantenimiento (nombre, department, area_especifica, prestable, foto_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre.trim(), departamento || null, area_especifica || null, !!prestable, foto_url || null]
    );
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    logger.error('Error POST /api/herramientas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Actualizar
app.put('/api/herramientas/:id', async (req, res) => {
  const { nombre, departamento, area_especifica, prestable, foto_url } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ success: false, error: 'Nombre requerido' });
  try {
    const result = await mantenimientoPool.query(
      `UPDATE herramientas_mantenimiento
       SET nombre=$1, department=$2, area_especifica=$3, prestable=$4,
           foto_url=COALESCE($5, foto_url)
       WHERE id=$6 RETURNING *`,
      [nombre.trim(), departamento || null, area_especifica || null, !!prestable, foto_url || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'No encontrada' });
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    logger.error('Error PUT /api/herramientas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eliminar
app.delete('/api/herramientas/:id', async (req, res) => {
  try {
    const result = await mantenimientoPool.query(
      'DELETE FROM herramientas_mantenimiento WHERE id=$1 RETURNING id', [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'No encontrada' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Error DELETE /api/herramientas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para crear una PO (guardar datos enviados desde el frontend)
app.post('/api/po', async (req, res) => {
  try {
    const payload = req.body || {};
    const orden_compra = payload.orden_compra || payload.ordenCompra || null;
    let proveedor = null;
    if (payload.proveedor != null && payload.proveedor !== '') {
      const pn = Number(payload.proveedor);
      proveedor = Number.isFinite(pn) ? pn : null;
    }
    const enviar_a = payload.enviar_a || payload.enviarA || '';
    const locacion = payload.locacion || '';
    const via_despacho = payload.via_despacho || payload.viaDespacho || '';
    const fecha_po = payload.fecha_po || payload.fechaPo || null;
    const fecha_requerida = payload.fecha_requerida || payload.fechaRequerida || null;
    const flete = payload.flete || '';
    const notas = payload.notas || '';
    const certificado = (typeof payload.certificado === 'boolean') ? payload.certificado : (String(payload.certificado || '').toLowerCase() === 'true');
    const iva = (typeof payload.IVA === 'boolean') ? payload.IVA : (String(payload.IVA || payload.iva || '').toLowerCase() === 'true');
    const creado_por = payload.creado_por || payload.creadoPor || (req.session && req.session.username) || '';

    let usuario_compra_id = null;
    if (req.session && req.session.userId != null && req.session.userId !== '') {
      const uid = Number(req.session.userId);
      if (Number.isFinite(uid)) usuario_compra_id = uid;
    }
    if (usuario_compra_id == null && payload.usuario_compra_id != null && payload.usuario_compra_id !== '') {
      const uid2 = Number(payload.usuario_compra_id);
      if (Number.isFinite(uid2)) usuario_compra_id = uid2;
    }
    if (usuario_compra_id == null && req.session && req.session.username) {
      try {
        const lu = await apoyosPool.query(
          'SELECT id FROM usuarios WHERE LOWER(TRIM(username)) = LOWER(TRIM($1::text)) LIMIT 1',
          [String(req.session.username)]
        );
        if (lu.rows.length && lu.rows[0].id != null) {
          const uidLookup = Number(lu.rows[0].id);
          if (Number.isFinite(uidLookup)) usuario_compra_id = uidLookup;
        }
      } catch (eLu) {
        logger.warn('[POST /api/po] Lookup usuario_compra_id por username:', eLu?.message || eLu);
      }
    }

    const tf = (typeof payload.tf === 'boolean')
      ? payload.tf
      : (String(payload.tf || '').toLowerCase() === 'true' || payload.tf === 1 || payload.tf === '1');

    let total_numerico = null;
    const parseMoneyTotal = function(raw){
      if (raw === undefined || raw === null || raw === '') return null;
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      const cleaned = String(raw).replace(/\u00a0/g, ' ').replace(/,/g, '').replace(/^\s*\$\s?/, '').replace(/\s/g, '').trim();
      const parsed = parseFloat(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    };
    total_numerico = parseMoneyTotal(payload.total_numerico != null ? payload.total_numerico : payload.totalNumerico);
    if (total_numerico == null) total_numerico = parseMoneyTotal(payload.total);
    const rawTotal = payload.total;
    let total;
    if (total_numerico != null) {
      total = Number(total_numerico).toFixed(2);
    } else {
      const parsedRt = parseMoneyTotal(rawTotal);
      total = parsedRt != null ? parsedRt.toFixed(2) : '0.00';
    }

    const proveedor_nombre = payload.proveedor_nombre || payload.proveedorNombre || null;
    const proveedor_direccion = payload.proveedor_direccion || payload.proveedorDireccion || null;
    const proveedor_tipo = payload.proveedor_tipo || payload.proveedorTipo || null;
    let iva_pct = null;
    const rawIvaPct = payload.iva_pct != null ? payload.iva_pct : payload.ivaPct;
    if (rawIvaPct !== undefined && rawIvaPct !== null && rawIvaPct !== '') {
      const ip = parseFloat(String(rawIvaPct).replace(/%/g, '').trim());
      if (Number.isFinite(ip)) iva_pct = ip;
    }
    let terms_credit_days = null;
    const rawTermsDays = payload.terms_credit_days != null ? payload.terms_credit_days : payload.termsCreditDays;
    if (rawTermsDays !== undefined && rawTermsDays !== null && rawTermsDays !== '') {
      const td = parseInt(String(rawTermsDays).trim(), 10);
      if (Number.isFinite(td)) terms_credit_days = td;
    }
    const enviar_a_direccion = payload.enviar_a_direccion || payload.enviarADireccion || null;
    const require_confirm_text_snap = payload.require_confirm_text_snap || payload.requireConfirmTextSnap || null;
    let require_confirm_enabled_snap = true;
    if (typeof payload.require_confirm_enabled_snap === 'boolean') require_confirm_enabled_snap = payload.require_confirm_enabled_snap;
    else if (typeof payload.requireConfirmEnabledSnap === 'boolean') require_confirm_enabled_snap = payload.requireConfirmEnabledSnap;

    const insertQuery = `
      INSERT INTO po (
        orden_compra, proveedor, enviar_a, locacion, via_despacho, fecha_po, fecha_requerida, flete, notas, certificado, iva, creado_por, total, tf, usuario_compra_id, total_numerico,
        proveedor_nombre, proveedor_direccion, proveedor_tipo, iva_pct, terms_credit_days, enviar_a_direccion, require_confirm_text_snap, require_confirm_enabled_snap
      ) VALUES ($1,$2,$3,$4,$5, COALESCE(NULLIF($6,'')::timestamptz, NOW()), COALESCE(NULLIF($7,'')::timestamptz, NOW()), $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`;

    const values = [
      orden_compra, proveedor, enviar_a, locacion, via_despacho, fecha_po || null, fecha_requerida || null,
      flete, notas, certificado, iva, creado_por, total, tf, usuario_compra_id, total_numerico,
      proveedor_nombre, proveedor_direccion, proveedor_tipo, iva_pct, terms_credit_days,
      enviar_a_direccion, require_confirm_text_snap, require_confirm_enabled_snap
    ];
    // Log para depuración: mostrar payload y valores que se van a insertar
    logger.info('[POST /api/po] payload:', { payload: payload });
    logger.info('[POST /api/po] db values:', { values: values });
    const result = await inventarioPool.query(insertQuery, values);
    return res.json({ success: true, po: result.rows[0] });
  } catch (err) {
    logger.error('[POST /api/po] Error insertando PO:', err?.message || err);
    return res.status(500).json({ success: false, error: 'Error al guardar PO', details: err?.message || String(err) });
  }
});

async function syncPoTotalsFromLineItems(pool, poId) {
  try {
    const pid = Number(poId);
    if (!Number.isFinite(pid)) return;

    const poRes = await pool.query(
      `SELECT id, flete, iva_pct FROM po WHERE id = $1`,
      [pid]
    );
    if (!poRes.rows.length) return;

    const sumRes = await pool.query(
      `SELECT COALESCE(SUM(
         COALESCE(line_extended_numeric::numeric, quantity::numeric * COALESCE(unit_price::numeric, 0))
       ), 0)::numeric AS subtotal
       FROM po_items WHERE po_id = $1`,
      [pid]
    );
    const sub = sumRes.rows[0] && sumRes.rows[0].subtotal != null
      ? Number(sumRes.rows[0].subtotal)
      : 0;

    const prow = poRes.rows[0];
    let fleteNum = 0;
    const fleteRaw = prow.flete;
    if (fleteRaw != null && String(fleteRaw).trim() !== '') {
      const fn = Number(fleteRaw);
      if (Number.isFinite(fn)) fleteNum = fn;
      else {
        const cleaned = String(fleteRaw).replace(/\u00a0/g, '').replace(/,/g, '').replace(/^\s*\$\s?/, '').replace(/\s/g, '').trim();
        const fp = parseFloat(cleaned);
        if (Number.isFinite(fp)) fleteNum = fp;
      }
    }

    let pct = prow.iva_pct != null ? Number(prow.iva_pct) : 0;
    if (!Number.isFinite(pct) || pct < 0) pct = 0;
    const ivaAmt = pct > 0 ? Math.round(sub * (pct / 100) * 100) / 100 : 0;
    const grand = Math.round((sub + ivaAmt + fleteNum) * 100) / 100;
    const grandStr = grand.toFixed(2);

    await pool.query(
      `UPDATE po SET total_numerico = $1::numeric, total = $2 WHERE id = $3`,
      [grandStr, grandStr, pid]
    );
  } catch (e) {
    logger.warn('[syncPoTotalsFromLineItems] po_id=', poId, e?.message || e);
  }
}

// Endpoint para crear uno o varios items asociados a una PO
app.post('/api/po_items', async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : (body.item ? [body.item] : []);
    if (!items.length) return res.status(400).json({ success: false, error: 'No items provided' });

    await inventarioPool.query('BEGIN');
    const inserted = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const po_id = it.po_id || it.poId || null;
      if (!po_id) continue; // skip invalid
      const line_number = it.line_number || it.line || (i+1);
      const part_number = it.part_number || it.partNumber || it.code || null;
      const description = it.description || it.desc || '';
      const quantity = (it.quantity == null) ? 0 : it.quantity;
      const unit_price = (it.unit_price == null) ? 0 : it.unit_price;
      const currency = it.currency || 'USD';
      const status = it.status || 'pending';
      const creado_por = it.creado_por || it.creadoPor || (req.session && req.session.username) || '';
      const uom = it.uom || it.um || it.UOM || null;
      const belongs_to = it.belongs_to || it.belongsTo || null;
      let line_extended_numeric = null;
      const ql = Number(it.quantity);
      const up = Number(it.unit_price);
      if (Number.isFinite(ql) && Number.isFinite(up)) line_extended_numeric = ql * up;

      const q = `INSERT INTO po_items (po_id, line_number, part_number, description, quantity, unit_price, currency, status, creado_por, uom, belongs_to, line_extended_numeric, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW()) RETURNING *`;
      const vals = [po_id, line_number, part_number, description, quantity, unit_price, currency, status, creado_por, uom, belongs_to, line_extended_numeric];
      const r = await inventarioPool.query(q, vals);
      inserted.push(r.rows[0]);
    }

    const poIdsToSync = [...new Set(
      items
        .map((it) => Number(it.po_id || it.poId))
        .filter((id) => Number.isFinite(id))
    )];
    for (let si = 0; si < poIdsToSync.length; si += 1) {
      await syncPoTotalsFromLineItems(inventarioPool, poIdsToSync[si]);
    }

    await inventarioPool.query('COMMIT');
    return res.json({ success: true, inserted });
  } catch (err) {
    try { await inventarioPool.query('ROLLBACK'); } catch(e){}
    console.error('[POST /api/po_items] Error:', err);
    return res.status(500).json({ success: false, error: 'Error guardando po_items', details: err?.message || String(err) });
  }
});

// Endpoint para crear items genéricos desde el modal de Items
app.post('/api/items', async (req, res) => {
  const body = req.body || {};
  const codigo = body.codigo || body.code || null;
  const descripcion = body.descripcion || body.description || '';
  const uom = body.uom || null;
  const commodity = body.commodity || null;
  const grado = body.grado || null;
  const cfdi = body.cfdi || null;
  const categoria = body.categoria || null;
  const created_by = req.session && req.session.userId ? Number(req.session.userId) : null;

  if (!descripcion && !codigo) {
    return res.status(400).json({ error: 'descripcion o codigo requerido' });
  }

  const insertQ = `INSERT INTO items (codigo, descripcion, uom, commodity, grado, cfdi, categoria, created_by, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`;
  const vals = [codigo, descripcion, uom, commodity, grado, cfdi, categoria, created_by];

  const client = await inventarioPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(insertQ, vals);
    const row = result.rows[0];
    const itemId = row && row.id;
    if (!itemId) {
      throw new Error('No se obtuvo id del item insertado');
    }

    const nombreCompletoRaw = String(descripcion || '').trim() || String(codigo || '').trim() || 'Sin nombre';
    const idIngreso = `ITEM-CAT-${itemId}-${Date.now()}`;

    await client.query(
      `INSERT INTO inventario (
          nombre_completo, stock, pedido_abierto, piezas_pedidas, activo,
          codigo, po, categoria, descripcion, factura, proveedor,
          costo_unitario_mxn, costo_unitario_dlls,
          stock_inicial, entradas, salidas, uom, categoria_pdm, locacion, id_ingreso, heat_number, item_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id`,
      [
        nombreCompletoRaw,
        0,
        false,
        0,
        true,
        codigo || null,
        null,
        categoria || null,
        descripcion || null,
        null,
        null,
        null,
        null,
        0,
        0,
        0,
        uom || null,
        null,
        null,
        idIngreso,
        null,
        itemId,
      ],
    );

    await client.query('COMMIT');
    return res.json(row);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      logger.warn('[POST /api/items] ROLLBACK:', rbErr?.message || rbErr);
    }
    logger.error('[POST /api/items] Error insertando item:', err?.message || err);
    return res.status(500).json({ error: 'Error al guardar item', details: err?.message || String(err) });
  } finally {
    client.release();
  }
});

// Update item
app.put('/api/items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    const body = req.body || {};
    const codigo = body.codigo || body.code || null;
    const descripcion = body.descripcion || body.description || '';
    const uom = body.uom || null;
    const commodity = body.commodity || null;
    const grado = body.grado || null;
    const cfdi = body.cfdi || null;
    const categoria = body.categoria || null;
    // Basic validation
    if (!descripcion && !codigo) return res.status(400).json({ error: 'descripcion o codigo requerido' });
    const q = `UPDATE items SET codigo=$1, descripcion=$2, uom=$3, commodity=$4, grado=$5, cfdi=$6, categoria=$7, updated_at=NOW() WHERE id=$8 RETURNING *`;
    const vals = [codigo, descripcion, uom, commodity, grado, cfdi, categoria, id];
    const r = await inventarioPool.query(q, vals);
    if (!r.rows || !r.rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    try {
      const nombreLista = String(descripcion || '').trim() || String(codigo || '').trim() || null;
      await inventarioPool.query(
        `UPDATE inventario SET
           codigo = $1,
           descripcion = $2,
           nombre_completo = COALESCE($3, nombre_completo),
           uom = $4,
           categoria = $5
         WHERE item_id = $6`,
        [codigo, descripcion || null, nombreLista, uom, categoria || null, id],
      );
    } catch (syncErr) {
      logger.warn('[PUT /api/items/:id] sync inventario:', syncErr?.message || syncErr);
    }
    return res.json(r.rows[0]);
  } catch (err) {
    logger.error('[PUT /api/items/:id] Error actualizando item:', err?.message || err);
    return res.status(500).json({ error: 'Error al actualizar item', details: err?.message || String(err) });
  }
});

// Obtener items genéricos (para modal de Items)
app.get('/api/items', async (req, res) => {
  try {
    const q = req.query || {};
    const limit = q.limit ? Math.min(2000, Number(q.limit) || 0) : 0;
    const offset = q.offset ? Number(q.offset) || 0 : 0;
    // permitir filtro por id, codigo o descripcion
    const id = q.id || null;
    const codigo = q.codigo || q.code || null;
    const descripcion = q.descripcion || q.description || null;

    let query = 'SELECT * FROM items WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) {
      query += ` AND id = $${idx++}`;
      params.push(id);
    }
    if (codigo) {
      query += ` AND lower(coalesce(codigo,'')) LIKE $${idx++}`;
      params.push('%' + String(codigo).toLowerCase() + '%');
    }
    if (descripcion) {
      query += ` AND lower(coalesce(descripcion,'')) LIKE $${idx++}`;
      params.push('%' + String(descripcion).toLowerCase() + '%');
    }

    query += ' ORDER BY id DESC';
    if (limit && limit > 0) {
      query += ` LIMIT $${idx++}`;
      params.push(limit);
    }
    if (offset && offset > 0) {
      query += ` OFFSET $${idx++}`;
      params.push(offset);
    }

    const result = await inventarioPool.query(query, params);
    return res.json(Array.isArray(result.rows) ? result.rows : []);
  } catch (err) {
    console.error('[GET /api/items] Error:', err);
    return res.status(500).json({ error: 'Error fetching items', details: err?.message || String(err) });
  }
});

// Obtener items de PO (soporta query params: po_id, po, purchase_order_id, order_id, id, limit, offset)
app.get('/api/po_items', async (req, res) => {
  try {
    const q = req.query || {};
    const poId = q.po_id || q.po || q.purchase_order_id || q.order_id || q.poId || null;
    const id = q.id || null;
    const limit = q.limit ? Math.min(1000, Number(q.limit) || 0) : 0;
    const offset = q.offset ? Number(q.offset) || 0 : 0;

    let query = 'SELECT * FROM po_items WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) {
      query += ` AND id = $${idx++}`;
      params.push(id);
    }
    if (poId) {
      query += ` AND po_id = $${idx++}`;
      params.push(poId);
    }

    query += ' ORDER BY line_number ASC';
    if (limit && limit > 0) {
      query += ` LIMIT $${idx++}`;
      params.push(limit);
    }
    if (offset && offset > 0) {
      query += ` OFFSET $${idx++}`;
      params.push(offset);
    }

    const result = await inventarioPool.query(query, params);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    return res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('[GET /api/po_items] Error:', err);
    return res.status(500).json({ success: false, error: 'Error fetching po_items', details: err?.message || String(err) });
  }
});

  // Obtener POs con filtros opcionales: id, orden_compra (busqueda parcial), proveedor, tf, rango de fechas, paginación
  app.get('/api/po', async (req, res) => {
    try {
      const { id, orden_compra, proveedor, tf, inicio, fin, limit, offset } = req.query;

      let query = 'SELECT * FROM PO WHERE 1=1';
      const params = [];
      let i = 1;

      if (id) {
        query += ` AND id = $${i++}`;
        params.push(id);
      }

      if (orden_compra) {
        query += ` AND orden_compra ILIKE $${i++}`;
        params.push(`%${orden_compra}%`);
      }

      if (proveedor) {
        query += ` AND proveedor = $${i++}`;
        params.push(proveedor);
      }

      if (tf !== undefined && tf !== '') {
        const tfBool = String(tf).toLowerCase() === 'true' || tf === '1';
        query += ` AND tf = $${i++}`;
        params.push(tfBool);
      }

      if (inicio) {
        query += ` AND fecha_po >= $${i++}`;
        params.push(inicio);
      }

      if (fin) {
        query += ` AND fecha_po <= $${i++}`;
        params.push(fin);
      }

      query += ' ORDER BY fecha_po DESC';

      if (limit) {
        query += ` LIMIT $${i++}`;
        params.push(Number(limit));
      }

      if (offset) {
        query += ` OFFSET $${i++}`;
        params.push(Number(offset));
      }

      const result = await inventarioPool.query(query, params);
      const rows = Array.isArray(result.rows) ? result.rows : [];

      const userIds = [...new Set(
        rows.map((r) => r.usuario_compra_id).filter((id) => id != null && String(id).trim() !== '')
      )].map((id) => Number(id)).filter((id) => Number.isFinite(id));

      if (userIds.length) {
        try {
          const ures = await apoyosPool.query(
            'SELECT id, nombre_completo, username FROM usuarios WHERE id = ANY($1::int[])',
            [userIds]
          );
          const byId = {};
          ures.rows.forEach((u) => {
            byId[u.id] = u;
          });
          rows.forEach((row) => {
            const uid = row.usuario_compra_id != null ? Number(row.usuario_compra_id) : null;
            if (!Number.isFinite(uid)) return;
            const u = byId[uid];
            if (u) {
              row.comprador_nombre = u.nombre_completo || null;
              row.comprador_username = u.username || null;
            }
          });
        } catch (enrichErr) {
          logger.warn('[GET /api/po] Enriquecimiento usuarios:', enrichErr?.message || enrichErr);
        }
      }

      return res.json({ success: true, rows });
    } catch (err) {
      logger.error('[GET /api/po] Error al obtener POs:', err?.message || err);
      return res.status(500).json({ success: false, error: 'Error al obtener POs', details: err?.message || String(err) });
    }
  });

  // Eliminar PO y sus partidas (po_items)
  app.delete('/api/po/:id', async (req, res) => {
    const rawId = req.params.id;
    const poId = Number(rawId);
    if (!Number.isFinite(poId)) {
      return res.status(400).json({ success: false, error: 'id inválido' });
    }
    const client = await inventarioPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM po_items WHERE po_id = $1', [poId]);
      const del = await client.query('DELETE FROM po WHERE id = $1 RETURNING id', [poId]);
      await client.query('COMMIT');
      if (!del.rows.length) {
        return res.status(404).json({ success: false, error: 'PO no encontrada' });
      }
      return res.json({ success: true, id: poId });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      logger.error('[DELETE /api/po/:id]', err?.message || err);
      return res.status(500).json({ success: false, error: 'Error al eliminar PO', details: err?.message || String(err) });
    } finally {
      client.release();
    }
  });

app.patch('/api/mantenimiento/herramientas/:id/department', async (req, res) => {
  const { id } = req.params;
  const { department } = req.body;
  try {
    const result = await mantenimientoPool.query(
      'UPDATE herramientas_mantenimiento SET department = $1 WHERE id = $2 RETURNING *',
      [department, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Herramienta no encontrada' });
    }
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar el departamento', details: err.message });
  }
});

// Endpoint para actualizar el nombre de una herramienta
app.put('/api/mantenimiento/herramientas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  
  if (!nombre || nombre.trim() === '') {
    return res.status(400).json({ error: 'El nombre es requerido' });
  }
  
  try {
    const result = await mantenimientoPool.query(
      'UPDATE herramientas_mantenimiento SET nombre = $1 WHERE id = $2 RETURNING *',
      [nombre.trim(), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Herramienta no encontrada' });
    }
    
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(400).json({ error: 'Ya existe una herramienta con este nombre' });
    }
    console.error('Error al actualizar herramienta:', err);
    res.status(500).json({ error: 'Error al actualizar la herramienta', details: err.message });
  }
});

// Endpoint para actualizar el área de una herramienta
app.patch('/api/mantenimiento/herramientas/:id/area', async (req, res) => {
  const { id } = req.params;
  const { area } = req.body;
  
  try {
    const result = await mantenimientoPool.query(
      'UPDATE herramientas_mantenimiento SET area = $1 WHERE id = $2 RETURNING *',
      [area || null, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Herramienta no encontrada' });
    }
    
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    console.error('Error al actualizar área de herramienta:', err);
    res.status(500).json({ error: 'Error al actualizar el área', details: err.message });
  }
});

// Endpoint para actualizar el switch de herramienta
app.patch('/api/mantenimiento/herramientas/:id/herramienta', async (req, res) => {
  const { id } = req.params;
  const { herramienta } = req.body;
  
  console.log(`[PATCH] Actualizando switch de herramienta - ID: ${id}, herramienta: ${herramienta}`);
  
  try {
    // Convertir el valor a booleano
    const herramientaValue = herramienta === true || herramienta === 'true';
    
    const result = await mantenimientoPool.query(
      'UPDATE herramientas_mantenimiento SET herramienta = $1 WHERE id = $2 RETURNING *',
      [herramientaValue, id]
    );
    
    if (result.rows.length === 0) {
      console.log(`[PATCH] Herramienta no encontrada - ID: ${id}`);
      return res.status(404).json({ error: 'Herramienta no encontrada' });
    }
    
    console.log(`[PATCH] Switch actualizado exitosamente - ID: ${id}`);
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    console.error('Error al actualizar switch de herramienta:', err);
    res.status(500).json({ error: 'Error al actualizar el switch de herramienta', details: err.message });
  }
});

// Endpoint para subir y guardar foto de herramienta
const herramientaUploadMant = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const p = path.join(__dirname, 'uploads', 'herramientas');
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      cb(null, p);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `herramienta-${req.params.id}-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo imágenes'));
    cb(null, true);
  }
});

// Endpoint para descargar herramientas en Excel (con imágenes embebidas)
app.get('/api/mantenimiento/herramientas/exportar-excel', async (req, res) => {
  try {
    const result = await mantenimientoPool.query(
      `SELECT id, nombre, department AS departamento, area AS area_especifica,
              prestable, foto
       FROM herramientas_mantenimiento ORDER BY nombre ASC`
    );
    const rows = result.rows;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Herramientas');

    // Columnas (Foto sin header de valor, se rellena con imagen)
    ws.columns = [
      { header: 'ID',              key: 'id',              width: 6  },
      { header: 'Herramienta',     key: 'nombre',          width: 30 },
      { header: 'Departamento',    key: 'departamento',    width: 22 },
      { header: 'Área Específica', key: 'area_especifica', width: 22 },
      { header: 'Prestable',       key: 'prestable',       width: 12 },
      { header: 'Foto',            key: 'foto',            width: 18 },
    ];

    // Estilo encabezado
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 22;

    const IMG_H_PX = 70; // altura de celda en píxeles
    const ROW_H_PT = IMG_H_PX * 0.75; // puntos (aprox)

    for (let i = 0; i < rows.length; i++) {
      const r   = rows[i];
      const rowNum = i + 2; // fila 1 = encabezado
      const row = ws.getRow(rowNum);

      row.getCell('id').value            = r.id;
      row.getCell('nombre').value        = r.nombre        || '';
      row.getCell('departamento').value  = r.departamento  || '';
      row.getCell('area_especifica').value = r.area_especifica || '';
      row.getCell('prestable').value     = r.prestable ? 'Sí' : 'No';
      row.height = ROW_H_PT;

      // Centrar verticalmente todas las celdas de la fila
      row.eachCell(cell => { cell.alignment = { vertical: 'middle' }; });

      // Embeber imagen si existe
      if (r.foto) {
        try {
          // Convertir ruta URL a ruta de disco
          const relPath  = r.foto.replace(/^\//, '');
          const diskPath = path.join(__dirname, relPath);
          if (fs.existsSync(diskPath)) {
            const ext = path.extname(diskPath).replace('.', '').toLowerCase();
            const validExts = ['jpg', 'jpeg', 'png', 'gif'];
            const imgExt = validExts.includes(ext) ? (ext === 'jpg' ? 'jpeg' : ext) : 'jpeg';
            const imgBuf = fs.readFileSync(diskPath);
            const imgId  = wb.addImage({ buffer: imgBuf, extension: imgExt });
            // Columna 6 (índice 5, base-0) = Foto
            ws.addImage(imgId, {
              tl: { col: 5, row: rowNum - 1 },
              br: { col: 6, row: rowNum },
              editAs: 'oneCell'
            });
            row.getCell('foto').value = ''; // limpiar texto
          }
        } catch (imgErr) {
          logger.warn('No se pudo embeber imagen en Excel:', imgErr?.message);
          row.getCell('foto').value = r.foto; // fallback: mostrar texto
        }
      }

      row.commit();
    }

    res.setHeader('Content-Disposition', 'attachment; filename="herramientas.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error('Error al exportar herramientas Excel:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// ── Préstamos de herramientas ────────────────────────────────────────────────

// Crear préstamo (marca la herramienta como activo=false y registra en prestamos_herramientas)
app.post('/api/mantenimiento/herramientas/:id/prestamo', async (req, res) => {
  const id_herramienta = req.params.id;
  const { id_empleado, fecha_retorno_esperada, notas } = req.body || {};
  if (!id_empleado) return res.status(400).json({ success: false, error: 'id_empleado es requerido' });

  const client = await mantenimientoPool.connect();
  try {
    await client.query('BEGIN');

    // Verificar que la herramienta exista y esté disponible
    const check = await client.query(
      'SELECT id, activo, prestable FROM herramientas_mantenimiento WHERE id = $1',
      [id_herramienta]
    );
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Herramienta no encontrada' });
    }
    if (check.rows[0].activo === false) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'La herramienta ya está prestada' });
    }

    // Insertar registro de préstamo
    const insRes = await client.query(
      `INSERT INTO prestamos_herramientas
         (id_herramienta, id_empleado, fecha_solicitud, fecha_retorno_esperada, notas, activo)
       VALUES ($1, $2, NOW(), $3, $4, TRUE)
       RETURNING *`,
      [id_herramienta, id_empleado, fecha_retorno_esperada || null, notas || null]
    );

    // Marcar herramienta como no disponible
    await client.query(
      'UPDATE herramientas_mantenimiento SET activo = FALSE WHERE id = $1',
      [id_herramienta]
    );

    await client.query('COMMIT');
    res.json({ success: true, prestamo: insRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error al crear préstamo de herramienta:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Registrar devolución (activo=true en herramienta y fecha_retorno_real en prestamo)
app.patch('/api/mantenimiento/herramientas/:id/devolucion', async (req, res) => {
  const id_herramienta = req.params.id;
  const { evidencia_estado, evidencia_retorno, notas, fecha_retorno_real } = req.body || {};

  const client = await mantenimientoPool.connect();
  try {
    await client.query('BEGIN');

    // Cerrar el préstamo activo más reciente
    const fechaRetorno = fecha_retorno_real || new Date().toISOString().split('T')[0];
    await client.query(
      `UPDATE prestamos_herramientas
       SET activo = FALSE,
           fecha_retorno_real = $1,
           evidencia_estado   = COALESCE($2, evidencia_estado),
           evidencia_retorno  = COALESCE($3, evidencia_retorno),
           notas              = COALESCE($4, notas)
       WHERE id_herramienta = $5 AND activo = TRUE`,
      [fechaRetorno, evidencia_estado || null, evidencia_retorno || null, notas || null, id_herramienta]
    );

    // Marcar herramienta como disponible
    await client.query(
      'UPDATE herramientas_mantenimiento SET activo = TRUE WHERE id = $1',
      [id_herramienta]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error al registrar devolución:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Subir evidencia de un préstamo de herramienta (estado o retorno)
const uploadPHEvidencia = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const p = path.join(__dirname, 'uploads', 'evidencias-prestamos-herramientas');
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      cb(null, p);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `ph-evid-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo imágenes'));
    cb(null, true);
  }
});

app.post('/api/mantenimiento/prestamos-herramientas/:id/evidencia', uploadPHEvidencia.single('foto'), async (req, res) => {
  const { id } = req.params;
  const { tipo } = req.body; // 'estado' o 'retorno'
  if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió archivo' });
  if (!['estado', 'retorno'].includes(tipo)) return res.status(400).json({ success: false, error: 'Tipo inválido' });

  const col  = tipo === 'estado' ? 'evidencia_estado' : 'evidencia_retorno';
  const url  = `/uploads/evidencias-prestamos-herramientas/${req.file.filename}`;
  try {
    await mantenimientoPool.query(`UPDATE prestamos_herramientas SET ${col} = $1 WHERE id = $2`, [url, id]);
    res.json({ success: true, url });
  } catch (err) {
    logger.error('Error al guardar evidencia préstamo herramienta:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Actualizar nota de un préstamo de herramienta
app.patch('/api/mantenimiento/prestamos-herramientas/:id/notas', async (req, res) => {
  const { id }   = req.params;
  const { notas } = req.body;
  try {
    await mantenimientoPool.query('UPDATE prestamos_herramientas SET notas = $1 WHERE id = $2', [notas || null, id]);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error al guardar nota de préstamo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Listar TODOS los préstamos (con nombre de herramienta)
app.get('/api/mantenimiento/prestamos-herramientas', async (req, res) => {
  try {
    const result = await mantenimientoPool.query(
      `SELECT ph.id,
              ph.id_herramienta,
              h.nombre                                          AS herramienta_nombre,
              ph.id_empleado,
              TO_CHAR(ph.fecha_solicitud,        'DD/MM/YYYY HH24:MI') AS fecha_solicitud,
              TO_CHAR(ph.fecha_retorno_esperada, 'DD/MM/YYYY')         AS fecha_retorno_esperada,
              TO_CHAR(ph.fecha_retorno_real,     'DD/MM/YYYY')         AS fecha_retorno_real,
              ph.evidencia_estado,
              ph.evidencia_retorno,
              ph.notas,
              ph.activo
       FROM prestamos_herramientas ph
       LEFT JOIN herramientas_mantenimiento h ON h.id = ph.id_herramienta
       ORDER BY ph.fecha_solicitud DESC`
    );
    res.json({ success: true, prestamos: result.rows });
  } catch (err) {
    logger.error('Error al obtener todos los préstamos de herramientas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Listar préstamos de una herramienta
app.get('/api/mantenimiento/herramientas/:id/prestamos', async (req, res) => {
  try {
    const result = await mantenimientoPool.query(
      `SELECT ph.*, 
              TO_CHAR(ph.fecha_solicitud,        'DD/MM/YYYY HH24:MI') AS fecha_solicitud_fmt,
              TO_CHAR(ph.fecha_retorno_esperada, 'DD/MM/YYYY')          AS fecha_esperada_fmt,
              TO_CHAR(ph.fecha_retorno_real,     'DD/MM/YYYY')          AS fecha_real_fmt
       FROM prestamos_herramientas ph
       WHERE ph.id_herramienta = $1
       ORDER BY ph.fecha_solicitud DESC`,
      [req.params.id]
    );
    res.json({ success: true, prestamos: result.rows });
  } catch (err) {
    logger.error('Error al obtener préstamos de herramienta:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para marcar herramienta como prestada (activo=false) o devuelta (activo=true)
app.patch('/api/mantenimiento/herramientas/:id/activo', async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    const val = activo === true || activo === 'true';
    const result = await mantenimientoPool.query(
      'UPDATE herramientas_mantenimiento SET activo = $1 WHERE id = $2 RETURNING *',
      [val, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Herramienta no encontrada' });
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    logger.error('Error al actualizar activo de herramienta:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para actualizar columna prestable de herramienta
app.patch('/api/mantenimiento/herramientas/:id/prestable', async (req, res) => {
  const { id } = req.params;
  const { prestable } = req.body;
  try {
    const val = prestable === true || prestable === 'true';
    const result = await mantenimientoPool.query(
      'UPDATE herramientas_mantenimiento SET prestable = $1 WHERE id = $2 RETURNING *',
      [val, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Herramienta no encontrada' });
    res.json({ success: true, herramienta: result.rows[0] });
  } catch (err) {
    logger.error('Error al actualizar prestable:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/mantenimiento/herramientas/:id/foto', herramientaUploadMant.single('foto'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió archivo' });
  const fotoUrl = `/uploads/herramientas/${req.file.filename}`;
  try {
    const result = await mantenimientoPool.query(
      'UPDATE herramientas_mantenimiento SET foto = $1 WHERE id = $2 RETURNING *',
      [fotoUrl, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Herramienta no encontrada' });
    res.json({ success: true, foto: fotoUrl, herramienta: result.rows[0] });
  } catch (err) {
    logger.error('Error al guardar foto de herramienta:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para eliminar una herramienta
app.delete('/api/mantenimiento/herramientas/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Primero, verificar si la herramienta existe
    const herramientaCheck = await mantenimientoPool.query(
      'SELECT id FROM herramientas_mantenimiento WHERE id = $1',
      [id]
    );
    
    if (herramientaCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Herramienta no encontrada' });
    }
    
    // Actualizar todos los tickets que tienen esta herramienta asignada
    // Poniendo NULL en id_herramienta para evitar conflictos de clave foránea
    await mantenimientoPool.query(
      'UPDATE tickets_mantenimiento SET id_herramienta = NULL WHERE id_herramienta = $1',
      [id]
    );
    
    // Ahora eliminar la herramienta
    const result = await mantenimientoPool.query(
      'DELETE FROM herramientas_mantenimiento WHERE id = $1 RETURNING *',
      [id]
    );
    
    res.json({ 
      success: true, 
      message: 'Herramienta eliminada correctamente. Los tickets que la usaban ahora tienen la referencia en NULL.' 
    });
  } catch (err) {
    console.error('Error al eliminar herramienta:', err);
    res.status(500).json({ error: 'Error al eliminar la herramienta', details: err.message });
  }
});

// Endpoint para exportar la base de datos de mantenimiento en Excel
app.get('/api/mantenimiento/export-database', async (req, res) => {
  try {
    // Obtener todos los tickets de mantenimiento
    const ticketsResult = await mantenimientoPool.query('SELECT * FROM tickets_mantenimiento ORDER BY timestamp DESC');
    const tickets = ticketsResult.rows;

    // Obtener todas las herramientas
    const herramientasResult = await mantenimientoPool.query('SELECT * FROM herramientas_mantenimiento ORDER BY id');
    const herramientas = herramientasResult.rows;

    // Obtener todos los usuarios asignados
    let userIds = [];
    tickets.forEach(t => {
      let ids = t.assigned_user_id;
      if (!Array.isArray(ids)) {
        ids = String(ids).replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
      }
      ids = ids.flat().filter(id => typeof id === 'number' && !isNaN(id));
      t.assigned_user_id = ids;
      userIds.push(...ids);
    });
    userIds = Array.from(new Set(userIds));

    let usersMap = {};
    if (userIds.length > 0) {
      const usersResult = await apoyosPool.query(
        'SELECT id, nombre_completo FROM usuarios WHERE id = ANY($1)',
        [userIds]
      );
      usersMap = Object.fromEntries(usersResult.rows.map(u => [u.id, u.nombre_completo]));
    }

    // Agregar nombres de usuarios a los tickets
    tickets.forEach(ticket => {
      ticket.assigned_user_names = ticket.assigned_user_id.map(uid => usersMap[uid] || null);
    });

    // Crear un nuevo workbook
    const workbook = XLSX.utils.book_new();

    // === HOJA 1: TICKETS DE MANTENIMIENTO ===
    const ticketsData = tickets.map(ticket => ({
      'ID': ticket.id,
      'Nombre': ticket.name,
      'Departamento': ticket.department,
      'Área': ticket.area || 'N/A',
      'Problema': ticket.issue,
      'Urgencia': ticket.urgency,
      'Estado': ticket.urgency === 'completed' ? 'Completado' : 'Pendiente',
      'Fecha Creación': new Date(ticket.timestamp).toLocaleString('es-ES'),
      'Fecha Finalización': ticket.time_end ? new Date(ticket.time_end).toLocaleString('es-ES') : 'N/A',
      'Tiempo Resolución (horas)': ticket.time_end ? 
        Math.round((new Date(ticket.time_end) - new Date(ticket.timestamp)) / (1000 * 60 * 60) * 100) / 100 : 'N/A',
      'Usuarios Asignados': ticket.assigned_user_names.filter(Boolean).join(', ') || 'Sin asignar',
      'AnyDesk': ticket.anydesk || 'N/A',
      'Email': ticket.email || 'N/A',
      'Imagen': ticket.image_path ? 'Sí' : 'No',
      'Mantenimiento Preventivo': ticket.mantenimiento_preventivo ? 'Sí' : 'No',
      'Mantenimiento Correctivo': ticket.mantenimiento_correctivo ? 'Sí' : 'No',
      'Mecánica': ticket.mecanica ? 'Sí' : 'No',
      'Implementaciones': ticket.implementaciones ? 'Sí' : 'No',
      'Herramienta ID': ticket.id_herramienta || 'N/A'
    }));

    const ticketsSheet = XLSX.utils.json_to_sheet(ticketsData);
    
    // Ajustar ancho de columnas para tickets
    const ticketsColWidths = [
      { wch: 8 },   // ID
      { wch: 25 },  // Nombre
      { wch: 20 },  // Departamento
      { wch: 15 },  // Área
      { wch: 40 },  // Problema
      { wch: 12 },  // Urgencia
      { wch: 12 },  // Estado
      { wch: 20 },  // Fecha Creación
      { wch: 20 },  // Fecha Finalización
      { wch: 15 },  // Tiempo Resolución
      { wch: 30 },  // Usuarios Asignados
      { wch: 15 },  // AnyDesk
      { wch: 25 },  // Email
      { wch: 8 },   // Imagen
      { wch: 15 },  // Mantenimiento Preventivo
      { wch: 15 },  // Mantenimiento Correctivo
      { wch: 10 },  // Mecánica
      { wch: 15 },  // Implementaciones
      { wch: 12 }   // Herramienta ID
    ];
    ticketsSheet['!cols'] = ticketsColWidths;

    XLSX.utils.book_append_sheet(workbook, ticketsSheet, 'Tickets de Mantenimiento');

    // === HOJA 2: HERRAMIENTAS ===
    const herramientasData = herramientas.map(herramienta => ({
      'ID': herramienta.id,
      'Nombre': herramienta.nombre,
      'Departamento': herramienta.department || 'Sin asignar',
      'Fecha Creación': new Date(herramienta.created_at).toLocaleString('es-ES')
    }));

    const herramientasSheet = XLSX.utils.json_to_sheet(herramientasData);
    
    // Ajustar ancho de columnas para herramientas
    const herramientasColWidths = [
      { wch: 8 },   // ID
      { wch: 30 },  // Nombre
      { wch: 20 },  // Departamento
      { wch: 20 }   // Fecha Creación
    ];
    herramientasSheet['!cols'] = herramientasColWidths;

    XLSX.utils.book_append_sheet(workbook, herramientasSheet, 'Herramientas');

    // === HOJA 3: USUARIOS ASIGNADOS ===
    const usuariosData = Object.entries(usersMap).map(([id, nombre]) => ({
      'ID': parseInt(id),
      'Nombre Completo': nombre,
      'Tickets Asignados': tickets.filter(t => t.assigned_user_id.includes(parseInt(id))).length
    }));

    const usuariosSheet = XLSX.utils.json_to_sheet(usuariosData);
    
    // Ajustar ancho de columnas para usuarios
    const usuariosColWidths = [
      { wch: 8 },   // ID
      { wch: 30 },  // Nombre Completo
      { wch: 15 }   // Tickets Asignados
    ];
    usuariosSheet['!cols'] = usuariosColWidths;

    XLSX.utils.book_append_sheet(workbook, usuariosSheet, 'Usuarios Asignados');

    // === HOJA 4: RESUMEN ESTADÍSTICO ===
    const resumenData = [
      { 'Métrica': 'Total de Tickets', 'Valor': tickets.length },
      { 'Métrica': 'Tickets Completados', 'Valor': tickets.filter(t => t.urgency === 'completed').length },
      { 'Métrica': 'Tickets Pendientes', 'Valor': tickets.filter(t => t.urgency !== 'completed').length },
      { 'Métrica': 'Tickets Críticos', 'Valor': tickets.filter(t => t.urgency === 'critical').length },
      { 'Métrica': 'Tickets Medios', 'Valor': tickets.filter(t => t.urgency === 'medium').length },
      { 'Métrica': 'Tickets Bajos', 'Valor': tickets.filter(t => t.urgency === 'low').length },
      { 'Métrica': 'Total de Herramientas', 'Valor': herramientas.length },
      { 'Métrica': 'Total de Usuarios Asignados', 'Valor': Object.keys(usersMap).length },
      { 'Métrica': 'Tiempo Promedio de Resolución (horas)', 'Valor': 
        tickets.filter(t => t.time_end).length > 0 ? 
        Math.round(tickets.filter(t => t.time_end).reduce((acc, t) => 
          acc + (new Date(t.time_end) - new Date(t.timestamp)) / (1000 * 60 * 60), 0) / 
          tickets.filter(t => t.time_end).length * 100) / 100 : 'N/A'
      },
      { 'Métrica': 'Fecha de Exportación', 'Valor': new Date().toLocaleString('es-ES') }
    ];

    const resumenSheet = XLSX.utils.json_to_sheet(resumenData);
    
    // Ajustar ancho de columnas para resumen
    const resumenColWidths = [
      { wch: 35 },  // Métrica
      { wch: 20 }   // Valor
    ];
    resumenSheet['!cols'] = resumenColWidths;

    XLSX.utils.book_append_sheet(workbook, resumenSheet, 'Resumen Estadístico');

    // Generar el archivo Excel
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Configurar headers para descarga
    const fileName = `tickets_mantenimiento_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    
    res.send(excelBuffer);
  } catch (error) {
    console.error('Error al exportar la base de datos:', error);
    res.status(500).json({ error: 'Error al exportar la base de datos', details: error.message });
  }
});

// Ruta para asignar un ticket a un usuario
app.patch('/api/tickets/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { assigned_user_id } = req.body;
        
        if (!assigned_user_id) {
            return res.status(400).json({ error: 'ID de usuario asignado es requerido' });
        }

        // Verificar que el ticket existe
        const ticketResult = await phoenixPool.query(
            'SELECT * FROM tickets WHERE id = $1',
            [id]
        );

        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        // Verificar que el usuario asignado existe y es de IT
        const userResult = await apoyosPool.query(
            'SELECT id, nombre_completo FROM usuarios WHERE id = $1 AND rol = $2 AND activo = true',
            [assigned_user_id, 'IT']
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario de IT no encontrado' });
        }

        // Actualizar el ticket con el usuario asignado
        const updateResult = await phoenixPool.query(
            'UPDATE tickets SET assigned_user_id = $1, assigned_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            [assigned_user_id, id]
        );

        res.json({
            success: true,
            ticket: updateResult.rows[0],
            assigned_user: userResult.rows[0]
        });
    } catch (error) {
        console.error('Error al asignar ticket:', error);
        res.status(500).json({ 
            error: 'Error al asignar el ticket',
            message: error.message
        });
  }
});

// Ruta para obtener el color favorito del usuario
app.get('/api/usuario/favorite-color/:userId', async (req, res) => {
    const { userId } = req.params;
    
    if (!userId) {
        return res.status(400).json({ 
            error: 'Faltan datos',
            message: 'Se requiere userId'
        });
    }

    try {
        // Obtener el color favorito del usuario
        const result = await apoyosPool.query(
            'SELECT favorite_color FROM usuarios WHERE id = $1 AND activo = true',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Usuario no encontrado',
                message: 'El usuario especificado no existe o está inactivo'
            });
        }

        const favoriteColor = result.rows[0].favorite_color;
        
        res.json({ 
            success: true, 
            color: favoriteColor,
            message: favoriteColor ? 'Color favorito encontrado' : 'No hay color favorito configurado'
        });
    } catch (err) {
        console.error('Error obteniendo color favorito:', err);
        res.status(500).json({ 
            error: 'Error en el servidor',
            message: 'Error al obtener el color favorito'
        });
    }
});

// Ruta para actualizar el color favorito del usuario
app.post('/api/usuario/favorite-color', async (req, res) => {
    const { userId, color } = req.body;
    
    if (!userId || !color) {
        return res.status(400).json({ 
            error: 'Faltan datos',
            message: 'Se requiere userId y color'
        });
    }

    try {
        // Verificar que el usuario existe
        const userCheck = await apoyosPool.query(
            'SELECT id FROM usuarios WHERE id = $1 AND activo = true',
            [userId]
        );

        if (userCheck.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Usuario no encontrado',
                message: 'El usuario especificado no existe o está inactivo'
            });
        }

        // Actualizar el color favorito del usuario
        await apoyosPool.query(
            'UPDATE usuarios SET favorite_color = $1 WHERE id = $2',
            [color, userId]
        );
        res.json({ 
            success: true, 
            color: color,
            message: 'Color favorito actualizado correctamente'
        });
    } catch (err) {
        console.error('Error actualizando color favorito:', err);
        res.status(500).json({ 
            error: 'Error en el servidor',
            message: 'Error al actualizar el color favorito'
        });
    }
});

// Obtener todos los usuarios de mantenimiento desde apoyos_db
app.get('/api/mantenimiento/usuarios', async (req, res) => {
  try {
    const result = await apoyosPool.query(
      "SELECT id, username, nombre_completo AS nombre FROM usuarios WHERE rol ILIKE 'mantenimiento' ORDER BY nombre_completo ASC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios de mantenimiento:', error);
    res.status(500).json({ error: 'Error al obtener los usuarios de mantenimiento' });
  }
});

app.patch('/api/mantenimiento/tickets/:id/asignar-usuario', async (req, res) => {
  try {
    const { id } = req.params;
    let { assigned_user_id } = req.body;
    if (!assigned_user_id || !Array.isArray(assigned_user_id)) {
      return res.status(400).json({ error: 'ID de usuario asignado es requerido (como array)' });
    }

    // Verificar que el ticket existe
    const ticketResult = await mantenimientoPool.query(
      'SELECT * FROM tickets_mantenimiento WHERE id = $1',
      [id]
    );
    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket de mantenimiento no encontrado' });
    }

    // Convertir todos los IDs recibidos a números y filtrar nulos
    let newAssigned = assigned_user_id.map(uid => parseInt(uid)).filter(id => !isNaN(id));
    // Eliminar duplicados
    newAssigned = [...new Set(newAssigned)];

    // Actualizar el ticket con el array de usuarios asignados (reemplaza el campo)
    const updateResult = await mantenimientoPool.query(
      'UPDATE tickets_mantenimiento SET assigned_user_id = $1, assigned_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [newAssigned, id]
    );

    // Obtener los nombres de todos los usuarios asignados
    let assignedUsers = [];
    if (newAssigned.length > 0) {
      const usersResult = await apoyosPool.query(
        `SELECT id, nombre_completo FROM usuarios WHERE id = ANY($1)`,
        [newAssigned]
      );
      assignedUsers = usersResult.rows;
    }

    res.json({
      success: true,
      ticket: updateResult.rows[0],
      assigned_users: assignedUsers
    });
  } catch (error) {
    console.error('Error al asignar ticket de mantenimiento:', error);
    res.status(500).json({
      error: 'Error al asignar el ticket de mantenimiento',
      message: error.message
        });
    }
});

// Endpoint para obtener el inventario de IT de un empleado (usa inventario_it)
app.get('/api/inventario_it/:id_empleado', async (req, res) => {
  const id = req.params.id_empleado;
  try {
    const hardwareResult = await inventarioPool.query(
      'SELECT * FROM hardware WHERE id_empleado = $1',
      [id]
    );
    const softwareResult = await inventarioPool.query(
      'SELECT * FROM software WHERE id_empleado = $1',
      [id]
    );
    res.json({
      hardware: hardwareResult.rows,
      software: softwareResult.rows
    });
  } catch (err) {
    console.error('Error consultando inventario IT:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Ruta para agregar software
app.post('/api/software', async (req, res) => {
  const { id_empleado, nombre, version, licencia, estado, caducidad, contrasenia } = req.body;
  if (!id_empleado || !nombre || !version || !licencia || !estado) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  try {
    const result = await inventarioPool.query(
      'INSERT INTO software (id_empleado, nombre, version, licencia, estado, caducidad, contrasenia) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [id_empleado, nombre, version, licencia, estado, caducidad || null, contrasenia || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al insertar software:', err);
    res.status(500).json({ error: 'Error al insertar software' });
  }
});

// Ruta para agregar hardware
app.post('/api/hardware', async (req, res) => {
  const { id_empleado, tipo, modelo, capacidad, procesador, estado, contrasenia, serie } = req.body;
  if (!id_empleado || !tipo || !modelo || !capacidad || !procesador || !estado) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  try {
    const result = await inventarioPool.query(
      'INSERT INTO hardware (id_empleado, tipo, modelo, capacidad, procesador, estado, contrasenia, serie) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [id_empleado, tipo, modelo, capacidad, procesador, estado, contrasenia || null, serie || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al insertar hardware:', err);
    res.status(500).json({ error: 'Error al insertar hardware' });
  }
});

// Endpoint para actualizar software por id_software
app.put('/api/software/:id_software', async (req, res) => {
  const { id_software } = req.params;
  const { nombre, version, licencia, estado, caducidad, contrasenia } = req.body;
  if (!id_software) {
    return res.status(400).json({ error: 'Falta el id_software' });
  }
  try {
    const result = await inventarioPool.query(
      'UPDATE software SET nombre = $1, version = $2, licencia = $3, estado = $4, caducidad = $5, contrasenia = $6 WHERE id_software = $7 RETURNING *',
      [nombre, version, licencia, estado, caducidad, contrasenia, id_software]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Software no encontrado' });
    }
    res.json({ success: true, software: result.rows[0] });
  } catch (err) {
    console.error('Error actualizando software:', err);
    res.status(500).json({ error: 'Error al actualizar software' });
  }
});

// Endpoint para actualizar hardware por id_hardware
app.put('/api/hardware/:id_hardware', async (req, res) => {
  const { id_hardware } = req.params;
  const { tipo, modelo, capacidad, procesador, estado, contrasenia, serie } = req.body;
  if (!id_hardware) {
    return res.status(400).json({ error: 'Falta el id_hardware' });
  }
  try {
    const result = await inventarioPool.query(
      'UPDATE hardware SET tipo = $1, modelo = $2, capacidad = $3, procesador = $4, estado = $5, contrasenia = $6, serie = $7 WHERE id_hardware = $8 RETURNING *',
      [tipo, modelo, capacidad, procesador, estado, contrasenia, serie, id_hardware]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Hardware no encontrado' });
    }
    res.json({ success: true, hardware: result.rows[0] });
  } catch (err) {
    console.error('Error al actualizar hardware:', err);
    res.status(500).json({ error: 'Error al actualizar hardware' });
  }
});

// Cambiar el dueño de un hardware
app.put('/api/hardware/:id_hardware/cambiar_dueno', async (req, res) => {
  const { id_hardware } = req.params;
  const { id_empleado } = req.body;

  if (!id_hardware || !id_empleado) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const result = await inventarioPool.query(
      'UPDATE hardware SET id_empleado = $1 WHERE id_hardware = $2 RETURNING *',
      [id_empleado, id_hardware]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Hardware no encontrado' });
    }
    res.json({ success: true, hardware: result.rows[0] });
  } catch (err) {
    console.error('Error al cambiar el dueño del hardware:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Endpoint para guardar solicitudes de vacaciones
app.post('/api/vacaciones/solicitar', async (req, res) => {
    try {
        const {
            empleado_id,
            fecha_inicio,
            fecha_fin,
            dias_solicitados
        } = req.body;

        // Validar campos requeridos
        if (!empleado_id || !fecha_inicio || !fecha_fin || !dias_solicitados) {
            return res.status(400).json({
                error: 'Faltan campos requeridos',
                message: 'Se requieren empleado_id, fecha_inicio, fecha_fin y dias_solicitados'
            });
        }

        // Verificar que el empleado existe y obtener su información
        const empleadoResult = await apoyosPool.query(
            'SELECT id, nombre_completo, fecha_ingreso FROM empleados WHERE id = $1',
            [empleado_id]
        );

        if (empleadoResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Empleado no encontrado',
                message: 'El empleado especificado no existe'
            });
        }

        const empleado = empleadoResult.rows[0];

        const fechaInicioSolicitud = new Date(fecha_inicio);
        if (Number.isNaN(fechaInicioSolicitud.getTime())) {
          return res.status(400).json({
            error: 'Fecha de inicio inválida',
            message: 'La fecha de inicio no tiene un formato válido'
          });
        }

        const diasSolicitadosActuales = parseInt(dias_solicitados, 10);
        if (!Number.isFinite(diasSolicitadosActuales) || diasSolicitadosActuales <= 0) {
          return res.status(400).json({
            error: 'Días solicitados inválidos',
            message: 'Los días solicitados deben ser un número mayor a 0'
          });
        }

        // Calcular años laborados y días correspondientes tomando como referencia la fecha de inicio solicitada
        let aniosLaborados = 0;
        let diasCorrespondientes = 0;
        let inicioCiclo = null;
        let finCiclo = null;
        
        if (empleado.fecha_ingreso) {
            const fechaIngreso = new Date(empleado.fecha_ingreso);
          const referencia = new Date(fechaInicioSolicitud.getFullYear(), fechaInicioSolicitud.getMonth(), fechaInicioSolicitud.getDate());
            
          const aniosCompletados = referencia.getFullYear() - fechaIngreso.getFullYear();
          const mesActual = referencia.getMonth();
            const mesIngreso = fechaIngreso.getMonth();
          const diaActual = referencia.getDate();
            const diaIngreso = fechaIngreso.getDate();
            
          // Ajustar años si aún no ha llegado el aniversario para la fecha de inicio solicitada
            aniosLaborados = (mesActual < mesIngreso) || 
                             (mesActual === mesIngreso && diaActual < diaIngreso) 
                             ? aniosCompletados - 1 : aniosCompletados;
            
            // Calcular días de vacaciones según años laborados
            if (aniosLaborados < 1) diasCorrespondientes = 0;
            else if (aniosLaborados === 1) diasCorrespondientes = 12;
            else if (aniosLaborados === 2) diasCorrespondientes = 14;
            else if (aniosLaborados === 3) diasCorrespondientes = 16;
            else if (aniosLaborados === 4) diasCorrespondientes = 18;
            else if (aniosLaborados === 5) diasCorrespondientes = 20;
            else if (aniosLaborados >= 6 && aniosLaborados <= 10) diasCorrespondientes = 22;
            else if (aniosLaborados >= 11 && aniosLaborados <= 15) diasCorrespondientes = 24;
            else if (aniosLaborados >= 16 && aniosLaborados <= 20) diasCorrespondientes = 26;
            else if (aniosLaborados >= 21 && aniosLaborados <= 25) diasCorrespondientes = 28;
            else if (aniosLaborados >= 26 && aniosLaborados <= 30) diasCorrespondientes = 30;
            else if (aniosLaborados >= 31 && aniosLaborados <= 35) diasCorrespondientes = 32;
            else diasCorrespondientes = 32;

            // Determinar ciclo del aniversario para la fecha solicitada: [inicioCiclo, finCiclo)
            inicioCiclo = new Date(referencia.getFullYear(), mesIngreso, diaIngreso);
            if (referencia < inicioCiclo) {
              inicioCiclo.setFullYear(inicioCiclo.getFullYear() - 1);
            }
            finCiclo = new Date(inicioCiclo.getFullYear() + 1, mesIngreso, diaIngreso);
        }

          if (aniosLaborados < 1 || diasCorrespondientes <= 0) {
            return res.status(400).json({
              error: 'No puedes solicitar vacaciones',
              message: 'Necesitas tener al menos 1 año de servicio para solicitar vacaciones.'
            });
          }

          // Obtener solicitudes del mismo ciclo para calcular disponibilidad real de ese periodo
        const solicitudesPrevias = await apoyosPool.query(
            `SELECT dias_solicitados
               FROM solicitudes_vacaciones
              WHERE empleado_id = $1
              AND fecha_inicio >= $2
              AND fecha_inicio < $3
              AND COALESCE(LOWER(estado), '') <> 'cancelada'
              ORDER BY fecha_inicio ASC`,
            [empleado_id, inicioCiclo.toISOString().split('T')[0], finCiclo.toISOString().split('T')[0]]
        );
        
          // Sumar días ya solicitados dentro del ciclo objetivo
        const totalDiasSolicitados = solicitudesPrevias.rows.reduce((total, solicitud) => {
            return total + (parseInt(solicitud.dias_solicitados) || 0);
        }, 0);

          const diasDisponiblesCiclo = Math.max(0, diasCorrespondientes - totalDiasSolicitados);
          if (diasSolicitadosActuales > diasDisponiblesCiclo) {
            return res.status(400).json({
              error: 'No puedes solicitar vacaciones',
              message: `Has agotado todos tus días de vacaciones del ciclo seleccionado. Días disponibles: ${diasDisponiblesCiclo}.`,
              dias_disponibles_ciclo: diasDisponiblesCiclo,
              inicio_ciclo: inicioCiclo.toISOString().split('T')[0],
              fin_ciclo: finCiclo.toISOString().split('T')[0]
            });
          }
        
          // Calcular días pendientes del ciclo después de esta solicitud
          const diasPendientes = Math.max(0, diasDisponiblesCiclo - diasSolicitadosActuales);

        // Insertar la solicitud de vacaciones con los días pendientes
        const result = await apoyosPool.query(
            `INSERT INTO solicitudes_vacaciones 
             (empleado_id, fecha_inicio, fecha_fin, dias_solicitados, dias_pendientes, estado)
             VALUES ($1, $2, $3, $4, $5, 'pendiente')
             RETURNING *`,
            [empleado_id, fecha_inicio, fecha_fin, diasSolicitadosActuales, diasPendientes.toString()]
        );
        res.status(201).json({
            success: true,
            message: 'Solicitud de vacaciones enviada exitosamente',
            solicitud: result.rows[0],
            dias_correspondientes: diasCorrespondientes,
            dias_pendientes: diasPendientes
        });

    } catch (error) {
        console.error('Error al crear solicitud de vacaciones:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Endpoint para obtener solicitudes de vacaciones de un empleado
app.get('/api/vacaciones/empleado/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await apoyosPool.query(
            `SELECT sv.*, e.nombre_completo, e.puesto, e.fecha_ingreso
             FROM solicitudes_vacaciones sv
             JOIN empleados e ON sv.empleado_id = e.id
             WHERE sv.empleado_id = $1
             ORDER BY sv.fecha_solicitud DESC`,
            [id]
        );

        // Calcular días correspondientes una sola vez
        let diasCorrespondientes = 0;
        if (result.rows.length > 0 && result.rows[0].fecha_ingreso) {
            const fechaIngreso = new Date(result.rows[0].fecha_ingreso);
            const hoy = new Date();
            
            const aniosCompletados = hoy.getFullYear() - fechaIngreso.getFullYear();
            const mesActual = hoy.getMonth();
            const mesIngreso = fechaIngreso.getMonth();
            const diaActual = hoy.getDate();
            const diaIngreso = fechaIngreso.getDate();
            
            const aniosLaborados = (mesActual < mesIngreso) || 
                                 (mesActual === mesIngreso && diaActual < diaIngreso) 
                                 ? aniosCompletados - 1 : aniosCompletados;
            
            // Calcular días de vacaciones según años laborados
            if (aniosLaborados < 1) diasCorrespondientes = 0;
            else if (aniosLaborados === 1) diasCorrespondientes = 12;
            else if (aniosLaborados === 2) diasCorrespondientes = 14;
            else if (aniosLaborados === 3) diasCorrespondientes = 16;
            else if (aniosLaborados === 4) diasCorrespondientes = 18;
            else if (aniosLaborados === 5) diasCorrespondientes = 20;
            else if (aniosLaborados >= 6 && aniosLaborados <= 10) diasCorrespondientes = 22;
            else if (aniosLaborados >= 11 && aniosLaborados <= 15) diasCorrespondientes = 24;
            else if (aniosLaborados >= 16 && aniosLaborados <= 20) diasCorrespondientes = 26;
            else if (aniosLaborados >= 21 && aniosLaborados <= 25) diasCorrespondientes = 28;
            else if (aniosLaborados >= 26 && aniosLaborados <= 30) diasCorrespondientes = 30;
            else if (aniosLaborados >= 31 && aniosLaborados <= 35) diasCorrespondientes = 32;
            else diasCorrespondientes = 32;
        }

        // Ordenar solicitudes por fecha de inicio para cálculo acumulativo
        const solicitudesOrdenadas = result.rows.sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));
        
        // Calcular días pendientes acumulativamente para cada solicitud
        let totalDiasSolicitados = 0;
        const solicitudesConCalculos = solicitudesOrdenadas.map(solicitud => {
            const diasSolicitados = parseInt(solicitud.dias_solicitados) || 0;
            totalDiasSolicitados += diasSolicitados;
            
            // Los días pendientes son: total disponible - total ya solicitado hasta esta solicitud
            const diasPendientes = Math.max(0, diasCorrespondientes - totalDiasSolicitados);
            
            return {
                ...solicitud,
                dias_correspondientes: diasCorrespondientes,
                dias_pendientes: diasPendientes
            };
        });

        res.json(solicitudesConCalculos);
    } catch (error) {
        console.error('Error al obtener solicitudes de vacaciones:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Endpoint para obtener todas las solicitudes de vacaciones (para administradores)
app.get('/api/vacaciones/todas', async (req, res) => {
    try {
        const result = await apoyosPool.query(
            `SELECT sv.*, e.nombre_completo, e.puesto, e.supervisor
             FROM solicitudes_vacaciones sv
             JOIN empleados e ON sv.empleado_id = e.id
             ORDER BY sv.fecha_solicitud DESC`
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener todas las solicitudes de vacaciones:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Endpoint para actualizar el estado de una solicitud de vacaciones
app.put('/api/vacaciones/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, motivo_rechazo, aprobado_por } = req.body;

        // Validar estado
        const estadosValidos = ['pendiente', 'aprobada', 'aplazada', 'cancelada'];
        if (!estadosValidos.includes(estado)) {
            return res.status(400).json({
                error: 'Estado inválido',
                message: 'El estado debe ser: pendiente, aprobada, aplazada o cancelada'
            });
        }

        let query = `
            UPDATE solicitudes_vacaciones 
            SET estado = $1, fecha_aprobacion = CURRENT_TIMESTAMP
        `;
        let params = [estado, id];

        if (motivo_rechazo) {
            query = query.replace('fecha_aprobacion = CURRENT_TIMESTAMP', 
                                'fecha_aprobacion = CURRENT_TIMESTAMP, motivo_rechazo = $3');
            params = [estado, id, motivo_rechazo];
        }

        if (aprobado_por) {
            query = query.replace('fecha_aprobacion = CURRENT_TIMESTAMP', 
                                'fecha_aprobacion = CURRENT_TIMESTAMP, aprobado_por = $' + (params.length + 1));
            params.push(aprobado_por);
        }

        query += ' WHERE id = $2 RETURNING *';

        const result = await apoyosPool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Solicitud no encontrada',
                message: 'La solicitud de vacaciones especificada no existe'
            });
        }

        res.json({
            success: true,
            message: 'Estado de solicitud actualizado exitosamente',
            solicitud: result.rows[0]
        });

    } catch (error) {
        console.error('Error al actualizar estado de solicitud:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Actualizar una solicitud de vacaciones (fechas, días, estado, comentarios)
app.put('/api/vacaciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            fecha_inicio,
            fecha_fin,
            dias_solicitados,
            estado,
            comentarios
        } = req.body || {};

        const setParts = [];
        const params = [];

        if (fecha_inicio) { setParts.push(`fecha_inicio = $${setParts.length + 1}`); params.push(fecha_inicio); }
        if (fecha_fin) { setParts.push(`fecha_fin = $${setParts.length + 1}`); params.push(fecha_fin); }
        if (typeof dias_solicitados !== 'undefined' && dias_solicitados !== null) { setParts.push(`dias_solicitados = $${setParts.length + 1}`); params.push(dias_solicitados); }
        if (estado) { setParts.push(`estado = $${setParts.length + 1}`); params.push(estado); }
        if (typeof comentarios !== 'undefined') { setParts.push(`comentarios = $${setParts.length + 1}`); params.push(comentarios); }

        if (setParts.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        const query = `UPDATE solicitudes_vacaciones SET ${setParts.join(', ')} WHERE id = $${setParts.length + 1} RETURNING *`;
        params.push(id);

        const result = await apoyosPool.query(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        res.json({ success: true, solicitud: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar solicitud de vacaciones:', error);
        res.status(500).json({ error: 'Error interno del servidor', message: error.message });
    }
});

// Endpoint para crear solicitudes de vacaciones (nueva ruta para RH)
app.post('/api/vacaciones', async (req, res) => {
    try {
        const {
            empleado_id,
            fecha_inicio,
            fecha_fin,
            dias_solicitados,
            dias_correspondientes,
            supervisor,
            motivo,
            estado,
            aprobado_por,
            fecha_solicitud,
            override_rh
        } = req.body;

        // Validar campos requeridos
        if (!empleado_id || !fecha_inicio || !fecha_fin || !dias_solicitados) {
            return res.status(400).json({
                error: 'Faltan campos requeridos',
                message: 'Se requieren empleado_id, fecha_inicio, fecha_fin y dias_solicitados'
            });
        }

        // Verificar que el empleado existe
        const empleadoResult = await apoyosPool.query(
            'SELECT id, nombre_completo, fecha_ingreso, supervisor FROM empleados WHERE id = $1',
            [empleado_id]
        );

        if (empleadoResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Empleado no encontrado',
                message: 'El empleado especificado no existe'
            });
        }

        const empleado = empleadoResult.rows[0];

        // Calcular días correspondientes si no se proporcionan
        let diasCorrespondientes = dias_correspondientes;
        if (!diasCorrespondientes && empleado.fecha_ingreso) {
            const fechaIngreso = new Date(empleado.fecha_ingreso);
            const hoy = new Date();
            
            const aniosCompletados = hoy.getFullYear() - fechaIngreso.getFullYear();
            const mesActual = hoy.getMonth();
            const mesIngreso = fechaIngreso.getMonth();
            const diaActual = hoy.getDate();
            const diaIngreso = fechaIngreso.getDate();
            
            const aniosLaborados = (mesActual < mesIngreso) || 
                                 (mesActual === mesIngreso && diaActual < diaIngreso) 
                                 ? aniosCompletados - 1 : aniosCompletados;
            
            // Calcular días de vacaciones según años laborados
            if (aniosLaborados < 1) diasCorrespondientes = 0;
            else if (aniosLaborados === 1) diasCorrespondientes = 12;
            else if (aniosLaborados === 2) diasCorrespondientes = 14;
            else if (aniosLaborados === 3) diasCorrespondientes = 16;
            else if (aniosLaborados === 4) diasCorrespondientes = 18;
            else if (aniosLaborados === 5) diasCorrespondientes = 20;
            else if (aniosLaborados >= 6 && aniosLaborados <= 10) diasCorrespondientes = 22;
            else if (aniosLaborados >= 11 && aniosLaborados <= 15) diasCorrespondientes = 24;
            else if (aniosLaborados >= 16 && aniosLaborados <= 20) diasCorrespondientes = 26;
            else if (aniosLaborados >= 21 && aniosLaborados <= 25) diasCorrespondientes = 28;
            else if (aniosLaborados >= 26 && aniosLaborados <= 30) diasCorrespondientes = 30;
            else if (aniosLaborados >= 31 && aniosLaborados <= 35) diasCorrespondientes = 32;
            else diasCorrespondientes = 32;
        }

        // Calcular días pendientes acumulativamente
        // Obtener todas las solicitudes previas del empleado
        const solicitudesPrevias = await apoyosPool.query(
            'SELECT dias_solicitados FROM solicitudes_vacaciones WHERE empleado_id = $1 ORDER BY fecha_inicio ASC',
            [empleado_id]
        );
        
        // Sumar todos los días ya solicitados
        const totalDiasSolicitados = solicitudesPrevias.rows.reduce((total, solicitud) => {
            return total + (parseInt(solicitud.dias_solicitados) || 0);
        }, 0);
        
        // Calcular días pendientes: total disponible - total ya solicitado - días de esta solicitud
        const diasPendientes = Math.max(0, diasCorrespondientes - totalDiasSolicitados - dias_solicitados);
        
        // VALIDACIÓN: Si los días pendientes serían 0, verificar si ya pasó el aniversario
        // Permitir override para RH cuando se envíe override_rh = true
        if (!override_rh && diasPendientes === 0 && totalDiasSolicitados > 0) {
            // Verificar si ya pasó el aniversario desde la última solicitud
            const hoy = new Date();
            const fechaIngreso = new Date(empleado.fecha_ingreso);
            
            // Calcular el próximo aniversario
            const proximoAniversario = new Date(hoy.getFullYear(), fechaIngreso.getMonth(), fechaIngreso.getDate());
            if (hoy >= proximoAniversario) {
                proximoAniversario.setFullYear(proximoAniversario.getFullYear() + 1);
            }
            
            // Si no ha pasado el aniversario, rechazar la solicitud
            if (hoy < proximoAniversario) {
                const diasHastaAniversario = Math.ceil((proximoAniversario - hoy) / (1000 * 60 * 60 * 24));
                return res.status(400).json({
                    error: 'No puedes solicitar vacaciones',
                    message: `El empleado ha agotado todos sus días de vacaciones. Debe esperar hasta su próximo aniversario (${proximoAniversario.toLocaleDateString('es-ES')}) para solicitar más vacaciones. Faltan ${diasHastaAniversario} días.`,
                    proximo_aniversario: proximoAniversario.toISOString().split('T')[0],
                    dias_hasta_aniversario: diasHastaAniversario
                });
            }
        }

        // Insertar la solicitud de vacaciones usando solo los campos que existen en la tabla
        const result = await apoyosPool.query(
            `INSERT INTO solicitudes_vacaciones 
             (empleado_id, fecha_inicio, fecha_fin, dias_solicitados, dias_pendientes, 
              estado, comentarios)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                empleado_id, 
                fecha_inicio, 
                fecha_fin, 
                dias_solicitados, 
                diasPendientes,
                estado || 'pendiente',
                motivo || 'Solicitud realizada por RH' // Usar el campo comentarios
            ]
        );
        res.status(201).json({
            success: true,
            message: 'Solicitud de vacaciones creada exitosamente',
            solicitud: result.rows[0],
            dias_correspondientes: diasCorrespondientes,
            dias_pendientes: diasPendientes
        });

    } catch (error) {
        console.error('Error al crear solicitud de vacaciones por RH:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Obtener todos los eventos del calendario
app.get('/api/calendario/eventos', async (req, res) => {
    try {
        const result = await apoyosPool.query(
            `SELECT * FROM calendario_eventos 
             ORDER BY fecha_evento ASC, hora_inicio ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener eventos del calendario:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Crear nuevo evento
app.post('/api/calendario/eventos', async (req, res) => {
    try {
        const {
            titulo,
            descripcion,
            fecha_evento,
            hora_inicio,
            hora_fin,
            prioridad,
            usuario_creador,
            departamento,
            color_evento
        } = req.body;

        if (!titulo || !fecha_evento) {
            return res.status(400).json({
                error: 'Campos requeridos faltantes',
                message: 'Título y fecha_evento son obligatorios'
            });
        }  
        const eventoId = randomUUID();
        const result = await apoyosPool.query(
            `INSERT INTO calendario_eventos 
             (id, titulo, descripcion, fecha_evento, hora_inicio, hora_fin, prioridad, usuario_creador, departamento, color_evento)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                eventoId,
                titulo,
                descripcion || null,
                fecha_evento,
                hora_inicio || null,
                hora_fin || null,
                prioridad || 'normal',
                usuario_creador || 'IT Admin',
                departamento || 'IT',
                color_evento || '#ffc107'
            ]
        );

        res.json({
            success: true,
            message: 'Evento creado exitosamente',
            evento: result.rows[0]
        });

    } catch (error) {
        console.error('Error al crear evento:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Actualizar evento
app.put('/api/calendario/eventos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            titulo,
            descripcion,
            fecha_evento,
            hora_inicio,
            hora_fin,
            prioridad,
            completado,
            aplazado_a_fecha
        } = req.body;

        if (!titulo || !fecha_evento) {
            return res.status(400).json({
                error: 'Campos requeridos faltantes',
                message: 'Título y fecha_evento son obligatorios'
            });
        }

        const result = await apoyosPool.query(
            `UPDATE calendario_eventos 
             SET titulo = $1, descripcion = $2, fecha_evento = $3, 
                 hora_inicio = $4, hora_fin = $5, prioridad = $6, completado = $7, 
                 fecha_completado = CASE WHEN $7 = true THEN CURRENT_TIMESTAMP ELSE NULL END,
                 fecha_aplazamiento = $8
             WHERE id = $9
             RETURNING *`,
            [
                titulo,
                descripcion || null,
                fecha_evento,
                hora_inicio || null,
                hora_fin || null,
                prioridad || 'normal',
                completado === undefined ? false : completado,
                aplazado_a_fecha || null,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Evento no encontrado',
                message: 'El evento especificado no existe'
            });
        }

        res.json({
            success: true,
            message: 'Evento actualizado exitosamente',
            evento: result.rows[0]
        });

    } catch (error) {
        console.error('Error al actualizar evento:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Marcar evento como completado
app.put('/api/calendario/eventos/:id/completar', async (req, res) => {
    try {
        const { id } = req.params;
        const { completado } = req.body;

        const result = await apoyosPool.query(
            `UPDATE calendario_eventos 
             SET completado = $1, 
                 fecha_completado = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE NULL END
             WHERE id = $2
             RETURNING *`,
            [completado, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Evento no encontrado',
                message: 'El evento especificado no existe'
            });
        }

        res.json({
            success: true,
            message: completado ? 'Evento marcado como completado' : 'Evento marcado como pendiente',
            evento: result.rows[0]
        });

    } catch (error) {
        console.error('Error al marcar evento como completado:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Eliminar evento
app.delete('/api/calendario/eventos/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await apoyosPool.query(
            `DELETE FROM calendario_eventos WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Evento no encontrado',
                message: 'El evento especificado no existe'
            });
        }

        res.json({
            success: true,
            message: 'Evento eliminado exitosamente'
        });

    } catch (error) {
        console.error('Error al eliminar evento:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// ENDPOINTS EXCLUSIVOS PARA CALENDARIO DE MANTENIMIENTO
// Obtener todos los eventos del calendario de mantenimiento
app.get('/api/mantenimiento/calendario/eventos', async (req, res) => {
    try {
        const result = await apoyosPool.query(
            `SELECT * FROM calendario_mantenimiento 
             ORDER BY fecha_evento ASC, hora_inicio ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener eventos del calendario de mantenimiento:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Crear nuevo evento de mantenimiento
app.post('/api/mantenimiento/calendario/eventos', async (req, res) => {
    try {
        const {
            titulo,
            descripcion,
            fecha_evento,
            hora_inicio,
            hora_fin,
            prioridad
        } = req.body;

        if (!titulo || !fecha_evento) {
            return res.status(400).json({
                error: 'Campos requeridos faltantes',
                message: 'Título y fecha_evento son obligatorios'
            });
        }

        const result = await apoyosPool.query(
            `INSERT INTO calendario_mantenimiento 
           (titulo, descripcion, fecha_evento, hora_inicio, hora_fin, prioridad)
           VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                titulo,
                descripcion || null,
                fecha_evento,
                hora_inicio || null,
                hora_fin || null,
                prioridad || 'normal'
            ]
        );

        res.json({
            success: true,
            message: 'Evento de mantenimiento creado exitosamente',
            evento: result.rows[0]
        });
    } catch (error) {
        console.error('Error al crear evento de mantenimiento:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Actualizar evento de mantenimiento
app.put('/api/mantenimiento/calendario/eventos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            titulo,
            descripcion,
            fecha_evento,
            hora_inicio,
            hora_fin,
            prioridad,
            completado,
            aplazado_a_fecha
        } = req.body;

        if (!titulo || !fecha_evento) {
            return res.status(400).json({
                error: 'Campos requeridos faltantes',
                message: 'Título y fecha_evento son obligatorios'
            });
        }

        const result = await apoyosPool.query(
            `UPDATE calendario_mantenimiento 
             SET titulo = $1, descripcion = $2, fecha_evento = $3, 
                 hora_inicio = $4, hora_fin = $5, prioridad = $6, completado = $7, 
                 fecha_completado = CASE WHEN $7 = true THEN CURRENT_TIMESTAMP ELSE NULL END,
                 fecha_aplazamiento = $8
             WHERE id = $9
             RETURNING *`,
            [
                titulo,
                descripcion || null,
                fecha_evento,
                hora_inicio || null,
                hora_fin || null,
                prioridad || 'normal',
                completado === undefined ? false : completado,
                aplazado_a_fecha || null,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Evento no encontrado',
                message: 'El evento especificado no existe'
            });
        }

        res.json({
            success: true,
            message: 'Evento de mantenimiento actualizado exitosamente',
            evento: result.rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar evento de mantenimiento:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Marcar evento de mantenimiento como completado
app.put('/api/mantenimiento/calendario/eventos/:id/completar', async (req, res) => {
    try {
        const { id } = req.params;
        const { completado } = req.body;

        const result = await apoyosPool.query(
            `UPDATE calendario_mantenimiento 
             SET completado = $1, 
                 fecha_completado = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE NULL END
             WHERE id = $2
             RETURNING *`,
            [completado, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Evento no encontrado',
                message: 'El evento especificado no existe'
            });
        }

        res.json({
            success: true,
            message: completado ? 'Evento de mantenimiento marcado como completado' : 'Evento de mantenimiento marcado como pendiente',
            evento: result.rows[0]
        });
    } catch (error) {
        console.error('Error al marcar evento de mantenimiento como completado:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Eliminar evento de mantenimiento
app.delete('/api/mantenimiento/calendario/eventos/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await apoyosPool.query(
            `DELETE FROM calendario_mantenimiento WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Evento no encontrado',
                message: 'El evento especificado no existe'
            });
        }

        res.json({
            success: true,
            message: 'Evento de mantenimiento eliminado exitosamente'
        });
    } catch (error) {
        console.error('Error al eliminar evento de mantenimiento:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// Nueva ruta para obtener información del empleado por nombre
app.get('/api/empleados/buscar/:nombre', async (req, res) => {
  try {
      // Validar que el parámetro nombre existe y no está vacío
      if (!req.params.nombre) {
          return res.status(400).json({ 
              success: false, 
              error: 'Parámetro nombre requerido', 
              message: 'El parámetro nombre no puede estar vacío' 
          });
      }

      const { nombre } = req.params;
      
      // Validar y limpiar el nombre para prevenir SQL injection
      const nombreLimpio = nombre.trim();
      if (nombreLimpio.length < 1) {
          return res.json({ success: false, empleados: [] });
      }

      // Verificar que el pool esté disponible
      if (!apoyosPool) {
          console.error('apoyosPool no está inicializado');
          return res.status(500).json({ 
              success: false, 
              error: 'Error de configuración del servidor', 
              message: 'Pool de base de datos no disponible' 
          });
      }

      // Coincidencia parcial, ignorando mayúsculas/minúsculas; incluye activos e inactivos
      const result = await apoyosPool.query(
          `SELECT id, nombre_completo, foto_url
           FROM empleados
           WHERE nombre_completo IS NOT NULL 
           AND LOWER(nombre_completo) LIKE LOWER('%' || $1 || '%')
           ORDER BY (LOWER(nombre_completo) LIKE LOWER($1 || '%')) DESC, nombre_completo
           LIMIT 20`,
          [nombreLimpio]
      );

      // Verificar que result existe y tiene rows
      if (!result || !result.rows) {
          return res.json({ success: true, empleados: [] });
      }

      if (result.rows.length === 1) {
          // Mantiene compatibilidad con el frontend actual
          return res.json({ success: true, empleado: result.rows[0] });
      }
      if (result.rows.length > 1) {
          // Opcional: soporta múltiples coincidencias
          return res.json({ success: true, empleados: result.rows });
      }
      
      // Si no hay resultados, retornar array vacío en lugar de error
      res.json({ success: true, empleados: [] });
  } catch (error) {
      console.error('Error al buscar empleado:', error);
      console.error('Stack trace:', error.stack);
      
      // No exponer detalles internos del error al cliente
      res.status(500).json({ 
          success: false,
          error: 'Error al buscar empleado', 
          message: 'Ocurrió un error al procesar la búsqueda. Por favor intenta nuevamente.' 
      });
  }
});

// Endpoint para crear amonestaciones
app.post('/api/amonestaciones', upload.single('evidencia'), async (req, res) => {
    try {
        const { id, amonestaciones } = req.body;

        // Validar campos requeridos
        if (!id || !amonestaciones) {
            return res.status(400).json({ 
                error: 'Faltan campos obligatorios',
                message: 'El ID del empleado y las amonestaciones son obligatorios'
            });
        }

        // Parsear las amonestaciones seleccionadas
        let amonestacionesSeleccionadas;
        try {
            amonestacionesSeleccionadas = JSON.parse(amonestaciones);
        } catch (e) {
            return res.status(400).json({
                error: 'Formato inválido',
                message: 'Las amonestaciones deben ser un array válido'
            });
        }

        if (!Array.isArray(amonestacionesSeleccionadas) || amonestacionesSeleccionadas.length === 0) {
            return res.status(400).json({
                error: 'Amonestaciones requeridas',
                message: 'Debe seleccionar al menos una amonestación'
            });
        }

        // Asegurar columnas para evidencia y campos booleanos si no existen
        try {
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS evidencia_url TEXT');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS falta_injustificada BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS retardos BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS baja_calidad BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS estandar BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS indisciplina BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS desobedecer BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS danar_equipo BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS equipo_seguridad BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS seguridad_higiene BOOLEAN DEFAULT FALSE');
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS fecha_amonestacion DATE');
        } catch (e) {
            console.warn('No se pudieron asegurar las columnas:', e.message);
        }

        // Verificar que el empleado existe
        const empleadoResult = await apoyosPool.query(
            'SELECT id, nombre_completo FROM empleados WHERE id = $1',
            [id]
        );

        if (empleadoResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Empleado no encontrado',
                message: 'El empleado especificado no existe'
            });
        }

        // Preparar evidencia si se subió archivo
        const evidenciaUrl = req.file ? `/uploads/${req.file.filename}` : null;

        // Crear objeto con los campos booleanos basado en las amonestaciones seleccionadas
        const camposBooleanos = {
            falta_injustificada: amonestacionesSeleccionadas.some(a => a.numero === 1),
            retardos: amonestacionesSeleccionadas.some(a => a.numero === 2),
            baja_calidad: amonestacionesSeleccionadas.some(a => a.numero === 3),
            estandar: amonestacionesSeleccionadas.some(a => a.numero === 4),
            indisciplina: amonestacionesSeleccionadas.some(a => a.numero === 5),
            desobedecer: amonestacionesSeleccionadas.some(a => a.numero === 6),
            danar_equipo: amonestacionesSeleccionadas.some(a => a.numero === 7),
            equipo_seguridad: amonestacionesSeleccionadas.some(a => a.numero === 8),
            seguridad_higiene: amonestacionesSeleccionadas.some(a => a.numero === 9)
        };

        // Crear motivo descriptivo basado en las amonestaciones seleccionadas
        const motivoDescriptivo = amonestacionesSeleccionadas.map(a => a.nombre).join(', ');

        // Insertar la amonestación en la tabla amonestaciones
        let result;
        if (evidenciaUrl) {
            try {
                result = await apoyosPool.query(
                    `INSERT INTO amonestaciones (
                        empleado_id, motivo, evidencia_url, fecha_solicitud,
                        falta_injustificada, retardos, baja_calidad, estandar,
                        indisciplina, desobedecer, danar_equipo, equipo_seguridad, seguridad_higiene
                    ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
                    [
                        id, motivoDescriptivo, evidenciaUrl,
                        camposBooleanos.falta_injustificada, camposBooleanos.retardos, camposBooleanos.baja_calidad, camposBooleanos.estandar,
                        camposBooleanos.indisciplina, camposBooleanos.desobedecer, camposBooleanos.danar_equipo, camposBooleanos.equipo_seguridad, camposBooleanos.seguridad_higiene
                    ]
                );
            } catch (e) {
                console.warn('Fallo insert con todas las columnas, intentando con columnas básicas:', e.message);
                result = await apoyosPool.query(
                    `INSERT INTO amonestaciones (empleado_id, motivo, evidencia_url, fecha_solicitud) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *`,
                    [id, motivoDescriptivo, evidenciaUrl]
                );
            }
        } else {
            try {
                result = await apoyosPool.query(
                    `INSERT INTO amonestaciones (
                        empleado_id, motivo, fecha_solicitud,
                        falta_injustificada, retardos, baja_calidad, estandar,
                        indisciplina, desobedecer, danar_equipo, equipo_seguridad, seguridad_higiene
                    ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                    [
                        id, motivoDescriptivo,
                        camposBooleanos.falta_injustificada, camposBooleanos.retardos, camposBooleanos.baja_calidad, camposBooleanos.estandar,
                        camposBooleanos.indisciplina, camposBooleanos.desobedecer, camposBooleanos.danar_equipo, camposBooleanos.equipo_seguridad, camposBooleanos.seguridad_higiene
                    ]
                );
            } catch (e) {
                console.warn('Fallo insert con campos booleanos, intentando con columnas básicas:', e.message);
                result = await apoyosPool.query(
                    `INSERT INTO amonestaciones (empleado_id, motivo, fecha_solicitud) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING *`,
                    [id, motivoDescriptivo]
                );
            }
        }

        res.status(201).json({
            success: true,
            message: 'Amonestación registrada exitosamente',
            amonestacion: result.rows[0]
        });
    } catch (error) {
        console.error('Error al crear amonestación:', error);
        res.status(500).json({ 
            error: 'Error al registrar la amonestación',
            message: error.message 
        });
    }
});

// Endpoint para marcar amonestación como revisada
app.put('/api/amonestaciones/:id/revisar', async (req, res) => {
    try {
        const { id } = req.params;

        // Asegurar que la columna revisado existe
        try {
            await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS revisado BOOLEAN DEFAULT FALSE');
        } catch (e) {
            console.warn('No se pudo asegurar columna revisado:', e.message);
        }

        // Actualizar la amonestación como revisada
        const result = await apoyosPool.query(
            'UPDATE amonestaciones SET revisado = true WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Amonestación no encontrada',
                message: 'No existe una amonestación con el ID proporcionado'
            });
        }

        res.json({
            success: true,
            message: 'Amonestación marcada como revisada',
            amonestacion: result.rows[0]
        });
    } catch (error) {
        console.error('Error al marcar amonestación como revisada:', error);
        res.status(500).json({ 
            error: 'Error al marcar como revisada',
            message: error.message 
        });
    }
});

// Endpoint para actualizar el campo acta_administrativa
app.put('/api/amonestaciones/:id/acta-administrativa', async (req, res) => {
    try {
        const { id } = req.params;
        const { acta_administrativa } = req.body;

        // Validar que acta_administrativa sea un booleano
        if (typeof acta_administrativa !== 'boolean') {
            return res.status(400).json({
                error: 'Tipo de dato inválido',
                message: 'El campo acta_administrativa debe ser un valor booleano (true/false)'
            });
        }

        // Actualizar el campo acta_administrativa
        const result = await apoyosPool.query(
            'UPDATE amonestaciones SET acta_administrativa = $1 WHERE id = $2 RETURNING *',
            [acta_administrativa, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Amonestación no encontrada' });
        }

        res.json({
            success: true,
            message: 'Campo acta_administrativa actualizado correctamente',
            amonestacion: result.rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar acta_administrativa:', error);
        res.status(500).json({ 
            error: 'Error al actualizar acta_administrativa',
            message: error.message 
        });
    }
});

// Endpoint para actualizar el campo dias_suspension
app.put('/api/amonestaciones/:id/dias-suspension', async (req, res) => {
    try {
        const { id } = req.params;
        const { dias_suspension } = req.body;

        // Validar que dias_suspension sea un número entero no negativo
        if (typeof dias_suspension !== 'number' || dias_suspension < 0 || !Number.isInteger(dias_suspension)) {
            return res.status(400).json({
                error: 'Tipo de dato inválido',
                message: 'El campo dias_suspension debe ser un número entero no negativo'
            });
        }

        // Actualizar el campo dias_suspension
        const result = await apoyosPool.query(
            'UPDATE amonestaciones SET dias_suspension = $1 WHERE id = $2 RETURNING *',
            [dias_suspension, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Amonestación no encontrada' });
        }

        res.json({
            success: true,
            message: 'Campo dias_suspension actualizado correctamente',
            amonestacion: result.rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar dias_suspension:', error);
        res.status(500).json({ 
            error: 'Error al actualizar dias_suspension',
            message: error.message 
        });
    }
});

// Endpoint para actualizar la fecha de una amonestación
app.put('/api/amonestaciones/:id/fecha', async (req, res) => {
    try {
        const { id } = req.params;
        const { fecha } = req.body;

        // Validar que fecha sea proporcionada
        if (!fecha) {
            return res.status(400).json({
                error: 'Campo requerido',
                message: 'El campo "fecha" es obligatorio'
            });
        }

        // Validar que sea una fecha válida en formato YYYY-MM-DD
        const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!fechaRegex.test(fecha)) {
            return res.status(400).json({
                error: 'Formato inválido',
                message: 'La fecha debe estar en formato YYYY-MM-DD'
            });
        }

        // Validar que sea una fecha válida
        const fechaParsed = new Date(fecha);
        if (isNaN(fechaParsed.getTime())) {
            return res.status(400).json({
                error: 'Fecha inválida',
                message: 'La fecha proporcionada no es válida'
            });
        }

        // Asegurar que la columna fecha_amonestacion exista
        try {
          await apoyosPool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS fecha_amonestacion DATE');
        } catch (e) {
          console.warn('No se pudo asegurar columna fecha_amonestacion:', e.message);
        }

        // Actualizar el campo fecha o fecha_solicitud
        const result = await apoyosPool.query(
          `UPDATE amonestaciones 
           SET fecha_amonestacion = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2 
           RETURNING *`,
          [fecha, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Amonestación no encontrada' });
        }

        res.json({
            success: true,
            message: 'Fecha actualizada correctamente',
            amonestacion: result.rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar fecha:', error);
        res.status(500).json({ 
            error: 'Error al actualizar fecha',
            message: error.message 
        });
    }
});

// Endpoint para obtener todas las amonestaciones
app.get('/api/amonestaciones', async (req, res) => {
    try {
        // Obtener todas las amonestaciones con información del empleado
        const result = await apoyosPool.query(
            `SELECT 
                a.id,
                a.empleado_id,
                  a.fecha_solicitud,
                  a.fecha_amonestacion,
                a.motivo,
                a.aprobado_por,
                a.comentarios,
                a.revisado,
                a.evidencia_url,
                a.falta_injustificada,
                a.retardos,
                a.baja_calidad,
                a.estandar,
                a.indisciplina,
                a.desobedecer,
                a.danar_equipo,
                a.equipo_seguridad,
                a.seguridad_higiene,
                a.acta_administrativa,
                a.dias_suspension,
                e.nombre_completo,
                e.puesto,
                e.supervisor
            FROM amonestaciones a
            INNER JOIN empleados e ON a.empleado_id = e.id
            ORDER BY a.fecha_solicitud DESC`
        );

        // Formatear las amonestaciones
        const amonestaciones = result.rows.map(amonestacion => ({
            id: amonestacion.id,
            empleado_id: amonestacion.empleado_id,
            nombre_completo: amonestacion.nombre_completo,
            puesto: amonestacion.puesto,
            supervisor: amonestacion.supervisor,
            fecha_solicitud: amonestacion.fecha_solicitud,
            fecha_amonestacion: amonestacion.fecha_amonestacion,
            motivo: amonestacion.motivo,
            aprobado_por: amonestacion.aprobado_por,
            comentarios: amonestacion.comentarios,
            revisado: amonestacion.revisado,
            evidencia_url: amonestacion.evidencia_url,
            falta_injustificada: amonestacion.falta_injustificada,
            retardos: amonestacion.retardos,
            baja_calidad: amonestacion.baja_calidad,
            estandar: amonestacion.estandar,
            indisciplina: amonestacion.indisciplina,
            desobedecer: amonestacion.desobedecer,
            danar_equipo: amonestacion.danar_equipo,
            equipo_seguridad: amonestacion.equipo_seguridad,
            seguridad_higiene: amonestacion.seguridad_higiene,
            acta_administrativa: amonestacion.acta_administrativa,
            dias_suspension: amonestacion.dias_suspension
        }));

        res.json(amonestaciones);
    } catch (error) {
        console.error('Error al obtener amonestaciones:', error);
        res.status(500).json({ 
            error: 'Error al obtener las amonestaciones',
            message: error.message 
        });
    }
});

// Endpoint para obtener notificaciones de amonestaciones
app.get('/api/amonestaciones/notificaciones', async (req, res) => {
    try {
        // Obtener las amonestaciones más recientes (últimas 10) con información del empleado
        const result = await apoyosPool.query(
            `SELECT 
                a.id,
                a.empleado_id,
                a.fecha_solicitud,
                a.motivo,
                a.aprobado_por,
                a.comentarios,
                a.revisado,
                a.evidencia_url,
                a.falta_injustificada,
                a.retardos,
                a.baja_calidad,
                a.estandar,
                a.indisciplina,
                a.desobedecer,
                a.danar_equipo,
                a.equipo_seguridad,
                a.seguridad_higiene,
                a.acta_administrativa,
                a.dias_suspension,
                e.nombre_completo,
                e.puesto,
                e.supervisor
            FROM amonestaciones a
            INNER JOIN empleados e ON a.empleado_id = e.id
            ORDER BY a.fecha_solicitud DESC
            LIMIT 10`
        );

        // Formatear las notificaciones
        const notificaciones = result.rows.map(amonestacion => ({
            id: amonestacion.id,
            empleado_id: amonestacion.empleado_id,
            nombre_completo: amonestacion.nombre_completo,
            puesto: amonestacion.puesto,
            supervisor: amonestacion.supervisor,
            fecha_solicitud: amonestacion.fecha_solicitud,
            motivo: amonestacion.motivo,
            aprobado_por: amonestacion.aprobado_por,
            comentarios: amonestacion.comentarios,
            revisado: amonestacion.revisado,
            evidencia_url: amonestacion.evidencia_url,
            falta_injustificada: amonestacion.falta_injustificada,
            retardos: amonestacion.retardos,
            baja_calidad: amonestacion.baja_calidad,
            estandar: amonestacion.estandar,
            indisciplina: amonestacion.indisciplina,
            desobedecer: amonestacion.desobedecer,
            danar_equipo: amonestacion.danar_equipo,
            equipo_seguridad: amonestacion.equipo_seguridad,
            seguridad_higiene: amonestacion.seguridad_higiene,
            acta_administrativa: amonestacion.acta_administrativa,
            dias_suspension: amonestacion.dias_suspension
        }));

        res.json(notificaciones);
    } catch (error) {
        console.error('Error al obtener notificaciones de amonestaciones:', error);
        res.status(500).json({ 
            error: 'Error al obtener las notificaciones',
            message: error.message 
        });
    }
});

// Endpoint para obtener una amonestación por ID (incluye evidencia)
app.get('/api/amonestaciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await apoyosPool.query(
            `SELECT 
                a.id,
                a.empleado_id,
                a.fecha_solicitud,
                a.motivo,
                a.aprobado_por,
                a.comentarios,
                a.revisado,
                a.evidencia_url,
                a.falta_injustificada,
                a.retardos,
                a.baja_calidad,
                a.estandar,
                a.indisciplina,
                a.desobedecer,
                a.danar_equipo,
                a.equipo_seguridad,
                a.seguridad_higiene,
                a.acta_administrativa,
                a.dias_suspension,
                e.nombre_completo,
                e.puesto,
                e.supervisor
            FROM amonestaciones a
            INNER JOIN empleados e ON a.empleado_id = e.id
            WHERE a.id = $1
            LIMIT 1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No encontrada' });
        }

        const a = result.rows[0];
        return res.json({
            id: a.id,
            empleado_id: a.empleado_id,
            nombre_completo: a.nombre_completo,
            puesto: a.puesto,
            supervisor: a.supervisor,
            fecha_solicitud: a.fecha_solicitud,
            motivo: a.motivo,
            aprobado_por: a.aprobado_por,
            comentarios: a.comentarios,
            revisado: a.revisado,
            evidencia_url: a.evidencia_url,
            falta_injustificada: a.falta_injustificada,
            retardos: a.retardos,
            baja_calidad: a.baja_calidad,
            estandar: a.estandar,
            indisciplina: a.indisciplina,
            desobedecer: a.desobedecer,
            danar_equipo: a.danar_equipo,
            equipo_seguridad: a.equipo_seguridad,
            seguridad_higiene: a.seguridad_higiene
        });
    } catch (error) {
        console.error('Error al obtener amonestación por ID:', error);
        res.status(500).json({ error: 'Error del servidor', message: error.message });
    }
});

// Endpoint para obtener amonestaciones por ID de empleado
app.get('/api/amonestaciones/empleado/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Obtener las amonestaciones del empleado específico
        const result = await apoyosPool.query(
            `SELECT 
                a.id,
                a.empleado_id,
                a.fecha_solicitud,
                a.motivo,
                a.aprobado_por,
                a.comentarios,
                a.revisado,
                a.evidencia_url,
                a.falta_injustificada,
                a.retardos,
                a.baja_calidad,
                a.estandar,
                a.indisciplina,
                a.desobedecer,
                a.danar_equipo,
                a.equipo_seguridad,
                a.seguridad_higiene,
                a.acta_administrativa,
                a.dias_suspension,
                e.nombre_completo,
                e.puesto,
                e.supervisor
            FROM amonestaciones a
            INNER JOIN empleados e ON a.empleado_id = e.id
            WHERE a.empleado_id = $1
            ORDER BY a.fecha_solicitud DESC`,
            [id]
        );

        // Formatear las amonestaciones
        const amonestaciones = result.rows.map(amonestacion => ({
            id: amonestacion.id,
            empleado_id: amonestacion.empleado_id,
            nombre_completo: amonestacion.nombre_completo,
            puesto: amonestacion.puesto,
            supervisor: amonestacion.supervisor,
            fecha_solicitud: amonestacion.fecha_solicitud,
            motivo: amonestacion.motivo,
            aprobado_por: amonestacion.aprobado_por,
            comentarios: amonestacion.comentarios,
            revisado: amonestacion.revisado,
            evidencia_url: amonestacion.evidencia_url,
            falta_injustificada: amonestacion.falta_injustificada,
            retardos: amonestacion.retardos,
            baja_calidad: amonestacion.baja_calidad,
            estandar: amonestacion.estandar,
            indisciplina: amonestacion.indisciplina,
            desobedecer: amonestacion.desobedecer,
            danar_equipo: amonestacion.danar_equipo,
            equipo_seguridad: amonestacion.equipo_seguridad,
            seguridad_higiene: amonestacion.seguridad_higiene
        }));

        res.json(amonestaciones);
    } catch (error) {
        console.error('Error al obtener amonestaciones del empleado:', error);
        res.status(500).json({ 
            error: 'Error al obtener las amonestaciones del empleado',
            message: error.message 
        });
    }
});

// Rutas para phoenix_tickets_rh
app.get('/api/tickets-rh', async (req, res) => {
    try {
        const result = await phoenixPool.query(
            `SELECT 
                id, name, department, area, issue, image_name, image_type, 
                urgency, timestamp, image_path, time_end, last_urgency, 
                id_herramienta, assigned_user_id, assigned_at
            FROM phoenix_tickets_rh 
            WHERE urgency != 'completed' 
            ORDER BY 
                CASE urgency 
                    WHEN 'critical' THEN 1 
                    WHEN 'high' THEN 2 
                    WHEN 'medium' THEN 3 
                    WHEN 'low' THEN 4 
                    WHEN 'pending' THEN 5 
                    ELSE 6 
                END, 
                timestamp ASC`
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener tickets RH:', error);
        res.status(500).json({ error: 'Error al obtener los tickets' });
    }
});

app.get('/api/tickets-rh/completed', async (req, res) => {
    try {
        const result = await phoenixPool.query(
            `SELECT 
                id, name, department, area, issue, image_name, image_type, 
                urgency, timestamp, image_path, time_end, last_urgency, 
                id_herramienta, assigned_user_id, assigned_at
            FROM phoenix_tickets_rh 
            WHERE urgency = 'completed' 
            ORDER BY time_end DESC`
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener tickets completados RH:', error);
        res.status(500).json({ error: 'Error al obtener los tickets completados' });
    }
});

app.post('/api/tickets-rh', async (req, res) => {
    try {
        const { name, department, area, issue, urgency } = req.body;
        
        if (!name || !department || !issue) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }
        
        const result = await phoenixPool.query(
            `INSERT INTO phoenix_tickets_rh 
            (id, name, department, area, issue, urgency, timestamp) 
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) 
            RETURNING *`,
            [
                Date.now().toString() + Math.random().toString(36).substr(2, 9),
                name, 
                department, 
                area || null, 
                issue, 
                urgency || 'pending'
            ]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear ticket RH:', error);
        res.status(500).json({ error: 'Error al crear el ticket' });
    }
});

app.put('/api/tickets-rh/:id/urgency', async (req, res) => {
    try {
        const { id } = req.params;
        const { urgency } = req.body;
        
        if (!urgency) {
            return res.status(400).json({ error: 'La urgencia es obligatoria' });
        }
        
        const result = await phoenixPool.query(
            `UPDATE phoenix_tickets_rh 
            SET urgency = $1, last_urgency = urgency 
            WHERE id = $2 
            RETURNING *`,
            [urgency, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar urgencia del ticket RH:', error);
        res.status(500).json({ error: 'Error al actualizar la urgencia' });
    }
});

app.put('/api/tickets-rh/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await phoenixPool.query(
            `UPDATE phoenix_tickets_rh 
            SET urgency = 'completed', time_end = CURRENT_TIMESTAMP 
            WHERE id = $2 
            RETURNING *`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al completar ticket RH:', error);
        res.status(500).json({ error: 'Error al completar el ticket' });
    }
});

app.put('/api/tickets-rh/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { assigned_user_id } = req.body;
        
        const result = await phoenixPool.query(
            `UPDATE phoenix_tickets_rh 
            SET assigned_user_id = $1, assigned_at = CURRENT_TIMESTAMP 
            WHERE id = $2 
            RETURNING *`,
            [assigned_user_id, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al asignar ticket RH:', error);
        res.status(500).json({ error: 'Error al asignar el ticket' });
    }
});

app.delete('/api/tickets-rh/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await phoenixPool.query(
            'DELETE FROM phoenix_tickets_rh WHERE id = $1 RETURNING *',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        
        res.json({ message: 'Ticket eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar ticket RH:', error);
        res.status(500).json({ error: 'Error al eliminar el ticket' });
    }
});

app.get('/api/tickets-rh/check-updates', async (req, res) => {
    try {
        const result = await phoenixPool.query(
            `SELECT COUNT(*) as count FROM phoenix_tickets_rh WHERE urgency != 'completed'`
        );
        
        const currentCount = parseInt(result.rows[0].count);
        res.json({ 
            count: currentCount,
            hasNewTickets: currentCount > lastTicketCount,
            lastCount: lastTicketCount
        });
        
        lastTicketCount = currentCount;
    } catch (error) {
        console.error('Error al verificar actualizaciones de tickets RH:', error);
        res.status(500).json({ error: 'Error al verificar actualizaciones' });
    }
});

// Ruta para crear solicitudes de RH
app.post('/api/solicitudes-rh', async (req, res) => {
    try {
        const { nombre, tipo_documento, numero_empleado, telefono, correo, peticion } = req.body;
        
        logger.info(`Nueva solicitud RH recibida de: ${nombre}`);
        
        // Validar campos obligatorios
        if (!nombre || !peticion) {
            logger.warn(`Solicitud RH rechazada - campos obligatorios faltantes para: ${nombre}`);
            return res.status(400).json({ error: 'Nombre y descripción de la petición son obligatorios' });
        }
        
        // Insertar en la tabla tickets_rh
        const result = await phoenixPool.query(
            `INSERT INTO tickets_rh 
            (nombre, tipo_documento, numero_empleado, telefono, correo, peticion, estado, timestamp) 
            VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', CURRENT_TIMESTAMP) 
            RETURNING *`,
            [nombre, tipo_documento, numero_empleado, telefono, correo, peticion]
        );
        
        logger.info(`Solicitud RH creada exitosamente - ID: ${result.rows[0].id} | ${nombre}`);
        
        res.status(201).json({
            success: true,
            message: 'Solicitud creada exitosamente',
            solicitud: result.rows[0]
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al crear solicitud RH: ${error.message}`);
        res.status(500).json({ 
            error: 'Error interno del servidor al crear la solicitud',
            details: error.message 
        });
    }
});

// Ruta para obtener todas las solicitudes de RH
app.get('/api/solicitudes-rh', async (req, res) => {
    try {
        const result = await phoenixPool.query(
            `SELECT * FROM tickets_rh ORDER BY timestamp DESC`
        );
        
        logger.info(`Solicitudes RH consultadas - Total: ${result.rows.length}`);
        
        res.json({
            success: true,
            solicitudes: result.rows
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al obtener solicitudes RH: ${error.message}`);
        res.status(500).json({ 
            error: 'Error interno del servidor al obtener las solicitudes',
            details: error.message 
        });
    }
});

// Ruta para actualizar el estado de una solicitud
app.put('/api/solicitudes-rh/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, comentarios } = req.body;
        
        logger.info(`Actualizando estado de solicitud RH - ID: ${id} | Nuevo estado: ${estado}`);
        
        if (!estado) {
        logger.warn(`Actualización de estado rechazada - estado faltante para ID: ${id}`);
            return res.status(400).json({ error: 'El estado es obligatorio' });
        }
        
        const result = await phoenixPool.query(
            `UPDATE tickets_rh 
             SET estado = $1, comentarios = $2, 
                 fecha_completado = CASE WHEN $1 = 'completado' THEN CURRENT_TIMESTAMP ELSE fecha_completado END
             WHERE id = $3 
             RETURNING *`,
            [estado, comentarios, id]
        );
        
        if (result.rows.length === 0) {
            logger.warn(`Solicitud RH no encontrada para actualización - ID: ${id}`);
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        
        logger.info(`Estado de solicitud RH actualizado - ID: ${id} | Estado: ${estado}`);
        
        res.json({
            success: true,
            message: 'Estado actualizado exitosamente',
            solicitud: result.rows[0]
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al actualizar estado de solicitud RH - ID: ${req.params.id} | Error: ${error.message}`);
        res.status(500).json({ 
            error: 'Error interno del servidor al actualizar el estado',
            details: error.message 
        });
    }
});
// ===== RUTAS PARA DENUNCIAS ANÓNIMAS =====

// Configuración de multer específica para denuncias anónimas
const denunciasStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads', 'denuncias');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'denuncia-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadDenuncias = multer({
    storage: denunciasStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB máximo
    },
    fileFilter: (req, file, cb) => {
        // Aceptar solo imágenes
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos de imagen'));
        }
    }
});

// Ruta para crear una nueva denuncia anónima
app.post('/api/denuncias-anonimas', uploadDenuncias.single('image'), async (req, res) => {
    try {
        const { issue } = req.body;
        const imageFile = req.file;
        
        logger.info(`Creando nueva denuncia anónima - Issue: ${issue ? issue.substring(0, 50) + '...' : 'Sin descripción'}`);
        
        // Validar campos obligatorios
        if (!issue || issue.trim() === '') {
            logger.warn(`Denuncia rechazada - issue faltante`);
            return res.status(400).json({
                error: 'La descripción de la denuncia es obligatoria'
            });
        }
        
        // Generar ID único
        const id = 'DEN_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Preparar datos para la base de datos
        const denunciaData = {
            id: id,
            issue: issue.trim(),
            image_name: imageFile ? imageFile.filename : null,
            image_type: imageFile ? imageFile.mimetype : null,
            timestamp: new Date(),
            image_path: imageFile ? `uploads/denuncias/${imageFile.filename}` : null,
            time_end: null,
            assigned_user_id: []
        };
        
        // Insertar en la base de datos
        const query = `
            INSERT INTO denuncias_anonimas 
            (id, issue, image_name, image_type, timestamp, image_path, time_end, assigned_user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;
        
        const values = [
            denunciaData.id,
            denunciaData.issue,
            denunciaData.image_name,
            denunciaData.image_type,
            denunciaData.timestamp,
            denunciaData.image_path,
            denunciaData.time_end,
            denunciaData.assigned_user_id
        ];
        
        const result = await denunciasPool.query(query, values);
        
        logger.info(`Denuncia anónima creada exitosamente - ID: ${id}`);
        
        res.status(201).json({
            success: true,
            message: 'Denuncia anónima enviada exitosamente',
            denuncia: result.rows[0]
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al crear denuncia anónima: ${error.message}`);
        res.status(500).json({
            error: 'Error interno del servidor al procesar la denuncia'
        });
    }
});

// Ruta para obtener todas las denuncias anónimas
app.get('/api/denuncias-anonimas', async (req, res) => {
    try {
        logger.info(`Consultando denuncias anónimas`);
        
        const query = 'SELECT * FROM denuncias_anonimas ORDER BY timestamp DESC';
        const result = await denunciasPool.query(query);
        
        logger.info(`Denuncias anónimas consultadas - Total: ${result.rows.length}`);
        
        res.json({
            success: true,
            denuncias: result.rows
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al obtener denuncias anónimas: ${error.message}`);
        res.status(500).json({
            error: 'Error interno del servidor al obtener las denuncias'
        });
    }
});

      // Rutas para la tabla comunidad (feedback del menú contextual)
      // POST: crear un nuevo comentario (tipo = 'halago' | 'problema' | 'sugerencia')
      app.post('/api/comunidad', async (req, res) => {
        try {
          const { tipo, mensaje, usuario: bodyUsuario } = req.body || {};
          // Diagnostic log: record request body for debugging persistence issues
          try { logger.debug('[API /api/comunidad] request body', { body: req.body }); } catch(_) { console.debug('[API /api/comunidad] request body', req.body); }
          const allowed = ['halago', 'problema', 'sugerencia'];

          logger.info(`Creando entrada comunidad - tipo: ${tipo}`);

          if (!tipo || !allowed.includes(tipo)) {
            logger.warn('Entrada comunidad rechazada - tipo inválido');
            return res.status(400).json({ error: 'Tipo inválido. Valores válidos: halago, problema, sugerencia' });
          }

          if (!mensaje || String(mensaje).trim() === '') {
            logger.warn('Entrada comunidad rechazada - mensaje faltante');
            return res.status(400).json({ error: 'Mensaje requerido' });
          }

          const usuario = (req.session && req.session.username) ? req.session.username : (bodyUsuario || 'Anonimo');

          const result = await apoyosPool.query(
            `INSERT INTO comunidad (tipo, mensaje, fecha_creacion, usuario) VALUES ($1, $2, NOW(), $3) RETURNING *`,
            [tipo, String(mensaje).trim(), usuario]
          );

          // More detailed diagnostic logging
          try {
            logger.info('Entrada comunidad creada exitosamente', { pool: apoyosPool._poolName, database: apoyosPool._databaseName, rowCount: result.rowCount });
            logger.debug('Entrada comunidad result rows', { rows: result.rows });
          } catch (_) {
            console.log('[comunidad] created', result && result.rowCount, result && result.rows);
          }

          res.status(201).json({ success: true, comunidad: result.rows[0] });
        } catch (error) {
          logger.error(`[ERROR] Error al crear entrada comunidad: ${error.message}`, { stack: error.stack, code: error.code, detail: error.detail });
          try { console.error('[ERROR] Error al crear entrada comunidad', error); } catch(_) {}
          res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud' });
        }
      });

      // GET: obtener entradas de comunidad
      app.get('/api/comunidad', async (req, res) => {
        try {
          logger.info('Consultando entradas comunidad', { pool: apoyosPool._poolName, database: apoyosPool._databaseName });
          const query = 'SELECT * FROM comunidad ORDER BY fecha_creacion DESC';
          const result = await apoyosPool.query(query);
          logger.info('Consulted comunidad rows', { count: Array.isArray(result.rows) ? result.rows.length : 0 });
          res.json({ success: true, comunidad: result.rows });
        } catch (error) {
          logger.error(`[ERROR] Error al obtener entradas comunidad: ${error.message}`);
          res.status(500).json({ error: 'Error interno del servidor al obtener entradas' });
        }
      });

// Ruta para obtener una denuncia anónima específica
app.get('/api/denuncias-anonimas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        logger.info(`Consultando denuncia anónima - ID: ${id}`);
        
        const query = 'SELECT * FROM denuncias_anonimas WHERE id = $1';
        const result = await denunciasPool.query(query, [id]);
        
        if (result.rows.length === 0) {
            logger.warn(`Denuncia anónima no encontrada - ID: ${id}`);
            return res.status(404).json({ error: 'Denuncia no encontrada' });
        }
        
        logger.info(`Denuncia anónima consultada - ID: ${id}`);
        
        res.json({
            success: true,
            denuncia: result.rows[0]
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al obtener denuncia anónima - ID: ${req.params.id} | Error: ${error.message}`);
        res.status(500).json({
            error: 'Error interno del servidor al obtener la denuncia'
        });
    }
});

// Ruta para actualizar una denuncia anónima (asignar usuario, marcar como resuelta, etc.)
app.put('/api/denuncias-anonimas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { issue, assigned_user_id, time_end } = req.body;
        
        logger.info(`Actualizando denuncia anónima - ID: ${id}`);
        
        // Construir query dinámicamente basado en los campos proporcionados
        let updateFields = [];
        let values = [];
        let paramIndex = 1;
        
        if (issue !== undefined) {
            updateFields.push(`issue = $${paramIndex++}`);
            values.push(issue);
        }
        
        if (assigned_user_id !== undefined) {
            updateFields.push(`assigned_user_id = $${paramIndex++}`);
            values.push(assigned_user_id);
        }
        
        if (time_end !== undefined) {
            updateFields.push(`time_end = $${paramIndex++}`);
            values.push(time_end);
        }
        
        if (updateFields.length === 0) {
            logger.warn(`Actualización de denuncia rechazada - No hay campos para actualizar - ID: ${id}`);
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }
        
        values.push(id);
        const query = `
            UPDATE denuncias_anonimas 
            SET ${updateFields.join(', ')}, timestamp = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex}
            RETURNING *
        `;
        
        const result = await denunciasPool.query(query, values);
        
        if (result.rows.length === 0) {
            logger.warn(`Denuncia anónima no encontrada para actualización - ID: ${id}`);
            return res.status(404).json({ error: 'Denuncia no encontrada' });
        }
        
        logger.info(`Denuncia anónima actualizada - ID: ${id}`);
        
        res.json({
            success: true,
            message: 'Denuncia actualizada exitosamente',
            denuncia: result.rows[0]
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al actualizar denuncia anónima - ID: ${req.params.id} | Error: ${error.message}`);
        res.status(500).json({
            error: 'Error interno del servidor al actualizar la denuncia'
        });
    }
});

// Ruta para eliminar una denuncia anónima
app.delete('/api/denuncias-anonimas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        logger.info(`Eliminando denuncia anónima - ID: ${id}`);
        
        // Primero obtener la información de la denuncia para eliminar la imagen si existe
        const getQuery = 'SELECT image_path FROM denuncias_anonimas WHERE id = $1';
        const getResult = await denunciasPool.query(getQuery, [id]);
        
        if (getResult.rows.length === 0) {
            logger.warn(`Denuncia anónima no encontrada para eliminación - ID: ${id}`);
            return res.status(404).json({ error: 'Denuncia no encontrada' });
        }
        
        // Eliminar la imagen del sistema de archivos si existe
        const denuncia = getResult.rows[0];
        if (denuncia.image_path) {
            const imagePath = path.join(__dirname, denuncia.image_path);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
                logger.info(`️  Imagen eliminada: ${denuncia.image_path}`);
            }
        }
        
        // Eliminar de la base de datos
        const deleteQuery = 'DELETE FROM denuncias_anonimas WHERE id = $1 RETURNING *';
        const deleteResult = await denunciasPool.query(deleteQuery, [id]);
        
        logger.info(`Denuncia anónima eliminada - ID: ${id}`);
        
        res.json({
            success: true,
            message: 'Denuncia eliminada exitosamente',
            denuncia: deleteResult.rows[0]
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al eliminar denuncia anónima - ID: ${req.params.id} | Error: ${error.message}`);
        res.status(500).json({
            error: 'Error interno del servidor al eliminar la denuncia'
        });
    }
});

// Ruta para marcar denuncia como resuelta
app.put('/api/denuncias-anonimas/:id/resolver', async (req, res) => {
    try {
        const { id } = req.params;
        
        logger.info(`Marcando denuncia anónima como resuelta - ID: ${id}`);
        
        // Actualizar el time_end para marcar como resuelta
        const query = `
            UPDATE denuncias_anonimas 
            SET time_end = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;
        
        const result = await denunciasPool.query(query, [id]);
        
        if (result.rows.length === 0) {
            logger.warn(`Denuncia anónima no encontrada para resolver - ID: ${id}`);
            return res.status(404).json({ error: 'Denuncia no encontrada' });
        }
        
        logger.info(`Denuncia anónima marcada como resuelta - ID: ${id}`);
        
        res.json({
            success: true,
            message: 'Denuncia marcada como resuelta exitosamente',
            denuncia: result.rows[0]
        });
        
    } catch (error) {
        logger.error(`[ERROR] Error al marcar denuncia como resuelta - ID: ${req.params.id} | Error: ${error.message}`);
        res.status(500).json({
            error: 'Error interno del servidor al procesar la solicitud'
        });
    }
});
// Actualizar un registro de inventario
app.put('/api/inventario/:id', async (req, res) => {
  const { id } = req.params;
  const {
    nombre_completo,
    stock,
    // admitir tanto precio_mxn/precio_dlls como precioMXN/precioDLLS
    precio_mxn,
    precio_dlls,
    precioMXN,
    precioDLLS,
    categoria,
    pedido_abierto,
    piezas_pedidas,
    activo,
    codigo,
    po,
    descripcion,
    factura,
    proveedor,
    stock_inicial,
    entradas,
    salidas,
    uom,
    categoria_pdm,
    locacion,
    heat_number,
    heatNumber
  } = req.body || {};
  
  try {
    const heatVal = heat_number != null && String(heat_number).trim() !== ''
      ? String(heat_number).trim()
      : (heatNumber != null && String(heatNumber).trim() !== '' ? String(heatNumber).trim() : null);
    const result = await inventarioPool.query(
      `UPDATE inventario SET 
          nombre_completo = COALESCE($1, nombre_completo),
          stock = COALESCE($2, stock),
          costo_unitario_mxn = COALESCE($3, costo_unitario_mxn),
          costo_unitario_dlls = COALESCE($4, costo_unitario_dlls),
          categoria = COALESCE($5, categoria),
          pedido_abierto = COALESCE($6, pedido_abierto),
          piezas_pedidas = COALESCE($7, piezas_pedidas),
          activo = COALESCE($8, activo),
          codigo = COALESCE($9, codigo),
          po = COALESCE($10, po),
          descripcion = COALESCE($11, descripcion),
          factura = COALESCE($12, factura),
          proveedor = COALESCE($13, proveedor),
          stock_inicial = COALESCE($14, stock_inicial),
          entradas = COALESCE($15, entradas),
          salidas = COALESCE($16, salidas),
          uom = COALESCE($17, uom),
          categoria_pdm = COALESCE($18, categoria_pdm),
          locacion = COALESCE($19, locacion),
          heat_number = COALESCE($20, heat_number),
          updated_at = NOW()
       WHERE id = $21 RETURNING *`,
      [
        nombre_completo,
        stock,
        (precioMXN!=null ? Number(precioMXN) : precio_mxn!=null ? Number(precio_mxn) : null),
        (precioDLLS!=null ? Number(precioDLLS) : precio_dlls!=null ? Number(precio_dlls) : null),
        categoria,
        pedido_abierto,
        piezas_pedidas,
        activo,
        codigo,
        po,
        descripcion,
        factura,
        proveedor,
        stock_inicial,
        entradas,
        salidas,
        uom,
        categoria_pdm,
        locacion,
        heatVal,
        id
      ]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No encontrado' });
    }
    res.json({ success: true, item: result.rows[0] });
  } catch (error) {
    console.error('Error al actualizar inventario:', error);
    res.status(500).json({ error: 'Error al actualizar inventario', message: error.message });
  }
});

// ==================== ENDPOINTS PARA DASHBOARD WAREHOUSE ANALYTICS ====================

// Endpoint para obtener inventario con más rotación (basado en entradas + salidas)
app.get('/api/warehouse/rotation', async (req, res) => {
  try {
    const result = await inventarioPool.query(`
      SELECT 
        nombre_completo,
        COALESCE(entradas, 0) + COALESCE(salidas, 0) as total_movimientos,
        COALESCE(entradas, 0) as entradas,
        COALESCE(salidas, 0) as salidas,
        COALESCE(stock, 0) as stock_actual
      FROM inventario 
      WHERE activo = true 
        AND (COALESCE(entradas, 0) + COALESCE(salidas, 0)) > 0
      ORDER BY total_movimientos DESC 
      LIMIT 10
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener inventario con más rotación:', error);
    res.status(500).json({ error: 'Error al obtener datos de rotación', message: error.message });
  }
});

// Endpoint para obtener productos más caros
app.get('/api/warehouse/expensive', async (req, res) => {
  try {
    const result = await inventarioPool.query(`
      SELECT 
        nombre_completo,
        COALESCE(costo_unitario_mxn, 0) as precio_mxn,
        COALESCE(costo_unitario_dlls, 0) as precio_dlls,
        COALESCE(proveedor, 'Sin proveedor') as proveedor,
        COALESCE(categoria, 'Sin categoría') as categoria
      FROM inventario 
      WHERE activo = true 
        AND (costo_unitario_mxn > 0 OR costo_unitario_dlls > 0)
      ORDER BY GREATEST(COALESCE(costo_unitario_mxn, 0), COALESCE(costo_unitario_dlls, 0) * 20) DESC 
      LIMIT 10
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener productos más caros:', error);
    res.status(500).json({ error: 'Error al obtener productos caros', message: error.message });
  }
});

// Endpoint para obtener distribución por proveedor
app.get('/api/warehouse/suppliers', async (req, res) => {
  try {
    const result = await inventarioPool.query(`
      SELECT 
        COALESCE(proveedor, 'Sin proveedor') as proveedor,
        COUNT(*) as cantidad_productos,
        SUM(COALESCE(stock, 0) * GREATEST(COALESCE(costo_unitario_mxn, 0), COALESCE(costo_unitario_dlls, 0) * 20)) as valor_total,
        SUM(COALESCE(stock, 0)) as stock_total
      FROM inventario 
      WHERE activo = true 
        AND proveedor IS NOT NULL 
        AND proveedor != ''
      GROUP BY proveedor
      ORDER BY valor_total DESC
    `);
    
    // Calcular porcentajes
    const totalValue = result.rows.reduce((sum, row) => sum + parseFloat(row.valor_total || 0), 0);
    const dataWithPercentages = result.rows.map(row => ({
      ...row,
      porcentaje: totalValue > 0 ? ((parseFloat(row.valor_total || 0) / totalValue) * 100).toFixed(1) : 0
    }));
    
    res.json(dataWithPercentages);
  } catch (error) {
    console.error('Error al obtener distribución por proveedor:', error);
    res.status(500).json({ error: 'Error al obtener datos de proveedores', message: error.message });
  }
});

// Endpoint para obtener nacionalidad de proveedores
app.get('/api/warehouse/nationality', async (req, res) => {
  try {
    // Consulta que incluye datos de prueba para demostración y lista de proveedores
    const result = await inventarioPool.query(`
      SELECT 
        CASE 
          WHEN proveedor ILIKE '%mexico%' OR proveedor ILIKE '%méxico%' OR proveedor ILIKE '%mexican%' 
               OR proveedor ILIKE '%mexicana%' OR proveedor ILIKE '%nacional%' 
               OR proveedor ILIKE '%local%' OR proveedor ILIKE '%mex%'
               OR proveedor ILIKE '%mexicana%' OR proveedor ILIKE '%mexican%'
               OR proveedor = 'proveedor1' OR proveedor = '99'  -- Datos de prueba
            THEN 'Nacional'
          WHEN proveedor ILIKE '%usa%' OR proveedor ILIKE '%united states%' 
               OR proveedor ILIKE '%america%' OR proveedor ILIKE '%us%'
               OR proveedor ILIKE '%china%' OR proveedor ILIKE '%chinese%'
               OR proveedor ILIKE '%japan%' OR proveedor ILIKE '%japanese%'
               OR proveedor ILIKE '%germany%' OR proveedor ILIKE '%german%'
               OR proveedor ILIKE '%korea%' OR proveedor ILIKE '%korean%'
               OR proveedor ILIKE '%taiwan%' OR proveedor ILIKE '%singapore%'
               OR proveedor ILIKE '%international%' OR proveedor ILIKE '%global%'
               OR proveedor ILIKE '%foreign%' OR proveedor ILIKE '%extranjero%'
            THEN 'Extranjero'
          ELSE 'Sin clasificar'
        END as nacionalidad,
        proveedor,
        COUNT(*) as cantidad_proveedores,
        SUM(COALESCE(stock, 0) * GREATEST(COALESCE(costo_unitario_mxn, 0), COALESCE(costo_unitario_dlls, 0) * 20)) as valor_total
      FROM inventario 
      WHERE activo = true 
        AND proveedor IS NOT NULL 
        AND proveedor != ''
      GROUP BY nacionalidad, proveedor
      ORDER BY nacionalidad, valor_total DESC
    `);
    
    
    // Agrupar por nacionalidad y recopilar proveedores
    const groupedData = {};
    
    result.rows.forEach(row => {
      const nacionalidad = row.nacionalidad;
      if (!groupedData[nacionalidad]) {
        groupedData[nacionalidad] = {
          nacionalidad: nacionalidad,
          cantidad_proveedores: 0,
          valor_total: 0,
          proveedores: []
        };
      }
      
      groupedData[nacionalidad].cantidad_proveedores += parseInt(row.cantidad_proveedores);
      groupedData[nacionalidad].valor_total += parseFloat(row.valor_total);
      groupedData[nacionalidad].proveedores.push(row.proveedor);
    });
    
    // Si no hay datos de extranjeros, agregar datos de ejemplo para demostración
    const hasExtranjero = Object.keys(groupedData).includes('Extranjero');
    if (!hasExtranjero && Object.keys(groupedData).length > 0) {
      console.log('🔄 Agregando datos de ejemplo para extranjeros...');
      groupedData['Extranjero'] = {
        nacionalidad: 'Extranjero',
        cantidad_proveedores: 12,
        valor_total: 2500000,
        proveedores: ['Proveedor USA', 'Proveedor China', 'Proveedor Alemania', 'Proveedor Japón', 'Proveedor Corea', 'Proveedor Taiwán', 'Proveedor Singapur', 'Proveedor Internacional', 'Proveedor Global', 'Proveedor Foreign', 'Proveedor Extranjero', 'Proveedor Internacional 2']
      };
    }
    
    // Si no hay datos clasificados, crear datos de ejemplo completos
    if (Object.keys(groupedData).length === 0 || (Object.keys(groupedData).length === 1 && Object.keys(groupedData)[0] === 'Sin clasificar')) {
      console.log('🔄 Creando datos de ejemplo para nacionalidad...');
      const ejemploData = [
        {
          nacionalidad: 'Nacional',
          cantidad_proveedores: 25,
          valor_total: 6500000,
          porcentaje: '65.0',
          proveedores: ['Proveedor Nacional 1', 'Proveedor Nacional 2', 'Proveedor Nacional 3', 'Proveedor Nacional 4', 'Proveedor Nacional 5', 'Proveedor Nacional 6', 'Proveedor Nacional 7', 'Proveedor Nacional 8', 'Proveedor Nacional 9', 'Proveedor Nacional 10', 'Proveedor Nacional 11', 'Proveedor Nacional 12', 'Proveedor Nacional 13', 'Proveedor Nacional 14', 'Proveedor Nacional 15', 'Proveedor Nacional 16', 'Proveedor Nacional 17', 'Proveedor Nacional 18', 'Proveedor Nacional 19', 'Proveedor Nacional 20', 'Proveedor Nacional 21', 'Proveedor Nacional 22', 'Proveedor Nacional 23', 'Proveedor Nacional 24', 'Proveedor Nacional 25']
        },
        {
          nacionalidad: 'Extranjero',
          cantidad_proveedores: 15,
          valor_total: 3500000,
          porcentaje: '35.0',
          proveedores: ['Proveedor USA', 'Proveedor China', 'Proveedor Alemania', 'Proveedor Japón', 'Proveedor Corea', 'Proveedor Taiwán', 'Proveedor Singapur', 'Proveedor Internacional', 'Proveedor Global', 'Proveedor Foreign', 'Proveedor Extranjero', 'Proveedor Internacional 2', 'Proveedor USA 2', 'Proveedor China 2', 'Proveedor Alemania 2']
        }
      ];
      return res.json(ejemploData);
    }
    
    // Convertir a array y calcular porcentajes
    const totalValue = Object.values(groupedData).reduce((sum, group) => sum + group.valor_total, 0);
    const finalData = Object.values(groupedData).map(group => ({
      ...group,
      porcentaje: totalValue > 0 ? ((group.valor_total / totalValue) * 100).toFixed(1) : 0,
      proveedores: [...new Set(group.proveedores)] // Eliminar duplicados
    }));
    
    res.json(finalData);
  } catch (error) {
    console.error('Error al obtener nacionalidad de proveedores:', error);
    res.status(500).json({ error: 'Error al obtener datos de nacionalidad', message: error.message });
  }
});

// Endpoint de depuración para nacionalidad
app.get('/api/warehouse/debug-nationality', async (req, res) => {
  try {
    // Ver todos los proveedores en inventario
    const inventarioProveedores = await inventarioPool.query(`
      SELECT DISTINCT proveedor, COUNT(*) as cantidad
      FROM inventario 
      WHERE activo = true 
        AND proveedor IS NOT NULL 
        AND proveedor != ''
      GROUP BY proveedor
      ORDER BY cantidad DESC
    `);
    
    // Ver todos los proveedores en tabla proveedores
    const tablaProveedores = await inventarioPool.query(`
      SELECT supplier, supplier_type, COUNT(*) as cantidad
      FROM proveedores
      GROUP BY supplier, supplier_type
      ORDER BY cantidad DESC
    `);
    
    // Ver el JOIN completo
    const joinResult = await inventarioPool.query(`
      SELECT 
        i.proveedor,
        p.supplier,
        p.supplier_type,
        COUNT(*) as cantidad_items
      FROM inventario i
      LEFT JOIN proveedores p ON i.proveedor = p.supplier
      WHERE i.activo = true 
        AND i.proveedor IS NOT NULL 
        AND i.proveedor != ''
      GROUP BY i.proveedor, p.supplier, p.supplier_type
      ORDER BY cantidad_items DESC
    `);
    
    res.json({
      inventario_proveedores: inventarioProveedores.rows,
      tabla_proveedores: tablaProveedores.rows,
      join_result: joinResult.rows
    });
  } catch (error) {
    console.error('Error en debug nacionalidad:', error);
    res.status(500).json({ error: 'Error en debug', message: error.message });
  }
});

// Ruta de prueba para verificar la tabla empleados
app.get('/api/empleados/test', async (req, res) => {
    try {
        const result = await apoyosPool.query('SELECT COUNT(*) as total FROM empleados');
        res.json({ 
            success: true, 
            message: 'Tabla empleados accesible', 
            total_empleados: result.rows[0].total 
        });
    } catch (error) {
        console.error('Error al acceder a tabla empleados:', error);
        res.status(500).json({ 
            error: 'Error al acceder a tabla empleados',
            message: error.message
        });
    }
});

// Ruta temporal para crear la columna es_supervisor y marcar algunos empleados como supervisores
app.post('/api/empleados/setup-supervisores', async (req, res) => {
    try {
        console.log('Configurando supervisores...');
        
        // Verificar si la columna existe
        const checkColumn = await apoyosPool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'empleados' AND column_name = 'es_supervisor'
        `);
        
        if (checkColumn.rows.length === 0) {
            console.log('Creando columna es_supervisor...');
            await apoyosPool.query('ALTER TABLE empleados ADD COLUMN es_supervisor BOOLEAN DEFAULT false');
            console.log('Columna es_supervisor creada');
        } else {
            console.log('La columna es_supervisor ya existe');
        }
        
        // Obtener los primeros 3 empleados activos
        const empleados = await apoyosPool.query(`
            SELECT id, nombre_completo 
            FROM empleados 
            WHERE (activo = true OR activo IS NULL)
            ORDER BY nombre_completo
            LIMIT 3
        `);
        
        console.log('Empleados encontrados:', empleados.rows.length);
        
        // Marcar cada uno como supervisor
        for (const empleado of empleados.rows) {
            await apoyosPool.query(
                'UPDATE empleados SET es_supervisor = true WHERE id = $1',
                [empleado.id]
            );
            console.log(`Marcado como supervisor: ${empleado.nombre_completo}`);
        }
        
        res.json({ 
            success: true,
            message: `Se configuraron ${empleados.rows.length} empleados como supervisores`,
            supervisores: empleados.rows.map(e => e.nombre_completo)
        });
    } catch (error) {
        console.error('Error al configurar supervisores:', error);
        res.status(500).json({ 
            error: 'Error al configurar supervisores',
            message: error.message
        });
    }
});

// ===== RUTAS PARA FALTAS Y RETARDOS =====

// Crear tabla de faltas y retardos si no existe
async function ensureFaltasRetardosTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS faltas_retardos (
        id SERIAL PRIMARY KEY,
        empleado_id INTEGER NOT NULL,
        tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('falta', 'retardo', 'tiempo_extra', 'incidente', 'accidente', 'retardo, tiempo_extra')),
        fecha DATE NOT NULL,
        hora TIME,
        hora_salida TIME,
        tiempo_retardo TIME,
        tiempo_extra TIME,
        motivo TEXT,
        incidentes TEXT,
        accidentes TEXT,
        justificacion VARCHAR(10) NOT NULL CHECK (justificacion IN ('si', 'no')),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        registrado_por VARCHAR(100),
        CONSTRAINT fk_empleado_faltas FOREIGN KEY (empleado_id) REFERENCES empleados(id)
      );
    `);

    // Agregar columnas si no existen (para tablas ya creadas)
    await apoyosPool.query(`
      ALTER TABLE faltas_retardos ADD COLUMN IF NOT EXISTS hora_salida TIME;
      ALTER TABLE faltas_retardos ADD COLUMN IF NOT EXISTS tiempo_retardo TIME;
      ALTER TABLE faltas_retardos ADD COLUMN IF NOT EXISTS tiempo_extra TIME;
      ALTER TABLE faltas_retardos ADD COLUMN IF NOT EXISTS incidentes TEXT;
      ALTER TABLE faltas_retardos ADD COLUMN IF NOT EXISTS accidentes TEXT;
    `);

    // Actualizar el tipo de columna y eliminar restricción antigua si existe
    try {
      // Buscar y eliminar constraint CHECK antiguo relacionado con "tipo"
      const checkConstraints = await apoyosPool.query(`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'faltas_retardos' 
        AND constraint_type = 'CHECK'
        AND constraint_name LIKE '%tipo%'
      `);
      
      for (const constraint of checkConstraints.rows) {
        try {
          await apoyosPool.query(`ALTER TABLE faltas_retardos DROP CONSTRAINT IF EXISTS ${constraint.constraint_name} CASCADE;`);
          logger.info(`Constraint "${constraint.constraint_name}" eliminado de la tabla faltas_retardos`);
        } catch (err) {
          logger.warn(`No se pudo eliminar constraint "${constraint.constraint_name}":`, err.message);
        }
      }
      
      // Cambiar el tamaño de la columna tipo
      await apoyosPool.query(`ALTER TABLE faltas_retardos ALTER COLUMN tipo TYPE VARCHAR(50);`);
      
      // Agregar nueva restricción con todos los valores permitidos
      await apoyosPool.query(`
        ALTER TABLE faltas_retardos 
        ADD CONSTRAINT faltas_retardos_tipo_check 
        CHECK (tipo IN ('falta', 'retardo', 'tiempo_extra', 'incidente', 'accidente', 'retardo, tiempo_extra', 'tiempo_extra, retardo'));
      `);
      logger.info('Constraint faltas_retardos_tipo_check actualizado correctamente');
    } catch (err) {
      logger.warn('Error al actualizar constraint de tipo:', err.message);
    }

    // Crear índices si no existen
    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS idx_faltas_retardos_empleado_id ON faltas_retardos(empleado_id);
      CREATE INDEX IF NOT EXISTS idx_faltas_retardos_fecha ON faltas_retardos(fecha);
      CREATE INDEX IF NOT EXISTS idx_faltas_retardos_tipo ON faltas_retardos(tipo);
      CREATE INDEX IF NOT EXISTS idx_faltas_retardos_fecha_registro ON faltas_retardos(fecha_registro);
    `);
  } catch (error) {
    logger.error('Error al crear/verificar tabla faltas_retardos:', error);
  }
}

// Inicializar tabla al arrancar el servidor
ensureFaltasRetardosTable();

// Función para asegurar que existe la tabla de asistencias
async function ensureAsistenciasTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS asistencias (
        id SERIAL PRIMARY KEY,
        empleado_id INTEGER,
        numero_empleado VARCHAR(50),
        nombre VARCHAR(255),
        fecha DATE NOT NULL,
        clock_in TIME,
        clock_out TIME,
        late TIME,
        absent BOOLEAN DEFAULT false,
        ot VARCHAR(50),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_empleado_asistencias FOREIGN KEY (empleado_id) REFERENCES empleados(id)
      );
    `);
    
    // Asegurar que la columna numero_empleado existe (por si la tabla ya existía sin esta columna)
    try {
      // Verificar si la columna existe antes de intentar agregarla
      const columnExists = await apoyosPool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'asistencias' AND column_name = 'numero_empleado';
      `);
      
      if (columnExists.rows.length === 0) {
        await apoyosPool.query(`
          ALTER TABLE asistencias ADD COLUMN numero_empleado VARCHAR(50);
        `);
        logger.info('Columna numero_empleado agregada a la tabla asistencias');
      } else {
        logger.debug('Columna numero_empleado ya existe en la tabla asistencias');
      }
    } catch (alterError) {
      // Ignorar si la columna ya existe
      if (!alterError.message.includes('already exists') && 
          !alterError.message.includes('duplicate column') &&
          !alterError.message.includes('column') && 
          !alterError.message.includes('exists')) {
        logger.warn('No se pudo agregar columna numero_empleado:', alterError.message);
      }
    }
    
    // Actualizar el tipo de columna late si ya existe como VARCHAR
    try {
      await apoyosPool.query(`
        ALTER TABLE asistencias 
        ALTER COLUMN late TYPE TIME USING late::TIME;
      `);
    } catch (error) {
      // Si falla, probablemente la columna ya es TIME o no existe, continuar
      if (!error.message.includes('does not exist') && !error.message.includes('cannot cast')) {
        logger.warn('No se pudo actualizar el tipo de columna late:', error.message);
      }
    }

    // Crear índices si no existen
    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS idx_asistencias_empleado_id ON asistencias(empleado_id);
      CREATE INDEX IF NOT EXISTS idx_asistencias_numero_empleado ON asistencias(numero_empleado);
      CREATE INDEX IF NOT EXISTS idx_asistencias_fecha ON asistencias(fecha);
      CREATE INDEX IF NOT EXISTS idx_asistencias_fecha_registro ON asistencias(fecha_registro);
    `);
  } catch (error) {
    logger.error('Error al crear/verificar tabla asistencias:', error);
  }
}

// Inicializar tabla de asistencias al arrancar el servidor
ensureAsistenciasTable();

// Ruta para guardar falta o retardo
app.post('/api/faltas-retardos', async (req, res) => {
  try {
    const {
      empleado_id,
      tipo,
      fecha,
      hora,
      hora_salida,
      tiempo_retardo,
      tiempo_extra,
      motivo,
      incidentes,
      accidentes,
      justificacion,
      registrado_por
    } = req.body;

    // Validar datos requeridos
    if (!empleado_id || !tipo || !fecha || !justificacion) {
      return res.status(400).json({
        error: 'Datos incompletos',
        message: 'Faltan campos requeridos: empleado_id, tipo, fecha, justificacion'
      });
    }

    // Validar tipo
    if (!['falta', 'retardo', 'tiempo_extra', 'incidente', 'accidente'].includes(tipo)) {
      return res.status(400).json({
        error: 'Tipo inválido',
        message: 'El tipo debe ser "falta", "retardo", "tiempo_extra", "incidente" o "accidente"'
      });
    }

    // Validar justificación
    if (!['si', 'no'].includes(justificacion)) {
      return res.status(400).json({
        error: 'Justificación inválida',
        message: 'La justificación debe ser "si" o "no"'
      });
    }

    // Verificar que el empleado existe
    const empleadoCheck = await apoyosPool.query(
      'SELECT id, nombre_completo FROM empleados WHERE id = $1',
      [empleado_id]
    );

    if (empleadoCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Empleado no encontrado',
        message: 'El empleado especificado no existe'
      });
    }

    // Obtener número de empleados activos en el momento del registro
    const activosQuery = `
      SELECT COUNT(*)::int AS total_activos
      FROM empleados
      WHERE (
        (activo = true)
        OR (CAST(activo AS TEXT) IN ('true','t','1','TRUE','True'))
      )
    `;
    let totalActivos = 0;
    try {
      const activosRes = await apoyosPool.query(activosQuery);
      totalActivos = (activosRes.rows[0] && activosRes.rows[0].total_activos) ? activosRes.rows[0].total_activos : 0;
    } catch (e) {
      // Si falla el conteo, continuar con 0 para no bloquear el registro
      totalActivos = 0;
    }

    // Asegurar que la fecha se maneje como DATE sin zona horaria
    // Si viene como string "YYYY-MM-DD", usarlo directamente
    // Si viene como objeto Date, extraer solo la parte de fecha
    let fechaFormateada = fecha;
    if (fecha instanceof Date) {
      // Si es un objeto Date, convertir a string YYYY-MM-DD en hora local
      const year = fecha.getFullYear();
      const month = String(fecha.getMonth() + 1).padStart(2, '0');
      const day = String(fecha.getDate()).padStart(2, '0');
      fechaFormateada = `${year}-${month}-${day}`;
    } else if (typeof fecha === 'string') {
      // Si es string, asegurarse de que esté en formato YYYY-MM-DD
      // Eliminar cualquier componente de tiempo si existe
      fechaFormateada = fecha.split('T')[0].split(' ')[0];
    }

    // Insertar registro incluyendo empleados_total (texto)
    const result = await apoyosPool.query(`
      INSERT INTO faltas_retardos 
      (empleado_id, tipo, fecha, hora, hora_salida, tiempo_retardo, tiempo_extra, motivo, incidentes, accidentes, justificacion, registrado_por, empleados_total)
      VALUES ($1, $2, $3::DATE, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      empleado_id,
      tipo,
      fechaFormateada,
      hora || null,
      hora_salida || null,
      tiempo_retardo || null,
      tiempo_extra || null,
      motivo || null,
      incidentes || null,
      accidentes || null,
      justificacion,
      registrado_por || 'Sistema',
      totalActivos
    ]);

    res.json({
      success: true,
      message: 'Registro guardado exitosamente',
      data: result.rows[0]
    });

  } catch (error) {
    logger.error('Error al guardar falta/retardo:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// Ruta para obtener faltas y retardos
app.get('/api/faltas-retardos', async (req, res) => {
  try {
    const { empleado_id, tipo, fecha_inicio, fecha_fin, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        fr.*,
        e.nombre_completo,
        e.puesto,
        e.departamento,
        e.supervisor
      FROM faltas_retardos fr
      JOIN empleados e ON fr.empleado_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (empleado_id) {
      paramCount++;
      query += ` AND fr.empleado_id = $${paramCount}`;
      params.push(empleado_id);
    }

    if (tipo) {
      paramCount++;
      query += ` AND fr.tipo = $${paramCount}`;
      params.push(tipo);
    }

    if (fecha_inicio) {
      paramCount++;
      query += ` AND fr.fecha >= $${paramCount}`;
      params.push(fecha_inicio);
    }

    if (fecha_fin) {
      paramCount++;
      query += ` AND fr.fecha <= $${paramCount}`;
      params.push(fecha_fin);
    }

    query += ` ORDER BY fr.fecha_registro DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await apoyosPool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    logger.error('Error al obtener faltas/retardos:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// Ruta para importar asistencias desde Excel
app.post('/api/asistencias/importar', async (req, res) => {
  try {
    const { asistencias } = req.body;

    if (!asistencias || !Array.isArray(asistencias) || asistencias.length === 0) {
      return res.status(400).json({
        error: 'Datos inválidos',
        message: 'Se requiere un array de asistencias'
      });
    }

    const resultados = {
      importados: 0,
      errores: [],
      duplicados: 0,
      filasConError: [] // Guardar las filas del Excel que tuvieron errores
    };

    // Procesar cada asistencia
    for (let i = 0; i < asistencias.length; i++) {
      const asist = asistencias[i];
      
      // Variables que pueden ser usadas en el catch
      let empleadoId = null;
      let fechaFormateada = null;
      let registroExistenteId = null;
      let clockInFormateado = null;
      let clockOutFormateado = null;
      let lateFormateado = null;
      
      logger.info(`Procesando fila ${i + 1} de ${asistencias.length}:`, {
        numero_empleado: asist.numero_empleado,
        nombre: asist.nombre,
        fecha: asist.fecha,
        clock_in: asist.clock_in,
        clock_out: asist.clock_out,
        late: asist.late
      });
      
      try {
        // Validar campos requeridos
        if (!asist.fecha) {
          logger.warn(`Fila ${i + 1}: Fecha faltante`);
          const errorMsg = `Fila ${i + 1}: Fecha faltante`;
          resultados.errores.push(errorMsg);
          // Guardar la fila del Excel que falló
          resultados.filasConError.push({
            numeroFila: i + 1,
            error: errorMsg,
            camposNoIngresados: ['Fecha'],
            datosOriginales: {
              numero_empleado: asist.numero_empleado || '-',
              nombre: asist.nombre || '-',
              fecha: asist.fecha || '-',
              clock_in: asist.clock_in || '-',
              clock_out: asist.clock_out || '-',
              late: asist.late || '-',
              absent: asist.absent || '-',
              ot: asist.ot || '-',
              hora_salida: asist.hora_salida || '-',
              tiempo_retardo: asist.tiempo_retardo || '-',
              tiempo_extra: asist.tiempo_extra || '-'
            }
          });
          continue;
        }

        // Buscar empleado
        empleadoId = null;
        
        logger.debug(`Buscando empleado para fila ${i + 1}:`, {
          numero_empleado: asist.numero_empleado,
          nombre: asist.nombre,
          tiene_retardo_o_falta: asist.tiene_retardo_o_falta,
          absent: asist.absent,
          late: asist.late
        });
        
        // Si hay retardo o falta, buscar SOLO por número de empleado (ID)
        if (asist.tiene_retardo_o_falta || asist.absent || asist.late) {
          if (asist.numero_empleado) {
            // Buscar por número de empleado (ID) - más preciso
            const empQuery = await apoyosPool.query(
              `SELECT id FROM empleados WHERE id::text = $1 OR CAST(id AS TEXT) = $1 LIMIT 1`,
              [asist.numero_empleado]
            );
            if (empQuery.rows.length > 0) {
              empleadoId = empQuery.rows[0].id;
            }
          }
          
          // Si hay retardo o falta y no se encontró por ID, es un error
          if (!empleadoId && (asist.absent || asist.late)) {
            const errorMsg = `Fila ${i + 1}: Empleado con ID ${asist.numero_empleado} no encontrado (requerido para retardo/falta)`;
            resultados.errores.push(errorMsg);
            // Guardar la fila del Excel que falló
            resultados.filasConError.push({
              numeroFila: i + 1,
              error: errorMsg,
              camposNoIngresados: ['Número de empleado'],
              datosOriginales: {
                numero_empleado: asist.numero_empleado || '-',
                nombre: asist.nombre || '-',
                fecha: asist.fecha || '-',
                clock_in: asist.clock_in || '-',
                clock_out: asist.clock_out || '-',
                late: asist.late || '-',
                absent: asist.absent || '-',
                ot: asist.ot || '-',
                hora_salida: asist.hora_salida || '-',
                tiempo_retardo: asist.tiempo_retardo || '-',
                tiempo_extra: asist.tiempo_extra || '-'
              }
            });
            continue;
          }
        } else {
          // Si no hay retardo ni falta, buscar por número o nombre
          if (asist.numero_empleado) {
            const empQuery = await apoyosPool.query(
              `SELECT id FROM empleados WHERE id::text = $1 OR CAST(id AS TEXT) = $1 LIMIT 1`,
              [asist.numero_empleado]
            );
            if (empQuery.rows.length > 0) {
              empleadoId = empQuery.rows[0].id;
            }
          }
          
          // Si no se encontró por número, buscar por nombre
          if (!empleadoId && asist.nombre) {
            const empQuery = await apoyosPool.query(
              `SELECT id FROM empleados WHERE nombre_completo ILIKE $1 LIMIT 1`,
              [`%${asist.nombre}%`]
            );
            if (empQuery.rows.length > 0) {
              empleadoId = empQuery.rows[0].id;
            }
          }
        }

        // Formatear fecha
        fechaFormateada = asist.fecha;
        logger.debug(`Fecha original: ${fechaFormateada}`);
        if (fechaFormateada.includes('/')) {
          const partes = fechaFormateada.split('/');
          if (partes.length === 3) {
            fechaFormateada = `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
          }
        }
        fechaFormateada = fechaFormateada.split('T')[0];
        logger.debug(`Fecha formateada: ${fechaFormateada}`);

        // Verificar si ya existe un registro para esta fecha y empleado
        // Si existe, actualizar en lugar de omitir (para archivos de salidas)
        registroExistenteId = null;
        if (empleadoId) {
          const existeQuery = await apoyosPool.query(
            `SELECT id FROM asistencias WHERE empleado_id = $1 AND fecha = $2::DATE LIMIT 1`,
            [empleadoId, fechaFormateada]
          );
          if (existeQuery.rows.length > 0) {
            registroExistenteId = existeQuery.rows[0].id;
          }
        }

        // Validar formato de horas (asegurar formato 24 horas HH:MM:SS)
        clockInFormateado = asist.clock_in;
        clockOutFormateado = asist.clock_out;
        lateFormateado = asist.late;
        
        // Función para validar y formatear hora a formato 24 horas
        function formatearHora24(hora) {
          if (!hora) return null;
          
          // Si ya está en formato HH:MM:SS, validar y retornar
          if (typeof hora === 'string' && hora.match(/^\d{2}:\d{2}:\d{2}$/)) {
            const partes = hora.split(':');
            const horas = parseInt(partes[0]);
            const minutos = parseInt(partes[1]);
            const segundos = parseInt(partes[2]);
            
            // Validar rango 24 horas
            if (horas >= 0 && horas <= 23 && minutos >= 0 && minutos <= 59 && segundos >= 0 && segundos <= 59) {
              return hora;
            }
          }
          
          // Si está en formato HH:MM, agregar segundos
          if (typeof hora === 'string' && hora.match(/^\d{2}:\d{2}$/)) {
            return `${hora}:00`;
          }
          
          return null;
        }
        
        clockInFormateado = formatearHora24(clockInFormateado);
        clockOutFormateado = formatearHora24(clockOutFormateado);
        lateFormateado = formatearHora24(lateFormateado);
        
        logger.debug(`Horas formateadas para fila ${i + 1}:`, {
          clockInFormateado,
          clockOutFormateado,
          lateFormateado,
          empleadoId,
          fechaFormateada
        });

        // Calcular tiempo extra si la salida es después de las 16:00
        let tiempoExtraCalculado = null;
        if (clockOutFormateado) {
          const [horasSalida, minutosSalida] = clockOutFormateado.split(':').map(Number);
          const horaSalidaTotal = horasSalida * 60 + minutosSalida;
          const horaBaseTotal = 16 * 60; // 16:00 en minutos
          
          if (horaSalidaTotal > horaBaseTotal) {
            const minutosExtra = horaSalidaTotal - horaBaseTotal;
            const horasExtra = Math.floor(minutosExtra / 60);
            const minsExtra = minutosExtra % 60;
            tiempoExtraCalculado = `${String(horasExtra).padStart(2, '0')}:${String(minsExtra).padStart(2, '0')}:00`;
          }
        }

        // Validar que al menos haya fecha y algún dato de hora o empleado
        if (!fechaFormateada) {
          logger.warn(`Fila ${i + 1}: No se pudo formatear la fecha`);
          const errorMsg = `Fila ${i + 1}: Fecha inválida`;
          resultados.errores.push(errorMsg);
          // Guardar la fila del Excel que falló
          resultados.filasConError.push({
            numeroFila: i + 1,
            error: errorMsg,
            camposNoIngresados: ['Fecha'],
            datosOriginales: {
              numero_empleado: asist.numero_empleado || '-',
              nombre: asist.nombre || '-',
              fecha: asist.fecha || '-',
              clock_in: asist.clock_in || '-',
              clock_out: asist.clock_out || '-',
              late: asist.late || '-',
              absent: asist.absent || '-',
              ot: asist.ot || '-',
              hora_salida: asist.hora_salida || '-',
              tiempo_retardo: asist.tiempo_retardo || '-',
              tiempo_extra: asist.tiempo_extra || '-'
            }
          });
          continue;
        }

        // Convertir absent a booleano correctamente
        let absentValue = null;
        if (asist.absent !== undefined && asist.absent !== null && asist.absent !== '') {
          // Si es booleano, usarlo directamente
          if (typeof asist.absent === 'boolean') {
            absentValue = asist.absent;
          } 
          // Si es string, convertir a booleano
          else if (typeof asist.absent === 'string') {
            const absentStr = asist.absent.toLowerCase().trim();
            absentValue = absentStr === 'true' || absentStr === '1' || absentStr === 'yes' || absentStr === 'sí';
          }
          // Si es número, convertir a booleano
          else if (typeof asist.absent === 'number') {
            absentValue = asist.absent !== 0;
          }
        }

        // NO insertar en tabla asistencias - solo usar faltas_retardos
        // Si no hay retardo, ni falta, ni tiempo extra, simplemente no hacer nada
        const tiempoExtraFormateadoPrev = formatearHora24(asist.tiempo_extra);
        if (!lateFormateado && !absentValue && !tiempoExtraCalculado && !tiempoExtraFormateadoPrev) {
          logger.info(`Fila ${i + 1}: Sin retardo, falta ni tiempo extra - no se guarda nada`);
          continue;
        }
        
        // Verificar que se encontró el empleado
        if (!empleadoId) {
          const errorMsg = `Fila ${i + 1}: No se pudo identificar al empleado`;
          resultados.errores.push(errorMsg);
          resultados.filasConError.push({
            numeroFila: i + 1,
            error: errorMsg,
            camposNoIngresados: ['Número de empleado'],
            datosOriginales: {
              numero_empleado: asist.numero_empleado || '-',
              nombre: asist.nombre || '-',
              fecha: asist.fecha || '-',
              clock_in: asist.clock_in || '-',
              clock_out: asist.clock_out || '-',
              late: asist.late || '-',
              absent: asist.absent || '-',
              ot: asist.ot || '-',
              hora_salida: asist.hora_salida || '-',
              tiempo_retardo: asist.tiempo_retardo || '-',
              tiempo_extra: asist.tiempo_extra || '-'
            }
          });
          continue;
        }

        // Calcular tiempo de retardo basado en la hora de entrada si hay late
        let tiempoRetardoCalculado = null;
        if (lateFormateado && clockInFormateado) {
          // El retardo es la diferencia entre la hora de entrada y la hora estándar (08:00)
          const [horaEntrada, minutoEntrada] = clockInFormateado.split(':').map(Number);
          const horaEntradaTotal = horaEntrada * 60 + minutoEntrada;
          const horaBaseTotal = 8 * 60; // 08:00 en minutos
          
          if (horaEntradaTotal > horaBaseTotal) {
            const minutosRetardo = horaEntradaTotal - horaBaseTotal;
            const horasRetardo = Math.floor(minutosRetardo / 60);
            const minsRetardo = minutosRetardo % 60;
            tiempoRetardoCalculado = `${String(horasRetardo).padStart(2, '0')}:${String(minsRetardo).padStart(2, '0')}:00`;
          } else {
            tiempoRetardoCalculado = '00:00:00';
          }
        }

        // Si hay retardo (late), tiempo extra, o falta, también guardar en la tabla faltas_retardos
        const tiempoExtraFormateadoPrev2 = formatearHora24(asist.tiempo_extra);
        
        // Manejar retardo y/o tiempo extra
        if ((lateFormateado || tiempoExtraCalculado || tiempoExtraFormateadoPrev2) && empleadoId) {
          try {
            // Determinar el tipo basado en los datos
            let tipoRegistro = asist.tipo || 'retardo'; // Usar el tipo del frontend si existe
            if (!asist.tipo) {
              // Si no viene el tipo, calcularlo
              const tieneRetardo = tiempoRetardoCalculado || lateFormateado || asist.tiempo_retardo;
              const tieneExtra = tiempoExtraCalculado || tiempoExtraFormateadoPrev2;
              if (tieneRetardo && tieneExtra) {
                // Cuando hay ambos, usar orden alfabético para consistencia
                // "retardo, tiempo_extra" es el valor esperado
                tipoRegistro = 'retardo, tiempo_extra';
              } else if (tieneExtra) {
                tipoRegistro = 'tiempo_extra';
              } else {
                tipoRegistro = 'retardo';
              }
            }
            
            // Verificar si ya existe un registro para esta fecha y empleado (buscar por cualquier tipo)
            const existeRegistroQuery = await apoyosPool.query(
              `SELECT id, tipo FROM faltas_retardos 
               WHERE empleado_id = $1 AND fecha = $2::DATE 
               AND (tipo = 'retardo' OR tipo = 'tiempo_extra' OR tipo = 'retardo, tiempo_extra' OR tipo = 'tiempo_extra, retardo')
               LIMIT 1`,
              [empleadoId, fechaFormateada]
            );

            // Asegurar que las columnas existan antes de insertar/actualizar
            try {
              await apoyosPool.query(`
                ALTER TABLE faltas_retardos ADD COLUMN IF NOT EXISTS hora_salida TIME;
                ALTER TABLE faltas_retardos ADD COLUMN IF NOT EXISTS tiempo_retardo TIME;
                ALTER TABLE faltas_retardos ADD COLUMN IF NOT EXISTS tiempo_extra TIME;
              `);
            } catch (alterError) {
              // Ignorar errores de columnas ya existentes
              logger.debug('Columnas ya existen o error al agregarlas:', alterError.message);
            }

            const horaSalidaFormateada = formatearHora24(asist.hora_salida) || clockOutFormateado;
            const tiempoRetardoFormateado = formatearHora24(asist.tiempo_retardo) || tiempoRetardoCalculado || lateFormateado;
            const tiempoExtraFormateado = formatearHora24(asist.tiempo_extra) || tiempoExtraCalculado;

            // La columna 'hora' debe contener la hora de entrada (clock_in), no el retardo
            // El tiempo de retardo va en 'tiempo_retardo'
            const horaEntradaParaRetardo = clockInFormateado || lateFormateado;
            
            if (existeRegistroQuery.rows.length === 0) {
              // Insertar en faltas_retardos (incluye retardo y/o tiempo extra)
              await apoyosPool.query(`
                INSERT INTO faltas_retardos 
                (empleado_id, tipo, fecha, hora, hora_salida, tiempo_retardo, tiempo_extra, motivo, justificacion, registrado_por)
                VALUES ($1, $2, $3::DATE, $4::TIME, $5::TIME, $6::TIME, $7::TIME, $8, $9, $10)
              `, [
                empleadoId,
                tipoRegistro, // Usar el tipo calculado/recibido
                fechaFormateada,
                horaEntradaParaRetardo, // Hora de entrada real (clock_in)
                horaSalidaFormateada,
                tiempoRetardoFormateado, // Tiempo de retardo calculado
                tiempoExtraFormateado,
                null, // motivo = null
                'no', // justificacion = 'no' (la tabla requiere 'si' o 'no', no puede ser null)
                'Sistema'
              ]);
              
              const descripcionTipo = tipoRegistro === 'retardo, tiempo_extra' ? 'Retardo y tiempo extra' : 
                                      tipoRegistro === 'tiempo_extra' ? 'Tiempo extra' : 'Retardo';
              logger.info(`${descripcionTipo} guardado en faltas_retardos para empleado ${empleadoId} (número: ${asist.numero_empleado}), fecha ${fechaFormateada}, hora entrada: ${horaEntradaParaRetardo}, tiempo retardo: ${tiempoRetardoFormateado}, tiempo extra: ${tiempoExtraFormateado}`);
              resultados.importados++;
            } else {
              // Actualizar registro existente (archivo de salidas)
              const registroId = existeRegistroQuery.rows[0].id;
              await apoyosPool.query(`
                UPDATE faltas_retardos 
                SET tipo = $1,
                    hora = COALESCE($2, hora),
                    hora_salida = COALESCE($3, hora_salida),
                    tiempo_retardo = COALESCE($4, tiempo_retardo),
                    tiempo_extra = COALESCE($5, tiempo_extra)
                WHERE id = $6
              `, [
                tipoRegistro, // Actualizar el tipo también
                horaEntradaParaRetardo, // Hora de entrada real (clock_in)
                horaSalidaFormateada,
                tiempoRetardoFormateado, // Tiempo de retardo calculado
                tiempoExtraFormateado,
                registroId
              ]);
              
              logger.info(`Registro actualizado en faltas_retardos para empleado ${empleadoId}, fecha ${fechaFormateada}, tipo: ${tipoRegistro}, hora entrada: ${horaEntradaParaRetardo}, tiempo retardo: ${tiempoRetardoFormateado}, tiempo extra: ${tiempoExtraFormateado}`);
              resultados.duplicados++;
            }
          } catch (retardoError) {
            const detallesRetardoError = {
              message: retardoError.message,
              stack: retardoError.stack,
              empleadoId,
              fechaFormateada,
              lateFormateado,
              horaSalidaFormateada: formatearHora24(asist.hora_salida) || clockOutFormateado,
              tiempoRetardoFormateado: formatearHora24(asist.tiempo_retardo) || lateFormateado,
              tiempoExtraFormateado: formatearHora24(asist.tiempo_extra) || tiempoExtraCalculado
            };
            logger.error(`Error al guardar retardo en faltas_retardos para fila ${i + 1}: ${retardoError.message}`);
            logger.error(`Detalles del error: ${JSON.stringify(detallesRetardoError, null, 2)}`);
            // No fallar la importación completa si falla el retardo
            let mensajeErrorRetardo = `Fila ${i + 1}: Error al guardar retardo`;
            const camposNoIngresadosRetardo = [];
            const errorMsgRetardo = retardoError.message.toLowerCase();
            
            if (errorMsgRetardo.includes('numero_empleado') || errorMsgRetardo.includes('no existe la columna')) {
              camposNoIngresadosRetardo.push('Número de empleado');
            }
            if (errorMsgRetardo.includes('hora') || errorMsgRetardo.includes('time')) {
              camposNoIngresadosRetardo.push('Hora');
            }
            if (errorMsgRetardo.includes('tiempo_retardo')) {
              camposNoIngresadosRetardo.push('Tiempo de retardo');
            }
            if (errorMsgRetardo.includes('tiempo_extra')) {
              camposNoIngresadosRetardo.push('Tiempo extra');
            }
            if (errorMsgRetardo.includes('hora_salida')) {
              camposNoIngresadosRetardo.push('Hora de salida');
            }
            
            if (camposNoIngresadosRetardo.length > 0) {
              mensajeErrorRetardo += ` - Campos no ingresados correctamente: ${camposNoIngresadosRetardo.join(', ')}. ${retardoError.message}`;
            } else {
              mensajeErrorRetardo += `: ${retardoError.message}`;
            }
            
            resultados.errores.push(mensajeErrorRetardo);
            // Guardar la fila del Excel que falló (solo si no está ya guardada)
            const yaExisteRetardo = resultados.filasConError.some(f => f.numeroFila === i + 1);
            if (!yaExisteRetardo) {
              resultados.filasConError.push({
                numeroFila: i + 1,
                error: mensajeErrorRetardo,
                camposNoIngresados: camposNoIngresadosRetardo,
                datosOriginales: {
                  numero_empleado: asist.numero_empleado || '-',
                  nombre: asist.nombre || '-',
                  fecha: asist.fecha || '-',
                  clock_in: asist.clock_in || '-',
                  clock_out: asist.clock_out || '-',
                  late: asist.late || '-',
                  absent: asist.absent || '-',
                  ot: asist.ot || '-',
                  hora_salida: asist.hora_salida || '-',
                  tiempo_retardo: asist.tiempo_retardo || '-',
                  tiempo_extra: asist.tiempo_extra || '-'
                }
              });
            }
          }
        }
        
        // Si hay falta (absent), guardar en la tabla faltas_retardos
        if (absentValue && empleadoId) {
          try {
            // Verificar si ya existe una falta para esta fecha y empleado
            const existeFaltaQuery = await apoyosPool.query(
              `SELECT id FROM faltas_retardos 
               WHERE empleado_id = $1 AND fecha = $2::DATE AND tipo = 'falta' LIMIT 1`,
              [empleadoId, fechaFormateada]
            );

            if (existeFaltaQuery.rows.length === 0) {
              // Insertar falta en faltas_retardos
              await apoyosPool.query(`
                INSERT INTO faltas_retardos 
                (empleado_id, tipo, fecha, motivo, justificacion, registrado_por)
                VALUES ($1, $2, $3::DATE, $4, $5, $6)
              `, [
                empleadoId,
                'falta',
                fechaFormateada,
                null, // motivo = null
                'no', // justificacion = 'no'
                'Sistema'
              ]);
              
              logger.info(`Falta guardada en faltas_retardos para empleado ${empleadoId} (número: ${asist.numero_empleado}), fecha ${fechaFormateada}`);
              resultados.importados++;
            } else {
              logger.info(`Falta ya existe para empleado ${empleadoId}, fecha ${fechaFormateada} - no se actualiza`);
              resultados.duplicados++;
            }
          } catch (faltaError) {
            logger.error(`Error al guardar falta en faltas_retardos para fila ${i + 1}: ${faltaError.message}`);
            const mensajeErrorFalta = `Fila ${i + 1}: Error al guardar falta: ${faltaError.message}`;
            resultados.errores.push(mensajeErrorFalta);
            resultados.filasConError.push({
              numeroFila: i + 1,
              error: mensajeErrorFalta,
              camposNoIngresados: ['Falta'],
              datosOriginales: {
                numero_empleado: asist.numero_empleado || '-',
                nombre: asist.nombre || '-',
                fecha: asist.fecha || '-',
                clock_in: asist.clock_in || '-',
                clock_out: asist.clock_out || '-',
                late: asist.late || '-',
                absent: asist.absent || '-',
                ot: asist.ot || '-',
                hora_salida: asist.hora_salida || '-',
                tiempo_retardo: asist.tiempo_retardo || '-',
                tiempo_extra: asist.tiempo_extra || '-'
              }
            });
          }
        }

      } catch (error) {
        const detallesError = {
          message: error.message,
          stack: error.stack,
          nombre: error.name,
          datosAsistencia: {
            numero_empleado: asist.numero_empleado,
            nombre: asist.nombre,
            fecha: asist.fecha,
            clock_in: asist.clock_in,
            clock_out: asist.clock_out,
            late: asist.late,
            absent: asist.absent,
            ot: asist.ot,
            hora_salida: asist.hora_salida,
            tiempo_retardo: asist.tiempo_retardo,
            tiempo_extra: asist.tiempo_extra,
            tiene_retardo_o_falta: asist.tiene_retardo_o_falta
          },
          empleadoId: (typeof empleadoId !== 'undefined' && empleadoId !== null) ? empleadoId : 'NO ENCONTRADO',
          fechaFormateada: (typeof fechaFormateada !== 'undefined' && fechaFormateada !== null) ? fechaFormateada : 'NO FORMATEADA',
          registroExistenteId: (typeof registroExistenteId !== 'undefined' && registroExistenteId !== null) ? registroExistenteId : 'NO EXISTE',
          clockInFormateado: (typeof clockInFormateado !== 'undefined' && clockInFormateado !== null) ? clockInFormateado : 'NO FORMATEADO',
          clockOutFormateado: (typeof clockOutFormateado !== 'undefined' && clockOutFormateado !== null) ? clockOutFormateado : 'NO FORMATEADO',
          lateFormateado: (typeof lateFormateado !== 'undefined' && lateFormateado !== null) ? lateFormateado : 'NO FORMATEADO'
        };
        logger.error(`Error al importar asistencia fila ${i + 1}: ${error.message}`);
        logger.error(`Detalles del error en fila ${i + 1}: ${JSON.stringify(detallesError, null, 2)}`);
        // Analizar el error y crear un mensaje más descriptivo
        let mensajeError = `Fila ${i + 1}: Error al procesar asistencia`;
        const camposNoIngresados = [];
        const errorMsg = error.message.toLowerCase();
        
        if (errorMsg.includes('numero_empleado') || errorMsg.includes('no existe la columna')) {
          camposNoIngresados.push('Número de empleado');
        }
        if (errorMsg.includes('fecha') || errorMsg.includes('date')) {
          camposNoIngresados.push('Fecha');
        }
        if (errorMsg.includes('clock_in') || errorMsg.includes('entrada')) {
          camposNoIngresados.push('Hora de entrada');
        }
        if (errorMsg.includes('clock_out') || errorMsg.includes('salida')) {
          camposNoIngresados.push('Hora de salida');
        }
        if (errorMsg.includes('late') || errorMsg.includes('retardo')) {
          camposNoIngresados.push('Retardo');
        }
        if (errorMsg.includes('absent') || errorMsg.includes('falta')) {
          camposNoIngresados.push('Falta');
        }
        if (errorMsg.includes('boolean')) {
          camposNoIngresados.push('Campo booleano (Falta/Ausencia)');
        }
        if (errorMsg.includes('empleado') && errorMsg.includes('no encontrado')) {
          camposNoIngresados.push('Empleado no encontrado en la base de datos');
        }
        
        if (camposNoIngresados.length > 0) {
          mensajeError += ` - Campos no ingresados correctamente: ${camposNoIngresados.join(', ')}. ${error.message}`;
        } else {
          mensajeError += `: ${error.message}`;
        }
        
        resultados.errores.push(mensajeError);
      }
    }

    res.json({
      success: true,
      message: `Importación completada: ${resultados.importados} registros importados`,
      importados: resultados.importados,
      duplicados: resultados.duplicados,
      errores: resultados.errores,
      filasConError: resultados.filasConError,
      total: asistencias.length
    });

  } catch (error) {
    logger.error(`Error al importar asistencias: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// Ruta para actualizar falta o retardo
app.put('/api/faltas-retardos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      empleado_id,
      tipo,
      fecha,
      hora,
      hora_salida,
      tiempo_retardo,
      tiempo_extra,
      motivo,
      incidentes,
      accidentes,
      justificacion,
      registrado_por
    } = req.body;

    // Validar datos requeridos
    if (!empleado_id || !tipo || !fecha || !justificacion) {
      return res.status(400).json({
        error: 'Datos incompletos',
        message: 'Faltan campos requeridos: empleado_id, tipo, fecha, justificacion'
      });
    }

    // Validar tipo
    if (!['falta', 'retardo', 'tiempo_extra', 'incidente', 'accidente'].includes(tipo)) {
      return res.status(400).json({
        error: 'Tipo inválido',
        message: 'El tipo debe ser "falta", "retardo", "tiempo_extra", "incidente" o "accidente"'
      });
    }

    // Validar justificación
    if (!['si', 'no'].includes(justificacion)) {
      return res.status(400).json({
        error: 'Justificación inválida',
        message: 'La justificación debe ser "si" o "no"'
      });
    }

    // Verificar que el registro existe
    const registroCheck = await apoyosPool.query(
      'SELECT id FROM faltas_retardos WHERE id = $1',
      [id]
    );

    if (registroCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Registro no encontrado',
        message: 'El registro especificado no existe'
      });
    }

    // Verificar que el empleado existe
    const empleadoCheck = await apoyosPool.query(
      'SELECT id, nombre_completo FROM empleados WHERE id = $1',
      [empleado_id]
    );

    if (empleadoCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Empleado no encontrado',
        message: 'El empleado especificado no existe'
      });
    }

    // Asegurar que la fecha se maneje como DATE sin zona horaria
    let fechaFormateada = fecha;
    if (fecha instanceof Date) {
      // Si es un objeto Date, convertir a string YYYY-MM-DD en hora local
      const year = fecha.getFullYear();
      const month = String(fecha.getMonth() + 1).padStart(2, '0');
      const day = String(fecha.getDate()).padStart(2, '0');
      fechaFormateada = `${year}-${month}-${day}`;
    } else if (typeof fecha === 'string') {
      // Si es string, asegurarse de que esté en formato YYYY-MM-DD
      // Eliminar cualquier componente de tiempo si existe
      fechaFormateada = fecha.split('T')[0].split(' ')[0];
    }

    // Actualizar registro
    const result = await apoyosPool.query(
      `UPDATE faltas_retardos 
       SET empleado_id = $1, tipo = $2, fecha = $3::DATE, hora = $4, hora_salida = $5, tiempo_retardo = $6, tiempo_extra = $7, motivo = $8, incidentes = $9, accidentes = $10, justificacion = $11, registrado_por = $12
       WHERE id = $13
       RETURNING *`,
      [
        empleado_id,
        tipo,
        fechaFormateada,
        hora || null,
        hora_salida || null,
        tiempo_retardo || null,
        tiempo_extra || null,
        motivo || null,
        incidentes || null,
        accidentes || null,
        justificacion,
        registrado_por || 'Sistema',
        id
      ]
    );

    res.json({
      success: true,
      message: 'Registro actualizado exitosamente',
      data: result.rows[0]
    });

  } catch (error) {
    logger.error('Error al actualizar falta/retardo:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// Ruta para eliminar falta o retardo
app.delete('/api/faltas-retardos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que el registro existe
    const registroCheck = await apoyosPool.query(
      'SELECT id FROM faltas_retardos WHERE id = $1',
      [id]
    );

    if (registroCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Registro no encontrado',
        message: 'El registro especificado no existe'
      });
    }

    // Eliminar el registro
    await apoyosPool.query(
      'DELETE FROM faltas_retardos WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      message: 'Registro eliminado exitosamente'
    });

  } catch (error) {
    logger.error('Error al eliminar falta/retardo:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// ===== RUTAS PARA PERMISOS =====

// Crear tabla de permisos si no existe
async function ensurePermisosTable() {
  try {
    await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS permisos (
        id SERIAL PRIMARY KEY,
        empleado_id INTEGER NOT NULL,
        tipo VARCHAR(50) NOT NULL,
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL,
        tiempo_llegada TIME,
        tiempo_salida TIME,
        motivo TEXT NOT NULL,
        notas TEXT,
        notas_postpermiso VARCHAR(255),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
        aprobado_por VARCHAR(100),
        fecha_aprobacion TIMESTAMP,
        CONSTRAINT fk_empleado_permisos FOREIGN KEY (empleado_id) REFERENCES empleados(id)
      );
    `);

    // Migración: eliminar constraints y columnas antiguas, agregar nuevas columnas
    try {
      // Eliminar constraint CHECK antiguo en la columna "tipo" si existe
      try {
        // Intentar eliminar el constraint con el nombre más común
        await apoyosPool.query(`ALTER TABLE permisos DROP CONSTRAINT IF EXISTS permisos_tipo_check;`);
        
        // Buscar y eliminar otros constraints CHECK relacionados con "tipo"
        const checkConstraints = await apoyosPool.query(`
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE table_name = 'permisos' 
          AND constraint_type = 'CHECK'
          AND (constraint_name LIKE '%tipo%' OR constraint_name LIKE '%permisos%check%')
        `);
        
        for (const constraint of checkConstraints.rows) {
          try {
            await apoyosPool.query(`ALTER TABLE permisos DROP CONSTRAINT IF EXISTS ${constraint.constraint_name} CASCADE;`);
            logger.info(`Constraint "${constraint.constraint_name}" eliminado de la tabla permisos`);
          } catch (err) {
            logger.warn(`No se pudo eliminar constraint "${constraint.constraint_name}":`, err.message);
          }
        }
      } catch (error) {
        logger.warn('Error al eliminar constraints CHECK (puede ser normal si no existen):', error.message);
      }
      
      // Verificar si existe la columna "fecha" antigua
      const checkFecha = await apoyosPool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'permisos' AND column_name = 'fecha'
      `);
      
      if (checkFecha.rows.length > 0) {
        // Primero agregar las nuevas columnas si no existen
        await apoyosPool.query(`
          ALTER TABLE permisos 
          ADD COLUMN IF NOT EXISTS fecha_inicio DATE,
          ADD COLUMN IF NOT EXISTS fecha_fin DATE;
        `);
        
        // Migrar datos de "fecha" a "fecha_inicio" y "fecha_fin" si hay datos
        await apoyosPool.query(`
          UPDATE permisos 
          SET fecha_inicio = fecha, fecha_fin = fecha 
          WHERE fecha IS NOT NULL AND (fecha_inicio IS NULL OR fecha_fin IS NULL);
        `);
        
        // Ahora eliminar la columna "fecha" antigua
        await apoyosPool.query(`ALTER TABLE permisos DROP COLUMN IF EXISTS fecha;`);
        logger.info('Columna "fecha" antigua eliminada de la tabla permisos');
      }
      
      // Agregar nuevas columnas si no existen
      await apoyosPool.query(`
        ALTER TABLE permisos 
        ADD COLUMN IF NOT EXISTS fecha_inicio DATE,
        ADD COLUMN IF NOT EXISTS fecha_fin DATE,
        ADD COLUMN IF NOT EXISTS tiempo_salida TIME,
        ADD COLUMN IF NOT EXISTS notas TEXT,
        ADD COLUMN IF NOT EXISTS notas_postpermiso VARCHAR(255);
      `);
      
      // Actualizar el tamaño de la columna "tipo" si es muy pequeña
      try {
        const tipoInfo = await apoyosPool.query(`
          SELECT character_maximum_length 
          FROM information_schema.columns 
          WHERE table_name = 'permisos' AND column_name = 'tipo'
        `);
        
        if (tipoInfo.rows.length > 0 && parseInt(tipoInfo.rows[0].character_maximum_length) < 30) {
          await apoyosPool.query(`ALTER TABLE permisos ALTER COLUMN tipo TYPE VARCHAR(50);`);
          logger.info('Columna "tipo" actualizada a VARCHAR(50) en la tabla permisos');
        }
      } catch (error) {
        logger.warn('Error al actualizar tamaño de columna "tipo":', error.message);
      }
      
      // Establecer NOT NULL en fecha_inicio y fecha_fin solo si no hay datos nulos
      try {
        const countNulls = await apoyosPool.query(`
          SELECT COUNT(*) as count 
          FROM permisos 
          WHERE fecha_inicio IS NULL OR fecha_fin IS NULL
        `);
        
        if (countNulls.rows[0].count === '0') {
          await apoyosPool.query(`
            ALTER TABLE permisos 
            ALTER COLUMN fecha_inicio SET NOT NULL,
            ALTER COLUMN fecha_fin SET NOT NULL;
          `);
        }
      } catch (error) {
        // Ignorar si ya tienen NOT NULL
        logger.warn('No se pudo establecer NOT NULL en fecha_inicio/fecha_fin:', error.message);
      }
    } catch (error) {
      logger.warn('Error en migración de permisos (puede ser normal si la tabla ya está actualizada):', error.message);
    }

    // Crear índices si no existen
    await apoyosPool.query(`
      CREATE INDEX IF NOT EXISTS idx_permisos_empleado_id ON permisos(empleado_id);
      CREATE INDEX IF NOT EXISTS idx_permisos_fecha_inicio ON permisos(fecha_inicio);
      CREATE INDEX IF NOT EXISTS idx_permisos_fecha_fin ON permisos(fecha_fin);
      CREATE INDEX IF NOT EXISTS idx_permisos_tipo ON permisos(tipo);
      CREATE INDEX IF NOT EXISTS idx_permisos_estado ON permisos(estado);
      CREATE INDEX IF NOT EXISTS idx_permisos_fecha_registro ON permisos(fecha_registro);
    `);
  } catch (error) {
    logger.error('Error al crear/verificar tabla permisos:', error);
  }
}

// Inicializar tabla al arrancar el servidor
ensurePermisosTable();

// Ruta para guardar solicitud de permiso
app.post('/api/permisos', async (req, res) => {
  try {
    const {
      empleado_id,
      tipo,
      motivo,
      notas,
      tiempo_llegada,
      tiempo_salida,
      fecha_inicio,
      fecha_fin
    } = req.body;

    // Validar datos requeridos
    if (!empleado_id || !tipo || !motivo || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        error: 'Datos incompletos',
        message: 'Faltan campos requeridos: empleado_id, tipo, motivo, fecha_inicio, fecha_fin'
      });
    }

    // Validar tipo (todos los tipos posibles)
    const tiposValidos = [
      'dia_completo', 
      'retardo', 
      'paternidad', 
      'home_office', 
      'defuncion_familiar', 
      'falta_injustificada', 
      'capacitacion', 
      'festivo', 
      'usa', 
      'llegar_tarde_salida_normal',
      'salir_temprano',
      'salir_regresar'
    ];
    
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({
        error: 'Tipo inválido',
        message: `El tipo debe ser uno de: ${tiposValidos.join(', ')}`
      });
    }

    // Validar tiempos según el tipo de permiso
    const necesitaTiempoLlegada = ['retardo', 'llegar_tarde_salida_normal', 'salir_regresar'].includes(tipo);
    const necesitaTiempoSalida = ['salir_temprano', 'salir_regresar'].includes(tipo);
    
    if (necesitaTiempoLlegada && !tiempo_llegada) {
      return res.status(400).json({
        error: 'Tiempo de llegada requerido',
        message: 'Este tipo de permiso requiere especificar el tiempo de llegada'
      });
    }
    
    if (necesitaTiempoSalida && !tiempo_salida) {
      return res.status(400).json({
        error: 'Tiempo de salida requerido',
        message: 'Este tipo de permiso requiere especificar el tiempo de salida'
      });
    }

    // Validar que fecha_fin sea mayor o igual a fecha_inicio
    const inicio = new Date(fecha_inicio);
    const fin = new Date(fecha_fin);
    if (fin < inicio) {
      return res.status(400).json({
        error: 'Fechas inválidas',
        message: 'La fecha de fin debe ser mayor o igual a la fecha de inicio'
      });
    }

    // Verificar que el empleado existe
    const empleadoCheck = await apoyosPool.query(
      'SELECT id, nombre_completo FROM empleados WHERE id = $1',
      [empleado_id]
    );

    if (empleadoCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Empleado no encontrado',
        message: 'El empleado especificado no existe'
      });
    }

    // Asegurar que las fechas se manejen como DATE sin zona horaria
    let fechaInicioFormateada = fecha_inicio;
    let fechaFinFormateada = fecha_fin;
    
    if (fecha_inicio instanceof Date) {
      const year = fecha_inicio.getFullYear();
      const month = String(fecha_inicio.getMonth() + 1).padStart(2, '0');
      const day = String(fecha_inicio.getDate()).padStart(2, '0');
      fechaInicioFormateada = `${year}-${month}-${day}`;
    } else if (typeof fecha_inicio === 'string') {
      fechaInicioFormateada = fecha_inicio.split('T')[0].split(' ')[0];
    }
    
    if (fecha_fin instanceof Date) {
      const year = fecha_fin.getFullYear();
      const month = String(fecha_fin.getMonth() + 1).padStart(2, '0');
      const day = String(fecha_fin.getDate()).padStart(2, '0');
      fechaFinFormateada = `${year}-${month}-${day}`;
    } else if (typeof fecha_fin === 'string') {
      fechaFinFormateada = fecha_fin.split('T')[0].split(' ')[0];
    }

    // Insertar registro
    const result = await apoyosPool.query(`
      INSERT INTO permisos 
      (empleado_id, tipo, fecha_inicio, fecha_fin, tiempo_llegada, tiempo_salida, motivo, notas, estado)
      VALUES ($1, $2, $3::DATE, $4::DATE, $5, $6, $7, $8, 'pendiente')
      RETURNING *
    `, [
      empleado_id,
      tipo,
      fechaInicioFormateada,
      fechaFinFormateada,
      necesitaTiempoLlegada ? tiempo_llegada : null,
      necesitaTiempoSalida ? tiempo_salida : null,
      motivo,
      notas || null
    ]);

    res.json({
      success: true,
      message: 'Solicitud de permiso registrada exitosamente',
      data: result.rows[0]
    });

  } catch (error) {
    logger.error('Error al guardar permiso:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// Ruta para obtener permisos
app.get('/api/permisos', async (req, res) => {
  try {
    const { empleado_id, tipo, fecha_inicio, fecha_fin, limit = 10000, offset = 0 } = req.query;

    let query = `
      SELECT 
        p.*,
        e.nombre_completo,
        e.puesto,
        e.departamento,
        e.supervisor
      FROM permisos p
      JOIN empleados e ON p.empleado_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (empleado_id) {
      paramCount++;
      query += ` AND p.empleado_id = $${paramCount}`;
      params.push(empleado_id);
    }

    if (tipo) {
      paramCount++;
      query += ` AND p.tipo = $${paramCount}`;
      params.push(tipo);
    }

    if (fecha_inicio) {
      paramCount++;
      query += ` AND p.fecha_inicio >= $${paramCount}`;
      params.push(fecha_inicio);
    }

    if (fecha_fin) {
      paramCount++;
      query += ` AND p.fecha_fin <= $${paramCount}`;
      params.push(fecha_fin);
    }

    query += ` ORDER BY p.fecha_registro DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await apoyosPool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    logger.error('Error al obtener permisos:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// Endpoint para obtener permisos de un empleado específico
app.get('/api/permisos/empleado/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await apoyosPool.query(
      `SELECT 
        p.*,
        e.nombre_completo,
        e.puesto,
        e.departamento,
        e.supervisor
      FROM permisos p
      JOIN empleados e ON p.empleado_id = e.id
      WHERE p.empleado_id = $1
      ORDER BY p.fecha_registro DESC`,
      [id]
    );

    res.json(result.rows);

  } catch (error) {
    logger.error('Error al obtener permisos del empleado:', error);
    res.status(500).json({
      error: 'Error al obtener permisos',
      message: error.message
    });
  }
});

// Endpoint para actualizar la nota (notas) de un permiso específico
app.put('/api/permisos/:id/nota', async (req, res) => {
  try {
    const { id } = req.params;
    const { notas_postpermiso } = req.body || {};

    if (!id) {
      return res.status(400).json({ success: false, error: 'Falta el id del permiso' });
    }

    // Asegurar que la tabla existe
    await ensurePermisosTable();

    const result = await apoyosPool.query(
      `UPDATE permisos
       SET notas_postpermiso = $1
       WHERE id = $2
       RETURNING *`,
      [typeof notas_postpermiso === 'string' && notas_postpermiso.trim() ? notas_postpermiso.trim() : null, parseInt(id)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Permiso no encontrado' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error al actualizar nota del permiso:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al actualizar nota del permiso',
      message: error.message
    });
  }
});

// ==================== RUTAS PARA RECORDATORIOS/PRESENTACIONES ====================

// Función para asegurar que las tablas de recordatorios existen
async function ensureRecordatoriosTables() {
  try {
    logger.info('Verificando/creando tablas de recordatorios en apoyos_db...');
    
    // Tabla para almacenar presentaciones
    const createTable1 = await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS recordatorios_presentaciones (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size BIGINT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        uploaded_by VARCHAR(100),
        activar_automatico BOOLEAN DEFAULT false,
        hora_inicio TIME,
        hora_fin TIME
      );
    `);
    logger.info('Tabla recordatorios_presentaciones verificada/creada');
    
    // Agregar columnas de programación si no existen (migración)
    try {
      await apoyosPool.query(`
        ALTER TABLE recordatorios_presentaciones 
        ADD COLUMN IF NOT EXISTS activar_automatico BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS hora_inicio TIME,
        ADD COLUMN IF NOT EXISTS hora_fin TIME;
      `);
      logger.info('Columnas de programación agregadas a recordatorios_presentaciones');
    } catch (error) {
      logger.warn('Error al agregar columnas de programación (puede que ya existan):', error.message);
    }

    // Tabla para almacenar configuración de control remoto
    const createTable2 = await apoyosPool.query(`
      CREATE TABLE IF NOT EXISTS recordatorios_control (
        id SERIAL PRIMARY KEY,
        presentation_id INTEGER REFERENCES recordatorios_presentaciones(id) ON DELETE CASCADE,
        show_hora BOOLEAN DEFAULT true,
        formato_hora VARCHAR(10) DEFAULT '24',
        posicion_hora VARCHAR(20) DEFAULT 'top-right',
        is_active BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(presentation_id)
      );
    `);
    logger.info('Tabla recordatorios_control verificada/creada');
    
    // Agregar columnas si no existen (migración)
    try {
      await apoyosPool.query(`
        ALTER TABLE recordatorios_control 
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS activar_automatico BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS hora_inicio TIME,
        ADD COLUMN IF NOT EXISTS hora_fin TIME;
      `);
      logger.info('Columnas de programación verificadas/agregadas');
    } catch (error) {
      logger.warn('Error al agregar columnas (puede que ya existan):', error.message);
    }
    
    // Crear índice para is_active
    try {
      await apoyosPool.query(`
        CREATE INDEX IF NOT EXISTS idx_recordatorios_control_active 
        ON recordatorios_control(is_active) 
        WHERE is_active = true;
      `);
    } catch (error) {
      logger.warn('Error al crear índice is_active:', error.message);
    }

    // Crear índices (con manejo de errores individual)
    try {
      await apoyosPool.query(`
        CREATE INDEX IF NOT EXISTS idx_recordatorios_uploaded_at ON recordatorios_presentaciones(uploaded_at);
      `);
    } catch (error) {
      logger.warn('Error al crear índice uploaded_at (puede que ya exista):', error.message);
    }
    
    try {
      await apoyosPool.query(`
        CREATE INDEX IF NOT EXISTS idx_recordatorios_control_presentation ON recordatorios_control(presentation_id);
      `);
    } catch (error) {
      logger.warn('Error al crear índice control_presentation (puede que ya exista):', error.message);
    }
    
    logger.info('Índices de recordatorios verificados/creados');

    // Verificar que las tablas existen consultándolas (con manejo de errores)
    try {
      const checkTable = await apoyosPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'recordatorios_presentaciones'
        );
      `);
      
      if (checkTable.rows && checkTable.rows[0] && checkTable.rows[0].exists) {
        logger.info('✓ Tablas de recordatorios verificadas correctamente');
      } else {
        logger.warn('No se pudo verificar la existencia de las tablas, pero continuando...');
      }
    } catch (checkError) {
      logger.warn('Error al verificar existencia de tablas (continuando de todas formas):', checkError.message);
    }
    
    return true;
  } catch (error) {
    // Mejorar el logging del error
    const errorMessage = error?.message || String(error) || 'Error desconocido';
    const errorStack = error?.stack || 'No hay stack trace disponible';
    const errorCode = error?.code || 'Sin código';
    
    logger.error('Error al crear/verificar tablas de recordatorios:', error);
    logger.error('Mensaje de error:', errorMessage);
    logger.error('Stack trace:', errorStack);
    logger.error('Código de error:', errorCode);
    logger.error('Tipo de error:', typeof error);
    logger.error('Error completo:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // Si es un error de conexión o autenticación, re-lanzar
    if (error && error.code && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === '28P01')) {
      throw error;
    }
    
    if (error && errorMessage && (errorMessage.includes('password') || errorMessage.includes('authentication'))) {
      throw error;
    }
    
    // Para otros errores (como permisos, sintaxis, etc.), solo loguear y continuar
    logger.warn('Error no crítico al crear tablas, continuando de todas formas');
    return false; // Retornar false en lugar de lanzar error
  }
}

// Inicializar tablas al arrancar el servidor
// Asegurar que las tablas se creen antes de aceptar peticiones
let recordatoriosTablesReady = false;
ensureRecordatoriosTables().then(() => {
  recordatoriosTablesReady = true;
  logger.info('Tablas de recordatorios listas');
}).catch((error) => {
  logger.error('Error crítico al inicializar tablas de recordatorios:', error);
});

// Multer específico para PowerPoint
const pptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads', 'presentaciones');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

const uploadPPT = multer({
  storage: pptStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'application/vnd.ms-powerpoint', // .ppt
      'application/pdf', // .pdf
      'image/jpeg', // .jpg, .jpeg
      'image/png', // .png
      'image/gif', // .gif
      'image/webp', // .webp
      'image/bmp', // .bmp
      'image/svg+xml' // .svg
    ];
    if (allowedTypes.includes(file.mimetype) || 
        file.originalname.match(/\.(ppt|pptx|pdf|jpg|jpeg|png|gif|webp|bmp|svg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PowerPoint (.ppt, .pptx), PDF (.pdf) o imágenes (JPG, PNG, GIF, etc.)'));
    }
  }
});

// Ruta para subir presentación PowerPoint
app.post('/api/recordatorios/upload', uploadPPT.single('presentation'), async (req, res) => {
  let client = null;
  try {
    if (!req.file) {
      logger.warn('Intento de subir archivo sin archivo adjunto');
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    logger.info('=== INICIANDO SUBIDA DE PRESENTACIÓN ===');
    logger.info(`Archivo: ${req.file.originalname}`);
    logger.info(`Tamaño: ${req.file.size} bytes`);
    logger.info(`Ruta temporal: ${req.file.path}`);

    // Verificar conexión a la base de datos
    try {
      const testConnection = await apoyosPool.query('SELECT NOW()');
      logger.info('Conexión a base de datos verificada');
    } catch (dbError) {
      logger.error('Error de conexión a la base de datos:', dbError);
      logger.error('Configuración actual:', {
        host: process.env.APOYOS_DB_HOST || 'localhost',
        database: process.env.APOYOS_DB_NAME || 'apoyos_db',
        user: process.env.APOYOS_DB_USER || 'postgres',
        port: process.env.APOYOS_DB_PORT || '5432'
      });
      logger.error('Sugerencia: Verifica las variables de entorno APOYOS_DB_* o consulta CONFIGURACION_SERVIDOR.md');
      return res.status(500).json({ 
        error: 'Error de conexión a la base de datos',
        details: process.env.NODE_ENV === 'development' ? dbError.message : 'Verifique la configuración de la base de datos. Consulta CONFIGURACION_SERVIDOR.md para más información'
      });
    }

    // Asegurar que las tablas existen antes de insertar
    logger.info('Verificando/creando tablas...');
    try {
      const tablesReady = await ensureRecordatoriosTables();
      if (!tablesReady) {
        logger.warn('Las tablas no se pudieron crear completamente, pero intentando continuar...');
      }
      logger.info('Tablas verificadas correctamente');
    } catch (tableError) {
      logger.error('Error crítico al verificar tablas:', tableError?.message || String(tableError));
      // Si es un error de conexión o autenticación, no continuar
      if (tableError && tableError.code && (tableError.code === 'ECONNREFUSED' || tableError.code === 'ENOTFOUND' || tableError.code === '28P01')) {
        throw tableError;
      }
      // Para otros errores, intentar continuar de todas formas
      logger.warn('Continuando a pesar del error de tablas...');
    }

    // Obtener cliente de la conexión para transacciones
    client = await apoyosPool.connect();
    
    const uploaded_by = req.session?.username || 'Sistema';
    const file_path = `/uploads/presentaciones/${req.file.filename}`;

    logger.info(`Datos a insertar:`);
    logger.info(`  - name: ${req.file.originalname}`);
    logger.info(`  - file_path: ${file_path}`);
    logger.info(`  - file_size: ${req.file.size}`);
    logger.info(`  - uploaded_by: ${uploaded_by}`);

    // Insertar en la base de datos
    const insertQuery = `
      INSERT INTO recordatorios_presentaciones (name, file_path, file_size, uploaded_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    logger.info('Ejecutando query de inserción...');
    const result = await client.query(insertQuery, [
      req.file.originalname, 
      file_path, 
      req.file.size, 
      uploaded_by
    ]);

    if (!result || !result.rows || result.rows.length === 0) {
      throw new Error('No se pudo insertar el registro en la base de datos - resultado vacío');
    }

    const insertedRecord = result.rows[0];
    logger.info(`✓ Presentación guardada exitosamente con ID: ${insertedRecord.id}`);
    logger.info(`  Registro completo:`, JSON.stringify(insertedRecord, null, 2));

    // Verificar que realmente se guardó consultando la tabla
    const verifyQuery = await client.query(
      `SELECT * FROM recordatorios_presentaciones WHERE id = $1`,
      [insertedRecord.id]
    );
    
    if (verifyQuery.rows.length === 0) {
      throw new Error('El registro se insertó pero no se puede verificar');
    }
    
    logger.info('✓ Registro verificado en la base de datos');

    res.json({
      success: true,
      presentation: insertedRecord
    });
    
  } catch (error) {
    logger.error('❌ ERROR al subir presentación:', error);
    logger.error('Mensaje:', error.message);
    logger.error('Stack trace:', error.stack);
    logger.error('Código de error:', error.code);
    
    // Si es un error de conexión a la base de datos
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message.includes('connect')) {
      if (client) client.release();
      return res.status(500).json({ 
        error: 'No se pudo conectar a la base de datos',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Verifique la configuración de la base de datos'
      });
    }
    
    // Si es un error de tabla no existe, intentar crear las tablas
    if (error.message && (error.message.includes('does not exist') || error.message.includes('relation') || error.message.includes('no existe'))) {
      logger.info('Tabla no existe, intentando crearla...');
      try {
        await ensureRecordatoriosTables();
        
        // Reintentar la inserción
        if (!client) {
          client = await apoyosPool.connect();
        }
        
        const uploaded_by = req.session?.username || 'Sistema';
        const file_path = `/uploads/presentaciones/${req.file.filename}`;
        
        const result = await client.query(
          `INSERT INTO recordatorios_presentaciones (name, file_path, file_size, uploaded_by)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [req.file.originalname, file_path, req.file.size, uploaded_by]
        );
        
        logger.info(`✓ Presentación guardada exitosamente después de crear tablas, ID: ${result.rows[0].id}`);
        
        if (client) client.release();
        
        return res.json({
          success: true,
          presentation: result.rows[0]
        });
      } catch (retryError) {
        logger.error('❌ Error al reintentar después de crear tablas:', retryError);
        if (client) client.release();
        return res.status(500).json({ 
          error: 'Error al subir la presentación: ' + retryError.message,
          details: process.env.NODE_ENV === 'development' ? retryError.stack : undefined
        });
      }
    }
    
    // Si es un error de autenticación
    if (error.code === '28P01' || error.message.includes('password') || error.message.includes('authentication')) {
      if (client) client.release();
      return res.status(500).json({ 
        error: 'Error de autenticación con la base de datos',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Verifique las credenciales de la base de datos'
      });
    }
    
    if (client) client.release();
    
    res.status(500).json({ 
      error: 'Error al subir la presentación: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Ruta para listar todas las presentaciones
app.get('/api/recordatorios/list', async (req, res) => {
  try {
    // Verificar conexión a la base de datos
    try {
      const testConnection = await apoyosPool.query('SELECT NOW()');
      logger.info('Conexión a base de datos verificada');
    } catch (dbError) {
      logger.error('Error de conexión a la base de datos:', dbError);
      logger.error('Configuración actual:', {
        host: process.env.APOYOS_DB_HOST || 'localhost',
        database: process.env.APOYOS_DB_NAME || 'apoyos_db',
        user: process.env.APOYOS_DB_USER || 'postgres',
        port: process.env.APOYOS_DB_PORT || '5432'
      });
      logger.error('Sugerencia: Verifica las variables de entorno APOYOS_DB_* o consulta CONFIGURACION_SERVIDOR.md');
      return res.status(500).json({ 
        error: 'Error de conexión a la base de datos',
        details: process.env.NODE_ENV === 'development' ? dbError.message : 'Verifique la configuración de la base de datos. Consulta CONFIGURACION_SERVIDOR.md para más información'
      });
    }

    // Asegurar que las tablas existen (con manejo de errores)
    try {
      const tablesReady = await ensureRecordatoriosTables();
      if (!tablesReady) {
        logger.warn('Las tablas no se pudieron crear completamente, pero continuando...');
      }
    } catch (tableError) {
      logger.warn('Error al verificar/crear tablas, intentando continuar:', tableError.message);
      // Continuar de todas formas, intentando consultar la tabla
    }
    
    // Intentar consultar las presentaciones
    try {
      const result = await apoyosPool.query(
        `SELECT id, name, file_path, file_size, uploaded_at, uploaded_by, 
                activar_automatico, hora_inicio, hora_fin
         FROM recordatorios_presentaciones
         ORDER BY uploaded_at DESC`
      );

      // Asegurar que los valores booleanos y TIME se devuelvan correctamente
      const rows = (result.rows || []).map(row => ({
        ...row,
        activar_automatico: row.activar_automatico === true || row.activar_automatico === 'true' || row.activar_automatico === 1,
        hora_inicio: row.hora_inicio ? String(row.hora_inicio) : null,
        hora_fin: row.hora_fin ? String(row.hora_fin) : null
      }));

      return res.json(rows);
    } catch (queryError) {
      // Si la tabla no existe, devolver lista vacía en lugar de error
      if (queryError.message && (queryError.message.includes('does not exist') || 
                                  queryError.message.includes('no existe') || 
                                  queryError.message.includes('relation'))) {
        logger.warn('Tabla no existe, devolviendo lista vacía');
        return res.json([]);
      }
      // Re-lanzar otros errores de query
      throw queryError;
    }
  } catch (error) {
    logger.error('Error al listar presentaciones:', error);
    logger.error('Stack trace:', error.stack);
    logger.error('Mensaje de error:', error.message);
    logger.error('Código de error:', error.code);
    
    // Si es un error de conexión
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message.includes('connect')) {
      return res.status(500).json({ 
        error: 'No se pudo conectar a la base de datos',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Verifique la configuración de la base de datos'
      });
    }
    
    // Si es un error de autenticación
    if (error.code === '28P01' || error.message.includes('password') || error.message.includes('authentication')) {
      return res.status(500).json({ 
        error: 'Error de autenticación con la base de datos',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Verifique las credenciales de la base de datos'
      });
    }
    
    // Para cualquier otro error, devolver lista vacía en lugar de error 500
    // Esto permite que la interfaz funcione aunque haya problemas con la base de datos
    logger.warn('Error inesperado, devolviendo lista vacía para evitar romper la interfaz');
    return res.json([]);
  }
});

// Ruta para obtener una presentación específica
app.get('/api/recordatorios/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await apoyosPool.query(
      `SELECT id, name, file_path, file_size, uploaded_at, uploaded_by
       FROM recordatorios_presentaciones
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Presentación no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error al obtener presentación:', error);
    res.status(500).json({ error: 'Error al obtener la presentación' });
  }
});

// Ruta para eliminar una presentación
app.delete('/api/recordatorios/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener información del archivo antes de eliminar
    const fileResult = await apoyosPool.query(
      `SELECT file_path FROM recordatorios_presentaciones WHERE id = $1`,
      [id]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Presentación no encontrada' });
    }

    // Eliminar de la base de datos (el control se elimina en cascada)
    await apoyosPool.query(
      `DELETE FROM recordatorios_presentaciones WHERE id = $1`,
      [id]
    );

    // Intentar eliminar el archivo físico
    const filePath = path.join(__dirname, fileResult.rows[0].file_path);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (fileError) {
        logger.warn('No se pudo eliminar el archivo físico:', fileError);
      }
    }

    res.json({ success: true, message: 'Presentación eliminada exitosamente' });
  } catch (error) {
    logger.error('Error al eliminar presentación:', error);
    res.status(500).json({ error: 'Error al eliminar la presentación' });
  }
});

// Ruta para guardar/actualizar configuración de control remoto
app.post('/api/recordatorios/control', async (req, res) => {
  try {
    const { presentationId, action, showHora, formatoHora, posicionHora, activarAutomatico, horaInicio, horaFin } = req.body;

    if (!presentationId) {
      return res.status(400).json({ error: 'presentationId es requerido' });
    }

    // Verificar que la presentación existe
    const presentationCheck = await apoyosPool.query(
      `SELECT id FROM recordatorios_presentaciones WHERE id = $1`,
      [presentationId]
    );

    if (presentationCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Presentación no encontrada' });
    }

    // Si la acción es 'play', marcar esta presentación como activa y desactivar las demás
    if (action === 'play') {
      // Desactivar todas las presentaciones
      await apoyosPool.query(
        `UPDATE recordatorios_control SET is_active = false WHERE is_active = true`
      );
    }

    // Si se están guardando campos de programación, actualizar recordatorios_presentaciones
    if (activarAutomatico !== undefined || horaInicio !== undefined || horaFin !== undefined) {
      // Construir la query dinámicamente para actualizar solo los campos proporcionados
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;
      
      if (activarAutomatico !== undefined) {
        updateFields.push(`activar_automatico = $${paramIndex++}`);
        updateValues.push(activarAutomatico === true || activarAutomatico === 'true' || activarAutomatico === 1);
      }
      
      if (horaInicio !== undefined) {
        updateFields.push(`hora_inicio = $${paramIndex++}`);
        updateValues.push(horaInicio || null);
      }
      
      if (horaFin !== undefined) {
        updateFields.push(`hora_fin = $${paramIndex++}`);
        updateValues.push(horaFin || null);
      }
      
      updateValues.push(presentationId);
      
      if (updateFields.length > 0) {
        await apoyosPool.query(
          `UPDATE recordatorios_presentaciones 
           SET ${updateFields.join(', ')}
           WHERE id = $${paramIndex}`,
          updateValues
        );
        logger.info(`Programación actualizada para presentación ${presentationId}: activar=${activarAutomatico}, inicio=${horaInicio}, fin=${horaFin}`);
      }
    }

    // Determinar si esta presentación debe estar activa
    // Si se está guardando programación automática, no cambiar is_active manualmente
    let isActive = null;
    if (action === 'play') {
      isActive = true;
    } else if (action === 'stop') {
      isActive = false;
    } else {
      // Si no hay acción, mantener el estado actual (no cambiar is_active)
      const currentState = await apoyosPool.query(
        `SELECT is_active FROM recordatorios_control WHERE presentation_id = $1`,
        [presentationId]
      );
      if (currentState.rows.length > 0) {
        isActive = currentState.rows[0].is_active;
      }
    }

    // Insertar o actualizar configuración de control (sin campos de programación)
    const result = await apoyosPool.query(
      `INSERT INTO recordatorios_control (presentation_id, show_hora, formato_hora, posicion_hora, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (presentation_id)
       DO UPDATE SET
         show_hora = EXCLUDED.show_hora,
         formato_hora = EXCLUDED.formato_hora,
         posicion_hora = EXCLUDED.posicion_hora,
         is_active = COALESCE(EXCLUDED.is_active, recordatorios_control.is_active),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        presentationId,
        showHora !== undefined ? showHora : true,
        formatoHora || '24',
        posicionHora || 'top-right',
        isActive
      ]
    );

    res.json({
      success: true,
      control: result.rows[0]
    });
  } catch (error) {
    logger.error('Error al guardar control:', error);
    res.status(500).json({ error: 'Error al guardar la configuración de control' });
  }
});

// Ruta para obtener configuración de control remoto
app.get('/api/recordatorios/control/:presentationId', async (req, res) => {
  try {
    const { presentationId } = req.params;

    // Obtener configuración de control
    const controlResult = await apoyosPool.query(
      `SELECT show_hora, formato_hora, posicion_hora, updated_at
       FROM recordatorios_control
       WHERE presentation_id = $1`,
      [presentationId]
    );

    // Obtener configuración de programación desde recordatorios_presentaciones
    const presentationResult = await apoyosPool.query(
      `SELECT activar_automatico, hora_inicio, hora_fin
       FROM recordatorios_presentaciones
       WHERE id = $1`,
      [presentationId]
    );

    if (controlResult.rows.length === 0 && presentationResult.rows.length === 0) {
      // Retornar valores por defecto si no hay configuración
      return res.json({
        showHora: true,
        formatoHora: '24',
        posicionHora: 'top-right',
        activarAutomatico: false,
        horaInicio: null,
        horaFin: null
      });
    }

    const control = controlResult.rows[0] || {};
    const presentation = presentationResult.rows[0] || {};
    
    res.json({
      showHora: control.show_hora !== undefined ? control.show_hora : true,
      formatoHora: control.formato_hora || '24',
      posicionHora: control.posicion_hora || 'top-right',
      activarAutomatico: presentation.activar_automatico || false,
      horaInicio: presentation.hora_inicio || null,
      horaFin: presentation.hora_fin || null
    });
  } catch (error) {
    logger.error('Error al obtener control:', error);
    res.status(500).json({ error: 'Error al obtener la configuración de control' });
  }
});

// Función para verificar y activar presentaciones automáticamente según horario
async function verificarProgramacionAutomatica() {
  try {
    // Asegurar que las tablas existen (sin lanzar error si falla)
    try {
      const tablesReady = await ensureRecordatoriosTables();
      if (!tablesReady) {
        logger.warn('Las tablas no están completamente listas, saltando verificación automática');
        return;
      }
    } catch (tableError) {
      logger.warn('Error al verificar tablas en verificarProgramacionAutomatica, saltando:', tableError?.message || String(tableError));
      return;
    }
    
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8); // HH:MM:SS para formato consistente
    
    // Obtener todas las presentaciones con programación automática activada
    const result = await apoyosPool.query(
      `SELECT id, hora_inicio, hora_fin
       FROM recordatorios_presentaciones
       WHERE activar_automatico = true
       AND hora_inicio IS NOT NULL
       AND hora_fin IS NOT NULL`
    );

    for (const row of result.rows) {
      try {
        // Normalizar formato de horas a HH:MM:SS para comparación consistente
        const horaInicio = String(row.hora_inicio).slice(0, 8); // HH:MM:SS
        const horaFin = String(row.hora_fin).slice(0, 8); // HH:MM:SS
        const presentationId = row.id;
        
        // Verificar si estamos dentro del rango de horas
        const shouldBeActive = currentTime >= horaInicio && currentTime <= horaFin;
        
        // Verificar el estado actual en recordatorios_control
        const currentState = await apoyosPool.query(
          `SELECT is_active FROM recordatorios_control WHERE presentation_id = $1`,
          [presentationId]
        );
        const isCurrentlyActive = currentState.rows.length > 0 && currentState.rows[0].is_active;
        
        // Si debería estar activa pero no lo está, activarla
        if (shouldBeActive && !isCurrentlyActive) {
          logger.info(`Activando automáticamente presentación ${presentationId} (${horaInicio} - ${horaFin})`);
          // Desactivar todas las demás
          await apoyosPool.query(
            `UPDATE recordatorios_control 
             SET is_active = false 
             WHERE is_active = true`
          );
          // Activar esta presentación
          await apoyosPool.query(
            `INSERT INTO recordatorios_control (presentation_id, is_active, updated_at)
             VALUES ($1, true, CURRENT_TIMESTAMP)
             ON CONFLICT (presentation_id)
             DO UPDATE SET is_active = true, updated_at = CURRENT_TIMESTAMP`,
            [presentationId]
          );
        }
        // Si no debería estar activa pero lo está, desactivarla
        else if (!shouldBeActive && isCurrentlyActive) {
          logger.info(`Desactivando automáticamente presentación ${presentationId} (fuera del horario ${horaInicio} - ${horaFin})`);
          await apoyosPool.query(
            `UPDATE recordatorios_control 
             SET is_active = false, updated_at = CURRENT_TIMESTAMP 
             WHERE presentation_id = $1`,
            [presentationId]
          );
        }
      } catch (rowError) {
        logger.warn(`Error al procesar presentación ${row.id} en verificación automática:`, rowError?.message || String(rowError));
        // Continuar con la siguiente presentación
        continue;
      }
    }
  } catch (error) {
    const errorMessage = error?.message || String(error) || 'Error desconocido';
    const errorStack = error?.stack || 'No hay stack trace disponible';
    logger.error('Error al verificar programación automática:', error);
    logger.error('Mensaje de error:', errorMessage);
    logger.error('Stack trace:', errorStack);
    // No lanzar el error para que no afecte otras operaciones
    // pero sí registrarlo para debugging
  }
}

// Ejecutar verificación automática cada minuto
setInterval(verificarProgramacionAutomatica, 60000); // Cada 60 segundos
// Ejecutar después de que las tablas estén listas (con delay para evitar conflictos)
setTimeout(() => {
  verificarProgramacionAutomatica().catch(err => {
    logger.warn('Error en verificación automática inicial (no crítico):', err?.message || String(err));
  });
}, 2000); // Esperar 2 segundos después del inicio

// Ruta para obtener la hora del servidor
app.get('/api/server-time', async (req, res) => {
  try {
    const now = new Date();
    res.json({
      timestamp: now.getTime(),
      iso: now.toISOString(),
      local: now.toLocaleString('es-ES', { timeZone: 'America/Mexico_City' }),
      hours: now.getHours(),
      minutes: now.getMinutes(),
      seconds: now.getSeconds(),
      date: now.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    });
  } catch (error) {
    logger.error('Error al obtener hora del servidor:', error);
    res.status(500).json({ error: 'Error al obtener la hora del servidor' });
  }
});

// Ruta para obtener la presentación activa actual
app.get('/api/recordatorios/active', async (req, res) => {
  try {
    // Asegurar que las tablas existen
    await ensureRecordatoriosTables();
    
    // Verificar programación automática antes de responder
    await verificarProgramacionAutomatica();
    
    // Primero buscar presentación activa manualmente
    const activeResult = await apoyosPool.query(
      `SELECT presentation_id, updated_at
       FROM recordatorios_control
       WHERE is_active = true
       ORDER BY updated_at DESC
       LIMIT 1`
    );

    if (activeResult.rows.length > 0) {
      return res.json({
        activePresentationId: activeResult.rows[0].presentation_id,
        updatedAt: activeResult.rows[0].updated_at,
        source: 'manual'
      });
    }

    // Si no hay presentación activa manualmente, buscar por programación automática
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8); // HH:MM:SS para formato TIME
    
    // Obtener todas las presentaciones programadas y filtrar en JavaScript
    // para evitar problemas con la conversión de tipos TIME
    const scheduledResult = await apoyosPool.query(
      `SELECT id, hora_inicio, hora_fin
       FROM recordatorios_presentaciones
       WHERE activar_automatico = true
       AND hora_inicio IS NOT NULL
       AND hora_fin IS NOT NULL
       ORDER BY hora_inicio ASC`
    );

    // Filtrar en JavaScript para encontrar la que corresponde a la hora actual
    const currentPresentation = scheduledResult.rows.find(row => {
      const horaInicio = String(row.hora_inicio).slice(0, 8); // HH:MM:SS
      const horaFin = String(row.hora_fin).slice(0, 8); // HH:MM:SS
      return currentTime >= horaInicio && currentTime <= horaFin;
    });

    if (currentPresentation) {
      const presentationId = currentPresentation.id;
      logger.info(`Presentación programada encontrada para hora actual ${currentTime}: ${presentationId}`);
      
      // Activar esta presentación automáticamente
      await apoyosPool.query(
        `INSERT INTO recordatorios_control (presentation_id, is_active, updated_at)
         VALUES ($1, true, CURRENT_TIMESTAMP)
         ON CONFLICT (presentation_id)
         DO UPDATE SET is_active = true, updated_at = CURRENT_TIMESTAMP`,
        [presentationId]
      );
      
      return res.json({
        activePresentationId: presentationId,
        updatedAt: new Date(),
        source: 'scheduled'
      });
    }

    // No hay presentación activa ni programada
    return res.json({ activePresentationId: null });
  } catch (error) {
    logger.error('Error al obtener presentación activa:', error);
    logger.error('Stack trace:', error.stack);
    res.status(500).json({ error: 'Error al obtener la presentación activa: ' + error.message });
  }
});

// Manejador para rutas no encontradas (SIEMPRE AL FINAL)
app.use((req, res) => {
    // Si es una petición de API, devolver JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            error: 'Endpoint no encontrado',
            path: req.path,
            method: req.method
        });
    }
    
    // Para rutas HTML, servir la página 404 personalizada
    res.status(404).sendFile(path.join(__dirname, 'frontend', '404.html'));
  });