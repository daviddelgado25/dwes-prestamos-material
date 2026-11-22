// Script de comprobación manual de la práctica. Uso (con el servidor arrancado y datos recién reiniciados):
//   node probar.mjs
// Debe ejecutarse UNA sola vez por cada reinicio de datos con init.sql.
const base = 'http://127.0.0.1:3000';
// Cuenta las comprobaciones que no salen como se esperaba.
let fallos = 0;

// Construye las opciones de fetch para una petición con cuerpo JSON.
const json = (method, datos) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: datos === undefined ? undefined : JSON.stringify(datos)
});

// Lanza una petición y devuelve estado, cuerpo (JSON si se puede), texto y cabecera Location.
async function llamar(ruta, opciones = {}) {
  const r = await fetch(base + ruta, opciones);
  const texto = await r.text();
  let cuerpo = texto;
  try { cuerpo = JSON.parse(texto); } catch { /* HTML o respuesta vacía */ }
  return { estado: r.status, cuerpo, texto, location: r.headers.get('location') };
}

// Imprime una línea OK/FALLO con el caso, lo esperado y lo obtenido (sirve para la tabla del README).
function caso(nombre, esperado, obtenido, ok) {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK ' : 'FALLO'} | ${nombre} | esperado: ${esperado} | obtenido: ${obtenido}`);
}

// --- Alta y modificación ---
// Alta correcta: debe responder 201 y la cabecera Location.
const alta = await llamar('/api/equipos', json('POST',
  { codigo: 'TEST-01', nombre: 'Equipo de prueba', categoria: 'Pruebas' }));
caso('POST /api/equipos', '201 + Location', `${alta.estado} ${alta.location}`,
  alta.estado === 201 && Boolean(alta.location));
const idTest = alta.cuerpo.id;

// Alta con código repetido: la restricción UNIQUE debe traducirse a 409.
const dup = await llamar('/api/equipos', json('POST',
  { codigo: 'TEST-01', nombre: 'Otro', categoria: 'Pruebas' }));
caso('POST código repetido', '409', dup.estado, dup.estado === 409);

// Modificación correcta: 200 y el nombre actualizado.
const mod = await llamar(`/api/equipos/${idTest}`, json('PUT',
  { codigo: 'TEST-01', nombre: 'Equipo modificado', categoria: 'Pruebas' }));
caso('PUT /api/equipos/:id', '200 y nombre nuevo', `${mod.estado} ${mod.cuerpo.nombre}`,
  mod.estado === 200 && mod.cuerpo.nombre === 'Equipo modificado');

// Modificación de un id inexistente: 404.
const mod404 = await llamar('/api/equipos/999999', json('PUT',
  { codigo: 'X-1', nombre: 'X', categoria: 'X' }));
caso('PUT id inexistente', '404', mod404.estado, mod404.estado === 404);

// Datos inválidos (código vacío y nombre en blanco): 400.
const datosMal = await llamar('/api/equipos', json('POST', { codigo: '', nombre: ' ' }));
caso('POST datos inválidos', '400', datosMal.estado, datosMal.estado === 400);

// --- Borrado ---
// Borrado de un equipo sin historial: 204 sin cuerpo.
const del = await llamar(`/api/equipos/${idTest}`, { method: 'DELETE' });
caso('DELETE sin historial', '204', del.estado, del.estado === 204);

// Repetir el borrado: el equipo ya no existe, 404.
const del404 = await llamar(`/api/equipos/${idTest}`, { method: 'DELETE' });
caso('DELETE id inexistente', '404', del404.estado, del404.estado === 404);

// --- Préstamo correcto y duplicado ---
// Préstamo válido del equipo 1 al usuario 1: 201 con el id del préstamo.
const p1 = await llamar('/api/prestamos', json('POST', { equipoId: 1, usuarioId: 1 }));
caso('POST /api/prestamos', '201 con id', `${p1.estado} id=${p1.cuerpo.id}`,
  p1.estado === 201 && Number.isInteger(p1.cuerpo.id));

// Segundo préstamo del mismo equipo: 409 y sin duplicar filas.
const p1dup = await llamar('/api/prestamos', json('POST', { equipoId: 1, usuarioId: 2 }));
caso('Préstamo duplicado', '409', p1dup.estado, p1dup.estado === 409);

// El detalle debe mostrar al usuario que lo tiene y el estado Prestado.
const det1 = await llamar('/equipos/1');
caso('Detalle tras préstamo', 'Prestado a Ana, 1 fila de historial',
  det1.estado, det1.estado === 200 && det1.texto.includes('Ana García') &&
  det1.texto.includes('<dd>Prestado</dd>'));

