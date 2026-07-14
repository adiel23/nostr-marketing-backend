# 📑 Documento de Requerimientos (MVP)

## Requerimientos Funcionales

### 1. Gestión de Empresas
El sistema debe permitir:

- Registro de empresas.
- Inicio de sesión.
- Gestión del perfil de la empresa.

---

### 2. Configuración de Campañas (Pay as You Go)

El sistema debe permitir crear campañas con los siguientes campos:

- Nombre.
- Descripción.
- Keywords.
- URL de NWC.
- Cantidad de sats por impacto.

**Restricciones:**

- No existe un límite inicial de impactos.

---

### 3. Validación de Conexión NWC

Antes de activar una campaña, el sistema debe verificar que:

- La URL de NWC sea válida.
- La wallet posea permisos de débito.

Si la validación falla, la campaña no podrá activarse.

---

### 4. Ciclo de Vida de Campañas

El sistema debe permitir que una campaña pueda:

- Pausarse.
- Reanudarse.
- Cancelarse.

Estas acciones deberán realizarse en tiempo real desde el panel de control.

---

### 5. Monitoreo de Relay Único

El backend deberá mantener una conexión persistente mediante WebSocket hacia un único relay de Nostr configurado por defecto para escuchar publicaciones globales.

---

### 6. Control de Spam (Frecuencia Única)

Antes de procesar un post, el sistema debe verificar si el autor ya fue impactado previamente por la misma campaña.

Si ya existe un impacto registrado:

- El post será ignorado.

---

### 7. Filtro Heurístico Local

Antes de enviar un post al LLM, el sistema deberá ejecutar filtros locales para reducir costos y mejorar el rendimiento.

Como mínimo deberá validar:

- Longitud mínima del contenido.
- Descarte de bots conocidos.

---

### 8. Evaluación Contextual mediante LLM

Los posts que superen el filtro heurístico deberán enviarse a un LLM económico (por ejemplo GPT-4o-mini o DeepSeek) para determinar si el contenido expresa una necesidad o interés real alineado con la descripción de la campaña.

---

### 9. Ejecución Transaccional del Impacto

Cuando un post sea considerado válido, el sistema deberá:

1. Publicar un comentario promocional utilizando la identidad global de la plataforma.
2. Intentar realizar el Zap mediante NWC.

Si el Zap falla debido a que el usuario no posee Lightning Address:

- El comentario permanecerá publicado.
- El impacto se considerará ejecutado.
- Se cobrará únicamente el fee de la plataforma.
- No se descontarán los sats correspondientes al Zap.

---

### 10. Cierre Automático por Tiempo

Las campañas deberán finalizar automáticamente después de cumplir **30 días corridos** desde su activación.

---

# Requerimientos No Funcionales

## 1. Modelo Financiero Integrado (Fee Split)

Por cada impacto exitoso, el sistema deberá calcular automáticamente el monto a cobrar como:

```
Cobro Total = Sats del Zap + Fee de la Plataforma
```

---

## 2. Procesamiento Asíncrono

Todo el flujo de procesamiento deberá ejecutarse mediante una cola de tareas asíncronas (por ejemplo Redis + BullMQ).

El flujo comprende:

1. Recepción del post desde el relay.
2. Aplicación de filtros heurísticos.
3. Evaluación mediante LLM.
4. Publicación del comentario.
5. Ejecución del Zap.
6. Registro del resultado.

La arquitectura deberá soportar alta concurrencia.

---

## 3. Seguridad de la NWC

Las URLs de conexión NWC deberán almacenarse cifradas mediante:

- AES-256 (cifrado simétrico).

Las claves de cifrado deberán mantenerse fuera del código fuente mediante variables de entorno.

---

## 4. Gestión de Identidad Global

El servidor deberá almacenar de forma segura las claves criptográficas (`nsec`) correspondientes a la cuenta oficial del bot de la plataforma.

Estas claves serán utilizadas para:

- Firmar eventos de Nostr.
- Publicar comentarios promocionales en nombre de la plataforma.