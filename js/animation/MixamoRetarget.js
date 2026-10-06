/**
 * Mixamo -> Meshy retargeting
 *
 * Converts an animation clip made for the Mixamo skeleton (mixamorigHips, mixamorigSpine, ...)
 * into a clip for the Meshy biped skeleton used by the plush characters (Hips, Spine02, ...).
 *
 * How it works, per mapped bone and per frame:
 *   - D = how much the source bone rotated in world space since its rest pose
 *   - A = aligns the target bone's rest direction with the source bone's rest direction
 *         (Mixamo rests in a T-pose, Meshy in an A-pose; without this the arms end up too low)
 *   - target world rotation = D * A * targetRest
 * The world rotation is then converted to the bone's local rotation, parents first.
 * Hips translation is copied as a delta from rest, scaled by the leg-length ratio.
 */

import * as THREE from 'three';

// Meshy bone name -> Mixamo bone name (FBXLoader drops the ':' from "mixamorig:")
export const MESHY_TO_MIXAMO = {
    Hips: 'mixamorigHips',
    Spine02: 'mixamorigSpine',
    Spine01: 'mixamorigSpine1',
    Spine: 'mixamorigSpine2',
    neck: 'mixamorigNeck',
    Head: 'mixamorigHead',
    LeftShoulder: 'mixamorigLeftShoulder',
    LeftArm: 'mixamorigLeftArm',
    LeftForeArm: 'mixamorigLeftForeArm',
    LeftHand: 'mixamorigLeftHand',
    RightShoulder: 'mixamorigRightShoulder',
    RightArm: 'mixamorigRightArm',
    RightForeArm: 'mixamorigRightForeArm',
    RightHand: 'mixamorigRightHand',
    LeftUpLeg: 'mixamorigLeftUpLeg',
    LeftLeg: 'mixamorigLeftLeg',
    LeftFoot: 'mixamorigLeftFoot',
    LeftToeBase: 'mixamorigLeftToeBase',
    RightUpLeg: 'mixamorigRightUpLeg',
    RightLeg: 'mixamorigRightLeg',
    RightFoot: 'mixamorigRightFoot',
    RightToeBase: 'mixamorigRightToeBase'
};

// Child used to measure each bone's direction (target name -> [target child, source child])
const DIRECTION_CHILD = {
    Spine02: ['Spine01', 'mixamorigSpine1'],
    Spine01: ['Spine', 'mixamorigSpine2'],
    Spine: ['neck', 'mixamorigNeck'],
    neck: ['Head', 'mixamorigHead'],
    Head: ['head_end', 'mixamorigHeadTop_End'],
    LeftShoulder: ['LeftArm', 'mixamorigLeftArm'],
    LeftArm: ['LeftForeArm', 'mixamorigLeftForeArm'],
    LeftForeArm: ['LeftHand', 'mixamorigLeftHand'],
    RightShoulder: ['RightArm', 'mixamorigRightArm'],
    RightArm: ['RightForeArm', 'mixamorigRightForeArm'],
    RightForeArm: ['RightHand', 'mixamorigRightHand'],
    LeftUpLeg: ['LeftLeg', 'mixamorigLeftLeg'],
    LeftLeg: ['LeftFoot', 'mixamorigLeftFoot'],
    LeftFoot: ['LeftToeBase', 'mixamorigLeftToeBase'],
    RightUpLeg: ['RightLeg', 'mixamorigRightLeg'],
    RightLeg: ['RightFoot', 'mixamorigRightFoot'],
    RightFoot: ['RightToeBase', 'mixamorigRightToeBase']
};

function collectBones(root) {
    const bones = new Map();
    root.traverse(o => { if (o.isBone) bones.set(o.name, o); });
    return bones;
}

function worldQuat(obj) {
    return obj.getWorldQuaternion(new THREE.Quaternion());
}

function worldPos(obj) {
    return obj.getWorldPosition(new THREE.Vector3());
}

function legLength(bones, up, leg, foot) {
    const a = bones.get(up), b = bones.get(leg), c = bones.get(foot);
    if (!a || !b || !c) return 0;
    return worldPos(a).distanceTo(worldPos(b)) + worldPos(b).distanceTo(worldPos(c));
}

/**
 * Retarget a Mixamo clip onto a Meshy-rigged model.
 *
 * @param {THREE.Object3D} targetRoot  Meshy model as loaded (rest pose, no animation applied)
 * @param {THREE.Object3D} sourceRoot  Mixamo FBX as loaded (skinless is fine), rest pose
 * @param {THREE.AnimationClip} clip   Mixamo clip (tracks named mixamorigXxx.*)
 * @param {object} [options]
 * @param {number} [options.fps=30]          Sampling rate of the output clip
 * @param {boolean} [options.inPlace=true]   Drop horizontal hips movement (keep vertical)
 * @param {string} [options.name]            Name for the output clip
 * @returns {THREE.AnimationClip}
 */
