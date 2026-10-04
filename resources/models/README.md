# Speech models

This folder holds the speech-recognition model that is bundled with the app.
The model files are large, so they are not stored in git. Download and verify
them with:

```bash
npm run fetch-model
```

Each model lives in its own folder with a `model.json` that lists its files.
Any [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) *streaming transducer*
model can be added the same way — see docs/BUILDING.md.
