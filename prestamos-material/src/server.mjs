// Importa Express, la utilidad para convertir URLs en rutas de archivo y los módulos propios.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { crearRepoEquipos } from './equipos.repo.mjs';
import { crearServicioPrestamos } from './prestamos.service.mjs';

// Crea la aplicación y construye el repositorio y el servicio pasándoles el pool compartido.
const app = express();
const repoEquipos = crearRepoEquipos(pool);
const servicioPrestamos = crearServicioPrestamos(pool);

// Configura EJS como motor de vistas y localiza la carpeta views junto al proyecto,
// sin depender del directorio desde el que se ejecute Node.
app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('../views/', import.meta.url)));
// Interpreta cuerpos JSON y limita su tamaño a 10 KB.
app.use(express.json({ limit: '10kb' }));

// Valida un identificador: solo dígitos sin ceros a la izquierda, entero seguro de JavaScript
// y dentro del rango del integer de PostgreSQL (máximo 2147483647).
const esIdValido = (val) =>
  /^[1-9]\d*$/.test(String(val)) &&
  Number.isSafeInteger(Number(val)) &&
  Number(val) <= 2147483647;

// Valida el cuerpo JSON de un equipo: tipos string, formato del código y longitudes máximas.
// La base de datos también protege estas reglas con sus restricciones.
function validarEquipo(b) {
  return Boolean(b) &&
    typeof b.codigo === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(b.codigo.trim()) &&
    typeof b.nombre === 'string' &&
    b.nombre.trim().length >= 1 && b.nombre.trim().length <= 80 &&
    typeof b.categoria === 'string' &&
    b.categoria.trim().length >= 1 && b.categoria.trim().length <= 50;
}

// --- VISTAS HTML ---

// Listado de equipos con búsqueda, filtros, orden y paginación.
app.get('/equipos', async (req, res) => {
  // Normaliza los parámetros de la URL: solo se aceptan strings y se limita su longitud.
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  const categoria = typeof req.query.categoria === 'string'
    ? req.query.categoria.slice(0, 50) : '';
  // disponible solo puede ser 'true' o 'false'; cualquier otro valor equivale a "sin filtro".
  const disponible = ['true', 'false'].includes(req.query.disponible)
    ? req.query.disponible : '';
  // El orden solo admite 'nombre'; por defecto se ordena por código.
  const orden = req.query.orden === 'nombre' ? 'nombre' : 'codigo';
  // Valida la página con una regex (1 a 9999). Si no es válida, responde 400.
  const textoPagina = req.query.pagina ?? '1';
  if (typeof textoPagina !== 'string' || !/^[1-9]\d{0,3}$/.test(textoPagina)) {
    return res.status(400).send('Paginación no válida');
  }
  const pagina = Number(textoPagina);

  // Pide al repositorio la página de equipos y si existe una siguiente.
  const { items, haySiguiente } =
    await repoEquipos.listar({ q, categoria, disponible, orden, pagina });

  // Construye enlaces de paginación que conservan los filtros (URLSearchParams los codifica).
  const urlPagina = (p) => '/equipos?' +
    new URLSearchParams({ q, categoria, disponible, orden, pagina: String(p) });

  // Renderiza la vista con los datos ya preparados.
  res.render('equipos', {
    equipos: items,
    filtros: { q, categoria, disponible, orden, pagina },
    anterior: pagina > 1 ? urlPagina(pagina - 1) : null,
    siguiente: haySiguiente ? urlPagina(pagina + 1) : null
  });
});

// Detalle de un equipo: 400 si el id está mal formado, 404 si no existe.
app.get('/equipos/:id', async (req, res) => {
  if (!esIdValido(req.params.id)) return res.status(400).send('ID no válido');
  const equipo = await repoEquipos.obtenerDetalle(Number(req.params.id));
  if (!equipo) return res.status(404).send('Equipo no encontrado');
  res.render('equipo', { equipo });
});

// --- API JSON ---

// Alta de equipo: valida, inserta y responde 201 con la cabecera Location.
app.post('/api/equipos', async (req, res) => {
  if (!validarEquipo(req.body)) {
    return res.status(400).json({ error: 'Datos de equipo inválidos' });
  }
  // Se guardan los textos sin espacios sobrantes.
  const nuevo = await repoEquipos.crear({
    codigo: req.body.codigo.trim(),
    nombre: req.body.nombre.trim(),
    categoria: req.body.categoria.trim()
  });
  res.status(201).location(`/api/equipos/${nuevo.id}`).json(nuevo);
});

