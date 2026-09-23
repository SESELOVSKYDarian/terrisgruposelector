# Esquinas del mapa y territorios cercanos

Generado a partir del mapa "Territorio Peralta Ramos". 180 esquinas (cruces de calles), cada una con los territorios
que la tocan, ordenados del que tiene mas manzanas en esa esquina al que tiene menos. Se cargan con
`supabase/seed-esquinas-mapa.sql` como puntos de salida de tipo Esquina.

## Como se armo

- Zona este (1 a 13) y zona sudoeste (22 a 36): las calles estan rotuladas en el mapa; confianza **alta**.
- Territorios 18, 19 y 15: calles verticales seguidas desde la grilla de abajo; confianza **media-alta**.
- Territorios 14, 16 y 17: el mapa no rotula las calles verticales de esa zona (estan inclinadas); se dedujeron por continuidad. Confianza **media**: revisar.
- Manzanas tachadas con X (no se visitan) no cuentan como territorio cercano.
- Zona sur (20 y 21): calles verticales JB. Justo (la del medio) y Larrea, segun indicacion. La calle entre ambos territorios figura como H. IRIGOYEN en el mapa y se cargo como Azcuenaga, como se indico.
- Todas las esquinas se cargan con dias lunes a viernes.

### Zona este (1 a 13)

| Esquina | Territorios cercanos (de mas a menos) | Confianza |
|---|---|---|
| Funes y Larrea | 10 | alta |
| Funes y Vieytes | 10 | alta |
| Funes y Paso | 10, 6 | alta |
| Funes y Laprida | 6 | alta |
| Funes y Almafuerte | 1, 6 | alta |
| Funes y Formosa | 1 | alta |
| Funes y Matheu | 1 | alta |
| Guido y Larrea | 10 | alta |
| Guido y Vieytes | 10 | alta |
| Guido y Paso | 6, 10 | alta |
| Guido y Laprida | 6 | alta |
| Guido y Almafuerte | 1, 6 | alta |
| Guido y Formosa | 1 | alta |
| Guido y Matheu | 1 | alta |
| Dorrego y Larrea | 10, 11 | alta |
| Dorrego y Vieytes | 10, 11 | alta |
| Dorrego y Paso | 6, 7, 10, 11 | alta |
| Dorrego y Laprida | 6, 7 | alta |
| Dorrego y Almafuerte | 1, 3, 6, 7 | alta |
| Dorrego y Formosa | 1, 3 | alta |
| Dorrego y Matheu | 1, 2, 3 | alta |
| 14 de Julio y Larrea | 11 | alta |
| 14 de Julio y Vieytes | 11 | alta |
| 14 de Julio y Paso | 7, 11 | alta |
| 14 de Julio y Laprida | 7 | alta |
| 14 de Julio y Almafuerte | 3, 7 | alta |
| 14 de Julio y Formosa | 3 | alta |
| 14 de Julio y Matheu | 2, 3 | alta |
| 20 de Septiembre y Larrea | 12, 11 | alta |
| 20 de Septiembre y Vieytes | 11, 12 | alta |
| 20 de Septiembre y Paso | 7, 8, 11, 12 | alta |
| 20 de Septiembre y Laprida | 7, 8 | alta |
| 20 de Septiembre y Almafuerte | 3, 4, 7, 8 | alta |
| 20 de Septiembre y Formosa | 3, 4 | alta |
| 20 de Septiembre y Matheu | 2, 3, 4 | alta |
| España y Larrea | 12 | alta |
| España y Vieytes | 12 | alta |
| España y Paso | 8, 12 | alta |
| España y Laprida | 8 | alta |
| España y Almafuerte | 4, 8 | alta |
| España y Formosa | 4 | alta |
| España y Matheu | 2, 4 | alta |
| Jujuy y Larrea | 12, 13 | alta |
| Jujuy y Vieytes | 12, 13 | alta |
| Jujuy y Paso | 8, 9, 12, 13 | alta |
| Jujuy y Laprida | 8, 9 | alta |
| Jujuy y Almafuerte | 4, 5, 8, 9 | alta |
| Jujuy y Formosa | 4, 5 | alta |
| Jujuy y Matheu | 2, 4, 5 | alta |
| Salta y Larrea | 13 | alta |
| Salta y Vieytes | 13 | alta |
| Salta y Paso | 9, 13 | alta |
| Salta y Laprida | 9 | alta |
| Salta y Almafuerte | 5, 9 | alta |
| Salta y Formosa | 5 | alta |
| Salta y Matheu | 5 | alta |
| Independencia y Larrea | 13 | alta |
| Independencia y Vieytes | 13 | alta |
| Independencia y Paso | 9, 13 | alta |
| Independencia y Laprida | 9 | alta |
| Independencia y Almafuerte | 5, 9 | alta |
| Independencia y Formosa | 5 | alta |
| Independencia y Matheu | 5 | alta |

