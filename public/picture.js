// Read a board from a picture (Your board). The picture stays on this device: it is drawn on a canvas and read by
// imageread.js. Nothing changes on the board until the player chooses "Use these tiles".
import { readBoard, referenceTiles, homography, project } from './imageread.js';
import { buildGraph, hexCorners } from './geometry.js';
import { SETUPS } from './board.js';

const LONGEST = 2000;   // pixels: big photos are scaled down first, which keeps reading quick on a phone
const NAME = { wood: 'Wood', brick: 'Brick', wheat: 'Wheat', sheep: 'Sheep', ore: 'Ore', desert: 'Desert' };
const list = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const svg = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

let dialog = null;

// Closes the reader without applying anything (Cancel does the same).
export function closePictureReader() { if (dialog?.open) dialog.close(); }

function build() {
  dialog = document.createElement('dialog');
  dialog.className = 'picture-dialog';
  dialog.setAttribute('aria-labelledby', 'picture-title');
  dialog.innerHTML = `<h2 id="picture-title">Read a board from a picture</h2>
    <p class="sub">Use a screenshot or a photo taken from straight above. The picture stays on this device.</p>
    <p class="picture-pick"><label class="btn ghost" id="picture-choose">Choose a picture<input type="file" accept="image/*" id="picture-file"></label>
      <span class="sub">or paste or drop one here</span></p>
    <div class="picture-prompt"><svg class="picture-guide" id="picture-guide" aria-hidden="true"></svg><p class="sub" id="picture-step" role="status"></p></div>
    <div class="picture-stage" hidden><canvas id="picture-canvas"></canvas></div>
    <ul class="sub picture-notes" id="picture-notes" hidden></ul>
    <p class="picture-actions"><button class="btn ghost" id="picture-undo" type="button" disabled>Undo last tap</button>
      <button class="btn" id="picture-use" type="button" disabled>Use these tiles</button>
      <button class="btn ghost" id="picture-cancel" type="button">Cancel</button></p>`;
  document.body.append(dialog);
}