// --- Rollback ---
// Prestar a un usuario inexistente: la clave foránea falla y la ruta responde 400.
const rb = await llamar('/api/prestamos', json('POST', { equipoId: 2, usuarioId: 999 }));
caso('Rollback: usuario inexistente', '400', rb.estado, rb.estado === 400);

// El equipo 2 debe seguir disponible y sin préstamos: el ROLLBACK revirtió el UPDATE.
const det2 = await llamar('/equipos/2');
caso('Rollback: equipo 2 intacto', 'Disponible y sin préstamos', det2.estado,
  det2.texto.includes('<dd>Disponible</dd>') &&
  det2.texto.includes('no tiene préstamos registrados'));

// --- Borrado con historial ---
// El equipo 1 tiene un préstamo: la clave foránea impide borrarlo (409).
const delHist = await llamar('/api/equipos/1', { method: 'DELETE' });
caso('DELETE con préstamos', '409', delHist.estado, delHist.estado === 409);

// --- Consultas y filtros ---
// Búsqueda ILIKE en minúsculas: encuentra PORT-01 y no TAB-01.
const f1 = await llamar('/equipos?q=port');
caso('Búsqueda ILIKE q=port', '200, PORT-01 sí y TAB-01 no', f1.estado,
  f1.estado === 200 && f1.texto.includes('PORT-01') && !f1.texto.includes('TAB-01'));

// Filtro por categoría.
const f2 = await llamar('/equipos?categoria=Tabletas');
caso('Filtro categoría', '200, TAB-01 sí y PORT-01 no', f2.estado,
  f2.estado === 200 && f2.texto.includes('TAB-01') && !f2.texto.includes('PORT-01'));

// Filtro de equipos prestados: solo el equipo 1 está prestado en este momento.
const f3 = await llamar('/equipos?disponible=false');
caso('Filtro prestados', '200, solo PORT-01', f3.estado,
  f3.estado === 200 && f3.texto.includes('PORT-01') && !f3.texto.includes('TAB-01'));

// Ordenación por nombre.
const f4 = await llamar('/equipos?orden=nombre');
caso('Orden por nombre', '200', f4.estado, f4.estado === 200);

// Segunda página (5 por página): contiene TAB-02 y no CAM-01.
const f5 = await llamar('/equipos?pagina=2');
caso('Segunda página', '200, TAB-02 sí y CAM-01 no', f5.estado,
  f5.estado === 200 && f5.texto.includes('TAB-02') && !f5.texto.includes('CAM-01'));

// Búsqueda sin coincidencias: sigue siendo 200 y muestra el mensaje de vacío.
const f6 = await llamar('/equipos?q=zzzz');
caso('Sin resultados', '200 con mensaje', f6.estado,
  f6.estado === 200 && f6.texto.includes('No hay equipos'));

// Detalle con id mal formado: 400.
const d400 = await llamar('/equipos/abc');
caso('Detalle id mal formado', '400', d400.estado, d400.estado === 400);

// Detalle de un id que no existe: 404.
const d404 = await llamar('/equipos/999999');
caso('Detalle id inexistente', '404', d404.estado, d404.estado === 404);

// --- Devolución ---
// Devolución correcta: 200 y fecha_devolucion registrada.
const dev = await llamar(`/api/prestamos/${p1.cuerpo.id}/devolucion`, { method: 'POST' });
caso('Devolución', '200 con fecha_devolucion', dev.estado,
  dev.estado === 200 && Boolean(dev.cuerpo.fecha_devolucion));

// Tras devolver, el equipo 1 vuelve a estar disponible.
const det1b = await llamar('/equipos/1');
caso('Equipo 1 tras devolver', 'Disponible', det1b.estado,
  det1b.texto.includes('<dd>Disponible</dd>'));

// Segunda devolución del mismo préstamo: 409 y no modifica nada.
const dev2 = await llamar(`/api/prestamos/${p1.cuerpo.id}/devolucion`, { method: 'POST' });
caso('Segunda devolución', '409', dev2.estado, dev2.estado === 409);

// --- Simultaneidad ---
// Dos préstamos a la vez del mismo equipo (Promise.all los lanza sin esperar al primero).
// Solo uno debe confirmarse (201) y el otro debe ser rechazado (409).
const [a, b] = await Promise.all([
  llamar('/api/prestamos', json('POST', { equipoId: 3, usuarioId: 1 })),
  llamar('/api/prestamos', json('POST', { equipoId: 3, usuarioId: 2 }))
]);
const estados = [a.estado, b.estado].sort();
caso('Dos préstamos simultáneos', '[201, 409]', JSON.stringify(estados),
  estados[0] === 201 && estados[1] === 409);

// Resumen final y código de salida del proceso (0 = todo bien, 1 = hay fallos).
console.log(fallos === 0 ? '\nTodo correcto.' : `\n${fallos} comprobación(es) fallida(s).`);
process.exitCode = fallos === 0 ? 0 : 1;