### Zona sudoeste y centro (14 a 19, 22 a 36)

| Esquina | Territorios cercanos (de mas a menos) | Confianza |
|---|---|---|
| De los Deportes y Irala | 16 | media |
| De los Deportes y Ayolas | 16 | media |
| De los Deportes y Magallanes | 14, 16 | media |
| De los Deportes y 12 de Octubre | 14 | media |
| V. del Mar y Irala | 16 | media |
| V. del Mar y Ayolas | 16 | media |
| V. del Mar y Magallanes | 14, 16 | media |
| V. del Mar y 12 de Octubre | 14 | media |
| V. del Mar y El Cano | 14 | media |
| Friuli y Irala | 16, 17 | media |
| Friuli y Ayolas | 16, 17 | media |
| Friuli y Magallanes | 17, 14, 16 | media |
| Friuli y 12 de Octubre | 14, 17 | media |
| Friuli y El Cano | 14, 17 | media |
| Friuli y Gaboto | 14 | media |
| L. de la Torre y Irala | 17, 18 | media |
| L. de la Torre y Ayolas | 17, 18 | media |
| L. de la Torre y Magallanes | 17, 18 | media |
| L. de la Torre y 12 de Octubre | 17 | media |
| L. de la Torre y El Cano | 14, 17 | media |
| L. de la Torre y Gaboto | 14 | media |
| G. Chavez y Irala | 18 | media-alta |
| G. Chavez y Ayolas | 18 | media-alta |
| G. Chavez y Magallanes | 18, 19 | media-alta |
| G. Chavez y 12 de Octubre | 19 | media-alta |
| G. Chavez y El Cano | 15, 19 | media-alta |
| G. Chavez y Gaboto | 15 | media-alta |
| G. Chavez y Solis | 15 | media-alta |
| C. Villar y Irala | 18 | media-alta |
| C. Villar y Ayolas | 18 | media-alta |
| C. Villar y Magallanes | 18, 19 | media-alta |
| C. Villar y 12 de Octubre | 19 | media-alta |
| C. Villar y El Cano | 15, 19 | media-alta |
| C. Villar y Gaboto | 15 | media-alta |
| C. Villar y Solis | 15 | media-alta |
| P. Ramos y Vertiz | 32 | alta |
| P. Ramos y San Salvador | 32 | alta |
| P. Ramos y Guanahani | 32 | alta |
| P. Ramos y Hernandarias | 32 | alta |
| P. Ramos y O. Zarate | 27, 32 | alta |
| P. Ramos y Irala | 27, 18 | media-alta |
| P. Ramos y Ayolas | 18, 27 | media-alta |
| P. Ramos y Magallanes | 27, 18, 19 | media-alta |
| P. Ramos y 12 de Octubre | 19, 22, 27 | media-alta |
| P. Ramos y El Cano | 22, 15, 19 | media-alta |
| P. Ramos y Gaboto | 15, 22 | media-alta |
| P. Ramos y Solis | 15, 22 | media-alta |
| F. Sanchez y Vertiz | 32, 35 | alta |
| F. Sanchez y San Salvador | 32, 35 | alta |
| F. Sanchez y Guanahani | 32, 33, 35 | alta |
| F. Sanchez y Hernandarias | 32, 33 | alta |
| F. Sanchez y O. Zarate | 27, 30, 32, 33 | alta |
| F. Sanchez y Irala | 27, 30 | alta |
| F. Sanchez y Ayolas | 27, 28, 30 | alta |
| F. Sanchez y Magallanes | 27, 28 | alta |
| F. Sanchez y 12 de Octubre | 22, 25, 27, 28 | alta |
| F. Sanchez y El Cano | 22, 25 | alta |
| F. Sanchez y Gaboto | 22, 23, 25 | alta |
| F. Sanchez y Solis | 22, 23 | alta |
| J. Manzo y Vertiz | 35 | alta |
| J. Manzo y San Salvador | 35 | alta |
| J. Manzo y Guanahani | 33, 35 | alta |
| J. Manzo y Hernandarias | 33 | alta |
| J. Manzo y O. Zarate | 30, 33 | alta |
| J. Manzo y Irala | 30 | alta |
| J. Manzo y Ayolas | 28, 30 | alta |
| J. Manzo y Magallanes | 28 | alta |
| J. Manzo y 12 de Octubre | 25, 28 | alta |
| J. Manzo y El Cano | 25 | alta |
| J. Manzo y Gaboto | 23, 25 | alta |
| J. Manzo y Solis | 23 | alta |
| Bestoso y Vertiz | 35, 36 | alta |
| Bestoso y San Salvador | 35, 36 | alta |
| Bestoso y Guanahani | 33, 34, 35, 36 | alta |
| Bestoso y Hernandarias | 33, 34 | alta |
| Bestoso y O. Zarate | 30, 31, 33, 34 | alta |
| Bestoso y Irala | 30, 31 | alta |
| Bestoso y Ayolas | 28, 29, 30, 31 | alta |
| Bestoso y Magallanes | 28, 29 | alta |
| Bestoso y 12 de Octubre | 25, 26, 28, 29 | alta |
| Bestoso y El Cano | 25, 26 | alta |
| Bestoso y Gaboto | 23, 24, 25, 26 | alta |
| Bestoso y Solis | 23, 24 | alta |
| Valentini y Vertiz | 36 | alta |
| Valentini y San Salvador | 36 | alta |
| Valentini y Guanahani | 36, 34 | alta |
| Valentini y Hernandarias | 34 | alta |
| Valentini y O. Zarate | 31, 34 | alta |
| Valentini y Irala | 31 | alta |
| Valentini y Ayolas | 29, 31 | alta |
| Valentini y Magallanes | 29 | alta |
| Valentini y 12 de Octubre | 26, 29 | alta |
| Valentini y El Cano | 26 | alta |
| Valentini y Gaboto | 24, 26 | alta |
| Valentini y Solis | 24 | alta |
| Dellepiane y Vertiz | 36 | alta |
| Dellepiane y San Salvador | 36 | alta |
| Dellepiane y Guanahani | 36 | alta |
| Dellepiane y Hernandarias | 34 | alta |
| Dellepiane y O. Zarate | 31, 34 | alta |
| Dellepiane y Irala | 31 | alta |
| Dellepiane y Ayolas | 29, 31 | alta |
| Dellepiane y Magallanes | 29 | alta |
| Dellepiane y 12 de Octubre | 26, 29 | alta |
| Dellepiane y El Cano | 26 | alta |
| Dellepiane y Gaboto | 24, 26 | alta |
| Dellepiane y Solis | 24 | alta |

### Zona sur (20 y 21)

| Esquina | Territorios cercanos (de mas a menos) | Confianza |
|---|---|---|
| Catamarca y JB. Justo | 20 | alta |
| Catamarca y Larrea | 20 | alta |
| La Rioja y JB. Justo | 20 | alta |
| La Rioja y Larrea | 20 | alta |
| Azcuenaga y JB. Justo | 20, 21 | alta |
| Azcuenaga y Larrea | 20, 21 | alta |
| Mitre y JB. Justo | 21 | alta |
| Mitre y Larrea | 21 | alta |
| San Luis y JB. Justo | 21 | alta |
| San Luis y Larrea | 21 | alta |
