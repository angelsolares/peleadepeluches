// Usage (from tools/): npm install && node convert-anims.mjs
// Regenerates assets/anims/*.json (animation-only clips) from the animation FBX files in assets/.
// Convert animation FBX files (with embedded skin) into small animation-only JSON clips.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal DOM stubs: FBXLoader creates image elements for embedded textures, which we don't need
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = {
    createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, set src(v) {} }),
    createElement: () => ({ style: {}, getContext: () => null, addEventListener() {}, removeEventListener() {} })
};

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const OUT = path.join(SRC, 'anims');
fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(SRC).filter(f => /^Meshy_AI_Animation_.*\.fbx$|^Crawling\.fbx$|^Flying\.fbx$/.test(f));

const round = (v, d) => Math.round(v * d) / d;
const loader = new FBXLoader();
const report = [];
for (const f of files) {
    const buf = fs.readFileSync(path.join(SRC, f));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const obj = loader.parse(ab, SRC + '/');
    const clip = obj.animations[0];
    const json = THREE.AnimationClip.toJSON(clip);
    // Trim float precision (times to 1 ms, values to 5 decimals)
    for (const t of json.tracks) {
        t.times = Array.from(t.times, v => round(v, 1000));
        t.values = Array.from(t.values, v => round(v, 100000));
    }
    const name = f.replace(/\.fbx$/, '.json');
    const text = JSON.stringify(json);
    fs.writeFileSync(path.join(OUT, name), text);
    report.push({ file: f, fbxMB: +(buf.length / 1048576).toFixed(1), jsonKB: +(text.length / 1024).toFixed(0), duration: +clip.duration.toFixed(2), tracks: clip.tracks.length, sample: clip.tracks.slice(0, 2).map(t => t.name) });
}
console.table(report.map(r => ({ file: r.file.replace('Meshy_AI_Animation_', '').replace('_withSkin', ''), fbxMB: r.fbxMB, jsonKB: r.jsonKB, s: r.duration, tracks: r.tracks })));
console.log('sample track names:', report[0].sample);
