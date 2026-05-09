const fs = require('fs');
const path = require('path');

const files = {
  'components/ui/card.tsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("rounded-xl border bg-card text-card-foreground shadow", className)} {...props} />
))
Card.displayName = "Card"

export { Card }
`,
  'components/ui/button.tsx': `import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "ghost"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "default", ...props }, ref) => {
  const variants = {
    default: "bg-commerk-navy text-white hover:bg-commerk-navy/90",
    destructive: "bg-commerk-wine text-white hover:bg-commerk-wine/90",
    outline: "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground"
  }
  return (
    <button
      ref={ref}
      className={cn("inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2", variants[variant], className)}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button }
`,
  'components/ui/badge.tsx': `import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {}

function Badge({ className, ...props }: BadgeProps) {
  return (
    <div className={cn("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", className)} {...props} />
  )
}

export { Badge }
`,
  'components/ui/table.tsx': `import * as React from "react"
import { cn } from "@/lib/utils"

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => (
  <div className="w-full overflow-auto"><table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} /></div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
))
TableBody.displayName = "TableBody"

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)} {...props} />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <th ref={ref} className={cn("h-10 px-2 text-left align-middle font-medium text-muted-foreground", className)} {...props} />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("p-2 align-middle", className)} {...props} />
))
TableCell.displayName = "TableCell"

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
`,
  'app/api/webhook/shopify/route.ts': `import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const hmac = req.headers.get('x-shopify-hmac-sha256');
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET || '';
    
    const hash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
    
    if (hash !== hmac) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = JSON.parse(body);
    
    // update logic based on payload
    if (payload.id) {
      await supabase.from('productos').upsert({
        id: payload.id,
        titulo: payload.title,
        inventario: payload.variants?.[0]?.inventory_quantity || 0,
        precio: payload.variants?.[0]?.price || 0,
        updated_at: new Date().toISOString()
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Shopify webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
`,
  'app/api/webhook/wompi/route.ts': `import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    // Signature verification logic should be here according to Wompi docs
    
    const { data: { transaction } } = payload;
    
    if (transaction && transaction.status === 'APPROVED') {
      const reference = transaction.reference;
      
      const { error } = await supabase
        .from('ventas')
        .update({ estado: 'pagado', updated_at: new Date().toISOString() })
        .eq('referencia', reference);
        
      if (error) throw error;
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Wompi webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
`,
  'app/api/webhook/whatsapp/route.ts': `import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.value && change.value.messages) {
            const message = change.value.messages[0];
            const contact = change.value.contacts[0];
            const phone = message.from;
            const text = message.text?.body || '';

            // Guarda mensaje en BD (Asegurar Supabase Service Role si aplica)
            await supabase.from('conversaciones').insert({
              telefono: phone,
              nombre: contact.profile.name,
              mensaje: text,
              tipo: 'entrante',
              created_at: new Date().toISOString()
            });

            // bot-logic.ts process here...
          }
        }
      }
      return NextResponse.json({ success: true }, { status: 200 });
    }
    
    return NextResponse.json({ success: false }, { status: 400 });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}
`,
  'app/dashboard/layout.tsx': `import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-64 bg-commerk-navy text-white flex flex-col">
        <div className="p-6">
          <h2 className="text-2xl font-bold text-commerk-green">Commerk</h2>
          <p className="text-sm text-gray-300">CRM & Chatbot</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <Link href="/dashboard" className="block px-4 py-2 rounded hover:bg-commerk-navy-light transition-colors">Dashboard</Link>
          <Link href="/dashboard/clientes" className="block px-4 py-2 rounded hover:bg-commerk-navy-light transition-colors">Clientes</Link>
          <Link href="/dashboard/conversaciones" className="block px-4 py-2 rounded hover:bg-commerk-navy-light transition-colors">Conversaciones</Link>
          <Link href="/dashboard/ventas" className="block px-4 py-2 rounded hover:bg-commerk-navy-light transition-colors">Ventas</Link>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
`,
  'app/dashboard/page.tsx': `'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';

export default function DashboardPage() {
  const [metricas, setMetricas] = useState({
    ventasHoy: 0,
    ingresosHoy: 0,
    clientesNuevos: 0
  });

  useEffect(() => {
    async function cargarMetricas() {
      const hoy = new Date().toISOString().split('T')[0];
      
      const { data: ventas } = await supabase
        .from('ventas')
        .select('*')
        .gte('created_at', \`\${hoy}T00:00:00\`)
        .eq('estado', 'pagado');
      
      setMetricas({
        ventasHoy: ventas?.length || 0,
        ingresosHoy: ventas?.reduce((sum, v) => sum + v.total, 0) || 0,
        clientesNuevos: 0
      });
    }
    
    cargarMetricas();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-commerk-navy mb-8">Dashboard</h1>
      
      <div className="grid grid-cols-3 gap-6">
        <Card className="p-6">
          <div className="text-sm text-gray-500">Ventas Hoy</div>
          <div className="text-4xl font-bold text-commerk-navy">{metricas.ventasHoy}</div>
        </Card>
        
        <Card className="p-6">
          <div className="text-sm text-gray-500">Ingresos Hoy</div>
          <div className="text-4xl font-bold text-commerk-green">
            \${metricas.ingresosHoy.toLocaleString('es-CO')}
          </div>
        </Card>
        
        <Card className="p-6">
          <div className="text-sm text-gray-500">Clientes Nuevos</div>
          <div className="text-4xl font-bold text-commerk-navy">{metricas.clientesNuevos}</div>
        </Card>
      </div>
    </div>
  );
}
`,
  'app/dashboard/clientes/page.tsx': `import { Card } from "@/components/ui/card"

export default function ClientesPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-commerk-navy mb-8">Clientes</h1>
      <Card className="p-6">
        <div className="text-gray-500">Lista de clientes en desarrollo...</div>
      </Card>
    </div>
  )
}
`,
  'app/dashboard/conversaciones/page.tsx': `import { Card } from "@/components/ui/card"

export default function ConversacionesPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-commerk-navy mb-8">Conversaciones</h1>
      <Card className="p-6">
        <div className="text-gray-500">Historial de conversaciones en desarrollo...</div>
      </Card>
    </div>
  )
}
`,
  'app/dashboard/ventas/page.tsx': `import { Card } from "@/components/ui/card"

export default function VentasPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-commerk-navy mb-8">Ventas</h1>
      <Card className="p-6">
        <div className="text-gray-500">Lista de ventas en desarrollo...</div>
      </Card>
    </div>
  )
}
`
};

for (const [filepath, content] of Object.entries(files)) {
  const fullPath = path.join(process.cwd(), filepath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

console.log("All files created successfully!");
