# Design: think before you draw

Read once per drawing session; `sketch`, `clean` and `hifi` say how far to take it. Whatever you make (a board, a slide, a diagram, a mockup, a chart), work like a professional designer: the right call for this content and this audience, not a house style. Everything here is advice to use with judgment. Fidelity is a look, not a phase: how many options, rounds and frames is the person's call, or a process skill's.

## Find the look first

1. **The page's look**, when the page is consistent: read a frame that's already there (`obeya get <page> --frame <id>`) and match its background, type, colours, corner radius and stroke. A new frame on a page belongs to the page.
2. **The person's look**: their instructions or your memory of them (a brand at work, fonts they like or hate).
3. **Otherwise set one**, on purpose: a small sample first (a title, a card, a chart), check it with one `shot`, then draw whole frames.

## Frame the problem

- What is it, who reads it, where: a board read on the canvas, a slide presented full screen, a mockup someone builds from.
- Its job (decide, explain, persuade, build from) and the one thing it must get across.

## Structure

- Inventory the content; group, order and label it; cut what doesn't serve the job.
- Decide primary, secondary and supporting before any colour or font.
- One message per frame; one reading path; labels people would use themselves.
- Pictures over text: compose from `--skill components` (tables, lanes, cards, callouts, …); a paragraph on a canvas is usually a missed picture.

## Size to the frame

Text size follows the frame's width, because the canvas shows a frame scaled to the screen:

| Frame width | Smallest text | Body | Title |
|---|---|---|---|
| 1280 (slide) | 18 | 22–24 | 40–56 |
| 1600–2400 (board) | 22–26 | 28–32 | 56–72 |
| 3200 (wide board) | 28–32 | 34–40 | 72–96 |

Size containers to their content; leave room. `obeya lint` flags text too small to read.

## Shape of the frame

Slides take the screen's shape (16:9: 1280×720 or 1920×1080). A board that tells a story is as tall as the story; don't squeeze it into 16:9. Decide which this is.

## Type and colour, briefly

- Few families, chosen for their voice: `Inter` (neutral), `Inter Bold`, `Source Serif` (editorial, warm), `Barlow Condensed` (numbers, dense labels), `Nunito` (friendly titles), `Helvetica`, `Cascadia` (code, eyebrows), `Caveat` (a human note), `Excalifont` (sketch).
- Hierarchy from size, weight, colour and space, not from boxes.
- Colour carries meaning: neutrals most of the area; colour where it says something; a legend for categories. Contrast: text 4.5:1, large text 3:1.

## Check

`obeya lint` is the floor; one `shot` of a new frame for the eye: does it land on the focal point first?
