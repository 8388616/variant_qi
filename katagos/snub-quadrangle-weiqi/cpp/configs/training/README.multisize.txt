Multisize training (mixed selfplay sizes, model usable up to 19x19)
====================================================================

KataGo's network is fully convolutional on the board: the same weights
can run on any board size up to the trained "pos len" (spatial tensor edge).

This repo's selfplay config is set up as:
  - Games sample board sizes 7–19 with a fixed mixture (see training/selfplay.cfg:
    bSizes / bSizeRelProbs). Default: 50% 9x9, 10% each for 10 and 11,
    remaining 30% split evenly across 7,8,12,13,14,15,16,17,18,19.
  - requireMaxBoardSize = false is REQUIRED so the NN buffer can stay
    19x19 while the live board is smaller (otherwise KataGo sets
    requireExactNNLen and you get a crash).
  - Training rows are written with dataBoardLen = 19 so each row is a
    19x19 plane with the real position embedded (padding is empty /
    masked by the usual "on board" input feature).
  - Python training uses -pos-len 19 so the saved model's maximum
    board size is 19.

You CAN load that exported model in GTP/analysis for any size up to 19.

Strength note
-------------
Smaller sizes appear more often in the mixture by design; very large
boards are rarer. Adjust bSizeRelProbs if you want more 19x19 experience.

If you only ever need up to 13x13, you may lower dataBoardLen,
maxBoard*ForNNBuffer, and train -pos-len to 13 to save memory and time.

Exporting PyTorch checkpoints to KataGo (Windows)
-----------------------------------------------
After training writes subfolders under torchmodels_toexport/, run:

  .\scripts\training.ps1 -Action ExportPending

This mirrors python/selfplay/export_model_for_selfplay.sh: runs
export_model_pytorch.py, clean_checkpoint.py, gzips model.bin, moves
the result to models\ (or modelstobetested\ if -UseGatekeeper).
Optional: -ExportExtra for torchmodels_toexport_extra -> models_extra.
