# 🤖 Chatbot WhatsApp + CRM - Commerk

Sistema completo de automatización de ventas por WhatsApp con CRM integrado para Tienda Commerk Antioquia.

## 📋 Características

✅ **Chatbot WhatsApp 24/7** - Responde automáticamente consultas de productos, precios y envíos
✅ **Generación automática de links de pago** (Wompi) 
✅ **CRM completo** - Dashboard con métricas en tiempo real
✅ **Integración con Shopify** - Sincronización de productos e inventario
✅ **Base de datos Supabase** - Almacena clientes, conversaciones y ventas
✅ **Diseño profesional** - Colores de marca Commerk
✅ **TypeScript** - Código type-safe y mantenible

## 🛠️ Stack Tecnológico

- **Framework**: Next.js 14 (App Router)
- **Lenguaje**: TypeScript
- **Estilos**: Tailwind CSS + Shadcn/ui
- **Base de Datos**: Supabase (PostgreSQL)
- **WhatsApp**: Meta Cloud API
- **E-commerce**: Shopify Admin API
- **Pagos**: Wompi (Colombia)
- **IA (Opcional)**: OpenAI GPT-4
- **Deploy**: Vercel

## 📦 Instalación

### 1. Clonar e instalar dependencias

```bash
cd chatbot-crm-commerk
npm install
```

### 2. Configurar variables de entorno

Copia `.env.example` a `.env.local` y llena todas las variables:

```bash
cp .env.example .env.local
```

Edita `.env.local` con tus credenciales reales.

### 3. Configurar Supabase

Crea las tablas ejecutando este SQL en tu proyecto Supabase:

```sql
-- Ver archivo: sql/schema.sql
```

### 4. Configurar WhatsApp Business API

1. Ve a https://developers.facebook.com/
2. Crea una app de tipo "Business"
3. Añade el producto "WhatsApp"
4. Copia el Phone Number ID y Access Token
5. Configura el webhook apuntando a: `https://tudominio.com/api/webhook/whatsapp`

### 5. Configurar Shopify

1. Admin > Apps > Develop apps > Create app
2. Permisos necesarios: `read_products`, `read_inventory`
3. Copia el Access Token

### 6. Configurar Wompi

1. Ve a https://comercios.wompi.co/
2. Dashboard > Configuración > API Keys
3. Copia las keys de producción

### 7. Iniciar proyecto

```bash
# Desarrollo
npm run dev

# Producción
npm run build
npm start
```

## 📱 Uso

### Dashboard CRM

Accede a `http://localhost:3000/dashboard` para ver:

- Métricas en tiempo real
- Lista de clientes
- Conversaciones activas
- Ventas completadas
- Reportes

### WhatsApp Bot

Los clientes escriben al número de WhatsApp Business configurado y el bot responde automáticamente:

**Ejemplo de flujo:**
1. Cliente: "Hola"
2. Bot: Saludo + opciones
3. Cliente: "catálogo"
4. Bot: Lista de productos
5. Cliente: "carta de oro"
6. Bot: Detalles + precio
7. Cliente: "quiero comprarlo"
8. Bot: Genera link de pago automáticamente

## 🔧 Personalización

### Cambiar respuestas del bot

Edita: `lib/bot-logic.ts`

```typescript
function respuestaSaludo(context: BotContext): BotResponse {
  return {
    texto: 'Tu mensaje personalizado aquí',
  };
}
```

### Agregar nuevos productos

Los productos se sincronizan automáticamente desde Shopify. Para forzar sincronización:

```bash
curl -X POST https://tudominio.com/api/sync/productos
```

### Personalizar diseño

Colores de marca en: `tailwind.config.ts`

```typescript
commerk: {
  navy: "#1B3A6B",
  wine: "#8B1A1A",
  gold: "#D4AF37",
  green: "#25D366",
}
```

## 🚀 Deploy en Vercel

1. Conecta tu repositorio a Vercel
2. Agrega todas las variables de entorno
3. Deploy automático en cada push a main

## 📊 Estructura del Proyecto

```
chatbot-crm-commerk/
├── app/
│   ├── api/
│   │   └── webhook/
│   │       ├── whatsapp/     # Recibe mensajes de WhatsApp
│   │       ├── shopify/      # Sincroniza productos
│   │       └── wompi/        # Confirma pagos
│   ├── dashboard/            # CRM Panel
│   └── globals.css           # Estilos globales
├── components/
│   └── ui/                   # Componentes reutilizables
├── lib/
│   ├── supabase.ts           # Cliente DB
│   ├── whatsapp.ts           # API WhatsApp
│   ├── shopify.ts            # API Shopify
│   ├── wompi.ts              # API Wompi
│   └── bot-logic.ts          # Lógica del chatbot
├── types/
│   └── index.ts              # TypeScript types
└── README.md                 # Este archivo
```

## 🐛 Troubleshooting

### El bot no responde

1. Verifica que el webhook esté configurado correctamente
2. Revisa los logs en Vercel/servidor
3. Confirma que el WEBHOOK_VERIFY_TOKEN coincida

### Los productos no aparecen

1. Verifica el SHOPIFY_ACCESS_TOKEN
2. Confirma permisos de la app en Shopify
3. Ejecuta sincronización manual

### Los pagos no se confirman

1. Verifica el WOMPI_EVENT_SECRET
2. Configura el webhook en Wompi apuntando a `/api/webhook/wompi`
3. Revisa logs de transacciones

## 💰 Costos Operativos

| Servicio | Costo Mensual |
|----------|---------------|
| Vercel Pro | $20 USD |
| Supabase Pro | $25 USD |
| WhatsApp Business API | Gratis hasta 1000 conversaciones |
| Wompi | 3.49% + IVA por transacción |
| **Total** | **~$45 USD + transacciones** |

## 📞 Soporte

Creado por: **Ing. Cristhian Salguero**  
Email: contacto@amcagencyweb.com  
WhatsApp: +57 318 334 9171

---

**© 2026 AMC Agency Web - Todos los derechos reservados**
