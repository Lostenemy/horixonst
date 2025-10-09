# HorizonST Access Control Server

Esta aplicación implementa un servidor de ingesta MQTT y un portal web para la gestión de gateways, dispositivos BLE, lugares, categorías y alarmas de presencia.

## Componentes principales

- **Servidor HTTP / API REST** construido con Express.
- **Cliente MQTT** que se conecta al broker proporcionado y procesa los mensajes de los tópicos `devices/MK1`, `devices/MK2` y `devices/MK3`.
- **Decodificadores** para normalizar tramas BLE Eddystone-TLM y estructuras personalizadas.
- **PostgreSQL** como base de datos relacional con scripts SQL en `sql/schema.sql` para generar toda la estructura.
- **Portal web** en `public/` (HTML5 + JavaScript) accesible desde la raíz del servidor (`www.horizonst.com.es`).

## Requisitos

- Node.js 18+
- PostgreSQL 14+

## Puesta en marcha

### Ejecución local

1. Copiar `.env.example` a `.env` y ajustar las credenciales de base de datos si es necesario.

   El archivo de ejemplo está preconfigurado con las credenciales proporcionadas:

   ```env
   DB_USER=Horizonst_user
   DB_PASSWORD=20025@BLELoRa
   DB_NAME=horixonst
   DB_ROOT_USER=Horizonst_user
   DB_ROOT_PASSWORD=20025@BLELoRa
   DB_ROOT_DATABASE=postgres
   MQTT_HOST=horizonst.com.es
   MQTT_PORT=1883
   MQTT_USER=mqtt@user
   MQTT_PASS=20025@BLELoRa
   ```

   > El servidor verifica en cada arranque que existan la base de datos y el rol configurados. Para ello utiliza `DB_ROOT_USER`, `DB_ROOT_PASSWORD` y `DB_ROOT_DATABASE`. Asegúrate de que estas credenciales tengan privilegios de creación cuando el despliegue sea contra una instancia nueva.

   > Para la conexión MQTT el cliente utiliza por defecto el protocolo 3.1.1 (versión `4`). Si tu broker requiere MQTT 5, ajusta `MQTT_PROTOCOL_VERSION=5`; en ese caso deja `MQTT_PROTOCOL_ID` vacío para que el cliente escoja automáticamente el identificador correcto.

### Broker MQTT

- **Con Docker Compose**: el archivo `docker-compose.yml` incluye un servicio `mqtt` basado en `emqx/emqx:5.8.0` configurado con volúmenes nombrados para conservar los datos, registros y configuración (`emqx-data`, `emqx-log`, `emqx-config`). Expone los puertos `1883`, `8883`, `8083`, `8084` y `18083` al exterior, deshabilita el acceso anónimo y crea automáticamente el usuario `mqtt@user` con contraseña `20025@BLELoRa`. El panel de administración queda disponible en `http://localhost:18083` (o la IP del servidor) usando las credenciales del dashboard (`mqtt` / `20025@BLELoRa`).
- **Sin Docker Compose**: si prefieres utilizar un broker externo, replica la configuración anterior y asegúrate de registrar el usuario `mqtt@user` con la contraseña indicada, además de habilitar el listener TCP en el puerto que hayas definido. Ajusta `MQTT_HOST` y `MQTT_PORT` en tu `.env` para apuntar a ese servidor.

2. (Opcional si el paso anterior ya tenía permisos de creación) Crear la base de datos y ejecutar el script de esquema manualmente:

   ```bash
   createdb horixonst
   psql horixonst < sql/schema.sql
   ```

3. Instalar dependencias y arrancar el servidor:

   ```bash
   npm install
   npm run dev
   ```

   El servidor escuchará en `http://localhost:8080` y se conectará automáticamente al broker MQTT configurado.

### Despliegue con Docker

1. Copiar el archivo de variables de entorno y, si se desea, modificar los valores por defecto:

   ```bash
   cp .env.example .env
   ```

   > El archivo `.env` es opcional; si no existe se utilizarán los valores definidos en `docker-compose.yml`.

2. Construir y levantar los servicios del API, PostgreSQL y el broker MQTT:

   ```bash
   docker compose up --build
   ```

   Este comando ejecutará tres contenedores:

