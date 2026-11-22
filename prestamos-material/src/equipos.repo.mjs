// Repositorio de equipos: reúne todo el SQL de acceso a datos de la tabla equipos.
// Recibe el pool como parámetro, así no depende de Express ni de la configuración.
export function crearRepoEquipos(pool) {
  return {
    // LISTADO: búsqueda, filtros, ordenación y paginación (GET /equipos).
    async listar({ q, categoria, disponible, orden, pagina }) {
      // Tamaño de página fijado por el enunciado: 5 registros.
      const tamano = 5;
      // Arrays donde se van acumulando las condiciones WHERE y sus valores parametrizados.
      const condiciones = [];
      const valores = [];

      // Filtro por nombre: búsqueda parcial sin distinguir mayúsculas (ILIKE).
      // El valor va en un parámetro ($n), nunca concatenado en el SQL.
      if (q) {
        valores.push(`%${q}%`);
        condiciones.push(`nombre ILIKE $${valores.length}`);
      }
      // Filtro por categoría: igualdad exacta, también parametrizada.
      if (categoria) {
        valores.push(categoria);
        condiciones.push(`categoria = $${valores.length}`);
      }
      // Filtro por disponibilidad: solo se aplica si llega 'true' o 'false'; se convierte a booleano.
      if (disponible === 'true' || disponible === 'false') {
        valores.push(disponible === 'true');
        condiciones.push(`disponible = $${valores.length}`);
      }

      // Une las condiciones con AND; si no hay ninguna, no se añade WHERE.
      const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
      // Lista blanca para ORDER BY: el cliente solo elige entre dos opciones fijas.
      // Nunca se concatena un nombre de columna recibido. El id desempata para un orden estable.
      const ordenSQL = orden === 'nombre' ? 'nombre ASC, id ASC' : 'codigo ASC, id ASC';

      // Calcula el desplazamiento: la página 1 empieza en 0, la 2 en 5, etc.
      const offset = (pagina - 1) * tamano;
      // Se pide una fila más que el tamaño de página para saber si existe página siguiente sin COUNT.
      valores.push(tamano + 1, offset);

      // Consulta final con columnas explícitas. LIMIT y OFFSET usan los dos últimos parámetros.
      const sql = `
        SELECT id, codigo, nombre, categoria, disponible
        FROM practica_prestamos.equipos
        ${where}
        ORDER BY ${ordenSQL}
        LIMIT $${valores.length - 1} OFFSET $${valores.length}
      `;

      // Ejecuta la consulta. Una consulta sin filas devuelve [], que no es un error.
      const r = await pool.query(sql, valores);
      // Devuelve solo las filas de la página y un indicador de si hay una página siguiente.
      return {
        items: r.rows.slice(0, tamano),
        haySiguiente: r.rows.length > tamano
      };
    },

    // DETALLE: datos del equipo, usuario actual e historial (GET /equipos/:id).
    async obtenerDetalle(id) {
      // Primera consulta: el equipo y, si existe, el usuario que lo tiene prestado ahora.
      // Se usan LEFT JOIN para conservar el equipo aunque no tenga préstamo activo.
      // La condición fecha_devolucion IS NULL va en el ON (no en el WHERE) para no perder esas filas.
      const eqRes = await pool.query(`
        SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible,
               u.nombre AS usuario_actual
        FROM practica_prestamos.equipos e
        LEFT JOIN practica_prestamos.prestamos p
          ON p.equipo_id = e.id AND p.fecha_devolucion IS NULL
        LEFT JOIN practica_prestamos.usuarios u ON u.id = p.usuario_id
        WHERE e.id = $1
      `, [id]);

      // Si no hay filas, el equipo no existe: devuelve null y la ruta responderá 404.
      if (!eqRes.rows.length) return null;

      // Segunda consulta: historial de préstamos con el nombre del usuario (JOIN).
      // Se hace aparte para no duplicar la fila del equipo por cada préstamo.
      // Orden descendente por fecha con id como desempate estable.
      const histRes = await pool.query(`
        SELECT p.id, u.nombre AS usuario, p.fecha_prestamo, p.fecha_devolucion
        FROM practica_prestamos.prestamos p
        JOIN practica_prestamos.usuarios u ON u.id = p.usuario_id
        WHERE p.equipo_id = $1
        ORDER BY p.fecha_prestamo DESC, p.id DESC
      `, [id]);

      // Devuelve los datos del equipo junto con su historial.
      return { ...eqRes.rows[0], historial: histRes.rows };
    },

    // ALTA: crea un equipo (POST /api/equipos).
    async crear({ codigo, nombre, categoria }) {
      // INSERT ... RETURNING devuelve la fila creada, con su id, sin una segunda consulta.
      // No se inserta disponible: toma su valor por defecto (true).
      const r = await pool.query(`
        INSERT INTO practica_prestamos.equipos (codigo, nombre, categoria)
        VALUES ($1, $2, $3)
        RETURNING id, codigo, nombre, categoria, disponible
      `, [codigo, nombre, categoria]);
      return r.rows[0];
    },

    // MODIFICACIÓN: actualiza un equipo (PUT /api/equipos/:id).
    async actualizar(id, { codigo, nombre, categoria }) {
      // El UPDATE no toca la columna disponible: ese estado solo cambia al prestar o devolver.
      // WHERE id=$4 limita el cambio a un registro y RETURNING devuelve la fila actualizada.
      const r = await pool.query(`
        UPDATE practica_prestamos.equipos
        SET codigo = $1, nombre = $2, categoria = $3
        WHERE id = $4
        RETURNING id, codigo, nombre, categoria, disponible
      `, [codigo, nombre, categoria, id]);
      // Si no se actualizó ninguna fila (id inexistente) devuelve null y la ruta responderá 404.
      return r.rows[0] ?? null;
    },

    // BAJA: elimina un equipo (DELETE /api/equipos/:id).
    async eliminar(id) {
      // DELETE parametrizado por id. Si el equipo tiene préstamos, la clave foránea lanza el error 23503.
      const r = await pool.query(
        'DELETE FROM practica_prestamos.equipos WHERE id = $1', [id]);
      // rowCount indica cuántas filas se borraron: 0 significa que el equipo no existía.
      return r.rowCount > 0;
    }
  };
}