// Opens the reader for a board layout. `onApply({ hexes, uncertain })` receives the guesses only when the player
// accepts them; Cancel, Escape or closing the dialog applies nothing.
export function openPictureReader({ setup, onApply }) {
  if (!dialog) build();
  const $ = s => dialog.querySelector(s);
  const refs = referenceTiles(setup), graph = buildGraph(SETUPS[setup].layout);
  const tileCount = graph.hexes.length;
  let image = null, taps = [], result = null, spots = null;
  const canvas = $('#picture-canvas'), ctx = canvas.getContext('2d');
  const step = text => { $('#picture-step').textContent = text; };
  const colour = name => getComputedStyle(dialog).getPropertyValue(name).trim();

  function guide() {
    const box = $('#picture-guide');
    box.replaceChildren();
    box.style.display = image ? '' : 'none';   // an SVG element has no hidden property
    const xs = graph.vertices.map(v => v.x), ys = graph.vertices.map(v => v.y);
    box.setAttribute('viewBox', `${Math.min(...xs) - 0.2} ${Math.min(...ys) - 0.2} ${Math.max(...xs) - Math.min(...xs) + 0.4} ${Math.max(...ys) - Math.min(...ys) + 0.4}`);
    for (const h of graph.hexes) {
      const k = refs.findIndex(r => r.id === h.id);
      const cls = k < 0 ? 'tile' : k < taps.length ? 'tile done' : k === taps.length ? 'tile next' : 'tile ref';
      box.append(svg('polygon', { class: cls, points: hexCorners(h.x, h.y).map(p => p.join(',')).join(' ') }));
    }
  }

  // Taps are numbered rings; once read, each tile gets its guess where the map puts its token, outlined in red
  // when the reader was unsure. The labels sit on the picture, so their size follows the tile spacing in it.
  function draw() {
    if (!image) return;
    ctx.putImageData(image, 0, 0);
    const gap = spots ? Math.hypot(spots[1].x - spots[0].x, spots[1].y - spots[0].y) : Math.max(image.width, image.height) / 8;
    ctx.lineWidth = Math.max(2, gap / 25);
    for (const [i, t] of taps.entries()) {
      ctx.strokeStyle = colour('--accent'); ctx.beginPath(); ctx.arc(t.x, t.y, gap / 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = colour('--accent'); ctx.font = `600 ${Math.round(gap / 5)}px sans-serif`; ctx.fillText(String(i + 1), t.x + gap / 4, t.y - gap / 4);
    }
    if (!result) return;
    ctx.font = `600 ${Math.round(gap / 6.5)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [i, h] of result.hexes.entries()) {
      const p = spots[i], shaky = result.uncertain.includes(i), w = gap * 0.78, ht = gap / 4.2;
      ctx.fillStyle = colour('--disc'); ctx.fillRect(p.x - w / 2, p.y - ht / 2, w, ht);
      ctx.strokeStyle = colour(shaky ? '--disc-red' : '--disc-ink'); ctx.lineWidth = Math.max(1.5, gap / (shaky ? 30 : 60)); ctx.strokeRect(p.x - w / 2, p.y - ht / 2, w, ht);
      ctx.fillStyle = colour(shaky ? '--disc-red' : '--disc-ink');
      ctx.fillText(`${NAME[h.resource] || '?'}${h.number ? ' ' + h.number : ''}`, p.x, p.y, w * 0.94);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  function prompt() {
    guide();
    $('#picture-undo').disabled = !taps.length;
    $('#picture-use').disabled = !result;
    if (!result) { $('#picture-notes').hidden = true; $('#picture-notes').replaceChildren(); }
    if (!image) return step(`Choose a picture of a ${tileCount}-tile board.`);
    if (taps.length < 4) return step(`Tap the number token on the ${refs[taps.length].corner} tile, shown on the small map (${taps.length + 1} of 4).`);
  }

  function read() {
    try {
      result = readBoard(image, setup, taps);
    } catch (error) {
      result = null;
      step(`${String(error.message || error)} Undo a tap and try again.`);
      return;
    }
    const H = homography(refs.map(r => ({ x: r.x, y: r.y })), taps);
    spots = graph.hexes.map(h => project(H, { x: h.x, y: h.y }));
    const counts = {};
    for (const h of result.hexes) counts[h.resource] = (counts[h.resource] || 0) + 1;
    const shaky = result.uncertain.map(i => String(i + 1));
    step(`Read ${result.hexes.length} tiles: ${list(Object.entries(counts).map(([r, n]) => `${n} ${NAME[r].toLowerCase()}`))}. ${shaky.length
      ? `Tile${shaky.length > 1 ? 's' : ''} ${list(shaky)} ${shaky.length > 1 ? 'were' : 'was'} hard to read and will be outlined on the board.`
      : 'Every tile read clearly; still compare them with your table.'} Harbours are not read: add them afterwards with Ports.`);
    const notes = $('#picture-notes');
    notes.replaceChildren(...result.notes.map(n => Object.assign(document.createElement('li'), { textContent: n })));
    notes.hidden = !result.notes.length;
  }

  async function load(file) {
    if (!file || (file.type && !file.type.startsWith('image/'))) return step('That file is not a picture. Choose a PNG, JPEG or similar image.');
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, LONGEST / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      taps = []; result = null; spots = null;
      $('.picture-stage').hidden = false;
      draw(); prompt();
    } catch {
      step('This picture could not be opened. Try a different file.');
    }
  }

  $('#picture-file').value = '';
  $('#picture-file').onchange = e => load(e.target.files[0]);
  dialog.onpaste = e => { const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); if (item) { e.preventDefault(); load(item.getAsFile()); } };
  dialog.ondragover = e => e.preventDefault();
  dialog.ondrop = e => { e.preventDefault(); load(e.dataTransfer?.files?.[0]); };
  canvas.onclick = e => {
    if (!image || taps.length >= 4) return;
    const box = canvas.getBoundingClientRect();
    taps.push({ x: (e.clientX - box.left) * canvas.width / box.width, y: (e.clientY - box.top) * canvas.height / box.height });
    if (taps.length === 4) read();
    draw(); prompt();
    if (result) $('#picture-use').focus();
  };
  $('#picture-undo').onclick = () => { taps.pop(); result = null; spots = null; draw(); prompt(); };
  $('#picture-cancel').onclick = () => dialog.close();
  $('#picture-use').onclick = () => {
    if (!result) return;
    dialog.close();
    onApply({ hexes: result.hexes.map(h => ({ resource: h.resource, number: h.number })), uncertain: [...result.uncertain] });
  };
  $('.picture-stage').hidden = true;
  image = null; taps = []; result = null; spots = null;
  prompt();
  dialog.showModal();
  $('#picture-file').focus();
}
