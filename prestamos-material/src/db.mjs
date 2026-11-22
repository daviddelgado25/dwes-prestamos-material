// Importa el controlador pg, que permite a Node.js comunicarse con PostgreSQL.
import pg from 'pg';

// Comprueba al arrancar que existen todas las variables de entorno de conexión (cargadas desde .env).
// Si falta alguna, se detiene el programa con un mensaje claro, sin mostrar valores secretos.
for (const clave of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
  if (!process.env[clave]) throw new Error(`Falta variable de entorno: ${clave}`);
}

// Valida que PGPORT sea un entero entre 1 y 65535, para fallar pronto con un error comprensible.
const puerto = Number(process.env.PGPORT);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  throw new Error('PGPORT no es válido');
}

// Crea un único pool de conexiones para todo el proceso (no uno por petición).
// max: límite de conexiones simultáneas.
// connectionTimeoutMillis: tiempo máximo de espera para conseguir una conexión.
// idleTimeoutMillis: tiempo tras el cual se cierra una conexión inactiva.
// pg lee host, puerto, base, usuario y contraseña de las variables PG* automáticamente.
export const pool = new pg.Pool({
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000
});

// Captura los errores de conexiones inactivas para que no tumben la aplicación.
// No se imprime el objeto de error porque podría contener datos sensibles.
pool.on('error', () => console.error('Error inesperado en cliente inactivo del pool'));