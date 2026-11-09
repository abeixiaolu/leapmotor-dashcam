# HyperLPR3 model assets

These files come from HyperLPR3 model release `20230229`.
The upstream project is [szad670401/HyperLPR](https://github.com/szad670401/HyperLPR).
Its Apache-2.0 license is included in `LICENSE-HyperLPR.txt`.

The download URL is the one configured by upstream in
[`Prj-Python/hyperlpr3/config/settings.py`](https://github.com/szad670401/HyperLPR/blob/9307450f7b7915be18f23a539ec05b41fe6629f4/Prj-Python/hyperlpr3/config/settings.py).
The archive was retrieved from `http://hyperlpr.tunm.top/raw/20230229.zip`.
The browser loads the packaged copies from the same site as the player.
It never uploads frames or downloads models from this upstream URL.

| Packaged file     | Original file                          | SHA-256                                                            |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `detector.onnx`   | `20230229/onnx/y5fu_640x_sim.onnx`     | `0306de937471b87f56eb3f5620815e7e7058f8ab7428e0734fc64627cc4d716c` |
| `recognizer.onnx` | `20230229/onnx/rpv3_mdict_160_r3.onnx` | `8fb08b5db2adeccf43b05006bbbf409e4659d08d72e46a62631c00ff751eaeb3` |

The TypeScript adapter follows the detector preprocessing, 77-character dictionary,
and CTC decoding in upstream revision `9307450f7b7915be18f23a539ec05b41fe6629f4`.
It uses RGB letterboxing for detection and BGR normalization for recognition.
It rectifies detected plate corners with bilinear sampling instead of OpenCV's
cubic interpolation. Thumbnails retain the original rectangular crop.
The adapter limits each quadrant to eight detections and accepts ordinary
province-prefixed seven- or eight-character plates. Special diplomatic, police,
learner and trailer suffixes are excluded from this first version.

The model scores are not calibrated probabilities that a number is correct.
The user must compare candidates with the original recording.

The packaged recognizer emits 78 classes, while the upstream dictionary defines
77 entries including blank. The adapter uses the model's 78-column stride and
rejects a result when the unmapped final class wins. It does not guess a character
for that class.
