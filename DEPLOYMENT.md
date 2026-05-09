# 🚀 GUÍA DE DESPLIEGUE

## Opción 1: Despliegue en Vercel (Recomendado)

### Paso 1: Preparar el repositorio

```bash
git init
git add .
git commit -m "Initial commit: Chatbot CRM Commerk"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/chatbot-crm-commerk.git
git push -u origin main
```

### Paso 2: Conectar con Vercel

1. Ve a https://vercel.com
2. Click en "Add New Project"
3. Importa tu repositorio de GitHub
4. Configura las variables de entorno (ver .env.example)
5. Click en "Deploy"

### Paso 3: Configurar Webhooks

Una vez desplegado, obtendrás una URL como:
`https://chatbot-crm-commerk.vercel.app`

Configura estos webhooks:

**WhatsApp:**
- URL: `https://TU-DOMINIO.vercel.app/api/webhook/whatsapp`
- Método: POST
- Verify Token: (el que pusiste en .env)

**Wompi:**
- URL: `https://TU-DOMINIO.vercel.app/api/webhook/wompi`
- Eventos: transaction.updated

**Shopify:**
- URL: `https://TU-DOMINIO.vercel.app/api/webhook/shopify`
- Evento: Product update

## Opción 2: Railway

```bash
# Instalar Railway CLI
npm i -g @railway/cli

# Login
railway login

# Inicializar proyecto
railway init

# Agregar variables de entorno
railway variables set WHATSAPP_PHONE_NUMBER_ID=xxx
# ... (repetir para todas las variables)

# Deploy
railway up
```

## Opción 3: VPS (Digital Ocean / AWS / Contabo)

```bash
# En tu servidor
git clone https://github.com/TU_USUARIO/chatbot-crm-commerk.git
cd chatbot-crm-commerk
npm install
npm run build

# Con PM2
pm2 start npm --name "chatbot-crm" -- start
pm2 save
pm2 startup
```

### Nginx Config

```nginx
server {
    listen 80;
    server_name tudominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Checklist Post-Deployment

- [ ] Webhooks configurados y verificados
- [ ] Variables de entorno correctas
- [ ] Base de datos Supabase con schema aplicado
- [ ] Productos sincronizados desde Shopify
- [ ] Mensaje de prueba en WhatsApp funciona
- [ ] Link de pago de prueba se genera
- [ ] Dashboard CRM accesible

## Monitoreo

### Logs en Vercel
```bash
vercel logs --follow
```

### Health Check
```bash
curl https://TU-DOMINIO.vercel.app/api/health
```

## Troubleshooting

**Error: Webhook no responde**
- Verifica que la URL sea HTTPS
- Revisa los logs en Vercel/Railway
- Confirma que el Verify Token coincida

**Error: No se generan links de pago**
- Verifica las credenciales de Wompi
- Revisa que el monto esté en el formato correcto (centavos)

**Error: Productos no se muestran**
- Sincroniza manualmente desde Shopify
- Verifica el Access Token de Shopify
- Revisa permisos de la app en Shopify

