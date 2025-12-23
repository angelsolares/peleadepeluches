/**
 * Arena Player Controller
 * Handles 360-degree movement, health, stamina, and combat for Arena mode
 */

import * as THREE from 'three';

// Arena-specific physics and combat config
const ARENA_PHYSICS = {
    MOVE_SPEED: 5,
    RUN_SPEED: 8,
    FRICTION: 0.85,
    
    // Health & Stamina
    MAX_HEALTH: 100,
    MAX_STAMINA: 100,
    STAMINA_REGEN: 10,       // Per second when not attacking
    STAMINA_REGEN_DELAY: 0.5, // Seconds after action before regen starts
    
    // Stamina costs
    PUNCH_STAMINA: 15,
    KICK_STAMINA: 20,
    GRAB_STAMINA: 25,
    THROW_STAMINA: 30,
    BLOCK_STAMINA_PER_SEC: 5,
    
    // Damage values
    PUNCH_DAMAGE: 10,
    KICK_DAMAGE: 15,
    THROW_DAMAGE: 25,
    
    // Knockback
    PUNCH_KNOCKBACK: 3,
    KICK_KNOCKBACK: 5,
    THROW_KNOCKBACK: 10,
    
    // Timing
    ATTACK_COOLDOWN: 0.5,
    GRAB_DURATION: 2.0,
    STUN_DURATION: 0.5,
};

class ArenaPlayerController {
    constructor(playerId, playerNumber, color) {
        this.id = playerId;
        this.playerNumber = playerNumber;
        this.color = color;
        
        // Position and movement (3D - X and Z for ground plane)
        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.movementDirection = new THREE.Vector3(0, 0, 0);
        this.facingAngle = 0; // Radians
        
        // Health and Stamina
        this.health = ARENA_PHYSICS.MAX_HEALTH;
        this.stamina = ARENA_PHYSICS.MAX_STAMINA;
        this.maxHealth = ARENA_PHYSICS.MAX_HEALTH;
        this.maxStamina = ARENA_PHYSICS.MAX_STAMINA;
        
        // State flags
        this.isAttacking = false;
        this.isBlocking = false;
        this.isGrabbing = false;
        this.isGrabbed = false;
        this.isStunned = false;
        this.isTaunting = false;
        this.isEliminated = false;
        this.isNearEdge = false;
        this.isExhausted = false; // No stamina
        
        // Grab state
        this.grabbedPlayer = null;
        this.grabbedBy = null;
        this.grabTimer = 0;
        
        // Timers
        this.attackCooldown = 0;
        this.stunTimer = 0;
        this.staminaRegenTimer = 0;
        
        // Input state (4 directions + actions)
        this.input = {
            left: false,
            right: false,
            up: false,
            down: false,
            run: false,
            punch: false,
            kick: false,
            grab: false,
            block: false
        };
    }
    
    /**
     * Update player physics and state
     * @param {number} delta - Time since last frame
     */
    update(delta) {
        // Don't update if eliminated
        if (this.isEliminated) return;
        
        // Update timers
        this.updateTimers(delta);
        
        // Regenerate stamina
        this.updateStamina(delta);
        
        // Handle stunned state
        if (this.isStunned) {
            this.velocity.multiplyScalar(0.9);
            return;
        }
        
        // Handle grabbed state
        if (this.isGrabbed) {
            this.velocity.set(0, 0, 0);
            return;
        }
        
        // Don't process movement during certain states
        if (this.isAttacking || this.isGrabbing || this.isTaunting) {
            this.velocity.multiplyScalar(0.9);
            this.updatePosition(delta);
            return;
        }
        
        // Process movement input
        this.processMovement(delta);
        
        // Apply friction
        this.velocity.multiplyScalar(ARENA_PHYSICS.FRICTION);
        
        // Update position
        this.updatePosition(delta);
    }
    
    /**
     * Process movement input for 360-degree movement
     */
    processMovement(delta) {
        // Calculate movement direction from input
        this.movementDirection.set(0, 0, 0);
        
        if (this.input.left) this.movementDirection.x -= 1;
        if (this.input.right) this.movementDirection.x += 1;
        if (this.input.up) this.movementDirection.z -= 1;
        if (this.input.down) this.movementDirection.z += 1;
        
        // Normalize for diagonal movement
        if (this.movementDirection.length() > 0) {
            this.movementDirection.normalize();
            
            // Calculate target speed
            const speed = this.input.run ? ARENA_PHYSICS.RUN_SPEED : ARENA_PHYSICS.MOVE_SPEED;
            
            // Apply movement
            this.velocity.x = this.movementDirection.x * speed;
            this.velocity.z = this.movementDirection.z * speed;
            
            // Update facing angle based on movement
            this.facingAngle = Math.atan2(this.movementDirection.x, this.movementDirection.z);
        }
    }
    
