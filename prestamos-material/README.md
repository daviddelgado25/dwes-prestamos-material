# Gestión de préstamos de material informático

Práctica evaluable de **Desarrollo Web en Entorno Servidor (2.º DAW)**.
Aplicación web con Node.js, Express 5 y PostgreSQL que mantiene el inventario de equipos de un centro educativo y permite realizar préstamos y devoluciones sin perder la coherencia de los datos.

**Autor:** David Delgado Alonso

**Chat IA:** https://claude.ai/share/38924bad-4313-4812-b477-1b27060fdb1b

## Requisitos

| Herramienta | Versión |
|---|---|
| Node.js | 24 |
| Docker y Docker Compose | `docker compose` (con espacio) |
| PostgreSQL | 18 (en contenedor) |
| Express | 5 |
| pg | 8 |
| EJS | 3 |

## Estructura del proyecto

```
practica-prestamos/
├── compose.yaml        PostgreSQL 18 en Docker con volumen persistente
├── init.sql            Esquema, restricciones y datos iniciales
├── probar.mjs          Script de comprobación con fetch
├── .env.example        Plantilla de configuración (sin credenciales reales)
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
├── src/
│   ├── server.mjs              Arranque de Express, rutas y errores
│   ├── db.mjs                  Pool de conexiones y validación del entorno
│   ├── equipos.repo.mjs        Consultas SQL de equipos
│   └── prestamos.service.mjs   Transacciones de préstamo y devolución
└── views/
    ├── equipos.ejs     Listado
    └── equipo.ejs      Detalle
```

## Instalación

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Crea tu archivo de configuración a partir de la plantilla y rellena las contraseñas:

   ```bash
   cp .env.example .env
   ```

   El mismo `.env` lo usan Docker Compose (variable `DB_ADMIN_PASSWORD`) y Node.js (variables `PG*` y `PORT`). No se entrega ni se sube a Git.

   Contenido de `.env.example`:

   ```
   DB_ADMIN_PASSWORD=CAMBIA_POR_UNA_CLAVE_ADMIN_PROPIA
   PGHOST=127.0.0.1
   PGPORT=15432
   PGDATABASE=dwes
   PGUSER=dwes_app
   PGPASSWORD=CAMBIA_POR_LA_CLAVE_DE_DWES_APP
   PORT=3000
   ```

## Puesta en marcha

### 1. Arrancar PostgreSQL

```bash
docker compose up -d
docker compose ps
```

Espera a que el servicio `db` aparezca como `healthy`. PostgreSQL queda publicado solo en `127.0.0.1:15432`.

### 2. Crear el usuario de la aplicación (solo la primera vez)

```bash
docker compose exec db psql -U postgres -d dwes
```

Dentro de `psql`:

```sql
CREATE ROLE dwes_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password dwes_app
GRANT CONNECT, CREATE ON DATABASE dwes TO dwes_app;
\q
```

La contraseña que asignes con `\password` debe coincidir con `PGPASSWORD` del `.env`. La aplicación nunca usa el usuario administrador `postgres`.

### 3. Inicializar la base de datos

```bash
docker compose exec db psql -h 127.0.0.1 -U dwes_app -d dwes -W
```

Pega dentro de `psql` el contenido completo de `init.sql` y sal con `\q`. Desde una base vacía crea el esquema `practica_prestamos`, las tres tablas, las restricciones y los datos de ejemplo (10 equipos de 5 categorías y 3 usuarios).

> **Atención:** `init.sql` termina con un `TRUNCATE ... RESTART IDENTITY`, así que **borra todos los datos de la práctica cada vez que se ejecuta**. Úsalo solo para reiniciar el estado.

### 4. Arrancar la aplicación

```bash
node --env-file=.env src/server.mjs
```

Aparece `Servidor escuchando en http://127.0.0.1:3000/equipos`. Detén el servidor con `Ctrl+C`.

## Modelo de datos

| Tabla | Campos | Reglas principales |
|---|---|---|
| `equipos` | id, codigo, nombre, categoria, disponible | id autogenerado; `codigo` único de 1 a 20 caracteres; nombre y categoría obligatorios y no vacíos; `disponible` booleano con valor inicial `true` |
| `usuarios` | id, nombre | Usuarios de prueba creados en la inicialización |
| `prestamos` | id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion | Claves foráneas; `fecha_prestamo` automática; `fecha_devolucion` es `NULL` mientras el préstamo está activo |

Reglas protegidas por la base de datos:

- **Un solo préstamo activo por equipo:** índice único parcial sobre `equipo_id` cuando `fecha_devolucion IS NULL`.
- **No se puede borrar un equipo con préstamos**, ni siquiera finalizados: las claves foráneas usan `ON DELETE RESTRICT` y no hay borrado en cascada.
- `CHECK` de que la devolución no sea anterior al préstamo.

## Rutas disponibles

### Vistas HTML

| Ruta | Descripción |
|---|---|
| `GET /equipos` | Tabla de equipos con búsqueda por nombre (`q`, ILIKE), filtro por `categoria` y `disponible` (`true`/`false`), orden por `codigo` o `nombre` y paginación de 5 en 5 (`pagina`). Los filtros se mantienen al paginar. |
| `GET /equipos/:id` | Datos del equipo, usuario que lo tiene actualmente e historial de préstamos. `400` si el id es inválido y `404` si no existe. |

