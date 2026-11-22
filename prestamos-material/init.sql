-- Crea el esquema propio de la práctica. IF NOT EXISTS permite repetir el script sin error.
CREATE SCHEMA IF NOT EXISTS practica_prestamos;

-- Tabla de usuarios de prueba. El id lo genera PostgreSQL (identidad), nunca con MAX(id)+1.
-- El CHECK con trim impide guardar nombres vacíos o formados solo por espacios.
CREATE TABLE IF NOT EXISTS practica_prestamos.usuarios (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre text NOT NULL CHECK (char_length(trim(nombre)) > 0)
);

-- Tabla de equipos del inventario.
-- codigo: obligatorio, único y de 1 a 20 caracteres.
-- nombre y categoria: obligatorios y no vacíos.
-- disponible: booleano con valor inicial true; solo cambia al prestar o devolver.
CREATE TABLE IF NOT EXISTS practica_prestamos.equipos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL UNIQUE CHECK (char_length(codigo) BETWEEN 1 AND 20),
  nombre text NOT NULL CHECK (char_length(trim(nombre)) > 0),
  categoria text NOT NULL CHECK (char_length(trim(categoria)) > 0),
  disponible boolean NOT NULL DEFAULT true
);

-- Tabla de préstamos. Relaciona un equipo con un usuario.
-- Las claves foráneas usan ON DELETE RESTRICT: no se puede borrar un equipo ni un usuario
-- con préstamos registrados (ni siquiera finalizados), y no hay borrado en cascada.
-- fecha_prestamo se rellena sola con now(); fecha_devolucion es NULL mientras el préstamo está activo.
-- El CHECK impide una devolución anterior al inicio del préstamo.
CREATE TABLE IF NOT EXISTS practica_prestamos.prestamos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id integer NOT NULL
    REFERENCES practica_prestamos.equipos(id) ON DELETE RESTRICT,
  usuario_id integer NOT NULL
    REFERENCES practica_prestamos.usuarios(id) ON DELETE RESTRICT,
  fecha_prestamo timestamptz NOT NULL DEFAULT now(),
  fecha_devolucion timestamptz,
  CHECK (fecha_devolucion IS NULL OR fecha_devolucion >= fecha_prestamo)
);

-- Índice único parcial: solo cuenta las filas con fecha_devolucion NULL (préstamos activos).
-- Así un equipo no puede tener dos préstamos activos a la vez, pero sí varios históricos.
-- Protege la regla incluso si dos peticiones simultáneas se saltaran el control de la aplicación.
CREATE UNIQUE INDEX IF NOT EXISTS un_prestamo_activo
  ON practica_prestamos.prestamos(equipo_id)
  WHERE fecha_devolucion IS NULL;

-- Reinicia los datos de práctica y las secuencias de id (RESTART IDENTITY).
-- ATENCIÓN: borra todos los datos cada vez que se ejecuta el script. Solo para reiniciar la práctica.
TRUNCATE practica_prestamos.prestamos,
         practica_prestamos.equipos,
         practica_prestamos.usuarios
RESTART IDENTITY;

-- Datos iniciales: 3 usuarios de prueba (el id lo asigna PostgreSQL).
INSERT INTO practica_prestamos.usuarios (nombre) VALUES
  ('Ana García'),
  ('Luis Pérez'),
  ('Marta Gómez');

-- Datos iniciales: 10 equipos de 5 categorías distintas (todos disponibles por defecto).
INSERT INTO practica_prestamos.equipos (codigo, nombre, categoria) VALUES
  ('PORT-01', 'Portátil Dell Latitude', 'Portátiles'),
  ('PORT-02', 'Portátil Lenovo ThinkPad', 'Portátiles'),
  ('PORT-03', 'MacBook Air M2', 'Portátiles'),
  ('TAB-01', 'iPad Air 10"', 'Tabletas'),
  ('TAB-02', 'Samsung Galaxy Tab S9', 'Tabletas'),
  ('PROY-01', 'Proyector Epson Aula 1', 'Proyectores'),
  ('PROY-02', 'Proyector BenQ Portátil', 'Proyectores'),
  ('CAM-01', 'Cámara Canon EOS', 'Audiovisual'),
  ('MIC-01', 'Micrófono Rode USB', 'Audiovisual'),
  ('SW-01', 'Switch Cisco 8 puertos', 'Redes');