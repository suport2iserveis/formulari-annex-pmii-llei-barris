# Formulari Annex PMII · Llei de Barris

Repositori web estàtic del formulari de l’annex de la sol·licitud del PMII.
Funciona de manera independent a GitHub Pages i també connectat amb
**Studio Llei de Barris 3.8.2**.

## Funcions

- formulari accessible en quatre passos;
- desament automàtic al navegador;
- requisit de 22 dígits per a l’IBAN, sense comprovació bancària;
- revisió abans de l’enviament;
- identitat visual integrada d’iServeis i Barry;
- importació i exportació JSON;
- impressió o desament del resum en PDF;
- càrrega automàtica de la versió actual de l’Studio;
- creació d’una versió nova i immutable a l’Studio.

## Publicació a GitHub Pages

1. Creeu un repositori públic anomenat `formulari-annex-pmii-llei-barris`.
2. Pugeu tots els fitxers d’aquesta carpeta a la branca `main`.
3. A `Settings → Pages`, seleccioneu `Deploy from a branch`.
4. Seleccioneu `main` i `/(root)`.

L’adreça prevista és:

`https://suport2iserveis.github.io/formulari-annex-pmii-llei-barris/`

L’Studio 3.8.0 ja utilitza aquesta adreça.

## Connexió amb l’Studio

L’Studio obre el formulari amb:

- l’identificador i el nom del projecte;
- el codi municipal;
- l’adreça de l’API de l’Studio;
- una sessió temporal vinculada al projecte.

La sessió caduca al cap de 12 hores. No hi ha cap clau privada dins del
repositori públic. Cada enviament crea una versió nova del mòdul `annex`.

## Prova

Obriu `index.html` en un navegador o executeu:

```bash
npm test
```
