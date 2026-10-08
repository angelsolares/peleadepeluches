/**
 * Sumo Player Controller
 * Mirror of the server snapshot for one sumo player (the server is authoritative:
 * the host only renders). Keeps position/velocity/facing and the sumo flags.
 */

import * as THREE from 'three';

const SUMO_ANIM = {
    WALK_SPEED: 1,   // Below this the player is idle
    RUN_SPEED: 5     // Above this the player runs
};

class SumoPlayerController {
    constructor(playerId, playerNumber, color) {
        this.id = playerId;
        this.playerNumber = playerNumber;
        this.color = color;

        // World units: y goes negative while an eliminated player drops below the ring
        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.facingAngle = 0; // Radians, atan2(dirX, dirZ)

        // Sumo flags
        this.isCharging = false;
        this.chargeRatio = 0;
        this.isShoving = false;
        this.stunned = false;
        this.alive = true;
        this.falling = false;
        this.placement = null;
    }

    /**
     * Apply a 'sumo-state' player snapshot
     * @param {object} state
     */
    applyServerState(state) {
        if (state.position) {
            this.position.set(state.position.x || 0, state.position.y || 0, state.position.z || 0);
        }
        if (state.velocity) {
            this.velocity.set(state.velocity.x || 0, 0, state.velocity.z || 0);
        }
        if (typeof state.facingAngle === 'number') this.facingAngle = state.facingAngle;
        if (typeof state.isCharging === 'boolean') this.isCharging = state.isCharging;
        if (typeof state.chargeRatio === 'number') this.chargeRatio = Math.max(0, Math.min(1, state.chargeRatio));
        if (typeof state.isShoving === 'boolean') this.isShoving = state.isShoving;
        if (typeof state.stunned === 'boolean') this.stunned = state.stunned;
        if (typeof state.alive === 'boolean') this.alive = state.alive;
        if (typeof state.falling === 'boolean') this.falling = state.falling;
        if (state.placement !== undefined) this.placement = state.placement;
    }

    /** Planar speed (world units / s) */
    getSpeed() {
        return Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    }

    /**
     * Movement animation for the current snapshot: run while shoving or moving fast,
     * walk while moving, idle otherwise
     */
    getMovementState() {
        if (this.isShoving) return 'run';
        const speed = this.getSpeed();
        if (speed > SUMO_ANIM.RUN_SPEED) return 'run';
        if (speed > SUMO_ANIM.WALK_SPEED) return 'walk';
        return 'idle';
    }
}

export default SumoPlayerController;
