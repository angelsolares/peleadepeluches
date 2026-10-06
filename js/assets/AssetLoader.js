/**
 * Shared asset loader for every game mode.
 *
 * - Animations: the Meshy/baby animation FBX files embed a whole character mesh (5–8 MB each).
 *   They were converted to animation-only JSON clips in assets/anims/ (20–110 KB each).
 *   loadClip()/loadClips() transparently use the JSON version when one exists.
 * - Models: loadModel() caches by URL, so a character is downloaded and parsed once per page,
 *   no matter how many modes/entities ask for it, and parallel requests share one download.
 * - Everything is promise-based so callers can load in parallel (Promise.all) instead of
 *   awaiting files one by one.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Absolute URL of the assets/ folder, resolved from this module's location (js/assets/),
// so it works from any page (root pages, playground/, mobile/...)
const ASSET_BASE = new URL('../../assets/', import.meta.url).href;

// Animation FBX files that have an animation-only JSON clip in assets/anims/
const JSON_CLIPS = new Set([
    'Meshy_AI_Animation_Block3_withSkin',
    'Meshy_AI_Animation_Boxing_Guard_Prep_Straight_Punch_withSkin',
    'Meshy_AI_Animation_Boxing_Guard_Right_Straight_Kick_withSkin',
    'Meshy_AI_Animation_Grab_Held_withSkin',
    'Meshy_AI_Animation_Hip_Hop_Dance_withSkin',
    'Meshy_AI_Animation_Hit_Reaction_1_withSkin',
    'Meshy_AI_Animation_Left_Uppercut_from_Guard_withSkin',
    'Meshy_AI_Animation_Running_withSkin',
    'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin',
    'Meshy_AI_Animation_Throw_withSkin',
    'Meshy_AI_Animation_Walking_withSkin',
    'Crawling',
    'Flying'
]);

const fbxLoader = new FBXLoader();
const modelCache = new Map(); // url -> Promise<THREE.Group>
const clipCache = new Map();  // url -> Promise<THREE.AnimationClip>

/** "Walking.fbx", "assets/Walking.fbx" or "/assets/Walking.fbx" -> absolute ".../assets/Walking.fbx" */
export function assetUrl(fileOrUrl) {
    if (/^(https?:)?\/\//.test(fileOrUrl)) return fileOrUrl;
    const clean = fileOrUrl.replace(/^\.?\//, '').replace(/^assets\//, '');
    return ASSET_BASE + clean;
}

function baseName(fileOrUrl) {
    return fileOrUrl.split('/').pop().replace(/\.(fbx|json)$/i, '');
}

/**
 * Load (and cache) an FBX. The returned object is shared: clone it (SkeletonUtils.clone)
 * before adding it to a scene more than once.
 */
export function loadModel(fileOrUrl, onProgress) {
    const url = assetUrl(fileOrUrl);
    if (!modelCache.has(url)) {
        const promise = new Promise((resolve, reject) => {
            fbxLoader.load(url, resolve, onProgress, reject);
        });
        promise.catch(() => modelCache.delete(url)); // allow a retry after a failure
        modelCache.set(url, promise);
    }
    return modelCache.get(url);
}

/**
 * Load (and cache) the first animation clip of an animation file.
 * Uses the animation-only JSON clip when available, otherwise the FBX itself.
 */
export function loadClip(fileOrUrl) {
    const name = baseName(fileOrUrl);
    const useJson = JSON_CLIPS.has(name);
    const url = useJson ? `${ASSET_BASE}anims/${name}.json` : assetUrl(fileOrUrl);
    if (!clipCache.has(url)) {
        const promise = useJson
            ? fetch(url)
                .then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
                    return r.json();
                })
                .then(json => THREE.AnimationClip.parse(json))
                .catch(err => {
                    // Fall back to the original FBX if the JSON clip is missing or broken
                    console.warn(`[AssetLoader] JSON clip failed (${err.message}), falling back to FBX`);
                    return loadModel(fileOrUrl).then(obj => obj.animations[0]);
                })
            : loadModel(fileOrUrl).then(obj => obj.animations[0]);
        promise.catch(() => clipCache.delete(url));
        clipCache.set(url, promise);
    }
    // Each caller gets its own copy so per-mode tweaks (renaming, track filtering) never leak
    return clipCache.get(url).then(clip => (clip ? clip.clone() : clip));
}

/**
 * Load several clips in parallel.
 * @param {Object<string,string>} files  { walk: 'Meshy_..._Walking_withSkin.fbx', ... }
 * @param {(loaded:number,total:number,name:string)=>void} [onEach]
 * @returns {Promise<Object<string,THREE.AnimationClip>>} Clips by key (failed ones are left out)
 */
export async function loadClips(files, onEach) {
    const entries = Object.entries(files);
    let loaded = 0;
    const results = await Promise.all(entries.map(async ([key, file]) => {
        try {
            const clip = await loadClip(file);
            if (clip) clip.name = key;
            return [key, clip];
        } catch (err) {
            console.warn(`[AssetLoader] Could not load animation "${key}" (${file})`, err);
            return [key, null];
        } finally {
            loaded++;
            onEach?.(loaded, entries.length, key);
        }
    }));
    return Object.fromEntries(results.filter(([, clip]) => clip));
}

/**
 * Load several models in parallel (cached).
 * @param {Object<string,string>} files { edgar: 'Edgar_Model.fbx', ... }
 * @returns {Promise<Object<string,THREE.Group>>} Models by key (failed ones are left out)
 */
export async function loadModels(files, onEach) {
    const entries = Object.entries(files);
    let loaded = 0;
    const results = await Promise.all(entries.map(async ([key, file]) => {
        try {
            return [key, await loadModel(file)];
        } catch (err) {
            console.warn(`[AssetLoader] Could not load model "${key}" (${file})`, err);
            return [key, null];
        } finally {
            loaded++;
            onEach?.(loaded, entries.length, key);
        }
    }));
    return Object.fromEntries(results.filter(([, model]) => model));
}

/** Whether a model URL was already requested (loaded or in flight) */
export function isModelRequested(fileOrUrl) {
    return modelCache.has(assetUrl(fileOrUrl));
}
