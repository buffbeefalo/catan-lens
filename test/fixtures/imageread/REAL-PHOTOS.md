# Real photos checked by hand

Two real photos from Wikimedia Commons were read with `public/imageread.js` on 2026-10-12. The photos are not stored
here (their licences need attribution); fetch them from the links below at the stated size to repeat the check. Taps
are in picture pixels, in `referenceTiles('base')` order (top left, top right, bottom right, bottom left of the app's
board); the truth lists each hex in hex id order, read by eye.

## Modern edition, board turned about 90 degrees

- Source: <https://commons.wikimedia.org/wiki/File:Settlers_of_Catan_completed.jpg>, original scaled to 2000 by 1259
  pixels (Lanczos), as the app scales a large photo.
- The app's top row is the photo's left column, read bottom to top. The robber covers hex 12's token (truth 6).
- Taps: `[{"x":805,"y":725},{"x":785,"y":462},{"x":1256,"y":497},{"x":1266,"y":735}]`
- Truth: `[["brick",2],["ore",9],["wheat",10],["wood",5],["wheat",10],["wood",3],["sheep",12],["sheep",11],["sheep",8],["desert",null],["wheat",4],["brick",6],["wheat",6],["brick",4],["sheep",3],["wood",9],["wood",5],["ore",11],["ore",8]]`
- Result: tile types 19 of 19; numbers 12 of 19 (5 of 19 before turned tokens were handled); 9 tiles flagged; no wrong
  number left unflagged.

## Older edition, top down, tokens turned at random

- Source: <https://commons.wikimedia.org/wiki/File:Catan_(20150816-IMG_20150816_180450).jpg>, the 1920 by 1440 pixel
  thumbnail.
- Its tokens have no pips, so the turn of a token cannot be found and the digits are tiny.
- Taps: `[{"x":837,"y":383},{"x":1194,"y":380},{"x":1182,"y":1005},{"x":828,"y":1003}]`
- Truth: `[["wheat",4],["brick",2],["sheep",6],["wood",8],["sheep",11],["ore",10],["wheat",12],["brick",5],["ore",3],["desert",null],["sheep",4],["wood",9],["wheat",6],["wood",11],["wood",3],["brick",10],["wheat",9],["sheep",5],["ore",8]]`
  (the blue-grey tiles of this edition are the least certain by eye)
- Result: tile types 19 of 19; numbers 5 of 19; 18 tiles flagged; no wrong number left unflagged.
