# Formulari Annex PMII · Llei de Barris · versió 1.2.3

Repositori web estàtic del formulari de l’annex de la sol·licitud del PMII.
Funciona de manera independent a GitHub Pages i també connectat amb
**Studio Llei de Barris 3.9.8**.

La versió 1.2.3 amplia el temps de confirmació de l’enviament i evita mostrar
un fals error quan el receptor encara està acabant de generar el PDF, enviar
el correu o confirmar la versió creada a l’Studio.

## Funcions

- formulari accessible en quatre passos;
- desament automàtic al navegador;
- requisit de 22 dígits per a l’IBAN, sense comprovació bancària;
- revisió abans de l’enviament;
- identitat visual integrada d’iServeis i Barry;
- importació i exportació JSON;
- impressió o desament local del resum en PDF;
- càrrega automàtica de la versió actual de l’Studio;
- botó `Enviar a iServeis`;
- enviament automàtic d’un PDF a `suport2@iserveis.cat`;
- creació simultània d’una versió nova i immutable a l’Studio;
- enllaç municipal específic, creat des de `Documents EACAT`.

## Publicació a GitHub Pages

1. Creeu un repositori públic anomenat `formulari-annex-pmii-llei-barris`.
2. Pugeu tots els fitxers d’aquesta carpeta a la branca `main`.
3. A `Settings → Pages`, seleccioneu `Deploy from a branch`.
4. Seleccioneu `main` i `/(root)`.

L’adreça prevista és:

`https://suport2iserveis.github.io/formulari-annex-pmii-llei-barris/`

L’Studio 3.9.8 ja utilitza aquesta adreça.

## Connexió amb l’Studio

L’Studio obre el formulari amb:

- l’identificador i el nom del projecte;
- el codi municipal;
- l’adreça de l’API de l’Studio;
- una sessió municipal vinculada exclusivament al projecte.

L’enllaç municipal es crea des de `Documents EACAT` i caduca al cap d’un any.
No hi ha cap clau privada dins del repositori públic. Cada enviament crea una
versió nova del mòdul `annex`, genera un PDF i l’envia a
`suport2@iserveis.cat`.

## Activació de l’enviament

El fitxer `google-apps-script.gs` continua sent la versió 14 del receptor
unificat. Si ja vau publicar la v14 amb la versió anterior, no cal tornar a
modificar ni desplegar Google Apps Script. Mantingueu l’URL `/exec` existent:
el formulari ja la porta configurada.

La primera vegada, Google demanarà autorització per enviar correus. El PDF es
genera directament en memòria i no requereix permisos per crear documents ni
fitxers temporals.

## Prova

Obriu `index.html` en un navegador o executeu:

```bash
npm test
```
