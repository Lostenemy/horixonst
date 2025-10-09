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

### Configuración del broker MQTT

El comando de despliegue de EMQX propuesto arranca la autenticación anónima desactivada, por lo que es necesario registrar el usuario que empleará la aplicación antes de que el servicio pueda conectarse.

1. Arranca el broker con el comando facilitado:

   ```bash
   sudo docker run -d --name emqx --restart unless-stopped \
     -p 1883:1883 -p 8883:8883 -p 8083:8083 -p 8084:8084 -p 18083:18083 \
     -v /opt/emqx/data:/opt/emqx/data \
     -v /opt/emqx/log:/opt/emqx/log \
     -v /opt/emqx/etc:/opt/emqx/etc \
     -e EMQX_DASHBOARD__DEFAULT_USERNAME=mqtt \
     -e EMQX_DASHBOARD__DEFAULT_PASSWORD='20025@BLELoRa' \
     -e EMQX_ALLOW_ANONYMOUS=false emqx/emqx:5.8.0
   ```

2. Crea el usuario MQTT que utilizará la aplicación. Puedes hacerlo desde el panel (`http://<tu-servidor>:18083`) autenticándote con las credenciales anteriores y registrando el usuario `mqtt@user` con contraseña `20025@BLELoRa` en el autenticador Password-Based. También puedes usar la CLI del contenedor:

   ```bash
   sudo docker exec -it emqx /opt/emqx/bin/emqx ctl users add mqtt@user 20025@BLELoRa
   ```

3. Comprueba que el listener MQTT TCP (puerto 1883) está habilitado. Si decides usar otro puerto, actualiza `MQTT_PORT` en tu `.env` o en las variables de entorno del servicio `horixonst-app`.

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

2. Construir y levantar los servicios del API y de PostgreSQL:

   ```bash
   docker compose up --build
   ```

   Este comando ejecutará dos contenedores:

   - **horixonst-db**: instancia de PostgreSQL con el esquema de `sql/schema.sql` cargado automáticamente.
   - **horixonst-app**: servidor Node.js sirviendo el portal web en `http://localhost:8080` y conectado al broker MQTT.

   > El contenedor de la aplicación ejecuta una fase de "bootstrap" que crea la base de datos y el rol configurados si todavía no existen.

3. Para ejecutar en segundo plano utiliza:

   ```bash
   docker compose up -d
   ```

4. Para detener y eliminar los contenedores:

   ```bash
   docker compose down
   ```

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
