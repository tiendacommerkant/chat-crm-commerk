import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-commerk-navy flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background decorative blobs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-commerk-navy-light rounded-full opacity-30 blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[32rem] h-[32rem] bg-commerk-navy-dark rounded-full opacity-50 blur-3xl translate-x-1/3 translate-y-1/3" />
      <div className="absolute top-1/2 left-1/2 w-80 h-80 bg-commerk-green rounded-full opacity-5 blur-3xl -translate-x-1/2 -translate-y-1/2" />

      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-4xl mx-auto gap-8 animate-fade-in">
        {/* Badge */}
        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-commerk-green/10 border border-commerk-green/30 text-commerk-green text-sm font-medium">
          <span className="w-2 h-2 bg-commerk-green rounded-full animate-pulse" />
          Sistema activo 24/7
        </span>

        {/* Logo + Title */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-commerk-green/15 border border-commerk-green/30 flex items-center justify-center shadow-lg shadow-commerk-green/10">
            <svg className="w-10 h-10 text-commerk-green" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white leading-tight">
            Tienda Commerk<br />
            <span className="text-commerk-green">WhatsApp CRM</span>
          </h1>
        </div>

        <p className="text-lg text-slate-300 max-w-2xl leading-relaxed">
          Sistema completo de automatización de ventas por WhatsApp para <strong className="text-white">tiendacommerkant.com.co</strong>. 
          Gestión de clientes, pedidos y pagos en tiempo real.
        </p>

        {/* Feature Pills */}
        <div className="flex flex-wrap justify-center gap-3">
          {['🤖 Chatbot 24/7', '💳 Pagos Wompi', '📦 Inventario Shopify', '📊 CRM Completo'].map((f) => (
            <span key={f} className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-slate-300 backdrop-blur-sm">
              {f}
            </span>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-4 mt-2">
          <Link
            href="/dashboard"
            className="px-8 py-4 bg-commerk-green text-commerk-navy-dark rounded-xl font-bold text-base hover:brightness-110 transition-all shadow-lg shadow-commerk-green/25 hover:shadow-commerk-green/40 hover:-translate-y-0.5"
          >
            Abrir Dashboard CRM
          </Link>
          <Link
            href="/dashboard/conversaciones"
            className="px-8 py-4 bg-white/10 border border-white/20 text-white rounded-xl font-semibold text-base hover:bg-white/15 transition-all backdrop-blur-sm"
          >
            Ver Conversaciones
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-8 mt-8 pt-8 border-t border-white/10 w-full max-w-lg">
          {[
            { label: 'Clientes', value: 'CRM' },
            { label: 'Canales', value: 'WhatsApp' },
            { label: 'Pagos', value: 'Wompi' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <div className="text-commerk-green font-bold text-lg">{s.value}</div>
              <div className="text-slate-400 text-sm">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
