# Fotografías originales del catálogo VANTA de demostración

Ocho fotografías de prendas ficticias creadas con OpenAI Image Generation para
esta entrega (octubre de 2026). No se descargaron de Brutto, de otras tiendas,
ni se utilizaron fotografías de terceros como referencia. No representan
productos existentes ni acreditan materiales, talles o stock reales.

Cada modelo tiene su propia fotografía en `vanta-demo-v1/`. Los dos colores de
cada modelo son variantes ficticias: la foto ilustra el modelo, no todas las
combinaciones de color. La descripción y el texto alternativo identifican la demo.

Los originales PNG se conservan sin retoques. Su SHA-256 queda registrado en
`../catalog.demo.json` y se comprueba antes de cargar. Máximo 5 MiB por archivo,
compatible con el bucket privado `product-images`. No publicar ese bucket.

No hay carga automática. Ver `docs/demo-catalog-load.md` desde la raíz del repo.

## Ampliación v2 en tonos claros

`vanta-demo-v2/` incorpora cuatro fotografías originales nuevas generadas con
OpenAI Image Generation, una por modelo: remera blanco hueso, buzo gris melange,
pantalón beige piedra y conjunto gris claro. Fondo de cemento y encuadre completo,
sin referencias fotográficas de otras tiendas, marcas, textos ni marcas de agua.
Los ocho originales v1 se conservan byte por byte. Los hashes v2 están en
`../catalog.demo.extension.json`. Las rutas remotas son
`vanta-demo-v2/<modelo>/front.png`; procedimiento incremental de cuatro fotos en
`docs/demo-catalog-extension.md` desde la raíz del repositorio.
