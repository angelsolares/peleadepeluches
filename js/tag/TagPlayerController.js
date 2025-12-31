/**
 * Tag Player Controller
 * Handles 360-degree movement and Tag-specific states
 */

import * as THREE from 'three';

const TAG_PHYSICS = {
    MOVE_SPEED: 7,
    IT_SPEED_BOOST: 1.1,
    FRICTION: 0.85
};

class TagPlayerController {
    constructor(playerId, playerNumber, color) {
        this.id = playerId;
        this.playerNumber = playerNumber;
        this.color = color;
        
        // Position and movement (3D - X and Z for ground plane)
        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.movementDirection = new THREE.Vector3(0, 0, 0);
        this.facingAngle = 0; // Radians
        
        // State flags
        this.isIt = false;
        this.hasGrace = false;
        this.penaltyTime = 0;
        
        // Input state (4 directions)
        this.input = {
            left: false,
            right: false,
            up: false,
            down: false
        };
    }
    
    /**
     * Update player physics and state
     * @param {number} delta - Time since last frame
     */
    update(delta) {
        // Process movement input
        this.processMovement(delta);
        
        // Apply friction
        this.velocity.multiplyScalar(TAG_PHYSICS.FRICTION);
        
        // Update position
        this.updatePosition(delta);
    }
    
    /**
     * Process movement input for 360-degree movement
     */
    processMovement(delta) {
        this.movementDirection.set(0, 0, 0);
        
        if (this.input.left) this.movementDirection.x -= 1;
        if (this.input.right) this.movementDirection.x += 1;
        if (this.input.up) this.movementDirection.z -= 1;
        if (this.input.down) this.movementDirection.z += 1;
        
        if (this.movementDirection.length() > 0) {
            this.movementDirection.normalize();
            
            let speed = TAG_PHYSICS.MOVE_SPEED;
            if (this.isIt) {
                speed *= TAG_PHYSICS.IT_SPEED_BOOST;
            }
            
            this.velocity.x = this.movementDirection.x * speed;
            this.velocity.z = this.movementDirection.z * speed;
            
            this.facingAngle = Math.atan2(this.movementDirection.x, this.movementDirection.z);
        }
    }
    
    /**
     * Update position based on velocity
     */
    updatePosition(delta) {
        this.position.x += this.velocity.x * delta;
        this.position.z += this.velocity.z * delta;
    }
    
    /**
     * Apply state from server
     * @param {object} state - Server state
     */
    applyServerState(state) {
        if (state.position) {
            this.position.set(state.position.x, 0, state.position.z);
        }
        if (state.velocity) {
            this.velocity.set(state.velocity.x, 0, state.velocity.z);
        }
        if (typeof state.facingAngle === 'number') this.facingAngle = state.facingAngle;
        if (typeof state.isIt === 'boolean') this.isIt = state.isIt;
        if (typeof state.hasGrace === 'boolean') this.hasGrace = state.hasGrace;
        if (typeof state.penaltyTime === 'number') this.penaltyTime = state.penaltyTime;
        if (state.input) this.input = { ...this.input, ...state.input };
    }
    
    /**
     * Get movement state for animation selection
     */
    getMovementState() {
        const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
        if (speed > 1) {
            return this.isIt ? 'run' : 'walk';
        }
        return 'idle';
    }
}

export default TagPlayerController;

