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

1. Crear la base de datos y ejecutar el script de esquema:

   ```bash
   createdb horixonst
   psql horixonst < sql/schema.sql
   ```

2. Copiar `.env.example` a `.env` y ajustar las credenciales de base de datos si es necesario.

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