### API JSON

| Método y ruta | Cuerpo | Resultado |
|---|---|---|
| `POST /api/equipos` | `{ codigo, nombre, categoria }` | `201` con el equipo creado y cabecera `Location`; `400` si los datos no son válidos; `409` si el código está repetido |
| `PUT /api/equipos/:id` | `{ codigo, nombre, categoria }` | `200` con el equipo actualizado; `404` si no existe. No modifica `disponible` |
| `DELETE /api/equipos/:id` | Sin cuerpo | `204`; `404` si no existe; `409` si tiene préstamos |
| `POST /api/prestamos` | `{ equipoId, usuarioId }` | `201` con el préstamo; `409` si el equipo está ocupado; `400` si el usuario no existe |
| `POST /api/prestamos/:id/devolucion` | Sin cuerpo | `200` con el préstamo devuelto; `409` si el préstamo no existe o ya estaba devuelto |

## Decisiones de implementación

- **SQL directo con `pg` y consultas parametrizadas** (`$1`, `$2`, ...) para todos los valores del cliente. La ordenación usa una lista blanca de dos opciones y nunca concatena texto recibido.
- **Préstamo atómico:** un único cliente del pool ejecuta `BEGIN`, un `UPDATE` condicional (`disponible = true`), el `INSERT` del préstamo y `COMMIT`. Ante cualquier fallo se ejecuta `ROLLBACK`, y el cliente se libera siempre en `finally`.
- **Concurrencia:** la actualización condicional y el índice único parcial garantizan que, con dos peticiones simultáneas para el mismo equipo, solo una se confirma.
- **Errores:** los SQLSTATE `23505`, `23503`, `23502` y `23514` se traducen a códigos HTTP. Al cliente nunca llegan mensajes técnicos de SQL ni credenciales.
- La paginación pide una fila más que el tamaño de página para saber si existe página siguiente sin hacer un `COUNT`.

## Pruebas realizadas

Con el servidor arrancado y los datos recién reiniciados con `init.sql`:

```bash
node probar.mjs
```

El script imprime una línea `OK`/`FALLO` por caso con el resultado esperado y el obtenido. Debe ejecutarse **una sola vez por cada reinicio de datos**; si se repite sin reiniciar, fallarán varios casos por el estado previo.

| Caso | Petición | Resultado esperado | Resultado obtenido |
|---|---|---|---|
| Alta | `POST /api/equipos` | 201 y cabecera `Location` | |
| Código repetido | `POST /api/equipos` con el mismo código | 409 | |
| Datos inválidos | `POST /api/equipos` con código vacío | 400 | |
| Modificación | `PUT /api/equipos/:id` | 200 con los datos nuevos | |
| Modificar inexistente | `PUT /api/equipos/999999` | 404 | |
| Borrado sin historial | `DELETE /api/equipos/:id` | 204 | |
| Borrar inexistente | `DELETE /api/equipos/:id` repetido | 404 | |
| Borrado con historial | `DELETE /api/equipos/1` tras prestarlo | 409 | |
| Búsqueda ILIKE | `GET /equipos?q=port` | 200, solo equipos con "port" en el nombre | |
| Filtro categoría | `GET /equipos?categoria=Tabletas` | 200, solo tabletas | |
| Filtro disponibilidad | `GET /equipos?disponible=false` | 200, solo equipos prestados | |
| Ordenación | `GET /equipos?orden=nombre` | 200 | |
| Segunda página | `GET /equipos?pagina=2` | 200, equipos del 6 al 10 | |
| Sin resultados | `GET /equipos?q=zzzz` | 200 con mensaje de vacío | |
| Detalle id mal formado | `GET /equipos/abc` | 400 | |
| Detalle inexistente | `GET /equipos/999999` | 404 | |
| Préstamo correcto | `POST /api/prestamos` `{equipoId:1, usuarioId:1}` | 201, un préstamo activo y equipo no disponible | |
| Préstamo duplicado | Mismo equipo con otro usuario | 409 sin duplicar filas | |
| Rollback | `POST /api/prestamos` con `usuarioId: 999` | 400; el equipo sigue disponible y sin préstamo nuevo | |
| Devolución | `POST /api/prestamos/:id/devolucion` | 200, `fecha_devolucion` registrada y equipo disponible | |
| Segunda devolución | Misma petición repetida | 409 sin modificar nada | |
| Simultaneidad | Dos `POST /api/prestamos` a la vez con `Promise.all` | Un 201 y un 409; solo una fila de préstamo | |

## Limitaciones conocidas

- Demostración local: no hay autenticación, sesiones ni permisos. El `usuarioId` se recibe en el cuerpo de la petición, algo que en una aplicación real debería obtenerse de la identidad autenticada.
- La interfaz solo permite consultar equipos; el resto de operaciones se prueban con `probar.mjs` o con un cliente HTTP.
- No hay endpoints para gestionar usuarios: se crean al inicializar la base de datos.
- No se incluyen tests automatizados con framework; la comprobación se hace con `probar.mjs`.
- El filtro de categoría es una coincidencia exacta y distingue mayúsculas de minúsculas.
- Los comodines `%` y `_` de la búsqueda por nombre conservan su significado de patrón.


PORT=3000

DB_ADMIN_PASSWORD=admin
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=tu_contraseña
DB_NAME=prestamos

.env
!.env.example
.DS_Store