- **horixonst-mqtt**: broker EMQX con persistencia proporcionada por los volúmenes `emqx-data`, `emqx-log` y `emqx-config`, accesible desde los puertos publicados (`1883`, `8883`, `8083`, `8084`, `18083`).
- **horixonst-db**: instancia de PostgreSQL con el esquema de `sql/schema.sql` cargado automáticamente.
- **horixonst-app**: servidor Node.js sirviendo el portal web en `http://localhost:8080` y conectado al broker MQTT interno (host `mqtt`).

> El contenedor de la aplicación ejecuta una fase de "bootstrap" que crea la base de datos y el rol configurados si todavía no existen.
> Puedes controlar cómo se aplica el esquema SQL mediante `DB_BOOTSTRAP_SCHEMA` (`on-create`, `always` o `never`) y, si lo necesitas, señalar un archivo alternativo con `DB_SCHEMA_PATH`.

3. Para ejecutar en segundo plano utiliza:

   ```bash
   docker compose up -d
   ```

4. Para detener y eliminar los contenedores:

   ```bash
   docker compose down
   ```

### Lanzadores independientes con Docker Compose

Si necesitas controlar el arranque de cada componente por separado, el repositorio incluye
archivos específicos que extienden la definición principal y eliminan las dependencias
cruzadas. De este modo puedes preparar primero el broker MQTT, luego la base de datos y
finalmente la aplicación.

- **Broker MQTT**

  ```bash
  docker compose -f docker-compose.mqtt.yml up -d
  ```

- **Base de datos PostgreSQL**

  ```bash
  docker compose -f docker-compose.db.yml up -d
  ```

- **Aplicación Node.js / Portal web**

  ```bash
  docker compose -f docker-compose.app.yml up -d
  ```

> El contenedor de la aplicación sigue esperando a que la base de datos y el broker estén
> operativos para poder completar la fase de bootstrap y conectarse. Cuando gestiones los
> servicios manualmente, asegúrate de que `horixonst-mqtt` y `horixonst-db` estén en marcha
> antes de iniciar `horixonst-app`.

Cada lanzador utiliza el mismo nombre de proyecto (derivado de la carpeta) y por tanto
comparte la red Docker. La definición `docker-compose.app.yml` establece como valores por
defecto `horixonst-db` y `horixonst-mqtt` para `DB_HOST` y `MQTT_HOST`, de modo que la
aplicación localizará automáticamente los otros contenedores si los has iniciado con los
archivos anteriores. Si necesitas utilizar hosts distintos, crea o modifica tu `.env`
estableciendo esas variables antes de arrancar la aplicación:

```bash
DB_HOST=mi-db-personal
MQTT_HOST=mi-broker
docker compose -f docker-compose.app.yml up -d
```

Cuando arranques y detengas servicios de forma individual es normal que Docker Compose
muestre avisos sobre "orphan containers"; puedes ignorarlos o añadir la bandera
`--remove-orphans` si deseas que se eliminen automáticamente los contenedores no definidos
en el archivo que estés usando.

## Credenciales iniciales

En la carga inicial de la base de datos se crea el usuario administrador `admin` con contraseña `admin1234`.

## Gestión de datos

- **Administradores** pueden dar de alta gateways y dispositivos, revisar los mensajes MQTT y consultar el histórico de cualquier dispositivo.
- **Usuarios** pueden crear lugares, categorías, asignar dispositivos a su perfil, gestionar fotos mediante URLs, agrupar dispositivos por lugar y configurar alarmas basadas en la última posición conocida.

## Alarmas

Cada alarma define un tiempo máximo (en segundos) que un dispositivo puede permanecer fuera de su último lugar detectado. El servicio evalúa periódicamente las alarmas y genera eventos cuando se excede el umbral.

## Seguridad

El acceso al API se realiza mediante JWT. Usa el endpoint `/api/auth/login` para autenticación y añade el token en la cabecera `Authorization: Bearer <token>` para el resto de peticiones.

## Scripts adicionales

- `npm start`: Ejecuta el servidor en modo producción.
- `npm run dev`: Usa nodemon para recargar automáticamente durante el desarrollo.

## Frontend

El portal web se sirve desde la carpeta `public/` y ofrece un dashboard responsive donde se agrupan los dispositivos por lugar, se gestionan los catálogos y se visualizan los mensajes MQTT e históricos.