// Modificación de equipo: valida id y cuerpo; responde 404 si el equipo no existe.
app.put('/api/equipos/:id', async (req, res) => {
  if (!esIdValido(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  if (!validarEquipo(req.body)) return res.status(400).json({ error: 'Datos inválidos' });

  const actualizado = await repoEquipos.actualizar(Number(req.params.id), {
    codigo: req.body.codigo.trim(),
    nombre: req.body.nombre.trim(),
    categoria: req.body.categoria.trim()
  });

  // El repositorio devuelve null si ninguna fila cumplió la condición.
  if (!actualizado) return res.status(404).json({ error: 'Equipo no existe' });
  res.json(actualizado);
});

// Baja de equipo: 204 sin cuerpo, 404 si no existe (409 si tiene préstamos, vía middleware de errores).
app.delete('/api/equipos/:id', async (req, res) => {
  if (!esIdValido(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  const borrado = await repoEquipos.eliminar(Number(req.params.id));
  if (!borrado) return res.status(404).json({ error: 'Equipo no existe' });
  res.status(204).end();
});

// Préstamo: valida ambos identificadores y delega en el servicio transaccional.
app.post('/api/prestamos', async (req, res) => {
  const { equipoId, usuarioId } = req.body ?? {};
  if (!esIdValido(equipoId) || !esIdValido(usuarioId)) {
    return res.status(400).json({ error: 'Identificadores inválidos' });
  }
  try {
    const prestamo = await servicioPrestamos.prestar(Number(equipoId), Number(usuarioId));
    res.status(201).json(prestamo);
  } catch (err) {
    // 23503 (clave foránea) aquí significa que el usuario no existe: es un dato inválido (400).
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Usuario inexistente' });
    }
    // Cualquier otro error pasa al middleware de errores.
    throw err;
  }
});

// Devolución: el id del préstamo viene en la URL y no hay cuerpo.
app.post('/api/prestamos/:id/devolucion', async (req, res) => {
  if (!esIdValido(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  const devuelto = await servicioPrestamos.devolver(Number(req.params.id));
  res.json(devuelto);
});

// --- ERRORES ---

// Middleware de errores (4 parámetros, colocado después de las rutas).
// Traduce errores a códigos HTTP sin mostrar mensajes técnicos de SQL al cliente.
app.use((err, req, res, next) => {
  // JSON mal formado o cuerpo demasiado grande.
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Cuerpo demasiado grande' });
  // Errores de dominio del servicio de préstamos: conflicto con el estado actual (409).
  if (err.codigo === 'EQUIPO_NO_DISPONIBLE' || err.codigo === 'PRESTAMO_NO_ACTIVO') {
    return res.status(409).json({ error: err.codigo });
  }
  // SQLSTATE 23505: violación de UNIQUE (código de equipo repetido) -> 409.
  if (err.code === '23505') return res.status(409).json({ error: 'Registro duplicado' });
  // SQLSTATE 23503: clave foránea; en este punto solo ocurre al borrar un equipo con préstamos -> 409.
  if (err.code === '23503') return res.status(409).json({ error: 'Equipo con préstamos registrados' });
  // SQLSTATE 23502 (NOT NULL) y 23514 (CHECK): datos no admitidos -> 400.
  if (['23502', '23514'].includes(err.code)) {
    return res.status(400).json({ error: 'Datos no cumplen restricciones' });
  }

  // Error inesperado: solo se registra el SQLSTATE (no el objeto completo) y el cliente recibe un 500 genérico.
  console.error('Error interno, SQLSTATE:', err.code ?? 'n/a');
  res.status(500).json({ error: 'Error interno del servidor' });
});

// --- ARRANQUE ---

try {
  // Comprueba la conexión con PostgreSQL antes de aceptar peticiones.
  await pool.query('SELECT 1');
  // Puerto configurable por .env; el servidor solo escucha en la interfaz local.
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Servidor escuchando en http://127.0.0.1:${port}/equipos`);
  });

  // Cierre ordenado: deja de aceptar tráfico y cierra el pool al recibir Ctrl+C o una señal de parada.
  const cerrar = () => server.close(async () => { await pool.end(); });
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
} catch {
  // Si PostgreSQL no está disponible, se informa sin detalles sensibles y el proceso termina con error.
  console.error('PostgreSQL no disponible');
  await pool.end();
  process.exitCode = 1;
}