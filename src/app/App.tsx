const pieces = [
  { name: 'Siluetas amplias', category: '01 / REMERAS', shape: 'tee' },
  { name: 'Capas esenciales', category: '02 / BUZOS', shape: 'hoodie' },
  { name: 'Movimiento libre', category: '03 / PANTALONES', shape: 'pants' },
]
export function App() {
  return <>
    <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-7 md:px-12">
      <a href="#inicio" aria-label="VANTA, inicio" className="text-3xl font-black tracking-[-.08em]">VANTA<span className="ml-1 text-xs align-top">®</span></a>
      <span className="text-[10px] tracking-[.25em] text-neutral-400">URBAN WEAR / ARGENTINA</span>
    </header>
    <main id="inicio">
      <section className="hero mx-auto grid max-w-7xl gap-12 px-6 py-20 md:grid-cols-[1.2fr_1fr] md:px-12 md:py-28">
        <div className="relative z-10 self-center">
          <p className="mb-7 text-xs tracking-[.3em] text-neutral-400">MENOS RUIDO. MÁS IDENTIDAD.</p>
          <h1 className="text-6xl font-semibold leading-[.95] tracking-[-.065em] sm:text-8xl">Presencia<br/><span className="text-neutral-500">sin esfuerzo.</span></h1>
          <p className="mt-8 max-w-sm text-sm leading-7 text-neutral-400">Siluetas urbanas. Tonos esenciales. Una nueva forma de habitar la ciudad.</p>
          <a href="#universo" className="mt-10 inline-flex items-center gap-12 border border-neutral-600 px-6 py-4 text-xs tracking-widest transition hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4">EXPLORÁ VANTA <span aria-hidden="true">↗</span></a>
        </div>
        <div className="hero-art" aria-hidden="true"><span className="art-orbit"/><span className="art-mark">V</span><span className="art-caption">EST. 2026 — THE ESSENTIAL FORM</span></div>
      </section>
      <section id="universo" className="mx-auto max-w-7xl px-6 pb-24 md:px-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-t border-neutral-800 pt-8"><h2 className="text-2xl tracking-tight">El universo VANTA</h2><p className="text-xs text-neutral-500">Colección en preparación</p></div>
        <div className="grid gap-5 sm:grid-cols-3">{pieces.map(piece => <article key={piece.shape} className="group border border-neutral-800 bg-neutral-950"><div className="piece-art" aria-hidden="true"><div className={`garment ${piece.shape}`}/><span className="piece-watermark">VANTA</span></div><div className="border-t border-neutral-800 p-6"><p className="text-[10px] tracking-widest text-neutral-500">{piece.category}</p><h3 className="mt-2 text-lg">{piece.name}</h3></div></article>)}</div>
        <p className="mt-6 text-xs leading-6 text-neutral-500">Proyecto ficticio de portfolio. Las siluetas son ilustrativas; la tienda todavía no acepta compras.</p>
      </section>
    </main>
    <footer className="flex flex-wrap justify-between gap-4 border-t border-neutral-800 px-6 py-8 text-[10px] tracking-widest text-neutral-500 md:px-12"><span>VANTA — URBAN WEAR</span><span>DISEÑADO PARA LO ESENCIAL.</span></footer>
  </>
}
