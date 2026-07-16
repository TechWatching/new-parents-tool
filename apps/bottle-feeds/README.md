# Bottle feed tracker

Vue 3 and TypeScript app for recording bottle feeds and baby weights. Data is retained in browser local storage.

- Add or edit bottle and weight entries at any time from the history lists.
- Fill a form automatically by taking or choosing a photo of a written note: the amount/weight
  is read on-device with [tesseract.js](https://github.com/naptha/tesseract.js) and pre-filled
  for review before saving.

Run commands from the monorepo root:

```sh
vp run --filter bottle-feeds dev
vp run --filter bottle-feeds test:unit -- --run
vp run --filter bottle-feeds build
```