    /**
     * Update position based on velocity
     */
    updatePosition(delta) {
        this.position.x += this.velocity.x * delta;
        this.position.z += this.velocity.z * delta;
        
        // Y position is controlled by arena (ring height)
    }
    
    /**
     * Update various timers
     */
    updateTimers(delta) {
        // Attack cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= delta;
            if (this.attackCooldown <= 0) {
                this.isAttacking = false;
            }
        }
        
        // Stun timer
        if (this.stunTimer > 0) {
            this.stunTimer -= delta;
            if (this.stunTimer <= 0) {
                this.isStunned = false;
            }
        }
        
        // Grab timer
        if (this.isGrabbing && this.grabTimer > 0) {
            this.grabTimer -= delta;
            if (this.grabTimer <= 0) {
                this.releaseGrab();
            }
        }
        
        // Stamina regen delay
        if (this.staminaRegenTimer > 0) {
            this.staminaRegenTimer -= delta;
        }
    }
    
    /**
     * Update stamina regeneration
     */
    updateStamina(delta) {
        // Don't regen while blocking
        if (this.isBlocking) {
            this.consumeStamina(ARENA_PHYSICS.BLOCK_STAMINA_PER_SEC * delta);
            return;
        }
        
        // Regen after delay
        if (this.staminaRegenTimer <= 0 && this.stamina < this.maxStamina) {
            this.stamina = Math.min(
                this.maxStamina,
                this.stamina + ARENA_PHYSICS.STAMINA_REGEN * delta
            );
        }
        
        // Update exhausted state
        this.isExhausted = this.stamina < 10;
    }
    
    /**
     * Consume stamina for an action
     * @returns {boolean} True if had enough stamina
     */
    consumeStamina(amount) {
        if (this.stamina < amount) {
            return false;
        }
        
        this.stamina -= amount;
        this.staminaRegenTimer = ARENA_PHYSICS.STAMINA_REGEN_DELAY;
        return true;
    }
    
    /**
     * Perform a punch attack
     * @returns {boolean} True if attack was performed
     */
    punch() {
        if (this.isAttacking || this.attackCooldown > 0 || this.isExhausted) {
            return false;
        }
        
        if (!this.consumeStamina(ARENA_PHYSICS.PUNCH_STAMINA)) {
            return false;
        }
        
        this.isAttacking = true;
        this.attackCooldown = ARENA_PHYSICS.ATTACK_COOLDOWN;
        
        return {
            type: 'punch',
            damage: ARENA_PHYSICS.PUNCH_DAMAGE,
            knockback: ARENA_PHYSICS.PUNCH_KNOCKBACK,
            direction: this.facingAngle
        };
    }
    
    /**
     * Perform a kick attack
     * @returns {boolean} True if attack was performed
     */
    kick() {
        if (this.isAttacking || this.attackCooldown > 0 || this.isExhausted) {
            return false;
        }
        
        if (!this.consumeStamina(ARENA_PHYSICS.KICK_STAMINA)) {
            return false;
        }
        
        this.isAttacking = true;
        this.attackCooldown = ARENA_PHYSICS.ATTACK_COOLDOWN * 1.2;
        
        return {
            type: 'kick',
            damage: ARENA_PHYSICS.KICK_DAMAGE,
            knockback: ARENA_PHYSICS.KICK_KNOCKBACK,
            direction: this.facingAngle
        };
    }
    
    /**
     * Attempt to grab another player
     * @returns {boolean} True if grab was initiated
     */
    grab() {
        if (this.isAttacking || this.isGrabbing || this.isExhausted) {
            return false;
        }
        
        if (!this.consumeStamina(ARENA_PHYSICS.GRAB_STAMINA)) {
            return false;
        }
        
        this.isGrabbing = true;
        this.grabTimer = ARENA_PHYSICS.GRAB_DURATION;
        
        return {
            type: 'grab',
            direction: this.facingAngle
        };
    }
    
    /**
     * Throw a grabbed player
     * @returns {object|false} Throw info or false if can't throw
     */
    throwPlayer() {
        if (!this.isGrabbing || !this.grabbedPlayer) {
            return false;
        }
        
        if (!this.consumeStamina(ARENA_PHYSICS.THROW_STAMINA)) {
            // Not enough stamina, just release
            this.releaseGrab();
            return false;
        }
        
        const throwInfo = {
            type: 'throw',
            targetId: this.grabbedPlayer.id,
            damage: ARENA_PHYSICS.THROW_DAMAGE,
            knockback: ARENA_PHYSICS.THROW_KNOCKBACK,
            direction: this.facingAngle
        };
        
        this.releaseGrab();
        
        return throwInfo;
    }
    
    /**
     * Release a grabbed player
     */
    releaseGrab() {
        if (this.grabbedPlayer) {
            this.grabbedPlayer.isGrabbed = false;
            this.grabbedPlayer.grabbedBy = null;
        }
        
        this.isGrabbing = false;
        this.grabbedPlayer = null;
        this.grabTimer = 0;
    }
    
    /**
     * Get grabbed by another player
     * @param {ArenaPlayerController} grabber - The player grabbing this one
     */
    getGrabbed(grabber) {
        this.isGrabbed = true;
        this.grabbedBy = grabber;
        this.velocity.set(0, 0, 0);
    }
    
    /**
     * Take damage from an attack
     * @param {number} damage - Damage amount
     * @param {number} knockback - Knockback force
     * @param {number} direction - Direction of knockback (radians)
     * @param {boolean} blocked - Whether the attack was blocked
     */
    takeDamage(damage, knockback, direction, blocked = false) {
        if (this.isEliminated) return;
        
        // Reduce damage if blocking
        const actualDamage = blocked ? damage * 0.2 : damage;
        const actualKnockback = blocked ? knockback * 0.3 : knockback;
        
        // Apply damage
        this.health = Math.max(0, this.health - actualDamage);
        
        // Apply knockback
        this.velocity.x += Math.sin(direction) * actualKnockback;
        this.velocity.z += Math.cos(direction) * actualKnockback;
        
        // Apply stun
        if (!blocked) {
            this.isStunned = true;
            this.stunTimer = ARENA_PHYSICS.STUN_DURATION;
        }
        
        // Check for elimination
        if (this.health <= 0) {
            this.eliminate();
        }
        
        return {
            damage: actualDamage,
            blocked: blocked,
            eliminated: this.isEliminated
        };
    }
    
    /**
     * Eliminate this player from the match
     */
    eliminate() {
        this.isEliminated = true;
        this.health = 0;
        this.velocity.set(0, 0, 0);
    }
    
    /**
     * Reset player for a new round
     */
    reset() {
        this.health = this.maxHealth;
        this.stamina = this.maxStamina;
        this.isAttacking = false;
        this.isBlocking = false;
        this.isGrabbing = false;
        this.isGrabbed = false;
        this.isStunned = false;
        this.isTaunting = false;
        this.isEliminated = false;
        this.isExhausted = false;
        this.grabbedPlayer = null;
        this.grabbedBy = null;
        this.attackCooldown = 0;
        this.stunTimer = 0;
        this.grabTimer = 0;
        this.velocity.set(0, 0, 0);
    }
    
    /**
     * Apply state from server
     * @param {object} state - Server state
     */
    applyServerState(state) {
        if (state.position) {
            this.position.set(state.position.x, state.position.y, state.position.z);
        }
        if (state.velocity) {
            this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
        }
        if (typeof state.health === 'number') this.health = state.health;
        if (typeof state.stamina === 'number') this.stamina = state.stamina;
        if (typeof state.isStunned === 'boolean') this.isStunned = state.isStunned;
        if (typeof state.isGrabbed === 'boolean') this.isGrabbed = state.isGrabbed;
        if (typeof state.isEliminated === 'boolean') this.isEliminated = state.isEliminated;
        if (state.input) this.input = { ...this.input, ...state.input };
    }
    
    /**
     * Get current state for networking
     * @returns {object} Current state
     */
    getState() {
        return {
            id: this.id,
            position: { x: this.position.x, y: this.position.y, z: this.position.z },
            velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
            health: this.health,
            stamina: this.stamina,
            facingAngle: this.facingAngle,
            isAttacking: this.isAttacking,
            isBlocking: this.isBlocking,
            isGrabbing: this.isGrabbing,
            isGrabbed: this.isGrabbed,
            isStunned: this.isStunned,
            isEliminated: this.isEliminated
        };
    }
    
    /**
     * Get movement state for animation selection
     * @returns {string} Movement state name
     */
    getMovementState() {
        if (this.isEliminated) return 'fall';
        if (this.isStunned) return 'hit';
        if (this.isAttacking) return 'attacking';
        if (this.isGrabbing) return 'grabbing';
        if (this.isGrabbed) return 'grabbed';
        if (this.isBlocking) return 'blocking';
        if (this.isTaunting) return 'taunting';
        
        const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
        if (speed > 0.5) {
            return this.input.run ? 'running' : 'walking';
        }
        
        return 'idle';
    }
}

export default ArenaPlayerController;

