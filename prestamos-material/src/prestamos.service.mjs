// Crea un error de dominio: un Error normal con una propiedad "codigo".
// El middleware de errores de server.mjs lo reconoce y lo traduce a un código HTTP.
function errorDominio(codigo) {
  return Object.assign(new Error(codigo), { codigo });
}

// Servicio de préstamos: contiene la lógica transaccional. No conoce req, res ni códigos HTTP.
export function crearServicioPrestamos(pool) {
  // Ayudante genérico que ejecuta un bloque de trabajo dentro de una transacción.
  async function ejecutarTransaccion(trabajo) {
    // Pide UN cliente al pool: todas las sentencias de la transacción deben usar la misma conexión.
    const cliente = await pool.connect();
    // Indica si la conexión debe descartarse al liberarla (si el ROLLBACK falla).
    let descartar = false;
    try {
      // Inicia la transacción en esta conexión.
      await cliente.query('BEGIN');
      // Ejecuta las escrituras del caso de uso con ese mismo cliente.
      const res = await trabajo(cliente);
      // Si todo salió bien, confirma los cambios juntos.
      await cliente.query('COMMIT');
      return res;
    } catch (err) {
      // Ante cualquier fallo, revierte todo lo escrito en la transacción.
      // Si el propio ROLLBACK falla, la conexión queda en estado incierto y se marca para descartarla.
      try { await cliente.query('ROLLBACK'); }
      catch { descartar = true; }
      // Vuelve a lanzar el error original para que lo trate la capa HTTP.
      throw err;
    } finally {
      // Siempre devuelve el cliente al pool (o lo destruye si descartar es true).
      // Si se olvidara, las peticiones futuras podrían quedarse esperando una conexión.
      cliente.release(descartar);
    }
  }

  return {
    // PRÉSTAMO: marca el equipo como no disponible y crea el préstamo, de forma atómica.
    async prestar(equipoId, usuarioId) {
      return ejecutarTransaccion(async (cliente) => {
        // Actualización condicional: solo pasa a disponible=false si ahora está disponible=true.
        // Con dos peticiones simultáneas, solo una modifica la fila; la otra afecta a cero filas.
        const upd = await cliente.query(`
          UPDATE practica_prestamos.equipos
          SET disponible = false
          WHERE id = $1 AND disponible = true
          RETURNING id
        `, [equipoId]);

        // Si no se modificó ninguna fila, el equipo no existe o está ocupado: se aborta sin crear préstamo.
        if (upd.rowCount === 0) throw errorDominio('EQUIPO_NO_DISPONIBLE');

        // Inserta el préstamo DESPUÉS del UPDATE a propósito: si el usuario no existe, la clave foránea
        // falla y el ROLLBACK devuelve el equipo a disponible=true. fecha_prestamo se rellena sola.
        const ins = await cliente.query(`
          INSERT INTO practica_prestamos.prestamos (equipo_id, usuario_id)
          VALUES ($1, $2)
          RETURNING id, equipo_id, usuario_id, fecha_prestamo
        `, [equipoId, usuarioId]);

        // Devuelve el préstamo creado (con su id).
        return ins.rows[0];
      });
    },

    // DEVOLUCIÓN: cierra el préstamo activo y libera el equipo, de forma atómica.
    async devolver(prestamoId) {
      return ejecutarTransaccion(async (cliente) => {
        // Modificación condicional: solo cierra el préstamo si sigue activo (fecha_devolucion IS NULL).
        // Así una segunda devolución no altera nada. RETURNING obtiene el equipo asociado.
        const updPrestamo = await cliente.query(`
          UPDATE practica_prestamos.prestamos
          SET fecha_devolucion = now()
          WHERE id = $1 AND fecha_devolucion IS NULL
          RETURNING id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion
        `, [prestamoId]);

        // Si no se modificó ninguna fila, el préstamo no existe o ya estaba devuelto.
        if (updPrestamo.rowCount === 0) throw errorDominio('PRESTAMO_NO_ACTIVO');

        // En la misma transacción, vuelve a marcar el equipo como disponible.
        await cliente.query(`
          UPDATE practica_prestamos.equipos
          SET disponible = true
          WHERE id = $1
        `, [updPrestamo.rows[0].equipo_id]);

        // Devuelve los datos del préstamo ya cerrado.
        return updPrestamo.rows[0];
      });
    }
  };
}