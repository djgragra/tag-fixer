# Manual de Tag Fixer

Tag Fixer lee y corrige por lotes los metadatos de los archivos de audio: **etiquetas ID3 y carátulas en MP3** (ID3v2.2, v2.3 y v2.4), **`bext` BWF con su CodingHistory, iXML y cart (AES46) en WAV y BWF, también RF64/BW64**, y **comentarios Vorbis en FLAC**. Trabajas en una tabla al estilo de una hoja de cálculo, cada archivo se copia como seguridad antes de tocarlo y el último lote se restaura en un solo paso. Es una app de escritorio gratuita para Windows, macOS y Linux de OnAir Garage.

## Instalación y primer inicio

Descarga el instalador para tu sistema desde la página de [Releases](https://github.com/djgragra/tag-fixer/releases) y compruébalo con `SHA256SUMS.txt`:
`Tag-Fixer-Setup-<V>.exe` (Windows), `Tag-Fixer-<V>-arm64.dmg` (Mac con Apple silicon), `Tag-Fixer-<V>-x64.dmg` (Mac con Intel), `Tag-Fixer-<V>.AppImage` (Linux).
La app es gratuita y no tiene certificado de Apple ni de Microsoft, así que en el primer inicio puede aparecer un aviso.

- **Windows**: ejecuta el instalador. Si SmartScreen dice «Windows protegió su PC», pulsa *Más información* → *Ejecutar de todos modos*.
- **macOS**: abre la imagen de disco y arrastra la app a Aplicaciones. La app tiene una firma ad-hoc, que es lo que necesita un Mac Apple silicon para abrirla. El primer inicio muestra igualmente el aviso «desarrollador no identificado»: abre *Ajustes del Sistema → Privacidad y seguridad*, desplázate hacia abajo y pulsa *Abrir de todos modos* (el clic derecho → Abrir ya no existe desde macOS 15). Si una versión anterior (26.10.3 o más antigua) dice que la app está «dañada», ejecuta una vez en Terminal: `xattr -cr "/Applications/Tag Fixer.app" && codesign --force --deep -s - "/Applications/Tag Fixer.app"`
- **Linux**: haz ejecutable el AppImage (`chmod +x Tag-Fixer-*.AppImage`) y ejecútalo.

La app se abre siempre en inglés; elige Italiano o Español en el menú de idioma y la elección se recuerda. El tema puede ser claro, oscuro o seguir el sistema.

## La ventana

Suelta archivos de audio o carpetas en la ventana, o usa *Añadir archivos…* y *Añadir carpeta…* (*Incluir subcarpetas* va más a fondo). Los archivos van a su pestaña:

| Pestaña | Archivos | Qué editas |
|---|---|---|
| MP3 · ID3 | MP3 | Título, Artista, Álbum, Año, Pista, Género, Comentario y Carátula |
| WAV · BWF | WAV y BWF, también RF64/BW64 | Tres vistas: **BWF** (Description, Originator, Ref. originator, Fecha, Hora y Coding history), **iXML** (Proyecto, Escena, Cinta, Toma, Nota) y **Cart** (Título, Artista, Cut ID, Client ID, Categoría, Clasificación, Out cue, fecha y hora de inicio y de fin, Definido por el usuario) |
| FLAC | FLAC | Título, Artista, Álbum, Fecha, Pista, Género y Comentario (comentarios Vorbis) |

Cada fila muestra una casilla, el archivo, su estado y la info del archivo, y después los campos. Una píldora arriba dice cuántos archivos hay en la lista, cuántos están por guardar y cuántos tienen errores.

## Editar

1. **Haz clic en una celda y escribe.** Las celdas editadas se resaltan y las no válidas (por ejemplo una fecha que no existe) se ponen rojas. Intro y las flechas pasan de una fila a otra; Esc deja la celda como estaba.
2. **El mismo valor en muchos archivos**: escríbelo en la fila resaltada bajo los encabezados (*Aplicar a todas las filas marcadas*) y pulsa ⇣: se escribe en cada fila marcada de esta pestaña.
3. **Desmarca** los archivos que no quieras cambiar. Las filas rojas bloquean el guardado hasta que las corrijas o las desmarques.
4. **Deshacer y rehacer** cada edición y cada herramienta con Ctrl+Z y Ctrl+Y (⌘Z en Mac), o con los botones *Deshacer* y *Rehacer*. *Descartar cambios* tira todo lo que no se ha guardado.
5. Un archivo dañado o cortado, o con una etiqueta que no se puede leer con seguridad, se muestra en **solo lectura** con el motivo y no se escribe nunca.

## Las herramientas sobre la tabla

Cada herramienta cambia solo la tabla: no se escribe nada en los archivos hasta que guardas.

- **Patrones…**: *Rellenar un campo con un patrón* (por ejemplo `{artist} - {title}` o `{n:3}`, con filtros como `{filename|lower}`; el contador empieza donde tú digas), *Leer campos del nombre del archivo* o *Renombrar archivos desde las etiquetas*. Los patrones guardados (*Patrones guardados…*) se conservan en los ajustes y viajan con la copia de seguridad de la configuración. La ventana muestra lo que recibiría cada archivo antes de aplicar.
- **Buscar y reemplazar…**: en un campo o en todos los campos de la vista. Busca y reemplaza texto (texto simple o *Expresión regular*, *Palabra completa*, *Distinguir mayúsculas*), o limpia: quitar espacios en los extremos, reducir espacios repetidos, MAYÚSCULAS, minúsculas, Iniciales Mayúsculas, Mayúscula solo al principio, quitar acentos, convertir a ASCII. La ventana dice cuántas celdas cambiarían.
- **Fecha y hora del archivo…**: rellena la fecha y hora de origen BWF, o el inicio o el fin cart, a partir del nombre del archivo (por ejemplo `2026-10-13_0830…`, si no, la fecha de modificación), de la fecha de modificación o de la fecha de creación. *Poner también la hora* es opcional.
- **Coding history…** (WAV): edítala en un archivo, o reemplázala o añade una línea al final en todos los archivos marcados.
- **Carátula…** (MP3): elige una imagen JPEG o PNG (hasta 16 MB) y úsala en este archivo o en todos los marcados, o quita la imagen. La imagen pasa a ser la carátula frontal y las demás imágenes de la etiqueta se conservan; *Quitar* borra todas las imágenes de la etiqueta.
- **Revisar archivos…**: lista lo que parece mal, por nivel (Errores, Avisos, Notas): campos que faltan, valores no válidos, fechas futuras, duplicados y archivos dañados. Haz clic en una línea para ir al archivo; *Mostrar solo estos archivos* filtra la tabla.
- **Exportar CSV…** / **Importar CSV…**: exporta la tabla (los archivos marcados o todos los de la pestaña) e impórtala de nuevo, con el separador que elijas. Las filas se emparejan por la ruta completa o por un nombre de archivo único; una celda vacía deja el campo como está, salvo que marques *Una celda vacía borra el campo*.
- **Convertir a ASCII**: el texto de los campos `bext` y cart debería ser ASCII (lo dice la especificación). El texto no ASCII se señala, y este botón convierte `è` en `e` y muestra el resultado antes de guardar.

## Guardar, copias de seguridad y restaurar

1. Pulsa **Guardar…**. La ventana enumera los cambios, la **carpeta de copias** y el espacio libre necesario; confirma para seguir.
2. Cada original se copia, con su fecha de modificación, a la carpeta de copias antes de cualquier cambio. Un cambio que mantiene el tamaño del archivo se escribe en su sitio; los demás pasan por un archivo temporal que sustituye al original solo cuando está completo y verificado. Cada archivo se vuelve a leer y se compara; si algo falla, se devuelve el original. Los lotes que solo renombran no necesitan copia de seguridad.
3. Al terminar, la ventana dice cuántos archivos se guardaron y dónde están los originales.
4. **Restaurar último lote** devuelve las etiquetas y los nombres originales desde la copia de seguridad (los archivos editados de nuevo desde entonces se quedan como están).

Cambiar la history, cualquier texto iXML o añadir un chunk **reescribe el archivo**: lleva tiempo y, para la copia, tanto espacio libre como el archivo. La app comprueba el espacio libre antes de guardar. Mantén la carpeta de copias fuera de las carpetas de emisión o de música: una copia dentro de una biblioteca vigilada podría cargarse como duplicado.

## Ajustes

Los ajustes están en pestañas, en el mismo orden que en todas las apps de OnAir Garage:

| Pestaña | Contenido |
|---|---|
| General | Idioma, tema, la **carpeta de las copias** de los archivos modificados (*Cambiar…*, *Abrir carpeta*) y durante cuántos días conservar los registros |
| Actualizaciones | La actualización guiada (véase más abajo) |
| Copia de seguridad | Exportación e importación de ajustes y patrones guardados (`tag-fixer-backup-AAAA-MM-DD.json`); la app no guarda contraseñas ni tokens, así que el archivo no contiene ninguno |
| Ayuda e información | Versión, licencia, créditos, enlaces, *Copiar info para soporte* (versión, sistema, idioma, última búsqueda de actualizaciones y último error: nunca nombres de archivo ni ajustes), *Abrir carpeta de registros* y la tarjeta de propina con la hucha |

La tarjeta de propina tiene una hucha y un botón: ambos abren la página de apoyo del sitio web en el idioma de la app; dentro de la app no se pide nunca nada. Todo ocurre en tu equipo: la app contacta con GitHub solo para buscar actualizaciones, cuando está activado, y para descargar una actualización que pides.

## Actualizaciones

Tag Fixer busca una versión nueva 15 segundos después de iniciarse y luego cada 24 horas (puedes desactivarlo en *Ajustes → Actualizaciones*). Un aviso ofrece *Descargar e instalar* (con una barra de progreso y *Cancelar*), *Recordármelo más tarde* (24 horas) y *Omitir esta versión*. El archivo se comprueba con el SHA-256 de la versión (`SHA256SUMS.txt`); uno que no coincide se elimina. *Cerrar e instalar* guarda antes una copia de seguridad de los ajustes. Tras la actualización aparece una vez la ventana *Novedades*. No se descarga ni se instala nada sin un clic.

## Límites y seguridad

- Los archivos WAV dañados o cortados, una cabecera RF64 o un chunk `ds64` no válidos, las etiquetas ID3 con desincronización o comprimidas, las etiquetas con datos ilegibles y los metadatos FLAC dañados se muestran en solo lectura y no se escriben nunca.
- Un frame de texto, un comentario o un campo Vorbis con varios valores se muestra unido por ` / ` y se sustituye por un solo valor si se edita. Los demás comentarios y los frames personalizados se quedan como están.
- iXML: si el texto no es UTF-8, no es XML válido o el elemento que editas contiene elementos anidados, ese campo es de solo lectura. cart: el chunk debe tener su parte fija de 2048 bytes; si no, es de solo lectura.
- No admitidos: OGG, M4A, AIFF y otros formatos. No se tocan: el audio, ID3v1, RIFF `LIST`/INFO, `axml`, otros chunks y las imágenes de los FLAC.
- La fecha de modificación de un archivo guardado es el momento del guardado; al restaurar se devuelve la fecha original.
- No es un instrumento certificado: lee siempre la lista de cambios antes de guardar.

## Solución de problemas

| Problema | Qué hacer |
|---|---|
| macOS: «la app está dañada / no se puede abrir» | Abre *Ajustes del Sistema → Privacidad y seguridad → Abrir de todos modos*; para una versión anterior a la 26.10.4, ejecuta en Terminal `xattr -cr "/Applications/Tag Fixer.app" && codesign --force --deep -s - "/Applications/Tag Fixer.app"`. |
| Windows: «Windows protegió su PC» | *Más información* → *Ejecutar de todos modos*. |
| Linux: el AppImage no se inicia | Hazlo ejecutable (`chmod +x`) e instala FUSE (`libfuse2`) si tu sistema lo necesita. |
| Una celda es de solo lectura | Mira el estado del archivo: está dañado o tiene una parte que la app no puede escribir con seguridad. |
| No hay espacio suficiente para guardar | Libera espacio en el disco o cambia la carpeta de copias en *Ajustes → General*. |
| Un cambio salió mal | *Restaurar último lote* devuelve los archivos originales desde la carpeta de copias. |
| La descarga de la actualización falló con «checksum mismatch» | El archivo se eliminó automáticamente. Inténtalo de nuevo o descarga el instalador a mano desde la página de versiones. |

## Contactos

Graziano Melzi · OnAir Garage — `https://onairgarage.com` — `hello@onairgarage.com`. Página de la herramienta: `https://onairgarage.com/tools/tag-fixer/`. Código fuente y versiones: `https://github.com/djgragra/tag-fixer`. Licencia: MIT © 2026 Graziano Melzi.