export function retargetMixamoClip(targetRoot, sourceRoot, clip, options = {}) {
    const fps = options.fps ?? 30;
    const inPlace = options.inPlace ?? true;

    // Work on clones at the origin so the caller's objects are untouched
    const target = targetRoot.clone(true);
    const source = sourceRoot.clone(true);
    for (const root of [target, source]) {
        root.position.set(0, 0, 0);
        root.quaternion.identity();
        root.scale.set(1, 1, 1);
        root.updateMatrixWorld(true);
    }

    const tBones = collectBones(target);
    const sBones = collectBones(source);

    // Target bones in hierarchy order (parents first) that have a source match
    const ordered = [];
    target.traverse(o => {
        if (o.isBone && MESHY_TO_MIXAMO[o.name] && sBones.has(MESHY_TO_MIXAMO[o.name])) ordered.push(o);
    });

    // Rest data
    const rest = new Map();
    for (const bone of ordered) {
        const src = sBones.get(MESHY_TO_MIXAMO[bone.name]);
        const tRest = worldQuat(bone);
        const sRestInv = worldQuat(src).invert();

        // Alignment: rotate the target's rest direction onto the source's rest direction
        const align = new THREE.Quaternion();
        const dirs = DIRECTION_CHILD[bone.name];
        if (dirs) {
            const tChild = tBones.get(dirs[0]);
            const sChild = sBones.get(dirs[1]);
            if (tChild && sChild) {
                const tDir = worldPos(tChild).sub(worldPos(bone)).normalize();
                const sDir = worldPos(sChild).sub(worldPos(src)).normalize();
                align.setFromUnitVectors(tDir, sDir);
            }
        }
        rest.set(bone.name, { src, tRest, sRestInv, align, localRest: bone.quaternion.clone() });
    }

    // Hips translation scaling
    const tHips = tBones.get('Hips');
    const sHips = sBones.get('mixamorigHips');
    const tLeg = legLength(tBones, 'LeftUpLeg', 'LeftLeg', 'LeftFoot');
    const sLeg = legLength(sBones, 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot');
    const ratio = sLeg > 0 ? tLeg / sLeg : 1;
    const tHipsRestWorld = tHips ? worldPos(tHips) : null;
    const sHipsRestWorld = sHips ? worldPos(sHips) : null;

    // Sample the source animation
    const mixer = new THREE.AnimationMixer(source);
    const action = mixer.clipAction(clip);
    action.play();

    const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const quatValues = new Map(ordered.map(b => [b.name, new Float32Array(frames * 4)]));
    const hipsValues = new Float32Array(frames * 3);

    const delta = new THREE.Quaternion();
    const world = new THREE.Quaternion();
    const parentWorld = new THREE.Quaternion();
    const tmpPos = new THREE.Vector3();

    for (let f = 0; f < frames; f++) {
        const t = Math.min(f / fps, clip.duration);
        times[f] = t;
        mixer.setTime(t);
        source.updateMatrixWorld(true);

        for (const bone of ordered) {
            const r = rest.get(bone.name);
            // D = sourceNow * sourceRest^-1 ; target = D * A * targetRest
            delta.copy(worldQuat(r.src)).multiply(r.sRestInv);
            world.copy(delta).multiply(r.align).multiply(r.tRest);

            // To local: parentWorld^-1 * world
            if (bone.parent) {
                bone.parent.getWorldQuaternion(parentWorld);
                bone.quaternion.copy(parentWorld.invert().multiply(world));
            } else {
                bone.quaternion.copy(world);
            }
            bone.updateMatrixWorld(true);
            bone.quaternion.toArray(quatValues.get(bone.name), f * 4);
        }

        // Hips translation (delta from rest, scaled), expressed in the hips' parent space
        if (tHips && sHips) {
            const d = worldPos(sHips).sub(sHipsRestWorld).multiplyScalar(ratio);
            if (inPlace) { d.x = 0; d.z = 0; }
            tmpPos.copy(tHipsRestWorld).add(d);
            if (tHips.parent) tHips.parent.worldToLocal(tmpPos);
            tmpPos.toArray(hipsValues, f * 3);
        }
    }

    mixer.stopAllAction();

    const tracks = [];
    for (const bone of ordered) {
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, quatValues.get(bone.name)));
    }
    if (tHips && sHips) {
        tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipsValues));
    }

    return new THREE.AnimationClip(options.name || clip.name, clip.duration, tracks);
}
